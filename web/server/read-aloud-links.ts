import { getQuest } from "./quest-store.js";

const COMMIT_CHIP_LINK =
  /\[([^\]]*)\]\(quest:(q-\d+):delivery:([a-f0-9]{32})(?::range:[a-f0-9]{40}:[a-f0-9]{40})?:commit:([a-f0-9]{40})\)/gi;

/**
 * Facts the Read aloud rewrite cannot see in a message's text: the size of each
 * commit chip, which the feed shows from the quest's recorded delivery. One line per
 * chip, or an empty string when the message has none.
 */
export async function describeReadAloudLinks(messageText: string): Promise<string> {
  const lines: string[] = [];
  for (const match of messageText.matchAll(COMMIT_CHIP_LINK)) {
    const [, title, questId, deliveryId, sha] = match;
    const commit = await getQuest(questId)
      .then((quest) => quest?.codeDeliveries?.find((delivery) => delivery.id === deliveryId))
      .then((delivery) => delivery?.commits.find((entry) => entry.sha === sha.toLowerCase()))
      .catch((error: unknown) => {
        console.warn(`[read-aloud] Could not read the delivery for ${questId}: ${error}`);
        return undefined;
      });
    const size = commit ? `${commit.additions} lines added, ${commit.deletions} removed` : "size unknown";
    lines.push(`- Commit chip "${title}": ${size}`);
  }
  return lines.join("\n");
}
