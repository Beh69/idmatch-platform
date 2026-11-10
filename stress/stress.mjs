// ---------------------------------------------------------------------------
// Stress / load test for the IDMatch API.
//
// Fires large volumes of concurrent requests at a running server and reports
// throughput (req/s), latency percentiles (p50/p90/p95/p99/max) and error rate.
// Covers read-heavy traffic (browse, search, view, weekly report) and the
// write-heavy ID04->ID05 transaction chain (request -> offer -> accept).
//
// Usage:  BASE=http://localhost:4900 node stress/stress.mjs
// ---------------------------------------------------------------------------
const BASE = process.env.BASE || "http://localhost:4900";

function pct(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
}

async function timed(fn) {
  const t0 = performance.now();
  try {
    const ok = await fn();
    return { ms: performance.now() - t0, ok };
  } catch {
    return { ms: performance.now() - t0, ok: false };
  }
}

// Run `total` tasks with a fixed `concurrency` ceiling (a worker pool).
async function runPool(total, concurrency, taskFactory) {
  const latencies = [];
  let errors = 0;
  let launched = 0;
  const t0 = performance.now();

  async function worker() {
    while (launched < total) {
      const i = launched++;
      const { ms, ok } = await timed(() => taskFactory(i));
      latencies.push(ms);
      if (!ok) errors++;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const wallMs = performance.now() - t0;
  latencies.sort((a, b) => a - b);
  return {
    total,
    concurrency,
    errors,
    wallMs,
    rps: (total / wallMs) * 1000,
    p50: pct(latencies, 50),
    p90: pct(latencies, 90),
    p95: pct(latencies, 95),
    p99: pct(latencies, 99),
    max: latencies[latencies.length - 1] || 0,
    mean: latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1),
  };
}

const get = async (p) => {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(String(r.status));
  await r.text();
  return true;
};
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const txt = await r.text();
  if (!r.ok) throw new Error(String(r.status) + " " + txt.slice(0, 80));
  return JSON.parse(txt);
};

function row(label, s) {
  const f = (n) => n.toFixed(1).padStart(8);
  console.log(
    `${label.padEnd(34)} | reqs ${String(s.total).padStart(6)} | conc ${String(s.concurrency).padStart(4)} | ` +
      `${f(s.rps)} rps | p50 ${f(s.p50)} | p95 ${f(s.p95)} | p99 ${f(s.p99)} | max ${f(s.max)} | err ${s.errors}`
  );
  return s;
}

async function main() {
  // discover published IDPs + a pool of DISTINCT customers so write-path tests
  // do not trip per-user guards (e.g. the ID01 5-inquiries/hour spam limit).
  const idps = await (await fetch(BASE + "/api/idps")).json();
  const idpId = idps[0].id;
  const users = await (await fetch(BASE + "/api/users")).json();
  const customers = users.filter((u) => u.role === "customer").map((u) => u.id);
  const idpIds = idps.map((i) => i.id);
  const custAt = (i) => customers[i % customers.length];
  const idpAt = (i) => idpIds[i % idpIds.length];
  console.log(`\nTarget: ${BASE}  (${idps.length} published portfolios, ${customers.length} customers)\n`);
  console.log("=".repeat(132));
  console.log("SCENARIO A — READ-HEAVY TRAFFIC (browse / search / view / report)");
  console.log("=".repeat(132));

  const results = {};

  // warm up
  await get("/api/idps");

  results.browse = row("GET /api/idps (browse listing)", await runPool(2000, 50, () => get("/api/idps")));
  results.search = row("GET /api/idps?q=Condo (search)", await runPool(2000, 50, () => get("/api/idps?q=Condo")));
  results.view = row("GET /api/idps/:id (view details)", await runPool(2000, 50, () => get(`/api/idps/${idpId}?custId=u_cust`)));
  results.cats = row("GET /api/categories", await runPool(2000, 50, () => get("/api/categories")));
  const wk = { weekStart: new Date(Date.now() - 14 * 864e5).toISOString(), weekEnd: new Date().toISOString() };
  results.report = row("POST /api/reports/weekly (ID03 agg)", await runPool(1000, 25, () => post("/api/reports/weekly", wk)));

  console.log("\n" + "=".repeat(132));
  console.log("SCENARIO B — CONCURRENCY SWEEP on the browse endpoint (find the knee)");
  console.log("=".repeat(132));
  const sweep = {};
  for (const c of [1, 10, 50, 100, 200, 400]) {
    sweep[c] = row(`browse @ concurrency ${c}`, await runPool(3000, c, () => get("/api/idps")));
  }

  console.log("\n" + "=".repeat(132));
  console.log("SCENARIO C — WRITE-HEAVY: full ID04->ID05 transaction chain (request -> offer -> accept)");
  console.log("=".repeat(132));
  // each task runs an entire renovation booking lifecycle end-to-end, as a
  // DISTINCT customer so the offer it creates is the one it accepts.
  async function fullChain(i) {
    const cust = custAt(i);
    const idp = idpAt(i);
    const req = await post("/api/price-requests", { custId: cust, idpId: idp, scope: "Full reno", propertyType: "Condominium", unitSizeSqft: 1100, budgetRangeSgd: "S$80k" });
    // the designer who owns this IDP must be the one to quote
    const offer = await post(`/api/price-requests/${req.id}/offer`, { designerId: req.designerId, amountSgd: 82000 });
    const res = await post(`/api/offers/${offer.id}/accept`, { custId: cust, method: "PayNow" });
    if (res.booking.status !== "confirmed") throw new Error("not confirmed");
    return true;
  }
  results.chain = row("full ID04->ID05 chain", await runPool(1000, 25, fullChain));

  // spread inquiries across many customers so the 5/hour spam limit is not hit
  results.inquiries = row("POST /api/inquiries (write)", await runPool(1500, 40, (i) =>
    post("/api/inquiries", { custId: custAt(i), idpId: idpAt(i), message: "Stress test inquiry " + Math.random() })
  ));

  console.log("\n" + "=".repeat(132));
  console.log("SUMMARY");
  console.log("=".repeat(132));
  const all = { ...results };
  const totalReqs = Object.values(all).reduce((a, s) => a + s.total, 0) + Object.values(sweep).reduce((a, s) => a + s.total, 0);
  const totalErrs = Object.values(all).reduce((a, s) => a + s.errors, 0) + Object.values(sweep).reduce((a, s) => a + s.errors, 0);
  const peakRps = Math.max(...Object.values(all).map((s) => s.rps), ...Object.values(sweep).map((s) => s.rps));
  console.log(`Total requests issued : ${totalReqs}`);
  console.log(`Total errors          : ${totalErrs}  (${((totalErrs / totalReqs) * 100).toFixed(3)}%)`);
  console.log(`Peak throughput       : ${peakRps.toFixed(0)} req/s`);
  console.log(`Read p95 (browse)     : ${results.browse.p95.toFixed(1)} ms`);
  console.log(`Write p95 (chain)     : ${results.chain.p95.toFixed(1)} ms`);

  // emit machine-readable JSON for the report
  const out = { reads: results, sweep, totals: { totalReqs, totalErrs, peakRps } };
  console.log("\nJSON_BEGIN" + JSON.stringify(out) + "JSON_END");
}

main().catch((e) => {
  console.error("stress failed:", e);
  process.exit(1);
});
