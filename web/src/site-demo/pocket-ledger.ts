/**
 * The landing page's demo story: a typical day with a Takode leader on a made-up project,
 * Pocket Ledger. Each chapter is one step of the tutorial the page tells beside it. The story
 * only changes the stand-in server's model; the real app shows the result.
 */
import type { BoardRow } from "../../server/session-types.js";
import type { QuestJourneyPlanState } from "../../shared/quest-journey.js";
import { ACCENT_REVIEW_ARTIFACT_ID, accentReview } from "./accent-search-review.js";
import type { DemoBackend } from "./demo-backend.js";

/** The chapters, in order. The page shows each one's title and caption. */
export const POCKET_LEDGER_CHAPTERS = ["ask", "plan", "parallel", "decision", "land", "results", "review"] as const;
export type PocketLedgerChapter = (typeof POCKET_LEDGER_CHAPTERS)[number];

export type DecisionChoice = "everywhere" | "report";

/** What the tutorial points at: the parts of the screen the captions name. */
export type PointerTarget =
  | "composer"
  | "tabs"
  | "worker"
  | "question"
  | "bell"
  | "status"
  | "review-decision"
  | "review-answers";

/** The demo page's hands on the app's screen; the story runs without them in tests. */
export interface StoryUi {
  press: (label: string) => void;
  point: (target: PointerTarget) => void;
}

const LEADER = "pocket-ledger";
const OPUS = "claude-opus-5.5";
const CODEX = "gpt-5.6-sol";
const WORKERS = [
  { id: "pl-worker-18", num: 18, quest: "q-22", backend: "claude-sdk", model: OPUS },
  { id: "pl-worker-19", num: 19, quest: "q-23", backend: "codex", model: CODEX },
  { id: "pl-worker-20", num: 20, quest: "q-24", backend: "claude-sdk", model: OPUS },
] as const;
const QUESTS = [
  [
    "q-22",
    "OFX import freezes on big files",
    "Importing a bank's 40 MB OFX export freezes the app; import it without freezing.",
  ],
  ["q-23", "Faint text in the dark theme", "Muted text is hard to read on dark cards; make it readable."],
  [
    "q-24",
    "Monthly totals off by a cent",
    "Some monthly totals are a cent off because of floating-point sums; total in cents.",
  ],
  ["q-25", "Search ignores accents", 'Searching "cafe" should find "Café".'],
  ["q-26", "Flaky import test", "The import test sometimes fails on a slow machine; make it reliable."],
] as const;

type Step = { chapter: PocketLedgerChapter; wait: number; run: (story: StoryState) => void };

interface StoryState {
  backend: DemoBackend;
  /** The thread the user's request started. */
  thread: string;
  choice: DecisionChoice | null;
  view: (thread: string) => void;
  /** Opens a Library artifact's page, as clicking its link does. */
  openArtifact: (id: string) => void;
  /** Presses a button on screen by its label, as the visitor would; does nothing where none shows. */
  press: (label: string) => void;
  /** Briefly rings the part of the screen the chapter's caption talks about. */
  point: (target: PointerTarget) => void;
  requestUserU?: string;
  decisionId?: string;
}

/** Journey states as the server's board keeps them. */
function journey(phaseIds: QuestJourneyPlanState["phaseIds"], index: number): QuestJourneyPlanState {
  return {
    presetId: "custom",
    phaseIds,
    mode: "active",
    activePhaseIndex: index,
    currentPhaseId: phaseIds[index],
  } as QuestJourneyPlanState;
}

const WORK = journey(["work", "memory"], 0);
const MEMORY = journey(["work", "memory"], 1);
const CHECKPOINT = journey(["work", "user-checkpoint", "work", "memory"], 1);
const BACK_TO_WORK = journey(["work", "user-checkpoint", "work", "memory"], 2);
const AFTER_CHECKPOINT_MEMORY = journey(["work", "user-checkpoint", "work", "memory"], 3);

function working(worker: (typeof WORKERS)[number]): Partial<BoardRow> {
  return { status: "WORKING", worker: worker.id, workerNum: worker.num, journey: WORK, waitFor: [] };
}

const THREAD_NAME = "Tester bug reports";
const REQUEST =
  "Five bug reports from this week's testers: the OFX import freezes on big files, muted text is faint in the dark theme, monthly totals are off by a cent, search ignores accents, and the import test is flaky. Can you take them?";

/** The request as it grows while being typed, a few words at a time. */
function typing(text: string): string[] {
  const words = text.split(" ");
  const steps: string[] = [];
  for (let end = 3; end < words.length; end += 3) steps.push(words.slice(0, end).join(" "));
  steps.push(text);
  return steps;
}

