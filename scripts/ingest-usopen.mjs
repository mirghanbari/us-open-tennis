// ---------------------------------------------------------------------------
// ingest-usopen.mjs — rebuilds the draw/match dataset from the official
// US Open feeds. No API key required.
//
//   node scripts/ingest-usopen.mjs
//
// This is the SOURCE OF TRUTH for tournament structure: the bracket, seeds,
// courts, entry statuses, per-round prize money and final scores. ESPN has no
// tennis bracket endpoint at all, and its competition ids are scheduling order
// rather than draw order, so it cannot reconstruct a draw. ESPN's job is TV
// listings and live scores (see ingest-espn.mjs), not structure.
//
// IMPORTANT — host choice: use `www.usopen.org`. The `ashe.usopen.org` host
// serves the same paths but a STALE draw (zero completed matches, entrants from
// a different draw entirely). It fails silently, so it must not be used.
//
// Writes:
//   src/data/draws.json    per-event metadata + prize money tiers
//   src/data/matches.json  every match across every event, with bracket links
//   src/data/players.json  participants harvested from the draws (bios added
//                          later by ingest-espn.mjs, which merges into this file)
// ---------------------------------------------------------------------------
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "src", "data");

const YEAR = Number(process.env.US_OPEN_YEAR) || 2026;
const BASE = `https://www.usopen.org/en_US/scores/feeds/${YEAR}`;

// Men's doubles is published later than the rest; a 404 is expected early in the
// fortnight and must not fail the run.
const EVENTS = [
  { code: "MS", tour: "atp" },
  { code: "WS", tour: "wta" },
  { code: "MD", tour: "atp" },
  { code: "WD", tour: "wta" },
  { code: "XD", tour: "atp" },
];

const UA = "Mozilla/5.0 (compatible; us-open-dashboard/1.0)";

/**
 * A match_id is `{eventDigit}{roundIndex}{2-digit slot}` — e.g. "1101" is
 * men's singles, round 1, slot 1; "4401" is women's doubles, round 4 (its
 * quarter-final), slot 1.
 *
 * Crucially the round digit is 1-indexed *within that draw*, so it already
 * accounts for draw size: a 128 draw's quarter-final is round 5, a 64 draw's is
 * round 4, and the 16-pair mixed draw's is round 2. Reading the index straight
 * off the id is therefore both simpler and more general than mapping the round
 * codes ("1","2","3","4","Q","S","F") through a fixed table — that table is
 * only correct for a 128 draw, and silently mis-links every smaller one.
 */
