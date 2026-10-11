# Your instructions and skills on every machine

Claude Code and Codex read your personal instructions and skills from the home folder of the machine a session runs on. Without help, each machine has its own copy, and copies drift. Takode keeps them once, on the machine that runs the Takode server, and delivers them to every machine that runs sessions for it.

## Where they live

The store is `~/.companion/user-content/` on the server's machine:

```
instructions/all.md      every session
instructions/claude.md   added after all.md for Claude sessions
instructions/codex.md    added after all.md for Codex sessions
skills/all/<skill>/      every session
skills/claude/<skill>/   Claude sessions only
skills/codex/<skill>/    Codex sessions only
```

Any file may be missing. A skill folder needs a `SKILL.md`. A store entry may be a link to a skill kept elsewhere, such as a skills repository; Takode follows the link and delivers the content. Hidden files are skipped.

Write rules that hold on every machine. A rule that applies to only one machine can say so ("on the laptop, ..."); every Takode session is told which machine it runs on.

## What Takode does with them

On each machine Takode owns these files and folders:

- `~/.claude/CLAUDE.md`: `all.md` followed by `claude.md`.
- `~/.codex/AGENTS.md`: `all.md` followed by `codex.md`.
- In `~/.claude/skills` and `~/.agents/skills`: one link per skill, pointing at the machine's copy in `~/.companion/user-content-installed/`. A backend's own skill replaces a shared skill of the same name.

So plain Claude Code and Codex sessions on that machine read the same content as Takode sessions.

Takode delivers the store to a machine before each session launches there, when a host connects, and within about 30 seconds of a change in the store. A session reads the files when it starts, so a running session picks up a change at its next relaunch.

## Your own files are never replaced silently

- A file or skill entry Takode did not write is left alone and listed in **Settings > Hosts > Your Instructions and Skills** as waiting for approval. **Let Takode manage these** replaces them on that machine.
- A file Takode wrote and you then edited by hand counts as yours again.
- A file that already holds exactly the store's content is treated as Takode's, since replacing it loses nothing.
- Before replacing or removing any file, Takode copies it to `~/.companion/backups/user-content/<time>/` on that machine (a link is kept as a link). It keeps the newest 50 such folders.
- A skill of the same name as one of Takode's own skills (such as `confirm`) is not linked; Takode's skill wins.
- If `~/.codex/AGENTS.override.md` exists, Codex reads it instead of `AGENTS.md`; the status shows a note.

## First use

Until the store exists, Takode touches nothing. Settings offers a one-time **Import from <machine>** for each connected machine. It copies that machine's `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` and skills (except Takode's own) into the empty store: one `all.md` when both files hold the same text, otherwise `claude.md` and `codex.md`; a skill found for both backends with the same content goes to `skills/all`. Takode then manages that machine's files, backing up what it replaces. Other machines keep their own files until you approve each one.

The same actions are available to agents acting on your approval: `GET /api/user-content`, `POST /api/user-content/import` and `POST /api/user-content/take-over` with `{"hostId": "<host id>"}` (or `null` for the server's machine).

Moving the server to another machine ([Moving the coordinator](moving-the-coordinator.md)) carries the store along.
