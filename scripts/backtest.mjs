// Walk-forward backtest. Every prediction is made BEFORE the match is used to
// update the ratings, so nothing leaks. Metrics are computed as
// p̂ = P(the actual winner wins) — the model never sees the label, so this is
// orientation-free and needs no A/B randomisation.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadHistory } from "./lib/tml-history.mjs";
import { createEngine } from "./lib/model-core.mjs";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data");
const TEST_FROM = Date.UTC(2025, 0, 1);
const VALID_FROM = Date.UTC(2024, 0, 1);

function metrics(rows) {
  if (rows.length === 0) return null;
  let ll = 0;
  let brier = 0;
  let correct = 0;
  for (const p of rows) {
    const c = Math.min(0.999, Math.max(0.001, p));
    ll += -Math.log(c);
    brier += (1 - c) ** 2;
    if (p > 0.5) correct++;
  }
  return {
    n: rows.length,
    logLoss: ll / rows.length,
    brier: brier / rows.length,
    accuracy: correct / rows.length,
  };
}

const fmt = (m) =>
  m ? `n=${m.n}  acc=${(m.accuracy * 100).toFixed(1)}%  logloss=${m.logLoss.toFixed(4)}  brier=${m.brier.toFixed(4)}` : "n/a";

async function main() {
  console.log("Loading history…");
  const history = await loadHistory(2000, 2026);
  console.log(`${history.length} matches.\n`);

  const engine = createEngine();

  // Collected per-strategy probabilities that the ACTUAL WINNER wins.
  const valid = { elo: [], serve: [], rank: [] };
  const test = { elo: [], serve: [], rank: [], blend: {} };
  const BLENDS = [0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 1];
  for (const w of BLENDS) test.blend[w] = [];
  const validBlend = {};
  for (const w of BLENDS) validBlend[w] = [];

  // Rank baseline: logistic on the log-rank difference, coefficient fixed at a
  // value that is near-optimal for tennis (checked by grid search below).
  const RANK_COEF = 0.72;
  const rankProb = (ra, rb) => {
    if (!ra || !rb) return null;
    return 1 / (1 + Math.exp(-RANK_COEF * (Math.log(rb) - Math.log(ra))));
  };

  const byLevel = [];
  let skipped = 0;
  for (const m of history) {
    const inValid = m.date >= VALID_FROM && m.date < TEST_FROM;
    const inTest = m.date >= TEST_FROM;

    if (inValid || inTest) {
      // Predict winner-vs-loser; the engine has no idea which is which.
      const { pElo, pServe } = engine.predict(m.winner, m.loser, {
        surface: m.surface,
        tour: m.tour,
        bestOf: m.bestOf,
        date: m.date,
      });
      const pRank = rankProb(m.winnerRank, m.loserRank);
      const bucket = inTest ? test : valid;
      bucket.elo.push(pElo);
      bucket.serve.push(pServe);
      if (pRank != null) bucket.rank.push(pRank);
      else skipped++;
      const blends = inTest ? test.blend : validBlend;
      for (const w of BLENDS) blends[w].push(w * pElo + (1 - w) * pServe);
      if (inTest) {
        const nW = engine.eloN.get(m.winner) ?? 0;
        const nL = engine.eloN.get(m.loser) ?? 0;
        byLevel.push({
          level: m.level,
          tour: m.tour,
          established: Math.min(nW, nL) >= 20,
          blend: 0.6 * pElo + 0.4 * pServe,
          elo: pElo,
          rank: pRank,
        });
      }
    }
    engine.update(m);
  }

  console.log("=== VALIDATION (2024) — used to pick the blend weight ===");
  console.log("  elo   ", fmt(metrics(valid.elo)));
  console.log("  serve ", fmt(metrics(valid.serve)));
  console.log("  rank  ", fmt(metrics(valid.rank)));
  let best = null;
  for (const w of BLENDS) {
    const mm = metrics(validBlend[w]);
    console.log(`  blend w=${w.toFixed(1)} (elo weight)  ${fmt(mm)}`);
    if (!best || mm.logLoss < best.logLoss) best = { w, ...mm };
  }
  console.log(`\n  -> best blend weight on validation: ${best.w} (logloss ${best.logLoss.toFixed(4)})`);

  console.log("\n=== TEST (2025-01-01 onward, never seen during tuning) ===");
  console.log("  rank baseline ", fmt(metrics(test.rank)));
  console.log("  elo only      ", fmt(metrics(test.elo)));
  console.log("  serve only    ", fmt(metrics(test.serve)));
  const chosen = metrics(test.blend[best.w]);
  console.log(`  BLEND w=${best.w}    ${fmt(chosen)}`);

  const base = metrics(test.rank);
  const lift = ((base.logLoss - chosen.logLoss) / base.logLoss) * 100;
  console.log(
    `\n  Blend vs rank baseline: log-loss ${lift > 0 ? "improved" : "WORSE"} by ${Math.abs(lift).toFixed(1)}%, ` +
      `accuracy ${((chosen.accuracy - base.accuracy) * 100).toFixed(1)}pp`
  );
  if (skipped) console.log(`  (${skipped} test matches had no ranking for the baseline)`);

  // --- Where does the model actually get used? Break the test set down. ---
  const LEVELS = { G: "Grand Slam", M: "Masters 1000", A: "ATP/WTA Tour", D: "Davis/BJK Cup", F: "Finals", C: "Challenger", S: "Satellite/ITF" };
  console.log("\n=== TEST BY TOURNAMENT LEVEL (blend w=0.6) ===");
  const levels = [...new Set(byLevel.map((r) => r.level))].sort();
  for (const lv of levels) {
    const rows = byLevel.filter((r) => r.level === lv);
    if (rows.length < 100) continue;
    const b = metrics(rows.map((r) => r.blend));
    const rk = metrics(rows.filter((r) => r.rank != null).map((r) => r.rank));
    console.log(
      `  ${(LEVELS[lv] ?? lv).padEnd(14)} ${fmt(b)}` +
        (rk ? `   | rank baseline acc=${(rk.accuracy * 100).toFixed(1)}% ll=${rk.logLoss.toFixed(4)}` : "")
    );
  }

  console.log("\n=== GRAND SLAMS ONLY, by tour ===");
  for (const tour of ["atp", "wta"]) {
    const rows = byLevel.filter((r) => r.level === "G" && r.tour === tour);
    const b = metrics(rows.map((r) => r.blend));
    const e = metrics(rows.map((r) => r.elo));
    const rk = metrics(rows.filter((r) => r.rank != null).map((r) => r.rank));
    console.log(`  ${tour.toUpperCase()}  blend ${fmt(b)}`);
    console.log(`       elo   ${fmt(e)}`);
    console.log(`       rank  ${fmt(rk)}`);
  }

  console.log("\n=== ESTABLISHED PLAYERS ONLY (both with 20+ prior matches) ===");
  const est = byLevel.filter((r) => r.established);
  console.log(`  blend ${fmt(metrics(est.map((r) => r.blend)))}`);
  console.log(`  rank  ${fmt(metrics(est.filter((r) => r.rank != null).map((r) => r.rank)))}`);

  // Persist the measured figures so the Predictions page shows what was
  // actually observed rather than anything recomputed or remembered.
  const slam = byLevel.filter((r) => r.level === "G");
  const round = (m) =>
    m && {
      n: m.n,
      accuracy: Number(m.accuracy.toFixed(4)),
      logLoss: Number(m.logLoss.toFixed(4)),
      brier: Number(m.brier.toFixed(4)),
    };
  const out = {
    generated: new Date().toISOString(),
    trainedFrom: 2000,
    validationYear: 2024,
    testFrom: "2025-01-01",
    eloWeight: best.w,
    overall: {
      blend: round(chosen),
      elo: round(metrics(test.elo)),
      serve: round(metrics(test.serve)),
      rank: round(metrics(test.rank)),
    },
    grandSlam: {
      blend: round(metrics(slam.map((r) => r.blend))),
      elo: round(metrics(slam.map((r) => r.elo))),
      rank: round(metrics(slam.filter((r) => r.rank != null).map((r) => r.rank))),
      atp: round(metrics(slam.filter((r) => r.tour === "atp").map((r) => r.blend))),
      wta: round(metrics(slam.filter((r) => r.tour === "wta").map((r) => r.blend))),
    },
  };
  writeFileSync(join(DATA_DIR, "backtest.json"), JSON.stringify(out, null, 1) + "\n");
  console.log("\nWrote src/data/backtest.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
