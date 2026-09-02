import { toggleFavorite, useFavorites } from "../favorites";

/**
 * Star toggle for a player. Rendered inside links in a few places, so it stops
 * propagation and prevents the default navigation.
 */
export function FavoriteStar({ id, label }: { id: string; label?: string }) {
  const favorites = useFavorites();
  const on = favorites.includes(id);
  return (
    <button
      className={"star" + (on ? " is-on" : "")}
      aria-pressed={on}
      aria-label={on ? `Unstar ${label ?? "player"}` : `Star ${label ?? "player"}`}
      title={on ? "Remove from favourites" : "Add to favourites"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(id);
      }}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
