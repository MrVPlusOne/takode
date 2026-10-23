/**
 * Renders visual blocks in a headless Chrome on the server, outside every browser
 * that shows them. Two callers:
 *
 * - `takode visual preview`, which shows the agent its visual at phone and desktop
 *   width in both themes and reports problems before it publishes;
 * - browsers that can't isolate a visual's scripts from the page (iPhone Safari, and
 *   any browser that keeps sandboxed frames in its own process), which ask for a
 *   snapshot: the visual after its scripts and helpers ran, with every script removed.
 *
 * A visual that never settles (an endless loop, a crash, a runaway page) costs only
 * this Chrome's page: it is closed after the time budget, and the browser restarted
 * if it no longer answers.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, access } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { buildVisualDocument, parseVisualBlock, visualSourceHash, type VisualTheme } from "../shared/visual-block.js";

export interface VisualRenderRequest {
  source: string;
  width: number;
  theme: VisualTheme;
  /** Capture a PNG at device scale 2. */
  screenshot?: boolean;
  /** Return the script-free snapshot. */
  snapshot?: boolean;
}

export type VisualRenderStatus = "ok" | "timeout" | "crashed" | "unavailable";

export interface VisualRenderResult {
  status: VisualRenderStatus;
  width: number;
  theme: VisualTheme;
  height: number;
  /** Time from loading the document to the visual reporting it settled. */
  settleMs: number;
  elementCount: number;
  /** Widest content in CSS px; above `width` means the visual scrolls sideways. */
  contentWidth: number;
  /** Smallest font size of visible text after scaling, in CSS px. */
  smallestTextPx: number | null;
  errors: string[];
  snapshotHtml?: string;
  screenshotPng?: string;
  detail?: string;
}

export interface VisualRendererOptions {
  /** Origin headless Chrome loads helper libraries from, normally this server. */
  assetBase: string;
  chromePath?: string;
  /** Wall-clock budget for one visual to settle. */
  settleBudgetMs?: number;
  /** Most extra memory Chrome may take while rendering one visual, in MB; above it the render counts as crashed. */
  memoryLimitMb?: number;
}

const DEFAULT_SETTLE_BUDGET_MS = 6000;
const IDLE_SHUTDOWN_MS = 90_000;
const DEFAULT_MEMORY_LIMIT_MB = 1024;
const MEMORY_POLL_MS = 150;
const CACHE_LIMIT = 300;

export class VisualRenderer {
  private browser: Promise<ChromeConnection> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly cache = new Map<string, VisualRenderResult>();

  constructor(private readonly options: VisualRendererOptions) {}

  /** Render one visual. Calls run one at a time; a snapshot result is cached by source, width and theme. */
  render(request: VisualRenderRequest): Promise<VisualRenderResult> {
    const key = request.snapshot && !request.screenshot ? cacheKey(request) : null;
    const cached = key ? this.cache.get(key) : undefined;
    if (cached) return Promise.resolve(cached);
    // A render must never hold the queue: past its budget it counts as a timeout and Chrome starts over.
    const limit = (this.options.settleBudgetMs ?? DEFAULT_SETTLE_BUDGET_MS) + 8000;
    const run = this.queue.then(async () => {
      const result = await withTimeout(this.renderNow(request), limit);
      if (result !== TIMED_OUT) return result;
      await this.restart();
      return {
        status: "timeout" as const,
        width: request.width,
        theme: request.theme,
        height: 0,
        settleMs: limit,
        elementCount: 0,
        contentWidth: 0,
        smallestTextPx: null,
        errors: [],
        detail: "Rendering did not finish.",
      };
    });
    this.queue = run.catch(() => undefined);
    return run.then((result) => {
      if (key && result.status !== "unavailable") {
        this.cache.set(key, result);
        if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
      }
      return result;
    });
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    if (browser) (await browser.catch(() => null))?.close();
  }

