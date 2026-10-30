import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./i18n.ts";
import "./styles.css";
import App from "./App.tsx";
import { FleetProvider } from "./fleet.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FleetProvider>
      <App />
    </FleetProvider>
  </StrictMode>,
);
