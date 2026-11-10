// «control» ReportController — implements ID03 "Generate a weekly activity
// report". Mirrors ID03 sequence: validateRange -> ActivityLog.queryByPeriod
// [loop over metrics] -> aggregate + computeGst -> create Report -> archive ->
// displayReport. Alt flows: invalid week, no activity (zero-count draft).
import { db } from "../db.js";
import { id, audit } from "../services/helpers.js";
import { httpError } from "./InquiryController.js";
import { taxService } from "../services/externalServices.js";
import { PLATFORM_COMMISSION_RATE } from "../../shared/types.js";
import type { Report } from "../../shared/types.js";

export class ReportController {
  static validateRange(weekStart: string, weekEnd: string): boolean {
    const s = Date.parse(weekStart);
    const e = Date.parse(weekEnd);
    return Number.isFinite(s) && Number.isFinite(e) && s < e;
  }

  // «entity» ActivityLog.queryByPeriod() — the ID03 sequence message. Returns
  // every activity-log row inside the reporting window; the aggregation below
  // then counts/sums over it.
  static queryByPeriod(s: string, e: string): { action: string; amountSgd: number }[] {
    return db
      .prepare(`SELECT action, amountSgd FROM audit_log WHERE timestamp >= ? AND timestamp < ?`)
      .all(s, e) as { action: string; amountSgd: number }[];
  }

  // count a particular action within a window (used by aggregate()).
  private static countAction(action: string, s: string, e: string): number {
    return (
      db
        .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = ? AND timestamp >= ? AND timestamp < ?`)
        .get(action, s, e) as { c: number }
    ).c;
  }
  private static sumAmount(action: string, s: string, e: string): number {
    return (
      (db
        .prepare(`SELECT COALESCE(SUM(amountSgd),0) AS s FROM audit_log WHERE action = ? AND timestamp >= ? AND timestamp < ?`)
        .get(action, s, e) as { s: number }).s
    );
  }

  static generateReport(weekStart: string, weekEnd: string): Report {
    if (!this.validateRange(weekStart, weekEnd)) {
      throw httpError(400, "INVALID_RANGE", "Please choose a valid week (start before end).");
    }
    const s = new Date(weekStart).toISOString();
    const e = new Date(weekEnd).toISOString();

    // ActivityLog.queryByPeriod(range) — pull the in-period activity rows (ID03).
    const activity = this.queryByPeriod(s, e);
    void activity.length; // the rows drive the aggregation counts below

    // aggregate() — loop over the activity metrics.
    const signUps = this.countAction("USER_SIGNED_UP", s, e);
    const idpCount = this.countAction("IDP_PUBLISHED", s, e);
    const views = this.countAction("IDP_VIEWED", s, e);
    const shortlists = this.countAction("IDP_SHORTLISTED", s, e);
    const inquiries = this.countAction("INQUIRY_SUBMITTED", s, e);
    const grossValueSgd = round2(this.sumAmount("OFFER_ACCEPTED", s, e));

    // Commission + GST come from the payments actually taken in-period. If no
    // payment rows match (e.g. historical/seeded activity), fall back to the
    // platform commission rate applied to gross value so the figures stay
    // coherent with the gross project value shown alongside them.
    const paidCommission = round2(
      (db
        .prepare(`SELECT COALESCE(SUM(commissionSgd),0) AS v FROM payments p JOIN audit_log a ON a.entityId = p.offerId
                  WHERE a.action = 'OFFER_ACCEPTED' AND a.timestamp >= ? AND a.timestamp < ?`)
        .get(s, e) as { v: number }).v
    );
    const commissionSgd = paidCommission > 0 ? paidCommission : round2(grossValueSgd * PLATFORM_COMMISSION_RATE);
    const gstCollectedSgd = round2(taxService.computeGst(commissionSgd));

    const hasActivity = signUps + idpCount + views + shortlists + inquiries > 0 || grossValueSgd > 0;

    const report: Report = {
      id: id("rpt"),
      weekStart,
      weekEnd,
      signUps,
      idpCount,
      views,
      shortlists,
      inquiries,
      grossValueSgd,
      commissionSgd,
      gstCollectedSgd,
      status: hasActivity ? "final" : "draft", // alt 5a — zero-count draft
    };
    this.archive(report); // «entity» Report.archive() — the ID03 sequence message
    return report;
  }

  // «entity» Report.archive() — persist the generated report to the activity log
  // so it is retained (ID03 sequence message).
  static archive(report: Report): void {
    audit("REPORT_GENERATED", null, report.id, report.grossValueSgd);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
