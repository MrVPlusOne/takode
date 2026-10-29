# Takode Changelog

## October 2026 release: one Takode across your machines

Until this release, every Takode session ran on the machine that hosted the Takode server. That works until the code you care about lives somewhere else: a cloud workspace, a GPU box, a second computer under your desk. The headline of this release is that one Takode now spans all of them. The server becomes the **coordinator**, which keeps your sessions, quests, work boards and memory in one place, and any machine you register as a **host** can run sessions for it. You keep one browser tab and one session list, and your leaders can start workers wherever the code and the hardware are.

Adding a machine takes two steps: register it with `takode host add` or in Settings → Hosts, then run `takode node` on it. The node dials out to the coordinator, so the host needs no open inbound ports. It signs in with its own token and keeps its own Claude Code and Codex logins. Everything that touches files runs where the files are: Git status, diffs, file previews, worktrees and terminals for a session all run on its machine. The new-session dialog has a machine picker that browses that machine's folders and branches, every remote session carries a chip naming its machine, and a leader can place a worker on a particular machine with `takode spawn --host`. Agents on a host use quests, memory and the Takode commands just as they do locally. All of their reads and writes go through the coordinator, so your data never splits into diverging copies. The [remote hosts guide](docs/remote-hosts.md) walks through the setup, including tunnels and shared machines.

Working across machines also made sessions sturdier everywhere. Sessions now keep running while you restart the Takode server, both on hosts and on the coordinator's own machine, and the restarted server picks them up where they were, pending permission requests included. Restart Server first brings the server's checkout up to date with the branch it tracks, and hosts started with `--auto-update` follow the coordinator onto the new build. When a turn loses its connection to the model API, it now pauses and continues on its own once the network is back instead of failing. If you outgrow a machine, you can move the whole coordinator to another one; the [coordinator move guide](docs/moving-the-coordinator.md) covers rehearsal, cutover and rollback. For reaching Takode from other machines, an optional browser login password guards the app, and a separate token-only host port keeps a tunnel on a shared machine from exposing your server.

The rest of the release is about spending less effort keeping up with your agents. Unsent drafts, including composer text, attached images, comments and half-answered questions, are kept by the server and follow you between your laptop and your phone. An attention list in the top bar gathers every question, Notify Me result and unread result across your sessions, and Next steps through them in priority order. Leader threads show a live preview of the worker they are waiting on, open with a card describing the quest and close with its final summary, and a Board button opens the work board from any thread. Agent activity between messages collapses into compact cards with a one-line summary, and a needs-input question now arrives as an ordinary explanation followed by a short question card, which you can snooze until later. Phone alerts can also go through Web Push, alongside Pushover.

Under the hood, Claude sessions now run only through the Claude Agent SDK, with Claude's native Auto permission mode, a reasoning effort picker and the model list Claude Code itself reports. Teams that share a branch can turn on a landing queue that tests waiting changes together and lands them, so workers are free as soon as they submit. Switching sessions over a slow connection is much faster thanks to compressed traffic and a reused connection. The dated entries below list every notable change.

## [0.47.0](https://github.com/MrVPlusOne/takode/compare/the-companion-v0.46.0...the-companion-v0.47.0) (2026-10-29)


### Features

