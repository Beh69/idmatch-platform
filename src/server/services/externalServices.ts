// ---------------------------------------------------------------------------
// External service adapters.
//
// In the BCE sequence diagrams these appear as «boundary» classes that talk to
// real Singapore third-party systems (Singpass/MyInfo, an ETA e-signature
// provider, PaymentGateway for PayNow/NETS/card, IRAS tax reporting, HDB/BCA
// permit checks, renovation insurance, and an SMS/Email/Push provider).
//
// Each is modelled behind an interface so the controllers depend on the
// abstraction, not the stub. The stubs simulate realistic latency, success,
// and failure so the full ID05 chain executes end-to-end and alternate flows
// can be exercised deterministically via the `simulate` flags.
// ---------------------------------------------------------------------------

import { GST_RATE } from "../../shared/types.js";

export interface SimulationFlags {
  singpassFail?: boolean;
  unsigned?: boolean;
  paymentDecline?: boolean;
  hdbPermitFail?: boolean;
}

// --- Singpass / MyInfo identity verification -------------------------------
export interface IdentityVerifier {
  verify(custId: string, sim?: SimulationFlags): Promise<{ verified: boolean; maskedNric: string }>;
}
export const singpassMyInfo: IdentityVerifier = {
  async verify(_custId, sim) {
    await delay(40);
    if (sim?.singpassFail) return { verified: false, maskedNric: "" };
    // MyInfo returns a masked NRIC such as S****123A
    return { verified: true, maskedNric: "S****" + rand(100, 999) + "A" };
  },
};

// --- ETA-compliant e-signature service -------------------------------------
export interface ESignatureService {
  sendForSignature(contractId: string, sim?: SimulationFlags): Promise<{ bothSigned: boolean; envelopeId: string }>;
}
export const eSignatureService: ESignatureService = {
  async sendForSignature(_contractId, sim) {
    await delay(50);
    return { bothSigned: !sim?.unsigned, envelopeId: "ENV-" + rand(10000, 99999) };
  },
};

// --- Payment gateway (PayNow / NETS / Card) --------------------------------
export interface PaymentGateway {
  charge(amountSgd: number, method: string, sim?: SimulationFlags): Promise<{ approved: boolean; ref: string }>;
}
export const paymentGateway: PaymentGateway = {
  async charge(_amount, _method, sim) {
    await delay(60);
    if (sim?.paymentDecline) return { approved: false, ref: "" };
    return { approved: true, ref: "PAY-" + rand(100000, 999999) };
  },
};

// --- IRAS tax service ------------------------------------------------------
export interface TaxService {
  computeGst(amountSgd: number): number;
  reportToIras(gstSgd: number, invoiceNo: string): Promise<void>;
}
export const taxService: TaxService = {
  computeGst(amountSgd) {
    return round2(amountSgd * GST_RATE);
  },
  async reportToIras(_gstSgd, _invoiceNo) {
    await delay(20); // fire-and-forget filing to IRAS
  },
};

// --- HDB / BCA renovation-permit check -------------------------------------
export interface PermitService {
  checkStatus(bookingRef: string, sim?: SimulationFlags): Promise<string>;
}
export const hdbPermitService: PermitService = {
  async checkStatus(_ref, sim) {
    await delay(30);
    return sim?.hdbPermitFail ? "NOT_APPROVED" : "APPROVED";
  },
};

// --- Renovation insurance provider -----------------------------------------
export interface InsuranceProvider {
  registerProject(bookingId: string): Promise<{ insured: boolean; policyNo: string }>;
}
export const insuranceProvider: InsuranceProvider = {
  async registerProject(_bookingId) {
    await delay(25);
    return { insured: true, policyNo: "POL-" + rand(10000, 99999) };
  },
};

// --- SMS / Email / Push provider (ID02) ------------------------------------
export interface MessagingProvider {
  deliver(channel: string, content: string, failPrimary?: boolean): Promise<boolean>;
}
export const messagingProvider: MessagingProvider = {
  async deliver(channel, _content, failPrimary) {
    await delay(15);
    // Simulate the primary channel failing so the fallback path is exercised.
    if (failPrimary && channel !== "email") return false;
    return true;
  },
};

// --- helpers ---------------------------------------------------------------
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
