import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { structuredPatch } from "diff";
import {
  isLeaderSkillPreloadSourceId,
  isSystemSourceId,
  LEADER_SKILL_PRELOAD_SOURCE_ID_PREFIX,
  SKILL_CHANGE_NOTICE_SOURCE_ID,
} from "../shared/injected-event-message.js";
import type { BrowserUserMessage } from "./bridge/adapter-browser-routing-message-types.js";
import { normalizeAdapterUserMessage } from "./bridge/user-message-delivery.js";
import type { BrowserIncomingMessage } from "./session-types.js";

/**
 * Skills a session loaded keep their old text in its conversation after Takode
 * updates them (Claude Code even carries invoked skills across compaction).
 * Takode's own skills change only when the server restarts onto new code, so
 * each start records which of them changed, and the first input a session gets
 * in that run names the ones it had loaded before they changed. When the change
 * since the version the session saw is small, the notice carries the diff, so
 * the session need not load the whole skill again; otherwise it says how big
 * the change is. Each start keeps the last few versions of every skill for this.
 *
 * What a session loaded comes from its history: leader preloads, the Skill
 * tool, and reads or shell commands that open a `skills/<name>/SKILL.md`. The
 * version it saw is the one installed when it loaded the skill or got the last
 * notice, since skills change only between server runs.
 */

const SKILL_CHANGE_NOTICE_SOURCE = {
  sessionId: SKILL_CHANGE_NOTICE_SOURCE_ID,
  sessionLabel: "Skills Changed",
};
const SKILL_FILE_PATTERN = /skills\/([A-Za-z0-9._-]+)\/SKILL\.md/g;
/** A diff up to this long goes into the notice; a longer change is only sized, and the session rereads the skill if it needs it. */
const MAX_DIFF_CHARS = 2_000;
const DIFF_CONTEXT_LINES = 2;
/** Versions of each skill kept, current included. Sessions that saw an older one get no diff. */
const KEPT_VERSIONS = 10;

interface SkillVersion {
  hash: string;
  /** Start time of the server run that first saw this text; 0 when it was there from the first record. */
  since: number;
  /** Missing for versions recorded before Takode kept skill texts. */
  text?: string;
}

/** How the current text differs from an earlier version. */
type SkillChange =
  | { kind: "diff"; diff: string }
  | {
      kind: "large";
      addedLines: number;
      removedLines: number;
      diffChars: number;
    };

interface EarlierVersion {
  since: number;
  /** Null when this version's text was not kept. */
  change: SkillChange | null;
}

/** A changed skill as one session saw it. */
export interface ChangedLoadedSkill {
  name: string;
  /** When the session last loaded the skill or got a notice covering it. */
  seenAt: number;
}

/** When each tracked skill last changed, set once per server start. */
let skillChangeTimes: ReadonlyMap<string, number> | null = null;
/** Each tracked skill's earlier versions, oldest first. */
let earlierVersions: ReadonlyMap<string, readonly EarlierVersion[]> = new Map();
/** Sessions already checked in this server run; their later inputs skip the history scan. */
let checkedSessions = new WeakSet<object>();

/**
 * Hash each tracked skill's `SKILL.md` under `skillsDir`, compare it with the
 * versions the previous run saved in `statePath`, remember when each one last
 * changed and how it differs from the kept earlier versions, and save the
 * versions again. Run after startup has installed the skills.
 */
