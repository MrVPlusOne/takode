import type { ChatMessage } from "../../types.js";
import { formatArtifactPlaceholder, type ArtifactMessageMarker } from "../../../shared/artifact-library.js";
import { MessageBubble } from "../MessageBubble.js";
import { Card, Section } from "./shared.js";

const POST: ArtifactMessageMarker = {
  id: "playground-post",
  kind: "post",
  title: "T7 thread update",
  version: 2,
  versionCount: 3,
};

/** An older version: the server sent the collapsed placeholder instead of its drafts. */
const OLDER_VERSION_MESSAGE: ChatMessage = {
  id: "playground-artifact-older",
  role: "assistant",
  timestamp: 0,
  content: `Here's the update, split into three messages. Attach the eval figure to the second and the training figure to the third.\n\n${formatArtifactPlaceholder(POST)}`,
};

/** The newest version: its drafts, a title header (not shown or copied) and the "Saved in Library" line. */
const NEWEST_VERSION_MESSAGE: ChatMessage = {
  id: "playground-artifact-newest",
  role: "assistant",
  timestamp: 0,
  content: [
    "Here's the T7 progress figure, and the update with it in the first message:",
    "",
    "````draft",
    "title: T7 thread update",
    "---",
    "Quick T7 update (T7 at step ~165, 256K twin at step ~94):",
    "",
    "| Eval | Start | T7 now (iter) |",
    "| --- | --- | --- |",
    "| SB Pro hard | 0.451 | 0.618 (160) |",
    "| DeepSWE v1.1 | 0.159 | 0.230 (152) |",
    "````",
    "",
    "```draft",
    "384K vs 256K twin, evals by checkpoint (attached): so far the twin tracks T7 on every eval.",
    "```",
  ].join("\n"),
  metadata: { artifacts: [{ ...POST, version: 3 }] },
};

export function PlaygroundArtifactLibrarySection() {
  return (
    <Section
      title="Artifact Library in the Feed"
      description="Drafts, reports, figures, visuals and guided reviews are saved in the Library with versions. A version a newer one replaced collapses to one line whose content was not sent (Show loads it from the backend); the newest gets a Saved in Library line. A draft's title: header names it and is neither shown nor copied."
    >
      <Card label="Older version, collapsed">
        <div className="max-w-[640px]" data-testid="playground-artifact-older">
          <MessageBubble message={OLDER_VERSION_MESSAGE} sessionId="playground-session" />
        </div>
      </Card>
      <Card label="Newest version with its Library line">
        <div className="max-w-[640px]" data-testid="playground-artifact-newest">
          <MessageBubble message={NEWEST_VERSION_MESSAGE} sessionId="playground-session" />
        </div>
      </Card>
    </Section>
  );
}
