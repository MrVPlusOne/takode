import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf-8");
}

/**
 * Extract the body of a named method using brace counting.
 * Searches for a method definition (`private/public/protected methodName(` or
 * just `methodName(` at the start of a line), then counts { / } to locate the
 * matching close brace. Immune to formatter-induced signature changes and
 * method reordering.
 */
function extractMethodBody(source: string, methodName: string): string {
  // Match the method definition, not call sites like `this.methodName(`
  const definitionPattern = new RegExp(
    `(?:(?:private|public|protected)\\s+|(?:export\\s+)?function\\s+)${methodName}\\s*\\(`,
  );
  const match = definitionPattern.exec(source);
  if (!match) return "";
  // Skip the parameter list, which may contain object types, to reach the body.
  let parenDepth = 1;
  let p = match.index + match[0].length;
  while (parenDepth > 0 && p < source.length) {
    if (source[p] === "(") parenDepth++;
    else if (source[p] === ")") parenDepth--;
    p++;
  }
  const braceStart = source.indexOf("{", p);
  if (braceStart === -1) return "";
  let depth = 1;
  let i = braceStart + 1;
  while (depth > 0 && i < source.length) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }
  return source.slice(braceStart, i);
}

/** Extract all `case "xxx":` strings from a block of source code. */
function extractCaseValues(block: string): Set<string> {
  return new Set([...block.matchAll(/case "([^"]+)":/g)].map((m) => m[1]));
}

/**
 * Extract the `type` literal from each constituent of the SDKMessage union.
 * Parses the union definition line to get member type names, then finds
 * each member's `type: 'xxx'` field. Handles union aliases (e.g.
 * `SDKResultMessage = SDKResultSuccess | SDKResultError`) by recursively
 * resolving them. This avoids the old approach of matching every
 * `type: 'xxx'` in the entire SDK file (which picked up transport types,
 * thinking config, etc.).
 */
function extractSDKMessageTypes(sdkSource: string): Set<string> {
  // Find the SDKMessage union: `export declare type SDKMessage = A | B | C;`
  const unionMatch = sdkSource.match(/export declare type SDKMessage\s*=\s*([^;]+);/);
  if (!unionMatch) return new Set();

  const memberNames = unionMatch[1].split("|").map((s) => s.trim());
  const types = new Set<string>();

  /** Try to extract the type literal from a named type, recursing through union aliases. */
  function resolveType(typeName: string): void {
    // Try direct object type: `export declare type Foo = { type: 'xxx'; ... }`
    // Use word boundary \b before `type` to avoid matching `subtype:`
    const objectPattern = new RegExp(`export declare type ${typeName}\\s*=\\s*\\{[^}]*\\btype:\\s*'([^']+)'`, "s");
    const objectMatch = sdkSource.match(objectPattern);
    if (objectMatch) {
      types.add(objectMatch[1]);
      return;
    }
    // Try union alias: `export declare type Foo = Bar | Baz;`
    const unionAliasPattern = new RegExp(`export declare type ${typeName}\\s*=\\s*([^;{]+);`);
    const aliasMatch = sdkSource.match(unionAliasPattern);
    if (aliasMatch) {
      for (const sub of aliasMatch[1].split("|").map((s) => s.trim())) {
        resolveType(sub);
      }
    }
  }

  for (const memberName of memberNames) {
    resolveType(memberName);
  }

  return types;
}

/** Extract `msg.type === "xxx"` comparisons from a block of source code. */
function extractTypeComparisons(block: string): Set<string> {
  return new Set([...block.matchAll(/msg\.type === "([^"]+)"/g)].map((m) => m[1]));
}

describe("Claude SDK message handling drift vs upstream Agent SDK snapshot", () => {
  it("keeps handled Claude message types aligned with upstream (or explicit local allowlist)", () => {
    // Claude output is translated by the SDK adapter, then handled by the bridge.
    const adapter = readFile("server/claude-sdk-adapter.ts");
    const bridge = readFile("server/bridge/claude-message-controller.ts");
    const sdk = readFile("server/protocol/claude-upstream/sdk.d.ts.txt");

    const adapterBody = extractMethodBody(adapter, "handleSdkMessage");
    const bridgeBody = extractMethodBody(bridge, "handleSdkBrowserMessage");
    expect(adapterBody.length).toBeGreaterThan(0);
    expect(bridgeBody.length).toBeGreaterThan(0);
    const handled = new Set([
      ...extractCaseValues(adapterBody),
      ...extractCaseValues(bridgeBody),
      ...extractTypeComparisons(bridgeBody),
    ]);
    expect(handled.size).toBeGreaterThan(0);

    const upstreamMessageTypes = extractSDKMessageTypes(sdk);
    expect(upstreamMessageTypes.size).toBeGreaterThan(0);

    // Types the adapter synthesizes for the bridge, or transport heartbeats,
    // that are not members of the SDKMessage union.
    const localTypes = new Set(["keep_alive", "control_cancel_request", "status_change", "task_notification"]);

    // Forward check: every type handled must exist in upstream OR the local allowlist
    for (const handledType of handled) {
      expect(
        upstreamMessageTypes.has(handledType) || localTypes.has(handledType),
        `Claude handling covers type "${handledType}" which is not in the upstream SDK snapshot or local allowlist`,
      ).toBe(true);
    }

    // Reverse check: every upstream SDKMessage type should be handled
    for (const upstreamType of upstreamMessageTypes) {
      expect(
        handled.has(upstreamType),
        `Upstream SDK message type "${upstreamType}" is not handled by the SDK adapter or bridge. ` +
          `Add handling for it, or document why it can be ignored.`,
      ).toBe(true);
    }
  });

  it("keeps system subtypes handled by the SDK adapter aligned with upstream", () => {
    const adapter = readFile("server/claude-sdk-adapter.ts");
    const sdk = readFile("server/protocol/claude-upstream/sdk.d.ts.txt");

    const upstreamInit = sdk.includes("export declare type SDKSystemMessage = {") && sdk.includes("subtype: 'init';");
    const upstreamStatus =
      sdk.includes("export declare type SDKStatusMessage = {") && sdk.includes("subtype: 'status';");

    expect(upstreamInit).toBe(true);
    expect(upstreamStatus).toBe(true);

    expect(adapter).toContain('if (msg.subtype === "init")');
    expect(adapter).toContain('if (msg.subtype === "status")');
  });
});
