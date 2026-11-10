// «control» PriceRequestController — implements ID04 "Request a price from a
// designer". Mirrors ID04 sequence: validateFields -> Designer.isAccepting ->
// create PriceRequest -> startSla -> notifyDesigner. Alt flows: missing fields,
// designer not accepting. Also lets a designer post a PriceOffer in response,
// which feeds ID05.
import { db } from "../db.js";
import { id, now, audit } from "../services/helpers.js";
import { httpError } from "./InquiryController.js";
import type { PriceRequest, PriceOffer, CompanyProfile, IDP } from "../../shared/types.js";

const SLA_HOURS = 48; // designer must respond within 48h

export class PriceRequestController {
  static validateFields(data: Partial<PriceRequest>): boolean {
    return Boolean(
      data.scope?.trim() &&
        data.propertyType?.trim() &&
        data.budgetRangeSgd?.trim() &&
        typeof data.unitSizeSqft === "number" &&
        data.unitSizeSqft > 0
    );
  }

  static isAccepting(designerId: string): boolean {
    const profile = db.prepare(`SELECT * FROM company_profiles WHERE designerId = ?`).get(designerId) as
      | CompanyProfile
      | undefined;
    return Boolean(profile?.acceptingRequests);
  }

  static createRequest(custId: string, idpId: string, data: Partial<PriceRequest>): PriceRequest {
    const idp = db.prepare(`SELECT * FROM idps WHERE id = ?`).get(idpId) as IDP | undefined;
    if (!idp) throw httpError(404, "IDP_UNAVAILABLE", "Portfolio not found.");
    if (!this.validateFields(data)) {
      throw httpError(400, "MISSING_FIELDS", "Please complete all fields (scope, property type, size, budget).");
    }
    if (!this.isAccepting(idp.designerId)) {
      throw httpError(409, "NOT_ACCEPTING", "This designer is not accepting new requests right now.");
    }

    const req: PriceRequest = {
      id: id("req"),
      idpId,
      customerId: custId,
      designerId: idp.designerId,
      scope: data.scope!.trim(),
      propertyType: data.propertyType!.trim(),
      unitSizeSqft: data.unitSizeSqft!,
      budgetRangeSgd: data.budgetRangeSgd!.trim(),
      status: "pending",
      slaDeadline: new Date(Date.now() + SLA_HOURS * 3600_000).toISOString(),
      createdDate: now(),
    };
    db.prepare(
      `INSERT INTO price_requests
        (id, idpId, customerId, designerId, scope, propertyType, unitSizeSqft, budgetRangeSgd, status, slaDeadline, createdDate)
       VALUES (@id,@idpId,@customerId,@designerId,@scope,@propertyType,@unitSizeSqft,@budgetRangeSgd,@status,@slaDeadline,@createdDate)`
    ).run(req);
    audit("PRICE_REQUEST_CREATED", custId, req.id);
    this.startSla(req.id); // ID04: start the 48h response SLA
    this.notifyDesigner(req.id); // ID04: notify the designer of the new request
    return req;
  }

  // startSla() — the ID04 sequence message; records the SLA clock start.
  static startSla(requestId: string): void {
    audit("PRICE_REQUEST_SLA_STARTED", null, requestId);
  }

  // notifyDesigner() — the ID04 sequence message; alerts the designer.
  static notifyDesigner(requestId: string): void {
    const req = db.prepare(`SELECT designerId FROM price_requests WHERE id = ?`).get(requestId) as
      | { designerId: string }
      | undefined;
    if (req) audit("DESIGNER_NOTIFIED", null, req.designerId);
  }

  // Designer responds with a concrete price offer (status Pending -> quoted).
  static createOffer(designerId: string, requestId: string, amountSgd: number): PriceOffer {
    const req = db.prepare(`SELECT * FROM price_requests WHERE id = ?`).get(requestId) as PriceRequest | undefined;
    if (!req) throw httpError(404, "NOT_FOUND", "Price request not found.");
    if (req.designerId !== designerId) throw httpError(403, "FORBIDDEN", "Not your request.");
    if (!(amountSgd > 0)) throw httpError(400, "BAD_AMOUNT", "Amount must be greater than zero.");

    const offer: PriceOffer = {
      id: id("off"),
      priceRequestId: req.id,
      idpId: req.idpId,
      customerId: req.customerId,
      designerId,
      amountSgd,
      status: "open",
      expiryDate: new Date(Date.now() + 14 * 24 * 3600_000).toISOString(),
    };
    db.prepare(
      `INSERT INTO price_offers (id, priceRequestId, idpId, customerId, designerId, amountSgd, status, expiryDate)
       VALUES (@id,@priceRequestId,@idpId,@customerId,@designerId,@amountSgd,@status,@expiryDate)`
    ).run(offer);
    db.prepare(`UPDATE price_requests SET status = 'quoted' WHERE id = ?`).run(requestId);
    audit("PRICE_OFFER_CREATED", designerId, offer.id, amountSgd);
    return offer;
  }

