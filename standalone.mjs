// ===========================================================================
// IDMatch — STANDALONE / EASY-MODE server.
//
// Runs the ENTIRE platform (all 8 features ID01-ID08) with:
//   - NO build step
//   - NO `npm install`
//   - NO native packages (no better-sqlite3)
//   - ONLY Node.js built-in modules
//
// Data is kept in memory and re-seeded each start. It serves the pre-built
// React frontend from ./dist/client and exposes the same /api endpoints as the
// full TypeScript version.
//
//   Run:  node standalone.mjs      then open  http://localhost:4000
// ===========================================================================
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;
const CLIENT_DIR = join(__dirname, "dist", "client");

const GST_RATE = 0.09; // Singapore GST (9%)
const COMMISSION_RATE = 0.05; // 5% platform commission

// Post-booking project lifecycle (due-diligence stages before handover).
const PROJECT_STAGES = [
  "Deposit Secured",
  "Site Survey & Measurement",
  "Design Finalisation & Sign-off",
  "HDB/BCA Permit Approved",
  "Materials Procurement",
  "Hacking & Masonry",
  "Carpentry & Installation",
  "Final Inspection & Defects Check",
  "Handover (Keys Returned)",
];

// Real interior-design photos (free Unsplash CDN) linked to listings so the
// standalone demo looks like a genuine ID marketplace.
const PHOTO_URLS = [
  "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0",
  "https://images.unsplash.com/photo-1586023492125-27b2c045efd7",
  "https://images.unsplash.com/photo-1600210492493-0946911123ea",
  "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6",
  "https://images.unsplash.com/photo-1600489000022-c2086d79f9d4",
  "https://images.unsplash.com/photo-1556911220-bff31c812dba",
  "https://images.unsplash.com/photo-1616594039964-ae9021a400a0",
  "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af",
  "https://images.unsplash.com/photo-1617806118233-18e1de247200",
  "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3",
  "https://images.unsplash.com/photo-1600585154340-be6161a56a0c",
  "https://images.unsplash.com/photo-1567767292278-a4f21aa2d36e",
].map((u) => u + "?w=900&q=80&auto=format&fit=crop");
// Deterministic gallery for a listing: hero shot first, then a spread of rooms.
function galleryFor(seedIdx, n) {
  const out = [PHOTO_URLS[seedIdx % PHOTO_URLS.length]];
  for (let i = 1; i < n; i++) out.push(PHOTO_URLS[(seedIdx * 3 + i) % PHOTO_URLS.length]);
  return out;
}

// ---------------------------------------------------------------------------
// In-memory data store (reset on each start).
// ---------------------------------------------------------------------------
const DB = {
  users: [],
  companies: [],
  categories: [],
  idps: [],
  photos: [],
  reviews: [],
  inquiries: [],
  notifications: [],
  channelPrefs: [],
  priceRequests: [],
  priceOffers: [],
  contracts: [],
  payments: [],
  bookings: [],
  audit: [],
  inquiryRate: [],
  viewDedupe: [],
  favourites: [],
};

const uid = (p) => `${p}_${randomUUID().slice(0, 8)}`;
const now = () => new Date().toISOString();
const round2 = (n) => Math.round(n * 100) / 100;

function audit(action, actorId = null, entityId = null, amountSgd = 0) {
  DB.audit.push({ id: uid("log"), action, actorId, entityId, amountSgd, timestamp: now() });
}

// PDPA — mask contact details in free text.
function maskContactDetails(text) {
  return text
    .replace(/(\+?65[\s-]?)?\d{4}[\s-]?\d{4}/g, "[contact removed]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]")
    .replace(/[STFG]\d{7}[A-Z]/gi, "[NRIC removed]");
}
const BLOCKED = ["scam", "spam", "http://", "https://"];
const screenContent = (t) => !BLOCKED.some((w) => t.toLowerCase().includes(w));

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// External SG service stubs (the «boundary» classes). `sim` flags drive the
// alternate flows used in the ID05 demo.
// ---------------------------------------------------------------------------
const ext = {
  async singpass(sim) {
    if (sim?.singpassFail) return { verified: false, maskedNric: "" };
    return { verified: true, maskedNric: "S****" + (100 + Math.floor(Math.random() * 900)) + "A" };
  },
  async esign(sim) {
    return { bothSigned: !sim?.unsigned, envelopeId: "ENV-" + Math.floor(10000 + Math.random() * 89999) };
  },
  async pay(sim) {
    if (sim?.paymentDecline) return { approved: false, ref: "" };
    return { approved: true, ref: "PAY-" + Math.floor(100000 + Math.random() * 899999) };
  },
  computeGst: (amt) => round2(amt * GST_RATE),
  async hdbPermit(sim) {
    return sim?.hdbPermitFail ? "NOT_APPROVED" : "APPROVED";
  },
  async insure() {
    return { insured: true, policyNo: "POL-" + Math.floor(10000 + Math.random() * 89999) };
  },
  async message(channel, failPrimary) {
    if (failPrimary && channel !== "email") return false;
    return true;
  },
};

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
function seed() {
  DB.users.push(
    { id: "u_cust", role: "customer", name: "Mei Ling Tan", email: "meiling@example.sg", nric: "S****123A" },
    { id: "u_desn", role: "designer", name: "Studio Lumen", email: "hello@studiolumen.sg", uen: "201512345K", caseTrust: true },
    { id: "u_mgr", role: "manager", name: "Platform Admin", email: "admin@idmatch.sg" }
  );
  DB.companies.push({ designerId: "u_desn", name: "Studio Lumen", uen: "201512345K", caseTrust: true, logoUrl: "🏢", acceptingRequests: true });

  const catNames = ["HDB 2-Room Flexi", "HDB 3-Room", "HDB 4-Room", "HDB 5-Room", "HDB Executive / Maisonette", "Condominium", "Executive Condominium (EC)", "Landed — Terrace", "Landed — Semi-Detached", "Landed — Bungalow / GCB", "Cluster House", "Walk-up Apartment", "Commercial / Office"];
  const catIds = catNames.map((name) => {
    const id = uid("cat");
    DB.categories.push({ id, name });
    return id;
  });

  function mkIdp(title, description, propertyType, budgetRangeSgd, catIdx, status, viewCount, shortlistCount) {
    const id = uid("idp");
    DB.idps.push({ id, designerId: "u_desn", title, description, propertyType, budgetRangeSgd, categoryId: catIds[catIdx], status, viewCount, shortlistCount, services: "Full home renovation · Carpentry · Flooring · Painting · HDB/BCA permit handling", createdDate: now() });
    return id;
  }
  const idp1 = mkIdp("Warm Japandi 4-Room BTO", "A calm Japandi renovation for a 4-room BTO in Punggol — oak veneer, muted clay tones, full carpentry and a bay-window reading nook. Completed in 9 weeks.", "HDB 4-Room BTO", "S$45,000 - S$60,000", 2, "published", 128, 21);
  const idp2 = mkIdp("Industrial Loft Condo", "Open-concept industrial loft for a condominium at the city fringe — exposed ceiling, microcement feature wall, and a kitchen island in black ash.", "Condominium", "S$70,000 - S$95,000", 3, "published", 86, 12);
  const draft = mkIdp("Minimalist Resale 5-Room (draft)", "Work-in-progress listing for a resale 5-room flat in Bishan with a light oak palette and hidden storage throughout the home.", "HDB 5-Room Resale", "S$55,000 - S$75,000", 0, "draft", 0, 0);

  const addPhoto = (idpId, url, order) => DB.photos.push({ id: uid("pho"), idpId, url, order, format: "jpg", consentConfirmed: true });
  galleryFor(0, 3).forEach((u, i) => addPhoto(idp1, u, i));
  galleryFor(1, 3).forEach((u, i) => addPhoto(idp2, u, i));
  addPhoto(draft, galleryFor(2, 1)[0], 0);

  DB.reviews.push(
    { id: uid("rev"), idpId: idp1, rating: 5, comment: "Studio Lumen nailed the brief — on time and on budget.", verified: true },
    { id: uid("rev"), idpId: idp1, rating: 4, comment: "Beautiful carpentry. Communication could be slightly faster.", verified: true },
    { id: uid("rev"), idpId: idp2, rating: 5, comment: "The microcement wall is stunning in person.", verified: true }
  );

  DB.channelPrefs.push({ customerId: "u_cust", primaryChannel: "push", fallbackChannel: "email", pdpaConsent: true, dndWindow: null });

  // historical activity for ID03
  const base = Date.now();
  const back = (action, actorId, entityId, amountSgd, daysAgo) =>
    DB.audit.push({ id: uid("log"), action, actorId, entityId, amountSgd, timestamp: new Date(base - daysAgo * 86400000 - Math.floor(Math.random() * 86400000)).toISOString() });
  for (let i = 0; i < 4; i++) back("USER_SIGNED_UP", null, null, 0, 1 + i);
  back("IDP_PUBLISHED", null, idp1, 0, 5);
  back("IDP_PUBLISHED", null, idp2, 0, 6);
  for (let i = 0; i < 30; i++) back("IDP_VIEWED", "u_cust", idp1, 0, (i % 6) + 1);
  for (let i = 0; i < 9; i++) back("IDP_SHORTLISTED", "u_cust", idp1, 0, (i % 6) + 1);
  for (let i = 0; i < 5; i++) back("INQUIRY_SUBMITTED", "u_cust", null, 0, (i % 6) + 1);
  back("OFFER_ACCEPTED", "u_cust", "off_seed", 52000, 3);
}

