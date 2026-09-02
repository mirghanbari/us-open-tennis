// Fetch + cache Tennismylife's per-year match archives, and parse them into a
// single chronological match list. Cached under .cache/ (gitignored) so repeat
// runs and the backtest don't re-download ~25MB.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, "..", "..", ".cache", "tml");

// Both tours come from the WEBSITE, not the GitHub mirror: the mirror's current
// year is stale (2026 stops in January there, but is complete on the site).
const url = (tour, year) =>
  tour === "atp"
    ? `https://stats.tennismylife.org/data/${year}.csv`
    : `https://stats.tennismylife.org/data/${year}_wta.csv`;

const UA = "Mozilla/5.0 (compatible; us-open-dashboard/1.0)";

async function fetchYear(tour, year, { refresh = false } = {}) {
  mkdirSync(join(CACHE, tour), { recursive: true });
  const file = join(CACHE, tour, `${year}.csv`);
  // Always re-fetch the current year; older years never change.
  const isCurrent = year >= new Date().getFullYear();
  if (existsSync(file) && !refresh && !isCurrent) return readFileSync(file, "utf8");
  try {
    const res = await fetch(url(tour, year), { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.startsWith("tourney_id")) throw new Error("not a CSV");
    writeFileSync(file, text);
    return text;
  } catch (err) {
    if (existsSync(file)) return readFileSync(file, "utf8");
    console.warn(`  ${tour} ${year}: ${err.message} (skipped)`);
    return null;
  }
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    header.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "20260830" → epoch ms. */
function toDate(v) {
  const s = String(v ?? "");
  if (s.length !== 8) return 0;
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
}

/**
 * Every match from `fromYear` to `toYear`, both tours, sorted chronologically.
 * Names are the join key throughout (there is no cross-source player id).
 */
export async function loadHistory(fromYear, toYear, opts = {}) {
  const out = [];
  for (const tour of ["atp", "wta"]) {
    for (let year = fromYear; year <= toYear; year++) {
      const text = await fetchYear(tour, year, opts);
      if (!text) continue;
      for (const r of parseCsv(text)) {
        const winner = r.winner_name;
        const loser = r.loser_name;
        if (!winner || !loser) continue;
        const svptW = num(r.w_svpt);
        const svptL = num(r.l_svpt);
        out.push({
          tour,
          date: toDate(r.tourney_date),
          year,
          tourney: r.tourney_name ?? "",
          level: r.tourney_level ?? "",
          surface: (r.surface || "").trim(),
          bestOf: num(r.best_of) ?? 3,
          round: r.round ?? "",
          winner,
          loser,
          winnerRank: num(r.winner_rank),
          loserRank: num(r.loser_rank),
          // Serve points won, each side. Null when the row carries no stats.
          wSvpt: svptW,
          lSvpt: svptL,
          wServeWon:
            svptW != null && num(r.w_1stWon) != null && num(r.w_2ndWon) != null
              ? num(r.w_1stWon) + num(r.w_2ndWon)
              : null,
          lServeWon:
            svptL != null && num(r.l_1stWon) != null && num(r.l_2ndWon) != null
              ? num(r.l_1stWon) + num(r.l_2ndWon)
              : null,
        });
      }
    }
  }
  out.sort((a, b) => a.date - b.date);
  return out;
}
