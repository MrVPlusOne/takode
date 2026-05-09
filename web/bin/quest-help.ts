export function showHelp(): void {
  console.log(`Questmaster CLI

Usage: quest <command> [options]

Commands:
  list   [--status <s1,s2>] [--tag <t>] [--tags "t1,t2"] [--session <sid>] [--text <q>] [--verification <scope>] [--json]
                                                         List quests with optional filters
  mine   [--json]                                        List quests owned by current session
  grep   <pattern> [--count N] [--json]                  Search inside quest title, description, debrief, and feedback/comments with snippets
  show   <id> [--json]                                   Show quest detail
  status <id> [--json]                                   Show compact action-oriented quest status
  history <id> [--json]                                  Show quest history
  tags   [--json]                                        List all existing tags with counts
  create [<title> | --title "..." | --title-file <path>|-] [--desc "..." | --desc-file <path>|-] [--tldr "..." | --tldr-file <path>|-] [--tags "t1,t2"] [--follow-up-of "q-1,q-2"] [--image <path>] [--images "p1,p2"] [--json]
                                                         Create a quest
  claim  <id> [--session <sid>] [--force --reason <text>] [--json]
                                                         Claim for session; --force is audited and server-auth only
  reassign <id> --session <worker> --reason <text> [--json]
                                                         Leader-only audited ownership reassignment
  complete <id> [--items "c1,c2" | --items-file <path>|-] [--session <sid>] [--commit <sha>] [--commits "s1,s2"] [--debrief "..." | --debrief-file <path>|-] [--debrief-tldr "..." | --debrief-tldr-file <path>|-] [--json]
                                                         Mark done and submit for review
  done   <id> [--notes "..." | --notes-file <path>|-] [--debrief "..." | --debrief-file <path>|-] [--debrief-tldr "..." | --debrief-tldr-file <path>|-] [--cancelled] [--json]
                                                         Mark as done/cancelled
  cancel <id> [--notes "reason" | --notes-file <path>|-] [--json]
                                                         Cancel from any status
  transition <id> --status <s> [--desc "..." | --desc-file <path>|-] [--tldr "..." | --tldr-file <path>|-] [--commit <sha>] [--commits "s1,s2"] [--debrief "..." | --debrief-file <path>|-] [--debrief-tldr "..." | --debrief-tldr-file <path>|-] [--json]
                                                         Change status
  later  <id> [--json]                                   Move review-pending quest out of inbox
  inbox  <id> [--json]                                   Move review-pending quest back to inbox
  edit   <id> [--title "..." | --title-file <path>|-] [--desc "..." | --desc-file <path>|-] [--tldr "..." | --tldr-file <path>|-] [--tags "t1,t2"] [--follow-up-of "q-1,q-2" | --clear-follow-up-of] [--json]
                                                         Edit in place
  check  <id> <index> [--json]                           Toggle verification item
  feedback <id> [--text "..." | --text-file <path>|-] [--tldr "..." | --tldr-file <path>|-] [--author agent|human] [--session <sid>] [--phase <id>] [--phase-position <n>] [--phase-occurrence <n>] [--phase-occurrence-id <id>] [--journey-run <id>] [--kind <kind>] [--infer-phase] [--no-phase] [--image <path>] [--images "p1,p2"] [--json]
                                                         Add feedback entry
  feedback add <id> [--text "..." | --text-file <path>|-] [--tldr "..." | --tldr-file <path>|-] [--author agent|human] [--session <sid>] [--phase <id>] [--phase-position <n>] [--phase-occurrence <n>] [--phase-occurrence-id <id>] [--journey-run <id>] [--kind <kind>] [--infer-phase] [--no-phase] [--image <path>] [--images "p1,p2"] [--json]
                                                         Add feedback entry explicitly
  feedback list <id> [--last N] [--author human|agent|all] [--unaddressed] [--json]
                                                         List indexed feedback entries
  feedback latest <id> [--author human|agent|all] [--unaddressed] [--full] [--json]
                                                         Show latest matching feedback entry
  feedback show <id> <index> [--json]                    Show one indexed feedback entry
  address <id> <index> [--json]                          Toggle feedback addressed status
  delete <id> [--json]                                   Delete quest
  resize-image <path> [--max-dim 1920] [--json]          Resize an image to fit within max dimension
  optimize-image <path> [--max-dim 1920] [--json]        Write an optimized .takode-agent sibling image

Environment:
  COMPANION_SESSION_ID  Session ID (auto-set by Companion)
  COMPANION_AUTH_TOKEN  Session auth token (auto-set by Companion)
  COMPANION_PORT        Server port for browser notifications

Auth fallback:
  .companion/session-auth.json (or legacy .codex/.claude paths)

Verification scopes:
  --verification inbox      done quests in Review Inbox
  --verification reviewed   done quests acknowledged and still under review
  --verification all        all done quests still under review

Search tips:
  quest list --text "foo"   Filter quests broadly by text
  quest grep "foo|bar"      Search inside quest text/debrief/comments with contextual snippets
  quest grep "follow_up"    Search related quest metadata and backlinks too

Safer rich-text input:
  quest create --title-file title.txt --desc-file body.md
  quest create --title-file title.txt --desc-file body.md --tldr-file summary.txt
  printf '%s\\n' 'Copied \`$(snippet)\` stays literal' | quest create "Quest title" --desc-file -
  quest edit q-1 --desc-file body.md
  quest create "Follow-up" --follow-up-of q-1
  quest edit q-2 --follow-up-of "q-1,q-3"
  quest edit q-2 --clear-follow-up-of
  quest claim q-1 --force --reason "board assigned this phase to me"
  quest reassign q-1 --session 42 --reason "stale previous worker"
  quest feedback q-1 --text-file note.md --tldr-file note-tldr.md
  quest feedback latest q-1 --author human --unaddressed --full
  quest feedback show q-1 0
  printf '%s\\n' 'Line 1' '\`$(nope)\`' | quest feedback q-1 --text-file -
  quest complete q-1 --items-file items.txt
  printf '%s\\n' 'Review comma-heavy item, "quotes", {braces}' | quest complete q-1 --items-file -
  quest done q-1 --debrief-file final-debrief.md --debrief-tldr-file final-debrief-tldr.md
  quest done q-1 --notes-file closeout.md
  printf '%s\\n' 'Superseded by q-2 with copied \`$(note)\` text' | quest cancel q-1 --notes-file -`);
}
