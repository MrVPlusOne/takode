import { apiGet, apiPost, assertKnownFlags, err, parseFlags, readOptionTextFile } from "./takode-core.js";

export const DELIVERY_TARGET_HELP = `Usage: takode board approve-delivery-target <quest-id> --target-file <path|-> [--json]
       takode board delivery-targets <quest-id> [--target <approval-id>] [--json]

The assigned leader records an already-authorized independent publication target
for the current worker and Work occurrence. This verifies existing publication;
it never pushes, moves a branch, repairs another quest, or changes session targets.

Target JSON: { "checkoutPath": "/absolute/independent-checkout", "remote": "origin",
  "repositoryUrl": "https://example.com/team/project.git",
  "refs": [{ "ref": "refs/heads/user/change", "sha": "<published head SHA>" }],
  "commitShas": ["<first final Work commit SHA>", "<last final Work commit SHA>"] }
For Work published to several repositories, the file may hold a JSON list of
targets, one per repository: each is verified and gets its own approval ID, and
none is recorded unless all verify.
checkoutPath is on the machine holding the worker's port target (its remote host,
if any), where Takode verifies it.
List all relevant final target commits in delivery order, separately from ref heads.
Both lists require full lowercase SHAs. Each commit must be reachable from an exact
published head. Use Work/publication receipts to establish the complete set; exclude
unrelated ancestors and discarded pre-squash increments. Git does not infer ownership.
The worker names the approvals with --delivery-target <id>[,<id>...] on
record-work-delivery or work-to-memory, and lists every approved commit in --commits
(plus any inherited-target commits), without --no-code.
Use delivery-targets --target for the full persisted approval, including paths/refs.
`;

/** Record or inspect target authority without publishing code or changing a session's target. */
export async function handleDeliveryTarget(base: string, action: string, args: string[]): Promise<void> {
  const questId = args[0];
  if (!questId || !/^q-\d+$/.test(questId)) err(DELIVERY_TARGET_HELP);
  const flags = parseFlags(args.slice(1));
  assertKnownFlags(
    flags,
    new Set(action === "approve-delivery-target" ? ["target-file", "json"] : ["target", "json"]),
    DELIVERY_TARGET_HELP,
  );
  if (action === "approve-delivery-target") {
    if (typeof flags["target-file"] !== "string") err("--target-file requires the approved target JSON file.");
    const spec = JSON.parse(await readOptionTextFile(flags["target-file"], "--target-file"));
    const result = (await apiPost(
      base,
      "/takode/board/approve-delivery-target",
      Array.isArray(spec) ? { questId, targets: spec } : { questId, target: spec },
    )) as { approvals: Array<{ approvalId: string; refCount: number; commitCount: number }> };
    const ids = result.approvals.map((item) => item.approvalId).join(",");
    if (flags.json)
      console.log(
        JSON.stringify(
          Array.isArray(spec) ? { questId, approvals: result.approvals } : { questId, ...result.approvals[0] },
        ),
      );
    else {
      for (const item of result.approvals)
        console.log(
          `${questId}: approved delivery target ${item.approvalId} (${item.refCount} refs; ${item.commitCount} commits).`,
        );
      console.log(`Worker: use --delivery-target ${ids} with the complete approved commit list.`);
    }
    return;
  }
  if (flags.target !== undefined && (typeof flags.target !== "string" || !/^[a-f0-9]{32}$/.test(flags.target)))
    err("--target requires an exact approval ID.");
  const result = (await apiGet(
    base,
    `/takode/board/delivery-targets/${questId}${flags.target ? `/${flags.target}` : ""}`,
  )) as {
    approval?: unknown;
    approvals?: Array<{
      id: string;
      approvedAt: number;
      phaseOccurrenceId: string;
      refCount: number;
      commitCount: number | null;
    }>;
  };
  if (flags.target) {
    console.log(JSON.stringify({ questId, approval: result.approval }, null, flags.json ? undefined : 2));
  } else {
    const approvals =
      result.approvals?.map(({ id, approvedAt, phaseOccurrenceId, refCount, commitCount }) => ({
        id,
        approvedAt,
        phaseOccurrenceId,
        refCount,
        commitCount,
      })) ?? [];
    if (flags.json) console.log(JSON.stringify({ questId, approvals }));
    else
      console.log(
        approvals.length
          ? approvals
              .map(
                (item) =>
                  `${item.id} (${item.refCount} refs; ${item.commitCount ?? "unrecorded"} commits; ${item.phaseOccurrenceId})`,
              )
              .join("\n")
          : `${questId}: no independent delivery target approvals.`,
      );
  }
}

/**
 * The approvals named with --delivery-target, for both worker-owned delivery paths.
 * The flag takes a comma-separated list and may repeat; parseFlags keeps only its
 * last value, so the raw arguments are read.
 */
export function deliveryTargetFlags(args: string[], flags: Record<string, string | boolean>): string[] {
  const ids = args.flatMap((arg, index) =>
    arg === "--delivery-target" ? (args[index + 1] ?? "").split(",").map((id) => id.trim()) : [],
  );
  if (ids.some((id) => !/^[a-f0-9]{32}$/.test(id)) || new Set(ids).size !== ids.length)
    err("--delivery-target requires distinct exact leader-approved target IDs.");
  if (ids.length > 0 && flags["no-code"])
    err("--delivery-target uses published commits and cannot combine with --no-code.");
  return ids;
}
