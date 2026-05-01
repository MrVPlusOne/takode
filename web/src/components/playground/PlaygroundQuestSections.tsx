import { PlaygroundQuestmasterCompactDemo } from "./PlaygroundQuestmasterCompactDemo.js";
import { PlaygroundQuestStatusPanelDemo } from "./PlaygroundQuestStatusPanelDemo.js";
import { Card, Section } from "./shared.js";

export function PlaygroundQuestStatusPanelSection() {
  return (
    <Section
      title="Quest Status Panel"
      description="Compact quest/status summary used in thread-aware leader surfaces."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Card label="Selected session quest">
          <PlaygroundQuestStatusPanelDemo variant="claimed" />
        </Card>
        <Card label="Leader board attention row">
          <PlaygroundQuestStatusPanelDemo variant="board-attention" />
        </Card>
      </div>
    </Section>
  );
}

export function PlaygroundQuestmasterCompactSection() {
  return (
    <Section
      title="Questmaster Compact Table"
      description="Compact Questmaster rows with generalized status, verification, and markdown TLDR rendering."
    >
      <Card label="Status, Verify, and title cell content">
        <PlaygroundQuestmasterCompactDemo />
      </Card>
    </Section>
  );
}
