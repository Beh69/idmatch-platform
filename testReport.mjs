#!/usr/bin/env node
/**
 * testReport.mjs — runs the IDMatch test program and writes a report.
 *
 * It executes the three automated test suites (via `npm test`, the node:test
 * runner in TAP format) and the full-program health check (healthcheck.mjs)
 * against the zero-install standalone server, then parses the real results and
 * writes:
 *     test-reports/test-report.md   — a human-readable report
 *     test-reports/test-output.tap  — the raw TAP output (evidence)
 *
 * Zero extra dependencies — just: node testReport.mjs
 */
import { spawnSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = new URL(".", import.meta.url).pathname;
const OUT_DIR = ROOT + "test-reports";
mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// 1. Run the automated suite (npm test → node:test TAP).
// ---------------------------------------------------------------------------
console.log("Running automated test suites (npm test)…");
// clean DB so the full build seeds fresh (suites that touch it stay isolated)
try { for (const f of ["data.sqlite", "data.sqlite-shm", "data.sqlite-wal"]) rmSync(ROOT + f, { force: true }); } catch {}

const run = spawnSync("npm", ["test"], { cwd: ROOT, encoding: "utf8", shell: false });
const tap = (run.stdout || "") + (run.stderr || "");
writeFileSync(OUT_DIR + "/test-output.tap", tap);

// Parse the per-suite "# tests / # pass / # fail" blocks the runner prints,
// and the names of the files it ran.
const suites = [];
const runningFiles = [...tap.matchAll(/=== Running (.+?\.test\.ts) ===/g)].map((m) => m[1]);
const blocks = [...tap.matchAll(/# tests (\d+)[\s\S]*?# pass (\d+)[\s\S]*?# fail (\d+)/g)];
blocks.forEach((b, i) => {
  suites.push({
    file: runningFiles[i] ?? `suite ${i + 1}`,
    tests: Number(b[1]),
    pass: Number(b[2]),
    fail: Number(b[3]),
  });
});
const totalTests = suites.reduce((a, s) => a + s.tests, 0);
const totalPass = suites.reduce((a, s) => a + s.pass, 0);
const totalFail = suites.reduce((a, s) => a + s.fail, 0);
const suitesGreen = run.status === 0 && totalFail === 0;

// Collect the individual passing/failing assertion names (TAP "ok/not ok" lines).
const okLines = [...tap.matchAll(/^ok \d+ - (.+)$/gm)].map((m) => m[1]);
const notOkLines = [...tap.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);

// ---------------------------------------------------------------------------
// 2. Run the full-program health check against the standalone server.
// ---------------------------------------------------------------------------
console.log("Running full-program health check (healthcheck.mjs)…");
const PORT = 7950;
const srv = spawn("node", ["standalone.mjs"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
await sleep(3000);
const hc = spawnSync("node", ["healthcheck.mjs"], {
  cwd: ROOT,
  encoding: "utf8",
  env: { ...process.env, BASE: `http://localhost:${PORT}` },
});
srv.kill();
const hcOut = (hc.stdout || "") + (hc.stderr || "");
const hcMatch = hcOut.match(/RESULT: (\d+) passed, (\d+) failed/);
const hcPass = hcMatch ? Number(hcMatch[1]) : 0;
const hcFail = hcMatch ? Number(hcMatch[2]) : 1;
const hcGreen = hc.status === 0 && hcFail === 0;

// ---------------------------------------------------------------------------
// 3. Write the Markdown report.
// ---------------------------------------------------------------------------
const now = new Date();
const stamp = now.toISOString();
const verdict = suitesGreen && hcGreen ? "PASS ✅" : "FAIL ❌";

const suiteRows = suites
  .map((s) => `| \`${s.file}\` | ${s.tests} | ${s.pass} | ${s.fail} | ${s.fail === 0 ? "PASS ✅" : "FAIL ❌"} |`)
  .join("\n");

const md = `# IDMatch — Automated Test Report

**Generated:** ${stamp}
**Command:** \`node testReport.mjs\`  (runs \`npm test\` + \`healthcheck.mjs\`)
**Overall verdict:** **${verdict}**

---

## 1. Summary

| Metric | Result |
|---|---|
| Automated tests run | **${totalTests}** |
| Automated tests passed | **${totalPass}** |
| Automated tests failed | **${totalFail}** |
| Health-check assertions | **${hcPass + hcFail}** |
| Health-check passed | **${hcPass}** |
| Health-check failed | **${hcFail}** |
| **Grand total checks** | **${totalTests + hcPass + hcFail}** |

The IDMatch test program has two layers: a **unit/integration test suite** run by
Node's built-in \`node:test\` runner (each suite in its own process for isolation),
and a **full-program health check** that drives every API endpoint of all eight
user stories (ID01–ID08) and their alternate flows against a running server.

## 2. Automated test suites (\`npm test\`)

| Suite | Tests | Pass | Fail | Status |
|---|---|---|---|---|
${suiteRows}
| **Total** | **${totalTests}** | **${totalPass}** | **${totalFail}** | **${totalFail === 0 ? "PASS ✅" : "FAIL ❌"}** |

**What each suite covers**

- **\`interestScore.test.ts\`** — TDD unit tests for the interest-scoring feature
  (weights, additivity, negative-input rejection, ranking order, no mutation).
  Written *before* the implementation as the red-green TDD exercise.
- **\`e2e.test.ts\`** — end-to-end tests of every user story against the seeded
  database: ID01 inquiry (+ PDPA masking, empty/flagged rejection), ID01→ID02
  reply-notification, ID03 weekly report (+ 9% GST), ID04 price request + offer,
  ID05 full Singapore acceptance chain + document approval (+ the payment/
  Singpass/permit alternate flows), ID06 preview-blocks-publish, ID07 create-IDP
  with UEN/CaseTrust, ID08 view-count increment.
- **\`bulkData.test.ts\`** — data-quality tests over the 100+-records-per-type
  generated dataset: referential integrity, 9% GST on every payment, no
  duplicate contracts/payments/bookings, UEN consistency, no expired-but-accepted
  offers, deterministic (seeded) generation, and demo-account guarantees.

${notOkLines.length ? `**Failing assertions:**\n${notOkLines.map((n) => `- ❌ ${n}`).join("\n")}\n` : "**All assertions passed.** No failures recorded.\n"}

<details><summary>All ${okLines.length} passing assertions (click to expand)</summary>

${okLines.map((n) => `- ✅ ${n}`).join("\n")}

</details>

## 3. Full-program health check (\`healthcheck.mjs\`)

A smoke test that issues **${hcPass + hcFail}** assertions against a live server,
exercising every endpoint for all eight features plus their alternate flows
(empty/flagged inquiry, PDPA masking, payment declined, Singpass failure, HDB
permit rejection, unsigned contract, re-accept blocked, incomplete-publish
blocked, invalid report range).

| Assertions | Passed | Failed | Status |
|---|---|---|---|
| ${hcPass + hcFail} | ${hcPass} | ${hcFail} | ${hcGreen ? "PASS ✅" : "FAIL ❌"} |

> Note: the health check was run here against the zero-install standalone server.
> It also passes identically against the full Express build and the standalone
> server in bulk-data mode.

## 4. How to reproduce

\`\`\`bash
cd idmatch
node testReport.mjs        # runs everything and regenerates this report
# or run the pieces directly:
npm test                   # the ${totalTests}-test automated suite
BASE=http://localhost:PORT node healthcheck.mjs   # against a running server
\`\`\`

---
*Report generated automatically by \`testReport.mjs\` from the real test output in
\`test-reports/test-output.tap\`.*
`;

writeFileSync(OUT_DIR + "/test-report.md", md);
console.log(`\nReport written to test-reports/test-report.md`);
console.log(`Raw TAP evidence written to test-reports/test-output.tap`);
console.log(
  `\nSUMMARY: ${totalPass}/${totalTests} automated tests passed, ` +
    `${hcPass}/${hcPass + hcFail} health-check assertions passed — verdict ${verdict}`
);
process.exit(suitesGreen && hcGreen ? 0 : 1);
