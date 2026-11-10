import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import "./styles.css";
import { SessionProvider, useSession } from "./session";
import { Browse } from "./pages/Browse";
import { IdpDetails } from "./pages/IdpDetails";
import { MyInquiries } from "./pages/MyInquiries";
import { Notifications } from "./pages/Notifications";
import { MyOffers } from "./pages/MyOffers";
import { DesignerStudio } from "./pages/DesignerStudio";
import { DesignerInbox } from "./pages/DesignerInbox";
import { ManagerReports } from "./pages/ManagerReports";

function TopBar() {
  const { users, current, setCurrentId } = useSession();
  const navigate = useNavigate();
  const role = current?.role ?? "customer";

  // When the active actor changes, return to Browse (every role can see it) so
  // the user never lands on a page that belongs to a different role.
  function switchActor(id: string) {
    setCurrentId(id);
    navigate("/browse");
  }

  // Navigation adapts to the active role so each actor sees their own features.
  const link = (to: string, label: string) => (
    <NavLink to={to} className={({ isActive }) => (isActive ? "active" : "")}>
      {label}
    </NavLink>
  );

  return (
    <div className="topbar">
      <div className="brand">
        ID<span>Match</span>
      </div>
      <nav className="nav">
        {link("/browse", "Browse")}
        {role === "customer" && link("/inquiries", "My Inquiries")}
        {role === "customer" && link("/notifications", "Notifications")}
        {role === "customer" && link("/offers", "My Offers")}
        {role === "designer" && link("/studio", "Design Studio")}
        {role === "designer" && link("/inbox", "Inbox & Quotes")}
        {role === "manager" && link("/reports", "Reports")}
      </nav>
      <div className="spacer" />
      <div className="role-switch">
        <span className="muted" style={{ fontSize: 13 }}>
          Acting as
        </span>
        <select value={current?.id ?? ""} onChange={(e) => switchActor(e.target.value)}>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.role})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function App() {
  return (
    <div className="app">
      <TopBar />
      <Routes>
        <Route path="/" element={<Navigate to="/browse" replace />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/idp/:id" element={<IdpDetails />} />
        <Route path="/inquiries" element={<MyInquiries />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/offers" element={<MyOffers />} />
        <Route path="/studio" element={<DesignerStudio />} />
        <Route path="/inbox" element={<DesignerInbox />} />
        <Route path="/reports" element={<ManagerReports />} />
        <Route path="*" element={<div className="empty">Page not found.</div>} />
      </Routes>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>
);
