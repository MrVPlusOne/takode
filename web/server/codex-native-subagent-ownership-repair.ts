import type { BrowserIncomingMessage } from "./session-types.js";
import { toPublicCodexNativeSubagentOwnership } from "../shared/codex-native-subagent-types.js";
import {
  applyCodexNativeSubagentEvent,
  codexNativeSubagentChildIdForProviderThread,
  normalizeCodexNativeSubagentRegistry,
  seedCodexNativeSubagentAdapterContext,
  type CodexNativeSubagentRegistry,
} from "./codex-native-subagent-state.js";

export interface CodexNativeSubagentBufferedMessage {
  message: BrowserIncomingMessage;
}

function isProviderRootPath(value: unknown): boolean {
  return typeof value === "string" && value.trim().replace(/\/+$/, "") === "/root";
}

function canonicalizeMessages(
  messages: BrowserIncomingMessage[],
  rootChildIds: Set<string>,
  expectedOwnershipByChildId: Map<string, ReturnType<typeof toPublicCodexNativeSubagentOwnership>>,
): boolean {
  let changed = false;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const ownership = message.codexSubagent;
    if (!ownership) continue;
    if (rootChildIds.has(ownership.childId)) {
      const { codexSubagent: _removedRootOwnership, ...rootOwnedMessage } = message;
      messages[index] = rootOwnedMessage as BrowserIncomingMessage;
      changed = true;
      continue;
    }

    // Missing/invalid registry topology cannot keep parent or root-turn claims.
    // Preserve only the opaque child identity so the row stays audit content.
    const expectedOwnership = expectedOwnershipByChildId.get(ownership.childId) ?? { childId: ownership.childId };
    if (JSON.stringify(expectedOwnership) === JSON.stringify(ownership)) continue;
    messages[index] = { ...message, codexSubagent: expectedOwnership } as BrowserIncomingMessage;
    changed = true;
  }
  return changed;
}

/**
 * Canonicalizes every browser-visible ownership object to the exact public
 * shape. Root candidates are stripped; invalid or unknown identities retain
 * only their opaque child ID and cannot remain attached to a root turn.
 */
export function canonicalizeCodexNativeSubagentOwnership(
  registry: CodexNativeSubagentRegistry,
  messageHistory: BrowserIncomingMessage[],
  eventBuffer?: CodexNativeSubagentBufferedMessage[],
  additionalRootChildIds: Iterable<string> = [],
): boolean {
  const rootChildIds = new Set(additionalRootChildIds);
  if (registry.rootProviderThreadId) {
    rootChildIds.add(codexNativeSubagentChildIdForProviderThread(registry, registry.rootProviderThreadId));
  }
  for (const record of Object.values(registry.childrenByProviderThreadId)) {
    if (isProviderRootPath(record.agentPath)) rootChildIds.add(record.publicChildId);
  }

  const expectedOwnershipByChildId = new Map(
    [...seedCodexNativeSubagentAdapterContext(registry).values()].map((ownership) => {
      const publicOwnership = toPublicCodexNativeSubagentOwnership(ownership);
      return [publicOwnership.childId, publicOwnership] as const;
    }),
  );
  for (const record of Object.values(registry.childrenByProviderThreadId)) {
    if (!expectedOwnershipByChildId.has(record.publicChildId)) {
      expectedOwnershipByChildId.set(record.publicChildId, { childId: record.publicChildId });
    }
  }

  let changed = canonicalizeMessages(messageHistory, rootChildIds, expectedOwnershipByChildId);
  if (eventBuffer) {
    for (const event of eventBuffer) {
      const messages = [event.message];
      if (!canonicalizeMessages(messages, rootChildIds, expectedOwnershipByChildId)) continue;
      event.message = messages[0]!;
      changed = true;
    }
  }
  return changed;
}

/**
 * Repairs persisted authority before browser subscribe can replay history.
 * A single exact `/root` record is sufficient provider evidence to identify
 * the root in legacy registries that predate persisted root identity.
 */
export function repairRestoredCodexNativeSubagentAuthority(
  sessionId: string,
  persistedRegistry: unknown,
  messageHistory: BrowserIncomingMessage[],
  eventBuffer?: CodexNativeSubagentBufferedMessage[],
): { registry: CodexNativeSubagentRegistry; changed: boolean } {
  const registry = normalizeCodexNativeSubagentRegistry(persistedRegistry, sessionId);
  const rootCandidates = Object.entries(registry.childrenByProviderThreadId)
    .filter(([, record]) => isProviderRootPath(record.agentPath))
    .map(([providerThreadId]) => providerThreadId);
  const rootCandidateChildIds = rootCandidates.map((providerThreadId) =>
    codexNativeSubagentChildIdForProviderThread(registry, providerThreadId),
  );
  let changed = false;

  const identifiedRoot = registry.rootProviderThreadId ?? (rootCandidates.length === 1 ? rootCandidates[0] : undefined);
  if (identifiedRoot) {
    changed =
      applyCodexNativeSubagentEvent(registry, {
        type: "root_thread_identified",
        providerThreadId: identifiedRoot,
        observedAt: Date.now(),
      }).changed || changed;
  }
  if (rootCandidates.length > 1) {
    if (!registry.integrityCompromised) {
      registry.integrityCompromised = true;
      changed = true;
    }
    if (registry.coverage !== "partial") {
      registry.coverage = "partial";
      changed = true;
    }
    if (changed) registry.revision += 1;
  }

  changed =
    canonicalizeCodexNativeSubagentOwnership(registry, messageHistory, eventBuffer, rootCandidateChildIds) || changed;
  return { registry, changed };
}
