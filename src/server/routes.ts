// REST API — the boundary layer exposed to the React client. Each endpoint
// delegates to the matching «control» class and maps typed errors to HTTP codes.
import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "./db.js";
import { InquiryController } from "./controllers/InquiryController.js";
import { NotificationController } from "./controllers/NotificationController.js";
import { PriceRequestController } from "./controllers/PriceRequestController.js";
import { OfferAcceptanceController } from "./controllers/OfferAcceptanceController.js";
import { IDPController } from "./controllers/IDPController.js";
import { ReportController } from "./controllers/ReportController.js";
import type { User } from "../shared/types.js";

export const api = Router();

// Tiny async wrapper so thrown controller errors reach the error middleware.
const h =
  (fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

// --- auth-lite: users pick a demo identity; id passed via header/body --------
// Only the three stable demo accounts are offered in the role-switcher, even
// though the database holds many generated users (for realistic data volume).
api.get("/users", h((_req, res) => {
  res.json(db.prepare(`SELECT * FROM users WHERE id IN ('u_cust','u_desn','u_mgr') ORDER BY CASE role WHEN 'customer' THEN 0 WHEN 'designer' THEN 1 ELSE 2 END`).all());
}));

// --- ID08 / search / listings ------------------------------------------------
api.get("/idps", h((req, res) => {
  res.json(IDPController.listPublished(req.query.q as string | undefined));
}));
api.get("/idps/:id", h((req, res) => {
  const custId = (req.query.custId as string) || null;
  res.json(IDPController.viewDetails(req.params.id, custId));
}));
api.post("/idps/:id/shortlist", h((req, res) => {
  res.json(IDPController.shortlist(req.body.custId, req.params.id));
}));
api.get("/categories", h((_req, res) => res.json(IDPController.listCategories())));

// --- ID07 create IDP ---------------------------------------------------------
api.get("/designer/:id/idps", h((req, res) => res.json(IDPController.listForDesigner(req.params.id))));
api.post("/idps", h((req, res) => {
  res.status(201).json(IDPController.createIDP(req.body.designerId, req.body));
}));
api.put("/idps/:id", h((req, res) => {
  res.json(IDPController.updateIDP(req.params.id, req.body));
}));
api.post("/idps/:id/photos", h((req, res) => {
  const { url, format, consentConfirmed } = req.body;
  res.status(201).json(IDPController.addPhoto(req.params.id, url, format, consentConfirmed));
}));
api.post("/idps/:id/category", h((req, res) => {
  IDPController.assignCategory(req.params.id, req.body.categoryId);
  res.json({ ok: true });
}));
api.post("/idps/:id/submit", h((req, res) => {
  IDPController.submitForModeration(req.params.id);
  res.json({ ok: true });
}));

// --- ID06 preview + publish --------------------------------------------------
api.get("/idps/:id/preview", h((req, res) => {
  // ID06 «control» IDPPreviewController.buildPreview(idpId)
  res.json(IDPController.buildPreview(req.params.id));
}));
api.post("/idps/:id/publish", h((req, res) => res.json(IDPController.publish(req.params.id))));

// --- ID01 inquiries ----------------------------------------------------------
api.post("/inquiries", h((req, res) => {
  const { custId, idpId, message } = req.body;
  res.status(201).json(InquiryController.submitInquiry(custId, idpId, message));
}));
api.get("/inquiries", h((req, res) => {
  const { role, userId } = req.query as { role: string; userId: string };
  res.json(
    role === "designer"
      ? InquiryController.listForDesigner(userId)
      : InquiryController.listForCustomer(userId)
  );
}));
api.post("/inquiries/:id/reply", h(async (req, res) => {
  res.json(await InquiryController.reply(req.params.id, req.body.reply));
}));
api.post("/inquiries/:id/follow-up", h((req, res) => {
  res.json(InquiryController.followUp(req.params.id, req.body.custId, req.body.message));
}));
api.post("/inquiries/open-thread", h((req, res) => {
  const { designerId, custId, idpId } = req.body;
  res.status(201).json(InquiryController.getOrCreateThread(designerId, custId, idpId));
}));

// --- ID02 notifications ------------------------------------------------------
api.get("/notifications/:custId", h((req, res) => {
  res.json(NotificationController.listForCustomer(req.params.custId));
}));
api.get("/channel-prefs/:custId", h((req, res) => {
  res.json(NotificationController.getConsentPrefs(req.params.custId));
}));
api.put("/channel-prefs/:custId", h((req, res) => {
  const { primaryChannel, fallbackChannel, pdpaConsent, dndWindow } = req.body;
  db.prepare(
    `INSERT INTO channel_prefs (customerId, primaryChannel, fallbackChannel, pdpaConsent, dndWindow)
     VALUES (@customerId,@primaryChannel,@fallbackChannel,@pdpaConsent,@dndWindow)
     ON CONFLICT(customerId) DO UPDATE SET
       primaryChannel=@primaryChannel, fallbackChannel=@fallbackChannel,
       pdpaConsent=@pdpaConsent, dndWindow=@dndWindow`
  ).run({
    customerId: req.params.custId,
    primaryChannel,
    fallbackChannel,
    pdpaConsent: pdpaConsent ? 1 : 0,
    dndWindow: dndWindow || null,
  });
  res.json(NotificationController.getConsentPrefs(req.params.custId));
}));

// --- ID04 price requests + offers --------------------------------------------
api.post("/price-requests", h((req, res) => {
  const { custId, idpId } = req.body;
  res.status(201).json(PriceRequestController.createRequest(custId, idpId, req.body));
}));
api.get("/price-requests", h((req, res) => {
  const { role, userId } = req.query as { role: string; userId: string };
  res.json(
    role === "designer"
      ? PriceRequestController.listForDesigner(userId)
      : PriceRequestController.listForCustomer(userId)
  );
}));
api.post("/price-requests/:id/offer", h((req, res) => {
  const { designerId, amountSgd } = req.body;
  res.status(201).json(PriceRequestController.createOffer(designerId, req.params.id, Number(amountSgd)));
}));
api.post("/offers/:id/counter", h((req, res) => {
  res.json(PriceRequestController.counterOffer(req.body.custId, req.params.id, Number(req.body.counterAmountSgd)));
}));
api.post("/offers/:id/respond-counter", h((req, res) => {
  const { designerId, acceptCounter, revisedAmountSgd } = req.body;
  res.json(PriceRequestController.respondToCounter(designerId, req.params.id, !!acceptCounter, revisedAmountSgd != null ? Number(revisedAmountSgd) : undefined));
}));
api.get("/offers/:custId", h((req, res) => {
  res.json(PriceRequestController.offersForCustomer(req.params.custId));
}));
api.get("/designer-offers/:designerId", h((req, res) => {
  res.json(PriceRequestController.offersForDesigner(req.params.designerId));
}));

// --- ID05 accept offer (the rich chain) --------------------------------------
api.post("/offers/:id/accept", h(async (req, res) => {
  const { custId, method, simulate, documents } = req.body;
  const result = await OfferAcceptanceController.acceptOffer(custId, req.params.id, method || "PayNow", simulate || {}, documents || []);
  res.json(result);
}));
api.get("/bookings/:custId", h((req, res) => {
  res.json(OfferAcceptanceController.listBookings(req.params.custId));
}));
api.post("/bookings/:id/confirm-stage", h((req, res) => {
  res.json(OfferAcceptanceController.confirmStage(req.params.id, req.body.role));
}));
api.get("/designer-bookings/:designerId", h((req, res) => {
  res.json(OfferAcceptanceController.bookingsForDesigner(req.params.designerId));
}));
api.get("/designer-bookings/:designerId/pending", h((req, res) => {
  res.json(OfferAcceptanceController.pendingReviewForDesigner(req.params.designerId));
}));
api.post("/bookings/:id/approve", h((req, res) => {
  res.json(OfferAcceptanceController.approveBooking(req.body.designerId, req.params.id));
}));

// --- ID03 weekly report ------------------------------------------------------
api.post("/reports/weekly", h((req, res) => {
  const { weekStart, weekEnd } = req.body;
  res.json(ReportController.generateReport(weekStart, weekEnd));
}));

// --- error handler (typed controller errors -> HTTP) -------------------------
api.use((err: Error & { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? 500;
  res.status(status).json({ error: err.message, code: err.code ?? "INTERNAL" });
});
