import { META } from "../data";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner container">
        <div>
          <strong>{META.name}</strong> · {META.venue}, {META.city}
        </div>
        <div className="tiny">
          Draws, seeds &amp; prize money from the{" "}
          <a href="https://www.usopen.org" target="_blank" rel="noreferrer">
            official US Open feed
          </a>
          ; live scores &amp; TV from{" "}
          <a href="https://www.espn.com/tennis/" target="_blank" rel="noreferrer">
            ESPN
          </a>
          . Data refreshed {fmt(META.updated)} ET.
        </div>
      </div>
    </footer>
  );
}
