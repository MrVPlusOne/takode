# Takode Changelog

## November 2026: threads, topics and the Scribe

Every conversation with a leader is now a thread. A leader opens on Home, which lists its threads with a line of news each and pins anything waiting for you on top; the sessions panel's Threads view does the same across all your leaders, and the side column is a temporary workspace where you dock a thread you are waiting on while you keep working elsewhere. Each leader's Scribe, an agent working in the background, names new threads and files them under a few broad topics. The [release note](docs/release-notes/threads-and-topics.md) explains the idea, common workflows and why it works this way, and the dated entries below list each change.

## October 2026 release: one Takode across your machines

Until this release, every Takode session ran on the machine that hosted the Takode server. That works until the code you care about lives somewhere else: a cloud workspace, a GPU box, a second computer under your desk. The headline of this release is that one Takode now spans all of them. The server becomes the **coordinator**, which keeps your sessions, quests, work boards and memory in one place, and any machine you register as a **host** can run sessions for it. You keep one browser tab and one session list, and your leaders can start workers wherever the code and the hardware are.

Adding a machine takes two steps: register it with `takode host add` or in Settings → Hosts, then run `takode node` on it. The node dials out to the coordinator, so the host needs no open inbound ports. It signs in with its own token and keeps its own Claude Code and Codex logins. Everything that touches files runs where the files are: Git status, diffs, file previews, worktrees and terminals for a session all run on its machine. The new-session dialog has a machine picker that browses that machine's folders and branches, every remote session carries a chip naming its machine, and a leader can place a worker on a particular machine with `takode spawn --host`. Agents on a host use quests, memory and the Takode commands just as they do locally. All of their reads and writes go through the coordinator, so your data never splits into diverging copies. The [remote hosts guide](docs/remote-hosts.md) walks through the setup, including tunnels and shared machines.

Working across machines also made sessions sturdier everywhere. Sessions now keep running while you restart the Takode server, both on hosts and on the coordinator's own machine, and the restarted server picks them up where they were, pending permission requests included. Restart Server first brings the server's checkout up to date with the branch it tracks, and hosts started with `--auto-update` follow the coordinator onto the new build. When a turn loses its connection to the model API, it now pauses and continues on its own once the network is back instead of failing. If you outgrow a machine, you can move the whole coordinator to another one; the [coordinator move guide](docs/moving-the-coordinator.md) covers rehearsal, cutover and rollback. For reaching Takode from other machines, an optional browser login password guards the app, and a separate token-only host port keeps a tunnel on a shared machine from exposing your server.

The rest of the release is about spending less effort keeping up with your agents. Unsent drafts, including composer text, attached images, comments and half-answered questions, are kept by the server and follow you between your laptop and your phone. An attention list in the top bar gathers every question, Notify Me result and unread result across your sessions, and Next steps through them in priority order. Leader threads show a live preview of the worker they are waiting on, open with a card describing the quest and close with its final summary, and a Board button opens the work board from any thread. Agent activity between messages collapses into compact cards with a one-line summary, and a needs-input question now arrives as an ordinary explanation followed by a short question card, which you can snooze until later. Phone alerts can also go through Web Push, alongside Pushover.

Under the hood, Claude sessions now run only through the Claude Agent SDK, with Claude's native Auto permission mode, a reasoning effort picker and the model list Claude Code itself reports. Teams that share a branch can turn on a landing queue that tests waiting changes together and lands them, so workers are free as soon as they submit. Switching sessions over a slow connection is much faster thanks to compressed traffic and a reused connection. The dated entries below list every notable change.

## [0.47.0](https://github.com/MrVPlusOne/takode/compare/the-companion-v0.46.0...the-companion-v0.47.0) (2026-11-13)


### Features

