import { useState } from "react";
import { api } from "../api";
import { Alert, StatusTag, useAsync, sgd } from "../components";
import type { Report } from "../../shared/types";

// ID03 — Platform Manager generates a weekly activity report. Defaults to the
// last 7 days; aggregates sign-ups, listings, views, shortlists, inquiries and
// computes gross value / commission / 9% GST collected.
export function ManagerReports() {
  const today = new Date();
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const [weekStart, setWeekStart] = useState(fmt(weekAgo));
  const [weekEnd, setWeekEnd] = useState(fmt(today));
  const [report, setReport] = useState<Report | null>(null);
  const { busy, err, run } = useAsync();

  function generate() {
    run(async () => {
      const r = await api.weeklyReport(new Date(weekStart).toISOString(), new Date(weekEnd + "T23:59:59").toISOString());
      setReport(r);
    });
  }

  return (
    <div>
      <div className="page-head">
        <h1>Weekly Activity Report</h1>
        <span className="tag id">ID03</span>
      </div>

      <div className="section">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div>
            <label>Week start</label>
            <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
          </div>
          <div>
            <label>Week end</label>
            <input type="date" value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} />
          </div>
          <div style={{ flex: 0 }}>
            <button disabled={busy} onClick={generate}>
              {busy ? "Generating…" : "Generate report"}
            </button>
          </div>
        </div>
        <Alert kind="err">{err}</Alert>
      </div>

      {report && (
        <div className="section">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <h2 style={{ margin: 0 }}>
              {new Date(report.weekStart).toLocaleDateString("en-SG")} – {new Date(report.weekEnd).toLocaleDateString("en-SG")}
            </h2>
            <StatusTag status={report.status} />
            {report.status === "draft" && <span className="muted">(no activity in range)</span>}
          </div>

          <div className="kpi">
            <Kpi n={report.signUps} l="New sign-ups" />
            <Kpi n={report.idpCount} l="IDPs published" />
            <Kpi n={report.views} l="Portfolio views" />
            <Kpi n={report.shortlists} l="Shortlists" />
            <Kpi n={report.inquiries} l="Inquiries" />
          </div>

          <h3 style={{ marginTop: 22 }}>Financials (SGD)</h3>
          <div className="kpi">
            <Kpi n={sgd(report.grossValueSgd)} l="Gross project value" />
            <Kpi n={sgd(report.commissionSgd)} l="Platform commission" />
            <Kpi n={sgd(report.gstCollectedSgd)} l="GST collected (9%)" />
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ n, l }: { n: number | string; l: string }) {
  return (
    <div className="box">
      <div className="n">{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
