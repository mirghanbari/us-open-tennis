// ---------- Core data model for the US Open dashboard ----------
// These types are the contract between the data layer (JSON files in src/data,
// produced by the scripts/ingest-*.mjs pipeline) and the React app.
//
// The official US Open draw feed is the source of truth for structure (bracket,
// seeds, courts, prize money); ESPN supplies TV listings and the CORS-enabled
// live scores the client polls directly. See README for the full source table.

/** The five championship events, by the feed's own event codes. */
export type EventCode = "MS" | "WS" | "MD" | "WD" | "XD";

/** Which ranking/rating pool a player belongs to. */
export type Tour = "atp" | "wta";

/**
 * Round codes exactly as the draw feed emits them. The numeric prefix of a
 * `match_id` maps onto this order, 1-indexed — see `roundIndex`.
 */
export type RoundCode = "1" | "2" | "3" | "4" | "Q" | "S" | "F";

export type MatchStatus = "scheduled" | "live" | "finished" | "retired" | "walkover";

/** One player within a match side. Doubles sides carry a second player. */
export interface MatchPlayer {
  /** Official feed id, e.g. "atpz355" / "wta329154". Stable across the event. */
  id: string;
  name: string; // display form, e.g. "A. Zverev"
  fullName: string; // "Alexander Zverev"
  nation: string; // 3-letter IOC code
}

/** One side of a match (a single player, or a doubles pair). */
export interface MatchSide {
  players: MatchPlayer[];
  seed: number | null;
  /** "Q" qualifier, "WC" wild card, "LL" lucky loser, etc. Null for direct entry. */
  entryStatus: string | null;
  setsWon: number | null;
  won: boolean | null;
}

/** A single set's games for both sides, with the tiebreak points if played. */
export interface SetScore {
  games: [number, number];
  /** Points won in the set's tiebreak, when there was one. */
  tiebreak: [number, number] | null;
}

export interface Match {
  /** Our id: `${eventCode}-${matchId}`, e.g. "MS-1101". Unique across events. */
  id: string;
  /** The feed's own match id, e.g. "1101" — encodes round and draw slot. */
  matchId: string;
  eventCode: EventCode;
  eventName: string;
  tour: Tour;

  round: RoundCode;
  roundName: string; // "Round 1", "Quarter-Finals"
  /** 1-indexed round number: R1=1 … F=7 for a 128 draw. */
  roundIndex: number;
  /** 1-indexed position within the round, from the match_id's last two digits. */
  slot: number;

  /** Our id of the match the winner advances into; null for the final. */
  feedsInto: string | null;
  /** Our ids of the two matches feeding this one; null for the opening round. */
  fedBy: [string, string] | null;

  court: string | null;
  courtId: string | null;
  /** Tournament day number from the feed. */
  eventDay: number | null;
  /**
   * The official feed's timestamp. Present only once a match has been played,
   * so it reads as "when it happened" rather than "when it starts".
   */
  epoch: number | null;
  /**
   * Scheduled start, epoch ms — from ESPN, which publishes a date for upcoming
   * matches where the official draw feed leaves `epoch` null. This is what the
   * schedule and court board order and label by.
   */
  startEpoch?: number | null;

  status: MatchStatus;
  /** The feed's raw status code, kept for debugging odd states. */
  statusCode: string;
  /** Elapsed match time as "H:MM", when finished. */
  duration: string | null;
  /** Per-set durations in minutes, parallel to `sets`. */
  setDurations: number[];
  /** The feed's own upset flag — a seed beaten by a lower-or-un-seeded player. */
  upset: boolean;

  sides: [MatchSide, MatchSide];
  sets: SetScore[];
  /** 1 or 2 for the winning side, null while unresolved. */
  winner: 1 | 2 | null;

  /** ESPN's competition id, joined on player name, for live-score patching. */
  espnId?: string;
  /**
   * ESPN competitor ids aligned to OUR `sides` order, resolved at ingest time.
   * ESPN's home/away ordering does not track the draw's team1/team2, so the
   * client uses this to land live scores on the correct side.
   */
  espnSideIds?: [string, string];
  /** US TV / streaming carriers, from ESPN's geoBroadcasts. */
  broadcasts?: Broadcast[];
}

export interface Broadcast {
  name: string;
  type: "tv" | "stream";
}

/** Prize money for reaching a given round, from the draw feed. */
export interface PrizeTier {
  roundCode: string;
  roundName: string;
  /** Parsed to a number; the feed ships it as a comma-formatted string. */
  amount: number;
}

export interface DrawMeta {
  eventCode: EventCode;
  eventName: string;
  drawSize: number;
  totalRounds: number;
  prizeMoney: PrizeTier[];
}

/** A tournament participant, assembled across the draw and ESPN's bios. */
export interface Player {
  /** Official feed id, e.g. "atpz355". */
  id: string;
  name: string;
  fullName: string;
  nation: string;
  tour: Tour;
  /** Seed in singles, when seeded. */
  seed: number | null;
  entryStatus: string | null;

  // --- Bio, from ESPN's core athlete endpoint. Absent when unmatched. ---
  espnId?: string;
  hand?: "R" | "L";
  heightCm?: number;
  weightKg?: number;
  dateOfBirth?: string;
  age?: number;
  birthPlace?: string;
  turnedPro?: number;

  // --- Ranking, from ESPN's rankings endpoint. ---
  rank?: number;
  rankPoints?: number;
  /** Movement since the previous ranking release. */
  rankTrend?: string;
}

export interface Meta {
  year: number;
  name: string;
  venue: string;
  city: string;
  startDate: string; // ISO
  endDate: string; // ISO
  /** When the ingest last ran, ISO. */
  updated: string;
  /** Which sources answered on the last run, for the UI's provenance labels. */
  sources: Record<string, boolean>;
}
