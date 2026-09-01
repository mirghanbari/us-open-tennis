import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
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