  private async renderNow(request: VisualRenderRequest): Promise<VisualRenderResult> {
    const base: VisualRenderResult = {
      status: "unavailable",
      width: request.width,
      theme: request.theme,
      height: 0,
      settleMs: 0,
      elementCount: 0,
      contentWidth: 0,
      smallestTextPx: null,
      errors: [],
    };
    let browser: ChromeConnection;
    try {
      browser = await this.connection();
    } catch (error) {
      return { ...base, detail: `No headless Chrome: ${(error as Error).message}` };
    }
    this.touch();
    const budget = this.options.settleBudgetMs ?? DEFAULT_SETTLE_BUDGET_MS;
    const page = await browser.openPage().catch(() => null);
    if (!page) {
      await this.restart();
      return { ...base, detail: "Headless Chrome did not open a page." };
    }
    // A visual can allocate gigabytes in a second (typed arrays live outside V8's heap limit),
    // so the whole Chrome process tree is measured while it renders and killed above the limit.
    const limitMb = this.options.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB;
    let overLimit = false;
    const watch = watchProcessTreeMemory(browser.pid, limitMb * 1024 * 1024, () => {
      overLimit = true;
      page.crashed = true;
      void this.restart();
    });
    try {
      return await renderInPage(page, request, this.options.assetBase, budget, base);
    } catch (error) {
      if (overLimit) return { ...base, status: "crashed", detail: `It used more than ${limitMb} MB of memory.` };
      throw error;
    } finally {
      watch.stop();
      if (overLimit) {
        // Already being restarted.
      } else {
        const closed = await withTimeout(page.close(), 2000).catch(() => false);
        // A page stuck in a script can keep Chrome from answering; start over next time.
        if (closed === false || page.hung) await this.restart();
      }
    }
  }

  private connection(): Promise<ChromeConnection> {
    if (!this.browser) {
      this.browser = launchChrome(this.options.chromePath);
      this.browser.catch(() => {
        this.browser = null;
      });
    }
    return this.browser;
  }

  private async restart(): Promise<void> {
    await this.close();
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.close(), IDLE_SHUTDOWN_MS);
    this.idleTimer.unref?.();
  }
}

async function renderInPage(
  page: ChromePage,
  request: VisualRenderRequest,
  assetBase: string,
  budget: number,
  base: VisualRenderResult,
): Promise<VisualRenderResult> {
  const block = parseVisualBlock(request.source);
  const html = buildVisualDocument({
    html: block.html,
    theme: request.theme,
    mode: "live",
    assetBase,
    frameId: "render",
  });
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: request.width,
    height: 900,
    deviceScaleFactor: request.screenshot ? 2 : 1,
    mobile: false,
  });
  // Screenshots show the visual on the feed's background, as it will look.
  const background = request.theme === "dark" ? { r: 30, g: 30, b: 30, a: 1 } : { r: 245, g: 245, b: 240, a: 1 };
  await page.send("Emulation.setDefaultBackgroundColorOverride", { color: background });
  await page.send("Page.enable");
  const tree = (await page.send("Page.getFrameTree")) as { frameTree: { frame: { id: string } } };
  const started = Date.now();
  // Writing the document runs its inline scripts, so a script that never returns holds this call.
  const written = await withTimeout(
    page.send("Page.setDocumentContent", { frameId: tree.frameTree.frame.id, html }),
    budget,
  );
  if (written === TIMED_OUT) {
    page.hung = true;
    return { ...base, status: "timeout", settleMs: Date.now() - started, detail: "A script kept the page busy." };
  }

  let settled = false;
  while (Date.now() - started < budget) {
    if (page.crashed) return { ...base, status: "crashed", detail: "The page crashed (often memory)." };
    const ready = await withTimeout(page.evaluate("window.__tkVisual && window.__tkVisual.ready === true"), 1500);
    if (ready === TIMED_OUT) {
      page.hung = true;
      return { ...base, status: "timeout", settleMs: Date.now() - started, detail: "A script kept the page busy." };
    }
    if (ready === true) {
      settled = true;
      break;
    }
    await sleep(60);
  }
  if (!settled) {
    if (page.crashed) return { ...base, status: "crashed", detail: "The page crashed (often memory)." };
    return { ...base, status: "timeout", settleMs: Date.now() - started, detail: "The visual did not settle in time." };
  }
  const settleMs = Date.now() - started;
  const metrics = (await withTimeout(page.evaluate(MEASURE_SCRIPT), 3000)) as
    | Omit<VisualRenderResult, "status" | "width" | "theme" | "settleMs">
    | typeof TIMED_OUT;
  if (metrics === TIMED_OUT || !metrics) {
    page.hung = true;
    return { ...base, status: "timeout", settleMs, detail: "The page stopped answering after it settled." };
  }
  const result: VisualRenderResult = { ...base, ...metrics, status: "ok", settleMs };
  if (request.screenshot) {
    const shot = (await page.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: request.width, height: Math.max(1, result.height), scale: 1 },
    })) as { data: string };
    result.screenshotPng = shot.data;
  }
  if (request.snapshot) {
    const snapshot = await withTimeout(page.evaluate(SNAPSHOT_SCRIPT), 3000);
    if (typeof snapshot === "string") result.snapshotHtml = snapshot;
  }
  return result;
}

