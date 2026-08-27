import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getSessionAuthDir, getSessionAuthFilePrefixes, parseSessionAuthFileData } from "../shared/session-auth.js";

export type CompanionCredentials = {
  sessionId: string;
  authToken: string;
  port?: number;
  serverId?: string;
};

type CredentialEnvironment = Record<string, string | undefined>;

/** Discover managed-session credentials for the standalone Quest CLI. */
export function discoverQuestCompanionCredentials(args: {
  cwd: string;
  environment?: CredentialEnvironment;
  skipFileDiscovery?: boolean;
  fail: (message: string) => never;
}): CompanionCredentials | null {
  const environment = args.environment ?? process.env;
  const sessionId = environment.COMPANION_SESSION_ID;
  const authToken = environment.COMPANION_AUTH_TOKEN;
  const envPort = Number(environment.COMPANION_PORT);
  const serverId = environment.COMPANION_SERVER_ID?.trim();
  if (sessionId && authToken) {
    return {
      sessionId,
      authToken,
      ...(Number.isFinite(envPort) && envPort > 0 ? { port: envPort } : {}),
      ...(serverId ? { serverId } : {}),
    };
  }
  if (args.skipFileDiscovery) return null;

  const authDir = getSessionAuthDir();
  const prefixes = getSessionAuthFilePrefixes(args.cwd).map((prefix) => `${prefix}-`);
  let fileNames: string[] = [];
  try {
    fileNames = readdirSync(authDir);
  } catch {
    fileNames = [];
  }

  const candidates = fileNames
    .filter((name) => name.endsWith(".json") && prefixes.some((prefix) => name.startsWith(prefix)))
    .map((name) => readCredential(`${authDir}/${name}`))
    .filter((value): value is CompanionCredentials => value !== null);
  const uniqueCandidates = dedupeCredentials(candidates);
  if (uniqueCandidates.length > 0) {
    const selected = selectCredential(uniqueCandidates, environment, args.cwd, args.fail);
    if (selected) return selected;
  }

  for (const prefix of getSessionAuthFilePrefixes(args.cwd)) {
    const credential = readCredential(`${authDir}/${prefix}.json`);
    if (credential) return credential;
  }
  for (const authFile of [
    join(args.cwd, ".companion", "session-auth.json"),
    join(args.cwd, ".codex", "session-auth.json"),
    join(args.cwd, ".claude", "session-auth.json"),
  ]) {
    const credential = readCredential(authFile);
    if (credential) return credential;
  }
  return null;
}

function selectCredential(
  candidates: CompanionCredentials[],
  environment: CredentialEnvironment,
  cwd: string,
  fail: (message: string) => never,
): CompanionCredentials | null {
  const selectors: Array<{
    label: string;
    value: string | number | undefined;
    matches: (credential: CompanionCredentials) => boolean;
  }> = [
    {
      label: "server",
      value: environment.COMPANION_SERVER_ID?.trim(),
      matches: (credential) => credential.serverId === environment.COMPANION_SERVER_ID?.trim(),
    },
    {
      label: "session",
      value: environment.COMPANION_SESSION_ID?.trim(),
      matches: (credential) => credential.sessionId === environment.COMPANION_SESSION_ID?.trim(),
    },
    {
      label: "port",
      value: validPort(environment.COMPANION_PORT),
      matches: (credential) => credential.port === validPort(environment.COMPANION_PORT),
    },
  ];
  for (const selector of selectors) {
    if (selector.value === undefined || selector.value === "") continue;
    const matches = candidates.filter(selector.matches);
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      fail(
        `Multiple Companion auth contexts matched ${selector.label} ${selector.value} for ${cwd}. Refusing to guess which server to use.`,
      );
    }
  }
  if (candidates.length === 1) return candidates[0]!;
  fail(
    `Multiple Companion auth contexts were found for ${cwd}. Refusing to guess which server to use. ` +
      "Relaunch this session to restore COMPANION_* env vars.",
  );
}

function readCredential(path: string): CompanionCredentials | null {
  try {
    return parseSessionAuthFileData(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return null;
  }
}

function dedupeCredentials(candidates: CompanionCredentials[]): CompanionCredentials[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = [candidate.serverId || "", candidate.sessionId, candidate.authToken, candidate.port ?? ""].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validPort(raw: string | undefined): number | undefined {
  const port = Number(raw);
  return Number.isFinite(port) && port > 0 ? port : undefined;
}
