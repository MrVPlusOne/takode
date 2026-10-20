import type { ChatMessage } from "../../types.js";
import { MessageBubble } from "../MessageBubble.js";
import { Card, Section } from "./shared.js";

/** A schema pasted as pretty-printed JSON: about 200 lines, the kind of block that used to run on. */
const LONG_JSON = JSON.stringify(
  {
    definitions: Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        String(index),
        {
          types: ["string", "number", "object"],
          properties: { $ref: `#/definitions/${index + 1}` },
          required: [],
          additionalProperties: false,
        },
      ]),
    ),
  },
  null,
  2,
);

const LONG_CODE_MESSAGE: ChatMessage = {
  id: "playground-long-code-block",
  role: "assistant",
  timestamp: 0,
  content: `The complete property contract follows as JSON:\n\n\`\`\`json\n${LONG_JSON}\n\`\`\`\n\nThe text after the block is reachable without scrolling past every line.\n\n\`\`\`\nshort block: stays at its own height\n\`\`\``,
};

export function PlaygroundLongCodeBlockSection() {
  return (
    <Section
      title="Long Code Blocks"
      description="A code block taller than about 22rem scrolls inside a capped window, both ways; its header shows the line count and an expand button, and an expanded block can be collapsed from its header or its end. Short blocks keep their height."
    >
      <Card label="Assistant message with a 200-line JSON block and a short block">
        <div className="max-w-[430px]" data-testid="playground-long-code-block">
          <MessageBubble message={LONG_CODE_MESSAGE} sessionId="playground-long-code" />
        </div>
      </Card>
    </Section>
  );
}