// ---------------------------------------------------------------------------
// Controllers (same logic as the TypeScript version)
// ---------------------------------------------------------------------------
const find = (arr, pred) => arr.find(pred);
const filt = (arr, pred) => arr.filter(pred);

const Inquiry = {
  checkSpamLimit(custId) {
    const cutoff = Date.now() - 3600000;
    return DB.inquiryRate.filter((r) => r.customerId === custId && Date.parse(r.ts) > cutoff).length < 5;
  },
  submit(custId, idpId, txt) {
    const idp = find(DB.idps, (i) => i.id === idpId);
    if (!idp || idp.status !== "published") throw new HttpError(404, "IDP_UNAVAILABLE", "This portfolio is no longer available.");
    if (!this.checkSpamLimit(custId)) throw new HttpError(429, "SPAM_LIMIT", "You have sent too many inquiries. Please try again later.");
    if (!txt || !txt.trim() || txt.trim().length > 2000) throw new HttpError(400, "EMPTY_MESSAGE", "Please enter a message (up to 2000 characters).");
    if (!screenContent(txt)) throw new HttpError(422, "FLAGGED_CONTENT", "Your message was flagged by our content filter.");
    const masked = maskContactDetails(txt);
    const inquiry = { id: uid("inq"), idpId, customerId: custId, designerId: idp.designerId, message: masked, status: "new", thread: [{ from: "customer", text: masked, at: now() }], createdDate: now() };
    DB.inquiries.push(inquiry);
    DB.inquiryRate.push({ customerId: custId, ts: now() });
    audit("INQUIRY_SUBMITTED", custId, inquiry.id);
    audit("DESIGNER_NOTIFIED", null, inquiry.designerId);
    return this.withTitle(inquiry);
  },
  // Append a message from either side — unlimited back-and-forth.
  async postMessage(inquiryId, fromRole, text) {
    const inq = find(DB.inquiries, (i) => i.id === inquiryId);
    if (!inq) throw new HttpError(404, "NOT_FOUND", "Inquiry not found.");
    if (!text || !text.trim()) throw new HttpError(400, "EMPTY_MESSAGE", "Message cannot be empty.");
    if (!Array.isArray(inq.thread)) inq.thread = [{ from: "customer", text: inq.message, at: inq.createdDate }];
    inq.thread.push({ from: fromRole, text: maskContactDetails(text), at: now() });
    inq.status = fromRole === "designer" ? "replied" : "new";
    if (fromRole === "designer") {
      audit("INQUIRY_REPLIED", inq.designerId, inquiryId);
      await Notification.onReplyPosted(inquiryId);
    } else {
      audit("INQUIRY_FOLLOW_UP", null, inquiryId);
      audit("DESIGNER_NOTIFIED", null, inq.designerId);
    }
    return this.withTitle(inq);
  },
  async reply(inquiryId, replyText) {
    const inq = find(DB.inquiries, (i) => i.id === inquiryId);
    if (!inq) throw new HttpError(404, "NOT_FOUND", "Inquiry not found.");
    if (!replyText || !replyText.trim()) throw new HttpError(400, "EMPTY_REPLY", "Reply cannot be empty.");
    return this.postMessage(inquiryId, "designer", replyText);
  },
  followUp(inquiryId, custId, text) {
    const inq = find(DB.inquiries, (i) => i.id === inquiryId);
    if (!inq) throw new HttpError(404, "NOT_FOUND", "Inquiry not found.");
    if (inq.customerId !== custId) throw new HttpError(403, "FORBIDDEN", "This inquiry is not yours.");
    return this.postMessage(inquiryId, "customer", text);
  },
  withTitle(inq) {
    const idp = find(DB.idps, (i) => i.id === inq.idpId);
    const cu = find(DB.users, (u) => u.id === inq.customerId);
    const du = find(DB.users, (u) => u.id === inq.designerId);
    const req = filt(DB.priceRequests, (r) => r.customerId === inq.customerId && r.designerId === inq.designerId).slice(-1)[0];
    const thread = Array.isArray(inq.thread) ? inq.thread : [{ from: "customer", text: inq.message, at: inq.createdDate }];
    return { ...inq, thread, idpTitle: idp ? idp.title : null, customerName: cu ? cu.name : null, designerName: du ? du.name : null, relatedRequestId: req ? req.id : null };
  },
  listWithTitles(pred) {
    return filt(DB.inquiries, pred).sort((a, b) => (a.createdDate < b.createdDate ? 1 : -1)).map((i) => this.withTitle(i));
  },
  getOrCreateThread(designerId, custId, idpId) {
    const existing = filt(DB.inquiries, (i) => i.designerId === designerId && i.customerId === custId && i.idpId === idpId);
    if (existing.length) return this.withTitle(existing[existing.length - 1]);
    const at = now();
    const opener = "Conversation opened from a price request.";
    const inq = { id: uid("inq"), idpId, customerId: custId, designerId, message: opener, status: "replied", thread: [{ from: "designer", text: opener, at }], createdDate: at };
    DB.inquiries.push(inq);
    audit("INQUIRY_OPENED_BY_DESIGNER", designerId, inq.id);
    return this.withTitle(inq);
  },
};

