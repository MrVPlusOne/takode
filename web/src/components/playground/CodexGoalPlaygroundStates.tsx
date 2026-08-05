import { CodexGoalPanel } from "../CodexGoalPanel.js";
import { Card, Section } from "./shared.js";

const NOW = new Date().toISOString();

export function PlaygroundCodexGoalStates() {
  return (
    <Section title="Codex Goal" description="Manual Codex Goal controls and status projection">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card label="Active with budget">
          <div className="border-t border-cc-border bg-cc-card p-4">
            <CodexGoalPanel
              sessionId="playground-codex-goal-active"
              capability={{ state: "supported", checkedAt: Date.now(), error: null }}
              goal={{
                threadId: "thread-active",
                objective: "Finish the migration and report validation limits.",
                status: "active",
                tokenBudget: 120000,
                tokensUsed: 34200,
                timeUsedSeconds: 2520,
                createdAt: NOW,
                updatedAt: NOW,
              }}
            />
          </div>
        </Card>
        <Card label="Paused checkpoint">
          <div className="border-t border-cc-border bg-cc-card p-4">
            <CodexGoalPanel
              sessionId="playground-codex-goal-paused"
              capability={{ state: "supported", checkedAt: Date.now(), error: null }}
              goal={{
                threadId: "thread-paused",
                objective: "Audit rollout behavior after the user chooses a deployment window.",
                status: "paused",
                tokenBudget: null,
                tokensUsed: 8100,
                timeUsedSeconds: 600,
                createdAt: NOW,
                updatedAt: NOW,
              }}
            />
          </div>
        </Card>
        <Card label="Unsupported backend">
          <div className="border-t border-cc-border bg-cc-card p-4">
            <CodexGoalPanel
              sessionId="playground-codex-goal-unsupported"
              capability={{ state: "unsupported", checkedAt: Date.now(), error: "thread/goal/get is unavailable" }}
              goal={null}
            />
          </div>
        </Card>
      </div>
    </Section>
  );
}
