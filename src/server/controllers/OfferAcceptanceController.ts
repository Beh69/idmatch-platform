// «control» OfferAcceptanceController — implements ID05 "Accept a price offer".
// This is the richest flow. It mirrors the ID05 sequence diagram end-to-end:
//
//   validateOffer (isValid)        -> PriceOffer entity
//   verifyIdentity                 -> Singpass/MyInfo (boundary)
//   markAccepted
//   generateContract + requestSignatures -> ESignatureService (ETA, boundary)
//   applyGst (9%)                  -> TaxService (boundary)
//   chargeDeposit                  -> PaymentGateway PayNow/NETS/card (boundary)
//   reportToIras + issueTaxInvoice -> TaxService (boundary)
//   verifyHdbPermit                -> HdbPermitService (boundary)
//   notifyInsurer                  -> InsuranceProvider (boundary)
//   createBooking                  -> Booking entity
//   notifyDesigner
//
// Alternate flows (each returns a typed error): offer invalid/expired,
// Singpass fails, contract unsigned, payment declined, HDB permit not approved.
import { db } from "../db.js";
import { id, now, audit } from "../services/helpers.js";
import { httpError } from "./InquiryController.js";
import {
  singpassMyInfo,
  eSignatureService,
  paymentGateway,
  taxService,
  hdbPermitService,
  insuranceProvider,
  round2,
  type SimulationFlags,
} from "../services/externalServices.js";
import { PLATFORM_COMMISSION_RATE, PROJECT_STAGES } from "../../shared/types.js";
import type { PriceOffer, Contract, Payment, Booking, StageEntry, ProjectStage, UploadedDocument } from "../../shared/types.js";

export interface AcceptResult {
  booking: Booking;
  contract: Contract;
  payment: Payment;
  steps: string[]; // ordered trace of the chain — surfaced in the UI
}

export class OfferAcceptanceController {
  static isValid(offer: PriceOffer | undefined): offer is PriceOffer {
    if (!offer) return false;
    if (offer.status !== "open") return false;
    return new Date(offer.expiryDate).getTime() > Date.now();
  }

