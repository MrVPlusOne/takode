/**
 * Takode's visual kit: the stylesheet and frame script every visual block gets.
 *
 * The kit gives agents ready-made shapes in Takode's own look (pipelines and flows,
 * steps, timelines, before/after, stat cards, rows with chips, nested sets, bars,
 * notes), in both themes and narrowing to phone widths, so most visuals need no
 * layout of their own. Tones (`data-tone="decide|look|checked|good|bad|warn|muted|primary"`)
 * pick Takode's colours; agents never choose colours themselves.
 *
 * The frame script reports the frame's height (and, live, a heartbeat and a still copy) to the page, forwards
 * link taps, and in live mode renders the diagram (`.tk-mermaid`) and chart
 * (`.tk-chart`, Vega-Lite) helpers with Takode's theme. It sets
 * `window.__tkVisual.ready` once the visual has settled, which the server renderer
 * waits for too.
 */

export const VISUAL_KIT_CSS = String.raw`
:root {
  --tk-bg: #F5F5F0; --tk-card: #FFFFFF; --tk-fg: #1a1a18; --tk-muted: #6f6a60; --tk-border: rgba(0,0,0,0.13);
  --tk-code: #ECE9DF; --tk-arrow: #b3ada2; --tk-primary: #ae5630;
  --tk-decide: #a35a1c; --tk-look: #1f6aa5; --tk-checked: #2f8a52; --tk-good: #2d7d46; --tk-bad: #c53030;
  --tk-warn: #8a4b00; --tk-tone-muted: #8f897e;
  --tk-tint: 10%;
  color-scheme: light;
  font: 14.5px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
html.dark {
  --tk-bg: #1e1e1e; --tk-card: #181818; --tk-fg: #eeeeee; --tk-muted: #8f8f8f; --tk-border: rgba(255,255,255,0.10);
  --tk-code: #111111; --tk-arrow: #5f5f5f; --tk-primary: #d98a5f;
  --tk-decide: #e0924f; --tk-look: #5ea8e6; --tk-checked: #5cc488; --tk-good: #48bb78; --tk-bad: #fc8181;
  --tk-warn: #f6d365; --tk-tone-muted: #8a8a8a;
  --tk-tint: 13%;
  /* Scrollbars and form controls inside the visual follow its theme. */
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: transparent; color: var(--tk-fg); }
body { overflow-x: auto; overflow-y: hidden; padding: 1px; }
html[data-tk-mode="static"] *, html[data-tk-mode="static"] *::before, html[data-tk-mode="static"] *::after {
  animation: none !important; transition: none !important;
}
p { margin: 0 0 8px; }
h3, h4 { margin: 0; font-size: 15px; font-weight: 650; }
h4 { font-size: 14px; }
small { color: var(--tk-muted); font-size: 12.5px; }
code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--tk-code); padding: 1px 5px; border-radius: 4px; color: var(--tk-primary); }
a { color: var(--tk-primary); text-decoration: none; }
a:hover { text-decoration: underline; }
svg { max-width: 100%; }

[data-tone] { --tone: var(--tk-tone-muted); }
[data-tone="decide"] { --tone: var(--tk-decide); }
[data-tone="look"] { --tone: var(--tk-look); }
[data-tone="checked"] { --tone: var(--tk-checked); }
[data-tone="good"] { --tone: var(--tk-good); }
[data-tone="bad"] { --tone: var(--tk-bad); }
[data-tone="warn"] { --tone: var(--tk-warn); }
[data-tone="primary"] { --tone: var(--tk-primary); }

.tk-lead { font-size: 16px; margin: 0 0 12px; }
.tk-section { font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--tk-muted); margin: 14px 0 8px; font-weight: 600; }
.tk-section:first-child { margin-top: 0; }
.tk-muted { color: var(--tk-muted); }
.tk-caption { text-align: center; color: var(--tk-muted); font-size: 12.5px; margin: 8px 0 0; }

/* Stat cards */
.tk-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: 8px; margin: 0 0 12px; }
.tk-stat { background: var(--tk-card); border: 1px solid var(--tk-border); border-radius: 10px; padding: 7px 12px; min-width: 0; }
.tk-stat b { display: block; font-size: 21px; font-weight: 650; line-height: 1.25; }
.tk-stat[data-tone] b::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--tone); margin-right: 7px; vertical-align: middle; }
.tk-stat span { display: block; font-size: 12.5px; color: var(--tk-muted); }

/* Boxes */
.tk-box, .tk-stage, .tk-card { background: var(--tk-card); border: 1px solid var(--tk-border); border-radius: 12px; padding: 10px 13px; min-width: 0; }
.tk-box { border-radius: 9px; padding: 7px 11px; }
.tk-box[data-tone], .tk-card[data-tone] { border-color: color-mix(in srgb, var(--tone) 55%, transparent); background: color-mix(in srgb, var(--tone) var(--tk-tint), var(--tk-card)); }
.tk-stage > h3, .tk-card > h3 { counter-increment: tk-stage; }
.tk-flow { counter-reset: tk-stage; }
.tk-flow.tk-numbered > .tk-stage > h3::before { content: counter(tk-stage); display: inline-flex; width: 20px; height: 20px; border-radius: 50%; background: var(--tk-fg); color: var(--tk-bg); font-size: 12px; align-items: center; justify-content: center; margin-right: 7px; vertical-align: 1px; }
.tk-sub { color: var(--tk-muted); font-size: 12.5px; margin: 2px 0 8px; }

/* Flows: boxes or stages joined by arrows; a .tk-in span inside a box labels the arrow into it */
.tk-flow { display: flex; align-items: stretch; gap: 34px; margin: 0 0 10px; }
.tk-flow > * { flex: 1 1 0; position: relative; }
.tk-flow > * + *::before { content: ""; position: absolute; left: -31px; top: 50%; width: 26px; height: 2px; background: var(--tk-arrow); }
.tk-flow > * + *::after { content: ""; position: absolute; left: -9px; top: calc(50% - 4px); border-left: 7px solid var(--tk-arrow); border-top: 5px solid transparent; border-bottom: 5px solid transparent; }
.tk-flow.tk-down { flex-direction: column; }
.tk-flow.tk-down { gap: 26px; }
.tk-flow.tk-down > * + *::before { left: calc(50% - 1px); top: -22px; width: 2px; height: 18px; }
.tk-flow.tk-down > * + *::after { left: calc(50% - 5px); top: -8px; border-top: 7px solid var(--tk-arrow); border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 0; }
.tk-in { position: absolute; font: 11px ui-monospace, Menlo, monospace; color: var(--tk-muted); white-space: nowrap; left: -32px; top: calc(50% + 6px); width: 30px; text-align: center; overflow: visible; }
.tk-flow:not(.tk-down) .tk-in { writing-mode: vertical-rl; transform: rotate(180deg); top: auto; bottom: calc(50% + 8px); left: -26px; width: auto; }
.tk-flow.tk-down .tk-in { left: calc(50% + 8px); top: -21px; width: auto; text-align: left; }

/* Steps: a vertical chain inside a stage or on its own */
.tk-steps { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.tk-step { border: 1px solid var(--tk-border); border-radius: 8px; padding: 6px 10px; font-size: 13.5px; background: var(--tk-bg); position: relative; }
.tk-step + .tk-step { margin-top: 14px; }
.tk-step + .tk-step::before { content: ""; position: absolute; left: 50%; top: -15px; width: 2px; height: 14px; background: var(--tk-arrow); }
.tk-step small { display: block; }
.tk-step[data-tone] { border-color: color-mix(in srgb, var(--tone) 55%, transparent); }
.tk-out { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.tk-out > * { font-size: 12.5px; border: 1px dashed var(--tk-arrow); border-radius: 6px; padding: 2px 8px; color: var(--tk-muted); }
.tk-aside { margin-top: 10px; border: 1.5px dashed var(--tk-arrow); border-radius: 10px; padding: 8px 12px; font-size: 13px; color: var(--tk-muted); }
.tk-aside b { color: var(--tk-fg); font-weight: 600; }

/* Badges and chips */
.tk-badge { display: inline-block; font-size: 12px; line-height: 1.45; border-radius: 10px; padding: 2px 9px; margin-top: 6px; font-weight: 550; color: var(--tone, var(--tk-muted)); background: color-mix(in srgb, var(--tone, var(--tk-muted)) var(--tk-tint), transparent); }
.tk-badge::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: currentColor; margin-right: 6px; vertical-align: 1px; }
.tk-badge[data-tone="checked"]::before, .tk-badge[data-tone="good"]::before { content: "\2713"; width: auto; height: auto; background: none; font-size: 11px; }
.tk-badge code { font-size: 11.5px; padding: 0 4px; }
.tk-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.tk-chip { font-size: 12px; border: 1px solid var(--tk-border); border-radius: 6px; padding: 1px 7px; background: var(--tk-bg); white-space: nowrap; }
.tk-chip.tk-wide { border-style: dashed; white-space: normal; }
.tk-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12.5px; color: var(--tk-muted); margin: 0 0 8px; }
.tk-legend > [data-tone]::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--tone); margin-right: 6px; }

/* Rows: one finding per row, a tone mark, text and chips */
.tk-rows { background: var(--tk-card); border: 1px solid var(--tk-border); border-radius: 12px; overflow: hidden; margin: 0 0 10px; }
.tk-rows > .tk-head { padding: 9px 14px; border-bottom: 1px solid var(--tk-border); font-size: 14px; }
.tk-row { display: grid; grid-template-columns: 14px minmax(0, 1.2fr) minmax(0, 1fr); gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--tk-border); align-items: center; font-size: 13.5px; }
.tk-row:last-child { border-bottom: none; }
.tk-row::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--tone, var(--tk-arrow)); }
.tk-row small { display: block; }

/* Sequence: who sends what to whom, in order; one message per row */
.tk-seq { display: grid; grid-template-columns: max-content 18px max-content minmax(0, 1fr); gap: 7px 8px; align-items: baseline; margin: 0 0 10px; font-size: 13.5px; }
.tk-msg { display: contents; }
.tk-msg > :last-child { min-width: 0; }
.tk-actor { font-size: 12.5px; font-weight: 600; border-radius: 6px; padding: 1px 8px; background: color-mix(in srgb, var(--tone, var(--tk-tone-muted)) 16%, transparent); color: var(--tone, var(--tk-fg)); white-space: nowrap; justify-self: start; }
.tk-to { color: var(--tk-arrow); text-align: center; }
.tk-to::before { content: "\2192"; }
.tk-msg.tk-back .tk-to::before { content: "\21E2"; }
.tk-seq > .tk-note { grid-column: 1 / -1; margin: 2px 0; }

/* Timeline */
.tk-timeline { position: relative; margin: 0 0 10px; padding-left: 22px; }
.tk-timeline::before { content: ""; position: absolute; left: 6px; top: 6px; bottom: 6px; width: 2px; background: var(--tk-arrow); }
.tk-event { position: relative; padding: 0 0 12px; font-size: 13.5px; }
.tk-event:last-child { padding-bottom: 0; }
.tk-event::before { content: ""; position: absolute; left: -21px; top: 5px; width: 10px; height: 10px; border-radius: 50%; background: var(--tk-card); border: 2px solid var(--tone, var(--tk-arrow)); }
.tk-event[data-tone]::before { background: var(--tone); }
.tk-event time { display: block; font-size: 12px; color: var(--tk-muted); }
.tk-event[data-tone] > b { color: var(--tone); }

/* Before / after and other side-by-side comparisons */
.tk-compare { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); grid-auto-flow: column; gap: 10px; margin: 0 0 10px; }
.tk-side { background: var(--tk-card); border: 1px solid var(--tk-border); border-radius: 12px; padding: 10px 13px; min-width: 0; }
.tk-side > h4 { margin-bottom: 6px; }
.tk-side[data-tone] { border-top: 3px solid var(--tone); }
.tk-side[data-tone] > h4 { color: var(--tone); }
.tk-side ul { margin: 0; padding-left: 18px; font-size: 13.5px; }

/* Nested sets: 1,600 tasks > 100 tested > 10 picked */
.tk-nest { margin: 0 0 10px; }
.tk-set { border: 1.5px solid var(--tone, var(--tk-arrow)); border-radius: 12px; padding: 8px 12px 12px; background: color-mix(in srgb, var(--tone, var(--tk-arrow)) 6%, transparent); }
.tk-set > .tk-set { margin-top: 8px; }
.tk-set > b { font-size: 17px; margin-right: 6px; }
.tk-set > span { color: var(--tk-muted); font-size: 13px; }

/* Bars: label, bar and value; --v is the bar's share of the width, 0 to 1 */
.tk-bars { display: grid; grid-template-columns: max-content 1fr max-content; gap: 6px 10px; align-items: center; margin: 0 0 10px; font-size: 13px; }
.tk-bar { display: contents; }
.tk-bar > i { display: block; height: 12px; border-radius: 3px; background: var(--tone, var(--tk-look)); width: calc(var(--v, 0) * 100%); min-width: 2px; }
.tk-bar > b { font-weight: 600; font-variant-numeric: tabular-nums; }

/* Notes */
.tk-note { border-left: 3px solid var(--tone, var(--tk-primary)); background: color-mix(in srgb, var(--tone, var(--tk-primary)) 8%, transparent); padding: 7px 12px; border-radius: 0 8px 8px 0; font-size: 13.5px; margin: 0 0 10px; }

.tk-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin: 0 0 10px; }

/* Helpers */
.tk-mermaid { margin: 0; text-align: center; font-size: 0; overflow-x: auto; }
html[data-tk-mode="live"] .tk-mermaid:not([data-processed]) { visibility: hidden; font-size: 12px; }
.tk-mermaid svg { max-width: none; height: auto; }
.tk-mermaid .node rect, .tk-mermaid .cluster rect { rx: 8px; ry: 8px; }
.tk-chart-box { width: 100%; }
.tk-chart-box .vega-embed { width: 100%; }
.tk-chart-box .vega-bindings { font-size: 13px; color: var(--tk-muted); margin-bottom: 6px; }
.tk-error { color: var(--tk-bad); font: 12px ui-monospace, Menlo, monospace; white-space: pre-wrap; }

@media (max-width: 560px) {
  .tk-flow:not(.tk-across) { flex-direction: column; gap: 26px; }
  .tk-flow:not(.tk-across) > * + *::before { left: calc(50% - 1px); top: -22px; width: 2px; height: 18px; }
  .tk-flow:not(.tk-across) > * + *::after { left: calc(50% - 5px); top: -8px; border-top: 7px solid var(--tk-arrow); border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 0; }
  .tk-flow:not(.tk-across) .tk-in { writing-mode: horizontal-tb; transform: none; left: calc(50% + 8px); top: -21px; bottom: auto; width: auto; text-align: left; }
  .tk-compare { grid-auto-flow: row; grid-template-columns: 1fr; }
  .tk-seq { grid-template-columns: max-content 18px minmax(0, 1fr); }
  .tk-msg > :last-child { grid-column: 1 / -1; margin: -3px 0 4px; color: var(--tk-muted); }
  .tk-row { grid-template-columns: 14px 1fr; }
  .tk-row > .tk-chips { grid-column: 2; }
  .tk-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tk-lead { font-size: 15px; }
}
`;

