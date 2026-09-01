import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import { Overview } from "./pages/Overview";
import { Courts } from "./pages/Courts";
import { Schedule } from "./pages/Schedule";
import { Draw } from "./pages/Draw";
import { Matches } from "./pages/Matches";
import { MatchDetail } from "./pages/MatchDetail";
import { Players } from "./pages/Players";
import { PlayerDetail } from "./pages/PlayerDetail";
import "./index.css";

// HashRouter so deep links work on GitHub Pages without server rewrites —
// same reasoning as the World Cup dashboard.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Overview />} />
          <Route path="courts" element={<Courts />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="draw" element={<Draw />} />
          <Route path="draw/:event" element={<Draw />} />
          <Route path="matches" element={<Matches />} />
          <Route path="matches/:id" element={<MatchDetail />} />
          <Route path="players" element={<Players />} />
          <Route path="players/:id" element={<PlayerDetail />} />
        </Route>
      </Routes>
    </HashRouter>
  </StrictMode>
);
