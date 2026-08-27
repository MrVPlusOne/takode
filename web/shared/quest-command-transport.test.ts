import { expect, it } from "vitest";
import { QUEST_COMMAND_CLIENT_TIMEOUT_MS, QUEST_COMMAND_RUNNER_TIMEOUT_MS } from "./quest-command-transport.js";

it("keeps the client deadline beyond the server-owned runner deadline", () => {
  expect(QUEST_COMMAND_CLIENT_TIMEOUT_MS).toBeGreaterThan(QUEST_COMMAND_RUNNER_TIMEOUT_MS);
  expect(QUEST_COMMAND_CLIENT_TIMEOUT_MS - QUEST_COMMAND_RUNNER_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
});