/** What each worker does first, as its quest's tab previews it. */
const FIRST_STEPS: Record<string, Array<[string, string]>> = {
  "q-22": [
    ["Read", "src/import/ofx.ts"],
    ["Bash", "bun test import -t 'large file'"],
  ],
  "q-23": [
    ["Grep", "--color-muted in src/theme"],
    ["Read", "src/theme/dark.css"],
  ],
  "q-24": [
    ["Read", "src/report/monthly-totals.ts"],
    ["Bash", "bun test report"],
  ],
};

const STEPS: Step[] = [
  // 1. You ask the leader from its Home, in plain words, as you would ask a colleague.
  { chapter: "ask", wait: 400, run: (s) => s.view("main") },
  { chapter: "ask", wait: 900, run: (s) => s.point("composer") },
  ...typing(REQUEST).map(
    (text, index): Step => ({ chapter: "ask", wait: index === 0 ? 1800 : 70, run: (s) => s.backend.typeInHome(text) }),
  ),
  {
    chapter: "ask",
    wait: 900,
    run: (s) => {
      s.backend.typeInHome(null);
      s.thread = s.backend.startThread(THREAD_NAME);
      s.requestUserU = s.backend.userSays(REQUEST, s.thread);
      s.backend.setRunning(LEADER, true, s.thread);
      s.view(s.thread);
    },
  },
  // 2. It files a quest for each and starts workers, noting what waits for what.
  {
    chapter: "plan",
    wait: 2600,
    run: (s) => {
      const b = s.backend;
      b.completeBoardRow("q-21");
      for (const [id] of QUESTS) b.setBoardRow(id, { status: "QUEUED" });
      for (const worker of WORKERS) {
        b.addSession({
          id: worker.id,
          num: worker.num,
          name: QUESTS.find(([id]) => id === worker.quest)![1],
          backend: worker.backend,
          model: worker.model,
          leaderId: LEADER,
        });
        b.setRunning(worker.id, true, worker.quest);
        b.setBoardRow(worker.quest, working(worker));
        for (const [tool, text] of FIRST_STEPS[worker.quest]) b.workerDoes(worker.id, tool, text);
      }
      b.setBoardRow("q-25", { status: "QUEUED", waitFor: ["free-worker"] });
      b.setBoardRow("q-26", { status: "QUEUED", waitFor: ["q-22"] });
      b.leaderSays(
        "I filed a quest for each report and started three workers, each in its own worktree:\n\n" +
          "- [q-22](quest:q-22) OFX import freezes on big files: [#18](session:18) on Claude Code\n" +
          "- [q-23](quest:q-23) Faint text in the dark theme: [#19](session:19) on Codex\n" +
          "- [q-24](quest:q-24) Monthly totals off by a cent: [#20](session:20) on Claude Code\n" +
          "- [q-25](quest:q-25) Search ignores accents: starts when a worker is free\n" +
          "- [q-26](quest:q-26) Flaky import test: waits for q-22, since both change the importer\n\n" +
          "I'll check each change before it lands and bring you only what needs your call.",
        s.thread,
        { status: { kind: "waiting", summary: "three quests in Work, two queued" } },
      );
      b.endTurn(s.thread);
    },
  },
  { chapter: "plan", wait: 1200, run: (s) => s.point("tabs") },
  // 3. Workers run in parallel; each quest's tab shows how its work is going.
  {
    chapter: "parallel",
    wait: 5500,
    run: (s) => {
      s.backend.workerDoes(WORKERS[0].id, "Edit", "src/import/ofx.ts");
      s.backend.workerDoes(WORKERS[0].id, "Bash", "bun test import");
      s.backend.leaderSays(
        "[#18](session:18) found the cause: the importer reads the whole file into memory before parsing. It's switching to reading in batches of 500 transactions.",
        "q-22",
      );
      s.view("q-22");
    },
  },
  { chapter: "parallel", wait: 1400, run: (s) => s.point("worker") },
  {
    chapter: "parallel",
    wait: 4500,
    run: (s) => {
      s.backend.workerDoes(WORKERS[2].id, "Edit", "src/report/monthly-totals.ts");
      s.backend.workerDoes(WORKERS[2].id, "Bash", "bun test report");
      s.backend.leaderSays(
        "[#20](session:20) confirmed the cent: amounts were added as decimals. Totals now add whole cents, with a test for the March report that was off.",
        "q-24",
      );
      s.view("q-24");
    },
  },
  // 4. Only a real choice reaches you, with the context to make it.
  {
    chapter: "decision",
    wait: 4500,
    run: (s) => {
      const b = s.backend;
      b.workerDoes(WORKERS[1].id, "Read", "src/theme/tokens.css");
      b.workerDoes(WORKERS[1].id, "Bash", "bun run contrast-check");
      b.setRunning(WORKERS[1].id, false);
      b.setBoardRow("q-23", { status: "USER_CHECKPOINTING", journey: CHECKPOINT });
      s.decisionId = b.ask(
        "q-23",
        "Faint text: which fix?",
        "[#19](session:19) found the cause of the faint text: muted text uses one gray everywhere, and it is too faint on dark cards. Two ways to fix it:\n\n" +
          "1. **Fix it everywhere.** One change to the shared gray. Muted text on 9 screens gets slightly brighter.\n" +
          "2. **Report page only.** The smallest change. Other screens stay faint for now.\n\n" +
          "I'd fix it everywhere: the other screens have the same problem.",
        "Which fix should #19 make?",
        ["Fix it everywhere", "Report page only"],
      );
      s.view("q-23");
    },
  },
  { chapter: "decision", wait: 1500, run: (s) => s.point("question") },
  { chapter: "decision", wait: 2600, run: (s) => s.point("bell") },
  // 5. Changes land through the queue; queued quests start as workers free up.
  {
    chapter: "land",
    wait: 3500,
    run: (s) => {
      const b = s.backend;
      for (const worker of [WORKERS[0], WORKERS[2]]) b.setRunning(worker.id, false);
      b.completeBoardRow("q-22");
      b.completeBoardRow("q-24");
      b.leaderSays(
        "[q-22](quest:q-22) and [q-24](quest:q-24) are on main: big OFX files import without freezing, and monthly totals add up to the cent. [#18](session:18) has started on [q-26](quest:q-26) now that the importer change is in, and [#20](session:20) on [q-25](quest:q-25).",
        s.thread,
        { status: { kind: "waiting", summary: "two landed; three quests in Work" } },
      );
      b.setRunning(WORKERS[0].id, true, "q-26");
      b.setBoardRow("q-26", working(WORKERS[0]));
      b.setRunning(WORKERS[2].id, true, "q-25");
      b.setBoardRow("q-25", working(WORKERS[2]));
      s.view(s.thread);
    },
  },
  { chapter: "land", wait: 1500, run: (s) => s.point("status") },
  {
    chapter: "land",
    wait: 4500,
    run: (s) => {
      const b = s.backend;
      for (const worker of WORKERS) b.setRunning(worker.id, false);
      b.setBoardRow("q-23", { status: "MEMORY", journey: AFTER_CHECKPOINT_MEMORY });
      for (const quest of ["q-25", "q-26"]) b.setBoardRow(quest, { status: "MEMORY", journey: MEMORY });
    },
  },
  // 6. Results come back as a short summary, and every quest keeps its record.
  {
    chapter: "results",
    wait: 3500,
    run: (s) => {
      const b = s.backend;
      for (const quest of ["q-23", "q-25", "q-26"]) b.completeBoardRow(quest);
      const faint =
        s.choice === "report"
          ? "Muted text on the report page is readable in the dark theme; the other screens are unchanged, as you chose."
          : "Muted text is readable in the dark theme on all 9 screens.";
      b.leaderSays(
        "All five reports are fixed and on main:\n\n" +
          "- [q-22](quest:q-22) A 40 MB OFX file imports in about 3 seconds, without freezing.\n" +
          `- [q-23](quest:q-23) ${faint}\n` +
          "- [q-24](quest:q-24) Monthly totals add up to the cent.\n" +
          '- [q-25](quest:q-25) Searching "cafe" finds "Café".\n' +
          "- [q-26](quest:q-26) The import test passed 50 runs in a row.\n\n" +
          "Each quest keeps what was asked, what was decided and its commits, so you can always look up why.",
        s.thread,
        { answers: s.requestUserU ? [s.requestUserU] : [], status: { kind: "ready", summary: "all five landed" } },
      );
      b.endTurn(s.thread);
      s.view(s.thread);
    },
  },
  { chapter: "results", wait: 1500, run: (s) => s.point("status") },
  // 7. When you want to read the code, a guided review walks you through it, decisions first.
  {
    chapter: "review",
    wait: 6000,
    run: (s) => {
      const b = s.backend;
      const review = accentReview(b.now(), LEADER, "q-25");
      b.artifacts.set(ACCENT_REVIEW_ARTIFACT_ID, review);
      b.leaderSays(
        "I published a guided review of the accent change, [q-25](quest:q-25). It has one decision for you: " +
          `[Search ignores accents](artifact:${ACCENT_REVIEW_ARTIFACT_ID}).`,
        s.thread,
      );
    },
  },
  { chapter: "review", wait: 3000, run: (s) => s.openArtifact(ACCENT_REVIEW_ARTIFACT_ID) },
  { chapter: "review", wait: 3500, run: (s) => s.press("Start the review") },
  { chapter: "review", wait: 4000, run: (s) => s.press("Start the walkthrough") },
  { chapter: "review", wait: 2000, run: (s) => s.point("review-decision") },
  // On narrow screens the answers sit below the code, so they get their own hint after the question.
  { chapter: "review", wait: 3600, run: (s) => s.point("review-answers") },
  // The page lingers on the decision before the day counts as done.
  { chapter: "review", wait: 4000, run: () => {} },
];

