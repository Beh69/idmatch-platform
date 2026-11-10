import { nanoid } from "nanoid";
import { db } from "../db.js";

export function id(prefix: string): string {
  return `${prefix}_${nanoid(10)}`;
}

export function now(): string {
  return new Date().toISOString();
}

// PDPA: mask phone numbers, emails and NRIC-like strings that customers paste
// into free-text so personal contact details are not exchanged off-platform.
export function maskContactDetails(text: string): string {
  return text
    .replace(/(\+?65[\s-]?)?\d{4}[\s-]?\d{4}/g, "[contact removed]") // SG phone
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]") // email
    .replace(/[STFG]\d{7}[A-Z]/gi, "[NRIC removed]"); // NRIC/FIN
}

// Very small content screen: reject empty / abusive messages.
const BLOCKED = ["scam", "spam", "http://", "https://"];
export function screenContent(text: string): boolean {
  const lower = text.toLowerCase();
  return !BLOCKED.some((w) => lower.includes(w));
}

// Audit log — the «entity» AuditLog in ID01 and ActivityLog in ID03.
export function audit(action: string, actorId: string | null, entityId: string | null, amountSgd = 0): void {
  db.prepare(
    `INSERT INTO audit_log (id, action, actorId, entityId, amountSgd, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id("log"), action, actorId, entityId, amountSgd, now());
}
