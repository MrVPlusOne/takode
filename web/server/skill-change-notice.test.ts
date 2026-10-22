import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SKILL_CHANGE_NOTICE_SOURCE_ID } from "../shared/injected-event-message.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import {
  checkSkillChanges,
  findChangedLoadedSkills,
  markSkillChangesChecked,
  recordSkillVersions,
  resetSkillChangeTrackingForTest,
} from "./skill-change-notice.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skill-change-notice-"));
  resetSkillChangeTrackingForTest();
});

afterEach(async () => {
  resetSkillChangeTrackingForTest();
  await rm(root, { recursive: true, force: true });
});

async function writeSkill(name: string, text: string): Promise<void> {
  await mkdir(join(root, "skills", name), { recursive: true });
  await writeFile(join(root, "skills", name, "SKILL.md"), text);
}

function record(now: number) {
  return recordSkillVersions({
    skillNames: ["quest", "confirm", "missing"],
    skillsDir: join(root, "skills"),
    statePath: join(root, "state", "server.json"),
    now,
  });
}

function toolUse(timestamp: number, name: string, input: Record<string, unknown>): BrowserIncomingMessage {
  return {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    message: {
      id: `msg-${timestamp}`,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "tool_use", id: `tool-${timestamp}`, name, input }],
      stop_reason: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  } as BrowserIncomingMessage;
}

function systemMessage(timestamp: number, sessionId: string): BrowserIncomingMessage {
  return {
    type: "user_message",
    content: "text",
    timestamp,
    agentSource: { sessionId },
  };
}

describe("recordSkillVersions", () => {
  it("records a change time only for skills whose text differs from the previous start", async () => {
    // The first start has nothing to compare with, so nothing counts as changed;
    // later starts keep an unchanged skill's earlier change time.
    await writeSkill("quest", "v1");
    await writeSkill("confirm", "v1");
    expect([...(await record(100))]).toEqual([
      ["quest", 0],
      ["confirm", 0],
    ]);

    await writeSkill("quest", "v2");
    expect([...(await record(200))]).toEqual([
      ["quest", 200],
      ["confirm", 0],
    ]);

    expect([...(await record(300))]).toEqual([
      ["quest", 200],
      ["confirm", 0],
    ]);
    const saved = JSON.parse(await readFile(join(root, "state", "server.json"), "utf-8"));
    expect(saved.quest.versions).toEqual([
      expect.objectContaining({ since: 0, text: "v1" }),
      expect.objectContaining({ since: 200, text: "v2" }),
    ]);
  });

  it("keeps only the latest versions of each skill", async () => {
    for (let version = 1; version <= 12; version++) {
      await writeSkill("quest", `v${version}`);
      await record(version * 100);
    }
    const saved = JSON.parse(await readFile(join(root, "state", "server.json"), "utf-8"));
    expect(saved.quest.versions.map((version: { text: string }) => version.text)).toEqual(
      Array.from({ length: 10 }, (_, index) => `v${index + 3}`),
    );
  });

  it("reads records saved before skill texts were kept", async () => {
    // Older records hold only a hash and change time; an unchanged skill keeps
    // its change time and gains its text.
    await mkdir(join(root, "state"), { recursive: true });
    await writeFile(
      join(root, "state", "server.json"),
      JSON.stringify({
        quest: { hash: "5a95ec2a3b0e4d8f1aa0f3bc0e9b3c4f6d43ae4bdc7a3cc0a7f1a7e2c8d5d1b2", changedAt: 50 },
      }),
    );
    await writeSkill("quest", "v1");
    expect([...(await record(100))]).toEqual([["quest", 100]]);
    const saved = JSON.parse(await readFile(join(root, "state", "server.json"), "utf-8"));
    expect(saved.quest.versions).toEqual([
      { hash: expect.any(String), since: 50 },
      expect.objectContaining({ since: 100, text: "v1" }),
    ]);
  });
});

describe("findChangedLoadedSkills", () => {
  const changeTimes = new Map([
    ["quest", 50],
    ["confirm", 50],
    ["takode-orchestration", 50],
    ["memory", 0],
  ]);

  it("finds skills loaded before their change through preloads, the Skill tool and file reads", () => {
    // Claude loads skills with the Skill tool or Read; Codex reads SKILL.md with
    // shell commands; leaders get preloads. Each counts as a load.
    const history = [
      systemMessage(10, "system:leader-skill-preload:takode-orchestration"),
      toolUse(11, "Skill", { skill: "confirm" }),
      toolUse(12, "Bash", {
        command: "sed -n '1,200p' /home/me/.agents/skills/quest/SKILL.md",
      }),
      toolUse(13, "Read", {
        file_path: "/home/me/.claude/skills/memory/SKILL.md",
      }),
      toolUse(14, "Read", {
        file_path: "/repo/.claude/skills/project-only/SKILL.md",
      }),
    ];
    // memory never changed; project-only is not a tracked skill.
    expect(findChangedLoadedSkills(history, changeTimes)).toEqual([
      { name: "confirm", seenAt: 11 },
      { name: "quest", seenAt: 12 },
      { name: "takode-orchestration", seenAt: 10 },
    ]);
  });

  it("skips skills loaded again after the change", () => {
    const history = [toolUse(10, "Skill", { skill: "quest" }), toolUse(60, "Skill", { skill: "quest" })];
    expect(findChangedLoadedSkills(history, changeTimes)).toEqual([]);
  });

  it("treats an earlier notice as covering every skill loaded before it", () => {
    // A notice named every changed skill, so only a later change counts again.
    const history = [toolUse(10, "Skill", { skill: "quest" }), systemMessage(70, SKILL_CHANGE_NOTICE_SOURCE_ID)];
    expect(findChangedLoadedSkills(history, changeTimes)).toEqual([]);
    // The notice is when the session last saw the skill.
    expect(findChangedLoadedSkills(history, new Map([["quest", 90]]))).toEqual([{ name: "quest", seenAt: 70 }]);
  });
});

