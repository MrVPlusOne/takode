// First, before any app module reads them: where pictures and storage come from in the demo.
import "./page-environment.js";
import { setLocalStorageItem } from "../utils/scoped-storage.js";
import { DemoBackend, installDemoBackend } from "./demo-backend.js";
import { createPocketLedgerStory } from "./pocket-ledger.js";
import { pointAt, settleFeed } from "./tutorial-pointer.js";

/**
 * The landing page's demo: the real Takode app, served by a stand-in server that plays a
 * scripted day of work on a made-up project. The page around it (site/demo/takode-demo.js)
 * picks chapters, pauses it off screen and switches day and night through `postMessage`.
 */
type FromPage =
  | { takodeDemo: "goto"; chapter: number; play: boolean }
  | { takodeDemo: "pause" }
  | { takodeDemo: "resume" }
  | { takodeDemo: "theme"; dark: boolean };

// Every visit starts fresh: nothing the visitor clicked last time carries over.
localStorage.clear();
const params = new URLSearchParams(location.search);
setLocalStorageItem("cc-color-theme", params.get("theme") === "dark" ? "dark" : "light");
const backend = new DemoBackend("pocket-ledger");
installDemoBackend(backend);
const story = createPocketLedgerStory(backend, {
  press: (label) => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
    button?.click();
  },
  point: pointAt,
});
// A worker's preview arrives a moment after its thread opens; keep the newest messages in view.
addEventListener("hashchange", () => settleFeed());
story.goto(0);

const toPage = (message: Record<string, unknown>) => {
  if (window.parent !== window) window.parent.postMessage({ ...message, takodeDemo: message.takodeDemo }, "*");
};
story.onChapter((chapter) => toPage({ takodeDemo: "chapter", chapter }));
story.onEnded(() => toPage({ takodeDemo: "ended" }));

// The app reads the transport and the store when it loads, so it loads after the fakes are in.
async function start() {
  // The topic pages column needs a project's Library; the demo has none, so it starts closed.
  const { setTopicPanelOpen } = await import("../utils/topic-panel.js");
  setTopicPanelOpen(false);
  const [{ StrictMode, createElement }, { createRoot }, { default: App }, { AppErrorBoundary }, { useStore }] =
    await Promise.all([
      import("react"),
      import("react-dom/client"),
      import("../App.js"),
      import("../components/AppErrorBoundary.js"),
      import("../store.js"),
      import("../index.css"),
      import("../scenic/scenic.css"),
      import("../scenic/ink-textures.css"),
    ]);
  createRoot(document.getElementById("root")!).render(
    createElement(StrictMode, null, createElement(AppErrorBoundary, null, createElement(App))),
  );
  window.addEventListener("message", (event) => {
    const message = event.data as FromPage;
    if (!message || typeof message !== "object" || !("takodeDemo" in message)) return;
    if (message.takodeDemo === "goto") story.goto(message.chapter, { play: message.play });
    if (message.takodeDemo === "pause") story.pause();
    if (message.takodeDemo === "resume") story.resume();
    if (message.takodeDemo === "theme") useStore.getState().setColorTheme(message.dark ? "dark" : "light");
  });
  if (window.parent === window) story.goto(0, { play: true });
  else toPage({ takodeDemo: "ready", chapters: story.chapters });
}

void start();

// For checking the demo by hand from the browser's console.
(window as unknown as { takodeDemo: unknown }).takodeDemo = story;
