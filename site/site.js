// Ink & Paper landing page: the living painting, day/night, the team diagram and the demo.

const canvas = document.getElementById("ink");
// The living painting is for desktops with power to spare. Phones, reduced motion, data saver
// and low-end machines get the still painting instead; ?still and ?live force either one.
const lowPower =
  (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4 || !!navigator.connection?.saveData;
const still = location.search.includes("live")
  ? false
  : location.search.includes("still") ||
    matchMedia("(prefers-reduced-motion: reduce)").matches ||
    matchMedia("(max-width: 820px), (pointer: coarse)").matches ||
    lowPower;
let dark = false;
let stopInk = null;

function startInk() {
  stopInk?.();
  stopInk = null;
  if (still) return document.body.classList.add("no-gl");
  stopInk = TakodeInk.start(canvas, { dark, motion: true, onFail: () => document.body.classList.add("no-gl") });
  if (!stopInk) document.body.classList.add("no-gl");
}

// The scene pauses once most of the hero is scrolled away, so scrolling the rest of the page
// never competes with it for the GPU; it keeps its state and resumes where it left off.
new IntersectionObserver(
  ([entry]) => {
    window.TAKODE_INK_PAUSED = entry.intersectionRatio <= 0.4;
  },
  { threshold: [0, 0.4, 1] },
).observe(document.querySelector(".hero"));
startInk();

const nightBtn = document.getElementById("night");
const demoEl = document.getElementById("demo");
nightBtn.onclick = () => {
  dark = !dark;
  document.body.classList.toggle("night", dark);
  nightBtn.querySelector(".ic").textContent = dark ? "☀" : "☾";
  nightBtn.querySelector(".lbl").textContent = dark ? "Day" : "Night";
  nightBtn.title = dark ? "Switch to day" : "Switch to night";
  demo.setTheme(dark);
  document.querySelector('link[rel="icon"]').href = `./assets/img/favicon${dark ? "-night" : ""}.png`;
  drawStamp();
  startInk();
};

// Cranes cross the sky when you hover or tap the seal, as they do in the app.
const seal = document.querySelector(".seal");
const cranes = () => window.dispatchEvent(new CustomEvent(TakodeInk.MOMENT_EVENT, { detail: "cranes" }));
seal.addEventListener("mouseenter", cranes);
seal.addEventListener("click", cranes);

// ---- team diagram ----
const lines = [
  [
    "Read src/import/ofx.ts",
    "Found it: the file is parsed in one pass",
    "Edit ofx.ts: read in batches",
    "Ran import tests · 38 passed",
  ],
  [
    "Measured contrast on 9 screens",
    "Asked you: everywhere or the report page?",
    "Edit theme.css",
    "Checked 9 screens · all pass",
  ],
  [
    "Reproduced: October off by 0.01",
    "Found it: amounts added as decimals",
    "Edit money.ts: add in cents",
    "Ran report tests · 61 passed",
  ],
];
const lives = document.querySelectorAll("[data-live]");
let tick = 0;
function cycle() {
  lives.forEach((el, i) => {
    el.textContent = lines[i][(tick + i) % 4];
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  });
  tick++;
}
cycle();
setInterval(cycle, 2400);

// Brush strokes from the leader's portrait to each slip: curves when they sit side by side,
// a spine down the left edge when the slips are stacked under the portrait (phones).
const art = document.querySelector(".team-art");
function drawStrokes() {
  const box = art.getBoundingClientRect();
  const img = art.querySelector(".leader img").getBoundingClientRect();
  const caption = art.querySelector(".leader figcaption").getBoundingClientRect();
  if (!img.width) return;
  const paths = art.querySelectorAll(".strokes path");
  const slips = [...art.querySelectorAll(".slip")];
  const stacked = img.bottom <= slips[0].getBoundingClientRect().top;
  slips.forEach((slip, i) => {
    // Slips slide in from the right; measure their resting place, not the start of that slide.
    const r = slip.getBoundingClientRect();
    const shift = art.classList.contains("drawn") ? 0 : 16;
    const x1 = r.left - shift - box.left;
    const y1 = r.top + r.height / 2 - box.top;
    let d;
    if (stacked) {
      const x0 = x1 - 16;
      // Start under the caption so the stroke doesn't underline it.
      const y0 = caption.bottom - box.top + 6;
      d = `M${img.left + img.width / 2 - box.left} ${y0} Q ${x0} ${y0}, ${x0} ${y0 + 30} L ${x0} ${y1 - 10} Q ${x0} ${y1}, ${x1} ${y1}`;
    } else {
      const x0 = img.right - box.left - 4;
      const y0 = img.top + img.height / 2 - box.top;
      const mx = (x0 + x1) / 2;
      d = `M${x0} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
    }
    paths[i].setAttribute("d", d);
  });
}
art.querySelector(".leader img").addEventListener("load", drawStrokes);
new IntersectionObserver(
  ([e]) => {
    drawStrokes();
    if (e.isIntersecting) art.classList.add("drawn");
  },
  { threshold: 0.35 },
).observe(art);
addEventListener("resize", drawStrokes);
drawStrokes();

// ---- demo ----
const stamp = document.getElementById("stamp");
function drawStamp() {
  stamp.innerHTML = TakodeInk.sealSvg(["圆", "满"], 58, 104, dark);
}
drawStamp();
// Press the app's 圆满 ("perfectly done") seal when the day's work is done.
const demo = TakodeDemoFrame.mount({
  host: demoEl,
  chips: document.getElementById("beats"),
  caption: document.getElementById("caption"),
  dark,
  onEnded: () => stamp.classList.add("on"),
});
for (const chip of document.getElementById("beats").children)
  chip.addEventListener("click", () => stamp.classList.remove("on"));

TakodeLandingQueue.mount(document.getElementById("lq"));

document.getElementById("copy").onclick = (e) => {
  navigator.clipboard.writeText(document.querySelector(".code pre").textContent);
  e.target.textContent = "Copied";
};
