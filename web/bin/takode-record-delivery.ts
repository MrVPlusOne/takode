import { apiPost, assertKnownFlags, err, parseFlags, parseIntegerFlag } from "./takode-core.js";
import { parseCommitShas } from "./quest-commit-flags.js";
import type { QuestDeliveryView } from "../shared/quest-delivery.js";
import { deliveryTargetFlags } from "./takode-delivery-target.js";

export const RECORD_DELIVERY_HELP = `Usage: takode board record-work-delivery <quest-id> --commits <sha,...> [--preparation <id>] [--delivery-target <approval-id>[,<approval-id>...]] [--work-note <index>] [--json]

Record an already verified/synchronized delivery while staying in Work. Uses the
same evidence guard as Work -> Memory. It does not port, push, or advance a phase.
After using port tracking, supply --preparation to attach retained review evidence.
For independent publication, ask the assigned leader to approve-delivery-target,
then use --delivery-target with the approved commits. Work spanning repositories
names every approval and lists all commits in --commits: each approval's commits
are recorded as that repository's delivery, the rest (with --preparation, if any)
as the inherited target's. Do not repeat a push to fix recording.
`;

export async function handleRecordDelivery(base: string, args: string[]): Promise<void> {
  const questId = args[0];
  if (!questId || !/^q-\d+$/.test(questId)) err(RECORD_DELIVERY_HELP);
  const flags = parseFlags(args.slice(1));
  assertKnownFlags(
    flags,
    new Set(["commits", "preparation", "delivery-target", "work-note", "json"]),
    RECORD_DELIVERY_HELP,
  );
  const deliveryTargetIds = deliveryTargetFlags(args, flags);
  if (typeof flags.commits !== "string") err("--commits requires the ordered synchronized target SHAs.");
  if (flags.preparation === true) err("--preparation requires its exact ID.");
  const result = (await apiPost(base, "/takode/board/record-work-delivery", {
    questId,
    commitShas: parseCommitShas(flags.commits.split(",")),
    preparationId: flags.preparation,
    ...(deliveryTargetIds.length > 0 ? { deliveryTargetIds } : {}),
    workFeedbackIndex: parseIntegerFlag(flags, "work-note", "Work note"),
  })) as { questId: string; deliveries: QuestDeliveryView[] };
  if (flags.json) {
    const views = result.deliveries.map((delivery) => ({
      deliveryId: delivery.id,
      commitShas: delivery.commits.map((commit) => commit.sha),
      branch: delivery.branch,
    }));
    console.log(JSON.stringify(views.length === 1 ? { questId, ...views[0] } : { questId, deliveries: views }));
  } else {
    for (const delivery of result.deliveries)
      console.log(
        `${questId}: recorded delivery ${delivery.id} (${delivery.commits.length} commits on ${delivery.branch}); still in Work.\nAuthor links: quest commit-links ${questId} --delivery ${delivery.id}`,
      );
  }
}