/** Runs first inside every visual frame. Plain ES2017 so every browser runs it as is. */
export const VISUAL_KIT_BOOTSTRAP = String.raw`(function () {
  var config = window.__tkVisualConfig || {};
  var state = (window.__tkVisual = { ready: false, errors: [] });
  var embedded = window.parent && window.parent !== window;
  function post(message) {
    if (!embedded) return;
    message.takodeVisual = config.id;
    try { window.parent.postMessage(message, "*"); } catch (e) {}
  }
  window.addEventListener("error", function (event) { state.errors.push(String(event.message || event.error)); });
  window.addEventListener("unhandledrejection", function (event) { state.errors.push(String(event.reason)); });

  // Heartbeat with how late the timer fired, so the page can tell a busy or hung visual. A
  // still picture runs no agent code and isn't watched, so it stays quiet.
  if (config.mode === "live") {
    var last = Date.now();
    setInterval(function () {
      var now = Date.now();
      post({ kind: "beat", lag: Math.max(0, now - last - 250) });
      last = now;
    }, 250);
  }

  // The settled visual without scripts: canvases become images, handlers and script tags go.
  // Takode keeps it as a still picture to show instantly whenever the live visual reloads.
  state.snapshot = function () {
    var clone = document.body.cloneNode(true);
    var canvases = document.body.querySelectorAll("canvas");
    clone.querySelectorAll("canvas").forEach(function (canvas, index) {
      var source = canvases[index];
      var img = document.createElement("img");
      try { img.src = source.toDataURL("image/png"); } catch (error) {}
      img.width = source.clientWidth; img.height = source.clientHeight;
      img.style.cssText = source.style.cssText;
      canvas.replaceWith(img);
    });
    clone.querySelectorAll("script, iframe, object, embed").forEach(function (node) { node.remove(); });
    clone.querySelectorAll("*").forEach(function (node) {
      node.getAttributeNames().forEach(function (name) { if (/^on/i.test(name)) node.removeAttribute(name); });
    });
    var styles = Array.prototype.map.call(document.querySelectorAll("head style:not(#tk-kit)"), function (s) { return s.outerHTML; }).join("");
    return styles + clone.innerHTML;
  };

  function height() {
    // The body, not the document: the document is at least as tall as the frame, so it could never shrink.
    return document.body ? Math.ceil(document.body.scrollHeight) : 0;
  }
  var lastHeight = 0;
  function reportSize() {
    var h = height();
    if (h !== lastHeight) { lastHeight = h; post({ kind: "size", height: h }); }
  }

  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link) return;
    event.preventDefault();
    post({ kind: "link", href: link.getAttribute("href") });
  });

  var dark = config.theme === "dark";
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function renderMermaid() {
    var blocks = document.querySelectorAll(".tk-mermaid");
    if (!blocks.length || !window.mermaid) return Promise.resolve();
    var narrow = document.body.clientWidth < 560;
    // Mermaid parses colours itself, so mix tints here instead of with CSS color-mix().
    function rgb(hex) { var n = parseInt(hex.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    function tint(tone) {
      var a = rgb(tone), b = rgb(dark ? "#181818" : "#ffffff"), share = dark ? 0.2 : 0.13;
      return "#" + a.map(function (v, i) { return Math.round(v * share + b[i] * (1 - share)).toString(16).padStart(2, "0"); }).join("");
    }
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "antiscript",
      theme: "base",
      fontFamily: "system-ui, -apple-system, sans-serif",
      themeVariables: {
        darkMode: dark, background: "transparent", fontSize: "14px",
        primaryColor: css("--tk-card"), primaryTextColor: css("--tk-fg"), primaryBorderColor: css("--tk-arrow"),
        secondaryColor: css("--tk-bg"), tertiaryColor: css("--tk-bg"), lineColor: css("--tk-arrow"), textColor: css("--tk-fg"),
        clusterBkg: dark ? "#1f1f1f" : "#fbfaf6", clusterBorder: css("--tk-border"), titleColor: css("--tk-muted"),
        actorBkg: css("--tk-card"), actorBorder: css("--tk-arrow"), actorTextColor: css("--tk-fg"),
        signalColor: css("--tk-muted"), signalTextColor: css("--tk-fg"), labelBoxBkgColor: css("--tk-card"),
        noteBkgColor: tint(css("--tk-decide")), noteTextColor: css("--tk-fg"), noteBorderColor: css("--tk-decide"),
        edgeLabelBackground: css("--tk-card"),
        git0: css("--tk-look"), git1: css("--tk-decide"), git2: css("--tk-checked"), git3: css("--tk-primary"),
        gitBranchLabel0: "#111", gitBranchLabel1: "#111", gitBranchLabel2: "#111", gitBranchLabel3: "#fff",
        commitLabelColor: css("--tk-fg"), commitLabelBackground: css("--tk-card"),
        tagLabelBackground: css("--tk-checked"), tagLabelColor: "#fff", tagLabelBorder: css("--tk-checked")
      },
      flowchart: narrow
        ? { useMaxWidth: false, htmlLabels: true, curve: "basis", nodeSpacing: 24, rankSpacing: 36, wrappingWidth: 140, padding: 10 }
        : { useMaxWidth: false, htmlLabels: true, curve: "basis" },
      sequence: { useMaxWidth: false, mirrorActors: false, actorMargin: 28, messageMargin: 26 },
      gitGraph: { useMaxWidth: false, rotateCommitLabel: false },
      timeline: { useMaxWidth: false },
      state: { useMaxWidth: false }
    });
    // Tones work in diagrams too: "class nodeA decide" and friends.
    var tones = ["decide", "look", "checked", "good", "bad", "warn", "primary"];
    blocks.forEach(function (block) {
      // The page parsed tags written in the diagram (like <br/> in a label) as elements;
      // put them back as text so the diagram source is what the agent wrote.
      block.querySelectorAll("*").forEach(function (element) {
        if (element.parentNode) element.replaceWith(document.createTextNode(element.outerHTML.replace(/<br>/g, "<br/>")));
      });
      var text = block.textContent || "";
      if (/^\s*(flowchart|graph)\b/.test(text)) {
        text += "\n" + tones.map(function (tone) {
          var color = css("--tk-" + tone);
          return "classDef " + tone + " fill:" + tint(color) + ",stroke:" + color + ",color:" + css("--tk-fg");
        }).join("\n");
      }
      block.textContent = text;
    });
    // One at a time, so a broken diagram shows its error without hiding the others.
    var chain = Promise.resolve();
    blocks.forEach(function (block) {
      chain = chain.then(function () {
        return window.mermaid.run({ nodes: [block] }).catch(function (error) {
          var message = "Diagram: " + (error && error.message ? error.message : error);
          state.errors.push(message);
          var box = document.createElement("div");
          box.className = "tk-error";
          box.textContent = message;
          block.replaceWith(box);
        });
      });
    });
    return chain;
  }

  function renderCharts() {
    var specs = document.querySelectorAll("script.tk-chart");
    if (!specs.length || !window.vegaEmbed) return Promise.resolve();
    var fg = css("--tk-fg"), muted = css("--tk-muted"), grid = css("--tk-border");
    var config = {
      background: null, font: "system-ui, -apple-system, sans-serif",
      view: { stroke: null },
      axis: { labelColor: muted, titleColor: muted, gridColor: grid, domainColor: grid, tickColor: grid, labelFontSize: 12, titleFontSize: 12, titleFontWeight: 500 },
      legend: { labelColor: fg, titleColor: muted, labelFontSize: 12, titleFontSize: 12, orient: "top" },
      title: { color: fg, fontSize: 13, fontWeight: 600, anchor: "start" },
      header: { labelColor: fg, titleColor: muted, labelFontSize: 12 },
      text: { color: fg },
      range: { category: [css("--tk-look"), css("--tk-decide"), css("--tk-checked"), css("--tk-primary"), css("--tk-tone-muted"), css("--tk-bad")] }
    };
    var jobs = [];
    specs.forEach(function (script) {
      var box = document.createElement("div");
      box.className = "tk-chart-box";
      script.parentNode.insertBefore(box, script);
      try {
        var spec = JSON.parse(script.textContent || "{}");
        if (spec.width === undefined) spec.width = "container";
        spec.autosize = spec.autosize || { type: "fit-x", contains: "padding" };
        jobs.push(window.vegaEmbed(box, spec, { renderer: "svg", actions: false, config: config, theme: dark ? "dark" : undefined })
          .catch(function (error) { box.innerHTML = '<div class="tk-error"></div>'; box.firstChild.textContent = "Chart: " + error.message; state.errors.push("Chart: " + error.message); }));
      } catch (error) {
        state.errors.push("Chart: " + error.message);
      }
    });
    return Promise.all(jobs);
  }

  // A diagram a little wider than the frame shrinks to fit (14px text stays at 11px or more);
  // a much wider one keeps its size and scrolls sideways.
  function fitDiagrams() {
    if (!document.body) return;
    var available = document.body.clientWidth - 2;
    document.querySelectorAll(".tk-mermaid svg").forEach(function (svg) {
      var box = svg.viewBox && svg.viewBox.baseVal;
      var natural = box && box.width ? box.width : svg.getBoundingClientRect().width;
      if (!natural) return;
      var scale = Math.min(1, available / natural);
      svg.style.maxWidth = "none";
      svg.style.width = (scale >= 0.78 ? natural * scale : natural) + "px";
      svg.style.height = "auto";
    });
  }
  window.addEventListener("resize", fitDiagrams);

  // Two animation frames let layout settle, but Chrome runs no animation frames in a frame
  // that is off screen (visuals load a little before they scroll in), so a short timer also counts.
  function frame() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
      setTimeout(resolve, 80);
    });
  }

  function settle() {
    var helpers =
      config.mode === "live"
        ? Promise.all([renderMermaid().then(fitDiagrams), renderCharts()])
        : Promise.resolve().then(fitDiagrams);
    return helpers
      .then(function () { return document.fonts && document.fonts.ready; })
      .catch(function (error) { state.errors.push(String(error)); })
      .then(frame)
      .then(function () {
        state.ready = true;
        reportSize();
        if (window.ResizeObserver) new ResizeObserver(reportSize).observe(document.body);
        post({ kind: "ready", height: height(), errors: state.errors.slice(0, 5) });
        if (config.mode === "live" && embedded) {
          try {
            var still = state.snapshot();
            if (still.length <= 1048576) post({ kind: "snapshot", html: still });
          } catch (error) {}
        }
      });
  }
  if (document.readyState === "complete") settle();
  else window.addEventListener("load", settle);
})();`;
