import type { ChatMessage } from "../../types.js";
import {
  formatArtifactPlaceholder,
  type ArtifactMessageMarker,
  type ArtifactSummary,
} from "../../../shared/artifact-library.js";
import { MessageBubble } from "../MessageBubble.js";
import { ArtifactCard } from "../library/ArtifactThumbnail.js";
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

/** The newest version: its drafts, a title header (not shown or copied) and its Library link in the card header. */
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

/** An earlier copy of the newest version, which a later message sent again unchanged. */
const REPEATED_VERSION_MESSAGE: ChatMessage = {
  id: "playground-artifact-repeated",
  role: "assistant",
  timestamp: 0,
  content: `Here's the DM reworked:\n\n${formatArtifactPlaceholder({ ...POST, version: 3, versionCount: 3, repeated: true })}`,
};

/** A message mentioning artifacts with Takode artifact links (hover shows a card; click opens the Library). */
const LINK_MESSAGE: ChatMessage = {
  id: "playground-artifact-links",
  role: "assistant",
  timestamp: 0,
  content:
    "The newest numbers are in [T7 vs twin evals by training data](artifact:0f1e2d3c), and the version you posted was [T7 thread update](artifact:7a6b5c4d:v2).",
};

function sampleArtifact(overrides: Partial<ArtifactSummary>): ArtifactSummary {
  const at = Date.now();
  return {
    id: "playground-card",
    kind: "post",
    title: "T7 thread update",
    space: "MSI",
    sessionId: "playground-session",
    threadKey: "q-2713",
    createdAt: at,
    updatedAt: at,
    starred: false,
    versionCount: 1,
    latest: { n: 1, at, bytes: 0, kept: true, source: { sessionId: "s", messageId: "m", threadKey: "q-2713", at } },
    preview: "",
    ...overrides,
  };
}

/** Text kinds draw a miniature from the excerpt sent with the list; pictures come from cached thumbnails. */
const GALLERY_CARDS: ArtifactSummary[] = [
  sampleArtifact({
    id: "card-table",
    kind: "table",
    title: "4 PM T7 update: training is now clearly helping on the SWE benchmarks",
    excerpt:
      "| Benchmark | Start | T7 latest | Change |\n| --- | --- | --- | --- |\n| SWE-bench Verified | 0.512 | 0.574 | +0.06 |\n| SB Pro hard | 0.451 | 0.618 | +0.17 |\n| DeepSWE v1.1 | 0.159 | 0.230 | +0.07 |\n| TB 1015 | 0.38 | 0.41 | +0.03 |",
  }),
  sampleArtifact({
    id: "card-post",
    kind: "post",
    title: "T7 thread update",
    versionCount: 3,
    starred: true,
    excerpt:
      "Quick T7 update (T7 at step ~165, 256K twin at step ~94):\n\n- SB Pro hard 0.451 -> 0.618\n- DeepSWE 0.159 -> 0.230\n\nThe twin tracks T7 on every eval so far.",
  }),
  sampleArtifact({
    id: "card-report",
    kind: "report",
    title: "Why the SD@400 checkpoint scores lower on T7's 384K evals",
    excerpt:
      "# Why SD@400 scores lower\n\nThe gap comes from stricter grading, not the 384K context.\n\n## What we checked\n- Same problems, both graders\n- Rollouts past 256K only",
  }),
];

export function PlaygroundArtifactLibrarySection() {
  return (
    <Section
      title="Artifact Library in the Feed"
      description="Drafts, reports, figures, visuals, tables and guided reviews are saved in the Library with versions. Messages can link to them with artifact: links, and the Library's gallery shows them as cards. A version a newer one replaced, or an earlier copy of a version sent again, collapses to one line whose content was not sent (Show loads it from the backend); the newest carries its Library link in the card header. A draft's title: header names it and is neither shown nor copied."
    >
      <Card label="Older version, collapsed">
        <div className="max-w-[640px]" data-testid="playground-artifact-older">
          <MessageBubble message={OLDER_VERSION_MESSAGE} sessionId="playground-session" />
        </div>
      </Card>
      <Card label="Earlier copy of a version sent again, collapsed">
        <div className="max-w-[640px]" data-testid="playground-artifact-repeated">
          <MessageBubble message={REPEATED_VERSION_MESSAGE} sessionId="playground-session" />
        </div>
      </Card>
      <Card label="Artifact links (hover for a card; click opens the Library)">
        <div className="max-w-[640px]" data-testid="playground-artifact-links">
          <MessageBubble message={LINK_MESSAGE} sessionId="playground-session" />
        </div>
      </Card>
      <Card label="Gallery cards: table, post and report miniatures">
        <div className="grid max-w-[700px] grid-cols-2 gap-3 sm:grid-cols-3" data-testid="playground-artifact-cards">
          {GALLERY_CARDS.map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} showKind showSpace={false} onOpen={() => {}} />
          ))}
        </div>
      </Card>
      <Card label="Newest version, Library link in the card header">
        <div className="max-w-[640px]" data-testid="playground-artifact-newest">
          <MessageBubble message={NEWEST_VERSION_MESSAGE} sessionId="playground-session" />
        </div>
      </Card>
    </Section>
  );
}
