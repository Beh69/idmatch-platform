import { useEffect, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { Alert, Modal, StatusTag, useAsync } from "../components";
import { PHOTO_SEQUENCE, isImageUrl } from "../../shared/stockPhotos";
import type { IDP, Category } from "../../shared/types";

// ID07 Create an IDP (multi-step: details → photos → category → submit) and
// ID06 Preview before publishing (completeness + PDPA + verification checks).
export function DesignerStudio() {
  const { current } = useSession();
  const [idps, setIdps] = useState<IDP[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editIdp, setEditIdp] = useState<IDP | null>(null);

  function load() {
    if (current) api.designerIdps(current.id).then(setIdps);
  }
  useEffect(() => {
    load();
    api.categories().then(setCats);
  }, [current?.id]);

  return (
    <div>
      <div className="page-head">
        <h1>Design Studio</h1>
        <span className="tag id">ID07</span>
        <span className="tag id">ID06</span>
        <div className="spacer" />
        <button onClick={() => setShowCreate(true)}>+ New portfolio</button>
      </div>

      <div className="section">
        {idps.length === 0 ? (
          <div className="empty">No portfolios yet. Create your first IDP.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Property</th>
                <th>Status</th>
                <th>Interest</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {idps.map((i) => (
                <tr key={i.id}>
                  <td>
                    <strong>{i.title}</strong>
                  </td>
                  <td className="muted">{i.propertyType}</td>
                  <td>
                    <StatusTag status={i.status} />
                  </td>
                  <td className="muted">
                    👁 {i.viewCount} · ⭐ {i.shortlistCount}
                  </td>
                  <td style={{ display: "flex", gap: 6 }}>
                    {i.status !== "published" && (
                      <button className="ghost sm" onClick={() => setEditIdp(i)}>
                        Edit
                      </button>
                    )}
                    <button className="ghost sm" onClick={() => setPreviewId(i.id)}>
                      Preview &amp; publish
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <CreateModal
          cats={cats}
          designerId={current!.id}
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
      {previewId && (
        <PreviewModal
          id={previewId}
          onClose={() => setPreviewId(null)}
          onPublished={() => {
            setPreviewId(null);
            load();
          }}
        />
      )}
      {editIdp && (
        <EditModal
          idp={editIdp}
          cats={cats}
          onClose={() => setEditIdp(null)}
          onSaved={() => {
            setEditIdp(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// ---- ID07 Create an IDP ----
function CreateModal({
  cats,
  designerId,
  onClose,
  onDone,
}: {
  cats: Category[];
  designerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState(1);
  const [idpId, setIdpId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    propertyType: "HDB 4-Room BTO",
    budgetRangeSgd: "S$40,000 - S$55,000",
    categoryId: cats[0]?.id ?? "",
    services: "Full home renovation · Carpentry · Flooring · Painting · HDB permit handling",
  });
  const [consent, setConsent] = useState(true);
  const [photos, setPhotos] = useState<string[]>([]);
  const { busy, err, ok, setOk, setErr, run } = useAsync();

  return (
    <Modal title={`Create a portfolio — step ${step} of 3 (ID07)`} onClose={onClose}>
      <Alert kind="err">{err}</Alert>
      <Alert kind="ok">{ok}</Alert>

      {step === 1 && (
        <>
          <label>Title</label>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Scandinavian 3-Room Resale" />
          <label>Description (min 30 chars)</label>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="row">
            <div>
              <label>Property type</label>
              <input value={form.propertyType} onChange={(e) => setForm({ ...form, propertyType: e.target.value })} />
            </div>
            <div>
              <label>Budget range (SGD)</label>
              <input value={form.budgetRangeSgd} onChange={(e) => setForm({ ...form, budgetRangeSgd: e.target.value })} />
            </div>
          </div>
          <label>Category</label>
          <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label>Services offered (what you advertise to customers)</label>
          <textarea
            value={form.services}
            onChange={(e) => setForm({ ...form, services: e.target.value })}
            placeholder="e.g. Full home renovation · Carpentry · Flooring · Painting · HDB permit handling"
          />
          <div style={{ marginTop: 14 }}>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const idp = await api.createIdp({ designerId, ...form });
                  setIdpId(idp.id);
                  await api.assignCategory(idp.id, form.categoryId);
                  setOk("Draft created. Add photos next.");
                  setStep(2);
                })
              }
            >
              {busy ? "Creating…" : "Create draft & continue"}
            </button>
          </div>
        </>
      )}

      {step === 2 && idpId && (
        <>
          <p className="muted">Each photo needs confirmed consent (PDPA) and passes a virus scan before it is stored.</p>

          {/* Consent is a PREREQUISITE and sits above the pickers. When it is
              off, adding photos is disabled (rather than firing a failing request). */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            I confirm consent to publish these photos (PDPA)
          </label>
          {!consent && (
            <p className="hint" style={{ color: "var(--warn)" }}>
              Tick the consent box above to enable adding photos.
            </p>
          )}

          {photos.length > 0 && (
            <>
              <label>Added photos ({photos.length})</label>
              <div className="gallery" style={{ marginBottom: 12 }}>
                {photos.map((p, i) =>
                  isImageUrl(p) ? (
                    <img key={i} className="ph" src={p} alt="added" loading="lazy" />
                  ) : (
                    <div key={i} className="ph">
                      {p}
                    </div>
                  )
                )}
              </div>
            </>
          )}
          <label>Choose photos to add (click a thumbnail)</label>
          <div className="gallery" style={{ marginBottom: 10, opacity: consent ? 1 : 0.45 }}>
            {PHOTO_SEQUENCE.map((url) => {
              const added = photos.includes(url);
              const disabled = added || busy || !consent;
              return (
                <img
                  key={url}
                  src={url}
                  alt="interior"
                  loading="lazy"
                  className="ph"
                  style={{ cursor: disabled ? "not-allowed" : "pointer", outline: added ? "3px solid var(--accent-2)" : "none", opacity: added ? 0.55 : 1 }}
                  onClick={() => {
                    if (disabled) {
                      if (!consent) setErr("Please confirm photo consent (PDPA) before adding a photo.");
                      return;
                    }
                    run(async () => {
                      await api.addPhoto(idpId, { url, format: "jpg", consentConfirmed: true });
                      setPhotos((p) => [...p, url]);
                      setErr("");
                    });
                  }}
                />
              );
            })}
          </div>

          <label>…or upload your own photos</label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            disabled={busy || !consent}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = ""; // allow re-selecting the same file
              if (!consent) {
                setErr("Please confirm photo consent (PDPA) before uploading.");
                return;
              }
              files.forEach((file) => {
                const reader = new FileReader();
                reader.onload = () => {
                  const dataUrl = String(reader.result);
                  const fmt = (file.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
                  run(async () => {
                    await api.addPhoto(idpId, { url: dataUrl, format: fmt, consentConfirmed: true });
                    setPhotos((p) => [...p, dataUrl]);
                    setErr("");
                  });
                };
                reader.readAsDataURL(file);
              });
            }}
          />
          <p className="hint">Upload JPG, PNG or WEBP from your device, or click a preset thumbnail above.</p>

          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <button disabled={busy || photos.length === 0} onClick={() => setStep(3)}>
              Continue ({photos.length} added)
            </button>
          </div>
        </>
      )}

      {step === 3 && idpId && (
        <>
          <p>Submit the draft for moderation. You can then preview and publish it.</p>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.submitForModeration(idpId);
                setOk("Submitted for moderation.");
                setTimeout(onDone, 600);
              })
            }
          >
            {busy ? "Submitting…" : "Submit for moderation"}
          </button>
        </>
      )}
    </Modal>
  );
}

// ---- Edit an existing (unpublished) portfolio ----
function EditModal({
  idp,
  cats,
  onClose,
  onSaved,
}: {
  idp: IDP;
  cats: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: idp.title,
    description: idp.description,
    propertyType: idp.propertyType,
    budgetRangeSgd: idp.budgetRangeSgd,
    categoryId: idp.categoryId ?? "",
  });
  const { busy, err, ok, setOk, run } = useAsync();

  return (
    <Modal title={`Edit portfolio — ${idp.title}`} onClose={onClose}>
      <Alert kind="err">{err}</Alert>
      <Alert kind="ok">{ok}</Alert>
      <label>Title</label>
      <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <label>Description (min 30 characters)</label>
      <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <div className="hint">{form.description.trim().length}/30 characters minimum.</div>
      <div className="row">
        <div>
          <label>Property type</label>
          <input value={form.propertyType} onChange={(e) => setForm({ ...form, propertyType: e.target.value })} />
        </div>
        <div>
          <label>Budget range (SGD)</label>
          <input value={form.budgetRangeSgd} onChange={(e) => setForm({ ...form, budgetRangeSgd: e.target.value })} />
        </div>
      </div>
      <label>Category</label>
      <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
        <option value="">— none —</option>
        {cats.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <div style={{ marginTop: 14 }}>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api.updateIdp(idp.id, form);
              setOk("Saved. You can now preview and publish.");
              setTimeout(onSaved, 500);
            })
          }
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}

// ---- ID06 Preview before publishing ----
function PreviewModal({ id, onClose, onPublished }: { id: string; onClose: () => void; onPublished: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.preview>> | null>(null);
  const { busy, err, run } = useAsync();

  function load() {
    api.preview(id).then(setData);
  }
  useEffect(load, [id]);
  if (!data) return <Modal title="Preview (ID06)" onClose={onClose}>Loading…</Modal>;

  const { idp, photos, company, check } = data;
  return (
    <Modal title="Preview before publishing (ID06)" onClose={onClose}>
      <div className="gallery" style={{ marginBottom: 14 }}>
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
      <h3 style={{ margin: "0 0 6px" }}>{idp.title}</h3>
      <div className="muted" style={{ marginBottom: 10 }}>
        {idp.propertyType} · {idp.budgetRangeSgd}
      </div>
      <p style={{ marginBottom: 10, lineHeight: 1.55 }}>{idp.description}</p>
      {company && (
        <div className="muted" style={{ marginBottom: 6 }}>
          {company.logoUrl} {company.name} · UEN {company.uen} {company.caseTrust ? "· CaseTrust ✓" : ""}
        </div>
      )}

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
        <h3 style={{ marginBottom: 8 }}>Pre-publish checks</h3>
        <div className="chips" style={{ marginBottom: 10 }}>
          <span className={`tag ${check.verified ? "ok" : "danger"}`}>UEN / CaseTrust {check.verified ? "✓" : "✗"}</span>
          <span className={`tag ${check.pdpaOk ? "ok" : "danger"}`}>PDPA consent {check.pdpaOk ? "✓" : "✗"}</span>
          <span className={`tag ${check.complete ? "ok" : "warn"}`}>Completeness {check.complete ? "✓" : "incomplete"}</span>
        </div>
        {check.issues.length > 0 && (
          <ul className="check">
            {check.issues.map((iss, i) => (
              <li key={i} className="tag warn" style={{ display: "block", marginBottom: 4 }}>
                {iss}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Alert kind="err">{err}</Alert>
      <div style={{ marginTop: 14 }}>
        <button
          className="ok"
          disabled={busy || !check.canPublish}
          onClick={() =>
            run(async () => {
              await api.publish(id);
              onPublished();
            })
          }
        >
          {check.canPublish ? "Publish now" : "Resolve issues to publish"}
        </button>
      </div>
    </Modal>
  );
}
