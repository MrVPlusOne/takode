import { setLandingRunnerApiPort } from "../landing-runner-launcher.js";
import { ensureBuiltInQuestJourneyPhaseData } from "../quest-journey-phases.js";
import { ensureQuestmasterIntegration } from "../quest-integration.js";
import { ensureSkillSymlinks, GLOBAL_SKILL_SLUGS } from "../skill-symlink.js";
import { runPreListenStartupReadiness } from "../startup-readiness.js";
import { ensureTakodeIntegration } from "../takode-integration.js";

/**
 * Set up a `takode node` on another machine than its coordinator before it
 * connects: agents there need the same CLI wrappers, skills and phase briefs
 * as on the coordinator, installed from this machine's own Takode checkout,
 * and landing runners started here reach the coordinator through the node's
 * API proxy on `apiPort`. This machine's own node needs none of it (the
 * coordinator installs them), so it never loads this module.
 */
export async function setUpRemoteNode(apiPort: number, packageRoot: string): Promise<void> {
  setLandingRunnerApiPort(apiPort);
  await runPreListenStartupReadiness(
    {
      ensureQuestmasterIntegration,
      ensureTakodeIntegration,
      ensureBuiltInQuestJourneyPhaseData,
      ensureSkillSymlinks,
    },
    { port: apiPort, packageRoot, startupSkillSlugs: GLOBAL_SKILL_SLUGS },
  );
}
