// ---------------------------------------------------------------------------
// build-model.mjs — trains the rating engine on 2000-2026 match history, then
// predicts every remaining US Open match and simulates the draw for title odds.
//
//   node scripts/build-model.mjs [--sims 10000]
//
// Writes src/data/model.json:
//   ratings     current Elo (overall + hard court) and serve rates per player
//   matches     win probability for every undecided match with both sides known
//   odds        Monte Carlo title / final / semi odds per player, per event
//   backtest    honest accuracy figures, surfaced on the Predictions page
//
// The blend weight (Elo vs serve model) was chosen on 2024 as a validation year
// and evaluated on 2025-26 as a held-out test set; see scripts/backtest.mjs.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadHistory } from "./lib/tml-history.mjs";
import { createEngine } from "./lib/model-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "src", "data");

const SIMS = Number(process.argv.find((a) => a.startsWith("--sims"))?.split("=")[1]) || 10000;
const ELO_WEIGHT = 0.6; // tuned on 2024, see backtest
const HARD = "Hard";

function norm(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const personKey = (n) => norm(n).split(" ").filter(Boolean).sort().join(" ");
const surnameKey = (n) => {
  const p = norm(n).split(" ").filter(Boolean);
  return p[p.length - 1] ?? "";
};

async function main() {
  const matches = JSON.parse(readFileSync(join(DATA_DIR, "matches.json"), "utf8"));
  const players = JSON.parse(readFileSync(join(DATA_DIR, "players.json"), "utf8"));
  const draws = JSON.parse(readFileSync(join(DATA_DIR, "draws.json"), "utf8"));
  const meta = JSON.parse(readFileSync(join(DATA_DIR, "meta.json"), "utf8"));

  console.log("Loading history…");
  const history = await loadHistory(2000, 2026);
  console.log(`  ${history.length} matches`);

  // ---- Train chronologically over the whole archive ----------------------
  const engine = createEngine();
  for (const m of history) engine.update(m);

  // ---- Map our players onto history names -------------------------------
  // The archive is keyed by name, like everything else in this project. Build
  // exact and surname indexes over names seen in the last three seasons, so a
  // retired player with a similar surname can't capture the key.
  const recentNames = new Set();
  const cutoff = Date.UTC(2023, 0, 1);
  for (const m of history) {
    if (m.date < cutoff) continue;
    recentNames.add(m.winner);
    recentNames.add(m.loser);
  }
  const exact = new Map();
  const loose = new Map();
  for (const n of recentNames) {
    exact.set(personKey(n), n);
    const sk = surnameKey(n);
    loose.set(sk, loose.has(sk) ? null : n);
  }

  const historyName = new Map(); // our player id -> archive name
  let matched = 0;
  for (const p of players) {
    const hit = exact.get(personKey(p.fullName)) ?? loose.get(surnameKey(p.fullName)) ?? null;
    if (hit) {
      historyName.set(p.id, hit);
      matched++;
    }
  }
  console.log(`  matched ${matched}/${players.length} players to the archive`);

  // ---- Current ratings ---------------------------------------------------
  const now = Date.now();
  const ratings = {};
  for (const p of players) {
    const hn = historyName.get(p.id);
    const r = engine.rates(hn ?? p.fullName, p.tour, now);
    ratings[p.id] = {
      elo: Math.round(engine.getElo(hn ?? p.fullName)),
      hardElo: Math.round(engine.getSurfElo(HARD, hn ?? p.fullName)),
      matches: engine.eloN.get(hn ?? p.fullName) ?? 0,
      spw: Number(r.spw.toFixed(4)),
      rpw: Number(r.rpw.toFixed(4)),
      servePoints: Math.round(r.servePoints),
      // false = no tour-level history in the archive, so this row is the
      // newcomer prior rather than a measured rating. Surfaced in the UI.
      rated: Boolean(hn),
    };
  }

  const nameById = new Map(players.map((p) => [p.id, p.fullName]));

  /**
   * Win probability for side A. A player with no archive history (a qualifier
   * or wildcard making their tour debut) falls back to Elo's own newcomer prior
   * of 1500 plus tour-average serve rates — which is what the engine returns for
   * an unseen name. Defaulting such a match to a coin flip instead would badly
   * overstate a debutant against a top seed.
   */
  function probFor(aId, bId, tour, bestOf) {
    const a = historyName.get(aId) ?? nameById.get(aId);
    const b = historyName.get(bId) ?? nameById.get(bId);
    if (!a || !b) return null;
    const { pElo, pServe } = engine.predict(a, b, {
      surface: HARD,
      tour,
      bestOf,
      date: now,
    });
    return ELO_WEIGHT * pElo + (1 - ELO_WEIGHT) * pServe;
  }

  // ---- Per-match probabilities for everything still to be played ---------
  const matchProbs = {};
  let unratedInvolved = 0;
  for (const m of matches) {
    if (m.winner != null) continue;
    if (m.sides.some((s) => s.players.length !== 1)) continue; // singles only
    const bestOf = m.tour === "atp" && (m.eventCode === "MS") ? 5 : 3;
    const p = probFor(m.sides[0].players[0].id, m.sides[1].players[0].id, m.tour, bestOf);
    if (p == null) continue;
    const bothRated =
      ratings[m.sides[0].players[0].id]?.rated && ratings[m.sides[1].players[0].id]?.rated;
    if (!bothRated) unratedInvolved++;
    matchProbs[m.id] = { p: Number(p.toFixed(4)), rated: Boolean(bothRated) };
  }
  console.log(
    `  probabilities for ${Object.keys(matchProbs).length} upcoming matches ` +
      `(${unratedInvolved} involve a player with no tour history)`
  );

  // ---- Monte Carlo the singles draws -------------------------------------
  const odds = {};
  for (const draw of draws) {
    if (draw.eventCode !== "MS" && draw.eventCode !== "WS") continue;
    const evMatches = matches.filter((m) => m.eventCode === draw.eventCode);
    const byRound = new Map();
    for (const m of evMatches) {
      if (!byRound.has(m.roundIndex)) byRound.set(m.roundIndex, []);
      byRound.get(m.roundIndex).push(m);
    }
    for (const list of byRound.values()) list.sort((a, b) => a.slot - b.slot);

    const bestOf = draw.eventCode === "MS" ? 5 : 3;
    const tour = draw.eventCode === "MS" ? "atp" : "wta";
    const tally = new Map(); // playerId -> counts per round reached

    // Cache pairwise probabilities — the same pairing recurs across simulations.
    const pCache = new Map();
    const pairProb = (a, b) => {
      const key = `${a}|${b}`;
      let v = pCache.get(key);
      if (v === undefined) {
        v = probFor(a, b, tour, bestOf) ?? 0.5;
        pCache.set(key, v);
      }
      return v;
    };

    for (let sim = 0; sim < SIMS; sim++) {
      // slots[round] = array of winners advancing OUT of that round, by slot.
      const winners = new Map(); // matchId -> playerId
      for (let r = 1; r <= draw.totalRounds; r++) {
        for (const m of byRound.get(r) ?? []) {
          // Who is in this match? Either it is already populated, or the two
          // feeder matches decided it in this simulation.
          let a = m.sides[0].players[0]?.id ?? null;
          let b = m.sides[1].players[0]?.id ?? null;
          if ((!a || !b) && m.fedBy) {
            a = a ?? winners.get(m.fedBy[0]) ?? null;
            b = b ?? winners.get(m.fedBy[1]) ?? null;
          }
          if (!a || !b) continue;

          let w;
          if (m.winner != null) {
            // Real result — never re-simulate a match that has been played.
            w = m.sides[m.winner - 1].players[0]?.id ?? null;
          } else {
            w = Math.random() < pairProb(a, b) ? a : b;
          }
          if (!w) continue;
          winners.set(m.id, w);
          let t = tally.get(w);
          if (!t) {
            t = new Array(draw.totalRounds + 1).fill(0);
            tally.set(w, t);
          }
          // Winning round r means reaching round r+1 (or the title at the end).
          t[r]++;
        }
      }
    }

    const rows = [];
    for (const [playerId, counts] of tally) {
      rows.push({
        playerId,
        // Probability of winning the final = the title.
        title: counts[draw.totalRounds] / SIMS,
        final: counts[draw.totalRounds - 1] / SIMS,
        semi: counts[draw.totalRounds - 2] / SIMS,
        quarter: counts[draw.totalRounds - 3] / SIMS,
      });
    }
    rows.sort((a, b) => b.title - a.title);
    odds[draw.eventCode] = rows
      .filter((r) => r.title > 0 || r.semi > 0)
      .map((r) => ({
        playerId: r.playerId,
        title: Number(r.title.toFixed(4)),
        final: Number(r.final.toFixed(4)),
        semi: Number(r.semi.toFixed(4)),
        quarter: Number(r.quarter.toFixed(4)),
      }));

    const top = odds[draw.eventCode][0];
    const name = players.find((p) => p.id === top?.playerId)?.fullName ?? "?";
    console.log(
      `  ${draw.eventCode}: ${SIMS} sims, favourite ${name} ${(top.title * 100).toFixed(1)}%`
    );
  }

  const model = {
    generated: new Date().toISOString(),
    // The same shrinkage targets the engine used, so the browser's live
    // win-probability maths matches the pre-match numbers exactly rather than
    // relying on a hardcoded constant.
    tourMeans: { atp: engine.tourMeans("atp"), wta: engine.tourMeans("wta") },
    sims: SIMS,
    eloWeight: ELO_WEIGHT,
    trainedFrom: 2000,
    trainedThrough: new Date(history[history.length - 1].date).toISOString().slice(0, 10),
    historyMatches: history.length,
    ratings,
    matches: matchProbs,
    odds,
    // Filled in by scripts/backtest.mjs and pasted here deliberately: these are
    // the numbers shown on the Predictions page, so they must be the measured
    // ones rather than anything recomputed on the fly.
    backtest: JSON.parse(readFileSync(join(DATA_DIR, "backtest.json"), "utf8")),
  };

  writeFileSync(join(DATA_DIR, "model.json"), JSON.stringify(model, null, 1) + "\n");
  meta.sources["model"] = true;
  writeFileSync(join(DATA_DIR, "meta.json"), JSON.stringify(meta, null, 1) + "\n");
  console.log("Wrote src/data/model.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
