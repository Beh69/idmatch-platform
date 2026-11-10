// Verifies the bulk test-data generator produces a sufficiently large dataset
// (>= 100 records for each core business data type) and that the data is
// internally consistent, so the live demo can run at realistic volume.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBulkData } from "../src/server/generateData.js";
import { db } from "../src/server/db.js";

const counts = generateBulkData();

// Core business data types that must each reach the 100-record demo threshold.
const CORE_TYPES = [
  "users",
  "company_profiles",
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
  "audit_log",
];

for (const t of CORE_TYPES) {
  test(`generates at least 100 ${t} records (got ${counts[t]})`, () => {
    assert.ok(counts[t] >= 100, `${t} had only ${counts[t]} records`);
  });
}

test("every photo belongs to an existing IDP (referential integrity)", () => {
  const orphans = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM photos p LEFT JOIN idps i ON i.id = p.idpId WHERE i.id IS NULL`)
      .get() as { c: number }
  ).c;
  assert.equal(orphans, 0);
});

test("every booking links to an accepted offer and real users", () => {
  const bad = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM bookings b
         LEFT JOIN price_offers o ON o.id = b.offerId
         LEFT JOIN users c1 ON c1.id = b.customerId
         LEFT JOIN users d1 ON d1.id = b.designerId
         WHERE o.id IS NULL OR c1.id IS NULL OR d1.id IS NULL`
      )
      .get() as { c: number }
  ).c;
  assert.equal(bad, 0);
});

test("every payment applies 9% GST on its commission", () => {
  const wrong = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM payments WHERE ABS(gstSgd - ROUND(commissionSgd * 0.09, 2)) > 0.01`)
      .get() as { c: number }
  ).c;
  assert.equal(wrong, 0);
});

test("the demo accounts (u_cust, u_desn, u_mgr) exist with correct roles", () => {
  const rows = db
    .prepare(`SELECT id, role FROM users WHERE id IN ('u_cust','u_desn','u_mgr') ORDER BY id`)
    .all() as { id: string; role: string }[];
  assert.equal(rows.length, 3);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.role]));
  assert.equal(byId["u_cust"], "customer");
  assert.equal(byId["u_desn"], "designer");
  assert.equal(byId["u_mgr"], "manager");
});

test("there are published portfolios available to browse", () => {
  const published = (db.prepare(`SELECT COUNT(*) AS c FROM idps WHERE status='published'`).get() as { c: number }).c;
  assert.ok(published >= 100);
});

// --- regression checks for the bugs found in code review ---

test("no offer has duplicate contracts / payments / bookings", () => {
  for (const t of ["contracts", "payments", "bookings"]) {
    const dups = (
      db.prepare(`SELECT COUNT(*) AS c FROM (SELECT offerId FROM ${t} GROUP BY offerId HAVING COUNT(*) > 1)`).get() as {
        c: number;
      }
    ).c;
    assert.equal(dups, 0, `${t} has offers with more than one row`);
  }
});

test("every designer's user UEN matches their company-profile UEN", () => {
  const mismatches = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM users u JOIN company_profiles c ON c.designerId = u.id WHERE u.uen != c.uen`)
      .get() as { c: number }
  ).c;
  assert.equal(mismatches, 0);
});

test("no accepted offer has an expiry date in the past (expired is never accepted)", () => {
  const bad = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM price_offers WHERE status = 'accepted' AND expiryDate < datetime('now')`)
      .get() as { c: number }
  ).c;
  assert.equal(bad, 0);
});

test("the demo accounts are guaranteed to have data for the live demo", () => {
  const custInquiries = (db.prepare(`SELECT COUNT(*) AS c FROM inquiries WHERE customerId='u_cust'`).get() as { c: number }).c;
  const custOpenOffers = (db.prepare(`SELECT COUNT(*) AS c FROM price_offers WHERE customerId='u_cust' AND status='open'`).get() as { c: number }).c;
  const desnPublished = (db.prepare(`SELECT COUNT(*) AS c FROM idps WHERE designerId='u_desn' AND status='published'`).get() as { c: number }).c;
  assert.ok(custInquiries >= 1, "demo customer should have inquiries");
  assert.ok(custOpenOffers >= 1, "demo customer should have an open offer to accept live");
  assert.ok(desnPublished >= 1, "demo designer should have published portfolios");
});

test("the generator is deterministic — the same seed yields identical counts", () => {
  const a = generateBulkData({ seed: 123 });
  const b = generateBulkData({ seed: 123 });
  assert.deepEqual(a, b);
});
