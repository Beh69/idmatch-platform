// ===========================================================================
// Bulk test-data generator.
//
// Produces a LARGE, realistic dataset (100+ records for each core business data
// type) so the system can be demonstrated live at volume. Values are randomised
// but Singapore-contextual (HDB/condo property types, SGD budgets, UEN/CaseTrust,
// 9% GST, PayNow/NETS) and all foreign-key relationships are kept valid.
//
// Deterministic: a fixed seed means every run produces the SAME dataset, so the
// live demo is repeatable. Pass a different seed to vary it.
//
// Run standalone:   npm run generate
// It wipes the DB first, then seeds the bulk dataset and prints a count table.
// ===========================================================================
import { fileURLToPath, pathToFileURL } from "node:url";
import { db, initSchema } from "./db.js";
import { id } from "./services/helpers.js";
import { GST_RATE, PLATFORM_COMMISSION_RATE } from "../shared/types.js";
import { photosForListing } from "../shared/stockPhotos.js";
import { CATEGORY_NAMES } from "../shared/categories.js";

// ---- seeded pseudo-random generator (mulberry32) so runs are repeatable ----
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Singapore-flavoured value pools ----
const FIRST = ["Mei Ling", "Wei Jie", "Siti", "Arjun", "Hui Fang", "Daniel", "Nurul", "Ethan", "Priya", "Jun Hao", "Rachel", "Faizal", "Grace", "Marcus", "Aisha", "Kai", "Shireen", "Benjamin", "Divya", "Zhi Hao"];
const LAST = ["Tan", "Lim", "Lee", "Wong", "Kumar", "Ng", "Rahman", "Goh", "Chua", "Devi", "Ong", "Teo", "Sharma", "Koh", "Yeo", "Nair", "Chan", "Low", "Raj", "Sim"];
const FIRMS = ["Studio Lumen", "Habitat Collective", "Nordic Nest", "Urban Canvas", "Loft & Co", "Maison Design", "Terra Interiors", "Blank Space", "The Local Project", "Casa Works", "Form & Function", "Aureus Studio", "Woodgrain", "Monocot Design", "Atelier Six"];
const PROPERTY = ["HDB 3-Room BTO", "HDB 4-Room BTO", "HDB 5-Room Resale", "HDB Executive", "Condominium", "Executive Condo", "Landed Terrace", "Cluster House", "Shoebox Apartment", "Penthouse"];
// Design styles used in listing titles/descriptions (flavour text only).
const STYLES = ["Scandinavian", "Modern Contemporary", "Muji / Japandi", "Industrial", "Minimalist", "Luxe Classic", "Mid-Century", "Coastal"];
const TOWNS = ["Punggol", "Sengkang", "Tampines", "Bishan", "Clementi", "Woodlands", "Jurong East", "Serangoon", "Yishun", "Bedok", "Queenstown", "Toa Payoh", "Hougang", "Bukit Panjang"];
const SERVICES = ["Full home renovation · Carpentry · Flooring · Painting · HDB permit handling", "Kitchen & bathroom specialist · Tiling · Plumbing · Waterproofing", "Space planning · Custom carpentry · Lighting design", "Resale restoration · Hacking · Rewiring · Painting · Permit handling"];
const BUDGETS = ["S$30,000 - S$45,000", "S$45,000 - S$60,000", "S$60,000 - S$80,000", "S$80,000 - S$100,000", "S$100,000 - S$140,000"];
const METHODS = ["PayNow", "NETS", "Card"];
const REVIEW_TXT = ["On time and on budget — highly recommend.", "Beautiful carpentry, great communication.", "The space feels twice as big now.", "Professional team, minor delays near the end.", "Exceeded our expectations.", "Good value for a BTO package.", "Responsive and transparent on pricing.", "Lovely finishes; would hire again.", "Smooth handover, clean site throughout.", "Creative ideas within our budget."];

interface Counts {
  [k: string]: number;
}