const Notification = {
  prefs(custId) {
    let p = find(DB.channelPrefs, (c) => c.customerId === custId);
    if (!p) {
      p = { customerId: custId, primaryChannel: "push", fallbackChannel: "email", pdpaConsent: true, dndWindow: null };
      DB.channelPrefs.push(p);
    }
    return p;
  },
  inDnd(custId) {
    const p = this.prefs(custId);
    if (!p.dndWindow) return false;
    const [s, e] = p.dndWindow.split("-").map(Number);
    const h = new Date().getHours();
    return s <= e ? h >= s && h < e : h >= s || h < e;
  },
  async onReplyPosted(inquiryId) {
    const inq = find(DB.inquiries, (i) => i.id === inquiryId);
    const p = this.prefs(inq.customerId);
    if (!p.pdpaConsent) return this.record(inq.customerId, "in_app", "A designer replied to your inquiry.", "delivered");
    if (this.inDnd(inq.customerId)) return this.record(inq.customerId, "in_app", "A designer replied (delivered quietly during DND).", "delivered");
    const content = "A designer has replied to your inquiry. Open the app to view the reply.";
    if (await ext.message(p.primaryChannel)) return this.record(inq.customerId, p.primaryChannel, content, "delivered");
    const ok = await ext.message(p.fallbackChannel);
    return this.record(inq.customerId, p.fallbackChannel, content, ok ? "delivered" : "failed");
  },
  record(custId, channel, content, status) {
    const n = { id: uid("ntf"), customerId: custId, channel, content, status, createdDate: now() };
    DB.notifications.push(n);
    audit("NOTIFICATION_" + status.toUpperCase(), custId, n.id);
    return n;
  },
};

const PriceReq = {
  create(custId, idpId, data) {
    const idp = find(DB.idps, (i) => i.id === idpId);
    if (!idp) throw new HttpError(404, "IDP_UNAVAILABLE", "Portfolio not found.");
    const valid = data.scope?.trim() && data.propertyType?.trim() && data.budgetRangeSgd?.trim() && Number(data.unitSizeSqft) > 0;
    if (!valid) throw new HttpError(400, "MISSING_FIELDS", "Please complete all fields (scope, property type, size, budget).");
    const company = find(DB.companies, (c) => c.designerId === idp.designerId);
    if (!company?.acceptingRequests) throw new HttpError(409, "NOT_ACCEPTING", "This designer is not accepting new requests right now.");
    const req = { id: uid("req"), idpId, customerId: custId, designerId: idp.designerId, scope: data.scope.trim(), propertyType: data.propertyType.trim(), unitSizeSqft: Number(data.unitSizeSqft), budgetRangeSgd: data.budgetRangeSgd.trim(), status: "pending", slaDeadline: new Date(Date.now() + 48 * 3600000).toISOString(), createdDate: now() };
    DB.priceRequests.push(req);
    audit("PRICE_REQUEST_CREATED", custId, req.id);
    return req;
  },
  offer(designerId, requestId, amountSgd) {
    const req = find(DB.priceRequests, (r) => r.id === requestId);
    if (!req) throw new HttpError(404, "NOT_FOUND", "Price request not found.");
    if (req.designerId !== designerId) throw new HttpError(403, "FORBIDDEN", "Not your request.");
    if (!(amountSgd > 0)) throw new HttpError(400, "BAD_AMOUNT", "Amount must be greater than zero.");
    const offer = { id: uid("off"), priceRequestId: req.id, idpId: req.idpId, customerId: req.customerId, designerId, amountSgd, status: "open", counterAmountSgd: null, expiryDate: new Date(Date.now() + 14 * 86400000).toISOString() };
    DB.priceOffers.push(offer);
    req.status = "quoted";
    audit("PRICE_OFFER_CREATED", designerId, offer.id, amountSgd);
    return offer;
  },
  counterOffer(custId, offerId, counterAmountSgd) {
    const offer = find(DB.priceOffers, (o) => o.id === offerId);
    if (!offer) throw new HttpError(404, "NOT_FOUND", "Offer not found.");
    if (offer.customerId !== custId) throw new HttpError(403, "FORBIDDEN", "This offer is not addressed to you.");
    if (offer.status !== "open") throw new HttpError(409, "NOT_OPEN", "Only an open offer can be countered.");
    if (!(counterAmountSgd > 0)) throw new HttpError(400, "BAD_AMOUNT", "Counter amount must be greater than zero.");
    offer.status = "countered";
    offer.counterAmountSgd = counterAmountSgd;
    audit("PRICE_OFFER_COUNTERED", custId, offerId, counterAmountSgd);
    return offer;
  },
  respondToCounter(designerId, offerId, acceptCounter, revisedAmountSgd) {
    const offer = find(DB.priceOffers, (o) => o.id === offerId);
    if (!offer) throw new HttpError(404, "NOT_FOUND", "Offer not found.");
    if (offer.designerId !== designerId) throw new HttpError(403, "FORBIDDEN", "Not your offer.");
    if (offer.status !== "countered") throw new HttpError(409, "NOT_COUNTERED", "This offer has no pending counter.");
    const newAmount = acceptCounter ? offer.counterAmountSgd : revisedAmountSgd;
    if (!(newAmount && newAmount > 0)) throw new HttpError(400, "BAD_AMOUNT", "A valid revised amount is required.");
    offer.amountSgd = newAmount;
    offer.status = "open";
    offer.counterAmountSgd = null;
    offer.expiryDate = new Date(Date.now() + 14 * 86400000).toISOString();
    audit(acceptCounter ? "COUNTER_ACCEPTED" : "COUNTER_REVISED", designerId, offerId, newAmount);
    return offer;
  },
};

