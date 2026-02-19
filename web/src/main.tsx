import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { AppErrorBoundary } from "./components/AppErrorBoundary.js";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
