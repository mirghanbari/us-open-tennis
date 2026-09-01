import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PLAYERS } from "../data";

type Sort = "rank" | "seed" | "name" | "nation";

export function Players() {
  const [q, setQ] = useState("");
  const [tour, setTour] = useState<"all" | "atp" | "wta">("all");
  const [sort, setSort] = useState<Sort>("rank");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return PLAYERS.filter((p) => (tour === "all" ? true : p.tour === tour))
      .filter((p) => (needle ? p.fullName.toLowerCase().includes(needle) : true))
      .sort((a, b) => {
        if (sort === "name") return a.fullName.localeCompare(b.fullName);
        if (sort === "nation") return a.nation.localeCompare(b.nation);
        if (sort === "seed") {
          return (a.seed ?? 999) - (b.seed ?? 999) || a.fullName.localeCompare(b.fullName);
        }
        return (a.rank ?? 9999) - (b.rank ?? 9999) || a.fullName.localeCompare(b.fullName);
      });
  }, [q, tour, sort]);

  return (
    <>
      <div className="page-head">
        <h1>Players</h1>
        <p>{PLAYERS.length} players across the published draws.</p>
      </div>

      <div className="filters">
        <input
          type="search"
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {(["all", "atp", "wta"] as const).map((t) => (
          <button
            key={t}
            className={"chip" + (tour === t ? " is-on" : "")}
            onClick={() => setTour(t)}
          >
            {t === "all" ? "All" : t.toUpperCase()}
          </button>
        ))}
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="rank">Sort: ranking</option>
          <option value="seed">Sort: seed</option>
          <option value="name">Sort: name</option>
          <option value="nation">Sort: nation</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">Seed</th>
              <th>Player</th>
              <th>Nation</th>
              <th className="num">Rank</th>
              <th className="num">Points</th>
              <th>Hand</th>
              <th className="num">Age</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id}>
                <td className="num">
                  {p.seed != null ? (
                    <span className="badge badge-seed">{p.seed}</span>
                  ) : (
                    <span className="faint">{p.entryStatus ?? "—"}</span>
                  )}
                </td>
                <td>
                  <Link to={`/players/${p.id}`}>
                    <strong>{p.fullName}</strong>
                  </Link>
                </td>
                <td className="faint">{p.nation}</td>
                <td className="num">{p.rank ?? "—"}</td>
                <td className="num">{p.rankPoints?.toLocaleString() ?? "—"}</td>
                <td className="faint">{p.hand ?? "—"}</td>
                <td className="num">{p.age ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="provenance">
        Seeds and entry status from the official draw; rankings, hand and age from ESPN. A dash
        means the source does not publish that value for this player.
      </div>
    </>
  );
}
