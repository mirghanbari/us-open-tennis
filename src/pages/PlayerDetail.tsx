import { useParams } from "react-router-dom";
import {
  applyLive,
  getPlayer,
  isDecided,
  matchesForPlayer,
  prizeMoneyFor,
  sideOf,
  useLiveMatches,
} from "../data";
import { MatchCard } from "../components/MatchCard";
import { FavoriteStar } from "../components/FavoriteStar";
import { money } from "../format";
import type { EventCode } from "../types";

export function PlayerDetail() {
  const { id = "" } = useParams();
  const live = useLiveMatches();
  const player = getPlayer(id);
  const matches = applyLive(matchesForPlayer(id), live);

  if (!player) return <div className="empty">Player not found.</div>;

  const decided = matches.filter(isDecided);
  const wins = decided.filter((m) => sideOf(m, id) === m.winner).length;
  const losses = decided.length - wins;

  // Prize money across every event this player appears in.
  const events = [...new Set(matches.map((m) => m.eventCode))] as EventCode[];
  const earned = events.reduce((sum, e) => sum + prizeMoneyFor(id, e), 0);

  return (
    <>
      <div className="page-head">
        <div className="row tiny faint" style={{ marginBottom: 6 }}>
          <span>{player.nation}</span>
          {player.seed != null && (
            <>
              <span>·</span>
              <span>Seed {player.seed}</span>
            </>
          )}
          {player.entryStatus && (
            <>
              <span>·</span>
              <span>{player.entryStatus}</span>
            </>
          )}
        </div>
        <h1 className="row">
          <FavoriteStar id={player.id} label={player.fullName} />
          {player.fullName}
        </h1>
      </div>

      <div className="grid grid-4">
        <div className="stat">
          <div className="stat-label">Ranking</div>
          <div className="stat-value">{player.rank ?? "—"}</div>
          <div className="stat-note">
            {player.rankPoints ? `${player.rankPoints.toLocaleString()} pts` : "not in top 150"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Here</div>
          <div className="stat-value">
            {wins}–{losses}
          </div>
          <div className="stat-note">{decided.length} matches played</div>
        </div>
        <div className="stat">
          <div className="stat-label">Prize money</div>
          <div className="stat-value">{earned ? money(earned) : "—"}</div>
          <div className="stat-note">guaranteed so far</div>
        </div>
        <div className="stat">
          <div className="stat-label">Profile</div>
          <div className="stat-value" style={{ fontSize: "1.1rem" }}>
            {player.hand ? (player.hand === "L" ? "Left" : "Right") : "—"}
          </div>
          <div className="stat-note">
            {[
              player.age ? `${player.age} yrs` : null,
              player.heightCm ? `${player.heightCm} cm` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "no bio published"}
          </div>
        </div>
      </div>

      {player.birthPlace && (
        <div className="provenance">
          Born {player.birthPlace}
          {player.turnedPro ? ` · turned pro ${player.turnedPro}` : ""}
        </div>
      )}

      <div className="section-head">
        <h2>Matches</h2>
      </div>
      {matches.length === 0 ? (
        <div className="empty">No matches found for this player.</div>
      ) : (
        <div className="grid grid-2">
          {matches.map((m) => (
            <MatchCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </>
  );
}
