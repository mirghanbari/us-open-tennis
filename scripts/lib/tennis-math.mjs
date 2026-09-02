// ---------------------------------------------------------------------------
// Closed-form tennis probabilities: point → game → set → match.
//
// The standard hierarchical model (O'Malley 2008). Given each player's
// probability of winning a point ON THEIR OWN SERVE, and assuming points are
// independent and identically distributed, every level above has an exact
// solution — no simulation needed for a single match.
//
// NOTE: src/model/tennis.ts carries a TypeScript twin of these functions that
// also handles *partial* scores, for in-match win probability in the browser.
// The two are deliberately duplicated rather than shared: this file runs in a
// plain node script with no build step, that one ships to the client. Keep the
// formulas in sync.
// ---------------------------------------------------------------------------

/** Probability the server wins a game, given p = P(win a point on serve). */
export function gameWinProb(p) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const q = 1 - p;
  // Win to love, 15, or 30, plus the deuce branch.
  const p4 = p ** 4; // 40-0
  const w0 = p4;
  const w15 = 4 * p4 * q;
  const w30 = 10 * p4 * q * q;
  // Reaching deuce: 20 * p^3 q^3. From deuce, server wins with p²/(p²+q²).
  const deuce = 20 * p ** 3 * q ** 3;
  const fromDeuce = (p * p) / (p * p + q * q);
  return w0 + w15 + w30 + deuce * fromDeuce;
}

/**
 * Probability of winning a tiebreak, given p (own serve) and q (opponent's
 * serve point-win prob for us on return). Solved by dynamic programming over
 * the 7-point race with the standard serve-alternation pattern.
 */
export function tiebreakWinProb(pServe, pReturn, target = 7) {
  const memo = new Map();
  // `n` = points played so far; determines who serves next.
  function serverIsUs(n) {
    // Point 0 served by us, then alternating in pairs: 1,2 opp; 3,4 us; …
    return Math.floor((n + 1) / 2) % 2 === 0;
  }
  // From a LEVEL score in the tail (6-6, 7-7, …) the outcome depends only on
  // the next two points, over which each player serves exactly once — so the
  // order does not matter and the state is memoryless:
  //   L = winBoth + (1 - winBoth - loseBoth)·L  ⇒  L = winBoth / (winBoth + loseBoth)
  const winBoth = pServe * pReturn;
  const loseBoth = (1 - pServe) * (1 - pReturn);
  const levelProb =
    winBoth + loseBoth <= 1e-12 ? 0.5 : winBoth / (winBoth + loseBoth);

  function rec(a, b) {
    if (a >= target && a - b >= 2) return 1;
    if (b >= target && b - a >= 2) return 0;
    // Level at or beyond 6-6. Non-level tail states (8-7, say) are NOT folded
    // in here — they keep recursing, and reach either a 2-point margin or the
    // next level state.
    if (a >= target - 1 && b >= target - 1 && a === b) return levelProb;
    const key = a * 100 + b;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const n = a + b;
    const pWin = serverIsUs(n) ? pServe : pReturn;
    const val = pWin * rec(a + 1, b) + (1 - pWin) * rec(a, b + 1);
    memo.set(key, val);
    return val;
  }
  return rec(0, 0);
}

/**
 * Probability of winning a set, given our game-win probability on our serve
 * (`gs`) and on the opponent's serve (`gr`). DP over game scores to 6, with a
 * tiebreak at 6-6.
 */
export function setWinProb(gs, gr, tbProb) {
  const memo = new Map();
  function rec(a, b) {
    if (a === 6 && b <= 4) return 1;
    if (b === 6 && a <= 4) return 0;
    if (a === 7) return 1;
    if (b === 7) return 0;
    if (a === 6 && b === 6) return tbProb;
    const key = a * 100 + b;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    // Games alternate serve; player A serves game 0, 2, 4, …
    const weServe = (a + b) % 2 === 0;
    const p = weServe ? gs : gr;
    const val = p * rec(a + 1, b) + (1 - p) * rec(a, b + 1);
    memo.set(key, val);
    return val;
  }
  return rec(0, 0);
}

/** Probability of winning a best-of-N match given per-set probability s. */
export function matchWinProb(s, bestOf = 3) {
  const need = bestOf === 5 ? 3 : 2;
  const memo = new Map();
  function rec(a, b) {
    if (a === need) return 1;
    if (b === need) return 0;
    const key = a * 10 + b;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const val = s * rec(a + 1, b) + (1 - s) * rec(a, b + 1);
    memo.set(key, val);
    return val;
  }
  return rec(0, 0);
}

/**
 * Full stack: from both players' serve point-win probabilities to a match
 * win probability for player A.
 */
export function matchProbFromServe(spwA, spwB, bestOf = 3) {
  // A's return points won = 1 - B's serve points won.
  const gs = gameWinProb(spwA);
  const gr = 1 - gameWinProb(spwB);
  const tb = tiebreakWinProb(spwA, 1 - spwB);
  const s = setWinProb(gs, gr, tb);
  return matchWinProb(s, bestOf);
}

/** Elo expected score for A against B. */
export const eloExpected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));
