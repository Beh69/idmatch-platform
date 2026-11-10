import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";
import { StatusTag, Alert, useAsync, useFlashFromHash } from "../components";
import type { Inquiry } from "../../shared/types";

// Customer view of ID01 inquiries: shows which portfolio each is about, the
// designer's reply, and lets the customer send a follow-up message back.
export function MyInquiries() {
  const { current } = useSession();
  const [items, setItems] = useState<Inquiry[]>([]);

  function load() {
    if (current) api.inquiries("customer", current.id).then(setItems);
  }
  useEffect(load, [current?.id]);

  // If we arrived from a project card's "💬 open chat" link, highlight the
  // specific conversation once the list has loaded.
  useFlashFromHash([items.length]);

  return (
    <div>
      <div className="page-head">
        <h1>My Inquiries</h1>
        <span className="tag id">ID01</span>
      </div>
      <div className="section">
        {items.length === 0 ? (
          <div className="empty">You haven't sent any inquiries yet. Open a portfolio and ask a question.</div>
        ) : (
          items.map((i) => <InquiryThread key={i.id} inq={i} custId={current!.id} onChanged={load} />)
        )}
      </div>
    </div>
  );
}

function InquiryThread({ inq, custId, onChanged }: { inq: Inquiry; custId: string; onChanged: () => void }) {
  const [text, setText] = useState("");
  const { busy, err, run } = useAsync();
  const threadRef = useRef<HTMLDivElement>(null);
  const msgCount = (inq.thread ?? []).length;

  // Auto-scroll the thread to the newest message (like a messaging app).
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgCount]);

  function send() {
    run(async () => {
      if (!text.trim()) return;
      await api.followUpInquiry(inq.id, custId, text);
      setText("");
      onChanged(); // refresh the thread immediately so your message appears
    });
  }

  return (
    <div className="list-item" id={`inquiry-${inq.id}`}>
      <div style={{ flex: 1 }}>
        {/* which portfolio this inquiry is about — click to open that listing */}
        <div style={{ marginBottom: 6 }}>
          Re:{" "}
          <Link to={`/idp/${inq.idpId}`}>
            <strong>{inq.idpTitle ?? "(portfolio)"}</strong>
          </Link>{" "}
          <StatusTag status={inq.status} />{" "}
          <span className="muted">· {new Date(inq.createdDate).toLocaleString("en-SG")}</span>
        </div>

        {/* full conversation thread (unlimited messages, auto-scrolls to newest) */}
        <div className="thread" ref={threadRef}>
          {(inq.thread ?? [{ from: "customer", text: inq.message, at: inq.createdDate }]).map((m, idx) => (
            <div key={idx} className={`bubble ${m.from === "customer" ? "you" : "designer"}`}>
              <span className="who">{m.from === "customer" ? "You" : inq.designerName ?? "Designer"}</span> {m.text}
            </div>
          ))}
        </div>

        {/* chat composer — always available; send as many messages as you like */}
        <div className="composer">
          <Alert kind="err">{err}</Alert>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim() && !busy) send();
            }}
          />
          <button className="sm" disabled={busy || !text.trim()} onClick={send}>
            {busy ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
