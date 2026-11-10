import { useEffect, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { StatusTag, Alert, useAsync } from "../components";
import type { Notification } from "../../shared/types";

// ID02 — notifications received when a designer replies, plus the channel /
// consent / DND preferences that drive the notification routing.
export function Notifications() {
  const { current } = useSession();
  const [items, setItems] = useState<Notification[]>([]);
  const [prefs, setPrefs] = useState({ primaryChannel: "push", fallbackChannel: "email", pdpaConsent: 1, dndWindow: "" as string | null });
  const { busy, ok, setOk, run } = useAsync();

  function load() {
    if (!current) return;
    api.notifications(current.id).then(setItems);
    api.channelPrefs(current.id).then((p) => setPrefs({ ...p, dndWindow: p.dndWindow ?? "" }));
  }
  useEffect(load, [current?.id]);

  return (
    <div>
      <div className="page-head">
        <h1>Notifications</h1>
        <span className="tag id">ID02</span>
      </div>

      <div className="section">
        <h2>Delivery preferences &amp; consent</h2>
        <Alert kind="ok">{ok}</Alert>
        <div className="row">
          <div>
            <label>Primary channel</label>
            <select value={prefs.primaryChannel} onChange={(e) => setPrefs({ ...prefs, primaryChannel: e.target.value })}>
              <option value="push">Push</option>
              <option value="email">Email</option>
              <option value="sms">SMS (+65)</option>
            </select>
          </div>
          <div>
            <label>Fallback channel</label>
            <select value={prefs.fallbackChannel} onChange={(e) => setPrefs({ ...prefs, fallbackChannel: e.target.value })}>
              <option value="email">Email</option>
              <option value="sms">SMS (+65)</option>
              <option value="push">Push</option>
            </select>
          </div>
          <div>
            <label>DND window (e.g. 22-08)</label>
            <input value={prefs.dndWindow ?? ""} placeholder="none" onChange={(e) => setPrefs({ ...prefs, dndWindow: e.target.value })} />
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={!!prefs.pdpaConsent}
            onChange={(e) => setPrefs({ ...prefs, pdpaConsent: e.target.checked ? 1 : 0 })}
          />
          I consent to receiving notifications via external channels (PDPA)
        </label>
        <div style={{ marginTop: 14 }}>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.updateChannelPrefs(current!.id, {
                  primaryChannel: prefs.primaryChannel,
                  fallbackChannel: prefs.fallbackChannel,
                  pdpaConsent: !!prefs.pdpaConsent,
                  dndWindow: prefs.dndWindow || null,
                });
                setOk("Preferences saved.");
              })
            }
          >
            Save preferences
          </button>
        </div>
        <p className="hint">
          When a designer replies, the system checks your consent and DND window, delivers via your primary channel, and
          falls back automatically if that channel fails.
        </p>
      </div>

      <div className="section">
        <h2>Inbox</h2>
        {items.length > 0 && (
          <p className="hint" style={{ marginTop: 0 }}>
            Delivery log — {items.filter((n) => n.status === "delivered").length} delivered,{" "}
            {items.filter((n) => n.status === "failed").length} failed. Each entry shows the channel it was
            sent through and whether delivery succeeded, so you can confirm notifications are working.
          </p>
        )}
        {items.length === 0 ? (
          <div className="empty">No notifications yet. When a designer replies to an inquiry, it appears here.</div>
        ) : (
          items.map((n) => (
            <div key={n.id} className="list-item">
              <div style={{ fontSize: 22 }}>{n.channel === "sms" ? "📱" : n.channel === "email" ? "✉️" : n.channel === "push" ? "🔔" : "📨"}</div>
              <div style={{ flex: 1 }}>
                <div>{n.content}</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  via {n.channel} · <StatusTag status={n.status} /> · {new Date(n.createdDate).toLocaleString("en-SG")}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
