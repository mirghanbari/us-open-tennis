// Flushing Meadows conditions, fetched client-side.
//
// Deliberately NOT part of the ingest: weather changes every few minutes, so
// committing it would churn src/data on every 20-minute CI run and trigger a
// redeploy even when no match data had moved. Open-Meteo is CORS-enabled and
// keyless, so the browser fetches it directly — same reasoning as live scores.
import { useEffect, useState } from "react";

// USTA Billie Jean King National Tennis Center.
const LAT = 40.7498;
const LON = -73.8448;

const URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
  "&current=temperature_2m,precipitation,weather_code,wind_speed_10m,relative_humidity_2m" +
  "&hourly=precipitation_probability" +
  "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FNew_York&forecast_days=1";

const REFRESH_MS = 15 * 60_000;

export interface Weather {
  tempF: number;
  humidity: number;
  windMph: number;
  precipitation: number;
  code: number;
  description: string;
  /** Chance of rain over the next six hours, as a percentage. */
  rainChance6h: number | null;
}

/** WMO weather codes, condensed to what matters at a tennis tournament. */
function describe(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Fog";
  if (code <= 55) return "Drizzle";
  if (code <= 57) return "Freezing drizzle";
  if (code <= 65) return "Rain";
  if (code <= 67) return "Freezing rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}

/** True when play would realistically be interrupted. */
export function isWet(code: number): boolean {
  return code >= 51;
}

export function useWeather(): Weather | null {
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(URL);
        if (!res.ok) return;
        const j: any = await res.json();
        const c = j?.current;
        if (!c || cancelled) return;

        // Next six hourly buckets from now, for a rain-delay heads-up.
        let rainChance6h: number | null = null;
        const times: string[] = j?.hourly?.time ?? [];
        const probs: number[] = j?.hourly?.precipitation_probability ?? [];
        const nowIso = c.time as string;
        const start = times.findIndex((t) => t >= nowIso);
        if (start >= 0 && probs.length) {
          const window = probs.slice(start, start + 6).filter((p) => typeof p === "number");
          if (window.length) rainChance6h = Math.max(...window);
        }

        setWeather({
          tempF: Math.round(c.temperature_2m),
          humidity: Math.round(c.relative_humidity_2m),
          windMph: Math.round(c.wind_speed_10m),
          precipitation: c.precipitation ?? 0,
          code: c.weather_code ?? 0,
          description: describe(c.weather_code ?? 0),
          rainChance6h,
        });
      } catch {
        /* offline or upstream hiccup — the panel simply doesn't render */
      }
    }

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return weather;
}
