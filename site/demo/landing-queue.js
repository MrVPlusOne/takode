// Animated landing queue: changes wait in line, are tested together, a failing
// batch is narrowed down to the one change that broke it, and the rest land.
// Mount: TakodeLandingQueue.mount(el)

(function () {
  // The five quests from the demo; the flaky test's change is the one that breaks the batch.
  const CHANGES = [
    ["q-22", "OFX import in batches"],
    ["q-24", "Totals in cents"],
    ["q-26", "Steadier import test"],
    ["q-23", "Readable muted text"],
    ["q-25", "Accent-blind search"],
  ];
  const BAD = "q-26";
  const FIRST_HALF = ["q-22", "q-24"];
  const SECOND_HALF = ["q-26", "q-23", "q-25"];

  function mount(root) {
    root.classList.add("lq");
    root.innerHTML = `
      <div class="lq-lane lq-wait"><div class="lq-label">Waiting</div><div class="lq-slots" data-z="wait"></div></div>
      <div class="lq-lane lq-test"><div class="lq-label" data-z="testlabel">Tested together</div><div class="lq-slots" data-z="test"></div></div>
      <div class="lq-lane lq-main"><div class="lq-label">Landed on main</div><div class="lq-slots" data-z="main"></div></div>
      <div class="lq-note" data-z="note"></div>`;
    const z = (n) => root.querySelector(`[data-z="${n}"]`);
    const pills = {};
    for (const [id] of CHANGES) {
      const p = document.createElement("div");
      p.className = "lq-pill";
      pills[id] = p;
    }
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const move = (id, zone, cls) => {
      const p = pills[id];
      p.className = "lq-pill" + (cls ? " " + cls : "");
      z(zone).appendChild(p);
    };
    const mark = (ids, from, to) => ids.forEach((id) => pills[id].classList.replace(from, to));
    const note = (t) => (z("note").textContent = t);

    let running = false;
    async function run() {
      if (running) return;
      running = true;
      for (const zone of ["wait", "test", "main"]) z(zone).innerHTML = "";
      for (const [id, title] of CHANGES) pills[id].innerHTML = `<b>${id}</b> ${title}`;
      root.classList.remove("lq-done");
      z("testlabel").textContent = "Tested together";
      note("Five workers finished. Their changes wait in line; nobody waits on CI.");
      for (const [id] of CHANGES) {
        move(id, "wait");
        await wait(360);
      }
      await wait(900);
      note("The queue tests the whole batch at once.");
      for (const [id] of CHANGES) {
        move(id, "test", "testing");
        await wait(150);
      }
      await wait(1600);
      mark(
        CHANGES.map(([id]) => id),
        "testing",
        "failed",
      );
      note("One test fails. Which change broke it?");
      await wait(1500);
      z("testlabel").textContent = "Narrowing it down";
      note("The queue splits the batch and tests each half…");
      mark(
        CHANGES.map(([id]) => id),
        "failed",
        "testing",
      );
      await wait(1500);
      for (const id of FIRST_HALF) {
        move(id, "main", "landed");
        await wait(200);
      }
      await wait(700);
      note("…then narrows the failing half down to one change.");
      await wait(1300);
      mark(
        SECOND_HALF.filter((id) => id !== BAD),
        "testing",
        "ok",
      );
      pills[BAD].classList.replace("testing", "failed");
      await wait(900);
      for (const id of SECOND_HALF.filter((id) => id !== BAD)) {
        move(id, "main", "landed");
        await wait(200);
      }
      pills[BAD].classList.add("bounced");
      note(`The batch broke; the queue found ${BAD} and landed the rest without asking you.`);
      await wait(2400);
      move(BAD, "wait", "fixing");
      pills[BAD].innerHTML = `<b>${BAD}</b> fixed by its worker`;
      note(`${BAD} went back to its worker with the failing test.`);
      await wait(1600);
      move(BAD, "test", "testing");
      await wait(1300);
      move(BAD, "main", "landed");
      note(`Fixed, retested and landed: all five changes are on main.`);
      running = false;
      root.classList.add("lq-done");
    }

    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          io.disconnect();
          run();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(root);
    return { run };
  }

  window.TakodeLandingQueue = { mount };
})();
