---
name: takode-mobile-ui-design
description: "Use before designing, redesigning or reviewing Takode UI for phones: layout and placement of bars, tabs, strips and buttons, thumb reach, information density, touch gestures, long-press menus, sheets and popovers, mobile animation, and presenting UI design options for the user to choose."
---

# Takode Mobile UI Design

The user's preferences for Takode on a phone, and the reasons behind them, distilled from many rounds of phone UI work. Apply them when designing or reviewing any phone-facing surface. They are preferences, not a procedure: when a proposal conflicts with one, raise the conflict before building instead of quietly picking a side.

## Who it is for

The user runs Takode on a large iPhone (about 430 pt wide), mostly as the Home Screen app, in **light theme**, often one-handed with the **right thumb**, and often with voice input. Design and judge phone UI under those conditions. Dark theme is still the primary theme for validation, so check both.

## Preferences and why

**Put frequent actions within right-thumb reach; keep identity and context where people look for them.**
- Primary actions sit at the right and toward the bottom. Examples: the composer's send button, needs-input Reply aligned right with send last, and the lower-right feed chip that steps to the next item needing attention. A left-edge Reply was hard to press one-handed.
- Reach is not a reason to move everything. A full bottom-anchored layout was built for real twice (the session bar, thread tabs and quest strip moved under the feed, in mirrored order) and the user kept today's top layout because it looked and felt better.
- Why the flipped layout failed:
  - the session identity turned into a footer;
  - the top-to-bottom order read from specific to general;
  - tab shapes still read as top tabs;
  - the bottom third filled with about six layers.
- Phone apps keep identity at the top and actions at the bottom. If reach comes up again, move only the frequently tapped parts and keep their natural order.

**Keep related context next to the control that changes it.**
- The strip that names the current thread (the Main board summary or the quest strip) sits right next to the thread tabs. After switching tabs the user sees which quest they are on without moving their eyes.
- The selected tab visibly joins the strip it labels.
- Do not separate a control from the information it changes, for example by putting the composer or another bar between them.

**Prefer the smallest change that rearranges existing parts.**
- The user judges every proposal against today's UI and will not switch without confidence that the new version is calmer and clearly better.
- Reuse familiar shapes and components, such as today's tab shapes. New visual languages need a strong reason.
- Mockups that rebuilt the top bar as a Safari pill or a Chrome toolbar were rejected as too much change.

**Calm, not busy.**
- No bold text in tight controls such as tabs and chips; regular weight reads calmer when space is short.
- Never show the same information twice. Examples:
  - a tab repeating the title the quest strip already shows;
  - a preview naming the leader and worker both as links and as buttons.
- Drop what is not essential. Tags were removed from the quest preview.
- Collapse secondary detail by default. Reminder chips start collapsed, and a long run of similar chips (such as related-quest references) belongs behind one expandable chip. Side-by-side buttons that fit on one row should share it instead of stacking.
- Informational indicators must not look unread. The Board button shows phase-colored dots, never a count or badge, because a badge read as something to clear and nagged.

