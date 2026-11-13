// The demo window: the real Takode app, built from web/src/site-demo into demo/app/, in a frame.
// It loads when the visitor nears it and pauses off screen. The chips and caption walk through a
// typical day with a leader, a short tutorial for newcomers.
// Usage: const demo = TakodeDemoFrame.mount({ host, chips, caption, dark, onEnded })

(function () {
  // Ids match the story's chapters (web/src/site-demo/pocket-ledger.ts).
  const CHAPTERS = [
    ["ask", "Ask a leader", "Start a thread from the leader's Home and ask in plain words, as you'd ask a colleague."],
    [
      "plan",
      "It files quests",
      "The leader files a quest for each request, starts workers and notes what waits for what.",
    ],
    [
      "parallel",
      "Workers run",
      "Each worker is a real Claude Code or Codex session in its own worktree; each quest's tab shows how it's going.",
    ],
    ["decision", "You decide", "Only real choices reach you, with the context to make them. Pick one."],
    ["land", "Changes land", "Checked changes land on main; queued quests start as workers free up."],
    ["results", "Results return", "A short summary comes back in your thread, and every quest keeps its record."],
    [
      "review",
      "Review a change",
      "When you want to read the code, a guided review walks you through it, your decisions first.",
    ],
  ];

  function mount({ host, chips, caption, dark, onEnded }) {
    let ready = false;
    let visible = false;
    let started = false;
    let isDark = dark;

    const frame = document.createElement("iframe");
    frame.className = "demo-app";
    frame.title = "Takode, playing a day of work on a made-up project";
    host.appendChild(frame);
    const send = (message) => ready && frame.contentWindow.postMessage({ ...message }, "*");

    const show = (index) => {
      [...chips.children].forEach((li, j) => {
        li.classList.toggle("on", j === index);
        li.classList.toggle("past", j < index);
      });
      caption.textContent = CHAPTERS[index][2];
      // Scroll only the chip row, never the page.
      const chip = chips.children[index];
      if (chip && chips.scrollWidth > chips.clientWidth)
        chips.scrollTo({ left: chip.offsetLeft - (chips.clientWidth - chip.offsetWidth) / 2, behavior: "smooth" });
    };
    CHAPTERS.forEach(([, title], index) => {
      const li = document.createElement("li");
      li.innerHTML = `<button type="button">${title}</button>`;
      li.onclick = () => {
        host.classList.remove("ended");
        send({ takodeDemo: "goto", chapter: index, play: true });
        show(index);
      };
      chips.appendChild(li);
    });
    show(0);

    const play = () => {
      if (!ready || !visible) return;
      if (!started) {
        started = true;
        send({ takodeDemo: "goto", chapter: 0, play: true });
      } else send({ takodeDemo: "resume" });
    };

    addEventListener("message", (event) => {
      const message = event.data;
      if (event.source !== frame.contentWindow || !message || typeof message.takodeDemo !== "string") return;
      if (message.takodeDemo === "ready") {
        ready = true;
        host.classList.add("loaded");
        send({ takodeDemo: "theme", dark: isDark });
        play();
      }
      if (message.takodeDemo === "chapter") show(message.chapter);
      if (message.takodeDemo === "ended") {
        host.classList.add("ended");
        onEnded?.();
      }
    });

    // Load the app (about 1 MB) only once the visitor comes near the demo.
    new IntersectionObserver(
      ([entry], observer) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        // A single-file preview of the page carries the app inline instead.
        if (window.TAKODE_DEMO_SRCDOC) frame.srcdoc = window.TAKODE_DEMO_SRCDOC;
        else frame.src = `demo/app/site-demo.html?theme=${isDark ? "dark" : "light"}`;
      },
      { rootMargin: "900px 0px" },
    ).observe(host);
    // Play while the window is mostly in view; pause when it isn't.
    new IntersectionObserver(
      ([entry]) => {
        visible = entry.intersectionRatio >= 0.35;
        if (visible) play();
        else send({ takodeDemo: "pause" });
      },
      { threshold: [0, 0.35, 1] },
    ).observe(host);

    return {
      setTheme(dark) {
        isDark = dark;
        send({ takodeDemo: "theme", dark });
      },
    };
  }

  window.TakodeDemoFrame = { mount, CHAPTERS };
})();
