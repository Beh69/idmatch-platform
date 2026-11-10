import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";
import { Alert, Modal, useAsync, IdTag } from "../components";
import { isImageUrl } from "../../shared/stockPhotos";
import type { IDP, Photo, Review, CompanyProfile } from "../../shared/types";

// ID08 View an IDP's details (+ view-count increment), and the entry points for
// ID01 Submit inquiry and ID04 Request a price.
export function IdpDetails() {
  const { id = "" } = useParams();
  const { current } = useSession();
  const [data, setData] = useState<{ idp: IDP; photos: Photo[]; reviews: Review[]; company?: CompanyProfile; shortlisted?: boolean } | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [showInquiry, setShowInquiry] = useState(false);
  const [showPrice, setShowPrice] = useState(false);

  function load() {
    api
      .viewIdp(id, current?.role === "customer" ? current.id : undefined)
      .then(setData)
      .catch((e) => setLoadErr((e as Error).message));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, current?.id]);

  if (loadErr) return <div className="empty">{loadErr}</div>;
  if (!data) return <div className="empty">Loading…</div>;
  const { idp, photos, reviews, company, shortlisted } = data;
  const isCustomer = current?.role === "customer";

  return (
    <div>
      <div className="page-head">
        <h1>{idp.title}</h1>
        <IdTag id="ID08" />
      </div>

      <div className="section">
        <div className="gallery">
          {photos.map((p) =>
            isImageUrl(p.url) ? (
              <img key={p.id} className="ph" src={p.url} alt={idp.title} loading="lazy" />
            ) : (
              <div key={p.id} className="ph">
                {p.url}
              </div>
            )
          )}
        </div>
        <p style={{ marginTop: 16 }}>{idp.description}</p>
        {idp.services && (
          <div style={{ marginTop: 10 }}>
            <div className="muted">Services offered</div>
            <strong>{idp.services}</strong>
          </div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <div>
            <div className="muted">Property type</div>
            <strong>{idp.propertyType}</strong>
          </div>
          <div>
            <div className="muted">Budget range</div>
            <strong>{idp.budgetRangeSgd}</strong>
          </div>
          <div>
            <div className="muted">Interest</div>
            <strong>
              👁 {idp.viewCount} · ⭐ {idp.shortlistCount}
            </strong>
          </div>
        </div>

        {company && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <div className="muted">Design firm</div>
            <strong>
              {company.logoUrl} {company.name}
            </strong>{" "}
            <span className="muted">
              · UEN {company.uen} {company.caseTrust ? "· CaseTrust accredited ✓" : ""}
            </span>
          </div>
        )}

        {isCustomer && (
          <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setShowInquiry(true)}>Ask a question (ID01)</button>
            <button className="ghost" onClick={() => setShowPrice(true)}>
              Request a price (ID04)
            </button>
            <button
              className={shortlisted ? "ok" : "ghost"}
              onClick={() => api.shortlist(idp.id, current!.id).then(load)}
              title={shortlisted ? "Remove from your shortlist" : "Save to your shortlist"}
            >
              {shortlisted ? "★ Shortlisted (saved)" : "☆ Add to shortlist"}
            </button>
          </div>
        )}
      </div>

      <div className="section">
        <h2>Verified reviews</h2>
        {reviews.length === 0 ? (
          <div className="muted">No reviews yet.</div>
        ) : (
          reviews.map((r) => (
            <div key={r.id} className="list-item">
              <div style={{ fontSize: 20 }}>{"⭐".repeat(r.rating)}</div>
              <div>{r.comment}</div>
            </div>
          ))
        )}
      </div>

      {showInquiry && <InquiryModal idpId={idp.id} custId={current!.id} onClose={() => setShowInquiry(false)} />}
      {showPrice && <PriceModal idp={idp} custId={current!.id} onClose={() => setShowPrice(false)} />}
    </div>
  );
}

// ---- ID01 Submit an inquiry ----
function InquiryModal({ idpId, custId, onClose }: { idpId: string; custId: string; onClose: () => void }) {
  const [msg, setMsg] = useState("");
  const { busy, err, ok, setOk, run } = useAsync();
  return (
    <Modal title="Ask the designer a question (ID01)" onClose={onClose}>
      <p className="muted">
        Contact details (phone, email, NRIC) are automatically masked before the message is stored — keeping the
        conversation on-platform (PDPA).
      </p>
      <Alert kind="err">{err}</Alert>
      <Alert kind="ok">{ok}</Alert>
      <label>Your message</label>
      <textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Hi, is this package available for a 4-room BTO in Sengkang? My budget is around S$50k." />
      <div style={{ marginTop: 14 }}>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api.submitInquiry(custId, idpId, msg);
              setOk("Inquiry sent! The designer has been notified. Track replies under My Inquiries.");
              setMsg("");
            })
          }
        >
          {busy ? "Sending…" : "Send inquiry"}
        </button>
      </div>
    </Modal>
  );
}

// ---- ID04 Request a price ----
function PriceModal({ idp, custId, onClose }: { idp: IDP; custId: string; onClose: () => void }) {
  // Property type and budget are prefilled from the portfolio — the customer
  // only supplies their own scope and unit size.
  const [scope, setScope] = useState("Full home renovation incl. carpentry, flooring, painting");
  const [unitSizeSqft, setUnitSizeSqft] = useState(990);
  const { busy, err, ok, setOk, run } = useAsync();

  return (
    <Modal title="Request a price quote (ID04)" onClose={onClose}>
      <p className="muted">The designer has a 48-hour SLA to respond with a quote.</p>
      <Alert kind="err">{err}</Alert>
      <Alert kind="ok">{ok}</Alert>

      {/* prefilled from the portfolio (read-only) */}
      <div className="row" style={{ marginBottom: 4 }}>
        <div>
          <label>Property type (from portfolio)</label>
          <input value={idp.propertyType} readOnly style={{ opacity: 0.75 }} />
        </div>
        <div>
          <label>Budget range (from portfolio)</label>
          <input value={idp.budgetRangeSgd} readOnly style={{ opacity: 0.75 }} />
        </div>
      </div>

      <label>Your unit size (sqft)</label>
      <input type="number" value={unitSizeSqft} onChange={(e) => setUnitSizeSqft(Number(e.target.value))} />
      <label>Scope of work</label>
      <textarea value={scope} onChange={(e) => setScope(e.target.value)} />

      <div style={{ marginTop: 14 }}>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api.createPriceRequest({
                custId,
                idpId: idp.id,
                scope,
                propertyType: idp.propertyType, // taken from the portfolio
                unitSizeSqft,
                budgetRangeSgd: idp.budgetRangeSgd, // taken from the portfolio
              });
              setOk("Price request submitted. You'll see the designer's offer under My Offers.");
            })
          }
        >
          {busy ? "Submitting…" : "Submit request"}
        </button>
      </div>
    </Modal>
  );
}
