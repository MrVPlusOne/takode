import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
 * in that run names the ones it had loaded before they changed.
 *
 * What a session loaded comes from its history: leader preloads, the Skill
 * tool, and reads or shell commands that open a `skills/<name>/SKILL.md`.
 */

const SKILL_CHANGE_NOTICE_SOURCE = {
  sessionId: SKILL_CHANGE_NOTICE_SOURCE_ID,
  sessionLabel: "Skills Changed",
};
const SKILL_FILE_PATTERN = /skills\/([A-Za-z0-9._-]+)\/SKILL\.md/g;

interface SkillVersion {
  hash: string;
  /** Start time of the server run that first saw this text; 0 when it was there from the first record. */
  changedAt: number;
}

/** When each tracked skill last changed, set once per server start. */
let skillChangeTimes: ReadonlyMap<string, number> | null = null;
/** Sessions already checked in this server run; their later inputs skip the history scan. */
let checkedSessions = new WeakSet<object>();

/**
 * Hash each tracked skill's `SKILL.md` under `skillsDir`, compare it with the
 * hashes the previous run saved in `statePath`, and remember when each one last
 * changed. Run after startup has installed the skills.
 */
export async function recordSkillVersions(options: {
  skillNames: readonly string[];
  skillsDir: string;
  statePath: string;
  now?: number;
}): Promise<ReadonlyMap<string, number>> {
  const now = options.now ?? Date.now();
  const previous = await readSavedVersions(options.statePath);
  const current: Record<string, SkillVersion> = {};
  for (const name of options.skillNames) {
    const text = await readFile(join(options.skillsDir, name, "SKILL.md"), "utf-8").catch(() => null);
    if (text === null) continue;
    const hash = createHash("sha256").update(text).digest("hex");
    const saved = previous[name];
    current[name] = { hash, changedAt: !saved ? 0 : saved.hash === hash ? saved.changedAt : now };
  }
  await mkdir(dirname(options.statePath), { recursive: true });
  await writeFile(options.statePath, `${JSON.stringify(current, null, 2)}\n`);
  skillChangeTimes = new Map(Object.entries(current).map(([name, version]) => [name, version.changedAt]));
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
  const notice = formatSkillChangeNotice(changed);
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
 * Skills loaded in `history` whose text changed after the session last loaded
 * them. An earlier notice counts as a fresh load of everything loaded before
 * it, since it named every changed one.
 */
export function findChangedLoadedSkills(
  history: readonly BrowserIncomingMessage[],
  changeTimes: ReadonlyMap<string, number>,
): string[] {
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
    .filter(([name, at]) => (changeTimes.get(name) ?? 0) > Math.max(at, noticedAt))
    .map(([name]) => name)
    .sort();
}

export function formatSkillChangeNotice(skillNames: readonly string[]): string {
  const names = skillNames.map((name) => `\`${name}\``).join(", ");
  return [
    `[Skills changed] These skills changed after you loaded them: ${names}.`,
    "Your copies of them are out of date. Load again only the ones you need for what you are doing now (the Skill tool, or read its SKILL.md), and skip the rest until you need them.",
  ].join("\n");
}

/** Reset module state between tests. */
export function resetSkillChangeTrackingForTest(): void {
  skillChangeTimes = null;
  checkedSessions = new WeakSet();
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

async function readSavedVersions(statePath: string): Promise<Record<string, SkillVersion>> {
  try {
    return JSON.parse(await readFile(statePath, "utf-8")) as Record<string, SkillVersion>;
  } catch (error) {
    // Without a saved record every skill starts unchanged.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[skill-change-notice] Ignoring unreadable ${statePath}:`, error);
    }
    return {};
  }
}
