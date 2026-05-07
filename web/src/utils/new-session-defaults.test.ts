// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { scopedSetItem } from "./scoped-storage.js";
import {
  getGlobalNewSessionDefaults,
  getGroupNewSessionDefaults,
  getCachedGroupNewSessionDefaults,
  getLastSessionCreationContext,
  saveLastSessionCreationContext,
  getTreeGroupNewSessionDefaultsKey,
  saveGroupNewSessionDefaults,
} from "./new-session-defaults.js";

describe("new-session-defaults", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("cc-server-id", "test-server");
  });

  it("reads the existing global create-session defaults from scoped storage", () => {
    scopedSetItem("cc-backend", "codex");
    scopedSetItem("cc-model-codex", "gpt-5.4");
    scopedSetItem("cc-mode", "agent");
    scopedSetItem("cc-ask-permission", "false");
    scopedSetItem("cc-selected-env", "prod");
    scopedSetItem("cc-worktree", "false");
    scopedSetItem("cc-codex-internet-access", "1");
    scopedSetItem("cc-codex-reasoning-effort", "high");
    scopedSetItem("cc-codex-permission-mode", "custom");

    expect(getGlobalNewSessionDefaults()).toEqual({
      backend: "codex",
      model: "gpt-5.4",
      mode: "default",
      askPermission: false,
      sessionRole: "worker",
      envSlug: "prod",
      cwd: "",
      useWorktree: false,
      codexInternetAccess: true,
      codexReasoningEffort: "high",
      codexPermissionMode: "custom",
    });
  });

  it("returns null for cached group defaults when a group has no saved config", () => {
    expect(getCachedGroupNewSessionDefaults("tree-group:missing")).toBeNull();
  });

  it("falls back to the global defaults when a group has no saved config", () => {
    scopedSetItem("cc-backend", "claude");
    scopedSetItem("cc-model-claude", "claude-opus-4-6");
    scopedSetItem("cc-worktree", "false");

    expect(getGroupNewSessionDefaults("/repo-a")).toEqual({
      backend: "claude",
      model: "claude-opus-4-6",
      mode: "acceptEdits",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: false,
      codexInternetAccess: false,
      codexReasoningEffort: "",
      codexPermissionMode: "default",
    });
  });

  it("returns the per-group defaults without disturbing the global defaults", () => {
    scopedSetItem("cc-backend", "claude");
    scopedSetItem("cc-model-claude", "claude-opus-4-6");

    // The Leader toggle is intentionally not remembered. A saved leader
    // selection should not make future sessions in the group default to leader.
    saveGroupNewSessionDefaults("/repo-a", {
      backend: "codex",
      model: "gpt-5.4",
      mode: "default",
      askPermission: false,
      sessionRole: "leader",
      envSlug: "sandbox",
      cwd: "/repo-a/worktrees/feature-x",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "medium",
      codexPermissionMode: "full-access",
    });

    expect(getGroupNewSessionDefaults("/repo-a")).toEqual({
      backend: "codex",
      model: "gpt-5.4",
      mode: "default",
      askPermission: false,
      sessionRole: "worker",
      envSlug: "sandbox",
      cwd: "/repo-a/worktrees/feature-x",
      useWorktree: true,
      codexInternetAccess: true,
      codexReasoningEffort: "medium",
      codexPermissionMode: "full-access",
    });
    expect(getCachedGroupNewSessionDefaults("/repo-a")).toMatchObject({
      backend: "codex",
      cwd: "/repo-a/worktrees/feature-x",
      sessionRole: "worker",
      codexPermissionMode: "full-access",
    });

    expect(getGlobalNewSessionDefaults()).toEqual({
      backend: "claude",
      model: "claude-opus-4-6",
      mode: "acceptEdits",
      askPermission: true,
      sessionRole: "worker",
      envSlug: "",
      cwd: "",
      useWorktree: true,
      codexInternetAccess: false,
      codexReasoningEffort: "",
      codexPermissionMode: "default",
    });
  });

  it("normalizes legacy codex permission modes when reading saved defaults", () => {
    scopedSetItem("cc-backend", "codex");
    scopedSetItem("cc-mode", "bypassPermissions");

    expect(getGlobalNewSessionDefaults()).toMatchObject({
      backend: "codex",
      model: "",
      mode: "default",
      askPermission: false,
      sessionRole: "worker",
      cwd: "",
      codexPermissionMode: "full-access",
    });
  });

  it("migrates legacy Codex suggest defaults to the default permission profile", () => {
    scopedSetItem("cc-backend", "codex");
    scopedSetItem("cc-mode", "suggest");

    expect(getGlobalNewSessionDefaults()).toMatchObject({
      backend: "codex",
      mode: "default",
      askPermission: true,
      codexPermissionMode: "default",
    });
  });

  it("preserves an explicit Codex permission profile over legacy suggest mode", () => {
    scopedSetItem("cc-backend", "codex");
    scopedSetItem("cc-mode", "suggest");
    scopedSetItem("cc-codex-permission-mode", "auto-review");

    expect(getGlobalNewSessionDefaults()).toMatchObject({
      backend: "codex",
      mode: "default",
      askPermission: true,
      codexPermissionMode: "auto-review",
    });
  });

  it("namespaces tree-group defaults keys separately from project paths", () => {
    expect(getTreeGroupNewSessionDefaultsKey(" team-alpha ")).toBe("tree-group:team-alpha");
    expect(getTreeGroupNewSessionDefaultsKey("")).toBe("");
  });

  it("persists the last session-creation modal context for shortcut reuse", () => {
    saveLastSessionCreationContext({
      cwd: "/repo-a/worktrees/feature-x",
      treeGroupId: "frontend",
      newSessionDefaultsKey: "tree-group:frontend",
    });

    expect(getLastSessionCreationContext()).toEqual({
      cwd: "/repo-a/worktrees/feature-x",
      treeGroupId: "frontend",
      newSessionDefaultsKey: "tree-group:frontend",
    });
  });
});
