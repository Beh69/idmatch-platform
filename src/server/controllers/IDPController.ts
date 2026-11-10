// «control» IDPController — implements ID07 "Create an IDP", ID06 "Preview an
// IDP before publishing", and ID08 "View an IDP's details".
//
// ID07 sequence: validateInput -> verifyUenCaseTrust -> create IDP ->
//   addPhoto[loop] (virusScan + consent) -> assignCategory -> saveDraft ->
//   submitForModeration.
// ID06 sequence: loadIDP -> loadPhotos[loop] -> CompanyProfile.isVerified ->
//   checkCompleteness + checkPdpaCompliance -> buildPreview / enablePublish.
// ID08 sequence: loadIDP -> loadPhotos[loop] -> loadReviews -> dedupeView ->
//   incrementViews -> displayDetails.
import { db } from "../db.js";
import { id, now, audit } from "../services/helpers.js";
import { httpError } from "./InquiryController.js";
import type { IDP, Photo, Review, Category, CompanyProfile } from "../../shared/types.js";

interface CompletenessResult {
  complete: boolean;
  pdpaOk: boolean;
  verified: boolean;
  issues: string[];
  canPublish: boolean;
}

export class IDPController {
  // ----- ID07 Create -----
  static validateInput(data: Partial<IDP>): boolean {
    return Boolean(
      data.title?.trim() &&
        data.description?.trim() &&
        data.propertyType?.trim() &&
        data.budgetRangeSgd?.trim()
    );
  }

  static verifyUenCaseTrust(designerId: string): boolean {
    const p = db.prepare(`SELECT * FROM company_profiles WHERE designerId = ?`).get(designerId) as
      | CompanyProfile
      | undefined;
    // A valid Singapore UEN plus CaseTrust accreditation is required to list.
    return Boolean(p && /^[0-9]{8,9}[A-Z]$/.test(p.uen) && p.caseTrust);
  }

  static createIDP(designerId: string, data: Partial<IDP>): IDP {
    if (!this.validateInput(data)) {
      throw httpError(400, "INVALID_INPUT", "Title, description, property type and budget are required.");
    }
    if (!this.verifyUenCaseTrust(designerId)) {
      throw httpError(403, "UEN_UNVERIFIED", "Your UEN / CaseTrust accreditation could not be verified.");
    }
    const idp: IDP = {
      id: id("idp"),
      designerId,
      title: data.title!.trim(),
      description: data.description!.trim(),
      propertyType: data.propertyType!.trim(),
      budgetRangeSgd: data.budgetRangeSgd!.trim(),
      categoryId: data.categoryId ?? null,
      status: "draft",
      viewCount: 0,
      shortlistCount: 0,
      services: data.services?.trim() || null,
      createdDate: now(),
    };
    db.prepare(
      `INSERT INTO idps (id, designerId, title, description, propertyType, budgetRangeSgd, categoryId, status, viewCount, shortlistCount, services, createdDate)
       VALUES (@id,@designerId,@title,@description,@propertyType,@budgetRangeSgd,@categoryId,@status,0,0,@services,@createdDate)`
    ).run(idp);
    audit("IDP_CREATED", designerId, idp.id);
    return idp;
  }

  // Edit an existing (unpublished) IDP's core fields — lets a designer fix a
  // draft that failed its pre-publish checks (e.g. a too-short description).
  static updateIDP(idpId: string, data: Partial<IDP>): IDP {
    const idp = this.loadIDP(idpId);
    if (idp.status === "published") {
      throw httpError(409, "ALREADY_PUBLISHED", "A published portfolio cannot be edited; unpublish it first.");
    }
    const next = {
      title: data.title?.trim() || idp.title,
      description: data.description?.trim() || idp.description,
      propertyType: data.propertyType?.trim() || idp.propertyType,
      budgetRangeSgd: data.budgetRangeSgd?.trim() || idp.budgetRangeSgd,
      categoryId: data.categoryId ?? idp.categoryId,
      services: data.services !== undefined ? data.services?.trim() || null : idp.services ?? null,
      id: idpId,
    };
    db.prepare(
      `UPDATE idps SET title=@title, description=@description, propertyType=@propertyType,
         budgetRangeSgd=@budgetRangeSgd, categoryId=@categoryId, services=@services WHERE id=@id`
    ).run(next);
    audit("IDP_UPDATED", idp.designerId, idpId);
    return this.loadIDP(idpId);
  }

  static addPhoto(idpId: string, url: string, format: string, consentConfirmed: boolean): Photo {
    // Alt 4a — virus scan; Alt 5a — consent.
    if (!this.virusScan(url)) throw httpError(422, "VIRUS_DETECTED", "The uploaded file failed the virus scan.");
    if (!consentConfirmed) throw httpError(422, "NO_CONSENT", "Photo consent must be confirmed (PDPA).");
    if (!/^(jpg|jpeg|png|webp)$/i.test(format)) throw httpError(400, "BAD_FORMAT", "Only JPG, PNG or WEBP allowed.");

    const order = (db.prepare(`SELECT COUNT(*) AS c FROM photos WHERE idpId = ?`).get(idpId) as { c: number }).c;
    const photo: Photo = { id: id("pho"), idpId, url, order, format, consentConfirmed };
    this.store(photo); // «entity» Photo.store()
    return photo;
  }

