// ---------------------------------------------------------------------------
// Shared domain types used by BOTH the Express backend and the React client.
// These mirror the entity classes in the BCE class diagrams (ID01-ID08).
// All monetary values are in SGD; GST is applied at the Singapore rate (9%).
// ---------------------------------------------------------------------------

export const GST_RATE = 0.09; // Singapore GST, 9% (effective 2024+)
export const PLATFORM_COMMISSION_RATE = 0.05; // 5% platform commission on project value

export type Role = "customer" | "designer" | "manager";

export interface User {
  id: string;
  role: Role;
  name: string;
  email: string;
  nric?: string; // masked, Singpass-verified customers only
  uen?: string; // designers / companies
  caseTrust?: boolean;
}

export type IdpStatus = "draft" | "in_moderation" | "published" | "rejected";

// Entity: IDP (Interior Design Portfolio item) — shared across ID06/07/08
export interface IDP {
  id: string;
  designerId: string;
  title: string;
  description: string;
  propertyType: string; // HDB 4-Room, Condominium, Landed, etc.
  budgetRangeSgd: string;
  categoryId: string | null;
  status: IdpStatus;
  viewCount: number;
  shortlistCount: number;
  services?: string | null; // scope of work the designer advertises/offers
  createdDate: string;
  coverUrl?: string | null; // first photo, populated on browse listings
}

export interface Photo {
  id: string;
  idpId: string;
  url: string;
  order: number;
  format: string;
  consentConfirmed: boolean;
}

export interface Review {
  id: string;
  idpId: string;
  rating: number; // 1..5
  comment: string;
  verified: boolean;
}

export interface Category {
  id: string;
  name: string;
}

export interface CompanyProfile {
  designerId: string;
  name: string;
  uen: string;
  caseTrust: boolean;
  logoUrl: string;
  acceptingRequests: boolean;
}

// ID01 — Inquiry
export type InquiryStatus = "new" | "replied" | "closed";
export interface ThreadMessage {
  from: "customer" | "designer";
  text: string;
  at: string;
}

export interface Inquiry {
  id: string;
  idpId: string;
  customerId: string;
  designerId: string;
  message: string; // the opening message (contact details masked, PDPA)
  status: InquiryStatus;
  reply?: string | null; // legacy single-reply fields (kept for compatibility)
  customerFollowUp?: string | null;
  thread?: ThreadMessage[]; // full unlimited conversation
  createdDate: string;
  idpTitle?: string; // the portfolio this inquiry is about (populated on listing)
  customerName?: string; // the customer in this conversation (populated on listing)
  designerName?: string; // the designer/firm in this conversation (populated on listing)
  relatedRequestId?: string | null; // a price request between the same pair, if any
}

// ID04 — Price request
export type PriceRequestStatus = "pending" | "quoted" | "declined" | "expired";
export interface PriceRequest {
  id: string;
  idpId: string;
  customerId: string;
  designerId: string;
  scope: string;
  propertyType: string;
  unitSizeSqft: number;
  budgetRangeSgd: string;
  status: PriceRequestStatus;
  slaDeadline: string;
  createdDate: string;
  customerName?: string; // populated when listed for the designer
}

// ID05 — Price offer + downstream contract / payment / booking
export type OfferStatus = "open" | "accepted" | "expired" | "declined" | "countered";
export interface PriceOffer {
  id: string;
  priceRequestId: string;
  idpId: string;
  customerId: string;
  designerId: string;
  amountSgd: number;
  status: OfferStatus;
  expiryDate: string;
  counterAmountSgd?: number | null; // customer's counter-offer amount, if any
}

export interface Contract {
  id: string;
  offerId: string;
  terms: string;
  signedByCustomer: boolean;
  signedByDesigner: boolean;
}

export interface Payment {
  id: string;
  offerId: string;
  amountSgd: number; // deposit (project value portion charged now)
  commissionSgd: number;
  gstSgd: number;
  totalSgd: number;
  method: string; // PayNow / NETS / Card
  status: "approved" | "declined";
  invoiceNo: string;
}

// The post-booking project lifecycle (the "due diligence over weeks" before
// handover). Each stage is cleared in order; the final stage is Handover.
export const PROJECT_STAGES = [
  "Deposit Secured",
  "Site Survey & Measurement",
  "Design Finalisation & Sign-off",
  "HDB/BCA Permit Approved",
  "Materials Procurement",
  "Hacking & Masonry",
  "Carpentry & Installation",
  "Final Inspection & Defects Check",
  "Handover (Keys Returned)",
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export interface StageEntry {
  stage: ProjectStage;
  at: string;
  note?: string;
}

// Documents the customer must upload before a booking is confirmed.
export const REQUIRED_DOCUMENTS = [
  "NRIC / identity document",
  "Proof of property ownership / tenancy",
  "Signed renovation contract",
  "HDB/BCA renovation permit",
  "Renovation insurance certificate",
] as const;
export type RequiredDocument = (typeof REQUIRED_DOCUMENTS)[number];

export interface UploadedDocument {
  name: string; // one of REQUIRED_DOCUMENTS
  url: string; // image data URL or link
  uploadedAt: string;
}

export interface Booking {
  id: string;
  offerId: string;
  customerId: string;
  designerId: string;
  // pending_review: docs uploaded, awaiting the designer's approval
  status: "pending_review" | "confirmed" | "completed";
  insured: boolean;
  permitVerified: boolean;
  documents?: UploadedDocument[]; // customer-uploaded supporting documents
  stage?: ProjectStage; // current lifecycle stage (only once confirmed)
  stageHistory?: StageEntry[];
  // The NEXT stage only advances once BOTH parties confirm it.
  pendingConfirm?: { customer: boolean; designer: boolean };
  createdDate: string;
  // Populated on listing for display/labelling:
  customerName?: string;
  designerName?: string;
  idpTitle?: string;
  amountSgd?: number;
  relatedInquiryId?: string | null; // a conversation with this customer, if any
}

// ID02 — Notification
export interface Notification {
  id: string;
  customerId: string;
  channel: string; // push / email / sms
  content: string;
  status: "delivered" | "failed" | "pending";
  createdDate: string;
}

// ID03 — Weekly activity report
export interface Report {
  id: string;
  weekStart: string;
  weekEnd: string;
  signUps: number;
  idpCount: number;
  views: number;
  shortlists: number;
  inquiries: number;
  grossValueSgd: number;
  commissionSgd: number;
  gstCollectedSgd: number;
  status: "final" | "draft";
}

// Generic API envelope
export interface ApiError {
  error: string;
  code: string;
}
