import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";
import { Alert, Modal, StatusTag, useAsync, sgd } from "../components";
import { renovationContractDraft, insuranceDraft, permitDraft, openDraft, type DraftContext } from "../docDrafts";
import { PROJECT_STAGES, REQUIRED_DOCUMENTS, type PriceOffer, type Booking } from "../../shared/types";

// ID05 — Accept a price offer. Shows the designer's offers and, on accept, runs
// the full Singapore chain (Singpass → e-signature → 9% GST → payment → IRAS →
// HDB permit → insurance → booking), surfacing the ordered step trace.
export function MyOffers() {
  const { current } = useSession();
  const navigate = useNavigate();
  const [offers, setOffers] = useState<PriceOffer[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [active, setActive] = useState<PriceOffer | null>(null);
  const [counter, setCounter] = useState<PriceOffer | null>(null);

  // Open (or create) a conversation with the designer of this offer, then jump
  // to My Inquiries and highlight that exact thread — mirrors the designer's
  // "Chat with customer" button.
  async function chatWithDesigner(o: PriceOffer) {
    if (!current) return;
    const thread = await api.openThread(o.designerId, current.id, o.idpId);
    navigate(`/inquiries#flash=inquiry-${thread.id}`);
  }

  function load() {
    if (!current) return;
    api.offers(current.id).then(setOffers);
    api.bookings(current.id).then(setBookings);
  }
  useEffect(load, [current?.id]);

  return (
    <div>
      <div className="page-head">
        <h1>My Offers</h1>
        <span className="tag id">ID05</span>
      </div>

      <div className="section">
        <h2>Price offers</h2>
        {offers.length === 0 ? (
          <div className="empty">No offers yet. Request a price on a portfolio; the designer's quote shows here.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Offer</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id}>
                  <td className="muted">{o.id}</td>
                  <td>
                    <strong>{sgd(o.amountSgd)}</strong>
                  </td>
                  <td>
                    <StatusTag status={o.status} />
                  </td>
                  <td className="muted">
                    {new Date(o.expiryDate).toLocaleDateString("en-SG")}
                    {o.status === "countered" && o.counterAmountSgd != null && (
                      <div style={{ color: "var(--warn)", fontSize: 12 }}>You countered: {sgd(o.counterAmountSgd)}</div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {o.status === "open" && (
                        <>
                          <button className="sm" onClick={() => setActive(o)}>
                            Accept
                          </button>
                          <button className="ghost sm" onClick={() => setCounter(o)}>
                            Counter
                          </button>
                        </>
                      )}
                      {o.status === "countered" && <span className="muted">awaiting designer</span>}
                      <button className="ghost sm" onClick={() => chatWithDesigner(o)}>
                        💬 Chat with designer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section">
        <h2>My projects</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          After you accept an offer the renovation runs through a staged lifecycle — site survey, permit,
          procurement, build, inspection — before the keys are handed over. Track and advance each stage here.
        </p>
        {bookings.length === 0 ? (
          <div className="muted">No projects yet. Accept an offer above to start one.</div>
        ) : (
          bookings.map((b) => <BookingCard key={b.id} booking={b} role="customer" onChanged={load} />)
        )}
      </div>

      {active && (
        <AcceptModal
          offer={active}
          custId={current!.id}
          onClose={() => setActive(null)}
          onDone={() => {
            setActive(null);
            load();
          }}
        />
      )}
      {counter && (
        <CounterModal
          offer={counter}
          custId={current!.id}
          onClose={() => setCounter(null)}
          onDone={() => {
            setCounter(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function CounterModal({
  offer,
  custId,
  onClose,
  onDone,
}: {
  offer: PriceOffer;
  custId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(Math.round(offer.amountSgd * 0.9));
  const { busy, err, ok, setOk, run } = useAsync();
  return (
    <Modal title={`Counter offer — current ${sgd(offer.amountSgd)}`} onClose={onClose}>
      <p className="muted">
        Propose a different price to the designer. They can accept your counter or come back with a revised quote.
      </p>
      <Alert kind="err">{err}</Alert>
      <Alert kind="ok">{ok}</Alert>
      <label>Your counter amount (SGD)</label>
      <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      <div style={{ marginTop: 14 }}>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api.counterOffer(offer.id, custId, amount);
              setOk("Counter-offer sent. The designer will respond with a revised quote or accept it.");
              setTimeout(onDone, 700);
            })
          }
        >
          {busy ? "Sending…" : "Send counter-offer"}
        </button>
      </div>
    </Modal>
  );
}

function AcceptModal({
  offer,
  custId,
  onClose,
  onDone,
}: {
  offer: PriceOffer;
  custId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { current: sessionUser } = useSession();
  const [method, setMethod] = useState("PayNow");
  const [sim, setSim] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState(0); // which due-diligence step we are on
  const [docs, setDocs] = useState<Record<string, string>>({}); // required doc name -> image data URL
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.acceptOffer>> | null>(null);
  const { busy, err, setErr, run } = useAsync();
  const toggle = (k: string) => setSim((s) => ({ ...s, [k]: !s[k] }));
  const allDocsUploaded = REQUIRED_DOCUMENTS.every((d) => docs[d]);

  const draftCtx: DraftContext = {
    offerId: offer.id,
    idpId: offer.idpId,
    amountSgd: offer.amountSgd,
    customerName: sessionUser?.name ?? "",
    designerName: "Studio Lumen / your appointed firm",
  };

  const commission = offer.amountSgd * 0.05;
  const gst = commission * 0.09;
  const total = commission + gst;

  // The guided due-diligence steps mirror the ID05 sequence diagram, each
  // acknowledged by the customer before the final atomic acceptance runs.
  const steps = [
    {
      key: "identity",
      title: "1. Identity verification (Singpass / MyInfo)",
      body: "We verify your identity with Singpass before any contract is raised. Your NRIC is only ever stored in masked form (e.g. S****123A).",
      cta: "Verify with Singpass",
    },
    {
      key: "contract",
      title: "2. Renovation contract (e-signature, ETA)",
      body: `A renovation agreement for S$${offer.amountSgd.toLocaleString("en-SG")} is prepared and must be e-signed by both you and the designer under the Electronic Transactions Act before work can begin.`,
      cta: "Review & e-sign contract",
    },
    {
      key: "insurance",
      title: "3. Insurance validation",
      body: "The project is registered with a renovation insurer. Validating cover protects you against contractor default and on-site damage before any deposit is released.",
      cta: "Validate insurance cover",
    },
    {
      key: "permit",
      title: "4. HDB / BCA renovation permit",
      body: "Renovation cannot lawfully start without an approved HDB/BCA permit. We confirm the permit status before confirming your booking.",
      cta: "Confirm permit status",
    },
    {
      key: "documents",
      title: "5. Upload supporting documents",
      body: "Upload an image of each required document. The designer reviews them before your booking is confirmed.",
      cta: "Continue to payment",
    },
    {
      key: "payment",
      title: "6. Payment — deposit, commission & 9% GST",
      body: `Commission S$${commission.toFixed(2)} + 9% GST S$${gst.toFixed(2)} = S$${total.toFixed(2)}, charged via your chosen method. An IRAS tax invoice is then issued.`,
      cta: "Pay & confirm booking",
    },
  ];

  const current = steps[step];

  async function proceed() {
    // Gate the documents step until every required document is uploaded.
    if (current.key === "documents" && !allDocsUploaded) {
      setErr("Please upload an image for every required document before continuing.");
      return;
    }
    // On the final (payment) step, run the real atomic acceptOffer transaction,
    // passing the uploaded documents so the designer can review them.
    if (step === steps.length - 1) {
      run(async () => {
        const documents = REQUIRED_DOCUMENTS.map((name) => ({ name, url: docs[name], uploadedAt: new Date().toISOString() }));
        const r = await api.acceptOffer(offer.id, custId, method, sim, documents);
        setResult(r);
      });
    } else {
      setErr("");
      setStep((s) => s + 1);
    }
  }

  return (
    <Modal title={`Accept offer — ${sgd(offer.amountSgd)} (ID05)`} onClose={onClose}>
      {!result ? (
        <>
          {/* progress indicator */}
          <div className="chips" style={{ marginBottom: 12 }}>
            {steps.map((s, i) => (
              <span key={s.key} className={`tag ${i < step ? "ok" : i === step ? "" : ""}`} style={{ opacity: i === step ? 1 : i < step ? 0.9 : 0.4 }}>
                {i < step ? "✓ " : ""}
                {s.title.split(".")[0]}
              </span>
            ))}
          </div>

          <h3 style={{ margin: "0 0 6px" }}>{current.title}</h3>
          <p className="muted" style={{ marginBottom: 10 }}>{current.body}</p>
          <Alert kind="err">{err}</Alert>

          {/* per-step downloadable draft the customer fills in and later uploads */}
          {current.key === "contract" && (
            <div className="note" style={{ marginBottom: 10 }}>
              📄 Download the renovation contract draft, fill in your details, then upload it in the documents step.
              <div style={{ marginTop: 8 }}>
                <button className="ghost sm" onClick={() => openDraft(renovationContractDraft(draftCtx), "renovation-contract-draft.html")}>
                  Download contract draft
                </button>
              </div>
            </div>
          )}
          {current.key === "insurance" && (
            <div className="note" style={{ marginBottom: 10 }}>
              📄 Download the insurance proposal form, complete your cover details, then upload it before validating.
              <div style={{ marginTop: 8 }}>
                <button className="ghost sm" onClick={() => openDraft(insuranceDraft(draftCtx), "insurance-validation-draft.html")}>
                  Download insurance form
                </button>
              </div>
            </div>
          )}
          {current.key === "permit" && (
            <div className="note" style={{ marginBottom: 10 }}>
              📄 Download the HDB/BCA permit application draft, fill it in, then upload it in the documents step.
              <div style={{ marginTop: 8 }}>
                <button className="ghost sm" onClick={() => openDraft(permitDraft(draftCtx), "hdb-bca-permit-draft.html")}>
                  Download permit draft
                </button>
              </div>
            </div>
          )}

          {/* document upload step */}
          {current.key === "documents" && (
            <div>
              {REQUIRED_DOCUMENTS.map((name) => (
                <div key={name} style={{ marginBottom: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {docs[name] ? "✅" : "⬜"} {name}
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => setDocs((d) => ({ ...d, [name]: String(reader.result) }));
                        reader.readAsDataURL(file);
                      }}
                    />
                    {docs[name] && <img src={docs[name]} alt={name} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} />}
                  </div>
                </div>
              ))}
              <p className="hint">{Object.keys(docs).length}/{REQUIRED_DOCUMENTS.length} uploaded. All are required.</p>
            </div>
          )}

          {/* payment method chooser only on the payment step */}
          {current.key === "payment" && (
            <>
              <label>Payment method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option>PayNow</option>
                <option>NETS</option>
                <option>Card</option>
              </select>
            </>
          )}

          {/* per-step alternate-flow simulation toggle (for grading/demo) */}
          {current.key === "identity" && <SimChip label="Simulate Singpass failure" k="singpassFail" sim={sim} toggle={toggle} />}
          {current.key === "contract" && <SimChip label="Simulate contract left unsigned" k="unsigned" sim={sim} toggle={toggle} />}
          {current.key === "permit" && <SimChip label="Simulate permit not approved" k="hdbPermitFail" sim={sim} toggle={toggle} />}
          {current.key === "payment" && <SimChip label="Simulate payment declined" k="paymentDecline" sim={sim} toggle={toggle} />}

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            {step > 0 && (
              <button className="ghost" disabled={busy} onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            )}
            <button disabled={busy} onClick={proceed}>
              {busy ? "Processing…" : current.cta}
            </button>
          </div>
        </>
      ) : (
        <>
          <Alert kind="ok">
            Payment complete — tax invoice {result.payment.invoiceNo} issued. Your documents have been submitted and
            are now <strong>awaiting the designer's review</strong>. The project begins once they approve.
          </Alert>
          <div className="kpi" style={{ margin: "14px 0" }}>
            <div className="box"><div className="n">{sgd(result.payment.commissionSgd)}</div><div className="l">Platform commission</div></div>
            <div className="box"><div className="n">{sgd(result.payment.gstSgd)}</div><div className="l">GST (9%)</div></div>
            <div className="box"><div className="n">{sgd(result.payment.totalSgd)}</div><div className="l">Charged via {result.payment.method}</div></div>
          </div>
          <h3 style={{ marginBottom: 4 }}>Completion chain</h3>
          <ol className="steps">
            {result.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className="hint" style={{ marginTop: 10 }}>Your renovation project now begins its staged lifecycle below — track it under “My projects”.</p>
          <div style={{ marginTop: 16 }}>
            <button className="ok" onClick={onDone}>Done</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function SimChip({ label, k, sim, toggle }: { label: string; k: string; sim: Record<string, boolean>; toggle: (k: string) => void }) {
  return (
    <div className="chips" style={{ marginTop: 10 }}>
      <span className={`chip ${sim[k] ? "active" : ""}`} onClick={() => toggle(k)}>
        {sim[k] ? "☑ " : "☐ "}
        {label}
      </span>
    </div>
  );
}

export function BookingCard({ booking, role, onChanged }: { booking: Booking; role: "customer" | "designer"; onChanged: () => void }) {
  const { busy, err, run } = useAsync();
  const bookingNavigate = useNavigate();
  const stages: readonly string[] = PROJECT_STAGES;
  const currentIdx = booking.stage ? stages.indexOf(booking.stage) : 0;
  const done = booking.status === "completed";
  const historyByStage = new Map<string, { stage: string; at: string; note?: string }>(
    (booking.stageHistory ?? []).map((h) => [h.stage as string, h])
  );

  // The counterpart to show depends on who is viewing — the designer sees the
  // customer's name, the customer sees the firm.
  const otherParty = role === "designer" ? booking.customerName ?? "Customer" : booking.designerName ?? "Designer";
  const detailsLine = (
    <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
      {role === "designer" ? "Customer" : "Firm"}: <strong>{otherParty}</strong>
      {booking.idpTitle && <> · {booking.idpTitle}</>}
      {typeof booking.amountSgd === "number" && <> · {sgd(booking.amountSgd)}</>}
      {" · "}
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          const page = role === "designer" ? "/inbox" : "/inquiries";
          // When we know the exact conversation, pass it as a one-shot hash so
          // the destination page scrolls to and highlights that thread.
          bookingNavigate(booking.relatedInquiryId ? `${page}#flash=inquiry-${booking.relatedInquiryId}` : page);
        }}
      >
        {booking.relatedInquiryId ? "💬 open chat" : "💬 start chat"}
      </a>
    </div>
  );

  if (booking.status === "pending_review") {
    return (
      <div className="section" style={{ background: "var(--surface-2)", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <strong>🕒 Project {booking.id}</strong>
          <StatusTag status={booking.status} />
        </div>
        {detailsLine}
        <p className="muted">
          {role === "designer"
            ? "The customer has paid and uploaded documents — review them under “Bookings awaiting your document review”."
            : "Your documents have been submitted and are awaiting the designer's review. The project lifecycle begins once they approve."}
        </p>
        <div className="gallery">
          {(booking.documents ?? []).map((d, i) => (
            <div key={i} title={d.name} style={{ textAlign: "center" }}>
              {/^data:image|^https?:/.test(d.url) ? (
                <img className="ph" src={d.url} alt={d.name} />
              ) : (
                <div className="ph">📄</div>
              )}
              <div className="muted" style={{ fontSize: 10, maxWidth: 110 }}>{d.name}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="section" style={{ background: "var(--surface-2)", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <strong>{done ? "✅" : "🏗️"} Project {booking.id}</strong>
        <StatusTag status={booking.status} />
        <span className="muted" style={{ fontSize: 12 }}>
          {booking.insured ? "Insured ✓" : "Not insured"} · {booking.permitVerified ? "Permit ✓" : "Permit pending"}
        </span>
      </div>
      {detailsLine}

      {/* staged timeline */}
      <ol className="stage-track">
        {stages.map((s, i) => {
          const state = i < currentIdx ? "done" : i === currentIdx ? "current" : "todo";
          const h = historyByStage.get(s);
          return (
            <li key={s} className={`stage ${state}`}>
              <span className="dot" />
              <span className="label">
                {s}
                {h && <span className="when"> · {new Date(h.at).toLocaleDateString("en-SG")}</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <Alert kind="err">{err}</Alert>
      {!done ? (
        (() => {
          const pc = booking.pendingConfirm ?? { customer: false, designer: false };
          const mineConfirmed = pc[role];
          const other = role === "customer" ? "designer" : "customer";
          const nextStage = stages[currentIdx + 1];
          return (
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                Advancing to <strong>{nextStage}</strong> needs both parties to confirm:{" "}
                <span className={pc.customer ? "tag ok" : "tag"}>Customer {pc.customer ? "✓" : "…"}</span>{" "}
                <span className={pc.designer ? "tag ok" : "tag"}>Designer {pc.designer ? "✓" : "…"}</span>
              </div>
              <button
                className="sm"
                disabled={busy || mineConfirmed}
                onClick={() =>
                  run(async () => {
                    await api.confirmStage(booking.id, role);
                    onChanged();
                  })
                }
              >
                {mineConfirmed
                  ? `Waiting for the ${other} to confirm…`
                  : busy
                  ? "Confirming…"
                  : `Confirm "${nextStage}" as ${role}`}
              </button>
            </div>
          );
        })()
      ) : (
        <div className="tag ok">Project complete — keys handed over 🎉</div>
      )}
    </div>
  );
}
