import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { readClaudeCredentialStore } from "./claude-credentials.js";

export interface UsageLimits {
  five_hour: { utilization: number; resets_at: string | null } | null;
  seven_day: { utilization: number; resets_at: string | null } | null;
  extra_usage: {
    is_enabled: boolean;
    monthly_limit: number;
    used_credits: number;
    utilization: number | null;
  } | null;
}

const OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const execFilePromise = promisify(execFileCb);

// In-memory cache (60s TTL)
const CACHE_DURATION_MS = 60 * 1000;
let cache: { data: UsageLimits; timestamp: number } | null = null;

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  [key: string]: unknown;
}

async function readRawCredentials(): Promise<{
  raw: string;
  parsed: Record<string, unknown>;
  oauth: OAuthCredentials;
} | null> {
  const store = await readClaudeCredentialStore();
  const oauth = store?.parsed.claudeAiOauth as OAuthCredentials | undefined;
  if (!store || !oauth?.accessToken) return null;
  return { ...store, oauth };
}

async function writeCredentials(creds: Record<string, unknown>): Promise<void> {
  try {
    const json = JSON.stringify(creds);
    if (process.platform !== "darwin") {
      // Windows and Linux: write to credentials file
      const home = process.env.USERPROFILE || process.env.HOME || homedir() || "";
      const credPath = join(home, ".claude", ".credentials.json");
      await writeFile(credPath, json, "utf-8");
    } else {
      // macOS: use Keychain
      await execFilePromise(
        "security",
        ["add-generic-password", "-U", "-s", "Claude Code-credentials", "-a", "Claude Code", "-w", json],
        { timeout: 5000 },
      );
    }
  } catch {
    // best-effort
  }
}

async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} | null> {
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  } catch {
    return null;
  }
}

export async function getCredentials(): Promise<string | null> {
  const creds = await readRawCredentials();
  return creds?.oauth.accessToken ?? null;
}

async function getValidAccessToken(): Promise<string | null> {
  const creds = await readRawCredentials();
  if (!creds) return null;

  const { oauth } = creds;

  // Token still valid (with 5min buffer)
  if (oauth.expiresAt && Date.now() < oauth.expiresAt - 5 * 60 * 1000) {
    return oauth.accessToken;
  }

  // Token expired — try to refresh
  if (!oauth.refreshToken) return null;

  const refreshed = await refreshAccessToken(oauth.refreshToken);
  if (!refreshed) return null;

  // Update stored credentials
  creds.parsed.claudeAiOauth = {
    ...oauth,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: Date.now() + refreshed.expiresIn * 1000,
  };
  void writeCredentials(creds.parsed).catch(() => {});

  return refreshed.accessToken;
}

export async function fetchUsageLimits(token: string): Promise<UsageLimits | null> {
  try {
    const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "claude-code/2.1.39",
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      five_hour: data.five_hour || null,
      seven_day: data.seven_day || null,
      extra_usage: data.extra_usage || null,
    };
  } catch {
    return null;
  }
}

export async function getUsageLimits(): Promise<UsageLimits> {
  const empty: UsageLimits = {
    five_hour: null,
    seven_day: null,
    extra_usage: null,
  };
  try {
    if (cache && Date.now() - cache.timestamp < CACHE_DURATION_MS) {
      return cache.data;
    }

    const token = await getValidAccessToken();
    if (!token) return empty;

    const limits = await fetchUsageLimits(token);
    if (!limits) return empty;

    cache = { data: limits, timestamp: Date.now() };
    return limits;
  } catch {
    return empty;
  }
}
