// Thin typed API client. Throws an ApiError-shaped object on non-2xx so UI
// components can show the server's human-readable message and code.
import type {
  IDP,
  Photo,
  Review,
  Category,
  CompanyProfile,
  Inquiry,
  Notification,
  PriceRequest,
  PriceOffer,
  Booking,
  Report,
  User,
} from "../shared/types";

const BASE = "/api";

export class ApiCallError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiCallError(data?.error ?? "Request failed", data?.code ?? "INTERNAL");
  }
  return data as T;
}

export const api = {
  users: () => req<User[]>("/users"),

  // ID08 + listings
  listIdps: (q?: string) => req<IDP[]>(`/idps${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  viewIdp: (id: string, custId?: string) =>
    req<{ idp: IDP; photos: Photo[]; reviews: Review[]; company?: CompanyProfile; shortlisted?: boolean }>(
      `/idps/${id}${custId ? `?custId=${custId}` : ""}`
    ),
  shortlist: (id: string, custId: string) =>
    req<IDP & { shortlisted: boolean }>(`/idps/${id}/shortlist`, { method: "POST", body: JSON.stringify({ custId }) }),
  categories: () => req<Category[]>("/categories"),

  // ID07 create
  designerIdps: (id: string) => req<IDP[]>(`/designer/${id}/idps`),
  createIdp: (body: Record<string, unknown>) => req<IDP>("/idps", { method: "POST", body: JSON.stringify(body) }),
  updateIdp: (id: string, body: Record<string, unknown>) => req<IDP>(`/idps/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  addPhoto: (id: string, body: Record<string, unknown>) =>
    req<Photo>(`/idps/${id}/photos`, { method: "POST", body: JSON.stringify(body) }),
  assignCategory: (id: string, categoryId: string) =>
    req(`/idps/${id}/category`, { method: "POST", body: JSON.stringify({ categoryId }) }),
  submitForModeration: (id: string) => req(`/idps/${id}/submit`, { method: "POST", body: "{}" }),

  // ID06 preview + publish
  preview: (id: string) =>
    req<{ idp: IDP; photos: Photo[]; company?: CompanyProfile; check: { issues: string[]; canPublish: boolean; verified: boolean; pdpaOk: boolean; complete: boolean } }>(
      `/idps/${id}/preview`
    ),
  publish: (id: string) => req<IDP>(`/idps/${id}/publish`, { method: "POST", body: "{}" }),

  // ID01 inquiries
  submitInquiry: (custId: string, idpId: string, message: string) =>
    req<Inquiry>("/inquiries", { method: "POST", body: JSON.stringify({ custId, idpId, message }) }),
  inquiries: (role: string, userId: string) => req<Inquiry[]>(`/inquiries?role=${role}&userId=${userId}`),
  replyInquiry: (id: string, reply: string) =>
    req<Inquiry>(`/inquiries/${id}/reply`, { method: "POST", body: JSON.stringify({ reply }) }),
  followUpInquiry: (id: string, custId: string, message: string) =>
    req<Inquiry>(`/inquiries/${id}/follow-up`, { method: "POST", body: JSON.stringify({ custId, message }) }),
  openThread: (designerId: string, custId: string, idpId: string) =>
    req<Inquiry>(`/inquiries/open-thread`, { method: "POST", body: JSON.stringify({ designerId, custId, idpId }) }),

  // ID02 notifications
  notifications: (custId: string) => req<Notification[]>(`/notifications/${custId}`),
  channelPrefs: (custId: string) =>
    req<{ primaryChannel: string; fallbackChannel: string; pdpaConsent: number; dndWindow: string | null }>(
      `/channel-prefs/${custId}`
    ),
  updateChannelPrefs: (custId: string, body: Record<string, unknown>) =>
    req(`/channel-prefs/${custId}`, { method: "PUT", body: JSON.stringify(body) }),

  // ID04 price requests + offers
  createPriceRequest: (body: Record<string, unknown>) =>
    req<PriceRequest>("/price-requests", { method: "POST", body: JSON.stringify(body) }),
  priceRequests: (role: string, userId: string) =>
    req<PriceRequest[]>(`/price-requests?role=${role}&userId=${userId}`),
  makeOffer: (requestId: string, designerId: string, amountSgd: number) =>
    req<PriceOffer>(`/price-requests/${requestId}/offer`, {
      method: "POST",
      body: JSON.stringify({ designerId, amountSgd }),
    }),
  designerOffers: (designerId: string) => req<PriceOffer[]>(`/designer-offers/${designerId}`),
  offers: (custId: string) => req<PriceOffer[]>(`/offers/${custId}`),
  counterOffer: (offerId: string, custId: string, counterAmountSgd: number) =>
    req<PriceOffer>(`/offers/${offerId}/counter`, { method: "POST", body: JSON.stringify({ custId, counterAmountSgd }) }),
  respondToCounter: (offerId: string, designerId: string, acceptCounter: boolean, revisedAmountSgd?: number) =>
    req<PriceOffer>(`/offers/${offerId}/respond-counter`, {
      method: "POST",
      body: JSON.stringify({ designerId, acceptCounter, revisedAmountSgd }),
    }),

  // ID05 accept offer
  acceptOffer: (
    offerId: string,
    custId: string,
    method: string,
    simulate?: Record<string, boolean>,
    documents?: { name: string; url: string; uploadedAt: string }[]
  ) =>
    req<{ booking: Booking; contract: { id: string; terms: string }; payment: { totalSgd: number; gstSgd: number; commissionSgd: number; invoiceNo: string; method: string }; steps: string[] }>(
      `/offers/${offerId}/accept`,
      { method: "POST", body: JSON.stringify({ custId, method, simulate, documents }) }
    ),
  bookings: (custId: string) => req<Booking[]>(`/bookings/${custId}`),
  designerBookings: (designerId: string) => req<Booking[]>(`/designer-bookings/${designerId}`),
  confirmStage: (id: string, role: "customer" | "designer") =>
    req<Booking>(`/bookings/${id}/confirm-stage`, { method: "POST", body: JSON.stringify({ role }) }),
  pendingBookings: (designerId: string) => req<Booking[]>(`/designer-bookings/${designerId}/pending`),
  approveBooking: (id: string, designerId: string) =>
    req<Booking>(`/bookings/${id}/approve`, { method: "POST", body: JSON.stringify({ designerId }) }),

  // ID03 report
  weeklyReport: (weekStart: string, weekEnd: string) =>
    req<Report>("/reports/weekly", { method: "POST", body: JSON.stringify({ weekStart, weekEnd }) }),
};
