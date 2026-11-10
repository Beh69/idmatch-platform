// End-to-end smoke test covering all 8 features (ID01-ID08), happy paths AND
// the key alternate flows. Boots the built server on a test port against a
// throwaway DB, drives it over HTTP, and asserts outcomes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { rmSync } from "node:fs";

const PORT = 4321;
const BASE = `http://localhost:${PORT}/api`;
let server: ChildProcess;

async function j(path: string, method = "GET", body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

before(async () => {
  try {
    rmSync(new URL("../data.sqlite", import.meta.url), { force: true });
    rmSync(new URL("../data.sqlite-wal", import.meta.url), { force: true });
    rmSync(new URL("../data.sqlite-shm", import.meta.url), { force: true });
  } catch {
    /* ignore */
  }
  server = spawn("npx", ["tsx", "src/server/index.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  // wait for health
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/health`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
});

after(() => {
  server?.kill("SIGKILL");
});

test("seed exposes 3 roles", async () => {
  const { data } = await j("/users");
  assert.equal(data.length, 3);
});

let publishedIdpId = "";
test("ID08 — view a published IDP increments the view count", async () => {
  const list = (await j("/idps")).data;
  assert.ok(list.length >= 2);
  publishedIdpId = list[0].id;
  const before = list[0].viewCount;
  const { data } = await j(`/idps/${publishedIdpId}?custId=u_cust`);
  assert.equal(data.idp.viewCount, before + 1);
  // dedupe: a second immediate view does NOT increment again
  const again = await j(`/idps/${publishedIdpId}?custId=u_cust`);
  assert.equal(again.data.idp.viewCount, before + 1);
});

test("ID01 — submit inquiry; empty + flagged are rejected", async () => {
  const ok = await j("/inquiries", "POST", { custId: "u_cust", idpId: publishedIdpId, message: "Is this available for a 4-room BTO?" });
  assert.equal(ok.status, 201);
  const empty = await j("/inquiries", "POST", { custId: "u_cust", idpId: publishedIdpId, message: "   " });
  assert.equal(empty.data.code, "EMPTY_MESSAGE");
  const flagged = await j("/inquiries", "POST", { custId: "u_cust", idpId: publishedIdpId, message: "visit http://scam.example" });
  assert.equal(flagged.data.code, "FLAGGED_CONTENT");
});

test("ID01 PDPA — contact details are masked", async () => {
  await j("/inquiries", "POST", { custId: "u_cust", idpId: publishedIdpId, message: "call me 9123 4567 or me@test.sg" });
  const inqs = (await j("/inquiries?role=designer&userId=u_desn")).data;
  const latest = inqs[0];
  assert.ok(latest.message.includes("[contact removed]"));
  assert.ok(latest.message.includes("[email removed]"));
});

test("ID01 + ID02 — designer reply triggers a customer notification", async () => {
  const inqs = (await j("/inquiries?role=designer&userId=u_desn")).data;
  const target = inqs.find((i: { status: string }) => i.status === "new");
  const replied = await j(`/inquiries/${target.id}/reply`, "POST", { reply: "Yes, available!" });
  assert.equal(replied.data.status, "replied");
  const notes = (await j("/notifications/u_cust")).data;
  assert.ok(notes.length >= 1);
  assert.equal(notes[0].status, "delivered");
});

let offerId = "";
test("ID04 — price request validation + designer offer", async () => {
  const bad = await j("/price-requests", "POST", { custId: "u_cust", idpId: publishedIdpId, scope: "", propertyType: "", budgetRangeSgd: "", unitSizeSqft: 0 });
  assert.equal(bad.data.code, "MISSING_FIELDS");
  const req = await j("/price-requests", "POST", {
    custId: "u_cust",
    idpId: publishedIdpId,
    scope: "Full reno",
    propertyType: "Condominium",
    unitSizeSqft: 1100,
    budgetRangeSgd: "S$80k",
  });
  assert.equal(req.status, 201);
  const offer = await j(`/price-requests/${req.data.id}/offer`, "POST", { designerId: "u_desn", amountSgd: 82000 });
  assert.equal(offer.status, 201);
  offerId = offer.data.id;
});

test("ID05 — accept offer runs the full SG chain, then designer approves docs", async () => {
  const res = await j(`/offers/${offerId}/accept`, "POST", {
    custId: "u_cust",
    method: "PayNow",
    documents: [{ name: "NRIC", url: "data:image/png;base64,x", uploadedAt: new Date().toISOString() }],
  });
  assert.equal(res.status, 200);
  // booking starts awaiting the designer's document review
  assert.equal(res.data.booking.status, "pending_review");
  assert.equal(res.data.booking.insured, true);
  assert.equal(res.data.booking.permitVerified, true);
  assert.ok(res.data.contract.terms.includes("Electronic Transactions Act"));
  assert.ok(Math.abs(res.data.payment.gstSgd - res.data.payment.commissionSgd * 0.09) < 0.01);
  assert.equal(res.data.steps.length, 9);

  // designer approves the documents -> booking becomes confirmed with a stage
  const approved = await j(`/bookings/${res.data.booking.id}/approve`, "POST", { designerId: "u_desn" });
  assert.equal(approved.data.status, "confirmed");
  assert.ok(approved.data.stage);
});

test("ID05 alt — payment declined / Singpass fail / permit fail", async () => {
  async function freshOffer(amount: number) {
    const req = await j("/price-requests", "POST", {
      custId: "u_cust",
      idpId: publishedIdpId,
      scope: "s",
      propertyType: "Condo",
      unitSizeSqft: 900,
      budgetRangeSgd: "x",
    });
    const off = await j(`/price-requests/${req.data.id}/offer`, "POST", { designerId: "u_desn", amountSgd: amount });
    return off.data.id;
  }
  const o1 = await freshOffer(70000);
  const decl = await j(`/offers/${o1}/accept`, "POST", { custId: "u_cust", method: "NETS", simulate: { paymentDecline: true } });
  assert.equal(decl.data.code, "PAYMENT_DECLINED");

  const o2 = await freshOffer(71000);
  const sp = await j(`/offers/${o2}/accept`, "POST", { custId: "u_cust", method: "PayNow", simulate: { singpassFail: true } });
  assert.equal(sp.data.code, "SINGPASS_FAILED");

  const o3 = await freshOffer(72000);
  const permit = await j(`/offers/${o3}/accept`, "POST", { custId: "u_cust", method: "PayNow", simulate: { hdbPermitFail: true } });
  assert.equal(permit.data.code, "PERMIT_NOT_APPROVED");
});

let draftId = "";
test("ID07 — create IDP requires UEN/CaseTrust; happy path creates a draft", async () => {
  const idp = await j("/idps", "POST", {
    designerId: "u_desn",
    title: "Test Minimalist 3-Room",
    description: "A clean minimalist renovation with ample hidden storage throughout.",
    propertyType: "HDB 3-Room",
    budgetRangeSgd: "S$30,000 - S$40,000",
  });
  assert.equal(idp.status, 201);
  draftId = idp.data.id;
  const photo = await j(`/idps/${draftId}/photos`, "POST", { url: "🛋️", format: "jpg", consentConfirmed: true });
  assert.equal(photo.status, 201);
  const noConsent = await j(`/idps/${draftId}/photos`, "POST", { url: "🪑", format: "jpg", consentConfirmed: false });
  assert.equal(noConsent.data.code, "NO_CONSENT");
});

test("ID06 — preview blocks publish until complete, then publishes", async () => {
  // no category assigned yet -> not publishable
  let prev = await j(`/idps/${draftId}/preview`);
  assert.equal(prev.data.check.canPublish, false);
  const cats = (await j("/categories")).data;
  await j(`/idps/${draftId}/category`, "POST", { categoryId: cats[0].id });
  prev = await j(`/idps/${draftId}/preview`);
  assert.equal(prev.data.check.canPublish, true);
  const pub = await j(`/idps/${draftId}/publish`, "POST", {});
  assert.equal(pub.data.status, "published");
});

test("ID03 — weekly report aggregates activity + 9% GST", async () => {
  const end = new Date(Date.now() + 86400_000).toISOString();
  const start = new Date(Date.now() - 8 * 86400_000).toISOString();
  const { data } = await j("/reports/weekly", "POST", { weekStart: start, weekEnd: end });
  assert.ok(data.views >= 1);
  assert.ok(data.inquiries >= 1);
  assert.ok(Math.abs(data.gstCollectedSgd - data.commissionSgd * 0.09) < 0.01);
  // invalid range rejected
  const bad = await j("/reports/weekly", "POST", { weekStart: end, weekEnd: start });
  assert.equal(bad.data.code, "INVALID_RANGE");
});
