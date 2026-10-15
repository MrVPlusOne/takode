# Takode Changelog

## October 2026 release: one Takode across your machines

Until this release, every Takode session ran on the machine that hosted the Takode server. That works until the code you care about lives somewhere else: a cloud workspace, a GPU box, a second computer under your desk. The headline of this release is that one Takode now spans all of them. The server becomes the **coordinator**, which keeps your sessions, quests, work boards and memory in one place, and any machine you register as a **host** can run sessions for it. You keep one browser tab and one session list, and your leaders can start workers wherever the code and the hardware are.

Adding a machine takes two steps: register it with `takode host add` or in Settings → Hosts, then run `takode node` on it. The node dials out to the coordinator, so the host needs no open inbound ports. It signs in with its own token and keeps its own Claude Code and Codex logins. Everything that touches files runs where the files are: Git status, diffs, file previews, worktrees and terminals for a session all run on its machine. The new-session dialog has a machine picker that browses that machine's folders and branches, every remote session carries a chip naming its machine, and a leader can place a worker on a particular machine with `takode spawn --host`. Agents on a host use quests, memory and the Takode commands just as they do locally. All of their reads and writes go through the coordinator, so your data never splits into diverging copies. The [remote hosts guide](docs/remote-hosts.md) walks through the setup, including tunnels and shared machines.

Working across machines also made sessions sturdier everywhere. Sessions now keep running while you restart the Takode server, both on hosts and on the coordinator's own machine, and the restarted server picks them up where they were, pending permission requests included. Restart Server first brings the server's checkout up to date with the branch it tracks, and hosts started with `--auto-update` follow the coordinator onto the new build. When a turn loses its connection to the model API, it now pauses and continues on its own once the network is back instead of failing. If you outgrow a machine, you can move the whole coordinator to another one; the [coordinator move guide](docs/moving-the-coordinator.md) covers rehearsal, cutover and rollback. For reaching Takode from other machines, an optional browser login password guards the app, and a separate token-only host port keeps a tunnel on a shared machine from exposing your server.

The rest of the release is about spending less effort keeping up with your agents. Unsent drafts, including composer text, attached images, comments and half-answered questions, are kept by the server and follow you between your laptop and your phone. An attention list in the top bar gathers every question, Notify Me result and unread result across your sessions, and Next steps through them in priority order. Leader threads show a live preview of the worker they are waiting on, open with a card describing the quest and close with its final summary, and a Board button opens the work board from any thread. Agent activity between messages collapses into compact cards with a one-line summary, and a needs-input question now arrives as an ordinary explanation followed by a short question card, which you can snooze until later. Phone alerts can also go through Web Push, alongside Pushover.

Under the hood, Claude sessions now run only through the Claude Agent SDK, with Claude's native Auto permission mode, a reasoning effort picker and the model list Claude Code itself reports. Teams that share a branch can turn on a landing queue that tests waiting changes together and lands them, so workers are free as soon as they submit. Switching sessions over a slow connection is much faster thanks to compressed traffic and a reused connection. The dated entries below list every notable change.

## [0.47.0](https://github.com/MrVPlusOne/takode/compare/the-companion-v0.46.0...the-companion-v0.47.0) (2026-10-15)


### Features

