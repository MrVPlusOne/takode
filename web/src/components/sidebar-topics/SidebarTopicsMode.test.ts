import { describe, expect, it } from "vitest";
import type { ThreadSummary, TopicSummary } from "../../../shared/library-topics.js";
import type { RecentSessionNode } from "../../utils/recent-sessions.js";
import { topicPlaces } from "./SidebarTopicsMode.js";

/**
 * Topics mode lists the topics and side chats of every leader with topics in one list, ordered as
 * Recent orders leaders: by when the user and the topic last dealt with each other there.
 */
const leader = (id: string) =>
  ({ leader: { id }, workers: [], spaceId: "s", spaceName: "S", recentAt: 0 }) as unknown as RecentSessionNode;
const topic = (id: string, interactionAt: number, extra: Partial<TopicSummary> = {}) =>
  ({ id, name: id, questIds: [], activityAt: 1, createdAt: 0, interactionAt, ...extra }) as TopicSummary;
const thread = (id: string, activityAt: number, extra: Partial<ThreadSummary> = {}) =>
  ({ id, key: `topic:${id}`, name: id, leaderId: "x", createdAt: 0, activityAt, ...extra }) as ThreadSummary;

describe("topicPlaces", () => {
  it("lists every leader's topics and unfiled side chats, newest interaction first", () => {
    const places = topicPlaces([
      { node: leader("takode"), topics: [topic("library", 300), topic("feed", 100)], threads: [thread("chat", 250)] },
      {
        node: leader("msi"),
        topics: [topic("t7", 400)],
        threads: [thread("filed", 900, { topic: { id: "t7", name: "T7" } })],
      },
    ]);
    expect(places.map((place) => `${place.leader.leader.id}:${place.name}`)).toEqual([
      "msi:t7",
      "takode:library",
      "takode:chat",
      "takode:feed",
    ]);
  });

  it("lists a topic shared by leaders once, in the leader where the user dealt with it last", () => {
    // Takode's topics hold quests of several Takode leaders; listing each copy crowded the list.
    const places = topicPlaces([
      { node: leader("devbox"), topics: [topic("library", 300)], threads: [] },
      { node: leader("laptop"), topics: [topic("library", 500)], threads: [] },
    ]);
    expect(places.map((place) => place.leader.leader.id)).toEqual(["laptop"]);
  });

  it("falls back to the topic's activity before the server reports interactions", () => {
    const places = topicPlaces([
      { node: leader("a"), topics: [topic("old", 0, { interactionAt: undefined, activityAt: 50 })], threads: [] },
    ]);
    expect(places[0]!.at).toBe(50);
  });
});
