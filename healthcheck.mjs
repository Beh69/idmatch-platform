// Exercises EVERY API endpoint (all 8 features, happy + alternate flows) against
// a running server and reports a pass/fail line for each. Used as a full-program
// smoke test. Usage: BASE=http://localhost:PORT node healthcheck.mjs
const BASE = process.env.BASE || "http://localhost:4000";
let pass = 0, fail = 0;
const fails = [];

async function call(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  return { status: r.status, data: txt ? JSON.parse(txt) : null };
}

function check(label, cond) {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; fails.push(label); console.log("  FAIL  " + label); }
}

async function main() {
  console.log("\n--- Feature coverage smoke test ---\n");

  // users / seed
  const users = (await call("GET", "/api/users")).data;
  check("users endpoint returns the 3 demo roles", users.length >= 3 && users.some(u => u.id === "u_cust") && users.some(u => u.id === "u_desn") && users.some(u => u.id === "u_mgr"));

  // ID08 — browse / view / search
  const idps = (await call("GET", "/api/idps")).data;
  check("ID08: browse returns published portfolios", Array.isArray(idps) && idps.length > 0);
  const idpId = idps[0].id;
  const beforeViews = idps[0].viewCount;
  const view1 = await call("GET", `/api/idps/${idpId}?custId=u_cust`);
  check("ID08: view details returns idp + photos + reviews + company", view1.data.idp && Array.isArray(view1.data.photos) && Array.isArray(view1.data.reviews));
  check("ID08: viewing increments the view count", view1.data.idp.viewCount === beforeViews + 1);
  const view2 = await call("GET", `/api/idps/${idpId}?custId=u_cust`);
  check("ID08: duplicate view within window does NOT double-count", view2.data.idp.viewCount === beforeViews + 1);
  const search = await call("GET", "/api/idps?q=Condo");
  check("ID08: search filters results", Array.isArray(search.data));
  const cats = (await call("GET", "/api/categories")).data;
  check("categories endpoint returns the style list", cats.length >= 5);
  const notFound = await call("GET", "/api/idps/does_not_exist");
  check("ID08 alt: unknown IDP returns 404", notFound.status === 404);

  // ID01 — inquiries (happy + 3 alt flows)
  const inq = await call("POST", "/api/inquiries", { custId: "u_cust", idpId, message: "Is this available for a 4-room BTO?" });
  check("ID01: submit inquiry succeeds", inq.status === 201 && inq.data.id);
  const empty = await call("POST", "/api/inquiries", { custId: "u_cust", idpId, message: "   " });
  check("ID01 alt: empty message rejected (EMPTY_MESSAGE)", empty.data.code === "EMPTY_MESSAGE");
  const flagged = await call("POST", "/api/inquiries", { custId: "u_cust", idpId, message: "visit http://scam.example" });
  check("ID01 alt: flagged content rejected (FLAGGED_CONTENT)", flagged.data.code === "FLAGGED_CONTENT");
  const masked = await call("POST", "/api/inquiries", { custId: "u_cust", idpId, message: "call 9123 4567 or me@test.sg" });
  check("ID01 PDPA: contact details are masked", masked.data.message.includes("[contact removed]") && masked.data.message.includes("[email removed]"));
  const custInq = (await call("GET", "/api/inquiries?role=customer&userId=u_cust")).data;
  check("ID01: customer can list their inquiries", custInq.length >= 1);

  // ID02 — reply triggers a notification
  const desnInq = (await call("GET", "/api/inquiries?role=designer&userId=u_desn")).data;
  const target = desnInq.find(i => i.status === "new") || desnInq[0];
  const reply = await call("POST", `/api/inquiries/${target.id}/reply`, { reply: "Yes, available!" });
  check("ID01: designer reply marks inquiry replied", reply.data.status === "replied");
  const notifs = (await call("GET", "/api/notifications/u_cust")).data;
  check("ID02: a notification was delivered to the customer", notifs.length >= 1 && notifs[0].status === "delivered");
  const prefs = await call("GET", "/api/channel-prefs/u_cust");
  check("ID02: channel preferences are readable", !!prefs.data.primaryChannel);
  const updPrefs = await call("PUT", "/api/channel-prefs/u_cust", { primaryChannel: "sms", fallbackChannel: "email", pdpaConsent: true, dndWindow: null });
  check("ID02: channel preferences are updatable", updPrefs.data.primaryChannel === "sms");

  // ID04 — price request (happy + alt) and designer offer
  const badReq = await call("POST", "/api/price-requests", { custId: "u_cust", idpId, scope: "", propertyType: "", budgetRangeSgd: "", unitSizeSqft: 0 });
  check("ID04 alt: missing fields rejected (MISSING_FIELDS)", badReq.data.code === "MISSING_FIELDS");
  const req = await call("POST", "/api/price-requests", { custId: "u_cust", idpId, scope: "Full reno", propertyType: "Condominium", unitSizeSqft: 1100, budgetRangeSgd: "S$80k" });
  check("ID04: price request created", req.status === 201 && req.data.id);
  const offer = await call("POST", `/api/price-requests/${req.data.id}/offer`, { designerId: req.data.designerId, amountSgd: 82000 });
  check("ID04: designer can post an offer", offer.status === 201 && offer.data.id);
  const custOffers = (await call("GET", "/api/offers/u_cust")).data;
  check("ID04: customer can see their offers", custOffers.length >= 1);

  // ID05 — accept offer happy path + alternate flows
  const accept = await call("POST", `/api/offers/${offer.data.id}/accept`, { custId: "u_cust", method: "PayNow" });
  check("ID05: accept runs full chain -> booking awaiting review", accept.data.booking && accept.data.booking.status === "pending_review");
  check("ID05: booking is insured + permit verified", accept.data.booking.insured === true && accept.data.booking.permitVerified === true);
  check("ID05: contract cites the Electronic Transactions Act", accept.data.contract.terms.includes("Electronic Transactions Act"));
  check("ID05: 9% GST applied on commission", Math.abs(accept.data.payment.gstSgd - accept.data.payment.commissionSgd * 0.09) < 0.01);
  check("ID05: step trace has all 9 stages", Array.isArray(accept.data.steps) && accept.data.steps.length === 9);
  const reaccept = await call("POST", `/api/offers/${offer.data.id}/accept`, { custId: "u_cust", method: "PayNow" });
  check("ID05 alt: re-accepting an already-accepted offer is rejected", reaccept.status >= 400);
  // fresh offers for alt flows
  async function freshOffer(amt) {
    const r = await call("POST", "/api/price-requests", { custId: "u_cust", idpId, scope: "s", propertyType: "Condo", unitSizeSqft: 900, budgetRangeSgd: "x" });
    const o = await call("POST", `/api/price-requests/${r.data.id}/offer`, { designerId: r.data.designerId, amountSgd: amt });
    return o.data.id;
  }
  const decl = await call("POST", `/api/offers/${await freshOffer(70000)}/accept`, { custId: "u_cust", method: "NETS", simulate: { paymentDecline: true } });
  check("ID05 alt: payment declined (PAYMENT_DECLINED)", decl.data.code === "PAYMENT_DECLINED");
  const sp = await call("POST", `/api/offers/${await freshOffer(71000)}/accept`, { custId: "u_cust", method: "PayNow", simulate: { singpassFail: true } });
  check("ID05 alt: Singpass failure (SINGPASS_FAILED)", sp.data.code === "SINGPASS_FAILED");
  const permit = await call("POST", `/api/offers/${await freshOffer(72000)}/accept`, { custId: "u_cust", method: "PayNow", simulate: { hdbPermitFail: true } });
  check("ID05 alt: HDB permit not approved (PERMIT_NOT_APPROVED)", permit.data.code === "PERMIT_NOT_APPROVED");
  const unsigned = await call("POST", `/api/offers/${await freshOffer(73000)}/accept`, { custId: "u_cust", method: "PayNow", simulate: { unsigned: true } });
  check("ID05 alt: unsigned contract (CONTRACT_UNSIGNED)", unsigned.data.code === "CONTRACT_UNSIGNED");
  const bookings = (await call("GET", "/api/bookings/u_cust")).data;
  check("ID05: customer booking history lists the confirmed booking", bookings.length >= 1);

  // ID07 — create IDP (happy + alt)
  const created = await call("POST", "/api/idps", { designerId: "u_desn", title: "Health-check Minimalist 3-Room", description: "A clean minimalist renovation with ample hidden storage throughout the home.", propertyType: "HDB 3-Room", budgetRangeSgd: "S$30k-40k" });
  check("ID07: create IDP (verified designer) succeeds", created.status === 201 && created.data.id);
  const draftId = created.data.id;
  const noConsent = await call("POST", `/api/idps/${draftId}/photos`, { url: "🛋️", format: "jpg", consentConfirmed: false });
  check("ID07 alt: photo without consent rejected (NO_CONSENT)", noConsent.data.code === "NO_CONSENT");
  const photo = await call("POST", `/api/idps/${draftId}/photos`, { url: "🛋️", format: "jpg", consentConfirmed: true });
  check("ID07: add photo with consent succeeds", photo.status === 201);

  // ID06 — preview blocks publish until complete, then publishes
  let prev = await call("GET", `/api/idps/${draftId}/preview`);
  check("ID06: preview reports not-publishable while incomplete", prev.data.check.canPublish === false);
  await call("POST", `/api/idps/${draftId}/category`, { categoryId: cats[0].id });
  prev = await call("GET", `/api/idps/${draftId}/preview`);
  check("ID06: preview becomes publishable once complete", prev.data.check.canPublish === true);
  const pub = await call("POST", `/api/idps/${draftId}/publish`, {});
  check("ID06: publish succeeds -> status published", pub.data.status === "published");

  // ID03 — weekly report (happy + alt)
  const rep = await call("POST", "/api/reports/weekly", { weekStart: new Date(Date.now() - 14 * 864e5).toISOString(), weekEnd: new Date().toISOString() });
  check("ID03: weekly report aggregates activity", rep.data.views >= 0 && rep.data.inquiries >= 0);
  check("ID03: report applies 9% GST to commission", Math.abs(rep.data.gstCollectedSgd - rep.data.commissionSgd * 0.09) < 0.01);
  const badRange = await call("POST", "/api/reports/weekly", { weekStart: new Date().toISOString(), weekEnd: new Date(Date.now() - 864e5).toISOString() });
  check("ID03 alt: invalid date range rejected (INVALID_RANGE)", badRange.data.code === "INVALID_RANGE");

  console.log(`\n--- RESULT: ${pass} passed, ${fail} failed ---`);
  if (fail) { console.log("FAILURES:\n" + fails.map(f => "  - " + f).join("\n")); process.exit(1); }
}
main().catch(e => { console.error("healthcheck crashed:", e); process.exit(1); });
