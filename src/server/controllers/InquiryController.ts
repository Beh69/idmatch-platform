// «control» InquiryController  —  implements ID01 "Submit an inquiry about an IDP".
// Mirrors the ID01 sequence diagram: checkSpamLimit -> validateMessage ->
// screenContent -> maskContactDetails -> create Inquiry -> AuditLog.record ->
// notifyDesigner. Alternate flows: spam limit, empty message, flagged content,
// IDP unavailable.
import { db } from "../db.js";
import { id, now, maskContactDetails, screenContent, audit } from "../services/helpers.js";
import { NotificationController } from "./NotificationController.js";
import type { Inquiry, IDP, ThreadMessage } from "../../shared/types.js";

const SPAM_LIMIT = 5; // max inquiries per customer per hour

export class InquiryController {
  // Business rule from ID01 alt-flow 4a.
  static checkSpamLimit(custId: string): boolean {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM inquiry_rate WHERE customerId = ? AND ts > ?`)
      .get(custId, oneHourAgo) as { c: number };
    return row.c < SPAM_LIMIT;
  }

  static validateMessage(txt: string): boolean {
    return txt.trim().length > 0 && txt.trim().length <= 2000;
  }

  static submitInquiry(custId: string, idpId: string, txt: string): Inquiry {
    // Alt 8a — IDP must exist and be published.
    const idp = db.prepare(`SELECT * FROM idps WHERE id = ?`).get(idpId) as IDP | undefined;
    if (!idp || idp.status !== "published") {
      throw httpError(404, "IDP_UNAVAILABLE", "This portfolio is no longer available.");
    }
    // Alt 4a — spam limit.
    if (!this.checkSpamLimit(custId)) {
      throw httpError(429, "SPAM_LIMIT", "You have sent too many inquiries. Please try again later.");
    }
    // Alt 5a — empty / too long.
    if (!this.validateMessage(txt)) {
      throw httpError(400, "EMPTY_MESSAGE", "Please enter a message (up to 2000 characters).");
    }
    // Alt 6a — flagged content.
    if (!screenContent(txt)) {
      throw httpError(422, "FLAGGED_CONTENT", "Your message was flagged by our content filter.");
    }

    const masked = maskContactDetails(txt); // PDPA
    const createdAt = now();
    const thread: ThreadMessage[] = [{ from: "customer", text: masked, at: createdAt }];
    const inquiry = {
      id: id("inq"),
      idpId,
      customerId: custId,
      designerId: idp.designerId,
      message: masked,
      status: "new",
      thread: JSON.stringify(thread),
      createdDate: createdAt,
    };
    db.prepare(
      `INSERT INTO inquiries (id, idpId, customerId, designerId, message, status, thread, createdDate)
       VALUES (@id, @idpId, @customerId, @designerId, @message, @status, @thread, @createdDate)`
    ).run(inquiry);
    db.prepare(`INSERT INTO inquiry_rate (customerId, ts) VALUES (?, ?)`).run(custId, now());

    audit("INQUIRY_SUBMITTED", custId, inquiry.id); // AuditLog.record (PDPA)
    this.notifyDesigner(inquiry.id); // async notification to the designer
    return this.getById(inquiry.id);
  }

  static notifyDesigner(inquiryId: string): void {
    const inq = db.prepare(`SELECT * FROM inquiries WHERE id = ?`).get(inquiryId) as { designerId: string };
    audit("DESIGNER_NOTIFIED", null, inq.designerId);
  }

  // Append a message to the conversation thread from either side. Supports
  // unlimited back-and-forth. A designer message triggers the ID02 notification.
  static async postMessage(inquiryId: string, fromRole: "customer" | "designer", text: string): Promise<Inquiry> {
    const inq = db.prepare(`SELECT * FROM inquiries WHERE id = ?`).get(inquiryId) as
      | { thread: string | null; designerId: string }
      | undefined;
    if (!inq) throw httpError(404, "NOT_FOUND", "Inquiry not found.");
    if (!text.trim()) throw httpError(400, "EMPTY_MESSAGE", "Message cannot be empty.");

    const thread: ThreadMessage[] = inq.thread ? JSON.parse(inq.thread) : [];
    thread.push({ from: fromRole, text: maskContactDetails(text), at: now() });
    // status: 'replied' when the designer has answered last, else 'new' (needs designer).
    const status = fromRole === "designer" ? "replied" : "new";
    db.prepare(`UPDATE inquiries SET thread = ?, status = ? WHERE id = ?`).run(JSON.stringify(thread), status, inquiryId);

    if (fromRole === "designer") {
      audit("INQUIRY_REPLIED", inq.designerId, inquiryId);
      await NotificationController.onReplyPosted(inquiryId); // ID02 notify customer
    } else {
      audit("INQUIRY_FOLLOW_UP", null, inquiryId);
      this.notifyDesigner(inquiryId);
    }
    return this.getById(inquiryId);
  }

  // Back-compat wrappers (used by existing routes/tests).
  static reply(inquiryId: string, replyText: string): Promise<Inquiry> {
    return this.postMessage(inquiryId, "designer", replyText);
  }
  static followUp(inquiryId: string, custId: string, text: string): Promise<Inquiry> {
    const inq = db.prepare(`SELECT customerId FROM inquiries WHERE id = ?`).get(inquiryId) as
      | { customerId: string }
      | undefined;
    if (!inq) throw httpError(404, "NOT_FOUND", "Inquiry not found.");
    if (inq.customerId !== custId) throw httpError(403, "FORBIDDEN", "This inquiry is not yours.");
    return this.postMessage(inquiryId, "customer", text);
  }

  private static hydrate(row: Record<string, unknown>): Inquiry {
    return { ...(row as unknown as Inquiry), thread: row.thread ? JSON.parse(row.thread as string) : [] };
  }

  // Shared SELECT that enriches an inquiry with the portfolio title, both
  // parties' names, and the id of a price request between the same pair (if any)
  // so the UI can label the chat and link to the related request.
  private static readonly ENRICHED =
    `SELECT i.*, idp.title AS idpTitle, cu.name AS customerName, du.name AS designerName,
        (SELECT r.id FROM price_requests r WHERE r.customerId = i.customerId AND r.designerId = i.designerId
         ORDER BY r.createdDate DESC LIMIT 1) AS relatedRequestId
     FROM inquiries i
     LEFT JOIN idps idp ON idp.id = i.idpId
     LEFT JOIN users cu ON cu.id = i.customerId
     LEFT JOIN users du ON du.id = i.designerId`;

  static getById(inquiryId: string): Inquiry {
    const row = db.prepare(`${this.ENRICHED} WHERE i.id = ?`).get(inquiryId) as Record<string, unknown>;
    return this.hydrate(row);
  }

  // Find an existing conversation between this designer and customer (about a
  // given IDP), or start a new one. Used by the designer's "Chat with customer"
  // button so they can message the person who sent a price request.
  static getOrCreateThread(designerId: string, custId: string, idpId: string): Inquiry {
    const existing = db
      .prepare(
        `SELECT id FROM inquiries WHERE designerId = ? AND customerId = ? AND idpId = ? ORDER BY createdDate DESC LIMIT 1`
      )
      .get(designerId, custId, idpId) as { id: string } | undefined;
    if (existing) return this.getById(existing.id);

    const createdAt = now();
    const opener = "Conversation opened from a price request.";
    const thread: ThreadMessage[] = [{ from: "designer", text: opener, at: createdAt }];
    const inquiry = {
      id: id("inq"),
      idpId,
      customerId: custId,
      designerId,
      message: opener,
      status: "replied",
      thread: JSON.stringify(thread),
      createdDate: createdAt,
    };
    db.prepare(
      `INSERT INTO inquiries (id, idpId, customerId, designerId, message, status, thread, createdDate)
       VALUES (@id,@idpId,@customerId,@designerId,@message,@status,@thread,@createdDate)`
    ).run(inquiry);
    audit("INQUIRY_OPENED_BY_DESIGNER", designerId, inquiry.id);
    return this.getById(inquiry.id);
  }

  static listForDesigner(designerId: string): Inquiry[] {
    return (
      db.prepare(`${this.ENRICHED} WHERE i.designerId = ? ORDER BY i.createdDate DESC`).all(designerId) as Record<
        string,
        unknown
      >[]
    ).map((r) => this.hydrate(r));
  }

  static listForCustomer(custId: string): Inquiry[] {
    return (
      db.prepare(`${this.ENRICHED} WHERE i.customerId = ? ORDER BY i.createdDate DESC`).all(custId) as Record<
        string,
        unknown
      >[]
    ).map((r) => this.hydrate(r));
  }
}

export function httpError(status: number, code: string, message: string): Error & { status: number; code: string } {
  const e = new Error(message) as Error & { status: number; code: string };
  e.status = status;
  e.code = code;
  return e;
}