const Accept = {
  valid(o) {
    return o && o.status === "open" && new Date(o.expiryDate).getTime() > Date.now();
  },
  async acceptOffer(custId, offerId, method, sim = {}, documents = []) {
    const steps = [];
    const offer = find(DB.priceOffers, (o) => o.id === offerId);
    if (!this.valid(offer)) throw new HttpError(410, "OFFER_INVALID", "This offer is no longer valid or has expired.");
    if (offer.customerId !== custId) throw new HttpError(403, "FORBIDDEN", "This offer is not addressed to you.");
    steps.push("Offer validated (open & within expiry).");

    const idv = await ext.singpass(sim);
    if (!idv.verified) throw new HttpError(401, "SINGPASS_FAILED", "Singpass identity verification failed. Please try again.");
    steps.push(`Identity verified via Singpass/MyInfo (NRIC ${idv.maskedNric}).`);

    offer.status = "accepted";

    const contract = { id: uid("con"), offerId, terms: `Renovation agreement for project ${offer.idpId}. Agreed value: S$${offer.amountSgd.toFixed(2)}. Governed by Singapore law; executed electronically under the Electronic Transactions Act.`, signedByCustomer: false, signedByDesigner: false };
    const sig = await ext.esign(sim);
    if (!sig.bothSigned) {
      offer.status = "open";
      throw new HttpError(409, "CONTRACT_UNSIGNED", "The contract was not signed by both parties.");
    }
    contract.signedByCustomer = true;
    contract.signedByDesigner = true;
    DB.contracts.push(contract);
    steps.push(`Contract ${contract.id} e-signed by both parties (envelope ${sig.envelopeId}).`);

    const commissionSgd = round2(offer.amountSgd * COMMISSION_RATE);
    const gstSgd = ext.computeGst(commissionSgd);
    steps.push(`Commission S$${commissionSgd.toFixed(2)} + 9% GST S$${gstSgd.toFixed(2)} computed.`);

    const totalSgd = round2(commissionSgd + gstSgd);
    const charge = await ext.pay(sim);
    if (!charge.approved) {
      offer.status = "open";
      throw new HttpError(402, "PAYMENT_DECLINED", `Payment via ${method} was declined.`);
    }
    const invoiceNo = "INV-" + new Date().getFullYear() + "-" + uid("x").slice(-6).toUpperCase();
    const payment = { id: uid("pay"), offerId, amountSgd: commissionSgd, commissionSgd, gstSgd, totalSgd, method, status: "approved", invoiceNo };
    DB.payments.push(payment);
    steps.push(`Payment ${charge.ref} approved via ${method} — total S$${totalSgd.toFixed(2)}.`);

    steps.push(`GST reported to IRAS; tax invoice ${invoiceNo} issued.`);

    const permit = await ext.hdbPermit(sim);
    if (permit !== "APPROVED") throw new HttpError(409, "PERMIT_NOT_APPROVED", "HDB/BCA renovation permit is not approved yet.");
    steps.push("HDB/BCA renovation permit verified as APPROVED.");

    const booking = { id: uid("bkg"), offerId, customerId: custId, designerId: offer.designerId, status: "pending_review", insured: false, permitVerified: true, documents, stage: null, stageHistory: null, createdDate: now() };
    const ins = await ext.insure();
    booking.insured = ins.insured;
    DB.bookings.push(booking);
    steps.push(`Renovation insurance registered (policy ${ins.policyNo}).`);

    audit("OFFER_ACCEPTED", custId, offerId, offer.amountSgd);
    audit("BOOKING_CONFIRMED", custId, booking.id);
    steps.push(`Booking ${booking.id} created with ${(documents || []).length} document(s) — awaiting designer review.`);
    return { booking, contract, payment, steps };
  },
  confirmStage(bookingId, role) {
    const b = find(DB.bookings, (x) => x.id === bookingId);
    if (!b) throw new HttpError(404, "NOT_FOUND", "Booking not found.");
    if (b.status === "pending_review") throw new HttpError(409, "NOT_CONFIRMED", "The booking documents are still awaiting approval.");
    const current = b.stage ?? PROJECT_STAGES[0];
    const idx = PROJECT_STAGES.indexOf(current);
    if (idx >= PROJECT_STAGES.length - 1) throw new HttpError(409, "ALREADY_COMPLETE", "This project has already reached handover.");
    if (!b.pendingConfirm) b.pendingConfirm = { customer: false, designer: false };
    b.pendingConfirm[role] = true;
    if (b.pendingConfirm.customer && b.pendingConfirm.designer) {
      const next = PROJECT_STAGES[idx + 1];
      if (!Array.isArray(b.stageHistory)) b.stageHistory = [{ stage: current, at: now() }];
      b.stageHistory.push({ stage: next, at: now(), note: "Confirmed by both customer and designer." });
      b.stage = next;
      b.status = next === PROJECT_STAGES[PROJECT_STAGES.length - 1] ? "completed" : "confirmed";
      b.pendingConfirm = null;
      audit("BOOKING_STAGE_ADVANCED", null, bookingId);
    } else {
      audit("BOOKING_STAGE_CONFIRMED_" + role.toUpperCase(), null, bookingId);
    }
    return b;
  },
  enrichBooking(b) {
    const cu = find(DB.users, (u) => u.id === b.customerId);
    const du = find(DB.users, (u) => u.id === b.designerId);
    const off = find(DB.priceOffers, (o) => o.id === b.offerId);
    const idp = off ? find(DB.idps, (i) => i.id === off.idpId) : null;
    const inq = filt(DB.inquiries, (i) => i.customerId === b.customerId && i.designerId === b.designerId).slice(-1)[0];
    return { ...b, customerName: cu ? cu.name : null, designerName: du ? du.name : null, idpTitle: idp ? idp.title : null, amountSgd: off ? off.amountSgd : null, relatedInquiryId: inq ? inq.id : null };
  },
  pendingReviewForDesigner(designerId) {
    return filt(DB.bookings, (b) => b.designerId === designerId && b.status === "pending_review").map((b) => this.enrichBooking(b));
  },
  approveBooking(designerId, bookingId) {
    const b = find(DB.bookings, (x) => x.id === bookingId);
    if (!b) throw new HttpError(404, "NOT_FOUND", "Booking not found.");
    if (b.designerId !== designerId) throw new HttpError(403, "FORBIDDEN", "Not your booking.");
    if (b.status !== "pending_review") throw new HttpError(409, "NOT_PENDING", "This booking is not awaiting review.");
    b.status = "confirmed";
    b.stage = PROJECT_STAGES[0];
    b.stageHistory = [{ stage: PROJECT_STAGES[0], at: now(), note: "Documents approved; project opened." }];
    audit("BOOKING_DOCS_APPROVED", designerId, bookingId);
    return b;
  },
};

