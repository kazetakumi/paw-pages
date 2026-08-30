import { useSyncExternalStore } from "react";

// One breakpoint for the whole app: every screen resolves to a desktop or a
// mobile layout component here, not to one tree reflowed with CSS.
const QUERY = "(min-width: 900px)";

export function useIsDesktop() {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(QUERY);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(QUERY).matches,
  );
}