/** Measured inside the rendered page. */
const MEASURE_SCRIPT = `(() => {
  const body = document.body;
  let smallest = null;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let checked = 0;
  while (walker.nextNode() && checked < 4000) {
    const node = walker.currentNode;
    if (!node.textContent.trim() || !node.parentElement) continue;
    checked++;
    const element = node.parentElement;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    let size = parseFloat(getComputedStyle(element).fontSize) || 0;
    // Text inside a scaled SVG renders at its size times the SVG's scale.
    const svg = element.closest("svg");
    if (svg && svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width) {
      size *= svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    }
    if (size && (smallest === null || size < smallest)) smallest = size;
  }
  let contentWidth = document.documentElement.scrollWidth;
  for (const el of body.querySelectorAll("*")) {
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") {
      contentWidth = Math.max(contentWidth, el.scrollWidth + el.getBoundingClientRect().left);
    }
  }
  return {
    height: Math.ceil(body.scrollHeight),
    elementCount: body.getElementsByTagName("*").length,
    contentWidth: Math.ceil(contentWidth),
    smallestTextPx: smallest === null ? null : Math.round(smallest * 10) / 10,
    errors: (window.__tkVisual.errors || []).slice(0, 8),
  };
})()`;

/** The settled visual without scripts: canvases become images, handlers and script tags go. */
const SNAPSHOT_SCRIPT = `(() => {
  const clone = document.body.cloneNode(true);
  const canvases = document.body.querySelectorAll("canvas");
  clone.querySelectorAll("canvas").forEach((canvas, index) => {
    const source = canvases[index];
    const img = document.createElement("img");
    try { img.src = source.toDataURL("image/png"); } catch (error) {}
    img.width = source.clientWidth; img.height = source.clientHeight;
    img.style.cssText = source.style.cssText;
    canvas.replaceWith(img);
  });
  clone.querySelectorAll("script, iframe, object, embed").forEach((node) => node.remove());
  clone.querySelectorAll("*").forEach((node) => {
    for (const name of node.getAttributeNames()) {
      if (/^on/i.test(name)) node.removeAttribute(name);
    }
  });
  const styles = [...document.querySelectorAll("head style:not(#tk-kit)")].map((s) => s.outerHTML).join("");
  return styles + clone.innerHTML;
})()`;

const TIMED_OUT = Symbol("timed-out");

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheKey(request: VisualRenderRequest): string {
  return `${request.width}:${request.theme}:${visualSourceHash(request.source)}:${request.source.length}`;
}

/**
 * Poll the resident memory of a process and all its descendants; call `onExceeded` once
 * when the total has grown by more than `limitBytes` since the first poll. Growth, because
 * Chrome's processes share pages that every process's RSS counts again (an idle headless
 * Chrome adds up to over 1 GB). Uses `ps`, which Linux and macOS both have.
 */
function watchProcessTreeMemory(rootPid: number, limitBytes: number, onExceeded: () => void): { stop(): void } {
  let stopped = false;
  let baseline: number | null = null;
  const poll = () => {
    if (stopped || !rootPid) return;
    execFile("ps", ["-A", "-o", "pid=,ppid=,rss="], { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (stopped) return;
      if (!error) {
        const children = new Map<number, number[]>();
        const rss = new Map<number, number>();
        for (const line of stdout.split("\n")) {
          const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
          if (!pid || ppid === undefined || kb === undefined) continue;
          rss.set(pid, kb * 1024);
          children.set(ppid, [...(children.get(ppid) ?? []), pid]);
        }
        let total = 0;
        const pending = [rootPid];
        while (pending.length) {
          const pid = pending.pop()!;
          total += rss.get(pid) ?? 0;
          pending.push(...(children.get(pid) ?? []));
        }
        baseline ??= total;
        if (total - baseline > limitBytes) {
          stopped = true;
          onExceeded();
          return;
        }
      }
      setTimeout(poll, MEMORY_POLL_MS);
    });
  };
  poll();
  return {
    stop() {
      stopped = true;
    },
  };
}

// ---- Minimal Chrome DevTools Protocol client --------------------------------

interface ChromePage {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
  close(): Promise<boolean>;
  crashed: boolean;
  hung: boolean;
}

