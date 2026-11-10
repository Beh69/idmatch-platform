// Seed demo data: 3 roles (customer / designer / manager), a verified company
// profile, categories, two published IDPs with photos & reviews, plus some
// historical activity so the ID03 weekly report has numbers to aggregate.
import { db, initSchema } from "./db.js";
import { id, now, audit } from "./services/helpers.js";
import { photosForListing } from "../shared/stockPhotos.js";
import { CATEGORY_NAMES } from "../shared/categories.js";

export function runSeed(): void {
  initSchema();
  const wipe = [
    "users",
    "company_profiles",
    "categories",
    "idps",
    "photos",
    "reviews",
    "inquiries",
    "notifications",
    "channel_prefs",
    "price_requests",
    "price_offers",
    "contracts",
    "payments",
    "bookings",
    "moderation_queue",
    "audit_log",
    "inquiry_rate",
    "view_dedupe",
  ];
  for (const t of wipe) db.prepare(`DELETE FROM ${t}`).run();

  // --- users ---
  const customer = { id: "u_cust", role: "customer", name: "Mei Ling Tan", email: "meiling@example.sg", nric: "S****123A" };
  const designer = { id: "u_desn", role: "designer", name: "Studio Lumen", email: "hello@studiolumen.sg", uen: "201512345K", caseTrust: 1 };
  const manager = { id: "u_mgr", role: "manager", name: "Platform Admin", email: "admin@idmatch.sg" };

  const insUser = db.prepare(
    `INSERT INTO users (id, role, name, email, nric, uen, caseTrust) VALUES (@id,@role,@name,@email,@nric,@uen,@caseTrust)`
  );
  insUser.run({ ...customer, nric: customer.nric ?? null, uen: null, caseTrust: null });
  insUser.run({ ...designer, nric: null, uen: designer.uen ?? null, caseTrust: designer.caseTrust ?? null });
  insUser.run({ ...manager, nric: null, uen: null, caseTrust: null });

  db.prepare(
    `INSERT INTO company_profiles (designerId, name, uen, caseTrust, logoUrl, acceptingRequests)
     VALUES ('u_desn','Studio Lumen','201512345K',1,'🏢',1)`
  ).run();

  // --- categories ---
  const cats = CATEGORY_NAMES;
  const catIds: string[] = [];
  for (const name of cats) {
    const cid = id("cat");
    catIds.push(cid);
    db.prepare(`INSERT INTO categories (id, name) VALUES (?,?)`).run(cid, name);
  }

  // --- two published IDPs ---
  function mkIdp(title: string, desc: string, prop: string, budget: string, catIdx: number, views: number, shortlists: number) {
    const idpId = id("idp");
    db.prepare(
      `INSERT INTO idps (id, designerId, title, description, propertyType, budgetRangeSgd, categoryId, status, viewCount, shortlistCount, services, createdDate)
       VALUES (?, 'u_desn', ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?)`
    ).run(idpId, title, desc, prop, budget, catIds[catIdx], views, shortlists, "Full home renovation · Carpentry · Flooring · Painting · HDB/BCA permit handling", now());
    return idpId;
  }

  const idp1 = mkIdp(
    "Warm Japandi 4-Room BTO",
    "A calm Japandi renovation for a 4-room BTO in Punggol — oak veneer, muted clay tones, full carpentry and a bay-window reading nook. Completed in 9 weeks.",
    "HDB 4-Room BTO",
    "S$45,000 - S$60,000",
    2,
    128,
    21
  );
  const idp2 = mkIdp(
    "Industrial Loft Condo",
    "Open-concept industrial loft for a condominium at the city fringe — exposed ceiling, microcement feature wall, and a kitchen island in black ash.",
    "Condominium",
    "S$70,000 - S$95,000",
    3,
    86,
    12
  );

  // photos + reviews
  const addPhoto = db.prepare(
    `INSERT INTO photos (id, idpId, url, "order", format, consentConfirmed) VALUES (?,?,?,?,?,1)`
  );
  photosForListing(0, 3).forEach((u, i) => addPhoto.run(id("pho"), idp1, u, i, "jpg"));
  photosForListing(1, 3).forEach((u, i) => addPhoto.run(id("pho"), idp2, u, i, "jpg"));

  const addReview = db.prepare(`INSERT INTO reviews (id, idpId, rating, comment, verified) VALUES (?,?,?,?,1)`);
  addReview.run(id("rev"), idp1, 5, "Studio Lumen nailed the brief — on time and on budget.");
  addReview.run(id("rev"), idp1, 4, "Beautiful carpentry. Communication could be slightly faster.");
  addReview.run(id("rev"), idp2, 5, "The microcement wall is stunning in person.");

  // a draft IDP so ID06 preview / ID07 publish can be demoed
  mkDraft();

  function mkDraft() {
    const idpId = id("idp");
    db.prepare(
      `INSERT INTO idps (id, designerId, title, description, propertyType, budgetRangeSgd, categoryId, status, viewCount, shortlistCount, createdDate)
       VALUES (?, 'u_desn', 'Minimalist Resale 5-Room (draft)', 'Work-in-progress listing for a resale 5-room flat in Bishan with a light oak palette and hidden storage throughout the home.', 'HDB 5-Room Resale', 'S$55,000 - S$75,000', ?, 'draft', 0, 0, ?)`
    ).run(idpId, catIds[0], now());
    db.prepare(`INSERT INTO photos (id, idpId, url, "order", format, consentConfirmed) VALUES (?,?,?,0,'jpg',1)`).run(
      id("pho"),
      idpId,
      photosForListing(2, 1)[0]
    );
  }

  // default channel prefs for the demo customer
  db.prepare(
    `INSERT INTO channel_prefs (customerId, primaryChannel, fallbackChannel, pdpaConsent, dndWindow)
     VALUES ('u_cust','push','email',1,NULL)`
  ).run();

  // --- historical activity for ID03 weekly report ---
  const base = Date.now();
  function backdated(action: string, actor: string | null, entity: string | null, amount: number, daysAgo: number) {
    const ts = new Date(base - daysAgo * 86400_000).toISOString();
    db.prepare(`INSERT INTO audit_log (id, action, actorId, entityId, amountSgd, timestamp) VALUES (?,?,?,?,?,?)`).run(
      id("log"),
      action,
      actor,
      entity,
      amount,
      ts
    );
  }
  for (let i = 0; i < 4; i++) backdated("USER_SIGNED_UP", null, null, 0, 1 + i);
  backdated("IDP_PUBLISHED", null, idp1, 0, 5);
  backdated("IDP_PUBLISHED", null, idp2, 0, 6);
  for (let i = 0; i < 30; i++) backdated("IDP_VIEWED", "u_cust", idp1, 0, (i % 6) + 1);
  for (let i = 0; i < 9; i++) backdated("IDP_SHORTLISTED", "u_cust", idp1, 0, (i % 6) + 1);
  for (let i = 0; i < 5; i++) backdated("INQUIRY_SUBMITTED", "u_cust", null, 0, (i % 6) + 1);
  backdated("OFFER_ACCEPTED", "u_cust", "off_seed", 52000, 3);

  audit("SEED_COMPLETE", "u_mgr", null);
  console.log("Seed complete: 3 users, 3 published + 1 draft IDP, categories, reviews, activity history.");
}

// Allow `npm run seed` to run this standalone.
if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed();
}