  // «entity» Photo.store() — persist an uploaded photo (ID07 message).
  static store(photo: Photo): void {
    db.prepare(
      `INSERT INTO photos (id, idpId, url, "order", format, consentConfirmed)
       VALUES (@id,@idpId,@url,@order,@format,@consentConfirmed)`
    ).run({ ...photo, consentConfirmed: photo.consentConfirmed ? 1 : 0 });
  }

  // «entity» IDP.saveDraft() — persist category/draft state (ID07 message).
  static saveDraft(idpId: string, categoryId?: string): void {
    if (categoryId) db.prepare(`UPDATE idps SET categoryId = ? WHERE id = ?`).run(categoryId, idpId);
    db.prepare(`UPDATE idps SET status = 'draft' WHERE id = ? AND status NOT IN ('published','in_moderation')`).run(idpId);
  }

  static virusScan(url: string): boolean {
    return !url.toLowerCase().includes("eicar"); // test marker only
  }

  static assignCategory(idpId: string, categoryId: string): void {
    this.saveDraft(idpId, categoryId); // assignCategory -> saveDraft (ID07)
  }

  // ----- ID06 Preview -----
  // «entity» CompanyProfile.isVerified() — mirrors the ID06 sequence message.
  static isVerified(designerId: string): boolean {
    return this.verifyUenCaseTrust(designerId);
  }

  // checkPdpaCompliance() — every photo must carry confirmed consent (ID06 message).
  static checkPdpaCompliance(idpId: string): boolean {
    const photos = this.loadPhotos(idpId);
    return photos.every((p) => p.consentConfirmed);
  }

  static checkCompleteness(idpId: string): CompletenessResult {
    const idp = db.prepare(`SELECT * FROM idps WHERE id = ?`).get(idpId) as IDP | undefined;
    if (!idp) throw httpError(404, "NOT_FOUND", "Draft not found.");
    const photos = this.loadPhotos(idpId);
    const issues: string[] = [];

    if (!idp.title?.trim()) issues.push("Title is missing.");
    if (!idp.description || idp.description.trim().length < 30) issues.push("Description must be at least 30 characters.");
    if (!idp.categoryId) issues.push("A category must be assigned.");
    if (photos.length < 1) issues.push("At least one photo is required.");

    const verified = this.isVerified(idp.designerId);
    if (!verified) issues.push("Company UEN / CaseTrust is not verified.");

    // PDPA: every photo must carry confirmed consent.
    const pdpaOk = this.checkPdpaCompliance(idpId);
    if (!pdpaOk) issues.push("Every photo must have confirmed PDPA consent.");

    const complete = issues.length === 0;
    return { complete, pdpaOk, verified, issues, canPublish: complete };
  }

  // buildPreview() — the ID06 control message: assemble the preview payload
  // (idp + photos + verified company) and the completeness/PDPA check result.
  static buildPreview(idpId: string) {
    const idp = this.loadIDP(idpId);
    const photos = this.loadPhotos(idpId); // loadPhotos [loop]
    const company = this.getCompanyProfile(idp.designerId);
    const check = this.checkCompleteness(idpId); // checkCompleteness + checkPdpaCompliance
    return { idp, photos, company, check };
  }

  static publish(idpId: string): IDP {
    const check = this.checkCompleteness(idpId);
    if (!check.canPublish) {
      throw httpError(422, "NOT_PUBLISHABLE", "Resolve all issues before publishing: " + check.issues.join(" "));
    }
    db.prepare(`UPDATE idps SET status = 'published' WHERE id = ?`).run(idpId);
    audit("IDP_PUBLISHED", null, idpId);
    return db.prepare(`SELECT * FROM idps WHERE id = ?`).get(idpId) as IDP;
  }

  static submitForModeration(idpId: string): void {
    db.prepare(`UPDATE idps SET status = 'in_moderation' WHERE id = ?`).run(idpId);
    db.prepare(`INSERT INTO moderation_queue (id, idpId, status) VALUES (?,?, 'pending')`).run(id("mod"), idpId);
    audit("IDP_SUBMITTED_FOR_MODERATION", null, idpId);
  }

