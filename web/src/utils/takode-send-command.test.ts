import { describe, expect, it } from "vitest";
import { isPureTakodeSendCommand } from "./takode-send-command.js";

describe("isPureTakodeSendCommand", () => {
  it.each([
    ['takode send 17 "Please add focused tests"', "positional message"],
    ['TAKODE_API_PORT=3456 takode send worker-17 "Please continue" --correction', "environment prefix"],
    ['/Users/me/.companion/bin/takode send 17 "Please continue" --json', "absolute CLI path"],
    ['env TAKODE_API_PORT=3456 -- /opt/takode send 17 "Please continue"', "env wrapper"],
    ['# thread:q-1892\ntakode send 17 "Please continue"', "thread routing comment"],
    ["takode send 17 --stdin < /tmp/message.md", "stdin file redirect"],
    ['takode send 17 --stdin <<< "Please continue"', "stdin here-string"],
    ["takode send 17 --stdin <<'EOF'\nPlease continue.\nEOF", "quoted heredoc"],
    ["takode send 17 --stdin <<'EOF'\nExplain $(git status) literally.\nEOF", "literal quoted-heredoc syntax"],
    ["takode send 17 --stdin <<-EOF\n\tPlease continue.\n\tEOF", "tab-stripped heredoc"],
  ])("recognizes a pure send with %s", (command) => {
    expect(isPureTakodeSendCommand(command)).toBe(true);
  });

  it.each([
    ["takode send 17", "missing message"],
    ["takode send 17 --stdin", "stdin without a source"],
    ['echo "takode send 17 hello"', "quoted mention"],
    ['rg -n "takode send" web/src', "search mention"],
    ['takode answer 17 "hello"', "different Takode command"],
    ['takode notify review "ready"', "notification command"],
    ['takode send 17 "hello" && git status', "later operational command"],
    ['git status; takode send 17 "hello"', "earlier operational command"],
    ['printf "hello" | takode send 17 --stdin', "pipeline producer"],
    ["takode send 17 --stdin > /tmp/output", "non-stdin redirection"],
    ['takode send 17 "$(git status)"', "command substitution"],
    ['takode send 17 "`git status`"', "backtick command substitution"],
    ["takode send 17 --stdin <<EOF\n$(git status)\nEOF", "unquoted heredoc command substitution"],
    ["takode send 17 --stdin <<EOF\n`git status`\nEOF", "unquoted heredoc backtick substitution"],
    ["takode send 17 --stdin <<'EOF'\n\nEOF", "empty heredoc"],
    ["takode send 17 --stdin <<'EOF'\nhello\nEOF\ngit status", "trailing heredoc command"],
    ['command takode send 17 "hello"', "unsupported wrapper"],
  ])("rejects %s", (command) => {
    expect(isPureTakodeSendCommand(command)).toBe(false);
  });
});
