---
name: takode-injected-message-design
description: "Use before changing Takode injected messages, synthetic user messages, model-only reminders, reminder messages, system notices (landing queue, resource lease, recovery, restart), or how any of them render or are delivered, and before adding a new message type to the chat feed or choosing between a message bubble and a collapsed chip. Future agents working on injected-message behavior must read this skill first."
---

# Takode Injected Message Design

Use this skill before changing any Takode path that injects messages into a session or renders those injected messages differently from ordinary user/assistant output. This includes synthetic user messages, model-only reminders, Thread Outcome Reminder, Thread Routing Reminder, quest-thread reminders, needs-input reminders, timer reminders, herd-event injections, landing-queue and resource-lease notices, and recovery or restart-prep messages.

## Core Rule

Injected messages are part of the model and operator workflow, not ordinary chat prose. Decide explicitly whether each injected-message path should run for interrupted-generation turns before adding or changing it.

## Interruption Policy

- Skip reminder or injected-message paths for turns that were interrupted while the model was still generating, unless the message is specifically about the interruption/recovery itself.
- Use the completed-turn boundary that already knows whether the turn was interrupted. Do not hide an unwanted reminder in frontend rendering after it has already been injected.
- Treat direct user interrupts, leader interrupts, SDK/Codex adapter interrupts, result `stop_reason` values containing interrupt/cancel, and raced adapter results after an interrupt as the same policy class.
- Preserve normal eligible behavior for completed non-interrupted turns, including idempotence and replay protections.

## Design Checklist

- Identify the source id and label for the injected message, and keep server/frontend contracts shared when the UI depends on them.
- Keep injected message routing metadata separate from status metadata. A status marker can update status without moving source prose, tool blocks, notifications, or answer UI.
- Avoid recursive reminder loops. System-triggered reminder turns and historical replay should not create fresh reminders.
- Add focused tests for both sides of the policy: the skip condition and a normal eligible path that still works.
- Prefer server-side prevention over frontend suppression when the product expectation is that no injected message exists.

## Feed Rendering: Bubbles Are for Conversation, Chips Are for Takode

A message bubble is for conversation: the user, or another session such as a leader, speaking to this session. Everything Takode itself injects (reminders, notices, queue and lease outcomes, recovery and bootstrap content) renders as one collapsed chip that expands to the full text.

Why: injected messages are part of the agent's workflow. As bubbles they look like something the user said, and their raw SHAs, commands and IDs crowd out the actual conversation, especially on a phone. A chip keeps the one fact a person needs visible and leaves the rest one tap away.

How to apply:

- **Use the shared chip.** Render through `InjectedMessageChip` and `InjectedMessageRow` (`web/src/components/InjectedMessageChip.tsx`) with an icon from `InjectedMessageIcons.tsx`. Do not hand-roll chip markup, colors or timestamps; extend the shared chip if a type genuinely needs something new.
- **Collapsed line: title, summary, badge.** The title names the kind of message ("Landing queue"), the summary is the one fact worth seeing ("q-12 landed on main"), and the badge is a short status ("landed", "1 open"). Keep raw IDs, SHAs, commands and source tags such as `[Landing queue]` out of the collapsed line; never show notification IDs.
- **Expanded detail: the full original text.** Show the message's Markdown, optionally with labeled facts above it. Rendering never changes what the agent receives; the model gets the injected text unchanged.
- **Start collapsed, always.** Do not auto-expand, even for open items; attention belongs to needs-input cards and the attention navigators.
- **Tone through theme tokens.** Pick a chip tone: `success` for good news, `attention` for something that needs a look, `info` for neutral system information, `warning` for broken or truncated content, `neutral` otherwise. The shared chip maps tones to `cc-*` tokens that work in light and dark themes; raw Tailwind shades tuned for dark are unreadable in light theme.
- **Classify by a shared source ID.** Give each message type a stable `agentSource.sessionId` defined once in `web/shared/` and used by both the server and the frontend. Choose the renderer by source ID, not by matching prose; parse the text only to build the summary, and fall back to the first line when parsing fails.
- **Show it.** Add a Playground card for each new state and check it at phone width in dark and light themes.

Bubbles stay bubbles for messages that act as a person's request: leader or session instructions, needs-input answers, user-scheduled cron prompts and Settings handoffs. Herd events and timer firings keep their own compact renderers because they batch and count repeated rows.

