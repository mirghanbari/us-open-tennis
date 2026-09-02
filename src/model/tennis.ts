// Tennis probability math for the browser — the twin of
// scripts/lib/tennis-math.mjs, extended to start from a PARTIAL score so a
// match in progress can be evaluated.
//
// The two files are deliberately duplicated rather than shared: the build
// script runs in plain node with no bundler, this ships to the client. Keep the
// formulas in sync; the pure ones below are identical.

/** Probability the server wins a game, given p = P(win a point on serve). */
export function gameWinProb(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const q = 1 - p;
  const p4 = p ** 4;
  const deuce = 20 * p ** 3 * q ** 3;
  const fromDeuce = (p * p) / (p * p + q * q);
  return p4 + 4 * p4 * q + 10 * p4 * q * q + deuce * fromDeuce;
}

/** Probability of winning a tiebreak from 0-0. */
export function tiebreakWinProb(pServe: number, pReturn: number, target = 7): number {
  const memo = new Map<number, number>();
  const serverIsUs = (n: number) => Math.floor((n + 1) / 2) % 2 === 0;
  const winBoth = pServe * pReturn;
  const loseBoth = (1 - pServe) * (1 - pReturn);
  // From a level score in the tail each player serves once over the next two
  // points, so: L = winBoth / (winBoth + loseBoth).
  const levelProb = winBoth + loseBoth <= 1e-12 ? 0.5 : winBoth / (winBoth + loseBoth);

  function rec(a: number, b: number): number {
    if (a >= target && a - b >= 2) return 1;
    if (b >= target && b - a >= 2) return 0;
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
 * Probability of winning a set FROM a given game score.
 * `weServeNext` says who serves the upcoming game.
 */
export function setWinProbFrom(
  gs: number,
  gr: number,
  tbProb: number,
  fromA = 0,
  fromB = 0,
  weServeNext = true
): number {
  const memo = new Map<number, number>();
  function rec(a: number, b: number, weServe: boolean): number {
    if (a === 6 && b <= 4) return 1;
    if (b === 6 && a <= 4) return 0;
    if (a === 7) return 1;
    if (b === 7) return 0;
    if (a === 6 && b === 6) return tbProb;
    const key = (a * 100 + b) * 2 + (weServe ? 1 : 0);
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const p = weServe ? gs : gr;
    const val = p * rec(a + 1, b, !weServe) + (1 - p) * rec(a, b + 1, !weServe);
    memo.set(key, val);
    return val;
  }
  return rec(fromA, fromB, weServeNext);
}

/** Probability of winning a best-of-N match from a given set score. */
export function matchWinProbFrom(s: number, setsA = 0, setsB = 0, bestOf = 3): number {
  const need = bestOf === 5 ? 3 : 2;
  const memo = new Map<number, number>();
  function rec(a: number, b: number): number {
    if (a >= need) return 1;
    if (b >= need) return 0;
    const key = a * 10 + b;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const val = s * rec(a + 1, b) + (1 - s) * rec(a, b + 1);
    memo.set(key, val);
    return val;
  }
  return rec(setsA, setsB);
}

/** From both players' serve point-win rates to a pre-match win probability. */
export function matchProbFromServe(spwA: number, spwB: number, bestOf = 3): number {
  const gs = gameWinProb(spwA);
  const gr = 1 - gameWinProb(spwB);
  const tb = tiebreakWinProb(spwA, 1 - spwB);
  return matchWinProbFrom(setWinProbFrom(gs, gr, tb), 0, 0, bestOf);
}

export interface LiveState {
  setsA: number;
  setsB: number;
  gamesA: number;
  gamesB: number;
  bestOf: number;
}

/**
 * In-match win probability for player A, from the current set and game score.
 *
 * LIMITATION, surfaced in the UI: no free feed says who is serving or what the
 * game score is — ESPN gives completed games only. So this averages over the
 * two possible servers for the next game, and treats the current game as not
 * yet started. The resulting figure is accurate at game granularity but cannot
 * capture "30-40 on serve".
 */
export function liveWinProb(spwA: number, spwB: number, state: LiveState): number {
  const { setsA, setsB, gamesA, gamesB, bestOf } = state;
  const need = bestOf === 5 ? 3 : 2;
  if (setsA >= need) return 1;
  if (setsB >= need) return 0;

  const gs = gameWinProb(spwA);
  const gr = 1 - gameWinProb(spwB);
  const tb = tiebreakWinProb(spwA, 1 - spwB);

  // Average the two serve assumptions rather than guessing one.
  const setNow =
    (setWinProbFrom(gs, gr, tb, gamesA, gamesB, true) +
      setWinProbFrom(gs, gr, tb, gamesA, gamesB, false)) /
    2;
  // Later sets start level, so use the neutral per-set probability there.
  const setLater = setWinProbFrom(gs, gr, tb, 0, 0, true);

  // Win the current set, then need (need-setsA-1) more; or lose it and need all.
  const winCurrent = matchWinProbFrom(setLater, setsA + 1, setsB, bestOf);
  const loseCurrent = matchWinProbFrom(setLater, setsA, setsB + 1, bestOf);
  return setNow * winCurrent + (1 - setNow) * loseCurrent;
}