function parseMatchId(matchId) {
  if (!/^\d{4}$/.test(matchId)) return null;
  return {
    prefix: matchId[0],
    roundIndex: Number(matchId[1]),
    slot: Number(matchId.slice(2)),
  };
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  // The site answers unknown feed paths with a 200-ish HTML error shell in some
  // edge cases, so verify we actually got JSON before trusting it.
  const text = await res.text();
  if (!text.trimStart().startsWith("{")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Map the feed's status code to our vocabulary.
 *   B = before (scheduled), A/actively playing = live, D = completed,
 *   E = retired, W = walkover.
 * Unknown codes fall back to the textual status, then to "scheduled", so a new
 * code shows up as an un-played match rather than crashing the build.
 */
function toStatus(statusCode, status) {
  switch (statusCode) {
    case "D":
      return "finished";
    case "E":
      return "retired";
    case "W":
      return "walkover";
    case "B":
      return "scheduled";
    default:
      if (/progress|playing|suspend/i.test(status || "")) return "live";
      if (/complet/i.test(status || "")) return "finished";
      return "scheduled";
  }
}

/** "140,000" → 140000. The feed ships prize money as a formatted string. */
function toAmount(money) {
  const n = Number(String(money ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build one side of a match. Doubles sides carry a second player in the
 * *NameB/idB fields; singles leave them null.
 */
function toSide(team) {
  if (!team) return { players: [], seed: null, entryStatus: null, setsWon: null, won: null };
  const players = [];
  if (team.idA) {
    players.push({
      id: team.idA,
      name: team.displayNameA ?? `${team.firstNameA ?? ""} ${team.lastNameA ?? ""}`.trim(),
      fullName: `${team.firstNameA ?? ""} ${team.lastNameA ?? ""}`.trim(),
      nation: team.nationA ?? "",
    });
  }
  if (team.idB) {
    players.push({
      id: team.idB,
      name: team.displayNameB ?? `${team.firstNameB ?? ""} ${team.lastNameB ?? ""}`.trim(),
      fullName: `${team.firstNameB ?? ""} ${team.lastNameB ?? ""}`.trim(),
      nation: team.nationB ?? "",
    });
  }
  return {
    players,
    seed: team.seed ?? null,
    entryStatus: team.entryStatus ?? null,
    setsWon: team.totalSetsWon ?? null,
    won: team.won ?? null,
  };
}

/** `scores.sets` is [[side1, side2], …] per set, each with score + tiebreak. */
function toSets(scores) {
  const sets = scores?.sets;
  if (!Array.isArray(sets)) return [];
  return sets
    .filter((s) => Array.isArray(s) && s.length === 2)
    .map((s) => ({
      games: [s[0]?.score ?? 0, s[1]?.score ?? 0],
      tiebreak:
        s[0]?.tiebreak != null || s[1]?.tiebreak != null
          ? [s[0]?.tiebreak ?? 0, s[1]?.tiebreak ?? 0]
          : null,
    }))
    // A not-yet-started set can appear as 0-0; drop trailing empties so the UI
    // doesn't render a phantom set.
    .filter((s, i, arr) => s.games[0] !== 0 || s.games[1] !== 0 || i < arr.length - 1);
}

/**
 * Derive the bracket links from the match_id.
 *
 * The winner of round r slot n advances into round r+1 slot ceil(n/2), and
 * round r slot n is fed by round r-1 slots 2n-1 and 2n. Verified against every
 * resolvable match in all four published draws.
 */
function bracketLinks(eventCode, prefix, roundIndex, slot, totalRounds) {
  const id = (r, s) => `${eventCode}-${prefix}${r}${String(s).padStart(2, "0")}`;
  return {
    feedsInto: roundIndex >= totalRounds ? null : id(roundIndex + 1, Math.ceil(slot / 2)),
    fedBy: roundIndex <= 1 ? null : [id(roundIndex - 1, slot * 2 - 1), id(roundIndex - 1, slot * 2)],
  };
}

async function main() {
  const draws = [];
  const matches = [];
  const playersById = new Map();
  const sources = {};

  for (const { code, tour } of EVENTS) {
    const feed = await getJson(`${BASE}/draws/${code}.json`);
    if (!feed || !Array.isArray(feed.matches)) {
      // Expected for MD early in the fortnight — record it and carry on.
      console.warn(`  ${code}: unavailable (skipped)`);
      sources[`draw:${code}`] = false;
      continue;
    }
    sources[`draw:${code}`] = true;

    const totalRounds = Number(feed.totalRounds) || 7;
    draws.push({
      eventCode: code,
      eventName: feed.eventName ?? code,
      drawSize: Number(feed.drawSize) || 0,
      totalRounds,
      prizeMoney: (feed.prizeMoney ?? []).map((p) => ({
        roundCode: p.roundCode,
        roundName: p.roundName,
        amount: toAmount(p.money),
      })),
    });

    for (const m of feed.matches) {
      const matchId = String(m.match_id);
      const parsed = parseMatchId(matchId);
      if (!parsed) {
        console.warn(`  ${code}: unparseable match_id ${matchId} (skipped)`);
        continue;
      }
      const { prefix, roundIndex, slot } = parsed;
      const { feedsInto, fedBy } = bracketLinks(code, prefix, roundIndex, slot, totalRounds);
      const sides = [toSide(m.team1), toSide(m.team2)];

      matches.push({
        id: `${code}-${matchId}`,
        matchId,
        eventCode: code,
        eventName: feed.eventName ?? code,
        tour,
        round: m.roundCode,
        roundName: m.roundName ?? "",
        roundIndex,
        slot,
        feedsInto,
        fedBy,
        court: m.courtName ?? null,
        courtId: m.courtId ?? null,
        eventDay: m.eventDay ?? null,
        epoch: m.epoch ?? null,
        status: toStatus(m.statusCode, m.status),
        statusCode: m.statusCode ?? "",
        duration: m.duration ?? null,
        setDurations: (m.scores?.setDurations ?? [])
          .map((d) => Number(d))
          .filter((d) => Number.isFinite(d) && d > 0),
        upset: Boolean(m.flags?.upset),
        sides,
        sets: toSets(m.scores),
        winner: m.winner === "1" ? 1 : m.winner === "2" ? 2 : null,
      });

      // Harvest participants. Seeds/entry live on the side, not the player, so
      // carry them across for singles (a doubles seed belongs to the pair).
      for (const side of sides) {
        const singles = code.length === 2 && code[1] === "S";
        for (const p of side.players) {
          if (!p.id || playersById.has(p.id)) continue;
          playersById.set(p.id, {
            id: p.id,
            name: p.name,
            fullName: p.fullName,
            nation: p.nation,
            tour: p.id.startsWith("wta") ? "wta" : "atp",
            seed: singles ? side.seed : null,
            entryStatus: singles ? side.entryStatus : null,
          });
        }
      }
    }
    console.log(`  ${code}: ${feed.matches.length} matches`);
  }

  if (matches.length === 0) {
    console.error("No draws could be fetched — leaving existing data untouched.");
    process.exit(1);
  }

  const meta = {
    year: YEAR,
    name: `US Open ${YEAR}`,
    venue: "USTA Billie Jean King National Tennis Center",
    city: "Flushing Meadows, New York",
    startDate: `${YEAR}-08-31`,
    endDate: `${YEAR}-09-13`,
    updated: new Date().toISOString(),
    sources,
  };

  mkdirSync(DATA_DIR, { recursive: true });
  const write = (file, data) =>
    writeFileSync(join(DATA_DIR, file), JSON.stringify(data, null, 1) + "\n");

  write("draws.json", draws);
  write("matches.json", matches);
  write("players.json", [...playersById.values()]);
  write("meta.json", meta);

  const done = matches.filter((m) => m.status === "finished" || m.status === "retired").length;
  console.log(
    `Wrote ${matches.length} matches across ${draws.length} draws ` +
      `(${done} completed), ${playersById.size} players.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
