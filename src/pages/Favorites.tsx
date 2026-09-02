import { Link } from "react-router-dom";
import {
  MATCHES,
  applyLive,
  getPlayer,
  isDecided,
  matchesForPlayer,
  recordFor,
  useLiveMatches,
} from "../data";
import { useFavorites } from "../favorites";
import { MatchCard } from "../components/MatchCard";
import { FavoriteStar } from "../components/FavoriteStar";
import { timeET } from "../format";

/**
 * The starred players' rail: for each, what they're doing right now or next,
 * and their record here. Favourites are device-local (see src/favorites.ts).
 */
export function Favorites() {
  const live = useLiveMatches();
  const all = applyLive(MATCHES, live);
  const ids = useFavorites();

  if (ids.length === 0) {
    return (
      <>
        <div className="page-head">
          <h1>My players</h1>
          <p>
            Star a player anywhere on the site — the Players table, a player page, or the prize
            money leaderboard — and they'll show up here with their next match.
          </p>
        </div>
        <div className="empty">
          No players starred yet. <Link to="/players">Browse players →</Link>
        </div>
      </>
    );
  }

  const rows = ids
    .map((id) => {
      const player = getPlayer(id);
      if (!player) return null;
      // Re-read this player's matches from the live-patched array so the card
      // reflects an in-progress score, not the last ingest.
      const mine = matchesForPlayer(id).map((m) => all.find((x) => x.id === m.id) ?? m);
      const onCourt = mine.find((m) => m.status === "live");
      const next = mine.find((m) => !isDecided(m) && m.status !== "live");
      const last = [...mine].reverse().find(isDecided);
      return { player, onCourt, next, last, record: recordFor(id) };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  return (
    <>
      <div className="page-head">
        <h1>My players</h1>
        <p>
          {rows.length} starred. Stored on this device only — no account, nothing synced.
        </p>
      </div>

      <div className="stack" style={{ gap: 18 }}>
        {rows.map(({ player, onCourt, next, last, record }) => (
          <div key={player.id} className="card card-pad">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row">
                <FavoriteStar id={player.id} label={player.fullName} />
                <Link to={`/players/${player.id}`}>
                  <strong>{player.fullName}</strong>
                </Link>
                <span className="flag">{player.nation}</span>
                {player.seed != null && <span className="badge badge-seed">{player.seed}</span>}
              </div>
              <span className="tiny faint">
                {record.wins}–{record.losses} here
                {player.rank ? ` · No. ${player.rank}` : ""}
              </span>
            </div>

            <div style={{ marginTop: 10 }}>
              {onCourt ? (
                <MatchCard m={onCourt} />
              ) : next ? (
                <>
                  <div className="stat-label" style={{ marginBottom: 6 }}>
                    Next up{next.startEpoch ? ` · ${timeET(next.startEpoch)} ET` : ""}
                  </div>
                  <MatchCard m={next} />
                </>
              ) : last ? (
                <>
                  <div className="stat-label" style={{ marginBottom: 6 }}>
                    Last match
                  </div>
                  <MatchCard m={last} />
                </>
              ) : (
                <p className="muted small">No matches scheduled.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
