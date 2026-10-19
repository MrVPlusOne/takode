import type { PendingCodexInput, PendingUserUpload } from "../../types.js";
import { PendingMessages } from "../PendingMessages.js";
import { Card, Section } from "./shared.js";

const SESSION_ID = "playground-pending-message-states";
const PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z1WQAAAAASUVORK5CYII=";

const SINGLE_QUEUED: PendingCodexInput[] = [
  {
    id: "playground-single-queued",
    content: "Also make the picker remember the last mic per device, and keep the old Settings reset working.",
    timestamp: 1,
    cancelable: true,
  },
];

const SENDING: PendingUserUpload[] = [
  {
    id: "playground-sending",
    content: "Compare this screenshot with the current mobile header state.",
    timestamp: 1,
    stage: "delivering",
    images: [
      {
        id: "playground-sending-image",
        name: "attachment-1.png",
        base64: PIXEL_PNG,
        mediaType: "image/png",
        status: "ready",
        prepared: { imageRef: { imageId: "playground-sending-image", media_type: "image/png" }, path: "/tmp/a.png" },
      },
    ],
  },
];

const FAILED_LOCAL: PendingUserUpload[] = [
  {
    id: "playground-failed-local",
    content: "Shorten this oversized request before sending it again.",
    timestamp: 1,
    stage: "failed",
    error: "Connection lost before delivery.",
    images: [],
    prepared: { deliveryContent: "Shorten this oversized request before sending it again.", imageRefs: [] },
  },
];

/** The pending-message states drawn on their own, outside a seeded feed. */
export function PlaygroundPendingMessageStates() {
  return (
    <Section
      title="Pending Messages"
      description="A message not yet delivered shows as the faded bubble it becomes, at the end of the feed, with its status and actions in a pill on its lower edge. The common case is one queued Codex message; a local send awaiting the server says Sending; failures offer Retry and Edit."
    >
      <div className="space-y-4">
        <Card label="One queued Codex message">
          <PendingState codexInputs={SINGLE_QUEUED} />
        </Card>
        <Card label="Sending, awaiting server acknowledgement">
          <PendingState uploads={SENDING} />
        </Card>
        <Card label="Local send failed">
          <PendingState uploads={FAILED_LOCAL} />
        </Card>
      </div>
    </Section>
  );
}

function PendingState({
  uploads = [],
  codexInputs = [],
}: {
  uploads?: PendingUserUpload[];
  codexInputs?: PendingCodexInput[];
}) {
  return (
    <div className="max-w-3xl rounded-xl border border-cc-border bg-cc-bg px-2 pb-6 pt-4 sm:px-4">
      <PendingMessages sessionId={SESSION_ID} uploads={uploads} codexInputs={codexInputs} />
    </div>
  );
}