  // ----- shared loaders (ID06 / ID08) -----
  static loadIDP(idpId: string): IDP {
    const idp = db.prepare(`SELECT * FROM idps WHERE id = ?`).get(idpId) as IDP | undefined;
    if (!idp) throw httpError(404, "NOT_FOUND", "Portfolio not found.");
    return idp;
  }
  static loadPhotos(idpId: string): Photo[] {
    return db.prepare(`SELECT * FROM photos WHERE idpId = ? ORDER BY "order"`).all(idpId) as Photo[];
  }
  static loadReviews(idpId: string): Review[] {
    return db.prepare(`SELECT * FROM reviews WHERE idpId = ? AND verified = 1`).all(idpId) as Review[];
  }
  static getCompanyProfile(designerId: string): CompanyProfile | undefined {
    return db.prepare(`SELECT * FROM company_profiles WHERE designerId = ?`).get(designerId) as
      | CompanyProfile
      | undefined;
  }

  // ----- ID08 View details -----
  static dedupeView(custId: string, idpId: string): boolean {
    // Only count one view per customer per IDP per 30 minutes.
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
    const recent = db
      .prepare(`SELECT COUNT(*) AS c FROM view_dedupe WHERE customerId = ? AND idpId = ? AND ts > ?`)
      .get(custId, idpId, cutoff) as { c: number };
    if (recent.c > 0) return false; // duplicate — do not count
    db.prepare(`INSERT INTO view_dedupe (customerId, idpId, ts) VALUES (?,?,?)`).run(custId, idpId, now());
    return true;
  }

  // «entity» IDP.getDetails() — fetch the published IDP row (ID08 message).
  static getDetails(idpId: string): IDP {
    const idp = this.loadIDP(idpId);
    if (idp.status !== "published") throw httpError(404, "IDP_UNAVAILABLE", "This portfolio is not available.");
    return idp;
  }

  // «entity» IDP.incrementViews() — bump the view counter (ID08 message).
  static incrementViews(idpId: string): void {
    db.prepare(`UPDATE idps SET viewCount = viewCount + 1 WHERE id = ?`).run(idpId);
    audit("IDP_VIEWED", null, idpId);
  }

  static viewDetails(idpId: string, custId: string | null) {
    const idp = this.getDetails(idpId); // loadIDP + getDetails
    const photos = this.loadPhotos(idpId); // loadPhotos [loop]
    const reviews = this.loadReviews(idpId); // loadReviews
    const company = this.getCompanyProfile(idp.designerId);

    if (custId && this.dedupeView(custId, idpId)) {
      this.incrementViews(idpId); // dedupeView -> incrementViews
      idp.viewCount += 1;
    }
    const shortlisted = custId ? this.isShortlisted(custId, idpId) : false;
    return { idp, photos, reviews, company, shortlisted };
  }

  // ----- interest tracking: shortlist is a per-customer favourite TOGGLE -----
  static isShortlisted(custId: string, idpId: string): boolean {
    return !!db.prepare(`SELECT 1 FROM favourites WHERE customerId = ? AND idpId = ?`).get(custId, idpId);
  }

  static shortlist(custId: string, idpId: string): IDP & { shortlisted: boolean } {
    this.loadIDP(idpId);
    const already = this.isShortlisted(custId, idpId);
    if (already) {
      db.prepare(`DELETE FROM favourites WHERE customerId = ? AND idpId = ?`).run(custId, idpId);
      db.prepare(`UPDATE idps SET shortlistCount = MAX(0, shortlistCount - 1) WHERE id = ?`).run(idpId);
    } else {
      db.prepare(`INSERT OR IGNORE INTO favourites (customerId, idpId) VALUES (?, ?)`).run(custId, idpId);
      db.prepare(`UPDATE idps SET shortlistCount = shortlistCount + 1 WHERE id = ?`).run(idpId);
      audit("IDP_SHORTLISTED", custId, idpId);
    }
    const idp = this.loadIDP(idpId);
    return { ...idp, shortlisted: !already };
  }

  static listFavourites(custId: string): IDP[] {
    return db
      .prepare(
        `SELECT i.* FROM idps i JOIN favourites f ON f.idpId = i.id WHERE f.customerId = ? ORDER BY i.title`
      )
      .all(custId) as IDP[];
  }

  // ----- listings / search -----
  static listPublished(q?: string): IDP[] {
    // Each listing carries a coverUrl — the first photo — so the browse grid can
    // show a real thumbnail.
    const cover = `(SELECT url FROM photos WHERE photos.idpId = idps.id ORDER BY "order" LIMIT 1) AS coverUrl`;
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      return db
        .prepare(
          `SELECT *, ${cover} FROM idps WHERE status = 'published' AND (title LIKE ? OR description LIKE ? OR propertyType LIKE ?)
           ORDER BY createdDate DESC`
        )
        .all(like, like, like) as IDP[];
    }
    return db.prepare(`SELECT *, ${cover} FROM idps WHERE status = 'published' ORDER BY createdDate DESC`).all() as IDP[];
  }
  static listForDesigner(designerId: string): IDP[] {
    return db.prepare(`SELECT * FROM idps WHERE designerId = ? ORDER BY createdDate DESC`).all(designerId) as IDP[];
  }
  static listCategories(): Category[] {
    return db.prepare(`SELECT * FROM categories ORDER BY name`).all() as Category[];
  }
}
