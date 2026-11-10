# IDMatch — Interior-Design Matching Platform

A working full-stack web application implementing the eight user stories
**ID01–ID08**, built to match the Boundary–Control–Entity (BCE) UML design and
contextualised for Singapore (9% GST, Singpass/MyInfo, PayNow/NETS, PDPA,
HDB/BCA permits, UEN/CaseTrust, ETA e-signatures, IRAS, SGD).

## ▶️ Quick start (easiest & no install needed)

1. Install [Node.js](https://nodejs.org) 18 or newer (check with `node --version`).
2. Download this repo (green **Code** button → **Download ZIP**) and unzip it.
3. In a terminal, `cd` into the folder and run:
   ```bash
   node standalone.mjs
   ```
4. Open **http://localhost:4000** in your browser. Stop with **Ctrl + C**.

No `npm install`, no build step. Use the **"Acting as"** selector (top-right) to
switch between customer, designer and manager.

**For the live demo with a large dataset** (100+ records per data type), start it
in bulk mode instead:
```bash
BULK=1 node standalone.mjs        # macOS/Linux   (Windows: set BULK=1 && node standalone.mjs)
```

Full details including the full-build path and `npm run generate` — are in
[`RUNNING.md`](./RUNNING.md).

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + React Router |
| Backend | Node + Express + TypeScript |
| Database | SQLite (file-based, zero-config) via better-sqlite3 |
| External SG systems | Interface-driven adapter stubs (run end-to-end) |

## Run it

```bash
cd idmatch
npm install

# Development (two processes): API on :4000, Vite UI on :5173 (proxies /api)
npm run dev:server      # terminal 1
npm run dev:client      # terminal 2  → open http://localhost:5173

# Production (single process serving UI + API on :4000)
npm run build
npm start               # → open http://localhost:4000

# Reset demo data
npm run seed

# Run the end-to-end test suite (all 8 features, happy + alt flows)
npm test
```

On first boot the database is auto-seeded with three demo users (one per role),
a verified design firm, categories, published + draft portfolios, reviews, and a
week of historical activity so the manager report has data.

**Switch roles** using the "Acting as" selector in the top bar:
`Mei Ling Tan (customer)`, `Studio Lumen (designer)`, `Platform Admin (manager)`.
The navigation adapts to the active role.

## How the code maps to the BCE design

The backend layering mirrors the class / sequence diagrams exactly.

| Story | «control» class (`src/server/controllers`) | Key «entity» tables | «boundary» (external) |
|-------|--------------------------------------------|---------------------|------------------------|
| **ID01** Submit inquiry | `InquiryController` | `inquiries`, `audit_log` | — |
| **ID02** Reply notification | `NotificationController` | `notifications`, `channel_prefs` | `messagingProvider` (SMS/Email/Push) |
| **ID03** Weekly report | `ReportController` | `audit_log`, `payments` | `taxService` (IRAS) |
| **ID04** Request a price | `PriceRequestController` | `price_requests`, `price_offers`, `company_profiles` | — |
| **ID05** Accept an offer | `OfferAcceptanceController` | `price_offers`, `contracts`, `payments`, `bookings` | Singpass, ESignature, PaymentGateway, TaxService, HdbPermit, Insurance |
| **ID06** Preview before publish | `IDPController.checkCompleteness/publish` | `idps`, `photos`, `company_profiles` | — |
| **ID07** Create an IDP | `IDPController.createIDP/addPhoto/...` | `idps`, `photos`, `moderation_queue` | — |
| **ID08** View IDP details | `IDPController.viewDetails/dedupeView` | `idps`, `photos`, `reviews` | — |

The external SG systems appear as `«boundary»` classes in the sequence diagrams.
They live behind interfaces in `src/server/services/externalServices.ts` and are
implemented as realistic stubs so the full **ID05** chain runs end-to-end:

```
validateOffer → Singpass/MyInfo → e-signature (ETA) → 9% GST → payment
(PayNow/NETS/card) → IRAS report + tax invoice → HDB/BCA permit →
insurance → booking confirmed → notify designer
```

## Feature walkthrough (demo script)

1. **Customer** → *Browse* → open a portfolio (**ID08**; view count increments,
   deduped within 30 min). *Ask a question* (**ID01**; contact details masked for
   PDPA) and *Request a price* (**ID04**).
2. **Designer** → *Inbox & Quotes* → reply to the inquiry (fires **ID02** to the
   customer) and send a price offer.
3. **Customer** → *My Offers* → *Accept* (**ID05**). The full SG chain runs and
   the ordered trace + commission/GST/total are shown. Toggle the simulation
   chips to exercise alternate flows (Singpass fail, unsigned, payment declined,
   permit not approved).
4. **Designer** → *Design Studio* → *New portfolio* (**ID07**, 3-step wizard with
   virus scan + PDPA consent), then *Preview & publish* (**ID06**; publish is
   blocked until completeness, PDPA and UEN/CaseTrust checks all pass).
5. **Manager** → *Reports* → generate the weekly activity report (**ID03**) with
   sign-ups, listings, views, shortlists, inquiries and financials incl. 9% GST.

## Design-consistency notes

- Controller **method names** match the class diagrams (`submitInquiry`,
  `checkSpamLimit`, `acceptOffer`, `computeGst`, `checkCompleteness`,
  `dedupeView`, `generateReport`, …).
- Each controller implements the **alternate flows** from the use-case
  descriptions as typed errors mapped to HTTP status codes.
- GST is centralised at the Singapore rate (`GST_RATE = 0.09`) and applied via
  the `TaxService` boundary, consistent with ID05 and ID03.
```
