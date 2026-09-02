// ---------------------------------------------------------------------------
// ingest-tml.mjs — per-match serve/return statistics from Tennismylife.
//
//   node scripts/ingest-tml.mjs      (run AFTER ingest-usopen.mjs)
//
// Why a THIRD source: neither of our others publishes match statistics. ESPN
// reports `statsSource: none` for tennis, and the official US Open draw feed
// carries only scores and durations. Tennismylife maintains the schema Jeff
// Sackmann's (now-404) tennis_atp/tennis_wta repos used, and exposes a live
// "ongoing tournaments" CSV per tour.
//
// Caveats, surfaced in the UI rather than hidden:
//   - Updated roughly daily, NOT live. A match finishing an hour ago usually
//     has no stats yet.
//   - The publisher states WTA data is less reliable than ATP.
//
// Joined on the winner/loser name pair rather than round codes: a given pair
// meets at most once in a tournament, so the pair alone is unambiguous and we
// avoid mapping TML's round vocabulary onto ours.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "src", "data");

const FEEDS = [
  { tour: "atp", url: "https://stats.tennismylife.org/data/ongoing_tourneys.csv" },
  { tour: "wta", url: "https://stats.tennismylife.org/data/wta_ongoing_tourneys.csv" },
];

const UA = "Mozilla/5.0 (compatible; us-open-dashboard/1.0)";

function norm(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Order-insensitive person key — the feeds disagree on name order. */
const personKey = (n) => norm(n).split(" ").filter(Boolean).sort().join(" ");

/** Unordered key for a pair of players. */
const pairKey = (a, b) => [personKey(a), personKey(b)].sort().join("|");

/**
 * Looser key: surnames only. Sources transliterate given names differently —
 * TML writes "Alexander Shevchenko" where the draw has "Aleksandr Shevchenko" —
 * which token-sorting cannot bridge. A surname pair is still unambiguous inside
 * one tournament, but only used when it resolves to exactly one match.
 */
const surname = (n) => {
  const parts = norm(n).split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
};
const loosePairKey = (a, b) => [surname(a), surname(b)].sort().join("|");

/** Minimal CSV parser — these files are plain, but names can contain commas. */
function parseCsv(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return rows;
  const header = lines[0].split(",");
  for (const line of lines.slice(1)) {
    const cells = [];
    let cur = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    const row = {};
    header.forEach((h, i) => (row[h.trim()] = (cells[i] ?? "").trim()));
    rows.push(row);
  }
  return rows;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Pull one side's serve line out of a TML row, given the "w" or "l" prefix. */
function sideStats(row, p) {
  const svpt = num(row[`${p}_svpt`]);
  const firstIn = num(row[`${p}_1stIn`]);
  const firstWon = num(row[`${p}_1stWon`]);
  const secondWon = num(row[`${p}_2ndWon`]);
  const bpFaced = num(row[`${p}_bpFaced`]);
  const bpSaved = num(row[`${p}_bpSaved`]);
  return {
    aces: num(row[`${p}_ace`]),
    doubleFaults: num(row[`${p}_df`]),
    servePoints: svpt,
    firstIn,
    firstWon,
    secondWon,
    serveGames: num(row[`${p}_SvGms`]),
    bpSaved,
    bpFaced,
    // Derived percentages, computed here so every consumer agrees on the maths.
    firstServePct: svpt && firstIn != null ? Math.round((firstIn / svpt) * 100) : null,
    firstWonPct: firstIn && firstWon != null ? Math.round((firstWon / firstIn) * 100) : null,
    secondWonPct:
      svpt != null && firstIn != null && secondWon != null && svpt - firstIn > 0
        ? Math.round((secondWon / (svpt - firstIn)) * 100)
        : null,
    bpSavedPct: bpFaced ? Math.round(((bpSaved ?? 0) / bpFaced) * 100) : null,
  };
}

async function main() {
  const matches = JSON.parse(readFileSync(join(DATA_DIR, "matches.json"), "utf8"));
  const meta = JSON.parse(readFileSync(join(DATA_DIR, "meta.json"), "utf8"));

  // Index our decided matches by unordered player-pair, plus a surname-only
  // fallback index that drops any key resolving to more than one match.
  const ours = new Map();
  const loose = new Map();
  for (const m of matches) {
    if (m.winner == null) continue;
    if (m.sides.some((s) => s.players.length !== 1)) continue; // singles only
    const a = m.sides[0].players[0].fullName;
    const b = m.sides[1].players[0].fullName;
    ours.set(pairKey(a, b), m);
    const lk = loosePairKey(a, b);
    loose.set(lk, loose.has(lk) ? null : m);
  }

  const stats = {};
  let rowsSeen = 0;
  let matched = 0;
  let looseJoins = 0;

  for (const { tour, url } of FEEDS) {
    let text;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (err) {
      console.warn(`  ${tour}: unavailable (${err.message}) — skipped`);
      meta.sources[`tml:${tour}`] = false;
      continue;
    }
    meta.sources[`tml:${tour}`] = true;

    const rows = parseCsv(text).filter((r) => /us open/i.test(r.tourney_name ?? ""));
    rowsSeen += rows.length;

    for (const row of rows) {
      let m = ours.get(pairKey(row.winner_name, row.loser_name));
      if (!m) {
        m = loose.get(loosePairKey(row.winner_name, row.loser_name)) ?? undefined;
        if (m) looseJoins++;
      }
      if (!m) continue;
      // Orient TML's winner/loser onto OUR side order.
      const winnerIsSide1 = m.winner === 1;
      const s1 = winnerIsSide1 ? sideStats(row, "w") : sideStats(row, "l");
      const s2 = winnerIsSide1 ? sideStats(row, "l") : sideStats(row, "w");
      // A row with no serve data at all is not worth storing.
      if (s1.servePoints == null && s2.servePoints == null) continue;
      matched++;
      stats[m.id] = { tour, minutes: num(row.minutes), sides: [s1, s2] };
    }
  }

  writeFileSync(join(DATA_DIR, "stats.json"), JSON.stringify(stats, null, 1) + "\n");
  meta.updated = new Date().toISOString();
  writeFileSync(join(DATA_DIR, "meta.json"), JSON.stringify(meta, null, 1) + "\n");

  console.log(
    `TML: ${rowsSeen} US Open rows → ${matched} matched ` +
      `(${looseJoins} via surname fallback) of ${ours.size} decided singles.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