  static async acceptOffer(
    custId: string,
    offerId: string,
    method: string,
    sim: SimulationFlags = {},
    documents: UploadedDocument[] = []
  ): Promise<AcceptResult> {
    const steps: string[] = [];
    const offer = db.prepare(`SELECT * FROM price_offers WHERE id = ?`).get(offerId) as PriceOffer | undefined;

    // --- validateOffer (alt 2a) ---
    if (!this.isValid(offer)) {
      throw httpError(410, "OFFER_INVALID", "This offer is no longer valid or has expired.");
    }
    if (offer.customerId !== custId) throw httpError(403, "FORBIDDEN", "This offer is not addressed to you.");
    steps.push("Offer validated (open & within expiry).");

    // --- verifyIdentity via Singpass/MyInfo (alt 3a) ---
    const idv = await singpassMyInfo.verify(custId, sim);
    if (!idv.verified) {
      throw httpError(401, "SINGPASS_FAILED", "Singpass identity verification failed. Please try again.");
    }
    steps.push(`Identity verified via Singpass/MyInfo (NRIC ${idv.maskedNric}).`);

    // --- markAccepted ---
    this.markAccepted(offerId);

    // --- generateContract + requestSignatures (ETA e-signature, alt 7a) ---
    const contract: Contract = {
      id: id("con"),
      offerId,
      terms: `Renovation agreement for project ${offer.idpId}. Agreed value: S$${offer.amountSgd.toFixed(
        2
      )}. Governed by Singapore law; executed electronically under the Electronic Transactions Act.`,
      signedByCustomer: false,
      signedByDesigner: false,
    };
    const sig = await eSignatureService.sendForSignature(contract.id, sim);
    if (!sig.bothSigned) {
      db.prepare(`UPDATE price_offers SET status = 'open' WHERE id = ?`).run(offerId); // roll back acceptance
      throw httpError(409, "CONTRACT_UNSIGNED", "The contract was not signed by both parties.");
    }
    contract.signedByCustomer = true;
    contract.signedByDesigner = true;
    db.prepare(
      `INSERT INTO contracts (id, offerId, terms, signedByCustomer, signedByDesigner) VALUES (?,?,?,1,1)`
    ).run(contract.id, offerId, contract.terms);
    steps.push(`Contract ${contract.id} e-signed by both parties (envelope ${sig.envelopeId}).`);

    // --- applyGst (9%) via TaxService ---
    const commissionSgd = round2(offer.amountSgd * PLATFORM_COMMISSION_RATE);
    const gstSgd = taxService.computeGst(commissionSgd);
    steps.push(`Commission S$${commissionSgd.toFixed(2)} + 9% GST S$${gstSgd.toFixed(2)} computed.`);

    // --- chargeDeposit via PaymentGateway (alt 10a) ---
    const totalSgd = round2(commissionSgd + gstSgd);
    const charge = await paymentGateway.charge(totalSgd, method, sim);
    if (!charge.approved) {
      db.prepare(`UPDATE price_offers SET status = 'open' WHERE id = ?`).run(offerId); // roll back
      throw httpError(402, "PAYMENT_DECLINED", `Payment via ${method} was declined.`);
    }
    const invoiceNo = "INV-" + new Date().getFullYear() + "-" + id("x").slice(-6).toUpperCase();
    const payment: Payment = {
      id: id("pay"),
      offerId,
      amountSgd: commissionSgd,
      commissionSgd,
      gstSgd,
      totalSgd,
      method,
      status: "approved",
      invoiceNo,
    };
    db.prepare(
      `INSERT INTO payments (id, offerId, amountSgd, commissionSgd, gstSgd, totalSgd, method, status, invoiceNo)
       VALUES (@id,@offerId,@amountSgd,@commissionSgd,@gstSgd,@totalSgd,@method,@status,@invoiceNo)`
    ).run(payment);
    steps.push(`Payment ${charge.ref} approved via ${method} — total S$${totalSgd.toFixed(2)}.`);

    // --- reportToIras + issueTaxInvoice ---
    await taxService.reportToIras(gstSgd, invoiceNo);
    this.issueTaxInvoice(payment); // «entity» Payment.issueTaxInvoice()
    steps.push(`GST reported to IRAS; tax invoice ${invoiceNo} issued.`);

    // --- verifyHdbPermit via HdbPermitService (alt 14a) ---
    const permit = await hdbPermitService.checkStatus(offerId, sim);
    if (permit !== "APPROVED") {
      throw httpError(409, "PERMIT_NOT_APPROVED", "HDB/BCA renovation permit is not approved yet.");
    }
    steps.push("HDB/BCA renovation permit verified as APPROVED.");

    // --- createBooking ---
    const booking: Booking = {
      id: id("bkg"),
      offerId,
      customerId: custId,
      designerId: offer.designerId,
      status: "pending_review",
      insured: false,
      permitVerified: true,
      createdDate: now(),
    };

    // --- notifyInsurer via InsuranceProvider ---
    const ins = await insuranceProvider.registerProject(booking.id);
    booking.insured = ins.insured;
    steps.push(`Renovation insurance registered (policy ${ins.policyNo}).`);

    // The booking is created in PENDING_REVIEW: the customer's uploaded documents
    // must be reviewed and approved by the designer before the project lifecycle
    // begins. No stage is set until approval.
    booking.status = "pending_review";
    db.prepare(
      `INSERT INTO bookings (id, offerId, customerId, designerId, status, insured, permitVerified, documents, stage, stageHistory, createdDate)
       VALUES (@id,@offerId,@customerId,@designerId,@status,@insured,@permitVerified,@documents,NULL,NULL,@createdDate)`
    ).run({
      ...booking,
      insured: booking.insured ? 1 : 0,
      permitVerified: 1,
      documents: JSON.stringify(documents),
    });

    // --- notifyDesigner ---
    audit("OFFER_ACCEPTED", custId, offerId, offer.amountSgd);
    audit("BOOKING_CONFIRMED", custId, booking.id);
    this.notifyDesigner(offer.designerId); // ID05: notify the designer of acceptance
    steps.push(`Booking ${booking.id} created with ${documents.length} document(s) — awaiting designer review.`);

    return { booking, contract, payment, steps };
  }

  // «entity» PriceOffer.markAccepted() — the ID05 sequence message.
  static markAccepted(offerId: string): void {
    db.prepare(`UPDATE price_offers SET status = 'accepted' WHERE id = ?`).run(offerId);
  }

  // «entity» Payment.issueTaxInvoice() — the ID05 sequence message (IRAS invoice).
  static issueTaxInvoice(payment: Payment): void {
    audit("TAX_INVOICE_ISSUED", null, payment.id, payment.gstSgd);
  }

  // notifyDesigner() — the ID05 sequence message.
  static notifyDesigner(designerId: string): void {
    audit("DESIGNER_NOTIFIED", null, designerId);
  }

  // Enriched booking SELECT: joins the customer/designer names, portfolio title,
  // agreed amount, and a related conversation id for display + chat linking.
  private static readonly ENRICHED_BOOKING =
    `SELECT b.*, cu.name AS customerName, du.name AS designerName, idp.title AS idpTitle, o.amountSgd AS amountSgd,
        (SELECT inq.id FROM inquiries inq WHERE inq.customerId = b.customerId AND inq.designerId = b.designerId
         ORDER BY inq.createdDate DESC LIMIT 1) AS relatedInquiryId
     FROM bookings b
     LEFT JOIN users cu ON cu.id = b.customerId
     LEFT JOIN users du ON du.id = b.designerId
     LEFT JOIN price_offers o ON o.id = b.offerId
     LEFT JOIN idps idp ON idp.id = o.idpId`;

