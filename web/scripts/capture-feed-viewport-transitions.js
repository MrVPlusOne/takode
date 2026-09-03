(() => {
  "use strict";

  const API_NAME = "__TAKODE_FEED_VIEWPORT_PROBE__";
  const MAX_SAMPLES = 200;
  const existing = window[API_NAME];
  if (existing?.stop) existing.stop();

  const state = {
    active: false,
    anchorMessageId: null,
    container: null,
    mutationObserver: null,
    resizeObserver: null,
    resizeTargets: new Set(),
    samples: [],
    lastSignature: null,
    pendingReasons: new Set(),
    raf: null,
    listeners: [],
  };

  const round = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
  const visibleRect = (element) => {
    if (!(element instanceof HTMLElement)) return null;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  };
  const elementHeight = (element) => round(element instanceof HTMLElement ? element.getBoundingClientRect().height : 0);
  const numericData = (element, key) => {
    const value = Number.parseFloat(element?.dataset?.[key] ?? "");
    return Number.isFinite(value) ? value : 0;
  };
  const uniqueMessageIds = (container) => {
    const seen = new Set();
    const ids = [];
    for (const element of container.querySelectorAll("[data-message-id]")) {
      const id = element instanceof HTMLElement ? element.dataset.messageId : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  };
  const stableIdSignature = (ids) => {
    let hash = 2166136261;
    for (const id of ids) {
      for (let index = 0; index < id.length; index += 1) {
        hash ^= id.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      hash ^= 0xff;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };
  const pickAnchor = (container, requestedId) => {
    if (requestedId) {
      return container.querySelector(`[data-message-id="${CSS.escape(requestedId)}"]`);
    }
    const containerRect = container.getBoundingClientRect();
    const candidates = [...container.querySelectorAll("[data-message-id]")].filter((element) => {
      if (!(element instanceof HTMLElement)) return false;
      if (element.dataset.messageRole === "system" && element.dataset.messageVariant === "error") return false;
      const rect = element.getBoundingClientRect();
      return rect.bottom > containerRect.top + 1 && rect.top < containerRect.bottom - 1;
    });
    candidates.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      const leftInside = leftRect.top >= containerRect.top ? 0 : 1;
      const rightInside = rightRect.top >= containerRect.top ? 0 : 1;
      return (
        leftInside - rightInside ||
        Math.abs(leftRect.top - containerRect.top) - Math.abs(rightRect.top - containerRect.top)
      );
    });
    return candidates[0] ?? null;
  };
  const safePerfTail = (sessionId) => {
    const entries = window.__TAKODE_FRONTEND_PERF__?.entries?.() ?? [];
    const keys = [
      "kind",
      "timestamp",
      "sessionId",
      "messageType",
      "phase",
      "fromThreadKey",
      "toThreadKey",
      "historyTurnCount",
      "threadItemCount",
      "messageCount",
      "entryCount",
      "turnCount",
      "durationMs",
      "reactCommitDurationMs",
      "nextPaintDurationMs",
      "totalDurationMs",
    ];
    return entries
      .filter((entry) => !sessionId || entry.sessionId === sessionId || entry.sessionId == null)
      .slice(-5)
      .map((entry) =>
        Object.fromEntries(keys.filter((key) => entry[key] !== undefined).map((key) => [key, entry[key]])),
      );
  };
  const collect = (reasons) => {
    const container = state.container;
    if (!(container instanceof HTMLElement) || !container.isConnected) {
      return { at: Date.now(), reasons, missingContainer: true };
    }
    const containerRect = container.getBoundingClientRect();
    const slack = container.querySelector("[data-feed-end-slack]");
    const slackRect = slack instanceof HTMLElement ? slack.getBoundingClientRect() : null;
    const fallbackContentBottom =
      container.scrollHeight -
      numericData(slack, "feedOverlayRunwayHeight") -
      numericData(slack, "feedThreadStatusCompensation");
    let maximumFeedBlockBottom = 0;
    for (const block of container.querySelectorAll("[data-feed-block-id]")) {
      if (!(block instanceof HTMLElement)) continue;
      const offsetBottom = block.offsetTop + block.offsetHeight;
      const rect = block.getBoundingClientRect();
      const blockBottom = offsetBottom > 0 ? offsetBottom : container.scrollTop + rect.bottom - containerRect.top;
      maximumFeedBlockBottom = Math.max(maximumFeedBlockBottom, blockBottom);
    }
    const contentBottom =
      maximumFeedBlockBottom <= 0 || maximumFeedBlockBottom >= container.scrollHeight - 1
        ? fallbackContentBottom
        : Math.min(fallbackContentBottom, maximumFeedBlockBottom);
    const anchor = state.anchorMessageId
      ? container.querySelector(`[data-message-id="${CSS.escape(state.anchorMessageId)}"]`)
      : null;
    const anchorRect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : null;
    const activity = container.parentElement?.querySelector('[data-feed-activity-row="true"]');
    const reservation = container.parentElement?.querySelector('[data-feed-activity-reservation="true"]');
    const leftStack = container.parentElement?.querySelector('[data-feed-floating-stack="left"]');
    const rightStack = container.parentElement?.querySelector('[data-feed-floating-stack="right"]');
    const threadStatus = container.querySelector('[data-feed-thread-status-footer="true"]');
    const messageIds = uniqueMessageIds(container);
    const sessionId = container.dataset.feedSessionId ?? null;
    const threadKey = container.dataset.feedThreadKey ?? null;
    return {
      at: Date.now(),
      reasons,
      route: `${location.pathname}${location.search}${location.hash}`,
      sessionId,
      threadKey,
      scrollTop: round(container.scrollTop),
      scrollHeight: round(container.scrollHeight),
      clientHeight: round(container.clientHeight),
      physicalBottomGap: round(container.scrollHeight - container.clientHeight - container.scrollTop),
      contentBottom: round(contentBottom),
      realBottomGap: round(contentBottom - container.clientHeight - container.scrollTop),
      trailingSlack: round(slackRect?.height ?? 0),
      overlayRunway: round(numericData(slack, "feedOverlayRunwayHeight")),
      threadStatusVisibleHeight: round(numericData(slack, "feedThreadStatusHeight")),
      threadStatusCompensation: round(numericData(slack, "feedThreadStatusCompensation")),
      leftFloatingStackHeight: elementHeight(leftStack),
      rightFloatingStackHeight: elementHeight(rightStack),
      activityHeight: elementHeight(activity),
      activityReservationHeight: elementHeight(reservation),
      threadStatusFooterHeight: elementHeight(threadStatus),
      threadStatusContribution: round(numericData(threadStatus, "feedThreadStatusContribution")),
      threadStatusHostTurnId:
        threadStatus instanceof HTMLElement
          ? (threadStatus.closest("[data-turn-id]")?.getAttribute("data-turn-id") ?? null)
          : null,
      anchor: {
        messageId: state.anchorMessageId,
        present: Boolean(anchorRect),
        turnId:
          anchor instanceof HTMLElement
            ? (anchor.closest("[data-turn-id]")?.getAttribute("data-turn-id") ?? null)
            : null,
        viewportOffsetTop: anchorRect ? round(anchorRect.top - containerRect.top) : null,
        contentOffsetTop: anchorRect ? round(container.scrollTop + anchorRect.top - containerRect.top) : null,
      },
      mountedWindow: {
        count: messageIds.length,
        firstMessageId: messageIds[0] ?? null,
        lastMessageId: messageIds.at(-1) ?? null,
        signature: stableIdSignature(messageIds),
      },
      perfTail: safePerfTail(sessionId),
    };
  };
  const record = (reasons) => {
    const sample = collect(reasons);
    const signature = JSON.stringify({ ...sample, at: 0, reasons: [] });
    const previous = state.samples.at(-1);
    if (signature === state.lastSignature && previous) {
      previous.lastSeenAt = sample.at;
      previous.repeats = (previous.repeats ?? 1) + 1;
      previous.reasons = [...new Set([...previous.reasons, ...reasons])];
      return previous;
    }
    state.lastSignature = signature;
    state.samples.push({ ...sample, lastSeenAt: sample.at, repeats: 1 });
    if (state.samples.length > MAX_SAMPLES) state.samples.splice(0, state.samples.length - MAX_SAMPLES);
    return sample;
  };
  const schedule = (reason) => {
    if (!state.active) return;
    state.pendingReasons.add(reason);
    if (state.raf != null) return;
    state.raf = requestAnimationFrame(() => {
      state.raf = null;
      const reasons = [...state.pendingReasons];
      state.pendingReasons.clear();
      refreshResizeTargets();
      record(reasons);
    });
  };
  const listen = (target, event, handler) => {
    target.addEventListener(event, handler, { passive: true });
    state.listeners.push(() => target.removeEventListener(event, handler));
  };
  const refreshResizeTargets = () => {
    if (!state.resizeObserver || !(state.container instanceof HTMLElement)) return;
    for (const target of [...state.resizeTargets]) {
      if (target.isConnected) continue;
      state.resizeObserver.unobserve(target);
      state.resizeTargets.delete(target);
    }
    const selectors = [
      '[data-feed-content-root="true"]',
      '[data-feed-end-slack="true"]',
      '[data-feed-floating-stack="left"]',
      '[data-feed-floating-stack="right"]',
      '[data-feed-thread-status-footer="true"]',
      '[data-feed-activity-row="true"]',
      '[data-feed-activity-reservation="true"]',
    ];
    for (const selector of selectors) {
      const root =
        selector.includes("floating-stack") || selector.includes("activity-")
          ? state.container.parentElement
          : state.container;
      for (const target of root?.querySelectorAll(selector) ?? []) {
        if (state.resizeTargets.has(target)) continue;
        state.resizeTargets.add(target);
        state.resizeObserver.observe(target);
      }
    }
  };
  const stop = () => {
    state.active = false;
    if (state.raf != null) cancelAnimationFrame(state.raf);
    state.raf = null;
    state.pendingReasons.clear();
    state.mutationObserver?.disconnect();
    state.resizeObserver?.disconnect();
    state.mutationObserver = null;
    state.resizeObserver = null;
    state.resizeTargets.clear();
    state.listeners.splice(0).forEach((remove) => remove());
    return { active: false, samples: state.samples.length, anchorMessageId: state.anchorMessageId };
  };
  const start = ({ containerSelector, anchorMessageId } = {}) => {
    stop();
    const selector = containerSelector || '[data-testid="message-feed-scroll-container"]';
    const candidates = [...document.querySelectorAll(selector)].filter((element) => visibleRect(element));
    if (candidates.length !== 1) {
      throw new Error(
        `Feed viewport probe expected exactly one visible container for ${selector}; found ${candidates.length}`,
      );
    }
    state.container = candidates[0];
    const anchor = pickAnchor(state.container, anchorMessageId);
    state.anchorMessageId = anchor instanceof HTMLElement ? (anchor.dataset.messageId ?? null) : null;
    state.active = true;
    state.mutationObserver = new MutationObserver(() => schedule("mutation"));
    state.mutationObserver.observe(state.container.parentElement ?? state.container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-feed-thread-status-contribution"],
    });
    state.resizeObserver = new ResizeObserver(() => schedule("resize-observer"));
    state.resizeObserver.observe(state.container);
    refreshResizeTargets();
    listen(state.container, "scroll", () => schedule("scroll"));
    listen(window, "resize", () => schedule("window-resize"));
    listen(window, "hashchange", () => schedule("hashchange"));
    return record(["start"]);
  };
  const clear = () => {
    state.samples.length = 0;
    state.lastSignature = null;
    return state.active ? record(["clear"]) : null;
  };
  const read = () => ({
    active: state.active,
    anchorMessageId: state.anchorMessageId,
    sampleCount: state.samples.length,
    samples: state.samples.map((sample) => ({ ...sample })),
  });
  const sample = (reason = "manual") => record([String(reason)]);

  window[API_NAME] = { start, stop, read, clear, sample };
  return { installed: true, api: `window.${API_NAME}`, maxSamples: MAX_SAMPLES };
})();