* **attention:** amber attention chip counts only open questions ([e26ee0c](https://github.com/MrVPlusOne/takode/commit/e26ee0c65e679d8342964f9dd4484f4c73d99217))
* **attention:** close any leader's thread tab from the attention lists ([2862220](https://github.com/MrVPlusOne/takode/commit/286222091b58fade8a9d849569f50aec13444c69))
* **attention:** leaders can mark an answer urgent ([12f9c44](https://github.com/MrVPlusOne/takode/commit/12f9c44fe8d8288fb1fa1aa8cfd54f759b20261a))
* **attention:** long-press the feed chip to close the tab and go to the next item ([02b19f6](https://github.com/MrVPlusOne/takode/commit/02b19f659671b0c9fd22d07d0e8c603f1448e0d8))
* **attention:** make the feed chip a next button and the top bar a list ([720dd67](https://github.com/MrVPlusOne/takode/commit/720dd670b782bb8312fe404589d20d75af2266de))
* **attention:** move attention row actions into a context menu ([7772a44](https://github.com/MrVPlusOne/takode/commit/7772a44146883238564d08c24e0a0068766dbf30))
* **attention:** move muted questions and tracked Notify Me tasks into the attention list ([6cc8791](https://github.com/MrVPlusOne/takode/commit/6cc8791033eec0b5acc56cf6c9b1294eb6ffbf74))
* **attention:** name the quest on attention rows' second line ([d00f96f](https://github.com/MrVPlusOne/takode/commit/d00f96fae940505bda208d423f850f73830d6a78))
* **attention:** name the thread tab on every attention row's second line ([2b53550](https://github.com/MrVPlusOne/takode/commit/2b5355056c5006df888e8171d5ef7f6d5d8ee92d))
* **attention:** one amber signal per scope in a desktop leader's top bar ([08f2a18](https://github.com/MrVPlusOne/takode/commit/08f2a1878e77ca8351324ac35e0d7b360a1def4e))
* **attention:** separate in-session and cross-session next shortcuts, drop the landing banner ([7daa3bb](https://github.com/MrVPlusOne/takode/commit/7daa3bb18caa721c1c4a540f128d1e8b01a0b189))
* **attention:** show the session Next chip at the feed's top right on desktop ([09c0488](https://github.com/MrVPlusOne/takode/commit/09c0488972fa88e2d743f28d0ed41711521e3a3c))
* **attention:** topic-first tab bar, unread per message, reminders on items ([580bb84](https://github.com/MrVPlusOne/takode/commit/580bb84cd760d4826b6ec1cb98192367ed4dad1f))
* **board:** let a quest in Work wait on a helper session ([be693ec](https://github.com/MrVPlusOne/takode/commit/be693eca0f705e6d8b0c4fc32948172cc586af97))
* **board:** put a quest in User Checkpoint while its leader's question is open ([b7fb0b4](https://github.com/MrVPlusOne/takode/commit/b7fb0b4636cb3b5512de1788de9d9368017a8f33))
* **claude:** live MCP status, sign-in, reconnect and toggle for Claude sessions ([0a145c7](https://github.com/MrVPlusOne/takode/commit/0a145c7d742c15881338ba08527225c04f5d5a46))
* **claude:** working web search and WebFetch for Claude sessions on GitHub Copilot ([1959371](https://github.com/MrVPlusOne/takode/commit/1959371d5c67f5838a58d5766694af71fcf69cfa))
* **cli:** read messages as exact text or Markdown quotes with takode read --raw/--quote ([6847871](https://github.com/MrVPlusOne/takode/commit/6847871c4fa5cb9967ebf643b91b7a30b473c4c4))
* **codex:** default Codex leaders to built-in compaction instead of recycling ([869c147](https://github.com/MrVPlusOne/takode/commit/869c1470a3a918d461af65f7a06e5595fa81d7d0))
* **codex:** sign in to MCP servers, including plugin-provided ones, from Takode ([2c2387e](https://github.com/MrVPlusOne/takode/commit/2c2387ea7623dbf114d0fd9dc4e37317e3dbbbec))
* **comments:** focus the composer after saving a comment with the send key ([2749fd6](https://github.com/MrVPlusOne/takode/commit/2749fd63bf6cfcaf884ad9485ab2271a44c68f4b))
* **composer:** cancel a recording from the button row, and undo/redo for drafts on phones ([dabf721](https://github.com/MrVPlusOne/takode/commit/dabf72165774bebc9789736bd098b260814b67e9))
* **composer:** put the [transcribed] tag on its own final line ([574ed77](https://github.com/MrVPlusOne/takode/commit/574ed779ba4f6c08251505567c9dac4eea24aaa5))
* **composer:** tag voice-transcribed messages so agents know they were dictated ([ec36e46](https://github.com/MrVPlusOne/takode/commit/ec36e46234b9610c966fa00cee811edc5af2a0de))
* **composer:** type anywhere to open the composer ([fae4921](https://github.com/MrVPlusOne/takode/commit/fae4921c579f5928b2e3c0b9b996bff9ac894dc4))
* **dev-scripts:** fall back to ss when lsof is missing ([baede8a](https://github.com/MrVPlusOne/takode/commit/baede8aebb857994308e4db98e53b23092fcebb1))
* **diff:** make the commit diff view friendlier on phones ([5a14985](https://github.com/MrVPlusOne/takode/commit/5a149851db8ad6643795a2b90248f5f7f6384077))
* **diff:** open diffs from the quest banner chip instead of the top bar ([28b368c](https://github.com/MrVPlusOne/takode/commit/28b368c18b3a88f1f276c2ab54e0e0e69a0490aa))
* **drafts:** sync composer and needs-input drafts through the server ([bac3e8b](https://github.com/MrVPlusOne/takode/commit/bac3e8b83cfdb7318c4586ae90280cd919d7fef5))
* **drafts:** sync uploaded composer images across devices ([bd89b28](https://github.com/MrVPlusOne/takode/commit/bd89b2830bd95dd803b7337cd548cd6adaaff932))
* **feed:** a leader's desktop Next chip sits right after the thread tabs ([3d9b4d7](https://github.com/MrVPlusOne/takode/commit/3d9b4d7ea2c8e32c72777eef86e3e1cf04473cd5))
* **feed:** calmer previews for messages quoted above answers ([48ffc18](https://github.com/MrVPlusOne/takode/commit/48ffc18d1eb8f94108aeb5ae475fe92752d0fd94))
* **feed:** cycle through a session's attention items from its feed chip ([7b039bf](https://github.com/MrVPlusOne/takode/commit/7b039bfdcc14826502d666098ddaaa43fdfc0817))
* **feed:** day pill only while scrolling; shorter collapsed composer ([b0a8351](https://github.com/MrVPlusOne/takode/commit/b0a83513a5584e0f4d0d0749f76bb1d0aeb3aabd))
* **feed:** desktop navigation buttons fade after scrolling stops ([2cc18c3](https://github.com/MrVPlusOne/takode/commit/2cc18c3b65c7ed0eab298bf892dd21f171ca3013))
* **feed:** faster Read aloud, saved replays, reports and a Copy submenu ([12e5f62](https://github.com/MrVPlusOne/takode/commit/12e5f62b8ef5d5f6284656e832591beab8c4fb5e))
* **feed:** keep expanded reports and long messages on the server, the same in every browser ([b292683](https://github.com/MrVPlusOne/takode/commit/b292683d997653c97929f83c70585ef79d82a709))
* **feed:** keep the last few chats viewed mounted but hidden, so going back is instant and exact ([18c4753](https://github.com/MrVPlusOne/takode/commit/18c4753812dab0356094afb39e44f90310ab3e3f))
* **feed:** label the attention chip "Next" instead of the item's kind ([652a395](https://github.com/MrVPlusOne/takode/commit/652a395187da79982738354f4e28682e5d47f6d7))
* **feed:** message times say how old they are ([18afab8](https://github.com/MrVPlusOne/takode/commit/18afab8daa26e99ec73a551373fd3262019b61fb))
* **feed:** one link shape from a message to each quest it started ([e3603e3](https://github.com/MrVPlusOne/takode/commit/e3603e3071e28a1dddf151ee7a7ebc196a78fd09))
* **feed:** open reports, posts and visuals full screen from their card ([2601526](https://github.com/MrVPlusOne/takode/commit/2601526adc99488fef0b4a1ca586cc8c564fdfdd))
* **feed:** quest link text hover shows the full preview, the thread icon only its title ([b9d5ac8](https://github.com/MrVPlusOne/takode/commit/b9d5ac8767357f43e9d7eee4d369b3bb23e8490f))
* **feed:** quote answered messages in All Threads even when they are outside the loaded window ([c612d0e](https://github.com/MrVPlusOne/takode/commit/c612d0e07f991bf3d056fe7ae5abfa9db38e1f82))
* **feed:** Read aloud mentions links and commits you can open ([44f0a8d](https://github.com/MrVPlusOne/takode/commit/44f0a8d6a332b745493fbf559de1b055f21d1124))
* **feed:** Read aloud mentions many links once instead of after each ([bbe83f8](https://github.com/MrVPlusOne/takode/commit/bbe83f841938cf03edd27c2232d54918f273dcd9))
* **feed:** read assistant messages aloud ([20a5276](https://github.com/MrVPlusOne/takode/commit/20a5276f9a2289ed57719133504ad218aa86be3b))
* **feed:** render Takode-injected messages as one shared collapsed chip ([4ee2477](https://github.com/MrVPlusOne/takode/commit/4ee24777e283dfced89dcc0cd0a54879537e1858))
* **feed:** show each message's time in its lower-right corner ([3eb770f](https://github.com/MrVPlusOne/takode/commit/3eb770fbfdacacda9b418aa6673ef17a734358a0))
* **feed:** show headings as typed and render dividers, tables and images in user messages ([e578d9a](https://github.com/MrVPlusOne/takode/commit/e578d9acaec71d056537dfd1cfa061d5d49ed7dc))
* **feed:** show Markdown image syntax as a reserved thumbnail, marked missing when gone ([945074b](https://github.com/MrVPlusOne/takode/commit/945074b3a7ed6688128f824c898a86d7d9fd9ba8))
* **feed:** show pending messages as faded bubbles where they will land ([6302ae7](https://github.com/MrVPlusOne/takode/commit/6302ae70bd17ca211767fe899306411ac7ed14d3))
* **feed:** show published reports in collapsed leader turns as a clipped, expandable preview ([abb212a](https://github.com/MrVPlusOne/takode/commit/abb212ad7c966c1370be727e6883c45c88b6fa56))
* **feed:** show what each leader answer answers and keep Quest complete at its time ([0b18a53](https://github.com/MrVPlusOne/takode/commit/0b18a5324e371a00e280dc6315da50f27c1b3e40))
* **feed:** turn image paths in agent messages into file-name links ([9df2144](https://github.com/MrVPlusOne/takode/commit/9df2144de922a5d801c2c42da30a0bba4e72ec6a))
* **feed:** walk the paw down the feed as new answers arrive ([540aef3](https://github.com/MrVPlusOne/takode/commit/540aef3b535d7690404e61463119b01248a13c59))
* **files:** open file links in Takode's viewer, with Open in VS Code over Remote-SSH ([7791637](https://github.com/MrVPlusOne/takode/commit/77916373bdcbdbaefc7a545767553c2ce329c15b))
* **herd:** let workers mark turns quiet so they do not wake the leader ([dbf4d0d](https://github.com/MrVPlusOne/takode/commit/dbf4d0d6a41eb69338d268e7631be5ad10bdf6f4))
* **herd:** make the worker-slot limit configurable per leader backend ([fb7dc9a](https://github.com/MrVPlusOne/takode/commit/fb7dc9a853df98e7cb517fb4599d04e9f40642ec))
* **hosts:** neutral machine chips that mark only offline hosts ([ad88f48](https://github.com/MrVPlusOne/takode/commit/ad88f48bac4fed230be49433c6bda5ce407179fc))
* **hosts:** send unpushed commits to hosts and prepare updates before stopping sessions ([5e0f2ff](https://github.com/MrVPlusOne/takode/commit/5e0f2ff4f3b08782f6f45fa0fedcd8ba1a5ee8ca))
* **hosts:** show each machine's real default worktree folder in Settings ([5547cda](https://github.com/MrVPlusOne/takode/commit/5547cdaaf7d94c42281331de8cc9e804b5d09729))
* **hosts:** tell recovered sessions what was kept and lost, and keep worktrees in a per-host folder ([e57aa4b](https://github.com/MrVPlusOne/takode/commit/e57aa4bc641994c60840c1fd4296ef1f4059aed2))
* **image-viewer:** Copy image puts the image itself on the clipboard ([8b1a358](https://github.com/MrVPlusOne/takode/commit/8b1a358efb5ef5b0532b4679276721e8caca5d91))
* **images:** compress model copies, uploads and thumbnails as WebP ([e904be7](https://github.com/MrVPlusOne/takode/commit/e904be7209a0ce92859f2da3fbb781b79e0c10e9))
* **images:** compress opened images as high-quality WebP to cut traffic ([d638baa](https://github.com/MrVPlusOne/takode/commit/d638baae962c112dc0455fadeca0eb83379ec2ec))
* **images:** show agent screenshots at full quality in the image viewer ([d7b855d](https://github.com/MrVPlusOne/takode/commit/d7b855d9e16037d512b1c5621319df8e79ae5cdf))
* **images:** show image size and a loading state in the image viewer ([28e3d03](https://github.com/MrVPlusOne/takode/commit/28e3d03aac488319407db67e48cca63563537c67))
* **images:** swipe between images in the image viewer ([7be9124](https://github.com/MrVPlusOne/takode/commit/7be9124a32816fc7abc0b35a3f091ce9e828247f))
* **instructions:** agents title every draft so revisions group in the Library ([37cc167](https://github.com/MrVPlusOne/takode/commit/37cc167a1562d20001d9f094d9cabebd31a6f67e))
* **landing:** free workers once their changes are submitted ([5be91a6](https://github.com/MrVPlusOne/takode/commit/5be91a601ed6c74bbff663ee7356573bd8c5af1a))
* **leader-header:** desktop leaders with topics keep their tabs in the top bar ([22425e9](https://github.com/MrVPlusOne/takode/commit/22425e9084e5c9d93e595edc83f6e522ce1f8f6f))
* **leader-tabs:** recent chats move a tab up within its status group ([ccd532c](https://github.com/MrVPlusOne/takode/commit/ccd532c6115a56a84bc4fef5ffb15f4a0f8e125b))
* **leader-tabs:** show when a quest tab belongs to another leader ([1ce3d71](https://github.com/MrVPlusOne/takode/commit/1ce3d71ca7771d346e3604a73718fdb53efc2d27))
* **leader-threads:** quiet supporting quests and answer where the user asked ([81b3688](https://github.com/MrVPlusOne/takode/commit/81b368837fc1eeda7cdd3d5086432e7568cecf7e))
* **leader-threads:** show a live turn timer in the worker preview title ([c618c99](https://github.com/MrVPlusOne/takode/commit/c618c9926f25ca0750885dd6078bd0cde4b87d8c))
* **leader-threads:** simplify the worker preview title bar ([a30cf40](https://github.com/MrVPlusOne/takode/commit/a30cf405cf683ea77711c34b512f362c38ec5bc2))
* **leader-unread:** mark leader threads unread for new answers and finished quests, and give other leaders' messages their own turn ([acb70b4](https://github.com/MrVPlusOne/takode/commit/acb70b4438f86c4ad0604fc5df2ddcd9a4f7a697))
* **leader:** answers that name no request, and published reports, make their thread unread ([8671dd0](https://github.com/MrVPlusOne/takode/commit/8671dd0917f4dffd507a1a44b593b9dd85a5c3bf))
* **leases:** allow raising a lease pool while slots are held ([5612b54](https://github.com/MrVPlusOne/takode/commit/5612b549d9acebe3820952974e31b8ed353da82f))
* **library:** a post with replies is one card, with files per part and part-level revisions ([c4258b7](https://github.com/MrVPlusOne/takode/commit/c4258b7fb5417b0bc4caa0d8d1f96cc341c1f4e1))
* **library:** a quest's topic replaces its tags in the quest views ([4046bde](https://github.com/MrVPlusOne/takode/commit/4046bde7510c888dda0ca94ce96bbc347c010ccc))
* **library:** a Scribe per leader keeps topic pages, as a quiet worker in its herd ([e3cb814](https://github.com/MrVPlusOne/takode/commit/e3cb814415b467fe151ced3a9c1e4cc48d496c77))
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
* **library:** quest tabs zoom out to their topic and back, keeping the reader's place ([4ece3ad](https://github.com/MrVPlusOne/takode/commit/4ece3ad084881471a1fe3ab67234c5a3a6fef79e))
* **library:** quest views name the quest's topic, opening its conversation where the quest was last discussed ([5683dc9](https://github.com/MrVPlusOne/takode/commit/5683dc9937464044e83ef2c8b9fcbf2163cdfb70))
* **library:** report cards open full screen, with Library, copy and export in a More menu ([d9669bd](https://github.com/MrVPlusOne/takode/commit/d9669bd386f2905ecf2faf0c1f8fc77dcf4c8f3a))
* **library:** save artifacts with versions and add the Library page ([e9d06a4](https://github.com/MrVPlusOne/takode/commit/e9d06a4657a6a96e305744907277202dd582efa0))
* **library:** Scribe events by urgency, done taps without a Scribe round, grouped Now items ([cbca4b8](https://github.com/MrVPlusOne/takode/commit/cbca4b8fb09ee512af19ff71bbc15235097251e3))
* **library:** Scribes run as continuous workers driven by events, guided by instructions ([1680c78](https://github.com/MrVPlusOne/takode/commit/1680c78fe794668b73ffe95b50567f4a0930380b))
* **library:** star artifacts from the gallery and a Starred toggle beside Filter ([83d251d](https://github.com/MrVPlusOne/takode/commit/83d251da900cf54d933ebf8a93d5d1a55eba1af9))
* **library:** topic conversations, a recent-first Done list and fresher topic pages ([b9a85a9](https://github.com/MrVPlusOne/takode/commit/b9a85a91fd4049e713ae68034d37b24c2e212bf3))
* **library:** topic page sections by kind of topic, and the user's requests per page ([f34e4f9](https://github.com/MrVPlusOne/takode/commit/f34e4f9f19707b164865496fce9d6a1dc6fd9ee0))
* **library:** topic pages are dashboards that track current state, not explanations ([2df75d8](https://github.com/MrVPlusOne/takode/commit/2df75d8c0352cdb85e9a91c36b9cf2b8313bd3e2))
* **library:** topic pages for deciding what to do next ([e5cbc1a](https://github.com/MrVPlusOne/takode/commit/e5cbc1a58b26cc1fa8f2dc95e28c0c6ed1f0ad13))
* **library:** topics with pages kept up to date ([06c3175](https://github.com/MrVPlusOne/takode/commit/06c31756faed72cf864ee04ebc5e274c4eb92a92))
* **markdown:** cap long code blocks to a scrollable window with expand ([302e659](https://github.com/MrVPlusOne/takode/commit/302e659f8decaf9333d839febfde52bf7cfceefe))
* **markdown:** copy for Slack keeps all formatting, also for a selection ([49a72d0](https://github.com/MrVPlusOne/takode/commit/49a72d0c9b84f036b798d690e24522c209c96334))
* **markdown:** copy tables in chosen formats and messages for Slack ([3ae0e39](https://github.com/MrVPlusOne/takode/commit/3ae0e394db8dd1c2d9a424475dd91fcb021aba44))
* **markdown:** draft cards with one-tap Copy for Slack ([19c0980](https://github.com/MrVPlusOne/takode/commit/19c09803e82550036d06f1455cb86bcc37c1def9))
* **motion:** drop the celebration when the Needs you group empties ([7c3817b](https://github.com/MrVPlusOne/takode/commit/7c3817b7d122d47e7a72439a698c19c6e7c34e85))
* **motion:** easier-to-notice tab glide and small completion celebrations ([0f508e0](https://github.com/MrVPlusOne/takode/commit/0f508e0186a08e374e67d65cf957555be94687a4))
* **motion:** randomized firework celebrations that lean away from screen edges ([8cda156](https://github.com/MrVPlusOne/takode/commit/8cda156eef6dea7129aaa87a2d7d3d5ea23efe3b))
* **nav:** back, forward and recently viewed buttons on desktop ([e5d8ac0](https://github.com/MrVPlusOne/takode/commit/e5d8ac0827a9f2585d5bfba4acad890b6b4d0c3b))
* **needs-input:** put reply controls at the right edge for one-handed use ([0228c0b](https://github.com/MrVPlusOne/takode/commit/0228c0b6e043a4ae6dbe1e3b8dd4060fdcaca8a7))
* **needs-input:** reply cards can send your pending comments with the answer ([1e2edf3](https://github.com/MrVPlusOne/takode/commit/1e2edf39ba8dddea2776a4918064484593671c28))
* **needs-input:** reply cards get an additional comments field ([48d41d5](https://github.com/MrVPlusOne/takode/commit/48d41d599d5082c68f74bea5a89e9167ffe06d72))
* **new-session:** name a session in the New Session dialog ([ebc1d62](https://github.com/MrVPlusOne/takode/commit/ebc1d6202c0b9399fec96f4d94b1e7e6805cbf8d))
* **notifications:** clear outdated phone alerts on tap and badge the app icon with waiting questions ([1255132](https://github.com/MrVPlusOne/takode/commit/12551324f3e597306d1ee3bc8821b2fc2c1bb525))
* **notifications:** offer 1h, 6h and 24h snoozes and snoozing until a chosen day ([750b5a3](https://github.com/MrVPlusOne/takode/commit/750b5a3a1c44e3f1d1d29a08018503e07f028c4f))
* **notifications:** open alerts and unread threads at the exact message ([cd600d8](https://github.com/MrVPlusOne/takode/commit/cd600d8affa1a9d2589e104de6927b432627d68f))
* **notifications:** remind on the phone about questions left waiting ([ba8b5c7](https://github.com/MrVPlusOne/takode/commit/ba8b5c723a50ed08f2c455b2e29e51df3b57853f))
* **notifications:** selectable alert sound sets, including your own sounds ([eedf2ac](https://github.com/MrVPlusOne/takode/commit/eedf2ac927dcdb13e7eb8fba818f6db3067e0b48))
* **notifications:** sound alerts from every session unless their tab is on screen ([ec2d0ec](https://github.com/MrVPlusOne/takode/commit/ec2d0ecfda46d1d3fb98ac2e97cdb554d39653dc))
* **orchestration:** have leaders acknowledge a user request before starting tool work ([7382052](https://github.com/MrVPlusOne/takode/commit/73820524d9c7379c4eee86467933dc11ef39c5c8))
* **portraits:** Animals is the default portrait set, and the picker starts with the cat groups collapsed ([fef1013](https://github.com/MrVPlusOne/takode/commit/fef10136c49340b4ac7ba6d50e526ed6cb9f1207))
* **portraits:** larger desktop portrait picker with collapsible groups saved on the server ([76e5212](https://github.com/MrVPlusOne/takode/commit/76e5212d2a0cd6afc8972efcdfd7af5fa8904a61))
* **portraits:** one-time offer for existing users to switch leaders to the Animals portraits ([4f0323c](https://github.com/MrVPlusOne/takode/commit/4f0323c1306fdac9c7ef75fed2e19374c303650f))
* **profiles:** add an animals leader portrait set ([45055e6](https://github.com/MrVPlusOne/takode/commit/45055e6b1ed23e538154c32874e7a1c2c1495c8a))
* **quest-header:** say Done and drop the phase total on phones in the quest header chip ([3eeae3b](https://github.com/MrVPlusOne/takode/commit/3eeae3baff77da30f9a2b4e4a8b0ba042c4d7666))
* **quest-preview:** make the quest preview easier to read ([ee1d9fa](https://github.com/MrVPlusOne/takode/commit/ee1d9fa3040b869e9a5ff7abfe79a0562d374d10))
* **quest-preview:** preview a quest when a message link is tapped on touch ([8e73c00](https://github.com/MrVPlusOne/takode/commit/8e73c00ec8b85c140ddaedb846efe6ea29b6094f))
* **quest-strip:** one-line quest strip with Worker and commits in the phase pill's card ([c0469f7](https://github.com/MrVPlusOne/takode/commit/c0469f750131adf51a8cce8a8bf48ee3c6c75823))
* **questmaster:** one list that adapts to phone and desktop ([89edfda](https://github.com/MrVPlusOne/takode/commit/89edfdadf5a9f213018a5419eaa640b4679895d6))
* **quests:** compact the full quest view header on phones ([07dfccc](https://github.com/MrVPlusOne/takode/commit/07dfccc2c278f527c56e6a4e99524e706a156787))
* **quests:** jump to a quest's thread from the icon after quest links ([ba5b88d](https://github.com/MrVPlusOne/takode/commit/ba5b88db19506b9ef368cc5db91cabdb7268ed09))
* **quests:** link a quest thread and the message it was filed from ([5a2f95c](https://github.com/MrVPlusOne/takode/commit/5a2f95c6e437f195507ae2c06f84023a657f342b))
* **quests:** modernize the quest view's feedback and action bar ([19edcd2](https://github.com/MrVPlusOne/takode/commit/19edcd24dfe6d47d0572cdaa2d46d0f65236a586))
* **quests:** pin Open Worker and Open Thread to the bottom of the phone preview sheet ([3041a7d](https://github.com/MrVPlusOne/takode/commit/3041a7d15d777068053c2fedf869de653f7882dd))
* **quests:** put Open Worker and Open Thread buttons at the top of quest views ([92782a3](https://github.com/MrVPlusOne/takode/commit/92782a35044f1cb9516d1b73c9913621c6cce139))
* **quests:** rounds keep reopened quests small ([2b1f936](https://github.com/MrVPlusOne/takode/commit/2b1f936295acf5737de72976573e77987f95c49b))
* **quests:** show unscoped feedback at its time position in the Journey timeline ([24b7c19](https://github.com/MrVPlusOne/takode/commit/24b7c19a1d00a85a871f7383eb0269f088c3241f))
* **quests:** write quest quizzes only when they help ([068a929](https://github.com/MrVPlusOne/takode/commit/068a9293371d1227ec73b0be5b3e7ef0ad2c0e82))
* **reports:** name only the report file in agent-facing report comments ([9542475](https://github.com/MrVPlusOne/takode/commit/9542475745543cfa12b4c447ab4ab88283d20e8b))
* **reports:** send report comments to the current session like any other comment ([023d695](https://github.com/MrVPlusOne/takode/commit/023d6954c99f2ccb98918fa7de9c76b35d574a85))
* **restart:** load the code landed on the server's branch ([fd6f2fe](https://github.com/MrVPlusOne/takode/commit/fd6f2fe243f1fcce29995f3bc5cec6baa2ee1754))
* **restart:** pull the latest published code, or stop and say why ([025e5e6](https://github.com/MrVPlusOne/takode/commit/025e5e6b1f495df8fec3d91268160205a0e609df))
* **review:** a message about the whole review on the wrap-up, and leaders stop assuming answers mean implement ([39d2d67](https://github.com/MrVPlusOne/takode/commit/39d2d67f3fce9b901206ad3315bb58092c1e33b4))
* **review:** Back beside Next in the walkthrough, and no Question or Change buttons ([8916a90](https://github.com/MrVPlusOne/takode/commit/8916a904838fbdc1ea426ef64c5e4710882a0d3c))
* **review:** comment on lines of code in guided reviews ([a7fc9b7](https://github.com/MrVPlusOne/takode/commit/a7fc9b7993f4b7404a39f5362d164b8b13a8d75d))
* **review:** guided reviews as a walkthrough with count tiles ([5679f98](https://github.com/MrVPlusOne/takode/commit/5679f98e3884be7eeb13fee2251cfb0991531846))
* **review:** guided reviews as one tour with synced inline answers ([928480e](https://github.com/MrVPlusOne/takode/commit/928480ea411aca625f6be2b2fd165ebd5a5ac393))
* **review:** guided reviews with questions first, then a tour ([65b8644](https://github.com/MrVPlusOne/takode/commit/65b86447c0c04a99dadc8d09aa609ccee3cd4c55))
* **review:** list each summarized file with the lines it covers, and leave Escape to a quest opened over a review ([4f0649a](https://github.com/MrVPlusOne/takode/commit/4f0649aea27ab18aab58391e741c52765a31989a))
* **review:** share a published guided review into another thread ([8469f8b](https://github.com/MrVPlusOne/takode/commit/8469f8b3580aeba3cf37d4cf58bef0fae63aa661))
* **review:** the guided review walkthrough uses the whole window, giving its code more width ([b14e42c](https://github.com/MrVPlusOne/takode/commit/b14e42c52bf7c370ba04bc594b4d506015afbe1a))
* **search:** give global search the leader Find sheet's look and one shared width ([27f977f](https://github.com/MrVPlusOne/takode/commit/27f977fa923cc89c13d53422c7abc62a7a8f6c86))
* **send:** name the receiving leader's thread with takode send --thread ([3d7266e](https://github.com/MrVPlusOne/takode/commit/3d7266e4d47e2c34cb468a6b7c91635d51995ec0))
* **session:** settings in the title and Session Info, quests and participant chips ([fa260a0](https://github.com/MrVPlusOne/takode/commit/fa260a0b6831409930a2290661b87087c8a42aed))
* **sessions:** show small skill changes to sessions as a diff ([a98afa0](https://github.com/MrVPlusOne/takode/commit/a98afa0d6706dbea524a8c2f4831c628f32d6d81))
* **sessions:** tell sessions when skills they loaded have changed ([f560ef2](https://github.com/MrVPlusOne/takode/commit/f560ef29654e16d83a8a2d401ef224d109f03f10))
* **settings:** list incoming and current-build changes in the Restart section ([6bc1371](https://github.com/MrVPlusOne/takode/commit/6bc1371de6871380dde424435f73908f43b03414))
* **settings:** separate OpenAI test key for agent tests and validation servers ([f5ceb76](https://github.com/MrVPlusOne/takode/commit/f5ceb7645c39385e0b527698a4883330b9581884))
* **settings:** server time zone setting applied at every server start ([cb7584a](https://github.com/MrVPlusOne/takode/commit/cb7584a08db7d511e29f1eb5796fc137799f8153))
* **sidebar:** a leader's Scribe sits last in its herd, apart from the worker count, and keeps its name ([1e16538](https://github.com/MrVPlusOne/takode/commit/1e16538767e9534a7d90da970fa47e25d106db8c))
* **sidebar:** add a Recent view that lists sessions by recent interaction ([3d69879](https://github.com/MrVPlusOne/takode/commit/3d69879efb95f22225c75a872df702018d667fb4))
* **sidebar:** drop the archive button from session cards ([111a914](https://github.com/MrVPlusOne/takode/commit/111a9149b1b1fd203bae65518d241caf0b117d76))
* **sidebar:** drop the header Quests chip and make the search field full-width and global ([48fd0ea](https://github.com/MrVPlusOne/takode/commit/48fd0eae05903e518b60ec1eaec28873f2557875))
* **sidebar:** leader portraits a quarter larger on desktop ([2189c58](https://github.com/MrVPlusOne/takode/commit/2189c58c87fd5c3573af102c12a88a596a6c5af5))
* **sidebar:** one-row search and Quests, drop the needs-input and Notify Me counts ([8006c48](https://github.com/MrVPlusOne/takode/commit/8006c48f5098ece19f9f155382de5a8914022d6b))
* **sidebar:** put the backend icon first on session card metadata rows ([dda6ff3](https://github.com/MrVPlusOne/takode/commit/dda6ff3f808fde50b5869e8a6d85944bad7f6b1d))
* **sidebar:** show a waiting leader's timer on its portrait corner and drop the timer text ([c410517](https://github.com/MrVPlusOne/takode/commit/c410517adfd2dd73f02e41ec4088f736ffe6d3fd))
* **sidebar:** swipe the phone sessions panel closed instead of archiving rows ([ffe4e5a](https://github.com/MrVPlusOne/takode/commit/ffe4e5a0a8b3a7c5362c7e10cb878eece3bca238))
* **sidebar:** unlock the desktop sessions panel to fold it to its top row and drop it down on hover ([f2b5d14](https://github.com/MrVPlusOne/takode/commit/f2b5d14ecca86bd62c4cc225ef8c48da1cc37bb9))
* **skills:** add self-improvement skill as moved from personal store ([8c83f5d](https://github.com/MrVPlusOne/takode/commit/8c83f5d5d605a4eceaab1450e9dee3f4e28682d8))
* **skills:** ship self-improvement as a global Takode skill ([2a16bc5](https://github.com/MrVPlusOne/takode/commit/2a16bc566ae60f96d0fca4dc2da5dd54eee5961c))
* **tabs:** bigger strip close button, close slide, next tab from the same group ([485439d](https://github.com/MrVPlusOne/takode/commit/485439de76d2bd59902bc5c41e6d4795bf89f365))
* **tabs:** calmer tab groups and Main strip, ordered by the stages of the work ([d6c7773](https://github.com/MrVPlusOne/takode/commit/d6c7773a3bb4f45c1d4d3e4dc290188a851c7b80))
* **tabs:** close the tab on screen from the quest strip; spin where the leader works ([b3374a1](https://github.com/MrVPlusOne/takode/commit/b3374a18809d1eea9fea63e241335541ba167755))
* **tabs:** Find lists and reopens the leader's closed quest tabs ([9548bdf](https://github.com/MrVPlusOne/takode/commit/9548bdf9e701b901b747f3cc03c7e6acc8d0fe01))
* **tabs:** New results opens the next unread tab, with its list a step away ([f981970](https://github.com/MrVPlusOne/takode/commit/f981970540bb2c48d673b1dba24c333aa0bae298))
* **tabs:** show phone thread tabs as status groups ([dee2580](https://github.com/MrVPlusOne/takode/commit/dee258011cbaaf252611f163f686a33bb57219ce))
* **tabs:** use status groups on every screen size and retire the tab strip ([5260d19](https://github.com/MrVPlusOne/takode/commit/5260d19335273a256d7070dfae390342ad8cc527))
* **takode:** add an activity command showing the user's messages and the answers to them ([49f6dd2](https://github.com/MrVPlusOne/takode/commit/49f6dd2c641b888929a530206d518d9a051f17e9))
* **takode:** create peer leaders in the creator's session space ([99577c4](https://github.com/MrVPlusOne/takode/commit/99577c47534fea7a5b2139a5c347068d8e8d297a))
* **takode:** show the first 1,000 characters of each message in takode activity ([e7df261](https://github.com/MrVPlusOne/takode/commit/e7df261d54351daab09eb25dbb98626bee7d0aa8))
* **terminal:** compact Terminal page with a machine picker ([33dc59f](https://github.com/MrVPlusOne/takode/commit/33dc59ff198e7d35fa7ba37b2e32de1f291cedfc))
* **theme:** replace the VS Code theme with a System option that follows the device ([15aa78f](https://github.com/MrVPlusOne/takode/commit/15aa78f7b276ff1ef1f3c4affba8a6d208006522))
* **thread-tabs:** a second click on an open tab group opens its first tab ([5ce9fed](https://github.com/MrVPlusOne/takode/commit/5ce9fed1a109e63974e24a270d923b276015872f))
* **thread-tabs:** Find's Messages list pages back to the session's first message ([40b8ac5](https://github.com/MrVPlusOne/takode/commit/40b8ac564c099fc7411784d5b907781b9cf5d98d))
* **threads:** a leader answer or report in a side quest's tab makes it a full quest ([e63c599](https://github.com/MrVPlusOne/takode/commit/e63c5992a1a6f58e261e38e9062691030238b2ae))
* **threads:** answering the leader's question in a side quest's tab also makes it a full quest ([bf38e08](https://github.com/MrVPlusOne/takode/commit/bf38e08813385dce6ff571fcd1540dbbdfa25822))
* **threads:** drop the Work continued handoff labels from the chat feed ([fa28310](https://github.com/MrVPlusOne/takode/commit/fa28310cb2239911c2ce008e17c36a83693c618e))
* **threads:** list recent messages in a leader's Find ([a7f1e62](https://github.com/MrVPlusOne/takode/commit/a7f1e620ffa15fe235aa43e9528f8cc5343630dc))
* **threads:** mark side quests in the leader's tab lists and quest header ([fcd8c2c](https://github.com/MrVPlusOne/takode/commit/fcd8c2cfa7209edf7c8b995205020279eda27235))
* **threads:** remind me later from the Notify button ([b88abfd](https://github.com/MrVPlusOne/takode/commit/b88abfd022a47c625fc1a4ae4cfb18b664667d49))
* **threads:** show the quest tab's worker preview whenever the quest is in an active phase ([b2b5a7e](https://github.com/MrVPlusOne/takode/commit/b2b5a7e343054c4aac84b2d32ac2c6e9392b910b))
* **threads:** simplify Find to Messages and Tabs, both newest first ([f3a8e54](https://github.com/MrVPlusOne/takode/commit/f3a8e5431eb2838da5e30404f5f7c3aa2618ade3))
* **threads:** start new threads from a Threads menu; they settle once their last answer is read ([892bcae](https://github.com/MrVPlusOne/takode/commit/892bcae2df94681f09dd00bfb3631a9223004e6c))
* **threads:** sweep a sheen across a quest fork row the first time it appears ([9c91d13](https://github.com/MrVPlusOne/takode/commit/9c91d13aa1b4265bf98dba91b941095ab4c7608c))
* **threads:** the quest tab's worker preview shows helper sessions and what the owner waits for ([d966081](https://github.com/MrVPlusOne/takode/commit/d96608189d73c289adc2dba84ff5d94701d31f92))
* **threads:** writing in a side quest's tab makes it a full quest ([7025401](https://github.com/MrVPlusOne/takode/commit/7025401a62bbc3bc57655ba2c21d14e4f205382a))
* **todos:** act on a to-do from its link preview ([28a791b](https://github.com/MrVPlusOne/takode/commit/28a791b501ac119c323e8475d6af3245c26c99ad))
* **todos:** check circle and fireworks in the to-do preview ([7e230ec](https://github.com/MrVPlusOne/takode/commit/7e230eccc99f645a8194fb8d2ae38dba991e71a2))
* **todos:** desktop side-panel layout for the to-do sheet ([a47ec1d](https://github.com/MrVPlusOne/takode/commit/a47ec1d060a84bc0c33927aff50faf4eceffc38e))
* **todos:** due dates, overdue highlight and count, and overdue phone alerts ([e176c35](https://github.com/MrVPlusOne/takode/commit/e176c358920104336aa3bb7f49834f4dac559e31))
* **todos:** lighter personal to-do page with swipe actions and a shared to-do sheet ([57d89c1](https://github.com/MrVPlusOne/takode/commit/57d89c1ebe957c5a43f653ac860b4924ec5e4603))
* **todos:** link personal to-dos to related quests ([142d030](https://github.com/MrVPlusOne/takode/commit/142d030e67ff8a8d5594ee76c523a8fdb7807de3))
* **todos:** mark a to-do proposal done in one step from its preview ([f6b0a59](https://github.com/MrVPlusOne/takode/commit/f6b0a591aa76e30a7e44e7f4e686da42bc9703e7))
* **todos:** mark to-do links and show each proposal's status ([0897c2e](https://github.com/MrVPlusOne/takode/commit/0897c2e12dfe516d915a5157f3debb1c53852da9))
* **todos:** replace to-do proposals and grants with direct adds and standing approvals ([50730a7](https://github.com/MrVPlusOne/takode/commit/50730a799eec17711eaf5b9426beff7371dab58e))
* **todos:** show each to-do's live status on to-do links ([37783b0](https://github.com/MrVPlusOne/takode/commit/37783b0e31b2e55f46269cdce2a7713442d08912))
* **todos:** show linked quests as status chips in the To-dos list ([b1fcc75](https://github.com/MrVPlusOne/takode/commit/b1fcc7530fe37ab5b5a956d675537ab92a840254))
* **todos:** to-do and proposal links with previews; proposals only add; agents make low-risk changes directly ([d49a377](https://github.com/MrVPlusOne/takode/commit/d49a3773622f6ec2d7c16b4a69bdc5b0b2cd8475))
* **topics:** messages sent from a topic conversation go to the topic ([2ac0bf9](https://github.com/MrVPlusOne/takode/commit/2ac0bf9ec972b2b98fcdad7a21fd59207df5e5e8))
* **topics:** search box in the Topics list and the topic panel ([f4b6ff5](https://github.com/MrVPlusOne/takode/commit/f4b6ff5905d05db90d2821e02db7850c12a926d7))
* **topics:** topics are threads ([bfdf78c](https://github.com/MrVPlusOne/takode/commit/bfdf78c409240bb53b9579d25cf7f8bc8a01e51f))
* **transcription:** drop 1-2 character workspace terms and terms already in the custom vocabulary ([b8dd1b3](https://github.com/MrVPlusOne/takode/commit/b8dd1b374473f57b22b48d09aa42763b3055b1c0))
* **ui:** float secondary views over the whole app instead of beside the chat ([461c2f6](https://github.com/MrVPlusOne/takode/commit/461c2f6e0110b517c6200a19045144cedea9bf69))
* **ui:** keep the conversation loaded and show pages and viewers beside it ([2c0deae](https://github.com/MrVPlusOne/takode/commit/2c0deae7bf59bb98467fa5039022d11fbc90d9ee))
* **ui:** one waiting chip and per-kind wait icons for timers, jobs, landing runs and queues ([c093c7d](https://github.com/MrVPlusOne/takode/commit/c093c7da0f7dcd1dace29a605d2a6116b4943185))
* **ui:** open the leader work board from a top-bar Board button and make it easier to read ([9e5b398](https://github.com/MrVPlusOne/takode/commit/9e5b398d115e13ecde0405fab07199fe879ebb9f))
* **ui:** press feedback on every control, pending state for server actions, squish for Send and Reply ([d8d4879](https://github.com/MrVPlusOne/takode/commit/d8d4879a4a2a745c286cc0d6f630e0813ece49fe))
* **ui:** show the leader's active quests as phase-colored dots in the Board button ([7d619fb](https://github.com/MrVPlusOne/takode/commit/7d619fb32c31612b42768b2de0daa535f6628f39))
* **user-content:** hand setup and migration to an agent instead of Settings controls ([7f859b3](https://github.com/MrVPlusOne/takode/commit/7f859b3f36ab9d04349bb879ef419fbc9a68bc18))
* **user-content:** keep user instructions and skills once and deliver them to every machine ([3a9a9fb](https://github.com/MrVPlusOne/takode/commit/3a9a9fb6545853bcd1cfeccb27b0b169eda00aa6))
* **user-content:** split the store, preview imports and guide migrations ([b3e8e36](https://github.com/MrVPlusOne/takode/commit/b3e8e36e18535ca52922d9cadca3358f309690e4))
* **validation:** add and remove a copied live session in a validation slot ([a199754](https://github.com/MrVPlusOne/takode/commit/a19975477c67f6ea267f495d828b5d4c61e678b7))
* **visuals:** visual blocks for agents, sandboxed so they can't hang Takode ([cbf318e](https://github.com/MrVPlusOne/takode/commit/cbf318e8f8a8cd7a55ca4b035dee7f92d25e4c31))
* **voice:** choose microphones while recording and remember their order ([6355e57](https://github.com/MrVPlusOne/takode/commit/6355e570d1c3681a7464672895d592e8fbced3b5))
* **voice:** custom instructions for the transcription enhancer ([91518bd](https://github.com/MrVPlusOne/takode/commit/91518bd9d14d5bbc4788aeaef48a766ac5eaaa4f))
* **voice:** drop everyday words and repeats from automatic transcription keywords ([ee80026](https://github.com/MrVPlusOne/takode/commit/ee800266561b2cb27edc748e7763bc61ddee16c5))
* **voice:** give transcription the workspace's recent terms, quests and activity ([2b3c927](https://github.com/MrVPlusOne/takode/commit/2b3c9276b2edf025c2d92f128ab99bedf26dfaa1))
* **voice:** record with the phone's own mic when AirPods are connected ([84f7366](https://github.com/MrVPlusOne/takode/commit/84f7366f3fb71c124652f37ef5a14d5face03c23))
* **voice:** tag dictated needs-input answers and comments as transcribed ([4305abc](https://github.com/MrVPlusOne/takode/commit/4305abc6873f9d5b2a1c5b43442092753057cb41))
* **voice:** use enhancer output as returned instead of a length guard ([3c3e5fc](https://github.com/MrVPlusOne/takode/commit/3c3e5fc061f1ce90fae93d1868ff8915ac72f9c2))


### Bug Fixes

* **activity:** list leader answers that name no message and published reports ([34d0884](https://github.com/MrVPlusOne/takode/commit/34d0884cd01afa254dc8fb491b596517bdf49ad3))
* **app:** a page that crashes after a server update reloads into the new version ([20699c3](https://github.com/MrVPlusOne/takode/commit/20699c3eba78bc49549bebf477b19cf5a828a919))
* **attention:** a Notify Me result opens at the answer it reports, not the Ready commentary ([06b4305](https://github.com/MrVPlusOne/takode/commit/06b4305543137f0c70a9ab36807175edd6028d60))
* **attention:** count an answer shown in several tabs as unread only in its own thread ([3657ea3](https://github.com/MrVPlusOne/takode/commit/3657ea3ef3f4565f1dc8a0dd010b38151eee9f22))
* **attention:** count unread by place, from what the user can still see ([f5605fa](https://github.com/MrVPlusOne/takode/commit/f5605fa7d593741e7808fa02020a3ee156631323))
* **attention:** name the unread result in unread rows, not the latest Ready status ([67e29c3](https://github.com/MrVPlusOne/takode/commit/67e29c3dacce5ab30c6e2f5203ffcf89d95a5ef7))
* **attention:** Next opens a topic's first unread answer, never the commentary before it ([09d273b](https://github.com/MrVPlusOne/takode/commit/09d273baedf4c63b29f2c02c95816e8a0c99f384))
* **attention:** open a finished quest's unread result on its Quest complete card, and answers before it ([1efdc74](https://github.com/MrVPlusOne/takode/commit/1efdc74c1871d3d24935804a32ecb2e75b1b60c6))
* **attention:** read a shared answer's Ready result from every quest tab that shows it ([a5dcb89](https://github.com/MrVPlusOne/takode/commit/a5dcb897ea88bf6a6e501fa1d78de83794c1c0e3))
* **attention:** room for the New line, and closing a tab follows the topic-first order ([9fc5a15](https://github.com/MrVPlusOne/takode/commit/9fc5a15ce252e99496e3de8d4b481e39442ec616))
* **board:** give User Checkpoint dots a real amber in light theme ([664bf9a](https://github.com/MrVPlusOne/takode/commit/664bf9a947ae040e98822e33f1509dd8728fb2a1))
* **board:** keep questions open when a User Checkpoint is ended by hand ([5f9632f](https://github.com/MrVPlusOne/takode/commit/5f9632f4262983e8457eed6cbaba059263fc2612))
* **board:** keep stale rows on paused or archived leaders from blocking quests ([9dd7d32](https://github.com/MrVPlusOne/takode/commit/9dd7d32ffe45a43bcc4387b6f16d45de763e2abc))
* **board:** put back a planned User Checkpoint ended by hand with open questions ([1437c28](https://github.com/MrVPlusOne/takode/commit/1437c288bb19be831b1cfb7cfa47717a2fc8cdbb))
* **browser:** send Safari and iPhone browsers uncompressed WebSocket messages ([329f746](https://github.com/MrVPlusOne/takode/commit/329f7467d4e9a291cab06d810c35745aee116b52))
* **browser:** use Safari-compatible WebSocket compression ([d2d3a23](https://github.com/MrVPlusOne/takode/commit/d2d3a2373a64fb2b4278123cb071adc558cf927b))
* **chat:** close quest link hover cards after the link was clicked ([2a0b420](https://github.com/MrVPlusOne/takode/commit/2a0b420c99b6a6f1296ae395e28cbf98754ce12c))
* **claude:** stop Claude's commit and PR attribution in Takode sessions ([d5ae4a0](https://github.com/MrVPlusOne/takode/commit/d5ae4a0045e0f5fb9be9a586480c813f7e0866bc))
* **cli:** send session tokens from takode host and companion management commands ([b86ecdb](https://github.com/MrVPlusOne/takode/commit/b86ecdbddcf07e0830d22dd9ea6873cefda71771))
* **codex-models:** follow the account's model list, keep chosen Default and models across relaunch, harden isolated homes ([20e768e](https://github.com/MrVPlusOne/takode/commit/20e768e4479052786ac8d171e100c181ca3f9166))
* **codex:** carry the user's Codex settings, plugins, hooks and login key into session homes ([db78e24](https://github.com/MrVPlusOne/takode/commit/db78e2430cc5ec3119bdcca5105d2c4c7f0f900a))
* **codex:** give generated session catalog entries Codex's own built-in prompt ([ef2a959](https://github.com/MrVPlusOne/takode/commit/ef2a959a2a3bb66cd0f63b75b6efe4cd83398dd0))
* **codex:** make the internet access toggle set Codex's web_search setting ([2d1f1ee](https://github.com/MrVPlusOne/takode/commit/2d1f1ee153fdca0b85d1f89d59bc1c354d0c5e4f))
* **codex:** revert Codex threads with thread/revert ([c268444](https://github.com/MrVPlusOne/takode/commit/c26844487580a5780d49525546f04aa473ba92ab))
* **comments:** keep the comment editor above the iPhone keyboard ([56440d2](https://github.com/MrVPlusOne/takode/commit/56440d29786696c1754b0daab1d73a6f5a790383))
* **composer:** a Send press that cannot send says why instead of doing nothing ([04c898c](https://github.com/MrVPlusOne/takode/commit/04c898cb5da0d93b3060bab7ceb007b45eb9c17b))
* **composer:** remove the collapse-all and minimize buttons ([898cc30](https://github.com/MrVPlusOne/takode/commit/898cc306024041d9c65856206fd2e55c2d98c007))
* **composer:** show the composer expanded when a voice transcription finishes ([159acf3](https://github.com/MrVPlusOne/takode/commit/159acf3686521d5b1d8929225fbb9bee7416db9b))
* **copy:** copy Takode-internal links as plain text instead of localhost URLs ([a6ac92d](https://github.com/MrVPlusOne/takode/commit/a6ac92dddb34584f1f8628f4fd799e32bfcdd1fe))
* **feed:** collapse needs-input reminders and give them a readable chip design ([27b7ede](https://github.com/MrVPlusOne/takode/commit/27b7ede527ef42f9a2d07a16e55f3d14142da5db))
* **feed:** drop leader read-marker chips from the chat feed ([7d681d6](https://github.com/MrVPlusOne/takode/commit/7d681d6ee3911fafb0aa6feb305e20bccdb1185a))
* **feed:** fold worker needs-input events into worker-event groups ([a961547](https://github.com/MrVPlusOne/takode/commit/a961547ea5a4b0078896c29354b70c88f88a3ca6))
* **feed:** keep a collapse control on screen for expanded report cards and mark comments on reports ([7245cbc](https://github.com/MrVPlusOne/takode/commit/7245cbc808fdd24f53c579f42f06451f93f3efc2))
* **feed:** keep a jumped-to message in place while the feed fills in around it ([922254e](https://github.com/MrVPlusOne/takode/commit/922254eaf6a6781e04df4a1071efe6a4ab6750e8))
* **feed:** keep All Threads at least as long as Main ([9f77bf8](https://github.com/MrVPlusOne/takode/commit/9f77bf832301a9d696d2954edabe8f0b17cdac3d))
* **feed:** keep answered needs-input prompts and their context in collapsed turns ([0db9d25](https://github.com/MrVPlusOne/takode/commit/0db9d2576df1a3df178c58402986e6cae8bc3045))
* **feed:** keep answered quest-thread prompts out of Main ([3fd4bc7](https://github.com/MrVPlusOne/takode/commit/3fd4bc78f1b7c3e48985bd16438d7ce406c1a002))
* **feed:** keep Go to bottom from restoring an older saved position ([ea72bdc](https://github.com/MrVPlusOne/takode/commit/ea72bdc8e10ae708874cf2fe9a3149ea42312c45))
* **feed:** keep live turn errors in their own turn and thread ([2eebd84](https://github.com/MrVPlusOne/takode/commit/2eebd844a871d0f103b7961d1ab53994ed3eb600))
* **feed:** keep loaded answer thumbnails mounted when a message is sent or a thread turns Ready ([e6a3cde](https://github.com/MrVPlusOne/takode/commit/e6a3cde097dd2e34d108aa0a76f7ec7278099720))
* **feed:** keep loading older All Threads history, at the usual first-load size ([01863ae](https://github.com/MrVPlusOne/takode/commit/01863ae3668722c8ef232e2d796c0af4ca967485))
* **feed:** keep Ready turns collapsed after navigation and earlier expansion ([9cfc411](https://github.com/MrVPlusOne/takode/commit/9cfc4111c1f62d513829d3af6263ca9665410299))
* **feed:** keep the day pill clear of the top controls; realistic Playground times ([ea44a9b](https://github.com/MrVPlusOne/takode/commit/ea44a9bdc9afed3f2cddaea65ed36ad291144324))
* **feed:** keep the quest complete card where the quest completed ([47e7116](https://github.com/MrVPlusOne/takode/commit/47e71163a3488de68c80020154cb40d6fbc644b4))
* **feed:** keep the reading position when sending while scrolled up ([77b0135](https://github.com/MrVPlusOne/takode/commit/77b01352120fc236d093fc8bbc84eaa20ff8de14))
* **feed:** keep visible turns mounted when the latest window slides ([2c81eb7](https://github.com/MrVPlusOne/takode/commit/2c81eb74a822659c4db3178480895a9da90312c3))
* **feed:** let the message options button take clicks under corner-time text ([94c7af5](https://github.com/MrVPlusOne/takode/commit/94c7af5b8d0130a322f3858cfa58ab0f631c7cdd))
* **feed:** on phones, give a short answer's time its own line below the options button ([dd3ab86](https://github.com/MrVPlusOne/takode/commit/dd3ab86b39b956254b9487fa7ea7a33fd7e94714))
* **feed:** only the real bottom resumes following, so worker preview updates never pull a reader down ([9c2ace5](https://github.com/MrVPlusOne/takode/commit/9c2ace505df57216d1f3e8446b0ec3478e9445ed))
* **feed:** send browsers the whole session state with each backend init, so expanded reports and stars stay ([8950b86](https://github.com/MrVPlusOne/takode/commit/8950b86d9798cb2b91134f410999ca6bb7a4ba55))
* **feed:** send notifications and attention records ahead of the messages ([ed7f9f9](https://github.com/MrVPlusOne/takode/commit/ed7f9f9185faead7cc510740b9e2ca2c4a59ce08))
* **feed:** show answer cards in Main and All Threads, not only the tab that owns the request ([6ba5a15](https://github.com/MrVPlusOne/takode/commit/6ba5a157c0b5e7ce40dddf01e6f578ed4fce04ad))
* **feed:** show every Markdown report as a clipped card, also in expanded turns ([def5e6c](https://github.com/MrVPlusOne/takode/commit/def5e6c1bd3d421e600480f3e76d43af5116c195))
* **feed:** show every takode send as a sent message, including leader-to-leader sends ([2bc0edb](https://github.com/MrVPlusOne/takode/commit/2bc0edb62cb4fde8f9fc2010470d34460aa6b6ba))
* **feed:** show thumbnails this browser already loaded as soon as a thread opens ([5e68541](https://github.com/MrVPlusOne/takode/commit/5e685417ffc39b5ae182ff02e568a509c0eeafcd))
* **feed:** start a turn at other leaders' messages in a leader's Main and All views ([9685ede](https://github.com/MrVPlusOne/takode/commit/9685ede524b23899e3249867ae186922b4da7a4d))
* **feed:** stop timers that outlive tests and fire after jsdom teardown ([2589ba0](https://github.com/MrVPlusOne/takode/commit/2589ba0fc170510c34efb288019801c697b10601))
* **feed:** time activity groups from their first start to their last end ([2b2d1cb](https://github.com/MrVPlusOne/takode/commit/2b2d1cbb9c1b15e13549a78a6be5c39f5a7afea0))
* **feed:** time every turn summary to the agent's last activity ([6f2fba8](https://github.com/MrVPlusOne/takode/commit/6f2fba870cf209b30fbdc7bbfcb36c7280665ac1))
* **feed:** top controls start below what is pinned at the top of the feed ([ff703de](https://github.com/MrVPlusOne/takode/commit/ff703def2e77d72fcb396ab62df7bab561d9e735))
* **file-links:** open Takode pages in an in-app sheet in the iPhone Home Screen app ([83b064e](https://github.com/MrVPlusOne/takode/commit/83b064e45c855db6a5f1aa176c8764f05bf2ac0f))
* **file-links:** show linked Markdown files inside Takode ([72c3407](https://github.com/MrVPlusOne/takode/commit/72c3407b8d8941e814fbec355f441bf9b1898f2d))
* **herd:** attribute a leader's dismissed question to the leader ([bca21f2](https://github.com/MrVPlusOne/takode/commit/bca21f24a2e8ca717d47240a28b97bb65028055c))
* **herd:** send herd events once to leaders on an offline host ([c4af167](https://github.com/MrVPlusOne/takode/commit/c4af167b7609b55ebfa1c3cbf231aa358c7646bc))
* **hosts:** alert on host outages only when work is affected ([1369326](https://github.com/MrVPlusOne/takode/commit/136932607f3c434eb332e547a170693bcb723de0))
* **hosts:** relaunch sessions whose worktree or conversation vanished with their machine ([ff04122](https://github.com/MrVPlusOne/takode/commit/ff041227699513aaf502c825707be08557594b73))
* **hosts:** stop a host stuck mid-update from hanging session creation ([566d6a0](https://github.com/MrVPlusOne/takode/commit/566d6a0ed92940943f2c9c9cdd268ad998f526bd))
* **hosts:** tell leaders when a remote host goes silent and hold its sessions' input ([178dabc](https://github.com/MrVPlusOne/takode/commit/178dabcf65c4cf28dc047a5efc55650d15c983be))
* **image-viewer:** hide a chat's full-screen viewer while the chat is kept hidden ([917ccf1](https://github.com/MrVPlusOne/takode/commit/917ccf1176f4512c1aac0e334abacf962ed0a687))
* **image-viewer:** open the server's copy when a kept chat's local preview was revoked ([0adb9d8](https://github.com/MrVPlusOne/takode/commit/0adb9d86bdf594d60706b43651d3792f9c13e17a))
* **images:** send the original when the full-view copy is not ready, and share encodes ([94273fd](https://github.com/MrVPlusOne/takode/commit/94273fd81bb633e8cf76b6857f379b5880f2e28e))
* **instructions:** ask the user right away when work waits on an action only they can take ([369f7ed](https://github.com/MrVPlusOne/takode/commit/369f7ed41da3364070fa7bec4036984e4691ece6))
* **instructions:** explain decision options only when their label leaves the meaning unclear ([a3ca42d](https://github.com/MrVPlusOne/takode/commit/a3ca42d1ff7d3de8cb739edfb92b34f35ea81ad0))
* **instructions:** keep agent-invented precautions out of requirements, and give Codex judgment guidance ([9dbad08](https://github.com/MrVPlusOne/takode/commit/9dbad0801e3c327ada9713eed2f0d590b3fa93d5))
* **landing:** compare Vitest unhandled errors with the baseline like failing tests ([56cff67](https://github.com/MrVPlusOne/takode/commit/56cff675475e94eeacbfb9827e202d1a6bb281ed))
* **launch:** don't pass a parent Claude session's login to launched agents ([5193e26](https://github.com/MrVPlusOne/takode/commit/5193e26e047f51367b1fb69b33a806b54c6e69dd))
* **leader-threads:** keep Main reachable with browser back and forward ([25d2fd4](https://github.com/MrVPlusOne/takode/commit/25d2fd4f71714232fc5a2ffb534c9a4adee7f4f4))
* **leader:** keep the user coverage of stored answers that also named timer firings ([5623591](https://github.com/MrVPlusOne/takode/commit/5623591738e7409566d297248df070a84cd1be82))
* **library,leader:** read skipped Library captures once; check a queued message with the turn that answers it ([da25553](https://github.com/MrVPlusOne/takode/commit/da255531c6ee65847905c7d07bb79a95e2594235))
* **library:** a quest tab names its topic at once, and the Done list's topics follow activity ([997111c](https://github.com/MrVPlusOne/takode/commit/997111c76e7a1f06d995974bba67a81e44f0039b))
* **library:** a topic conversation catches up after the phone comes back ([ea37696](https://github.com/MrVPlusOne/takode/commit/ea376969f3f33a4c58a8721516434b369021fe70))
* **library:** capture a message whose text arrives after its thinking was read ([726de0a](https://github.com/MrVPlusOne/takode/commit/726de0ab32823207b8176d6d821c4605e38ebdc2))
* **library:** collapse earlier copies of a version sent again; Library link inside the card ([77d31f2](https://github.com/MrVPlusOne/takode/commit/77d31f21b59a04a982155a75ebc14193f6ad4777))
* **library:** count a Scribe's work from the request, and clear its stopped state once it finishes ([c060db1](https://github.com/MrVPlusOne/takode/commit/c060db1996c15c353e6c90cc526033a9292911ac))
* **library:** deliver Scribe requests after a restart and retry interrupted turns ([69abadf](https://github.com/MrVPlusOne/takode/commit/69abadf2b06fd2adc5dfa71fd8e33b52d6995817))
* **library:** embedded images open in the image viewer; quieter topic changes and a settings gear ([8845e14](https://github.com/MrVPlusOne/takode/commit/8845e14e66d9fd8440b74f5784023ca8c37a482d))
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
* **links:** render iCloud and spaced file paths as links; add macOS places to the folder picker ([8952a90](https://github.com/MrVPlusOne/takode/commit/8952a90c7123b7cffc51e8f2316784af027b7319))
* **long-press:** ignore the lift after a long-press anywhere on the page ([3376528](https://github.com/MrVPlusOne/takode/commit/3376528c509b6f94088facfb2b782ddad1c0a0c3))
* **markdown:** no empty lines between blocks in the Slack copy ([78f1ab9](https://github.com/MrVPlusOne/takode/commit/78f1ab9fdc8289231cb2081e2ac377bf42f21530))
* **memory:** refuse a note save that would undo a newer edit ([0753ffc](https://github.com/MrVPlusOne/takode/commit/0753ffc314ab907e82b2e8b80027f57dadf30706))
* **mobile:** keep iOS from leaving its status-bar blur over the top bar ([74c916d](https://github.com/MrVPlusOne/takode/commit/74c916dbafe2a02a70ea4029f3139229390ef529))
* **new-session:** keep the folder on the selected machine ([8fc1a74](https://github.com/MrVPlusOne/takode/commit/8fc1a740e914762d95d501cd47f556344ca69afe))
* **new-session:** offer the backends the selected machine has ([ece9e25](https://github.com/MrVPlusOne/takode/commit/ece9e25846f5c10f5f3747fc836dee806e273ede))
* **notifications:** keep needs-input answer drafts across feed updates ([ca663ff](https://github.com/MrVPlusOne/takode/commit/ca663ff82bcf7bf180afa2d2ebdb50fc0b235368))
* **notifications:** number multi-question needs-input answers once and keep multi-line answers inside their item ([84b6844](https://github.com/MrVPlusOne/takode/commit/84b6844539b85348b6a675a6b2fddcc9d6941b82))
* **notifications:** preview answers and reports as plain text ([5ff4c79](https://github.com/MrVPlusOne/takode/commit/5ff4c79a4ac2b32b91f7952f1de575869eb4f54e))
* **notifications:** show a needs-input card wherever its context answer is shown ([491bf9d](https://github.com/MrVPlusOne/takode/commit/491bf9d9fa860c8e8fadee97f7dfd30d03bd005e))
* **phone-alerts:** open the exact leader tab an alert came from ([9bc7364](https://github.com/MrVPlusOne/takode/commit/9bc73644cf6969e28e412bdb1cf1a421027598ce))
* **quest-delivery:** read a direct checkout's branch from Git when its session records none ([b99833e](https://github.com/MrVPlusOne/takode/commit/b99833e0e745217a3d36c78e1650b88c9aa05539))
* **quest-forks:** show Continued in as soon as a request is handed off to its quest ([92da1ae](https://github.com/MrVPlusOne/takode/commit/92da1ae66fd8e2b7b9e562318f5f6c466e895e90))
* **quest-preview:** open a cached quest preview at once and refresh it in place ([02d57f6](https://github.com/MrVPlusOne/takode/commit/02d57f6d7be44de9d3a6dbba7486561fe3840a90))
* **quest-preview:** show basic information for quests without a TLDR and label cancelled quests ([5b2ec67](https://github.com/MrVPlusOne/takode/commit/5b2ec67fd1adde35ace9c7a5e43dc4cd7ae8f9c6))
* **quest-strip:** keep the close button at the top right as the strip wraps ([2d3d490](https://github.com/MrVPlusOne/takode/commit/2d3d490bf87ea2d3552d50579d30913076ae8a63))
* **quest-strip:** the Notify icon sits right before the phase pill, on the strip's line ([b9b0bf2](https://github.com/MrVPlusOne/takode/commit/b9b0bf2db63988b70123244ba2b7c62137031db7))
* **quests:** find the leader of a dispatched quest before its worker claims it ([8c0a6b3](https://github.com/MrVPlusOne/takode/commit/8c0a6b386ca94523f061585d33dbeb36aad682d7))
* **quests:** show the same status and section labels in the quest preview and quest view ([e1aba40](https://github.com/MrVPlusOne/takode/commit/e1aba40cf6e3a7ebd914d57f376d74413b55787e))
* **quests:** tidier inline quest links, with no preview eye on touch phones ([b6182ad](https://github.com/MrVPlusOne/takode/commit/b6182ad6667e954c8b4173387ae9d2f92eaed07f))
* **remote-host:** point prepared Codex leaders' TAKODE_API_PORT at the host's API proxy ([a37104c](https://github.com/MrVPlusOne/takode/commit/a37104c4159e324121e0d65bf94751eb8c83f875))
* **replay:** keep notification and attention-record copies out of session replay buffers ([4fd47b5](https://github.com/MrVPlusOne/takode/commit/4fd47b51085d0d36799f8c210b95696e58ed3a31))
* **replay:** keep work-board copies out of session replay buffers ([874cec9](https://github.com/MrVPlusOne/takode/commit/874cec949a55a456e2b3d0b168799aee008a4375))
* **restart:** restore pulling the latest published code or stopping with a reason ([f57a677](https://github.com/MrVPlusOne/takode/commit/f57a6775e6396f35f9adb4032f11d9ab96675544))
* **restart:** tell resumed sessions Takode interrupted them, not the user ([b462a2e](https://github.com/MrVPlusOne/takode/commit/b462a2eb0341eb03c7a52ba5e8fb7eb56d2bce09))
* **review:** close a guided review when a link inside it opens a session or message ([8426ee6](https://github.com/MrVPlusOne/takode/commit/8426ee6ec62c4125fdc18c71d108e39ec8e288de))
* **search:** arrow keys step from the row shown as selected while new results settle ([f35418c](https://github.com/MrVPlusOne/takode/commit/f35418cfbd4f19a09c1f5e9557e60de779aaefd5))
* **search:** rank message matches by phrase, then newest, and search comment text ([9634b0f](https://github.com/MrVPlusOne/takode/commit/9634b0f4d1a9d530914ff6208f9c09ca8af2fe6f))
* **selection-menu:** keep the phone menu clear of iOS's edit menu and let a tap on Copy show its formats ([c7a7714](https://github.com/MrVPlusOne/takode/commit/c7a7714d12a8f45b26c47fa62d5c0f73a8c45d33))
* **server:** bound the accepted-work shutdown wait so restarts always finish ([4565ce1](https://github.com/MrVPlusOne/takode/commit/4565ce133ea0269d2d54dd0a07ac8400ddde8577))
* **server:** capture the login-shell PATH for sessions ([4c4ba9b](https://github.com/MrVPlusOne/takode/commit/4c4ba9b4c37dce1ad441f91a350133a8cf47b569))
* **server:** name the host of a session launch in shutdown logs ([48673e4](https://github.com/MrVPlusOne/takode/commit/48673e4e3498925e7585fc7e55ddb0d031f12414))
* **server:** restore capturing the login-shell PATH for sessions ([53e65f0](https://github.com/MrVPlusOne/takode/commit/53e65f0b24a157e0c793eb5ebd6582fdbe27da77))
* **server:** restore naming the host of a session launch in shutdown logs ([6feb24f](https://github.com/MrVPlusOne/takode/commit/6feb24fc113347d67691155fe729f5f7997ec77a))
* **server:** restore the bounded accepted-work shutdown wait ([ac83343](https://github.com/MrVPlusOne/takode/commit/ac8334392b30ce388a646a4f91accf56b2752fb9))
* **server:** send gzipped API answers whole so proxies on HTTP/1.0 get valid bodies ([e85d3de](https://github.com/MrVPlusOne/takode/commit/e85d3dea30aa1f57131107b788f085f956854380))
* **session-info:** close the session info panel when its title is tapped again ([93cdb8e](https://github.com/MrVPlusOne/takode/commit/93cdb8e87cacb302b3e2a604807ebedc6ffa6413))
* **session-store:** guard save cost against whole-history regressions ([460cb4c](https://github.com/MrVPlusOne/takode/commit/460cb4c28cb0c6e28f49391461e999500c395ce3))
* **session-store:** stop re-hashing saved frozen history on every save ([9c6f8f8](https://github.com/MrVPlusOne/takode/commit/9c6f8f85def7c793a94d724b3c57dd9b63d63990))
* **session:** a fresh Claude process no longer inherits a failed resume's open window ([cbc8fb7](https://github.com/MrVPlusOne/takode/commit/cbc8fb7607cda857a5b63643e9513228cef66ece))
* **sessions:** give every session new instructions after a restart ([ee8b23a](https://github.com/MrVPlusOne/takode/commit/ee8b23a18e276801c67517daad578856d9838dca))
* **sessions:** skip server records in the sessions folder when loading sessions ([f5472ff](https://github.com/MrVPlusOne/takode/commit/f5472ffa963b6508978cd91091c85969df925940))
* **shortcuts:** make Off actually turn a preset shortcut off and show it as off ([67b88ba](https://github.com/MrVPlusOne/takode/commit/67b88bac760192e7bb5b69e9793e12c8cbd775e5))
* **shortcuts:** save Next Item Needing Attention overrides and explain refused recordings ([69b552e](https://github.com/MrVPlusOne/takode/commit/69b552e921075d9fdfe473c7abc3156cb7547756))
* **sidebar:** change a leader's portrait only from Session Info ([6a864af](https://github.com/MrVPlusOne/takode/commit/6a864af0609647c23b81018e12c75709d5fc777d))
* **sidebar:** make the portrait timer badge smaller and hug the clock ([e17522a](https://github.com/MrVPlusOne/takode/commit/e17522a41f172ddb636cf3cae600a397d6cb1538))
* **sidebar:** stop double-click from renaming sessions ([f7c4bbe](https://github.com/MrVPlusOne/takode/commit/f7c4bbe292757fa9e9ce13435231a3639b9ba711))
* **sidebar:** switching sessions no longer focuses and expands the composer ([2785bea](https://github.com/MrVPlusOne/takode/commit/2785bea3700ffe2849c8050d09852f03aa6b6e9b))
* **skills:** keep Takode development skills out of the global skill folders ([f61ce4a](https://github.com/MrVPlusOne/takode/commit/f61ce4a1cff61a257f3e7719788d517d2c4f674b))
* start Takode commands outside the caller's directory so crowded folders can't slow them ([33537d5](https://github.com/MrVPlusOne/takode/commit/33537d54875e0eec9370c890c33fbfc47c2c545a))
* **tabs:** a tap on a group with several tabs only opens its list ([cd941ec](https://github.com/MrVPlusOne/takode/commit/cd941ec6b788086f03f651bd2e9fc5f98ec09254))
* **tabs:** glide a tab opened from New results into the group it moves to ([426f75a](https://github.com/MrVPlusOne/takode/commit/426f75aede1224f8e7f5c5344856f1daf44a2f38))
* **tabs:** keep Main out of the thread tab groups ([af32a9b](https://github.com/MrVPlusOne/takode/commit/af32a9b7b367b752ac6ca8e8cb6866e739504f0a))
* **tabs:** move the tab on screen straight to its new group, with a glide ([a9d23dd](https://github.com/MrVPlusOne/takode/commit/a9d23dd98ef0e725d77f29d7c74967be7a477d2f))
* **tabs:** one tab spins, and only for writing that isn't on screen ([cda6c63](https://github.com/MrVPlusOne/takode/commit/cda6c6343e6c37a4252ecedfa5463db09d73e147))
* **tabs:** open the only tab of a phone tab group in one tap ([4cc8543](https://github.com/MrVPlusOne/takode/commit/4cc8543642948264bcfebdb1a75e87c80ce052c5))
* **takode:** recognize Work dispatches in leader-context-resume ([6c2e030](https://github.com/MrVPlusOne/takode/commit/6c2e0304354b8bdd7943f72bbe4c8910c6632f70))
* **terminal:** offer Paste on a touch long-press over the terminal ([22c51b9](https://github.com/MrVPlusOne/takode/commit/22c51b97c333ea8c96833465baed65a98ed8ed57))
* **test:** keep the Takode session environment out of test runs ([34cbb6e](https://github.com/MrVPlusOne/takode/commit/34cbb6e1eb814e8e6c89e6dea16ec3e3fe978318))
* **threads:** keep a leader's live view on the thread it shows ([1ad4c44](https://github.com/MrVPlusOne/takode/commit/1ad4c4480d29d55001a454ed18aa9d622facc08f))
* **threads:** keep the state and time readable in Find's Recent rows ([f80c394](https://github.com/MrVPlusOne/takode/commit/f80c394cdd957eeb028b3611fcf792c5626fc36a))
* **threads:** read a thread's result only after it has really been on screen ([bdd0617](https://github.com/MrVPlusOne/takode/commit/bdd06175264e0adb59ef4e65f90de0230fcc22ff))
* **threads:** turning on Notify Me for a side quest no longer surfaces its old Ready marker ([7251299](https://github.com/MrVPlusOne/takode/commit/7251299a63f7985a03f439ec28f0522868162865))
* **timers:** keep the timer chip visible above the expanded desktop composer ([afbabba](https://github.com/MrVPlusOne/takode/commit/afbabba77d86037036b5e605344554d6c694c292))
* **todos:** follow the send-key setting when adding and editing to-dos ([6f6683d](https://github.com/MrVPlusOne/takode/commit/6f6683d848a310659d2e06ef822d265ef722fa86))
* **todos:** keep the to-do editor focused while the list refreshes ([36cb893](https://github.com/MrVPlusOne/takode/commit/36cb893945a0a786cddbaf72d756baddc0c8d7ca))
* **todos:** keep the to-do sheet's layout when it is completed ([19d922a](https://github.com/MrVPlusOne/takode/commit/19d922ae0582184e5b4679027377fa7e47dc13f7))
* **todos:** no-op to-do changes record nothing, and overdue alerts don't repeat after a start ([dc7a9e1](https://github.com/MrVPlusOne/takode/commit/dc7a9e1f0ad3b08d530cf282fe8d244d2b17d883))
* **topics:** a quest's strip starts where the conversation moves to it, also mid-turn ([1a3348c](https://github.com/MrVPlusOne/takode/commit/1a3348c1fd3d18c55819f2c4a24a40eda59e9ede))
* **topics:** no empty band above a pinned quest strip ([90d643d](https://github.com/MrVPlusOne/takode/commit/90d643d1442a74e2b6a2bc3ab9e69cd5ba4afecb))
* **topics:** quest strips only above final messages in topic conversations ([949fc03](https://github.com/MrVPlusOne/takode/commit/949fc03b6e4bf582ddd06dd6f6d67e145ee75ba6))
* **topics:** the Topics bell rings only for what its list marks ([d0a085a](https://github.com/MrVPlusOne/takode/commit/d0a085a81abae2592a15ae08121a6a4a6c7406a4))
* **topics:** warn when leader output names a topic that doesn't exist ([30d7b92](https://github.com/MrVPlusOne/takode/commit/30d7b92b9bad24cc9aba24df6a99f1c4755d4bf2))
* **touch:** a second tap closes menus and popovers opened by a tap ([3d0a5f0](https://github.com/MrVPlusOne/takode/commit/3d0a5f04810d8f54c2726c5f0cc4494228f251ed))
* **ui:** judge a backdrop press whose release was not seen by where it began ([c5beae0](https://github.com/MrVPlusOne/takode/commit/c5beae08ffff6847b8ce15e919977bd273eea172))
* **ui:** keep dialogs open when a text selection or drag ends on their backdrop ([2220813](https://github.com/MrVPlusOne/takode/commit/2220813d8932ba10948ed3553d939967231220f7))
* **ui:** keep the secondary view overlay from making the whole app scrollable ([82fbfb3](https://github.com/MrVPlusOne/takode/commit/82fbfb3c2330c0e6941af3b0d29b23a355366ecf))
* **ui:** show the work board count as plain text in the Board button ([140c415](https://github.com/MrVPlusOne/takode/commit/140c4156c0a1f5fc11d040ff1f92d8320b793c26))
* **user-content:** land Set up on the section and show machines before their previews arrive ([d78b19d](https://github.com/MrVPlusOne/takode/commit/d78b19d87fb6a9519f67d9cdc15bb99fc0ef6929))
* **visuals:** a cold Chrome start no longer counts against a visual's render time limit ([c7279e9](https://github.com/MrVPlusOne/takode/commit/c7279e9c17214b37ea510d7e7ebb14356fe8f312))
* **visuals:** scroll through visuals without blanks or redraws ([bd68db2](https://github.com/MrVPlusOne/takode/commit/bd68db2834c17576bcf3bdc9d25d8289ae503da9))
* **voice:** keep finished transcriptions for their draft until a browser applies them ([1d7dc84](https://github.com/MrVPlusOne/takode/commit/1d7dc843037dbf031c4920effdf771b795179907))
* **voice:** keep the screen awake while recording voice input ([ad5e9ff](https://github.com/MrVPlusOne/takode/commit/ad5e9ffcb260f69a5a24f669484031893eb48cab))
* **voice:** move the transcription tag to the end when appending after it ([26b8491](https://github.com/MrVPlusOne/takode/commit/26b84913084bf388c7f94615ff96e3d20c47bb34))
* **voice:** record the mic directly in WebKit so AirPods recordings are not near-silent ([2274e21](https://github.com/MrVPlusOne/takode/commit/2274e2100487c83b62bdc7db8275dbc7ba6e0fe9))
* **voice:** remember the mode chosen by a voice rerun for the next voice input ([212bf3b](https://github.com/MrVPlusOne/takode/commit/212bf3b6552f99208eacf32669b651e1a3cc3364))
* **voice:** restart the level meter when Safari stops its audio context mid-recording ([09bdc2a](https://github.com/MrVPlusOne/takode/commit/09bdc2a7379d939cbdc158d11a935562726373d7))
* **worktrees:** recreate a vanished checkout recorded through a symlinked path ([6b724a4](https://github.com/MrVPlusOne/takode/commit/6b724a47873092c7c7e0ee30ef920fbda3cc732e))
* **ws:** wait for the page to be on screen before reconnecting ([43df7f5](https://github.com/MrVPlusOne/takode/commit/43df7f55731a88640614d47b1913fe48b3d7852f))


### Performance Improvements

* **activity:** read archived sessions' activity from records saved at archive time ([9770980](https://github.com/MrVPlusOne/takode/commit/977098042520fba9665da3b14c64e29ab7a4b7ec))
* **activity:** read only the recent part of each history; keep transcription activity fresh ([8a59553](https://github.com/MrVPlusOne/takode/commit/8a59553c0840c85f9238a7f72ebd0b5fac25b6e1))
* **app:** load rarely used pages on first use ([daf1277](https://github.com/MrVPlusOne/takode/commit/daf1277f3230e974220bacea815b808cc6526151))
* **browser:** compress large browser WebSocket messages ([fef1d9c](https://github.com/MrVPlusOne/takode/commit/fef1d9c4779c5a3441c6f428d7d604deb6144a20))
* **feed:** refetch the navigation index only when a navigable user message arrives ([7a087bf](https://github.com/MrVPlusOne/takode/commit/7a087bf279fac7bf566aea7e2254e178e79b9163))
* **feed:** show a jumped-to message and its surroundings first ([398da00](https://github.com/MrVPlusOne/takode/commit/398da002aaaa0fc10d8bb3c5c2e629bbcf6f196b))
* **feed:** stop redrawing the app and every message row on other sessions' updates ([fe21c2f](https://github.com/MrVPlusOne/takode/commit/fe21c2f8bdae57110f92d3da91328a28576ef433))
* **feed:** stop redrawing user bubbles and the whole feed on each new message ([e2411a4](https://github.com/MrVPlusOne/takode/commit/e2411a4d19124ebf0a4f9b5c1979cf2096844e9a))
* **hosts:** compress the host link and agent CLI answers ([cbf77ad](https://github.com/MrVPlusOne/takode/commit/cbf77ad36fb0c4178bf2db48a3b1ecafe8e21b61))
* **images:** fast WebP settings and prepared chat images ([47de3b8](https://github.com/MrVPlusOne/takode/commit/47de3b814e3e6878fc51ac357e10d15cf8da1098))
* **images:** make model copies with fast lossless WebP ([a57659a](https://github.com/MrVPlusOne/takode/commit/a57659a82c27a812d07f2e2efcf86c98943ef7e3))
* **reconnect:** send reconnect state as changes from what the browser holds ([b88076c](https://github.com/MrVPlusOne/takode/commit/b88076cccea932021d7dbfc5156dd08db9d75f52))
* **serve:** let browsers keep content-hashed build assets ([11a4adf](https://github.com/MrVPlusOne/takode/commit/11a4adfae13470223de558f969caa64a2bfaa3dd))
* **server:** stop whole-history and whole-store serialization from blocking the server ([9bcd5b5](https://github.com/MrVPlusOne/takode/commit/9bcd5b5dd6cff90b194d22496028aa4690973b0b))
* **sidebar:** skip unchanged session-list polls with a socket-independent ETag ([e6f1d70](https://github.com/MrVPlusOne/takode/commit/e6f1d70067fa7a98247a34e17a4173505d3071b4))
* **switch:** cut bytes and round trips when switching sessions over a slow link ([51ffcf9](https://github.com/MrVPlusOne/takode/commit/51ffcf9915c147295a78d5ff3f77b720e24b2d43))
* **switch:** make revisiting a session instant from what the browser holds ([6e1eb17](https://github.com/MrVPlusOne/takode/commit/6e1eb175d9e7fb4d4435e246710a6084c0c43add))
* **switch:** reuse the browser socket across session switches and push scroll-position handoff state ([381c14c](https://github.com/MrVPlusOne/takode/commit/381c14cc20a699a0ebcf8c1cb258c3653e81b9aa))
* **threads:** build a topic window in one pass over the history, not one per quest ([3ac41c6](https://github.com/MrVPlusOne/takode/commit/3ac41c644357427c9e70df180fa840337d28969e))
* **threads:** read a leader's answers once per request, not once per quest ([90c984e](https://github.com/MrVPlusOne/takode/commit/90c984e06720a8176005c016b554b2a133464bb3))
* **threads:** stop re-reading every message's routing and answer text on each leader change ([aa6eb40](https://github.com/MrVPlusOne/takode/commit/aa6eb40544837eb6f3f2449503894e3639cf1379))
* **threads:** work out each message's threads once, in one shared module ([d7b0a5b](https://github.com/MrVPlusOne/takode/commit/d7b0a5b3cf107b658002a1daad9a180a358091ef))
* **traffic:** send list changes instead of whole notification, attention and tree-group lists ([408ad4e](https://github.com/MrVPlusOne/takode/commit/408ad4e082ac999a2d0b5b2c6f67880d60cb12ce))
* **traffic:** stop re-sending unchanged session lists and completed boards ([e6ebbf4](https://github.com/MrVPlusOne/takode/commit/e6ebbf42e44738fcb61515bf60dd5633bf3dad5b))

## 2026-10-28

### Added

- **Folding the desktop sessions panel** -- A lock button beside "Search everything" unlocks the desktop sessions panel. Unlocked, it folds up to its top row in the top bar's line, so the conversation gets the full width, and drops down over the chat when the mouse rests on that row. A tap toggles it on a touch screen.
- **Exporting reports** -- A report card's More menu holds Open in Library, Copy Markdown and Export as Markdown, PDF, image or web page; PDFs and images are drawn by the server from a clean light page of the report. Drafts and visuals keep their Library link, source and exports in the same menu.
- **Copied drafts** -- Copy for Slack dims the button of each part already copied, on every device and after reloads, and a new version keeps that mark only for parts that did not change.

### Changed

- **Leader tabs in the top bar on desktop** -- A desktop leader with topics on has no separate tab row: Main, All and Topics sit in the top bar after the session name, and the Next chip and a Working on menu (which now also opens the work board) sit before the attention bell. The model and access line moves to the session name's tooltip.
- **One-line quest strip** -- A leader's quest strip shows the topic, quest and title, the Notify Me icon, the phase pill and the close button on one line. Worker, reviewer and commits move into the phase pill's card, where a quest's recorded commits and its worker's uncommitted changes are separate chips that open their part of the diff. Notify Me also sits beside Open Thread in the quest preview and quest view, and the quest view counts memory commits apart.

### Fixed

- **Opening unread results** -- Next and the attention lists open a topic's first unread answer, and a Notify Me result opens at the answer it reports, never at the commentary around it. The Topics tab's bell lights only for what its list marks.
- **Quest strips in topic conversations** -- A topic conversation shows a quest's strip only above a turn with a final message (your message, an answer, a report or a question); a run of working steps from another quest gets a small quest label instead.
- **Top-bar navigation after switching leaders** -- Desktop leaders' top-bar controls no longer show twice after switching to another leader and back.

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
