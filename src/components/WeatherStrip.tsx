import { isWet, useWeather } from "../data/weather";

/**
 * Conditions at Flushing Meadows. Rain stops play on every court except Ashe
 * and Armstrong, which have roofs — so a wet code is worth flagging.
 */
export function WeatherStrip() {
  const w = useWeather();
  if (!w) return null;

  const wet = isWet(w.code);
  const rainy = wet || (w.rainChance6h != null && w.rainChance6h >= 40);

  return (
    <div className="card card-pad weather">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <strong>{w.tempF}°F</strong>
          <span className="muted">{w.description}</span>
          <span className="tiny faint">
            {w.humidity}% humidity · {w.windMph} mph wind
          </span>
        </div>
        {rainy ? (
          <span className="badge badge-upset">
            {wet ? "Rain now" : `${w.rainChance6h}% rain risk`}
          </span>
        ) : (
          <span className="badge">Clear to play</span>
        )}
      </div>
      {rainy && (
        <div className="provenance" style={{ marginTop: 6 }}>
          Arthur Ashe and Louis Armstrong have roofs and keep playing; every other court is
          exposed.
        </div>
      )}
    </div>
  );
}
