import type { QuestServerClient } from "./quest-server-client.js";
import { formatHandoffResult, type ThreadHandoffResult } from "./thread-handoff-format.js";

/**
 * `--source-message uN`: the user's message this quest was filed from, by the `id:uN` its
 * source tag showed; the server resolves the ID in the calling session's conversation.
 * `--own-thread`: the quest is its own conversation rather than a side quest of the thread
 * where the message was asked (one of several quests from it, or long work).
 */
export interface SourceMessageFlags {
  startedFromUserMessageId?: string;
  ownThread?: true;
}

export function parseSourceMessageFlags(
  option: (name: string) => string | undefined,
  flag: (name: string) => boolean,
): SourceMessageFlags {
  const raw = option("source-message")?.trim();
  if (raw !== undefined && !/^u\d+$/.test(raw)) {
    throw new Error(`--source-message takes a user message ID like u12, not "${raw}"`);
  }
  return {
    ...(raw !== undefined ? { startedFromUserMessageId: raw } : {}),
    ...(flag("own-thread") ? { ownThread: true as const } : {}),
  };
}

/** What the source-message commands need from the running `quest` CLI. */
export interface SourceMessageCli {
  questServer: QuestServerClient;
  sessionId: string | undefined;
  json: boolean;
}

/**
 * Hands the leader's requests off to a quest it just filed or reopened, as `takode thread handoff`
 * does: at once when the quest is already active on its board, else when `takode board set` puts
 * it there (that command's output then says so).
 */
export async function handOffWhenOnBoard(
  cli: SourceMessageCli,
  questId: string,
  userMessageIds: string[],
): Promise<void> {
  try {
    if (!cli.sessionId) throw new Error("--handoff needs a Takode leader session");
    const { value } = await cli.questServer.request<ThreadHandoffResult>(
      "POST",
      `/sessions/${encodeURIComponent(cli.sessionId)}/thread/handoff`,
      { questId, userMessageIds, whenOnBoard: true },
    );
    if (!cli.json) console.log(formatHandoffResult({ ...value, questId }));
  } catch (e) {
    // The quest itself is saved: say so, and how to hand off once the problem is fixed.
    console.error(
      `Not handed off: ${(e as Error).message}. ${questId} is saved; hand off with \`takode thread handoff ${questId} --user ${userMessageIds.join(" ")}\`.`,
    );
    process.exitCode = 1;
  }
}

/**
 * After a quest was filed or edited from the user's message: tell the leader what it is now, a side
 * quest whose result goes back to the thread where the user asked, or its own conversation. When it
 * was just filed as a side quest, also say how to make it its own conversation instead.
 */
export async function reportStartedQuest(cli: SourceMessageCli, questId: string, justFiled: boolean): Promise<void> {
  if (cli.json || !cli.sessionId) return;
  const kind = await cli.questServer.read<{ note: string | null; sideQuest: boolean }>(
    `/sessions/${encodeURIComponent(cli.sessionId)}/started-quests/${encodeURIComponent(questId)}/kind`,
    { allowNotFound: true },
  );
  if (!kind?.note) return;
  const instead =
    justFiled && kind.sideQuest
      ? ` If it should be its own conversation instead (long work, or one of several quests from that message), run \`quest edit ${questId} --own-thread\`.`
      : "";
  console.log(kind.note + instead);
}
