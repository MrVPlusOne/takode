/** Browser-configurable MCP server definition shared by session transport surfaces. */
export interface McpServerConfig {
  type: "stdio" | "sse" | "http" | "sdk";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

/** Runtime MCP connection detail projected to browser clients. */
export interface McpServerDetail {
  name: string;
  status: "connected" | "failed" | "disabled" | "connecting";
  serverInfo?: unknown;
  error?: string;
  config: { type: string; url?: string; command?: string; args?: string[] };
  scope: string;
  tools?: { name: string; annotations?: { readOnly?: boolean; destructive?: boolean; openWorld?: boolean } }[];
  /** The server asks for a sign-in (Codex reports it as not logged in). */
  needsSignIn?: boolean;
  /** A sign-in Takode started for this server: waiting for the user, or failed with a reason. */
  signIn?: { state: "pending" | "failed"; authorizationUrl?: string; error?: string };
}