export interface GenOptions {
  designers: number;
  customers: number;
  idps: number;
  seed: number;
}
const DEFAULTS: GenOptions = { designers: 110, customers: 120, idps: 160, seed: 42 };

export function generateBulkData(opts: Partial<GenOptions> = {}): Counts {
  const { designers, customers, idps, seed } = { ...DEFAULTS, ...opts };

  // All randomness flows through this seeded generator -> repeatable dataset.
  const rng = makeRng(seed);
  const rand = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
  const pick = <T,>(arr: T[]): T => arr[rand(0, arr.length - 1)];
  const chance = (p: number) => rng() < p;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  // Subtract whole days PLUS a random time-of-day so timestamps vary realistically
  // (not all frozen at the generator's run time).
  const daysAgoIso = (d: number) =>
    new Date(Date.now() - d * 86400_000 - Math.floor(rng() * 86400_000)).toISOString();
  const uen = () => String(rand(199000000, 202599999)) + pick("ABCDEFGHJKLMNPQRSTUVWXYZ".split(""));

  initSchema();
  const wipe = ["users", "company_profiles", "categories", "idps", "photos", "reviews", "inquiries", "notifications", "channel_prefs", "price_requests", "price_offers", "contracts", "payments", "bookings", "moderation_queue", "audit_log", "inquiry_rate", "view_dedupe"];
  for (const t of wipe) db.prepare(`DELETE FROM ${t}`).run();

  const tx = db.transaction(() => {
    // --- platform manager (1) ---
    db.prepare(`INSERT INTO users (id, role, name, email, nric, uen, caseTrust) VALUES ('u_mgr','manager','Platform Admin','admin@idmatch.sg',NULL,NULL,NULL)`).run();

    // --- categories (Singapore property types; a fixed reference list) ---
    const catIds: string[] = [];
    for (const name of CATEGORY_NAMES) {
      const cid = id("cat");
      catIds.push(cid);
      db.prepare(`INSERT INTO categories (id, name) VALUES (?,?)`).run(cid, name);
    }

    // --- designers + company profiles (ONE shared UEN per designer) ---
    const designerIds: string[] = [];
    const insUser = db.prepare(`INSERT INTO users (id, role, name, email, nric, uen, caseTrust) VALUES (@id,@role,@name,@email,@nric,@uen,@caseTrust)`);
    const insCompany = db.prepare(`INSERT INTO company_profiles (designerId, name, uen, caseTrust, logoUrl, acceptingRequests) VALUES (@designerId,@name,@uen,@caseTrust,@logoUrl,@acceptingRequests)`);
    for (let i = 0; i < designers; i++) {
      const did = id("desn");
      designerIds.push(did);
      const firm = pick(FIRMS) + " " + pick(["Studio", "Interiors", "Design", "& Co", "Works"]);
      const caseTrust = chance(0.8) ? 1 : 0; // most accredited; some not (for ID07 negative path)
      const sharedUen = uen(); // the SAME UEN on both the user row and the company profile
      insUser.run({ id: did, role: "designer", name: firm, email: `hello@${firm.toLowerCase().replace(/[^a-z]/g, "")}${i}.sg`, nric: null, uen: sharedUen, caseTrust });
      insCompany.run({ designerId: did, name: firm, uen: sharedUen, caseTrust, logoUrl: pick(["🏢", "🏠", "🏗️", "🪟", "🛋️"]), acceptingRequests: chance(0.85) ? 1 : 0 });
    }
    // stable, known, accredited demo designer (always accepting)
    db.prepare(`UPDATE users SET id='u_desn', name='Studio Lumen', email='hello@studiolumen.sg', uen='201512345K', caseTrust=1 WHERE id=?`).run(designerIds[0]);
    db.prepare(`UPDATE company_profiles SET designerId='u_desn', name='Studio Lumen', uen='201512345K', caseTrust=1, acceptingRequests=1 WHERE designerId=?`).run(designerIds[0]);
    designerIds[0] = "u_desn";

    // --- customers ---
    const customerIds: string[] = [];
    for (let i = 0; i < customers; i++) {
      const cid = id("cust");
      customerIds.push(cid);
      const name = pick(FIRST) + " " + pick(LAST);
      insUser.run({ id: cid, role: "customer", name, email: `${name.toLowerCase().replace(/[^a-z]/g, ".")}.${i}@example.sg`, nric: "S****" + rand(100, 999) + pick("ABCDEFGHJKLZ".split("")), uen: null, caseTrust: null });
      db.prepare(`INSERT INTO channel_prefs (customerId, primaryChannel, fallbackChannel, pdpaConsent, dndWindow) VALUES (?,?,?,?,?)`)
        .run(cid, pick(["push", "email", "sms"]), pick(["email", "sms", "push"]), chance(0.9) ? 1 : 0, chance(0.2) ? "22-08" : null);
    }
    // stable, known demo customer
    db.prepare(`UPDATE users SET id='u_cust', name='Mei Ling Tan', email='meiling@example.sg', nric='S****123A' WHERE id=?`).run(customerIds[0]);
    db.prepare(`UPDATE channel_prefs SET customerId='u_cust' WHERE customerId=?`).run(customerIds[0]);
    customerIds[0] = "u_cust";

    // --- IDPs (portfolios) + photos + reviews ---
    const insIdp = db.prepare(`INSERT INTO idps (id, designerId, title, description, propertyType, budgetRangeSgd, categoryId, status, viewCount, shortlistCount, services, createdDate) VALUES (@id,@designerId,@title,@description,@propertyType,@budgetRangeSgd,@categoryId,@status,@viewCount,@shortlistCount,@services,@createdDate)`);
    const insPhoto = db.prepare(`INSERT INTO photos (id, idpId, url, "order", format, consentConfirmed) VALUES (?,?,?,?,?,1)`);
    const insReview = db.prepare(`INSERT INTO reviews (id, idpId, rating, comment, verified) VALUES (?,?,?,?,?)`);
    const publishedIdps: string[] = [];
    const idpDesigner: Record<string, string> = {};

    // Helper that creates one IDP; used both for random IDPs and for guaranteeing
    // the demo designer (u_desn) owns a healthy set of published portfolios.
    let photoSeed = 0;
    function makeIdp(designerId: string, forcePublished = false): string {
      const idpId = id("idp");
      const style = pick(STYLES);
      const prop = pick(PROPERTY);
      const town = pick(TOWNS);
      const status = forcePublished ? "published" : chance(0.8) ? "published" : pick(["draft", "in_moderation"]);
      const views = status === "published" ? rand(5, 400) : 0;
      const shortlists = status === "published" ? rand(0, Math.max(1, Math.floor(views / 6))) : 0;
      insIdp.run({
        id: idpId, designerId,
        title: `${style} ${prop.replace("HDB ", "")} in ${town}`,
        description: `A ${style.toLowerCase()} renovation for a ${prop} in ${town}. Includes carpentry, flooring and lighting, delivered in ${rand(6, 14)} weeks within a ${pick(BUDGETS)} budget.`,
        propertyType: prop, budgetRangeSgd: pick(BUDGETS), categoryId: pick(catIds),
        status, viewCount: views, shortlistCount: shortlists, services: pick(SERVICES), createdDate: daysAgoIso(rand(1, 120)),
      });
      idpDesigner[idpId] = designerId;
      if (status === "published") publishedIdps.push(idpId);
      // Real interior photos (Unsplash CDN) linked to this listing, deterministic per listing.
      const gallery = photosForListing(photoSeed++, rand(3, 5));
      gallery.forEach((url, p) => insPhoto.run(id("pho"), idpId, url, p, "jpg"));
      for (let r = 0; r < rand(0, 4); r++) insReview.run(id("rev"), idpId, rand(3, 5), pick(REVIEW_TXT), chance(0.85) ? 1 : 0);
      if (status === "in_moderation") db.prepare(`INSERT INTO moderation_queue (id, idpId, status) VALUES (?,?, 'pending')`).run(id("mod"), idpId);
      return idpId;
    }

    // Guarantee the demo designer has 6 published portfolios with photos/reviews.
    const demoIdps: string[] = [];
    for (let i = 0; i < 6; i++) demoIdps.push(makeIdp("u_desn", true));
    // Remaining random IDPs across all designers.
    for (let i = demoIdps.length; i < idps; i++) makeIdp(pick(designerIds));

    // --- inquiries (ID01) + notifications (ID02) ---
    const insInq = db.prepare(`INSERT INTO inquiries (id, idpId, customerId, designerId, message, status, thread, createdDate) VALUES (@id,@idpId,@customerId,@designerId,@message,@status,@thread,@createdDate)`);
    const insNotif = db.prepare(`INSERT INTO notifications (id, customerId, channel, content, status, createdDate) VALUES (?,?,?,?,?,?)`);

    function makeInquiry(idpId: string, cust: string, forceNew = false) {
      const designerId = idpDesigner[idpId];
      // Most generated inquiries are left UNREPLIED so the designer answers them
      // live in the demo. A minority carry a realistic (non-placeholder) reply.
      const replied = !forceNew && chance(0.4);
      const created = daysAgoIso(rand(1, 60));
      const msg = pick(["Is this package available for my unit?", "What is the lead time?", "Can you work within my budget?", "Do you offer HDB permit handling?", "Can we schedule a consultation?"]);
      const dReply = pick([
        "Thanks for reaching out — we have availability next month and can tailor the scope to your budget.",
        "Lead time is about 8–10 weeks from handover. Happy to arrange a site consultation.",
        "Yes, we handle HDB permit submission as part of the package. Let's discuss the details.",
      ]);
      const thread = [{ from: "customer", text: msg, at: created }];
      if (replied) thread.push({ from: "designer", text: dReply, at: created });
      insInq.run({
        id: id("inq"), idpId, customerId: cust, designerId,
        message: msg,
        status: replied ? "replied" : "new",
        thread: JSON.stringify(thread),
        createdDate: created,
      });
      if (replied) insNotif.run(id("ntf"), cust, pick(["push", "email", "sms"]), "A designer has replied to your inquiry.", chance(0.95) ? "delivered" : "failed", created);
    }

    // Demo customer gets a couple of unreplied inquiries (to answer live) plus
    // a couple already answered (to show the two-way thread).
    for (let i = 0; i < 4; i++) makeInquiry(demoIdps[i % demoIdps.length], "u_cust", i >= 2);
    const nInq = rand(120, 160);
    for (let i = 0; i < nInq; i++) makeInquiry(pick(publishedIdps), pick(customerIds));
    while ((db.prepare(`SELECT COUNT(*) AS c FROM notifications`).get() as { c: number }).c < 110) {
      insNotif.run(id("ntf"), pick(customerIds), pick(["push", "email", "sms"]), "A designer has replied to your inquiry.", "delivered", daysAgoIso(rand(1, 60)));
    }

    // --- price requests (ID04) + offers (ID05 input) ---
    const insReq = db.prepare(`INSERT INTO price_requests (id, idpId, customerId, designerId, scope, propertyType, unitSizeSqft, budgetRangeSgd, status, slaDeadline, createdDate) VALUES (@id,@idpId,@customerId,@designerId,@scope,@propertyType,@unitSizeSqft,@budgetRangeSgd,@status,@slaDeadline,@createdDate)`);
    const insOffer = db.prepare(`INSERT INTO price_offers (id, priceRequestId, idpId, customerId, designerId, amountSgd, status, expiryDate) VALUES (@id,@priceRequestId,@idpId,@customerId,@designerId,@amountSgd,@status,@expiryDate)`);
    // Only OPEN, non-expired offers are eligible to be "accepted" later.
    const openOfferIds: string[] = [];

    function makeRequest(idpId: string, cust: string, forceOpenOffer = false) {
      const designerId = idpDesigner[idpId];
      const quoted = forceOpenOffer || chance(0.8);
      const reqId = id("req");
      const created = daysAgoIso(rand(1, 45));
      insReq.run({
        id: reqId, idpId, customerId: cust, designerId,
        scope: pick(["Full home renovation", "Kitchen + living only", "Master bedroom + wardrobe", "Whole-unit incl. carpentry"]),
        propertyType: pick(PROPERTY), unitSizeSqft: rand(450, 2200), budgetRangeSgd: pick(BUDGETS),
        status: quoted ? "quoted" : pick(["pending", "pending", "expired"]),
        slaDeadline: new Date(Date.parse(created) + 48 * 3600_000).toISOString(), createdDate: created,
      });
      if (quoted) {
        const offId = id("off");
        const amount = rand(25, 150) * 1000;
        // status: open / accepted / expired. Expired offers get a PAST expiry date
        // and are NEVER later converted to accepted (they stay a dead end).
        const roll = rng();
        let status: string;
        let expiryDays: number;
        if (forceOpenOffer) {
          status = "open";
          expiryDays = rand(3, 14);
        } else if (roll < 0.3) {
          status = "accepted";
          expiryDays = rand(3, 14);
        } else if (roll < 0.45) {
          status = "expired";
          expiryDays = -rand(1, 10); // already in the past
        } else {
          status = "open";
          expiryDays = rand(3, 14);
        }
        insOffer.run({ id: offId, priceRequestId: reqId, idpId, customerId: cust, designerId, amountSgd: amount, status, expiryDate: new Date(Date.now() + expiryDays * 86400_000).toISOString() });
        // Only RANDOM open offers go into the consumable pool. The demo customer's
        // forced-open offers are protected so they always remain open to accept live.
        if (status === "open" && !forceOpenOffer) openOfferIds.push(offId);
      }
    }

    // Guarantee the demo customer has OPEN offers to accept live (kept out of the
    // accepted-top-up pool, so they are never consumed).
    for (let i = 0; i < 3; i++) makeRequest(demoIdps[i % demoIdps.length], "u_cust", true);
    const nReq = rand(150, 180);
    for (let i = 0; i < nReq; i++) makeRequest(pick(publishedIdps), pick(customerIds));

    // --- accepted offers -> contracts + payments + bookings (ID05 downstream) ---
    const insContract = db.prepare(`INSERT INTO contracts (id, offerId, terms, signedByCustomer, signedByDesigner) VALUES (?,?,?,1,1)`);
    const insPayment = db.prepare(`INSERT INTO payments (id, offerId, amountSgd, commissionSgd, gstSgd, totalSgd, method, status, invoiceNo) VALUES (@id,@offerId,@amountSgd,@commissionSgd,@gstSgd,@totalSgd,@method,@status,@invoiceNo)`);
    const insBooking = db.prepare(`INSERT INTO bookings (id, offerId, customerId, designerId, status, insured, permitVerified, createdDate) VALUES (@id,@offerId,@customerId,@designerId,@status,@insured,@permitVerified,@createdDate)`);
    const insAudit = db.prepare(`INSERT INTO audit_log (id, action, actorId, entityId, amountSgd, timestamp) VALUES (?,?,?,?,?,?)`);

    // Top up the accepted pool to >= 110 by converting OPEN offers ONLY — each
    // offer is consumed at most once (shift), so no duplicate downstream rows.
    const TARGET = 110;
    let acceptedCount = (db.prepare(`SELECT COUNT(*) AS c FROM price_offers WHERE status='accepted'`).get() as { c: number }).c;
    while (acceptedCount < TARGET && openOfferIds.length > 0) {
      const offId = openOfferIds.shift()!; // consume once
      db.prepare(`UPDATE price_offers SET status='accepted' WHERE id=? AND status='open'`).run(offId);
      acceptedCount++;
    }

    // Build the downstream rows from the authoritative DB list of accepted offers.
    const acceptedOffers = db.prepare(`SELECT id, customerId, designerId, amountSgd FROM price_offers WHERE status='accepted'`).all() as { id: string; customerId: string; designerId: string; amountSgd: number }[];
    for (const o of acceptedOffers) {
      const commission = round2(o.amountSgd * PLATFORM_COMMISSION_RATE);
      const gst = round2(commission * GST_RATE);
      const total = round2(commission + gst);
      const created = daysAgoIso(rand(1, 40));
      insContract.run(id("con"), o.id, `Renovation agreement. Agreed value S$${o.amountSgd.toFixed(2)}. Executed under the Electronic Transactions Act.`);
      insPayment.run({ id: id("pay"), offerId: o.id, amountSgd: commission, commissionSgd: commission, gstSgd: gst, totalSgd: total, method: pick(METHODS), status: "approved", invoiceNo: "INV-2026-" + id("x").slice(-6).toUpperCase() });
      insBooking.run({ id: id("bkg"), offerId: o.id, customerId: o.customerId, designerId: o.designerId, status: "confirmed", insured: 1, permitVerified: 1, createdDate: created });
      insAudit.run(id("log"), "OFFER_ACCEPTED", o.customerId, o.id, o.amountSgd, created);
    }

    // --- moderation queue: top up to 100+ by enqueuing additional drafts ---
    // (each queued item references a real in_moderation IDP for integrity).
    const insModIdp = insIdp;
    const insMod = db.prepare(`INSERT INTO moderation_queue (id, idpId, status) VALUES (?,?,?)`);
    while ((db.prepare(`SELECT COUNT(*) AS c FROM moderation_queue`).get() as { c: number }).c < 105) {
      const idpId = id("idp");
      const style = pick(STYLES);
      const prop = pick(PROPERTY);
      const town = pick(TOWNS);
      insModIdp.run({
        id: idpId, designerId: pick(designerIds),
        title: `${style} ${prop.replace("HDB ", "")} in ${town}`,
        description: `A ${style.toLowerCase()} renovation for a ${prop} in ${town}, pending moderation review.`,
        propertyType: prop, budgetRangeSgd: pick(BUDGETS), categoryId: pick(catIds),
        status: "in_moderation", viewCount: 0, shortlistCount: 0, services: pick(SERVICES), createdDate: daysAgoIso(rand(1, 20)),
      });
      idpDesigner[idpId] = "";
      insPhoto.run(id("pho"), idpId, photosForListing(photoSeed++, 1)[0], 0, "jpg");
      insMod.run(id("mod"), idpId, pick(["pending", "pending", "approved", "rejected"]));
    }

    // --- audit / activity log: ensure 100+ across a spread of weeks for ID03 ---
    const actions = ["USER_SIGNED_UP", "IDP_PUBLISHED", "IDP_VIEWED", "IDP_SHORTLISTED", "INQUIRY_SUBMITTED"];
    while ((db.prepare(`SELECT COUNT(*) AS c FROM audit_log`).get() as { c: number }).c < 400) {
      insAudit.run(id("log"), pick(actions), pick(customerIds), null, 0, daysAgoIso(rand(1, 56)));
    }
  });

  tx();

  const counts: Counts = {};
  for (const t of wipe) counts[t] = (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
  return counts;
}

// ---- standalone entry (works on Windows, macOS and Linux) ----
// Compare resolved file paths rather than raw file:// strings so this fires
// correctly regardless of platform path formatting.
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]).href);

if (invokedDirectly) {
  const counts = generateBulkData();
  console.log("\nBulk test data generated (seed=42, repeatable). Record counts per data type:\n");
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [t, c] of rows) console.log(`  ${t.padEnd(18)} ${String(c).padStart(5)}`);
  console.log(`\n  TOTAL records: ${Object.values(counts).reduce((a, b) => a + b, 0)}\n`);
}