interface ChromeConnection {
  openPage(): Promise<ChromePage>;
  close(): void;
  /** The browser process; its renderers are its descendants. */
  pid: number;
}

/**
 * Find a Chrome: TAKODE_VISUAL_CHROME, else agent-browser's download (in HOME or the
 * account's home from /etc/passwd), else Chrome or Chromium on PATH or in the usual macOS place.
 */
export async function findChrome(explicit?: string): Promise<string> {
  const candidates = [explicit, process.env.TAKODE_VISUAL_CHROME].filter((path): path is string => !!path);
  for (const home of new Set([homedir(), await accountHome()])) {
    if (!home) continue;
    const dir = join(home, ".agent-browser", "browsers");
    const downloads = await readdir(dir).catch(() => [] as string[]);
    for (const name of downloads
      .filter((entry) => entry.startsWith("chrome-"))
      .sort()
      .reverse()) {
      candidates.push(join(dir, name, "chrome"));
      candidates.push(
        join(dir, name, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      );
    }
  }
  for (const dir of (process.env.PATH ?? "").split(":")) {
    for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
      candidates.push(join(dir, name));
    }
  }
  candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  for (const candidate of candidates) {
    if (
      await access(candidate).then(
        () => true,
        () => false,
      )
    )
      return candidate;
  }
  throw new Error("set TAKODE_VISUAL_CHROME to a Chrome or Chromium binary");
}

/**
 * The account's home from /etc/passwd. Validation servers and tests run with a temporary
 * HOME, but agent-browser's Chrome lives in the real one.
 */
async function accountHome(): Promise<string | null> {
  const uid = process.getuid?.();
  if (uid === undefined) return null;
  const passwd = await readFile("/etc/passwd", "utf8").catch(() => "");
  for (const line of passwd.split("\n")) {
    const fields = line.split(":");
    if (fields[2] === String(uid) && fields[5]) return fields[5];
  }
  return null;
}

async function launchChrome(explicit?: string): Promise<ChromeConnection> {
  const chromePath = await findChrome(explicit);
  const profile = await mkdtemp(join(tmpdir(), "takode-visual-chrome-"));
  const child: ChildProcess = spawn(
    chromePath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--mute-audio",
      // A visual that hogs memory crashes its own page instead of growing without bound.
      "--js-flags=--max-old-space-size=512",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  // Chrome must not outlive the server, however the server stops.
  const killOnExit = () => {
    if (child.exitCode === null) child.kill("SIGKILL");
  };
  process.once("exit", killOnExit);
  const cleanup = () => {
    process.off("exit", killOnExit);
    killOnExit();
    void rm(profile, { recursive: true, force: true }).catch(() => undefined);
  };
  let port = "";
  for (let attempt = 0; attempt < 100 && !port; attempt++) {
    await sleep(100);
    if (child.exitCode !== null) break;
    const file = await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => "");
    port = file.split("\n")[0] ?? "";
  }
  if (!port) {
    cleanup();
    throw new Error("Chrome did not start");
  }
  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
    webSocketDebuggerUrl: string;
  };
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("Chrome DevTools connection failed"));
  });
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const pages = new Map<string, ChromePage>();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      result?: unknown;
      error?: { message: string };
      method?: string;
      sessionId?: string;
    };
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter?.reject(new Error(message.error.message));
      else waiter?.resolve(message.result);
      return;
    }
    if (message.method === "Inspector.targetCrashed" && message.sessionId) {
      const page = pages.get(message.sessionId);
      if (page) page.crashed = true;
    }
  };
  socket.onclose = () => {
    for (const waiter of pending.values()) waiter.reject(new Error("Chrome closed"));
    pending.clear();
  };
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  return {
    async openPage() {
      const { targetId } = (await send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
      const { sessionId } = (await send("Target.attachToTarget", { targetId, flatten: true })) as {
        sessionId: string;
      };
      const page: ChromePage = {
        crashed: false,
        hung: false,
        send: (method, params) => send(method, params, sessionId),
        async evaluate(expression) {
          const response = (await send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)) as {
            result?: { value?: unknown };
          };
          return response.result?.value;
        },
        async close() {
          pages.delete(sessionId);
          await send("Target.closeTarget", { targetId });
          return true;
        },
      };
      pages.set(sessionId, page);
      await send("Inspector.enable", {}, sessionId);
      return page;
    },
    close() {
      socket.close();
      cleanup();
    },
    pid: child.pid ?? 0,
  };
}
