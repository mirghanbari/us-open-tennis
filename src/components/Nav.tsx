import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

const LINKS = [
  { to: "/", label: "Overview", end: true },
  { to: "/courts", label: "Courts", end: false },
  { to: "/schedule", label: "Schedule", end: false },
  { to: "/draw", label: "Draws", end: false },
  { to: "/matches", label: "Matches", end: false },
  { to: "/players", label: "Players", end: false },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close the menu whenever the route changes (e.g. after tapping a link).
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <header className="nav">
      <div className="nav-inner container">
        <NavLink to="/" className="brand" end onClick={() => setOpen(false)}>
          <span className="brand-ball">🎾</span>
          <span className="brand-text">
            US Open <strong>2026</strong>
          </span>
        </NavLink>

        <button
          className="nav-toggle"
          aria-label="Toggle navigation menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "✕" : "☰"}
        </button>

        <nav className={"nav-links" + (open ? " is-open" : "")}>
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => "nav-link" + (isActive ? " is-active" : "")}
              onClick={() => setOpen(false)}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
