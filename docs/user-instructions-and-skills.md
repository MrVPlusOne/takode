# Your instructions and skills on every machine

Claude Code and Codex read your personal instructions and skills from the home folder of the machine a session runs on. Without help, each machine has its own copy, and the copies drift. Takode can keep them once, on the machine that runs the Takode server (the coordinator), and give every machine that runs sessions for it the same copy.

## Where they live

Two folders on the coordinator make up the **store**:

```
~/.companion/user-instructions/all.md      every session
~/.companion/user-instructions/claude.md   added after all.md for Claude sessions
~/.companion/user-instructions/codex.md    added after all.md for Codex sessions
~/.companion/user-skills/all/<skill>/      every session
~/.companion/user-skills/claude/<skill>/   Claude sessions only
~/.companion/user-skills/codex/<skill>/    Codex sessions only
```

Any file may be missing, and a skill folder needs a `SKILL.md`. Hidden files are skipped.

Either folder, or any entry in it, may be a link. The recommended setup keeps the content in a private Git repository, with both store folders linking into one checkout of it on the coordinator:

```
~/.companion/user-instructions -> ~/Code/<your-repo>/user-instructions
~/.companion/user-skills       -> ~/Code/<your-repo>/user-skills
```

Takode follows the links, and notices changes made through them, such as an edit or a `git pull` in the checkout.

Write rules that hold on every machine. A rule that applies to only one machine can say so ("on the laptop, ..."); every Takode session is told which machine it runs on.

## What Takode does with them

On each machine, Takode owns:

- `~/.claude/CLAUDE.md`: `all.md` followed by `claude.md`;
- `~/.codex/AGENTS.md`: `all.md` followed by `codex.md`;
- in `~/.claude/skills` and `~/.agents/skills`, one link per skill, pointing at that machine's copy in `~/.companion/user-content-installed/`. A backend's own skill replaces a shared skill of the same name.

Plain Claude Code and Codex sessions on that machine therefore read the same content as Takode sessions.

Takode updates a machine before each session launches there, when a host connects, and within about 30 seconds of a change to the store. A session reads the files when it starts, so a running session picks up a change at its next relaunch.

## Your own files are never replaced silently

- **A different file or skill that Takode did not write is left alone.** It appears in **Settings → Hosts → Your Instructions and Skills** under its machine as waiting for approval, with the reason: "differs from the store", "edited by hand after Takode wrote it" (a file Takode wrote that someone then changed), or "a link to …". **Let Takode manage these**, then its confirmation, replaces them on that machine.
- **Something identical to the store's copy needs no approval**, because replacing it loses nothing. Examples: a skill folder with exactly the store's files, or `AGENTS.md` linking to a `CLAUDE.md` that already holds the store's text. Takode replaces it and keeps a backup.
- **Backups:** before replacing or removing anything, Takode moves or copies it to `~/.companion/backups/user-content/<time>/` on that machine. A link is kept as a link. The newest 50 such folders are kept. Settings shows each machine's latest backup folder.
- **Takode's own skills win.** A skill with the same name as one of Takode's own (such as `confirm`) is not linked; Takode's skill is used.
- If `~/.codex/AGENTS.override.md` exists, Codex reads it instead of `AGENTS.md`, and the status shows a note.

## First use after upgrading

Until a store folder exists, Takode touches nothing. If some machine has user-level instructions or skills, the app shows a one-time notice with **Set up** and **Dismiss**. Dismissing hides it for every browser.

**Settings → Hosts → Your Instructions and Skills** then lists each connected machine with what an import from it would bring in, for example "rules 12 KB (one file for Claude and Codex); 8 skills: …". **Import from here**, then its confirmation:

1. copies that machine's `CLAUDE.md`, `AGENTS.md` and skills (except Takode's own) into the empty store: one `all.md` when both files hold the same text, otherwise `claude.md` and `codex.md`; a skill found for both backends with the same content goes to `user-skills/all`;
2. lets Takode manage that machine's files, backing up what it replaces.

Other machines get any file or skill they lack straight away. Their identical items are replaced without asking, and anything different waits for approval there.

You can also fill the store yourself, for example by linking it into a checkout, instead of importing.

## Undo and switching off

- **Restore a backup** by copying it back. Takode then sees a file it did not write and leaves it alone.
- **Switch the feature off** by removing or renaming both store folders. Takode then stops touching anything and leaves the files it last wrote in place.
- **An empty store is different.** If the store exists but is empty, Takode removes the files it wrote, after backing them up.

## For agents

Agents act through the same steps, on the user's approval:

| Action | Route |
|---|---|
| Status, including import previews | `GET /api/user-content` |
| Import from a machine | `POST /api/user-content/import` |
| Take over a machine's files | `POST /api/user-content/take-over` |

The two POST routes take `{"hostId": "<host id>"}`, or `null` for the coordinator's machine.

Before moving the coordinator or adding a host, follow [Moving the coordinator](moving-the-coordinator.md#your-instructions-and-skills).

A coordinator move carries the store along. A store folder that is a link moves as the same link, so the checkout it points to must exist on the new machine.