export async function recordSkillVersions(options: {
  skillNames: readonly string[];
  skillsDir: string;
  statePath: string;
  now?: number;
}): Promise<ReadonlyMap<string, number>> {
  const now = options.now ?? Date.now();
  const previous = await readSavedVersions(options.statePath);
  const saved: Record<string, { versions: SkillVersion[] }> = {};
  const changeTimes = new Map<string, number>();
  const earlier = new Map<string, EarlierVersion[]>();
  for (const name of options.skillNames) {
    const text = await readFile(join(options.skillsDir, name, "SKILL.md"), "utf-8").catch(() => null);
    if (text === null) continue;
    const versions = addVersion(previous[name] ?? [], text, now).slice(-KEPT_VERSIONS);
    saved[name] = { versions };
    changeTimes.set(name, versions.at(-1)!.since);
    earlier.set(
      name,
      versions.slice(0, -1).map((version) => ({
        since: version.since,
        change: version.text === undefined ? null : describeChange(version.text, text),
      })),
    );
  }
  await mkdir(dirname(options.statePath), { recursive: true });
  await writeFile(options.statePath, `${JSON.stringify(saved, null, 2)}\n`);
  skillChangeTimes = changeTimes;
  earlierVersions = earlier;
  checkedSessions = new WeakSet();
  return skillChangeTimes;
}

/**
 * For the first ordinary input a session gets in this server run (not one of
 * Takode's own system messages), add a notice naming the skills it loaded that
 * have changed since. Returns null when this input is not checked; otherwise
 * the input to deliver, and the caller calls `markSkillChangesChecked` once it
 * was accepted.
 */
export function checkSkillChanges(
  session: { id: string; messageHistory: readonly BrowserIncomingMessage[] },
  message: BrowserUserMessage,
): BrowserUserMessage | null {
  if (!skillChangeTimes || checkedSessions.has(session) || isSystemSourceId(message.agentSource?.sessionId)) {
    return null;
  }
  const changed = findChangedLoadedSkills(session.messageHistory, skillChangeTimes);
  if (changed.length === 0) return message;
  // Compile the attachment paths first: setting deliveryContent hides imageRefs from delivery.
  const primary = normalizeAdapterUserMessage(session, message, message.imageRefs);
  if (primary?.type !== "user_message") return message;
  const notice = formatSkillChangeNotice(
    changed.map(({ name, seenAt }) => ({
      name,
      // The version the session saw is the last one installed by then.
      change: earlierVersions.get(name)?.findLast((version) => version.since <= seenAt)?.change ?? null,
    })),
  );
  return {
    ...message,
    deliveryContent: `${primary.content}\n\n${notice}`,
    historyFollowUps: [
      ...(message.historyFollowUps ?? []),
      { content: notice, agentSource: SKILL_CHANGE_NOTICE_SOURCE },
    ],
  };
}

export function markSkillChangesChecked(session: object): void {
  checkedSessions.add(session);
}

/**
 * Skills loaded in `history` whose text changed after the session last saw
 * them, sorted by name. An earlier notice counts as a fresh load of everything
 * loaded before it, since it covered every changed one.
 */