**Make important content readable.**
- Content people open a surface for (a quest's summary, latest phase, the question being asked) gets normal reading size and full contrast. Labels can be small and muted.
- Do not shrink important text to fit; remove or collapse less important things instead.

**Show what the user scans, not identifiers.**
- The user recognizes threads by phase color and by the amber (needs input) or blue (new result) bell, and does not remember quest numbers.
- Numbers belong in search and secondary lines, for finding a quest someone just mentioned.
- Colors must mean the same thing everywhere and in both themes. The Board button's dots must match the board's phase colors exactly.
- Use the theme tokens, which have light and dark values. Raw shades tuned for dark theme turn faint or wrong in the user's light theme.

**Fewer taps for common moves.**
- Do not add a step that adds nothing. A status group holding a single tab should switch straight to it instead of opening a one-item list.
- Shortcuts for repeated workflows are welcome. The user reviews tabs one by one, so the feed chip's long-press offers "close tab and go to next".
- Tapping a quest link in a message on a touch screen opens the preview sheet, with a large button on to the full view, because a full page is heavy for a quick look. Decide by the input of that tap (touch or mouse), not by device type.

**Behave like a native app.**
- **Long-press:** long-press menus use the shared long-press hook and touch-sized menu rows.
- **Back gesture:** the phone's back gesture closes sheets.
- **Gestures:** swipes and pinch work where people expect them (swiping between images, pinch zoom). The app disables browser zoom, so zoomable surfaces bring their own gesture handling.
- Details: `mobile/ios-long-press-menus-and-web-haptics.md` and `mobile/mobile-image-preview-zoom.md` in Takode memory.

**Nothing moves under the finger.**
- Controls the user hits from habit keep fixed positions. The mic and send buttons never shift when Stop appears.
- Avoid layouts that jump when the keyboard opens or closes. Hiding bars while typing made the remaining parts reflow, and they stayed hidden after the iOS keyboard's Done until the next tap.
- Popovers opened from low on the screen open upward.
- Do not put a tappable strip directly against the composer, where a slightly-off tap hits the wrong one.
- iOS also fires a click where the finger lifts after a long-press, so a menu that opens under the finger can choose an item by itself. This was found only on a real iPhone; see the long-press memory note.

**One tap, one outcome.**
- A tap is not just a click. The browser sends the press first (pointerdown, touchstart, then an emulated mouseover and mousedown) and the click last. Whatever reacts to the press or the hover acts on the tap before the control's own click does, and the two can undo each other.
- A tap that opened something must close it when repeated: the user undoes an accidental tap on the same spot. The most common way this breaks is outside-press dismissal: the open surface closes on the press because its trigger lies outside it, then the trigger's click opens it again. Every popover, panel and menu must treat its trigger as inside. Menus opened by a button use `useMenuButton` in `ContextMenu.tsx`; popovers take their trigger as an anchor.
- Triggers toggle. A trigger that can only open leaves the user no way to close the surface from where they tapped.
- Hover cards that also open on tap decide by the input of the press: a tap toggles, a mouse hovers. Ignore the emulated hover a tap sends, or the click closes what the hover just opened.
- A long-press must not also count as a tap; the shared long-press hook already swallows the emulated click.
- Test with the full tap sequence (the `fingerTap` test fixture), not a bare click, which skips the press and hides these bugs. In the browser, drive real CDP touch input, and say that Chromium is not an iPhone.
- Details: `mobile/ios-long-press-menus-and-web-haptics.md` in Takode memory.

**Motion: small, meaningful, once.**
- Delight is welcome when tied to real events and played once. The paw that walks down the feed as answers arrive is the model.
- Never drive animation from scrolling, and never replay it for history.
- Avoid opacity-start entrance animations on scroll-critical surfaces such as the feed and tabs: on phones they can leave content blank or looking duplicated. See `mobile/mobile-scroll-critical-animation-stability.md`.
- Respect reduced motion.

## Presenting design options

- Show options as real implementations in the app, with screenshots of the main states and interactions, side by side with today's UI. Mockups looked better or worse than the real thing, and details such as bold text or a repeated title only showed up once built.
- Use phone size (at least 430x932), light theme first (the user's theme), then dark.
- Show the interactions that matter for the decision: switching, the keyboard opening and closing, sheets and menus.
- Keep alternatives behind a temporary preview switch on the worker branch, and remove the losers before landing.
- Say plainly what was not checked. Chromium is not an iPhone, and several phone-only bugs were found only on the real device.
- Pure mockups are fine for early direction-setting and should be labelled as mockups.
- Memory: `agent-instructions/ui-design-options-as-real-implementations.md`. Validation mechanics: the `takode-ui-e2e-validation` skill.

## Where details live

This skill holds principles. Current designs, their code and their history live in Takode memory, mainly the `mobile/`, `session-ui/` (top bar and panel), `leader-threads/` (thread tabs), `notifications/` (needs-input cards and attention navigation) and `chat-feed/` (previews, reminders, images, paw) folders. Read the matching folder before changing a surface.
