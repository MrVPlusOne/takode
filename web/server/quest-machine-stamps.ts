import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { rewriteAllQuests } from "./quest-store.js";
import { writeVerifiedQuestStoreBackup } from "./quest-store-migration.js";
import type { QuestDone, QuestFeedbackEntry, QuestmasterTask } from "./quest-types.js";
import { sessionMachineName } from "./remote-host/machines.js";
import { QUEST_MACHINE_STAMPS_MARKER } from "./constants.js";

export interface QuestMachineStampResult {
  stampedEntries: number;
  stampedDebriefs: number;
  /** The whole store as it was before the migration. */
  backupFile: string;
}

/**
 * One-time migration: quest notes and debriefs written before machine stamps
 * existed are stamped with the machine they were written on. That is the
 * machine of the note's author session when Takode still knows it, and
 * otherwise this coordinator's machine, which ran every session before remote
 * hosts existed. Notes written in the browser have no author session and stay
 * unstamped, like new ones. Debriefs record no session and get the
 * coordinator's machine.
 *
 * The whole store is first saved to a backup file, which is read back and
 * checked against what was saved. A marker file makes the migration run once;
 * it only adds missing stamps, so running it again after an interruption is
 * harmless. To undo it, stop the server, move `~/.companion/questmaster-live/quests`
 * aside and copy the backup file named in the marker to
 * `~/.companion/questmaster-live/store.json`; the next start moves it back into
 * one file per quest.
 */
export async function stampQuestMachines(options: {
  coordinatorMachine: string;
  machineForSession?: (sessionId: string) => string | undefined;
}): Promise<QuestMachineStampResult | null> {
  const companionDir = join(homedir(), ".companion");
  const markerPath = join(companionDir, "questmaster-live", QUEST_MACHINE_STAMPS_MARKER);
  if (await exists(markerPath)) return null;
  const machineForSession = options.machineForSession ?? sessionMachineName;
  const outcome: { result?: QuestMachineStampResult } = {};

  await rewriteAllQuests(async (storeText, quests) => {
    const counts = { entries: 0, debriefs: 0 };
    const stamped = quests.map((quest) => stampQuest(quest, options.coordinatorMachine, machineForSession, counts));
    if (counts.entries === 0 && counts.debriefs === 0) return null;
    const backupFile = await writeVerifiedQuestStoreBackup(
      join(companionDir, "questmaster-backups"),
      "store-before-machine-stamps",
      storeText,
    );
    outcome.result = { stampedEntries: counts.entries, stampedDebriefs: counts.debriefs, backupFile };
    return stamped;
  });
  const result = outcome.result ?? null;

  await mkdir(join(companionDir, "questmaster-live"), { recursive: true });
  await writeFile(
    markerPath,
    `${JSON.stringify({ migratedAt: new Date().toISOString(), coordinatorMachine: options.coordinatorMachine, ...(result ?? {}) }, null, 2)}\n`,
    "utf-8",
  );
  if (result) {
    const { stampedEntries, stampedDebriefs, backupFile } = result;
    console.log(
      `[quest-machine-stamps] Stamped ${stampedEntries} quest notes and ${stampedDebriefs} debriefs with machine names; ` +
        `the store before this is saved at ${backupFile} (to undo, stop the server, move questmaster-live/quests aside and copy it to questmaster-live/store.json)`,
    );
  }
  return result;
}

function stampQuest(
  quest: QuestmasterTask,
  coordinatorMachine: string,
  machineForSession: (sessionId: string) => string | undefined,
  counts: { entries: number; debriefs: number },
): QuestmasterTask {
  let changed = false;
  const feedback = quest.feedback?.map((entry): QuestFeedbackEntry => {
    if (entry.machine || entry.deletedAt || !(entry.authorSessionId || entry.author === "agent")) return entry;
    const machine = (entry.authorSessionId && machineForSession(entry.authorSessionId)) || coordinatorMachine;
    counts.entries++;
    changed = true;
    return { ...entry, machine };
  });
  const done = quest.status === "done" ? (quest as QuestDone) : null;
  const stampDebrief = Boolean(done?.debrief && !done.debriefMachine);
  if (stampDebrief) counts.debriefs++;
  if (!changed && !stampDebrief) return quest;
  return {
    ...quest,
    ...(feedback ? { feedback } : {}),
    ...(stampDebrief ? { debriefMachine: coordinatorMachine } : {}),
  } as QuestmasterTask;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
