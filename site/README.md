# Takode landing page

A static page that introduces Takode: the living Ink & Paper painting as the hero, a demo of a leader at work that doubles as a short tutorial, and the main features.

- `index.html`, `site.css`, `site.js`: the page.
- `demo/takode-demo.js`: the demo window. It holds the real Takode app in a frame (`demo/app/`), loads it once the visitor comes near and pauses it off screen. Its chips and captions walk through a typical day: ask a leader, it files quests, workers run, you decide, changes land, results return, review a change.
- `demo/app/`: the demo app, built from `web/src/site-demo` and not checked in. Build it from `web/`:

  ```bash
  bun --no-install run build:site-demo
  ```

- `demo/landing-queue.*`: the landing-queue animation.
- `demo/ink-alive.js`: the app's living painting (`web/src/scenic/ink-alive`), bundled for the page. Rebuild it after the scene changes, from `web/`:

  ```bash
  bun --no-install ../site/tools/build-ink.ts
  ```

- `assets/img/`: the painted layers and portraits, copied from `web/public`, plus `paper-day.webp` and `paper-night.webp`, the app's mulberry paper texture pre-blended onto the page colors. Pre-blending keeps the texture off the compositor; a fixed, blended full-page layer made scrolling stall. In the still night painting (`ink-night.v2.webp`) the moon is moved to where the day sun sits, so it stays clear of the headline, as it does in the live painting.
- `assets/shots/`: screenshots of the same mock Pocket Ledger project as the README screenshots, cut down to the part each section talks about so they stay readable at page width. Each has a `-dark` twin taken in the app's dark theme, shown when the page is in night mode. Retake both when the app's look changes.

## The demo is the real app

The demo is not a mockup. `web/src/site-demo` builds the app itself with a stand-in server (`demo-backend.ts`) in place of the real one: it answers the app's WebSocket and API requests with the same messages a Takode server sends, building conversation windows with the server's shared code. A script (`pocket-ledger.ts`) plays a day of work on Pocket Ledger, a made-up project, by changing the stand-in server's data; the guided review in the last chapter is prepared by the same shared code that publishes real ones (`accent-search-review.ts`). So the demo looks exactly like Takode, and it follows the app as the app changes:

- The demo is built from the same commit as the page, so it always shows the current UI.
- The stand-in server and the story are type-checked with the app.
- `pocket-ledger.test.tsx` plays every chapter, checks the data with the validators the browser applies, and renders each chapter in the real app. It runs in the normal test suite, so a change that breaks the demo fails there.

The story stays made-up and free of private content, and shows no internal labels.

## Previewing

Phones, reduced motion, data saver and low-power devices get the still painting; `?live` and `?still` force either one. The live painting also pauses while the hero is mostly scrolled away.

To preview, build the demo app, then open `index.html` from disk or serve the folder with any static server.

The repo's format check (`cd web && bun --no-install run format:check`) and the pre-commit hook cover the page's scripts too, all but the generated `demo/ink-alive.js` bundle and the built `demo/app/`. CSS and HTML are not formatted, as in `web/`. The 2000-line file limit applies here as everywhere.
