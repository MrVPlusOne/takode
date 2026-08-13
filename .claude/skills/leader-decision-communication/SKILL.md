---
name: leader-decision-communication
description: "Use whenever a Takode leader/orchestrator writes or rewrites a user-facing decision, approval, confirmation, clarification, proposal, action request, or material status update, especially before a User Checkpoint or `takode notify needs-input`. Make the message decision-first, plain-language, and necessity-filtered without weakening visible-option, fresh-approval, notification, board-wait, interruption, or safety requirements."
---

# Leader Decision Communication

This skill is the authoritative owner of Takode's decision-first communication rule. Other leader, phase, and injected instruction paths should keep only their role-specific mechanics plus a pointer here.

## Choose the Message Shape

For a **decision or action request**, lead in this order:

1. **Problem or current state** — what needs attention.
2. **Practical consequence** — why it matters to the user now.
3. **Recommendation** — the preferred choice and why.
4. **Choices and key tradeoffs** — only what could change the decision.
5. **Exact requested answer** — the reply that unblocks the work.

For a **status update with no user decision**, lead with the outcome, user-facing impact, and next step. Do not invent a choice or ask for approval when none is needed.

Use familiar language. Define unavoidable jargon, translate machine-scale quantities into human-scale terms, and include local time when it helps. Do not make the user decode the implementation before learning the point.

## Apply the Necessity Filter

Keep a visible detail only when it helps the user:

- choose between the available options;
- understand time, cost, scope, or user-facing impact; or
- verify a material safety or authorization boundary.

Material details commonly include major risk or uncertainty, irreversible or destructive effects, external consequences, important prerequisites, and consequential overwrite, retention, cleanup, stop, or fallback behavior. Keep an exact value visible when the user is authorizing that value or it distinguishes the approved action.

Commands, hashes, internal paths, process or job identifiers, retry plumbing, monitoring mechanics, raw machine units, and UTC-only timestamps are normally supporting evidence rather than decision context. Keep them complete in quest feedback or another durable packet unless a specific value is itself material to the choice.

Do not use a hard length limit. A short prompt that hides a material tradeoff is worse than a longer prompt that enables a safe decision.

## Use Progressive Disclosure Without Hiding the Decision

Put the complete technical or safety packet in durable quest feedback or an artifact and reference the exact entry when useful. The visible message may bind the requested approval to that exact record without duplicating it.

The reference is not a substitute for the decision surface. The user must still see every option, its material tradeoffs, the recommendation, and the requested answer without opening the technical packet or understanding internal implementation.

Example:

> Two things block the test run: the input bundle still needs preparation, which should take about 2–6 hours and use up to 200 GB, and the current worker expires too soon. I recommend preparing the bundle and reserving a replacement worker. Neither choice starts the test run. Reply **Bundle: yes/no** and **Replacement: yes/no**. Exact commands, checksums, and retry evidence are in the referenced phase note.

## Preserve Authority and Delivery Safety

This skill changes presentation, not authority. Continue to follow the applicable User Checkpoint brief and Takode orchestration rules.

- Keep visible option meanings and relevant tradeoffs self-contained; explain every shortcut before notification.
- State what yes authorizes and what no declines or preserves.
- Keep material risks, irreversible effects, and approval-defining values visible.
- Preserve fresh explicit approval, revised-packet, visible-prompt-before-notify, fresh-notification, board-wait, and scoped-wait requirements.
- Do not broaden permissions or treat an edit, question, or ambiguous reply as approval.
- If an injected or recovery-message path is involved, preserve its interruption, replay, idempotence, and routing policy.

## Pre-Send Check

Before publishing, ask:

- Can the user understand the problem and consequence before any implementation detail?
- Can the user decide without understanding internal implementation?
- Is the recommendation explicit, and is the requested answer easy to copy or select?
- Does every visible detail pass the necessity filter?
- Are all material tradeoffs and safety boundaries still present?
- If approval binds to a durable packet, is the exact record unambiguous?
- Are the applicable routing, notification, board-wait, and fresh-approval mechanics still satisfied?

If any answer is no, rewrite before sending.
