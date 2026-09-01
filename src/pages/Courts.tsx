import { MATCHES, applyLive, courts, isDecided, useLiveMatches } from "../data";
import { MatchCard } from "../components/MatchCard";
import { timeET } from "../format";

const SHOW_COURTS = ["Arthur Ashe Stadium", "Louis Armstrong Stadium", "Grandstand", "Stadium 17"];

/**
 * Court-by-court board: what is on each of the grounds' courts right now, with
 * whatever is queued behind it. This is the view that has no equivalent in a
 * football dashboard — 17 courts run simultaneously for 12+ hours a day.
 */
export function Courts() {
  const live = useLiveMatches();
  const matches = applyLive(MATCHES, live);
  const names = courts();

  // Today's play, per court: anything live, else the next scheduled match.
  const byCourt = new Map<string, typeof matches>();
  for (const m of matches) {
    if (!m.court) continue;
    if (!byCourt.has(m.court)) byCourt.set(m.court, []);
    byCourt.get(m.court)!.push(m);
  }

  return (
    <>
      <div className="page-head">
        <h1>Court board</h1>
        <p>
          Every court on the grounds, with what is playing now and what follows. Scores refresh
          from ESPN roughly every 30 seconds while play is under way.
        </p>
      </div>

      <div className="grid grid-2">
        {names.map((court) => {
          const all = (byCourt.get(court) ?? []).sort(
            (a, b) => (a.startEpoch ?? a.epoch ?? 0) - (b.startEpoch ?? b.epoch ?? 0)
          );
          const onCourt = all.find((m) => m.status === "live");
          const upcoming = all.filter((m) => !isDecided(m) && m.status !== "live").slice(0, 3);
          const isShow = SHOW_COURTS.includes(court);

          return (
            <div
              key={court}
              className={
                "court-card" + (onCourt ? " is-live" : "") + (isShow ? " is-show" : "")
              }
            >
              <div className="court-head">
                <span>{court}</span>
                {onCourt && (
                  <span className="badge badge-live">
                    <span className="dot-live" /> LIVE
                  </span>
                )}
              </div>
              <div className="court-body">
                {onCourt ? (
                  <MatchCard m={onCourt} hideCourt />
                ) : (
                  <div className="court-empty">No match in progress</div>
                )}
                {upcoming.length > 0 && (
                  <div className="stack" style={{ gap: 4, marginTop: 10 }}>
                    <div className="stat-label">Next up</div>
                    {upcoming.map((m) => (
                      <div key={m.id} className="row tiny">
                        <span className="faint">{m.startEpoch ? timeET(m.startEpoch) : "TBA"}</span>
                        <span>
                          {m.sides
                            .map((s) => s.players.map((p) => p.name).join("/") || "TBD")
                            .join(" v ")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
