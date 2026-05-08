---
name: takode-injected-message-design
description: "Use before changing Takode injected messages, synthetic user messages, model-only reminders, reminder messages, or reminder-message rendering/delivery. Future agents working on injected-message behavior must read this skill first."
---

# Takode Injected Message Design

Use this skill before changing any Takode path that injects messages into a session or renders those injected messages differently from ordinary user/assistant output. This includes synthetic user messages, model-only reminders, Thread Outcome Reminder, Thread Routing Reminder, quest-thread reminders, needs-input reminders, timer reminders, herd-event injections, and recovery or restart-prep messages.

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