/** What the decision chapter does once the user answers. */
function afterAnswer(s: StoryState, answer: string, answerMessageId: string): void {
  s.choice = /report/i.test(answer) ? "report" : "everywhere";
  const b = s.backend;
  b.setBoardRow("q-23", { status: "WORKING", journey: BACK_TO_WORK });
  b.setRunning(WORKERS[1].id, true, "q-23");
  b.leaderSays(
    s.choice === "report"
      ? "Got it: [#19](session:19) is fixing the report page only. I noted the other screens as a follow-up."
      : "Got it: [#19](session:19) is fixing the gray everywhere and checking all 9 screens in both themes.",
    "q-23",
    { answers: [answerMessageId] },
  );
}

/**
 * The story's controls. `goto` rebuilds the model as it stands at the start of a chapter
 * (playing the earlier ones instantly) and, with `play`, plays on from there.
 */
export interface PocketLedgerStory {
  chapters: readonly PocketLedgerChapter[];
  goto(chapter: number, options?: { play?: boolean }): void;
  pause(): void;
  /** Plays on from where `pause` stopped. */
  resume(): void;
  onEnded(listener: () => void): void;
  onChapter(listener: (chapter: number) => void): void;
  /** Called with the visitor's answer once the question is answered. */
  onAnswered(listener: (choice: DecisionChoice) => void): void;
  /** How long the decision chapter waits before answering on the visitor's behalf; 0 never does. */
  autoAnswerMs: number;
}

