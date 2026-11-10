# IDMatch — Automated Test Report

**Generated:** 2026-11-10T16:55:40.243Z
**Node version:** v22.23.4
**Command:** `node testReport.mjs`  (runs `npm test` + `healthcheck.mjs`)
**Overall verdict:** **PASS ✅**

---


## 1. Summary

| Metric | Result |
|---|---|
| Automated tests run | **43** |
| Automated tests passed | **43** |
| Automated tests failed | **0** |
| Health-check assertions | **41** |
| Health-check passed | **41** |
| Health-check failed | **0** |
| **Grand total checks that ran** | **84** |

The IDMatch test program has two layers: a **unit/integration test suite** run by
Node's built-in `node:test` runner (each suite in its own process for isolation),
and a **full-program health check** that drives every API endpoint of all eight
user stories (ID01–ID08) and their alternate flows against a running server.

## 2. Automated test suites (`npm test`)

| Suite | Tests | Pass | Fail | Status |
|---|---|---|---|---|
| `bulkData.test.ts` | 24 | 24 | 0 | PASS ✅ |
| `e2e.test.ts` | 11 | 11 | 0 | PASS ✅ |
| `interestScore.test.ts` | 8 | 8 | 0 | PASS ✅ |
| **Total (ran)** | **43** | **43** | **0** | **PASS ✅** |

**What each suite covers**

- **`interestScore.test.ts`** — TDD unit tests for the interest-scoring feature
  (weights, additivity, negative-input rejection, ranking order, no mutation).
  Written *before* the implementation as the red-green TDD exercise. **No native
  dependency — runs on any Node version.**
- **`e2e.test.ts`** — end-to-end tests of every user story against the seeded
  database: ID01 inquiry (+ PDPA masking, empty/flagged rejection), ID01→ID02
  reply-notification, ID03 weekly report (+ 9% GST), ID04 price request + offer,
  ID05 full Singapore acceptance chain + document approval (+ the payment/
  Singpass/permit alternate flows), ID06 preview-blocks-publish, ID07 create-IDP
  with UEN/CaseTrust, ID08 view-count increment.
- **`bulkData.test.ts`** — data-quality tests over the 100+-records-per-type
  generated dataset: referential integrity, 9% GST on every payment, no
  duplicate contracts/payments/bookings, UEN consistency, no expired-but-accepted
  offers, deterministic (seeded) generation, and demo-account guarantees.

**All assertions that ran passed.** No failures recorded.


<details><summary>All 43 passing assertions that ran (click to expand)</summary>

- ✅ generates at least 100 users records (got 231)
- ✅ generates at least 100 company_profiles records (got 110)
- ✅ generates at least 100 idps records (got 246)
- ✅ generates at least 100 photos records (got 729)
- ✅ generates at least 100 reviews records (got 244)
- ✅ generates at least 100 inquiries records (got 127)
- ✅ generates at least 100 notifications records (got 110)
- ✅ generates at least 100 channel_prefs records (got 120)
- ✅ generates at least 100 price_requests records (got 173)
- ✅ generates at least 100 price_offers records (got 145)
- ✅ generates at least 100 contracts records (got 110)
- ✅ generates at least 100 payments records (got 110)
- ✅ generates at least 100 bookings records (got 110)
- ✅ generates at least 100 audit_log records (got 400)
- ✅ every photo belongs to an existing IDP (referential integrity)
- ✅ every booking links to an accepted offer and real users
- ✅ every payment applies 9% GST on its commission
- ✅ the demo accounts (u_cust, u_desn, u_mgr) exist with correct roles
- ✅ there are published portfolios available to browse
- ✅ no offer has duplicate contracts / payments / bookings
- ✅ every designer's user UEN matches their company-profile UEN
- ✅ no accepted offer has an expiry date in the past (expired is never accepted)
- ✅ the demo accounts are guaranteed to have data for the live demo
- ✅ the generator is deterministic — the same seed yields identical counts
- ✅ seed exposes 3 roles
- ✅ ID08 — view a published IDP increments the view count
- ✅ ID01 — submit inquiry; empty + flagged are rejected
- ✅ ID01 PDPA — contact details are masked
- ✅ ID01 + ID02 — designer reply triggers a customer notification
- ✅ ID04 — price request validation + designer offer
- ✅ ID05 — accept offer runs the full SG chain, then designer approves docs
- ✅ ID05 alt — payment declined / Singpass fail / permit fail
- ✅ ID07 — create IDP requires UEN/CaseTrust; happy path creates a draft
- ✅ ID06 — preview blocks publish until complete, then publishes
- ✅ ID03 — weekly report aggregates activity + 9% GST
- ✅ score of zero activity is zero
- ✅ views only are counted at the view weight
- ✅ shortlists only are counted at the (heavier) shortlist weight
- ✅ views and shortlists combine additively
- ✅ a shortlist outweighs a single view
- ✅ negative inputs are rejected
- ✅ rankByInterest orders portfolios highest score first
- ✅ rankByInterest does not mutate the input array

</details>

## 3. Full-program health check (`healthcheck.mjs`)

A smoke test that issues **41** assertions against a live server,
exercising every endpoint for all eight features plus their alternate flows
(empty/flagged inquiry, PDPA masking, payment declined, Singpass failure, HDB
permit rejection, unsigned contract, re-accept blocked, incomplete-publish
blocked, invalid report range). It runs against the **zero-install standalone
server**, so it needs no native build and works on any Node version.

| Assertions | Passed | Failed | Status |
|---|---|---|---|
| 41 | 41 | 0 | PASS ✅ |

## 4. How to reproduce

```bash
cd idmatch
node testReport.mjs        # runs everything and regenerates this report
# or run the pieces directly:
npm test                   # the full 43-test automated suite (needs Node 20 LTS)
BASE=http://localhost:PORT node healthcheck.mjs   # against a running server
```

---
*Report generated automatically by `testReport.mjs` from the real test output in
`test-reports/test-output.tap`.*
