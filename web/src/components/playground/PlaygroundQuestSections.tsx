import { PlaygroundQuestmasterDemo, PlaygroundQuestmasterPhoneRows } from "./PlaygroundQuestmasterDemo.js";
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

export function PlaygroundQuestmasterSection() {
  return (
    <Section
      title="Questmaster List"
      description="Questmaster's list: status chips, Journey-phase status, open feedback and one-line TLDRs, laid out for phone or desktop by window width."
    >
      <div className="space-y-4">
        <Card label="Page at this window's width">
          <PlaygroundQuestmasterDemo />
        </Card>
        <Card label="Phone rows">
          <PlaygroundQuestmasterPhoneRows />
        </Card>
      </div>
    </Section>
  );
}
