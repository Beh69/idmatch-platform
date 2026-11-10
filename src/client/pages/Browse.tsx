import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { StatusTag } from "../components";
import { isImageUrl } from "../../shared/stockPhotos";
import type { IDP, Category } from "../../shared/types";

// Public browse / search over published IDPs (supports ID08 entry + interest
// tracking via view and shortlist counts).
export function Browse() {
  const [idps, setIdps] = useState<IDP[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");

  function load(query = q) {
    api.listIdps(query).then(setIdps);
  }
  useEffect(() => {
    load("");
    api.categories().then(setCats);
  }, []);

  const filtered = cat ? idps.filter((i) => i.categoryId === cat) : idps;

  return (
    <div>
      <div className="page-head">
        <h1>Find your interior designer</h1>
        <span className="muted">Singapore renovation portfolios</span>
      </div>

      <div className="section">
        <div className="row">
          <div style={{ flex: 3 }}>
            <label>Search portfolios</label>
            <input
              placeholder="e.g. Japandi, BTO, industrial, condo…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
            />
          </div>
          <div style={{ flex: 0, display: "flex", alignItems: "flex-end" }}>
            <button onClick={() => load()}>Search</button>
          </div>
        </div>
        <div className="chips">
          <span className={`chip ${cat === "" ? "active" : ""}`} onClick={() => setCat("")}>
            All
          </span>
          {cats.map((c) => (
            <span key={c.id} className={`chip ${cat === c.id ? "active" : ""}`} onClick={() => setCat(c.id)}>
              {c.name}
            </span>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">No portfolios match your search.</div>
      ) : (
        <div className="grid">
          {filtered.map((idp) => (
            <Link key={idp.id} to={`/idp/${idp.id}`} className="card" style={{ color: "inherit" }}>
              {idp.coverUrl && isImageUrl(idp.coverUrl) ? (
                <img className="thumb" src={idp.coverUrl} alt={idp.title} loading="lazy" />
              ) : (
                <div className="thumb">🏠</div>
              )}
              <div className="body">
                <h3>{idp.title}</h3>
                <div className="meta">
                  {idp.propertyType} · {idp.budgetRangeSgd}
                </div>
                <div className="meta" style={{ marginTop: 8 }}>
                  👁 {idp.viewCount} views · ⭐ {idp.shortlistCount} shortlists
                </div>
                <div style={{ marginTop: 10 }}>
                  <StatusTag status={idp.status} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
