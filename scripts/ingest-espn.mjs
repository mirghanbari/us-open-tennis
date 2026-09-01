// ---------------------------------------------------------------------------
// ingest-espn.mjs — enriches the official dataset with the things ESPN has and
// the US Open feed does not. No API key required.
//
//   node scripts/ingest-espn.mjs      (run AFTER ingest-usopen.mjs)
//
// ESPN contributes three things:
//   1. US TV / streaming carriers per match (geoBroadcasts) — absent from the
//      official feed entirely.
//   2. An `espnId` on each match, so the BROWSER can poll ESPN directly for
//      live scores. ESPN sends `access-control-allow-origin: *` and the whole
//      239-match payload is ~99KB gzipped, so the client goes straight to the
//      source instead of us redeploying the site every time a score changes.
//   3. Player bios (hand, height, DOB, birthplace) and ATP/WTA rankings.
//
// What ESPN deliberately is NOT used for: draw structure. It has no bracket
// endpoint, and its competition ids are scheduling order rather than draw
// order, so the official feed owns the bracket (see ingest-usopen.mjs).
//
// Bios are only fetched for players we don't already have one for — they never
// change, so the 20-minute CI cadence costs almost nothing in steady state.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "src", "data");

const SITE = "https://site.api.espn.com/apis/site/v2/sports/tennis";
const CORE = "https://sports.core.api.espn.com/v2/sports/tennis/leagues";
const TOURS = ["atp", "wta"];

/** ESPN's grouping slugs → our event codes. */
const EVENT_BY_SLUG = {
  "mens-singles": "MS",
  "womens-singles": "WS",
  "mens-doubles": "MD",
  "womens-doubles": "WD",
  "mixed-doubles": "XD",
};

