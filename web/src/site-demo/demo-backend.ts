/**
 * A stand-in Takode server for the landing page's demo. It keeps a small model of a
 * project (sessions, their message histories, the leader's work board and questions)
 * and answers the real browser client the way the real server does: over the same
 * WebSocket protocol and REST routes, with thread windows built by the server's own
 * shared builder. The real app then renders it exactly as it renders a live server.
 */
import type {
  BoardRow,
  BrowserIncomingMessage,
  BrowserSessionState,
  TakodeNotificationPayload,
  ThreadRef,
} from "../../server/session-types.js";
import type { SessionNotification } from "../../server/session-attention-types.js";
import type { SessionActivityPreview, SessionActivityPreviewLine } from "../../server/session-activity-preview.js";
import type { ArtifactDetail, ArtifactVersionContent } from "../../shared/artifact-library.js";
import type { DiffFile } from "../../shared/guided-review.js";
import type { SdkSessionInfo } from "../../server/session-info.js";
import { buildLeaderActivePhaseSummary } from "../../shared/leader-active-phase-summary.js";
import { collectLeaderThreadSummaries } from "../../shared/leader-projection.js";
import { LEADER_PROFILE_PORTRAITS } from "../../shared/leader-profile-portraits.js";
import {
  LEADER_THREAD_TABS_PROJECTION,
  type LeaderThreadTabsProjectionTab,
  type LeaderThreadTabsProjectionValue,
} from "../../shared/leader-thread-tabs-projection.js";
import type { QuestJourneyPlanState } from "../../shared/quest-journey.js";
import { threadStatusMessageIdHash, type LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import {
  SESSION_ATTENTION_PROJECTION,
  type SessionAttentionProjectionValue,
} from "../../shared/session-attention-projection.js";
import {
  SESSION_NAVIGATION_PROJECTION,
  type SessionNavigationProjectionValue,
} from "../../shared/session-navigation-projection.js";
import { THREAD_MONITORING_PROJECTION } from "../../shared/thread-monitoring.js";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import { DEMO_SETTINGS } from "./demo-settings.js";

export type DemoBackendType = "claude-sdk" | "codex";

export interface DemoSessionSpec {
  id: string;
  num: number;
  name: string;
  backend: DemoBackendType;
  model: string;
  /** The leader this worker reports to; leaders have none. */
  leaderId?: string;
  portraitId?: string;
}

interface DemoSession extends DemoSessionSpec {
  status: "idle" | "running";
  /** What the session did last, newest last, as its activity preview lists it. */
  activity: SessionActivityPreviewLine[];
  createdAt: number;
  lastActivityAt: number;
  history: BrowserIncomingMessage[];
  generationStartedAt: number | null;
  activeThread: string | null;
}

export interface DemoQuest {
  id: string;
  title: string;
  tldr: string;
  status: "in_progress" | "done";
  /** The thread whose request filed it, which its answers go back to. */
  askedIn?: string;
}

/** A thread the user started with the leader (a `t-N` thread). */
export interface DemoThread {
  id: string;
  key: string;
  number: number;
  name: string;
  createdAt: number;
  /** The line of news the leader's Home shows for it. */
  news?: string;
}

/** What the browser asked to watch on one socket. */
interface DemoSocketView {
  sessionId: string;
  threads: Set<string>;
  windowSize: { section: number; visible: number };
}

const GENERATION = "pocket-ledger-demo";
const CWD = "~/code/pocket-ledger";

/** The stand-in server. One instance serves one demo page. */
export class DemoBackend {
  readonly sessions = new Map<string, DemoSession>();
  readonly quests = new Map<string, DemoQuest>();
  board: BoardRow[] = [];
  completedBoard: BoardRow[] = [];
  notifications: SessionNotification[] = [];
  threads: DemoThread[] = [];
  threadStatuses: Record<string, LeaderThreadStatus> = {};
  /** Library artifacts (the demo's guided review), with each review's diff by file. */
  artifacts = new Map<string, { detail: ArtifactDetail; content: ArtifactVersionContent; files: DiffFile[] }>();
  private sockets = new Set<DemoSocket>();
  private revision = 1;
  private leaderMessageCount = 0;
  private draftRevision = 0;
  private notificationCount = 0;
  private answerListeners = new Set<(notificationId: string, answer: string, userMessageId: string) => void>();
  /** The demo's clock: real time, so feed times read "just now" and timers count. */
  now = () => Date.now();

  constructor(readonly leaderId: string) {}

  // ---- Model: what the story changes ----

  addSession(spec: DemoSessionSpec, createdAt = this.now()): void {
    this.sessions.set(spec.id, {
      ...spec,
      status: "idle",
      createdAt,
      lastActivityAt: createdAt,
      history: [],
      activity: [],
      generationStartedAt: null,
      activeThread: null,
    });
  }

  /** A worker's latest step, shown where its quest's tab previews what it is doing. */
  workerDoes(sessionId: string, toolName: string, text: string): void {
    const session = this.session(sessionId);
    const line: SessionActivityPreviewLine = {
      historyIndex: session.activity.length,
      kind: "tool",
      toolName,
      text,
      timestamp: this.now(),
    };
    session.activity = [...session.activity, line].slice(-4);
    session.lastActivityAt = this.now();
  }

  /** Empties the model, keeping the browsers connected. */
  reset(): void {
    this.sessions.clear();
    this.quests.clear();
    this.board = [];
    this.completedBoard = [];
    this.notifications = [];
    this.threads = [];
    this.threadStatuses = {};
    this.artifacts.clear();
    this.leaderMessageCount = 0;
    this.notificationCount = 0;
    this.draftRevision += 1;
  }

  /** Takes a session out of the browser's session list, as deleting it on the server does. */
  removeSession(id: string): void {
    this.sessions.delete(id);
    for (const socket of this.sockets)
      socket.deliver({ type: "session_deleted", session_id: id } as BrowserIncomingMessage);
  }

  addQuest(quest: DemoQuest): void {
    this.quests.set(quest.id, quest);
  }

  /** A message from the user to the leader, in `thread`. Returns its id for the answer that covers it. */
  userSays(
    content: string,
    thread = "main",
    extra: Partial<Extract<BrowserIncomingMessage, { type: "user_message" }>> = {},
  ) {
    const leader = this.leader();
    const leaderUserMessageId = `u${++this.leaderMessageCount}`;
    const at = this.now();
    leader.history.push({
      type: "user_message",
      content,
      timestamp: at,
      id: `user-${at}-${leader.history.length}`,
      ...routing(thread),
      leaderResponseCoverageVersion: 1,
      leaderUserMessageId,
      ...extra,
    } as BrowserIncomingMessage);
    leader.lastActivityAt = at;
    return leaderUserMessageId;
  }

  /**
   * Leader text in `thread`: an answer to the user's messages `answers` when given, else
   * commentary. `notification` anchors a question card to it.
   */
  leaderSays(
    text: string,
    thread = "main",
    options: {
      answers?: string[];
      id?: string;
      notification?: TakodeNotificationPayload;
      /** The thread's status line after this message, as a leader's status marker sets it. */
      status?: { kind: "waiting" | "ready"; summary: string; thread?: string };
    } = {},
  ): string {
    const leader = this.leader();
    const at = this.now();
    const id = options.id ?? `msg-demo-${leader.history.length}`;
    const marker = options.status ? this.statusMarker(options.status.thread ?? thread, options.status, id, at) : null;
    leader.history.push({
      type: "assistant",
      message: {
        id,
        type: "message",
        role: "assistant",
        model: leader.model,
        content: [{ type: "text", text }],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: at,
      uuid: `${id}-uuid`,
      ...routing(thread),
      leaderThreadRole: options.answers ? "answer" : "commentary",
      ...(options.answers
        ? {
            threadAnswer: {
              version: 2,
              answerUserMessageIds: options.answers,
              observedHistoryLength: leader.history.length,
              authoredThreadKey: thread,
            },
          }
        : {}),
      ...(options.notification ? { notification: options.notification } : {}),
      ...(marker ? { threadStatusMarkers: [marker] } : {}),
    } as BrowserIncomingMessage);
    if (marker) this.threadStatuses[marker.threadKey] = marker;
    leader.lastActivityAt = at;
    return id;
  }

  /**
   * Text in the leader's Home message box, as another of the user's browsers typing it would
   * appear (drafts are shared between browsers); null clears it.
   */
  typeInHome(text: string | null): void {
    const change = {
      kind: "side-composer" as const,
      place: "home",
      draft: text === null ? null : { text },
      revision: ++this.draftRevision,
      clientId: "demo-typist",
      updatedAt: this.now(),
    };
    for (const socket of this.sockets) {
      if (socket.view.sessionId === this.leaderId) socket.deliver({ type: "session_draft_update", change });
    }
  }

  /** Starts a `t-N` thread for a request made from the leader's Home. */
  startThread(name: string, news?: string): string {
    const number = this.threads.length + 1;
    // Thread keys name the thread's id by its first 8 hex digits, as the server's do.
    const id = `${(0x7a1e0000 + number).toString(16)}-0000-4000-8000-${String(number).padStart(12, "0")}`;
    const key = `topic:${id.slice(0, 8)}`;
    this.threads = [...this.threads, { id, key, number, name, createdAt: this.now(), ...(news ? { news } : {}) }];
    return key;
  }

  private statusMarker(
    thread: string,
    status: { kind: "waiting" | "ready"; summary: string },
    messageId: string,
    at: number,
  ): LeaderThreadStatus {
    return {
      kind: status.kind,
      label: status.kind === "ready" ? "Thread Ready" : "Thread Waiting",
      ...routeTarget(thread),
      summary: status.summary,
      messageId,
      messageIdHash: threadStatusMessageIdHash(messageId),
      timestamp: at,
      updatedAt: at,
    };
  }

  /** Closes the leader's turn, as a finished backend turn does. */
  endTurn(thread = "main"): void {
    const leader = this.leader();
    leader.history.push({
      type: "result",
      data: {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1000,
        duration_api_ms: 1000,
        num_turns: 1,
        result: "",
        stop_reason: "end_turn",
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        uuid: `result-${leader.history.length}`,
        session_id: leader.id,
      },
      ...routing(thread),
    } as BrowserIncomingMessage);
    this.setRunning(leader.id, false);
  }

  /**
   * Asks the user a question in `thread`, the way `takode notify needs-input` does: the
   * explanation becomes a leader message carrying the card.
   */
  ask(thread: string, summary: string, context: string, prompt: string, answers: string[]): string {
    const id = `n-${++this.notificationCount}`;
    const contextMessageId = `needs-input-context-${id}`;
    const at = this.now();
    const route = routing(thread);
    const notification: SessionNotification = {
      id,
      category: "needs-input",
      summary,
      questionOnly: true,
      contextMessageId,
      questions: [{ prompt, suggestedAnswers: answers }],
      timestamp: at,
      messageId: contextMessageId,
      done: false,
      ...route,
    };
    this.leaderSays(context, thread, {
      id: contextMessageId,
      notification: {
        id,
        category: "needs-input",
        summary,
        questionOnly: true,
        questions: notification.questions,
        timestamp: at,
        ...route,
      },
    });
    this.notifications = [...this.notifications, notification];
    return id;
  }

  onAnswer(listener: (notificationId: string, answer: string, userMessageId: string) => void): () => void {
    this.answerListeners.add(listener);
    return () => this.answerListeners.delete(listener);
  }

  /** The user's reply to a question card, as the server records it. */
  answer(notificationId: string, content: string): void {
    const notification = this.notifications.find((n) => n.id === notificationId);
    if (!notification || notification.done) return;
    const prompt = notification.questions?.[0]?.prompt ?? notification.summary ?? "";
    const thread = notification.threadKey ?? "main";
    const userMessageId = this.userSays(`${prompt}\n\nAnswer: ${content}`, thread, {
      replyContext: {
        messageId: notification.messageId ?? undefined,
        notificationId,
        previewText: notification.summary,
      },
    } as Partial<Extract<BrowserIncomingMessage, { type: "user_message" }>>);
    this.notifications = this.notifications.map((n) =>
      n.id === notificationId ? { ...n, done: true, doneAt: this.now() } : n,
    );
    this.publish();
    for (const listener of this.answerListeners) listener(notificationId, content, userMessageId);
  }

  setRunning(sessionId: string, running: boolean, thread: string | null = null): void {
    const session = this.session(sessionId);
    session.status = running ? "running" : "idle";
    session.generationStartedAt = running ? this.now() : null;
    session.activeThread = running ? thread : null;
    session.lastActivityAt = this.now();
  }

  /** Puts a quest on the leader's board, or updates its row. */
  setBoardRow(questId: string, row: Partial<BoardRow> & { journey?: QuestJourneyPlanState }): void {
    const existing = this.board.find((r) => r.questId === questId);
    const quest = this.quests.get(questId);
    const next: BoardRow = {
      questId,
      title: quest?.title,
      questTldr: quest?.tldr,
      createdAt: existing?.createdAt ?? this.now(),
      ...existing,
      ...row,
      updatedAt: this.now(),
    };
    this.board = existing ? this.board.map((r) => (r.questId === questId ? next : r)) : [...this.board, next];
  }

  /** Moves a quest from the board to the completed board. */
  completeBoardRow(questId: string): void {
    const row = this.board.find((r) => r.questId === questId);
    if (!row) return;
    const at = this.now();
    this.board = this.board.filter((r) => r.questId !== questId);
    this.completedBoard = [{ ...row, status: "DONE", completedAt: at, updatedAt: at }, ...this.completedBoard];
    const quest = this.quests.get(questId);
    if (quest) quest.status = "done";
  }

  // ---- Protocol: what the browser receives ----

  /** Sends every watching browser the current state. */
  publish(): void {
    this.revision += 1;
    for (const socket of this.sockets) {
      // The browser refetches its thread list when told the leader's threads changed.
      if (socket.view.sessionId === this.leaderId)
        socket.deliver({ type: "leader_threads_changed", leaderId: this.leaderId });
      this.sendState(socket, false);
    }
  }

  connect(socket: DemoSocket): void {
    this.sockets.add(socket);
    socket.deliver({ type: "connected" } as unknown as BrowserIncomingMessage);
  }

  disconnect(socket: DemoSocket): void {
    this.sockets.delete(socket);
  }

  /** A message from the browser. */
  receive(socket: DemoSocket, raw: string): void {
    const message = JSON.parse(raw) as { type: string } & Record<string, unknown>;
    const view = socket.view;
    switch (message.type) {
      case "session_subscribe": {
        const initial = message.initial_thread_window as
          | { thread_key: string; section_item_count: number; visible_item_count: number }
          | undefined;
        view.windowSize = {
          section: Number(message.history_window_section_turn_count) || 10,
          visible: Number(message.history_window_visible_section_count) || 3,
        };
        if (initial) view.threads.add(initial.thread_key);
        this.sendState(socket, true);
        const subscriptions = message.synced_projection_subscriptions as SubscriptionRequest[] | undefined;
        if (subscriptions) this.sendProjections(socket, subscriptions);
        break;
      }
      case "synced_projection_subscribe":
        this.sendProjections(socket, (message.subscriptions as SubscriptionRequest[]) ?? []);
        break;
      case "thread_window_request":
      case "conversation_view_update": {
        const thread = String(message.thread_key ?? "main");
        view.threads.add(thread);
        if (message.type === "thread_window_request") socket.deliver(this.threadWindow(view.sessionId, thread, view));
        break;
      }
      case "user_message": {
        // The visitor wrote to the leader. The demo shows the message and says what it is.
        const asked = String(message.threadKey ?? "");
        const thread = /^(main|q-\d+|topic:)/.test(asked) ? asked : this.startThread("Your message");
        const id = this.userSays(String(message.content ?? ""), thread, {
          ...(message.client_msg_id ? { client_msg_id: String(message.client_msg_id) } : {}),
        } as Partial<Extract<BrowserIncomingMessage, { type: "user_message" }>>);
        this.leaderSays(
          "This is a demo, so nothing happens with that here. In Takode, your leader would take it from this point.",
          thread,
          { answers: [id] },
        );
        this.publish();
        break;
      }
      default:
        // Reads, acks, pings, load reports and tab moves change nothing the demo shows.
        break;
    }
  }

  /** REST: the routes the app calls, answered from the model. */
  async fetch(path: string, init?: RequestInit): Promise<Response> {
    const url = new URL(path, "http://demo");
    const route = url.pathname.replace(/^\/api/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const response = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

    const answered = route.match(/^\/sessions\/[^/]+\/notifications\/([^/]+)\/response$/);
    if (answered && method === "POST") {
      const { content } = JSON.parse(String(init?.body ?? "{}")) as { content?: string };
      // Deferred so the card's own request settles before the feed changes under it.
      setTimeout(() => this.answer(decodeURIComponent(answered[1]), String(content ?? "")), 0);
      return response({ ok: true, sessionId: this.leaderId, notificationId: answered[1], delivery: "sent" });
    }
    const routes: Record<string, () => unknown> = {
      "/sessions": () => this.sessionList(),
      "/settings": () => {
        // Times read in the visitor's own zone, as they would on their own server.
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        return { ...DEMO_SETTINGS, serverTimeZoneInEffect: zone, serverTimeZoneDefault: zone };
      },
      "/auth/status": () => ({ enabled: false, loggedIn: false, minPasswordLength: 8 }),
      "/health": () => ({ ok: true, timestamp: this.now(), buildId: "site-demo", servedFrontendBuildId: "site-demo" }),
      "/tree-groups": () => this.treeGroups(),
      "/quests/_titles": () => ({
        quests: [...this.quests.values()].map((q) => this.questTitle(q)),
        missingQuestIds: [],
      }),
      "/quests/_summary": () => {
        const all = this.quests.size;
        const done = [...this.quests.values()].filter((q) => q.status === "done").length;
        return { total: all, active: all - done, counts: { all, idea: 0, refined: 0, in_progress: all - done, done } };
      },
      "/sessions/archived/summary": () => ({ total: 0 }),
      "/hosts": () => ({
        hosts: [],
        build: "",
        local: { id: "local", name: "laptop", settings: {}, platform: "linux" },
      }),
      "/artifacts": () => {
        const artifacts = [...this.artifacts.values()].map(
          ({ detail: { versions: _versions, ...summary } }) => summary,
        );
        return { artifacts, total: artifacts.length, kinds: {}, spaces: ["Pocket Ledger"], space: null };
      },
      "/topics": () => ({ topics: [], changes: [], leaders: [], spaces: [], suggestions: [], scribe: null }),
      "/topics/threads": () => ({ threads: this.threadList() }),
      "/topics/home-lines": () => ({
        lines: Object.fromEntries(
          this.threads.flatMap((t) => (t.news ? [[t.key, { text: t.news, at: t.createdAt, source: "leader" }]] : [])),
        ),
      }),
      "/topics/quest-map": () => ({ enabled: false, map: {}, topics: {} }),
      "/todos/item-summaries": () => ({ items: {}, proposalItems: {}, revision: 0 }),
      "/glossary/opened": () => ({ opened: true }),
      "/leader-profile/animals-offer": () => ({ show: false }),
      "/user-content/notice": () => ({ show: false }),
      "/backends/claude/models": () => [],
    };
    if (routes[route]) return response(routes[route]());
    const artifact = route.match(/^\/artifacts\/([^/]+)(?:\/versions\/(\d+))?$/);
    if (artifact && this.artifacts.has(artifact[1])) {
      const { detail, content } = this.artifacts.get(artifact[1])!;
      return response(artifact[2] ? content : detail);
    }
    const reviewDiff = route.match(/^\/sessions\/[^/]+\/guided-reviews\/([^/]+)\/file-diff$/);
    if (reviewDiff) {
      const path = url.searchParams.get("path");
      const review = [...this.artifacts.values()].find(
        ({ content }) => content.kind === "review" && content.review?.meta.reviewId === reviewDiff[1],
      );
      const file = review?.files.find((entry) => entry.path === path);
      return response(file ? { available: true, diff: diffText(file) } : { available: false });
    }
    // The demo never shares a review: its answers stay with the leader that published it.
    const reviewHome = route.match(/^\/sessions\/[^/]+\/guided-reviews\/([^/]+)\/home$/);
    if (reviewHome) {
      const content = [...this.artifacts.values()].find(
        ({ content }) => content.kind === "review" && content.review?.meta.reviewId === reviewHome[1],
      )?.content;
      const review = content?.kind === "review" ? content.review : undefined;
      if (review) {
        const { sessionId, threadKey, questId } = review;
        return response({ home: { sessionId, threadKey, ...(questId ? { questId } : {}) } });
      }
    }
    const quest = route.match(/^\/quests\/(q-\d+)$/);
    if (quest && this.quests.has(quest[1])) return response(this.questRecord(this.quests.get(quest[1])!));
    const sessionRoute = route.match(/^\/sessions\/[^/]+\/(.+)$/)?.[1];
    if (sessionRoute === "notifications") return response(this.notifications);
    if (sessionRoute === "activity-preview") {
      const session = this.sessions.get(decodeURIComponent(route.split("/")[2] ?? ""));
      const preview: SessionActivityPreview = {
        lines: session?.activity ?? [],
        lastActivityAt: session?.activity.at(-1)?.timestamp ?? null,
      };
      return response(preview);
    }
    if (sessionRoute === "usage-limits") return response({ five_hour: null, seven_day: null, extra_usage: null });
    if (sessionRoute === "started-quests") return response({ quests: [] });
    if (sessionRoute?.match(/^started-quests\/[^/]+\/answer$/)) return response({ answer: null });
    if (sessionRoute === "message-search")
      return response({ results: [], totalMatches: 0, hasMore: false, nextOffset: null });
    if (method !== "GET") return response({ ok: true });
    return response({ error: "Not part of the demo" }, 404);
  }

  // ---- Server-shaped state ----

  private leader(): DemoSession {
    return this.session(this.leaderId);
  }

  private session(id: string): DemoSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown demo session ${id}`);
    return session;
  }

  private sendState(socket: DemoSocket, subscribe: boolean): void {
    const session = this.session(socket.view.sessionId);
    const isLeader = session.id === this.leaderId;
    if (subscribe) {
      socket.deliver({ type: "session_init", session: this.browserSession(session) as BrowserSessionState });
      socket.deliver({ type: "codex_pending_inputs", inputs: [] });
      socket.deliver({ type: "backend_connected" });
    }
    socket.deliver({
      type: "state_snapshot",
      sessionStatus: session.status,
      permissionMode: "bypassPermissions",
      backendConnected: true,
      backendState: "connected",
      uiMode: null,
      askPermission: false,
      generationStartedAt: session.generationStartedAt,
      activeTurnRoute: session.activeThread ? routeTarget(session.activeThread) : null,
      ...(isLeader
        ? {
            board: this.board,
            leaderActivePhaseSummary: buildLeaderActivePhaseSummary(this.board),
            completedBoard: this.completedBoard,
            rowSessionStatuses: this.rowSessionStatuses(),
          }
        : {}),
    } as BrowserIncomingMessage);
    socket.deliver({
      type: "status_change",
      status: session.status,
      activeTurnRoute: session.activeThread ? routeTarget(session.activeThread) : null,
      ...(session.generationStartedAt ? { generationStartedAt: session.generationStartedAt } : {}),
    });
    if (isLeader) {
      socket.deliver({
        type: "feed_attention_snapshot",
        notifications: this.notifications,
        ...this.notificationCounts(),
      });
      socket.deliver({
        type: "leader_projection_snapshot",
        projection: {
          schemaVersion: 2,
          sourceHistoryLength: session.history.length,
          threadSummaries: collectLeaderThreadSummaries(session.history),
          messageAttentionRecords: [],
        },
      } as BrowserIncomingMessage);
      for (const thread of socket.view.threads) socket.deliver(this.threadWindow(session.id, thread, socket.view));
    }
    if (subscribe) {
      socket.deliver({ type: "tree_groups_update", ...this.treeGroupsUpdate() } as BrowserIncomingMessage);
      socket.deliver({ type: "timer_update", timers: [] });
      socket.deliver({ type: "conversation_sync_complete", through_seq: 0 });
    }
    // The session list follows each change through the projections the browser subscribed to.
    for (const key of socket.projections) {
      const [projection, sessionId] = key.split("|");
      const envelope = this.projection(projection, sessionId);
      if (envelope) socket.deliver({ type: "synced_projection_snapshot", ...envelope } as BrowserIncomingMessage);
    }
  }

  private sendProjections(socket: DemoSocket, subscriptions: SubscriptionRequest[]): void {
    for (const { projection, key } of subscriptions) {
      socket.projections.add(`${projection}|${key}`);
      const envelope = this.projection(projection, key);
      if (envelope) socket.deliver({ type: "synced_projection_snapshot", ...envelope } as BrowserIncomingMessage);
    }
    socket.deliver({
      type: "synced_projection_subscriptions_ack",
      all_accepted: true,
      complete: true,
    } as BrowserIncomingMessage);
  }

  private threadWindow(sessionId: string, thread: string, view: DemoSocketView): BrowserIncomingMessage {
    const session = this.session(sessionId);
    const built = buildThreadWindowSync({
      messageHistory: session.history,
      threadKey: thread,
      fromItem: -1,
      itemCount: view.windowSize.section * view.windowSize.visible,
      sectionItemCount: view.windowSize.section,
      visibleItemCount: view.windowSize.visible,
    });
    return {
      type: "thread_window_sync",
      thread_key: built.threadKey,
      entries: built.entries,
      window: built.window,
      ...(built.threadResponseProjection ? { response_state: built.threadResponseProjection } : {}),
      thread_status: this.threadStatuses[built.threadKey] ?? null,
    };
  }

  private projection(projection: string, key: string) {
    const version = { generation: GENERATION, revision: this.revision };
    const session = this.sessions.get(key);
    if (!session) return null;
    if (projection === SESSION_NAVIGATION_PROJECTION)
      return { projection, key, ...version, value: this.navigation(session) };
    if (projection === SESSION_ATTENTION_PROJECTION)
      return { projection, key, ...version, value: this.attention(session) };
    if (projection === THREAD_MONITORING_PROJECTION)
      return {
        projection,
        key,
        ...version,
        value: { revision: 0, alertVersion: 0, trackedCount: 0, pendingCount: 0, threads: {} },
      };
    if (projection === LEADER_THREAD_TABS_PROJECTION && key === this.leaderId)
      return { projection, key, ...version, value: this.leaderTabs() };
    return null;
  }

  private sessionList(): SdkSessionInfo[] {
    return [...this.sessions.values()].map((session) => {
      const version = { generation: GENERATION, revision: this.revision };
      const portrait = LEADER_PROFILE_PORTRAITS.find((p) => p.id === session.portraitId);
      return {
        sessionId: session.id,
        ...this.navigationFields(session),
        ...(portrait ? { leaderProfilePortraitId: portrait.id, leaderProfilePortrait: portrait } : {}),
        ...this.notificationCounts(session),
        sessionNavigationProjection: {
          projection: SESSION_NAVIGATION_PROJECTION,
          key: session.id,
          ...version,
          value: this.navigation(session),
        },
        sessionAttentionProjection: {
          projection: SESSION_ATTENTION_PROJECTION,
          key: session.id,
          ...version,
          value: this.attention(session),
        },
        ...(session.id === this.leaderId
          ? {
              leaderThreadTabsProjection: {
                projection: LEADER_THREAD_TABS_PROJECTION,
                key: session.id,
                ...version,
                value: this.leaderTabs(),
              },
            }
          : {}),
      } as unknown as SdkSessionInfo;
    });
  }

  private navigationFields(session: DemoSession) {
    const quest =
      this.board.find((row) => row.worker === session.id) ??
      this.completedBoard.find((row) => row.worker === session.id);
    const last = [...session.history].reverse().find((m) => m.type === "assistant" || m.type === "user_message");
    return {
      name: session.name,
      model: session.model,
      cwd: CWD,
      backendType: session.backend,
      permissionMode: "bypassPermissions",
      askPermission: false,
      sessionNum: session.num,
      createdAt: session.createdAt,
      treeGroupId: "default",
      memorySessionSpaceSlug: "Pocket Ledger",
      repoRoot: CWD,
      isWorktree: Boolean(session.leaderId),
      isContainerized: false,
      hostId: null,
      isAssistant: false,
      isOrchestrator: !session.leaderId,
      herdedBy: session.leaderId ?? null,
      reviewerOf: null,
      cronJobId: null,
      cronJobName: null,
      state: "connected",
      status: session.status,
      cliConnected: true,
      killedByIdleManager: false,
      pendingPermissionCount: 0,
      pendingTimerCount: 0,
      waits: [],
      paused: false,
      pausedInputQueueCount: 0,
      lastActivityAt: session.lastActivityAt,
      lastUserMessageAt: session.createdAt,
      lastAttentionAt: session.lastActivityAt,
      lastMessagePreviewAt: session.lastActivityAt,
      claimedQuestId: quest?.questId ?? null,
      claimedQuestTitle: quest?.title ?? null,
      claimedQuestStatus: quest ? (this.quests.get(quest.questId)?.status ?? null) : null,
      claimedQuestVerificationInboxUnread: null,
      claimedQuestLeaderSessionId: quest ? this.leaderId : null,
      gitBranch: session.leaderId ? `pocket-ledger-${session.num}` : "main",
      gitDefaultBranch: "origin/main",
      diffBaseBranch: "origin/main",
      gitAhead: 0,
      gitBehind: 0,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
      diffStatsSkippedReason: null,
      gitStatusRefreshedAt: session.lastActivityAt,
      gitStatusRefreshError: null,
      lastMessagePreview: last ? previewText(last) : "",
      userTurnCount: 1,
      agentTurnCount: 1,
      contextUsedPercent: 12,
      contextTokensUsed: null,
      modelContextWindow: 1_000_000,
      codexMaxContextLength: null,
      claudeMaxContextLength: null,
      codexLeaderRecycleThresholdTokens: null,
      messageHistoryBytes: 0,
      codexRetainedPayloadBytes: 0,
      codexReasoningEffort: null,
      codexEffectiveReasoningEffort: null,
      codexEffectiveReasoningEffortReported: false,
    } satisfies SessionNavigationProjectionValue;
  }

  private navigation(session: DemoSession): SessionNavigationProjectionValue {
    return this.navigationFields(session);
  }

  private attention(session: DemoSession): SessionAttentionProjectionValue {
    if (session.id !== this.leaderId) return { attentionReason: null, status: null };
    const open = this.notifications.filter((n) => !n.done && n.category === "needs-input").length;
    return open
      ? { attentionReason: "action", status: { urgency: "needs-input", count: open } }
      : { attentionReason: null, status: null };
  }

  private notificationCounts(session?: DemoSession) {
    if (session && session.id !== this.leaderId) return {};
    const open = this.notifications.filter((n) => !n.done && n.category === "needs-input").length;
    return {
      notificationUrgency: open ? ("needs-input" as const) : null,
      activeNotificationCount: open,
      activeNeedsInputNotificationCount: open,
      activeReviewNotificationCount: 0,
      mutedNeedsInputNotificationCount: 0,
      notificationStatusVersion: this.revision,
      notificationStatusUpdatedAt: this.now(),
    };
  }

  private leaderTabs(): LeaderThreadTabsProjectionValue {
    const attention = (needsInput: boolean, at: number) => ({
      needsInput,
      mutedNeedsInput: false,
      reviewUnread: false,
      updatedAt: at,
      changedAt: at,
    });
    const tab = (row: BoardRow, completed: boolean): LeaderThreadTabsProjectionTab => {
      const journey = row.journey;
      const waiting = this.notifications.some((n) => !n.done && n.threadKey === row.questId);
      const queued = row.status === "QUEUED";
      return {
        threadKey: row.questId,
        questId: row.questId,
        title: row.title ?? null,
        boardStatus: row.status ?? null,
        journey: journey
          ? {
              mode: journey.mode ?? "active",
              phaseIds: journey.phaseIds,
              currentPhaseId: journey.currentPhaseId ?? null,
              activePhaseIndex: journey.activePhaseIndex ?? null,
              phaseCount: journey.phaseIds.length,
              durationSummary: null,
            }
          : null,
        sourceLeaderSessionId: this.leaderId,
        sourceRowCreatedAt: row.createdAt,
        workerSessionId: row.worker ?? null,
        workerSessionNum: row.workerNum ?? null,
        ownership: "own",
        active: !completed && !queued,
        queued: !completed && queued,
        proposed: false,
        neverStartedScheduled: !completed && queued,
        completed,
        canClose: completed,
        attention: attention(waiting, row.updatedAt ?? row.createdAt),
        updatedAt: row.updatedAt ?? row.createdAt,
        groupChangedAt: row.updatedAt ?? row.createdAt,
        ...(this.quests.get(row.questId)?.askedIn ? { sideQuestOf: this.quests.get(row.questId)!.askedIn } : {}),
      };
    };
    const tabs = [...this.board.map((row) => tab(row, false)), ...this.completedBoard.map((row) => tab(row, true))];
    return {
      currentQuestStateVersion: 1,
      tabState: { version: 1 },
      tabs,
      mainAttention: attention(false, this.now()),
      // Quest and Main statuses travel here; a started thread's comes with the thread list.
      threadStatuses: Object.fromEntries(
        Object.entries(this.threadStatuses).filter(([key]) => key === "main" || key.startsWith("q-")),
      ),
      activePhaseSummary: buildLeaderActivePhaseSummary(this.board),
      runningQuestIds: this.board
        .filter((row) => row.status !== "QUEUED" && row.status !== "USER_CHECKPOINTING")
        .map((row) => row.questId),
    };
  }

  private threadList() {
    return this.threads.map((thread) => {
      const lastActivity = [...this.leader().history]
        .reverse()
        .find((m) => "threadKey" in m && m.threadKey === thread.key);
      const activityAt =
        lastActivity && "timestamp" in m(lastActivity) ? Number(m(lastActivity).timestamp) : thread.createdAt;
      return {
        id: thread.id,
        key: thread.key,
        number: thread.number,
        address: `t-${thread.number}`,
        name: thread.name,
        leaderId: this.leaderId,
        topic: null,
        createdAt: thread.createdAt,
        activityAt,
        ...(this.threadStatuses[thread.key] ? { status: this.threadStatuses[thread.key] } : {}),
        interactionAt: activityAt,
      };
    });
  }

  private rowSessionStatuses() {
    return Object.fromEntries(
      [...this.board, ...this.completedBoard]
        .filter((row) => row.worker && this.sessions.has(row.worker))
        .map((row) => {
          const worker = this.session(row.worker!);
          return [
            row.questId,
            {
              worker: {
                sessionId: worker.id,
                sessionNum: worker.num,
                name: worker.name,
                status: worker.status,
                ...(worker.generationStartedAt ? { generationStartedAt: worker.generationStartedAt } : {}),
                ...(worker.activeThread ? { activeTurnRoute: routeTarget(worker.activeThread) } : {}),
              },
              reviewer: null,
            },
          ];
        }),
    );
  }

  private treeGroups() {
    const ids = [...this.sessions.keys()];
    return {
      groups: [{ id: "default", name: "Pocket Ledger" }],
      assignments: Object.fromEntries(ids.map((id) => [id, "default"])),
      nodeOrder: { default: [this.leaderId] },
    };
  }

  private treeGroupsUpdate() {
    const { groups, assignments, nodeOrder } = this.treeGroups();
    return { treeGroups: groups, treeAssignments: assignments, treeNodeOrder: nodeOrder };
  }

  private browserSession(session: DemoSession): Partial<BrowserSessionState> {
    return {
      session_id: session.id,
      backend_type: session.backend,
      model: session.model,
      cwd: CWD,
      tools: [],
      permissionMode: "bypassPermissions",
      claude_code_version: "",
      mcp_servers: [],
      agents: [],
      slash_commands: [],
      skills: [],
      total_cost_usd: 0,
      num_turns: 1,
      context_used_percent: 12,
      is_compacting: false,
      git_branch: "main",
      git_default_branch: "origin/main",
      is_worktree: Boolean(session.leaderId),
      is_containerized: false,
      repo_root: CWD,
      git_ahead: 0,
      git_behind: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
      isOrchestrator: !session.leaderId,
      backend_state: "connected",
      uiMode: "agent",
      askPermission: false,
      treeGroupId: "default",
    };
  }

  private questTitle(quest: DemoQuest) {
    return {
      questId: quest.id,
      title: quest.title,
      version: 1,
      updatedAt: this.now(),
      status: quest.status,
      tldr: quest.tldr,
    };
  }

  private questRecord(quest: DemoQuest) {
    return {
      id: quest.id,
      questId: quest.id,
      version: 1,
      title: quest.title,
      tldr: quest.tldr,
      description: quest.tldr,
      status: quest.status,
      tags: [],
      createdAt: this.now() - 60_000,
      updatedAt: this.now(),
      statusChangedAt: this.now(),
      feedback: [],
    };
  }
}

interface SubscriptionRequest {
  projection: string;
  key: string;
}

/** The browser's WebSocket to the stand-in server. */
export class DemoSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  readonly view: DemoSocketView;
  readonly projections = new Set<string>();
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(
    readonly url: string,
    private backend: DemoBackend | null,
  ) {
    super();
    const sessionId = decodeURIComponent(url.split("/ws/browser/")[1] ?? "").split("?")[0];
    this.view = { sessionId, threads: new Set(), windowSize: { section: 10, visible: 3 } };
    setTimeout(() => {
      // Sockets the demo does not serve (the dev server's own) simply never open.
      if (!this.backend || !sessionId) return;
      this.readyState = 1;
      this.onopen?.(new Event("open"));
      this.backend.connect(this);
    }, 0);
  }

  send(data: string): void {
    if (this.readyState === 1) this.backend?.receive(this, data);
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.backend?.disconnect(this);
    this.onclose?.(new CloseEvent("close", { code: 1000 }));
  }

  deliver(message: BrowserIncomingMessage): void {
    if (this.readyState !== 1) return;
    // Like the network, delivery is asynchronous and in order.
    const data = JSON.stringify(message);
    queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data })));
  }
}

/** Points the page's WebSocket and API requests at the stand-in server. */
export function installDemoBackend(backend: DemoBackend): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith(location.origin) ? url.slice(location.origin.length) : url;
    if (path.startsWith("/api/")) return backend.fetch(path, init);
    return realFetch(input, init);
  }) as typeof fetch;
  const DemoWebSocket = function (url: string) {
    return new DemoSocket(url, url.includes("/ws/browser/") ? backend : null);
  } as unknown as typeof WebSocket;
  Object.assign(DemoWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = DemoWebSocket;
}

/** One file's part of a diff, as git prints it. */
function diffText(file: DiffFile): string {
  const lines = [...file.header];
  for (const hunk of file.hunks) {
    const oldCount = hunk.lines.filter((line) => line.kind !== "add").length;
    const newCount = hunk.lines.filter((line) => line.kind !== "del").length;
    lines.push(`@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@${hunk.section}`);
    for (const line of hunk.lines)
      lines.push(`${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`);
  }
  return `${lines.join("\n")}\n`;
}

/** A history record's fields, for reading its timestamp. */
function m(message: BrowserIncomingMessage): Record<string, unknown> {
  return message as unknown as Record<string, unknown>;
}

function routing(thread: string): { threadKey: string; questId?: string; threadRefs: ThreadRef[] } {
  const quest = thread.startsWith("q-") ? { questId: thread } : {};
  return { threadKey: thread, ...quest, threadRefs: [{ threadKey: thread, ...quest, source: "explicit" }] };
}

function routeTarget(thread: string) {
  return thread.startsWith("q-") ? { threadKey: thread, questId: thread } : { threadKey: thread };
}

function previewText(message: BrowserIncomingMessage): string {
  if (message.type === "user_message") return message.content.slice(0, 80);
  if (message.type === "assistant") {
    const text = message.message.content.find((block) => block.type === "text");
    return text && "text" in text ? text.text.slice(0, 80) : "";
  }
  return "";
}
