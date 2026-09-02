// ---------------------------------------------------------------------------
// ingest-schedule.mjs — the official order of play.
//
//   node scripts/ingest-schedule.mjs      (run AFTER ingest-usopen.mjs)
//
// Found via the site's own config at /en_US/json/gen/config_web.json, which
// lists every feed the tournament publishes. This one carries what the draws
// feed does not:
//
//   - the tournament's OWN day labels ("Day 4: Wednesday, September 2"),
//     so we no longer have to infer a name for each session
//   - day and night sessions per court, with start times
//   - each match's ORDER on its court, plus "not before" times
//   - an in-progress status, and crucially SUSPENDED — a match stopped for
//     rain or darkness, which no other source we use exposes
//   - the day's notices (sign-in deadlines and the like)
//
// Live SCORES are not here and are not in any JSON feed: the site streams them
// over MQTT/SSE from scores.usopen.org with encoded, compressed topics. ESPN
// remains our live-score source.
//
// Writes src/data/schedule.json and patches order/session/status onto
// src/data/matches.json.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "src", "data");

const YEAR = Number(process.env.US_OPEN_YEAR) || 2026;
const BASE = `https://www.usopen.org/en_US/scores/feeds/${YEAR}`;
const UA = "Mozilla/5.0 (compatible; us-open-dashboard/1.0)";

// Past days are already covered by results in the draws feed, so only pull the
// current day onward (plus one back, to catch a session still finishing).
const DAYS_BACK = 1;

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

/** Schedule status codes → our vocabulary. */
function toStatus(code, status) {
  switch (code) {
    case "A":
      return "live";
    case "K":
      return "suspended";
    case "D":
      return "finished";
    case "E":
      return "retired";
    case "W":
      return "walkover";
    case "B":
      return "scheduled";
    default:
      return /progress/i.test(status || "") ? "live" : "scheduled";
  }
}

const side = (team) =>
  (team ?? [])
    .flatMap((t) => [t.displayNameA, t.displayNameB])
    .filter(Boolean)
    .join(" / ");

async function main() {
  const matches = JSON.parse(readFileSync(join(DATA_DIR, "matches.json"), "utf8"));
  const meta = JSON.parse(readFileSync(join(DATA_DIR, "meta.json"), "utf8"));
  const byMatchId = new Map(matches.map((m) => [`${m.eventCode}-${m.matchId}`, m]));

  const index = await getJson(`${BASE}/schedule/scheduleDays.json`);
  if (!index?.eventDays?.length) {
    console.warn("  schedule index unavailable — skipped");
    meta.sources["schedule"] = false;
    writeFileSync(join(DATA_DIR, "meta.json"), JSON.stringify(meta, null, 1) + "\n");
    return;
  }
  meta.sources["schedule"] = true;

  // Which tournament day is "now"? Use the highest day whose feed reports any
  // completed or in-progress match, so this stays correct without a clock.
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date()
  );

  const days = [];
  let patched = 0;

  for (const d of index.eventDays) {
    const tournDay = Number(d.tournDay);
    if (!Number.isFinite(tournDay)) continue;

    const feed = await getJson(`${BASE}/schedule/schedule${tournDay}.json`);
    if (!feed?.courts) continue;

    // Skip days well in the past — their results already live in the draw.
    const dayDate = feed.epoch
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
          new Date(feed.epoch * 1000)
        )
      : null;
    if (dayDate && dayDate < todayIso) {
      const gap = (Date.parse(todayIso) - Date.parse(dayDate)) / 86_400_000;
      if (gap > DAYS_BACK) continue;
    }

    const courts = feed.courts.map((c) => ({
      court: c.courtName,
      courtId: c.courtId,
      session: c.session ?? null,
      sessionName: c.sessionName ?? null,
      startTime: c.time ?? null,
      startEpoch: c.startEpoch ? c.startEpoch * 1000 : null,
      matches: (c.matches ?? []).map((m) => {
        const id = `${m.eventCode}-${m.match_id}`;
        const ours = byMatchId.get(id);
        // Push the order-of-play detail onto the match record too, so cards can
        // show "2nd on court, not before 2:00 PM" wherever they appear.
        if (ours) {
          ours.courtOrder = m.order ?? null;
          ours.notBefore = m.notBefore ?? null;
          ours.session = c.session ?? null;
          if (!ours.court && m.courtName) ours.court = m.courtName;
          // The schedule feed is the ONLY source that reports a suspension.
          // Never let it downgrade a match the draw already settled.
          const s = toStatus(m.statusCode, m.status);
          if (s === "suspended" && ours.winner == null) ours.status = "suspended";
          patched++;
        }
        return {
          id,
          order: m.order ?? null,
          notBefore: m.notBefore ?? null,
          conjunction: m.conjunction ?? null,
          comment: m.comment ?? null,
          status: toStatus(m.statusCode, m.status),
          eventCode: m.eventCode,
          roundName: m.roundName ?? "",
          team1: side(m.team1),
          team2: side(m.team2),
        };
      }),
    }));

    days.push({
      tournDay,
      // The tournament's own label, e.g. "Day 4: Wednesday, September 2".
      label: feed.day || d.message || `Day ${tournDay}`,
      shortLabel: d.messageShort ?? null,
      displayDate: feed.displayDate ?? null,
      date: dayDate,
      releaseTime: feed.releaseTime ?? null,
      comments: feed.comments || null,
      footerComment: feed.footerComment || null,
      courts,
    });
  }

  days.sort((a, b) => a.tournDay - b.tournDay);

  writeFileSync(join(DATA_DIR, "schedule.json"), JSON.stringify(days, null, 1) + "\n");
  writeFileSync(join(DATA_DIR, "matches.json"), JSON.stringify(matches, null, 1) + "\n");
  meta.updated = new Date().toISOString();
  writeFileSync(join(DATA_DIR, "meta.json"), JSON.stringify(meta, null, 1) + "\n");

  const suspended = matches.filter((m) => m.status === "suspended").length;
  console.log(
    `Schedule: ${days.length} day(s), ${patched} matches given an order of play` +
      (suspended ? `, ${suspended} suspended` : "")
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
