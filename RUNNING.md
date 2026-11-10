# How to run IDMatch locally

There are two ways. **Option 1 is the easy one** — no build, no `npm install`,
no database setup. Use it if you just want to see the site working.

---

## ✅ Option 1 — Easy mode (recommended)

**Requirement:** only [Node.js](https://nodejs.org) version 18 or newer.
Check with:

```bash
node --version
```

If that prints `v18`, `v20`, `v22`, etc., you're ready. If it errors or shows
something older, install the **LTS** build from https://nodejs.org first.

**Then, from inside the project folder, run a single command:**

```bash
node standalone.mjs
```

Open your browser to **http://localhost:4000**.

That's it — no `npm install`, no `npm run build`. The standalone server uses only
Node's built-in features, keeps its data in memory, and serves the pre-built
website that's already included in the repo (`dist/client`).

### 📊 For the live demo — load the large dataset

By default the server starts with a small, curated demo set (3 users). For the
**product demonstration**, start it in bulk mode to load 100+ records per data
type (hundreds of portfolios, inquiries, offers, bookings, etc.):

```bash
BULK=1 node standalone.mjs          # macOS / Linux
```
```bat
set BULK=1 && node standalone.mjs   :: Windows Command Prompt
```
```powershell
$env:BULK=1; node standalone.mjs    # Windows PowerShell
```

Then open **http://localhost:4000**. Log in (top-right selector) as
**Mei Ling Tan (customer)** — she has inquiries and an open price offer ready to
accept — or **Studio Lumen (designer)**, who owns several published portfolios.
The dataset is seeded deterministically, so it is the same every time you run it.

Stop the server with **Ctrl + C**.

> If port 4000 is busy, pick another:
> `PORT=4001 node standalone.mjs` (macOS/Linux) or
> `set PORT=4001 && node standalone.mjs` (Windows Command Prompt), then open
> http://localhost:4001.

---

## Option 2 — Full developer setup (only if you want to edit the code)

This uses the full TypeScript source with live reload. It needs `npm install`.

```bash
npm install          # installs dependencies (needs internet)
npm run build        # compiles the frontend + backend
npm start            # serves everything on http://localhost:4000
```

Or, for live-reload while editing (two terminals):

```bash
npm run dev:server   # terminal 1 — backend on :4000
npm run dev:client   # terminal 2 — frontend on :5173  ← open this one
```

### Load the large demo dataset (full build)

```bash
npm run generate     # seeds the SQLite database with 100+ records per data type
npm start            # then serve it
```

`npm run generate` is deterministic (fixed seed), so the dataset is identical on
every run — handy for rehearsing the demo.

> ⚠️ Note: `npm test` resets the database (the test suites seed their own data).
> If you want to keep a generated demo dataset, run `npm run generate` **after**
> running the tests, not before.

Run the automated tests:

```bash
npm test             # 43 tests across 3 files
```

### If `npm install` fails or `vite: command not found`

That means dependencies didn't install — `vite` lives inside `node_modules`,
which only exists after a successful `npm install`. Fixes, in order:

1. Make sure `node --version` is **18+**. If not, update Node and retry.
2. Clean and reinstall:
   ```bash
   # macOS / Linux
   rm -rf node_modules package-lock.json && npm install
   # Windows PowerShell
   Remove-Item -Recurse -Force node_modules, package-lock.json ; npm install
   ```
3. Still stuck? **Just use Option 1** (`node standalone.mjs`) — it needs none of
   this.

---

## Using the app (both options)

Use the **"Acting as"** selector at the top-right to switch between the three
roles. The navigation changes to match each role.

| Acting as | What you can do | Stories |
|-----------|-----------------|---------|
| **Mei Ling Tan (customer)** | Browse & view portfolios, ask questions, request prices, accept offers, see notifications | ID08, ID01, ID04, ID05, ID02 |
| **Studio Lumen (designer)** | Create portfolios, preview & publish, reply to inquiries, send quotes | ID07, ID06, ID01, ID04 |
| **Platform Admin (manager)** | Generate the weekly activity report | ID03 |

**Best end-to-end demo:**
1. As **customer** → open a portfolio → *Request a price*.
2. Switch to **designer** → *Inbox & Quotes* → send an offer.
3. Switch back to **customer** → *My Offers* → **Accept** and watch the full
   Singapore completion chain (Singpass → e-signature → 9% GST → payment →
   IRAS invoice → HDB permit → insurance → booking). Toggle the simulation
   chips to see alternate flows (payment declined, Singpass fails, etc.).
