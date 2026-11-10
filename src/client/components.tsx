import { useEffect, useState, type ReactNode } from "react";

export function IdTag({ id }: { id: string }) {
  return <span className="tag id">{id}</span>;
}

export function StatusTag({ status }: { status: string }) {
  const cls =
    status === "published" || status === "confirmed" || status === "delivered" || status === "replied" || status === "final"
      ? "ok"
      : status === "rejected" || status === "failed" || status === "declined" || status === "expired"
      ? "danger"
      : status === "draft" || status === "pending" || status === "in_moderation" || status === "new" || status === "open"
      ? "warn"
      : "";
  return <span className={`tag ${cls}`}>{status.replace(/_/g, " ")}</span>;
}

export function Alert({ kind, children }: { kind: "err" | "ok"; children: ReactNode }) {
  if (!children) return null;
  return <div className={`alert ${kind}`}>{children}</div>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button className="ghost sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="mbody">{children}</div>
      </div>
    </div>
  );
}

// Small hook to standardise async submit + error/ok messaging in forms.
export function useAsync() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    setOk("");
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, err, ok, setOk, setErr, run };
}

export function sgd(n: number): string {
  return "S$" + n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Scroll a target element into view and briefly highlight it, so a user who
// clicks a "jump to…" link can see exactly which row/thread they landed on —
// the same affordance browsers give native anchor links (:target).
export function flashTarget(id: string, opts: { focus?: boolean } = {}) {
  // Retry briefly in case the target is still rendering (e.g. right after a
  // cross-page navigation or a data reload).
  let tries = 0;
  const tick = () => {
    const el = document.getElementById(id);
    if (!el) {
      if (tries++ < 20) setTimeout(tick, 50);
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash-target");
    // force reflow so the animation restarts even on repeated clicks
    void el.offsetWidth;
    el.classList.add("flash-target");
    const clear = () => el.classList.remove("flash-target");
    el.addEventListener("animationend", clear, { once: true });
    setTimeout(clear, 2600);
    if (opts.focus) {
      const field = el.querySelector<HTMLElement>("input, textarea, button");
      field?.focus();
    }
  };
  tick();
}

// Read a one-shot navigation hash like "#flash=inquiry-abc123", flash that
// element, then strip the hash so a refresh doesn't re-trigger it.
export function useFlashFromHash(deps: unknown[] = []) {
  useEffect(() => {
    const m = window.location.hash.match(/^#flash=(.+)$/);
    if (!m) return;
    const id = decodeURIComponent(m[1]);
    flashTarget(id, { focus: true });
    history.replaceState(null, "", window.location.pathname + window.location.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