export function createPocketLedgerStory(
  backend: DemoBackend,
  ui: StoryUi = { press: () => {}, point: () => {} },
): PocketLedgerStory {
  const chapterListeners = new Set<(chapter: number) => void>();
  const answeredListeners = new Set<(choice: DecisionChoice) => void>();
  const endedListeners = new Set<() => void>();
  let playing = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let autoAnswer: ReturnType<typeof setTimeout> | null = null;
  let state: StoryState;
  let next = 0;
  let waitingForAnswer = false;
  let paused = false;
  let fastForward = false;

  const openArtifact = (id: string) => {
    location.hash = `#/artifact/${id}`;
  };
  // Home is the "main" thread. Naming it keeps the app from reopening the thread it showed last.
  const view = (thread: string) => {
    const hash = `#/session/${LEADER}?thread=${encodeURIComponent(thread)}`;
    if (location.hash !== hash) location.hash = hash;
  };

  const reset = () => {
    const previous = [...backend.sessions.keys()];
    backend.reset();
    seed(backend);
    for (const id of previous) if (!backend.sessions.has(id)) backend.removeSession(id);
    state = {
      backend,
      choice: state?.choice ?? null,
      view,
      openArtifact,
      // Fast-forwarding to a chapter replays steps without touching the screen.
      press: (label) => !fastForward && ui.press(label),
      point: (target) => !fastForward && ui.point(target),
      thread: "main",
    };
  };

  const chapterOf = (step: number) => POCKET_LEDGER_CHAPTERS.indexOf(STEPS[step].chapter);
  const clearTimers = () => {
    if (timer) clearTimeout(timer);
    if (autoAnswer) clearTimeout(autoAnswer);
    timer = autoAnswer = null;
  };

  const runStep = (index: number, instant: boolean) => {
    const step = STEPS[index];
    step.run(state);
    if (step.chapter === "decision" && state.decisionId) {
      if (instant) {
        backend.answer(state.decisionId, state.choice === "report" ? "Report page only" : "Fix it everywhere");
      } else {
        waitingForAnswer = true;
      }
    }
  };

  backend.onAnswer((id, answer, answerMessageId) => {
    if (id !== state?.decisionId) return;
    afterAnswer(state, answer, answerMessageId);
    backend.publish();
    for (const listener of answeredListeners) listener(state.choice!);
    if (waitingForAnswer) {
      waitingForAnswer = false;
      if (autoAnswer) clearTimeout(autoAnswer);
      autoAnswer = null;
      // A step still due in this chapter schedules the rest itself.
      if (!timer && playing && !paused) schedule();
    }
  });

  const schedule = () => {
    if (next >= STEPS.length) {
      playing = false;
      for (const listener of endedListeners) listener();
      return;
    }
    // An open question holds the story at the end of its chapter until it is answered.
    if (waitingForAnswer && STEPS[next].chapter !== "decision") return;
    timer = setTimeout(() => {
      timer = null;
      const index = next++;
      if (index === 0 || chapterOf(index) !== chapterOf(index - 1)) {
        for (const listener of chapterListeners) listener(chapterOf(index));
      }
      runStep(index, false);
      backend.publish();
      if (waitingForAnswer && story.autoAnswerMs > 0 && !autoAnswer) {
        autoAnswer = setTimeout(() => backend.answer(state.decisionId!, "Fix it everywhere"), story.autoAnswerMs);
      }
      schedule();
    }, STEPS[next].wait);
  };

  const story: PocketLedgerStory = {
    chapters: POCKET_LEDGER_CHAPTERS,
    autoAnswerMs: 16_000,
    goto(chapter, options = {}) {
      clearTimers();
      paused = false;
      waitingForAnswer = false;
      reset();
      next = 0;
      fastForward = true;
      while (next < STEPS.length && chapterOf(next) < chapter) runStep(next++, true);
      fastForward = false;
      if (chapter === 0) view("main");
      backend.publish();
      for (const listener of chapterListeners) listener(chapter);
      playing = Boolean(options.play);
      if (playing) schedule();
    },
    pause() {
      if (!timer && !autoAnswer) return;
      clearTimers();
      paused = true;
    },
    resume() {
      if (!paused) return;
      paused = false;
      if (playing) schedule();
      if (waitingForAnswer && story.autoAnswerMs > 0) {
        autoAnswer = setTimeout(() => backend.answer(state.decisionId!, "Fix it everywhere"), story.autoAnswerMs);
      }
    },
    onEnded: (listener) => void endedListeners.add(listener),
    onChapter: (listener) => void chapterListeners.add(listener),
    onAnswered: (listener) => void answeredListeners.add(listener),
  };

  reset();
  return story;
}