const Idp = {
  verifyUen(designerId) {
    const c = find(DB.companies, (x) => x.designerId === designerId);
    return !!(c && /^[0-9]{8,9}[A-Z]$/.test(c.uen) && c.caseTrust);
  },
  create(designerId, data) {
    const valid = data.title?.trim() && data.description?.trim() && data.propertyType?.trim() && data.budgetRangeSgd?.trim();
    if (!valid) throw new HttpError(400, "INVALID_INPUT", "Title, description, property type and budget are required.");
    if (!this.verifyUen(designerId)) throw new HttpError(403, "UEN_UNVERIFIED", "Your UEN / CaseTrust accreditation could not be verified.");
    const idp = { id: uid("idp"), designerId, title: data.title.trim(), description: data.description.trim(), propertyType: data.propertyType.trim(), budgetRangeSgd: data.budgetRangeSgd.trim(), categoryId: data.categoryId ?? null, status: "draft", viewCount: 0, shortlistCount: 0, services: data.services?.trim() || null, createdDate: now() };
    DB.idps.push(idp);
    audit("IDP_CREATED", designerId, idp.id);
    return idp;
  },
  updateIDP(idpId, data) {
    const idp = find(DB.idps, (i) => i.id === idpId);
    if (!idp) throw new HttpError(404, "NOT_FOUND", "Portfolio not found.");
    if (idp.status === "published") throw new HttpError(409, "ALREADY_PUBLISHED", "A published portfolio cannot be edited; unpublish it first.");
    if (data.title?.trim()) idp.title = data.title.trim();
    if (data.description?.trim()) idp.description = data.description.trim();
    if (data.propertyType?.trim()) idp.propertyType = data.propertyType.trim();
    if (data.budgetRangeSgd?.trim()) idp.budgetRangeSgd = data.budgetRangeSgd.trim();
    if (data.categoryId !== undefined) idp.categoryId = data.categoryId;
    if (data.services !== undefined) idp.services = data.services?.trim() || null;
    audit("IDP_UPDATED", idp.designerId, idpId);
    return idp;
  },
  addPhoto(idpId, url, format, consent) {
    if (url?.toLowerCase().includes("eicar")) throw new HttpError(422, "VIRUS_DETECTED", "The uploaded file failed the virus scan.");
    if (!consent) throw new HttpError(422, "NO_CONSENT", "Photo consent must be confirmed (PDPA).");
    if (!/^(jpg|jpeg|png|webp)$/i.test(format)) throw new HttpError(400, "BAD_FORMAT", "Only JPG, PNG or WEBP allowed.");
    const order = filt(DB.photos, (p) => p.idpId === idpId).length;
    const photo = { id: uid("pho"), idpId, url, order, format, consentConfirmed: true };
    DB.photos.push(photo);
    return photo;
  },
  assignCategory(idpId, categoryId) {
    const idp = find(DB.idps, (i) => i.id === idpId);
    if (idp) idp.categoryId = categoryId;
  },
  checkCompleteness(idpId) {
    const idp = find(DB.idps, (i) => i.id === idpId);
    if (!idp) throw new HttpError(404, "NOT_FOUND", "Draft not found.");
    const photos = filt(DB.photos, (p) => p.idpId === idpId);
    const issues = [];
    if (!idp.title?.trim()) issues.push("Title is missing.");
    if (!idp.description || idp.description.trim().length < 30) issues.push("Description must be at least 30 characters.");
    if (!idp.categoryId) issues.push("A category must be assigned.");
    if (photos.length < 1) issues.push("At least one photo is required.");
    const verified = this.verifyUen(idp.designerId);
    if (!verified) issues.push("Company UEN / CaseTrust is not verified.");
    const pdpaOk = photos.every((p) => p.consentConfirmed);
    if (!pdpaOk) issues.push("Every photo must have confirmed PDPA consent.");
    const complete = issues.length === 0;
    return { complete, pdpaOk, verified, issues, canPublish: complete };
  },
  publish(idpId) {
    const check = this.checkCompleteness(idpId);
    if (!check.canPublish) throw new HttpError(422, "NOT_PUBLISHABLE", "Resolve all issues before publishing: " + check.issues.join(" "));
    const idp = find(DB.idps, (i) => i.id === idpId);
    idp.status = "published";
    audit("IDP_PUBLISHED", null, idpId);
    return idp;
  },
  submitForModeration(idpId) {
    const idp = find(DB.idps, (i) => i.id === idpId);
    if (idp) idp.status = "in_moderation";
    audit("IDP_SUBMITTED_FOR_MODERATION", null, idpId);
  },
  dedupeView(custId, idpId) {
    const cutoff = Date.now() - 30 * 60000;
    const recent = DB.viewDedupe.some((v) => v.customerId === custId && v.idpId === idpId && Date.parse(v.ts) > cutoff);
    if (recent) return false;
    DB.viewDedupe.push({ customerId: custId, idpId, ts: now() });
    return true;
  },
  viewDetails(idpId, custId) {
    const idp = find(DB.idps, (i) => i.id === idpId);
    if (!idp) throw new HttpError(404, "NOT_FOUND", "Portfolio not found.");
    if (idp.status !== "published") throw new HttpError(404, "IDP_UNAVAILABLE", "This portfolio is not available.");
    const photos = filt(DB.photos, (p) => p.idpId === idpId).sort((a, b) => a.order - b.order);
    const reviews = filt(DB.reviews, (r) => r.idpId === idpId && r.verified);
    const company = find(DB.companies, (c) => c.designerId === idp.designerId);
    if (custId && this.dedupeView(custId, idpId)) {
      idp.viewCount += 1;
      audit("IDP_VIEWED", custId, idpId);
    }
    const shortlisted = custId ? DB.favourites.some((f) => f.customerId === custId && f.idpId === idpId) : false;
    return { idp, photos, reviews, company, shortlisted };
  },
  shortlist(custId, idpId) {
    const idp = find(DB.idps, (i) => i.id === idpId);
    if (!idp) throw new HttpError(404, "NOT_FOUND", "Portfolio not found.");
    const i = DB.favourites.findIndex((f) => f.customerId === custId && f.idpId === idpId);
    if (i >= 0) {
      DB.favourites.splice(i, 1);
      idp.shortlistCount = Math.max(0, idp.shortlistCount - 1);
      return { ...idp, shortlisted: false };
    }
    DB.favourites.push({ customerId: custId, idpId });
    idp.shortlistCount += 1;
    audit("IDP_SHORTLISTED", custId, idpId);
    return { ...idp, shortlisted: true };
  },
  listPublished(q) {
    let list = filt(DB.idps, (i) => i.status === "published");
    if (q && q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((i) => (i.title + i.description + i.propertyType).toLowerCase().includes(s));
    }
    // attach a coverUrl (first photo) so the browse grid shows a real thumbnail
    return list.map((i) => {
      const photos = filt(DB.photos, (p) => p.idpId === i.id).sort((a, b) => a.order - b.order);
      return { ...i, coverUrl: photos.length ? photos[0].url : null };
    });
  },
};

