import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "../../data.sqlite");

// Single shared connection. WAL mode gives us safe concurrent reads.
export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------------------------------------------------------------------------
// Schema. Each table corresponds to an ENTITY class in the BCE class diagrams.
// ---------------------------------------------------------------------------
export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      nric TEXT,
      uen TEXT,
      caseTrust INTEGER
    );

    CREATE TABLE IF NOT EXISTS company_profiles (
      designerId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      uen TEXT NOT NULL,
      caseTrust INTEGER NOT NULL DEFAULT 0,
      logoUrl TEXT NOT NULL DEFAULT '',
      acceptingRequests INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idps (
      id TEXT PRIMARY KEY,
      designerId TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      propertyType TEXT NOT NULL,
      budgetRangeSgd TEXT NOT NULL,
      categoryId TEXT,
      status TEXT NOT NULL,
      viewCount INTEGER NOT NULL DEFAULT 0,
      shortlistCount INTEGER NOT NULL DEFAULT 0,
      services TEXT,
      createdDate TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      idpId TEXT NOT NULL,
      url TEXT NOT NULL,
      "order" INTEGER NOT NULL DEFAULT 0,
      format TEXT NOT NULL,
      consentConfirmed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      idpId TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS inquiries (
      id TEXT PRIMARY KEY,
      idpId TEXT NOT NULL,
      customerId TEXT NOT NULL,
      designerId TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      reply TEXT,
      customerFollowUp TEXT,
      thread TEXT,
      createdDate TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      customerId TEXT NOT NULL,
      channel TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      createdDate TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channel_prefs (
      customerId TEXT PRIMARY KEY,
      primaryChannel TEXT NOT NULL,
      fallbackChannel TEXT NOT NULL,
      pdpaConsent INTEGER NOT NULL DEFAULT 1,
      dndWindow TEXT
    );

    CREATE TABLE IF NOT EXISTS price_requests (
      id TEXT PRIMARY KEY,
      idpId TEXT NOT NULL,
      customerId TEXT NOT NULL,
      designerId TEXT NOT NULL,
      scope TEXT NOT NULL,
      propertyType TEXT NOT NULL,
      unitSizeSqft INTEGER NOT NULL,
      budgetRangeSgd TEXT NOT NULL,
      status TEXT NOT NULL,
      slaDeadline TEXT NOT NULL,
      createdDate TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_offers (
      id TEXT PRIMARY KEY,
      priceRequestId TEXT NOT NULL,
      idpId TEXT NOT NULL,
      customerId TEXT NOT NULL,
      designerId TEXT NOT NULL,
      amountSgd REAL NOT NULL,
      status TEXT NOT NULL,
      expiryDate TEXT NOT NULL,
      counterAmountSgd REAL
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      offerId TEXT NOT NULL,
      terms TEXT NOT NULL,
      signedByCustomer INTEGER NOT NULL DEFAULT 0,
      signedByDesigner INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      offerId TEXT NOT NULL,
      amountSgd REAL NOT NULL,
      commissionSgd REAL NOT NULL,
      gstSgd REAL NOT NULL,
      totalSgd REAL NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL,
      invoiceNo TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      offerId TEXT NOT NULL,
      customerId TEXT NOT NULL,
      designerId TEXT NOT NULL,
      status TEXT NOT NULL,
      insured INTEGER NOT NULL DEFAULT 0,
      permitVerified INTEGER NOT NULL DEFAULT 0,
      documents TEXT,
      stage TEXT,
      stageHistory TEXT,
      pendingConfirm TEXT,
      createdDate TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moderation_queue (
      id TEXT PRIMARY KEY,
      idpId TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      actorId TEXT,
      entityId TEXT,
      amountSgd REAL,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inquiry_rate (
      customerId TEXT NOT NULL,
      ts TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS view_dedupe (
      customerId TEXT NOT NULL,
      idpId TEXT NOT NULL,
      ts TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS favourites (
      customerId TEXT NOT NULL,
      idpId TEXT NOT NULL,
      PRIMARY KEY (customerId, idpId)
    );
  `);
}
