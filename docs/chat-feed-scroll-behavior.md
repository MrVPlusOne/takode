# Chat Feed Scroll Behavior

This file is the source of truth for Takode chat-feed scrolling behavior.

## Goals

- Keep scroll behavior simple and predictable.
- Preserve the user’s reading position when they scroll away from the bottom.
- Follow new content only when the user is already near the bottom.

## Canonical Behavior

### 1. Sending a user message

Sending a new user message does not trigger any special user-turn pinning,
runway creation, or top-alignment behavior.

The new user message is appended to the conversation like any other message.

After send, the feed behaves according to the normal bottom-follow rule:

- if the user was already near the bottom, keep following the bottom
- if the user was scrolled up, preserve their current reading position

There is no dedicated "scroll the new user message to the top" path.

### 2. Bottom-follow rule

The feed maintains a simple sticky-bottom model:

- when the user is near the bottom, new content should keep the feed near the
  bottom
- when the user is not near the bottom, new content should not force the
  viewport to move

Near-bottom detection and automatic following use the real conversation bottom,
excluding trailing space reserved for overlays and explicit passage navigation.

On desktop, the expanded composer overlays a fixed compact dock. Its measured
overlap adds manual scroll range so the last passage can be read above it;
expanding or collapsing never requests a feed scroll. Retain the greatest measured
overlap while viewing the same destination, including after collapse or draft
shrinkage, so the browser cannot clamp a position reached using that range.
Changing destinations releases that reservation. In-flow touch layouts do not
reserve additional composer space.

### 3. Streaming behavior

During streaming:

- if the user is near the bottom, the feed may keep up with streaming output
  using immediate bottom alignment
- if the user has scrolled up, do not auto-follow continuously

This preserves the previous behavior where streaming does not interrupt manual
reading once the user has moved away from the bottom.

### 4. Jump-to-bottom and latest-indicator behavior

The existing jump-to-bottom button remains the manual way to return to the end
of the conversation.

Clicking it should scroll to the real bottom of the feed so the last rendered
message aligns naturally at the bottom of the viewport.

The feed may also show a passive "New content below" indicator when:

- the user is no longer sticky to the bottom, and
- newer content has appeared below the last real content bottom they had
  already seen, or
- the feed has restored into an older section window that still has newer
  sections below

The latest indicator is only an affordance to jump back to the real bottom. It
must not change the user’s current scroll position by itself.

Switching away from a session and then back again must not resurrect the latest
indicator purely because the browser restored an older saved baseline. On
session restore, the browser should treat the currently restored content bottom
as the new baseline for that viewing pass.

After a restore, the latest indicator should only appear again when:

- genuinely new content arrives after the restore while the user remains away
  from the bottom, or
- the restored section window still has newer hidden sections below

### 5. Session restore

Restore a saved stable message and its offset when possible. A turn-only saved
position can restore by that turn; a missing message must not be substituted
with its turn's beginning. An off-window target is looked up through the server,
and unrelated window updates do not establish that the lookup failed.

If the target's authoritative delivery still cannot restore the anchor, go to
latest. Coordinates alone cannot reliably identify a position in a bounded
window, so an unanchored saved position in that mode also falls back to latest.
The unwindowed feed retains its proportional-coordinate restoration. Valid
older reading positions remain valid regardless of their age. Fresh explicit
navigation takes precedence over restoration and cancels a pending restore.

If the user left at the bottom, restore the real bottom. Latest navigation also
preserves bottom-follow intent while its requested window is loading.

If the user left the session scrolled up, restoring that position must not by
itself imply "new content below". The latest-indicator baseline resets to the
restored content bottom for the new viewing pass.

There is no special anchor-restore path tied to the latest user turn.

### 6. Cold session hydration

When switching to a session whose full history is not yet loaded in the browser:

- the feed should show an explicit `Loading conversation...` state instead of
  the normal empty-conversation UI
- the feed should not look empty and then suddenly populate
- the first authoritative history render should not trigger a visible
  top-to-bottom smooth scroll animation

In practice, this means restore/follow logic should wait until the first
history payload has landed for that session.

## Non-goals

- No send-time auto-scroll to place the newest user turn at the top
- No send-time scroll runway or automatic following of overlay clearance
- No special session-restore anchor model for running turns

## Expected UX outcome

- When you are reading at the bottom, the chat keeps up with new content.
- When you scroll up, your position stays stable.
- Switching sessions restores the old scroll position or bottom state without
  extra send/runway behavior interfering.
- Cold session switches show a loading conversation state instead of a blank
  feed, and history should appear without a disorienting scroll-on-appear.
