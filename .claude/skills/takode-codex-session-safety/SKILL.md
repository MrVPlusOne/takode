---
name: takode-codex-session-safety
description: "Use before changing or reviewing Takode Codex adapter/session behavior involving Codex skills/changed notifications, skills/list or app/list metadata refresh, stale skill/app metadata state, startup or relaunch metadata pickup, Codex session close waves, browser-open relaunch or recovery behavior, or image attachment transport safety."
---

# Takode Codex Session Safety

Use this skill before changing Takode paths that can affect Codex session liveness, metadata refresh, browser-triggered recovery, or image delivery to model backends.

## Core Rules

- Treat automatic `skills/changed` as invalidation, not permission to immediately refresh. Mark skill/app metadata stale, surface state and diagnostics, and avoid forced `skills/list` / `app/list` from that notification.
- Keep metadata pickup explicit or idle. Startup/relaunch and manual refresh can fetch skill/app metadata, but those requests must be bounded, cause-labeled, and coordinated with outgoing turn dispatch.
- Never let metadata refresh overlap queued user work, `turn/start`, or an active turn. If startup pickup is queued behind user work and the turn becomes active, skip or defer the metadata refresh.
- Browser viewing should primarily subscribe and sync state. Do not make passive browser-open the fastest relaunch or recovery path; recovery triggers should be explicit, gated, rate-limited, or handled by the server lifecycle path.
- Do not put inline image bytes, base64 payloads, `data:image` URLs, or raw image arrays inside Codex or Claude user messages. Pass processed image paths and metadata so agents read images through tools.

## Close-Wave Diagnostics

When investigating Codex disconnect storms or delayed response delivery:

- Inspect raw recordings, server logs, and session diagnostics for close-wave timing, last incoming/outgoing JSON-RPC methods, pending RPCs, current turn state, and whether browser viewing or herd events only exposed an already-broken session.
- Remember that Codex may emit `skills/changed` with `{}` and no path/cause metadata. Add Takode-side diagnostics for receipt time, payload keys, current turn id, action taken, stale state, and refresh cause.
- Check whether legacy or broken skill symlinks can amplify metadata churn, but keep skill-scope redesign separate unless it is explicitly in scope.

## Scope Discipline

Keep separate failure layers separate:

- Skill-change emission and metadata pickup.
- In-flight generation disruption.
- Post-disconnect retry, diagnosis, and user-turn recovery.
- Browser-open relaunch or passive recovery gating.
- Attachment message shaping.

Do not bundle unrelated recovery fixes into a skill-metadata change without an approved scope. Document residual risk and follow-up ownership when a layer remains intentionally out of scope.

## Verification Checklist

Add focused coverage for the paths touched:

- `skills/changed` marks stale and emits diagnostics without sending automatic `skills/list` / `app/list`.
- Manual refresh clears stale state and refreshes both skills and apps.
- Idle startup/relaunch pickup refreshes metadata with a bounded initialize cause.
- Queued initialization user messages start before startup metadata refresh; metadata refresh skips or defers when a turn becomes active.
- Composer/browser viewing does not passively refresh skills just because a session is viewed.
- Image transport tests prove backend user messages stay path-only and do not carry inline image bytes.