/** The project as the day starts: the leader, and yesterday's last exchange in Main. */
function seed(backend: DemoBackend): void {
  const day = 24 * 60 * 60_000;
  const start = backend.now() - 8 * day;
  backend.addSession(
    { id: LEADER, num: 1, name: "Pocket Ledger", backend: "claude-sdk", model: OPUS, portraitId: "tako1-04" },
    start,
  );
  for (const [id, title, tldr] of QUESTS) backend.addQuest({ id, title, tldr, status: "in_progress" });
  // Earlier threads, so Home opens on a project already in use: [age, name, question, answer, news].
  const earlier: Array<[number, string, string, string, string]> = [
    [
      6 * day,
      "Budget alerts",
      "How should budgets warn me when a category goes over?",
      "Done: categories over budget are highlighted in the monthly report, with the amount they're over by.",
      "Over-budget categories are highlighted in the monthly report",
    ],
    [
      2 * day,
      "Yearly summary",
      "Can I see the whole year on one page?",
      "Done: the new yearly page shows each month's spending by category, in each currency.",
      "The yearly page shows each month by category",
    ],
    [
      day,
      "CSV export by month",
      "Can the monthly page export its transactions as CSV?",
      "Done: the monthly page has an **Export CSV** button, one file per currency. It landed with all tests passing.",
      "Export CSV is on the monthly page, one file per currency",
    ],
  ];
  // Yesterday's last quest is wrapping up, so the board isn't empty as the day starts.
  backend.addQuest({
    id: "q-21",
    title: "Recurring transactions",
    tldr: "Rent and subscriptions repeat every month.",
    status: "in_progress",
  });
  backend.setBoardRow("q-21", { status: "MEMORY", journey: MEMORY });
  // Each thread is written with the clock set back to its day, so its times read as days past.
  const clock = backend.now;
  for (const [age, name, question, answer, news] of earlier) {
    backend.now = () => clock() - age;
    const thread = backend.startThread(name, news);
    const asked = backend.userSays(question, thread);
    backend.leaderSays(answer, thread, { answers: [asked], status: { kind: "ready", summary: "landed" } });
    backend.endTurn(thread);
  }
  backend.now = clock;
}
