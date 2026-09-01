import { useMemo, useState } from "react";
import { MATCHES, applyLive, publishedEvents, useLiveMatches } from "../data";
import { MatchCard } from "../components/MatchCard";
import type { EventCode } from "../types";

type StatusFilter = "all" | "live" | "finished" | "scheduled";

export function Matches() {
  const live = useLiveMatches();
  const all = applyLive(MATCHES, live);
  const events = publishedEvents();

  const [event, setEvent] = useState<EventCode | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((m) => (event === "all" ? true : m.eventCode === event))
      .filter((m) => {
        if (status === "all") return true;
        if (status === "finished") return m.winner != null;
        return m.status === status;
      })
      .filter((m) =>
        needle
          ? m.sides.some((s) =>
              s.players.some((p) => p.fullName.toLowerCase().includes(needle))
            )
          : true
      )
      .sort(
        (a, b) =>
          (b.startEpoch ?? b.epoch ?? 0) - (a.startEpoch ?? a.epoch ?? 0) ||
          a.roundIndex - b.roundIndex
      );
  }, [all, event, status, q]);

  return (
    <>
      <div className="page-head">
        <h1>Matches</h1>
        <p>Every match across the published draws, filterable by event and state.</p>
      </div>

      <div className="filters">
        <input
          type="search"
          placeholder="Search a player…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className={"chip" + (event === "all" ? " is-on" : "")}
          onClick={() => setEvent("all")}
        >
          All events
        </button>
        {events.map((e) => (
          <button
            key={e.eventCode}
            className={"chip" + (event === e.eventCode ? " is-on" : "")}
            onClick={() => setEvent(e.eventCode)}
          >
            {e.eventName}
          </button>
        ))}
      </div>
      <div className="filters">
        {(["all", "live", "finished", "scheduled"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            className={"chip" + (status === s ? " is-on" : "")}
            onClick={() => setStatus(s)}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span className="tiny faint" style={{ marginLeft: "auto" }}>
          {shown.length} matches
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="empty">No matches match those filters.</div>
      ) : (
        <div className="grid grid-2">
          {shown.map((m) => (
            <MatchCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </>
  );
}
