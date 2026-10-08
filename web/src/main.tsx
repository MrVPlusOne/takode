import "./utils/browser-load-diagnostics.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { AppErrorBoundary } from "./components/AppErrorBoundary.js";
import { LoginGate } from "./components/LoginPage.js";
import { checkLogin, installLoginRequiredWatcher } from "./browser-login.js";
import { installBrowserPerfDebugHooks } from "./utils/browser-perf-debug.js";
import { installUiCrashDebugHooks } from "./utils/ui-crash-debug.js";
import { resumeWebPushOnThisDevice } from "./utils/web-push.js";
import "./index.css";

installUiCrashDebugHooks();
installLoginRequiredWatcher();
if (import.meta.env.DEV) {
  installBrowserPerfDebugHooks();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <LoginGate>
        <App />
      </LoginGate>
    </AppErrorBoundary>
  </StrictMode>,
);

checkLogin()
  .then(resumeWebPushOnThisDevice)
  .catch((error) => console.warn("[web-push] Could not resume on this device", error));
