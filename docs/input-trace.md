# Input trace

The input trace helps diagnose input glitches that can't be reproduced on demand, such as a paste or key press that does nothing the first time. It is off by default.

## Turning it on

Settings > Diagnostics > **Input trace**. The setting is saved on the server, so every browser connected to it starts recording. Each page automatically sends new events to that server, which keeps a rolling one-hour window of up to 10,000 events per recording. Saved events survive page reloads and server restarts. Turning the setting off stops new recording; already saved events age out of the available window.

New activity is batched roughly once a second; pastes flush after their handlers finish, and hiding/leaving a page attempts a final upload. Failed uploads retry while that page remains open, and Settings shows failures. Events that have not reached the server can still be lost if the page closes during an outage. This is diagnostic recording, not a guarantee of capturing a browser crash's final event.

The **Report input glitch** button under the toggle is optional: it saves an additional snapshot in the server log for later investigation. You can also give **Report Input Glitch** a key under Settings > Keyboard. There is no sidebar button.

## What it records

- **Key presses:** each keydown, plus the keyup of modifier keys and Cmd/Ctrl shortcuts. Shortcuts are named, such as `Meta+v` or `Enter`. A key that types a character is recorded only as `char` (or `Alt+char`), and an input method's composing state is flagged.
- **Edits and focus:** pointerdown, focusin, focusout, beforeinput, textInput, input, paste, and composition start and end.
- **Window and page:** the window gaining or losing focus (`window-focus`, `window-blur`), and the page being hidden or shown.
- **Takode changes:** the composer expanding or collapsing, pastes inserted by the composer (`composer-paste`, with lengths before and after), and another browser's draft replacing a composer draft (`draft-sync`).

For each event the trace notes the target and focused elements, such as `textarea.composer`, `textarea.side-composer` or `div#composer-input-card`. It also notes the target's text length and selection offsets. For paste it notes the clipboard's types, text length and file count. For keydown, pointerdown, beforeinput and paste it notes whether the default action survived: `default`, `prevented` (a handler cancelled it) or `stopped` (a handler stopped the event before it finished).

The trace never records typed or pasted text.

## Reading a report

Automatic recordings require no manual report:

```bash
takode input-trace                                    # compact list, with time coverage
takode input-trace <trace-prefix> --since 5m --json     # events for one recording
takode input-trace <trace-prefix> --limit 10000 --json  # its retained window
```

Each page/recording has its own identity, so inspect the browser and time coverage to choose it. Events carry increasing sequence numbers, making upload retries idempotent. Recordings live under the coordinator's `~/.companion/input-traces/`, separately from general logs and manual reports. Reads filter the one-hour window; reads and ongoing recording prune expired recordings. The CLI and route return event payloads only when a recording is selected; the default shows summaries.

A manually saved report is one entry in the server log, under the component `input-trace`. It holds the report time, the browser and the events. For example:

```bash
takode logs --component input-trace --json --limit 1
```

The message gives the report time. The glitch usually sits in the last few seconds before it, unless the user reported it later. `meta.events` lists the events oldest first, with `t` in epoch milliseconds. For a lost paste, check these in order:

1. Did a `keydown` with `Meta+v` or `Ctrl+v` reach the page?
2. Did a `paste` follow, and on which target?
3. Did an `input` with `insertFromPaste` follow?
4. Did anything prevent or stop an event?

Window focus changes just before the key press show the user clicked into the browser from another app.
