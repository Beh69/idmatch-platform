import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";
import { Alert, StatusTag, useAsync, sgd, flashTarget, useFlashFromHash } from "../components";
import { BookingCard } from "./MyOffers";
import type { Inquiry, PriceRequest, PriceOffer, Booking } from "../../shared/types";

// Designer side of ID01 (reply -> triggers ID02 notification) and ID04
// (respond to a price request with a concrete offer that feeds ID05).
export function DesignerInbox() {
  const { current } = useSession();
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [requests, setRequests] = useState<PriceRequest[]>([]);
  const [offers, setOffers] = useState<PriceOffer[]>([]);
  const [pending, setPending] = useState<Booking[]>([]);
  const [projects, setProjects] = useState<Booking[]>([]);

  function load() {
    if (!current) return;
    api.inquiries("designer", current.id).then(setInquiries);
    api.priceRequests("designer", current.id).then(setRequests);
    api.designerOffers(current.id).then(setOffers);
    api.pendingBookings(current.id).then(setPending);
    api.designerBookings(current.id).then(setProjects);
  }
  useEffect(load, [current?.id]);

  // If we arrived here from a "💬 open chat" link, flash the specific thread
  // once the inquiries have loaded.
  useFlashFromHash([inquiries.length]);

  const counters = offers.filter((o) => o.status === "countered");

  return (
    <div>
      <div className="page-head">
        <h1>Inbox &amp; Quotes</h1>
        <span className="tag id">ID01</span>
        <span className="tag id">ID04</span>
      </div>

      <div className="section" id="designer-inquiries">
        <h2>Customer inquiries</h2>
        {inquiries.length === 0 ? (
          <div className="empty">No inquiries yet.</div>
        ) : (
          inquiries.map((i) => <InquiryRow key={i.id} inq={i} onReplied={load} />)
        )}
      </div>

      {pending.length > 0 && (
        <div className="section">
          <h2>Bookings awaiting your document review</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            The customer has paid and uploaded their documents. Review each one and approve to start the project.
          </p>
          {pending.map((b) => (
            <ReviewRow key={b.id} booking={b} designerId={current!.id} onApproved={load} />
          ))}
        </div>
      )}

      {projects.length > 0 && (
        <div className="section">
          <h2>My projects (co-sign each stage)</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            Each lifecycle stage only advances once both you and the customer confirm it.
          </p>
          {projects.map((b) => (
            <BookingCard key={b.id} booking={b} role="designer" onChanged={load} />
          ))}
        </div>
      )}

      {counters.length > 0 && (
        <div className="section">
          <h2>Counter-offers awaiting your response</h2>
          {counters.map((o) => (
            <CounterRow key={o.id} offer={o} designerId={current!.id} onResponded={load} />
          ))}
        </div>
      )}

      <div className="section" id="designer-requests">
        <h2>Price requests</h2>
        {requests.length === 0 ? (
          <div className="empty">No price requests yet.</div>
        ) : (
          requests.map((r) => (
            <RequestRow
              key={r.id}
              req={r}
              designerId={current!.id}
              onQuoted={load}
              onChat={async (pr) => {
                const thread = await api.openThread(current!.id, pr.customerId, pr.idpId);
                await load();
                // Jump straight to (and highlight) the exact conversation.
                flashTarget(`inquiry-${thread.id}`, { focus: true });
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ReviewRow({ booking, designerId, onApproved }: { booking: Booking; designerId: string; onApproved: () => void }) {
  const { busy, err, run } = useAsync();
  return (
    <div className="list-item">
      <div style={{ flex: 1 }}>
        <div style={{ marginBottom: 6 }}>
          <strong>Booking {booking.id}</strong>{" "}
          <span className="muted">· {(booking.documents ?? []).length} document(s) uploaded</span>
        </div>
        <div className="gallery" style={{ marginBottom: 8 }}>
          {(booking.documents ?? []).map((d, i) => (
            <div key={i} style={{ textAlign: "center" }} title={d.name}>
              {/^data:image|^https?:/.test(d.url) ? (
                <img className="ph" src={d.url} alt={d.name} />
              ) : (
                <div className="ph">📄</div>
              )}
              <div className="muted" style={{ fontSize: 10, maxWidth: 110 }}>
                {d.name}
              </div>
            </div>
          ))}
        </div>
        <Alert kind="err">{err}</Alert>
        <button
          className="ok sm"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api.approveBooking(booking.id, designerId);
              onApproved();
            })
          }
        >
          {busy ? "Approving…" : "Approve documents & start project"}
        </button>
      </div>
    </div>
  );
}

function CounterRow({ offer, designerId, onResponded }: { offer: PriceOffer; designerId: string; onResponded: () => void }) {
  const [revised, setRevised] = useState(offer.counterAmountSgd ?? offer.amountSgd);
  const { busy, err, ok, setOk, run } = useAsync();
  return (
    <div className="list-item">
      <div style={{ flex: 1 }}>
        <div style={{ marginBottom: 6 }}>
          You quoted <strong>{sgd(offer.amountSgd)}</strong> · customer countered{" "}
          <strong style={{ color: "var(--warn)" }}>{sgd(offer.counterAmountSgd ?? 0)}</strong>
        </div>
        <Alert kind="err">{err}</Alert>
        <Alert kind="ok">{ok}</Alert>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ maxWidth: 220 }}>
            <label>Revised quote (SGD)</label>
            <input type="number" value={revised} onChange={(e) => setRevised(Number(e.target.value))} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="ok sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.respondToCounter(offer.id, designerId, true);
                  setOk("Counter accepted — offer re-opened at the customer's price.");
                  onResponded();
                })
              }
            >
              Accept counter ({sgd(offer.counterAmountSgd ?? 0)})
            </button>
            <button
              className="sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.respondToCounter(offer.id, designerId, false, revised);
                  setOk("Revised quote sent to the customer.");
                  onResponded();
                })
              }
            >
              Send revised quote
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InquiryRow({ inq, onReplied }: { inq: Inquiry; onReplied: () => void }) {
  const [reply, setReply] = useState("");
  const { busy, err, run } = useAsync();
  const waiting = inq.status === "new"; // customer is awaiting a designer response

  const threadRef = useRef<HTMLDivElement>(null);
  const msgCount = (inq.thread ?? []).length;
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgCount]);

  function send() {
    run(async () => {
      if (!reply.trim()) return;
      await api.replyInquiry(inq.id, reply);
      setReply("");
      onReplied();
    });
  }
  return (
    <div className="list-item" id={`inquiry-${inq.id}`}>
      <div style={{ flex: 1 }}>
        <div style={{ marginBottom: 2 }}>
          <strong>👤 {inq.customerName ?? "Customer"}</strong> <StatusTag status={inq.status} />{" "}
          <span className="muted">· {new Date(inq.createdDate).toLocaleString("en-SG")}</span>
        </div>
        <div className="muted" style={{ marginBottom: 6, fontSize: 13 }}>
          Re:{" "}
          <Link to={`/idp/${inq.idpId}`}>{inq.idpTitle ?? "(portfolio)"}</Link>
          {inq.relatedRequestId && (
            <>
              {" · "}
              <a
                href={`#request-${inq.relatedRequestId}`}
                onClick={(e) => {
                  e.preventDefault();
                  flashTarget(`request-${inq.relatedRequestId}`);
                }}
              >
                view their price request →
              </a>
            </>
          )}
        </div>
        <div className="thread" ref={threadRef}>
          {(inq.thread ?? [{ from: "customer", text: inq.message, at: inq.createdDate }]).map((m, idx) => (
            <div key={idx} className={`bubble ${m.from === "customer" ? "you" : "designer"}`}>
              <span className="who">{m.from === "customer" ? inq.customerName ?? "Customer" : "You (" + (inq.designerName ?? "designer") + ")"}</span> {m.text}
            </div>
          ))}
        </div>
        <div className="composer">
          <Alert kind="err">{err}</Alert>
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={waiting ? "Reply to the customer…" : "Send another message…"}
            onKeyDown={(e) => {
              if (e.key === "Enter" && reply.trim() && !busy) send();
            }}
          />
          <button className="sm" disabled={busy || !reply.trim()} onClick={send}>
            {busy ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RequestRow({ req, designerId, onQuoted, onChat }: { req: PriceRequest; designerId: string; onQuoted: () => void; onChat: (r: PriceRequest) => void }) {
  const [amount, setAmount] = useState(50000);
  const { busy, err, ok, setOk, run } = useAsync();
  return (
    <div className="list-item" id={`request-${req.id}`}>
      <div style={{ flex: 1 }}>
        <div style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong>👤 {req.customerName ?? "Customer"}</strong>
          <StatusTag status={req.status} />
          <span className="muted">· SLA by {new Date(req.slaDeadline).toLocaleString("en-SG")}</span>
          <button className="ghost sm" onClick={() => onChat(req)}>
            💬 Chat with customer
          </button>
        </div>
        <div>
          <strong>Scope:</strong> {req.scope}
        </div>
        <div className="muted">
          {req.propertyType} · {req.unitSizeSqft} sqft · budget {req.budgetRangeSgd}
        </div>
        {req.status === "pending" ? (
          <div style={{ marginTop: 8 }}>
            <Alert kind="err">{err}</Alert>
            <Alert kind="ok">{ok}</Alert>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div style={{ maxWidth: 220 }}>
                <label>Quote amount (SGD)</label>
                <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
              </div>
              <div style={{ flex: 0 }}>
                <button
                  className="sm"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api.makeOffer(req.id, designerId, amount);
                      setOk("Offer sent to the customer.");
                      onQuoted();
                    })
                  }
                >
                  {busy ? "Sending…" : "Send offer"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="muted" style={{ marginTop: 6 }}>
            Quote sent — now visible under the customer's My Offers.
          </div>
        )}
      </div>
    </div>
  );
}