export function findChangedLoadedSkills(
  history: readonly BrowserIncomingMessage[],
  changeTimes: ReadonlyMap<string, number>,
): ChangedLoadedSkill[] {
  const loadedAt = new Map<string, number>();
  let noticedAt = 0;
  for (const entry of history) {
    if (entry.type === "user_message") {
      const source = entry.agentSource?.sessionId;
      if (source === SKILL_CHANGE_NOTICE_SOURCE_ID) noticedAt = entry.timestamp;
      if (isLeaderSkillPreloadSourceId(source)) {
        loadedAt.set(source!.slice(LEADER_SKILL_PRELOAD_SOURCE_ID_PREFIX.length), entry.timestamp);
      }
      continue;
    }
    if (entry.type !== "assistant" || !Array.isArray(entry.message.content)) continue;
    for (const block of entry.message.content) {
      if (block.type !== "tool_use") continue;
      for (const name of skillsLoadedByToolUse(block.name, block.input)) loadedAt.set(name, entry.timestamp ?? 0);
    }
  }
  return [...loadedAt]
    .map(([name, at]) => ({ name, seenAt: Math.max(at, noticedAt) }))
    .filter(({ name, seenAt }) => (changeTimes.get(name) ?? 0) > seenAt)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function formatSkillChangeNotice(skills: readonly { name: string; change: SkillChange | null }[]): string {
  const names = skills.map(({ name }) => `\`${name}\``).join(", ");
  const lines = [`[Skills changed] These skills changed after you loaded them: ${names}.`];
  for (const { name, change } of skills) lines.push("", formatChange(name, change));
  return lines.join("\n");
}

/** Reset module state between tests. */
export function resetSkillChangeTrackingForTest(): void {
  skillChangeTimes = null;
  earlierVersions = new Map();
  checkedSessions = new WeakSet();
}

function formatChange(name: string, change: SkillChange | null): string {
  const reload = "load it again (the Skill tool, or read its SKILL.md) only if you need it for what you are doing now.";
  if (change?.kind === "diff") {
    const fence = codeFence(change.diff);
    return [
      `\`${name}\` changed only as shown; the rest is as you loaded it, so you need not load it again:`,
      `${fence}diff`,
      change.diff,
      fence,
    ].join("\n");
  }
  if (change?.kind === "large") {
    const size = `${change.addedLines} lines added, ${change.removedLines} removed, a ${change.diffChars.toLocaleString("en-US")}-character diff`;
    return `\`${name}\` changed too much to show here (${size}). Your copy is out of date: ${reload}`;
  }
  return `\`${name}\`: your copy is out of date; ${reload}`;
}

/** A compact unified diff from `before` to `after`, or its size when too long to include. */
function describeChange(before: string, after: string): SkillChange {
  const patch = structuredPatch("", "", before, after, undefined, undefined, {
    context: DIFF_CONTEXT_LINES,
  });
  const lines: string[] = [];
  let addedLines = 0;
  let removedLines = 0;
  for (const hunk of patch.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      if (line.startsWith("\\")) continue; // "\ No newline at end of file"
      if (line.startsWith("+")) addedLines++;
      if (line.startsWith("-")) removedLines++;
      lines.push(line);
    }
  }
  const diff = lines.join("\n");
  return diff.length <= MAX_DIFF_CHARS
    ? { kind: "diff", diff }
    : { kind: "large", addedLines, removedLines, diffChars: diff.length };
}

/** Skills contain code fences, so the diff's fence must be longer than any backtick run in it. */
function codeFence(text: string): string {
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

function addVersion(versions: readonly SkillVersion[], text: string, now: number): SkillVersion[] {
  const hash = createHash("sha256").update(text).digest("hex");
  const current = versions.at(-1);
  if (!current) return [{ hash, since: 0, text }];
  // Unchanged: still store the text, which records from before texts were kept lack.
  if (current.hash === hash) return [...versions.slice(0, -1), { ...current, text }];
  return [...versions, { hash, since: now, text }];
}

function skillsLoadedByToolUse(toolName: string, input: Record<string, unknown> | undefined): string[] {
  if (toolName === "Skill" && typeof input?.skill === "string") return [input.skill];
  const names: string[] = [];
  for (const field of [input?.file_path, input?.command]) {
    if (typeof field !== "string") continue;
    for (const match of field.matchAll(SKILL_FILE_PATTERN)) names.push(match[1]);
  }
  return names;
}

async function readSavedVersions(statePath: string): Promise<Record<string, SkillVersion[]>> {
  let saved: Record<string, { versions?: SkillVersion[]; hash?: string; changedAt?: number }>;
  try {
    saved = JSON.parse(await readFile(statePath, "utf-8"));
  } catch (error) {
    // Without a saved record every skill starts unchanged.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[skill-change-notice] Ignoring unreadable ${statePath}:`, error);
    }
    return {};
  }
  return Object.fromEntries(
    Object.entries(saved).map(([name, entry]) => [
      name,
      // Records from before texts were kept hold only the current hash.
      entry.versions ?? (entry.hash ? [{ hash: entry.hash, since: entry.changedAt ?? 0 }] : []),
    ]),
  );
}
