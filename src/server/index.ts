import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { initSchema, db } from "./db.js";
import { api } from "./routes.js";
import { runSeed } from "./seed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;

initSchema();

// Seed on first run so the app is immediately usable.
const seeded = (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c > 0;
if (!seeded) runSeed();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api", api);

// Serve the built client in production (dist/client).
const clientDir = join(__dirname, "../client");
if (existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get("*", (_req, res) => res.sendFile(join(clientDir, "index.html")));
}

app.listen(PORT, () => {
  console.log(`IDMatch API listening on http://localhost:${PORT}`);
});
