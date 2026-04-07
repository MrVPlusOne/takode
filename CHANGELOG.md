# Takode Changelog

## [0.47.0](https://github.com/MrVPlusOne/companion/compare/the-companion-v0.46.0...the-companion-v0.47.0) (2026-04-07)


### Features

* add Tailscale HTTPS helper script ([74e4755](https://github.com/MrVPlusOne/companion/commit/74e47554e0fd977cc1ec3aa2957071e3b1f8e50d))
* **board:** add Wait For column to BoardBlock UI and fix CLI ambiguity (q-90) ([f57e9ac](https://github.com/MrVPlusOne/companion/commit/f57e9ac4bf00a2d5b3375e3daf8612f15cd85d48))
* **board:** persistent work board widget at bottom of leader session UI (q-105) ([d79c2bc](https://github.com/MrVPlusOne/companion/commit/d79c2bccfb1f1ea4f9032a48f7313080fb1a3557))
* **board:** stable sort, operation title, and auto-collapse for work board (q-99) ([4f42ce6](https://github.com/MrVPlusOne/companion/commit/4f42ce666233993b7db9deb1485aa8eacbc069ed))
* **bridge:** add [User HH:MM] timestamp tags to all CLI-bound user messages ([ae9ce94](https://github.com/MrVPlusOne/companion/commit/ae9ce94dbf6c296b58cf6560afeb6ff58ca2d45e))
* **bridge:** re-inject leader system prompt after compaction (q-138) ([d4598b5](https://github.com/MrVPlusOne/companion/commit/d4598b53187a196745880c114453a26ff87545df))
* **bridge:** use [Leader HH:MM] tag for herded worker messages from leader ([eea169e](https://github.com/MrVPlusOne/companion/commit/eea169e0f53a8ae29835d90ae37ba815f13396f0))
* **chat:** add codex terminal chips ([4fe4a31](https://github.com/MrVPlusOne/companion/commit/4fe4a316463a65be4c980d73fa847a49f84b52f2))
* **chat:** add horizontal live activity rail ([4a66297](https://github.com/MrVPlusOne/companion/commit/4a66297a0df7c152982eba3ff380a51b34abe3c9))
* **chat:** add reply-to-message button for assistant messages ([3c5a548](https://github.com/MrVPlusOne/companion/commit/3c5a548b517f8c6a165955ddccbe6f84c1397840))
* **chat:** add sectioned feed windowing ([b637d70](https://github.com/MrVPlusOne/companion/commit/b637d7080220406ab35fb93b19f6475377b3d40a))
* **chat:** clickable reply chip + grayed composer preview ([85ba8e5](https://github.com/MrVPlusOne/companion/commit/85ba8e5eb5f2c6d6f397ca6e60d8bbdc3e8d045e))
* **chat:** merge latest pill into status rail ([b1f8452](https://github.com/MrVPlusOne/companion/commit/b1f8452c6116f6f4602877b54c06b5c2d539d9e7))
* **chat:** pin sent messages during streaming ([0619199](https://github.com/MrVPlusOne/companion/commit/0619199e97b27532d3208af4d255b6a13801b8e2))
* **chat:** prettier reply-to display with robust delimiter syntax ([0459786](https://github.com/MrVPlusOne/companion/commit/0459786034179bd6ffb818d8b02dbc60284ab37c))
* **chat:** render notification markers on anchored assistant messages ([a8ec604](https://github.com/MrVPlusOne/companion/commit/a8ec604ee34861a7d60f3442be34bf37bff943e3))
* **chat:** restore latest indicator rail ([aaff969](https://github.com/MrVPlusOne/companion/commit/aaff969590ca926156e5a09fbe4924c82b0b7743))
* **codex:** add mention picker and resume UI ([d579bc5](https://github.com/MrVPlusOne/companion/commit/d579bc5d8e24a11a6e24dbb271bf712d53609c48))
* **codex:** enable native multi-agent sessions ([626058d](https://github.com/MrVPlusOne/companion/commit/626058d1e3c422aa818ffe1f3a8fa2543cee6d35))
* **codex:** redesign steering delivery flow ([87a490e](https://github.com/MrVPlusOne/companion/commit/87a490e307a8006e7a3d82d34b0befb548c673b7))
* **composer:** add @ file mention system with autocomplete ([6df128b](https://github.com/MrVPlusOne/companion/commit/6df128b158ec7c72467bee6f4a3199b6426a2e51))
* **composer:** add reversible voice edit flow ([de88999](https://github.com/MrVPlusOne/companion/commit/de8899925abf024d36e315ce3f59542b074d8692))
* **composer:** add voice input mode toggle (edit/append) ([e691483](https://github.com/MrVPlusOne/companion/commit/e691483e49e03398f675a4780f58c4dd24b30c81))
* **composer:** attach dropped images in chat ([0fef0c9](https://github.com/MrVPlusOne/companion/commit/0fef0c90cb824e47d668f31322267557a5298fb3))
* **composer:** fetch full model list with context length variants ([a2985db](https://github.com/MrVPlusOne/companion/commit/a2985db7e7e46ba5e036149ba420e77fdc74c14d))
* **composer:** persist voice input mode preference server-side ([dad2b51](https://github.com/MrVPlusOne/companion/commit/dad2b519f6b4802d3e4b98043100419b53b4aae8))
* **debug:** add [revert] debug logging to revert flow ([19c93b8](https://github.com/MrVPlusOne/companion/commit/19c93b8b1fe2a994a5ababa450948f455220f792))
* **diff:** add syntax-highlighted expandable hunks ([e8be38c](https://github.com/MrVPlusOne/companion/commit/e8be38c26922056c092f31dbe494a930ec71e47f))
* **diff:** cross-session branch invalidation + takode branch command ([8bdada9](https://github.com/MrVPlusOne/companion/commit/8bdada93006eb7777403c40143bb82f88026b876))
* **feed:** collapse consecutive herd events into expandable batch group ([827778e](https://github.com/MrVPlusOne/companion/commit/827778ecc9a0f9f16c225c5c863e27c47dc08eba))
* **launcher:** explain message source tags in system prompt ([8e85f74](https://github.com/MrVPlusOne/companion/commit/8e85f74d15a07c9787f85822b0b84427cff447d6))
* **launcher:** inject COMPANION_SESSION_NUMBER env var into CLI sessions ([ce6e2f9](https://github.com/MrVPlusOne/companion/commit/ce6e2f9e05087c1604f498edb94e1baf4354ff02))
* **markdown:** support repo-relative file links ([4df9efe](https://github.com/MrVPlusOne/companion/commit/4df9efeb1b46db6876b53fc5673649626a693da8))
* **models:** dynamic model discovery from LiteLLM proxy ([0543543](https://github.com/MrVPlusOne/companion/commit/0543543cf9cadc30227db0ffb40fcfdc554da416))
* **models:** update codex model selector for gpt-5.4 ([7b0d054](https://github.com/MrVPlusOne/companion/commit/7b0d0547e9089d4cff8b5b7e510c82d43e6b8d35))
* **orchestration:** add leader discipline rules to injected system prompt ([9455c01](https://github.com/MrVPlusOne/companion/commit/9455c01f2ae6427a3920296fa3ccdc09a5c6c270))
* **orchestration:** add plan-before-execute, /groom self-review, and herd management to leader prompt ([1bd6532](https://github.com/MrVPlusOne/companion/commit/1bd653286cd9a5c8f60e1ef4dcfb0e249265a03e))
* **orchestration:** add source conversation reference rule to leader discipline ([0b0c398](https://github.com/MrVPlusOne/companion/commit/0b0c398e87e3eb98ca2b90602c5ee63b88e8ea73))
* **orchestration:** include msg_index in takode pending output ([1fe6b94](https://github.com/MrVPlusOne/companion/commit/1fe6b94b14d9c389caf218a53fa084c113396f65))
* **orchestration:** replace [@to](https://github.com/to) tags with takode notify command ([0da8551](https://github.com/MrVPlusOne/companion/commit/0da8551ce3863e8adc12a7637f3c3de66511f5f1))
* **orchestrator:** add dispatch rules for duplication prevention and groom triggers ([60040c9](https://github.com/MrVPlusOne/companion/commit/60040c9937e5fad0aca7fd73b0665641e6441ad9))
* **permissions:** enable all auto-approval tiers for Codex sessions ([fe53889](https://github.com/MrVPlusOne/companion/commit/fe538899c36a1ffd7a86b1272141298ffa33c59c))
* **permissions:** settings.json rule matching for SDK sessions ([23e120b](https://github.com/MrVPlusOne/companion/commit/23e120b243cc407c905eeabc67ce2d535874017d))
* **quest-cli:** add image flags to quest create ([1a97bd4](https://github.com/MrVPlusOne/companion/commit/1a97bd43c3674999d345403fd5f7e7882485dcc9))
* **quest:** add resize-image command for oversized screenshots ([9b1c454](https://github.com/MrVPlusOne/companion/commit/9b1c4540afce5505588482fec0f9ff3e4a1c49b0))
* **quest:** prevent leader sessions from claiming quests (q-87) ([70dc1f1](https://github.com/MrVPlusOne/companion/commit/70dc1f1f98f3d50e841cfa6fdd01feafa17942e2))
* **quests:** add Cancelled option to quest state dropdown ([be7a2b6](https://github.com/MrVPlusOne/companion/commit/be7a2b66558da5aa344a770c488780a7198399d8))
* **scripts:** support concurrent tailscale prod and dev ([50ec94a](https://github.com/MrVPlusOne/companion/commit/50ec94a44d51124eb1ae5d7d37e74211709d99d1))
* **server:** add sleep inhibitor to prevent macOS sleep during generation ([820aba1](https://github.com/MrVPlusOne/companion/commit/820aba1eceae946da5bebfc6dcb8a7bf0f792e0d))
* **session-info:** show injected system prompt in Session Info panel ([e4764a1](https://github.com/MrVPlusOne/companion/commit/e4764a1260702ed3de192571649c2e689a8e301d))
* **session:** add transport switch via session context menu ([1610074](https://github.com/MrVPlusOne/companion/commit/1610074ab8905529fb40ff445a3cc80537f69726))
* **session:** discover Codex CLI sessions in resume panel ([dc8f9ec](https://github.com/MrVPlusOne/companion/commit/dc8f9ec119a6f6b6ce6a143120a461808ca6bfe1))
* **session:** support resuming Codex sessions from existing thread ID ([d8f2a0e](https://github.com/MrVPlusOne/companion/commit/d8f2a0e669eb15d393d3dd3e02ce2d437fb32028))
* **settings:** add global defaultClaudeBackend setting (WebSocket/SDK) ([5bf52fe](https://github.com/MrVPlusOne/companion/commit/5bf52fe0413f0e4173de3e750771844218fd59f7))
* **settings:** add live caffeinate status timer ([2168acc](https://github.com/MrVPlusOne/companion/commit/2168acc4ed1b1117e835ffedf9ccfd93308799b6))
* **settings:** persist heavy repo mode ([cd88bd2](https://github.com/MrVPlusOne/companion/commit/cd88bd2ee2f2a66c7a88aa1ebd1997ab488b2744))
* **sidebar:** add per-group session presets ([edf579b](https://github.com/MrVPlusOne/companion/commit/edf579b8f7d17478369b0ad93b110fd584595dfc))
* **sidebar:** add sort-by-last-activity toggle (q-124) ([6f6a303](https://github.com/MrVPlusOne/companion/commit/6f6a3039f1548512122184e1ee3b228e5890352d))
* **sidebar:** colorize herd group badges ([697b192](https://github.com/MrVPlusOne/companion/commit/697b192ff49c2ea3e5a9ca93342ce5a0a37255fb))
* **sidebar:** show reviewer sessions as inline badge on parent row (q-104) ([2feea1d](https://github.com/MrVPlusOne/companion/commit/2feea1d148994028105db723ef6259e80f78b39b))
* **skeptic-review:** use temporary reviewer sessions instead of subagents ([9a602a1](https://github.com/MrVPlusOne/companion/commit/9a602a1346193c093d1806bb9bc02f3f99a67915))
* **skills:** add /skeptic-review skill for adversarial worker verification ([6eaec6b](https://github.com/MrVPlusOne/companion/commit/6eaec6b40a98b040759d3b59ddb3896c674900de))
* **skills:** add cron-scheduling skill with cronafter helper ([cf7095c](https://github.com/MrVPlusOne/companion/commit/cf7095ca933a1f216968590582dbb1adbc408b53))
* **subagents:** add collapsible card sections ([4bff3ce](https://github.com/MrVPlusOne/companion/commit/4bff3cefef2a5df3034b9cc3a82f97da99ad9979))
* **takode:** add --herd flag to list for explicit herded-only filtering (q-95) ([b3ce262](https://github.com/MrVPlusOne/companion/commit/b3ce26270ee10585aa89d3ff7eec46a2f37fe1ff))
* **takode:** add --reviewer flag to takode spawn ([ef73382](https://github.com/MrVPlusOne/companion/commit/ef73382646e40d64ec52c6d027559ea73a3f40ae))
* **takode:** add --show-tools flag to peek for full session audit (q-89) ([7a0b910](https://github.com/MrVPlusOne/companion/commit/7a0b910abc1a9084e523027697fb263fb78e49e7))
* **takode:** add 'info' command for detailed session metadata ([fcdd9df](https://github.com/MrVPlusOne/companion/commit/fcdd9df69498dfb9b6704e8d9074f283d1f9b01e))
* **takode:** add herd check, message referencing, and groom relay rules to leader prompt ([5992eab](https://github.com/MrVPlusOne/companion/commit/5992eab2c2c220f16389012dee282a2165adec14))
* **takode:** add herd size warning after spawn ([9ccd673](https://github.com/MrVPlusOne/companion/commit/9ccd67319242efb266c2d8ede01e82d1a7725539))
* **takode:** add optional summary parameter to notify command (q-131) ([39408cf](https://github.com/MrVPlusOne/companion/commit/39408cf5b18b37d6ff60ec4713ade9598387271c))
* **takode:** add rename command and replace --no-autoname with --fixed-name ([d3063fb](https://github.com/MrVPlusOne/companion/commit/d3063fb489e40fd3962fe6dff505d4e2971be5da))
* **takode:** add scan, grep, export commands and fix numTurns ([585eabc](https://github.com/MrVPlusOne/companion/commit/585eabc60a4d0f5bbee8e9f2fcac41349f526a27))
* **takode:** add stdin support for send ([3983c56](https://github.com/MrVPlusOne/companion/commit/3983c5670d873d7837abcf423c520f8d3814aaac))
* **takode:** add work board CLI tool and frontend rendering ([1d2f302](https://github.com/MrVPlusOne/companion/commit/1d2f302140fca3f0ee76bffdf5f36148eae6705a))
* **takode:** expose base/current branch per session via API and CLI ([c9c38ad](https://github.com/MrVPlusOne/companion/commit/c9c38ade2caa7b9317cce3fbce6327a5ff31b045))
* **takode:** include message ID in permission_request herd events (q-92) ([6462634](https://github.com/MrVPlusOne/companion/commit/6462634ee27e2b40562e7bf0f9fb31ad68b47fba))
* **takode:** install takode-orchestration skill globally at startup ([900bf24](https://github.com/MrVPlusOne/companion/commit/900bf2473a26307a62b4d0ba35142a9f7ccc8a59))
* **takode:** Quest Journey lifecycle with stateful work board ([c51ed22](https://github.com/MrVPlusOne/companion/commit/c51ed221c5a69905b141a4ddcf7813e0f5ba3f23))
* **takode:** reuse codex session info on spawn ([c983510](https://github.com/MrVPlusOne/companion/commit/c9835107eb216d35289f57ca817393f085070d27))
* **takode:** show message ranges on collapsed turns and add --turn flag ([7b122f0](https://github.com/MrVPlusOne/companion/commit/7b122f005523476fb4db8e01aa3d58f55bf741b8))
* **tool:** add open actions for edited files ([702f615](https://github.com/MrVPlusOne/companion/commit/702f615c542ec4f5136869dcf7b97cd30bee451e))
* **traffic:** add browser traffic measurement tools ([756fe6f](https://github.com/MrVPlusOne/companion/commit/756fe6f3b5b5bf071180061c7f0c6953e0fb3696))
* **traffic:** break down history sync payloads ([1a98757](https://github.com/MrVPlusOne/companion/commit/1a98757a0d4ec1e1369d950060721b9bbb59a4e9))
* **traffic:** track lazy tool result fetches ([66388aa](https://github.com/MrVPlusOne/companion/commit/66388aaeaeef5a5bc70e9413f211d9631dce0bcf))
* **transcription:** persist debug logs to JSONL file ([462acfd](https://github.com/MrVPlusOne/companion/commit/462acfd1c8736edc0fa2c216d3957aad7c89b7fb))
* **transcription:** rewrite enhancer prompt for scannable output ([445c3aa](https://github.com/MrVPlusOne/companion/commit/445c3aac58b872da415f5f6fe89677493ecf6b85))
* **transcription:** strengthen STT prompt + add custom vocabulary ([bc5251f](https://github.com/MrVPlusOne/companion/commit/bc5251ff33dc906ca878ef473ea0b5b3eb880b82))
* **ui:** add close button to VS Code selection chip in composer ([8116759](https://github.com/MrVPlusOne/companion/commit/8116759aa964c3b07093da20436d23d330fd8567))
* **ui:** add multi-theme support with Codex Dark theme ([fdeac29](https://github.com/MrVPlusOne/companion/commit/fdeac297e2cbf646e7bfe469ef35064ecc042144))
* **ui:** add status glow to reviewer badge (q-121) ([e5de25f](https://github.com/MrVPlusOne/companion/commit/e5de25f20aa12a352b0a5e560791b404907df189))
* **ui:** add within-session message search with highlighting ([65337e2](https://github.com/MrVPlusOne/companion/commit/65337e2af93a06819c528e79e49e2d1a1c600f2e))
* **ui:** batch consecutive auto-approvals into collapsed group (q-130) ([61e8682](https://github.com/MrVPlusOne/companion/commit/61e8682534ccf6ef1dee4eea49fab3811d24c863))
* **ui:** compact single-line herd event rendering ([daf760b](https://github.com/MrVPlusOne/companion/commit/daf760bb89931c99ae1bb0a97073e7fa5c9ecbaf))
* **ui:** darken dark theme background and add takode notify pills ([d559294](https://github.com/MrVPlusOne/companion/commit/d559294fda170ebb73e98550a48f1439b1ec7cbc))
* **ui:** enhance group session panel, rename orchestrator→leader, reorder branch/worktree ([9b6e52e](https://github.com/MrVPlusOne/companion/commit/9b6e52eab314511cce04ac9eed8165d89ce6c940))
* **ui:** merge Claude backend buttons in new session modal ([327a35d](https://github.com/MrVPlusOne/companion/commit/327a35d06f75d8cc9598cb1ee2dc4c7037a161b3))
* **ui:** show max codex context length ([0b6bee7](https://github.com/MrVPlusOne/companion/commit/0b6bee7d78c42f84e6441c8cc8fcc9bc47672b2b))
* **voice:** add configurable STT model selector in settings ([56ec1f0](https://github.com/MrVPlusOne/companion/commit/56ec1f0a8ea0f25c92823a805357205ade6d8249))
* **voice:** add enhancement tester to Settings page ([ad1535a](https://github.com/MrVPlusOne/companion/commit/ad1535a15ded96a0744b1e5fef8157a1445be9ad))
* **voice:** add prose enhancement mode and improve transcription prompts ([7117385](https://github.com/MrVPlusOne/companion/commit/71173857dbf9ecddf3b932dfb192d14220d89630))
* **voice:** increase STT prompt budget to match enhancer (10k chars) ([cf4748d](https://github.com/MrVPlusOne/companion/commit/cf4748d0f9b8880cf0668ff7f2315df0c7e49769))
* **voice:** save recordings on transcription failure and allow retry (q-108) ([9914464](https://github.com/MrVPlusOne/companion/commit/991446491f37952be81837951786c4020cccdcf5))
* **voice:** single Shift finishes recording, Escape cancels ([0f8ca1b](https://github.com/MrVPlusOne/companion/commit/0f8ca1ba3f2dc82e76453ca8f642c2320e5fd5a1))
* **vscode:** add prod and dev panel commands ([b1d7e9f](https://github.com/MrVPlusOne/companion/commit/b1d7e9f095c2a9a3e6ee683942c57d99c6662f15))
* **vscode:** add remote editor routing ([2ce2f7c](https://github.com/MrVPlusOne/companion/commit/2ce2f7c5f05249eae9cbdfc495bbfcd0ac6a65f0))
* **vscode:** embed takode panel with editor context ([bee87f7](https://github.com/MrVPlusOne/companion/commit/bee87f707220163eace71ae3cc5c927f800c0dc4))
* **vscode:** keep cross-repo selection context ([07a6b02](https://github.com/MrVPlusOne/companion/commit/07a6b0203d5ab3bce4632da851739ec3bd599a4d))
* **vscode:** open panel file links in VS Code ([3d14503](https://github.com/MrVPlusOne/companion/commit/3d1450338ded8dbc62b123db549012ec5982346a))
* **vscode:** simplify selection context UI ([86220fd](https://github.com/MrVPlusOne/companion/commit/86220fde21ed9b1ebce89c6caf709f3bd0e77316))
* **vscode:** support file-link line ranges ([1d54336](https://github.com/MrVPlusOne/companion/commit/1d54336850da1bec1d8ad9817f7b0ff34a8d8083))
* **vscode:** sync authoritative selection state ([e0c46f5](https://github.com/MrVPlusOne/companion/commit/e0c46f5e5d4bf99111b9970b43fd6b8a202aae57))
* **ws-bridge:** inject date at date boundaries in CLI user message timestamps (q-103) ([7f56a1e](https://github.com/MrVPlusOne/companion/commit/7f56a1ec48f379a9a41f94f071173da2a10ff12a))


### Bug Fixes

* **board:** add hover preview tooltips to quest and worker links in BoardBlock ([cbd5285](https://github.com/MrVPlusOne/companion/commit/cbd5285319ea409936937d5582afddeddaeb5d2a))
* **board:** add server-side validation to DELETE/advance routes and log title fetch errors (q-134) ([35efc67](https://github.com/MrVPlusOne/companion/commit/35efc67730101f16c9d87981148fd7c60a9d2a5d))
* **board:** clean up board rows on quest delete and cancel ([f2bb9ac](https://github.com/MrVPlusOne/companion/commit/f2bb9ac50378eda244fa1800e98dcb7fa6aa9ddd))
* **board:** decouple board row removal from quest state changes ([c8e8850](https://github.com/MrVPlusOne/companion/commit/c8e88508e8d8b59de48eed36713619eed9af9572))
* **board:** fix BoardBlock rendering by always emitting JSON marker and lazy-fetching full results ([27aa824](https://github.com/MrVPlusOne/companion/commit/27aa824306f1427e5e85ab0060c8482c26664226))
* **board:** fix clearing wait-for and worker fields via empty strings (q-93) ([d912020](https://github.com/MrVPlusOne/companion/commit/d912020fec83eff3eae0cd15bc8eb3868b0c7a4f))
* **board:** validate quest IDs and auto-populate titles (q-134) ([4b97a86](https://github.com/MrVPlusOne/companion/commit/4b97a86aaa718cd71fd9c0d01d2bbc1acde8fb52))
* **bridge:** add optimistic timer to promoted queued turns ([fbaa911](https://github.com/MrVPlusOne/companion/commit/fbaa9111d058c6514519feef149c966d8f8dc8f6))
* **bridge:** apply timestamp tags in SDK/Codex adapter path ([9ba6bf6](https://github.com/MrVPlusOne/companion/commit/9ba6bf61626634bfa9ed5494e10bdc9f8013df33))
* **bridge:** auto-recover sessions stuck in running state after 5 minutes (q-132) ([c443368](https://github.com/MrVPlusOne/companion/commit/c44336888e8799a7d885fb4701bbb9a2ab85dc99))
* **bridge:** eliminate duplicate event buffer entries and fix frozen/active turn split ([b9d999a](https://github.com/MrVPlusOne/companion/commit/b9d999a0c8bdd2f2c3887ac7db5198fba362bd58))
* **bridge:** handle status_change for SDK sessions (compaction state tracking) ([dd36ebf](https://github.com/MrVPlusOne/companion/commit/dd36ebfa75f72085959f58e3bc3462da17836f97))
* **bridge:** prevent relaunch from preserving stale isGenerating state ([ae461b8](https://github.com/MrVPlusOne/companion/commit/ae461b883c5368385fde540fca94ac3df02d1049))
* **bridge:** recompute diff stats when diff base branch changes ([ea5f66b](https://github.com/MrVPlusOne/companion/commit/ea5f66b5bb686b3c52972cabcb6d3b44c1e3e910))
* **bridge:** remove SDK crash-loop fallback that silently reverted to WebSocket ([afca7ad](https://github.com/MrVPlusOne/companion/commit/afca7ad779a88d100fc22f95e6a84ab6dbaa48d6))
* **bridge:** rename backendConnected to cliConnected in getHerdDiagnostics ([def9e59](https://github.com/MrVPlusOne/companion/commit/def9e59b1af68c8f5883c3c41261f485bcde1772))
* **bridge:** stop sending false backend_connected for dead SDK sessions ([b56e5b3](https://github.com/MrVPlusOne/companion/commit/b56e5b34e0cd1e4d4100127ada5e7d5c375f92f8))
* **bridge:** synthesize compact_marker from SDK status_change for UI visibility (q-135) ([daf0cab](https://github.com/MrVPlusOne/companion/commit/daf0cabf8f12ebb5f118344bb0a9871405fdb83f))
* **bridge:** track CLI-initiated turns so cron/background wakeups emit turn_end ([327077a](https://github.com/MrVPlusOne/companion/commit/327077a8bdb18c1d5331f65a133deee6a567d309))
* **bridge:** use all tool_progress as liveness signal for stuck detection ([3714b1e](https://github.com/MrVPlusOne/companion/commit/3714b1eb4f4d3b3016b6ec77fd14c99950b626b8))
* **chat-feed:** reset transient turn expansion on reopen ([b691be5](https://github.com/MrVPlusOne/companion/commit/b691be56ac8706167b0000cb8f913bd6ec5b4559))
* **chat:** add feed scroll runway ([217b36e](https://github.com/MrVPlusOne/companion/commit/217b36ed58d98f053c319f6cb966aa84cc4be225))
* **chat:** anchor feed runway to user turns ([023b2ff](https://github.com/MrVPlusOne/companion/commit/023b2ff76f08ae85612fed43412d6bfcdcdfee4e))
* **chat:** avoid resurrecting stale latest pill ([0626fbc](https://github.com/MrVPlusOne/companion/commit/0626fbcf064783bc30b9793ec92fa3a94e36d2ef))
* **chat:** broaden running-state feed runway ([a67d187](https://github.com/MrVPlusOne/companion/commit/a67d1879b28d524d71612dba8dc93c55d0df861e))
* **chat:** clear empty-history loading state ([594f5fc](https://github.com/MrVPlusOne/companion/commit/594f5fcd19578f1c85c44681329c9c067d334556))
* **chat:** dismiss stale live subagent chips ([f7ee819](https://github.com/MrVPlusOne/companion/commit/f7ee81975d19867dbc65ed661efc50405c2a2aff))
* **chat:** extend send-time feed runway ([ef116e1](https://github.com/MrVPlusOne/companion/commit/ef116e1c71c091ed7b31049fb5e2910e1a340784))
* **chat:** gate codex terminal rail with dwell ([a28cc33](https://github.com/MrVPlusOne/companion/commit/a28cc33afb3a55930107c21bc839e4382d4093a6))
* **chat:** hide empty assistant message bubbles ([454b4a1](https://github.com/MrVPlusOne/companion/commit/454b4a164f3d27a6b59dbae5ff356600d6a6f294))
* **chat:** mute completed live badges ([322469b](https://github.com/MrVPlusOne/companion/commit/322469b2682749ad1d94a81ad46a477da01d10a1))
* **chat:** only show [@to](https://github.com/to)(user) messages in collapsed leader turns ([356f094](https://github.com/MrVPlusOne/companion/commit/356f094df0b492afc69f1a1b52289f8a20132403))
* **chat:** preserve pinned scroll across session switches ([f5a64da](https://github.com/MrVPlusOne/companion/commit/f5a64da08db2e8b692123f83b4d587cbd37ecebd))
* **chat:** preserve send alignment through follow flush ([229d41f](https://github.com/MrVPlusOne/companion/commit/229d41f4712110339833e8575e4ba252085fefd2))
* **chat:** preserve viewport across turn collapse ([2d060d7](https://github.com/MrVPlusOne/companion/commit/2d060d7d2493564e9b7efba104a2860f5b38c695))
* **chat:** reduce long-feed render work ([cf2fcc7](https://github.com/MrVPlusOne/companion/commit/cf2fcc7498859e80170a9f53978877f1c959663c))
* **chat:** refine codex terminal live shell cards ([bb71ef9](https://github.com/MrVPlusOne/companion/commit/bb71ef9c5741e366374214d5acd8f44272117355))
* **chat:** render [@to](https://github.com/to)(user) messages outside collapsed turn card ([9fe739e](https://github.com/MrVPlusOne/companion/commit/9fe739e4b125055867f237eb5a77a495e3479a95))
* **chat:** restore go-to-bottom behavior ([5b09796](https://github.com/MrVPlusOne/companion/commit/5b0979659a462b78efdbf256af99f763518e576d))
* **chat:** restore latest indicator on session switch ([ae36bd1](https://github.com/MrVPlusOne/companion/commit/ae36bd17373571cdec3cb08f487d74c9f4439829))
* **chat:** show loading state during history hydration ([1f9201c](https://github.com/MrVPlusOne/companion/commit/1f9201c9bc8ad77a31c9f01ebecd1b802539f6c8))
* **chat:** simplify send scroll behavior ([b0c5a02](https://github.com/MrVPlusOne/companion/commit/b0c5a023bae4f2df1b420b0ee09a0d9c5e757db9))
* **chat:** simplify user-turn scroll targets ([69a3182](https://github.com/MrVPlusOne/companion/commit/69a31829ba4d757cde9b4d756a6299835333b343))
* **chat:** stabilize feed auto-scroll ([0411b72](https://github.com/MrVPlusOne/companion/commit/0411b7235130c275ccfd23427db2eb8add23146f))
* **chat:** stabilize feed scroll restore ([1218ce7](https://github.com/MrVPlusOne/companion/commit/1218ce7d48c3c4b0e95ec08251047e286f25a92a))
* **chat:** stabilize latest feed alignment ([67da0d5](https://github.com/MrVPlusOne/companion/commit/67da0d52632c1e386e45c8395423b97af1989644))
* **chat:** stabilize send-time feed alignment ([cd5d3e7](https://github.com/MrVPlusOne/companion/commit/cd5d3e7401dcbdf5b85ccc497c38e4fc86a06424))
* **chat:** target stable send scroll position ([ab509cc](https://github.com/MrVPlusOne/companion/commit/ab509cc1f8654ecc93ff246f893d898b83603578))
* **chat:** tighten floating feed spacing ([1f559b4](https://github.com/MrVPlusOne/companion/commit/1f559b4693e2f83ddf52b3461b8e2299c61be20a))
* **claude-sdk:** handle mcp_get_status instead of logging warning ([a173492](https://github.com/MrVPlusOne/companion/commit/a173492b9f2a469a8148fef6dae793826d565306))
* **cli:** stabilize session auth lookup on macOS ([d01aacf](https://github.com/MrVPlusOne/companion/commit/d01aacf868986dff67a820caeec9fc3bf30a5ad6))
* **codex:** autocomplete slash skills ([4e50e36](https://github.com/MrVPlusOne/companion/commit/4e50e3603bd6d06b629f254d3798284489299bf7))
* **codex:** avoid false queued turn_end interrupts ([419ba80](https://github.com/MrVPlusOne/companion/commit/419ba804778ded05895882b091fcffb911ede5ce))
* **codex:** clear stale turn state and fix dedup window on reconnect ([00544d2](https://github.com/MrVPlusOne/companion/commit/00544d2404d0bf8d76d81e6eb4eadb20cedc9367))
* **codex:** dedup compaction resume replays ([469d583](https://github.com/MrVPlusOne/companion/commit/469d58379285f43276eaf1075847015086acffbf))
* **codex:** eliminate status flicker on idle SDK session user dispatch ([1549e1f](https://github.com/MrVPlusOne/companion/commit/1549e1f363f02a0c174cd02cf3bb0a1a64d962a1))
* **codex:** gate auth recovery per launch ([9c20c7f](https://github.com/MrVPlusOne/companion/commit/9c20c7f501ecb1043e7a2b334981d3990968d027))
* **codex:** handle connector auth startup failures ([1547bb9](https://github.com/MrVPlusOne/companion/commit/1547bb9a3255f321f4407c414a3d328c51780dd5))
* **codex:** harden resume and launcher startup ([2c12c25](https://github.com/MrVPlusOne/companion/commit/2c12c259ded18a75972aae63f4f8ac78c23218f4))
* **codex:** inherit user PATH for new sessions ([01687e8](https://github.com/MrVPlusOne/companion/commit/01687e8b191d9aeb56c32935bcee7b26f88e97d1))
* **codex:** nest spawned subagent activity ([4068e5c](https://github.com/MrVPlusOne/companion/commit/4068e5c83e2aec95f6ac131d3e715597594bdd4e))
* **codex:** pass LiteLLM env vars to spawned Codex sessions ([1a0b199](https://github.com/MrVPlusOne/companion/commit/1a0b19939705f42a646b98f462f1ae6c722e9e7c))
* **codex:** persist leader guardrails ([1934300](https://github.com/MrVPlusOne/companion/commit/1934300d0a9d810869e4e51fe307c408c9c7fe1f))
* **codex:** prefer retained terminal transcript ([f78639a](https://github.com/MrVPlusOne/companion/commit/f78639aa79df6a350e1a82061455f3b6c69ebe54))
* **codex:** preserve built-in path shims ([58b9f5d](https://github.com/MrVPlusOne/companion/commit/58b9f5d462676ad980d857de78b2b80a6c235540))
* **codex:** prevent double-spawn and zombie sessions on relaunch (q-16) ([f0d0203](https://github.com/MrVPlusOne/companion/commit/f0d020361b73994fb3f93c8b34168503fd969d30))
* **codex:** reconcile queued turn completion ([64239f3](https://github.com/MrVPlusOne/companion/commit/64239f3b04ab500f6bfbe60b46ab310f9dd44ec3))
* **codex:** recover annotated image turns on resume ([1749717](https://github.com/MrVPlusOne/companion/commit/1749717ae57f7e831bc7e02d731b612cb5586789))
* **codex:** recover cleanly across mid-turn reconnects ([f985f89](https://github.com/MrVPlusOne/companion/commit/f985f894c2510b9811e753f98b369e7f0aa318a8))
* **codex:** recover from empty rollout session files ([c43e60f](https://github.com/MrVPlusOne/companion/commit/c43e60fef8142a8697a361e8e6e007c8152cdfc5))
* **codex:** recover orphaned resumed turns ([9fb310c](https://github.com/MrVPlusOne/companion/commit/9fb310c41e305202d496a81990f1b467ff5f2007))
* **codex:** recover pending delivery state ([9d463b4](https://github.com/MrVPlusOne/companion/commit/9d463b4829dfdc51fdbd94fa4840ca509b61a749))
* **codex:** render diff-only file creates ([c6d4803](https://github.com/MrVPlusOne/companion/commit/c6d48030588d66559c942939d032afb86bda3421))
* **codex:** restore live thinking in chat feed ([00595b4](https://github.com/MrVPlusOne/companion/commit/00595b4dbd79a2d50aaa1761a43da07801bdbef8))
* **codex:** restore pending delivery recovery ([a313f8e](https://github.com/MrVPlusOne/companion/commit/a313f8ef7784bc2f534d8f01f6499efd4e84aaba))
* **codex:** retry user message on stale turn after compaction disconnect ([6f99742](https://github.com/MrVPlusOne/companion/commit/6f997425a61e8a39c1e0a8a10836a756d15c71c6))
* **codex:** route takode /compact to compaction API ([8c76691](https://github.com/MrVPlusOne/companion/commit/8c7669165c37d6cff80be42d236009c0221902c6))
* **codex:** set cliInitReceived on Codex adapter attach for herd event delivery ([5963162](https://github.com/MrVPlusOne/companion/commit/596316209d1f836a592ed4ccfef7da9574a4014a))
* **codex:** use path-based image transport for multi-image turns ([5a34def](https://github.com/MrVPlusOne/companion/commit/5a34def09d9d79adac2815eabe6214ea8628a19b))
* **composer:** honor server ui mode for plan toggle state ([65b24c5](https://github.com/MrVPlusOne/companion/commit/65b24c5cd9ca08cfca83b06455dd7d3e7dba6c28))
* **composer:** keep mobile voice button visible ([a10520e](https://github.com/MrVPlusOne/companion/commit/a10520ee6e30d7f6d44b803dd400b50183c7efe7))
* **composer:** make disabled voice warning on-demand ([bebccf7](https://github.com/MrVPlusOne/companion/commit/bebccf7255efba0b89d86d78859232e4f1d6fe5f))
* **composer:** remove @ mention file content injection on send ([b4114e3](https://github.com/MrVPlusOne/companion/commit/b4114e3b2f5598247fffca40daa899ed99baf2ba))
* **composer:** remove Default option from mid-session model selector ([70c382c](https://github.com/MrVPlusOne/companion/commit/70c382c80d6d695ac737d8e884f3ebfeab7cfe56))
* **composer:** resolve Default model from ~/.claude/settings.json ([f90be66](https://github.com/MrVPlusOne/companion/commit/f90be665736cad92d93a800eb4b4b8b10c9c5cf1))
* **composer:** show full model list with [1m] context variants and Default option ([bce5158](https://github.com/MrVPlusOne/companion/commit/bce51582cfb84d3845c3dfcfda28275ae669ea59))
* **composer:** skip send on Enter during IME composition ([3ec2129](https://github.com/MrVPlusOne/companion/commit/3ec2129e1a5136d214f396a848029fa9edf79b3d))
* **cronafter:** tighten input validation from groom review ([53863a5](https://github.com/MrVPlusOne/companion/commit/53863a5d63a35792e0f350ecaac72f26638e80ef))
* **diff-stats:** use merge-base for non-worktree sessions to exclude remote changes ([bbbe2c1](https://github.com/MrVPlusOne/companion/commit/bbbe2c18741c40c193b33ab0520b701710b4f4bb))
* **diff:** align chat diffs with panel and chunk gap expansion ([869e582](https://github.com/MrVPlusOne/companion/commit/869e5824b5d012b307694b1729d3672907d76ab5))
* **diff:** hide empty diff cards for deleted/renamed files with no content change ([2b91a4a](https://github.com/MrVPlusOne/companion/commit/2b91a4a68e124dc4ccd14a28be15f2395c645c25))
* **diff:** prevent diff view from blocking server on large diffs ([85164d8](https://github.com/MrVPlusOne/companion/commit/85164d88fdfc8cc00e312568192de79c1274c247))
* **diff:** prevent stuck loading state from stale async completions ([d29d600](https://github.com/MrVPlusOne/companion/commit/d29d60088aa63ac26209a9b5d5e5e7f89b3cc02e))
* **diff:** separate file path and stats for syntax inference ([f37503a](https://github.com/MrVPlusOne/companion/commit/f37503ab1043f81cc3bc04cc84038ee98e53788e))
* **diff:** truncate long file paths in diff headers ([cb88f5e](https://github.com/MrVPlusOne/companion/commit/cb88f5eb409a67fb536142783506779aaccbbf62))
* **diff:** use git-based file list for DiffPanel (fixes missing deletions/renames) ([e0ca5ac](https://github.com/MrVPlusOne/companion/commit/e0ca5ac5be3a82ffa192bbd5777fb0a6e0c7ccad))
* **frontend:** parse codex headerless edit hunks in diff viewer ([1ce1ec8](https://github.com/MrVPlusOne/companion/commit/1ce1ec83c5129b0b0303dfc754a39822aada8cd7))
* **git:** avoid redundant worktree diff refreshes ([f6df4f7](https://github.com/MrVPlusOne/companion/commit/f6df4f710ec16f3fc828d00ce5c9fbb51aff0192))
* **git:** reduce startup fsmonitor churn ([cbf0414](https://github.com/MrVPlusOne/companion/commit/cbf0414329edd5fb194ab4f19897eb5d86185df5))
* **git:** refresh worktree diff stats after resets ([cafc540](https://github.com/MrVPlusOne/companion/commit/cafc540bb1d0f6a2c5fede739eabd52a2a4a44a9))
* **groom:** resolve skill symlink to main repo root, not worktree ([9af5769](https://github.com/MrVPlusOne/companion/commit/9af576945caecbfcadc1ec27fb74b61a0c842aa8))
* **herd:** consolidate delete notification to use session_archived path ([32be70b](https://github.com/MrVPlusOne/companion/commit/32be70b3e7711c379b90dc6198e59e0c81861b4c))
* **herd:** deliver user-initiated turn_end events to leader (annotated) ([9e46200](https://github.com/MrVPlusOne/companion/commit/9e46200d8169c07979bfd783ea26c92d2a645da0))
* **herd:** filter user-initiated turn_end events and skip 30s timeout for herded workers (q-16) ([7987987](https://github.com/MrVPlusOne/companion/commit/798798779611f1b59c03cfdbdbc80b5ccbe83da4))
* **herd:** force-deliver pending events to stuck orchestrators ([95dd56c](https://github.com/MrVPlusOne/companion/commit/95dd56c12485744c797f59442db2706ecbdc46cc))
* **herd:** suppress compaction events for leaders ([4f0b1cb](https://github.com/MrVPlusOne/companion/commit/4f0b1cb725d5cac209ddf07214fcc82b23242a31))
* **herd:** wake idle-killed leader sessions on new herd events ([67e5bbe](https://github.com/MrVPlusOne/companion/commit/67e5bbe3c38a5a1f473934e01fe2e6192ccd9526))
* **history-sync:** add task_notification to hash computation ([cffed9a](https://github.com/MrVPlusOne/companion/commit/cffed9a33e46e11874b64158deae906f84f8895b))
* **history-sync:** exclude ephemeral browser-only messages from sync hash ([4a35948](https://github.com/MrVPlusOne/companion/commit/4a35948517d41b21c57d635cee9614214714698b))
* **idle:** prevent kill loop for SDK sessions by handling adapter disconnect ([122c829](https://github.com/MrVPlusOne/companion/commit/122c8291ef3e32803d86a37d90f9b34ed0933283))
* **images:** fail fast on upload errors and enforce codex path refs ([a89146d](https://github.com/MrVPlusOne/companion/commit/a89146d9eab08385b8cbc06b90d0c30352b5d1b2))
* **images:** keep non-sdk inline image blocks and number attachment paths ([ac8a086](https://github.com/MrVPlusOne/companion/commit/ac8a08648bd4edd207d289ac43d1b9ff76b985e0))
* keep herded unread state based on turn trigger source ([4877064](https://github.com/MrVPlusOne/companion/commit/4877064b7026163984d61160fa215893fa0846e1))
* **landing:** point github links to mrvplusone companion repo ([fa87c6d](https://github.com/MrVPlusOne/companion/commit/fa87c6d08f8b742c6721132f82ac3684e27fb786))
* **link-syntax:** clarify absolute file link syntax with example ([ad7e85a](https://github.com/MrVPlusOne/companion/commit/ad7e85add0bc76696976130d5490ffaf6fbe0c6b))
* **markdown:** remap stale worktree file links ([74a276c](https://github.com/MrVPlusOne/companion/commit/74a276cce036c9cfa1b2739c692975fe1cab8d3d))
* **markdown:** resolve worktree file links ([8a4e3fe](https://github.com/MrVPlusOne/companion/commit/8a4e3feda0da86e600cc3d6a8bd6877537065eb1))
* **message-feed:** escape scroll target selectors ([8b805ae](https://github.com/MrVPlusOne/companion/commit/8b805aea1c5dbcf50ca4e67a3292482aa570e727))
* **metrics:** expose context usage stats for claude-sdk sessions ([ab24261](https://github.com/MrVPlusOne/companion/commit/ab242614f98b41c28b387c1d87e5020610ff04e9))
* **metrics:** show claude context usage in session info ([0cc7529](https://github.com/MrVPlusOne/companion/commit/0cc7529c03ca9db047b921baab161e60b3c32bbf))
* **namer:** release quest name lock when quest leaves in_progress ([a755dab](https://github.com/MrVPlusOne/companion/commit/a755dab39db2e14034d5d1b50bc7c77510a16d04))
* **notify:** display summary in NotificationMarker and fix Pushover suppression (q-131) ([8a6a66c](https://github.com/MrVPlusOne/companion/commit/8a6a66c2c43323aa41d66ba559e22e12460104f8))
* **notify:** read message.id not top-level id for anchored notifications ([9e03a7e](https://github.com/MrVPlusOne/companion/commit/9e03a7ebb3d302ae73619d0bd59d34381f742082))
* **notify:** show summary in NotificationMarker and add Pushover debug logs ([4c591f4](https://github.com/MrVPlusOne/companion/commit/4c591f4d331933cca8b2b3e93ab7a5ac465a77b3))
* **orchestration:** add turn_source to permission_request herd events ([60fecf0](https://github.com/MrVPlusOne/companion/commit/60fecf0c2dbd5b357b1ad5a8e3ec47f985c19dd3))
* **orchestration:** re-inject guardrails on session relaunch ([e763d33](https://github.com/MrVPlusOne/companion/commit/e763d33c08138790a320f4489928e13a93848314))
* **orchestration:** split codex leader guardrails by backend ([5a2e20f](https://github.com/MrVPlusOne/companion/commit/5a2e20f6930c5680a903a43f3639c55cdefa41cb))
* **orchestration:** tailor leader instructions by backend ([39a07b9](https://github.com/MrVPlusOne/companion/commit/39a07b9e1f17e672e4e78f8af12652b6d84c89c3))
* **orchestrator:** add delegation principle to leader system prompt ([dee95df](https://github.com/MrVPlusOne/companion/commit/dee95df1dcdf8e7d075c9bf1923ce7de9e1e4449))
* **orchestrator:** add permission request handling guidelines to leader prompt ([21e045e](https://github.com/MrVPlusOne/companion/commit/21e045e79f293b49cc4b535dec145be6bbf89a70))
* **orchestrator:** improve leader system prompt with delegation guidelines ([e301582](https://github.com/MrVPlusOne/companion/commit/e301582d7755ad1516d045c34152195880c76ba8))
* **orchestrator:** replace [@to](https://github.com/to)(user)/[@to](https://github.com/to)(self) with takode notify instructions ([a954988](https://github.com/MrVPlusOne/companion/commit/a954988985c72c39c405e7e602129e4c5af0e518))
* **permissions:** add ssh to DANGEROUS_FIRST_TOKENS ([4561349](https://github.com/MrVPlusOne/companion/commit/4561349dfa70ff006984f125ad8fc52b2f14b3ec))
* **permissions:** forward browser approval to SDK adapter (fixes stuck tools) ([7d2997a](https://github.com/MrVPlusOne/companion/commit/7d2997a253e9a134b9854bfc0199ff751615a1b8))
* **permissions:** handle settings_rule_approved result in ws-bridge ([b3ffb86](https://github.com/MrVPlusOne/companion/commit/b3ffb86f57ffd58601e9475909ae4f03637594f9))
* **permissions:** handle shell comments in command splitter ([1ea50dc](https://github.com/MrVPlusOne/companion/commit/1ea50dc123792ad9da3a7abfc7f6f4d243067156))
* **permissions:** keep pipes intact for rule matching (match CLI behavior) ([b70f0a6](https://github.com/MrVPlusOne/companion/commit/b70f0a6f537afb9362ea8a9b593d3d2b2a7f48db))
* **permissions:** show reason when sensitive file blocks auto-approval ([42ef538](https://github.com/MrVPlusOne/companion/commit/42ef538e450fc091d6476d143ffaeb3a9f7da64f))
* **prompt:** enforce takode file link syntax ([1b0e72f](https://github.com/MrVPlusOne/companion/commit/1b0e72f8d5192db3315bf744ce17e34250073b8b))
* **pushover:** remove noisy 'not configured' log and add skipReadCheck test ([c6daf34](https://github.com/MrVPlusOne/companion/commit/c6daf34c2a4ad649ffc32ef32135f1ac9660170c))
* **quest-link:** show read-only modal overlay instead of navigating to Questmaster (q-102) ([613d321](https://github.com/MrVPlusOne/companion/commit/613d3217054cbabc7675bfb00b83a76e2bd18c0b))
* **quest:** add --title flag alias to quest create CLI ([e471649](https://github.com/MrVPlusOne/companion/commit/e471649ea3bb6e9c82cdcef390226a3a4d8f1ad3))
* **questmaster:** render markdown in quest detail view ([030531b](https://github.com/MrVPlusOne/companion/commit/030531b3311d4997405c1f89158b22144e8e5dd9))
* **quest:** render markdown in inline QuestClaimBlock description ([89b33da](https://github.com/MrVPlusOne/companion/commit/89b33da444c51817da8be2344ad456e15ddbd9a1))
* **quest:** resize oversized images at upload to fit Read tool limit ([2f6fd35](https://github.com/MrVPlusOne/companion/commit/2f6fd35537da4439b1b1c9974b4b8d247a601d0b))
* **reliability:** improve stuck detection and SDK relaunch feedback ([14d6e2b](https://github.com/MrVPlusOne/companion/commit/14d6e2b0dfe04cafa930b7296124660132406947))
* remove --coverage from pre-commit hook and fix 7 pre-existing test failures ([5c7f7b0](https://github.com/MrVPlusOne/companion/commit/5c7f7b0e0926ecf0e87d84377ea258c73f518a0c))
* **repo:** remove stray self dependency ([09913f5](https://github.com/MrVPlusOne/companion/commit/09913f588ffdd19de35b424e741a10ed8da89819))
* **routes:** filter and sort codex models by supported versions ([cc36ad0](https://github.com/MrVPlusOne/companion/commit/cc36ad0329ab6c3924d70562d5d56d743c631b2c))
* **sdk:** always provide canUseTool so interactive tools reach the browser ([e700e5d](https://github.com/MrVPlusOne/companion/commit/e700e5d1ad085ac91a47d18e8f439e9ea4d611d0))
* **sdk:** avoid double-queueing pending adapter messages ([73696e9](https://github.com/MrVPlusOne/companion/commit/73696e9458c1001610930f8d2e3696c5a285a5e8))
* **sdk:** deduplicate task_notification on CLI resume replay ([415202f](https://github.com/MrVPlusOne/companion/commit/415202fd67db4ead6a40bc2c0e96f1168d29cb8b))
* **sdk:** drain queued turns before result processing to prevent stuck generation ([df23b4f](https://github.com/MrVPlusOne/companion/commit/df23b4fd8c007157e6b4c81f26ff10b96cd0e004))
* **sdk:** fall through to result.usage for context % when assistant usage is zero ([e482fe4](https://github.com/MrVPlusOne/companion/commit/e482fe4a4f07a402e150eb778ac647557e13175c))
* **sdk:** flush pending messages on SDK adapter attach ([3a28060](https://github.com/MrVPlusOne/companion/commit/3a2806047c4c341b290488eead04aaa316d23fa9))
* **sdk:** forward task_notification for Claude SDK sub-agent chips ([d0e01ca](https://github.com/MrVPlusOne/companion/commit/d0e01ca77f4078726aeb2430240018a88e4503e9))
* **sdk:** forward vscodeSelection to Claude SDK adapter ([3adf49f](https://github.com/MrVPlusOne/companion/commit/3adf49f045ab0ee686063e0a066b1ba4380f165d))
* **sdk:** initialize context usage on system.init for new SDK sessions ([b0dda2d](https://github.com/MrVPlusOne/companion/commit/b0dda2dbc5237a982826c0f1c866095615d2cc63))
* **sdk:** resolve user's default model explicitly for new sessions ([65cd7d8](https://github.com/MrVPlusOne/companion/commit/65cd7d8568ff424a8896a4a2477b815233cd057a))
* **sdk:** strip image content blocks for SDK sessions ([814c61a](https://github.com/MrVPlusOne/companion/commit/814c61ae6eb5359b6ab7398a6f63422888f5a24c))
* **sdk:** unify generation lifecycle for Claude SDK result handling ([31bf2e9](https://github.com/MrVPlusOne/companion/commit/31bf2e98d02416fd5c1260b0c16911f4aa0c624c))
* **server:** remove session names from herd event summaries ([6458980](https://github.com/MrVPlusOne/companion/commit/645898076f26b7af469b8706116595df9cd4f972))
* **server:** show session numbers instead of UUIDs in restart error ([f8b4455](https://github.com/MrVPlusOne/companion/commit/f8b44558b691abc7c04f53c40ae178c4888c4c76))
* **server:** stabilize ripgrep resolution tests ([a52b959](https://github.com/MrVPlusOne/companion/commit/a52b959a7f542c1d025ec30ff56468f00112aa6f))
* **session-info:** display system prompt via modal like Claude.md files ([aac327b](https://github.com/MrVPlusOne/companion/commit/aac327be47dabfdd42cc637ae8e197fb2d2bc56a))
* **session-info:** prevent system prompt modal dismiss on content click ([71dfbe4](https://github.com/MrVPlusOne/companion/commit/71dfbe45d401bbaebb71dc0a5f66ffa44da734f0))
* **session-store:** trim replay preview tails ([503bceb](https://github.com/MrVPlusOne/companion/commit/503bceb33a120ee67f10f430d244d01f8ae632a4))
* **session:** preserve claude-sdk backend type through session creation ([7b09ec9](https://github.com/MrVPlusOne/companion/commit/7b09ec9dd94c7470743cad3089c322de039da9c6))
* **session:** preserve restored context metadata ([9a2e0d0](https://github.com/MrVPlusOne/companion/commit/9a2e0d0be8ec54dc8b39e40153829aad44549215))
* **session:** restore Codex CLI session discovery lost in rebase ([41742e8](https://github.com/MrVPlusOne/companion/commit/41742e8e89e5b50222632069bb7830a173fd5c96))
* **sessions:** avoid blocking git worktree setup ([b185a77](https://github.com/MrVPlusOne/companion/commit/b185a7758b39526ef926dd27506f4588c4ef34eb))
* **settings:** persist custom transcription vocabulary ([5ef3929](https://github.com/MrVPlusOne/companion/commit/5ef39290ca3d04e9dea5aa8e47a2ea552cf85f6d))
* **settings:** persist enhancementMode in transcription config ([e2f2e0f](https://github.com/MrVPlusOne/companion/commit/e2f2e0fd46555e78bd37187b6abe8da1474553e4))
* **settings:** store openai keys in server secrets ([e186734](https://github.com/MrVPlusOne/companion/commit/e1867346e71380162fdecef2866fc7edf4868af6))
* **sidebar:** disable drag-and-drop in activity sort mode ([5a8f544](https://github.com/MrVPlusOne/companion/commit/5a8f5448cf2ab6ea385ab78f9a7e4efd26a61768))
* **sidebar:** hide branch names and move git summary in popover ([914b448](https://github.com/MrVPlusOne/companion/commit/914b4481b237a19880ca9fc088e46e17b2f3090e))
* **sidebar:** move session status indicator to stripe ([e4fc656](https://github.com/MrVPlusOne/companion/commit/e4fc65687be0e9efc9aa662d282d742d4f8c694f))
* **sidebar:** nest reviewer sessions under parent worker's project group (q-98) ([b34e916](https://github.com/MrVPlusOne/companion/commit/b34e916fecbef7880d20eeacd269e0bc3ded44f5))
* **sidebar:** refresh non-current session status ([cc7b7d6](https://github.com/MrVPlusOne/companion/commit/cc7b7d658edb6884d54167b47cc7f939fdc1409f))
* **sidebar:** restore session diff stats fallback ([238674f](https://github.com/MrVPlusOne/companion/commit/238674ff96b124079718432d656419efa00d4d6d))
* **sidebar:** review group session drafts before create ([2e1f396](https://github.com/MrVPlusOne/companion/commit/2e1f396bfa53f3b58615a8781a04d9cac2ebd31a))
* **sidebar:** sort sessions by last user message time, not assistant activity ([a4f94ef](https://github.com/MrVPlusOne/companion/commit/a4f94ef3fab77fdf4d94085066abd1a84e5164d1))
* **sidebar:** stabilize mobile session gestures ([feac1c0](https://github.com/MrVPlusOne/companion/commit/feac1c06ef75435fc7fa68531832b8c2e1b3b0dc))
* **sidebar:** thicken session status stripe ([7c0cd12](https://github.com/MrVPlusOne/companion/commit/7c0cd12833432b9005474eb574a589797c6de3de))
* **skill-symlink:** resolve relative git-common-dir path to absolute ([5fb46e8](https://github.com/MrVPlusOne/companion/commit/5fb46e83d2543fbd8cbe6cb1635e6e872dde0e6e))
* **skill:** rewrite skeptic-review for reviewer perspective only (q-106) ([f317194](https://github.com/MrVPlusOne/companion/commit/f3171945b99b8aa05cd95494ddf2bfd0f61f7cbb))
* **skills:** sync project skill symlinks for agents ([6133a05](https://github.com/MrVPlusOne/companion/commit/6133a058247908255193ef8865f27d6df814a770))
* **sleep-inhibitor:** remove arbitrary 30-min cap and clarify server-level scope ([020c41d](https://github.com/MrVPlusOne/companion/commit/020c41dbec25ad39caf8861e0ca0139084cddb57))
* **spawn:** resolve base branch when spawning from a worktree ([16241fe](https://github.com/MrVPlusOne/companion/commit/16241fee8837417e0e53af7d9aaeb08ed1fddd4c))
* **streaming:** render codex markdown on complete lines ([5a3088b](https://github.com/MrVPlusOne/companion/commit/5a3088be836e57f677323c46cf1e18072c84a100))
* **stt:** wrap STT prompt in VOCABULARY_CONTEXT to prevent response hallucination ([50bd405](https://github.com/MrVPlusOne/companion/commit/50bd405e17d0326ff6882eb7c873019975d538b6))
* **subagents:** keep sections collapsed during streaming ([8f75f0f](https://github.com/MrVPlusOne/companion/commit/8f75f0fafac29ce7482ffbd8100098ade16bcb12))
* **subagents:** stream and peek child output correctly ([3e4eb51](https://github.com/MrVPlusOne/companion/commit/3e4eb519901e1e0659956b8f44380bbf9c318ba1))
* **takode-orchestration:** enforce dispatch-workflow.md and fix dispatch defaults (q-101) ([0623df6](https://github.com/MrVPlusOne/companion/commit/0623df63409635fcb43cc21c2874aa3ddb8f8d6c))
* **takode:** add backward peek paging ([be41af5](https://github.com/MrVPlusOne/companion/commit/be41af5e9dcf67c0fde7a8f8858ba5b2da222dee))
* **takode:** add investigation delegation rule and reinforce Quest Journey in leader prompt ([66b37b8](https://github.com/MrVPlusOne/companion/commit/66b37b89c07375b580c930810b69aa2f046063ba))
* **takode:** address groom findings for --reviewer flag ([3a30d26](https://github.com/MrVPlusOne/companion/commit/3a30d26e815cd5c0a75c02a535d275b5471a30c4))
* **takode:** allow read-only cli access for workers ([dc5d1b6](https://github.com/MrVPlusOne/companion/commit/dc5d1b6da08651302d01ec82693990113b34e827))
* **takode:** allow takode send to wake disconnected sessions (q-15) ([b52116d](https://github.com/MrVPlusOne/companion/commit/b52116d96b84653ee6fb4d5a8b06af177f50ae50))
* **takode:** bump server-side contentLimit to 500 in peek/scan APIs ([d63d720](https://github.com/MrVPlusOne/companion/commit/d63d72069c8a3edef3f7122d08e1cf740bd6e34f))
* **takode:** clear stale running state after turn completion ([36b6777](https://github.com/MrVPlusOne/companion/commit/36b67770a67fac0200a311d4884b124c23c4629d))
* **takode:** escape formatted terminal output ([8843c25](https://github.com/MrVPlusOne/companion/commit/8843c25385ecdd31926fb37265f1c258b8e1b36b))
* **takode:** fail closed on ambiguous auth routing ([8e08550](https://github.com/MrVPlusOne/companion/commit/8e0855091ca5b33bdd11915b08e3da168fd35aa2))
* **takode:** fix archive cascade event and add server-side tests ([699b1e0](https://github.com/MrVPlusOne/companion/commit/699b1e096f556716a184bc44b0f97f3326aa1bdc))
* **takode:** honor session-auth port fallback ([f40288f](https://github.com/MrVPlusOne/companion/commit/f40288f09eca9686b1eaeab43826c869e8327e66))
* **takode:** increase message truncation limits to 500 chars ([bf4a51a](https://github.com/MrVPlusOne/companion/commit/bf4a51a4387b7144845d23f7c55eaf63eb312f79))
* **takode:** inherit parent worker cwd for reviewer session grouping ([5dad11a](https://github.com/MrVPlusOne/companion/commit/5dad11aebd39b12cb26f837d864fb96f16f462d4))
* **takode:** make skeptic review mandatory, groom review conditional (q-91) ([53c6f3d](https://github.com/MrVPlusOne/companion/commit/53c6f3d92122d269dd13e8ac8f358b862730c048))
* **takode:** mark SDK/Codex sessions as interrupted on user interrupt ([87388f8](https://github.com/MrVPlusOne/companion/commit/87388f805e137fc6c43fcbc5695562883ed0bdbc))
* **takode:** prefer launch mode during spawn startup ([60a3613](https://github.com/MrVPlusOne/companion/commit/60a36134055fd07ac7bda5930d040a107d6b476f))
* **takode:** refine worker selection to queue when best worker is busy ([c161298](https://github.com/MrVPlusOne/companion/commit/c1612984ba2ce27de54c190d503532fd28851126))
* **takode:** refresh workers after leader compaction ([24c8cda](https://github.com/MrVPlusOne/companion/commit/24c8cda6a997f983675d31f7513b21b87811cb33))
* **takode:** scan backward by default, collapse user+assistant turns, add --until ([6fb6b10](https://github.com/MrVPlusOne/companion/commit/6fb6b10b2d0de107e61e08784f1da47d8d5c571c))
* **takode:** show msg IDs in pending output and peek tool-only messages ([4f4ac6a](https://github.com/MrVPlusOne/companion/commit/4f4ac6a7155d93864bf3907d8508605f0278ff60))
* **takode:** spawn inherits backend from leader session ([1b3d4fa](https://github.com/MrVPlusOne/companion/commit/1b3d4fa548aa6360daf1e75e02c07c77cfbf567b))
* **takode:** split GROOMED into GROOM_SENT and GROOMED states ([257951c](https://github.com/MrVPlusOne/companion/commit/257951c1c5f06997c7e5cc57f66252bc4a2b0075))
* **takode:** strengthen link-syntax instructions for all sessions ([e48398b](https://github.com/MrVPlusOne/companion/commit/e48398ba984896fcf89844c228c98591f69cfc1a))
* **takode:** suppress leader reminder after interrupt ([2f60711](https://github.com/MrVPlusOne/companion/commit/2f60711dbdc57868d2a8169dc7e8d0b242e32449))
* **takode:** update remaining old stage name references in help text and comments ([a21bfab](https://github.com/MrVPlusOne/companion/commit/a21bfab71d2e8aa531dcb7a8c20e2fc0bcc36f74))
* **takode:** wake idle-killed sessions on takode send ([79dcf21](https://github.com/MrVPlusOne/companion/commit/79dcf219b908844fd925ba31b5ce0cb7cfe20b60))
* **tasks:** clear stale current to-dos after codex turns ([add8c2e](https://github.com/MrVPlusOne/companion/commit/add8c2eca876d556066ac40ef56a7771296219d9))
* **test:** add touchUserMessage mock to ws-bridge test launchers ([32b35a3](https://github.com/MrVPlusOne/companion/commit/32b35a3be6c07614a81bc0198ccb900137287f69))
* **test:** flush store writes before restoreFromDisk to fix flaky test ([961456b](https://github.com/MrVPlusOne/companion/commit/961456b0f510b1058b6bcbd7fbf6263a8d99d8d7))
* **tests:** repair architecture-guards and protocol-drift tests ([b67fe71](https://github.com/MrVPlusOne/companion/commit/b67fe715604f098068f5849153aece515eeb412e))
* **tool-block:** show full file paths with CSS left-truncation ([0bcc087](https://github.com/MrVPlusOne/companion/commit/0bcc08747408d79765da0031ab1c61893798d22f))
* **toolblock:** collapse editor diffs by default ([b297ead](https://github.com/MrVPlusOne/companion/commit/b297ead2accc32efe948bf86bbd00dd20298b04b))
* **toolblock:** trim repeated terminal labels ([7280cf2](https://github.com/MrVPlusOne/companion/commit/7280cf26d5741a57fc3e389ca9d84b0dd402f580))
* **topbar:** keep mobile attention cycle in-session ([1aa99db](https://github.com/MrVPlusOne/companion/commit/1aa99db190b5676b504a430f128ee5438991790f))
* **topbar:** remove redundant plan mode label ([d6ea7e1](https://github.com/MrVPlusOne/companion/commit/d6ea7e106aa264ed99f38e3504aa6caee529b716))
* **traffic:** log browser history sync mismatches ([eda28ac](https://github.com/MrVPlusOne/companion/commit/eda28acc4f6235aafef3f974773298eb3f67aee9))
* **traffic:** reduce browser session sync egress ([8bb340a](https://github.com/MrVPlusOne/companion/commit/8bb340a0450c3dd52e7d741936a0a253d778d9d9))
* **traffic:** stop history sync retry loops ([57dd731](https://github.com/MrVPlusOne/companion/commit/57dd7316382e722fe85776a2f41d00b9c2505069))
* **traffic:** verify history sync with hashes ([a18cac4](https://github.com/MrVPlusOne/companion/commit/a18cac48cadfa72140deeac777e287a19a06ae1d))
* **transcription:** enforce bullet format for multi-sentence output ([f2fa690](https://github.com/MrVPlusOne/companion/commit/f2fa690a87b1e1e56a2335a982f9edc9f8e358ea))
* **transcription:** normalize recorded audio uploads ([57a96d7](https://github.com/MrVPlusOne/companion/commit/57a96d7895643dafba894b4b35a0e394a2a32003))
* **transcription:** plain text top-level points, indented - sub-points ([a2a98d1](https://github.com/MrVPlusOne/companion/commit/a2a98d1c7301f2a38a781715eb7353a5d20378b3))
* **transcription:** plain text top-level points, indented - sub-points ([61b4cfe](https://github.com/MrVPlusOne/companion/commit/61b4cfe8b2ad9ca65103bcafb9bb1fbccddf71c2))
* **transcription:** preserve uncertainty in enhanced output ([de92e62](https://github.com/MrVPlusOne/companion/commit/de92e623366e74825a741a92df54e1d9b18cb861))
* **transcription:** reduce over-condensing, preserve full meaning ([0dd341a](https://github.com/MrVPlusOne/companion/commit/0dd341adb83da9f86224a9c3c0b3acfdb4c3d767))
* **transcription:** restructure STT prompt, no empty lines in enhancer ([751262a](https://github.com/MrVPlusOne/companion/commit/751262a024ffe8a47df9f57d6356d0a8da07367d))
* **transcription:** simplify enhancer prompt, allow sub-bullets on single points ([c64ccaf](https://github.com/MrVPlusOne/companion/commit/c64ccaf56da49fee09c85920eaeaac6a66c558e3))
* **transcription:** use - and + for bullet glyphs instead of • and - ([bd6b0c9](https://github.com/MrVPlusOne/companion/commit/bd6b0c983bfea8481fa627d446e0c3fff6e0c3c2))
* **transcription:** use * for sub-bullets, preserve user questions ([d7c8cd8](https://github.com/MrVPlusOne/companion/commit/d7c8cd817341b24a10410a04b31056129b75b290))
* **transcription:** use character-based enhancer threshold (100 chars) ([24056f3](https://github.com/MrVPlusOne/companion/commit/24056f3efec03a9ccfe92782d1e34d5bc2c8d5a0))
* **transcription:** wrap enhancer examples in &lt;example&gt; tags ([5b6b9e3](https://github.com/MrVPlusOne/companion/commit/5b6b9e3c090bf9116ea1f5c9bcdd76a3240652f9))
* **transport:** broadcast backend_type to browsers on transport switch ([e235696](https://github.com/MrVPlusOne/companion/commit/e235696c51e34c75c0cc8969a1c55e593af2f8d2))
* **types:** add shell-quote module declaration ([df3a354](https://github.com/MrVPlusOne/companion/commit/df3a354acb884d81e3c53060d990b5bdb81e28c4))
* **types:** cover shell-quote glob token shape ([a5f3f52](https://github.com/MrVPlusOne/companion/commit/a5f3f52e51fc9efe3a81b78e1cadeeb6c4234616))
* **ui:** adapt VS Code layout to zoomed panels ([d14812d](https://github.com/MrVPlusOne/companion/commit/d14812d33d52c54fec8b9da988a9bb163071a7e5))
* **ui:** add amber badge for action attention without permissions ([607d13f](https://github.com/MrVPlusOne/companion/commit/607d13f1fc99af12fbadf5e420ae10020652f150))
* **ui:** add subtle background tint to [@to](https://github.com/to)(user) messages ([fa10e5e](https://github.com/MrVPlusOne/companion/commit/fa10e5e5790b0709eb4b5d7664cc210c106616cc))
* **ui:** address groom review feedback for ToolBlock error boundary ([4711dbc](https://github.com/MrVPlusOne/companion/commit/4711dbc67874de611a65f3fa2c7d17e542576b8c))
* **ui:** allow sending image-only messages without text ([b1bf17f](https://github.com/MrVPlusOne/companion/commit/b1bf17f7a63dd9bdb64122d770905d57b5961528))
* **ui:** always show collapse footer to prevent scroll jank ([e763674](https://github.com/MrVPlusOne/companion/commit/e7636740dae86327ae74fa6fb3e710ef98831659))
* **ui:** background agents incorrectly shown as finished and triggering stuck warnings ([3d3696d](https://github.com/MrVPlusOne/companion/commit/3d3696d7d2b9c882ea5f700ca80e92685a912883))
* **ui:** background agents use task_notification for completion, not instant tool_result ([a65ddff](https://github.com/MrVPlusOne/companion/commit/a65ddff858eacc4962ede36ea7d5e64689128cd7))
* **ui:** deactivate TopBar quest pills when quest leaves in_progress ([7cfecb1](https://github.com/MrVPlusOne/companion/commit/7cfecb12a844a5987c9cea8703db71304051d274))
* **ui:** drop agentType and bg tags from floating agent chips ([606bd81](https://github.com/MrVPlusOne/companion/commit/606bd817598a2fbbb7c6fd8b315453e207943134))
* **ui:** eliminate Zustand store subscription from DiffViewer render path ([3ceb7c7](https://github.com/MrVPlusOne/companion/commit/3ceb7c775c10881a62276af9df5d075f2a328c6a))
* **ui:** improve edit/diff display defaults ([d745f9f](https://github.com/MrVPlusOne/companion/commit/d745f9f5c08ddf38c49acd361f2907b9421303a7))
* **ui:** include 'Other' custom answers in AskUserQuestion submission ([a660a39](https://github.com/MrVPlusOne/companion/commit/a660a3918f35390f51e47b5e809e63e3eca37e27))
* **ui:** inline leader/herd tag with title, lead metadata with #N ([ecbc297](https://github.com/MrVPlusOne/companion/commit/ecbc2976bde7a2e53849d37dd246045b5a6ab7c5))
* **ui:** make [@to](https://github.com/to)(user) leader message styling more subtle ([8dae2f6](https://github.com/MrVPlusOne/companion/commit/8dae2f68a40a81b34ebf27e8987e1d0b06c864b6))
* **ui:** move archive button to left side of session chip ([fe2ed23](https://github.com/MrVPlusOne/companion/commit/fe2ed23bb9b8dfe05840487f9a3cc52ffa8c8d73))
* **ui:** preserve Default model option when dynamic models are fetched ([f555765](https://github.com/MrVPlusOne/companion/commit/f55576599160658e6e67fca3c33d00d1541b4418))
* **ui:** prevent Edit block crashes and add expand/collapse setting ([8adea10](https://github.com/MrVPlusOne/companion/commit/8adea10e9b558fddcc81c55bdc90d8c5e686ede9))
* **ui:** prevent Edit block re-render loop and improve crash resilience ([f792d7b](https://github.com/MrVPlusOne/companion/commit/f792d7b648abd961c0e9d585bb36394676b48a5f))
* **ui:** prevent long text truncation in chat messages ([75daf94](https://github.com/MrVPlusOne/companion/commit/75daf94b494a2acd7f398166d88e7e739f248d66))
* **ui:** prevent ToolBlock re-render storms causing React error [#185](https://github.com/MrVPlusOne/companion/issues/185) ([f1aa279](https://github.com/MrVPlusOne/companion/commit/f1aa27989076a4c37e7152b7b94f662093cc5404))
* **ui:** raise collapse footer height threshold to 400px ([4166862](https://github.com/MrVPlusOne/companion/commit/41668623b609226df810eb9792518daff519c257))
* **ui:** render assistant text before subagent chips in mixed messages ([a126e62](https://github.com/MrVPlusOne/companion/commit/a126e62f8e8cfdb1ce495f2d67aa6b5afde787d2))
* **ui:** replace Codex theme with VS Code Dark Modern theme ([42af995](https://github.com/MrVPlusOne/companion/commit/42af99542e2d5494831124f8c2b322b6c1748135))
* **ui:** show leader turn last message in collapsed view ([b3ee697](https://github.com/MrVPlusOne/companion/commit/b3ee697aacc7d63844f69a0b0f3dacc316e48b8a))
* **ui:** unify terminal command row display ([6c31bb9](https://github.com/MrVPlusOne/companion/commit/6c31bb91ea6485dd72fcd08a5190dbee3dccf048))
* **ui:** use orange accent for [@to](https://github.com/to)(user) tag and dimmed borders ([25e890c](https://github.com/MrVPlusOne/companion/commit/25e890cd34c481364916c643fd4b635304e667dc))
* **ui:** use top/bottom borders and blue tag for [@to](https://github.com/to)(user) messages ([75e95d8](https://github.com/MrVPlusOne/companion/commit/75e95d8883051a577818070068d90b31655d0faa))
* **ui:** wrap ToolBlock in outer error boundary for crash isolation ([2bb88a4](https://github.com/MrVPlusOne/companion/commit/2bb88a448742a829d8193fcab305633596e6523b))
* **usage:** surface session token stats ([27c2140](https://github.com/MrVPlusOne/companion/commit/27c21401dff531c8beb152ebf1c7bc98af36996f))
* **voice-edit:** ignore line-ending-only diff noise ([11d4920](https://github.com/MrVPlusOne/companion/commit/11d492006498469b355d96f53dfebea279e0a9cd))
* **voice:** add client-side timeout and reduce enhancement token budget ([7c81611](https://github.com/MrVPlusOne/companion/commit/7c816110f7efe2ad4b9164dc73e645bece5c6bda))
* **voice:** add prose-mode format reminder for consistent recency bias ([20cbdab](https://github.com/MrVPlusOne/companion/commit/20cbdab7a1a1d6af52a54ace939ae7bd12c45d99))
* **voice:** make bullet mode reorganize sentences instead of compressing them ([b37d13a](https://github.com/MrVPlusOne/companion/commit/b37d13a6fe2d272bfdec6d50636344bf741d6dd0))
* **voice:** make format reminder mode-aware to fix prose enhancement slowdown ([99e928c](https://github.com/MrVPlusOne/companion/commit/99e928cf3bddf0498fcf6fdb2bf1aade63077bda))
* **voice:** make voice-edit mode respect enhancement mode setting ([9f174d5](https://github.com/MrVPlusOne/companion/commit/9f174d5fbb5d6bbc0f48a9cad34519566ed6cdf1))
* **voice:** persist sttModel when saving transcription settings ([0673ac6](https://github.com/MrVPlusOne/companion/commit/0673ac63870aa15922ab31e3519856bde8450d8d))
* **voice:** preserve format and clean preview diff ([ac11d71](https://github.com/MrVPlusOne/companion/commit/ac11d71d051c973766635f23c1806ff6bd625709))
* **voice:** prevent bullet mode from inventing summary headings ([1c80caa](https://github.com/MrVPlusOne/companion/commit/1c80caa148376daf31dcd722c67cca32c3cd3600))
* **voice:** simplify enhancement prompt to reduce reasoning overhead ([7c393c4](https://github.com/MrVPlusOne/companion/commit/7c393c47c7c5a2ccfc76bfcee5d7026e375b16f6))
* **vscode:** add bridge debug logging ([65d3941](https://github.com/MrVPlusOne/companion/commit/65d394197b8cab12458e41336b7d2af80228e6aa))
* **vscode:** expose frontend context debug hooks ([cf6733f](https://github.com/MrVPlusOne/companion/commit/cf6733f0ad7d50818a02d2dad554b2b74c7a3dcc))
* **vscode:** forward panel localhost through workspace host ([46e5065](https://github.com/MrVPlusOne/companion/commit/46e5065cf7d2212c428cfe0228669f4e98bb365a))
* **vscode:** harden selection context bridge ([3b4d0ee](https://github.com/MrVPlusOne/companion/commit/3b4d0eedb6f7e5fef5ea49637096233d77c3e21d))
* **vscode:** recover panel and selection sync after restart ([b6bca17](https://github.com/MrVPlusOne/companion/commit/b6bca1704260907f6ab3dd4ae9e54d8feafd6e70))
* **vscode:** request selection after webview boot ([9cf3a09](https://github.com/MrVPlusOne/companion/commit/9cf3a0939c697780b732d7e7a4736762b0e2e0b9))
* **vscode:** retain last editor selection in panel ([aee2635](https://github.com/MrVPlusOne/companion/commit/aee2635ba664a46a37cc1d1a1dde2fc2099af304))
* **vscode:** simplify selection context display ([ca19452](https://github.com/MrVPlusOne/companion/commit/ca19452748d1abea4cc7854d123eeaaa1b923613))
* **vscode:** stop selection badge flickering from heartbeat force-publish ([a8da52b](https://github.com/MrVPlusOne/companion/commit/a8da52b62b74b9da56e2f1c6a25d2e658ae36fc7))
* **vscode:** tighten selection and keyboard behavior ([b295804](https://github.com/MrVPlusOne/companion/commit/b295804959bbd7c147bd994603a4c8d833793ffa))
* **watchdog:** prevent false stuck warnings when async sub-agents are running ([979f711](https://github.com/MrVPlusOne/companion/commit/979f7114e0121e1c96f989e3a3a4637d80e04195))
* **watchdog:** skip stuck detection when tools are actively running ([24b833b](https://github.com/MrVPlusOne/companion/commit/24b833be6bbd4e30952b6155445f8faa7935abdc))
* **worktree:** avoid nested worker spawns from leader worktrees ([c2e8a40](https://github.com/MrVPlusOne/companion/commit/c2e8a4056d36157de415eee6ffd0bc5aefb2bbde))
* **worktree:** require sync before quest verification ([9571d30](https://github.com/MrVPlusOne/companion/commit/9571d303ccbe692645c98120b57654984e19f2f5))
* **ws-bridge:** dedupe replayed history entries ([477a0b6](https://github.com/MrVPlusOne/companion/commit/477a0b650eaca975defdeeefbc85bbba4723bc90))
* **ws-bridge:** finalize superseded codex tool timers ([c28fa21](https://github.com/MrVPlusOne/companion/commit/c28fa21aeb10bb87d9a1124e28021e46b0947958))
* **ws-bridge:** handle compaction markers for SDK sessions ([95055d4](https://github.com/MrVPlusOne/companion/commit/95055d494673a2a38a62c1e311f2e21ada58dedd))
* **ws-bridge:** harden codex disconnect recovery ([ccfd30d](https://github.com/MrVPlusOne/companion/commit/ccfd30d4f0d0aee0a57044e754d243b34366a7a8))
* **ws-bridge:** prevent false stuck-session indicator on fresh generations ([4c59743](https://github.com/MrVPlusOne/companion/commit/4c59743f69ae7b0aa48f6b313b91ec6e3727fc80))
* **ws-bridge:** prevent recursive leader tag reminders ([83cef6f](https://github.com/MrVPlusOne/companion/commit/83cef6fbd077b6cbd9c9723f98efcd5e7d3c9f6a))
* **ws-bridge:** reconcile codex queued turns after resume ([a9e15c8](https://github.com/MrVPlusOne/companion/commit/a9e15c828303b585705a8a61d10adc5dc0fcc883))
* **ws-bridge:** recover orphaned codex terminal results ([0a3d570](https://github.com/MrVPlusOne/companion/commit/0a3d570d0e1488b0eda75f5b8be0aae133ea7b67))
* **ws-bridge:** recover orphaned codex tool calls after reconnect ([cdcaeea](https://github.com/MrVPlusOne/companion/commit/cdcaeea123e5fb5fc6ebef87d24d4f409c9be823))
* **ws-bridge:** sync plan mode button state with CLI for SDK sessions ([84004aa](https://github.com/MrVPlusOne/companion/commit/84004aa91b0ff49fb361abb0258e2467f9d586ed))


### Performance Improvements

* **diff:** remove rename detection and untracked scan from diff-files endpoint ([89351be](https://github.com/MrVPlusOne/companion/commit/89351be747245593967219865fd0536f5e70a72e))
* **diff:** virtualize file list and defer content fetching ([9e35701](https://github.com/MrVPlusOne/companion/commit/9e35701931fd6c7f60c1119ed95f9950bcbd1039))
* **transcription:** raise enhancer threshold to 10 words ([4cd57f6](https://github.com/MrVPlusOne/companion/commit/4cd57f6422614cb8cd0d0178615373de953e86c9))
* **typecheck:** cache incremental tsc state ([be2bd6e](https://github.com/MrVPlusOne/companion/commit/be2bd6e0a1126629aa31c5abb52d827a6d364668))
* **ws-bridge:** fix event loop blocking in sendHistorySync (q-125) ([d67ba33](https://github.com/MrVPlusOne/companion/commit/d67ba339f214221be02adbcb772eaa7d41a7589c))


### Reverts

* **chat:** restore simple feed scrolling ([d104273](https://github.com/MrVPlusOne/companion/commit/d104273eff4934eb76355d10bd6251f4d2b0e34a))

## [0.46.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.45.0...the-companion-v0.46.0) (2026-02-16)


### Features

* **containers:** add Codex CLI support in Docker sessions ([#290](https://github.com/The-Vibe-Company/companion/issues/290)) ([992604b](https://github.com/The-Vibe-Company/companion/commit/992604b229542de87cacd8547c7d74955b05c5d8))


### Bug Fixes

* **sidebar:** separate scheduled runs from regular sessions ([#284](https://github.com/The-Vibe-Company/companion/issues/284)) ([cc0f042](https://github.com/The-Vibe-Company/companion/commit/cc0f042472363e40410728c550a7e6e2275ab80b))

## [0.45.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.44.1...the-companion-v0.45.0) (2026-02-16)


### Features

* **containers:** implement workspace isolation and git auth seeding in Docker sessions ([d651cc3](https://github.com/The-Vibe-Company/companion/commit/d651cc3144f65c939bdcb91f7f6900951a161552))
* **routing:** add session ID to URL hash for deep-linking ([#289](https://github.com/The-Vibe-Company/companion/issues/289)) ([ddd15ac](https://github.com/The-Vibe-Company/companion/commit/ddd15ac194390eb7b7bf4d7ff0850d71b2ff498a))
* **ui:** add full-screen session launch overlay ([#287](https://github.com/The-Vibe-Company/companion/issues/287)) ([0f31196](https://github.com/The-Vibe-Company/companion/commit/0f3119629de91271a0f3d92da2124f5028fe543b))


### Bug Fixes

* **ui:** cap textarea height and add overflow scroll for long prompts ([#285](https://github.com/The-Vibe-Company/companion/issues/285)) ([2b26bc7](https://github.com/The-Vibe-Company/companion/commit/2b26bc7b4122d22d29c821d9e1db29cce7dfbc64))

## [0.44.1](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.44.0...the-companion-v0.44.1) (2026-02-16)


### Bug Fixes

* **containers:** switch Docker registry from ghcr.io to Docker Hub ([525687e](https://github.com/The-Vibe-Company/companion/commit/525687e3e6d4eae3ab1125599c62881ee0ce80ac))

## [0.44.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.43.0...the-companion-v0.44.0) (2026-02-16)


### Features

* **containers:** pull Docker images from ghcr.io + session creation progress UI ([#281](https://github.com/The-Vibe-Company/companion/issues/281)) ([e87cfae](https://github.com/The-Vibe-Company/companion/commit/e87cfaed99010c37e12eca5adcaa30e8e5c07cb6))
* **containers:** replace git worktree isolation with Docker container-based sessions ([#277](https://github.com/The-Vibe-Company/companion/issues/277)) ([92a6172](https://github.com/The-Vibe-Company/companion/commit/92a6172db4bfa4bef613f21fa1bc243c848f7b9d))
* **containers:** seed git auth (gitconfig + gh token) in Docker sessions ([198be0e](https://github.com/The-Vibe-Company/companion/commit/198be0ef7465e3d355e34945fa67151e0457f096))


### Bug Fixes

* **ci:** only tag Docker image as :latest on version tags ([63ca679](https://github.com/The-Vibe-Company/companion/commit/63ca67934ab6d4a9024f5aa6031b4e059baeca79))
* **containers:** rewrite SSH git remotes to HTTPS inside containers ([6c867e3](https://github.com/The-Vibe-Company/companion/commit/6c867e36cc7b76a94c59e646ba37813b4aea651b))

## [0.43.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.42.0...the-companion-v0.43.0) (2026-02-15)


### Features

* **assistant:** add Companion — persistent AI assistant session ([#268](https://github.com/The-Vibe-Company/companion/issues/268)) ([ec0e90b](https://github.com/The-Vibe-Company/companion/commit/ec0e90b8b58f0ec09104590b182941a4d7c9b503))

## [0.42.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.41.0...the-companion-v0.42.0) (2026-02-15)


### Features

* **cron:** add scheduled task system for autonomous sessions ([#84](https://github.com/The-Vibe-Company/companion/issues/84)) ([e02c55a](https://github.com/The-Vibe-Company/companion/commit/e02c55a079bb0f81b71bc7a1fd44b23181d97bb1))

## [0.41.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.40.1...the-companion-v0.41.0) (2026-02-15)


### Features

* **server:** add always-on session recorder with line-based rotation ([#262](https://github.com/The-Vibe-Company/companion/issues/262)) ([369df07](https://github.com/The-Vibe-Company/companion/commit/369df07642f74f7abb523ed0323912f4f6b3d989))
* **ui:** enhanced tool rendering, tool_progress, and Codex session details ([#264](https://github.com/The-Vibe-Company/companion/issues/264)) ([a12963c](https://github.com/The-Vibe-Company/companion/commit/a12963cd014643fdd6785b03ad9e57016c1f7219))


### Bug Fixes

* **ui:** address review comments - stray 0 render, concurrent progress clearing ([#265](https://github.com/The-Vibe-Company/companion/issues/265)) ([6dfdee0](https://github.com/The-Vibe-Company/companion/commit/6dfdee0dbd25bc896e2c3ef37727021130da1808))

## [0.40.1](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.40.0...the-companion-v0.40.1) (2026-02-15)


### Reverts

* **plugins:** remove event-driven plugin runtime ([#260](https://github.com/The-Vibe-Company/companion/issues/260)) ([ea8011a](https://github.com/The-Vibe-Company/companion/commit/ea8011a714b9bdac096eb7bce8a6eca9b71e0eb1))

## [0.40.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.39.1...the-companion-v0.40.0) (2026-02-14)


### Features

* **plugins:** add event-driven plugin runtime with frontend integration ([#251](https://github.com/The-Vibe-Company/companion/issues/251)) ([fdc7418](https://github.com/The-Vibe-Company/companion/commit/fdc7418b7e0a0e17e31e0dbeaf45a7c0fad810cc))


### Bug Fixes

* **repo:** add tailored greptile code review rules ([#258](https://github.com/The-Vibe-Company/companion/issues/258)) ([2030e55](https://github.com/The-Vibe-Company/companion/commit/2030e553015800b757716393ada8fe2b1527f5bf))

## [0.39.1](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.39.0...the-companion-v0.39.1) (2026-02-14)


### Bug Fixes

* **ui:** keep session action controls visible on mobile ([#247](https://github.com/The-Vibe-Company/companion/issues/247)) ([209ac9a](https://github.com/The-Vibe-Company/companion/commit/209ac9a3f2d5bd99e3e2dbe46dc9eb7b10e40082))

## [0.39.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.38.0...the-companion-v0.39.0) (2026-02-14)


### Features

* **telemetry:** add posthog analytics, opt-out controls, and CI env wiring ([#238](https://github.com/The-Vibe-Company/companion/issues/238)) ([743aeab](https://github.com/The-Vibe-Company/companion/commit/743aeab86aa5b9141c86f605bbd3572694c80113))

## [0.38.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.37.2...the-companion-v0.38.0) (2026-02-13)


### Features

* **settings:** add application update controls to settings ([#234](https://github.com/The-Vibe-Company/companion/issues/234)) ([17760af](https://github.com/The-Vibe-Company/companion/commit/17760afb3cade5e325b7771cabbe0f78034512e5))


### Bug Fixes

* **landing:** focus messaging on codex, mcp, terminal and secure remote setup ([#237](https://github.com/The-Vibe-Company/companion/issues/237)) ([80759a7](https://github.com/The-Vibe-Company/companion/commit/80759a7ed3209d8aebf1e108d3e0c68d7bb8824f))

## [0.37.2](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.37.1...the-companion-v0.37.2) (2026-02-13)


### Bug Fixes

* **ws:** add durable replay cursors and idempotent message handling ([#232](https://github.com/The-Vibe-Company/companion/issues/232)) ([fba76e7](https://github.com/The-Vibe-Company/companion/commit/fba76e730ea5398a2df9dbda2167c32f49c7668f))

## [0.37.1](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.37.0...the-companion-v0.37.1) (2026-02-13)


### Bug Fixes

* **settings:** correct auto-renaming helper copy ([#230](https://github.com/The-Vibe-Company/companion/issues/230)) ([5da1586](https://github.com/The-Vibe-Company/companion/commit/5da15865508e6ae5bbcda45e149f64bc966b141c))

## [0.37.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.36.2...the-companion-v0.37.0) (2026-02-13)


### Features

* **ui:** show session name in top bar ([#228](https://github.com/The-Vibe-Company/companion/issues/228)) ([a9dc926](https://github.com/The-Vibe-Company/companion/commit/a9dc926d761c2dbbef741a2e7b05ecba29bd29b8))


### Bug Fixes

* **web:** compare file diffs against default branch ([#226](https://github.com/The-Vibe-Company/companion/issues/226)) ([b437d2c](https://github.com/The-Vibe-Company/companion/commit/b437d2c5705ee32cb4e7964dd1d33113d3470f9d))

## [0.36.2](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.36.1...the-companion-v0.36.2) (2026-02-13)


### Bug Fixes

* **cli-launcher:** bypass shebang to use correct Node for Codex ([#223](https://github.com/The-Vibe-Company/companion/issues/223)) ([9fe1583](https://github.com/The-Vibe-Company/companion/commit/9fe158358880789ec80ea5bd5daf738a261089dc))
* **ui:** move terminal, settings, and environments to full pages ([#224](https://github.com/The-Vibe-Company/companion/issues/224)) ([be1de35](https://github.com/The-Vibe-Company/companion/commit/be1de35e816ac782d4ba5c948f0b00abf0641f75))

## [0.36.1](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.36.0...the-companion-v0.36.1) (2026-02-13)


### Bug Fixes

* **cli-launcher:** pass enriched PATH to spawned CLI/Codex processes ([#221](https://github.com/The-Vibe-Company/companion/issues/221)) ([661e8b4](https://github.com/The-Vibe-Company/companion/commit/661e8b45d9909b9e59b0ecb396a4fb7a143f2816))

## [0.36.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.35.0...the-companion-v0.36.0) (2026-02-13)


### Features

* add Linux systemd support for service install/uninstall ([#169](https://github.com/The-Vibe-Company/companion/issues/169)) ([73fb3f7](https://github.com/The-Vibe-Company/companion/commit/73fb3f721efde79fec50f9c74a4f078f821c35d3))
* add MCP server management support ([#198](https://github.com/The-Vibe-Company/companion/issues/198)) ([018cf1f](https://github.com/The-Vibe-Company/companion/commit/018cf1f65ea5e281c19a39367f8cccf14ac56c1f))
* Add permission & plan approval E2E tests ([#6](https://github.com/The-Vibe-Company/companion/issues/6)) ([8590a68](https://github.com/The-Vibe-Company/companion/commit/8590a68657f0a06e94795a179ad4bbedae782c63))
* add release-please for automated npm publishing ([#24](https://github.com/The-Vibe-Company/companion/issues/24)) ([93b24ee](https://github.com/The-Vibe-Company/companion/commit/93b24ee4a12b3f32e81f59a348b25e89aaa86dce))
* allow dev server access over Tailscale/LAN ([#33](https://github.com/The-Vibe-Company/companion/issues/33)) ([9599d7a](https://github.com/The-Vibe-Company/companion/commit/9599d7ad4e2823d51c8fa262e1dcd96eeb056244))
* claude.md update ([7fa4e7a](https://github.com/The-Vibe-Company/companion/commit/7fa4e7adfdc7c409cfeed4e8a11f237ff0572234))
* **cli:** add service install/uninstall and separate dev/prod ports ([#155](https://github.com/The-Vibe-Company/companion/issues/155)) ([a4e5ba6](https://github.com/The-Vibe-Company/companion/commit/a4e5ba6ced2cc8041f61b303b0205f36e50b7594))
* **cli:** add stop and restart service commands ([#185](https://github.com/The-Vibe-Company/companion/issues/185)) ([04da8e5](https://github.com/The-Vibe-Company/companion/commit/04da8e5a3d3f0e363f662cdd6bca6145eaec479f))
* **cli:** start and stop Companion via daemon service ([#201](https://github.com/The-Vibe-Company/companion/issues/201)) ([39e2b79](https://github.com/The-Vibe-Company/companion/commit/39e2b79a6dbb70e7c7dcaf3ccbaf2116ac26b43a))
* **codex:** add offline protocol compatibility guardrails and playground coverage ([#194](https://github.com/The-Vibe-Company/companion/issues/194)) ([bf0a43e](https://github.com/The-Vibe-Company/companion/commit/bf0a43e5fdc791166e76391c0ee1ad3cf18dae10))
* Corriger menu dossier mobile et décalage clavier ([#151](https://github.com/The-Vibe-Company/companion/issues/151)) ([8068925](https://github.com/The-Vibe-Company/companion/commit/8068925f6a5ec5c6b7a40b36398bd4f9be04708d))
* e2e permissions plans ([#9](https://github.com/The-Vibe-Company/companion/issues/9)) ([53b38bf](https://github.com/The-Vibe-Company/companion/commit/53b38bfd4e773454492a3fea10e8db7ffd3fd768))
* Fix Diffs panel for worktree/relative paths and untracked files ([#165](https://github.com/The-Vibe-Company/companion/issues/165)) ([6810643](https://github.com/The-Vibe-Company/companion/commit/681064328d2bf3f4fc5c3a1867abc1536d2d54f3))
* Hide successful no-output command results ([#139](https://github.com/The-Vibe-Company/companion/issues/139)) ([a66e386](https://github.com/The-Vibe-Company/companion/commit/a66e386491e6887c5684cd70f63cc49cac0a64b7))
* **landing:** add marketing landing page for thecompanion.sh ([#128](https://github.com/The-Vibe-Company/companion/issues/128)) ([170b89c](https://github.com/The-Vibe-Company/companion/commit/170b89c72012dfb0ba68239a7665634d65275aa3))
* OpenRouter-based session auto-naming + settings page ([#168](https://github.com/The-Vibe-Company/companion/issues/168)) ([a86b1e7](https://github.com/The-Vibe-Company/companion/commit/a86b1e711ff1c38985bb3d622c6ec372a266637e))
* protocol conformance fixes and improved E2E tests ([#14](https://github.com/The-Vibe-Company/companion/issues/14)) ([51b13b9](https://github.com/The-Vibe-Company/companion/commit/51b13b9d647de6c92881b1abb61161f39152e0ef))
* Redesign README as a landing page with API-first documentation ([#7](https://github.com/The-Vibe-Company/companion/issues/7)) ([a59e1b4](https://github.com/The-Vibe-Company/companion/commit/a59e1b4604baf87faa32af7d62e4846afae49dbe))
* **sidebar:** group sound and alerts under notification ([#203](https://github.com/The-Vibe-Company/companion/issues/203)) ([0077e75](https://github.com/The-Vibe-Company/companion/commit/0077e75208e7505a53db8a829a9480a77b8c3916))
* simplified claude() API, unified endpoints, and landing page README ([#12](https://github.com/The-Vibe-Company/companion/issues/12)) ([aa2e535](https://github.com/The-Vibe-Company/companion/commit/aa2e535fe0a83b726ff2a2c08359e55973a9136b))
* The Vibe Companion complete web UI rewrite + npm package ([#23](https://github.com/The-Vibe-Company/companion/issues/23)) ([0bdc77a](https://github.com/The-Vibe-Company/companion/commit/0bdc77a81b21cd9d08ba29ea48844e73df3a1852))
* trigger release for statusline capture ([#19](https://github.com/The-Vibe-Company/companion/issues/19)) ([cedc9df](https://github.com/The-Vibe-Company/companion/commit/cedc9dfb7445344bdb43a1a756f1d2e538e08c76))
* **web:** adaptive server-side PR polling with WebSocket push ([#178](https://github.com/The-Vibe-Company/companion/issues/178)) ([57939e4](https://github.com/The-Vibe-Company/companion/commit/57939e4030a4b0e5a7dae39d93c34944e3bdff0f))
* **web:** add browser web notifications ([#191](https://github.com/The-Vibe-Company/companion/issues/191)) ([092c59a](https://github.com/The-Vibe-Company/companion/commit/092c59aff620aa2b2eac51903c01ad7cb0c4bc8e))
* **web:** add CLAUDE.md editor button in TopBar ([#170](https://github.com/The-Vibe-Company/companion/issues/170)) ([f553b9b](https://github.com/The-Vibe-Company/companion/commit/f553b9b86842f0b47c0bf24b08903e0352b7b078))
* **web:** add Clawd-inspired pixel art logo and favicon ([#70](https://github.com/The-Vibe-Company/companion/issues/70)) ([b3994ef](https://github.com/The-Vibe-Company/companion/commit/b3994eff2eac62c3cf8f40a8c31b720c910a7601))
* **web:** add component playground and ExitPlanMode display ([#36](https://github.com/The-Vibe-Company/companion/issues/36)) ([e958be7](https://github.com/The-Vibe-Company/companion/commit/e958be780f1b6e1a8f65daedbf968cdf6ef47798))
* **web:** add embedded code editor with file tree, changed files tracking, and diff view ([#81](https://github.com/The-Vibe-Company/companion/issues/81)) ([3ed0957](https://github.com/The-Vibe-Company/companion/commit/3ed095790c73edeef911ab4c73d74f1998100c5c))
* **web:** add embedded terminal in sidebar ([#175](https://github.com/The-Vibe-Company/companion/issues/175)) ([e711c5d](https://github.com/The-Vibe-Company/companion/commit/e711c5d5ef40edfa9c265642383a4c526b9b3ece))
* **web:** add git worktree support for isolated multi-branch sessions ([#64](https://github.com/The-Vibe-Company/companion/issues/64)) ([fee39d6](https://github.com/The-Vibe-Company/companion/commit/fee39d62986cd99700ba78c84a1f586331955ff8))
* **web:** add GitHub PR status to TaskPanel sidebar ([#166](https://github.com/The-Vibe-Company/companion/issues/166)) ([6ace3b2](https://github.com/The-Vibe-Company/companion/commit/6ace3b2944ec9e9082a11a45fe0798f0f5f41e55))
* **web:** add missing message-flow components to Playground ([#156](https://github.com/The-Vibe-Company/companion/issues/156)) ([ef6c27d](https://github.com/The-Vibe-Company/companion/commit/ef6c27dfa950c11b09394c74c4452c0b02aed8fb))
* **web:** add notification sound on task completion ([#99](https://github.com/The-Vibe-Company/companion/issues/99)) ([337c735](https://github.com/The-Vibe-Company/companion/commit/337c735e8267f076ada4b9ef01632d37376ec2d0))
* **web:** add OpenAI Codex CLI backend integration ([#100](https://github.com/The-Vibe-Company/companion/issues/100)) ([54e3c1a](https://github.com/The-Vibe-Company/companion/commit/54e3c1a2b359719d7983fa9ee857507e1446f505))
* **web:** add per-session usage limits with OAuth refresh and Codex support ([24ebd32](https://github.com/The-Vibe-Company/companion/commit/24ebd32f5ec617290b6b93e8bc76972a3b80d6a9))
* **web:** add permission suggestions and pending permission indicators ([10422c1](https://github.com/The-Vibe-Company/companion/commit/10422c1464b6ad4bc45eb90e6cd9ebbc0ebeac92))
* **web:** add PWA support for mobile home screen install ([#116](https://github.com/The-Vibe-Company/companion/issues/116)) ([85e605f](https://github.com/The-Vibe-Company/companion/commit/85e605fd758ee952e0d5b1dbc6f7065b514844a7))
* **web:** add update-available banner with auto-update for service mode ([#158](https://github.com/The-Vibe-Company/companion/issues/158)) ([727bd7f](https://github.com/The-Vibe-Company/companion/commit/727bd7fbd16557fd63ce41632592c1485e69713c))
* **web:** add usage limits display in session panel ([#97](https://github.com/The-Vibe-Company/companion/issues/97)) ([d29f489](https://github.com/The-Vibe-Company/companion/commit/d29f489ed9951d36ff45ec240410ffd8ffdf05eb))
* **web:** archive sessions instead of deleting them ([#56](https://github.com/The-Vibe-Company/companion/issues/56)) ([489d608](https://github.com/The-Vibe-Company/companion/commit/489d6087fc99b9131386547edaf3bd303a114090))
* **web:** enlarge homepage logo as hero element ([#71](https://github.com/The-Vibe-Company/companion/issues/71)) ([18ead74](https://github.com/The-Vibe-Company/companion/commit/18ead7436d3ebbe9d766754ddb17aa504c63703f))
* **web:** git fetch on branch picker open ([#72](https://github.com/The-Vibe-Company/companion/issues/72)) ([f110405](https://github.com/The-Vibe-Company/companion/commit/f110405edbd0f00454edd65ed72197daf0293182))
* **web:** git info display, folder dropdown fix, dev workflow ([#43](https://github.com/The-Vibe-Company/companion/issues/43)) ([1fe2069](https://github.com/The-Vibe-Company/companion/commit/1fe2069a7db17b410e383f883c934ee1662c2171))
* **web:** git worktree support with branch picker and git pull ([#65](https://github.com/The-Vibe-Company/companion/issues/65)) ([4d0c9c8](https://github.com/The-Vibe-Company/companion/commit/4d0c9c83f4fe13be863313d6c945ce0b671a7f8a))
* **web:** group sidebar sessions by project directory ([#117](https://github.com/The-Vibe-Company/companion/issues/117)) ([deceb59](https://github.com/The-Vibe-Company/companion/commit/deceb599975f53141e9c0bd6c7675437f96978b8))
* **web:** named environment profiles (~/.companion/envs/) ([#50](https://github.com/The-Vibe-Company/companion/issues/50)) ([eaa1a49](https://github.com/The-Vibe-Company/companion/commit/eaa1a497f3be61f2f71f9467e93fa2b65be19095))
* **web:** persist sessions to disk for dev mode resilience ([#45](https://github.com/The-Vibe-Company/companion/issues/45)) ([c943d00](https://github.com/The-Vibe-Company/companion/commit/c943d0047b728854f059e26facde950e08cdfe0c))
* **web:** redesign session list with avatars, auto-reconnect, and git info ([#111](https://github.com/The-Vibe-Company/companion/issues/111)) ([8a7284b](https://github.com/The-Vibe-Company/companion/commit/8a7284b3c08dc301a879924aea133945697b037a))
* **web:** replace CodeMirror editor with unified diff viewer ([#160](https://github.com/The-Vibe-Company/companion/issues/160)) ([f9b6869](https://github.com/The-Vibe-Company/companion/commit/f9b686902011ffd194a118cc1cb022bac71eaa3b))
* **web:** replace folder picker dropdown with fixed-size modal ([#76](https://github.com/The-Vibe-Company/companion/issues/76)) ([979e395](https://github.com/The-Vibe-Company/companion/commit/979e395b530cdb21e6a073ba60e33ea8ac497e2a))
* **web:** session rename persistence + auto-generated titles ([#79](https://github.com/The-Vibe-Company/companion/issues/79)) ([e1dc58c](https://github.com/The-Vibe-Company/companion/commit/e1dc58ce8ab9a619d36f2261cce89b90cfdb70d6))
* **web:** warn when branch is behind remote before session creation ([#127](https://github.com/The-Vibe-Company/companion/issues/127)) ([ef89d5c](https://github.com/The-Vibe-Company/companion/commit/ef89d5c208ca5da006aaa88b78dbd647186fb0df))


### Bug Fixes

* add web/dist to gitignore ([#2](https://github.com/The-Vibe-Company/companion/issues/2)) ([b9ac264](https://github.com/The-Vibe-Company/companion/commit/b9ac264fbb99415517636517e8f503d40fe3253d))
* always update statusLine settings on agent spawn ([#21](https://github.com/The-Vibe-Company/companion/issues/21)) ([71c343c](https://github.com/The-Vibe-Company/companion/commit/71c343cfd29fff3204ad0cc2986ff000d1be5adc))
* auto-accept workspace trust prompt and handle idle in ask() ([#16](https://github.com/The-Vibe-Company/companion/issues/16)) ([ded31b4](https://github.com/The-Vibe-Company/companion/commit/ded31b4cf9900f7ed8c3ff373ef16ae8f1e8a886))
* checkout selected branch when worktree mode is off ([#68](https://github.com/The-Vibe-Company/companion/issues/68)) ([500f3b1](https://github.com/The-Vibe-Company/companion/commit/500f3b112c5ccc646c7965344b5774efe1338377))
* **cli:** auto-update restarts service reliably via explicit systemctl/launchctl ([#208](https://github.com/The-Vibe-Company/companion/issues/208)) ([33fa67e](https://github.com/The-Vibe-Company/companion/commit/33fa67ebd75609b9a7b8700ce67b1dd949663b06))
* **cli:** expose stop/restart in help and add test ([#188](https://github.com/The-Vibe-Company/companion/issues/188)) ([c307525](https://github.com/The-Vibe-Company/companion/commit/c30752545f2137fd7c03525d5bb7f5f8851271d4))
* **cli:** fix Linux systemd service management (start, auto-restart) ([#213](https://github.com/The-Vibe-Company/companion/issues/213)) ([fc1dd65](https://github.com/The-Vibe-Company/companion/commit/fc1dd65a9fd32958d47499af1b35992a0c10fe8e))
* **cli:** refresh systemd unit file on start/restart to prevent restart loops ([#215](https://github.com/The-Vibe-Company/companion/issues/215)) ([35f80d9](https://github.com/The-Vibe-Company/companion/commit/35f80d963b1f0f0feccf7215a9bd4711b4520a12))
* **cli:** resolve binaries via user shell PATH when running as service ([#216](https://github.com/The-Vibe-Company/companion/issues/216)) ([47e4967](https://github.com/The-Vibe-Company/companion/commit/47e4967215a5bfd84c8afc2a86ce42151c73d187))
* **codex:** fix 3 critical bugs in Codex backend integration ([#147](https://github.com/The-Vibe-Company/companion/issues/147)) ([0ec92db](https://github.com/The-Vibe-Company/companion/commit/0ec92db909c7be42f94cc21d2890c9c123702dd7))
* **codex:** handle init failure gracefully and isolate per-session CODEX_HOME ([#210](https://github.com/The-Vibe-Company/companion/issues/210)) ([f4efcea](https://github.com/The-Vibe-Company/companion/commit/f4efceace6c260de92df728335678b7bded3e144))
* make service stop actually stop on macOS and refresh stale update checks ([#192](https://github.com/The-Vibe-Company/companion/issues/192)) ([f608f64](https://github.com/The-Vibe-Company/companion/commit/f608f64887bf78b2cca909aa20bd87e4a897ce94))
* remove vibe alias, update repo URLs to companion ([#30](https://github.com/The-Vibe-Company/companion/issues/30)) ([4f7b47c](https://github.com/The-Vibe-Company/companion/commit/4f7b47cba86c278e89fe81292fea9b8b3e75c035))
* scope permission requests to their session tab ([#35](https://github.com/The-Vibe-Company/companion/issues/35)) ([ef9f41c](https://github.com/The-Vibe-Company/companion/commit/ef9f41c8589e382de1db719984931bc4e91aeb11))
* show pasted images in chat history ([#32](https://github.com/The-Vibe-Company/companion/issues/32)) ([46365be](https://github.com/The-Vibe-Company/companion/commit/46365be45ae8b325100ed296617455c105d4d52e))
* **sidebar:** nest notification toggles behind disclosure ([#207](https://github.com/The-Vibe-Company/companion/issues/207)) ([87e71b8](https://github.com/The-Vibe-Company/companion/commit/87e71b8f5bf3e47c96421bca315ac412934a7dc2))
* **task-panel:** enable scrolling for long MCP sections ([#204](https://github.com/The-Vibe-Company/companion/issues/204)) ([b98abbb](https://github.com/The-Vibe-Company/companion/commit/b98abbbea4355c7e91d4dc322e53e638f4e4c542))
* track all commits in release-please, not just web/ ([#27](https://github.com/The-Vibe-Company/companion/issues/27)) ([d49f649](https://github.com/The-Vibe-Company/companion/commit/d49f64996d02807baf0482ce3c3607ae59f78638))
* use correct secret name NPM_PUBLISH_TOKEN in publish workflow ([e296ab0](https://github.com/The-Vibe-Company/companion/commit/e296ab0fabd6345b1f21c7094ca1f8d6f6af79cb))
* use correct secret name NPM_PUBLISH_TOKEN in publish workflow ([#26](https://github.com/The-Vibe-Company/companion/issues/26)) ([61eed5a](https://github.com/The-Vibe-Company/companion/commit/61eed5addd6e332fac360d9ae8239f1b0f93868e))
* use random suffixes for worktree branch names ([#88](https://github.com/The-Vibe-Company/companion/issues/88)) ([0b79f9a](https://github.com/The-Vibe-Company/companion/commit/0b79f9af172595cb84810b5d4cd65e0ed9c8e23d))
* **web:** always generate unique branch names for worktrees with forceNew ([#131](https://github.com/The-Vibe-Company/companion/issues/131)) ([cd62d4a](https://github.com/The-Vibe-Company/companion/commit/cd62d4ac8fae0b56cdef0ff850eab4a8c707f99b))
* **web:** chat scroll and composer visibility in plan mode ([#55](https://github.com/The-Vibe-Company/companion/issues/55)) ([4cff10c](https://github.com/The-Vibe-Company/companion/commit/4cff10cde297b7142c088584b6dd83060902c526))
* **web:** deduplicate messages on WebSocket reconnection ([#150](https://github.com/The-Vibe-Company/companion/issues/150)) ([a81bb3d](https://github.com/The-Vibe-Company/companion/commit/a81bb3d878957f1f18234a5f9194d1d8064f795c))
* **web:** default folder picker to home directory instead of server cwd ([#122](https://github.com/The-Vibe-Company/companion/issues/122)) ([7b8a4c7](https://github.com/The-Vibe-Company/companion/commit/7b8a4c71f32c68ffcc907269e88b3711c0d5af7a))
* **web:** enable codex web search when internet toggle is on ([#135](https://github.com/The-Vibe-Company/companion/issues/135)) ([8d9f0b0](https://github.com/The-Vibe-Company/companion/commit/8d9f0b002dcafcfc020862cb107777d75fc2580e))
* **web:** fetch and pull selected branch on session create ([#137](https://github.com/The-Vibe-Company/companion/issues/137)) ([9cdbbe1](https://github.com/The-Vibe-Company/companion/commit/9cdbbe1e151f024bd41f60e20c60e2f092ba7014))
* **web:** fix Codex approval policy and Composer mode labels ([#106](https://github.com/The-Vibe-Company/companion/issues/106)) ([fd5c2f1](https://github.com/The-Vibe-Company/companion/commit/fd5c2f15b144eb2ae9ec809fdb6ee19e797dc15a))
* **web:** fix session auto-rename and add blur-to-focus animation ([#86](https://github.com/The-Vibe-Company/companion/issues/86)) ([6d3c91f](https://github.com/The-Vibe-Company/companion/commit/6d3c91f73a65054e2c15727e90ca554af70eed28))
* **web:** fix WritableStream locked race condition in Codex adapter ([b43569d](https://github.com/The-Vibe-Company/companion/commit/b43569dbb3d154a303d60ec6bc2007b5a7bcedea))
* **web:** improve light mode contrast ([#89](https://github.com/The-Vibe-Company/companion/issues/89)) ([7ac7886](https://github.com/The-Vibe-Company/companion/commit/7ac7886fc6305e3ec45698a1c7c91b72a91c7c44))
* **web:** improve responsive design across all components ([#85](https://github.com/The-Vibe-Company/companion/issues/85)) ([0750fbb](https://github.com/The-Vibe-Company/companion/commit/0750fbbbe456d79bc104fdbdaf8f08e8795a3b62))
* **web:** isolate worktree sessions with proper branch-tracking ([#74](https://github.com/The-Vibe-Company/companion/issues/74)) ([764d7a7](https://github.com/The-Vibe-Company/companion/commit/764d7a7f5391a686408a8542421f771da341d5db))
* **web:** polyfill localStorage for Node.js 22+ ([#149](https://github.com/The-Vibe-Company/companion/issues/149)) ([602c684](https://github.com/The-Vibe-Company/companion/commit/602c6841f03677ec3f419860469e39b791968de6))
* **web:** prevent iOS auto-zoom on mobile input focus ([#102](https://github.com/The-Vibe-Company/companion/issues/102)) ([18ee23f](https://github.com/The-Vibe-Company/companion/commit/18ee23f6f1674fbcf5e1be25f8c4e23510bc12b5))
* **web:** prevent mobile keyboard layout shift and iOS zoom on branch selector ([#159](https://github.com/The-Vibe-Company/companion/issues/159)) ([4276afd](https://github.com/The-Vibe-Company/companion/commit/4276afd4390808d9d040555652c80bd1461c45b7))
* **web:** refresh git branch tracking after session start ([#195](https://github.com/The-Vibe-Company/companion/issues/195)) ([c3cb47b](https://github.com/The-Vibe-Company/companion/commit/c3cb47b56257b866b76abbb66709694cb26e0925))
* **web:** resolve [object Object] display for Codex file edit results ([#133](https://github.com/The-Vibe-Company/companion/issues/133)) ([9cc21a7](https://github.com/The-Vibe-Company/companion/commit/9cc21a78064cf07bb90174dd87bbfbd367516c90))
* **web:** resolve original repo root for worktree sessions in sidebar grouping ([#120](https://github.com/The-Vibe-Company/companion/issues/120)) ([8925ac9](https://github.com/The-Vibe-Company/companion/commit/8925ac9f540b3cd2520268539d21b0267b2dadb1))
* **web:** session reconnection with auto-relaunch and persist ([#49](https://github.com/The-Vibe-Company/companion/issues/49)) ([f58e542](https://github.com/The-Vibe-Company/companion/commit/f58e5428847a342069e6790fa7d70f190bc5f396))
* **web:** stable session ordering — sort by creation date only ([#173](https://github.com/The-Vibe-Company/companion/issues/173)) ([05c3a06](https://github.com/The-Vibe-Company/companion/commit/05c3a0652b823c5ca20b233be164a899f9920caf))
* **web:** unset CLAUDECODE env var to prevent CLI nesting guard rejec… ([#181](https://github.com/The-Vibe-Company/companion/issues/181)) ([75e264a](https://github.com/The-Vibe-Company/companion/commit/75e264a0be975dadbf3d56e64b990e0e07b12777))
* **web:** use --resume on CLI relaunch to restore conversation context ([#46](https://github.com/The-Vibe-Company/companion/issues/46)) ([3e2b5bd](https://github.com/The-Vibe-Company/companion/commit/3e2b5bdd39bd265ca5675784227a9f1b4f2a8aa3))

## [0.35.0](https://github.com/The-Vibe-Company/companion/compare/thecompanion-v0.34.5...thecompanion-v0.35.0) (2026-02-13)


### Features

* add Linux systemd support for service install/uninstall ([#169](https://github.com/The-Vibe-Company/companion/issues/169)) ([73fb3f7](https://github.com/The-Vibe-Company/companion/commit/73fb3f721efde79fec50f9c74a4f078f821c35d3))
* add MCP server management support ([#198](https://github.com/The-Vibe-Company/companion/issues/198)) ([018cf1f](https://github.com/The-Vibe-Company/companion/commit/018cf1f65ea5e281c19a39367f8cccf14ac56c1f))
* Add permission & plan approval E2E tests ([#6](https://github.com/The-Vibe-Company/companion/issues/6)) ([8590a68](https://github.com/The-Vibe-Company/companion/commit/8590a68657f0a06e94795a179ad4bbedae782c63))
* add release-please for automated npm publishing ([#24](https://github.com/The-Vibe-Company/companion/issues/24)) ([93b24ee](https://github.com/The-Vibe-Company/companion/commit/93b24ee4a12b3f32e81f59a348b25e89aaa86dce))
* allow dev server access over Tailscale/LAN ([#33](https://github.com/The-Vibe-Company/companion/issues/33)) ([9599d7a](https://github.com/The-Vibe-Company/companion/commit/9599d7ad4e2823d51c8fa262e1dcd96eeb056244))
* claude.md update ([7fa4e7a](https://github.com/The-Vibe-Company/companion/commit/7fa4e7adfdc7c409cfeed4e8a11f237ff0572234))
* **cli:** add service install/uninstall and separate dev/prod ports ([#155](https://github.com/The-Vibe-Company/companion/issues/155)) ([a4e5ba6](https://github.com/The-Vibe-Company/companion/commit/a4e5ba6ced2cc8041f61b303b0205f36e50b7594))
* **cli:** add stop and restart service commands ([#185](https://github.com/The-Vibe-Company/companion/issues/185)) ([04da8e5](https://github.com/The-Vibe-Company/companion/commit/04da8e5a3d3f0e363f662cdd6bca6145eaec479f))
* **cli:** start and stop Companion via daemon service ([#201](https://github.com/The-Vibe-Company/companion/issues/201)) ([39e2b79](https://github.com/The-Vibe-Company/companion/commit/39e2b79a6dbb70e7c7dcaf3ccbaf2116ac26b43a))
* **codex:** add offline protocol compatibility guardrails and playground coverage ([#194](https://github.com/The-Vibe-Company/companion/issues/194)) ([bf0a43e](https://github.com/The-Vibe-Company/companion/commit/bf0a43e5fdc791166e76391c0ee1ad3cf18dae10))
* Corriger menu dossier mobile et décalage clavier ([#151](https://github.com/The-Vibe-Company/companion/issues/151)) ([8068925](https://github.com/The-Vibe-Company/companion/commit/8068925f6a5ec5c6b7a40b36398bd4f9be04708d))
* e2e permissions plans ([#9](https://github.com/The-Vibe-Company/companion/issues/9)) ([53b38bf](https://github.com/The-Vibe-Company/companion/commit/53b38bfd4e773454492a3fea10e8db7ffd3fd768))
* Fix Diffs panel for worktree/relative paths and untracked files ([#165](https://github.com/The-Vibe-Company/companion/issues/165)) ([6810643](https://github.com/The-Vibe-Company/companion/commit/681064328d2bf3f4fc5c3a1867abc1536d2d54f3))
* Hide successful no-output command results ([#139](https://github.com/The-Vibe-Company/companion/issues/139)) ([a66e386](https://github.com/The-Vibe-Company/companion/commit/a66e386491e6887c5684cd70f63cc49cac0a64b7))
* **landing:** add marketing landing page for thecompanion.sh ([#128](https://github.com/The-Vibe-Company/companion/issues/128)) ([170b89c](https://github.com/The-Vibe-Company/companion/commit/170b89c72012dfb0ba68239a7665634d65275aa3))
* OpenRouter-based session auto-naming + settings page ([#168](https://github.com/The-Vibe-Company/companion/issues/168)) ([a86b1e7](https://github.com/The-Vibe-Company/companion/commit/a86b1e711ff1c38985bb3d622c6ec372a266637e))
* protocol conformance fixes and improved E2E tests ([#14](https://github.com/The-Vibe-Company/companion/issues/14)) ([51b13b9](https://github.com/The-Vibe-Company/companion/commit/51b13b9d647de6c92881b1abb61161f39152e0ef))
* Redesign README as a landing page with API-first documentation ([#7](https://github.com/The-Vibe-Company/companion/issues/7)) ([a59e1b4](https://github.com/The-Vibe-Company/companion/commit/a59e1b4604baf87faa32af7d62e4846afae49dbe))
* **sidebar:** group sound and alerts under notification ([#203](https://github.com/The-Vibe-Company/companion/issues/203)) ([0077e75](https://github.com/The-Vibe-Company/companion/commit/0077e75208e7505a53db8a829a9480a77b8c3916))
* simplified claude() API, unified endpoints, and landing page README ([#12](https://github.com/The-Vibe-Company/companion/issues/12)) ([aa2e535](https://github.com/The-Vibe-Company/companion/commit/aa2e535fe0a83b726ff2a2c08359e55973a9136b))
* The Vibe Companion complete web UI rewrite + npm package ([#23](https://github.com/The-Vibe-Company/companion/issues/23)) ([0bdc77a](https://github.com/The-Vibe-Company/companion/commit/0bdc77a81b21cd9d08ba29ea48844e73df3a1852))
* trigger release for statusline capture ([#19](https://github.com/The-Vibe-Company/companion/issues/19)) ([cedc9df](https://github.com/The-Vibe-Company/companion/commit/cedc9dfb7445344bdb43a1a756f1d2e538e08c76))
* **web:** adaptive server-side PR polling with WebSocket push ([#178](https://github.com/The-Vibe-Company/companion/issues/178)) ([57939e4](https://github.com/The-Vibe-Company/companion/commit/57939e4030a4b0e5a7dae39d93c34944e3bdff0f))
* **web:** add browser web notifications ([#191](https://github.com/The-Vibe-Company/companion/issues/191)) ([092c59a](https://github.com/The-Vibe-Company/companion/commit/092c59aff620aa2b2eac51903c01ad7cb0c4bc8e))
* **web:** add CLAUDE.md editor button in TopBar ([#170](https://github.com/The-Vibe-Company/companion/issues/170)) ([f553b9b](https://github.com/The-Vibe-Company/companion/commit/f553b9b86842f0b47c0bf24b08903e0352b7b078))
* **web:** add Clawd-inspired pixel art logo and favicon ([#70](https://github.com/The-Vibe-Company/companion/issues/70)) ([b3994ef](https://github.com/The-Vibe-Company/companion/commit/b3994eff2eac62c3cf8f40a8c31b720c910a7601))
* **web:** add component playground and ExitPlanMode display ([#36](https://github.com/The-Vibe-Company/companion/issues/36)) ([e958be7](https://github.com/The-Vibe-Company/companion/commit/e958be780f1b6e1a8f65daedbf968cdf6ef47798))
* **web:** add embedded code editor with file tree, changed files tracking, and diff view ([#81](https://github.com/The-Vibe-Company/companion/issues/81)) ([3ed0957](https://github.com/The-Vibe-Company/companion/commit/3ed095790c73edeef911ab4c73d74f1998100c5c))
* **web:** add embedded terminal in sidebar ([#175](https://github.com/The-Vibe-Company/companion/issues/175)) ([e711c5d](https://github.com/The-Vibe-Company/companion/commit/e711c5d5ef40edfa9c265642383a4c526b9b3ece))
* **web:** add git worktree support for isolated multi-branch sessions ([#64](https://github.com/The-Vibe-Company/companion/issues/64)) ([fee39d6](https://github.com/The-Vibe-Company/companion/commit/fee39d62986cd99700ba78c84a1f586331955ff8))
* **web:** add GitHub PR status to TaskPanel sidebar ([#166](https://github.com/The-Vibe-Company/companion/issues/166)) ([6ace3b2](https://github.com/The-Vibe-Company/companion/commit/6ace3b2944ec9e9082a11a45fe0798f0f5f41e55))
* **web:** add missing message-flow components to Playground ([#156](https://github.com/The-Vibe-Company/companion/issues/156)) ([ef6c27d](https://github.com/The-Vibe-Company/companion/commit/ef6c27dfa950c11b09394c74c4452c0b02aed8fb))
* **web:** add notification sound on task completion ([#99](https://github.com/The-Vibe-Company/companion/issues/99)) ([337c735](https://github.com/The-Vibe-Company/companion/commit/337c735e8267f076ada4b9ef01632d37376ec2d0))
* **web:** add OpenAI Codex CLI backend integration ([#100](https://github.com/The-Vibe-Company/companion/issues/100)) ([54e3c1a](https://github.com/The-Vibe-Company/companion/commit/54e3c1a2b359719d7983fa9ee857507e1446f505))
* **web:** add per-session usage limits with OAuth refresh and Codex support ([24ebd32](https://github.com/The-Vibe-Company/companion/commit/24ebd32f5ec617290b6b93e8bc76972a3b80d6a9))
* **web:** add permission suggestions and pending permission indicators ([10422c1](https://github.com/The-Vibe-Company/companion/commit/10422c1464b6ad4bc45eb90e6cd9ebbc0ebeac92))
* **web:** add PWA support for mobile home screen install ([#116](https://github.com/The-Vibe-Company/companion/issues/116)) ([85e605f](https://github.com/The-Vibe-Company/companion/commit/85e605fd758ee952e0d5b1dbc6f7065b514844a7))
* **web:** add update-available banner with auto-update for service mode ([#158](https://github.com/The-Vibe-Company/companion/issues/158)) ([727bd7f](https://github.com/The-Vibe-Company/companion/commit/727bd7fbd16557fd63ce41632592c1485e69713c))
* **web:** add usage limits display in session panel ([#97](https://github.com/The-Vibe-Company/companion/issues/97)) ([d29f489](https://github.com/The-Vibe-Company/companion/commit/d29f489ed9951d36ff45ec240410ffd8ffdf05eb))
* **web:** archive sessions instead of deleting them ([#56](https://github.com/The-Vibe-Company/companion/issues/56)) ([489d608](https://github.com/The-Vibe-Company/companion/commit/489d6087fc99b9131386547edaf3bd303a114090))
* **web:** enlarge homepage logo as hero element ([#71](https://github.com/The-Vibe-Company/companion/issues/71)) ([18ead74](https://github.com/The-Vibe-Company/companion/commit/18ead7436d3ebbe9d766754ddb17aa504c63703f))
* **web:** git fetch on branch picker open ([#72](https://github.com/The-Vibe-Company/companion/issues/72)) ([f110405](https://github.com/The-Vibe-Company/companion/commit/f110405edbd0f00454edd65ed72197daf0293182))
* **web:** git info display, folder dropdown fix, dev workflow ([#43](https://github.com/The-Vibe-Company/companion/issues/43)) ([1fe2069](https://github.com/The-Vibe-Company/companion/commit/1fe2069a7db17b410e383f883c934ee1662c2171))
* **web:** git worktree support with branch picker and git pull ([#65](https://github.com/The-Vibe-Company/companion/issues/65)) ([4d0c9c8](https://github.com/The-Vibe-Company/companion/commit/4d0c9c83f4fe13be863313d6c945ce0b671a7f8a))
* **web:** group sidebar sessions by project directory ([#117](https://github.com/The-Vibe-Company/companion/issues/117)) ([deceb59](https://github.com/The-Vibe-Company/companion/commit/deceb599975f53141e9c0bd6c7675437f96978b8))
* **web:** named environment profiles (~/.companion/envs/) ([#50](https://github.com/The-Vibe-Company/companion/issues/50)) ([eaa1a49](https://github.com/The-Vibe-Company/companion/commit/eaa1a497f3be61f2f71f9467e93fa2b65be19095))
* **web:** persist sessions to disk for dev mode resilience ([#45](https://github.com/The-Vibe-Company/companion/issues/45)) ([c943d00](https://github.com/The-Vibe-Company/companion/commit/c943d0047b728854f059e26facde950e08cdfe0c))
* **web:** redesign session list with avatars, auto-reconnect, and git info ([#111](https://github.com/The-Vibe-Company/companion/issues/111)) ([8a7284b](https://github.com/The-Vibe-Company/companion/commit/8a7284b3c08dc301a879924aea133945697b037a))
* **web:** replace CodeMirror editor with unified diff viewer ([#160](https://github.com/The-Vibe-Company/companion/issues/160)) ([f9b6869](https://github.com/The-Vibe-Company/companion/commit/f9b686902011ffd194a118cc1cb022bac71eaa3b))
* **web:** replace folder picker dropdown with fixed-size modal ([#76](https://github.com/The-Vibe-Company/companion/issues/76)) ([979e395](https://github.com/The-Vibe-Company/companion/commit/979e395b530cdb21e6a073ba60e33ea8ac497e2a))
* **web:** session rename persistence + auto-generated titles ([#79](https://github.com/The-Vibe-Company/companion/issues/79)) ([e1dc58c](https://github.com/The-Vibe-Company/companion/commit/e1dc58ce8ab9a619d36f2261cce89b90cfdb70d6))
* **web:** warn when branch is behind remote before session creation ([#127](https://github.com/The-Vibe-Company/companion/issues/127)) ([ef89d5c](https://github.com/The-Vibe-Company/companion/commit/ef89d5c208ca5da006aaa88b78dbd647186fb0df))


### Bug Fixes

* add web/dist to gitignore ([#2](https://github.com/The-Vibe-Company/companion/issues/2)) ([b9ac264](https://github.com/The-Vibe-Company/companion/commit/b9ac264fbb99415517636517e8f503d40fe3253d))
* always update statusLine settings on agent spawn ([#21](https://github.com/The-Vibe-Company/companion/issues/21)) ([71c343c](https://github.com/The-Vibe-Company/companion/commit/71c343cfd29fff3204ad0cc2986ff000d1be5adc))
* auto-accept workspace trust prompt and handle idle in ask() ([#16](https://github.com/The-Vibe-Company/companion/issues/16)) ([ded31b4](https://github.com/The-Vibe-Company/companion/commit/ded31b4cf9900f7ed8c3ff373ef16ae8f1e8a886))
* checkout selected branch when worktree mode is off ([#68](https://github.com/The-Vibe-Company/companion/issues/68)) ([500f3b1](https://github.com/The-Vibe-Company/companion/commit/500f3b112c5ccc646c7965344b5774efe1338377))
* **cli:** auto-update restarts service reliably via explicit systemctl/launchctl ([#208](https://github.com/The-Vibe-Company/companion/issues/208)) ([33fa67e](https://github.com/The-Vibe-Company/companion/commit/33fa67ebd75609b9a7b8700ce67b1dd949663b06))
* **cli:** expose stop/restart in help and add test ([#188](https://github.com/The-Vibe-Company/companion/issues/188)) ([c307525](https://github.com/The-Vibe-Company/companion/commit/c30752545f2137fd7c03525d5bb7f5f8851271d4))
* **cli:** fix Linux systemd service management (start, auto-restart) ([#213](https://github.com/The-Vibe-Company/companion/issues/213)) ([fc1dd65](https://github.com/The-Vibe-Company/companion/commit/fc1dd65a9fd32958d47499af1b35992a0c10fe8e))
* **cli:** refresh systemd unit file on start/restart to prevent restart loops ([#215](https://github.com/The-Vibe-Company/companion/issues/215)) ([35f80d9](https://github.com/The-Vibe-Company/companion/commit/35f80d963b1f0f0feccf7215a9bd4711b4520a12))
* **cli:** resolve binaries via user shell PATH when running as service ([#216](https://github.com/The-Vibe-Company/companion/issues/216)) ([47e4967](https://github.com/The-Vibe-Company/companion/commit/47e4967215a5bfd84c8afc2a86ce42151c73d187))
* **codex:** fix 3 critical bugs in Codex backend integration ([#147](https://github.com/The-Vibe-Company/companion/issues/147)) ([0ec92db](https://github.com/The-Vibe-Company/companion/commit/0ec92db909c7be42f94cc21d2890c9c123702dd7))
* **codex:** handle init failure gracefully and isolate per-session CODEX_HOME ([#210](https://github.com/The-Vibe-Company/companion/issues/210)) ([f4efcea](https://github.com/The-Vibe-Company/companion/commit/f4efceace6c260de92df728335678b7bded3e144))
* make service stop actually stop on macOS and refresh stale update checks ([#192](https://github.com/The-Vibe-Company/companion/issues/192)) ([f608f64](https://github.com/The-Vibe-Company/companion/commit/f608f64887bf78b2cca909aa20bd87e4a897ce94))
* remove vibe alias, update repo URLs to companion ([#30](https://github.com/The-Vibe-Company/companion/issues/30)) ([4f7b47c](https://github.com/The-Vibe-Company/companion/commit/4f7b47cba86c278e89fe81292fea9b8b3e75c035))
* scope permission requests to their session tab ([#35](https://github.com/The-Vibe-Company/companion/issues/35)) ([ef9f41c](https://github.com/The-Vibe-Company/companion/commit/ef9f41c8589e382de1db719984931bc4e91aeb11))
* show pasted images in chat history ([#32](https://github.com/The-Vibe-Company/companion/issues/32)) ([46365be](https://github.com/The-Vibe-Company/companion/commit/46365be45ae8b325100ed296617455c105d4d52e))
* **sidebar:** nest notification toggles behind disclosure ([#207](https://github.com/The-Vibe-Company/companion/issues/207)) ([87e71b8](https://github.com/The-Vibe-Company/companion/commit/87e71b8f5bf3e47c96421bca315ac412934a7dc2))
* **task-panel:** enable scrolling for long MCP sections ([#204](https://github.com/The-Vibe-Company/companion/issues/204)) ([b98abbb](https://github.com/The-Vibe-Company/companion/commit/b98abbbea4355c7e91d4dc322e53e638f4e4c542))
* track all commits in release-please, not just web/ ([#27](https://github.com/The-Vibe-Company/companion/issues/27)) ([d49f649](https://github.com/The-Vibe-Company/companion/commit/d49f64996d02807baf0482ce3c3607ae59f78638))
* use correct secret name NPM_PUBLISH_TOKEN in publish workflow ([e296ab0](https://github.com/The-Vibe-Company/companion/commit/e296ab0fabd6345b1f21c7094ca1f8d6f6af79cb))
* use correct secret name NPM_PUBLISH_TOKEN in publish workflow ([#26](https://github.com/The-Vibe-Company/companion/issues/26)) ([61eed5a](https://github.com/The-Vibe-Company/companion/commit/61eed5addd6e332fac360d9ae8239f1b0f93868e))
* use random suffixes for worktree branch names ([#88](https://github.com/The-Vibe-Company/companion/issues/88)) ([0b79f9a](https://github.com/The-Vibe-Company/companion/commit/0b79f9af172595cb84810b5d4cd65e0ed9c8e23d))
* **web:** always generate unique branch names for worktrees with forceNew ([#131](https://github.com/The-Vibe-Company/companion/issues/131)) ([cd62d4a](https://github.com/The-Vibe-Company/companion/commit/cd62d4ac8fae0b56cdef0ff850eab4a8c707f99b))
* **web:** chat scroll and composer visibility in plan mode ([#55](https://github.com/The-Vibe-Company/companion/issues/55)) ([4cff10c](https://github.com/The-Vibe-Company/companion/commit/4cff10cde297b7142c088584b6dd83060902c526))
* **web:** deduplicate messages on WebSocket reconnection ([#150](https://github.com/The-Vibe-Company/companion/issues/150)) ([a81bb3d](https://github.com/The-Vibe-Company/companion/commit/a81bb3d878957f1f18234a5f9194d1d8064f795c))
* **web:** default folder picker to home directory instead of server cwd ([#122](https://github.com/The-Vibe-Company/companion/issues/122)) ([7b8a4c7](https://github.com/The-Vibe-Company/companion/commit/7b8a4c71f32c68ffcc907269e88b3711c0d5af7a))
* **web:** enable codex web search when internet toggle is on ([#135](https://github.com/The-Vibe-Company/companion/issues/135)) ([8d9f0b0](https://github.com/The-Vibe-Company/companion/commit/8d9f0b002dcafcfc020862cb107777d75fc2580e))
* **web:** fetch and pull selected branch on session create ([#137](https://github.com/The-Vibe-Company/companion/issues/137)) ([9cdbbe1](https://github.com/The-Vibe-Company/companion/commit/9cdbbe1e151f024bd41f60e20c60e2f092ba7014))
* **web:** fix Codex approval policy and Composer mode labels ([#106](https://github.com/The-Vibe-Company/companion/issues/106)) ([fd5c2f1](https://github.com/The-Vibe-Company/companion/commit/fd5c2f15b144eb2ae9ec809fdb6ee19e797dc15a))
* **web:** fix session auto-rename and add blur-to-focus animation ([#86](https://github.com/The-Vibe-Company/companion/issues/86)) ([6d3c91f](https://github.com/The-Vibe-Company/companion/commit/6d3c91f73a65054e2c15727e90ca554af70eed28))
* **web:** fix WritableStream locked race condition in Codex adapter ([b43569d](https://github.com/The-Vibe-Company/companion/commit/b43569dbb3d154a303d60ec6bc2007b5a7bcedea))
* **web:** improve light mode contrast ([#89](https://github.com/The-Vibe-Company/companion/issues/89)) ([7ac7886](https://github.com/The-Vibe-Company/companion/commit/7ac7886fc6305e3ec45698a1c7c91b72a91c7c44))
* **web:** improve responsive design across all components ([#85](https://github.com/The-Vibe-Company/companion/issues/85)) ([0750fbb](https://github.com/The-Vibe-Company/companion/commit/0750fbbbe456d79bc104fdbdaf8f08e8795a3b62))
* **web:** isolate worktree sessions with proper branch-tracking ([#74](https://github.com/The-Vibe-Company/companion/issues/74)) ([764d7a7](https://github.com/The-Vibe-Company/companion/commit/764d7a7f5391a686408a8542421f771da341d5db))
* **web:** polyfill localStorage for Node.js 22+ ([#149](https://github.com/The-Vibe-Company/companion/issues/149)) ([602c684](https://github.com/The-Vibe-Company/companion/commit/602c6841f03677ec3f419860469e39b791968de6))
* **web:** prevent iOS auto-zoom on mobile input focus ([#102](https://github.com/The-Vibe-Company/companion/issues/102)) ([18ee23f](https://github.com/The-Vibe-Company/companion/commit/18ee23f6f1674fbcf5e1be25f8c4e23510bc12b5))
* **web:** prevent mobile keyboard layout shift and iOS zoom on branch selector ([#159](https://github.com/The-Vibe-Company/companion/issues/159)) ([4276afd](https://github.com/The-Vibe-Company/companion/commit/4276afd4390808d9d040555652c80bd1461c45b7))
* **web:** refresh git branch tracking after session start ([#195](https://github.com/The-Vibe-Company/companion/issues/195)) ([c3cb47b](https://github.com/The-Vibe-Company/companion/commit/c3cb47b56257b866b76abbb66709694cb26e0925))
* **web:** resolve [object Object] display for Codex file edit results ([#133](https://github.com/The-Vibe-Company/companion/issues/133)) ([9cc21a7](https://github.com/The-Vibe-Company/companion/commit/9cc21a78064cf07bb90174dd87bbfbd367516c90))
* **web:** resolve original repo root for worktree sessions in sidebar grouping ([#120](https://github.com/The-Vibe-Company/companion/issues/120)) ([8925ac9](https://github.com/The-Vibe-Company/companion/commit/8925ac9f540b3cd2520268539d21b0267b2dadb1))
* **web:** session reconnection with auto-relaunch and persist ([#49](https://github.com/The-Vibe-Company/companion/issues/49)) ([f58e542](https://github.com/The-Vibe-Company/companion/commit/f58e5428847a342069e6790fa7d70f190bc5f396))
* **web:** stable session ordering — sort by creation date only ([#173](https://github.com/The-Vibe-Company/companion/issues/173)) ([05c3a06](https://github.com/The-Vibe-Company/companion/commit/05c3a0652b823c5ca20b233be164a899f9920caf))
* **web:** unset CLAUDECODE env var to prevent CLI nesting guard rejec… ([#181](https://github.com/The-Vibe-Company/companion/issues/181)) ([75e264a](https://github.com/The-Vibe-Company/companion/commit/75e264a0be975dadbf3d56e64b990e0e07b12777))
* **web:** use --resume on CLI relaunch to restore conversation context ([#46](https://github.com/The-Vibe-Company/companion/issues/46)) ([3e2b5bd](https://github.com/The-Vibe-Company/companion/commit/3e2b5bdd39bd265ca5675784227a9f1b4f2a8aa3))

## [0.34.5](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.34.4...the-companion-v0.34.5) (2026-02-13)


### Bug Fixes

* **cli:** fix Linux systemd service management (start, auto-restart) ([#213](https://github.com/The-Vibe-Company/companion/issues/213)) ([fc1dd65](https://github.com/The-Vibe-Company/companion/commit/fc1dd65a9fd32958d47499af1b35992a0c10fe8e))
* **cli:** refresh systemd unit file on start/restart to prevent restart loops ([#215](https://github.com/The-Vibe-Company/companion/issues/215)) ([35f80d9](https://github.com/The-Vibe-Company/companion/commit/35f80d963b1f0f0feccf7215a9bd4711b4520a12))
* **cli:** resolve binaries via user shell PATH when running as service ([#216](https://github.com/The-Vibe-Company/companion/issues/216)) ([47e4967](https://github.com/The-Vibe-Company/companion/commit/47e4967215a5bfd84c8afc2a86ce42151c73d187))

## [0.34.4](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.34.3...the-companion-v0.34.4) (2026-02-13)


### Bug Fixes

* **codex:** handle init failure gracefully and isolate per-session CODEX_HOME ([#210](https://github.com/The-Vibe-Company/companion/issues/210)) ([f4efcea](https://github.com/The-Vibe-Company/companion/commit/f4efceace6c260de92df728335678b7bded3e144))

## [0.34.3](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.34.2...the-companion-v0.34.3) (2026-02-13)


### Bug Fixes

* **cli:** auto-update restarts service reliably via explicit systemctl/launchctl ([#208](https://github.com/The-Vibe-Company/companion/issues/208)) ([33fa67e](https://github.com/The-Vibe-Company/companion/commit/33fa67ebd75609b9a7b8700ce67b1dd949663b06))

## [0.34.2](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.34.1...the-companion-v0.34.2) (2026-02-13)


### Bug Fixes

* **sidebar:** nest notification toggles behind disclosure ([#207](https://github.com/The-Vibe-Company/companion/issues/207)) ([87e71b8](https://github.com/The-Vibe-Company/companion/commit/87e71b8f5bf3e47c96421bca315ac412934a7dc2))

## [0.34.1](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.34.0...the-companion-v0.34.1) (2026-02-13)


### Bug Fixes

* **task-panel:** enable scrolling for long MCP sections ([#204](https://github.com/The-Vibe-Company/companion/issues/204)) ([b98abbb](https://github.com/The-Vibe-Company/companion/commit/b98abbbea4355c7e91d4dc322e53e638f4e4c542))

## [0.34.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.33.0...the-companion-v0.34.0) (2026-02-13)


### Features

* **cli:** start and stop Companion via daemon service ([#201](https://github.com/The-Vibe-Company/companion/issues/201)) ([39e2b79](https://github.com/The-Vibe-Company/companion/commit/39e2b79a6dbb70e7c7dcaf3ccbaf2116ac26b43a))
* **sidebar:** group sound and alerts under notification ([#203](https://github.com/The-Vibe-Company/companion/issues/203)) ([0077e75](https://github.com/The-Vibe-Company/companion/commit/0077e75208e7505a53db8a829a9480a77b8c3916))

## [0.33.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.32.0...the-companion-v0.33.0) (2026-02-13)


### Features

* **web:** add browser web notifications ([#191](https://github.com/The-Vibe-Company/companion/issues/191)) ([092c59a](https://github.com/The-Vibe-Company/companion/commit/092c59aff620aa2b2eac51903c01ad7cb0c4bc8e))

## [0.32.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.31.0...the-companion-v0.32.0) (2026-02-13)


### Features

* add MCP server management support ([#198](https://github.com/The-Vibe-Company/companion/issues/198)) ([018cf1f](https://github.com/The-Vibe-Company/companion/commit/018cf1f65ea5e281c19a39367f8cccf14ac56c1f))


### Bug Fixes

* **web:** refresh git branch tracking after session start ([#195](https://github.com/The-Vibe-Company/companion/issues/195)) ([c3cb47b](https://github.com/The-Vibe-Company/companion/commit/c3cb47b56257b866b76abbb66709694cb26e0925))

## [0.31.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.30.1...the-companion-v0.31.0) (2026-02-13)


### Features

* **codex:** add offline protocol compatibility guardrails and playground coverage ([#194](https://github.com/The-Vibe-Company/companion/issues/194)) ([bf0a43e](https://github.com/The-Vibe-Company/companion/commit/bf0a43e5fdc791166e76391c0ee1ad3cf18dae10))


### Bug Fixes

* make service stop actually stop on macOS and refresh stale update checks ([#192](https://github.com/The-Vibe-Company/companion/issues/192)) ([f608f64](https://github.com/The-Vibe-Company/companion/commit/f608f64887bf78b2cca909aa20bd87e4a897ce94))

## [0.30.1](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.30.0...the-companion-v0.30.1) (2026-02-13)


### Bug Fixes

* **cli:** expose stop/restart in help and add test ([#188](https://github.com/The-Vibe-Company/companion/issues/188)) ([c307525](https://github.com/The-Vibe-Company/companion/commit/c30752545f2137fd7c03525d5bb7f5f8851271d4))

## [0.30.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.29.0...the-companion-v0.30.0) (2026-02-13)


### Features

* **cli:** add stop and restart service commands ([#185](https://github.com/The-Vibe-Company/companion/issues/185)) ([04da8e5](https://github.com/The-Vibe-Company/companion/commit/04da8e5a3d3f0e363f662cdd6bca6145eaec479f))

## [0.29.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.28.0...the-companion-v0.29.0) (2026-02-13)


### Features

* **web:** adaptive server-side PR polling with WebSocket push ([#178](https://github.com/The-Vibe-Company/companion/issues/178)) ([57939e4](https://github.com/The-Vibe-Company/companion/commit/57939e4030a4b0e5a7dae39d93c34944e3bdff0f))


### Bug Fixes

* **web:** unset CLAUDECODE env var to prevent CLI nesting guard rejec… ([#181](https://github.com/The-Vibe-Company/companion/issues/181)) ([75e264a](https://github.com/The-Vibe-Company/companion/commit/75e264a0be975dadbf3d56e64b990e0e07b12777))

## [0.28.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.27.1...the-companion-v0.28.0) (2026-02-12)


### Features

* **web:** add embedded terminal in sidebar ([#175](https://github.com/The-Vibe-Company/companion/issues/175)) ([e711c5d](https://github.com/The-Vibe-Company/companion/commit/e711c5d5ef40edfa9c265642383a4c526b9b3ece))

## [0.27.1](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.27.0...the-companion-v0.27.1) (2026-02-12)


### Bug Fixes

* **web:** stable session ordering — sort by creation date only ([#173](https://github.com/The-Vibe-Company/companion/issues/173)) ([05c3a06](https://github.com/The-Vibe-Company/companion/commit/05c3a0652b823c5ca20b233be164a899f9920caf))

## [0.27.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.26.0...the-companion-v0.27.0) (2026-02-12)


### Features

* OpenRouter-based session auto-naming + settings page ([#168](https://github.com/The-Vibe-Company/companion/issues/168)) ([a86b1e7](https://github.com/The-Vibe-Company/companion/commit/a86b1e711ff1c38985bb3d622c6ec372a266637e))
* **web:** add CLAUDE.md editor button in TopBar ([#170](https://github.com/The-Vibe-Company/companion/issues/170)) ([f553b9b](https://github.com/The-Vibe-Company/companion/commit/f553b9b86842f0b47c0bf24b08903e0352b7b078))

## [0.26.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.25.0...the-companion-v0.26.0) (2026-02-12)


### Features

* add Linux systemd support for service install/uninstall ([#169](https://github.com/The-Vibe-Company/companion/issues/169)) ([73fb3f7](https://github.com/The-Vibe-Company/companion/commit/73fb3f721efde79fec50f9c74a4f078f821c35d3))

## [0.25.0](https://github.com/The-Vibe-Company/companion/compare/the-companion-v0.24.0...the-companion-v0.25.0) (2026-02-12)


### Features

* Add permission & plan approval E2E tests ([#6](https://github.com/The-Vibe-Company/companion/issues/6)) ([8590a68](https://github.com/The-Vibe-Company/companion/commit/8590a68657f0a06e94795a179ad4bbedae782c63))
* add release-please for automated npm publishing ([#24](https://github.com/The-Vibe-Company/companion/issues/24)) ([93b24ee](https://github.com/The-Vibe-Company/companion/commit/93b24ee4a12b3f32e81f59a348b25e89aaa86dce))
* allow dev server access over Tailscale/LAN ([#33](https://github.com/The-Vibe-Company/companion/issues/33)) ([9599d7a](https://github.com/The-Vibe-Company/companion/commit/9599d7ad4e2823d51c8fa262e1dcd96eeb056244))
* claude.md update ([7fa4e7a](https://github.com/The-Vibe-Company/companion/commit/7fa4e7adfdc7c409cfeed4e8a11f237ff0572234))
* **cli:** add service install/uninstall and separate dev/prod ports ([#155](https://github.com/The-Vibe-Company/companion/issues/155)) ([a4e5ba6](https://github.com/The-Vibe-Company/companion/commit/a4e5ba6ced2cc8041f61b303b0205f36e50b7594))
* Corriger menu dossier mobile et décalage clavier ([#151](https://github.com/The-Vibe-Company/companion/issues/151)) ([8068925](https://github.com/The-Vibe-Company/companion/commit/8068925f6a5ec5c6b7a40b36398bd4f9be04708d))
* e2e permissions plans ([#9](https://github.com/The-Vibe-Company/companion/issues/9)) ([53b38bf](https://github.com/The-Vibe-Company/companion/commit/53b38bfd4e773454492a3fea10e8db7ffd3fd768))
* Fix Diffs panel for worktree/relative paths and untracked files ([#165](https://github.com/The-Vibe-Company/companion/issues/165)) ([6810643](https://github.com/The-Vibe-Company/companion/commit/681064328d2bf3f4fc5c3a1867abc1536d2d54f3))
* Hide successful no-output command results ([#139](https://github.com/The-Vibe-Company/companion/issues/139)) ([a66e386](https://github.com/The-Vibe-Company/companion/commit/a66e386491e6887c5684cd70f63cc49cac0a64b7))
* **landing:** add marketing landing page for thecompanion.sh ([#128](https://github.com/The-Vibe-Company/companion/issues/128)) ([170b89c](https://github.com/The-Vibe-Company/companion/commit/170b89c72012dfb0ba68239a7665634d65275aa3))
* protocol conformance fixes and improved E2E tests ([#14](https://github.com/The-Vibe-Company/companion/issues/14)) ([51b13b9](https://github.com/The-Vibe-Company/companion/commit/51b13b9d647de6c92881b1abb61161f39152e0ef))
* Redesign README as a landing page with API-first documentation ([#7](https://github.com/The-Vibe-Company/companion/issues/7)) ([a59e1b4](https://github.com/The-Vibe-Company/companion/commit/a59e1b4604baf87faa32af7d62e4846afae49dbe))
* simplified claude() API, unified endpoints, and landing page README ([#12](https://github.com/The-Vibe-Company/companion/issues/12)) ([aa2e535](https://github.com/The-Vibe-Company/companion/commit/aa2e535fe0a83b726ff2a2c08359e55973a9136b))
* The Vibe Companion complete web UI rewrite + npm package ([#23](https://github.com/The-Vibe-Company/companion/issues/23)) ([0bdc77a](https://github.com/The-Vibe-Company/companion/commit/0bdc77a81b21cd9d08ba29ea48844e73df3a1852))
* trigger release for statusline capture ([#19](https://github.com/The-Vibe-Company/companion/issues/19)) ([cedc9df](https://github.com/The-Vibe-Company/companion/commit/cedc9dfb7445344bdb43a1a756f1d2e538e08c76))
* **web:** add Clawd-inspired pixel art logo and favicon ([#70](https://github.com/The-Vibe-Company/companion/issues/70)) ([b3994ef](https://github.com/The-Vibe-Company/companion/commit/b3994eff2eac62c3cf8f40a8c31b720c910a7601))
* **web:** add component playground and ExitPlanMode display ([#36](https://github.com/The-Vibe-Company/companion/issues/36)) ([e958be7](https://github.com/The-Vibe-Company/companion/commit/e958be780f1b6e1a8f65daedbf968cdf6ef47798))
* **web:** add embedded code editor with file tree, changed files tracking, and diff view ([#81](https://github.com/The-Vibe-Company/companion/issues/81)) ([3ed0957](https://github.com/The-Vibe-Company/companion/commit/3ed095790c73edeef911ab4c73d74f1998100c5c))
* **web:** add git worktree support for isolated multi-branch sessions ([#64](https://github.com/The-Vibe-Company/companion/issues/64)) ([fee39d6](https://github.com/The-Vibe-Company/companion/commit/fee39d62986cd99700ba78c84a1f586331955ff8))
* **web:** add GitHub PR status to TaskPanel sidebar ([#166](https://github.com/The-Vibe-Company/companion/issues/166)) ([6ace3b2](https://github.com/The-Vibe-Company/companion/commit/6ace3b2944ec9e9082a11a45fe0798f0f5f41e55))
* **web:** add missing message-flow components to Playground ([#156](https://github.com/The-Vibe-Company/companion/issues/156)) ([ef6c27d](https://github.com/The-Vibe-Company/companion/commit/ef6c27dfa950c11b09394c74c4452c0b02aed8fb))
* **web:** add notification sound on task completion ([#99](https://github.com/The-Vibe-Company/companion/issues/99)) ([337c735](https://github.com/The-Vibe-Company/companion/commit/337c735e8267f076ada4b9ef01632d37376ec2d0))
* **web:** add OpenAI Codex CLI backend integration ([#100](https://github.com/The-Vibe-Company/companion/issues/100)) ([54e3c1a](https://github.com/The-Vibe-Company/companion/commit/54e3c1a2b359719d7983fa9ee857507e1446f505))
* **web:** add per-session usage limits with OAuth refresh and Codex support ([24ebd32](https://github.com/The-Vibe-Company/companion/commit/24ebd32f5ec617290b6b93e8bc76972a3b80d6a9))
* **web:** add permission suggestions and pending permission indicators ([10422c1](https://github.com/The-Vibe-Company/companion/commit/10422c1464b6ad4bc45eb90e6cd9ebbc0ebeac92))
* **web:** add PWA support for mobile home screen install ([#116](https://github.com/The-Vibe-Company/companion/issues/116)) ([85e605f](https://github.com/The-Vibe-Company/companion/commit/85e605fd758ee952e0d5b1dbc6f7065b514844a7))
* **web:** add update-available banner with auto-update for service mode ([#158](https://github.com/The-Vibe-Company/companion/issues/158)) ([727bd7f](https://github.com/The-Vibe-Company/companion/commit/727bd7fbd16557fd63ce41632592c1485e69713c))
* **web:** add usage limits display in session panel ([#97](https://github.com/The-Vibe-Company/companion/issues/97)) ([d29f489](https://github.com/The-Vibe-Company/companion/commit/d29f489ed9951d36ff45ec240410ffd8ffdf05eb))
* **web:** archive sessions instead of deleting them ([#56](https://github.com/The-Vibe-Company/companion/issues/56)) ([489d608](https://github.com/The-Vibe-Company/companion/commit/489d6087fc99b9131386547edaf3bd303a114090))
* **web:** enlarge homepage logo as hero element ([#71](https://github.com/The-Vibe-Company/companion/issues/71)) ([18ead74](https://github.com/The-Vibe-Company/companion/commit/18ead7436d3ebbe9d766754ddb17aa504c63703f))
* **web:** git fetch on branch picker open ([#72](https://github.com/The-Vibe-Company/companion/issues/72)) ([f110405](https://github.com/The-Vibe-Company/companion/commit/f110405edbd0f00454edd65ed72197daf0293182))
* **web:** git info display, folder dropdown fix, dev workflow ([#43](https://github.com/The-Vibe-Company/companion/issues/43)) ([1fe2069](https://github.com/The-Vibe-Company/companion/commit/1fe2069a7db17b410e383f883c934ee1662c2171))
* **web:** git worktree support with branch picker and git pull ([#65](https://github.com/The-Vibe-Company/companion/issues/65)) ([4d0c9c8](https://github.com/The-Vibe-Company/companion/commit/4d0c9c83f4fe13be863313d6c945ce0b671a7f8a))
* **web:** group sidebar sessions by project directory ([#117](https://github.com/The-Vibe-Company/companion/issues/117)) ([deceb59](https://github.com/The-Vibe-Company/companion/commit/deceb599975f53141e9c0bd6c7675437f96978b8))
* **web:** named environment profiles (~/.companion/envs/) ([#50](https://github.com/The-Vibe-Company/companion/issues/50)) ([eaa1a49](https://github.com/The-Vibe-Company/companion/commit/eaa1a497f3be61f2f71f9467e93fa2b65be19095))
* **web:** persist sessions to disk for dev mode resilience ([#45](https://github.com/The-Vibe-Company/companion/issues/45)) ([c943d00](https://github.com/The-Vibe-Company/companion/commit/c943d0047b728854f059e26facde950e08cdfe0c))
* **web:** redesign session list with avatars, auto-reconnect, and git info ([#111](https://github.com/The-Vibe-Company/companion/issues/111)) ([8a7284b](https://github.com/The-Vibe-Company/companion/commit/8a7284b3c08dc301a879924aea133945697b037a))
* **web:** replace CodeMirror editor with unified diff viewer ([#160](https://github.com/The-Vibe-Company/companion/issues/160)) ([f9b6869](https://github.com/The-Vibe-Company/companion/commit/f9b686902011ffd194a118cc1cb022bac71eaa3b))
* **web:** replace folder picker dropdown with fixed-size modal ([#76](https://github.com/The-Vibe-Company/companion/issues/76)) ([979e395](https://github.com/The-Vibe-Company/companion/commit/979e395b530cdb21e6a073ba60e33ea8ac497e2a))
* **web:** session rename persistence + auto-generated titles ([#79](https://github.com/The-Vibe-Company/companion/issues/79)) ([e1dc58c](https://github.com/The-Vibe-Company/companion/commit/e1dc58ce8ab9a619d36f2261cce89b90cfdb70d6))
* **web:** warn when branch is behind remote before session creation ([#127](https://github.com/The-Vibe-Company/companion/issues/127)) ([ef89d5c](https://github.com/The-Vibe-Company/companion/commit/ef89d5c208ca5da006aaa88b78dbd647186fb0df))


### Bug Fixes

* add web/dist to gitignore ([#2](https://github.com/The-Vibe-Company/companion/issues/2)) ([b9ac264](https://github.com/The-Vibe-Company/companion/commit/b9ac264fbb99415517636517e8f503d40fe3253d))
* always update statusLine settings on agent spawn ([#21](https://github.com/The-Vibe-Company/companion/issues/21)) ([71c343c](https://github.com/The-Vibe-Company/companion/commit/71c343cfd29fff3204ad0cc2986ff000d1be5adc))
* auto-accept workspace trust prompt and handle idle in ask() ([#16](https://github.com/The-Vibe-Company/companion/issues/16)) ([ded31b4](https://github.com/The-Vibe-Company/companion/commit/ded31b4cf9900f7ed8c3ff373ef16ae8f1e8a886))
* checkout selected branch when worktree mode is off ([#68](https://github.com/The-Vibe-Company/companion/issues/68)) ([500f3b1](https://github.com/The-Vibe-Company/companion/commit/500f3b112c5ccc646c7965344b5774efe1338377))
* **codex:** fix 3 critical bugs in Codex backend integration ([#147](https://github.com/The-Vibe-Company/companion/issues/147)) ([0ec92db](https://github.com/The-Vibe-Company/companion/commit/0ec92db909c7be42f94cc21d2890c9c123702dd7))
* remove vibe alias, update repo URLs to companion ([#30](https://github.com/The-Vibe-Company/companion/issues/30)) ([4f7b47c](https://github.com/The-Vibe-Company/companion/commit/4f7b47cba86c278e89fe81292fea9b8b3e75c035))
* scope permission requests to their session tab ([#35](https://github.com/The-Vibe-Company/companion/issues/35)) ([ef9f41c](https://github.com/The-Vibe-Company/companion/commit/ef9f41c8589e382de1db719984931bc4e91aeb11))
* show pasted images in chat history ([#32](https://github.com/The-Vibe-Company/companion/issues/32)) ([46365be](https://github.com/The-Vibe-Company/companion/commit/46365be45ae8b325100ed296617455c105d4d52e))
* track all commits in release-please, not just web/ ([#27](https://github.com/The-Vibe-Company/companion/issues/27)) ([d49f649](https://github.com/The-Vibe-Company/companion/commit/d49f64996d02807baf0482ce3c3607ae59f78638))
* use correct secret name NPM_PUBLISH_TOKEN in publish workflow ([e296ab0](https://github.com/The-Vibe-Company/companion/commit/e296ab0fabd6345b1f21c7094ca1f8d6f6af79cb))
* use correct secret name NPM_PUBLISH_TOKEN in publish workflow ([#26](https://github.com/The-Vibe-Company/companion/issues/26)) ([61eed5a](https://github.com/The-Vibe-Company/companion/commit/61eed5addd6e332fac360d9ae8239f1b0f93868e))
* use random suffixes for worktree branch names ([#88](https://github.com/The-Vibe-Company/companion/issues/88)) ([0b79f9a](https://github.com/The-Vibe-Company/companion/commit/0b79f9af172595cb84810b5d4cd65e0ed9c8e23d))
* **web:** always generate unique branch names for worktrees with forceNew ([#131](https://github.com/The-Vibe-Company/companion/issues/131)) ([cd62d4a](https://github.com/The-Vibe-Company/companion/commit/cd62d4ac8fae0b56cdef0ff850eab4a8c707f99b))
* **web:** chat scroll and composer visibility in plan mode ([#55](https://github.com/The-Vibe-Company/companion/issues/55)) ([4cff10c](https://github.com/The-Vibe-Company/companion/commit/4cff10cde297b7142c088584b6dd83060902c526))
* **web:** deduplicate messages on WebSocket reconnection ([#150](https://github.com/The-Vibe-Company/companion/issues/150)) ([a81bb3d](https://github.com/The-Vibe-Company/companion/commit/a81bb3d878957f1f18234a5f9194d1d8064f795c))
* **web:** default folder picker to home directory instead of server cwd ([#122](https://github.com/The-Vibe-Company/companion/issues/122)) ([7b8a4c7](https://github.com/The-Vibe-Company/companion/commit/7b8a4c71f32c68ffcc907269e88b3711c0d5af7a))
* **web:** enable codex web search when internet toggle is on ([#135](https://github.com/The-Vibe-Company/companion/issues/135)) ([8d9f0b0](https://github.com/The-Vibe-Company/companion/commit/8d9f0b002dcafcfc020862cb107777d75fc2580e))
* **web:** fetch and pull selected branch on session create ([#137](https://github.com/The-Vibe-Company/companion/issues/137)) ([9cdbbe1](https://github.com/The-Vibe-Company/companion/commit/9cdbbe1e151f024bd41f60e20c60e2f092ba7014))
* **web:** fix Codex approval policy and Composer mode labels ([#106](https://github.com/The-Vibe-Company/companion/issues/106)) ([fd5c2f1](https://github.com/The-Vibe-Company/companion/commit/fd5c2f15b144eb2ae9ec809fdb6ee19e797dc15a))
* **web:** fix session auto-rename and add blur-to-focus animation ([#86](https://github.com/The-Vibe-Company/companion/issues/86)) ([6d3c91f](https://github.com/The-Vibe-Company/companion/commit/6d3c91f73a65054e2c15727e90ca554af70eed28))
* **web:** fix WritableStream locked race condition in Codex adapter ([b43569d](https://github.com/The-Vibe-Company/companion/commit/b43569dbb3d154a303d60ec6bc2007b5a7bcedea))
* **web:** improve light mode contrast ([#89](https://github.com/The-Vibe-Company/companion/issues/89)) ([7ac7886](https://github.com/The-Vibe-Company/companion/commit/7ac7886fc6305e3ec45698a1c7c91b72a91c7c44))
* **web:** improve responsive design across all components ([#85](https://github.com/The-Vibe-Company/companion/issues/85)) ([0750fbb](https://github.com/The-Vibe-Company/companion/commit/0750fbbbe456d79bc104fdbdaf8f08e8795a3b62))
* **web:** isolate worktree sessions with proper branch-tracking ([#74](https://github.com/The-Vibe-Company/companion/issues/74)) ([764d7a7](https://github.com/The-Vibe-Company/companion/commit/764d7a7f5391a686408a8542421f771da341d5db))
* **web:** polyfill localStorage for Node.js 22+ ([#149](https://github.com/The-Vibe-Company/companion/issues/149)) ([602c684](https://github.com/The-Vibe-Company/companion/commit/602c6841f03677ec3f419860469e39b791968de6))
* **web:** prevent iOS auto-zoom on mobile input focus ([#102](https://github.com/The-Vibe-Company/companion/issues/102)) ([18ee23f](https://github.com/The-Vibe-Company/companion/commit/18ee23f6f1674fbcf5e1be25f8c4e23510bc12b5))
* **web:** prevent mobile keyboard layout shift and iOS zoom on branch selector ([#159](https://github.com/The-Vibe-Company/companion/issues/159)) ([4276afd](https://github.com/The-Vibe-Company/companion/commit/4276afd4390808d9d040555652c80bd1461c45b7))
* **web:** resolve [object Object] display for Codex file edit results ([#133](https://github.com/The-Vibe-Company/companion/issues/133)) ([9cc21a7](https://github.com/The-Vibe-Company/companion/commit/9cc21a78064cf07bb90174dd87bbfbd367516c90))
* **web:** resolve original repo root for worktree sessions in sidebar grouping ([#120](https://github.com/The-Vibe-Company/companion/issues/120)) ([8925ac9](https://github.com/The-Vibe-Company/companion/commit/8925ac9f540b3cd2520268539d21b0267b2dadb1))
* **web:** session reconnection with auto-relaunch and persist ([#49](https://github.com/The-Vibe-Company/companion/issues/49)) ([f58e542](https://github.com/The-Vibe-Company/companion/commit/f58e5428847a342069e6790fa7d70f190bc5f396))
* **web:** use --resume on CLI relaunch to restore conversation context ([#46](https://github.com/The-Vibe-Company/companion/issues/46)) ([3e2b5bd](https://github.com/The-Vibe-Company/companion/commit/3e2b5bdd39bd265ca5675784227a9f1b4f2a8aa3))

## [0.24.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.23.0...the-vibe-companion-v0.24.0) (2026-02-12)


### Features

* Fix Diffs panel for worktree/relative paths and untracked files ([#165](https://github.com/The-Vibe-Company/companion/issues/165)) ([6810643](https://github.com/The-Vibe-Company/companion/commit/681064328d2bf3f4fc5c3a1867abc1536d2d54f3))
* **web:** add GitHub PR status to TaskPanel sidebar ([#166](https://github.com/The-Vibe-Company/companion/issues/166)) ([6ace3b2](https://github.com/The-Vibe-Company/companion/commit/6ace3b2944ec9e9082a11a45fe0798f0f5f41e55))
* **web:** add update-available banner with auto-update for service mode ([#158](https://github.com/The-Vibe-Company/companion/issues/158)) ([727bd7f](https://github.com/The-Vibe-Company/companion/commit/727bd7fbd16557fd63ce41632592c1485e69713c))
* **web:** replace CodeMirror editor with unified diff viewer ([#160](https://github.com/The-Vibe-Company/companion/issues/160)) ([f9b6869](https://github.com/The-Vibe-Company/companion/commit/f9b686902011ffd194a118cc1cb022bac71eaa3b))


### Bug Fixes

* **web:** prevent mobile keyboard layout shift and iOS zoom on branch selector ([#159](https://github.com/The-Vibe-Company/companion/issues/159)) ([4276afd](https://github.com/The-Vibe-Company/companion/commit/4276afd4390808d9d040555652c80bd1461c45b7))

## [0.23.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.22.1...the-vibe-companion-v0.23.0) (2026-02-12)


### Features

* **cli:** add service install/uninstall and separate dev/prod ports ([#155](https://github.com/The-Vibe-Company/companion/issues/155)) ([a4e5ba6](https://github.com/The-Vibe-Company/companion/commit/a4e5ba6ced2cc8041f61b303b0205f36e50b7594))
* **web:** add missing message-flow components to Playground ([#156](https://github.com/The-Vibe-Company/companion/issues/156)) ([ef6c27d](https://github.com/The-Vibe-Company/companion/commit/ef6c27dfa950c11b09394c74c4452c0b02aed8fb))

## [0.22.1](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.22.0...the-vibe-companion-v0.22.1) (2026-02-12)


### Bug Fixes

* **web:** polyfill localStorage for Node.js 22+ ([#149](https://github.com/The-Vibe-Company/companion/issues/149)) ([602c684](https://github.com/The-Vibe-Company/companion/commit/602c6841f03677ec3f419860469e39b791968de6))

## [0.22.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.21.0...the-vibe-companion-v0.22.0) (2026-02-12)


### Features

* Corriger menu dossier mobile et décalage clavier ([#151](https://github.com/The-Vibe-Company/companion/issues/151)) ([8068925](https://github.com/The-Vibe-Company/companion/commit/8068925f6a5ec5c6b7a40b36398bd4f9be04708d))


### Bug Fixes

* **codex:** fix 3 critical bugs in Codex backend integration ([#147](https://github.com/The-Vibe-Company/companion/issues/147)) ([0ec92db](https://github.com/The-Vibe-Company/companion/commit/0ec92db909c7be42f94cc21d2890c9c123702dd7))
* **web:** deduplicate messages on WebSocket reconnection ([#150](https://github.com/The-Vibe-Company/companion/issues/150)) ([a81bb3d](https://github.com/The-Vibe-Company/companion/commit/a81bb3d878957f1f18234a5f9194d1d8064f795c))

## [0.21.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.20.3...the-vibe-companion-v0.21.0) (2026-02-11)


### Features

* Hide successful no-output command results ([#139](https://github.com/The-Vibe-Company/companion/issues/139)) ([a66e386](https://github.com/The-Vibe-Company/companion/commit/a66e386491e6887c5684cd70f63cc49cac0a64b7))

## [0.20.3](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.20.2...the-vibe-companion-v0.20.3) (2026-02-11)


### Bug Fixes

* **web:** enable codex web search when internet toggle is on ([#135](https://github.com/The-Vibe-Company/companion/issues/135)) ([8d9f0b0](https://github.com/The-Vibe-Company/companion/commit/8d9f0b002dcafcfc020862cb107777d75fc2580e))
* **web:** fetch and pull selected branch on session create ([#137](https://github.com/The-Vibe-Company/companion/issues/137)) ([9cdbbe1](https://github.com/The-Vibe-Company/companion/commit/9cdbbe1e151f024bd41f60e20c60e2f092ba7014))

## [0.20.2](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.20.1...the-vibe-companion-v0.20.2) (2026-02-11)


### Bug Fixes

* **web:** resolve [object Object] display for Codex file edit results ([#133](https://github.com/The-Vibe-Company/companion/issues/133)) ([9cc21a7](https://github.com/The-Vibe-Company/companion/commit/9cc21a78064cf07bb90174dd87bbfbd367516c90))

## [0.20.1](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.20.0...the-vibe-companion-v0.20.1) (2026-02-11)


### Bug Fixes

* **web:** always generate unique branch names for worktrees with forceNew ([#131](https://github.com/The-Vibe-Company/companion/issues/131)) ([cd62d4a](https://github.com/The-Vibe-Company/companion/commit/cd62d4ac8fae0b56cdef0ff850eab4a8c707f99b))

## [0.20.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.19.1...the-vibe-companion-v0.20.0) (2026-02-11)


### Features

* **landing:** add marketing landing page for thecompanion.sh ([#128](https://github.com/The-Vibe-Company/companion/issues/128)) ([170b89c](https://github.com/The-Vibe-Company/companion/commit/170b89c72012dfb0ba68239a7665634d65275aa3))
* **web:** warn when branch is behind remote before session creation ([#127](https://github.com/The-Vibe-Company/companion/issues/127)) ([ef89d5c](https://github.com/The-Vibe-Company/companion/commit/ef89d5c208ca5da006aaa88b78dbd647186fb0df))

## [0.19.1](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.19.0...the-vibe-companion-v0.19.1) (2026-02-11)


### Bug Fixes

* **web:** default folder picker to home directory instead of server cwd ([#122](https://github.com/The-Vibe-Company/companion/issues/122)) ([7b8a4c7](https://github.com/The-Vibe-Company/companion/commit/7b8a4c71f32c68ffcc907269e88b3711c0d5af7a))

## [0.19.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.18.1...the-vibe-companion-v0.19.0) (2026-02-11)


### Features

* **web:** add PWA support for mobile home screen install ([#116](https://github.com/The-Vibe-Company/companion/issues/116)) ([85e605f](https://github.com/The-Vibe-Company/companion/commit/85e605fd758ee952e0d5b1dbc6f7065b514844a7))

## [0.18.1](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.18.0...the-vibe-companion-v0.18.1) (2026-02-11)


### Bug Fixes

* **web:** resolve original repo root for worktree sessions in sidebar grouping ([#120](https://github.com/The-Vibe-Company/companion/issues/120)) ([8925ac9](https://github.com/The-Vibe-Company/companion/commit/8925ac9f540b3cd2520268539d21b0267b2dadb1))

## [0.18.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.17.1...the-vibe-companion-v0.18.0) (2026-02-11)


### Features

* **web:** group sidebar sessions by project directory ([#117](https://github.com/The-Vibe-Company/companion/issues/117)) ([deceb59](https://github.com/The-Vibe-Company/companion/commit/deceb599975f53141e9c0bd6c7675437f96978b8))
* **web:** redesign session list with avatars, auto-reconnect, and git info ([#111](https://github.com/The-Vibe-Company/companion/issues/111)) ([8a7284b](https://github.com/The-Vibe-Company/companion/commit/8a7284b3c08dc301a879924aea133945697b037a))

## [0.17.1](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.17.0...the-vibe-companion-v0.17.1) (2026-02-11)


### Bug Fixes

* **web:** prevent iOS auto-zoom on mobile input focus ([#102](https://github.com/The-Vibe-Company/companion/issues/102)) ([18ee23f](https://github.com/The-Vibe-Company/companion/commit/18ee23f6f1674fbcf5e1be25f8c4e23510bc12b5))

## [0.17.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.16.0...the-vibe-companion-v0.17.0) (2026-02-11)


### Features

* **web:** add per-session usage limits with OAuth refresh and Codex support ([24ebd32](https://github.com/The-Vibe-Company/companion/commit/24ebd32f5ec617290b6b93e8bc76972a3b80d6a9))


### Bug Fixes

* **web:** fix WritableStream locked race condition in Codex adapter ([b43569d](https://github.com/The-Vibe-Company/companion/commit/b43569dbb3d154a303d60ec6bc2007b5a7bcedea))

## [0.16.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.15.0...the-vibe-companion-v0.16.0) (2026-02-11)


### Features

* **web:** add usage limits display in session panel ([#97](https://github.com/The-Vibe-Company/companion/issues/97)) ([d29f489](https://github.com/The-Vibe-Company/companion/commit/d29f489ed9951d36ff45ec240410ffd8ffdf05eb))


### Bug Fixes

* **web:** fix Codex approval policy and Composer mode labels ([#106](https://github.com/The-Vibe-Company/companion/issues/106)) ([fd5c2f1](https://github.com/The-Vibe-Company/companion/commit/fd5c2f15b144eb2ae9ec809fdb6ee19e797dc15a))

## [0.15.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.14.1...the-vibe-companion-v0.15.0) (2026-02-10)


### Features

* **web:** add notification sound on task completion ([#99](https://github.com/The-Vibe-Company/companion/issues/99)) ([337c735](https://github.com/The-Vibe-Company/companion/commit/337c735e8267f076ada4b9ef01632d37376ec2d0))
* **web:** add OpenAI Codex CLI backend integration ([#100](https://github.com/The-Vibe-Company/companion/issues/100)) ([54e3c1a](https://github.com/The-Vibe-Company/companion/commit/54e3c1a2b359719d7983fa9ee857507e1446f505))


### Bug Fixes

* use random suffixes for worktree branch names ([#88](https://github.com/The-Vibe-Company/companion/issues/88)) ([0b79f9a](https://github.com/The-Vibe-Company/companion/commit/0b79f9af172595cb84810b5d4cd65e0ed9c8e23d))
* **web:** improve light mode contrast ([#89](https://github.com/The-Vibe-Company/companion/issues/89)) ([7ac7886](https://github.com/The-Vibe-Company/companion/commit/7ac7886fc6305e3ec45698a1c7c91b72a91c7c44))

## [0.14.1](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.14.0...the-vibe-companion-v0.14.1) (2026-02-10)


### Bug Fixes

* **web:** fix session auto-rename and add blur-to-focus animation ([#86](https://github.com/The-Vibe-Company/companion/issues/86)) ([6d3c91f](https://github.com/The-Vibe-Company/companion/commit/6d3c91f73a65054e2c15727e90ca554af70eed28))
* **web:** improve responsive design across all components ([#85](https://github.com/The-Vibe-Company/companion/issues/85)) ([0750fbb](https://github.com/The-Vibe-Company/companion/commit/0750fbbbe456d79bc104fdbdaf8f08e8795a3b62))

## [0.14.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.13.0...the-vibe-companion-v0.14.0) (2026-02-10)


### Features

* **web:** add embedded code editor with file tree, changed files tracking, and diff view ([#81](https://github.com/The-Vibe-Company/companion/issues/81)) ([3ed0957](https://github.com/The-Vibe-Company/companion/commit/3ed095790c73edeef911ab4c73d74f1998100c5c))
* **web:** session rename persistence + auto-generated titles ([#79](https://github.com/The-Vibe-Company/companion/issues/79)) ([e1dc58c](https://github.com/The-Vibe-Company/companion/commit/e1dc58ce8ab9a619d36f2261cce89b90cfdb70d6))

## [0.13.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.12.1...the-vibe-companion-v0.13.0) (2026-02-10)


### Features

* **web:** replace folder picker dropdown with fixed-size modal ([#76](https://github.com/The-Vibe-Company/companion/issues/76)) ([979e395](https://github.com/The-Vibe-Company/companion/commit/979e395b530cdb21e6a073ba60e33ea8ac497e2a))

## [0.12.1](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.12.0...the-vibe-companion-v0.12.1) (2026-02-10)


### Bug Fixes

* **web:** isolate worktree sessions with proper branch-tracking ([#74](https://github.com/The-Vibe-Company/companion/issues/74)) ([764d7a7](https://github.com/The-Vibe-Company/companion/commit/764d7a7f5391a686408a8542421f771da341d5db))

## [0.12.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.11.0...the-vibe-companion-v0.12.0) (2026-02-10)


### Features

* **web:** git fetch on branch picker open ([#72](https://github.com/The-Vibe-Company/companion/issues/72)) ([f110405](https://github.com/The-Vibe-Company/companion/commit/f110405edbd0f00454edd65ed72197daf0293182))

## [0.11.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.10.0...the-vibe-companion-v0.11.0) (2026-02-10)


### Features

* **web:** add Clawd-inspired pixel art logo and favicon ([#70](https://github.com/The-Vibe-Company/companion/issues/70)) ([b3994ef](https://github.com/The-Vibe-Company/companion/commit/b3994eff2eac62c3cf8f40a8c31b720c910a7601))
* **web:** enlarge homepage logo as hero element ([#71](https://github.com/The-Vibe-Company/companion/issues/71)) ([18ead74](https://github.com/The-Vibe-Company/companion/commit/18ead7436d3ebbe9d766754ddb17aa504c63703f))


### Bug Fixes

* checkout selected branch when worktree mode is off ([#68](https://github.com/The-Vibe-Company/companion/issues/68)) ([500f3b1](https://github.com/The-Vibe-Company/companion/commit/500f3b112c5ccc646c7965344b5774efe1338377))

## [0.10.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.9.0...the-vibe-companion-v0.10.0) (2026-02-10)


### Features

* **web:** git worktree support with branch picker and git pull ([#65](https://github.com/The-Vibe-Company/companion/issues/65)) ([4d0c9c8](https://github.com/The-Vibe-Company/companion/commit/4d0c9c83f4fe13be863313d6c945ce0b671a7f8a))

## [0.9.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.8.1...the-vibe-companion-v0.9.0) (2026-02-10)


### Features

* claude.md update ([7fa4e7a](https://github.com/The-Vibe-Company/companion/commit/7fa4e7adfdc7c409cfeed4e8a11f237ff0572234))
* **web:** add git worktree support for isolated multi-branch sessions ([#64](https://github.com/The-Vibe-Company/companion/issues/64)) ([fee39d6](https://github.com/The-Vibe-Company/companion/commit/fee39d62986cd99700ba78c84a1f586331955ff8))

## [0.8.1](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.8.0...the-vibe-companion-v0.8.1) (2026-02-10)


### Bug Fixes

* **web:** chat scroll and composer visibility in plan mode ([#55](https://github.com/The-Vibe-Company/companion/issues/55)) ([4cff10c](https://github.com/The-Vibe-Company/companion/commit/4cff10cde297b7142c088584b6dd83060902c526))

## [0.8.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.7.0...the-vibe-companion-v0.8.0) (2026-02-10)


### Features

* **web:** archive sessions instead of deleting them ([#56](https://github.com/The-Vibe-Company/companion/issues/56)) ([489d608](https://github.com/The-Vibe-Company/companion/commit/489d6087fc99b9131386547edaf3bd303a114090))

## [0.7.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.6.1...the-vibe-companion-v0.7.0) (2026-02-10)


### Features

* **web:** named environment profiles (~/.companion/envs/) ([#50](https://github.com/The-Vibe-Company/companion/issues/50)) ([eaa1a49](https://github.com/The-Vibe-Company/companion/commit/eaa1a497f3be61f2f71f9467e93fa2b65be19095))

## [0.6.1](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.6.0...the-vibe-companion-v0.6.1) (2026-02-10)


### Bug Fixes

* **web:** session reconnection with auto-relaunch and persist ([#49](https://github.com/The-Vibe-Company/companion/issues/49)) ([f58e542](https://github.com/The-Vibe-Company/companion/commit/f58e5428847a342069e6790fa7d70f190bc5f396))
* **web:** use --resume on CLI relaunch to restore conversation context ([#46](https://github.com/The-Vibe-Company/companion/issues/46)) ([3e2b5bd](https://github.com/The-Vibe-Company/companion/commit/3e2b5bdd39bd265ca5675784227a9f1b4f2a8aa3))

## [0.6.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.5.0...the-vibe-companion-v0.6.0) (2026-02-10)


### Features

* **web:** git info display, folder dropdown fix, dev workflow ([#43](https://github.com/The-Vibe-Company/companion/issues/43)) ([1fe2069](https://github.com/The-Vibe-Company/companion/commit/1fe2069a7db17b410e383f883c934ee1662c2171))
* **web:** persist sessions to disk for dev mode resilience ([#45](https://github.com/The-Vibe-Company/companion/issues/45)) ([c943d00](https://github.com/The-Vibe-Company/companion/commit/c943d0047b728854f059e26facde950e08cdfe0c))

## [0.5.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.4.0...the-vibe-companion-v0.5.0) (2026-02-09)


### Features

* **web:** add permission suggestions and pending permission indicators ([10422c1](https://github.com/The-Vibe-Company/companion/commit/10422c1464b6ad4bc45eb90e6cd9ebbc0ebeac92))

## [0.4.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.3.0...the-vibe-companion-v0.4.0) (2026-02-09)


### Features

* **web:** add component playground and ExitPlanMode display ([#36](https://github.com/The-Vibe-Company/companion/issues/36)) ([e958be7](https://github.com/The-Vibe-Company/companion/commit/e958be780f1b6e1a8f65daedbf968cdf6ef47798))

## [0.3.0](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.2.2...the-vibe-companion-v0.3.0) (2026-02-09)


### Features

* allow dev server access over Tailscale/LAN ([#33](https://github.com/The-Vibe-Company/companion/issues/33)) ([9599d7a](https://github.com/The-Vibe-Company/companion/commit/9599d7ad4e2823d51c8fa262e1dcd96eeb056244))


### Bug Fixes

* scope permission requests to their session tab ([#35](https://github.com/The-Vibe-Company/companion/issues/35)) ([ef9f41c](https://github.com/The-Vibe-Company/companion/commit/ef9f41c8589e382de1db719984931bc4e91aeb11))

## [0.2.2](https://github.com/The-Vibe-Company/companion/compare/the-vibe-companion-v0.2.1...the-vibe-companion-v0.2.2) (2026-02-09)


### Bug Fixes

* remove vibe alias, update repo URLs to companion ([#30](https://github.com/The-Vibe-Company/companion/issues/30)) ([4f7b47c](https://github.com/The-Vibe-Company/companion/commit/4f7b47cba86c278e89fe81292fea9b8b3e75c035))
* show pasted images in chat history ([#32](https://github.com/The-Vibe-Company/companion/issues/32)) ([46365be](https://github.com/The-Vibe-Company/companion/commit/46365be45ae8b325100ed296617455c105d4d52e))

## [0.2.1](https://github.com/The-Vibe-Company/claude-code-controller/compare/the-vibe-companion-v0.2.0...the-vibe-companion-v0.2.1) (2026-02-09)


### Bug Fixes

* track all commits in release-please, not just web/ ([#27](https://github.com/The-Vibe-Company/claude-code-controller/issues/27)) ([d49f649](https://github.com/The-Vibe-Company/claude-code-controller/commit/d49f64996d02807baf0482ce3c3607ae59f78638))
* use correct secret name NPM_PUBLISH_TOKEN in publish workflow ([e296ab0](https://github.com/The-Vibe-Company/claude-code-controller/commit/e296ab0fabd6345b1f21c7094ca1f8d6f6af79cb))
* use correct secret name NPM_PUBLISH_TOKEN in publish workflow ([#26](https://github.com/The-Vibe-Company/claude-code-controller/issues/26)) ([61eed5a](https://github.com/The-Vibe-Company/claude-code-controller/commit/61eed5addd6e332fac360d9ae8239f1b0f93868e))