describe("checkSkillChanges", () => {
  async function setUpChangedQuest() {
    await writeSkill("quest", "v1");
    await record(100);
    await writeSkill("quest", "v2");
    await record(200);
  }

  function session() {
    return {
      id: "s1",
      messageHistory: [toolUse(150, "Skill", { skill: "quest" })],
    };
  }

  it("adds the notice to the first ordinary input and stops after the session is marked checked", async () => {
    await setUpChangedQuest();
    const target = session();
    const checked = checkSkillChanges(target, {
      type: "user_message",
      content: "Do the work",
    });
    expect(checked?.deliveryContent).toMatch(/^Do the work\n\n\[Skills changed\] .*`quest`/);
    expect(checked?.historyFollowUps).toEqual([
      expect.objectContaining({
        agentSource: expect.objectContaining({
          sessionId: SKILL_CHANGE_NOTICE_SOURCE_ID,
        }),
      }),
    ]);

    markSkillChangesChecked(target);
    expect(checkSkillChanges(target, { type: "user_message", content: "Next" })).toBeNull();
  });

  it("leaves Takode's own system messages for the next ordinary input", async () => {
    // A reminder or recovery message is not new work; the check waits for one.
    await setUpChangedQuest();
    const target = session();
    const reminder = {
      type: "user_message" as const,
      content: "x",
      agentSource: { sessionId: "system:long-sleep-guard" },
    };
    expect(checkSkillChanges(target, reminder)).toBeNull();
    const herd = {
      type: "user_message" as const,
      content: "events",
      agentSource: { sessionId: "herd-events" },
    };
    expect(checkSkillChanges(target, herd)?.deliveryContent).toContain("[Skills changed]");
  });

  it("delivers the input unchanged when no loaded skill changed", async () => {
    await writeSkill("quest", "v1");
    await record(100);
    const message = { type: "user_message" as const, content: "Hi" };
    expect(checkSkillChanges(session(), message)).toBe(message);
  });
});

describe("skill change diffs", () => {
  const lines = (count: number, prefix = "line") =>
    Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);

  function loadedAt(timestamp: number) {
    return { id: "s1", messageHistory: [toolUse(timestamp, "Skill", { skill: "quest" })] };
  }

  function notice(target: ReturnType<typeof loadedAt>): string {
    return checkSkillChanges(target, { type: "user_message", content: "Go" })?.historyFollowUps?.[0]?.content ?? "";
  }

  it("shows a small change as a diff against the version the session loaded", async () => {
    // v1 -> v2 -> v3: a session that loaded v2 sees only the v2 -> v3 change,
    // with a little context and line numbers to place it.
    const v1 = lines(20);
    const v2 = v1.map((line) => (line === "line 5" ? "line five" : line));
    const v3 = v2.map((line) => (line === "line 15" ? "line fifteen" : line));
    await writeSkill("quest", `${v1.join("\n")}\n`);
    await record(100);
    await writeSkill("quest", `${v2.join("\n")}\n`);
    await record(200);
    await writeSkill("quest", `${v3.join("\n")}\n`);
    await record(300);

    expect(notice(loadedAt(250))).toBe(
      [
        "[Skills changed] These skills changed after you loaded them: `quest`.",
        "",
        "`quest` changed only as shown; the rest is as you loaded it, so you need not load it again:",
        "```diff",
        "@@ -13,5 +13,5 @@",
        " line 13",
        " line 14",
        "-line 15",
        "+line fifteen",
        " line 16",
        " line 17",
        "```",
      ].join("\n"),
    );
    // Loaded v1: both changes.
    expect(notice(loadedAt(150))).toContain("-line 5\n+line five");
  });

  it("gives the size of a large change and asks for a reload only if needed", async () => {
    await writeSkill("quest", lines(100).join("\n"));
    await record(100);
    await writeSkill("quest", lines(100, "rewritten line").join("\n"));
    await record(200);

    const text = notice(loadedAt(150));
    expect(text).toContain("`quest` changed too much to show here (100 lines added, 100 removed, a ");
    expect(text).toMatch(/a [\d,]+-character diff\)\. Your copy is out of date: load it again .* only if you need it/);
    expect(text).not.toContain("```");
  });

  it("names the change without a diff when the loaded version's text was not kept", async () => {
    // The session loaded the skill before the oldest kept version.
    for (let version = 1; version <= 11; version++) {
      await writeSkill("quest", `v${version}`);
      await record(version * 100);
    }
    expect(notice(loadedAt(150))).toBe(
      [
        "[Skills changed] These skills changed after you loaded them: `quest`.",
        "",
        "`quest`: your copy is out of date; load it again (the Skill tool, or read its SKILL.md) only if you need it for what you are doing now.",
      ].join("\n"),
    );
  });

  it("fences a diff of skill text that contains code fences", async () => {
    await writeSkill("quest", "intro\n```bash\nold\n```\n");
    await record(100);
    await writeSkill("quest", "intro\n```bash\nnew\n```\n");
    await record(200);
    expect(notice(loadedAt(150))).toContain("````diff\n@@ -1,4 +1,4 @@\n intro\n ```bash\n-old\n+new\n ```\n````");
  });
});