const Report = {
  generate(weekStart, weekEnd) {
    const s = Date.parse(weekStart);
    const e = Date.parse(weekEnd);
    if (!(Number.isFinite(s) && Number.isFinite(e) && s < e)) throw new HttpError(400, "INVALID_RANGE", "Please choose a valid week (start before end).");
    const inRange = (ts) => Date.parse(ts) >= s && Date.parse(ts) < e;
    const count = (action) => DB.audit.filter((a) => a.action === action && inRange(a.timestamp)).length;
    const sum = (action) => DB.audit.filter((a) => a.action === action && inRange(a.timestamp)).reduce((t, a) => t + a.amountSgd, 0);
    const signUps = count("USER_SIGNED_UP");
    const idpCount = count("IDP_PUBLISHED");
    const views = count("IDP_VIEWED");
    const shortlists = count("IDP_SHORTLISTED");
    const inquiries = count("INQUIRY_SUBMITTED");
    const grossValueSgd = round2(sum("OFFER_ACCEPTED"));
    const commissionSgd = round2(grossValueSgd * COMMISSION_RATE);
    const gstCollectedSgd = round2(ext.computeGst(commissionSgd));
    const hasActivity = signUps + idpCount + views + shortlists + inquiries > 0 || grossValueSgd > 0;
    return { id: uid("rpt"), weekStart, weekEnd, signUps, idpCount, views, shortlists, inquiries, grossValueSgd, commissionSgd, gstCollectedSgd, status: hasActivity ? "final" : "draft" };
  },
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function parseUrl(url) {
  const u = new URL(url, "http://x");
  return { path: u.pathname, query: Object.fromEntries(u.searchParams) };
}

async function handleApi(method, path, query, body) {
  // listings / ID08
  if (method === "GET" && path === "/api/users") {
    // Only the three stable demo accounts appear in the role-switcher.
    const order = { customer: 0, designer: 1, manager: 2 };
    return DB.users.filter((u) => ["u_cust", "u_desn", "u_mgr"].includes(u.id)).sort((a, b) => order[a.role] - order[b.role]);
  }
  if (method === "GET" && path === "/api/idps") return Idp.listPublished(query.q);
  if (method === "GET" && path === "/api/categories") return DB.categories;
  let m;
  if (method === "GET" && (m = path.match(/^\/api\/idps\/([^/]+)$/))) return Idp.viewDetails(m[1], query.custId || null);
  if (method === "POST" && (m = path.match(/^\/api\/idps\/([^/]+)\/shortlist$/))) return Idp.shortlist(body.custId, m[1]);
  if (method === "GET" && (m = path.match(/^\/api\/idps\/([^/]+)\/preview$/))) {
    const idp = find(DB.idps, (i) => i.id === m[1]);
    if (!idp) throw new HttpError(404, "NOT_FOUND", "Portfolio not found.");
    const photos = filt(DB.photos, (p) => p.idpId === m[1]).sort((a, b) => a.order - b.order);
    const company = find(DB.companies, (c) => c.designerId === idp.designerId);
    const check = Idp.checkCompleteness(m[1]);
    return { idp, photos, company, check };
  }
  if (method === "POST" && (m = path.match(/^\/api\/idps\/([^/]+)\/publish$/))) return Idp.publish(m[1]);
  if (method === "POST" && (m = path.match(/^\/api\/idps\/([^/]+)\/photos$/))) return Idp.addPhoto(m[1], body.url, body.format, body.consentConfirmed);
  if (method === "POST" && (m = path.match(/^\/api\/idps\/([^/]+)\/category$/))) { Idp.assignCategory(m[1], body.categoryId); return { ok: true }; }
  if (method === "POST" && (m = path.match(/^\/api\/idps\/([^/]+)\/submit$/))) { Idp.submitForModeration(m[1]); return { ok: true }; }
  if (method === "POST" && path === "/api/idps") return Idp.create(body.designerId, body);
  if (method === "PUT" && (m = path.match(/^\/api\/idps\/([^/]+)$/))) return Idp.updateIDP(m[1], body);
  if (method === "GET" && (m = path.match(/^\/api\/designer\/([^/]+)\/idps$/))) return filt(DB.idps, (i) => i.designerId === m[1]);

  // ID01
  if (method === "POST" && path === "/api/inquiries") return Inquiry.submit(body.custId, body.idpId, body.message);
  if (method === "GET" && path === "/api/inquiries") {
    return query.role === "designer"
      ? Inquiry.listWithTitles((i) => i.designerId === query.userId)
      : Inquiry.listWithTitles((i) => i.customerId === query.userId);
  }
  if (method === "POST" && (m = path.match(/^\/api\/inquiries\/([^/]+)\/reply$/))) return await Inquiry.reply(m[1], body.reply);
  if (method === "POST" && (m = path.match(/^\/api\/inquiries\/([^/]+)\/follow-up$/))) return Inquiry.followUp(m[1], body.custId, body.message);
  if (method === "POST" && path === "/api/inquiries/open-thread") return Inquiry.getOrCreateThread(body.designerId, body.custId, body.idpId);

  // ID02
  if (method === "GET" && (m = path.match(/^\/api\/notifications\/([^/]+)$/))) return filt(DB.notifications, (n) => n.customerId === m[1]).reverse();
  if (method === "GET" && (m = path.match(/^\/api\/channel-prefs\/([^/]+)$/))) return Notification.prefs(m[1]);
  if (method === "PUT" && (m = path.match(/^\/api\/channel-prefs\/([^/]+)$/))) {
    const p = Notification.prefs(m[1]);
    Object.assign(p, { primaryChannel: body.primaryChannel, fallbackChannel: body.fallbackChannel, pdpaConsent: !!body.pdpaConsent, dndWindow: body.dndWindow || null });
    return p;
  }

  // ID04
  if (method === "POST" && path === "/api/price-requests") return PriceReq.create(body.custId, body.idpId, body);
  if (method === "GET" && path === "/api/price-requests") {
    if (query.role === "designer") {
      return filt(DB.priceRequests, (r) => r.designerId === query.userId).map((r) => {
        const u = find(DB.users, (x) => x.id === r.customerId);
        return { ...r, customerName: u ? u.name : null };
      });
    }
    return filt(DB.priceRequests, (r) => r.customerId === query.userId);
  }
  if (method === "POST" && (m = path.match(/^\/api\/price-requests\/([^/]+)\/offer$/))) return PriceReq.offer(body.designerId, m[1], Number(body.amountSgd));
  if (method === "POST" && (m = path.match(/^\/api\/offers\/([^/]+)\/counter$/))) return PriceReq.counterOffer(body.custId, m[1], Number(body.counterAmountSgd));
  if (method === "POST" && (m = path.match(/^\/api\/offers\/([^/]+)\/respond-counter$/))) return PriceReq.respondToCounter(body.designerId, m[1], !!body.acceptCounter, body.revisedAmountSgd != null ? Number(body.revisedAmountSgd) : undefined);
  if (method === "GET" && (m = path.match(/^\/api\/offers\/([^/]+)$/))) return filt(DB.priceOffers, (o) => o.customerId === m[1]);
  if (method === "GET" && (m = path.match(/^\/api\/designer-offers\/([^/]+)$/))) return filt(DB.priceOffers, (o) => o.designerId === m[1]);

  // ID05
  if (method === "POST" && (m = path.match(/^\/api\/offers\/([^/]+)\/accept$/))) return await Accept.acceptOffer(body.custId, m[1], body.method || "PayNow", body.simulate || {}, body.documents || []);
  if (method === "POST" && (m = path.match(/^\/api\/bookings\/([^/]+)\/confirm-stage$/))) return Accept.confirmStage(m[1], body.role);
  if (method === "POST" && (m = path.match(/^\/api\/bookings\/([^/]+)\/approve$/))) return Accept.approveBooking(body.designerId, m[1]);
  if (method === "GET" && (m = path.match(/^\/api\/designer-bookings\/([^/]+)\/pending$/))) return Accept.pendingReviewForDesigner(m[1]);
  if (method === "GET" && (m = path.match(/^\/api\/designer-bookings\/([^/]+)$/))) return filt(DB.bookings, (b) => b.designerId === m[1] && b.status !== "pending_review").map((b) => Accept.enrichBooking(b));
  if (method === "GET" && (m = path.match(/^\/api\/bookings\/([^/]+)$/))) return filt(DB.bookings, (b) => b.customerId === m[1]).map((b) => Accept.enrichBooking(b));

  // ID03
  if (method === "POST" && path === "/api/reports/weekly") return Report.generate(body.weekStart, body.weekEnd);

  if (path === "/api/health") return { status: "ok" };
  throw new HttpError(404, "NOT_FOUND", "Unknown endpoint: " + path);
}

// ---------------------------------------------------------------------------
// Static file serving for the built client
// ---------------------------------------------------------------------------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

async function serveStatic(res, filePath) {
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b ? JSON.parse(b) : {}));
  });
}

