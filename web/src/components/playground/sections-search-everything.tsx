import { SearchEverythingDemoPanel } from "../SearchEverythingOverlay.js";
import type { SearchEverythingResult } from "../../api.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const MIXED_RESULTS: SearchEverythingResult[] = [
  {
    id: "session:s-auth",
    type: "session",
    title: "#12 Auth workflow worker",
    subtitle: "last active 4m ago · feature/search · /Code/takode",
    score: 1220,
    matchedFields: ["user_message", "assistant", "branch"],
    childMatches: [
      {
        id: "message:s-auth:m1",
        type: "message",
        title: "Message",
        snippet: "Approved product defaults: global_search should open the new Search Everything overlay.",
        matchedField: "user_message",
        score: 660,
      },
      {
        id: "message:s-auth:m2",
        type: "message",
        title: "Assistant",
        snippet: "Search Everything results aggregate matching messages under their containing session.",
        matchedField: "assistant",
        score: 620,
      },
      {
        id: "session:s-auth:branch",
        type: "session_field",
        title: "Branch",
        snippet: "main-wt-6666",
        matchedField: "branch",
        score: 800,
      },
    ],
    totalChildMatches: 7,
    remainingChildMatches: 4,
    route: { kind: "session", sessionId: "s-auth" },
    meta: {
      sessionId: "s-auth",
      sessionNum: 12,
      lastActivityAt: Date.now() - 240_000,
      cwd: "/Code/takode",
      gitBranch: "feature/search",
    },
  },
  {
    id: "quest:q-42",
    type: "quest",
    title: "q-42 Implement search-everything feature",
    subtitle: "in_progress",
    score: 1180,
    matchedFields: ["title", "feedback_3_text", "feedback_4_text"],
    childMatches: [
      {
        id: "quest:q-1177:title",
        type: "quest_field",
        title: "Title",
        snippet: "Implement search-everything feature",
        matchedField: "title",
        score: 1100,
      },
      {
        id: "quest:q-1177:feedback_3",
        type: "quest_feedback",
        title: "Feedback 4",
        snippet: "Aggregate repeated child matches into natural parent objects.",
        matchedField: "feedback_3_text",
        score: 590,
      },
      {
        id: "quest:q-1177:feedback_4",
        type: "quest_feedback",
        title: "Feedback 5",
        snippet: "Make global_search open Search Everything and include active cross-session messages.",
        matchedField: "feedback_4_text",
        score: 590,
      },
    ],
    totalChildMatches: 5,
    remainingChildMatches: 2,
    route: { kind: "quest", questId: "q-42" },
    meta: { questId: "q-42", status: "in_progress", lastActivityAt: Date.now() - 600_000 },
  },
];

export function PlaygroundSearchEverythingSections() {
  return (
    <PlaygroundSectionGroup groupId="interactive">
      <Section
        title="Search Everything"
        description="App-wide grouped search overlay with parent session and quest results, child evidence snippets, category toggles, and command-palette keyboard behavior."
      >
        <div className="grid gap-4">
          <Card label="Mixed grouped results">
            <SearchEverythingDemoPanel query="search everything" results={MIXED_RESULTS} state="results" />
          </Card>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card label="Loading">
              <SearchEverythingDemoPanel query="auth" results={[]} state="loading" />
            </Card>
            <Card label="Empty">
              <SearchEverythingDemoPanel query="unmatched phrase" results={[]} state="empty" />
            </Card>
            <Card label="Error">
              <SearchEverythingDemoPanel query="branch state" results={[]} state="error" />
            </Card>
          </div>
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
