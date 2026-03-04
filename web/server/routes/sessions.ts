import { Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { resolveBinary, expandTilde } from "../path-resolver.js";
import { readFile, writeFile, stat, readdir, access as accessAsync } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import type { CliLauncher } from "../cli-launcher.js";
import * as envManager from "../env-manager.js";
import * as gitUtils from "../git-utils.js";
import * as sessionNames from "../session-names.js";
import * as sessionOrderStore from "../session-order.js";
import * as groupOrderStore from "../group-order.js";
import { recreateWorktreeIfMissing } from "../migration.js";
import { containerManager, ContainerManager, type ContainerConfig, type ContainerInfo } from "../container-manager.js";
import type { CreationStepId } from "../session-types.js";
import { hasContainerClaudeAuth } from "../claude-container-auth.js";
import { hasContainerCodexAuth } from "../codex-container-auth.js";
import { getSettings } from "../settings-manager.js";
import { searchSessionDocuments, type SessionSearchDocument } from "../session-search.js";
import { ensureAssistantWorkspace, ASSISTANT_DIR } from "../assistant-workspace.js";
import { generateUniqueSessionName } from "../../src/utils/names.js";
import { GIT_CMD_TIMEOUT } from "../constants.js";
import type { RouteContext } from "./context.js";

export function createSessionsRoutes(ctx: RouteContext) {
  const api = new Hono();
  const {
    launcher,
    wsBridge,
    sessionStore,
    worktreeTracker,
    prPoller,
    imageStore,
    resolveId,
    authenticateTakodeCaller,
    execCaptureStdoutAsync,
    pathExists,
    WEB_DIR,
    ORCHESTRATOR_SYSTEM_PROMPT,
    resolveInitialModeState,
  } = ctx;

  // ─── Worktree cleanup helper ────────────────────────────────────

  function cleanupWorktree(
    sessionId: string,
    force?: boolean,
  ): { cleaned?: boolean; dirty?: boolean; path?: string } | undefined {
    const mapping = worktreeTracker.getBySession(sessionId);
    if (!mapping) return undefined;

    // Check if other sessions still use this worktree
    if (worktreeTracker.isWorktreeInUse(mapping.worktreePath, sessionId)) {
      worktreeTracker.removeBySession(sessionId);
      return { cleaned: false, path: mapping.worktreePath };
    }

    // Auto-remove if clean, or force-remove if requested
    const dirty = gitUtils.isWorktreeDirty(mapping.worktreePath);
    if (dirty && !force) {
      return { cleaned: false, dirty: true, path: mapping.worktreePath };
    }

    // Delete companion-managed branch if it differs from the user-selected branch
    const branchToDelete =
      mapping.actualBranch && mapping.actualBranch !== mapping.branch
        ? mapping.actualBranch
        : undefined;
    const result = gitUtils.removeWorktree(mapping.repoRoot, mapping.worktreePath, {
      force: dirty,
      branchToDelete,
    });
    if (result.removed) {
      worktreeTracker.removeBySession(sessionId);
    }
    return { cleaned: result.removed, path: mapping.worktreePath };
  }
  // ─── SDK Sessions (--sdk-url) ─────────────────────────────────────

  api.post("/sessions/create", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const backend = body.backend ?? "claude";
      if (backend !== "claude" && backend !== "codex" && backend !== "claude-sdk") {
        return c.json({ error: `Invalid backend: ${String(backend)}` }, 400);
      }

      // ── Resume fast-path: skip git/worktree/container logic ──
      if (body.resumeCliSessionId) {
        if (backend !== "claude") {
          return c.json({ error: "Resuming CLI sessions is only supported for Claude backend" }, 400);
        }
        let envVars: Record<string, string> | undefined = body.env;
        if (body.envSlug) {
          const companionEnv = await envManager.getEnv(body.envSlug);
          if (companionEnv) envVars = { ...companionEnv.variables, ...body.env };
        }
        // Inject COMPANION_PORT so resumed sessions can call the local API.
        envVars = { ...envVars, COMPANION_PORT: String(launcher.getPort()) };
        // Add orchestrator env vars if role is specified
        if (body.role === "orchestrator") {
          envVars.TAKODE_ROLE = "orchestrator";
          envVars.TAKODE_API_PORT = String(launcher.getPort());
        }
        const binarySettings = getSettings();
        const session = await launcher.launch({
          cwd: body.cwd ? resolve(expandTilde(body.cwd)) : process.cwd(),
          claudeBinary: body.claudeBinary || binarySettings.claudeBinary || undefined,
          env: envVars,
          backendType: "claude",
          resumeCliSessionId: body.resumeCliSessionId,
          permissionMode: body.askPermission !== false ? "plan" : "bypassPermissions",
          askPermission: body.askPermission !== false,
        });
        if (body.role === "orchestrator") {
          session.isOrchestrator = true;
        }
        if (body.envSlug) session.envSlug = body.envSlug;
        const resumeAskPermission = body.askPermission !== false;
        wsBridge.setInitialAskPermission(
          session.sessionId,
          resumeAskPermission,
          resumeAskPermission ? "plan" : "agent",
        );
        wsBridge.markResumedFromExternal(session.sessionId);
        const existingNames = new Set(Object.values(sessionNames.getAllNames()));
        sessionNames.setName(session.sessionId, generateUniqueSessionName(existingNames));
        // Auto-herd: if creator is an orchestrator, herd the new session
        if (body.createdBy) {
          const creatorId = resolveId(String(body.createdBy));
          const creator = creatorId ? launcher.getSession(creatorId) : null;
          if (creator?.isOrchestrator) {
            launcher.herdSessions(creator.sessionId, [session.sessionId]);
          }
        }
        wsBridge.broadcastGlobal({ type: "session_created", session_id: session.sessionId });
        return c.json(session);
      }

      // Resolve environment variables from envSlug
      let envVars: Record<string, string> | undefined = body.env;
      if (body.envSlug) {
        const companionEnv = await envManager.getEnv(body.envSlug);
        if (companionEnv) {
          console.log(
            `[routes] Injecting env "${companionEnv.name}" (${Object.keys(companionEnv.variables).length} vars):`,
            Object.keys(companionEnv.variables).join(", "),
          );
          envVars = { ...companionEnv.variables, ...body.env };
        } else {
          console.warn(
            `[routes] Environment "${body.envSlug}" not found, ignoring`,
          );
        }
      }

      let cwd = body.cwd;
      const isAssistantMode = body.assistantMode === true;
      let worktreeInfo: { isWorktree: boolean; repoRoot: string; branch: string; actualBranch: string; worktreePath: string; defaultBranch: string } | undefined;

      // Expand tilde and validate cwd before any downstream use
      if (cwd) {
        cwd = resolve(expandTilde(cwd));
        if (!existsSync(cwd)) { // sync-ok: route handler, not called during message handling
          return c.json({ error: `Directory does not exist: ${cwd}` }, 400);
        }
      }

      // Inject COMPANION_PORT so agents in any session can call the REST API
      envVars = { ...envVars, COMPANION_PORT: String(launcher.getPort()) };
      // Add orchestrator env vars if role is specified
      if (body.role === "orchestrator") {
        envVars.TAKODE_ROLE = "orchestrator";
        envVars.TAKODE_API_PORT = String(launcher.getPort());
      }

      // Assistant mode: override cwd and ensure workspace exists
      if (isAssistantMode) {
        ensureAssistantWorkspace();
        cwd = ASSISTANT_DIR;
      }

      // Validate branch name to prevent command injection via shell metacharacters
      if (body.branch && !/^[a-zA-Z0-9/_.\-]+$/.test(body.branch)) {
        return c.json({ error: "Invalid branch name" }, 400);
      }

      if (body.useWorktree) {
        if (!cwd) {
          return c.json({ error: "Worktree mode requires a cwd" }, 400);
        }
        // Worktree isolation: create/reuse a worktree for the selected branch.
        // If the UI hasn't loaded branch metadata yet, fall back to current branch.
        const repoInfo = gitUtils.getRepoInfo(cwd);
        if (!repoInfo) {
          return c.json({ error: "Worktree mode requires a git repository" }, 400);
        }
        const targetBranch = body.branch || repoInfo.currentBranch;
        if (!targetBranch) {
          return c.json({ error: "Unable to determine branch for worktree session" }, 400);
        }
        const result = gitUtils.ensureWorktree(repoInfo.repoRoot, targetBranch, {
          baseBranch: repoInfo.defaultBranch,
          createBranch: body.createBranch,
          forceNew: true,
        });
        cwd = result.worktreePath;
        worktreeInfo = {
          isWorktree: true,
          repoRoot: repoInfo.repoRoot,
          branch: targetBranch,
          actualBranch: result.actualBranch,
          worktreePath: result.worktreePath,
          defaultBranch: repoInfo.defaultBranch,
        };
      } else if (body.branch && cwd) {
        // Non-worktree: attempt to checkout the selected branch in-place.
        // All git operations are non-fatal — dirty repos, auth failures, or missing
        // branches just proceed with the current state. The session will use whatever
        // branch the repo is currently on.
        const repoInfo = gitUtils.getRepoInfo(cwd);
        if (repoInfo) {
          const fetchResult = gitUtils.gitFetch(repoInfo.repoRoot);
          if (!fetchResult.success) {
            console.warn(`[routes] git fetch warning (non-fatal): ${fetchResult.output}`);
          }

          if (repoInfo.currentBranch !== body.branch) {
            try {
              gitUtils.checkoutBranch(repoInfo.repoRoot, body.branch);
            } catch (err) {
              console.warn(`[routes] git checkout warning (non-fatal, repo may have uncommitted changes): ${err}`);
            }
          }

          const pullResult = gitUtils.gitPull(repoInfo.repoRoot);
          if (!pullResult.success) {
            console.warn(`[routes] git pull warning (non-fatal): ${pullResult.output}`);
          }
        }
      }

      // Resolve Docker image from environment or explicit container config
      const companionEnv = body.envSlug ? await envManager.getEnv(body.envSlug) : null;
      let effectiveImage = companionEnv
        ? (body.envSlug ? await envManager.getEffectiveImage(body.envSlug) : null)
        : (body.container?.image || null);

      let containerInfo: ContainerInfo | undefined;
      let containerId: string | undefined;
      let containerName: string | undefined;
      let containerImage: string | undefined;

      // Containers cannot use host keychain auth.
      // Fail fast with a clear error when no container-compatible auth is present.
      if (effectiveImage && backend === "claude" && !hasContainerClaudeAuth(envVars)) {
        return c.json({
          error:
            "Containerized Claude requires auth available inside the container. " +
            "Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN / CLAUDE_CODE_AUTH_TOKEN) in the selected environment.",
        }, 400);
      }
      if (effectiveImage && backend === "codex" && !hasContainerCodexAuth(envVars)) {
        return c.json({
          error:
            "Containerized Codex requires auth available inside the container. " +
            "Set OPENAI_API_KEY in the selected environment, or ensure ~/.codex/auth.json exists on the host.",
        }, 400);
      }

      // Create container if a Docker image is available.
      // Do not silently fall back to host execution: if container startup fails,
      // return an explicit error.
      if (effectiveImage) {
        if (!containerManager.imageExists(effectiveImage)) {
          // Auto-build for default images (the-companion or legacy companion-dev)
          const isDefaultImage = effectiveImage === "the-companion:latest" || effectiveImage === "companion-dev:latest";
          if (isDefaultImage) {
            // Try fallback: if the-companion requested but companion-dev exists, use it
            if (effectiveImage === "the-companion:latest" && containerManager.imageExists("companion-dev:latest")) {
              console.warn("[routes] the-companion:latest not found, falling back to companion-dev:latest (deprecated)");
              effectiveImage = "companion-dev:latest";
            } else {
              // Try pulling from Docker Hub first, fall back to local build
              const registryImage = ContainerManager.getRegistryImage(effectiveImage);
              let pulled = false;
              if (registryImage) {
                console.log(`[routes] ${effectiveImage} missing locally, trying docker pull ${registryImage}...`);
                pulled = await containerManager.pullImage(registryImage, effectiveImage);
              }

              if (!pulled) {
                // Fall back to local Dockerfile build
                const dockerfileName = effectiveImage === "the-companion:latest"
                  ? "Dockerfile.the-companion"
                  : "Dockerfile.companion-dev";
                const dockerfilePath = join(WEB_DIR, "docker", dockerfileName);
                if (!existsSync(dockerfilePath)) { // sync-ok: route handler, not called during message handling
                  return c.json({
                    error:
                      `Docker image ${effectiveImage} is missing, pull failed, and Dockerfile not found at ${dockerfilePath}`,
                  }, 503);
                }
                try {
                  console.log(`[routes] Pull failed/unavailable, building ${effectiveImage} from Dockerfile...`);
                  containerManager.buildImage(dockerfilePath, effectiveImage);
                } catch (err) {
                  const reason = err instanceof Error ? err.message : String(err);
                  return c.json({
                    error:
                      `Docker image ${effectiveImage} is missing: pull and build both failed: ${reason}`,
                  }, 503);
                }
              }
            }
          } else {
            return c.json({
              error:
                `Docker image not found locally: ${effectiveImage}. ` +
                "Build/pull the image first, then retry.",
            }, 503);
          }
        }

        const tempId = crypto.randomUUID().slice(0, 8);
        const cConfig: ContainerConfig = {
          image: effectiveImage,
          ports: companionEnv?.ports
            ?? (Array.isArray(body.container?.ports)
              ? body.container.ports.map(Number).filter((n: number) => n > 0)
              : []),
          volumes: companionEnv?.volumes ?? body.container?.volumes,
          env: envVars,
        };
        try {
          containerInfo = containerManager.createContainer(tempId, cwd, cConfig);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          return c.json({
            error:
              `Docker is required to run this environment image (${effectiveImage}) ` +
              `but container startup failed: ${reason}`,
          }, 503);
        }
        containerId = containerInfo.containerId;
        containerName = containerInfo.name;
        containerImage = effectiveImage;

        // Copy workspace files into the container's isolated volume
        try {
          await containerManager.copyWorkspaceToContainer(containerInfo.containerId, cwd);
          containerManager.reseedGitAuth(containerInfo.containerId);
        } catch (err) {
          containerManager.removeContainer(tempId);
          const reason = err instanceof Error ? err.message : String(err);
          return c.json({
            error: `Failed to copy workspace to container: ${reason}`,
          }, 503);
        }

        // Run per-environment init script if configured
        if (companionEnv?.initScript?.trim()) {
          try {
            console.log(`[routes] Running init script for env "${companionEnv.name}" in container ${containerInfo.name}...`);
            const initTimeout = Number(process.env.COMPANION_INIT_SCRIPT_TIMEOUT) || 120_000;
            const result = await containerManager.execInContainerAsync(
              containerInfo.containerId,
              ["sh", "-lc", companionEnv.initScript],
              { timeout: initTimeout },
            );
            if (result.exitCode !== 0) {
              console.error(
                `[routes] Init script failed for env "${companionEnv.name}" (exit ${result.exitCode}):\n${result.output}`,
              );
              containerManager.removeContainer(tempId);
              const truncated = result.output.length > 2000
                ? result.output.slice(0, 500) + "\n...[truncated]...\n" + result.output.slice(-1500)
                : result.output;
              return c.json({
                error: `Init script failed (exit ${result.exitCode}):\n${truncated}`,
              }, 503);
            }
            console.log(`[routes] Init script completed successfully for env "${companionEnv.name}"`);
          } catch (e) {
            containerManager.removeContainer(tempId);
            const reason = e instanceof Error ? e.message : String(e);
            return c.json({
              error: `Init script execution failed: ${reason}`,
            }, 503);
          }
        }
      }

      // Resolve initial mode state from askPermission (+ optional permissionMode).
      // For Codex, default to gpt-5.3-codex if no model provided (Codex requires explicit model).
      // For Claude, undefined is fine — the CLI uses its own configured default.
      const askPermissionRequested = body.askPermission !== false;
      const initialModeState = resolveInitialModeState(backend, body.permissionMode, askPermissionRequested);
      const model = body.model || (backend === "codex" ? "gpt-5.3-codex" : undefined);
      const codexReasoningEffort = backend === "codex" && typeof body.codexReasoningEffort === "string"
        ? (body.codexReasoningEffort.trim() || undefined)
        : undefined;
      // Inject orchestrator guardrails into .claude/CLAUDE.md before launch
      if (body.role === "orchestrator" && cwd) {
        await launcher.injectOrchestratorGuardrails(cwd, launcher.getPort());
      }

      const binarySettings = getSettings();
      const session = await launcher.launch({
        model,
        permissionMode: initialModeState.permissionMode,
        askPermission: initialModeState.askPermission,
        cwd,
        claudeBinary: body.claudeBinary || binarySettings.claudeBinary || undefined,
        codexBinary: body.codexBinary || binarySettings.codexBinary || undefined,
        codexInternetAccess: backend === "codex" && body.codexInternetAccess === true,
        codexSandbox: backend === "codex" && body.codexInternetAccess === true
          ? "danger-full-access"
          : "workspace-write",
        codexReasoningEffort,
        allowedTools: body.allowedTools,
        env: envVars,
        backendType: backend,
        containerId,
        containerName,
        containerImage,
        worktreeInfo,
      });

      // Re-track container with real session ID and mark session as containerized
      // so the bridge preserves the host cwd for sidebar grouping
      if (containerInfo) {
        containerManager.retrack(containerInfo.containerId, session.sessionId);
        wsBridge.markContainerized(session.sessionId, cwd);
      }

      // Track the worktree mapping and pre-populate session state
      // so the browser gets correct sidebar grouping immediately
      if (worktreeInfo) {
        wsBridge.markWorktree(session.sessionId, worktreeInfo.repoRoot, cwd, worktreeInfo.defaultBranch, worktreeInfo.branch);
        worktreeTracker.addMapping({
          sessionId: session.sessionId,
          repoRoot: worktreeInfo.repoRoot,
          branch: worktreeInfo.branch,
          actualBranch: worktreeInfo.actualBranch,
          worktreePath: worktreeInfo.worktreePath,
          createdAt: Date.now(),
        });
      }

      // Set initial askPermission/uiMode so state_snapshot is consistent on first paint.
      wsBridge.setInitialAskPermission(
        session.sessionId,
        initialModeState.askPermission,
        initialModeState.uiMode,
      );

      // Mark as assistant session if in assistant mode
      if (isAssistantMode) {
        session.isAssistant = true;
      }

      // Mark as orchestrator session if role is specified
      if (body.role === "orchestrator") {
        session.isOrchestrator = true;
        // Fire-and-forget: wait for CLI to connect, then send identity message
        (async () => {
          const maxWait = 30_000;
          const pollMs = 200;
          const start = Date.now();
          while (Date.now() - start < maxWait) {
            const info = launcher.getSession(session.sessionId);
            if (info && (info.state === "connected" || info.state === "running")) {
              wsBridge.injectUserMessage(session.sessionId,
                ORCHESTRATOR_SYSTEM_PROMPT
              );
              return;
            }
            if (info?.state === "exited") return; // CLI crashed, don't inject
            await new Promise(r => setTimeout(r, pollMs));
          }
        })().catch(e => console.error(`[routes] Failed to inject orchestrator message:`, e));
      }

      if (body.envSlug) session.envSlug = body.envSlug;

      // Generate a session name so all creation paths (browser, CLI, API) get names
      if (isAssistantMode) {
        sessionNames.setName(session.sessionId, "Takode");
      } else {
        const existingNames = new Set(Object.values(sessionNames.getAllNames()));
        const generatedName = generateUniqueSessionName(existingNames);
        sessionNames.setName(session.sessionId, generatedName);
      }

      // Auto-herd: if creator is an orchestrator, herd the new session
      if (body.createdBy) {
        const creatorId = resolveId(String(body.createdBy));
        const creator = creatorId ? launcher.getSession(creatorId) : null;
        if (creator?.isOrchestrator) {
          launcher.herdSessions(creator.sessionId, [session.sessionId]);
        }
      }

      wsBridge.broadcastGlobal({ type: "session_created", session_id: session.sessionId });
      return c.json(session);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[routes] Failed to create session:", msg);
      return c.json({ error: msg }, 500);
    }
  });

  // ─── SSE Session Creation (with progress streaming) ─────────────────────

  api.post("/sessions/create-stream", async (c) => {
    const body = await c.req.json().catch(() => ({}));

    const emitProgress = (
      stream: SSEStreamingApi,
      step: CreationStepId,
      label: string,
      status: "in_progress" | "done" | "error",
      detail?: string,
    ) =>
      stream.writeSSE({
        event: "progress",
        data: JSON.stringify({ step, label, status, detail }),
      });

    return streamSSE(c, async (stream) => {
      try {
        const backend = body.backend ?? "claude";
        if (backend !== "claude" && backend !== "codex" && backend !== "claude-sdk") {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ error: `Invalid backend: ${String(backend)}` }),
          });
          return;
        }

        // ── Resume fast-path: skip git/worktree/container logic ──
        if (body.resumeCliSessionId) {
          if (backend !== "claude") {
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({ error: "Resuming CLI sessions is only supported for Claude backend" }),
            });
            return;
          }
          await emitProgress(stream, "resolving_env", "Resolving environment...", "in_progress");
          let envVars: Record<string, string> | undefined = body.env;
          if (body.envSlug) {
            const companionEnv = await envManager.getEnv(body.envSlug);
            if (companionEnv) envVars = { ...companionEnv.variables, ...body.env };
          }
          // Inject COMPANION_PORT so resumed sessions can call the local API.
          envVars = { ...envVars, COMPANION_PORT: String(launcher.getPort()) };
          // Add orchestrator env vars if role is specified
          if (body.role === "orchestrator") {
            envVars.TAKODE_ROLE = "orchestrator";
            envVars.TAKODE_API_PORT = String(launcher.getPort());
          }
          await emitProgress(stream, "resolving_env", "Environment resolved", "done");

          await emitProgress(stream, "launching_cli", "Resuming CLI session...", "in_progress");
          const binarySettings = getSettings();
          const session = await launcher.launch({
            cwd: body.cwd ? resolve(expandTilde(body.cwd)) : process.cwd(),
            claudeBinary: body.claudeBinary || binarySettings.claudeBinary || undefined,
            env: envVars,
            backendType: "claude",
            resumeCliSessionId: body.resumeCliSessionId,
            permissionMode: body.askPermission !== false ? "plan" : "bypassPermissions",
            askPermission: body.askPermission !== false,
          });
          if (body.role === "orchestrator") {
            session.isOrchestrator = true;
          }
          if (body.envSlug) session.envSlug = body.envSlug;
          wsBridge.setInitialCwd(session.sessionId, body.cwd ? resolve(expandTilde(body.cwd)) : process.cwd());
          const resumeAskPermission = body.askPermission !== false;
          wsBridge.setInitialAskPermission(
            session.sessionId,
            resumeAskPermission,
            resumeAskPermission ? "plan" : "agent",
          );
          wsBridge.markResumedFromExternal(session.sessionId);
          const existingNames = new Set(Object.values(sessionNames.getAllNames()));
          sessionNames.setName(session.sessionId, generateUniqueSessionName(existingNames));
          await emitProgress(stream, "launching_cli", "Session resumed", "done");

          wsBridge.broadcastGlobal({ type: "session_created", session_id: session.sessionId });
          await stream.writeSSE({
            event: "done",
            data: JSON.stringify({
              sessionId: session.sessionId,
              state: session.state,
              cwd: session.cwd,
            }),
          });
          return;
        }

        // --- Step: Resolve environment ---
        await emitProgress(stream, "resolving_env", "Resolving environment...", "in_progress");

        let envVars: Record<string, string> | undefined = body.env;
        const companionEnv = body.envSlug ? await envManager.getEnv(body.envSlug) : null;
        if (body.envSlug && companionEnv) {
          envVars = { ...companionEnv.variables, ...body.env };
        }

        await emitProgress(stream, "resolving_env", "Environment resolved", "done");

        let cwd = body.cwd;
        const isAssistantMode = body.assistantMode === true;
        let worktreeInfo: { isWorktree: boolean; repoRoot: string; branch: string; actualBranch: string; worktreePath: string; defaultBranch: string } | undefined;

        // Expand tilde and validate cwd before any downstream use
        if (cwd) {
          cwd = resolve(expandTilde(cwd));
          if (!existsSync(cwd)) { // sync-ok: route handler, not called during message handling
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({ error: `Directory does not exist: ${cwd}`, step: "resolving_env" }),
            });
            return;
          }
        }

        // Inject COMPANION_PORT so agents in any session can call the REST API
        envVars = { ...envVars, COMPANION_PORT: String(launcher.getPort()) };
        // Add orchestrator env vars if role is specified
        if (body.role === "orchestrator") {
          envVars.TAKODE_ROLE = "orchestrator";
          envVars.TAKODE_API_PORT = String(launcher.getPort());
        }

        // Assistant mode: override cwd and ensure workspace exists
        if (isAssistantMode) {
          ensureAssistantWorkspace();
          cwd = ASSISTANT_DIR;
        }

        // Validate branch name
        if (body.branch && !/^[a-zA-Z0-9/_.\-]+$/.test(body.branch)) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ error: "Invalid branch name", step: "checkout_branch" }),
          });
          return;
        }

        // --- Step: Git operations ---
        if (body.useWorktree) {
          if (!cwd) {
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({ error: "Worktree mode requires a cwd", step: "creating_worktree" }),
            });
            return;
          }
          await emitProgress(stream, "creating_worktree", "Creating worktree...", "in_progress");
          const repoInfo = gitUtils.getRepoInfo(cwd);
          if (!repoInfo) {
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({ error: "Worktree mode requires a git repository", step: "creating_worktree" }),
            });
            return;
          }
          // If branch metadata hasn't loaded in the client yet, default to current branch.
          const targetBranch = body.branch || repoInfo.currentBranch;
          if (!targetBranch) {
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({ error: "Unable to determine branch for worktree session", step: "creating_worktree" }),
            });
            return;
          }
          const result = gitUtils.ensureWorktree(repoInfo.repoRoot, targetBranch, {
            baseBranch: repoInfo.defaultBranch,
            createBranch: body.createBranch,
            forceNew: true,
          });
          cwd = result.worktreePath;
          worktreeInfo = {
            isWorktree: true,
            repoRoot: repoInfo.repoRoot,
            branch: targetBranch,
            actualBranch: result.actualBranch,
            worktreePath: result.worktreePath,
            defaultBranch: repoInfo.defaultBranch,
          };
          await emitProgress(stream, "creating_worktree", "Worktree ready", "done");
        } else if (body.branch && cwd) {
          const repoInfo = gitUtils.getRepoInfo(cwd);
          if (repoInfo) {
            await emitProgress(stream, "fetching_git", "Fetching from remote...", "in_progress");
            const fetchResult = gitUtils.gitFetch(repoInfo.repoRoot);
            if (!fetchResult.success) {
              console.warn(`[routes] git fetch warning (non-fatal): ${fetchResult.output}`);
              await emitProgress(stream, "fetching_git", "Fetch skipped (offline or auth issue)", "done");
            } else {
              await emitProgress(stream, "fetching_git", "Fetch complete", "done");
            }

            if (repoInfo.currentBranch !== body.branch) {
              await emitProgress(stream, "checkout_branch", `Checking out ${body.branch}...`, "in_progress");
              try {
                gitUtils.checkoutBranch(repoInfo.repoRoot, body.branch);
                await emitProgress(stream, "checkout_branch", `On branch ${body.branch}`, "done");
              } catch (err) {
                console.warn(`[routes] git checkout warning (non-fatal, repo may have uncommitted changes): ${err}`);
                await emitProgress(stream, "checkout_branch", `Checkout skipped (uncommitted changes)`, "done");
              }
            }

            await emitProgress(stream, "pulling_git", "Pulling latest changes...", "in_progress");
            const pullResult = gitUtils.gitPull(repoInfo.repoRoot);
            if (!pullResult.success) {
              console.warn(`[routes] git pull warning (non-fatal): ${pullResult.output}`);
            }
            await emitProgress(stream, "pulling_git", "Up to date", "done");
          }
        }

        // --- Step: Docker image resolution ---
        let effectiveImage = companionEnv
          ? (body.envSlug ? await envManager.getEffectiveImage(body.envSlug) : null)
          : (body.container?.image || null);

        let containerInfo: ContainerInfo | undefined;
        let containerId: string | undefined;
        let containerName: string | undefined;
        let containerImage: string | undefined;

        // Auth check for containerized sessions
        if (effectiveImage && backend === "claude" && !hasContainerClaudeAuth(envVars)) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({
              error:
                "Containerized Claude requires auth available inside the container. " +
                "Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN / CLAUDE_CODE_AUTH_TOKEN) in the selected environment.",
            }),
          });
          return;
        }
        if (effectiveImage && backend === "codex" && !hasContainerCodexAuth(envVars)) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({
              error:
                "Containerized Codex requires auth available inside the container. " +
                "Set OPENAI_API_KEY in the selected environment, or ensure ~/.codex/auth.json exists on the host.",
            }),
          });
          return;
        }

        if (effectiveImage) {
          if (!containerManager.imageExists(effectiveImage)) {
            const isDefaultImage = effectiveImage === "the-companion:latest" || effectiveImage === "companion-dev:latest";
            if (isDefaultImage) {
              if (effectiveImage === "the-companion:latest" && containerManager.imageExists("companion-dev:latest")) {
                effectiveImage = "companion-dev:latest";
              } else {
                // Try pulling from Docker Hub first
                const registryImage = ContainerManager.getRegistryImage(effectiveImage);
                let pulled = false;
                if (registryImage) {
                  await emitProgress(stream, "pulling_image", "Pulling Docker image...", "in_progress");
                  pulled = await containerManager.pullImage(registryImage, effectiveImage);
                  if (pulled) {
                    await emitProgress(stream, "pulling_image", "Image pulled", "done");
                  } else {
                    await emitProgress(stream, "pulling_image", "Pull failed, falling back to build", "error");
                  }
                }

                // Fall back to local build if pull failed
                if (!pulled) {
                  const dockerfileName = effectiveImage === "the-companion:latest"
                    ? "Dockerfile.the-companion"
                    : "Dockerfile.companion-dev";
                  const dockerfilePath = join(WEB_DIR, "docker", dockerfileName);
                  if (!existsSync(dockerfilePath)) { // sync-ok: route handler, not called during message handling
                    await stream.writeSSE({
                      event: "error",
                      data: JSON.stringify({
                        error: `Docker image ${effectiveImage} is missing, pull failed, and Dockerfile not found at ${dockerfilePath}`,
                        step: "building_image",
                      }),
                    });
                    return;
                  }
                  try {
                    await emitProgress(stream, "building_image", "Building Docker image (this may take a minute)...", "in_progress");
                    containerManager.buildImage(dockerfilePath, effectiveImage);
                    await emitProgress(stream, "building_image", "Image built", "done");
                  } catch (err) {
                    const reason = err instanceof Error ? err.message : String(err);
                    await stream.writeSSE({
                      event: "error",
                      data: JSON.stringify({
                        error: `Docker image build failed: ${reason}`,
                        step: "building_image",
                      }),
                    });
                    return;
                  }
                }
              }
            } else {
              await stream.writeSSE({
                event: "error",
                data: JSON.stringify({
                  error: `Docker image not found locally: ${effectiveImage}. Build/pull the image first, then retry.`,
                }),
              });
              return;
            }
          }

          // --- Step: Create container ---
          await emitProgress(stream, "creating_container", "Starting container...", "in_progress");
          const tempId = crypto.randomUUID().slice(0, 8);
          const cConfig: ContainerConfig = {
            image: effectiveImage,
            ports: companionEnv?.ports
              ?? (Array.isArray(body.container?.ports)
                ? body.container.ports.map(Number).filter((n: number) => n > 0)
                : []),
            volumes: companionEnv?.volumes ?? body.container?.volumes,
            env: envVars,
          };
          try {
            containerInfo = containerManager.createContainer(tempId, cwd, cConfig);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({
                error: `Container startup failed: ${reason}`,
                step: "creating_container",
              }),
            });
            return;
          }
          containerId = containerInfo.containerId;
          containerName = containerInfo.name;
          containerImage = effectiveImage;
          await emitProgress(stream, "creating_container", "Container running", "done");

          // --- Step: Copy workspace into isolated volume ---
          await emitProgress(stream, "copying_workspace", "Copying workspace files...", "in_progress");
          try {
            await containerManager.copyWorkspaceToContainer(containerInfo.containerId, cwd);
            containerManager.reseedGitAuth(containerInfo.containerId);
            await emitProgress(stream, "copying_workspace", "Workspace copied", "done");
          } catch (err) {
            containerManager.removeContainer(tempId);
            const reason = err instanceof Error ? err.message : String(err);
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({
                error: `Failed to copy workspace: ${reason}`,
                step: "copying_workspace",
              }),
            });
            return;
          }

          // --- Step: Init script ---
          if (companionEnv?.initScript?.trim()) {
            await emitProgress(stream, "running_init_script", "Running init script...", "in_progress");
            try {
              const initTimeout = Number(process.env.COMPANION_INIT_SCRIPT_TIMEOUT) || 120_000;
              const result = await containerManager.execInContainerAsync(
                containerInfo.containerId,
                ["sh", "-lc", companionEnv.initScript],
                { timeout: initTimeout },
              );
              if (result.exitCode !== 0) {
                console.error(
                  `[routes] Init script failed for env "${companionEnv.name}" (exit ${result.exitCode}):\n${result.output}`,
                );
                containerManager.removeContainer(tempId);
                const truncated = result.output.length > 2000
                  ? result.output.slice(0, 500) + "\n...[truncated]...\n" + result.output.slice(-1500)
                  : result.output;
                await stream.writeSSE({
                  event: "error",
                  data: JSON.stringify({
                    error: `Init script failed (exit ${result.exitCode}):\n${truncated}`,
                    step: "running_init_script",
                  }),
                });
                return;
              }
              await emitProgress(stream, "running_init_script", "Init script complete", "done");
            } catch (e) {
              containerManager.removeContainer(tempId);
              const reason = e instanceof Error ? e.message : String(e);
              await stream.writeSSE({
                event: "error",
                data: JSON.stringify({
                  error: `Init script execution failed: ${reason}`,
                  step: "running_init_script",
                }),
              });
              return;
            }
          }
        }

        // --- Step: Launch CLI ---
        await emitProgress(stream, "launching_cli", "Launching Claude Code...", "in_progress");

        // Resolve initial mode state from askPermission (+ optional permissionMode).
        const askPermissionRequested = body.askPermission !== false;
        const initialModeState = resolveInitialModeState(backend, body.permissionMode, askPermissionRequested);
        const model = body.model || (backend === "codex" ? "gpt-5.3-codex" : undefined);
        const codexReasoningEffort = backend === "codex" && typeof body.codexReasoningEffort === "string"
          ? (body.codexReasoningEffort.trim() || undefined)
          : undefined;
        // Inject orchestrator guardrails into .claude/CLAUDE.md before launch
        if (body.role === "orchestrator" && cwd) {
          await launcher.injectOrchestratorGuardrails(cwd, launcher.getPort());
        }

        const streamBinarySettings = getSettings();
        const session = await launcher.launch({
          model,
          permissionMode: initialModeState.permissionMode,
          askPermission: initialModeState.askPermission,
          cwd,
          claudeBinary: body.claudeBinary || streamBinarySettings.claudeBinary || undefined,
          codexBinary: body.codexBinary || streamBinarySettings.codexBinary || undefined,
          codexInternetAccess: backend === "codex" && body.codexInternetAccess === true,
          codexSandbox: backend === "codex" && body.codexInternetAccess === true
            ? "danger-full-access"
            : "workspace-write",
          codexReasoningEffort,
          allowedTools: body.allowedTools,
          env: envVars,
          backendType: backend,
          containerId,
          containerName,
          containerImage,
          worktreeInfo,
        });

        // Re-track container and mark session as containerized
        if (containerInfo) {
          containerManager.retrack(containerInfo.containerId, session.sessionId);
          wsBridge.markContainerized(session.sessionId, cwd);
        }

        // Track worktree mapping and pre-populate session state
        // so the browser gets correct sidebar grouping immediately
        if (worktreeInfo) {
          wsBridge.markWorktree(session.sessionId, worktreeInfo.repoRoot, cwd, worktreeInfo.defaultBranch, worktreeInfo.branch);
          worktreeTracker.addMapping({
            sessionId: session.sessionId,
            repoRoot: worktreeInfo.repoRoot,
            branch: worktreeInfo.branch,
            actualBranch: worktreeInfo.actualBranch,
            worktreePath: worktreeInfo.worktreePath,
            createdAt: Date.now(),
          });
        }

        // Set cwd early so slash command cache lookup works before CLI sends system/init.
        // For worktree/container sessions markWorktree/markContainerized already set cwd,
        // so setInitialCwd only fills it for plain sessions and pre-fills slash commands.
        wsBridge.setInitialCwd(session.sessionId, cwd);

        // Set initial askPermission/uiMode so state_snapshot is consistent on first paint.
        wsBridge.setInitialAskPermission(
          session.sessionId,
          initialModeState.askPermission,
          initialModeState.uiMode,
        );

        // Mark as assistant session if in assistant mode
        if (isAssistantMode) {
          session.isAssistant = true;
        }

        // Mark as orchestrator session if role is specified
        if (body.role === "orchestrator") {
          session.isOrchestrator = true;
          // Fire-and-forget: wait for CLI to connect, then send identity message
          (async () => {
            const maxWait = 30_000;
            const pollMs = 200;
            const start = Date.now();
            while (Date.now() - start < maxWait) {
              const info = launcher.getSession(session.sessionId);
              if (info && (info.state === "connected" || info.state === "running")) {
                wsBridge.injectUserMessage(session.sessionId,
                  ORCHESTRATOR_SYSTEM_PROMPT
                );
                return;
              }
              if (info?.state === "exited") return; // CLI crashed, don't inject
              await new Promise(r => setTimeout(r, pollMs));
            }
          })().catch(e => console.error(`[routes] Failed to inject orchestrator message:`, e));
        }

        if (body.envSlug) session.envSlug = body.envSlug;

        // Generate a session name so all creation paths (browser, CLI, API) get names
        if (isAssistantMode) {
          sessionNames.setName(session.sessionId, "Takode");
        } else {
          const existingNames = new Set(Object.values(sessionNames.getAllNames()));
          const generatedName = generateUniqueSessionName(existingNames);
          sessionNames.setName(session.sessionId, generatedName);
        }

        await emitProgress(stream, "launching_cli", "Session started", "done");

        // --- Done ---
        wsBridge.broadcastGlobal({ type: "session_created", session_id: session.sessionId });
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            sessionId: session.sessionId,
            state: session.state,
            cwd: session.cwd,
          }),
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[routes] Failed to create session (stream):", msg);
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ error: msg }),
        });
      }
    });
  });

  // ─── CLI Session Discovery (for resume) ──────────────────────────────────

  api.get("/cli-sessions", async (c) => {
    try {
      const claudeProjectsDir = join(homedir(), ".claude", "projects");
      if (!existsSync(claudeProjectsDir)) { // sync-ok: route handler, not called during message handling
        return c.json({ sessions: [] });
      }

      // Collect active CLI session IDs so we can filter them out
      const activeCliSessionIds = new Set<string>();
      for (const s of launcher.listSessions()) {
        if (s.cliSessionId) activeCliSessionIds.add(s.cliSessionId);
      }

      // Scan all project directories for .jsonl files
      interface CliSessionFile {
        id: string;
        projectDir: string;
        path: string;
        lastModified: number;
        sizeBytes: number;
      }
      const allFiles: CliSessionFile[] = [];

      let projectDirs: string[];
      try {
        projectDirs = await readdir(claudeProjectsDir);
      } catch {
        return c.json({ sessions: [] });
      }

      for (const projectDir of projectDirs) {
        const projectPath = join(claudeProjectsDir, projectDir);
        let entries: string[];
        try {
          entries = await readdir(projectPath);
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (!entry.endsWith(".jsonl")) continue;
          const sessionId = entry.slice(0, -6); // strip .jsonl
          // Skip subagent sessions
          if (sessionId.startsWith("agent-")) continue;
          // Skip sessions already active in the Companion
          if (activeCliSessionIds.has(sessionId)) continue;

          const filePath = join(projectPath, entry);
          try {
            const st = await stat(filePath);
            allFiles.push({
              id: sessionId,
              projectDir,
              path: filePath,
              lastModified: st.mtimeMs,
              sizeBytes: st.size,
            });
          } catch {
            continue;
          }
        }
      }

      // Sort by mtime desc and take top 50
      allFiles.sort((a, b) => b.lastModified - a.lastModified);
      const top = allFiles.slice(0, 50);

      // Read first few lines of each to extract metadata
      const results = await Promise.all(
        top.map(async (f) => {
          let cwd: string | undefined;
          let slug: string | undefined;
          let gitBranch: string | undefined;

          try {
            // Read first 4KB which should contain enough lines for metadata
            const fd = Bun.file(f.path);
            const chunk = await fd.slice(0, 4096).text();
            const lines = chunk.split("\n").slice(0, 10);
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const obj = JSON.parse(line);
                if (obj.cwd && !cwd) cwd = obj.cwd;
                if (obj.slug && !slug) slug = obj.slug;
                if (obj.gitBranch && !gitBranch) gitBranch = obj.gitBranch;
                if (cwd && slug && gitBranch) break;
              } catch {
                continue;
              }
            }
          } catch {
            // Metadata extraction failed — still return the session with basic info
          }

          return {
            id: f.id,
            cwd: cwd || null,
            slug: slug || null,
            gitBranch: gitBranch || null,
            lastModified: f.lastModified,
            sizeBytes: f.sizeBytes,
          };
        }),
      );

      return c.json({ sessions: results });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[routes] Failed to list CLI sessions:", msg);
      return c.json({ sessions: [] });
    }
  });

  const buildEnrichedSessions = async (
    filterFn?: (s: ReturnType<CliLauncher["listSessions"]>[number]) => boolean,
  ) => {
    const sessions = launcher.listSessions();
    const names = sessionNames.getAllNames();
    const bridgeStates = wsBridge.getAllSessions();
    const bridgeMap = new Map(bridgeStates.map((s) => [s.session_id, s]));
    const pool = filterFn ? sessions.filter(filterFn) : sessions;
    return Promise.all(pool.map(async (s) => {
      try {
        const bridge = bridgeMap.get(s.sessionId);
        let gitAhead = bridge?.git_ahead || 0;
        let gitBehind = bridge?.git_behind || 0;
        // Ahead/behind counts come from the bridge's cached git info (refreshed
        // lazily on CLI connect, not on every sidebar poll). Previously this ran
        // a `git rev-list` per worktree session on every /api/sessions request,
        // causing 800-1300ms latency on NFS.
        // Strip sessionAuthToken — never expose to browser clients
        const { sessionAuthToken: _token, ...safeSession } = s;
        return {
          ...safeSession,
          sessionNum: launcher.getSessionNum(s.sessionId) ?? null,
          name: names[s.sessionId] ?? s.name,
          gitBranch: bridge?.git_branch || "",
          gitAhead,
          gitBehind,
          totalLinesAdded: bridge?.total_lines_added || 0,
          totalLinesRemoved: bridge?.total_lines_removed || 0,
          lastMessagePreview: wsBridge.getLastUserMessage(s.sessionId) || "",
          cliConnected: wsBridge.isCliConnected(s.sessionId),
          taskHistory: wsBridge.getSessionTaskHistory(s.sessionId),
          keywords: wsBridge.getSessionKeywords(s.sessionId),
          claimedQuestId: bridge?.claimedQuestId ?? null,
          claimedQuestStatus: bridge?.claimedQuestStatus ?? null,
          ...(wsBridge.getSessionAttentionState(s.sessionId) ?? {}),
          // Worktree liveness status for archived worktree sessions
          // Only check existence (one async access() call), skip expensive git status
          ...(s.isWorktree && s.archived ? await (async () => {
            let exists = false;
            try { await accessAsync(s.cwd); exists = true; } catch { /* not found */ }
            return { worktreeExists: exists };
          })() : {}),
        };
      } catch (e) {
        console.warn(`[routes] Failed to enrich session ${s.sessionId}:`, e);
        return { ...s, name: names[s.sessionId] ?? s.name };
      }
    }));
  };

  const backfillSessionProjectMeta = async (
    info: { cwd: string; repoRoot?: string },
    bridgeSession?: { state?: { repo_root?: string; cwd?: string } } | null,
  ): Promise<void> => {
    if ((!info.cwd || !info.cwd.trim()) && bridgeSession?.state?.cwd) {
      info.cwd = bridgeSession.state.cwd;
    }
    if (info.repoRoot && info.repoRoot.trim()) return;
    const fromBridge = bridgeSession?.state?.repo_root?.trim();
    if (fromBridge) {
      info.repoRoot = fromBridge;
      return;
    }
    if (!info.cwd || !info.cwd.trim()) return;
    const inferred = await execCaptureStdoutAsync("git --no-optional-locks rev-parse --show-toplevel", info.cwd);
    if (inferred) info.repoRoot = inferred;
  };

  api.get("/sessions", async (c) => {
    const enriched = await buildEnrichedSessions();
    return c.json(enriched);
  });

  api.get("/sessions/search", (c) => {
    const rawQuery = (c.req.query("q") || "").trim();
    if (!rawQuery) {
      return c.json({ error: "q is required" }, 400);
    }

    const limitParam = Number.parseInt(c.req.query("limit") || "50", 10);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(limitParam, 200)) : 50;

    const msgLimitParam = Number.parseInt(c.req.query("messageLimitPerSession") || "400", 10);
    const messageLimitPerSession = Number.isFinite(msgLimitParam)
      ? Math.max(50, Math.min(msgLimitParam, 2000))
      : 400;

    const includeArchivedRaw = c.req.query("includeArchived");
    const includeArchived = includeArchivedRaw === undefined
      ? true
      : !["0", "false", "no"].includes(includeArchivedRaw.toLowerCase());

    const startedAt = Date.now();
    const sessions = launcher.listSessions();
    const names = sessionNames.getAllNames();
    const bridgeStates = wsBridge.getAllSessions();
    const bridgeMap = new Map(bridgeStates.map((s) => [s.session_id, s]));

    const docs: SessionSearchDocument[] = sessions.map((s) => {
      const bridge = bridgeMap.get(s.sessionId);
      return {
        sessionId: s.sessionId,
        archived: !!s.archived,
        createdAt: s.createdAt || 0,
        lastActivityAt: s.lastActivityAt,
        name: names[s.sessionId] ?? s.name ?? "",
        taskHistory: wsBridge.getSessionTaskHistory(s.sessionId),
        keywords: wsBridge.getSessionKeywords(s.sessionId),
        gitBranch: bridge?.git_branch || "",
        cwd: bridge?.cwd || s.cwd || "",
        repoRoot: bridge?.repo_root || s.repoRoot || "",
        messageHistory: wsBridge.getMessageHistory(s.sessionId) || [],
      };
    });

    const { results, totalMatches } = searchSessionDocuments(docs, {
      query: rawQuery,
      limit,
      includeArchived,
      messageLimitPerSession,
    });

    return c.json({
      query: rawQuery,
      tookMs: Date.now() - startedAt,
      totalMatches,
      results,
    });
  });

  api.get("/sessions/:id", (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const session = launcher.getSession(id);
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json({
      ...session,
      isGenerating: wsBridge.isSessionBusy(id),
    });
  });

  api.patch("/sessions/:id/name", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.name !== "string" || !body.name.trim()) {
      return c.json({ error: "name is required" }, 400);
    }
    const session = launcher.getSession(id);
    if (!session) return c.json({ error: "Session not found" }, 404);
    sessionNames.setName(id, body.name.trim());
    wsBridge.broadcastSessionUpdate(id, { name: body.name.trim() });
    return c.json({ ok: true, name: body.name.trim() });
  });

  api.patch("/sessions/order", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const groupKey = typeof body.groupKey === "string" ? body.groupKey.trim() : "";
    if (!groupKey) {
      return c.json({ error: "groupKey is required" }, 400);
    }
    if (!Array.isArray(body.orderedIds)) {
      return c.json({ error: "orderedIds must be an array" }, 400);
    }

    const orderedIds = body.orderedIds
      .filter((value: unknown): value is string => typeof value === "string")
      .map((value: string) => value.trim())
      .filter(Boolean);

    const sessionOrder = wsBridge.updateSessionOrder(groupKey, orderedIds);
    await sessionOrderStore.setAllOrder(sessionOrder);
    wsBridge.broadcastSessionOrderUpdate();
    return c.json({ ok: true, sessionOrder });
  });

  api.patch("/sessions/groups/order", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!Array.isArray(body.orderedGroupKeys)) {
      return c.json({ error: "orderedGroupKeys must be an array" }, 400);
    }

    const orderedGroupKeys = body.orderedGroupKeys
      .filter((value: unknown): value is string => typeof value === "string")
      .map((value: string) => value.trim())
      .filter(Boolean);

    const groupOrder = wsBridge.updateGroupOrder(orderedGroupKeys);
    await groupOrderStore.setAllOrder(groupOrder);
    wsBridge.broadcastGroupOrderUpdate();
    return c.json({ ok: true, groupOrder });
  });

  api.patch("/sessions/:id/diff-base", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const branch = typeof body.branch === "string" ? body.branch : "";
    if (!wsBridge.setDiffBaseBranch(id, branch)) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json({ ok: true, diff_base_branch: branch });
  });

  api.patch("/sessions/:id/read", (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    if (!wsBridge.markSessionRead(id)) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json({ ok: true });
  });

  api.patch("/sessions/:id/unread", (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    if (!wsBridge.markSessionUnread(id)) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json({ ok: true });
  });

  api.post("/sessions/mark-all-read", (c) => {
    wsBridge.markAllSessionsRead();
    return c.json({ ok: true });
  });

  api.post("/sessions/:id/kill", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const killed = await launcher.kill(id);
    if (!killed)
      return c.json({ error: "Session not found or already exited" }, 404);

    // Clean up container if any
    containerManager.removeContainer(id);

    return c.json({ ok: true });
  });

  // Leader-initiated stop: gracefully stop a herded worker session
  api.post("/sessions/:id/stop", async (c) => {
    const auth = authenticateTakodeCaller(c, { requireOrchestrator: true });
    if ("response" in auth) return auth.response;

    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    if (
      typeof body.callerSessionId === "string"
      && body.callerSessionId.trim()
      && body.callerSessionId.trim() !== auth.callerId
    ) {
      return c.json({ error: "callerSessionId does not match authenticated caller" }, 403);
    }
    const callerSessionId = auth.callerId;

    // Herd guard: only the herding leader can stop
    const workerInfo = launcher.getSession(id);
    if (!workerInfo) return c.json({ error: "Session not found" }, 404);
    if (!callerSessionId || workerInfo.herdedBy !== callerSessionId) {
      return c.json({ error: "Only the leader who herded this session can stop it" }, 403);
    }

    // Preserve project metadata used for grouping. Some sessions only have repo
    // root in bridge state (derived from git), not in launcher state.
    const session = wsBridge.getSession(id);
    await backfillSessionProjectMeta(workerInfo, session);

    // Inject a visible system message into the worker's chat before stopping
    const leaderNum = launcher.getSessionNum(callerSessionId);
    const leaderName = sessionNames.getName(callerSessionId) || callerSessionId.slice(0, 8);
    const stopMsg = `Session stopped by leader #${leaderNum ?? "?"} ${leaderName}`;
    const ts = Date.now();
    if (session) {
      const historyEntry = {
        type: "user_message" as const,
        content: stopMsg,
        timestamp: ts,
        id: `stop-${ts}`,
        agentSource: { sessionId: callerSessionId, sessionLabel: `#${leaderNum ?? "?"} ${leaderName}` },
      };
      session.messageHistory.push(historyEntry as any);
      wsBridge.broadcastToSession(id, historyEntry as any);
    }

    const targetSession = session || wsBridge.getOrCreateSession(id, workerInfo.backendType || "claude");
    await wsBridge.routeExternalInterrupt(targetSession, "leader");

    return c.json({ ok: true, sessionId: id, stoppedBy: callerSessionId });
  });

  api.post("/sessions/:id/relaunch", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const info = launcher.getSession(id);
    if (!info) return c.json({ error: "Session not found" }, 404);
    await backfillSessionProjectMeta(info, wsBridge.getSession(id));

    // Worktree sessions: validate the worktree still exists and isn't used by another session
    if (info.isWorktree && info.repoRoot && info.branch) {
      const cwdExists = existsSync(info.cwd); // sync-ok: route handler, not called during message handling
      const usedByOther = worktreeTracker.isWorktreeInUse(info.cwd, id);

      if (!cwdExists || usedByOther) {
        // Recreate the worktree at a new unique path
        const wt = gitUtils.ensureWorktree(info.repoRoot, info.branch, { forceNew: true });
        info.cwd = wt.worktreePath;
        info.actualBranch = wt.actualBranch;
        wsBridge.markWorktree(id, info.repoRoot, wt.worktreePath, undefined, info.branch);
        worktreeTracker.addMapping({
          sessionId: id,
          repoRoot: info.repoRoot,
          branch: info.branch,
          actualBranch: wt.actualBranch,
          worktreePath: wt.worktreePath,
          createdAt: Date.now(),
        });
      } else if (!worktreeTracker.getBySession(id)) {
        // Re-register this session with the tracker (e.g., mapping was lost during archive)
        worktreeTracker.addMapping({
          sessionId: id,
          repoRoot: info.repoRoot,
          branch: info.branch,
          actualBranch: info.actualBranch || info.branch,
          worktreePath: info.cwd,
          createdAt: Date.now(),
        });
      }
    }

    const result = await launcher.relaunch(id);
    if (!result.ok) {
      const status = (result.error && (result.error.includes("not found") || result.error.includes("Session not found"))) ? 404 : 503;
      return c.json({ error: result.error || "Relaunch failed" }, status);
    }
    return c.json({ ok: true });
  });

  // ─── Transport Upgrade: WebSocket → SDK ───────────────────────
  api.post("/sessions/:id/upgrade-transport", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);

    const result = await launcher.upgradeToSdk(id);
    if (!result.ok) {
      const status = (result.error && result.error.includes("not found")) ? 404 : 400;
      return c.json({ error: result.error }, status);
    }

    // Update the ws-bridge session's backendType so it attaches the
    // SDK adapter (instead of expecting a WebSocket CLI connection).
    const bridgeSession = wsBridge.getSession(id);
    if (bridgeSession) {
      bridgeSession.backendType = "claude-sdk";
    }

    return c.json(result);
  });

  api.post("/sessions/:id/force-compact", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const info = launcher.getSession(id);
    if (!info) return c.json({ error: "Session not found" }, 404);
    if (!info.cliSessionId) return c.json({ error: "No CLI session to resume" }, 400);
    if (info.backendType === "codex") return c.json({ error: "Force compact not supported for Codex" }, 400);

    // Queue /compact to be sent as first message after relaunch.
    // The CLI in SDK mode doesn't intercept slash commands from user messages,
    // so we kill and relaunch with --resume. On a fresh connection, /compact
    // as the first user message will fit in the context and trigger compaction.
    const session = wsBridge.getOrCreateSession(id);
    session.pendingMessages.push(JSON.stringify({
      type: "user",
      message: { role: "user", content: "/compact" },
      parent_tool_use_id: null,
      session_id: info.cliSessionId,
    }));

    // Notify browsers compaction is starting
    wsBridge.broadcastToSession(id, { type: "status_change", status: "compacting" });

    const result = await launcher.relaunch(id);
    if (!result.ok) {
      return c.json({ error: result.error || "Relaunch failed" }, 503);
    }
    return c.json({ ok: true });
  });

  api.post("/sessions/:id/revert", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const body = await c.req.json<{ messageId: string }>();
    const info = launcher.getSession(id);
    if (!info) return c.json({ error: "Session not found" }, 404);
    if (!info.cliSessionId) return c.json({ error: "No CLI session to resume" }, 400);
    if (info.backendType === "codex") return c.json({ error: "Revert not supported for Codex" }, 400);

    const session = wsBridge.getOrCreateSession(id);

    // Find the target user message in history
    const targetIdx = session.messageHistory.findIndex(
      (m) => m.type === "user_message" && (m as { id?: string }).id === body.messageId,
    );
    if (targetIdx < 0) return c.json({ error: "Message not found in history" }, 404);

    // Find the preceding assistant message with a UUID for --resume-session-at
    let assistantUuid: string | undefined;
    for (let i = targetIdx - 1; i >= 0; i--) {
      const m = session.messageHistory[i];
      if (m.type === "assistant" && (m as { uuid?: string }).uuid) {
        assistantUuid = (m as { uuid?: string }).uuid;
        break;
      }
    }

    // Truncate server-side message history
    session.messageHistory = session.messageHistory.slice(0, targetIdx);

    // Truncate task history: keep only entries whose trigger message survived truncation
    if (session.taskHistory?.length) {
      const remainingUserMsgIds = new Set(
        session.messageHistory
          .filter((m) => m.type === "user_message")
          .map((m) => (m as { id?: string }).id)
          .filter((id): id is string => typeof id === "string"),
      );
      const prevCount = session.taskHistory.length;
      session.taskHistory = session.taskHistory.filter((t) => remainingUserMsgIds.has(t.triggerMessageId));
      if (session.taskHistory.length !== prevCount) {
        wsBridge.broadcastToSession(id, { type: "session_task_history", tasks: session.taskHistory });
      }
    }

    // Clear orphaned permission dialogs
    session.pendingPermissions.clear();
    wsBridge.broadcastToSession(id, { type: "permissions_cleared" });

    // Notify browsers that revert is in progress
    wsBridge.broadcastToSession(id, { type: "status_change", status: "reverting" });

    // Persist immediately (don't rely on debounce — crash would lose truncation)
    wsBridge.persistSessionSync(id);

    // Kill CLI and relaunch with --resume-session-at to truncate CLI's history
    let result: { ok: boolean; error?: string };
    if (assistantUuid) {
      result = await launcher.relaunchWithResumeAt(id, assistantUuid);
    } else {
      // Reverting the first user message — start fresh
      info.cliSessionId = undefined;
      result = await launcher.relaunch(id);
    }

    if (!result.ok) {
      return c.json({ error: result.error || "Relaunch failed" }, 503);
    }

    // Broadcast updated (truncated) history to all browsers
    wsBridge.broadcastToSession(id, { type: "message_history", messages: session.messageHistory });

    return c.json({ ok: true });
  });

  api.delete("/sessions/:id", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);

    // Emit herd event BEFORE killing — after removal the session info
    // (including herdedBy) is no longer accessible.
    const deletedSessionInfo = launcher.getSession(id);
    if (deletedSessionInfo?.herdedBy) {
      wsBridge.emitTakodeEvent(id, "session_deleted", {});
    }

    await launcher.kill(id);

    // Clean up container if any
    containerManager.removeContainer(id);

    const worktreeResult = cleanupWorktree(id, true);
    prPoller?.unwatch(id);
    launcher.removeSession(id);
    // Broadcast deletion to all browsers BEFORE closing the session sockets.
    // This ensures every browser tab (not just the one that triggered delete)
    // removes the session from the sidebar immediately.
    wsBridge.broadcastGlobal({ type: "session_deleted", session_id: id });
    wsBridge.closeSession(id);
    await imageStore?.removeSession(id);
    return c.json({ ok: true, worktree: worktreeResult });
  });

  api.post("/sessions/:id/archive", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const body = await c.req.json().catch(() => ({}));

    // Emit herd event before killing — the leader needs to know a worker was archived.
    const archivedSessionInfo = launcher.getSession(id);
    if (archivedSessionInfo?.herdedBy) {
      wsBridge.emitTakodeEvent(id, "session_archived", {});
    }

    await launcher.kill(id);

    // Clean up container if any
    containerManager.removeContainer(id);

    // Stop PR polling for this session
    prPoller?.unwatch(id);

    // Always force-delete the worktree on archive. Worktrees contain only
    // generated/derived content — the branch preserves any committed changes.
    // Without force, dirty worktrees (any untracked file) accumulate forever,
    // inflating git branch lists and slowing NFS operations.
    const worktreeResult = cleanupWorktree(id, true);
    launcher.setArchived(id, true);
    await sessionStore.setArchived(id, true);
    return c.json({ ok: true, worktree: worktreeResult });
  });

  api.post("/sessions/:id/unarchive", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const info = launcher.getSession(id);
    if (!info) return c.json({ error: "Session not found" }, 404);

    launcher.setArchived(id, false);
    await sessionStore.setArchived(id, false);

    // For worktree sessions: recreate the worktree if it was deleted during archiving
    let worktreeRecreated = false;
    if (info.isWorktree && info.repoRoot && info.branch) {
      if (!existsSync(info.cwd)) { // sync-ok: route handler, not called during message handling
        try {
          const result = recreateWorktreeIfMissing(id, info, { launcher, worktreeTracker, wsBridge });
          if (result.error) {
            return c.json({ ok: false, error: `Failed to recreate worktree: ${result.error}` }, 500);
          }
          worktreeRecreated = result.recreated;
        } catch (e) {
          console.error(`[routes] Failed to recreate worktree for session ${id}:`, e);
          return c.json({
            ok: false,
            error: `Failed to recreate worktree: ${e instanceof Error ? e.message : String(e)}`,
          }, 500);
        }
      } else {
        // Worktree still exists — re-register tracker and bridge state
        worktreeTracker.addMapping({
          sessionId: id,
          repoRoot: info.repoRoot,
          branch: info.branch,
          actualBranch: info.actualBranch || info.branch,
          worktreePath: info.cwd,
          createdAt: Date.now(),
        });
        wsBridge.markWorktree(id, info.repoRoot, info.cwd, undefined, info.branch);
      }
    }

    // Auto-relaunch the CLI so the session is immediately usable
    const relaunchResult = await launcher.relaunch(id);

    return c.json({ ok: true, worktreeRecreated, relaunch: relaunchResult });
  });

  // ─── Task History (table of contents) ──────────────────────

  api.get("/sessions/:id/tasks", (c) => {
    const sessionId = resolveId(c.req.param("id"));
    if (!sessionId) return c.json({ error: "Session not found" }, 404);

    const taskHistory = wsBridge.getSessionTaskHistory(sessionId);
    const messageHistory = wsBridge.getMessageHistory(sessionId);
    if (!messageHistory) return c.json({ error: "Session not found in bridge" }, 404);

    const sessionNum = launcher.getSessionNum(sessionId) ?? -1;
    const sessionName = sessionNames.getName(sessionId) || sessionId.slice(0, 8);

    // Build a message ID → array index lookup map for all user messages
    const idToIdx = new Map<string, number>();
    for (let i = 0; i < messageHistory.length; i++) {
      const msg = messageHistory[i];
      if (msg.type === "user_message" && (msg as any).id) {
        idToIdx.set((msg as any).id, i);
      }
    }

    // Resolve each task's triggerMessageId to an array index and compute ranges
    const tasks = taskHistory
      .filter(t => t.action !== "revise") // revise entries update in-place, skip them
      .map((task, i, arr) => {
        const startIdx = idToIdx.get(task.triggerMessageId) ?? 0;

        // endIdx = start of next task - 1, or end of history
        let endIdx = messageHistory.length - 1;
        if (i + 1 < arr.length) {
          const nextStart = idToIdx.get(arr[i + 1].triggerMessageId);
          if (nextStart !== undefined && nextStart > 0) {
            endIdx = nextStart - 1;
          }
        }

        return {
          taskNum: i + 1,
          title: task.title,
          startIdx,
          endIdx,
          startedAt: task.timestamp,
          source: task.source || "namer",
          questId: task.questId || null,
        };
      });

    return c.json({
      sessionId,
      sessionNum,
      sessionName,
      totalMessages: messageHistory.length,
      tasks,
    });
  });

  // ─── Tool result lazy fetch ────────────────────────────────

  api.get("/sessions/:id/tool-result/:toolUseId", (c) => {
    const sessionId = resolveId(c.req.param("id"));
    if (!sessionId) return c.json({ error: "Session not found" }, 404);
    const toolUseId = c.req.param("toolUseId");

    const result = wsBridge.getToolResult(sessionId, toolUseId);
    if (!result) {
      return c.json({ error: "Tool result not found" }, 404);
    }

    return c.json(result);
  });

  // ─── Background agent output file ────────────────────────────

  api.get("/sessions/:id/agent-output", async (c) => {
    const filePath = c.req.query("path");
    if (!filePath) return c.text("Missing path parameter", 400);
    // Security: only allow reading from temp directories
    if (!filePath.startsWith("/tmp/")) return c.text("Access denied", 403);
    try {
      const content = await readFile(filePath, "utf-8");
      return c.text(content);
    } catch {
      return c.text("File not found", 404);
    }
  });

  // ─── Image serving ─────────────────────────────────────────

  api.get("/images/:sessionId/:imageId/thumb", async (c) => {
    if (!imageStore) return c.json({ error: "Image store not configured" }, 503);
    const { sessionId, imageId } = c.req.param();
    // Try thumbnail first, fall back to original
    const thumbPath = await imageStore.getThumbnailPath(sessionId, imageId);
    const path = thumbPath || await imageStore.getOriginalPath(sessionId, imageId);
    if (!path) return c.json({ error: "Image not found" }, 404);
    return new Response(Bun.file(path), {
      headers: {
        "Content-Type": thumbPath ? "image/jpeg" : "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });

  api.get("/images/:sessionId/:imageId/full", async (c) => {
    if (!imageStore) return c.json({ error: "Image store not configured" }, 503);
    const { sessionId, imageId } = c.req.param();
    const path = await imageStore.getOriginalPath(sessionId, imageId);
    if (!path) return c.json({ error: "Image not found" }, 404);
    const file = Bun.file(path);
    return new Response(file, {
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });


  return api;
}