const server = http.createServer(async (req, res) => {
  const { path, query } = parseUrl(req.url);
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (path.startsWith("/api/")) {
    try {
      const body = req.method === "GET" ? {} : await readBody(req);
      const result = await handleApi(req.method, path, query, body);
      // Return 201 Created for the resource-creation endpoints (matches the full
      // Express build); 200 OK for everything else.
      const isCreate =
        req.method === "POST" &&
        (path === "/api/inquiries" ||
          path === "/api/price-requests" ||
          path === "/api/idps" ||
          /^\/api\/price-requests\/[^/]+\/offer$/.test(path) ||
          /^\/api\/idps\/[^/]+\/photos$/.test(path));
      res.writeHead(isCreate ? 201 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(e.status || 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message, code: e.code || "INTERNAL" }));
    }
    return;
  }

  // static client; SPA fallback to index.html
  if (!existsSync(CLIENT_DIR)) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Built client not found. Run `npm run build` first, or use the pre-built dist/client committed to the repo.");
    return;
  }
  const candidate = join(CLIENT_DIR, path === "/" ? "index.html" : path.replace(/^\//, ""));
  if (await serveStatic(res, candidate)) return;
  await serveStatic(res, join(CLIENT_DIR, "index.html"));
});

// ---------------------------------------------------------------------------
// Bulk test data: set BULK=1 to generate 100+ records per core data type for a
// realistic live demo (e.g.  BULK=1 node standalone.mjs ). Default keeps the
// small, curated demo set so first-time use is simple.
// ---------------------------------------------------------------------------
function generateBulk() {
  const FIRST = ["Mei Ling", "Wei Jie", "Siti", "Arjun", "Hui Fang", "Daniel", "Nurul", "Ethan", "Priya", "Jun Hao", "Rachel", "Faizal", "Grace", "Marcus", "Aisha"];
  const LAST = ["Tan", "Lim", "Lee", "Wong", "Kumar", "Ng", "Rahman", "Goh", "Chua", "Devi", "Ong", "Teo", "Koh", "Yeo", "Nair"];
  const PROPERTY = ["HDB 3-Room BTO", "HDB 4-Room BTO", "HDB 5-Room Resale", "HDB Executive", "Condominium", "Executive Condo", "Landed Terrace", "Shoebox Apartment"];
  const TOWNS = ["Punggol", "Sengkang", "Tampines", "Bishan", "Clementi", "Woodlands", "Serangoon", "Yishun", "Bedok", "Queenstown"];
  const BUDGETS = ["S$30,000 - S$45,000", "S$45,000 - S$60,000", "S$60,000 - S$80,000", "S$80,000 - S$100,000", "S$100,000 - S$140,000"];
  const styleNames = ["Scandinavian", "Modern Contemporary", "Muji / Japandi", "Industrial", "Minimalist", "Luxe Classic", "Mid-Century", "Coastal"];
  const designerIds = DB.companies.map((c) => c.designerId);
  const catIds = DB.categories.map((c) => c.id);
  const r = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const p = (arr) => arr[r(0, arr.length - 1)];

  // extra designers (→ company_profiles ≥ 100)
  for (let i = 0; i < 110; i++) {
    const did = uid("desn");
    const firm = p(["Habitat", "Nordic Nest", "Urban Canvas", "Loft & Co", "Terra", "Blank Space", "Casa", "Form & Function", "Aureus", "Monocot"]) + " " + p(["Studio", "Interiors", "Design", "Works"]);
    // ONE shared UEN + caseTrust per designer (user row and company profile must agree).
    const sharedUen = String(r(199000000, 202599999)) + "K";
    const caseTrust = Math.random() < 0.8;
    DB.users.push({ id: did, role: "designer", name: firm, email: `hi@${firm.toLowerCase().replace(/[^a-z]/g, "")}${i}.sg`, uen: sharedUen, caseTrust });
    DB.companies.push({ designerId: did, name: firm, uen: sharedUen, caseTrust, logoUrl: p(["🏢", "🏠", "🪟"]), acceptingRequests: Math.random() < 0.85 });
    designerIds.push(did);
  }
  // customers (→ users/channel_prefs ≥ 100)
  const customerIds = ["u_cust"];
  for (let i = 0; i < 120; i++) {
    const cid = uid("cust");
    const name = p(FIRST) + " " + p(LAST);
    DB.users.push({ id: cid, role: "customer", name, email: `${name.toLowerCase().replace(/[^a-z]/g, ".")}@example.sg`, nric: "S****" + r(100, 999) + "A" });
    DB.channelPrefs.push({ customerId: cid, primaryChannel: p(["push", "email", "sms"]), fallbackChannel: "email", pdpaConsent: Math.random() < 0.9, dndWindow: null });
    customerIds.push(cid);
  }
  // IDPs + photos + reviews
  const published = DB.idps.filter((i) => i.status === "published").map((i) => i.id);
  for (let i = 0; i < 160; i++) {
    const idpId = uid("idp");
    const style = p(styleNames), prop = p(PROPERTY), town = p(TOWNS);
    const status = Math.random() < 0.8 ? "published" : p(["draft", "in_moderation"]);
    const views = status === "published" ? r(5, 400) : 0;
    DB.idps.push({ id: idpId, designerId: p(designerIds), title: `${style} ${prop.replace("HDB ", "")} in ${town}`, description: `A ${style.toLowerCase()} renovation for a ${prop} in ${town}, including carpentry, flooring and lighting within a ${p(BUDGETS)} budget.`, propertyType: prop, budgetRangeSgd: p(BUDGETS), categoryId: p(catIds), status, viewCount: views, shortlistCount: status === "published" ? r(0, Math.max(1, Math.floor(views / 6))) : 0, services: p(["Full home renovation · Carpentry · Flooring · Painting · HDB permit handling", "Kitchen & bathroom specialist · Tiling · Waterproofing", "Space planning · Custom carpentry · Lighting design"]), createdDate: new Date(Date.now() - r(1, 120) * 86400000 - r(0, 86399) * 1000).toISOString() });
    if (status === "published") published.push(idpId);
    const gal = galleryFor(i, r(3, 5)); gal.forEach((u, k) => DB.photos.push({ id: uid("pho"), idpId, url: u, order: k, format: "jpg", consentConfirmed: true }));
    for (let k = 0; k < r(0, 4); k++) DB.reviews.push({ id: uid("rev"), idpId, rating: r(3, 5), comment: "Great work, delivered on budget.", verified: Math.random() < 0.85 });
  }
  // inquiries + notifications
  for (let i = 0; i < 140; i++) {
    const idpId = p(published);
    const idp = DB.idps.find((x) => x.id === idpId);
    const cust = p(customerIds);
    const replied = Math.random() < 0.55;
    const created = new Date(Date.now() - r(1, 60) * 86400000 - r(0, 86399) * 1000).toISOString();
    {
      const msg = p(["Is this available for my unit?", "What is the lead time?", "Can you work to my budget?"]);
      const thread = [{ from: "customer", text: msg, at: created }];
      if (replied) thread.push({ from: "designer", text: p(["Thanks for reaching out — we can tailor the scope to your budget.", "Lead time is about 8–10 weeks; happy to arrange a consultation.", "Yes, we handle HDB permit submission as part of the package."]), at: created });
      DB.inquiries.push({ id: uid("inq"), idpId, customerId: cust, designerId: idp.designerId, message: msg, status: replied ? "replied" : "new", thread, createdDate: created });
    }
    if (replied) DB.notifications.push({ id: uid("ntf"), customerId: cust, channel: p(["push", "email", "sms"]), content: "A designer has replied to your inquiry.", status: "delivered", createdDate: created });
  }
  while (DB.notifications.length < 110) DB.notifications.push({ id: uid("ntf"), customerId: p(customerIds), channel: "email", content: "A designer has replied to your inquiry.", status: "delivered", createdDate: new Date().toISOString() });
  // price requests + offers + accepted → contracts/payments/bookings
  const openOffers = [];
  for (let i = 0; i < 170; i++) {
    const idpId = p(published);
    const idp = DB.idps.find((x) => x.id === idpId);
    const cust = p(customerIds);
    const reqId = uid("req");
    const created = new Date(Date.now() - r(1, 45) * 86400000 - r(0, 86399) * 1000).toISOString();
    const quoted = Math.random() < 0.8;
    DB.priceRequests.push({ id: reqId, idpId, customerId: cust, designerId: idp.designerId, scope: p(["Full home renovation", "Kitchen + living", "Master bedroom"]), propertyType: p(PROPERTY), unitSizeSqft: r(450, 2200), budgetRangeSgd: p(BUDGETS), status: quoted ? "quoted" : "pending", slaDeadline: new Date(Date.parse(created) + 48 * 3600000).toISOString(), createdDate: created });
    if (quoted) {
      const offId = uid("off"), amount = r(25, 150) * 1000;
      // open/accepted -> future expiry; expired -> PAST expiry and never later accepted.
      const roll = Math.random();
      const status = roll < 0.3 ? "accepted" : roll < 0.45 ? "expired" : "open";
      const expiryDays = status === "expired" ? -r(1, 10) : r(3, 14);
      DB.priceOffers.push({ id: offId, priceRequestId: reqId, idpId, customerId: cust, designerId: idp.designerId, amountSgd: amount, status, expiryDate: new Date(Date.now() + expiryDays * 86400000).toISOString() });
      if (status === "open") openOffers.push({ id: offId, customerId: cust, designerId: idp.designerId, amountSgd: amount });
    }
  }
  // Top up accepted offers by consuming OPEN ones only, each exactly once (no duplicates).
  const accepted = DB.priceOffers.filter((o) => o.status === "accepted");
  while (accepted.length < 110 && openOffers.length) {
    const o = openOffers.pop();
    const off = DB.priceOffers.find((x) => x.id === o.id);
    off.status = "accepted";
    accepted.push(off);
  }
  for (const o of accepted) {
    const commission = round2(o.amountSgd * COMMISSION_RATE);
    const gst = round2(commission * GST_RATE);
    const created = new Date(Date.now() - r(1, 40) * 86400000 - r(0, 86399) * 1000).toISOString();
    DB.contracts.push({ id: uid("con"), offerId: o.id, terms: `Renovation agreement, S$${o.amountSgd.toFixed(2)}, ETA-executed.`, signedByCustomer: true, signedByDesigner: true });
    DB.payments.push({ id: uid("pay"), offerId: o.id, amountSgd: commission, commissionSgd: commission, gstSgd: gst, totalSgd: round2(commission + gst), method: p(["PayNow", "NETS", "Card"]), status: "approved", invoiceNo: "INV-2026-" + uid("x").slice(-6).toUpperCase() });
    DB.bookings.push({ id: uid("bkg"), offerId: o.id, customerId: o.customerId, designerId: o.designerId, status: "confirmed", insured: true, permitVerified: true, createdDate: created });
    DB.audit.push({ id: uid("log"), action: "OFFER_ACCEPTED", actorId: o.customerId, entityId: o.id, amountSgd: o.amountSgd, timestamp: created });
  }
  // Guarantee the demo customer (u_cust) has an OPEN offer to accept during the
  // live demo, plus a couple of inquiries, so the easy-mode demo is complete.
  const demoIdp = published[0];
  const demoDesigner = DB.idps.find((x) => x.id === demoIdp).designerId;
  const demoReq = uid("req");
  DB.priceRequests.push({ id: demoReq, idpId: demoIdp, customerId: "u_cust", designerId: demoDesigner, scope: "Full home renovation", propertyType: "HDB 4-Room BTO", unitSizeSqft: 990, budgetRangeSgd: "S$45,000 - S$60,000", status: "quoted", slaDeadline: new Date(Date.now() + 48 * 3600000).toISOString(), createdDate: new Date().toISOString() });
  DB.priceOffers.push({ id: uid("off"), priceRequestId: demoReq, idpId: demoIdp, customerId: "u_cust", designerId: demoDesigner, amountSgd: 52000, status: "open", expiryDate: new Date(Date.now() + 14 * 86400000).toISOString() });
  const demoT1 = new Date(Date.now() - (r(5, 20) * 3600000)).toISOString();
  DB.inquiries.push({ id: uid("inq"), idpId: demoIdp, customerId: "u_cust", designerId: demoDesigner, message: "Is this package available for my 4-room unit?", status: "replied", thread: [{ from: "customer", text: "Is this package available for my 4-room unit?", at: demoT1 }, { from: "designer", text: "Thanks for reaching out — we have availability next month and can tailor the scope to your budget.", at: demoT1 }], createdDate: demoT1 });
  const demoT2 = new Date(Date.now() - (r(1, 4) * 3600000)).toISOString();
  DB.inquiries.push({ id: uid("inq"), idpId: demoIdp, customerId: "u_cust", designerId: demoDesigner, message: "What is the typical lead time for this package?", status: "new", thread: [{ from: "customer", text: "What is the typical lead time for this package?", at: demoT2 }], createdDate: demoT2 });

  // activity log padding for ID03
  const actions = ["USER_SIGNED_UP", "IDP_PUBLISHED", "IDP_VIEWED", "IDP_SHORTLISTED", "INQUIRY_SUBMITTED"];
  while (DB.audit.length < 400) DB.audit.push({ id: uid("log"), action: p(actions), actorId: p(customerIds), entityId: null, amountSgd: 0, timestamp: new Date(Date.now() - r(1, 56) * 86400000 - r(0, 86399) * 1000).toISOString() });
}

seed();
if (process.env.BULK === "1") {
  generateBulk();
  const n = (a) => a.length;
  console.log(`  BULK mode: users=${n(DB.users)} idps=${n(DB.idps)} photos=${n(DB.photos)} inquiries=${n(DB.inquiries)} offers=${n(DB.priceOffers)} bookings=${n(DB.bookings)} payments=${n(DB.payments)}`);
}
server.listen(PORT, () => {
  console.log(`\n  IDMatch (standalone) running →  http://localhost:${PORT}\n`);
  console.log("  No build or npm install needed. Switch roles with the top-right selector.");
  console.log("  Tip: run with  BULK=1 node standalone.mjs  for 100+ records per data type.\n");
});