/** Strip diacritics and punctuation so "Carballés Baena" == "Carballes Baena". */
function norm(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Last token of a normalized name — the fallback join key. */
function surname(name) {
  const parts = norm(name).split(" ");
  return parts[parts.length - 1] ?? "";
}

/**
 * Normalize a single person's name to an order-insensitive key by sorting its
 * tokens. The two feeds disagree on given/family name order for several players
 * — the official draw lists "Yunchaokete Bu" where ESPN has "Bu Yunchaokete" —
 * which silently cost us ~13 singles joins. Sorting tokens makes both sides
 * agree without a hand-maintained alias table.
 */
function personKey(name) {
  return norm(name).split(" ").filter(Boolean).sort().join(" ");
}

/**
 * A side's join key: its players' order-insensitive name keys, sorted, joined.
 * ESPN models a doubles pair as ONE competitor with a combined name, so split
 * on the separators it uses before normalizing.
 */
function sideKey(names) {
  return names
    .flatMap((n) => String(n ?? "").split(/\s*[/&]\s*/))
    .map(personKey)
    .filter(Boolean)
    .sort()
    .join("+");
}

function sideSurnameKey(names) {
  return names
    .flatMap((n) => String(n ?? "").split(/\s*[/&]\s*/))
    .map(surname)
    .filter(Boolean)
    .sort()
    .join("+");
}

async function getJson(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "us-open-dashboard/1.0" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Resolve `tasks` with a small concurrency cap so we don't hammer ESPN. */
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

function toBroadcasts(comp) {
  const seen = new Map();
  for (const b of comp.geoBroadcasts ?? []) {
    const name = b.media?.shortName;
    if (!name || seen.has(name)) continue;
    // ESPN's type id 1 is TV; everything else here is a streaming product.
    seen.set(name, { name, type: b.type?.shortName === "TV" ? "tv" : "stream" });
  }
  return [...seen.values()];
}

async function main() {
  const matches = JSON.parse(readFileSync(join(DATA_DIR, "matches.json"), "utf8"));
  const players = JSON.parse(readFileSync(join(DATA_DIR, "players.json"), "utf8"));
  const meta = JSON.parse(readFileSync(join(DATA_DIR, "meta.json"), "utf8"));

  // ---- 1. Index every ESPN competition by event + side keys ----------------
  /** @type {Map<string, {id:string, broadcasts:any[], competitorIds:string[], names:string[][]}>} */
  const exact = new Map();
  const loose = new Map();
  let espnComps = 0;

  // ESPN's atp and wta scoreboards return IDENTICAL payloads for a Slam — all
  // five draws appear under both (verified: 625 competitions each, zero
  // difference). So fetch ONE, falling back to the other only if it fails.
  // Indexing both would double-insert every competition, which makes each
  // surname key look ambiguous and silently disables the fallback join.
  let event = null;
  for (const tour of TOURS) {
    const board = await getJson(`${SITE}/${tour}/scoreboard`);
    meta.sources[`espn:${tour}`] = Boolean(board?.events?.[0]);
    if (board?.events?.[0]) {
      event = board.events[0];
      break;
    }
    console.warn(`  ${tour}: scoreboard unavailable, trying next`);
  }

  if (!event) {
    console.warn("  ESPN scoreboard unavailable — keeping existing TV/espnId data.");
  } else {
    for (const grouping of event.groupings ?? []) {
      const eventCode = EVENT_BY_SLUG[grouping.grouping?.slug];
      if (!eventCode) continue;
      for (const comp of grouping.competitions ?? []) {
        const sides = (comp.competitors ?? []).map((c) => [c.athlete?.displayName]);
        const ids = (comp.competitors ?? []).map((c) => String(c.id));
        // Unresolved bracket slots are literal "TBD" — nothing to join on.
        if (sides.flat().some((n) => !n || n === "TBD")) continue;
        espnComps++;
        const rec = {
          id: String(comp.id),
          broadcasts: toBroadcasts(comp),
          competitorIds: ids,
          names: sides,
          // ESPN publishes a start time for UPCOMING matches; the official draw
          // feed sets its own `epoch` only once a match has been played. This is
          // the only free source of an order of play.
          startEpoch: comp.date ? Date.parse(comp.date) : null,
          court: comp.venue?.court ?? null,
        };
        const pair = sides.map((s) => sideKey(s)).sort().join("|");
        const loosePair = sides.map((s) => sideSurnameKey(s)).sort().join("|");
        exact.set(`${eventCode}|${pair}`, rec);
        // Only keep an unambiguous loose key — two different matches sharing a
        // surname pair must not silently join to the wrong one.
        const lk = `${eventCode}|${loosePair}`;
        loose.set(lk, loose.has(lk) ? null : rec);
      }
    }
  }

  // ---- 2. Join onto our matches -------------------------------------------
  /** our player id → ESPN athlete id, harvested from singles joins */
  const espnAthleteId = new Map();
  let joined = 0;
  let looseJoins = 0;

  for (const m of matches) {
    const sides = m.sides.map((s) => s.players.map((p) => p.fullName));
    if (sides.flat().length === 0) continue;
    const pair = sides.map((s) => sideKey(s)).sort().join("|");
    let hit = exact.get(`${m.eventCode}|${pair}`);
    if (!hit) {
      const loosePair = sides.map((s) => sideSurnameKey(s)).sort().join("|");
      hit = loose.get(`${m.eventCode}|${loosePair}`) ?? undefined;
      if (hit) looseJoins++;
    }
    if (!hit) continue;
    joined++;
    m.espnId = hit.id;
    if (hit.broadcasts.length) m.broadcasts = hit.broadcasts;
    if (hit.startEpoch) m.startEpoch = hit.startEpoch;
    // The official feed can lag on court assignments for upcoming matches.
    if (!m.court && hit.court) m.court = hit.court;

    // Align ESPN's competitors to OUR side order and store the ids. ESPN's
    // home/away ordering does not track the draw's team1/team2, so resolving it
    // here — once, at ingest — saves the browser from re-matching names on every
    // poll and keeps live patches from landing on the wrong side.
    const espnSideIds = m.sides.map((s) => {
      const key = sideKey(s.players.map((p) => p.fullName));
      const i = hit.names.findIndex((n) => sideKey(n) === key);
      return i >= 0 ? hit.competitorIds[i] : null;
    });
    // Only trust it when both sides resolved unambiguously.
    if (espnSideIds.every(Boolean) && espnSideIds[0] !== espnSideIds[1]) {
      m.espnSideIds = espnSideIds;
      if (m.sides.every((s) => s.players.length === 1)) {
        m.sides.forEach((s, i) => espnAthleteId.set(s.players[0].id, espnSideIds[i]));
      }
    }
  }

  // ---- 3. Rankings ---------------------------------------------------------
  const rankByName = new Map();
  for (const tour of TOURS) {
    const data = await getJson(`${SITE}/${tour}/rankings`);
    const ranks = data?.rankings?.[0]?.ranks ?? [];
    for (const r of ranks) {
      const key = norm(r.athlete?.displayName);
      if (!key) continue;
      rankByName.set(key, {
        rank: r.current,
        rankPoints: r.points,
        rankTrend: r.trend,
      });
    }
    meta.sources[`espn:rankings:${tour}`] = ranks.length > 0;
  }

  // ---- 4. Bios for players we don't have one for --------------------------
  const needBio = players.filter((p) => !p.hand && espnAthleteId.has(p.id));
  const fetched = await pooled(needBio, 6, async (p) => {
    const tour = p.tour === "wta" ? "wta" : "atp";
    const a = await getJson(`${CORE}/${tour}/athletes/${espnAthleteId.get(p.id)}`);
    return a ? [p.id, a] : null;
  });
  const bios = new Map(fetched.filter(Boolean));

  let bioCount = 0;
  for (const p of players) {
    const r = rankByName.get(norm(p.fullName));
    if (r) Object.assign(p, r);

    const espnId = espnAthleteId.get(p.id);
    if (espnId) p.espnId = espnId;

    const a = bios.get(p.id);
    if (!a) continue;
    bioCount++;
    if (a.hand?.type || a.hand?.abbreviation) {
      const h = String(a.hand.abbreviation ?? a.hand.type)[0]?.toUpperCase();
      if (h === "R" || h === "L") p.hand = h;
    }
    if (Number.isFinite(a.height)) p.heightCm = Math.round(a.height * 2.54);
    if (Number.isFinite(a.weight)) p.weightKg = Math.round(a.weight * 0.453592);
    if (a.dateOfBirth) p.dateOfBirth = a.dateOfBirth;
    if (Number.isFinite(a.age)) p.age = a.age;
    if (a.birthPlace?.displayText) p.birthPlace = a.birthPlace.displayText;
    else if (a.birthPlace?.country) p.birthPlace = a.birthPlace.country;
    if (Number.isFinite(a.debutYear)) p.turnedPro = a.debutYear;
  }

  meta.updated = new Date().toISOString();

  const write = (file, data) =>
    writeFileSync(join(DATA_DIR, file), JSON.stringify(data, null, 1) + "\n");
  write("matches.json", matches);
  write("players.json", players);
  write("meta.json", meta);

  const scheduled = matches.filter((m) => m.startEpoch).length;
  const withTv = matches.filter((m) => m.broadcasts?.length).length;
  const ranked = players.filter((p) => p.rank != null).length;
  console.log(
    `ESPN: ${espnComps} resolvable competitions → joined ${joined}/${matches.length} matches ` +
      `(${looseJoins} via surname fallback), ${withTv} with TV, ${scheduled} with a start time.\n` +
      `      ${ranked}/${players.length} players ranked, ${bioCount} new bios ` +
      `(${players.filter((p) => p.hand).length} total).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
