// ---------------------------------------------------------------------------
// ingest-h2h.mjs — head-to-head records for matches that have two known sides.
//
//   node scripts/ingest-h2h.mjs      (run AFTER ingest-usopen.mjs)
//
// The official feed exposes one file per match, keyed by the SAME match_id the
// draws feed uses. (An apparent id mismatch during research turned out to be the
// stale `ashe.usopen.org` host — on `www` they line up.)
//
// Only fetched for undecided matches with both sides known: a completed match's
// H2H is of little interest, and this keeps the request count to the handful of
// matches actually coming up rather than all 332 every 20 minutes.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "src", "data");

const YEAR = Number(process.env.US_OPEN_YEAR) || 2026;
const BASE = `https://www.usopen.org/en_US/scores/feeds/${YEAR}`;
const UA = "Mozilla/5.0 (compatible; us-open-dashboard/1.0)";

async function getJson(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trimStart().startsWith("{")) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function pooled(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

async function main() {
  const matches = JSON.parse(readFileSync(join(DATA_DIR, "matches.json"), "utf8"));

  const wanted = matches.filter(
    (m) => m.sides.every((s) => s.players.length > 0) && m.winner == null
  );

  const results = await pooled(wanted, 6, async (m) => {
    const j = await getJson(`${BASE}/stats/head2head/${m.matchId}.json`);
    const p = j?.player?.[0];
    if (!p) return null;

    // The feed emits a single placeholder row (year "0") when the pair have
    // never met; treat that as an empty history rather than a meeting.
    const meetings = (p.results ?? [])
      .filter((r) => r.year && r.year !== "0")
      .map((r) => ({
        year: Number(r.year),
        tournament: r.tournamentName ?? "",
        surface: r.tournamentSurface ?? "",
        round: r.round ?? "",
        winner: r.winner ?? "",
        score: r.scores ?? "",
      }))
      .sort((a, b) => b.year - a.year);

    return [
      m.id,
      {
        player1: { id: p.player1Id, name: p.player1Name, wins: Number(p.player1Wins) || 0 },
        player2: { id: p.player2Id, name: p.player2Name, wins: Number(p.player2Wins) || 0 },
        meetings,
      },
    ];
  });

  const h2h = Object.fromEntries(results.filter(Boolean));
  writeFileSync(join(DATA_DIR, "headtohead.json"), JSON.stringify(h2h, null, 1) + "\n");

  const withHistory = Object.values(h2h).filter((v) => v.meetings.length > 0).length;
  console.log(
    `H2H: ${Object.keys(h2h).length} upcoming matches (${withHistory} with a prior meeting).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