  // Customer proposes a COUNTER-OFFER on an open offer (price negotiation).
  // The offer moves to 'countered' and the designer is notified to respond.
  static counterOffer(custId: string, offerId: string, counterAmountSgd: number): PriceOffer {
    const offer = db.prepare(`SELECT * FROM price_offers WHERE id = ?`).get(offerId) as PriceOffer | undefined;
    if (!offer) throw httpError(404, "NOT_FOUND", "Offer not found.");
    if (offer.customerId !== custId) throw httpError(403, "FORBIDDEN", "This offer is not addressed to you.");
    if (offer.status !== "open") throw httpError(409, "NOT_OPEN", "Only an open offer can be countered.");
    if (!(counterAmountSgd > 0)) throw httpError(400, "BAD_AMOUNT", "Counter amount must be greater than zero.");

    db.prepare(`UPDATE price_offers SET status = 'countered', counterAmountSgd = ? WHERE id = ?`).run(
      counterAmountSgd,
      offerId
    );
    audit("PRICE_OFFER_COUNTERED", custId, offerId, counterAmountSgd);
    return db.prepare(`SELECT * FROM price_offers WHERE id = ?`).get(offerId) as PriceOffer;
  }

  // Designer responds to a counter: either accepts the counter amount (re-opens
  // the offer at that price) or proposes a new revised amount.
  static respondToCounter(designerId: string, offerId: string, acceptCounter: boolean, revisedAmountSgd?: number): PriceOffer {
    const offer = db.prepare(`SELECT * FROM price_offers WHERE id = ?`).get(offerId) as PriceOffer | undefined;
    if (!offer) throw httpError(404, "NOT_FOUND", "Offer not found.");
    if (offer.designerId !== designerId) throw httpError(403, "FORBIDDEN", "Not your offer.");
    if (offer.status !== "countered") throw httpError(409, "NOT_COUNTERED", "This offer has no pending counter.");

    const newAmount = acceptCounter ? offer.counterAmountSgd! : revisedAmountSgd;
    if (!(newAmount && newAmount > 0)) throw httpError(400, "BAD_AMOUNT", "A valid revised amount is required.");

    db.prepare(
      `UPDATE price_offers SET amountSgd = ?, status = 'open', counterAmountSgd = NULL,
         expiryDate = ? WHERE id = ?`
    ).run(newAmount, new Date(Date.now() + 14 * 24 * 3600_000).toISOString(), offerId);
    audit(acceptCounter ? "COUNTER_ACCEPTED" : "COUNTER_REVISED", designerId, offerId, newAmount);
    return db.prepare(`SELECT * FROM price_offers WHERE id = ?`).get(offerId) as PriceOffer;
  }

  static listForCustomer(custId: string): PriceRequest[] {
    return db
      .prepare(`SELECT * FROM price_requests WHERE customerId = ? ORDER BY createdDate DESC`)
      .all(custId) as PriceRequest[];
  }
  static listForDesigner(designerId: string): PriceRequest[] {
    return db
      .prepare(
        `SELECT r.*, u.name AS customerName FROM price_requests r
         LEFT JOIN users u ON u.id = r.customerId
         WHERE r.designerId = ? ORDER BY r.createdDate DESC`
      )
      .all(designerId) as PriceRequest[];
  }
  static offersForCustomer(custId: string): PriceOffer[] {
    return db
      .prepare(`SELECT * FROM price_offers WHERE customerId = ? ORDER BY expiryDate DESC`)
      .all(custId) as PriceOffer[];
  }
  static offersForDesigner(designerId: string): PriceOffer[] {
    return db
      .prepare(`SELECT * FROM price_offers WHERE designerId = ? ORDER BY expiryDate DESC`)
      .all(designerId) as PriceOffer[];
  }
}
