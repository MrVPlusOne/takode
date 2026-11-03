# Takode glossary

In Claude Code or the Codex app you talk to one agent and watch it work. In Takode you mostly talk to a **leader**, which turns your requests into **quests**, hands them to **worker** sessions and comes back to you only for decisions and results. Every session is still a real Claude Code or Codex session that you can open and talk to.

## People and roles

- **Session**: one Claude Code or Codex conversation, running on one of your machines.
- **Leader**: a session that runs work instead of doing it: it files quests, starts and briefs workers, checks their results and asks you when something needs your call.
- **Worker**: an ordinary session doing one quest, usually in its own git worktree. The sidebar lists a leader's workers under it.
- **Herd**: a leader's workers. The leader hears when they finish a turn or ask a question, and can message, interrupt or archive them.
- **Scribe**: a helper agent for each leader that works in the background: it names threads, files them under topics and writes the one-line news on Home. It never does the work itself.
- **Session space**: a separate area, such as work and personal, with its own sessions and memory.

## Talking to a leader

- **Home**: where a leader opens. It lists the leader's threads by when you last dealt with them, questions pinned on top, each with a line of news. Type there to start a new thread.
- **Thread**: one conversation with a leader about one subject, addressed as t-1, t-2 and so on. Threads never need closing.
- **Quest thread**: a thread whose request became a quest, so the conversation and the work stay together. Usually one quest per thread.
- **Topic**: a broad area of work. The Scribe files threads and quests under topics; a topic's page in the Library says where the area stands.
- **Answer and commentary**: answers are what the leader writes for you and make a thread unread. Commentary is its working notes, folded into the turn's activity once the leader moves on.
- **Question card**: how a session asks you to decide something, with suggested replies to tap. Its explanation is the message just above it.

## Work

- **Quest**: a durable task, such as q-42: what was asked, who is doing it, the decisions, the commits and a final summary. Questmaster lists them all.
- **Round**: the next piece of work on a reopened quest. The quest keeps one thread, and its rounds read like small quests in a row.
- **Quest Journey**: the phases a quest goes through. Most go Work, then Memory; a User Checkpoint is added while the quest waits for you, and Landing when its change goes through the landing queue.
- **Work**: the phase where the worker investigates, builds, tests and publishes.
- **User Checkpoint**: the quest is waiting for your answer, usually to a design or approval question.
- **Memory**: the last phase: the worker records what future sessions should know and finishes the quest.
- **Work Board**: a leader's list of active and queued quests, with each one's phase, worker and what it waits on. The Board button in the top bar opens it.
- **Worktree**: a separate git checkout and branch for one worker, so parallel changes don't collide.
- **Landing queue**: on a shared branch, waiting changes are tested together and landed, so workers are free as soon as they submit.
- **Memory notes**: Git-tracked Markdown notes that later sessions read before related work. There is no hidden model memory.
- **Lease**: a session's turn on a shared resource such as a dev server or the browser, so agents don't collide. Leases are customizable: ask a leader or worker to add a new kind, such as one for heavy test runs on a machine, to bound how much runs at once.

## What needs you

- **Needs you**: a thread with a question waiting for your answer, shown in amber.
- **Unread**: a thread with an answer or result you haven't read, shown in blue.
- **In progress**: threads where work is running right now, such as a worker on its quest, shown in green.
- **Idle**: threads where nothing is running, finished quests included, shown in grey.
- **Status row**: the row under the top bar for the leader on screen: Home, Idle, In progress, Unread and Needs you. Tap a group to see its threads.
- **Attention list**: the bell in the top bar collects every leader's questions and unread results; Next steps through them.
- **Notify Me**: a quest's menu option to be told when it finishes.
- **Remind me later**: hides a question or result from the attention list until the time you pick.

## Places on screen

- **Sessions panel**: the sidebar. Spaces lists sessions by space, Recent by when you used them, and Threads lists every leader's threads by when you last dealt with them.
- **Side column**: on wide screens, a temporary workspace beside the conversation. Dock a thread you are waiting on, keep working, and its answer or question appears right there.
- **Library**: reports, figures, drafts and topic pages that leaders and workers made.
- **Universal Search**: finds sessions, quests and messages, including everything you wrote.
- **Coordinator and hosts**: the Takode server you open keeps all sessions, quests and memory; other machines run `takode node` to host sessions near their files.

## Common workflows

- **Ask for something new**: type it on a leader's Home. A thread starts, gets a name, and becomes a quest's thread if the leader files one.
- **See what needs you**: open the bell for every leader, or a leader's Needs you group for that leader.
- **Catch up on a leader**: read the news lines on its Home, or switch Home to By topic.
- **Wait without stopping**: move the thread you are waiting on into the side column, keep working, and close it once unblocked; Unread brings it back when it finishes.
- **Steer a quest**: reply in its thread and the leader passes it on to the worker, or open the worker session and talk to it directly.
- **Find something from last week**: the sessions panel's Threads view, a topic page's finished quests, or Universal Search, or just ask a leader to search for you.
