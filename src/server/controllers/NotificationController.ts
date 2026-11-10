// «control» NotificationController — implements ID02 "Receive a notification
// when a designer replies". Mirrors the ID02 sequence: onReplyPosted ->
// getConsentPrefs -> checkDndWindow -> compose Notification -> send via
// SmsEmailPushProvider, with a fallback channel when the primary fails.
import { db } from "../db.js";
import { id, now, audit } from "../services/helpers.js";
import { messagingProvider } from "../services/externalServices.js";
import type { Inquiry, Notification } from "../../shared/types.js";

interface ChannelPref {
  customerId: string;
  primaryChannel: string;
  fallbackChannel: string;
  pdpaConsent: number;
  dndWindow: string | null;
}

export class NotificationController {
  static getConsentPrefs(custId: string): ChannelPref {
    let pref = db.prepare(`SELECT * FROM channel_prefs WHERE customerId = ?`).get(custId) as
      | ChannelPref
      | undefined;
    if (!pref) {
      // Sensible default: push primary, email fallback, consent granted.
      pref = { customerId: custId, primaryChannel: "push", fallbackChannel: "email", pdpaConsent: 1, dndWindow: null };
      db.prepare(
        `INSERT INTO channel_prefs (customerId, primaryChannel, fallbackChannel, pdpaConsent, dndWindow)
         VALUES (@customerId, @primaryChannel, @fallbackChannel, @pdpaConsent, @dndWindow)`
      ).run(pref);
    }
    return pref;
  }

  // DND quiet-hours window "HH-HH" (e.g. "22-08"). Returns true if NOW is inside it.
  static checkDndWindow(custId: string): boolean {
    const pref = this.getConsentPrefs(custId);
    if (!pref.dndWindow) return false;
    const [start, end] = pref.dndWindow.split("-").map(Number);
    const h = new Date().getHours();
    return start <= end ? h >= start && h < end : h >= start || h < end;
  }

  // ReplyPosted event handler — the entry point triggered by InquiryController.reply.
  static async onReplyPosted(inquiryId: string): Promise<Notification | null> {
    const inq = db.prepare(`SELECT * FROM inquiries WHERE id = ?`).get(inquiryId) as Inquiry;
    const pref = this.getConsentPrefs(inq.customerId);

    // Alt 3a — no PDPA consent: suppress external delivery, keep an in-app record only.
    if (!pref.pdpaConsent) {
      return this.record(inq.customerId, "in_app", "A designer replied to your inquiry.", "delivered");
    }
    // Alt 4a — DND window: defer to in-app only until quiet hours end.
    if (this.checkDndWindow(inq.customerId)) {
      return this.record(inq.customerId, "in_app", "A designer replied (delivered quietly during DND).", "delivered");
    }

    const content = "A designer has replied to your inquiry. Open the app to view the reply.";

    // Try the primary channel; fall back on failure (alt 6a / 7a).
    const okPrimary = await messagingProvider.deliver(pref.primaryChannel, content);
    if (okPrimary) {
      return this.record(inq.customerId, pref.primaryChannel, content, "delivered");
    }
    const okFallback = await messagingProvider.deliver(pref.fallbackChannel, content);
    return this.record(inq.customerId, pref.fallbackChannel, content, okFallback ? "delivered" : "failed");
  }

  static record(custId: string, channel: string, content: string, status: Notification["status"]): Notification {
    const n: Notification = {
      id: id("ntf"),
      customerId: custId,
      channel,
      content,
      status,
      createdDate: now(),
    };
    db.prepare(
      `INSERT INTO notifications (id, customerId, channel, content, status, createdDate)
       VALUES (@id, @customerId, @channel, @content, @status, @createdDate)`
    ).run(n);
    if (status === "delivered") this.markDelivered(n.id); // ID02: markDelivered()
    else audit("NOTIFICATION_" + status.toUpperCase(), custId, n.id);
    return n;
  }

  // «entity» Notification.markDelivered() — the ID02 sequence message.
  static markDelivered(notificationId: string): void {
    db.prepare(`UPDATE notifications SET status = 'delivered' WHERE id = ?`).run(notificationId);
    audit("NOTIFICATION_DELIVERED", null, notificationId);
  }

  static listForCustomer(custId: string): Notification[] {
    return db
      .prepare(`SELECT * FROM notifications WHERE customerId = ? ORDER BY createdDate DESC`)
      .all(custId) as Notification[];
  }
}
