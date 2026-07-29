import { describe, expect, it } from "vitest";
import {
  ModelDefaultConflictError,
  buildTakodeCatalogRouteEntry,
  canonicalJson,
  fingerprintModelRouteEntry,
  normalizeCanonicalModelId,
  resolveModelAuthority,
  type CanonicalModelRouteEntry,
} from "./model-identity-contract.js";

describe("model identity contract", () => {
  it("selects one effective model and records lower-precedence authorities", () => {
    const decision = resolveModelAuthority([
      { source: "managed_fallback", model: "gpt-5.6-sol", precedence: 100 },
      { source: "session_default", model: "gpt-5.6-terra", precedence: 300 },
      { source: "explicit_request", model: "gpt-5.6-luna", precedence: 400 },
    ]);

    expect(decision).toMatchObject({
      model: "gpt-5.6-luna",
      source: "explicit_request",
      overrideTrace: [
        { source: "explicit_request", status: "selected" },
        { source: "session_default", status: "overridden" },
        { source: "managed_fallback", status: "overridden" },
      ],
    });
  });

  it("fails with a typed conflict when equal authorities disagree", () => {
    expect(() =>
      resolveModelAuthority([
        { source: "explicit_request", model: "gpt-5.6-sol", precedence: 400 },
        { source: "launch_option", model: "gpt-5.6-terra", precedence: 400 },
      ]),
    ).toThrow(ModelDefaultConflictError);
  });

  it("rejects non-canonical model ids instead of normalizing them silently", () => {
    expect(() => normalizeCanonicalModelId(" GPT-5.6-SOL ")).toThrow("Invalid canonical model id");
    expect(normalizeCanonicalModelId(" gpt-5.6-sol ")).toBe("gpt-5.6-sol");
  });

  it("canonicalizes route projections deterministically and fingerprints alias metadata", () => {
    const alias: CanonicalModelRouteEntry = {
      schemaMajor: 1,
      requestedCanonical: "gpt-5",
      matchKind: "declared_alias",
      variantPolicy: null,
      targetCanonical: "gpt-5.5",
      provider: "github_copilot",
      deployment: "gpt-5.5",
      wireMode: "responses",
      alias: {
        id: "legacy-gpt-5",
        version: 1,
        label: "GPT-5 legacy alias",
        reason: "The base GPT-5 deployment is unavailable",
        disclosed: true,
        deprecation: null,
      },
    };
    const reordered = Object.fromEntries(Object.entries(alias).reverse()) as unknown as CanonicalModelRouteEntry;

    expect(canonicalJson(alias as never)).toBe(canonicalJson(reordered as never));
    expect(fingerprintModelRouteEntry(alias)).toBe(fingerprintModelRouteEntry(reordered));
    expect(fingerprintModelRouteEntry(alias)).toBe("80b22b49615a9bfbb16ccb7d7e1e6e0d0f8981001e59468e46b96dc7f86c2fc1");
    expect(fingerprintModelRouteEntry(alias)).not.toBe(
      fingerprintModelRouteEntry({ ...alias, alias: { ...alias.alias!, version: 2 } }),
    );
    expect(fingerprintModelRouteEntry(buildTakodeCatalogRouteEntry("gpt-5.6-sol"))).toHaveLength(64);
  });
});
