# Chat Feed Scroll Behavior

This file is the source of truth for Takode chat-feed scrolling behavior.

## Goals

- Keep send-time scrolling simple and predictable.
- Avoid continuous auto-follow during assistant streaming.
- Preserve manual navigation controls for following the latest content.

## Canonical Behavior

### 1. Sending a user message

When a new user message is added to the feed, the feed should first render that
message in place in the conversation.

After the message is rendered, the feed should move in two stages:

1. jump immediately to the real content bottom region for that new turn
2. then do only a short local alignment toward the stable user-anchored target

In practice, that means:

- jump immediately into the newest-turn region without animation
- only animate the short final alignment toward the stable target
- do not rely on one long smooth-scroll across old content
- do not separately pin the user turn with `scrollIntoView`

### 2. Scroll runway

The feed includes extra scroll runway only when it is needed to align the
newest user turn near the top while the turn is still active.

The runway is always measured relative to the newest user turn, but it is
capped by the real content bottom.

The practical rule is:

- find the newest user message in the visible feed
- compute the stable user-anchored target that would place that turn at the top
  of the viewport
- allow extra runway only when the real content bottom is above that target
- treat active top-level streaming as runway-eligible even if the `running`
  status update arrives slightly later
- once the response is complete, do not leave more blank space than needed

Another way to say it:

- the maximum readable extent should be the smaller of:
  - one viewport below the newest user turn
  - the real end of the assistant/system content

The runway may still shrink as real assistant content grows below the newest
user message, but it must not shrink in a way that clamps the current scroll
position upward while the user is already inside that extra scroll region.

Implementation note:

- the feed may temporarily keep a little more spacer than the stable target in
  order to avoid an upward clamp/jump
- that temporary anti-clamp spacer is not part of the canonical scroll target
- programmatic scrolling should target the stable user-anchored position, not
  the temporarily inflated maximum scroll height

### 3. Running Turn

While the session is running:

- do not continuously auto-scroll the viewport
- do not keep forcing the viewport downward as new text arrives
- let the user read the generated text in a stable position after the one-time
  send scroll

When assistant text is streaming, the same rule still applies: no continuous
auto-follow after the one-time send scroll.

If the user wants to follow the latest content live, they must do so manually.

### 4. Jump-to-latest behavior

The existing jump-to-bottom/latest control remains the manual way to follow new
content.

That control should scroll to the real content bottom, not the persistent
user-anchored runway target.

In practice, that means:

- align the last rendered message with the bottom of the viewport
- ignore the extra user-anchored runway when the user explicitly asks to go to
  bottom

### 4.1. New-content indicator

When the user is no longer at the bottom and new content arrives below the
current viewport, the feed should show a bottom-docked "latest" pill as the
primary affordance.

The practical rule is:

- do not show the pill just because the user scrolled up
- do not show it just because there was already older hidden content below
- show it only after the real content bottom grows beyond the last bottom the
  user had already seen while they are away from bottom
- render it in the bottom status rail above the composer so it shares space with
  running-state text instead of stacking a second overlay over the feed
- clicking it should use the same real-content-bottom behavior as the manual
  go-to-bottom control

The right-side scroll buttons remain available as secondary navigation controls.

### 5. Session restore

Saved scroll position restore should keep working as before:

- if the user left the session scrolled up, restore that position
- if the user left the session at the bottom, restore to the current stable
  allowed position for the newest user turn
- restoring "at bottom" should target the stable position, not any temporary
  anti-clamp spacer

Restore should preserve the viewport-relative placement of the saved visible
turn anchor when that anchor is still available. If the saved anchor cannot be
restored reliably, prefer the end of the conversation over dropping the user
near the beginning. Restore should wait until the session feed has actual
content before applying.

## Non-goals

- No continuous streaming auto-follow
- No new separate "follow mode"
- No extra decorative top padding above the newest user message

## Expected UX outcome

After send:

1. the newest user message appears in the conversation
2. the feed jumps into the newest-turn region
3. the feed then performs only a short final alignment toward the stable target
4. assistant output grows afterward without pushing the viewport
5. the jump-to-latest control remains available for manual follow