  static listBookings(custId: string): Booking[] {
    return (
      db.prepare(`${this.ENRICHED_BOOKING} WHERE b.customerId = ? ORDER BY b.createdDate DESC`).all(custId) as Record<
        string,
        unknown
      >[]
    ).map((b) => this.hydrateBooking(b));
  }

  private static hydrateBooking(b: Record<string, unknown>): Booking {
    return {
      ...(b as unknown as Booking),
      insured: !!b.insured,
      permitVerified: !!b.permitVerified,
      documents: b.documents ? JSON.parse(b.documents as string) : [],
      stageHistory: b.stageHistory ? JSON.parse(b.stageHistory as string) : [],
      pendingConfirm: b.pendingConfirm ? JSON.parse(b.pendingConfirm as string) : { customer: false, designer: false },
    };
  }

  // All confirmed/active projects for a designer (so they can co-sign stages).
  static bookingsForDesigner(designerId: string): Booking[] {
    return (
      db
        .prepare(`${this.ENRICHED_BOOKING} WHERE b.designerId = ? AND b.status != 'pending_review' ORDER BY b.createdDate DESC`)
        .all(designerId) as Record<string, unknown>[]
    ).map((b) => this.hydrateBooking(b));
  }

  // Bookings whose documents the designer still needs to review.
  static pendingReviewForDesigner(designerId: string): Booking[] {
    return (
      db
        .prepare(`${this.ENRICHED_BOOKING} WHERE b.designerId = ? AND b.status = 'pending_review' ORDER BY b.createdDate DESC`)
        .all(designerId) as Record<string, unknown>[]
    ).map((b) => this.hydrateBooking(b));
  }

  // Designer reviews the uploaded documents and APPROVES the booking. Only then
  // does the project move to 'confirmed' and enter its staged lifecycle.
  static approveBooking(designerId: string, bookingId: string): Booking {
    const row = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId) as Record<string, unknown> | undefined;
    if (!row) throw httpError(404, "NOT_FOUND", "Booking not found.");
    if (row.designerId !== designerId) throw httpError(403, "FORBIDDEN", "Not your booking.");
    if (row.status !== "pending_review") throw httpError(409, "NOT_PENDING", "This booking is not awaiting review.");
    const firstStage = PROJECT_STAGES[0];
    const stageHistory: StageEntry[] = [{ stage: firstStage, at: now(), note: "Documents approved; project opened." }];
    db.prepare(`UPDATE bookings SET status = 'confirmed', stage = ?, stageHistory = ? WHERE id = ?`).run(
      firstStage,
      JSON.stringify(stageHistory),
      bookingId
    );
    audit("BOOKING_DOCS_APPROVED", designerId, bookingId);
    return this.hydrateBooking(db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId) as Record<string, unknown>);
  }

  // Advancing a stage requires BOTH parties to confirm. This records one party's
  // confirmation of the NEXT stage; only when customer AND designer have both
  // confirmed does the booking actually move on (and confirmations reset).
  static confirmStage(bookingId: string, role: "customer" | "designer"): Booking {
    const row = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId) as Record<string, unknown> | undefined;
    if (!row) throw httpError(404, "NOT_FOUND", "Booking not found.");
    if (row.status === "pending_review") throw httpError(409, "NOT_CONFIRMED", "The booking documents are still awaiting approval.");

    const current = (row.stage as ProjectStage) ?? PROJECT_STAGES[0];
    const idx = PROJECT_STAGES.indexOf(current);
    if (idx >= PROJECT_STAGES.length - 1) {
      throw httpError(409, "ALREADY_COMPLETE", "This project has already reached handover.");
    }

    const pending: { customer: boolean; designer: boolean } = row.pendingConfirm
      ? JSON.parse(row.pendingConfirm as string)
      : { customer: false, designer: false };
    pending[role] = true;

    // Both parties confirmed -> advance to the next stage and reset confirmations.
    if (pending.customer && pending.designer) {
      const next = PROJECT_STAGES[idx + 1];
      const history: StageEntry[] = row.stageHistory ? JSON.parse(row.stageHistory as string) : [];
      history.push({ stage: next, at: now(), note: "Confirmed by both customer and designer." });
      const completed = next === PROJECT_STAGES[PROJECT_STAGES.length - 1];
      db.prepare(`UPDATE bookings SET stage = ?, stageHistory = ?, status = ?, pendingConfirm = NULL WHERE id = ?`).run(
        next,
        JSON.stringify(history),
        completed ? "completed" : "confirmed",
        bookingId
      );
      audit("BOOKING_STAGE_ADVANCED", null, bookingId);
    } else {
      // Only one side has confirmed so far — store and wait for the other.
      db.prepare(`UPDATE bookings SET pendingConfirm = ? WHERE id = ?`).run(JSON.stringify(pending), bookingId);
      audit("BOOKING_STAGE_CONFIRMED_" + role.toUpperCase(), null, bookingId);
    }
    return this.hydrateBooking(db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId) as Record<string, unknown>);
  }
}
