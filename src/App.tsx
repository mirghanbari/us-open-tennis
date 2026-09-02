import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { MATCHES, applyLive, useLiveMatches } from "./data";
import { useFavorites } from "./favorites";
import { useOnCourtNotifications } from "./notify";
import { Nav } from "./components/Nav";
import { Footer } from "./components/Footer";

// Reset scroll on every route change so navigating always lands at the top.
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  // App-level so a starred player going on court is announced from any page.
  // Shares the single live poll the pages already use.
  const live = useLiveMatches();
  useOnCourtNotifications(applyLive(MATCHES, live), useFavorites());

  return (
    <>
      <ScrollToTop />
      <div className="court-stripe" />
      <Nav />
      <main className="container">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