* add conversation comment attachments ([a58c04f](https://github.com/MrVPlusOne/takode/commit/a58c04f8a43b6b3ba0d37c8c81ef2a163d10b937))
* add counted resource lease pools ([d2492f9](https://github.com/MrVPlusOne/takode/commit/d2492f90b48a2753ffce2bdb1ce58170256569f6))
* **attention:** amber attention chip counts only open questions ([e26ee0c](https://github.com/MrVPlusOne/takode/commit/e26ee0c65e679d8342964f9dd4484f4c73d99217))
* **attention:** close any leader's thread tab from the attention lists ([2862220](https://github.com/MrVPlusOne/takode/commit/286222091b58fade8a9d849569f50aec13444c69))
* **attention:** long-press the feed chip to close the tab and go to the next item ([02b19f6](https://github.com/MrVPlusOne/takode/commit/02b19f659671b0c9fd22d07d0e8c603f1448e0d8))
* **attention:** make the feed chip a next button and the top bar a list ([720dd67](https://github.com/MrVPlusOne/takode/commit/720dd670b782bb8312fe404589d20d75af2266de))
* **attention:** move attention row actions into a context menu ([7772a44](https://github.com/MrVPlusOne/takode/commit/7772a44146883238564d08c24e0a0068766dbf30))
* **attention:** move muted questions and tracked Notify Me tasks into the attention list ([6cc8791](https://github.com/MrVPlusOne/takode/commit/6cc8791033eec0b5acc56cf6c9b1294eb6ffbf74))
* **attention:** name the quest on attention rows' second line ([d00f96f](https://github.com/MrVPlusOne/takode/commit/d00f96fae940505bda208d423f850f73830d6a78))
* **attention:** name the thread tab on every attention row's second line ([2b53550](https://github.com/MrVPlusOne/takode/commit/2b5355056c5006df888e8171d5ef7f6d5d8ee92d))
* **auth:** add an optional browser login password ([feff80f](https://github.com/MrVPlusOne/takode/commit/feff80fe91651797c7fec32ee475ce070bd600e2))
* **board:** put a quest in User Checkpoint while its leader's question is open ([b7fb0b4](https://github.com/MrVPlusOne/takode/commit/b7fb0b4636cb3b5512de1788de9d9368017a8f33))
* **bridge:** show assistant text only once messages complete ([d31e6b9](https://github.com/MrVPlusOne/takode/commit/d31e6b9729fcbac2fad83c0737cea8eae7b8ca47))
* **chat:** publish annotatable Markdown report snapshots ([ebd6fcd](https://github.com/MrVPlusOne/takode/commit/ebd6fcdc0250f39ce2ab3bce11982006363935e0))
* **claude:** run Claude through Agent SDK 0.3 query() ([16a9540](https://github.com/MrVPlusOne/takode/commit/16a954006027dc30e071093c437c592f03d88619))
* **claude:** working web search and WebFetch for Claude sessions on GitHub Copilot ([1959371](https://github.com/MrVPlusOne/takode/commit/1959371d5c67f5838a58d5766694af71fcf69cfa))
* **cli:** accept large text through stdin ([628a9ba](https://github.com/MrVPlusOne/takode/commit/628a9bab56f635e747aef98c5617a7ad2246800d))
* **cli:** route quest and memory writes through the server ([d152986](https://github.com/MrVPlusOne/takode/commit/d152986c5bd48da5bece8c25a3ed39bb77d4f27e))
* **commits:** browse verified ranges behind recorded delivery tips ([31eb270](https://github.com/MrVPlusOne/takode/commit/31eb270b466975574e6294f91f821b8f8c2e41bd))
* **composer:** add reasoning effort to the Claude model picker ([ac8b004](https://github.com/MrVPlusOne/takode/commit/ac8b0047fcadf1eacfa8026bc3409f2b8b11b2fb))
* **composer:** configurable send key shared by composer and comment boxes ([be8ad41](https://github.com/MrVPlusOne/takode/commit/be8ad416b0ea77f65e9711a9dba6d0c6c9a2faaa))
* **composer:** tag voice-transcribed messages so agents know they were dictated ([ec36e46](https://github.com/MrVPlusOne/takode/commit/ec36e46234b9610c966fa00cee811edc5af2a0de))
* **coordinator:** hand the coordinator to another machine ([55cb65f](https://github.com/MrVPlusOne/takode/commit/55cb65f9f61ee2cc89e02d3ddd6659d8563b92e7))
* **dev-scripts:** fall back to ss when lsof is missing ([baede8a](https://github.com/MrVPlusOne/takode/commit/baede8aebb857994308e4db98e53b23092fcebb1))
* **diagnostics:** collect bounded startup asset timings ([b35195e](https://github.com/MrVPlusOne/takode/commit/b35195e2202aa4f43e8e5ddb3dfc7e5b39798ea2))
* **diagnostics:** log browser connection transfer costs ([14cb4ea](https://github.com/MrVPlusOne/takode/commit/14cb4ea8f78d08192af17ec24239e85b65b0b900))
* **diagnostics:** retain frontend load stages by connection ([aa883ca](https://github.com/MrVPlusOne/takode/commit/aa883ca48e9448e63b030c54343fca350e9ff4ea))
* **diff:** open diffs from the quest banner chip instead of the top bar ([28b368c](https://github.com/MrVPlusOne/takode/commit/28b368c18b3a88f1f276c2ab54e0e0e69a0490aa))
* **drafts:** sync composer and needs-input drafts through the server ([bac3e8b](https://github.com/MrVPlusOne/takode/commit/bac3e8b83cfdb7318c4586ae90280cd919d7fef5))
* **drafts:** sync uploaded composer images across devices ([bd89b28](https://github.com/MrVPlusOne/takode/commit/bd89b2830bd95dd803b7337cd548cd6adaaff932))
* **feed:** clickable thread links joined with the answer chip ([7cbcd74](https://github.com/MrVPlusOne/takode/commit/7cbcd741be99a84e2d1eb1281e81380fd4eb7292))
* **feed:** collapse inactive activity groups to their header ([0856c0c](https://github.com/MrVPlusOne/takode/commit/0856c0c8437d6219fe416e40c9d9f16f588c94fe))
* **feed:** collapse leader messages rejected for bad thread tags ([a8966f9](https://github.com/MrVPlusOne/takode/commit/a8966f9e5eb0fab341ff176f0cbb8909b554bbba))
* **feed:** count a running tool group's total time live in its heading ([8466dcc](https://github.com/MrVPlusOne/takode/commit/8466dcc8d77f51edca28f29d6c6b5a0c30838176))
* **feed:** cycle through a session's attention items from its feed chip ([7b039bf](https://github.com/MrVPlusOne/takode/commit/7b039bfdcc14826502d666098ddaaa43fdfc0817))
* **feed:** group all agent activity between texts into rolling-window cards ([dfd406b](https://github.com/MrVPlusOne/takode/commit/dfd406b2b149af1e3126f525649a315c57e2e77d))
* **feed:** label the attention chip "Next" instead of the item's kind ([652a395](https://github.com/MrVPlusOne/takode/commit/652a395187da79982738354f4e28682e5d47f6d7))
* **feed:** let collapsed command runs grow with their contents ([c5b8401](https://github.com/MrVPlusOne/takode/commit/c5b8401a3a0b937f31429057d68b13861a78f0f3))
* **feed:** make tool activity line previews informative ([dc9dbc6](https://github.com/MrVPlusOne/takode/commit/dc9dbc6f45b90c199a3b9534943a80277ab47a4b))
* **feed:** open leader quest threads with a quest description card ([8e74548](https://github.com/MrVPlusOne/takode/commit/8e745484d72ae00d54e1c546cdeb64e9236a7c1b))
* **feed:** render Takode-injected messages as one shared collapsed chip ([4ee2477](https://github.com/MrVPlusOne/takode/commit/4ee24777e283dfced89dcc0cd0a54879537e1858))
* **feed:** set the waiting worker preview apart with a status-keyed edge ([d37da65](https://github.com/MrVPlusOne/takode/commit/d37da65bebc1b091313c3eb0d6a14963494b6bad))
* **feed:** show a quest-complete summary card in leader quest threads ([35544b8](https://github.com/MrVPlusOne/takode/commit/35544b8b0a09c2cdea584827e96b29fbe7ef7983))
* **feed:** show Markdown image syntax as a reserved thumbnail, marked missing when gone ([945074b](https://github.com/MrVPlusOne/takode/commit/945074b3a7ed6688128f824c898a86d7d9fd9ba8))
* **feed:** show published reports in collapsed leader turns as a clipped, expandable preview ([abb212a](https://github.com/MrVPlusOne/takode/commit/abb212ad7c966c1370be727e6883c45c88b6fa56))
* **feed:** show screenshots inline in visual decisions ([5c8d4ae](https://github.com/MrVPlusOne/takode/commit/5c8d4aea8199b3c94f5e5e527d8359ba723ff199))
* **feed:** show the last message in collapsed turns without an answer ([3cedc65](https://github.com/MrVPlusOne/takode/commit/3cedc6594e8cc9f5dc817ca8c1cf9edb826fea46))
* **feed:** turn image paths in agent messages into file-name links ([9df2144](https://github.com/MrVPlusOne/takode/commit/9df2144de922a5d801c2c42da30a0bba4e72ec6a))
* **feed:** walk the paw down the feed as new answers arrive ([540aef3](https://github.com/MrVPlusOne/takode/commit/540aef3b535d7690404e61463119b01248a13c59))
* **herd:** make the worker-slot limit configurable per leader backend ([fb7dc9a](https://github.com/MrVPlusOne/takode/commit/fb7dc9a853df98e7cb517fb4599d04e9f40642ec))
* **host:** keep Takode data on the coordinator for CLIs on remote hosts ([30ba931](https://github.com/MrVPlusOne/takode/commit/30ba931845b7e132dcb1f8f88df4b58cbeb3404f))
* **hosts:** always run this machine's sessions under its local node ([a448c25](https://github.com/MrVPlusOne/takode/commit/a448c25d882700510ec9d52113dacc4e08540003))
* **hosts:** create and clean up worktree sessions on remote hosts ([bedefe2](https://github.com/MrVPlusOne/takode/commit/bedefe23617e3d127bc7922bf4a91b4d4a3746da))
* **hosts:** give each host its own pool of machine-local leases ([8396e95](https://github.com/MrVPlusOne/takode/commit/8396e95b785cf99491fdfcd57da90a703bb1d8c7))
* **hosts:** give each machine its own Claude and Codex settings ([0f10773](https://github.com/MrVPlusOne/takode/commit/0f107735dd2e8106f52abd6a1f1ed3843d350643))
* **hosts:** give machines stable names and stamp quest notes with them ([c46703f](https://github.com/MrVPlusOne/takode/commit/c46703f2df82e85ac7e069772dcb49ec17e760d8))
* **hosts:** inspect remote sessions' git state, diffs and files on their host ([5f33155](https://github.com/MrVPlusOne/takode/commit/5f33155b33898d0deb1da95127d536cd9b5cb7d2))
* **hosts:** keep host sessions running across coordinator restarts ([c52ff1f](https://github.com/MrVPlusOne/takode/commit/c52ff1fab8946b9d1a9e17ac07879899128c001f))
* **hosts:** keep host updates from killing pre-submit test runs ([1ce3313](https://github.com/MrVPlusOne/takode/commit/1ce3313562e6154d8d890e99952258cb76ff22bc))
* **hosts:** keep one coordinator per server with a start counter ([63cd6ad](https://github.com/MrVPlusOne/takode/commit/63cd6add3b558d9fc202c666725553cb95451cb4))
* **hosts:** keep this machine's sessions running across server restarts ([0bbabf3](https://github.com/MrVPlusOne/takode/commit/0bbabf384ff17df6f2acffd21395180540cb025d))
* **hosts:** let agents on remote hosts use memory, quests and Takode tools ([9429276](https://github.com/MrVPlusOne/takode/commit/942927653ecb6e7b17631502dc5cd6c766bff45c))
* **hosts:** manage hosts, pick a machine and show host status in the UI ([ec90b84](https://github.com/MrVPlusOne/takode/commit/ec90b84fd2b4d8c850565acfad4003661287e231))
* **hosts:** neutral machine chips that mark only offline hosts ([ad88f48](https://github.com/MrVPlusOne/takode/commit/ad88f48bac4fed230be49433c6bda5ce407179fc))
* **hosts:** report host builds and auto-update hosts to the coordinator's commit ([d39f1f4](https://github.com/MrVPlusOne/takode/commit/d39f1f4feaaf1de20433c2058c42f98a3399c1cc))
* **hosts:** run Claude sessions on registered remote hosts ([ccf3fde](https://github.com/MrVPlusOne/takode/commit/ccf3fded920840acea47df94606541402407f1ca))
* **hosts:** run Codex sessions on remote hosts ([0250131](https://github.com/MrVPlusOne/takode/commit/0250131f2df40ede648350352b2cc40a34b8bc37))
* **hosts:** show which machine runs each session ([c97d9b1](https://github.com/MrVPlusOne/takode/commit/c97d9b1f5f6dd4ba5617be1149ba91d59c79d5ce))
* **hosts:** spawn workers on remote hosts and hand their commits back as bundles ([ae0c928](https://github.com/MrVPlusOne/takode/commit/ae0c928014892c849647b69df4691674ad1551b1))
* **hosts:** tell recovered sessions what was kept and lost, and keep worktrees in a per-host folder ([e57aa4b](https://github.com/MrVPlusOne/takode/commit/e57aa4bc641994c60840c1fd4296ef1f4059aed2))
* **hosts:** token-only host port so tunnels don't expose the coordinator on shared machines ([0f7e5e6](https://github.com/MrVPlusOne/takode/commit/0f7e5e60fcf0879847f2345b42241d81c68008d6))
* **hosts:** update every host right after Restart Server ([f44558b](https://github.com/MrVPlusOne/takode/commit/f44558b24a2b41d96c38d6b2c02b03512457a6e9))
* **images:** pinch, drag and double-tap to zoom image previews ([b897f70](https://github.com/MrVPlusOne/takode/commit/b897f703eddf6ffbdbe62ac039b3d121175cf26e))
* **images:** swipe between images in the image viewer ([7be9124](https://github.com/MrVPlusOne/takode/commit/7be9124a32816fc7abc0b35a3f091ce9e828247f))
* improve comment previews and composer controls ([e5af814](https://github.com/MrVPlusOne/takode/commit/e5af814c8c49aa4e0fe9d97aefb0d5e041a77350))
* **instructions:** tell agents to end their turn instead of chaining sleeps ([c905645](https://github.com/MrVPlusOne/takode/commit/c905645957e40dd7061b0cf6716ad09a45fff34d))
* **land:** give gate commands a per-machine environment ([ae028c4](https://github.com/MrVPlusOne/takode/commit/ae028c48179ba0d063aece8a9eba024fc964560f))
* **landing:** free workers once their changes are submitted ([5be91a6](https://github.com/MrVPlusOne/takode/commit/5be91a601ed6c74bbff663ee7356573bd8c5af1a))
* **land:** make the pre-submit check focused on chosen tests ([69680ca](https://github.com/MrVPlusOne/takode/commit/69680ca9936f41501539cdb98ad9f05eb17a896b))
* **land:** store landing gates on the Takode server ([aada1a3](https://github.com/MrVPlusOne/takode/commit/aada1a3cf791a62e6821b393ee6085cf493a910f))
* **latency:** record the host link hop for CLIs on remote hosts ([a267988](https://github.com/MrVPlusOne/takode/commit/a267988ecef86cab2eef0b4373afe17746298aaf))
* **leader-tabs:** recent chats move a tab up within its status group ([ccd532c](https://github.com/MrVPlusOne/takode/commit/ccd532c6115a56a84bc4fef5ffb15f4a0f8e125b))
* **leader-tabs:** show when a quest tab belongs to another leader ([1ce3d71](https://github.com/MrVPlusOne/takode/commit/1ce3d71ca7771d346e3604a73718fdb53efc2d27))
* **leader-threads:** show a live turn timer in the worker preview title ([c618c99](https://github.com/MrVPlusOne/takode/commit/c618c9926f25ca0750885dd6078bd0cde4b87d8c))
* **leader-threads:** simplify the worker preview title bar ([a30cf40](https://github.com/MrVPlusOne/takode/commit/a30cf405cf683ea77711c34b512f362c38ec5bc2))
* **leader:** move the waiting-worker preview into the chat feed ([75203e7](https://github.com/MrVPlusOne/takode/commit/75203e76cc66491d6defa9dd63c7924d0569b49b))
* **leader:** show live worker preview in waiting quest threads ([55fff1b](https://github.com/MrVPlusOne/takode/commit/55fff1beaebb3c989d2a232c9d3ba4815906cbd2))
* **leases:** let leaders force-release reservations ([1f82896](https://github.com/MrVPlusOne/takode/commit/1f82896ad296079121756c357ecc6a0c14e7a558))
* **leases:** share port leases for a repository branch across machines ([e840232](https://github.com/MrVPlusOne/takode/commit/e840232791d7afd6cf875d36fef725beac904024))
* **leases:** show lease wait time in the lease chip ([a34358d](https://github.com/MrVPlusOne/takode/commit/a34358d95fbe01ad8bb83f32e6aa5ab2b1ffd563))
* **memory:** bounded catalog with topic folders, handle dedupe and memory skill ([593fd9d](https://github.com/MrVPlusOne/takode/commit/593fd9df75cfcb43fa1c5706e913ae041ae811e4))
* **memory:** record the machines each memory note was written on ([6876a2c](https://github.com/MrVPlusOne/takode/commit/6876a2c9ee3e141d6dca18137dd3fa4baa39d1d2))
* **mobile:** declutter the phone top bar and add Next attention navigation ([658b53d](https://github.com/MrVPlusOne/takode/commit/658b53d18e4cb30e03a3978090f2d67400d644e9))
* **mobile:** share the native-style long-press menu across mobile context menus ([b429bc9](https://github.com/MrVPlusOne/takode/commit/b429bc92c59f7fe9be504bfef84a0f145d012812))
* **needs-input:** put reply controls at the right edge for one-handed use ([0228c0b](https://github.com/MrVPlusOne/takode/commit/0228c0b6e043a4ae6dbe1e3b8dd4060fdcaca8a7))
* **notifications:** add independent Notify Me push setting ([4fffab1](https://github.com/MrVPlusOne/takode/commit/4fffab1fa0e76ad37080b84b2fe50021266f90a8))
* **notifications:** add link syntax for needs-input notifications ([c92cb95](https://github.com/MrVPlusOne/takode/commit/c92cb9521fc681dc1552b881a41bdf7d07b083eb))
* **notifications:** add remind-me-later snooze for needs-input prompts ([501e019](https://github.com/MrVPlusOne/takode/commit/501e019ea643d6b15fa795e9deffc56590b378a7))
* **notifications:** offer 1h, 6h and 24h snoozes and snoozing until a chosen day ([750b5a3](https://github.com/MrVPlusOne/takode/commit/750b5a3a1c44e3f1d1d29a08018503e07f028c4f))
* **notifications:** remind on the phone about questions left waiting ([ba8b5c7](https://github.com/MrVPlusOne/takode/commit/ba8b5c723a50ed08f2c455b2e29e51df3b57853f))
* **notifications:** restyle needs-input cards with a neutral look and option rows ([fab0edb](https://github.com/MrVPlusOne/takode/commit/fab0edbb49d3d58ba3609eb57d34083eedbd0c28))
* **notifications:** send phone alerts through Web Push with retraction ([cdaff85](https://github.com/MrVPlusOne/takode/commit/cdaff85725c25eba504876d2c9cee402f82ecff2))
* **notifications:** split needs-input prompts into feed context and question-only card ([96eec4d](https://github.com/MrVPlusOne/takode/commit/96eec4d28d1aed6d2951264e613908e9e612ec38))
* **notify:** show needs-input decision context in the question card ([b993f4b](https://github.com/MrVPlusOne/takode/commit/b993f4bdd615992e8b9b298fc88c7d037c234ae0))
* **orchestration:** start quests in Work with optional reports ([5950546](https://github.com/MrVPlusOne/takode/commit/59505460138251d7d49d06a0d4b91c226870805f))
* **perf:** track end-to-end latency of CLI commands and Codex RPCs ([913c68e](https://github.com/MrVPlusOne/takode/commit/913c68ea5b774980cb96097cd36ff10834305537))
* **permissions:** add Claude Auto mode and trim the Claude permission menu ([d1cb0e0](https://github.com/MrVPlusOne/takode/commit/d1cb0e0cec4b58a6b09c65aed1c37ec2c0a96d54))
* **port:** land shared-branch changes through a batched landing queue ([941bccc](https://github.com/MrVPlusOne/takode/commit/941bcccc98d4f7157cc644ef208aca023a79fc64))
* **quest-header:** say Done and drop the phase total on phones in the quest header chip ([3eeae3b](https://github.com/MrVPlusOne/takode/commit/3eeae3baff77da30f9a2b4e4a8b0ba042c4d7666))
* **quest-preview:** make the quest preview easier to read ([ee1d9fa](https://github.com/MrVPlusOne/takode/commit/ee1d9fa3040b869e9a5ff7abfe79a0562d374d10))
* **quest-preview:** preview a quest when a message link is tapped on touch ([8e73c00](https://github.com/MrVPlusOne/takode/commit/8e73c00ec8b85c140ddaedb846efe6ea29b6094f))
* **quests:** compact the full quest view header on phones ([07dfccc](https://github.com/MrVPlusOne/takode/commit/07dfccc2c278f527c56e6a4e99524e706a156787))
* **quests:** modernize the quest view's feedback and action bar ([19edcd2](https://github.com/MrVPlusOne/takode/commit/19edcd24dfe6d47d0572cdaa2d46d0f65236a586))
* **quests:** pin Open Worker and Open Thread to the bottom of the phone preview sheet ([3041a7d](https://github.com/MrVPlusOne/takode/commit/3041a7d15d777068053c2fedf869de653f7882dd))
* **quests:** put Open Worker and Open Thread buttons at the top of quest views ([92782a3](https://github.com/MrVPlusOne/takode/commit/92782a35044f1cb9516d1b73c9913621c6cce139))
* **quests:** verify independently approved delivery targets ([162d3a8](https://github.com/MrVPlusOne/takode/commit/162d3a833c4c9b3cf387e457f420c1fcf8f06c1a))
* **quiz:** let the user collapse feed quest quizzes ([eef607b](https://github.com/MrVPlusOne/takode/commit/eef607bf9b367b173c4ddbac43ccabe682b9bf49))
* **recovery:** cap hidden continues and lengthen Claude's own retries ([7a21948](https://github.com/MrVPlusOne/takode/commit/7a219480702f42f63c82ab135967762c48c1d1d3))
* **recovery:** pause and auto-resume turns during network outages ([9d344c5](https://github.com/MrVPlusOne/takode/commit/9d344c51e6f85a6ca4dc6cfc0c697c6fabf33770))
* **remote-hosts:** open session terminals on the session's remote host ([7690d08](https://github.com/MrVPlusOne/takode/commit/7690d088ff5093cd500010951ad32e23f571122f))
* **reports:** name only the report file in agent-facing report comments ([9542475](https://github.com/MrVPlusOne/takode/commit/9542475745543cfa12b4c447ab4ab88283d20e8b))
* **reports:** send report comments to the current session like any other comment ([023d695](https://github.com/MrVPlusOne/takode/commit/023d6954c99f2ccb98918fa7de9c76b35d574a85))
* **restart:** load the code landed on the server's branch ([fd6f2fe](https://github.com/MrVPlusOne/takode/commit/fd6f2fe243f1fcce29995f3bc5cec6baa2ee1754))
* **restart:** pull the latest published code, or stop and say why ([025e5e6](https://github.com/MrVPlusOne/takode/commit/025e5e6b1f495df8fec3d91268160205a0e609df))
* send Pushover alerts for monitored thread results ([fc4c639](https://github.com/MrVPlusOne/takode/commit/fc4c6396f85475140a885f2ff0ad2dd17623de9e))
* separate leader recycle and compact commands ([53b4d78](https://github.com/MrVPlusOne/takode/commit/53b4d7803260f3593cd5f0deff5727badb0378dd))
* **session-store:** persist large session histories incrementally ([9196b71](https://github.com/MrVPlusOne/takode/commit/9196b71c2c01af5e93fde9eb12f3234a1daeeff2))
* **sessions:** browse remote host folders and branches in the new-session dialog ([3944476](https://github.com/MrVPlusOne/takode/commit/3944476a8c0d12b1744e79b57fdb8e766dbd9939))
* **session:** settings in the title and Session Info, quests and participant chips ([fa260a0](https://github.com/MrVPlusOne/takode/commit/fa260a0b6831409930a2290661b87087c8a42aed))
* **settings:** list incoming and current-build changes in the Restart section ([6bc1371](https://github.com/MrVPlusOne/takode/commit/6bc1371de6871380dde424435f73908f43b03414))
* **settings:** regroup Settings into six groups with clearer controls ([c1b5b6f](https://github.com/MrVPlusOne/takode/commit/c1b5b6f3d7ff66d45e8701b45584b290a8795ced))
* **settings:** server time zone setting applied at every server start ([cb7584a](https://github.com/MrVPlusOne/takode/commit/cb7584a08db7d511e29f1eb5796fc137799f8153))
* **settings:** show each host's progress onto the new build after a restart ([870d5bb](https://github.com/MrVPlusOne/takode/commit/870d5bb5b2303f370873adc9afc1d74a8f4975b7))
* **settings:** split Settings into ten clearer groups ([d30ebf0](https://github.com/MrVPlusOne/takode/commit/d30ebf019411c3c633146d9dfe04fc3274d52eb4))
* **sidebar:** add a Recent view that lists sessions by recent interaction ([3d69879](https://github.com/MrVPlusOne/takode/commit/3d69879efb95f22225c75a872df702018d667fb4))
* **sidebar:** drop the archive button from session cards ([111a914](https://github.com/MrVPlusOne/takode/commit/111a9149b1b1fd203bae65518d241caf0b117d76))
* **sidebar:** one-row search and Quests, drop the needs-input and Notify Me counts ([8006c48](https://github.com/MrVPlusOne/takode/commit/8006c48f5098ece19f9f155382de5a8914022d6b))
* **sidebar:** search field and chips at the top of the sessions panel on desktop and phone ([a33d824](https://github.com/MrVPlusOne/takode/commit/a33d824f77a27a681eff0dfda4a266a8312e243d))
* **sidebar:** show a waiting leader's timer on its portrait corner and drop the timer text ([c410517](https://github.com/MrVPlusOne/takode/commit/c410517adfd2dd73f02e41ec4088f736ffe6d3fd))
* **tabs:** bigger strip close button, close slide, next tab from the same group ([485439d](https://github.com/MrVPlusOne/takode/commit/485439de76d2bd59902bc5c41e6d4795bf89f365))
* **tabs:** calmer tab groups and Main strip, ordered by the stages of the work ([d6c7773](https://github.com/MrVPlusOne/takode/commit/d6c7773a3bb4f45c1d4d3e4dc290188a851c7b80))
* **tabs:** close the tab on screen from the quest strip; spin where the leader works ([b3374a1](https://github.com/MrVPlusOne/takode/commit/b3374a18809d1eea9fea63e241335541ba167755))
* **tabs:** Find lists and reopens the leader's closed quest tabs ([9548bdf](https://github.com/MrVPlusOne/takode/commit/9548bdf9e701b901b747f3cc03c7e6acc8d0fe01))
* **tabs:** New results opens the next unread tab, with its list a step away ([f981970](https://github.com/MrVPlusOne/takode/commit/f981970540bb2c48d673b1dba24c333aa0bae298))
* **tabs:** show phone thread tabs as status groups ([dee2580](https://github.com/MrVPlusOne/takode/commit/dee258011cbaaf252611f163f686a33bb57219ce))
* **tabs:** use status groups on every screen size and retire the tab strip ([5260d19](https://github.com/MrVPlusOne/takode/commit/5260d19335273a256d7070dfae390342ad8cc527))
* **takode:** add an activity command showing the user's messages and the answers to them ([49f6dd2](https://github.com/MrVPlusOne/takode/commit/49f6dd2c641b888929a530206d518d9a051f17e9))
* **takode:** create peer leaders in the creator's session space ([99577c4](https://github.com/MrVPlusOne/takode/commit/99577c47534fea7a5b2139a5c347068d8e8d297a))
* **takode:** let leaders message other leader sessions ([ec7d57d](https://github.com/MrVPlusOne/takode/commit/ec7d57dd203c91cc448b0c47359eb390097d74f3))
* **takode:** show only session numbers in message source tags ([558db13](https://github.com/MrVPlusOne/takode/commit/558db13bab4aca036208d1c1f55fa93b69808efd))
* **takode:** show the first 1,000 characters of each message in takode activity ([e7df261](https://github.com/MrVPlusOne/takode/commit/e7df261d54351daab09eb25dbb98626bee7d0aa8))
* **takode:** tell senders whether queued messages were delivered ([bc37e60](https://github.com/MrVPlusOne/takode/commit/bc37e603cd9601eb785fbb3a8fc41b9a38ea0250))
* **terminal:** compact Terminal page with a machine picker ([33dc59f](https://github.com/MrVPlusOne/takode/commit/33dc59ff198e7d35fa7ba37b2e32de1f291cedfc))
* **threads:** open a tab menu on long-press or right-click ([7590bc1](https://github.com/MrVPlusOne/takode/commit/7590bc13c4b3aab01278b2c9f179f89a741023fa))
* **timers:** route scheduled reports to firing answers ([4904bad](https://github.com/MrVPlusOne/takode/commit/4904bad66417a335dd0a07bceb46ab537dfab953))
* **todos:** link personal to-dos to related quests ([142d030](https://github.com/MrVPlusOne/takode/commit/142d030e67ff8a8d5594ee76c523a8fdb7807de3))
* **todos:** mark to-do links and show each proposal's status ([0897c2e](https://github.com/MrVPlusOne/takode/commit/0897c2e12dfe516d915a5157f3debb1c53852da9))
* **todos:** show linked quests as status chips in the To-dos list ([b1fcc75](https://github.com/MrVPlusOne/takode/commit/b1fcc7530fe37ab5b5a956d675537ab92a840254))
* **todos:** to-do and proposal links with previews; proposals only add; agents make low-risk changes directly ([d49a377](https://github.com/MrVPlusOne/takode/commit/d49a3773622f6ec2d7c16b4a69bdc5b0b2cd8475))
* **ui:** float secondary views over the whole app instead of beside the chat ([461c2f6](https://github.com/MrVPlusOne/takode/commit/461c2f6e0110b517c6200a19045144cedea9bf69))
* **ui:** keep monitored thread results until acknowledged ([e0e0297](https://github.com/MrVPlusOne/takode/commit/e0e02979e9fb5b548db1d1f41f4cde1c241c76d5))
* **ui:** keep the conversation loaded and show pages and viewers beside it ([2c0deae](https://github.com/MrVPlusOne/takode/commit/2c0deae7bf59bb98467fa5039022d11fbc90d9ee))
* **ui:** open the leader work board from a top-bar Board button and make it easier to read ([9e5b398](https://github.com/MrVPlusOne/takode/commit/9e5b398d115e13ecde0405fab07199fe879ebb9f))
* **ui:** press feedback on every control, pending state for server actions, squish for Send and Reply ([d8d4879](https://github.com/MrVPlusOne/takode/commit/d8d4879a4a2a745c286cc0d6f630e0813ece49fe))
* **ui:** replace tracking with acknowledgement for pending results ([a762671](https://github.com/MrVPlusOne/takode/commit/a7626712a4a5929b86e4e6c0e77a33dce7f0ddb2))
* **ui:** show lease-waiting sessions as waiting instead of idle ([5d3b718](https://github.com/MrVPlusOne/takode/commit/5d3b718288030987e1ad5783b0f68bbaf2f45b6e))
* **ui:** show the leader's active quests as phase-colored dots in the Board button ([7d619fb](https://github.com/MrVPlusOne/takode/commit/7d619fb32c31612b42768b2de0daa535f6628f39))
* **ui:** show what idle workers are waiting for ([6c74f00](https://github.com/MrVPlusOne/takode/commit/6c74f00200c6d9acc7bd7ec9d90772d19d7fde61))
* **ui:** simplify quest headers and keep task actions direct ([24a61eb](https://github.com/MrVPlusOne/takode/commit/24a61eb61502178dbddbf8b04399d62668311aa1))
* **ui:** simplify turn activity disclosure ([78101aa](https://github.com/MrVPlusOne/takode/commit/78101aa8e86eda7fec6a9bd9eae970751b7a0974))
* **ui:** start Memory page folders collapsed ([c9af509](https://github.com/MrVPlusOne/takode/commit/c9af5095888e0628334c3810525de8cdfb3c5e16))
* unify compact composer behavior across devices ([fe92928](https://github.com/MrVPlusOne/takode/commit/fe92928d6af984924f27fe80befc0fc7a75808f1))
* **user-content:** hand setup and migration to an agent instead of Settings controls ([7f859b3](https://github.com/MrVPlusOne/takode/commit/7f859b3f36ab9d04349bb879ef419fbc9a68bc18))
* **user-content:** keep user instructions and skills once and deliver them to every machine ([3a9a9fb](https://github.com/MrVPlusOne/takode/commit/3a9a9fb6545853bcd1cfeccb27b0b169eda00aa6))
* **user-content:** split the store, preview imports and guide migrations ([b3e8e36](https://github.com/MrVPlusOne/takode/commit/b3e8e36e18535ca52922d9cadca3358f309690e4))
* **validation:** add and remove a copied live session in a validation slot ([a199754](https://github.com/MrVPlusOne/takode/commit/a19975477c67f6ea267f495d828b5d4c61e678b7))
* **validation:** map lease slots to dedicated ports, state and browser sessions ([d3541d0](https://github.com/MrVPlusOne/takode/commit/d3541d057609b53c5fc8217734896f5f1ab32c33))
* **voice:** choose microphones while recording and remember their order ([6355e57](https://github.com/MrVPlusOne/takode/commit/6355e570d1c3681a7464672895d592e8fbced3b5))
* **voice:** tag dictated needs-input answers and comments as transcribed ([4305abc](https://github.com/MrVPlusOne/takode/commit/4305abc6873f9d5b2a1c5b43442092753057cb41))


### Bug Fixes

* **agent-browser:** wake the display before screenshots on macOS ([b247bf7](https://github.com/MrVPlusOne/takode/commit/b247bf77bd583ba098cead9e756fb15433df01ea))
* align delivery batch reporting and commit comparisons ([059c94e](https://github.com/MrVPlusOne/takode/commit/059c94ebc77e4d7eef3c06daa238c21c9a57127d))
* **attention:** count an answer shown in several tabs as unread only in its own thread ([3657ea3](https://github.com/MrVPlusOne/takode/commit/3657ea3ef3f4565f1dc8a0dd010b38151eee9f22))
* **attention:** leave herded workers' questions out of global attention counts ([1c3341a](https://github.com/MrVPlusOne/takode/commit/1c3341a2423fc6d8bcdaf3474f4b329f7c1311a6))
* **attention:** read a shared answer's Ready result from every quest tab that shows it ([a5dcb89](https://github.com/MrVPlusOne/takode/commit/a5dcb897ea88bf6a6e501fa1d78de83794c1c0e3))
* **board:** don't flag lease-queued workers as stalled ([5d7cd9b](https://github.com/MrVPlusOne/takode/commit/5d7cd9b028545dfedf8ab5414610031bd13f4cf1))
* **board:** don't flag workers waiting on their own background job as stalled ([0425bbd](https://github.com/MrVPlusOne/takode/commit/0425bbd64d2339a0e6fb7059e19b3d6727d8c894))
* **board:** give User Checkpoint dots a real amber in light theme ([664bf9a](https://github.com/MrVPlusOne/takode/commit/664bf9a947ae040e98822e33f1509dd8728fb2a1))
* **board:** keep questions open when a User Checkpoint is ended by hand ([5f9632f](https://github.com/MrVPlusOne/takode/commit/5f9632f4262983e8457eed6cbaba059263fc2612))
* **board:** put back a planned User Checkpoint ended by hand with open questions ([1437c28](https://github.com/MrVPlusOne/takode/commit/1437c288bb19be831b1cfb7cfa47717a2fc8cdbb))
* bound recovery inspection and retain close diagnostics ([15d684d](https://github.com/MrVPlusOne/takode/commit/15d684d5ee7394c7f98d2146d01d67644c4a66c1))
* **browser:** send Safari and iPhone browsers uncompressed WebSocket messages ([329f746](https://github.com/MrVPlusOne/takode/commit/329f7467d4e9a291cab06d810c35745aee116b52))
* **browser:** use Safari-compatible WebSocket compression ([d2d3a23](https://github.com/MrVPlusOne/takode/commit/d2d3a2373a64fb2b4278123cb071adc558cf927b))
* **chat:** align report highlights and reactive draft persistence ([27b14d5](https://github.com/MrVPlusOne/takode/commit/27b14d5a735b5d2a029a24c060292db4d41eb40c))
* **chat:** keep quest preview eyes adjacent ([4a6b2aa](https://github.com/MrVPlusOne/takode/commit/4a6b2aa22cbfb4473d6b638678d958e78f97de09))
* **chat:** preserve report annotations and bounded reload behavior ([e69a74f](https://github.com/MrVPlusOne/takode/commit/e69a74fb7225195839a1908a556855067e1e4aa7))
* **chat:** preserve tab order on leader session return ([0d61013](https://github.com/MrVPlusOne/takode/commit/0d61013317a143523bd05f3c87d32cc0d190fcce))
* **ci:** budget heap for cold TypeScript checks ([f5d9add](https://github.com/MrVPlusOne/takode/commit/f5d9add5205531074b7901d3cb73222926a86616))
* **claude-sdk:** keep the generation chip visible while Claude requests the model ([15c5fb6](https://github.com/MrVPlusOne/takode/commit/15c5fb64b1d5a9c8f4d99ac9aa6ad50ca5c7efce))
* **claude-sdk:** report backend exit when the SDK stream closes without a result ([383bb31](https://github.com/MrVPlusOne/takode/commit/383bb3104c124b23ab55fe58892eea4842f607fa))
* **claude:** deliver queued input to a resumed SDK session that stays silent ([08e60c1](https://github.com/MrVPlusOne/takode/commit/08e60c1260e096b7ac5eaae56f6aaaee5d2bd848))
* **claude:** let an interrupt end a turn Claude never received ([cb10c22](https://github.com/MrVPlusOne/takode/commit/cb10c22e268bbf293c3b45dfff3dafb81d2f819c))
* **claude:** measure mid-turn context usage against the reported window ([8ff9da9](https://github.com/MrVPlusOne/takode/commit/8ff9da96da113a6c41e834e8886a0418a0742c7b))
* **claude:** report CLI tool heartbeats under the real tool id ([8cecbe3](https://github.com/MrVPlusOne/takode/commit/8cecbe3f4d6d61376b8f8d3f684b891a666aa19f))
* **claude:** stop Claude's commit and PR attribution in Takode sessions ([d5ae4a0](https://github.com/MrVPlusOne/takode/commit/d5ae4a0045e0f5fb9be9a586480c813f7e0866bc))
* **cli:** send session tokens from takode host and companion management commands ([b86ecdb](https://github.com/MrVPlusOne/takode/commit/b86ecdbddcf07e0830d22dd9ea6873cefda71771))
* **codex:** disable built-in memory for managed sessions ([29bbddb](https://github.com/MrVPlusOne/takode/commit/29bbddb50999c6447d7582dd13b34fc4270036e5))
* **codex:** preserve chronological delivery and compaction context ([c9cb07f](https://github.com/MrVPlusOne/takode/commit/c9cb07f523e0ea01912fec7fd53c326d9c6f9391))
* **codex:** restore catalogs on post-compaction input ([2ad78d2](https://github.com/MrVPlusOne/takode/commit/2ad78d27d1ba5e9cda4d6a2bb7126c2a40bbc247))
* **codex:** retain recycle skills without an optional catalog ([d6f551d](https://github.com/MrVPlusOne/takode/commit/d6f551dee5e37a05c4d58c3a9ff060f6f5e4ad65))
* **codex:** retire completed live stream replay ([f180584](https://github.com/MrVPlusOne/takode/commit/f180584c09ec9332bcf2ef420666a1959f8a77e3))
* **codex:** show confirmed response retry progress ([d165a80](https://github.com/MrVPlusOne/takode/commit/d165a808dbc0411ffadc4847706bf1c290152a8c))
* **comments:** save the comment draft when clicking outside its editor ([fe845ca](https://github.com/MrVPlusOne/takode/commit/fe845cae7c7951d9d0b0d73064614f32a560e19b))
* **composer:** a Send press that cannot send says why instead of doing nothing ([04c898c](https://github.com/MrVPlusOne/takode/commit/04c898cb5da0d93b3060bab7ceb007b45eb9c17b))
* **composer:** keep mic and send fixed while a reply streams ([aa20a43](https://github.com/MrVPlusOne/takode/commit/aa20a43f3bfce0afb027adf6e655ac94b2e1afda))
* **composer:** list the Claude CLI's own models in the model menu ([2b36758](https://github.com/MrVPlusOne/takode/commit/2b36758a833f8f1b80b481bde053ebbafbfca9d2))
* **composer:** preserve expansion across transient focus loss ([3d37a7b](https://github.com/MrVPlusOne/takode/commit/3d37a7b4e7bd56803d39294540308e1bc6aed989))
* **composer:** remove the collapse-all and minimize buttons ([898cc30](https://github.com/MrVPlusOne/takode/commit/898cc306024041d9c65856206fd2e55c2d98c007))
* **composer:** show the composer expanded when a voice transcription finishes ([159acf3](https://github.com/MrVPlusOne/takode/commit/159acf3686521d5b1d8929225fbb9bee7416db9b))
* **coordinator:** carry landing gates and hash files without streams in a handoff ([d8fa8f2](https://github.com/MrVPlusOne/takode/commit/d8fa8f25a57a5c0a35a7d74682e9a3f4829c814e))
* deliver session timers during active Codex work ([c7f1849](https://github.com/MrVPlusOne/takode/commit/c7f1849626cfbe2e0df4c756e854d1885e608cd5))
* **deliveries:** record complete approved publication commit sets ([5bc16d8](https://github.com/MrVPlusOne/takode/commit/5bc16d86e8d8c1cc0c9f693e3d2d78b4496e1543))
* **delivery:** check delivery evidence on the machine holding the checkout ([1d4314b](https://github.com/MrVPlusOne/takode/commit/1d4314b51a3bce6f06d6f06ac6a05616158148fe))
* **deps:** pin Agent SDK 0.3.287, the newest the configured npm proxy offers ([4a41c0d](https://github.com/MrVPlusOne/takode/commit/4a41c0df10975d6ebfd17b0675d92ad0a5b1a266))
* **deps:** update hono, sharp, shell-quote and dev tooling for security advisories ([8cf5789](https://github.com/MrVPlusOne/takode/commit/8cf57893a96e6e04853b5a48355e0b7ca1f5afa4))
* **diagnostics:** stop frame work after capture expires ([a1ba9fb](https://github.com/MrVPlusOne/takode/commit/a1ba9fbf391aae88b4df2fdf7951786c60343fbc))
* disable hover previews inside More tabs ([1e48e28](https://github.com/MrVPlusOne/takode/commit/1e48e285019695c81754db85935c55cb0e978d49))
* **feed:** absorb thinking with content into activity groups and keep labels neutral ([d66f91a](https://github.com/MrVPlusOne/takode/commit/d66f91a0d2637c839008c8190e50f74dccf828ee))
* **feed:** always prefer a Bash command's description in its collapsed row ([b2bf3d9](https://github.com/MrVPlusOne/takode/commit/b2bf3d973e74fc3e92d894f0f8cc2fdd7447c7fb))
* **feed:** collapse needs-input reminders and give them a readable chip design ([27b7ede](https://github.com/MrVPlusOne/takode/commit/27b7ede527ef42f9a2d07a16e55f3d14142da5db))
* **feed:** fall back to latest when saved restoration fails ([eade192](https://github.com/MrVPlusOne/takode/commit/eade19252d0d0a928afdacba23394b497a4667af))
* **feed:** keep a jumped-to message in place while the feed fills in around it ([922254e](https://github.com/MrVPlusOne/takode/commit/922254eaf6a6781e04df4a1071efe6a4ab6750e8))
* **feed:** keep collapsed answers in source chronology ([aafe0dc](https://github.com/MrVPlusOne/takode/commit/aafe0dc6481e953118e444b83a62bbd18f866077))
* **feed:** keep Go to bottom from restoring an older saved position ([ea72bdc](https://github.com/MrVPlusOne/takode/commit/ea72bdc8e10ae708874cf2fe9a3149ea42312c45))
* **feed:** keep live turn errors in their own turn and thread ([2eebd84](https://github.com/MrVPlusOne/takode/commit/2eebd844a871d0f103b7961d1ab53994ed3eb600))
* **feed:** keep Ready turns collapsed after navigation and earlier expansion ([9cfc411](https://github.com/MrVPlusOne/takode/commit/9cfc4111c1f62d513829d3af6263ca9665410299))
* **feed:** keep the Purring timer on the server generation start when opening a session ([171f9d3](https://github.com/MrVPlusOne/takode/commit/171f9d3d0939698ef5df7caed2853bdfaa2157c3))
* **feed:** keep the quest complete card where the quest completed ([47e7116](https://github.com/MrVPlusOne/takode/commit/47e71163a3488de68c80020154cb40d6fbc644b4))
* **feed:** keep thinking out of agent-text checks so it stays in activity groups ([a4d8c78](https://github.com/MrVPlusOne/takode/commit/a4d8c785bf1039b4aa27c076b61357b6702988a4))
* **feed:** keep visible turns mounted when the latest window slides ([2c81eb7](https://github.com/MrVPlusOne/takode/commit/2c81eb74a822659c4db3178480895a9da90312c3))
* **feed:** let commands after a Claude note join the next command run ([a488d46](https://github.com/MrVPlusOne/takode/commit/a488d4603287ede009342b8feaeed9c640eb948c))
* **feed:** let empty Claude thinking blocks group with tool calls ([7d34203](https://github.com/MrVPlusOne/takode/commit/7d34203935aee084a0a68412911ca5733d5aeb77))
* **feed:** link each message to the one thread it was written in ([ae6ace2](https://github.com/MrVPlusOne/takode/commit/ae6ace2b3fa92bc9fb155c9d3e49f4e61ff5d96c))
* **feed:** open the Comment / Copy menu for needs-input card text ([64076ed](https://github.com/MrVPlusOne/takode/commit/64076ed0fda94a653dbf0205dab4ee7ccf375328))
* **feed:** preserve scaled scroll anchors and retain more paging context ([19ea4d5](https://github.com/MrVPlusOne/takode/commit/19ea4d53d3759578855e720cf39e077fe91553be))
* **feed:** preview comment-only requests behind the answer label ([78518a1](https://github.com/MrVPlusOne/takode/commit/78518a1a228e39a8c3b5ce472893d4ed0db22317))
* **feed:** retain latest-follow intent after sending ([dbd6237](https://github.com/MrVPlusOne/takode/commit/dbd6237f32288080178aa1043dad20c28c131548))
* **feed:** send notifications and attention records ahead of the messages ([ed7f9f9](https://github.com/MrVPlusOne/takode/commit/ed7f9f9185faead7cc510740b9e2ca2c4a59ce08))
* **feed:** show single tool chips directly and drop duplicate task notices ([a02afc7](https://github.com/MrVPlusOne/takode/commit/a02afc7a85dcbc46fb145dfa1f747b5b7d0bacc8))
* **feed:** show the quest card in a quest thread with no messages ([0d20757](https://github.com/MrVPlusOne/takode/commit/0d2075703c1b5f1d588ae392fbee2731ae5809d1))
* **feed:** show thumbnails this browser already loaded as soon as a thread opens ([5e68541](https://github.com/MrVPlusOne/takode/commit/5e685417ffc39b5ae182ff02e568a509c0eeafcd))
* **feed:** stop compact activity adding a bare Needs input chip ([96abcd7](https://github.com/MrVPlusOne/takode/commit/96abcd73465e22c88f976a68a417c4d23ad2d730))
* **feed:** stop replaying progress for tools that already finished ([1f21cd1](https://github.com/MrVPlusOne/takode/commit/1f21cd10c7a5e26e71f88432ebdcac4b5bf82123))
* **feed:** stop timers that outlive tests and fire after jsdom teardown ([2589ba0](https://github.com/MrVPlusOne/takode/commit/2589ba0fc170510c34efb288019801c697b10601))
* **feed:** time activity groups from their first start to their last end ([2b2d1cb](https://github.com/MrVPlusOne/takode/commit/2b2d1cbb9c1b15e13549a78a6be5c39f5a7afea0))
* **feed:** time every turn summary to the agent's last activity ([6f2fba8](https://github.com/MrVPlusOne/takode/commit/6f2fba870cf209b30fbdc7bbfcb36c7280665ac1))
* **file-links:** show linked Markdown files inside Takode ([72c3407](https://github.com/MrVPlusOne/takode/commit/72c3407b8d8941e814fbec355f441bf9b1898f2d))
* **herd:** attribute a leader's dismissed question to the leader ([bca21f2](https://github.com/MrVPlusOne/takode/commit/bca21f24a2e8ca717d47240a28b97bb65028055c))
* **herd:** send herd events once to leaders on an offline host ([c4af167](https://github.com/MrVPlusOne/takode/commit/c4af167b7609b55ebfa1c3cbf231aa358c7646bc))
* **hosts:** alert on host outages only when work is affected ([1369326](https://github.com/MrVPlusOne/takode/commit/136932607f3c434eb332e547a170693bcb723de0))
* **hosts:** keep old binary settings that differ from this machine's ([380c7d8](https://github.com/MrVPlusOne/takode/commit/380c7d871c82378c442a7baaeb889491579e0a92))
* **hosts:** relaunch remote sessions and stop them cleanly before host updates ([6e00226](https://github.com/MrVPlusOne/takode/commit/6e00226f2113427614664c6eb1f49e7b5bf0a496))
* **hosts:** relaunch sessions whose worktree or conversation vanished with their machine ([ff04122](https://github.com/MrVPlusOne/takode/commit/ff041227699513aaf502c825707be08557594b73))
* **hosts:** run remote sessions' git reads and pulls on their host ([b2518d1](https://github.com/MrVPlusOne/takode/commit/b2518d1fc895c4c5786b55aa83088de538c3c671))
* **hosts:** stop a host stuck mid-update from hanging session creation ([566d6a0](https://github.com/MrVPlusOne/takode/commit/566d6a0ed92940943f2c9c9cdd268ad998f526bd))
* **hosts:** stop node sessions on a server stop, keep them on restart ([0e23a3c](https://github.com/MrVPlusOne/takode/commit/0e23a3cf51d29e4d7a0043aa7cef5ae99be24c35))
* **hosts:** tell leaders when a remote host goes silent and hold its sessions' input ([178dabc](https://github.com/MrVPlusOne/takode/commit/178dabcf65c4cf28dc047a5efc55650d15c983be))
* **land:** compare test IDs by resolved path ([a4b107c](https://github.com/MrVPlusOne/takode/commit/a4b107c93272f0556a3853c583f24f50907cef67))
* **land:** free stopped test slots and drop stale queue reasons ([57866a6](https://github.com/MrVPlusOne/takode/commit/57866a6d9ab85e54da8d4d265b9672e1f3ca882e))
* **landing:** compare Vitest unhandled errors with the baseline like failing tests ([56cff67](https://github.com/MrVPlusOne/takode/commit/56cff675475e94eeacbfb9827e202d1a6bb281ed))
* **launch:** don't pass a parent Claude session's login to launched agents ([5193e26](https://github.com/MrVPlusOne/takode/commit/5193e26e047f51367b1fb69b33a806b54c6e69dd))
* **launcher:** end the Claude process when a session is killed or archived ([43bbab3](https://github.com/MrVPlusOne/takode/commit/43bbab39d277852541eaf86cca3b13c5fc334c49))
* **leader:** accept answers covering input the Claude CLI folded into the turn ([9581d50](https://github.com/MrVPlusOne/takode/commit/9581d50d1f14ae0add1c93519eec129d5e204cb5))
* **leader:** persist thread handoffs of already-saved requests ([9ea2f9f](https://github.com/MrVPlusOne/takode/commit/9ea2f9f9f25cffb91e659df0f781f4744de5b50c))
* **leader:** route Claude leader markers that follow a thinking chunk ([fb5c6f9](https://github.com/MrVPlusOne/takode/commit/fb5c6f98c1a27000f22ae903b9e390ff13cf1d99))
* **lease:** exit non-zero when lease acquisition only queues ([5e9cd88](https://github.com/MrVPlusOne/takode/commit/5e9cd885a60c412b8c329430431749aa3fc8264f))
* **links:** render iCloud and spaced file paths as links; add macOS places to the folder picker ([8952a90](https://github.com/MrVPlusOne/takode/commit/8952a90c7123b7cffc51e8f2316784af027b7319))
* **long-press:** ignore the lift after a long-press anywhere on the page ([3376528](https://github.com/MrVPlusOne/takode/commit/3376528c509b6f94088facfb2b782ddad1c0a0c3))
* **memory:** recover locks held by dead writers and enforce lock ownership ([db4d664](https://github.com/MrVPlusOne/takode/commit/db4d664d3cdf3afbd65e087f8d27084267e40513))
* **memory:** refuse a note save that would undo a newer edit ([0753ffc](https://github.com/MrVPlusOne/takode/commit/0753ffc314ab907e82b2e8b80027f57dadf30706))
* **mobile:** keep iOS from leaving its status-bar blur over the top bar ([74c916d](https://github.com/MrVPlusOne/takode/commit/74c916dbafe2a02a70ea4029f3139229390ef529))
* **new-session:** keep the folder on the selected machine ([8fc1a74](https://github.com/MrVPlusOne/takode/commit/8fc1a740e914762d95d501cd47f556344ca69afe))
* **new-session:** offer the backends the selected machine has ([ece9e25](https://github.com/MrVPlusOne/takode/commit/ece9e25846f5c10f5f3747fc836dee806e273ede))
* **notifications:** keep needs-input answer drafts across feed updates ([ca663ff](https://github.com/MrVPlusOne/takode/commit/ca663ff82bcf7bf180afa2d2ebdb50fc0b235368))
* **notifications:** number multi-question needs-input answers once and keep multi-line answers inside their item ([84b6844](https://github.com/MrVPlusOne/takode/commit/84b6844539b85348b6a675a6b2fddcc9d6941b82))
* **notifications:** stop retracting delivered Web Push alerts ([8996d29](https://github.com/MrVPlusOne/takode/commit/8996d2927fa0260347ad3a5dc362245afa479217))
* **notifications:** stop sending a Topic header to Apple push ([78c6890](https://github.com/MrVPlusOne/takode/commit/78c6890d19f5d62da5dc64d69b76ad9b8d0aa644))
* **notify:** suggest one reply per named option in needs-input guidance ([867fbf9](https://github.com/MrVPlusOne/takode/commit/867fbf9cf19dafad720e43d8364b31c85541ddad))
* prefer supported citation links in session replies ([b88f1ed](https://github.com/MrVPlusOne/takode/commit/b88f1ede3246cb9100da2fcf8a19327af4fe1cbc))
* preserve voice expansion and reveal compact draft content ([f6cc532](https://github.com/MrVPlusOne/takode/commit/f6cc5327398badb8ea0872acd91efd5f980cd392))
* **quest-preview:** open a cached quest preview at once and refresh it in place ([02d57f6](https://github.com/MrVPlusOne/takode/commit/02d57f6d7be44de9d3a6dbba7486561fe3840a90))
* **quest-preview:** show basic information for quests without a TLDR and label cancelled quests ([5b2ec67](https://github.com/MrVPlusOne/takode/commit/5b2ec67fd1adde35ace9c7a5e43dc4cd7ae8f9c6))
* **quests:** find the leader of a dispatched quest before its worker claims it ([8c0a6b3](https://github.com/MrVPlusOne/takode/commit/8c0a6b386ca94523f061585d33dbeb36aad682d7))
* **quests:** read recorded commits from their delivery target ([1c2e14e](https://github.com/MrVPlusOne/takode/commit/1c2e14e1ad062367978337dc4b6ed3cb598adaf2))
* **quests:** show the same status and section labels in the quest preview and quest view ([e1aba40](https://github.com/MrVPlusOne/takode/commit/e1aba40cf6e3a7ebd914d57f376d74413b55787e))
* **quests:** tidier inline quest links, with no preview eye on touch phones ([b6182ad](https://github.com/MrVPlusOne/takode/commit/b6182ad6667e954c8b4173387ae9d2f92eaed07f))
* **relay:** make the supervisor restart-policy tests reliable under load ([c2d072a](https://github.com/MrVPlusOne/takode/commit/c2d072a058f31b09e72fc6d4ac1ff27a053db779))
* **restart:** restore pulling the latest published code or stopping with a reason ([f57a677](https://github.com/MrVPlusOne/takode/commit/f57a6775e6396f35f9adb4032f11d9ab96675544))
* **restart:** tell resumed sessions Takode interrupted them, not the user ([b462a2e](https://github.com/MrVPlusOne/takode/commit/b462a2eb0341eb03c7a52ba5e8fb7eb56d2bce09))
* **search:** animate pending quick search status ([da002b7](https://github.com/MrVPlusOne/takode/commit/da002b7e1c1fbac57e16e860b7b1950ae68193a7))
* **server:** bound the accepted-work shutdown wait so restarts always finish ([4565ce1](https://github.com/MrVPlusOne/takode/commit/4565ce133ea0269d2d54dd0a07ac8400ddde8577))
* **server:** capture the login-shell PATH for sessions ([4c4ba9b](https://github.com/MrVPlusOne/takode/commit/4c4ba9b4c37dce1ad441f91a350133a8cf47b569))
* **server:** check backend dependencies before Restart Server shuts down ([28b4ee5](https://github.com/MrVPlusOne/takode/commit/28b4ee579ae07030fef67e62da675a3513d42181))
* **server:** name the host of a session launch in shutdown logs ([48673e4](https://github.com/MrVPlusOne/takode/commit/48673e4e3498925e7585fc7e55ddb0d031f12414))
* **server:** preserve pending work through bounded shutdown ([5297722](https://github.com/MrVPlusOne/takode/commit/529772292fec751ac656a9cd3808cd6953c8c9b6))
* **server:** restore capturing the login-shell PATH for sessions ([53e65f0](https://github.com/MrVPlusOne/takode/commit/53e65f0b24a157e0c793eb5ebd6582fdbe27da77))
* **server:** restore naming the host of a session launch in shutdown logs ([6feb24f](https://github.com/MrVPlusOne/takode/commit/6feb24fc113347d67691155fe729f5f7997ec77a))
* **server:** restore the bounded accepted-work shutdown wait ([ac83343](https://github.com/MrVPlusOne/takode/commit/ac8334392b30ce388a646a4f91accf56b2752fb9))
* **server:** send gzipped API answers whole so proxies on HTTP/1.0 get valid bodies ([e85d3de](https://github.com/MrVPlusOne/takode/commit/e85d3dea30aa1f57131107b788f085f956854380))
* **session-info:** close the session info panel when its title is tapped again ([93cdb8e](https://github.com/MrVPlusOne/takode/commit/93cdb8e87cacb302b3e2a604807ebedc6ffa6413))
* **session-store:** read chunked session history in one pass ([7963a28](https://github.com/MrVPlusOne/takode/commit/7963a28676d4bd2cc0d8fc2f1b07f59545f0f2ca))
* **session:** a fresh Claude process no longer inherits a failed resume's open window ([cbc8fb7](https://github.com/MrVPlusOne/takode/commit/cbc8fb7607cda857a5b63643e9513228cef66ece))
* **sessions:** keep the creation-time permission mode in session state ([97c64cf](https://github.com/MrVPlusOne/takode/commit/97c64cf57cf9d2be66a23b6fe543ded81f77db31))
* **settings:** confirm Restart Server in the page and show restart progress ([af5790d](https://github.com/MrVPlusOne/takode/commit/af5790d472bf82af450a51b6e5a9a8fd659600a8))
* **sidebar:** make the portrait timer badge smaller and hug the clock ([e17522a](https://github.com/MrVPlusOne/takode/commit/e17522a41f172ddb636cf3cae600a397d6cb1538))
* **sidebar:** remove the permission shield icon from session cards ([95f05a7](https://github.com/MrVPlusOne/takode/commit/95f05a70e10ad25e5e9bce556e1b5a880d919485))
* **skills:** give Claude sessions the shared UI validation skill and leader source tags ([b19e341](https://github.com/MrVPlusOne/takode/commit/b19e34163e591531ad08da2cc2bb962bdeb51c1d))
* **skills:** keep Takode development skills out of the global skill folders ([f61ce4a](https://github.com/MrVPlusOne/takode/commit/f61ce4a1cff61a257f3e7719788d517d2c4f674b))
* **spawn:** base host workers on the host checkout's branch ([c7f8ad8](https://github.com/MrVPlusOne/takode/commit/c7f8ad863214a0a80d276b48e75ecdec8d9c00e6))
* **spawn:** run workers on the leader's own machine by default ([d8bca8d](https://github.com/MrVPlusOne/takode/commit/d8bca8debd10daa5c8d25163745bb91416c8956b))
* stabilize comment navigation and composer restoration ([190a637](https://github.com/MrVPlusOne/takode/commit/190a637c14ecf2da459d49a6a55bfffb06174e6c))
* **tabs:** a tap on a group with several tabs only opens its list ([cd941ec](https://github.com/MrVPlusOne/takode/commit/cd941ec6b788086f03f651bd2e9fc5f98ec09254))
* **tabs:** glide a tab opened from New results into the group it moves to ([426f75a](https://github.com/MrVPlusOne/takode/commit/426f75aede1224f8e7f5c5344856f1daf44a2f38))
* **tabs:** keep Main out of the thread tab groups ([af32a9b](https://github.com/MrVPlusOne/takode/commit/af32a9b7b367b752ac6ca8e8cb6866e739504f0a))
* **tabs:** move the tab on screen straight to its new group, with a glide ([a9d23dd](https://github.com/MrVPlusOne/takode/commit/a9d23dd98ef0e725d77f29d7c74967be7a477d2f))
* **tabs:** open the only tab of a phone tab group in one tap ([4cc8543](https://github.com/MrVPlusOne/takode/commit/4cc8543642948264bcfebdb1a75e87c80ce052c5))
* **takode:** keep worker needs-input prompts answerable after herd delivery ([d45cb36](https://github.com/MrVPlusOne/takode/commit/d45cb36068e14e507268fee3cd45b613e4b538bc))
* **takode:** recognize Work dispatches in leader-context-resume ([6c2e030](https://github.com/MrVPlusOne/takode/commit/6c2e0304354b8bdd7943f72bbe4c8910c6632f70))
* **terminal:** offer Paste on a touch long-press over the terminal ([22c51b9](https://github.com/MrVPlusOne/takode/commit/22c51b97c333ea8c96833465baed65a98ed8ed57))
* **test:** keep at least half the CPU budget as Vitest workers on a busy machine ([7177d50](https://github.com/MrVPlusOne/takode/commit/7177d5005b544ad27cd3e741a53331d5ce19c9a0))
* **test:** keep the Takode session environment out of test runs ([34cbb6e](https://github.com/MrVPlusOne/takode/commit/34cbb6e1eb814e8e6c89e6dea16ec3e3fe978318))
* **test:** size Vitest workers by the cgroup CPU quota and affinity ([ed9c15c](https://github.com/MrVPlusOne/takode/commit/ed9c15cace7a51ecbe0c4296aa6c794a671a7be8))
* **test:** type shutdown diagnostic callback explicitly ([27aba35](https://github.com/MrVPlusOne/takode/commit/27aba357cbfc6f6207b3daff69257252c7be989b))
* **thread-tabs:** keep the long-press tab menu open when the finger lifts ([cc64c83](https://github.com/MrVPlusOne/takode/commit/cc64c83fd5f70cc1044263367996ee6c2549d506))
* **threads:** keep a leader's live view on the thread it shows ([1ad4c44](https://github.com/MrVPlusOne/takode/commit/1ad4c4480d29d55001a454ed18aa9d622facc08f))
* **threads:** read a thread's result only after it has really been on screen ([bdd0617](https://github.com/MrVPlusOne/takode/commit/bdd06175264e0adb59ef4e65f90de0230fcc22ff))
* **touch:** a second tap closes menus and popovers opened by a tap ([3d0a5f0](https://github.com/MrVPlusOne/takode/commit/3d0a5f04810d8f54c2726c5f0cc4494228f251ed))
* **transcription:** retain failed context and allow warned audio retries ([d0128c1](https://github.com/MrVPlusOne/takode/commit/d0128c16f863ecc2c00efce9ba61c18e9b00271a))
* **ui:** compact commit chips and align grouped titles ([6e4733b](https://github.com/MrVPlusOne/takode/commit/6e4733b3bb26bfe2722d34e51a11a1f43be9341d))
* **ui:** distinguish needs-input attention from unread results ([e93dc33](https://github.com/MrVPlusOne/takode/commit/e93dc33f17a3853e0a2269aa5bb6cf214e2d7170))
* **ui:** flatten turn activity indentation ([5c99100](https://github.com/MrVPlusOne/takode/commit/5c9910057f5053322741c703fc36ea1a7d41e6c3))
* **ui:** hide Git counts on leader sidebar cards ([f7ec246](https://github.com/MrVPlusOne/takode/commit/f7ec246c3ada56477c9f3f03524552f9b8fa3d97))
* **ui:** keep compact quest journey summaries single-state ([a519dbe](https://github.com/MrVPlusOne/takode/commit/a519dbe544adecff8d44c53f39598033271a63cf))
* **ui:** keep on-demand quest details editable ([9536da0](https://github.com/MrVPlusOne/takode/commit/9536da0c43552d6304c7a6db7cf2787daecf1844))
* **ui:** keep turn guides continuous through system events ([8c9fc3a](https://github.com/MrVPlusOne/takode/commit/8c9fc3a5623c088e69ed076ef5e46c47aca3850f))
* **ui:** label current-thread continuation links ([2c78fbd](https://github.com/MrVPlusOne/takode/commit/2c78fbdb9c28fcd1efe63eed724307f30de6f0d7))
* **ui:** reveal conversation beneath expanded composer ([f1d6294](https://github.com/MrVPlusOne/takode/commit/f1d6294a65b1c032f51cc79739f82c344f088a47))
* **ui:** scope pending messages to valid destination threads ([edf340b](https://github.com/MrVPlusOne/takode/commit/edf340b3edf8f8c801ad407a3805a94d8421a18b))
* **ui:** shorten quest header phase and notification labels ([89f5230](https://github.com/MrVPlusOne/takode/commit/89f52305857611c50ab78315aefb75eec148ab71))
* **ui:** show comment and image counts in Recent previews ([01325ac](https://github.com/MrVPlusOne/takode/commit/01325ace5ddbcbb762a8a4a525408efb8693cc52))
* **ui:** show long turn durations in hours and minutes ([0f54a28](https://github.com/MrVPlusOne/takode/commit/0f54a280f4cb111fd4938f88f30aa6397b29a2c8))
* **ui:** show sidebar build time in the browser's local timezone ([4726dfe](https://github.com/MrVPlusOne/takode/commit/4726dfed51402a89ba68a8bfaa3a45eb96f921e9))
* **ui:** show the work board count as plain text in the Board button ([140c415](https://github.com/MrVPlusOne/takode/commit/140c4156c0a1f5fc11d040ff1f92d8320b793c26))
* unify comment highlights and scroll to passages ([fc3b7ff](https://github.com/MrVPlusOne/takode/commit/fc3b7ffd037e62c029ab933966bfe5855652cbc2))
* **user-content:** land Set up on the section and show machines before their previews arrive ([d78b19d](https://github.com/MrVPlusOne/takode/commit/d78b19d87fb6a9519f67d9cdc15bb99fc0ef6929))
* **voice:** keep the screen awake while recording voice input ([ad5e9ff](https://github.com/MrVPlusOne/takode/commit/ad5e9ffcb260f69a5a24f669484031893eb48cab))
* **voice:** move the transcription tag to the end when appending after it ([26b8491](https://github.com/MrVPlusOne/takode/commit/26b84913084bf388c7f94615ff96e3d20c47bb34))
* **voice:** record from the system-selected microphone and show its name ([df46f59](https://github.com/MrVPlusOne/takode/commit/df46f5916aad6e1dc35c553dbeb325e4c2ce1663))
* **voice:** stop repeated and silent microphone denials on iPhone ([f3077ff](https://github.com/MrVPlusOne/takode/commit/f3077ff9220b58130aeab3ce7d564c6df30af517))
* **worktree:** delete the stale committed .claude/CLAUDE.md ([052e02a](https://github.com/MrVPlusOne/takode/commit/052e02ac55bb66555605571b0a43631d8bf3cb31))


### Performance Improvements

* **app:** load rarely used pages on first use ([daf1277](https://github.com/MrVPlusOne/takode/commit/daf1277f3230e974220bacea815b808cc6526151))
* **browser:** compress large browser WebSocket messages ([fef1d9c](https://github.com/MrVPlusOne/takode/commit/fef1d9c4779c5a3441c6f428d7d604deb6144a20))
* **feed:** refetch the navigation index only when a navigable user message arrives ([7a087bf](https://github.com/MrVPlusOne/takode/commit/7a087bf279fac7bf566aea7e2254e178e79b9163))
* **feed:** stop redrawing the app and every message row on other sessions' updates ([fe21c2f](https://github.com/MrVPlusOne/takode/commit/fe21c2f8bdae57110f92d3da91328a28576ef433))
* **feed:** stop redrawing user bubbles and the whole feed on each new message ([e2411a4](https://github.com/MrVPlusOne/takode/commit/e2411a4d19124ebf0a4f9b5c1979cf2096844e9a))
* **hosts:** compress the host link and agent CLI answers ([cbf77ad](https://github.com/MrVPlusOne/takode/commit/cbf77ad36fb0c4178bf2db48a3b1ecafe8e21b61))
* **quests:** serve quest reads from an in-memory store and stop fetching every session ([4ece73c](https://github.com/MrVPlusOne/takode/commit/4ece73c9d66548bfe3dcd38b34bcbe119c96bfc1))
* **search:** reuse authoritative quest search documents ([b5d68ff](https://github.com/MrVPlusOne/takode/commit/b5d68ffed52a2f171a73be681283dcdf60af52f2))
* **serve:** let browsers keep content-hashed build assets ([11a4adf](https://github.com/MrVPlusOne/takode/commit/11a4adfae13470223de558f969caa64a2bfaa3dd))
* **sidebar:** skip unchanged session-list polls with a socket-independent ETag ([e6f1d70](https://github.com/MrVPlusOne/takode/commit/e6f1d70067fa7a98247a34e17a4173505d3071b4))
* **switch:** cut bytes and round trips when switching sessions over a slow link ([51ffcf9](https://github.com/MrVPlusOne/takode/commit/51ffcf9915c147295a78d5ff3f77b720e24b2d43))
* **switch:** reuse the browser socket across session switches and push scroll-position handoff state ([381c14c](https://github.com/MrVPlusOne/takode/commit/381c14cc20a699a0ebcf8c1cb258c3653e81b9aa))
* **test:** make the offline session-tail converter tests fast ([85dc65e](https://github.com/MrVPlusOne/takode/commit/85dc65e6d07165127a15a98427c370e4b98f4874))
* **web:** serve prebuilt gzip frontend assets ([1615769](https://github.com/MrVPlusOne/takode/commit/1615769a10fdf69c99da3d93f56ae499ce3389b4))


### Reverts

* **land:** drop the per-machine gate environment ([617473e](https://github.com/MrVPlusOne/takode/commit/617473eb094e6067bff70c7b48dc6b73ac74787d))

## 2026-10-14

### Added

- **Reminders about waiting questions** -- When questions stay unanswered while you are away, Takode sends one summary reminder through Pushover and Web Push after 2 hours without activity, then at doubling gaps, at most 3 a day and never during quiet hours (11 PM to 9 AM). Activity means a message, an answer, or a tap or key press in a Takode window; an open screen alone does not count. The reminder opens the attention list, and all of it is configurable in Settings next to the phone alert rules.

### Changed

- **Pages and viewers float over the app** -- The side-by-side mode is retired. Pages, quest details, files and diffs opened from the chat always slide in from the right over the whole app, sized to their content. The app behind stays inert while one is open, Escape closes the top one, and opening a session from quest details or a file closes them.
- **Quest view actions** -- Add Feedback is a filled button on the right, the action row keeps Edit and Delete on the left and the status and Finish Quest on the right, and Delete confirms in place. The manual Assign and Rework buttons are gone. On phones, Open Worker and Open Thread sit in a pinned footer within thumb reach, in the quest view and in the quest preview sheet.

### Fixed

- **Status-bar blur on iPhone** -- iOS no longer leaves its blurred status-bar band over the Home Screen app's top bar after a full-screen preview closes.

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
