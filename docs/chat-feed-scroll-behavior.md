# Chat Feed Scroll Behavior

This file is the source of truth for Takode chat-feed scrolling behavior.

## Goals

- Keep scroll behavior simple and predictable.
- Preserve the user’s reading position when they scroll away from the bottom.
- Follow new content only when the user is at the bottom.

## Canonical Behavior

### 1. Sending a user message

Sending a new user message does not trigger any special user-turn pinning,
runway creation, or top-alignment behavior.

The new user message is appended to the conversation like any other message.

After send, the feed behaves according to the normal bottom-follow rule:

- if the user was at the bottom, keep following the bottom
- if the user was scrolled up, preserve their current reading position

This holds for every way of sending (the composer, comments and quick replies
to questions), in Main and in leader quest threads. People often send while
scrolled up to comment on what they are reading, so the send must not pull them
away; the Go to bottom button and latest pill show that newer content exists.

There is no dedicated "scroll the new user message to the top" path.

### 2. Bottom-follow rule

The feed maintains a simple sticky-bottom model:

- when the user is at the bottom, new content should keep the feed at the
  bottom
- when the user is anywhere above the bottom, even a few pixels, new content
  should not force the viewport to move

"At the bottom" means the real conversation bottom, excluding trailing space
reserved for overlays and explicit passage navigation. Scrolling up stops
following. Following resumes only when the user scrolls back down to that real
bottom (or uses the jump-to-bottom control); getting close to it is not enough.
Slow scrolls arrive in steps of a few pixels, and content that updates below a
reader every second, such as a waiting worker's live preview in a leader quest
thread, would otherwise pull them back down on every update.

An upward step that still ends at the real bottom does not stop following. The
browser makes such steps itself when content below the viewport shrinks (for
example after Go to bottom replaces an older window with the newest one); treating
them as the reader scrolling up silently turned following off while the view sat
at the bottom.

On desktop, the expanded composer overlays a fixed compact dock. Its measured
overlap adds manual scroll range so the last passage can be read above it;
expanding or collapsing never requests a feed scroll. Retain the greatest measured
overlap while viewing the same destination, including after collapse or draft
shrinkage, so the browser cannot clamp a position reached using that range.
Changing destinations releases that reservation. In-flow touch layouts do not
reserve additional composer space.

### 3. Streaming behavior

During streaming:

- if the user is at the bottom, the feed may keep up with streaming output
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

A conversation (a chat, a leader's tab or a topic conversation) goes back to
where it was left only if it is one of the last three places left in this
browser, or was left less than 30 minutes ago. An older one opens at its latest
messages, as Slack does: see "Opening at the latest" below. Each saved position
records when it was left; positions handed over by another browser carry the
time they were left there. The rest of this section is about places that do go
back to where they were left.

Restore a saved stable message and its offset when possible. A turn-only saved
position can restore by that turn; a missing message must not be substituted
with its turn's beginning. An off-window target is looked up through the server,
and unrelated window updates do not establish that the lookup failed.

If the target's authoritative delivery still cannot restore the anchor, go to
latest. Coordinates alone cannot reliably identify a position in a bounded
window, so an unanchored saved position in that mode also falls back to latest.
The unwindowed feed retains its proportional-coordinate restoration. A valid
reading position of a recent place restores regardless of its age. Fresh explicit
navigation takes precedence over restoration and cancels a pending restore.

If the user left at the bottom, restore the real bottom. Latest navigation also
preserves bottom-follow intent while its requested window is loading.

If the user left the session scrolled up, restoring that position must not by
itself imply "new content below". The latest-indicator baseline resets to the
restored content bottom for the new viewing pass.

There is no special anchor-restore path tied to the latest user turn.

#### Opening at the latest

An older place, or one never shown, opens at its latest messages. When thread
status rows sit under the last message (Thread Waiting or Ready, a waiting
worker's live preview), the view lands just above them, with the last message at
the bottom of the view, and holds that spot while the feed finishes rendering
until the reader scrolls. That is a reading position, so new content does not
pull the view down; without such rows the view is at the real bottom and follows
new content.

When unread answers or reports of the conversation sit above the view, a pill at
the top of the feed says how many ("2 unread"); a tap jumps to the first one,
where the red New line is. Each one leaves the count once it has been read by
being on screen. Clicking a thread's tab follows the same rule even when it has
unread results; Next, notifications and message links still land on their
message.

### 6. Jumping to a message

A jump to a message (the attention chip's Next, notification and message
links, search results) centers the target and then keeps it where it landed
while the feed finishes rendering around it: content that mounts late, such as
a quest thread's description and completion cards or images, must not push the
target away. Browsers with CSS scroll anchoring often do this themselves, but
iOS Safari has none, so the feed corrects the scroll position after each size
change of its content. The target lets go as soon as the user touches or
scrolls the feed, navigates elsewhere, switches thread, or after a few seconds.

### 7. Returning to a recently viewed session

The last three sessions viewed stay mounted but
hidden, so going back to one shows it exactly as it was left: the same scroll
position, open thread and expanded content, with no reload. A hidden session runs
none of its effects (it sits in a hidden React `Activity`), so it does no work
and never counts as being viewed: it marks nothing read and sends no viewing
signal. Only the session on screen does. Older sessions are rebuilt on return and
open as described above: where they were left if recent, else at the latest.

Whether a report or a long user message is expanded is the session's state,
kept on the server: a reload or another browser shows it the same way.

### 8. Cold session hydration

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