* **appearance:** a bigger Tako in the app icon, and warm moonlight on the night one ([d712707](https://github.com/MrVPlusOne/takode/commit/d712707eaf6bcd03ce436e0e97170580ec2b865c))
* **appearance:** a glowing vermilion caret and a forged caret in the Typing Feel demo ([8f2f534](https://github.com/MrVPlusOne/takode/commit/8f2f53485792981114952541c4770a975d8daa2b))
* **appearance:** a new app icon in the Ink & Paper style, with a night version for the dark theme ([2b275f1](https://github.com/MrVPlusOne/takode/commit/2b275f1f3bf52fd7c9db9774418621017566445f))
* **appearance:** a sea of clouds drifting through the Ink & Paper valleys ([1b59c7f](https://github.com/MrVPlusOne/takode/commit/1b59c7ff1eb76eec3eae80c95e55fc136b900d34))
* **appearance:** bring Ink & Paper to life ([f94fe27](https://github.com/MrVPlusOne/takode/commit/f94fe271874af3188f1fc7cfe5a3045cdee3098d))
* **appearance:** each message on its own sheet over the scenic painting ([476930f](https://github.com/MrVPlusOne/takode/commit/476930faa58cd7d5e45b53ad9f87797611b3f9dc))
* **appearance:** Ink & Paper celebrates a finished quest with ink fireworks and a seal ([ae44de3](https://github.com/MrVPlusOne/takode/commit/ae44de3bc34a4c09d452feeb87dc014f95219265))
* **appearance:** Ink & Paper is the colour version; a crisp edge on the paper sheet ([77748bf](https://github.com/MrVPlusOne/takode/commit/77748bf53d0905247ab530ab2423612e8c3bbb16))
* **appearance:** living water, swaying pines and an Ink & Colour choice ([b1601c7](https://github.com/MrVPlusOne/takode/commit/b1601c743e4feb293305dfb4874b2d889ff744a7))
* **appearance:** new answers arrive like ink, and a Playground demo of typing feels ([29acc72](https://github.com/MrVPlusOne/takode/commit/29acc720a5ff73feb2acfc1b097dfc31f0e5752d))
* **appearance:** paper and silk textures for the Ink & Paper UI ([05313d2](https://github.com/MrVPlusOne/takode/commit/05313d26a4cba8f340680992d4d2180221d72cc7))
* **appearance:** scenic background styles ([2b85df7](https://github.com/MrVPlusOne/takode/commit/2b85df77d59126a6f791d7af4d9c0fac0e14328c))
* **appearance:** the Typing Feel demo tries caret styles that add no typing latency ([3aa839f](https://github.com/MrVPlusOne/takode/commit/3aa839f5b85b5082a95d3c8bbd78a9aca5ee692e))
* **appearance:** visible living ink, no mouse parallax, paper column ([ca4385b](https://github.com/MrVPlusOne/takode/commit/ca4385bcceca5f88287d7fab73c6fb10d9c720f4))
* **attention:** a new question rings its bell and new answers pop their count, in the side column, Threads view and top bar ([3c0e00c](https://github.com/MrVPlusOne/takode/commit/3c0e00c60e8f03256b107478f12c49ee467ae529))
* **attention:** leaders can mark an answer urgent ([12f9c44](https://github.com/MrVPlusOne/takode/commit/12f9c44fe8d8288fb1fa1aa8cfd54f759b20261a))
* **attention:** one amber signal per scope in a desktop leader's top bar ([08f2a18](https://github.com/MrVPlusOne/takode/commit/08f2a1878e77ca8351324ac35e0d7b360a1def4e))
* **attention:** separate in-session and cross-session next shortcuts, drop the landing banner ([7daa3bb](https://github.com/MrVPlusOne/takode/commit/7daa3bb18caa721c1c4a540f128d1e8b01a0b189))
* **attention:** the Needs attention list names threads, not topics ([04a8d79](https://github.com/MrVPlusOne/takode/commit/04a8d79dd1f5857e05b625b3dd295f82625d88b2))
* **attention:** the Next chip's list reads like the top bar's, opens in the feed; tabs no longer close with the breadcrumb ([8c08f48](https://github.com/MrVPlusOne/takode/commit/8c08f48f8819a7e814f60f4d3bf3ff2d6bbfc811))
* **attention:** topic-first tab bar, unread per message, reminders on items ([580bb84](https://github.com/MrVPlusOne/takode/commit/580bb84cd760d4826b6ec1cb98192367ed4dad1f))
* **backup:** back up the coordinator's data to a Git repository and/or a machine copy ([9ca50f9](https://github.com/MrVPlusOne/takode/commit/9ca50f9d39660b210869832ae5b0411df6ca5658))
* **breadcrumb:** label a topic's own conversation "Whole topic", quieter than a quest ([40cc120](https://github.com/MrVPlusOne/takode/commit/40cc120adcc8c321d212c72fc16c67565f6640c4))
* **chat-focus:** scrolling a chat focuses it ([692b088](https://github.com/MrVPlusOne/takode/commit/692b08872de5e12d53c59846cbb63626ff1444f9))
* **chat:** one focused chat at a time among the main view and side panes ([9bf4025](https://github.com/MrVPlusOne/takode/commit/9bf40253d695cf58b7606e7f7da5a386c811e66b))
* **cli:** read messages as exact text or Markdown quotes with takode read --raw/--quote ([6847871](https://github.com/MrVPlusOne/takode/commit/6847871c4fa5cb9967ebf643b91b7a30b473c4c4))
* **code:** highlight Lean 4 and Rocq/Coq code blocks ([f936402](https://github.com/MrVPlusOne/takode/commit/f9364025b33236c821aa0caa004716635d609973))
* **composer:** a send pressed while images upload waits for them instead of being refused ([0021902](https://github.com/MrVPlusOne/takode/commit/00219027cf0c143be86370b509472b606d0f76f1))
* **composer:** cancel a recording from the button row, and undo/redo for drafts on phones ([dabf721](https://github.com/MrVPlusOne/takode/commit/dabf72165774bebc9789736bd098b260814b67e9))
* **composer:** the collapsed composer sits a little higher on phones ([2196e6e](https://github.com/MrVPlusOne/takode/commit/2196e6eff5b8fa1d4e9e0ce480add8a88ee9499b))
* **composer:** type anywhere to open the composer ([fae4921](https://github.com/MrVPlusOne/takode/commit/fae4921c579f5928b2e3c0b9b996bff9ac894dc4))
* **copilot:** offer Fable 5.2 to Claude sessions when Copilot serves it ([8ff238c](https://github.com/MrVPlusOne/takode/commit/8ff238c6b9edd190a4a1ffc7c82eb92a368e9dc5))
* **copy:** underline in drafts, and Slack copies in Slack's own clipboard format ([db73997](https://github.com/MrVPlusOne/takode/commit/db7399757a3d74cc8a9600065c8d420f69c44ae9))
* **diagnostics:** opt-in input trace for reporting input glitches ([b967804](https://github.com/MrVPlusOne/takode/commit/b967804a5f78508c01dca7fd4568d58d44a5971b))
* **downloads:** Download and Export sit together in one menu for files and artifacts ([7d95ac9](https://github.com/MrVPlusOne/takode/commit/7d95ac99b8c1229cb256f005f2c2dab857503475))
* **drafts:** share a worker's draft into a thread as its Library card ([1807be5](https://github.com/MrVPlusOne/takode/commit/1807be5669564aa58ac7616c2994256a7fc02add))
* **exec:** --memory-limit kills a command whose processes use too much memory ([34b5b7c](https://github.com/MrVPlusOne/takode/commit/34b5b7c844a59f96b174fb2da4f8896f21f704bc))
* **exec:** sessions run commands on any machine with takode exec ([4cf685f](https://github.com/MrVPlusOne/takode/commit/4cf685fba7daf94d19eea5a8062522934983c12a))
* **feed:** a leader's desktop Next chip sits right after the thread tabs ([3d9b4d7](https://github.com/MrVPlusOne/takode/commit/3d9b4d7ea2c8e32c72777eef86e3e1cf04473cd5))
* **feed:** day pill only while scrolling; shorter collapsed composer ([b0a8351](https://github.com/MrVPlusOne/takode/commit/b0a83513a5584e0f4d0d0749f76bb1d0aeb3aabd))
* **feed:** desktop navigation buttons fade after scrolling stops ([2cc18c3](https://github.com/MrVPlusOne/takode/commit/2cc18c3b65c7ed0eab298bf892dd21f171ca3013))
* **feed:** fold a leader turn's activity before its newest final message ([0942634](https://github.com/MrVPlusOne/takode/commit/0942634e9efc7145fe1aba4193d13e75fa5a58b0))
* **feed:** keep expanded reports and long messages on the server, the same in every browser ([b292683](https://github.com/MrVPlusOne/takode/commit/b292683d997653c97929f83c70585ef79d82a709))
* **feed:** keep the last few chats viewed mounted but hidden, so going back is instant and exact ([18c4753](https://github.com/MrVPlusOne/takode/commit/18c4753812dab0356094afb39e44f90310ab3e3f))
* **feed:** message times at the start of each message ([6e09626](https://github.com/MrVPlusOne/takode/commit/6e096264f8cab01e3d7ef39c7f8556476c46c811))
* **feed:** message times say how old they are ([18afab8](https://github.com/MrVPlusOne/takode/commit/18afab8daa26e99ec73a551373fd3262019b61fb))
* **feed:** message times share a line with the answer tag and the user bubble ([62a33f0](https://github.com/MrVPlusOne/takode/commit/62a33f0c26c3e5f328bce1ccd4e957b6fb5b7f6b))
* **feed:** no New marker on a reply watched as it arrives ([07745fa](https://github.com/MrVPlusOne/takode/commit/07745fa7ec14ec02980da2d3e924cb99088a248a))
* **feed:** older chats open at the latest with the unread counted above ([06ba735](https://github.com/MrVPlusOne/takode/commit/06ba735e43b5c967669fc15a20dd3b676047fa32))
* **feed:** open reports, posts and visuals full screen from their card ([2601526](https://github.com/MrVPlusOne/takode/commit/2601526adc99488fef0b4a1ca586cc8c564fdfdd))
* **feed:** opening a topic follows the opening rule too ([50d46c8](https://github.com/MrVPlusOne/takode/commit/50d46c8186a845ef2ad95dddf9e05e254747db95))
* **feed:** quest link text hover shows the full preview, the thread icon only its title ([b9d5ac8](https://github.com/MrVPlusOne/takode/commit/b9d5ac8767357f43e9d7eee4d369b3bb23e8490f))
* **feed:** show other leaders' messages as a light collapsed line in a leader's feed ([be871fe](https://github.com/MrVPlusOne/takode/commit/be871fe2bb1bee578ea8fcabcc7b0a02e5bf7aa3))
* **feed:** the unread mark is a short bar beside the answer's first line ([1a6583d](https://github.com/MrVPlusOne/takode/commit/1a6583dbd1e3011543699b478b749e121d0f19a1))
* **feed:** unread answers get a dot in the left margin that turns into a read ring ([a8fd353](https://github.com/MrVPlusOne/takode/commit/a8fd35306391d3e406e2e2c050582e5412fbcb53))
* **file-viewer:** Download saves a viewed or linked file to the browser's device ([9739896](https://github.com/MrVPlusOne/takode/commit/97398965f3a7b598d30e137b4f4fa4e0276a00b8))
* **files:** open file links in Takode's viewer, with Open in VS Code over Remote-SSH ([7791637](https://github.com/MrVPlusOne/takode/commit/77916373bdcbdbaefc7a545767553c2ce329c15b))
* **glossary:** "Takode at a glance" glossary page ([c4d011b](https://github.com/MrVPlusOne/takode/commit/c4d011bfc609fc91c27c0066e87da30fe0ea945b))
* **guided-review:** each stop's code shows the code around it ([758c372](https://github.com/MrVPlusOne/takode/commit/758c372c985f1f9b5aa4139c563c81a7cb9ec8af))
* **guided-review:** label new, deleted and renamed files ([cce9368](https://github.com/MrVPlusOne/takode/commit/cce9368d5f02b8d8c1843c9a382604e468b204ab))
* **guided-review:** say when a stop's surrounding code can't load, with Retry ([d02c9e6](https://github.com/MrVPlusOne/takode/commit/d02c9e61e8bb4170bf1e1c3713f2aba3695e7bb5))
* **guided-review:** the code around each stop comes from git when viewed ([2f9649e](https://github.com/MrVPlusOne/takode/commit/2f9649e8bda37bdcd28dad8e81494362d3876f8f))
* **guided-review:** the walkthrough shows the code on the left and the explanation on the right, next to Back and Next ([5e5c979](https://github.com/MrVPlusOne/takode/commit/5e5c97975933bd81c22da9c9077e19a970f02434))
* **home:** a leader's Home shows its Next chip at the lower right, as a conversation does ([1b6fc41](https://github.com/MrVPlusOne/takode/commit/1b6fc4178850be6f6c6e1cd90a150347ee283220))
* **home:** a line of news per thread, what changed since you looked, Idle by topic ([f8d210f](https://github.com/MrVPlusOne/takode/commit/f8d210f0e8d8d069282e38f5f7b74841f377126d))
* **home:** Home lists the leader's threads once, by your last interaction ([0d9f8b7](https://github.com/MrVPlusOne/takode/commit/0d9f8b7fd3b7c7e502734968a04e9690f5ce0f09))
* **home:** rows in two lines like the Threads view, and a wider Home when there is room ([350ec33](https://github.com/MrVPlusOne/takode/commit/350ec332dcdf6c7b4245007c72e2d838bb8e5d74))
* **home:** rows of even height with a one-line news line ([a6e5ce5](https://github.com/MrVPlusOne/takode/commit/a6e5ce58b0c1bbe0d89a4067d86214fd3db5579c))
* **hosts:** keep-alive limit and keep-awake are per machine ([02afc7c](https://github.com/MrVPlusOne/takode/commit/02afc7cc4c36872e8d5a980bfd43504dccbf3a09))
* **hosts:** memory guard for runaway jobs and per-machine agent notes ([84c11b5](https://github.com/MrVPlusOne/takode/commit/84c11b5894a1fd0eeb97e458944f2289799e941a))
* **hosts:** restart this machine's node only when its own code changed ([31bf40a](https://github.com/MrVPlusOne/takode/commit/31bf40a823cc41a8e32d81cab8df395dd4e5cf0e))
* **hosts:** takode node follows the coordinator's build by default ([3ca4526](https://github.com/MrVPlusOne/takode/commit/3ca4526c81f2c715112abd4e96a9326188163740))
* **image-viewer:** Copy image puts the image itself on the clipboard ([8b1a358](https://github.com/MrVPlusOne/takode/commit/8b1a358efb5ef5b0532b4679276721e8caca5d91))
* **images:** show image size and a loading state in the image viewer ([28e3d03](https://github.com/MrVPlusOne/takode/commit/28e3d03aac488319407db67e48cca63563537c67))
* **instructions:** agents title every draft so revisions group in the Library ([37cc167](https://github.com/MrVPlusOne/takode/commit/37cc167a1562d20001d9f094d9cabebd31a6f67e))
* **layout:** drag the edge of the secondary view to resize it, kept as a share of the window ([9ecac59](https://github.com/MrVPlusOne/takode/commit/9ecac59d2888d2771e927cc4fc1fa867afc5c459))
* **leader-header:** desktop leaders with topics keep their tabs in the top bar ([22425e9](https://github.com/MrVPlusOne/takode/commit/22425e9084e5c9d93e595edc83f6e522ce1f8f6f))
* **leader-nav:** a leader overview in the side column and the top bar, ordered by its Scribe ([c7584a4](https://github.com/MrVPlusOne/takode/commit/c7584a49ec8de021be20b5a988e32c376d5d64c0))
* **leader-nav:** artifacts in the side column, a Settings key for it, synced side drafts ([c366e27](https://github.com/MrVPlusOne/takode/commit/c366e27abe22eb5f37cc6d5c1eee9321ffc1b0ad))
* **leader-nav:** breadcrumb pickers without down arrows ([ca4878f](https://github.com/MrVPlusOne/takode/commit/ca4878f2962c63b8c417ddb959f436ac8b0cbb62))
* **leader-nav:** breadcrumb, side column and side chats for topic leaders ([443cd57](https://github.com/MrVPlusOne/takode/commit/443cd576381ad8c48dd1b8b9afd96bc73dac3b7b))
* **leader-nav:** roomier breadcrumb band on phones ([2987795](https://github.com/MrVPlusOne/takode/commit/2987795a551e7bf7cc524cd51155213aff66c021))
* **leader-nav:** the place picker's "Not in a topic" lists every such quest of the leader ([2262c7b](https://github.com/MrVPlusOne/takode/commit/2262c7b01342d9c7d88dde9c59c7399cb6b63baf))
* **leader-nav:** tighter breadcrumb band ([495fba1](https://github.com/MrVPlusOne/takode/commit/495fba173758bfdc1e797fd94481423f0d74dfce))
* **leaders:** questions and answers stay out of Main ([d719187](https://github.com/MrVPlusOne/takode/commit/d719187b38218488588670dbc9631cb17d6cadca))
* **leaders:** Scribe names new threads, quests hand off with --handoff, landing notices carry commit links ([5a3be06](https://github.com/MrVPlusOne/takode/commit/5a3be06023359909ab081ec4b55066ec49419c68))
* **leases:** print slot wait lines every 10 minutes ([e6c7b24](https://github.com/MrVPlusOne/takode/commit/e6c7b24013260f178cb6db212b1c642d120812c7))
* **leases:** shared compute budgets with a slot per running command ([0df4438](https://github.com/MrVPlusOne/takode/commit/0df443812d42bb0dec287089815508d63e2888f5))
* **leases:** warn on nested pool slots and show long slot waits ([820aaa6](https://github.com/MrVPlusOne/takode/commit/820aaa604797e7523df22aabda3543796acf4082))
* **library:** a post with replies is one card, with files per part and part-level revisions ([c4258b7](https://github.com/MrVPlusOne/takode/commit/c4258b7fb5417b0bc4caa0d8d1f96cc341c1f4e1))
* **library:** a quest's topic replaces its tags in the quest views ([4046bde](https://github.com/MrVPlusOne/takode/commit/4046bde7510c888dda0ca94ce96bbc347c010ccc))
* **library:** a Scribe per leader keeps topic pages, as a quiet worker in its herd ([e3cb814](https://github.com/MrVPlusOne/takode/commit/e3cb814415b467fe151ced3a9c1e4cc48d496c77))
* **library:** a side chat about an artifact in its own views ([8687d3c](https://github.com/MrVPlusOne/takode/commit/8687d3c941094244e3bc2d74788d222534fa53d5))
* **library:** a topic's waiting on you is its open questions; Scribe items become Follow-ups ([35473b0](https://github.com/MrVPlusOne/takode/commit/35473b04ffee4631bed6faa6de3d4abf6bf16171))
* **library:** a Topics tab group beside Main ([2d097ca](https://github.com/MrVPlusOne/takode/commit/2d097caaae686b7dabf52500b568adf57616f35c))
* **library:** a View topic tab button and a quest picker on topic pages ([1e74eb6](https://github.com/MrVPlusOne/takode/commit/1e74eb627e3e4d745c035aad00078b415cdf4235))
* **library:** artifact gallery, topic panel beside the conversation, artifact links ([dc3f535](https://github.com/MrVPlusOne/takode/commit/dc3f53509239221ac44574028ad924d4ef6baf8a))
* **library:** dim a draft's Copy button once it was copied, remembered on the server ([71d5acf](https://github.com/MrVPlusOne/takode/commit/71d5acf3b1a463c50f96e058c0d032eee20a67a7))
* **library:** drafts link where they are to be posted ([b7a1609](https://github.com/MrVPlusOne/takode/commit/b7a1609f36e3d1de837a8f40b7eccf64ac6db2df))
* **library:** Find folds into Search everything ([415e176](https://github.com/MrVPlusOne/takode/commit/415e1761bb96ea3f229b42a66f914ca38708492e))
* **library:** fold topic page sections, list all a topic's quests, and link the quest in topic conversation strips ([6a5d4e5](https://github.com/MrVPlusOne/takode/commit/6a5d4e5e24b9d7d001a431b69af391016ea276b5))
* **library:** Main's topic list shows what moved, newest activity first ([b3d3be4](https://github.com/MrVPlusOne/takode/commit/b3d3be4ee8e30369709172b849f1ab9b22ffcad8))
* **library:** name a quest's topic above its strip, at the start of its conversation and on its page ([930f2c0](https://github.com/MrVPlusOne/takode/commit/930f2c0ed2cf1ba146bf61385db2144637f4ee0f))
* **library:** Now as entries that Scribes add and remove, per leader ([580c5ac](https://github.com/MrVPlusOne/takode/commit/580c5acb826b9ce311e92321434fbb863a8e380e))
* **library:** open an artifact in a window of its own, with Cmd/Ctrl-click ([04bc6da](https://github.com/MrVPlusOne/takode/commit/04bc6da5474fde8e09b84d8f56d189af13dd8736))
* **library:** publish PowerPoint decks to the Library from any machine ([1487394](https://github.com/MrVPlusOne/takode/commit/14873948755e38c989a5b18147983c4a01e0c1ae))
* **library:** quest tabs zoom out to their topic and back, keeping the reader's place ([4ece3ad](https://github.com/MrVPlusOne/takode/commit/4ece3ad084881471a1fe3ab67234c5a3a6fef79e))
* **library:** quest views name the quest's topic, opening its conversation where the quest was last discussed ([5683dc9](https://github.com/MrVPlusOne/takode/commit/5683dc9937464044e83ef2c8b9fcbf2163cdfb70))
* **library:** report cards open full screen, with Library, copy and export in a More menu ([d9669bd](https://github.com/MrVPlusOne/takode/commit/d9669bd386f2905ecf2faf0c1f8fc77dcf4c8f3a))
* **library:** save artifacts with versions and add the Library page ([e9d06a4](https://github.com/MrVPlusOne/takode/commit/e9d06a4657a6a96e305744907277202dd582efa0))
* **library:** Scribe events by urgency, done taps without a Scribe round, grouped Now items ([cbca4b8](https://github.com/MrVPlusOne/takode/commit/cbca4b8fb09ee512af19ff71bbc15235097251e3))
* **library:** Scribes run as continuous workers driven by events, guided by instructions ([1680c78](https://github.com/MrVPlusOne/takode/commit/1680c78fe794668b73ffe95b50567f4a0930380b))
* **library:** slide decks get their own Slides kind in the Library ([c6dc434](https://github.com/MrVPlusOne/takode/commit/c6dc43432425514f74fe14b2c74abadeb195c00a))
* **library:** star artifacts from the gallery and a Starred toggle beside Filter ([83d251d](https://github.com/MrVPlusOne/takode/commit/83d251da900cf54d933ebf8a93d5d1a55eba1af9))
* **library:** star artifacts from their cards' More menu in the chat feed ([a636bcf](https://github.com/MrVPlusOne/takode/commit/a636bcf269d9f68776b5397af15bc299a71d8102))
* **library:** topic conversations, a recent-first Done list and fresher topic pages ([b9a85a9](https://github.com/MrVPlusOne/takode/commit/b9a85a91fd4049e713ae68034d37b24c2e212bf3))
* **library:** topic page sections by kind of topic, and the user's requests per page ([f34e4f9](https://github.com/MrVPlusOne/takode/commit/f34e4f9f19707b164865496fce9d6a1dc6fd9ee0))
* **library:** topic pages are dashboards that track current state, not explanations ([2df75d8](https://github.com/MrVPlusOne/takode/commit/2df75d8c0352cdb85e9a91c36b9cf2b8313bd3e2))
* **library:** topic pages for deciding what to do next ([e5cbc1a](https://github.com/MrVPlusOne/takode/commit/e5cbc1a58b26cc1fa8f2dc95e28c0c6ed1f0ad13))
* **library:** topic pages show each open quest's news line ([d0e427c](https://github.com/MrVPlusOne/takode/commit/d0e427c653289002bdf3d53e4d45fdcd4f1948d0))
* **library:** topics with pages kept up to date ([06c3175](https://github.com/MrVPlusOne/takode/commit/06c31756faed72cf864ee04ebc5e274c4eb92a92))
* **markdown:** fold GitHub-style &lt;details&gt; sections ([88f6164](https://github.com/MrVPlusOne/takode/commit/88f6164e2402743851c3785d3eb17a9e957fccb0))
* **needs-input:** reply cards can send your pending comments with the answer ([1e2edf3](https://github.com/MrVPlusOne/takode/commit/1e2edf39ba8dddea2776a4918064484593671c28))
* **needs-input:** reply cards get an additional comments field ([48d41d5](https://github.com/MrVPlusOne/takode/commit/48d41d599d5082c68f74bea5a89e9167ffe06d72))
* **notify-me:** show at a glance when Notify Me is on ([d2c0a6b](https://github.com/MrVPlusOne/takode/commit/d2c0a6be2c785c2b1fbfe2a8c1c221174cc96a28))
* **orchestration:** have leaders acknowledge a user request before starting tool work ([7382052](https://github.com/MrVPlusOne/takode/commit/73820524d9c7379c4eee86467933dc11ef39c5c8))
* **overview:** one line per row, what needs you first, the rest folded ([0b3259f](https://github.com/MrVPlusOne/takode/commit/0b3259f99e47562256478ceee873dcb82deb7b5a))
* **overview:** Takode's own menu on every Overview row ([61ca74d](https://github.com/MrVPlusOne/takode/commit/61ca74d6775aec61e18a8e627fffa3f91b064e3d))
* **portraits:** Animals is the default portrait set, and the picker starts with the cat groups collapsed ([fef1013](https://github.com/MrVPlusOne/takode/commit/fef10136c49340b4ac7ba6d50e526ed6cb9f1207))
* **portraits:** larger desktop portrait picker with collapsible groups saved on the server ([76e5212](https://github.com/MrVPlusOne/takode/commit/76e5212d2a0cd6afc8972efcdfd7af5fa8904a61))
* **portraits:** one-time offer for existing users to switch leaders to the Animals portraits ([4f0323c](https://github.com/MrVPlusOne/takode/commit/4f0323c1306fdac9c7ef75fed2e19374c303650f))
* **profiles:** add an animals leader portrait set ([45055e6](https://github.com/MrVPlusOne/takode/commit/45055e6b1ed23e538154c32874e7a1c2c1495c8a))
* **quest-journey:** record Work delivered to several repositories in one call ([5e3243b](https://github.com/MrVPlusOne/takode/commit/5e3243b5610dc5355d3708b12df20d2bb88bd8bf))
* **quest-strip:** one-line quest strip with Worker and commits in the phase pill's card ([c0469f7](https://github.com/MrVPlusOne/takode/commit/c0469f750131adf51a8cce8a8bf48ee3c6c75823))
* **questmaster:** store each quest version once in backup snapshots ([c86ea69](https://github.com/MrVPlusOne/takode/commit/c86ea691c17c353c7a003963bb04598ce617f0fb))
* **questmaster:** store one file per quest ([4d8e295](https://github.com/MrVPlusOne/takode/commit/4d8e295ff6e8478da87f131adad4413994379612))
* **quests:** jump to a quest's thread from the icon after quest links ([ba5b88d](https://github.com/MrVPlusOne/takode/commit/ba5b88db19506b9ef368cc5db91cabdb7268ed09))
* **quests:** reopened quests show their newest round first; no new round while one is in Memory or Landing ([e51e377](https://github.com/MrVPlusOne/takode/commit/e51e377c5e21ffd79c07c247e69c0c2e0ee0cb00))
* **quests:** rounds keep reopened quests small ([2b1f936](https://github.com/MrVPlusOne/takode/commit/2b1f936295acf5737de72976573e77987f95c49b))
* **quests:** show unscoped feedback at its time position in the Journey timeline ([24b7c19](https://github.com/MrVPlusOne/takode/commit/24b7c19a1d00a85a871f7383eb0269f088c3241f))
* **quests:** write quest quizzes only when they help ([068a929](https://github.com/MrVPlusOne/takode/commit/068a9293371d1227ec73b0be5b3e7ef0ad2c0e82))
* **read-aloud:** drafts are read aloud, from the whole message or their own card ([cff7643](https://github.com/MrVPlusOne/takode/commit/cff76435b2f62c855c036588ac9282b403c7a666))
* **read-aloud:** start playing as soon as the first piece is spoken ([3617803](https://github.com/MrVPlusOne/takode/commit/361780376dbc542199d0bbc448c7d7d684d88b46))
* **read-aloud:** voiceback mode reads each new final answer aloud as it arrives ([ffe0104](https://github.com/MrVPlusOne/takode/commit/ffe0104f731da37e0b7ae20b044b51df010091d5))
* **read-aloud:** voiceback reads questions and stays on across sessions and reloads ([f203424](https://github.com/MrVPlusOne/takode/commit/f203424e1dd4ee929841927711735b4fc8605415))
* **remind-later:** the custom amount starts in hours and remembers the unit ([ecb148e](https://github.com/MrVPlusOne/takode/commit/ecb148e472fb18f2f3e72a34a380953ac556882f))
* **reports:** an expanded report's pinned bar shows its title ([5495571](https://github.com/MrVPlusOne/takode/commit/54955713f00454096b1ebec04e6bb0eaa74312f8))
* **reports:** open reports, drafts and visuals in the resizable side panel ([f5c734d](https://github.com/MrVPlusOne/takode/commit/f5c734d10a340b4e2449afe1dfa3e20fb149a4ce))
* **reports:** visual roles, zones and captions; table buttons on hover; jump list and wider column for long reports ([120a9d7](https://github.com/MrVPlusOne/takode/commit/120a9d7aced5fa8048b786845a90a76a6eb41dba))
* **review-skills:** reviews search the default branch for code that already does the job ([ea5b84e](https://github.com/MrVPlusOne/takode/commit/ea5b84e2a63e1a314549fc1e19b2aa5a6af949d2))
* **review:** a message about the whole review on the wrap-up, and leaders stop assuming answers mean implement ([39d2d67](https://github.com/MrVPlusOne/takode/commit/39d2d67f3fce9b901206ad3315bb58092c1e33b4))
* **review:** Back beside Next in the walkthrough, and no Question or Change buttons ([8916a90](https://github.com/MrVPlusOne/takode/commit/8916a904838fbdc1ea426ef64c5e4710882a0d3c))
* **review:** comment on lines of code in guided reviews ([a7fc9b7](https://github.com/MrVPlusOne/takode/commit/a7fc9b7993f4b7404a39f5362d164b8b13a8d75d))
* **review:** list each summarized file with the lines it covers, and leave Escape to a quest opened over a review ([4f0649a](https://github.com/MrVPlusOne/takode/commit/4f0649aea27ab18aab58391e741c52765a31989a))
* **review:** share a published guided review into another thread ([8469f8b](https://github.com/MrVPlusOne/takode/commit/8469f8b3580aeba3cf37d4cf58bef0fae63aa661))
* **review:** the guided review walkthrough uses the whole window, giving its code more width ([b14e42c](https://github.com/MrVPlusOne/takode/commit/b14e42c52bf7c370ba04bc594b4d506015afbe1a))
* **scribe:** rewrite a thread's news line on every new result ([5ba3a23](https://github.com/MrVPlusOne/takode/commit/5ba3a2378d39d71e0043c4882c3558cc65c78ecf))
* **scribes:** a new Scribe context limit applies at once ([6c666a3](https://github.com/MrVPlusOne/takode/commit/6c666a36f8bb7cec31595a0de370da24f5d7baa7))
* **scribes:** keep Scribes running with a context limit instead of replacing them ([f4760f8](https://github.com/MrVPlusOne/takode/commit/f4760f8de3f550c90bd5ec33928b99af7b03742d))
* **scribes:** Scribe messages carry only what changed ([c16488e](https://github.com/MrVPlusOne/takode/commit/c16488eccfe3820a3dd76b7ca48b09669236807e))
* **scribes:** thread joins wait for a thread to settle, stay with its quest, and can be fixed ([34115f7](https://github.com/MrVPlusOne/takode/commit/34115f7a39adb36564ba237ce0b1c281091d11fb))
* **scrollbars:** fade scroll bars when not scrolling, one at a time ([13da1ac](https://github.com/MrVPlusOne/takode/commit/13da1ac8e2851a35eaf685baaf8d3ec894132d44))
* **search:** Recent searches your messages in every session; Assistant searches one leader ([2397826](https://github.com/MrVPlusOne/takode/commit/2397826f05bdfadc7555495a2fba53b4fc65568a))
* **search:** server search of the user's own messages across every session ([c878a1d](https://github.com/MrVPlusOne/takode/commit/c878a1d6f957e344714bf35dbadbce397ecb35a9))
* **session-hover:** active quests in the hover card open their thread ([d601483](https://github.com/MrVPlusOne/takode/commit/d601483d2368219ac1b3eb8f2e895fb9117104b4))
* **sessions:** tell a Claude session which sub-agents stopped with its process ([889d623](https://github.com/MrVPlusOne/takode/commit/889d6231a7229ce309641498f7cf9705b7a01a2f))
* **side-chats:** a side chat becomes its quest's thread, and links open in the pane they're in ([3b91b94](https://github.com/MrVPlusOne/takode/commit/3b91b943c22d579add5d1436a5c90520c7c76c63))
* **side-chats:** start a side chat with another leader from any leader's side column ([83aa9d5](https://github.com/MrVPlusOne/takode/commit/83aa9d5714bee3bb83d94b3ed63f322d9abb4fb7))
* **side-column:** a leader's Home opens in the side column as a switcher for the main view ([5dd0b9b](https://github.com/MrVPlusOne/takode/commit/5dd0b9b3e39e78abe1c6e65853d8bfeeb90448e9))
* **side-column:** a quest's side conversation shows its quest chips, as the main view does ([6883e54](https://github.com/MrVPlusOne/takode/commit/6883e5401af54276f0c51c6108af2de7abeb97c9))
* **side-column:** at most three open side conversations; New thread shows its leader ([f23d0e2](https://github.com/MrVPlusOne/takode/commit/f23d0e2b6d0fdf95d7f970e7f3c09244fc690b21))
* **side-column:** chats always open one at a time ([d83497e](https://github.com/MrVPlusOne/takode/commit/d83497e4b2c7dadd455d65d544b194dd3e69fd4a))
* **side-column:** every section folds on its own, the column scrolls, and an open section's bottom edge sets its height ([7285c1d](https://github.com/MrVPlusOne/takode/commit/7285c1d8e6da5bcc7f6631d4e12ea2bf5a276d97))
* **side-column:** fold everything put in the side column into one group above the topic page ([aee6c83](https://github.com/MrVPlusOne/takode/commit/aee6c837015f9da14293e42f23daaa57d21c7893))
* **side-column:** group the side column by kind, with a clearer folded chats bar and page-style bars for pages ([c399872](https://github.com/MrVPlusOne/takode/commit/c3998720e7300594fa6b29553f19ef142485464e))
* **side-column:** new threads start at the last side conversation height; keep held connections across changes ([8b3059c](https://github.com/MrVPlusOne/takode/commit/8b3059c55ef26b2c9df5570f6352a496d70f0ff5))
* **side-column:** one side column for every leader ([3a45d92](https://github.com/MrVPlusOne/takode/commit/3a45d920d92098ec8fe5fccf7110e32311dba35f))
* **side-column:** one-at-a-time mode, where opening a section folds the others and it fills the column ([a6bded0](https://github.com/MrVPlusOne/takode/commit/a6bded0dd46fc4e2d7fb647c967acf85b9d9684e))
* **side-column:** Shift-click on move-to-side or Open in the main view keeps the chat in both views ([5dad645](https://github.com/MrVPlusOne/takode/commit/5dad6452532350884c6ef2d1563e085a919abca7))
* **side-column:** side panes' title bars show their leader's portrait ([cd5bb51](https://github.com/MrVPlusOne/takode/commit/cd5bb51d34da3364c51c4742bf40e8c726dbe310))
* **side-column:** the Library's gallery button in the open column's top row ([005cb1a](https://github.com/MrVPlusOne/takode/commit/005cb1ab1dc6d80ea097fd438f5a4124f0399dfc))
* **side-column:** the Settings key for the side column is the other-column click, and keeps a chat in both columns on the move buttons ([04dcbf6](https://github.com/MrVPlusOne/takode/commit/04dcbf6ecad9dcfa8b8f796a67e038cb6c456a01))
* **sidebar:** a leader's Scribe sits last in its herd, apart from the worker count, and keeps its name ([1e16538](https://github.com/MrVPlusOne/takode/commit/1e16538767e9534a7d90da970fa47e25d106db8c))
* **sidebar:** a Topics mode for the sessions panel ([e01ad2e](https://github.com/MrVPlusOne/takode/commit/e01ad2ecdb6c4c6a8e5457f0c7d43f55e350e56b))
* **sidebar:** leader portraits a quarter larger on desktop ([2189c58](https://github.com/MrVPlusOne/takode/commit/2189c58c87fd5c3573af102c12a88a596a6c5af5))
* **sidebar:** swipe the phone sessions panel closed instead of archiving rows ([ffe4e5a](https://github.com/MrVPlusOne/takode/commit/ffe4e5a0a8b3a7c5362c7e10cb878eece3bca238))
* **sidebar:** unlock the desktop sessions panel to fold it to its top row and drop it down on hover ([f2b5d14](https://github.com/MrVPlusOne/takode/commit/f2b5d14ecca86bd62c4cc225ef8c48da1cc37bb9))
* **site:** a landing page with the Ink & Paper painting and a demo that plays the real Takode app ([85bd742](https://github.com/MrVPlusOne/takode/commit/85bd742a0045ac5805b7fa3bfff50267da75b951))
* **slack-updates:** compact repeated Slack update notices ([fc05b37](https://github.com/MrVPlusOne/takode/commit/fc05b37530fb6fe3146cb55f561cf40511fa18a1))
* **slack-updates:** have Claude Code renew an expired Slack login ([74749bd](https://github.com/MrVPlusOne/takode/commit/74749bd3910d7b90a3988caabf51e08fa6b40646))
* **slack-updates:** tell agents about new messages in Slack conversations they read ([b01ab5d](https://github.com/MrVPlusOne/takode/commit/b01ab5d938b7d5e13d5af1673d800697906aab1b))
* **slides:** deck controls in one centered group, Play in place, click and Space shortcuts ([84ec92e](https://github.com/MrVPlusOne/takode/commit/84ec92edf4c50f329e6ad46f5427b664a74e41ef))
* **slides:** show reports written as slide decks one slide at a time, with Present and PDF export ([5523a0f](https://github.com/MrVPlusOne/takode/commit/5523a0f8e1144250bc5fe14fbca94e18d95c0fd5))
* **slides:** speaker notes, narrated Play and comments on a slide ([c6c0824](https://github.com/MrVPlusOne/takode/commit/c6c0824cb193b4b120243ece76357174801c6247))
* **theme:** replace the VS Code theme with a System option that follows the device ([15aa78f](https://github.com/MrVPlusOne/takode/commit/15aa78f7b276ff1ef1f3c4affba8a6d208006522))
* **threads:** a thread's strip holds its name and actions; its quest's state floats in the feed ([af6c18d](https://github.com/MrVPlusOne/takode/commit/af6c18d3c518766f56a920cd65b606686dfd30c1))
* **threads:** a Threads view in the sessions panel; groups follow what runs ([ac0ac99](https://github.com/MrVPlusOne/takode/commit/ac0ac99dcdb0d2e7fe77a933ac0c0a2d7d1483e1))
* **threads:** a Threads view row shows a hover card instead of a plain tooltip ([a78d0b1](https://github.com/MrVPlusOne/takode/commit/a78d0b14ff39476d448853dcf8e8d25b4965e4bc))
* **threads:** cancelled quests leave the status row and the Threads view ([4218041](https://github.com/MrVPlusOne/takode/commit/4218041f89e790691b95bcd700f791476917b56b))
* **threads:** deliver live messages of conversations shown beside the main view ([42a8ece](https://github.com/MrVPlusOne/takode/commit/42a8ece5cb60d66fb1f74a759b648a35acbcfbdd))
* **threads:** drop the Work continued handoff labels from the chat feed ([fa28310](https://github.com/MrVPlusOne/takode/commit/fa28310cb2239911c2ce008e17c36a83693c618e))
* **threads:** Home replaces a topic leader's Main, and leaders open threads of their own ([f037d93](https://github.com/MrVPlusOne/takode/commit/f037d93e4ca5a28cbee851b766225605736885c5))
* **threads:** leaders hold threads; topics become tags ([2d9ee7e](https://github.com/MrVPlusOne/takode/commit/2d9ee7eccf4817645eebbd919c71a1644454823e))
* **threads:** Main names each request's quest with a sticky strip ([fa7c3b7](https://github.com/MrVPlusOne/takode/commit/fa7c3b75fcd211a8d148f7fb318fa7f0cf4fb4be))
* **threads:** Needs you and Unread overlap In progress and Idle ([ce9d4fa](https://github.com/MrVPlusOne/takode/commit/ce9d4face12287d752eca9f37fdc5c738de14b08))
* **threads:** one tap opens a phone quest chip's Journey with its worker and commits ([5a5bcf5](https://github.com/MrVPlusOne/takode/commit/5a5bcf59cf10282c5e94484020af6a3753af8613))
* **threads:** one title per thread, then its update ([57131fc](https://github.com/MrVPlusOne/takode/commit/57131fc1ed619407aefaa43dba502caa693d8e91))
* **threads:** quest chips float at the feed's top right, with room above the conversation ([7c8e34a](https://github.com/MrVPlusOne/takode/commit/7c8e34a2f6e1ea7addd288131527f0aa4b7eee1c))
* **threads:** Recent lists every thread read, filed or not, with search ([26afce7](https://github.com/MrVPlusOne/takode/commit/26afce767d4c1da98dd01a8709f937d0d565958e))
* **threads:** replying in a thread reads its earlier answers ([d1dea91](https://github.com/MrVPlusOne/takode/commit/d1dea91a6717e6c3777215637f028048dde3bf73))
* **threads:** short thread addresses t-N ([e87f702](https://github.com/MrVPlusOne/takode/commit/e87f702291406e7a8d892bf21aac097f5a6359da))
* **threads:** show the quest tab's worker preview whenever the quest is in an active phase ([b2b5a7e](https://github.com/MrVPlusOne/takode/commit/b2b5a7e343054c4aac84b2d32ac2c6e9392b910b))
* **threads:** slimmer status row and one folded quest chip on desktop ([ed55a5d](https://github.com/MrVPlusOne/takode/commit/ed55a5dc1b0f18de10187f237ca2b297c5ddfd65))
* **threads:** start new threads from a Threads menu; they settle once their last answer is read ([892bcae](https://github.com/MrVPlusOne/takode/commit/892bcae2df94681f09dd00bfb3631a9223004e6c))
* **threads:** sweep a sheen across a quest fork row the first time it appears ([9c91d13](https://github.com/MrVPlusOne/takode/commit/9c91d13aa1b4265bf98dba91b941095ab4c7608c))
* **threads:** Takode's own menus on the Threads view's rows ([fe07a65](https://github.com/MrVPlusOne/takode/commit/fe07a655a19e8c4e37c1026e5358aaad18c197dc))
* **threads:** the tab on screen floats between status groups when it changes group ([bcd71fd](https://github.com/MrVPlusOne/takode/commit/bcd71fd37daa636d8c1ff35e3b5c91b50b8e6013))
* **threads:** Threads view by the user's last interaction, urgent groups on the right ([46724a7](https://github.com/MrVPlusOne/takode/commit/46724a73ee2f1ca52d6355b77df3b03800565c5f))
* **threads:** Threads view rows drop the quest number so titles get the room ([fed19eb](https://github.com/MrVPlusOne/takode/commit/fed19eb771b728b7f6cfac3835edd4308a1bb486))
* **threads:** Threads view rows lead with the leader's portrait, ringed by status ([56f543d](https://github.com/MrVPlusOne/takode/commit/56f543d7975b355406fbdade7884ca1632c0b0c3))
* **threads:** Threads view rows lead with the quest number and say what's new ([64ba81d](https://github.com/MrVPlusOne/takode/commit/64ba81dc92051c62b2d1a519178644c971bdd54c))
* **threads:** viewing a thread moves it up, and search finds threads by name ([602be0f](https://github.com/MrVPlusOne/takode/commit/602be0f62fc356957930d2908cf99ab00a74cf8a))
* **timers:** let a recurring timer check a command before waking the session ([522d515](https://github.com/MrVPlusOne/takode/commit/522d515842d96b67fd8fa60a597b7922b2680d2b))
* **todos:** check circle and fireworks in the to-do preview ([7e230ec](https://github.com/MrVPlusOne/takode/commit/7e230eccc99f645a8194fb8d2ae38dba991e71a2))
* **todos:** reorder to-do categories and archive categories with only Done to-dos ([9f13697](https://github.com/MrVPlusOne/takode/commit/9f13697109d69abbf713f03ae83c562d7f69e8ee))
* **todos:** right-click or long-press a to-do for its quick actions ([85a907f](https://github.com/MrVPlusOne/takode/commit/85a907f738162b3b92ffb8bd4a92e673437a9478))
* **topics:** a request moved to another topic's quest sits under that quest's strip ([924d762](https://github.com/MrVPlusOne/takode/commit/924d7629e06ce2fdafac0ec166b3b35894e1ad13))
* **topics:** a request sits under the strip of the quest it continued in ([c2d65af](https://github.com/MrVPlusOne/takode/commit/c2d65afa7616531383c45c6f0546e68b97994415))
* **topics:** a topic page's pictures can't outgrow its text unnoticed ([482ab97](https://github.com/MrVPlusOne/takode/commit/482ab97dce681518bd7e05661a488ac913b8dcb3))
* **topics:** a topic row's card lists what waits, what is new and what runs ([0d588e6](https://github.com/MrVPlusOne/takode/commit/0d588e614545e8a495055e1dd4f15ee5edfa6630))
* **topics:** every leader has topics; retire topics-off mode ([d641527](https://github.com/MrVPlusOne/takode/commit/d64152707657347944f9b72819bb88a02b79f6ec))
* **topics:** fold interleaved progress of parallel quests into a card ([ebceb4e](https://github.com/MrVPlusOne/takode/commit/ebceb4ed3eed6ee0157865ad16aa710ee6264d4c))
* **topics:** keep topic edges clear: scope lines at filing, a filing check and batch moves for the Scribe ([3ce0067](https://github.com/MrVPlusOne/takode/commit/3ce006760cd7d30c9f36bccc8c92817135db41d3))
* **topics:** keep topics broad, few and distinct ([846657a](https://github.com/MrVPlusOne/takode/commit/846657a14e0987eff518aedebd532008a53ab228))
* **topics:** Library topics and Scribes are on for every leader by default ([72b7068](https://github.com/MrVPlusOne/takode/commit/72b7068ac0981513800b1961450750e98a891239))
* **topics:** messages sent from a topic conversation go to the topic ([2ac0bf9](https://github.com/MrVPlusOne/takode/commit/2ac0bf9ec972b2b98fcdad7a21fd59207df5e5e8))
* **topics:** pin topics to the top, and the view switch folds into a dropdown when the panel is narrow ([e5701aa](https://github.com/MrVPlusOne/takode/commit/e5701aa4509d52b5b4a45f3d3d87ccb241423ae4))
* **topics:** search box in the Topics list and the topic panel ([f4b6ff5](https://github.com/MrVPlusOne/takode/commit/f4b6ff5905d05db90d2821e02db7850c12a926d7))
* **topics:** the Scribe as a background support role ([29c5e92](https://github.com/MrVPlusOne/takode/commit/29c5e92116a87ac47c8149f511036a3e54e59517))
* **topics:** the topic view shows what you read, one quest at a time ([bdcd230](https://github.com/MrVPlusOne/takode/commit/bdcd230b72f42928003c1ea8fe9d5b5d683aee2b))
* **topics:** topics are threads ([bfdf78c](https://github.com/MrVPlusOne/takode/commit/bfdf78c409240bb53b9579d25cf7f8bc8a01e51f))
* **tracks:** integration branches for parallel lines of work ([374c7f3](https://github.com/MrVPlusOne/takode/commit/374c7f350017baf213f00dc2b687f5869ece118e))
* **transcription:** drop 1-2 character workspace terms and terms already in the custom vocabulary ([b8dd1b3](https://github.com/MrVPlusOne/takode/commit/b8dd1b374473f57b22b48d09aa42763b3055b1c0))
* **ui:** replace the legacy cat art with a ring spinner, breathing dot and painted Tako ([534f5e0](https://github.com/MrVPlusOne/takode/commit/534f5e061744ba01da80bef409fde63c6c075469))
* **ui:** right-click menus on the remaining rows, cards and quest links ([c45c1e3](https://github.com/MrVPlusOne/takode/commit/c45c1e39e1f98e299d54536b517c73dcedd61f2c))
* **ui:** Takode draws every button's tooltip, and icon buttons must have one ([dc18e90](https://github.com/MrVPlusOne/takode/commit/dc18e90e1e451e2f30e55a5253fbfae203f11b61))
* **unread:** each unread answer gets its own New tag when they are not together ([3a6e53f](https://github.com/MrVPlusOne/takode/commit/3a6e53ffa4f156fca0fd899a64380ea104533ecd))
* **visuals:** visual blocks for agents, sandboxed so they can't hang Takode ([cbf318e](https://github.com/MrVPlusOne/takode/commit/cbf318e8f8a8cd7a55ca4b035dee7f92d25e4c31))
* **voice:** fix misheard names in transcription with fuller, readable context ([fa6ba22](https://github.com/MrVPlusOne/takode/commit/fa6ba22ea7662efa14dc461d5b7787e43c39ffb4))
* **voice:** record with the phone's own mic when AirPods are connected ([84f7366](https://github.com/MrVPlusOne/takode/commit/84f7366f3fb71c124652f37ef5a14d5face03c23))
* **worktrees:** register auxiliary checkouts on other machines ([40088f3](https://github.com/MrVPlusOne/takode/commit/40088f38980d90948b03aa207673f854ff8fcdf5))
* **worktrees:** unregister and prune registrations of removed checkouts ([d99481f](https://github.com/MrVPlusOne/takode/commit/d99481f1bd7fbee43fe515dd84cd8a826023a9c4))


### Bug Fixes

* **app:** a page that crashes after a server update reloads into the new version ([20699c3](https://github.com/MrVPlusOne/takode/commit/20699c3eba78bc49549bebf477b19cf5a828a919))
* **appearance:** a worker's activity keeps its sheet when its leader's messages arrive mid-turn ([e699e33](https://github.com/MrVPlusOne/takode/commit/e699e336736aa55aac0c18a7cf5961f2b962a38e))
* **appearance:** cranes, the boat and fireworks pass behind Ink & Paper's near pines ([b5ae8fc](https://github.com/MrVPlusOne/takode/commit/b5ae8fc398abc1239ccc6a79f1824a106a0c0d1c))
* **appearance:** keep menus above the conversation with a scenic background ([54668a4](https://github.com/MrVPlusOne/takode/commit/54668a457ba66786531951a175c575e9ec893826))
* **appearance:** keep message times inside the paper column with a scenic background ([c3f0162](https://github.com/MrVPlusOne/takode/commit/c3f0162fc280a6c73aaef44c770e47c0db7ebf8f))
* **appearance:** no faint box around the boat and cranes ([515f5e5](https://github.com/MrVPlusOne/takode/commit/515f5e531f814a9754904baca7d04f496192398f))
* **appearance:** scenic styles keep the app's fonts ([f3cbd99](https://github.com/MrVPlusOne/takode/commit/f3cbd991c7b19b9e7490c06d7e9af425c72b5235))
* **appearance:** the turn summary heads its message sheet in scenic styles ([baacb4f](https://github.com/MrVPlusOne/takode/commit/baacb4fbf738e5bd125c9b1cdd8f03a4bf01afc2))
* **appearance:** your messages stand out in the side chat ([03e4cb9](https://github.com/MrVPlusOne/takode/commit/03e4cb9589b9277bcebc74f830f82ff1a886865e))
* **attention:** a Notify Me result opens at the answer it reports, not the Ready commentary ([06b4305](https://github.com/MrVPlusOne/takode/commit/06b4305543137f0c70a9ab36807175edd6028d60))
* **attention:** count unread by place, from what the user can still see ([f5605fa](https://github.com/MrVPlusOne/takode/commit/f5605fa7d593741e7808fa02020a3ee156631323))
* **attention:** Next opens a topic's first unread answer, never the commentary before it ([09d273b](https://github.com/MrVPlusOne/takode/commit/09d273baedf4c63b29f2c02c95816e8a0c99f384))
* **attention:** open a finished quest's unread result on its Quest complete card, and answers before it ([1efdc74](https://github.com/MrVPlusOne/takode/commit/1efdc74c1871d3d24935804a32ecb2e75b1b60c6))
* **attention:** room for the New line, and closing a tab follows the topic-first order ([9fc5a15](https://github.com/MrVPlusOne/takode/commit/9fc5a15ce252e99496e3de8d4b481e39442ec616))
* **backup:** back up the quest folder as it is ([313d505](https://github.com/MrVPlusOne/takode/commit/313d505ac625c11225a0d99b707aad3f9a9e02fa))
* **board:** count a disconnected worker's exec jobs as a legitimate wait ([7a43e08](https://github.com/MrVPlusOne/takode/commit/7a43e0848cfbccc9a4f4d56f7bdfda637a4255e4))
* **board:** refuse another leader's quest, and remove one without a trace ([41ec540](https://github.com/MrVPlusOne/takode/commit/41ec540cba2b2fcdd8611e31089e50e63e783c20))
* **board:** refuse archived, unknown or unherded workers on board rows ([12b5d04](https://github.com/MrVPlusOne/takode/commit/12b5d0450dfa56d5b9b49d7f621d76e9154306f6))
* **board:** say why Work-to-Memory refuses a named Work note ([9ff8251](https://github.com/MrVPlusOne/takode/commit/9ff8251f544d0d1a574b8c07c1afeadd58fab5e3))
* **chat:** a message being sent keeps the shape it will have once delivered ([086b3d2](https://github.com/MrVPlusOne/takode/commit/086b3d2eaeb08df8b9e4cf4591b8a2520569c3a3))
* **chat:** close quest link hover cards after the link was clicked ([2a0b420](https://github.com/MrVPlusOne/takode/commit/2a0b420c99b6a6f1296ae395e28cbf98754ce12c))
* **chat:** keep a feed at its bottom clear of the floating status chips ([ca8b377](https://github.com/MrVPlusOne/takode/commit/ca8b377a7c5eaac8049f6864b5297d7375e0a292))
* **chat:** more room above the floating status chips, and the activity pill's timer on one line ([ae1fb73](https://github.com/MrVPlusOne/takode/commit/ae1fb73e8c5e95aaee741b1b1acdb6147c0a3c29))
* **claude-sdk:** announce the backend connection when a relaunched adapter finishes starting ([8b74515](https://github.com/MrVPlusOne/takode/commit/8b74515c6637f1c8a60c51724fac74f966a58eee))
* **comments:** keep unsent comments with the thread they were made in ([eab9041](https://github.com/MrVPlusOne/takode/commit/eab90410d4e0f36f2e23ad462430deda961f47e4))
* **comments:** voice edit in a comment editor shows the composer's diff preview ([6060e4e](https://github.com/MrVPlusOne/takode/commit/6060e4eed34ffd3f391d3c2215e5d2e6ee490070))
* **composer:** a first Cmd+V with nothing focused pastes into the composer ([83cad41](https://github.com/MrVPlusOne/takode/commit/83cad41de8856984b24a31c40b53b2f20b1c3e51))
* **composer:** insert pasted text and save input traces automatically ([64d5944](https://github.com/MrVPlusOne/takode/commit/64d594422615c982ffec0d5c38c89b535e84115d))
* **diagnostics:** report input glitches from Settings or the shortcut, not a sidebar button ([a58f31a](https://github.com/MrVPlusOne/takode/commit/a58f31a52b0ed94daa88319043f1d7b867aafef0))
* **drafts:** call the draft card's copy button Copy, since drafts aren't only for Slack ([07f4928](https://github.com/MrVPlusOne/takode/commit/07f49284bac6f13f84adac4eb1f095fe984474cd))
* **drafts:** keep the Home and artifact chat drafts across reconnects ([5751bc2](https://github.com/MrVPlusOne/takode/commit/5751bc2db27f1b94b9f7e774a008ce5753a4af9c))
* **drafts:** let draft and visual titles be selected and copied ([0473b78](https://github.com/MrVPlusOne/takode/commit/0473b78c7dddd5a7d6dc5afe64dbd8019e0ac917))
* **drafts:** paste bullet-character draft lines into Slack as real lists ([9dfc59f](https://github.com/MrVPlusOne/takode/commit/9dfc59fe368253c0eeb341235dc28e12476c4bd4))
* **drafts:** read Slack's own link and mention syntax in draft cards ([2a7c0de](https://github.com/MrVPlusOne/takode/commit/2a7c0de04ff46fe28c1e3bc0edb8a69c20576d51))
* **exec:** killing a job stops processes that left its process group ([85cc86d](https://github.com/MrVPlusOne/takode/commit/85cc86dd2513b7fd56d223edc4f673084033aa85))
* **exec:** make takode exec reliable for long commands and retire --background ([e87f3cb](https://github.com/MrVPlusOne/takode/commit/e87f3cb6849eb76139f2af7e9432a056eaa173cd))
* **exec:** run commands in the user's own login shell and give all of long output ([163fbcf](https://github.com/MrVPlusOne/takode/commit/163fbcf724ae6f2c3fbe074e52ea296c2b13fa91))
* **exec:** session CLIs refuse to run inside takode exec ([dd54313](https://github.com/MrVPlusOne/takode/commit/dd5431377913c53db0392d28d88ed2a95defbd6c))
* **feed:** a thread joined onto a quest keeps the quest's answer cards, so every answer shows and can be read ([7859009](https://github.com/MrVPlusOne/takode/commit/7859009cd70fb1c0243e38148172f838b8c2986b))
* **feed:** keep a leader note's trailing commands in the next activity group ([202fccf](https://github.com/MrVPlusOne/takode/commit/202fccf3e00329e4d72577508f62651a6cfbc248))
* **feed:** keep All Threads at least as long as Main ([9f77bf8](https://github.com/MrVPlusOne/takode/commit/9f77bf832301a9d696d2954edabe8f0b17cdac3d))
* **feed:** keep loading older All Threads history, at the usual first-load size ([01863ae](https://github.com/MrVPlusOne/takode/commit/01863ae3668722c8ef232e2d796c0af4ca967485))
* **feed:** keep the day pill clear of the top controls; realistic Playground times ([ea44a9b](https://github.com/MrVPlusOne/takode/commit/ea44a9bdc9afed3f2cddaea65ed36ad291144324))
* **feed:** replies that begin with thinking keep their place in side panes ([2e84a11](https://github.com/MrVPlusOne/takode/commit/2e84a1126d1cabdf1baff4fa4b023585dabc3f92))
* **feed:** send browsers the whole session state with each backend init, so expanded reports and stars stay ([8950b86](https://github.com/MrVPlusOne/takode/commit/8950b86d9798cb2b91134f410999ca6bb7a4ba55))
* **feed:** sending or commenting while scrolled up keeps the view exactly still ([ffaffca](https://github.com/MrVPlusOne/takode/commit/ffaffca57fa73b63e5017bb440213ae3b8dfc904))
* **feed:** side panes take their own jumps, so comment chips open there ([f3da009](https://github.com/MrVPlusOne/takode/commit/f3da00990887730bc2b91e5b3b716e7e190522d8))
* **feed:** side panes tell the server what they show, like the main view ([a9ed32c](https://github.com/MrVPlusOne/takode/commit/a9ed32cf5873833f45e421316cbfa11b7dbb38b7))
* **feed:** sticky report bars pin flush with the feed's top in quest threads ([5a934e3](https://github.com/MrVPlusOne/takode/commit/5a934e3ecf98f4c252af6ab1acd484b05b78a14b))
* **feed:** top controls start below what is pinned at the top of the feed ([ff703de](https://github.com/MrVPlusOne/takode/commit/ff703def2e77d72fcb396ab62df7bab561d9e735))
* **file-links:** open HTML file links from sessions on remote hosts ([d1e7c59](https://github.com/MrVPlusOne/takode/commit/d1e7c596b2a72b86f78a727cf979478f41fe39bd))
* **herd:** let turns woken only by takode exec completions stay quiet ([d791fc2](https://github.com/MrVPlusOne/takode/commit/d791fc2575f2a2d9c07fd4281b92746facc2615d))
* **hosts:** offline alerts only for sessions a host outage actually stalls ([8f49628](https://github.com/MrVPlusOne/takode/commit/8f4962878ac7d79803e4620d7748f2c6cf2f4810))
* **image-viewer:** hide a chat's full-screen viewer while the chat is kept hidden ([917ccf1](https://github.com/MrVPlusOne/takode/commit/917ccf1176f4512c1aac0e334abacf962ed0a687))
* **image-viewer:** open the server's copy when a kept chat's local preview was revoked ([0adb9d8](https://github.com/MrVPlusOne/takode/commit/0adb9d86bdf594d60706b43651d3792f9c13e17a))
* **images:** send the original when the full-view copy is not ready, and share encodes ([94273fd](https://github.com/MrVPlusOne/takode/commit/94273fd81bb633e8cf76b6857f379b5880f2e28e))
* **landing:** keep a landing run's result when the server restarts mid-gate ([8343fe5](https://github.com/MrVPlusOne/takode/commit/8343fe5d3a31060893b1fe6c8f198158b22a53f5))
* **leader-nav:** a topic's conversation is a place of its own ([9013f87](https://github.com/MrVPlusOne/takode/commit/9013f87a3cc17707668044ab2050e69feb26c7a1))
* **leader-nav:** band × goes to the topic; leaders reopen where left ([6c2a090](https://github.com/MrVPlusOne/takode/commit/6c2a090578977e5c8eaaba8b92694aab09b22928))
* **leader-nav:** open-in-side works on every link; side scroll leaves main alone ([9923df5](https://github.com/MrVPlusOne/takode/commit/9923df573ca93d9441085b38e4c5499e1447d791))
* **leader-threads:** deliver each thread's status with its own window ([64696e0](https://github.com/MrVPlusOne/takode/commit/64696e091dc6e2f700e48876c3aa6d4df73458d1))
* **leader-threads:** hold answer reminders until Claude is idle and re-check them before sending ([76f3d4a](https://github.com/MrVPlusOne/takode/commit/76f3d4a34e09a2c0ba25f6c097114650209e0d60))
* **leader-threads:** keep an answer resent after a routing reminder visible in its thread ([99f4f4a](https://github.com/MrVPlusOne/takode/commit/99f4f4a324ea7679e0705c3d8923e4542334034c))
* **leader-threads:** show a plain thread's status chip in its own feed ([43716d2](https://github.com/MrVPlusOne/takode/commit/43716d28ab8075f0c95c7d9fac140001d009101b))
* **leader:** a slash command sent in a thread stays in that thread ([b95de6a](https://github.com/MrVPlusOne/takode/commit/b95de6a2ced163afba37a64725a7482303058166))
* **leader:** keep answers that go on to call tools, and flag results left as commentary ([561859f](https://github.com/MrVPlusOne/takode/commit/561859f3897b30fccb49c195d64efe438efaf974))
* **library,leader:** read skipped Library captures once; check a queued message with the turn that answers it ([da25553](https://github.com/MrVPlusOne/takode/commit/da255531c6ee65847905c7d07bb79a95e2594235))
* **library:** a quest tab names its topic at once, and the Done list's topics follow activity ([997111c](https://github.com/MrVPlusOne/takode/commit/997111c76e7a1f06d995974bba67a81e44f0039b))
* **library:** a topic conversation catches up after the phone comes back ([ea37696](https://github.com/MrVPlusOne/takode/commit/ea376969f3f33a4c58a8721516434b369021fe70))
* **library:** capture a message whose text arrives after its thinking was read ([726de0a](https://github.com/MrVPlusOne/takode/commit/726de0ab32823207b8176d6d821c4605e38ebdc2))
* **library:** collapse earlier copies of a version sent again; Library link inside the card ([77d31f2](https://github.com/MrVPlusOne/takode/commit/77d31f21b59a04a982155a75ebc14193f6ad4777))
* **library:** count a Scribe's work from the request, and clear its stopped state once it finishes ([c060db1](https://github.com/MrVPlusOne/takode/commit/c060db1996c15c353e6c90cc526033a9292911ac))
* **library:** deliver Scribe requests after a restart and retry interrupted turns ([69abadf](https://github.com/MrVPlusOne/takode/commit/69abadf2b06fd2adc5dfa71fd8e33b52d6995817))
* **library:** embedded images open in the image viewer; quieter topic changes and a settings gear ([8845e14](https://github.com/MrVPlusOne/takode/commit/8845e14e66d9fd8440b74f5784023ca8c37a482d))
* **library:** keep an artifact's width when its side chat opens ([dcae2e0](https://github.com/MrVPlusOne/takode/commit/dcae2e00dbb9b515e089f581847531b53cdfa8b1))
* **library:** leaders reach a busy Scribe, and lasting page requests go in its instructions ([14edc83](https://github.com/MrVPlusOne/takode/commit/14edc83cb4c36e82f2c711f8b16459016af03ac4))
* **library:** live work and local images in topic views ([6271bb4](https://github.com/MrVPlusOne/takode/commit/6271bb4e6a3700187a5697b58822901782ee6a2a))
* **library:** one topic panel width for every leader ([5c9ed19](https://github.com/MrVPlusOne/takode/commit/5c9ed19cbbe26e2f0a9a48f83b457e798aca8465))
* **library:** open a topic conversation without reading the history once per quest ([55fb344](https://github.com/MrVPlusOne/takode/commit/55fb344f995d8ad2220043f6a0e2729c369ad026))
* **library:** open guided reviews from the Library as in chat ([d960d4f](https://github.com/MrVPlusOne/takode/commit/d960d4f0d714c06e88644e1c275bbf2d446a0fe8))
* **library:** plots embedded as server image URLs refresh on topic pages ([65541e8](https://github.com/MrVPlusOne/takode/commit/65541e8cdb3df5e403f8829a4a17c0848679e54e))
* **library:** Scribes back off after failed turns instead of looping ([16aac47](https://github.com/MrVPlusOne/takode/commit/16aac4716dc89b5e865f1f42a9451253a5886a3c))
* **library:** Scribes build a topic's Now from what its quests left open ([a4d306c](https://github.com/MrVPlusOne/takode/commit/a4d306c2c4b806da19fbecfea7d86a21d7cf88d6))
* **library:** start each Scribe on its leader's machine ([d876913](https://github.com/MrVPlusOne/takode/commit/d8769131f2f67b8dfbc4a469e1d2f4582744d6b0))
* **library:** start the phone topic panel right under the tabs ([fd12fc1](https://github.com/MrVPlusOne/takode/commit/fd12fc1abbb34fd7afd14bb17ac34d002ad7cd2e))
* **library:** topic conversations show answers as quest tabs do ([4b976e4](https://github.com/MrVPlusOne/takode/commit/4b976e4b58d43a6eaddf00a203d97ecbc3b25642))
* **memory-guard:** count compressed memory in command limits on macOS ([e301cda](https://github.com/MrVPlusOne/takode/commit/e301cda469fa49120e210c38b63adc635cc50b1b))
* **memory-guard:** read cgroup v1 memory limits such as a Slurm job's ([7f67da6](https://github.com/MrVPlusOne/takode/commit/7f67da6645a5badbe00a76553b71cb2e54f8f62d))
* **memory:** inject a kept memory catalog instead of scanning on demand ([0b25399](https://github.com/MrVPlusOne/takode/commit/0b25399e850668a82d13689082db62ef6b7c5ab9))
* **navigation:** choosing a thread closes a page open over the chat ([d1568a0](https://github.com/MrVPlusOne/takode/commit/d1568a0e9b56e814953eb040d1a1b5c3877bd1fe))
* **notifications:** keep unread results shown when the group-idle mark clears ([a2a2968](https://github.com/MrVPlusOne/takode/commit/a2a296861f06539cd5a12a671781315bb6f64323))
* **notify-me:** a reminder's time sits on one line on the thread strip ([50539e9](https://github.com/MrVPlusOne/takode/commit/50539e9af6995f767f3e993f4004d1830768c059))
* **notify-me:** reading a tracked thread's answer acknowledges its Notify Me result ([9a6108a](https://github.com/MrVPlusOne/takode/commit/9a6108af6686858ce3a1ee02897c8747e96c1628))
* **overview:** amber only for questions, blue for anything new ([bc88e73](https://github.com/MrVPlusOne/takode/commit/bc88e733d604f056eda4abf5a9ce1fe64ac987e4))
* **quest-links:** the thread icon always jumps, and a preview opens next to its link ([fb42bad](https://github.com/MrVPlusOne/takode/commit/fb42bad513ce16d053b1268c0591d4ce16db87e3))
* **quest-store:** linear quest linking and changed-only mutation journal ([717533e](https://github.com/MrVPlusOne/takode/commit/717533ed309b4323a63f04d5786d23252e5952ae))
* **quest-strip:** the Notify icon sits right before the phase pill, on the strip's line ([b9b0bf2](https://github.com/MrVPlusOne/takode/commit/b9b0bf2db63988b70123244ba2b7c62137031db7))
* **quests:** a quest waiting in Landing no longer blocks its worker's next claim ([1faff3f](https://github.com/MrVPlusOne/takode/commit/1faff3fd193f6414b072c067a514e28274234caf))
* **quests:** completion accepts work delivered to an approved published branch ([3b8b44d](https://github.com/MrVPlusOne/takode/commit/3b8b44dd544a948595849ebd3a4dba94bba584c4))
* **quests:** completion recognizes commits the landing queue already landed ([cbbbc62](https://github.com/MrVPlusOne/takode/commit/cbbbc6256a8cf254d1ee273d2bfa305c0e685d47))
* **quests:** no-code quests complete for a worker outside a git checkout ([53eb371](https://github.com/MrVPlusOne/takode/commit/53eb371046ebde9491f26efe20152e6bf1d27e89))
* **remote-hosts:** update a node before restoring its sessions ([249f08f](https://github.com/MrVPlusOne/takode/commit/249f08faa82b13172f2d12938326d43d93778fec))
* **restart:** interrupt the sessions of nodes the restarted server updates ([aec3a19](https://github.com/MrVPlusOne/takode/commit/aec3a19a7ef2ef35f7644ce706b8b3993c6fe695))
* **review:** close a guided review when a link inside it opens a session or message ([8426ee6](https://github.com/MrVPlusOne/takode/commit/8426ee6ec62c4125fdc18c71d108e39ec8e288de))
* **scribe:** archive a leader's Scribe with its leader ([f0bc499](https://github.com/MrVPlusOne/takode/commit/f0bc4995923ef1585bc6b7b32ce70e688ad5994b))
* **scroll:** code blocks and other embedded scrollers pass the wheel on to the page ([06840c6](https://github.com/MrVPlusOne/takode/commit/06840c633ee9ada70a0f7b4f74f09fe2ae197271))
* **search:** arrow keys step from the row shown as selected while new results settle ([f35418c](https://github.com/MrVPlusOne/takode/commit/f35418cfbd4f19a09c1f5e9557e60de779aaefd5))
* **search:** rank message matches by phrase, then newest, and search comment text ([9634b0f](https://github.com/MrVPlusOne/takode/commit/9634b0f4d1a9d530914ff6208f9c09ca8af2fe6f))
* **search:** Recent rows look up names only for thread conversations ([dd03f5b](https://github.com/MrVPlusOne/takode/commit/dd03f5bfe2614493a47b74f92273a24f369aa03b))
* **search:** rows of your own messages don't label themselves User ([15d86b1](https://github.com/MrVPlusOne/takode/commit/15d86b14a686fb60ef02cb395060829f30b96f6a))
* **search:** your own messages' results name their thread's conversation, never its topic: address ([d4149cc](https://github.com/MrVPlusOne/takode/commit/d4149cce0d4a441fe4a0c6da29f340f49461163e))
* **selection-menu:** a menu left open never stays on another chat, so only one can show ([dde12b3](https://github.com/MrVPlusOne/takode/commit/dde12b3654728b4d2856e84d98e62d577cc234bd))
* **session-store:** save cost follows the change in unfinished turns and after tool results ([38fbc0c](https://github.com/MrVPlusOne/takode/commit/38fbc0c8be3325bfde97cee222340665ee80a08c))
* **sessions:** continue turns cut off by a restart, and flag stopped helpers past the worker's own waits ([a2cc9e6](https://github.com/MrVPlusOne/takode/commit/a2cc9e6b5dbc2db90e05e39730a45a8d2f88d9f8))
* **sessions:** restart sessions with outdated instructions only when idle ([6dad7ff](https://github.com/MrVPlusOne/takode/commit/6dad7ff93181e1dd619c0f64248b0973dab56bcd))
* **sessions:** session [#0](https://github.com/MrVPlusOne/takode/issues/0) keeps its number, agent-browser skips every Takode wrapper, previews read as plain text ([3b03ade](https://github.com/MrVPlusOne/takode/commit/3b03aded257adaa4c91ebb3d95bc44f402c00834))
* **sessions:** skip server records in the sessions folder when loading sessions ([f5472ff](https://github.com/MrVPlusOne/takode/commit/f5472ffa963b6508978cd91091c85969df925940))
* **sessions:** start afresh when a process being taken over ended meanwhile ([34695d7](https://github.com/MrVPlusOne/takode/commit/34695d777d3e8b8055f8a016be3de2f8ed9dc8c8))
* **shortcuts:** make Off actually turn a preset shortcut off and show it as off ([67b88ba](https://github.com/MrVPlusOne/takode/commit/67b88bac760192e7bb5b69e9793e12c8cbd775e5))
* **shortcuts:** save Next Item Needing Attention overrides and explain refused recordings ([69b552e](https://github.com/MrVPlusOne/takode/commit/69b552e921075d9fdfe473c7abc3156cb7547756))
* **side-column:** a column saved with more conversations open starts within the limit ([bb4e4e2](https://github.com/MrVPlusOne/takode/commit/bb4e4e284937ed8c299141d310a6b6d6893153fe))
* **side-column:** a focused side pane reads its thread's finished-quest results ([a1120f4](https://github.com/MrVPlusOne/takode/commit/a1120f448bc8fd955e2d7f9971c0a58c4d6d1ba7))
* **side-column:** a message in a side pane shows the same Side quest and Continued in rows as in the main view ([6a48220](https://github.com/MrVPlusOne/takode/commit/6a48220dec26fe1abc2f1f2206748c1d8c4f9d40))
* **side-column:** a new thread's page names its leader with its portrait ([8a03e30](https://github.com/MrVPlusOne/takode/commit/8a03e30a3195b1d0f8619103b6873fd35dc41cd0))
* **side-column:** a question on a side row shows the amber bell, not a text pill ([62a3bdb](https://github.com/MrVPlusOne/takode/commit/62a3bdb2534d9607cbef00e06b687284ab7549c8))
* **side-column:** a Reply or comment in a side chat focuses the side chat's message box ([8fc580d](https://github.com/MrVPlusOne/takode/commit/8fc580d730cb3b44c8115c397060add95fbaf5a9))
* **side-column:** a row's dot shows what its quest waits on: amber for a question, green only while running ([8fa6e95](https://github.com/MrVPlusOne/takode/commit/8fa6e95325c116c1a069972420346ae1d026637d))
* **side-column:** a side quest's title bar shows the side-quest mark, as the main view's strip does ([ea75316](https://github.com/MrVPlusOne/takode/commit/ea75316262e844cba2edc0b23b0cdc09ba8a8956))
* **side-column:** an artifact's side chat receives its thread's live messages ([95330cf](https://github.com/MrVPlusOne/takode/commit/95330cf15e636f763f40af18870afd0a911f6180))
* **side-column:** closing the open side chat opens the chat below it ([f3af56b](https://github.com/MrVPlusOne/takode/commit/f3af56b905891f1dd7d2c2c9745e9eab63a82e10))
* **side-column:** comments and reply quotes go to the composer of the conversation they're made in ([ff9318f](https://github.com/MrVPlusOne/takode/commit/ff9318f936a5b10091bafc66904b284b51f361b4))
* **side-column:** merged threads turn into their conversation in place, without a loading page ([5ab9266](https://github.com/MrVPlusOne/takode/commit/5ab92661ddcf718cf3a167b97366784e041d7bb9))
* **side-column:** one-at-a-time applies to chats only, which share one height while the column scrolls as before ([940c700](https://github.com/MrVPlusOne/takode/commit/940c700f91d7750623dcd1d2a41be4db66a3b6c1))
* **side-column:** plain threads show their status dot instead of the thread icon ([aaccd02](https://github.com/MrVPlusOne/takode/commit/aaccd02c96f74462ce0bbee7ef27c16da6a5ca8c))
* **side-column:** Shift-click on a message link opens the message in the side column ([40e270f](https://github.com/MrVPlusOne/takode/commit/40e270f4a39029094ff7fa13d240e5fc84d679df))
* **side-column:** side chats catch up after a reconnect and say where a handed-off request continues ([61a6d19](https://github.com/MrVPlusOne/takode/commit/61a6d19c7b03f7f9bdb92162dea129b4228f58ef))
* **side-column:** status dots use only the four group colours, quest numbers are links, and an edge strip scrolls the column ([4f0201a](https://github.com/MrVPlusOne/takode/commit/4f0201a5e0ba7ea4007572c29eecd5f67685c0e6))
* **side-column:** the scroll strip runs beside each section's content, not its title bar ([ff8f8f6](https://github.com/MrVPlusOne/takode/commit/ff8f8f6543c4b783787133f44e8f87c2bdc6c783))
* **side-column:** the side column can widen until the main view reaches its minimum ([2b19941](https://github.com/MrVPlusOne/takode/commit/2b1994199c7d7d7b7caad69708ffc78b744471f4))
* **side-column:** with chats one at a time, removing the open chat opens another ([0b29ca8](https://github.com/MrVPlusOne/takode/commit/0b29ca8b266e5cf8f278ec3c9f274deeccec1d79))
* **sidebar:** keep the view-mode check out of the mocked settings module ([6f8898e](https://github.com/MrVPlusOne/takode/commit/6f8898ea209a7a8e61dce9eee2bfab1fdb061b60))
* **sidebar:** stop double-click from renaming sessions ([f7c4bbe](https://github.com/MrVPlusOne/takode/commit/f7c4bbe292757fa9e9ce13435231a3639b9ba711))
* **sidebar:** switching sessions no longer focuses and expands the composer ([2785bea](https://github.com/MrVPlusOne/takode/commit/2785bea3700ffe2849c8050d09852f03aa6b6e9b))
* **slack-copy:** copy plain text as Markdown so Slack keeps links and lists ([2ce91ec](https://github.com/MrVPlusOne/takode/commit/2ce91ecea3073b1c0e0e42273453ef47d9538070))
* **slack-copy:** keep links whose label is inline code as links ([ed05f66](https://github.com/MrVPlusOne/takode/commit/ed05f66c4a657402ab82513e5d8a7b6a2dac0792))
* **sleep-guard:** deny a session's long sleep with a hook instead of interrupting its turn ([d37ea0a](https://github.com/MrVPlusOne/takode/commit/d37ea0ab34d6a9fcb03b4d8c775ecc01a537e6a8))
* **slides:** settle every measured deck size so a slide can't flicker between two layouts ([aac6674](https://github.com/MrVPlusOne/takode/commit/aac667461aaf87371140f9be0f037e4bd078e7d3))
* **slides:** stop slides flickering and show code blocks whole ([3184df1](https://github.com/MrVPlusOne/takode/commit/3184df13aff88e61ac0a82094eb857717f49b7f1))
* start Takode commands outside the caller's directory so crowded folders can't slow them ([33537d5](https://github.com/MrVPlusOne/takode/commit/33537d54875e0eec9370c890c33fbfc47c2c545a))
* **storage:** route every localStorage write through a guarded setter and add a reset to the crash screen ([a108eac](https://github.com/MrVPlusOne/takode/commit/a108eac5a6e0bc89fef1dcb6d173576f4201c16b))
* **storage:** stop pasted images from filling localStorage and crashing the app ([92dbafb](https://github.com/MrVPlusOne/takode/commit/92dbafbd6e65e20b681865e8b04e2e7da7cefcea))
* **tabs:** one tab spins, and only for writing that isn't on screen ([cda6c63](https://github.com/MrVPlusOne/takode/commit/cda6c6343e6c37a4252ecedfa5463db09d73e147))
* **tests:** keep test runs below a container's CPU quota ([8be7298](https://github.com/MrVPlusOne/takode/commit/8be72985b95e908f4433a8802a98b67083d992ee))
* **threads:** a handed-off message names its quest once ([9ad9431](https://github.com/MrVPlusOne/takode/commit/9ad9431b2b7540cc39f95abc704b94eb0658f02c))
* **threads:** a leader's sidebar row counts threads, as its status row does ([e089e91](https://github.com/MrVPlusOne/takode/commit/e089e919084dd1c8e5c7f84498acef7224cfe094))
* **threads:** a Notify Me result isn't counted as unread in the Threads view, as in the status row ([e0ba6c5](https://github.com/MrVPlusOne/takode/commit/e0ba6c54426750e40a8169f0a8c2ecad1069ce54))
* **threads:** a quest's strip stays one row, its topic first ([8faae95](https://github.com/MrVPlusOne/takode/commit/8faae95d91df53617cd5a69c2dac52b6956ab39b))
* **threads:** a request handed off to a quest shows Continued in that quest ([ecd3dbb](https://github.com/MrVPlusOne/takode/commit/ecd3dbb124365ae8e254e7a88931263fbb58c3a6))
* **threads:** a second press on an open status row group closes its list ([85ec2e5](https://github.com/MrVPlusOne/takode/commit/85ec2e5e1bb7e768aa3cfb01662df62d8100cbd1))
* **threads:** a side pane reads and marks unread answers in its own feed when the main view shows the same thread ([063cb1a](https://github.com/MrVPlusOne/takode/commit/063cb1ad89be2cf5240298968007dbe42dc7b61d))
* **threads:** a thread merging into another conversation keeps the reader's place ([1a85ca9](https://github.com/MrVPlusOne/takode/commit/1a85ca9261c7903f22957ace53ce2708341627c5))
* **threads:** a Threads view row's update starts at the row's left edge ([1c18851](https://github.com/MrVPlusOne/takode/commit/1c1885110b3d8f703d6004d96625ee476ce1c2f0))
* **threads:** Ask in new thread sends, threads read by name everywhere, Next counts thread answers ([8dbfd8c](https://github.com/MrVPlusOne/takode/commit/8dbfd8ca59d81ff34836426e445ca483bfd03d7e))
* **threads:** rejected messages say so, dead threads can be removed, filings show at once ([596ffd4](https://github.com/MrVPlusOne/takode/commit/596ffd4e18f674c542f2082cda20719d5688e2a4))
* **threads:** side panes get answer state on refresh, and a chunked answer isn't rejected for a newer request ([fe42559](https://github.com/MrVPlusOne/takode/commit/fe42559100dbb7b2ea77006b2f7c47897f4ee1be))
* **threads:** started-from links and Recent rows name a thread, never its topic: address ([ddb256e](https://github.com/MrVPlusOne/takode/commit/ddb256ebc3cb7fa6b2a0f20fda08d50a12ecb5e1))
* **threads:** the status row stays within the main view beside the side column ([ffa01de](https://github.com/MrVPlusOne/takode/commit/ffa01de560684595baa54410a1122d503fca92d0))
* **todos:** keep the to-do editor focused while the list refreshes ([36cb893](https://github.com/MrVPlusOne/takode/commit/36cb893945a0a786cddbaf72d756baddc0c8d7ca))
* **todos:** keep the to-do sheet's layout when it is completed ([19d922a](https://github.com/MrVPlusOne/takode/commit/19d922ae0582184e5b4679027377fa7e47dc13f7))
* **todos:** plain titles keep underscores in identifiers and code ([e325432](https://github.com/MrVPlusOne/takode/commit/e3254322623bcd5539d3c7c34e5d83f200884238))
* **top-bar:** steady top-bar navigation; the Next chip at the feed's lower right on desktop ([df4c89a](https://github.com/MrVPlusOne/takode/commit/df4c89aba0283046139f7e8ae52abbee6ae44a05))
* **topics:** a quest at a User Checkpoint stops counting as running ([8e330bb](https://github.com/MrVPlusOne/takode/commit/8e330bbe43e98784ffa3c338b7a4df89c3662bd4))
* **topics:** a quest's strip starts where the conversation moves to it, also mid-turn ([1a3348c](https://github.com/MrVPlusOne/takode/commit/1a3348c1fd3d18c55819f2c4a24a40eda59e9ede))
* **topics:** no empty band above a pinned quest strip ([90d643d](https://github.com/MrVPlusOne/takode/commit/90d643d1442a74e2b6a2bc3ab9e69cd5ba4afecb))
* **topics:** quest strips only above final messages in topic conversations ([949fc03](https://github.com/MrVPlusOne/takode/commit/949fc03b6e4bf582ddd06dd6f6d67e145ee75ba6))
* **topics:** render topic page intros as Markdown and update pages without a click ([b02f13b](https://github.com/MrVPlusOne/takode/commit/b02f13b75fb85f262381775d46682167b1dee0b9))
* **topics:** the Topics bell rings only for what its list marks ([d0a085a](https://github.com/MrVPlusOne/takode/commit/d0a085a81abae2592a15ae08121a6a4a6c7406a4))
* **topics:** warn when leader output names a topic that doesn't exist ([30d7b92](https://github.com/MrVPlusOne/takode/commit/30d7b92b9bad24cc9aba24df6a99f1c4755d4bf2))
* **ui:** every collapsible section remembers whether it is folded ([26adcb6](https://github.com/MrVPlusOne/takode/commit/26adcb6b1c865dcf27bfb14af7ce13887b18624e))
* **ui:** judge a backdrop press whose release was not seen by where it began ([c5beae0](https://github.com/MrVPlusOne/takode/commit/c5beae08ffff6847b8ce15e919977bd273eea172))
* **ui:** keep dialogs open when a text selection or drag ends on their backdrop ([2220813](https://github.com/MrVPlusOne/takode/commit/2220813d8932ba10948ed3553d939967231220f7))
* **ui:** plain labels instead of internal ones in quest details, side quests, thread status, topics and Memory ([ac0dc84](https://github.com/MrVPlusOne/takode/commit/ac0dc84ff0f34e88747682c79b4f4ed5e5291ac8))
* **validation:** validation servers listen on loopback only ([b6cfc5b](https://github.com/MrVPlusOne/takode/commit/b6cfc5b473e52e139166578dd8234905bb482356))
* **visuals:** a cold Chrome start no longer counts against a visual's render time limit ([c7279e9](https://github.com/MrVPlusOne/takode/commit/c7279e9c17214b37ea510d7e7ebb14356fe8f312))
* **visuals:** install the visual-blocks skill and flag colours that don't suit the theme ([7c074f9](https://github.com/MrVPlusOne/takode/commit/7c074f9215d8b90960cf4cb9cfeab2f4146a8a88))
* **visuals:** report a runaway visual as crashed even when it settles between memory polls ([2225d10](https://github.com/MrVPlusOne/takode/commit/2225d101f069806b27857f655e2a89bfc59033bb))
* **visuals:** run the renderer's Chrome with a mock keychain ([3ee1ab0](https://github.com/MrVPlusOne/takode/commit/3ee1ab0ff38549546e80b3bbad76d8635fbbb477))
* **visuals:** scroll through visuals without blanks or redraws ([bd68db2](https://github.com/MrVPlusOne/takode/commit/bd68db2834c17576bcf3bdc9d25d8289ae503da9))
* **voice:** always enhance transcripts, however short or without context ([1b18c79](https://github.com/MrVPlusOne/takode/commit/1b18c79183c89d21c99c9e564bed10ea4ab35f83))
* **voice:** keep the speaker's wording when cleanup fixes misheard terms ([c3a7392](https://github.com/MrVPlusOne/takode/commit/c3a7392d7f3e2b798289f2aae0bde68fbd92cd80))
* **voice:** start the iPhone level meter in the record tap and resume it before replacing it ([157e81f](https://github.com/MrVPlusOne/takode/commit/157e81f11c15814eb589aca7ac818808255c6db1))
* **worker-stream:** accept reports from worker turns not routed to the quest ([7fc11c3](https://github.com/MrVPlusOne/takode/commit/7fc11c35b6bf4735f80da4a96aaa98ecfdf6123d))


### Performance Improvements

* **animations:** stop the page redrawing every frame while sessions run ([8af0cb7](https://github.com/MrVPlusOne/takode/commit/8af0cb7080edb9533d3e0c1939f150a03e593c8b))
* **feed:** show a jumped-to message and its surroundings first ([398da00](https://github.com/MrVPlusOne/takode/commit/398da002aaaa0fc10d8bb3c5c2e629bbcf6f196b))
* **home:** show Home's news lines and worker steps at once on a return visit ([19bbac1](https://github.com/MrVPlusOne/takode/commit/19bbac12cafe292ff9e77aaa6a2a2fe9130cd1ad))
* **images:** fast WebP settings and prepared chat images ([47de3b8](https://github.com/MrVPlusOne/takode/commit/47de3b814e3e6878fc51ac357e10d15cf8da1098))
* **projections:** publish synced projection changes at most every 100 ms ([525283b](https://github.com/MrVPlusOne/takode/commit/525283bd80c3781df36531c93048e9c719bfcb20))
* **quests:** run quest list text searches through the cached, yielding quest search ([2113b54](https://github.com/MrVPlusOne/takode/commit/2113b54ec4bf92c20189f0c45cc797fd53326c85))
* **server:** keep per-message caches on the messages instead of in WeakMaps ([4efc3b0](https://github.com/MrVPlusOne/takode/commit/4efc3b0ddd6f0ea085802e8490f5d9662a524bfc))
* **server:** stop whole-history and whole-store serialization from blocking the server ([9bcd5b5](https://github.com/MrVPlusOne/takode/commit/9bcd5b5dd6cff90b194d22496028aa4690973b0b))
* **session-store:** history files keep each row as JSON text, so restarts read them about four times faster ([ab16d70](https://github.com/MrVPlusOne/takode/commit/ab16d70c68446f9aa0a8536d133f466ad0a1b77a))
* **sessions:** count turns of a grown history from where the last count stopped ([bfe8b64](https://github.com/MrVPlusOne/takode/commit/bfe8b647bc2fc6a4e0f1860e71881e0e07bab420))
* **sessions:** keep launch instructions out of the launcher state file ([e4ee422](https://github.com/MrVPlusOne/takode/commit/e4ee4225c8a56579bcd84c62d62daf6e6d20428b))
* **sessions:** read long histories in linear time and append the first save after a restart ([87c2aa6](https://github.com/MrVPlusOne/takode/commit/87c2aa6653431f8914b73a1338dd574b2ffc2e8d))
* **threads:** build a topic window in one pass over the history, not one per quest ([3ac41c6](https://github.com/MrVPlusOne/takode/commit/3ac41c644357427c9e70df180fa840337d28969e))
* **threads:** read a leader's answers once per request, not once per quest ([90c984e](https://github.com/MrVPlusOne/takode/commit/90c984e06720a8176005c016b554b2a133464bb3))
* **threads:** stop re-reading every message's routing and answer text on each leader change ([aa6eb40](https://github.com/MrVPlusOne/takode/commit/aa6eb40544837eb6f3f2449503894e3639cf1379))
* **threads:** work out each message's threads once, in one shared module ([d7b0a5b](https://github.com/MrVPlusOne/takode/commit/d7b0a5b3cf107b658002a1daad9a180a358091ef))
* **topics:** look up thread handles in an index and write cursor moves at most once a minute ([7d6205f](https://github.com/MrVPlusOne/takode/commit/7d6205f5ba292341ea1714f7498060237a73da28))

## 2026-11-12

### Added

- **Ink fireworks for a finished quest** -- In Ink & Paper, a finished quest sets off three ink fireworks that burst in the painting between the message sheets, never across text, and a vermilion seal is pressed onto the completion card where it covers no writing. The celebration plays in the pane that holds the card, a side chat included, and is gone after about four and a half seconds.
- **Answers arrive like ink** -- With a scenic background on, a new answer spreads in from its centre like an ink blot.
- **The Library from the side column** -- The open side column's top row has the same gallery button as the folded rail, opening the Library in one click.

### Fixed

- **Scenic fonts** -- Scenic styles keep the app's fonts: Ink & Paper no longer sets a serif on headings, so answers with Markdown headings match the rest.
- **Your messages in the side chat** -- In the side column, your messages and their times take a deeper tone of the bubble, so they no longer blend into Ink & Paper's or Seaside's paper.
- **Choosing a thread over an open page** -- Choosing a thread while Settings, Questmaster or the Library is open over the chat closes the page, so on a phone the tap no longer seems to do nothing.
- **Session commands inside `takode exec`** -- `quest`, `takode`, `memory` and `stream` run through `takode exec` stop with a clear message that it carries no session identity, instead of failing with "command not found" or a bare 401.
- **Why Work-to-Memory refuses a note** -- When `takode board work-to-memory` refuses the Work note it was given, it names the rule the note breaks (kind, author, phase, occurrence or length) and how to add one that qualifies.

## 2026-11-11

### Added

- **Ink & Paper's sea of clouds and water** -- A sea of clouds now streams through Ink & Paper's valleys, lit silver by the moon at night, over a lake of real water that mirrors the peaks, clouds and sky, with ripples, short glints and a path of sun or moonlight. The pines sway in the same breeze and the boat bobs gently. The painting is glazed in light ochre and blue by day and stays ink at night, and switching sessions keeps the living scene running instead of restarting it.
- **Paper and silk** -- With Ink & Paper on, the interface itself is made of paper and silk, like a painting mounted as a scroll: your messages are painting silk, the composer, menus and cards are mulberry paper, and the top bar, tab bar and banners are mounting silk. The textures are still images that load only while Ink & Paper is on.
- **Slide decks in the Library** -- Reports published with `slides: true` are saved as slide decks, with their own Slides kind, a first-slide thumbnail and one history with the report they came from.
- **PowerPoint decks** -- `takode artifact publish` uploads a `.pptx`, with optional per-slide pictures, from whichever machine the session runs on. The Library keeps it as a slide deck versioned by title, searches its slide text and speaker notes, and shows it slide by slide with notes, full screen and a Download .pptx button.
- **Folded sections** -- `<details>` and `<summary>` render as a folded toggle with Markdown inside, in messages, reports and drafts (`<details open>` starts unfolded). Copy for Slack unfolds a section into a bold title and its text, and Read aloud says only a folded section's title.
- **Underline and Slack's own paste format** -- Drafts can mark underline with `<u>text</u>`. Copy for Slack now writes Slack desktop's own clipboard format, so drafts paste into Slack with underline, links, code, nested lists, quotes and code blocks as written.
- **Work delivered to several repositories** -- `takode board work-to-memory` and delivery recording accept several approved delivery targets, one per repository: each takes its own commits and is verified against its repository, and nothing is recorded unless every repository verifies.
- **Fable 5.2 through Copilot** -- The Claude Code Copilot setup offers Fable 5.2 to Claude sessions when the account's Copilot serves it, and leaves it out with a note when it doesn't.

### Changed

- **Each message on its own sheet** -- With a scenic background, each answer, card and activity group sits on its own sheet of paper instead of one opaque column, so the painting shows between them, and small labels on the painting (times, activity summaries, live lines) get a slip of paper. Message times stay inside the column.
- **Chats always one at a time** -- The side column always opens one chat at a time: opening a chat folds the others, and they share one height. The switch and the limit of three open conversations are gone, and a column saved with several chats open starts with one.
- **Compact Slack updates** -- A repeated Slack update notice carries little more than the new messages: a conversation's title and the thread it was read in appear only in its first notice, and the chip names who wrote.
- **Misheard names in dictation** -- Voice cleanup fixes misheard names using fuller context while keeping the speaker's wording: comment voice input gets its thread's conversation as dictation does, leader threads keep every agent reply in that context, and speech-to-text gets up to 48 key terms, your Settings vocabulary first. Transcription Detail shows the key term list.

### Fixed

- **A message being sent** -- A message still being sent looks as it will once delivered, with the day divider and time labels, so it no longer changes shape or moves when it lands; with a scenic background it is no longer wrapped in a dark oval.
- **Server stalls** -- A `quest list --text` search no longer freezes the server for up to a minute on large quest stores, and leader turns, the session list's refresh and topic saves take far less work, as does memory cleanup with long histories.
- **Faster restarts** -- Startup reads long session histories in linear time, and each session's first save after a restart adds to its history file instead of rewriting all of it, which took seconds for the largest sessions.

## 2026-11-10

### Added

- **Slack updates** -- When an agent reads a Slack thread or a direct-message conversation, the server checks it every 10 minutes with Claude Code's read-only Slack login and attaches new messages to the agent's next input. It never wakes the agent, and it stops watching a conversation a week after the last read. When the login has expired, Takode has Claude Code renew it.
- **Living Ink & Paper** -- Ink & Paper becomes a living ink painting drawn with WebGL: layered peaks with mist and clouds flowing between them, wet ink that slowly flows, a lake that mirrors the peaks, a drifting boat and, every few quiet minutes, cranes flying across. The scene hushes while you type, scroll or a reply arrives, steps down on a slow GPU, shows its still painting without WebGL, and draws a single still frame with reduced motion.
- **Threads in Universal Search** -- Universal Search lists every leader's threads whose name matches above the tab's results, and the threads you dealt with or viewed last when nothing is typed.

### Changed

- **Viewing a thread moves it up** -- A thread on screen in a focused chat for 2 seconds, in the main view or the side column, counts as dealing with it, so the Threads view and Home list it near the top on every device. Side column views also go into the Recently viewed list.
- **Scenic backgrounds stay put** -- No scenic background follows the mouse any more, and with one on, the conversation sits on a paper column so answers read as cleanly as your own messages.
- **New spinner and painted Tako** -- Every spinner is one thin ring, the dot beside live statuses breathes and then holds, disconnected sessions show a hollow ring instead of a plug, and the empty conversation and the no-sessions page show a painting of Tako asleep in place of the old cat art.
- **Fading scroll bars** -- Scroll bars appear while you scroll or hover them and fade shortly after, one at a time, so the side column and a pane inside it never show two side by side.
- **Idle pages stay idle** -- Status glows and pulses breathe three times and then hold, and spinners turn in steps, so a page with running sessions no longer redraws every frame.
- **Closing a side chat** -- Closing the open side chat opens the chat below it, else the one above, so closing chats one by one reads them top to bottom.
- **Status dots for plain threads** -- In the side column, a plain thread shows its status dot, grey when idle, instead of the thread icon.

### Fixed

- **Unread results in quest threads** -- Unread results no longer disappear from quest threads when a leader's idle group gets busy again.
- **Shift-click on a message link** -- Opening a message link in the other column opens the message's thread there, scrolled to the message, instead of the leader's Home, and a plain click on such a link in a side pane opens it in that pane.
- **Slack paste from plain text** -- Copy for Slack's plain text is Markdown, so Slack keeps links and lists when it formats the paste itself.
- **Stalls with many sessions** -- The server no longer rewrites every session's launch instructions on each state change, which with hundreds of sessions stalled requests and chat switches.
- **Landing across a restart** -- A landing gate that passes while the server restarts keeps its result instead of running again.

## 2026-11-09

### Added

- **Scenic backgrounds** -- Settings → Appearance can put a painted landscape behind the conversation: Summer Meadow, Seaside Town or Ink & Paper (off by default). Each style has day and night paintings for the light and dark themes and taller ones for phones, drifting clouds, haze or mist, and a reading veil that keeps text legible. Finishing a quest briefly lifts the veil with a fanfare, and a landing gets a small one; reduced motion keeps the painting still and skips the fanfares.

### Changed

- **Waiting for a pool slot** -- `takode lease run` and `takode exec --pool` print a line every 10 minutes while they wait, with the wait so far, the place in line and who holds the slots, and `takode exec status` shows the same. Starting a pooled command from one that already holds a slot of the same pool warns that it can deadlock, and the work board's alert for a worker stuck waiting for a lease says how long it has waited.

### Fixed

- **Selecting draft and visual titles** -- The titles of draft cards and visuals can be selected and copied.
- **Memory limits on macOS** -- `takode exec --memory-limit` on a Mac counts memory macOS has compressed (the footprint Activity Monitor shows), so a command can no longer grow far past its limit unseen.
- **Runaway visuals** -- A visual that eats memory is stopped and reported as crashed even when its page settles between two memory checks, instead of coming back fine.
- **Keychain dialogs on a Mac** -- The headless Chrome that draws visuals no longer touches the Mac keychain, so it can't pop up "Keychain Not Found" dialogs.
- **Artifacts beside their side chat** -- Opening an artifact's side chat keeps the artifact's own width, so a slide deck keeps its 16:9 stage; when the window is too narrow for both, the chat opens over the artifact's right side, and on a phone it still sits under it.
- **Steady slides** -- A slide whose notes about fill the column no longer flickers, a slide too tall for the stage always settles on the same zoom, and code blocks on a slide show whole.

## 2026-11-08

### Added

- **Shared compute budgets** -- A lease pool can be shared by many commands of one session, such as a worker's sub-agents. `takode exec --pool <name>` and `takode lease run <pool> -- <command>` hold a slot only while their command runs, wait in line quietly when the pool is full and free the slot when the command ends; without `--host`, `takode exec --pool` runs on whichever machine with that pool frees a slot first.
- **Timers that check before waking** -- A recurring timer created with `--check '<command>'` runs the command on the session's machine (or `--host`) at each tick and wakes the session only when it succeeds, which ends the timer. Every `--wake-every` failed checks (10 by default) it also wakes the session with the latest result, so a wrong check can't keep it asleep. Creating one runs the check once and refuses a check that can't run; the waiting list and Active Timers page show each check's latest result.
- **Stopped sub-agents** -- When a Claude session's process ends (a node update, an idle stop, the memory guard or a crash), the session is told which background sub-agents and commands stopped with it so it can resume them. The notice starts the session again, survives a server restart and shows as a collapsed chip; a session someone stopped on purpose stays stopped and is told when it next starts.

### Changed

- **Notify Me at a glance** -- While Notify Me is on or a reminder is set, the Notify button is a tinted pill with a filled target and a label, instead of looking the same as off.
- **Fewer node restarts** -- Restart Server restarts this machine's `takode node`, which ends its sessions' processes and their sub-agents, only when the code that node loaded changed, a few percent of commits. Nodes on other machines still follow every new build.

## 2026-11-06

### Added

- **Backups** -- The server backs up its data about once an hour: quests, memory with its full Git history, settings without secrets, to-dos, the Library, your instructions and skills, and the session list. Choose a private Git repository and/or a copy on one of your registered machines in Settings → Backups or with `takode backup`. Nothing is force-pushed, a weekly restore test checks the latest backup, repeated failures alert your phone, and `takode backup restore` rebuilds a `.companion` folder without a server.
- **Memory limits for remote commands** -- `takode exec --memory-limit 64G` kills the command and everything it started once together they use more memory than that, and its outcome says so. A node that can't enforce the limit refuses the option rather than running uncapped.
- **Other leaders' messages** -- In a leader's conversation, a message from another leader shows as a muted collapsed line with the sender's portrait, name and first line, opening to the full text on click, so your own messages stand out.

### Changed

- **Side column groups** -- The side column groups what you put in it by kind, above the followed topic page: chats, quest pages and other pages (artifacts, Homes, pinned topic pages) each fold on their own, and opening something unfolds only its group. Chats fold from a fixed Chats button in the top row; folded, a bar names each chat with its status dot, asking and unread first, after the bell and unread count. Pages get slim bars naming their kind while open and their title while folded.
- **One file per quest** -- Questmaster keeps each quest in its own file, so a quest change no longer rewrites the whole store, which took over a second on large stores. The server moves an existing store at startup after a verified backup and refuses quest changes until a failed move succeeds on a later start. Questmaster's local backup snapshots keep each quest version once and share the rest.
- **`takode exec` waits for long commands** -- `takode exec` always waits for its command, like a local command, and no longer fails after about two minutes. The command stops with its caller (an interrupt, a tool timeout, or nobody asking about it for five minutes). `--background` is retired, so finished remote commands no longer wake sessions for nothing, and Claude's Bash calls can ask for timeouts of up to a day.

### Fixed

- **Pasting into the composer** -- Pasted text goes into the composer even when the browser's own paste stops short. With the input trace on, recordings are saved to the server automatically (`takode input-trace` lists them) rather than only when you report a glitch.
- **Long sleeps** -- A Claude session's own long `sleep` is refused by a hook instead of interrupting its turn, so running sub-agents keep going, and sub-agents' sleeps are left alone.
- **Slack lists from drafts** -- Draft lines written with `•` bullets show as a list, and Copy pastes them into Slack as a real list.
- **Memory guard under Slurm** -- The memory guard reads cgroup v1 memory limits such as a Slurm job's, so it acts before the job's own out-of-memory killer.
- **Disconnected label** -- A Claude session relaunched while you watch no longer keeps a Disconnected label while it works.
- **Topic page intros** -- A topic page's intro renders as Markdown with working links, and Update no longer stays lit after an update; while a page is open, its waiting events reach the Scribe within three minutes.
- **Home and artifact chat drafts** -- Unsent text in a leader's Home box or an artifact's chat survives reconnects, such as switching apps on an iPhone.
- **Worker reports** -- Reports a worker sends with `takode worker-stream` from a turn started by a timer or a finished command reach its quest instead of being refused.
- **Board rows** -- `takode board set` refuses an archived, unknown or unherded worker, and a wait on an unknown or archived session, before changing anything.
- **Freezes with large data** -- Saving a very large session no longer blocks the server for hundreds of milliseconds after tool results or during long Codex turns, a quest store whose notes link many quests no longer blocks it for over a minute, and the memory catalog given to new sessions is kept ready instead of being scanned under a time limit that a busy server could miss.

## 2026-11-05

### Added

- **Reports in the side panel** -- On wide screens, the expand button on a report, draft or visual opens it in the resizable panel that slides in from the right, like images and files, so you choose its line length. Phones keep the full-window view, and slide decks keep their own full screen.
- **To-do category order** -- To-do categories keep the order you arrange (drag a header's handle, or Move up and down in its menu on touch), and a category whose to-dos are all Done can be archived.
- **New, deleted and renamed files** -- Guided reviews and diffs label files a change added, deleted or renamed.

### Changed

- **Voiceback reads questions** -- Voiceback also reads every new question: its explanation, then the question and its suggested answers. It is now a mode of the device rather than of one session: it follows the session on screen and comes back on after a reload.

### Fixed

- **Restarts with nodes** -- After Restart Server, a node on an older build is updated before its sessions are taken over, so they no longer load their history twice. Busy sessions on nodes updated right away are interrupted and continued, as sessions without a node are, and a session running outdated instructions restarts at its first idle moment instead of being cut off mid-turn.
- **Codex resume freezes** -- Resuming a long Codex session no longer freezes the server for 15 to 40 seconds, long enough to show it as unreachable.
- **Comments stay in their thread** -- Unsent comments you start in one of a leader's threads stay with that thread instead of following you to others and being sent there.
- **Plain thread status chips** -- A plain thread shows its Ready or Waiting chip in its own feed, however old it is.
- **Answers resent after a reminder** -- An answer a leader resends to its thread after a routing reminder stays visible there instead of folding into the activity.
- **Scribes of archived leaders** -- Archiving a leader archives its Scribe too, and no new Scribe starts for an archived leader.
- **Completing published work** -- Final completion accepts a change delivered to an approved published branch, instead of needing the leader's override.
- **Slack links with code labels** -- Copy for Slack keeps a link whose label is inline code as a link.

## 2026-11-04

### Added

- **Voiceback** -- A composer toggle reads each new final message aloud as it arrives: a leader's answers and reports, or the message another session's turn ends on. Arrivals play one after another, a leader's result read to its end is marked read, and the screen stays awake while it is on. Pausing other input sources moves to Session Info, and the paused banner gains Resume.
- **Drafts read aloud** -- Read aloud reads drafts in full after a short introduction, from the whole message or from a speaker in each draft card's header.
- **Download** -- The file viewer's Download saves a file's original bytes, from remote hosts too, with the PDF, image and web page exports beside it for Markdown files; a file link's menu offers Download for files that open outside the viewer. Report, slide deck, draft and visual cards list Download (their Markdown as written) beside Export, and the Library gives reports, tables and figures the same menu.
- **A chat in both views** -- Clicking move-to-side or Open in the main view while holding the Open in the Other Column key (Shift by default, in Settings → Keyboard) keeps the chat in both views, so it can be scrolled to two places at once.

### Changed

- **Message times on the tag line** -- A message's time shares a line with the answer tag, and your own messages' times sit beside the bubble.
- **Slide deck controls** -- A deck's controls are one centered group under the slide, in the card and in full screen alike. Play reads the deck aloud right in the card, a click on a slide turns to the next one and a right-click to the previous one (a tap on the left third on touch screens), and Space pauses and resumes the reading.
- **Guided review walkthrough** -- The walkthrough shows the code on the left and the explanation on the right, next to Back and Next.
- **Sending while images upload** -- Send pressed while an attached image is still uploading waits and sends once every image is ready, instead of being refused.
- **Keep-alive and keep-awake per machine** -- Each machine enforces Max Keep-Alive on its own sessions, with a per-machine override under Settings → Hosts, and each Mac keeps itself awake while its own sessions are mid-turn, switchable per machine.
- **Copy on draft cards** -- A draft card's copy button is called Copy, since drafts aren't only for Slack.

### Fixed

- **Notify Me after reading** -- Reading a tracked thread's answer acknowledges its Notify Me result, so Next no longer takes you back to it.

## 2026-11-03

### Added

- **Glossary** -- "Takode at a glance" explains Takode's terms for people coming from Claude Code or the Codex app, with a diagram of how leaders, quests, workers and the Scribe fit together. A Glossary link beside the sidebar's build label opens it and is highlighted until you first open it.
- **Attention cues** -- When a new question arrives its bell rings, and when new answers arrive their unread count pops, in the side column, the Threads view and the top bar.
- **Right-click menus everywhere** -- To-do rows open Takode's menu on right-click or long-press (status, due date, add below, move, copy, archive), and category headers get their own. Home rows, Questmaster and board rows, quest links in messages and topic pages, Library and topic artifact cards and side column headers also open Takode's menus instead of the browser's.
- **Integration tracks** -- A leader can declare a track (`takode track add`), an integration branch for a parallel line of work. `takode spawn --track` starts workers from it and makes it their landing target, and `takode track list` shows each track's workers and how far it is behind the branch it follows.
- **Sharing a worker's draft** -- `takode artifact share` posts a worker's Library draft into a leader's thread as the same draft card, with its versions, and makes the thread unread.

### Changed

- **Message times at the start** -- A message's time sits at its start instead of its lower-right corner: in the left margin where there's room, otherwise on a small line just above it. In a quick run of messages, times within three minutes of the first are left out.
- **One title per thread** -- Each thread shows one title, its quest's or its own name, followed in the strip, side title bars, Home rows and the Threads view by its news line, marked as an update. Round titles leave thread lists.
- **A news line for every result** -- The Scribe rewrites a thread's news line for every new answer, report or finished quest, saying what the newest result is about.
- **Threads view rows** -- Rows lead with the leader's portrait, ringed in the thread's status colour, with the update starting at the row's left edge, and hovering a row shows a hover card.
- **Home's Next chip** -- A leader's Home shows its Next chip at the lower right, as a conversation does.
- **Reporting input glitches** -- Input glitches are reported from Settings → Diagnostics or the shortcut; the sidebar button is gone.
- **Wider side column** -- The side column can widen until the main view reaches its minimum width.
- **Host offline alerts** -- A host going offline alerts only for sessions it actually stalls (mid-turn or with queued input), and the back-online event stays quiet when none of them needs resuming.

### Fixed

- **Leader answers with tool calls** -- A Claude leader's answer followed by a tool call in the same response counts as the answer instead of folding away, and a leader is reminded when it leaves a draft, image, table, visual or long result as commentary.
- **Board ownership** -- `takode board set` refuses a quest another active leader runs unless given `--take-over`, and removing such a quest leaves no trace in the leader's threads or Next.
- **Slash commands in threads** -- A slash command sent in a thread stays in that thread.
- **Slack syntax in drafts** -- Draft cards turn Slack's `<url|name>` links into real links, so Copy pastes working links, and warn about `<@U…>` mentions, which paste as plain text.
- **Thread counts** -- A leader's sidebar row counts threads as its status row does, and a Notify Me result isn't counted as unread in the Threads view.
- **Side pane on the main view's thread** -- A side pane showing the same thread as the main view reads and marks its own unread answers.
- **Closing the open chat** -- With chats one at a time, closing the open chat opens another.
- **Takeovers after a restart** -- A session whose process ended while the restarted server was taking it over starts afresh, instead of looking connected while its messages go nowhere, and a Claude turn that gets no output at all restarts its backend.

## 2026-11-02

### Added

- **Input trace** -- Settings gains a Diagnostics section. Its input trace, off by default, keeps the last hour of input activity in the browser (never the characters typed), and Report input glitch, a sidebar button while it records, in Settings or on a shortcut, sends it to the server log for diagnosis.
- **One chat at a time** -- The side column has a one-at-a-time mode for chats: opening one folds the others and it takes their shared height, while the column scrolls as before.
- **Quest chips in side conversations** -- A quest's side conversation shows its quest chips and the side-quest mark, as the main view does.
- **Tooltips on every button** -- Takode draws button tooltips itself, and every icon button has one.
- **Cleaning up worktree registrations** -- `takode worktree unregister` drops a registration without touching files, `takode worktree list` marks checkouts that no longer exist, and archive cleanup drops temporary registrations whose checkout is gone instead of reporting them blocked.

### Changed

- **Unread bars** -- Each unread answer gets a short blue bar beside its first line, in the left margin, so nothing shifts when it appears or goes. Once the answer is read the bar stretches briefly and turns grey, staying until the chat loses focus.
- **News on topic pages** -- Each open quest on a topic page shows its news line, and Home's By topic view shows every running, unread or asking thread of a topic, not only three.
- **Needs attention by thread** -- The attention list, its Next order and its counts go by thread rather than by Library topic.
- **Faster Home** -- Returning to a leader's Home shows its news lines and workers' latest steps at once.

### Fixed

- **First paste on a Mac** -- The first Cmd+V with nothing focused pastes into the composer instead of only focusing it.
- **Artifact side chats** -- An artifact's side chat shows the leader's answer as it arrives instead of staying on "Sending...".
- **Comment chips in side panes** -- A comment chip in a side pane opens the comment there, and an open comment holds back only its own composer's Send.
- **Answers in joined threads** -- A thread joined onto a quest shows all its answers, so they can be read and its "N new" clears.
- **Duplicate leader answers** -- Reminders to answer wait until a Claude leader is idle and are checked again before sending, so a leader no longer answers the same request twice.

## 2026-11-01

### Added

- **One side column for every leader** -- What you put in the side column stays when the main view switches to another leader or to a worker's session; each pane names its leader with its portrait and keeps working over that leader's connection. The leaders' separate columns merge on first load. A leader's Home can open in the column as a switcher: a click in it opens the thread in the main view and the Home stays.
- **At most three open side conversations** -- Opening a fourth conversation in the side column folds the one used least recently, which stops loading its live messages until you unfold it, where it catches up at the same place. Pages, artifacts and quest details don't count. A new thread starts at the height you last gave a side conversation, and the arrow beside New thread shows the portrait of the leader a plain New thread goes to.
- **Searching your own messages** -- Typing in Universal Search's Recent tab searches every message you wrote, in every session, archived ones included. The Messages tab becomes Assistant: one leader's replies and events, starting on the leader you are viewing.
- **A side chat about an artifact** -- In the Library, an artifact pane in the side column or an artifact's own window, a leader's artifact has a button that opens a chat with that leader about it, and commenting on its text opens the chat too. It sits beside the artifact on wide screens and under it otherwise, the leader is told which artifact and version it is about, and reopening the artifact shows the same thread.
- **Starring from the feed** -- Reports, slide decks, drafts, visuals and guided reviews in a conversation have Star or Unstar in their More menu, the same star as the Library's, kept in step on every device.
- **Scribe context limit** -- Scribes keep running instead of being replaced after a day, and Settings → Sessions → Topics and Scribes sets how much context a Scribe keeps before compacting (256K tokens by default). A change restarts running Scribes so it applies at once, and Session Info measures a Claude Scribe against its limit.
- **Lean 4 and Rocq highlighting** -- Fenced `lean`/`lean4` and `rocq`/`coq` code blocks and `.lean`/`.v` files are highlighted.
- **Memory guard on hosts** -- On Linux machines, `takode node` watches memory every 2 seconds and, at 90% of the machine's or container's limit, stops the largest process tree its sessions started and tells that session why, so a runaway job can't take down Takode itself. Each machine also gets a Note for agents setting, added to the instructions of every session that runs there.
- **Checkouts on other machines** -- `takode worktree register --host <machine>` records a checkout that lives on another machine, such as one made with `takode exec --host`; its checks and its removal at archive run on that machine, and nothing is removed while the machine is offline.

### Changed

- **Home lists each thread once** -- A leader's Home lists its threads like the sessions panel's Threads view: questions pinned on top, then by when you last dealt with each thread, with All, Needs you, New and Running filters and a By topic view of the same list. Rows use Home's width for the thread's news line, the question it asks, a running quest's worker and latest step, or a finished quest's commits, and Home widens with the main view.
- **Threads view by your last interaction** -- The sessions panel's Threads view lists threads by when you last wrote in them or read or dismissed their results and questions, with questions pinned on top; an unread result no longer moves a row. Rows drop the quest number so titles get the room (hover shows it), and right-click or long-press opens Takode's menus: rename and archive on leader rows, and open, open in the side column, open quest or worker, mark read or unread, remind me later and copy link on thread rows. New with a leader opens its Home ready to type.
- **Status row** -- The status row's groups run Home · Idle · In progress · Unread · Needs you, the urgent ones nearest the bell, and on desktop the row is slimmer. When the thread on screen changes group, a floating tab naming it glides from the old group to the new one. A second press on an open group closes its list. Cancelled quests are left out of the row and the Threads view.
- **One quest chip** -- An unfinished quest's chips in its feed fold into its phase chip at the top right, on desktop and phones alike: one tap opens the Journey with the worker, reviewer, commits, changes and waits under it. The feed keeps room above its first message so the chip never covers it.
- **The Scribe names new threads** -- A new thread reaches the leader's Scribe at once, which names it before or right after the leader's first answer. Whether a thread continues an earlier conversation is asked only once it settles, a thread whose request went to a quest joins only that quest, and the Scribe can undo a wrong join of its own.
- **Short thread addresses** -- Threads get short numbers like quests (t-1, t-2, ...), which leaders use to route answers, questions and handoffs.
- **Folded leader turns** -- In a leader thread that is not Ready, the latest turn folds the activity before its newest final message (an answer, a result, a question, a report or the quest's completion card) and keeps what came after it open.
- **New markers** -- When unread answers are scattered among read ones (after the Scribe joins a thread onto an older conversation), each gets its own small New tag, and the unread pill steps through them. A reply that arrives while you are watching the chat gets no New marker.
- **Scrolling a chat focuses it** -- A wheel, trackpad or touch scroll inside a chat focuses it, in the main view and side panes alike, as a click does.
- **Reopened quests by their newest round** -- Thread rows, quest strips and side column titles name a reopened quest by its newest round, with the quest number and title second.
- **Code around a guided review stop** -- The code around each stop is read from git when the stop is viewed, with Show more adding 20 lines at a time; when it can't be read, the stop says so with Retry.
- **Every transcript enhanced** -- With transcript enhancement on, every voice transcript goes through it, however short and with or without conversation context.
- **Hosts follow the coordinator's build** -- `takode node` updates itself to the coordinator's build by default; start it with `--no-auto-update` to opt out.
- **Even Home rows** -- Home's rows are three lines high: the title, a one-line news line whose full text unfolds on hover or long-press, and the status.

### Fixed

- **Thread names everywhere** -- Started-from links, Recent rows, search results and answer alerts name a thread, or the conversation it joined, instead of showing its internal address.
- **Merging keeps your place** -- When the thread on screen is handed to a quest or joined onto an earlier thread, the view switches to that conversation at the same messages, still following a reply that is streaming in.
- **Results read in side panes** -- A focused side pane reads its thread's finished-quest results, so its "N new" no longer stays lit.
- **Scrolling over code blocks** -- A code block that shows all its lines passes the wheel on to the page, and a capped one scrolls until its edge and then lets the page scroll.
- **Report bars in quest threads** -- A report's pinned collapse bar sits flush with the top of a quest thread's feed.
- **Handed-off messages** -- A message moved into a quest names the quest once, not in both its label and its Continued in row.
- **Leader activity groups** -- A leader's note sent with its first command no longer splits one run of commands into two groups.
- **Voice edits in comments** -- A voice edit in a comment editor shows the composer's preview with the changed words highlighted, Undo and Accept.
- **iPhone voice level meter** -- The level meter no longer stays flat for whole recordings on iPhones.
- **Completing landed work** -- Final Memory recognizes commits the landing queue already landed after rebasing them, instead of refusing until the worker resets its checkout.
- **Stopping remote commands** -- `takode exec kill` also stops processes that left the command's process group, such as `timeout` pipelines, and a worker disconnected while its command runs is no longer flagged as stalled.
- **HTML files on remote hosts** -- HTML file links from a session on a remote host open, with the page and its assets read through that host.
- **Visuals in the dark theme** -- Sessions outside the Takode repo now get the visual-blocks skill, so their visuals no longer use fixed light colours that glare on the dark theme, and `takode visual preview` flags light boxes and low-contrast text.
- **Replies in side panes** -- A reply that begins with thinking keeps its place in a side pane instead of jumping to the end of the feed, and a side pane's refreshes send the newest messages once you are back at them.

## 2026-10-31

### Added

- **Threads by status** -- A leader's threads are now the one place to see what needs you. A status row under the top bar groups every thread of the leader, quest threads and its other threads alike, as Needs you, Unread, In progress and Idle: a thread is In progress only while work goes on in it, and a running thread with an unread result shows under both. The Board button returns to the top bar.
- **Home** -- A leader opens on Home instead of its Main conversation: its threads, each with a line of news written by the leader's Scribe (or, until it writes one, the latest summary an agent wrote), a line counting what changed since you last looked, and a message box that starts a new thread. Main's own messages are read in the leader log.
- **Threads view in the sessions panel** -- A Threads view replaces the Topics view: every leader's threads in one list with their leader's portrait, a line of news and amber, blue and green counts, then the leaders and other sessions in folding groups. When the panel is narrow, the view switch becomes a dropdown.
- **Threads joined by the Scribe** -- The Scribe joins a new thread onto the earlier conversation it plainly continues. Its messages then read there after a marker naming the earlier conversation, with Undo, and its address opens that conversation.
- **Leaders open threads** -- A leader can open a thread of its own for a proposal or question that belongs to no quest or thread yet, so it shows by name under Needs you.
- **Side chats with another leader** -- A chooser beside New thread in the side column starts a thread with any leader, which that leader answers and files.
- **Running commands on any machine** -- `takode exec --host <machine> -- <command>` lets sessions run a command on a registered host or the coordinator's machine, in the user's own login shell, with its output and exit code. Long commands run in the background and tell their session when they end; Settings → Hosts can turn it off per machine.
- **One focused chat** -- Among the main view and side panes one chat is focused: typing goes to its composer, a click focuses a chat, and an answer arriving in a chat that isn't focused stays unread until you look at it. A thin line marks the focused chat while side panes share the screen.
- **Code around a guided review stop** -- Each stop's code shows the code around its lines, dimmed.

### Changed

- **Topics become tags** -- Topic conversations, the breadcrumb, the Overview menu, the side column's overview and Recent list and the sessions panel's Topics view are retired. Topics stay for browsing: topic pages open beside a conversation and from Home's By topic view.
- **Every leader has topics** -- Library topics can no longer be turned off, and the older tab row, tab closing and Main/All toggle go with that mode.
- **Thread strips and quest chips** -- A thread's strip holds its name, Notify Me and, on desktop, a button that moves the thread to the side column. A quest's phase, worker, reviewer, waits and commits float as chips at the top of its feed. Threads don't close; Home in the status row is the way back.
- **Side chats are threads** -- Side chats are called threads throughout. When the leader hands a thread's request to a quest, the thread becomes the quest's thread, and its pane turns into the quest's conversation in place. A link clicked in a side pane opens in that pane, and the open-in-side click opens it in the main view.
- **A scrolling side column** -- Every section of the side column folds on its own, any number can be open, the column scrolls, and dragging an open section's bottom edge sets its height. A strip beside each section's content scrolls the whole column.
- **Status colours** -- Every thread status mark uses its group's colour and no other: amber needs you, blue unread, green in progress, grey idle. A side row's question shows the amber bell, and its quest number is a quest link.
- **Questions and answers stay out of Main** -- Leaders ask and answer in the thread a matter belongs to, or a new thread, instead of Main, which is now only the leader's log.
- **Replying reads earlier answers** -- Sending a message or answering a question in a leader's thread marks the thread's earlier unread answers and results as read.
- **Read aloud starts sooner** -- Read aloud starts playing as soon as the first sentences are spoken instead of waiting for the whole message.
- **Faster restarts** -- Session history files load about four times faster when the server starts.
- **Remind me later in hours** -- Remind me later's custom amount starts in hours and remembers the unit you last chose, on every device.
- **Composer on phones** -- The collapsed composer sits a little higher above a phone's bottom edge.

### Fixed

- **Crash from full browser storage** -- A full browser storage no longer crashes the app on every load, and the crash screen has a button that resets this browser's saved Takode state.
- **Remembered folds** -- Every collapsible section remembers whether it is folded, including the archive, Scheduled Runs and Memory folders, without one tab overwriting another's choice.
- **Holding still while scrolled up** -- Sending a message or saving a comment while scrolled up keeps the view exactly where it was.
- **Merging threads in place** -- A thread handed to a quest or joined onto another conversation turns into it in place, without a loading page.
- **Side panes** -- Messages in a side pane show the same Side quest and Continued in rows as in the main view, a new thread's page names its leader, and answer state stays current after a refresh.
- **Turns cut off by a restart** -- Sessions whose turn was cut off by Restart Server continue it, instead of stopping until their next message.
- **Workers waiting on a landing** -- A quest waiting in the landing queue no longer keeps its worker from claiming the next quest.
- **Quests without a checkout** -- A quest that changed no code completes for a worker that works outside a git checkout.
- **Underscores in titles** -- Titles and summaries keep the underscores in identifiers such as `QA_DATASETS_1031`.
- **Reminder times on a strip** -- A Notify Me reminder's time stays on one line on a thread's strip.

## 2026-10-30

### Added

- **Slide decks** -- A report whose Markdown opens with `slides: true` shows one slide at a time, with a slide list, swipes, a full-screen Present and a PDF export with one page per slide. A `Notes:` line starts a slide's speaker notes, Play reads them aloud while it turns the slides, and a comment can be made on a whole slide.
- **Artifacts in their own window** -- Cmd-click (Ctrl-click off Mac) on an artifact link or gallery card, or Open in new window in a card's menu, opens the artifact in a window of its own that keeps up with new versions.
- **Leader overview** -- The side column opens with the leader's overview, what needs you and what runs now across its topics, and the top bar's Working on picker becomes an Overview menu with the same lists, one line per row, ordered by the leader's Scribe.
- **Topics view in the sessions panel** -- A third view beside Spaces and Recent lists every leader's topics and side chats, each with its leader's portrait and counts of questions, new results and running quests; hovering a row lists them.
- **Resizable secondary view** -- The view holding Artifacts, Questmaster, Settings and Memory has a draggable edge, and its width is kept as a share of the window.
- **Report visuals** -- The visual kit adds a colour per actor, dashed zones and captions. Table buttons show on hover, and full-screen reports with four or more sections list them at the top.

### Changed

- **The Scribe as background support** -- Topic pages drop the Now list and its tick buttons. Each leader's Scribe instead keeps one to three lines of where the topic stands at the top of the page, rewritten on every update; a quest log lists the topic's finished quests with their wrap-ups; and the Scribe can tell its leader about loose ends. Each page opens with a sentence saying what belongs in it, and the Scribe checks new filings and redraws topic edges with one Undo.
- **Pictures on topic pages** -- A topic page shows when each picture was redrawn and says when the pictures are newer than its text, and the Scribe brings the text up to date.
- **Topic conversations** -- Interleaved progress of quests running in parallel folds into one Progress card, and a request sits under the strip of the quest it continued in, also when that quest is under another topic.
- **Tabs stay open** -- Leaders on the breadcrumb no longer close tabs. The breadcrumb's "Not in a topic" lists every quest of the leader that has no topic, and right-click or long-press on the Next chip opens the conversation's attention list.
- **Session hover cards** -- Active quest rows in a session's hover card open that quest's thread.

### Fixed

- **Leaving a quest** -- The × on a quest's breadcrumb band goes to its topic's conversation, and a leader left on a topic's conversation reopens there.
- **Open in the side column** -- The open-in-side click never opens a new browser window. It opens in the side column what a plain click opens, including a quest's details and another session's conversation, and scrolling a side feed no longer moves the main chat.
- **Comments with a side chat open** -- Comments, reply quotes and edits go to the message box of the conversation they were made in, which also takes the focus.
- **Side chats after a reconnect** -- A side chat catches up with the replies written while the phone was locked, and a request handed off from it shows where it continues.
- **User Checkpoints are not running** -- A quest waiting at a User Checkpoint counts as a question, not as running.
- **Pasted images and browser storage** -- Pasted screenshots no longer fill the browser's storage and crash the app.

## 2026-10-29

### Added

- **Breadcrumb and side column** -- Leaders with topics navigate by a breadcrumb under the top bar, on desktop and phones alike: its first part picks the place (Main, all threads, a topic, quests under no topic), its second the quest or thread. Beside the conversation, a side column (a sheet on phones) stacks the topic page with side chats, other conversations, topic pages and Library artifacts. Shift-click opens a link there (another modifier can be chosen in Settings → Keyboard), and Ask in side chat starts a side chat about a selected passage. Side chats replace the Threads menu, and their drafts sync between devices.
- **Topics for every leader** -- Library topics and Scribes are on for every leader by default, with a Settings switch to turn them off. Topics are kept broad and few: the Scribe checks each new topic and merges the quietest ones once a leader has more than about 15.
- **Titles on pinned report bars** -- Deep in a long expanded report, the pinned Show less bar names the report.

### Changed

- **Main names each request's quest** -- In Main, a strip naming the topic, quest and status sits above each request that moved into a quest and sticks while that part is read.
- **Where conversations open** -- A conversation returns to where you left it only if it is one of the last three places you left or you left it within 30 minutes. Otherwise it opens at its latest messages, with a pill counting the unread answers above.
- **Next chip on desktop** -- The Next chip sits at the feed's lower right, as on phones, and the top bar's navigation keeps its place whatever the session name's length.

### Fixed

- **Rejected messages** -- A message the server can't accept says so, with Retry and Edit, instead of staying at "Sending..."; a thread whose first message never arrived can be removed; and the Scribe's filings show at once.
- **Continued in after a handoff** -- A request handed off to a quest shows where it continues, as one filed from it does.
- **Quest link icons** -- A quest link's thread icon always jumps to the thread, and previews open next to their link.

## 2026-10-28

### Added

- **Folding the desktop sessions panel** -- A lock button beside "Search everything" unlocks the desktop sessions panel. Unlocked, it folds up to its top row in the top bar's line, so the conversation gets the full width, and drops down over the chat when the mouse rests on that row. A tap toggles it on a touch screen.
- **Exporting reports** -- A report card's More menu holds Open in Library, Copy Markdown and Export as Markdown, PDF, image or web page; PDFs and images are drawn by the server from a clean light page of the report. Drafts and visuals keep their Library link, source and exports in the same menu.
- **Copied drafts** -- Copy for Slack dims the button of each part already copied, on every device and after reloads, and a new version keeps that mark only for parts that did not change.
- **Threads** -- A leader with Library topics gets a Threads menu next to Topics. New thread starts a lightweight conversation with the leader that is not a topic, and Ask in new thread on selected text starts one with the passage attached. Reading a thread's last answer settles it, and the leader's Scribe files a settled thread under an existing topic where it plainly belongs. Recent lists every thread you have read, newest first, with a search box; Working on still lists only quests.
- **More to say on a reply card** -- A needs-input reply card has an Additional comments box for anything beyond the answers to its questions.

### Changed

- **One amber signal per place** -- On a desktop leader's top bar, Topics and Working on no longer carry a bell: the Next chip carries this conversation's next question or unread result, and the attention count carries every session's. The Next chip sits right after Topics.
- **Leader tabs in the top bar on desktop** -- A desktop leader with topics on has no separate tab row: Main, All and Topics sit in the top bar after the session name, and the Next chip and a Working on menu (which now also opens the work board) sit before the attention bell. The model and access line moves to the session name's tooltip.
- **One-line quest strip** -- A leader's quest strip shows the topic, quest and title, the Notify Me icon, the phase pill and the close button on one line. Worker, reviewer and commits move into the phase pill's card, where a quest's recorded commits and its worker's uncommitted changes are separate chips that open their part of the diff. Notify Me also sits beside Open Thread in the quest preview and quest view, and the quest view counts memory commits apart.

### Fixed

- **Opening unread results** -- Next and the attention lists open a topic's first unread answer, and a Notify Me result opens at the answer it reports, never at the commentary around it. The Topics tab's bell lights only for what its list marks.
- **Quest strips in topic conversations** -- A topic conversation shows a quest's strip only above a turn with a final message (your message, an answer, a report or a question); a run of working steps from another quest gets a small quest label instead.
- **Top-bar navigation after switching leaders** -- Desktop leaders' top-bar controls no longer show twice after switching to another leader and back.
- **Threads by name** -- Ask in new thread delivers its first message. Threads show their name, not an internal key, in the attention list, phone alerts, the search scope and message labels, and open the thread. The Next chip counts unread answers in threads and topic conversations, and a question asked in a thread no longer opens a tab.
- **Selection menus across chats** -- A text selection menu left open no longer stays over the next chat after switching chats with a shortcut or a notification.
- **Search arrow keys** -- Arrow keys in search step from the row shown as selected while new results are still arriving.
- **First visual after a restart** -- The server's Chrome starting up no longer counts against a visual's render time limit.

## 2026-10-27

### Added

- **Posts with replies** -- A drafted Slack post and its thread replies show as one card, each part with its own Copy for Slack plus Copy all. A part can attach files, shown under it with Copy image. A revision can repeat only the parts it changes, and the card marks parts that are new or edited and lists removed ones.
- **Where a draft goes** -- A draft can name the Slack channel, thread or pull request it is for; the card shows a "Post in ..." link that opens it, kept across revisions.
- **Reading full screen** -- Report, post and visual cards open full screen over the whole window, with the same controls, and comments made there highlight in the feed too.
- **Type anywhere to write** -- On desktop, typing or pasting with nothing else focused opens the composer with that text, and Enter opens it empty; Escape collapses it and keeps the draft. A switch in Settings → Keyboard turns it off. Switching sessions no longer opens the composer by itself.
- **Urgent answers** -- A leader can mark an answer urgent. It gets its own section in the attention list right after the questions, turns the attention pill red, always sounds and sends an "Urgent result" phone alert while unread, with its own phone alert switch.
- **Searching topics** -- A search box in the Topics list and the topic panel filters a leader's topics by name and latest update.

### Changed

- **Message times with their day** -- Message times say how old they are ("Yesterday 2:13 PM", "Mon 2:13 PM", "Oct 19, 2:13 PM") and roll over at midnight. While you scroll an older stretch, a small pill names its day and how long ago it was, then fades.
- **Shorter composer** -- The collapsed composer is about a quarter shorter.
- **Topics have their own thread** -- Messages written in a topic conversation go to the topic's own thread, where the leader answers them or moves them to a quest, as with quest threads. Answers, unread, reminders and reports work there too, and the topic's messages seen elsewhere are labelled with its name.
- **Quest link previews** -- Hovering a quest link's text opens the full quest preview; hovering the thread icon shows only the title, so clicking the icon always jumps to the thread.
- **Desktop feed controls** -- The feed's navigation buttons fade after scrolling stops, and a desktop leader's Next chip sits right after the thread tabs instead of over the text.

### Fixed

- **Repeated draft versions** -- When a leader sends the newest version of a draft again, earlier copies collapse like older versions. The Library link moves into the draft's own card header.
- **Tab spinners** -- Only one tab spins for a leader's writing, and none for writing already on screen.
- **Quest strips mid-turn** -- A topic conversation starts a quest's strip wherever the conversation moves to that quest, also inside a turn.
- **Controls under pinned strips** -- The feed's top controls and a report's collapse bar sit below a pinned quest strip instead of behind it, without an empty band above the strip.
- **Image viewer in background chats** -- A chat kept loaded in the background no longer leaves its full-screen image viewer over the next chat, and its thumbnails still open.
- **Mistyped topic names** -- A leader that writes to a topic that does not exist is told so, with the closest topics, and handing a Main request to a topic's thread works.

## 2026-10-26

### Added

- **Sending comments with an answer** -- When you have unsent comments, needs-input question cards offer "Include my N comments", which sends them with the answer.

### Changed

- **Topic-first tabs** -- A leader with topics on has three tabs: Main, Working on (its unfinished quests) and Topics, which holds every quest tab, with each topic's row showing work in progress, new answers and Notify Me. Leaders with topics off keep the status groups.
- **Unread per message** -- Answers and reports count as read once they have been on screen for a second in any view, with a "New" line above the first unread one. Counts show places rather than messages: each question, each watched result and each topic (or quest or Main) with new answers counts once.
- **One attention order** -- The attention list is one order that Next walks: questions, reminders that came due, unread answers grouped by topic, then watched results. Any question or unread answer can be reminded later (30 minutes, 2 hours or tomorrow at 9 AM).
- **Topic pages as dashboards** -- Topic pages track the topic's current state, every section folds and remembers it, and each page ends with the topic's latest artifacts and all its quests. Quest views name the quest's topic in place of its tags and open the topic's conversation where the quest was last discussed.
- **Scribes in the sidebar** -- A leader's Scribe sits last in its herd with its own icon, and the herd summary names it instead of counting it as a worker.
- **Faster large leaders** -- Long leader sessions no longer stall the server when they are opened, saved or searched, and quest writes no longer serialize the whole quest store. A jump to a message shows it and its surroundings first, before the rest of the window.

### Fixed

- **Library captures** -- Drafts, tables and reports in a Claude message whose text arrived after its thinking are saved to the Library, and history skipped that way is read again once.
- **Messages queued during a turn** -- A message sent while Claude runs a turn and answered in the next turn no longer counts as unanswered in between, so leaders are not reminded to answer it twice.
- **Scribe status** -- A Scribe that finishes its work after stopping early no longer stays marked as stopped.

## 2026-10-25

### Added

- **Topics tab group** -- Leaders with topics on get a Topics group right after Main, listing every topic by recent activity with its latest update and what waits on you; choosing one reads it as one conversation. A topic's name above a quest's strip, a "Part of" line at the start of its conversation, and the topic page's "Read all N quests" open that conversation, and a quest tab can zoom out to its topic and back without losing your place.
- **Now on topic pages** -- A topic's Now is a list of entries in fixed groups (waiting on you, waiting on someone, in progress, next, to try), which Scribes add and remove and which show at once. Each leader's own entries come first, and an entry can be marked done with Undo. Waiting on you lists the topic's open questions.
- **Requests for a topic page** -- Lasting requests for one topic's page, or for how topics are grouped, are saved as instructions the Scribe keeps following.
- **Quest rounds** -- A quest reopened for each step of sequential work reads as a series of rounds, each with its own title, brief, requests and outcome. Quest details show the open round first and earlier rounds one line each, and round links open one round.
- **Recording controls** -- While recording, the composer's button row shows a cancel button, the running time and the input level. On touch screens, undo and redo buttons cover typing, pastes, transcripts and drafts synced from another device.
- **Copy image** -- Both image viewers have a Copy image button that puts the image itself on the clipboard, so it pastes into Slack and other apps as an image.

### Changed

- **Search everything replaces Find** -- The tab bar's Find is gone. Search everything's Messages lists every message newest first when there is no query, and each quest in Quests mode has a Tab button that opens its tab in its leader.
- **Topic pages** -- Pages pick sections by what a topic is about around Now and History; Main's topic list shows what moved, newest activity first, with each topic's latest update. Scribes get updates within seconds after a quiet spell and in 30-second batches during a burst, back off after failed turns, and start on their leader's machine.
- **Phone mic with AirPods** -- On an iPhone with AirPods connected, voice input records with the phone's own mic so it starts at once, and the recording bar shows "Preparing mic..." until audio flows. "Mic with a headset" in Settings keeps the headset mic instead.
- **Session rows** -- Swiping the phone sessions panel left closes it, rows no longer archive on a swipe, and double-clicking a row no longer renames it; both stay in the row's menu.
- **Images in Markdown** -- Every image embedded in Markdown opens full size in the image viewer, and plots on topic pages refresh when their file is rewritten.

### Fixed

- **Crash after an update** -- A page that crashes after a server update reloads into the new version by itself.
- **Topic conversations** -- A topic conversation catches up on what arrived while the phone was away, opens without stalling the server on large topics, and the topic panel keeps one width across leaders.

## 2026-10-24

### Added

- **Topic conversations** -- A quest tab whose topic holds other quests can open the whole topic as one conversation, the quests' threads stitched in time order, each quest's strip pinned while its part is read. Live work and local images show there too.

### Changed

- **Topic pages lead with what is going on** -- A topic page opens with what the topic covers and a Now section (waiting on you, in progress, next and limits), built from what its quests left open, then its history. The panel lists open quests and the newest artifacts, and topics can be turned on per leader with `takode topic on`. On phones the topic panel slides in from the right and closes with a swipe.
- **Notes in the Journey timeline** -- Quest notes recorded outside any phase sit in the Quest Detail Journey timeline where their time falls, as one-line rows that expand.
- **Quest quizzes when they help** -- Quests get a quiz only when you asked for one, when the quest answered a request for an explanation or research, or, rarely, when something is especially important to know.

### Fixed

- **Quest link hover cards** -- A quest link's hover card closes after the link was clicked, including after switching windows.
- **Guided reviews in the Library** -- A guided review opened from the Library shows the review card with Start the review, as in chat.

## 2026-10-23

### Added

- **Library** -- Takode saves what agents make for you (drafts and posts, reports, guided reviews, visuals, tables and figures) in a Library, with revisions grouped as versions; older versions collapse to one line in the conversation. The gallery shows one kind at a time with search, filters and stars, and opens an artifact large with Copy for Slack and a link to its message. Agents can link artifacts in messages, with a hover card.
- **Topics and Scribes** -- Leaders can turn on topics (off by default). Each quest is filed under a topic in your words, and a Scribe, a quiet background worker in each leader's herd, keeps a page per topic up to date from the leader's activity. Topic pages live in a panel beside the conversation that follows the quest tab on screen. Renaming a topic you named is only ever a suggestion.
- **Visuals in answers** -- Agents can draw diagrams, timelines, comparisons, charts and other visuals in any answer, report or guided review, in Takode's look and both themes. Each runs sandboxed, so a broken visual cannot hang Takode: one that hangs or slows the page is stopped and shown as a still picture with Run. Scrolling past visuals shows no blanks or redraws.
- **File viewer** -- Every file link opens inside Takode, read on the machine that holds the file: folders with image thumbnails, code with line numbers and the linked lines marked, logs at their end. Open in VS Code (and Cursor) is a button there, using Remote-SSH for machines set up in Settings → Hosts.
- **Comments on code in guided reviews** -- Select lines of a stop's code to comment on them; comments go to the agent with the file, lines and quoted code.
- **`takode read --raw` and `--quote`** -- Print a message's exact text, or a Markdown quote of it with its sender, time and link, so leaders can carry your exact words into quests.

### Changed

- **System theme** -- The theme setting offers Light, Dark and System, which follows the device and switches live. The VS Code theme is retired; a browser that used it starts on Dark.
- **Jump to a quest's thread** -- The icon after a quest link opens the quest's thread tab, on phones too; hovering it still previews the quest.
- **Two Next shortcuts** -- Next Item in This Session and Next Item Across Sessions are separate shortcuts, and stepping no longer shows a banner saying where it went.
- **Image viewer** -- The image viewer shows the file's size and download progress, dims the previous image while the next loads, and opens large screenshots at once instead of waiting for a compressed copy.
- **To-do sheet** -- The to-do sheet has the list's check circle beside the title, with fireworks on completion and Undo on a second tap.

### Fixed

- **All Threads history** -- All Threads keeps loading older history on busy leaders, where it could stop after one page.
- **To-do editing on phones** -- The keyboard no longer closes while editing a to-do, and completing a to-do in its sheet no longer moves the title.
- **Commands in crowded folders** -- Takode commands start just as fast from folders with hundreds of thousands of entries, and Settings → Hosts names any remaining folder that slows a machine down.

## 2026-10-22

### Added

- **Guided review walkthrough** -- A guided review walks through one stop at a time: an overview with counts of decisions, careful looks, checks and summaries, then each stop with its explanation and code side by side on wide screens, then a wrap-up with your answers and an optional message about the whole review. It uses the whole window on desktop, and Back, Next, the arrow keys or a swipe move between steps. Leaders can share a worker's review into their own thread, and treat answers as feedback rather than orders to implement.
- **Alert sound sets** -- Each device picks its alert sounds in Settings → Notifications: Classic, Singing Bowl, Lounge Piano or your own uploaded sounds, so people sharing a room can tell whose alert rang.
- **Animal portraits** -- A new Animals set of leader portraits is the default, offered once to existing users, with a larger desktop picker whose groups collapse. Leader portraits are a quarter larger in the desktop sidebar.
- **Instant return to recent chats** -- The last few chats you viewed stay loaded in the background, so going back to one is instant and exact. Expanded reports and long messages are kept on the server, so they stay expanded in every browser.

### Changed

- **Message search order** -- Message search ranks the exact phrase first, then whole words, then partial words, newest first within each, and finds the text of comments sent on answers.
- **Worker preview in every active phase** -- A quest tab shows its worker preview whenever the quest is in an active phase.
- **Transcription keywords** -- Workspace terms of one or two characters, and terms already in your custom vocabulary, are left out of transcription keywords.
- **Quest handoff rows** -- "Work continued" handoff labels are gone from the feed, since the "Continued in" row under your message shows where a request went; a new row sweeps a sheen across itself once so it is noticed.
- **Leaders acknowledge first** -- A leader that needs tool work before replying starts with a short line saying what it is about to do.

### Fixed

- **Dialogs and text selection** -- Selecting text in a dialog and letting go over its backdrop no longer closes the dialog.
- **Keyboard shortcut settings** -- Off turns a preset shortcut off, Next Item Needing Attention keeps its custom keys, and recording a shortcut another action uses, or one the browser keeps, says why it was refused.
- **Finished quest results** -- Opening a finished quest's unread result lands on its Quest complete card, or on the unread answer next to it.
- **Links inside guided reviews** -- Session and message links inside a guided review close the review and open their target.

## 2026-10-21

### Added

- **Guided reviews** -- Agents can publish a guided review of a set of commits with `takode review`, covering every changed line: the stops that need your decision or a careful look come with their code and an answer field, followed by what the agent checked and summarized, and the full diff is a tap away. Answers sync across devices and go back to the agent as one message.
- **Copy for Slack** -- Assistant messages and selections have Copy → For Slack, which keeps the formatting Slack supports and turns tables into aligned code blocks. Each table has its own Copy menu (for Slack and spreadsheets, as a code block or as Markdown).
- **Draft cards** -- Agents hand over message drafts as cards that show the draft as it will look, with a Copy for Slack button that copies exactly the draft.
- **MCP sign-in** -- The MCP panel can sign in to servers that need it, including ones provided by Codex plugins, also from a phone by pasting the address the sign-in ended on. Claude sessions show live MCP status with tools and can sign in, reconnect and turn servers on or off.
- **Remind me later for threads** -- The Notify button in a quest's strip, and a new one for Main, can bring the thread back later (1, 6 or 24 hours, a custom amount or a day and time); a due reminder alerts like a Notify Me result.

### Changed

- **Alerts open at the message** -- Phone alerts open at the exact question or result, and opening an unread thread lands on its first unread result.
- **Skill change notices** -- A small change to a skill a session loaded arrives as a diff against the version that session saw.
- **Find** -- Find's Messages list pages back to the session's first message, and a second click on an open tab group opens its first tab.
- **Worker preview** -- A quest tab's worker preview also shows helper sessions and what the worker waits for.
- **Portraits** -- Tapping a leader's portrait in the sidebar opens the session; the portrait picker is in Session Info.
- **Transcription keywords** -- Automatic transcription keywords leave out everyday spoken words and repeats.

### Fixed

- **Phone selection menu** -- The selection menu opens clear of iOS's own edit menu, and tapping Copy shows its formats.
- **HTML links in the Home Screen app** -- In the iPhone Home Screen app, links to Takode-hosted pages open in an in-app sheet instead of replacing the app.
- **Voice level meter** -- The level meter keeps working when Safari pauses its audio during a recording.
- **Notify Me on side quests** -- Turning on Notify Me for a side quest no longer surfaces its old result.

## 2026-10-20

### Added

- **Side quests** -- Quests whose answer comes back where they were asked are marked as side quests with a small icon in the tab lists and quest header. Writing in a side quest's tab, answering a question there, or a leader answer or report there makes it a full quest.
- **Transcription knows your workspace** -- Voice transcription also gets recent terms, quest titles and activity from the whole session space, so names used elsewhere are heard correctly.
- **OpenAI test key** -- Settings → Voice has a separate OpenAI key for agents' tests and validation servers, keeping their spend off the main key.

### Changed

- **Faster Read aloud** -- Read aloud starts in seconds, replays recorded audio for a message read before, reads published reports, and mentions links and commits naturally. Copy items in the message menu sit in one Copy submenu.
- **Long code blocks** -- Long code blocks show in a scrollable window with their line count and an expand button.
- **Markdown as typed** -- Headings in your messages stay as typed, while dividers, tables and images render as in replies.
- **Images at full quality** -- The image viewer shows screenshots at full quality, compressed as high-quality WebP to cut traffic, and every image copy Takode makes (uploads, thumbnails, agent copies) uses WebP.
- **Codex sessions follow your Codex setup** -- Codex sessions get your Codex settings, plugins, hooks, developer instructions and provider key, rebuilt at every launch.
- **Faster `takode activity`** -- `takode activity` reads only the recent part of each history and reads archived sessions from records saved at archive time.

### Fixed

- **Dictation never lost** -- A dictation that finishes after you switched sessions, reloaded or the phone suspended is kept for its draft and applied once by the next browser that shows it.
- **Sending while scrolled up** -- Sending a message while reading older content keeps your place.
- **Codex internet toggle and Revert** -- The internet access toggle controls Codex's web search, and Revert works with current Codex.
- **To-do send keys** -- Adding and editing to-dos follows the send-key setting, and the quick-add box has an Add button.

## 2026-10-19

### Added

- **Read aloud** -- Assistant messages can be read aloud, rewritten for listening first, with a player for seeking, speed and voice.
- **Back, Forward and Recently viewed** -- The desktop sidebar header has Back and Forward buttons and a list of recently viewed sessions and tabs.
- **Quiet worker turns** -- A worker can mark a turn quiet when it holds nothing its leader needs; the leader is not woken for it and sees it folded into the next real event.
- **Waiting on a helper** -- A quest in Work can wait on a helper session, such as one that runs a step on another machine, without tripping the stall alert.
- **Small celebrations** -- Completing a to-do sets off a small burst of fireworks, a freshly finished quest's card twinkles and a landed change pops a check, and tabs glide visibly into their new group. Nothing plays with reduced motion.

### Changed

- **Calmer quote previews** -- With a mouse, each line quoted above an answer has a small "open" link that previews just that message; tapping on touch screens opens them in full as before.
- **To-do sheet on desktop** -- On desktop the to-do sheet opens as a wide dialog with the text on the left and every control on the right.
- **Lighter reconnects** -- A phone returning to Takode downloads only what changed while it was away.
- **Report cards** -- Every Markdown report shows as a clipped card, also in expanded turns.

### Fixed

- **Following the conversation** -- Only reaching the real bottom resumes following new messages, so a worker preview's updates never pull you down while reading.
- **Comment editor on iPhone** -- The comment editor stays above the iPhone keyboard.
- **AirPods recordings** -- Recordings on an iPhone with AirPods are no longer near-silent.
- **Message corner times** -- The message options button takes clicks under the corner time, and on phones a short answer's time gets its own line.

## 2026-10-18

### Added

- **Message times** -- Every message in the feed shows its time in its lower-right corner, hidden when the next one on that side follows within 3 minutes.
- **Pending messages in place** -- Messages waiting to be delivered show as faded bubbles where they will land.
- **What an answer answers** -- Each leader answer quotes the message it answers, which opens in full on hover or tap, in Main and All Threads too. The Quest complete card sits at the moment the quest completed.
- **Self-improvement skill** -- Every session gets a skill for turning a correction or repeated mistake into a proposed fix to instructions, skills or code.

### Changed

- **Questmaster list** -- Questmaster is one list that adapts to the screen: sortable columns on desktop and two-line rows on phones, with a status bar of counts.
- **To-dos page** -- The to-dos page is lighter: a one-row header, quiet rows that open the shared to-do sheet, swipe to complete or for more actions on touch screens, quick due dates, and categories that collapse.
- **Search everything** -- The sidebar's search field spans the header as "Search everything" and shares its sheet with the leader's Find.
- **Quests started from a message** -- Under your message, every quest filed from it shows as "Continued in" or "Side quest" with its title, which opens its thread.
- **Codex leaders compact** -- New Codex leaders use Codex's built-in compaction instead of recycling; recycling stays available in Settings.
- **Fewer invented precautions** -- Agents keep gates, waits and extra checks they come up with out of what they ask you to approve, treat a standing grant as covering later actions of that kind, and ask you right away when work waits on something only you can do.
- **Host updates without long interruptions** -- Hosts updating to the coordinator's build get ready first, including commits the coordinator never pushed, and stop their sessions only once ready.
- **Raising lease pools** -- A lease pool's capacity can be raised while its slots are held.

### Fixed

- **Sent messages** -- Every `takode send`, including leader-to-leader sends, shows as a sent message.
- **Codex prompt on Copilot** -- Codex sessions on providers without a model cache get Codex's own built-in prompt.
- **Needs-input cards** -- A needs-input card shows wherever its explanation is shown.
- **Voice rerun mode** -- A voice rerun's chosen mode is remembered for the next voice input.

## 2026-10-17

### Added

- **Transcription instructions** -- Settings → Voice takes custom instructions for the transcription cleanup, such as an output style or a language to always translate into, and the cleaned text is used as returned.

### Changed

- **Alert sounds from every session** -- New questions and newly unread tabs sound from any session, unless that tab is already on screen in a focused window.
- **Side quests stay quiet** -- A quest filed from a request that stays in its thread no longer makes its own tab unread when it completes; the leader answers where you asked, and your message shows the quest's progress.
- **Messages between leaders** -- `takode send` to a leader names the receiving thread, so messages between leaders land in the right tab.
- **Codex models** -- Codex model pickers list the models your account offers, in Codex's order, and a chosen model or Default survives relaunch.
- **Smaller updates** -- Notification, attention and session-group lists are sent as changes rather than whole lists.

### Fixed

- **Read markers** -- Leader read markers no longer show as question-like chips in the feed, and unread rows and previews name the actual result in plain text.
- **Reconnecting in the background** -- A phone app woken briefly by an alert no longer downloads the whole session state just before sleeping again.
- **Expanded report cards** -- An expanded report has a collapse control pinned on screen, and comments on a report show its file name.
- **Back and forward to Main** -- Browser back and forward reach Main again.
- **Handoffs and quest strips** -- "Continued in" shows as soon as a request moves to its quest, and the quest strip's close button stays at the top right.
- **Codex leaders on hosts** -- Codex leaders on remote hosts reach the Takode API through their host.
- **Delivery from existing checkouts** -- Sessions started on an existing checkout can record quest deliveries.

## 2026-10-16

### Added

- **New results** -- A leader can post a result nobody asked for, and it makes its thread unread like an answer; publishing a report does too. `takode activity` lists both.
- **Cleaner phone alerts** -- Tapping a Takode alert clears outdated ones, and the app icon's badge counts the questions waiting.
- **To-do status on links** -- To-do links show each to-do's live status: Todo, Doing, Done, overdue, archived or gone.
- **Quest links to their source** -- A quest's thread links back to the message it was filed from.
- **Find lists messages** -- A leader's Find lists Messages and Tabs, both newest first.
- **Skill change notices** -- After a restart onto new code, a session is told which of the skills it loaded have changed.

### Changed

- **Commit diffs on phones** -- The commit diff view has finger-sized controls on phones and wraps code lines behind a remembered Wrap toggle.
- **Next chip on desktop** -- The session's Next chip sits at the feed's top right on desktop.
- **Lighter saves and traffic** -- Large sessions save without stalling the server, and unchanged session lists and completed boards are no longer sent again.

### Fixed

- **New instructions after a restart** -- Relaunched Claude sessions, and processes kept running across a restart, get Takode's current instructions.
- **Stale board rows** -- A row left on a paused or archived leader's board no longer blocks the quest for the leader running it, and leaders can clear it.
- **Feed stability** -- Answer thumbnails no longer reload when you send a message, answered questions keep their context in collapsed turns, and worker questions fold into worker-event groups.
- **Other leaders' messages** -- Messages from other leaders start their own turn in Main and All Threads too.
- **Copying Takode links** -- Copying text turns links back to Takode into plain text instead of localhost URLs.

## 2026-10-15

### Added

- **To-do due dates** -- Personal to-dos can have a due date and time. Overdue to-dos show in red with a count on the To-dos button and send one phone alert, with its own switch in phone alert settings.
- **Acting from a to-do link** -- A to-do link's preview can change its status, edit it and set its due date.
- **Naming a new session** -- The New Session dialog has an optional Name field.

### Changed

- **Unread from results** -- A leader thread becomes unread for a new answer or a finished quest, not for every status update, and messages from other leaders start their own turn.
- **Direct to-do adds** -- Agents add to-dos directly and say where each came from; to-do proposals are retired. Changes that could lose track of something still need your approval in the session or a written standing approval, and previews show who added a to-do and what authorized the last change.
- **Waiting chip** -- Timers, jobs, landing runs and queues share one waiting chip with an icon per kind.
- **Small touches** -- The `[transcribed]` tag sits on its own last line, saving a comment with the send key returns to the composer, and session cards show the backend icon first.

### Fixed

- **Alerts open the right tab** -- A phone alert opens the exact leader tab it came from, also after the app was asleep.
- **Timer chip on desktop** -- The timer chip and other floating controls stay visible above the expanded desktop composer, and `takode timer list` shows the time left.

## 2026-10-14

### Added

- **Reminders about waiting questions** -- When questions stay unanswered while you are away, Takode sends one summary reminder through Pushover and Web Push after 2 hours without activity, then at doubling gaps, at most 3 a day and never during quiet hours (11 PM to 9 AM). Activity means a message, an answer, or a tap or key press in a Takode window; an open screen alone does not count. The reminder opens the attention list, and all of it is configurable in Settings next to the phone alert rules.

### Changed

- **Pages and viewers float over the app** -- The side-by-side mode is retired. Pages, quest details, files and diffs opened from the chat always slide in from the right over the whole app, sized to their content. The app behind stays inert while one is open, Escape closes the top one, and opening a session from quest details or a file closes them.
- **Quest view actions** -- Add Feedback is a filled button on the right, the action row keeps Edit and Delete on the left and the status and Finish Quest on the right, and Delete confirms in place. The manual Assign and Rework buttons are gone. On phones, Open Worker and Open Thread sit in a pinned footer within thumb reach, in the quest view and in the quest preview sheet.
- **Instant session revisits** -- Going back to a recently viewed session shows it at once from what the browser holds, without downloading unchanged data again.
- **Real worktree folders in Settings** -- Settings → Hosts shows each machine's actual default worktree folder, from the home directory the machine reports.

### Fixed

- **Status-bar blur on iPhone** -- iOS no longer leaves its blurred status-bar band over the Home Screen app's top bar after a full-screen preview closes.
- **Pages scrolling the app** -- Scrolling past the end of a page that floats over the app no longer scrolls the whole app.
- **Answered questions in Main** -- Answered questions that belong to a quest thread no longer repeat in Main.
- **Recreating a vanished worktree** -- A worktree recorded through a symlinked folder, such as macOS's `/var`, is recreated on its session's own branch.

## 2026-10-13

### Added

- **Conversation stays loaded under pages** -- Questmaster, Memory, Settings and the other pages open as a view over the current session instead of replacing it, so the conversation stays loaded and comes back instantly at the same scroll position. The address keeps the session and adds the page, and old page links open over the current session.
- **Session settings in the title** -- The session title shows model, effort and access on one line, and a tap opens Session Info, which starts with a settings menu for model, effort, Codex speed and access. Session Info also shows the session's leader, workers or reviewers as chips and its quests, current one first. The composer's separate control row is gone.
- **Recent sidebar view** -- The sidebar can list sessions by most recent interaction across session spaces, each card keeping its herd.
- **Reopening closed quest tabs** -- Find lists a leader's closed quest tabs and reopens them.
- **Microphone choice** -- Voice input can use a microphone chosen while recording, and Takode remembers the order you prefer them in.
- **To-do and proposal links** -- Agents can link a to-do or a to-do proposal in a message. Tapping one opens a preview, where a pending proposal can be approved or rejected, and a small marker shows each link's kind and each proposal's status. Proposals now only add to-dos; agents make changes that cannot lose track of anything (adding text, quest links, Todo or Doing, restoring) directly, and everything else still needs your approval.
- **Recovering sessions after a host moves** -- When a host comes back on a new machine, its sessions relaunch: a missing worktree is recreated on the session's own branch, and a Claude conversation that is gone continues in a fresh one. The session is told what was kept and what was lost before any other input. Each machine can set its worktree folder in Settings → Hosts, so worktrees on storage that outlives the machine survive the move.
- **Host outage alerts** -- When a remote host goes silent, a leader gets one alert per host listing its affected sessions (mid-turn, with input waiting or working an active quest) and a note when the host is back. Messages to a session on an offline host wait for the host instead of being reported delivered, and herd events for a leader on an offline host arrive once it returns.
- **Press feedback** -- Every control responds visibly to a press, buttons that call the server show a pending state, and Send and Reply squish when pressed. A Send press that cannot send now says why next to the button, and a message that cannot reach the server keeps its draft and says so.
- **Web search for Claude on GitHub Copilot** -- Claude sessions served through GitHub Copilot get a working web search tool backed by Copilot's own search, and WebFetch works there too.
- **Changes in the Restart section** -- Settings → Restart lists the commits Restart Server would load and the commits the current build brought in, with when each landed.
- **macOS places in the folder picker** -- On a Mac, the folder picker offers Home, iCloud Drive, Desktop, Documents and Downloads.

### Changed

- **One attention list** -- Muted questions and tracked Notify Me tasks move into the top-bar attention list, replacing the separate needs-input and Notify Me menus. The sidebar's top row holds just search and Quests, and the amber attention chip counts only the open questions.
- **Takode messages as chips** -- Every message Takode injects into a conversation, including landing-queue notices, reminders and recovery notices, shows as one family of collapsed chips with a one-line summary instead of a full message bubble. The full text is a tap away, and the agent still receives it unchanged.
- **Reports in collapsed turns** -- A collapsed leader turn shows the reports it published as a clipped preview that expands in place.
- **Report comments** -- Comments on a published report go to the session showing it, like any other comment, and can be mixed with other comments, images and replies. They name the report's file instead of internal IDs.
- **Tab order follows your chats** -- Inside a status group, a tab also moves up when you write in it or the leader answers you there. Background activity does not move tabs.

### Fixed

- **Restart, PATH and shutdown regressions** -- The previous release accidentally shipped without three earlier fixes: Restart Server updating its checkout first (and its "Update the checkout before restarting" setting), sessions getting the machine's login-shell `PATH`, and the bounded wait that lets restarts always finish. All three are back.
- **Backends on the selected machine** -- The new-session dialog offers the backends the selected machine actually has, instead of checking the coordinator's machine.
- **Memory edits** -- `memory write` refuses to save over a note that changed since the session last read it, and asks the agent to read and merge first.
- **Jumping to a message** -- A message reached by a jump stays in place while images and cards load around it, including on iOS Safari.
- **File links with spaces** -- File links whose paths contain spaces, such as iCloud Drive's, render as links, and single tildes in prose stay literal.
- **Activity and turn durations** -- Activity group headers span from the first call's start to the last call's end instead of summing call times, and every turn summary shows its duration up to the agent's last activity.

## 2026-10-12

### Added

- **Thread tab status groups** -- Leader thread tabs show as one row of status groups on every screen size, replacing the tab strip: Main, then Needs you, In progress, New results and Done, each with its count, and Find to search every tab by title or quest number. A group of one opens its tab on a tap and a larger group opens its list; a long-press or right-click opens any group's list. Inside a group the tab that joined it most recently comes first, and the tab on screen glides into its new group when it moves.
- **Closing the tab on screen** -- The quest strip ends with a close button for the tab on screen. Closing slides it away and opens the next tab in the same group, or Main when the group is empty. A small spinner marks where the leader is writing.
- **Images in agent messages** -- Image paths render as file-name links that open the image viewer at that image, and the viewer shows the full path with a Copy button. `![caption](/path/to/image.png)` reserves its thumbnail from the first render and shows "Image missing" when the file cannot be fetched, including files on a remote host.
- **Swiping between images** -- A sideways swipe on an unzoomed image moves to the previous or next image in the viewer.
- **Markdown files inside Takode** -- Tapping a Markdown file link opens it in an in-app viewer, read on the linking session's machine, instead of an editor link that phones and remote files cannot open. Relative links inside it open further files.
- **Worker limit per leader backend** -- The number of workers a leader may run is a Settings value per leader backend, 8 for Claude leaders and 5 for Codex leaders by default.

### Changed

- **Quest view header on phones** -- The full quest view's header is compact on phones, with tags, commits and related quests in one wrapping row of chips that expand.
- **Quest status labels** -- The quest preview and the quest view show the same status (the active Journey phase, else Idea, Refined, In Progress, Done or Cancelled) and the same section names.
- **Inline quest links** -- The preview eye after a quest link sits in the text like a glyph, and is hidden on touch phones, where tapping the link already opens the preview.
- **Needs-input reminders** -- Needs-input reminders in the feed start collapsed as a readable one-line chip in both themes.
- **Next on the attention chip** -- The feed's attention chip reads "Next" instead of naming the item's kind.
- **Sidebar timer badge** -- A waiting leader's timer shows as a small clock on its portrait's corner instead of timer text.
- **Composer buttons** -- The collapse-all and minimize buttons are removed; the composer still collapses on a press outside it.
- **Commit attribution** -- Claude sessions no longer add "Co-Authored-By: Claude" or "Generated with Claude Code" lines to commits and pull requests.
- **Proposed improvement quests** -- Leaders propose quests for problems they notice themselves and wait for your approval before filing or dispatching them.

### Fixed

- **User Checkpoints ended by hand** -- Ending a checkpoint by hand keeps its questions open as non-blocking questions, and a planned checkpoint that a side question used up is put back. User Checkpoint dots use a real amber in the light theme.
- **Results read only when seen** -- A thread's results count as read only after it has been on screen for two seconds with the page visible, so a quest no longer moves to Done while its answer flashed by unseen.
- **Leader view after reconnect** -- After a reconnect or a move from Main to a quest thread, a leader's live view stays on the thread it shows.
- **Feed without late jumps** -- Notifications and thumbnails this browser already loaded appear with the conversation instead of pushing messages down a moment later.
- **Menus and popovers on touch** -- A second tap closes a menu or popover opened by a tap, including the session info panel, and popovers close as soon as a finger lands outside them.
- **Open Thread right after dispatch** -- Quest previews and views find a dispatched quest's leader before its worker claims it.
- **Quest complete card** -- The Quest complete card stays at the turn where the quest completed instead of moving to the latest turn.

## 2026-10-11

### Added

- **Your instructions and skills on every machine** -- Takode can keep your personal instructions (for all agents, Claude only or Codex only) and skills once on the coordinator and deliver them to `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` and the Claude and agent skill folders on every machine, so plain and Takode sessions read the same copy. Either store may link into a Git checkout. Setup and migration run as an agent task: Settings shows each machine's state and hands the job to a session you pick, which uses the new `takode user-content` commands. Files Takode did not write are replaced only with your approval, everything replaced is backed up, and Takode's own skills win a name clash. The [user instructions and skills guide](docs/user-instructions-and-skills.md) has the details.
- **Questions put quests in User Checkpoint** -- A leader's question in a quest's thread moves the quest into User Checkpoint on the work board until its last question is resolved, then back to Work with the same worker, so Work time excludes waiting on you. Leaders can mark a question non-blocking with `--no-checkpoint`, and dismissing a question tells the leader.
- **Quest previews on touch** -- Tapping a quest link in a message on a phone opens the quest preview sheet over the conversation, with an Open button for the full view; the back gesture closes it.
- **Open Worker and Open Thread** -- The quest preview and the full quest view start with buttons to the quest's worker session and its thread tab in the leader session, each showing its session number.
- **Linked to-dos** -- Personal to-dos can link related quests with `takode todo link`. Links never change a to-do's status, and the To-dos list shows each linked quest as a status chip that opens it.
- **`takode activity`** -- Lists the messages you typed in a time window and the final answers to them, as one narrative per session thread.
- **Transcribed tag** -- Dictated composer messages, needs-input answers and comments end with a `[transcribed]` tag you can delete, shown as a small mic marker, so agents know the text may hold transcription errors and ask when one matters.
- **More snooze choices** -- Remind me later offers 1, 6 and 24 hours, a custom amount and a day-and-time picker for snoozing until a chosen day.
- **Worker preview timer** -- The live worker preview in leader threads shows how long the worker's current turn has run.
- **Close tab and go to next** -- On a closable thread tab, long-press or right-click the feed chip's Next button to close the tab and go straight to the next item.

### Changed

- **Faster loading** -- Browsers keep the app's build files between visits, rarely used pages load on first use (the startup script shrinks from about 1,065 KB to 766 KB compressed), and the feed no longer redraws every message on other sessions' updates or on each new message. A tab left on an older build after a restart offers Reload when a page cannot load.
- **Quest preview** -- The quest preview's summary and latest progress are in full-size text, the worker and leader appear only on their buttons, and a cached preview opens at once and refreshes in place.
- **One-handed replies** -- Needs-input reply controls sit at the right edge with the send button last, within a right thumb's reach.
- **Paw marker** -- The newest answer in the feed keeps its paw and older answers rest as dots; when a new answer arrives live, the paw walks down to it.

### Fixed

- **New-session folders on the right machine** -- The new-session dialog checks a remembered folder on the selected machine, replaces one that is not there, and shows the full path with its machine. Recent folders list only folders that exist on the machine being browsed, and a remote session whose folder is missing on its host is refused before it is created.
- **Unread answers across tabs** -- Reading a leader answer in any quest tab that shows it marks it read there, and an answer shown in several tabs counts as unread only in its own thread.
- **Recording on a phone** -- Voice input keeps the screen awake while recording, so the phone's auto-lock no longer cuts off a long dictation, and the composer stays expanded when a transcription finishes.
- **Feed stays put on send** -- Visible turns no longer reload, and their images no longer flash, each time a new message arrives.
- **Terminal paste on touch** -- A long-press over the terminal on a touch screen offers Paste.
- **Multi-question answers** -- Answers to several needs-input questions are numbered once, and multi-line answers stay inside their item.
- **Quest previews without a summary** -- A quest without a TLDR shows the start of its description and closing note, and cancelled quests are labelled Cancelled instead of Completed.
- **Takode development skills** -- When Takode runs from its own repository, only the skills sessions need everywhere are linked into the global skill folders; the skills for developing Takode stay inside the repository.

## 2026-10-10

### Added

- **Drafts on every device** -- Unsent composer text, comments, report recipients, partly answered needs-input questions and uploaded composer images are kept by the server and appear in every browser, surviving reloads, including iOS reloading the Home Screen app. The last saved change wins, and a tab never loses its own unsent edit to another browser's change. Uploads still in progress stay in their tab.
- **Attention list** -- The top-bar attention control opens a list of everything that needs you across sessions, grouped by priority, with Go to on each row and a Next step with its own shortcut. Each chat's attention chip steps to that session's next item on tap and opens its list on long-press or right-click. Both keep their place as items are answered or added.
- **Peer leaders** -- `takode spawn --leader` lets a leader start another leader session in its own session space and memory space, optionally on another machine. The new leader is not herded under its creator, and a new session whose session space and memory space disagree is refused instead of being split.
- **Attention row details and actions** -- Rows name the thread tab and quest they belong to. Right-click or long-press a row for actions that fit it: mute, remind me later, acknowledge, mark as read, or close the thread tab, including another leader's closable tab.

### Changed

- **Board button** -- The work board button shows one phase-colored dot per active quest instead of a count, at a fixed size; the count and phase breakdown are in its tooltip.
- **Diffs from the quest banner** -- The top-bar Diff button is gone. The quest banner chip opens a quest's recorded commits and its worker's changes, labelled in plain text such as "2 commits · +120 -8", with a switch between commits and worker changes. Worker sessions show the same chip, and sessions without a quest get it while they have changes.
- **Machine chips** -- Machine chips use one neutral style and mark only hosts that cannot be reached, with an unplugged icon and a tooltip saying when the host was last seen.
- **Session cards** -- The archive button is removed from session cards. Archive from the card's long-press or right-click menu, or by swiping.
- **Worker preview header** -- The live worker preview in leader threads shows only a status dot, the worker number and Open session; a pulsing dot marks a working worker.
- **Terminal page** -- One compact row names the machine and folder, and a machine menu moves the terminal to any connected machine.

### Fixed

- **Unread results from quest tabs** -- Going to Main's unread result from a quest tab opens Main at its newest Ready result instead of returning to the quest tab.
- **Ready turns stay collapsed** -- A leader turn collapses again on each new Ready result, even after it was opened from a notification or expanded earlier in the quest.
- **Go to bottom** -- Jumping to the bottom from an older part of a conversation no longer restores an older saved reading position.
- **Resuming after restarts** -- After Takode interrupts a turn to restart or update itself, the resumed session is told that Takode, not the user, cut off the tool call and that the call may have partly run.
- **Session PATH** -- Sessions get the machine's real login-shell `PATH` instead of a guessed list of directories.
- **Landing gate errors** -- The landing queue checks unhandled test errors against the base commit like failing tests, so an existing leak no longer bounces unrelated changes while a new reproducible one still blocks.

## 2026-10-09

### Added

- **Landing queue** -- A shared branch can opt into a landing queue by saving a gate for it with `takode land gate`. Workers check their change with `takode land test` and hand it off with `takode land submit`. The server then stacks waiting changes on the branch tip, runs the gate once for the batch and pushes it. A change that conflicts or brings new failures bounces to its owner, while failures that also occur on the base commit do not block. Workers are free once they submit, and the quest completes when its change lands.
- **Server time zone** -- Settings has a server time zone, applied at every server start, for chat timestamps, herd events and timers on a server whose machine runs in another zone.
- **Host updates after Restart Server** -- After Restart Server, auto-updating hosts move to the new build right away instead of waiting until they are idle. Interrupted turns continue once their host is back, and Settings shows each host's progress.
- **Quests led by another leader** -- A quest tab handed to another leader is muted and marked "Led by #N", and the quest header links to that leader. Quests on no board read "Not on board".
- **Board button** -- Leaders open their work board from a Board button in the top bar on any thread and at every width. The board opens in place with its own Active / Completed switch and is easier to read, especially in the light theme.
- **Session attention chip** -- Each chat's lower-right chip counts that session's questions, Notify Me results and unread results and opens them one at a time.
- **Coordinator move guide** -- A guide covers moving the coordinator to another machine: what moves, rehearsal on a copy, cutover, verification and rollback. The remote hosts guide lists the Git version hosts need and how immediate host updates work.

### Changed

- **Restart Server follows its branch** -- Before restarting, a production server fetches the branch its checkout tracks, fast-forwards and reinstalls dependencies. When the checkout cannot simply follow, for example because of local changes, the restart stops before interrupting anything and says why. Settings shows the commit the server runs, warns when a restart would load older code, and can turn the update off. Restart Server asks for confirmation in the page and shows its progress.
- **Faster switching over slow connections** -- Switching sessions and thread tabs over a remote connection sends far fewer bytes and round trips. The browser keeps one connection across switches, large messages are compressed, including for Safari and iPhone, unchanged session-list polls return nothing, and opaque thinking signatures are no longer sent to browsers.
- **Faster host connections** -- Traffic between hosts and the coordinator, and agent command answers on hosts, are compressed.
- **Remote agents use the coordinator's data** -- Agent commands on a host never fall back to that machine's own Takode files, and the stream command also runs through the coordinator.
- **Agent waiting** -- Agents end their turn instead of chaining sleeps: Claude sessions wait for a background command's completion notice, and Codex sessions use a timer. The work board does not report such workers as stalled.
- **Running activity time** -- An activity card's heading counts the total time of running tools live.
- **Lease wait time** -- The lease chip shows how long a session waited for its lease.
- **Quest header on phones** -- The quest header chip drops its phase total on phones, and finished quests read "Done".
- **Permission rules** -- Takode no longer re-applies Claude Code `settings.json` allow rules itself; Claude Code applies its own rules. Requests go through hard denies, the permission mode, then you.

### Fixed

- **Phone session lists** -- Compressed API answers are sent whole, so session lists no longer show empty through proxies that speak HTTP/1.0.
- **Restarts always finish** -- Server shutdown waits at most 30 seconds for accepted work, logs what it waited on, and no longer hangs on a host that cannot reconnect.
- **Hosts stuck mid-update** -- A host whose update fails is reported and released, and creating a session on an offline or updating host fails at once with its name instead of hanging.
- **Claude login in launched sessions** -- A server or node started from inside a Claude Code session no longer passes that session's login to the agents it launches, which made them report "Not logged in".
- **Host CLI tokens** -- `takode host` and server management commands work from sessions on a remote host.
- **Turn errors** -- A failed turn's error stays in its own turn and thread instead of following later turns in Main.
- **Installs through registry proxies** -- The Claude Agent SDK is pinned to a version that npm registry proxies already serve, so frozen installs no longer fail with 404s.

## 2026-10-08

### Added

- **Moving the coordinator** -- A coordinator handoff tool moves a whole coordinator to a machine that already runs its sessions as a host, with checksums for every file. The old machine becomes a host, a rehearsal mode packages a copy without stopping anything, and the old machine is fenced off until it is explicitly reclaimed for a rollback.
- **Next and a cleaner top bar** -- A Next button opens the next item that needs you. The session top bar keeps only the sidebar toggle, the session title, Next and Diffs; the sessions panel opens with a search field for Universal Search and chips for needs input, Notify Me and Quests on desktop and phone. Universal Search can show leaders only and include archived sessions.
- **Waiting workers** -- Idle workers that wait on a background job, a lease or a landing run show what they wait for in the sidebar, the work board and the top bar instead of a plain idle dot, and the board no longer reports workers queued for a lease as stalled.
- **Host port** -- The coordinator also listens on a token-only host port (main port + 1000) for hosts and their agents, so a tunnel on a shared machine does not open the server to other users there. The remote hosts guide covers forward tunnels and loopback-only coordinators.
- **Machines on memory notes** -- Memory notes record which machines wrote them, and the memory catalog and Memory page show it.

### Changed

- **Claude Agent SDK 0.3** -- Claude sessions run on the Claude Code bundled with Agent SDK 0.3, which reads `AGENTS.md`.
- **Sessions survive restarts by default** -- The server always runs this machine's sessions under its own node, so they keep running across restarts. A deliberate server stop still stops them.
- **Focused pre-submit checks** -- `takode land test` runs typecheck and format in full but only the tests chosen for the change, with `--full` for the whole gate. Stopping a run frees its test slot at once.
- **Workers' questions stay with their leader** -- Questions from herded workers stay out of the global needs-input count, title count and Next, and stay answerable by their leader until answered.
- **Lease exit codes** -- `takode lease acquire` exits non-zero when it only joins the queue.

### Fixed

- **Comment drafts** -- Clicking outside the comment editor saves a non-empty comment instead of discarding it.
- **Comment-only requests** -- Answer labels preview requests sent only as comments.
- **Memory locks** -- A memory lock held by a session that has exited is taken over, and only the lock's holder can write.
- **Delivery checks on hosts** -- Commit evidence for quests is checked on the machine that holds the checkout.

## 2026-10-07

### Added

- **Sessions on other machines** -- Register a machine with `takode host add` and run `takode node` on it to run Claude Code and Codex sessions there, while the coordinator keeps sessions, quests, boards and memory. Git status, diffs, file previews, worktrees and terminals run on the session's machine, and agents there use quests, memory and Takode commands unchanged.
- **Workers on any machine** -- `takode spawn --host` starts a worker on a registered machine, and workers start on their leader's machine by default. A worker on another machine than its port target hands its commits back as a Git bundle. Each host has its own pool of machine-local leases, while port leases for a branch are shared across machines.
- **Machines in the UI** -- Settings → Hosts registers and removes machines, names them, and sets which Claude Code and Codex each one runs. The new-session dialog picks a machine and browses its folders and branches. Remote sessions show their machine across the sidebar, top bar, hover cards and board, and `takode list` marks them.
- **Sessions survive server restarts** -- Sessions on hosts keep running while the coordinator restarts, and a setting does the same for this machine's sessions. The restarted server reattaches to them with their pending permission requests.
- **Host auto-update** -- Hosts report their Takode build, and a node started with `--auto-update` follows the coordinator's commit when its sessions are idle.
- **Machine names on quest notes** -- Every machine keeps a stable name, sessions are told which machine they run on, and quest notes are stamped with the machine they were written on.
- **Network outage recovery** -- When a Claude turn cannot reach the model API, it waits for the connection instead of failing and continues on its own once the network is back, with at most five automatic continues per outage.
- **Browser login** -- An optional password can guard the app's API, live connections and file previews. Agents and hosts keep using their tokens.
- **Remind me later** -- Needs-input questions can be snoozed until a chosen time and come back as fresh alerts.
- **Leader-to-leader messages** -- `takode send` can message another leader session directly.
- **Delivery status for sent messages** -- `takode send` and `takode answer` report whether a message was delivered, failed or is still queued, and the sender is told when a queued message is finally delivered.
- **Quest cards in leader threads** -- Quest threads open with a card describing the quest, also when the thread has no messages yet, and completed quests end with a card showing the final summary.
- **Long-press menus** -- Thread tabs, session rows, file links, the session title and Session Space headers share one native-style long-press menu on touch screens, and thread tabs get a menu with Close tab and Notify Me.
- **Image zoom** -- Image previews zoom with pinch, drag, mouse wheel and double-tap.
- **Notification links** -- Agents can link to a needs-input question; the link previews it on hover and jumps to its card.
- **Collapsible quizzes** -- Quest quizzes in the chat can be collapsed.
- **Command latency log** -- `takode latency` summarizes how long Takode commands and Codex requests take and where the time goes.

### Changed

- **Settings groups** -- Settings is reorganized into clearer groups, with switches, a visible theme picker and steppers.
- **LLM auto-approval removed** -- Takode's model-based permission approver is retired now that Claude Code and Codex have their own auto-approval modes. Saved rules stay on disk untouched.
- **Quest and memory writes go through the server** -- Quest and memory commands no longer write files directly, so a command on another machine cannot create a diverging copy.
- **Faster quest commands** -- Quest reads are served from memory, so quest commands and the board answer much faster.
- **Shorter source tags** -- Messages from leaders and agents are tagged only with session numbers.
- **Rejected leader messages** -- A leader message rejected for a bad thread tag collapses into a compact row that expands to the original.
- **Session cards** -- The permission shield icon is removed from session cards; the permission mode stays in the composer.
- **README** -- The README now leads with leader-driven session management, presents sessions on several machines and has refreshed screenshots.

### Fixed

- **Claude status chip** -- The generation chip stays visible while Claude waits on the model, and its timer no longer restarts mid-turn.
- **Microphone choice** -- Dictation records from the microphone the system has selected and shows its name, and iPhones no longer repeat or silently deny microphone prompts.
- **Faster startup** -- Large chunked session histories load about ten times faster at startup.
- **Claude processes end with their session** -- Killing or archiving a Claude session ends its process.
- **Stale tool progress** -- Opening a running session no longer shows finished tools as still running.
- **Leader answers for mid-turn input** -- A Claude leader's answer to a message sent mid-turn is accepted, and network errors no longer trigger routing reminders.
- **Removed project skills** -- Skills removed from the repository are uninstalled at startup instead of leaving dangling links.

## 2026-10-06

### Added

- **Send key setting** -- Comment, quest feedback, Side Chat and answer boxes use the composer's send key, and a new setting makes Enter add a newline and Cmd+Enter (Ctrl+Enter) send.
- **Screenshots in decisions** -- Local image paths render as file links, and visual decisions show their screenshots inline.

### Changed

- **Needs-input explanations in the conversation** -- The explanation for a needs-input question is written into the thread as an ordinary message, and the card, phone alerts and attention panels show only the question.
- **Activity cards** -- Activity cards collapse to their heading once later text follows them, and their lines show skill names, shortened file paths and MCP server and tool names.
- **Thread links** -- A message from another thread shows a clickable link to the one thread it was written in.
- **Collapsed turns** -- A collapsed leader turn without an answer shows its last message.
- **Memory page** -- Memory folders start collapsed, like a table of contents.
- **Memory reading** -- Agents read memory through the catalog and folders; the weighted memory recall command and the Codex `memory_recall` tool are retired.

### Fixed

- **Activity grouping** -- Thinking stays inside activity cards, and cards no longer add an empty Needs input chip below a question.

## 2026-10-05

### Added

- **Web Push phone alerts** -- Phone alerts can go through Web Push alongside Pushover, with the same delay and filters. Devices enroll from Settings (on iPhone from the Home Screen app), and alerts skip a device that has Takode on screen.
- **Claude Auto mode** -- Claude sessions offer Claude's own Auto permission mode, and permission mode changes apply to the running Claude process.
- **Claude reasoning effort** -- Claude sessions get the Model and Effort menu, taken from Claude Code's model catalog and applied without a relaunch.
- **Live worker preview** -- A leader quest thread waiting on its worker shows the worker's latest actions in the conversation, with an edge colored by the worker's status.
- **Copilot setup guide** -- A guide and setup script run Takode's Claude sessions on Claude models served by a GitHub Copilot subscription.

### Changed

- **Claude runs through the Agent SDK only** -- Claude Code's current versions reject the native WebSocket backend, so Claude sessions run only through the Agent SDK. Saved Claude sessions resume through it, and Claude sessions in containers are refused.
- **Compact activity cards** -- All agent activity between two pieces of text forms one card with a summary heading of failures, counts and total time over its newest lines. A single tool shows as one light line with its description, and Claude commands group like Codex commands.
- **Complete messages** -- Assistant text appears once each message is complete instead of streaming into the browser.
- **Needs-input cards** -- Question cards show their decision context, use a neutral style with full-width option rows, and their text can be commented on or copied.
- **Lease waits** -- Sessions queued for a resource lease show as waiting, naming the pool, instead of idle.
- **Memory folders** -- Memory notes live in topic folders, and the catalog shows recent notes plus one line per folder so it stays small. The Memory page groups notes by folder.
- **Quests start in Work** -- Quest Journeys start in Work, and workers send optional reports instead of waiting for an initial approval.
- **Large session histories** -- Large histories are saved incrementally instead of rewriting a full snapshot on every save, with bounded memory use and saves committed in order.
- **Claude model list** -- The Claude model menu lists the models Claude Code itself reports, including the running model.

### Fixed

- **Claude turn control** -- Interrupts end turns Claude never received, queued input reaches resumed sessions, and a Claude process that ends unexpectedly is reported instead of stalling the server.
- **Claude status readouts** -- Live context usage uses the window Claude reports, long-running tools keep one progress entry, the turn timer keeps its start when a session is opened, and a session created with a permission mode keeps it.
- **Claude leader routing** -- Thread markers in Claude leader messages that follow a thinking block are routed.
- **Composer buttons** -- The microphone and send buttons stay in place while a reply streams, with Stop at the far left.
- **Thread handoffs** -- Requests handed to a quest thread stay there after a server restart.
- **Restart Server checks** -- Restart Server checks that the backend loads with installed dependencies before shutting down.
- **Shutdown keeps pending work** -- Server shutdown stops taking new work and finishes work it already accepted before exiting.
- **Build time** -- The sidebar build time uses the browser's time zone.
- **Dependency security updates** -- hono, sharp and shell-quote are updated for security advisories.

## 2026-10-03

### Added

- **Markdown reports** -- `takode report` publishes a Markdown file as a fixed snapshot in the chat. Passages can be commented on and the comments sent to the session or its worker, with drafts kept across reloads.

## 2026-10-02

### Fixed

- **Quest detail editing** -- Quest details loaded on demand stay editable.

## 2026-09-30

### Fixed

- **Node REPL previews** -- Node REPL tool calls show their titles in activity previews.

## 2026-09-29

### Added

- **Session menu from the title** -- Clicking the session title in the top bar opens the same session menu as the sidebar.

### Fixed

- **Quest completion evidence** -- Completing a quest whose Journey repeated phases checks only the current run's evidence.

## 2026-09-28

### Changed

- **Codex built-in memory off** -- Codex sessions launched by Takode turn off Codex's own memory, so background consolidation cannot act with orchestration authority. Takode memory is unchanged.

### Fixed

- **Voice transcription retries** -- Failed transcriptions keep their context, and recordings flagged with a warning can be retried.

## 2026-09-24

### Changed

- **Quest commit ranges** -- Commit chips can browse a verified range of commits behind a recorded delivery, and deliveries published to a separate branch record their complete approved commit set.

## 2026-09-23

### Added

- **Counted resource leases** -- Leaders can configure resource pools with numbered slots, one reservation per session and FIFO waiting. Renewal, expiry and recovery target individual slots; existing singleton reservations migrate without losing ownership or queue state.
- **Leader lease recovery** -- Leaders can release stale or abandoned reservations held by other sessions without waiting for expiry. Recovery releases one selected slot and leaves the underlying processes and data untouched.
- **CLI text inputs** -- Session messages and worker answers accept stdin; proposal summaries, phase notes, timer descriptions, skill content, cron prompts, and delivery-target JSON accept file/stdin input. Help and agent examples show quoted heredocs and separate summaries without routine temporary files.

### Fixed

- **Skill content parsing** -- Ambiguous inline content beginning with option syntax is rejected with file/stdin guidance instead of sending a boolean as Markdown.
- **Expanded composer clearance** -- Desktop conversations can be scrolled above the expanded composer to reveal covered passages. Expanding or collapsing keeps the feed stationary, and used scroll space remains available until switching destinations.

## 2026-09-20

### Changed

- **Agreed design replacements** -- Agent guidance carries an approved replacement through planning and implementation, retiring superseded behavior within scope while preserving required compatibility, shared functionality and user data.

## 2026-09-19

### Changed

- **Leader recommendations** -- Guidance anchors recommendations in accepted decisions and favors the smallest coherent change. Proposals that revisit an agreed tradeoff must explain the departure and preserve approval requirements.

### Fixed

- **Post-compaction memory catalogs** -- Codex attaches fresh memory orientation to the next ordinary input after compaction, without an extra model turn or duplicate required guidance. Catalog failures leave ordinary work usable, and repeated boundaries do not duplicate the attachment.
- **Disposable worker branches** -- Archive cleanup again removes proven Takode-created, exclusively owned worker branch names after preserving their committed tips for recovery. Original worker checkouts retain force-removal; shared, retained, user-owned and unproven branches stay protected, with auxiliary and retry safeguards unchanged.

## 2026-09-18

### Added

- **Auxiliary worktree retention** -- Workers can register extra checkouts as temporary or retained. Archive cleanup protects shared and retained checkouts, checks temporary work before removal, and preserves Git branches independently of checkout environments.

### Changed

- **Mobile quest banners** -- The title and right-aligned Journey pill share one row. Expanded details show the current worker, while a manual collapse control saves screen space without reopening on phase updates.
- **Quick quest search** -- Reuses prepared search documents and cancels superseded requests to reduce repeated work while preserving current results and relationship-aware freshness.
- **Notify Me phone alerts** -- Settings provides a separate, default-on Pushover filter for monitored results, independent of ordinary review notifications.
- **Blocker escalation** -- Agent guidance now asks agents to check available context, resources and alternative approaches before asking the user to resolve an avoidable blocker.

### Fixed

- **Memory catalog freshness** -- Catalog diffs detect note-body edits, descriptions have a 1,000-character validation limit, and agent guidance reuses preloaded catalogs while preserving direct note checks. Clipped preloads no longer mark unseen content as observed.
- **Search activity** -- Pending quick searches show an animated status indicator, with reduced-motion support, until results arrive.
- **Recent attachment counts** -- Recent message previews show separate image and comment counts, including messages with attachments but no text.
- **Input delivery order** -- Human and leader input carries earlier queued observations in chronological order without pulling later background events into an active turn. Input already sent to that turn is not resent by a stale queued turn.
- **Codex recovery guidance** -- Required recovery instructions and leader skills survive compaction without duplicate recovery messages. Leader recycle also retains its skills when the optional memory catalog is unavailable.
- **Codex recovery stability** -- Quiet compaction is no longer treated as a stuck turn. Repeated automatic recovery requests share the current relaunch instead of restarting its replacement.
- **Compaction status** -- Conversation markers distinguish compaction starting from completion, so an in-progress compaction is not presented as finished.
- **Pending message visibility** -- Queued input remains visible in its valid destination thread even when another routing field is blank or invalid. Inputs without a known destination retain global visibility.
- **Active Codex timers** -- Verified timer firings can reach an active turn with earlier queued observations, while paused or interrupted work stays protected.

## 2026-09-17

### Changed

- **Leader sidebar cards** -- Leader cards omit numeric Git divergence and line-change counts. Git details remain available on hover, and worker cards keep their existing counts.

## 2026-09-14

### Changed

- **Smaller frontend transfers** -- Production JavaScript and CSS can be served as build-time gzip copies, preserving the decoded application and existing cache/build behavior.
- **Quest status and participant chips** -- Leader headers use the same colored Journey pill and progress count as worker headers. Worker-side Leader links match the lighter Worker-link style while retaining role, identity and navigation. The single-action Notify/Acknowledge control is unchanged.

### Fixed

- **Composer focus** -- Temporary focus loss during internal controls or voice input preserves expansion. Outside clicks, keyboard focus moving outside, navigation, sending, and manual minimization keep their existing behavior.
- **Resolved Needs Input cards** -- Completed decisions remain inspectable in the conversation, including their full questions and exact recorded replies in chronological order. Missing replies are identified without substituting unrelated messages.

## 2026-09-13

### Added

- **Automatic startup asset timings** -- Home Screen startup diagnostics can retain a bounded entry JavaScript/CSS timing summary, with explicit missing-data limits and no manual inspection or content capture.
- **Mobile load diagnostics** -- Bounded startup, foreground, and selected-feed timings are retained in server logs alongside the actual browser connection, with explicit limits on what browser callbacks establish.
- **Notify Me phone alerts** -- New monitored results can send dedicated Pushover alerts using the existing review filter and delay, with direct links to their task tabs. Acknowledging, replying to, or untracking a result before delivery suppresses its pending push.

### Changed

- **Compact diff viewer** -- Commit modals fill the viewport with two compact context rows, visible change totals, a file picker, and on-demand comparison details. Commit and review navigation remain accessible while code keeps the full width.
- **Quest headers** -- Phase names use quiet inline text without counts, duplicate waiting notices are removed, and Worker and Commits remain directly accessible. Pending results replace Notify with Acknowledge; acknowledging restores Notify while tracking stays enabled. The Notify tooltip retains the full Notify Me name.
- **Compact draft indicators** -- The first-line preview indicates additional lines and shows image and comment counts while preserving the complete draft and attachments.

### Fixed

- **Comment highlights** -- Passage shading stays uniform across formatted text and overlapping comments. Attached comments keep a dim highlight that strengthens on hover or while editing, and chip navigation brings the selected passage near the top of the feed.
- **Voice composer expansion** -- Starting voice input deliberately expands the composer and keeps the transcription visible until a later interaction minimizes it.

## 2026-09-12

### Changed

- **Compact composer** -- Desktop and mobile start with an input showing the draft's first line. Expand to edit; sending or leaving the composer minimizes it. Drafts and attachments survive, and the minimize button fits in the existing toolbar.
- **Interrupted-work inspection** -- Recovery guidance continues from available context and uses bounded history pages only for missing details. Codex close diagnostics retain termination details and evidence references without enabling raw protocol recording or claiming an unproven cause.

### Fixed

- **Delivery comparisons** -- Commit chips identify their comparison baseline, and merge statistics and opened patches use the same first-parent view. Earlier saved totals stay inspectable, while reporting distinguishes pending and newly delivered batches without repeating historical commits.
- **Comment source navigation** -- Attached comments can locate their original message beyond the loaded history window without jumping to a different passage or a child-only conversation.
- **Overflow task tabs** -- The More menu keeps click and keyboard navigation without hover previews covering its rows; previews remain available on visible tabs.

## 2026-09-11

### Added

- **Notify Me** -- Monitor named task tabs and keep new results in a global list until acknowledged or replied to; monitoring survives viewing, tab closure, and reconnects while ordinary unread and needs-input remain independent
- **Conversation comments** -- Attach comments to selected passages, inspect their quoted context and source highlights, and send them alongside text or images. Voice editing can update the attached comments.
- **Browser connection diagnostics** -- Server logs record transfer bytes, backpressure and synchronization timing for each browser connection without retaining message payloads.

### Changed

- **Composer controls** -- Manual minimize and expand controls preserve the complete draft, images and comments while hiding their content. Comment previews and selection controls make attached passages easier to inspect and edit.
- **Citation guidance** -- Session instructions prefer supported clickable source links while preserving required citation formats and the exact content of quoted or stored messages.

### Fixed

- **Leader session return** -- Restoring the previously selected task tab no longer moves it ahead of the server's saved tab order.

## 2026-09-10

### Added

- **Independent delivery targets** -- Leaders can record an explicitly approved publication's exact repository and branch heads without moving it onto an unrelated integration branch. Commit inspection reads from the recorded delivery target.

### Changed

- **Journey approval cards** -- Proposals render their complete Markdown summary and native links in one readable card, with shell details available through separate raw inspection.
- **Thread continuation notices** -- Ordinary conversation notices disappear when agent activity returns to the viewed thread, while original history and navigation remain available. Loading older history does not resurrect an expired notice.

### Fixed

- **Long turn durations** -- Turn summaries display hours and minutes for long runs instead of an unwieldy total number of seconds.

## 2026-09-09

### Added

- **Tracked commit deliveries** -- Commit links stay tied to an exact recorded delivery batch, with retained review history and receipts for partial ports. Port guidance requires fast-forward updates to shared integration branches and preserves already-landed history.

### Changed

- **Turn activity disclosure** -- One top control expands or collapses a turn's activity. Shared indentation and a continuous guide keep tools, commentary and system events aligned while preserving the full audit details.
- **Compact commit chips** -- Adjacent commit links form aligned compact rows while retaining full titles, change totals and access to the exact selected commit.

### Fixed

- **Request handoff history** -- Moving unfinished work from Main to a task tab preserves the original request and related answers in their original thread while responsibility stays with the new owner.

## 2026-09-08

### Added

- **Main-to-task handoff** -- Leaders can explicitly transfer unfinished requests and selected decisions from Main to a task tab without treating that transfer as an answer or completion.
- **Scheduled thread reports** -- Leader timers retain the destination selected at creation. Each firing can receive its own answer, including after queued delivery or restart, without settling unrelated user requests.
- **Codex retry progress** -- The activity indicator shows confirmed internal response retries and returns to normal when output resumes, without inventing retry counts.

### Changed

- **Leader context commands** -- `/compact` requests Codex compaction and `/recycle` requests a one-time leader recycle. Neither changes the configured automatic context policy.
- **Compact Journey status** -- Board and header summaries show one current state or phase with its position, keeping the full Journey available in detail views.
- **Continuation links** -- Notices label the viewed source or destination as the current thread while keeping the other thread's name and navigation.

### Fixed

- **Conversation navigation** -- Turn expansion, scaled scroll positions and bottom navigation remain stable as history windows change. Sending keeps the feed following new output without moving readers who are inspecting older messages.
- **Decision chronology and quizzes** -- Full decision context and replies stay in chronological order, and each quiz uses one visible presentation instead of appearing twice in collapsed activity.
- **MCP status errors** -- Server-status retrieval failures appear in Session Info instead of failing the session or adding conversation errors. Successful retrieval clears the diagnostic while independent server startup failures remain visible.
- **Interrupted Codex delivery** -- Terminal recovery records no longer block later requests, and a delayed continuation cannot deliver after its recovery ownership has ended.
- **Completed stream replay** -- Completed Codex output no longer reappears as a second live footer after conversation synchronization; genuine unfinished output and child-session ownership remain intact.
- **Needs Input attention** -- Unresolved prompts remain distinct from unread results in session and group indicators instead of being counted as both.

## 2026-09-07

### Added

- **Captured instruction viewing** -- Codex instruction sources are grouped under Developer Instructions with explicit viewing of captured content. Unavailable or unverified captures stay identified rather than being replaced with current file contents.
- **Native computer-use defaults** -- Supported macOS Codex sessions can use the configured native computer-use runtime at normal startup while preserving custom settings. Each app and its intended use still require explicit human approval; Claude sessions remain excluded.
- **Delivery evidence correction** -- Assigned workers can correct invalid recorded commit evidence through an audited operation that verifies the expected prior list and selected target, without advancing the Journey.

### Changed

- **Suggested replies** -- Agent guidance requires convenient reply shortcuts alongside complete decision context, while custom responses remain available and shortcuts never count as approval by themselves.
- **Shared leader answers** -- One answer can appear across the related Main and task tabs without duplicating its text or settling unrelated requests. Bounded thread views retain the relevant complete answer set.

### Fixed

- **Answer retention** -- Routine outcome bookkeeping stays commentary so it cannot replace the substantive answer as the current result.

## 2026-08-31

### Changed

- **Session identity projection** -- Compact navigation rows take session names, claimed-quest fields, and live-only rename animation from one synchronized authority while detail, mutation, and recovery state remain separate

### Fixed

- **Build mismatch actions** -- Takode distinguishes the browser-loaded frontend, server-served frontend, and backend build; Reload is offered only for a coherent server pair, while broken or identity-less pairs request a full restart and stale probes cannot restore the wrong banner

## 2026-08-30

### Added

- **Build compatibility enforcement** -- Takode detects incompatible frontend/backend builds, shows an explicit recovery notice instead of silently keeping mixed versions, and prepares and validates replacement frontends before interrupting the current compatible pair

### Changed

- **Codex compaction accounting** -- Ordinary usage uses the provider's last total while prompt input, configured capacity, and compaction cause stay distinct; uncorrelated automatic compactions remain cause-unknown instead of receiving synthetic charged-context claims
- **Scheduled quest tabs** -- In-motion work stays ahead of queued or proposed tabs, scheduled tabs can be dismissed without changing board state, and genuine activation can resurface them safely
- **Session navigation authority** -- Compatible builds use one canonical server row across navigation surfaces, so stale REST state cannot make active sessions appear idle while first-upgrade migration and raw actions remain safe
- **Leader thread authority** -- Current-build leader tabs use one synchronized visual authority with preserved phase colors, ordering, routing, current-run fencing, and bounded persisted-tab migration
- **Browser conversation synchronization** -- Current-build browsers use one bounded server-authored history and thread path; routine full-history and unused sidecar delivery are removed while explicit recovery, routing, attachments, and replay remain intact
- **Session attention authority** -- Compact unread, needs-input, and timer visuals use one fail-closed synchronized projection across browsers while notification detail, permissions, persisted read state, and mutation remain authoritative separately

### Fixed

- **Interrupted leader continuation** -- Interrupted Codex leader work stays visibly recoverable in its thread; one safe continuation can finish missing work without replaying completed actions, and generic errors disappear only after recovery actually queues
- **Prolonged Codex outages** -- Eligible exact pending work continues low-frequency recovery beyond finite reconnect cycles without duplicate execution, persistent retry noise, or unbounded storage

## 2026-08-29

### Added

- **Inline quest feed previews** -- Chat-feed quest links remain direct while compact validated status and same-color eyes open canonical full previews with accessible keyboard and touch behavior plus fail-closed thread routing

### Changed

- **Synchronized session attention** -- Session rows, aggregates, search and cron results, reviewer badges, and hover cards begin sharing one server-authored attention value while detailed notifications and actions remain authoritative
- **Codex collapsed response phases** -- Official nullable Codex phases select collapsed final responses, commentary stays expanded-only, and genuinely unannotated history keeps a conservative fallback without exposing hidden routing or reasoning fields
- **Session navigation projections** -- Lists, groups, hover cards, links, and selected-session surfaces begin sharing bounded server-authored navigation state while established backend actions remain authoritative
- **Leader thread projections** -- Quest tabs begin using synchronized Journey and participant state with semantic phase colors while preserving existing navigation, attention, and first-upgrade migration behavior

### Fixed

- **Sidebar unread propagation** -- Unselected rows, hover cards, and Session Space totals share one server-authored unread summary, so fresh Ready counts reach other browsers before selection while stale or closed attention stays suppressed

## 2026-08-28

### Added

- **Natural explanation guidance** -- Bundled cross-agent guidance favors natural, audience-aware, fresh-reader, concept-first explanations while leaving format and workflow choices to agent judgment and narrower rules
- **Pending attachment slots** -- Explicit message images reserve ordered accessible loading tiles and become previews in place; terminal failures disappear while speculative paths remain silent

### Changed

- **Intent-first quest creation** -- Leaders preserve requested outcomes, confirmed or mandatory constraints, and hard-to-recover evidence without turning unconfirmed ideas or technical plans into binding scope
- **Codex subagent workspace** -- Native child inspection uses the full chat workspace with compact responsive navigation, oldest-to-newest paging, dismissible warnings, and no empty controls for sessions without genuine children
- **Accepted Work handoff** -- Accepted Work and its synchronized commit or explicit no-code evidence appear before mandatory Memory, while stale or missing evidence is blocked
- **Recent and Messages search** -- Universal Search's query-free Recent view shows one latest human message per destination, while scoped Messages preserves every matching message with canonical routing and evidence-backed status
- **Completed waiting tabs** -- Completed quest tabs stay visually active while their authoritative state is Thread Waiting and return to muted when the wait clears or becomes Ready

### Fixed

- **Codex turn settlement** -- Delivered stale owners drain before queued work and reconnect snapshots missing locally observed tools become actionable no-replay interruptions instead of stuck or repeated output
- **Message route restoration** -- Deliberate manual scrolling retires superseded message-route and pending-target ownership so Browser Back no longer snaps to an obsolete search target while fresh links and automatic restoration remain intact
- **Production frontend snapshots** -- Production serves validated app-owned frontend copies and uses application readiness separately from backend liveness, preserving the last good UI when replacement builds or cleanup fail
- **Quest feedback links** -- Canonical feedback links keep stable zero-based targets through reload, browser history, collapsed Journey history, and deletion tombstones
- **Native child feed isolation** -- Ordinary root chat, navigation, searches, reasoning groups, and lifecycle state exclude proven Codex child activity while canonical child audit history remains inspectable

## 2026-08-27

### Added

- **Native Codex subagent inspector** -- A server-owned registry and read-only responsive inspector show genuine child reasoning, messages, tools, results, and errors chronologically with bounded privacy-safe history and fail-closed partial or legacy coverage
- **Shared Markdown math** -- Safe accessible KaTeX rendering for dollar and stored backslash delimiters preserves exact source, copy, selection, malformed fallback, streaming, tables, and local overflow
- **HTML file browser tabs** -- Resolved HTML file links open in native new tabs with scripts and supported relative assets through capability-scoped serving without granting Takode API, session, or generic filesystem authority

### Changed

- **Quest CLI plugin workflow** -- The Codex plugin makes the existing Quest CLI the sole public Quest interface, routes mutations through live Takode authority, preserves managed sessions, and retains focused Todo, Memory, and Lease MCP tools
- **Expanded quest reconciliation** -- Same-quest design-to-build continuations require immediate title, description, and TLDR reconciliation before implementation resumes, with delivery claims gated by synchronized evidence

### Fixed

- **Leader reconnect viewport** -- Lifecycle snapshots and stale-anchor migration preserve the real selected message and offset across reconnects, reloads, and delayed hydration without weakening fresh navigation
- **Queued Codex inputs** -- Text and image messages steer or safely restart at the earliest supported point, with one owner-scoped pending state and safe Retry, Edit, and Cancel actions that prevent replay and starvation

## 2026-08-26

### Added

- **Takode Codex plugin** -- An opt-in plugin packages Takode integration for ordinary Codex tasks while managed Takode sessions retain their existing identity and lifecycle

### Changed

- **Design-to-delivery continuity** -- One intended design-and-build outcome stays in one quest through explicit checkpoint routing, preserves worker-owned closure, and requires delivery evidence before testability claims

### Fixed

- **Passive leader returns** -- Re-entering a leader session preserves the actual selected thread and stable viewport instead of letting stale layout continuity or late hydration switch the user elsewhere
- **Stale Codex recovery owners** -- Automatic-input recovery shows exact-owner testing or active state, retires provider-proven completed owners, preserves held inputs exactly once, and stops stale work from replaying across reconnect or watchdog cycles

## 2026-08-24

### Added

- **Recent asks** -- Universal Search adds a bounded global view of exact human-request bundles with canonical quest links, stable message jumps, compact expandable text, and evidence-backed response status without rendering response bodies

### Changed

- **Voice rerun offers** -- Append-to-edit and edit-to-append reruns share one compact status, action, and dismiss row while preserving the result and same-audio in-memory rerun behavior
- **Evidence-based safety scope** -- Leader and worker guidance preserves access safeguards, requires explicit direction, policy, an approved contract, or payload evidence before fidelity-changing transformations, and requires existing authority or a User Checkpoint for material scope, cost, validation, or acceptance expansion

### Fixed

- **Attached-message chronology** -- Older requests and reasoning attached to a live quest thread retain their canonical position above newer completion, quiz, and Ready content, matching refresh without duplicate tails or viewport jumps
- **Retained quest titles** -- Completed, cancelled, or board-removed leader tabs keep canonical Questmaster titles across tabs, headers, navigation, and hover instead of falling back to repeated IDs

## 2026-08-16

### Changed

- **Transcription Debug loading** -- The newest 15 records load first with older archive pages on demand, and replay transcription selection covers built-in, configured, and source-record models
- **Recurring timer history** -- Contiguous compatible firings of the same unchanged timer compact into one counted expandable row while every real timestamped firing, stable search or deep-link identity, audit detail, and work-trigger boundary remains intact

### Fixed

- **Leader quest tab surfacing** -- Queued or proposed quests reopen their leader tab when work becomes active and stay discoverable through completion or reload, while later manual closes remain respected

## 2026-08-15

### Changed

- **Worker-send activity** -- Collapsed activity labels pure `takode send` invocations as `Sent a message`, while mixed or ambiguous shell commands retain truthful command labels and full expanded detail

## 2026-08-13

### Added

- **Personal to-dos** -- A separate server-authoritative Markdown Todo/Doing/Done outline supports categories, search, active ordering, marker-first completion, date-grouped history, recoverable drafts, reversible archive, and stale-safe UI Undo, with compact CLI access, proposals and grants, and fail-closed mutation authority

### Changed

- **Mobile participant labels** -- Quest banners show full Leader and Worker labels with role icons through 320px while the selected-session TopBar keeps its compact `#N` identity
- **Work recovery authorization** -- Recoverable interruptions resume the remaining approved Work envelope instead of serial micro-handoffs, while genuine approval and safety gates remain unchanged
- **Codex reasoning selection** -- Ordinary controls show one selected effort and confirmed runtime mismatches add a compact warning, while Codex-reported effective effort remains authoritative for validation and targeted CLI or debug diagnostics
- **Leader decision communication** -- Leader decisions and material status updates lead with the problem, impact, recommendation, choices, and requested answer while incidental technical evidence stays in durable records and approval safeguards remain intact
- **Quest Journey colors** -- Active Alignment, Work, User Checkpoint, and Memory phases use distinct cyan, green, amber, and violet styling with accessible light and dark contrast
- **Codex worker multi-agent mode** -- Normal leader-created Codex workers use native multi-agent V2 by default and existing idle workers migrate through a guarded fresh-thread handoff, while leaders, reviewers, manual sessions, and archived sessions remain on V1

### Fixed

- **Copilot request retries** -- Eligible transient stream failures retry quietly with compact progress; successful recovery hides transient errors, while side-effect uncertainty or exhausted retries still fail closed
- **Recovery ownership** -- Leader escalations, repeated board stalls, and retry indicators stay tied to the exact owning turn or occurrence so later activity cannot consume, suppress, or resurrect stale recovery state
- **Collapsed leader responses** -- Substantive replies remain visible when later outcome reminders add empty or low-value rows, without changing Ready collapse, routing, needs-input priority, or expanded audit history
- **Attached thread rendering** -- Historical attached rows no longer flash phantom duplicates after remounts or thread navigation, while authoritative content and position stay unchanged
- **Empty assistant rows** -- Fully post-processed assistant messages no longer leave blank avatar or menu shells, while status footers, raw history, side effects, and visible child UI remain intact
- **Mobile composer focus** -- Narrow-touch session and thread navigation no longer auto-focuses the composer; drafts, explicit taps, and desktop focus behavior remain intact

## 2026-08-12

### Changed

- **Reasoning detail groups** -- Consecutive compatible Codex reasoning summaries collapse into one newest-summary preview with a count, while expansion preserves every original detail and chronology or ownership boundaries

### Fixed

- **Paused-input banner contrast** -- Automatic-input pause and recovery states use theme-aware text, icon, chip, border, and card colors for readable light and dark themes without changing recovery behavior
- **Leader thread outcomes** -- Fresh same-thread leader text, tool activity, or reasoning clears stale Ready/Waiting footers while preserving historical markers, unread state, and unrelated threads
- **Archived session reconciliation** -- Server-confirmed archives disappear promptly and cannot be resurrected by older in-flight active-session snapshots, while later backend state and lazy archived loading remain authoritative

## 2026-08-10

### Added

- **Role-aware session defaults** -- Settings keep separate server-backed defaults for future Leader and Worker sessions while preserving existing per-group creation choices and explicit overrides
- **Session reconnect controls** -- Codex recovery shows up to five process attempts, offers a fresh-cycle Reconnect action, and lets leaders reconnect eligible owned workers without sending task text
- **Codex reasoning details** -- Each official reasoning-summary part is stored and rendered as its own chronological expandable detail, converging live and completed updates without merged or duplicate rows while redundant root-level thinking rows stay hidden

### Changed

- **Composer model controls** -- Codex model selection uses a compact model-and-effort chip with nested Model, Effort, and capability-gated Speed controls, plus Reset to fresh role defaults
- **Codex Goal browser surface** -- The Session Info Goal editor and browser `/goal` shortcut are removed while backend and CLI Goal state remain available for automatic continuation
- **Alignment and herd context** -- Routine Alignment completion uses normal turn completion instead of an approval prompt, and structured preload or recovery bodies are bounded before leader-model injection while audit history remains available
- **Long tool activity summaries** -- Large collapsed Bash or MCP groups switch to a stable `N tool calls` label while expanded audit detail and smaller descriptive summaries remain intact

### Fixed

- **Passive disconnected sessions** -- Post-restart viewing shows a quiet recoverable-disconnected state instead of a false startup spinner without waking the backend
- **Provider recovery** -- Temporary Copilot authentication or network failures use bounded refresh and replay only provably side-effect-free turns, while unsupported models remain terminal and Claude interruption diagnostics stay out of conversation history
- **Leader activity ownership** -- An idle leader no longer inherits a running worker's route or timer in its activity chip
- **Codex stale delivery replay** -- Already-processed user and mixed herd or system payloads cannot be automatically re-delivered as fresh turns when provider or local model activity proves ownership, while genuinely undelivered user-only work still recovers
- **Cached leader thread refresh** -- Reopening a cached leader tab revalidates its authoritative window so routed worker events and leader responses cannot remain hidden in stale almost-empty history

## 2026-08-08

### Added

- **Direct worker errands** -- Leaders can route one-turn, context-rich, read-only follow-ups directly to an existing worker, while broader or stateful work fails closed to a normal quest

### Changed

- **Browsed-window reconnects** -- Capable browsers reconnect with only the bounded server-authored conversation window currently being viewed instead of passively catching up entire session histories

### Fixed

- **Leader viewport restoration** -- Saved message anchors and routed quest-thread positions survive cold hydration and tab changes, including off-window targets
- **Work Board reminder freshness** -- Delayed dispatchable reminders are tied to the live board-row revision and suppressed when the underlying wait has already changed or cleared

## 2026-08-07

### Changed

- **Selected conversation loading** -- Cold leader startup prioritizes the selected authoritative window before tree, replay, and snapshot work so mobile content appears sooner without sacrificing paging or tool-result closure

## 2026-08-06

### Changed

- **Message timestamp menus** -- Exact message times are available from the existing message menu while rail dots and stars retain their normal navigation and starring behavior
- **Herd event activity** -- Routine non-decision and board-stalled events collapse into compact worker activity while meaningful decisions and complete audit detail remain visible
- **Leader turn summaries** -- Ready leader turns auto-collapse immediately while preserving status-bearing final prose, hiding model-only reminder acknowledgements, and retaining manual expansion

### Fixed

- **Restart continuation context** -- Ordinary restart continuation stays a concise `Continue.` instead of reinjecting the Memory catalog, while new sessions and real compaction or recycle recovery still preload it
- **Completed quest queue banners** -- Completed Journey rows no longer retain stale queued-worker or free-worker wait status, while genuine active and needs-input waits remain visible

## 2026-08-05

### Added

- **Alternate voice reruns** -- A completed voice result can be rerun in append or voice-edit mode using the active in-memory audio without recording again

### Changed

- **Worker reclamation safety** -- Leader guidance treats clean behind-only worktrees as safely replaceable while preserving dirty or genuinely ahead workers and requiring fresh target-ref checks

### Fixed

- **Journey participant projection** -- Active and completed rows for the same quest no longer leave stale worker or reviewer state, and unsynced tracked work remains in Work until its evidence is settled

## 2026-08-04

### Added

- **Audited quest recovery** -- Owning leaders have a reason-required, server-authenticated fallback for exceptional stuck quest completion while normal worker completion remains the preferred path
- **External dependency wakeups** -- Leaders receive targeted board reminders when external session or quest blockers resolve, with cleared dependencies removed from the waiting row

### Changed

- **Leader and worker handoffs** -- Post-Alignment Work dispatches carry only leader-owned deltas, implementation follow-ups prefer the context-rich worker or accepted evidence, and workers report at meaningful milestones
- **Self-contained quest context** -- Refined quest records carry concise standalone background and true follow-up differences instead of depending on linked history for essential context

### Fixed

- **Leader quest tab titles** -- Quest tabs preserve their real Questmaster titles instead of degrading into repeated quest IDs
- **Memory completion Git refresh** -- Final Memory refreshes worker Git state through the server-owned path so completion sees current sync state without weakening identity checks
- **Needs-input decision panels** -- The owning thread again shows the real question, choices, custom reply field, supported voice input, and authoritative loading or retry state

## 2026-08-03

### Added

- **Codex leader compaction mode** -- Leaders can opt into Codex built-in compaction while Takode recycling remains the default and delegation stays available in either mode
- **Sessionless Takode inspection** -- Ordinary Codex contexts can read session and history state without a session identity while invalid authentication, mutations, and unrelated protected operations remain rejected
- **Compact tool activity** -- A Settings option condenses consecutive passive tool calls into categorized expandable summaries while keeping notification and approval interactions visible

### Changed

- **Quest Journey v2** -- New work uses Alignment, Work, and final Memory with User Checkpoint as a Work pause, while legacy Journey history stays readable and completion requires clean synchronized evidence
- **Checkpoint shortcut prompts** -- Notification shortcuts must be explained in the visible decision packet before they are offered, preserving exact-approval safety

### Fixed

- **Completed tool-result closure** -- Visible completed tools receive their latest matching result preview before optional support trimming so historical commands do not reappear as live during later turns

## 2026-08-02

### Added

- **Relay supervision tooling** -- An opt-in monitor-free direct-SSH supervisor package provides transactional ownership, bounded private events, trusted retries, and stale-proof readiness evidence while activation remains separately controlled

### Changed

- **Browser title attention count** -- The tab-title number represents only active unresolved and unmuted needs-input prompts across non-archived sessions, independent of other in-app attention indicators

## 2026-08-01

### Added

- **Quest reviewer identity** -- Leader quest banners show the authoritative Reviewer beside the Worker and keep that identity current through lifecycle refreshes

### Changed

- **Automatic recovery guidance** -- Recovery banners explain the sanitized cause, original pause time, required direct action, and eventual held-input outcome consistently across browsers

### Fixed

- **Historical Journey routes** -- Legitimate completed Explore-to-Implement history remains valid across later board operations while malformed phase data fails closed before provenance can be rewritten
- **Large conversation restoration** -- Mobile and desktop sessions restore through compact authoritative projections and bounded visible windows instead of showing a false-empty Main view

## 2026-07-31

### Added

- **Held-input recovery receipts** -- Automatic-pause recovery keeps durable, sanitized, exact-once outcome records across retry, restart, and ownership handoff, with bounded searchable history and no payload disclosure

### Changed

- **Edit-and-approve checkpoints** -- One fresh reply may make one exact substitution and approve the resulting packet only when every unchanged term and consequence remains unambiguous; all broader edits require a revised packet

## 2026-07-30

### Changed

- **Inbound handoff markers** -- Destination quest feeds hide redundant inbound transition rows while source threads retain the outbound breadcrumb and All Threads keeps the complete audit
- **Raw protocol recording** -- Automatic Claude, Codex, and browser payload capture is off by default while explicit environment opt-in, manual per-session capture, and existing-file inspection remain available
- **Model migration notices** -- Legacy model-identity warnings can be acknowledged across browsers and restarts without erasing audit history, and stale acknowledgements cannot hide a newer event

## 2026-07-29

### Changed

- **Replay comparison layout** -- Transcription Replay & compare starts collapsed while Raw Transcript stays visible and comparison details remain accessible on demand

### Fixed

- **Managed model identity** -- Codex routing fails closed when the selected model cannot be proven, preventing silent drift or fallback while retaining one-time legacy migration provenance

## 2026-07-28

### Added

- **GPT Transcribe voice model** -- New voice-transcription settings default to `gpt-transcribe` with bounded vocabulary and expected-language hints while preserving older and custom model compatibility
- **Transcription replay comparisons** -- Transcription Detail can re-run stored audio or raw transcripts against selected models, save comparison variants, and rediscover a privacy-bounded recording archive after restart
- **Transcription record previews** -- Transcription Debug rows show bounded single-line enhanced-first or raw-fallback excerpts, while unsafe and non-ready records remain preview-free
- **Replay difference highlighting** -- Re-transcribe and re-enhance comparisons highlight stage-correct text changes with readable bounded fallbacks for long inputs

### Changed

- **Composer and Questmaster density** -- The composer condenses model controls into one chip and removes branch/diff metadata, while the compact quest table drops its User review checks column
- **Expected language picker** -- Selected language hints remain visible while the searchable picker stays collapsed until requested

### Fixed

- **Session unread consistency** -- Compact lists, live updates, and selection hydration share one server-authored notification projection so read or closed-thread alerts cannot inflate counts while legitimate unread stays visible
- **Copilot authentication exhaustion** -- Codex sessions pause automatic inputs after a strictly recognized terminal API-key refresh failure while preserving manual recovery and exact-once backlog drain

## 2026-07-27

### Changed

- **Delegate task results** -- Delegate traces group Bash commands with their results, lead with the child summary, and separate task, timing, and inspection metadata from result content

### Fixed

- **Delegate task context** -- Native-fork delegates resume the expected inherited Codex context, fail closed instead of silently starting fresh, and keep pending handoff state accurate
- **Backend startup labels** -- Session creation shows launch progress for Codex, Claude Code, or Claude SDK according to the selected backend
- **Leader route splits** -- Thread routing recognizes split markers even when blank spacer lines surround them

## 2026-07-26

### Changed

- **Delegate task contract** -- The command-only delegation tool is now the general `delegate_task(task)` workflow while retaining hidden child evidence, lifecycle safeguards, and compact parent results

### Fixed

- **Codex startup recovery** -- Queued work waits for initializing or resuming adapters to become ready instead of relaunching them prematurely, and internal initialization turn-end rows stay out of leader activity

## 2026-07-25

### Added

- **Quest commit diffs** -- Leader quest tabs can open quest-recorded code commits with selected-first loading, clear zero-code states, and protection from stale background failures

### Changed

- **Message dates** -- Message timestamps stay time-only today and add compact yesterday, current-year, or prior-year date context for older history
- **Quest Journey details** -- Long phase histories are grouped and windowed so current runs stay readable while older notes remain accessible

### Fixed

- **Delegate child lifecycle** -- Completed hidden delegates leave active session lists without losing UUID-backed transcript inspection

## 2026-07-24

### Changed

- **Post-Explore routing** -- Leaders can revise a completed Explore directly to a clear low-risk Implement step while required User Checkpoints and later safeguards remain protected
- **Light theme contrast** -- Chat, quest links, attention rows, and related light-theme surfaces have clearer text and state contrast

## 2026-07-23

### Added

- **Delegated work** -- Leaders can fork bounded work into a hidden Codex child, keep raw evidence in the child transcript, and receive a compact inspectable parent result

### Changed

- **Bash result visibility** -- Codex Bash cards prefer fuller matching output, mark embedded newlines in collapsed previews, and bound retained raw output
- **Injected event details** -- Injected events show payload size metadata, and memory-catalog snapshots can be copied from their feed rows

### Fixed

- **Thread routing boundaries** -- Mid-message route splits, deep-link scroll targets, and stale ready-status chips resolve to the intended thread without repeated navigation
- **Codex tool readiness** -- Startup and delegated-child prompts wait for refreshed MCP tools and an actual callable handoff tool before proceeding

## 2026-07-22

### Added

- **Memory catalog startup context** -- Leader startup and recovery receive a visible catalog snapshot so relevant durable memory can be inspected before work continues

### Changed

- **Leader tab selection** -- Relevant quest tabs can surface in the background without automatically replacing the leader's selected thread

### Fixed

- **Thread-aware message links** -- Session and message links select the intended thread before jumping to their target
- **Codex shell environment** -- Session-scoped Codex shell tools preserve the configured home directory and its isolated session state

## 2026-07-21

### Added

- **Journey revisions** -- `takode board revise` can replace an active Journey suffix while preserving completed phase history and validating required safeguards

### Changed

- **Board proposals** -- `takode board propose --summary` creates and presents one expanded approval packet with Journey and dependency context

### Fixed

- **Thread continuation links** -- Continuation markers keep their session and quest links when rendered in collapsed feed history

## 2026-07-20

### Added

- **Questmaster local backups** -- Quest and Journey text gains retained local snapshots and mutation journals, with separately deduplicated image blobs and manual restore guidance

### Fixed

- **Needs-input retries** -- Notification retries anchor to visible prompts, deduplicate only exact active retries, and report recovered notification state more accurately
- **Quest hover previews** -- Quest links validate cached preview metadata before rendering so stale summaries do not appear under the wrong quest

## 2026-07-17

### Changed

- **Leader ready outcomes** -- Leader workflows verify promised durable actions before marking a thread Ready

### Fixed

- **All Threads status noise** -- Internal thread-status chips stay out of the combined All Threads feed

## 2026-07-15

### Changed

- **Quest reference autocomplete** -- Composer quest references use the full authoritative candidate set instead of only the currently loaded quest page

### Fixed

- **Message navigator jumps** -- User-message navigation loads off-window targets before scrolling to them
- **Internal status rows** -- Codex retry turn-end events and Thread Ready bookkeeping stay out of the visible conversation feed

## 2026-07-14

### Added

- **Leader skill preloading** -- Leader sessions preload required orchestration skills during startup and recovery so recycled or resumed leaders regain Journey guidance more reliably

### Changed

- **Needs-input suggestions** -- Needs-input prompts can carry more short suggested answers, with guidance updated to keep choices useful without an arbitrary cap
- **Checkpoint approval guidance** -- Leader and checkpoint instructions distinguish actual user decisions from corrections more explicitly before continuing work
- **Leader work summaries** -- Session summaries show waiting counts, and newly started Journeys receive clearer attention treatment

### Fixed

- **Leader preload recovery reminders** -- Recovery reminders avoid false compaction signals during resume replay and point leaders back to preload state more accurately
- **Quest Quiz directives** -- Inline quiz directives render after their quest details arrive instead of remaining unresolved in fetched history

## 2026-07-13

### Changed

- **Quest Journey routing** -- Leaders can use lighter direct dispatch for low-risk tasks, and Outcome Review is optional when the approved Journey does not need a separate acceptance pass
- **Codex launch defaults** -- Codex catalog handling disables unsupported Responses Lite options for MAI LiteLLM catalogs and gives non-leader sessions a safer auto-compact default

### Fixed

- **Quest link previews** -- Quest links show hover previews more reliably
- **Codex model switching** -- Model changes, relaunches, leader context preservation, failed compaction recovery, and recycle watermarks recover more reliably without duplicate migration loops
- **Archived session recovery** -- Archived-session relaunch and partial archive-group failures reconcile UI and server state more consistently

## 2026-07-11

### Changed

- **Codex model catalog** -- Model pickers include refreshed Codex options and runtime-setting updates, with future reasoning parameters preserved for compatible models

## 2026-07-09

### Changed

- **Archived session browsing** -- Archived sessions load in pages and open in read-only views so large archives are lighter and safer to browse

### Fixed

- **Configure Session context capacity** -- Configure Session and session info surfaces show context capacity more accurately for Codex sessions

## 2026-07-08

### Added

- **Notification row actions** -- Notification rows expose per-session actions from notification chip surfaces
- **Questmaster preview loading** -- Quest lists, hover cards, and detail panels can load compact previews before hydrating full quest records

### Fixed

- **Leader tool routing** -- Unthreaded or mixed leader tool/result rows route to the most recent relevant thread more consistently
- **Mixed tool result previews** -- Assistant messages can render mixed tool-result previews without losing surrounding context
- **Quest detail caching** -- Partial quest detail loads preserve summaries and avoid stale detail-cache state

## 2026-07-07

### Added

- **Session directory opening** -- Session info surfaces can open session directories in the local file browser

### Fixed

- **Archived worktree cleanup** -- Archived worktree cleanup retries and retry rows reconcile branch deletion failures more reliably

## 2026-07-06

### Fixed

- **Archive reconciliation** -- Sidebar archive mutations and reviewer archive markers roll back or reconcile more safely when archive operations fail

## 2026-07-02

### Changed

- **Quest Quiz guidance** -- Completion guidance makes quiz questions more useful and better grounded in agent-discovered outcomes

### Fixed

- **Thread route splitting** -- Post-quiz routes, split thread routes, and ready-thread unread views avoid cumulative append and stale read-state issues

## 2026-07-01

### Changed

- **Pushover prompts** -- Pushover input prompts use a clearer title

### Fixed

- **Reviewer sidebar chips** -- Reviewer labels fit and render consistently in sidebar chips
- **Diff syntax highlighting** -- Unified diff panels highlight syntax more reliably
- **Leader thread tabs** -- Completed leader thread tabs, active Work Board tab ordering, and ready-thread unread markers persist more predictably

## Earlier history

Changes from April 10 to June 30, 2026 are in the [April to June 2026 changelog](docs/changelog/2026-04-to-06.md).
