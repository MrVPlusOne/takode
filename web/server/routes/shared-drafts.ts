import { Hono } from "hono";
import { normalizeThreadTarget } from "../../shared/thread-routing.js";
import { threadAddress } from "../../shared/topic-thread-key.js";
import { formatDraftPost } from "../../shared/draft-posts.js";
import { assistantMessageId } from "../artifact-extract.js";
import { getArtifactLibrary, type ArtifactLibrary } from "../artifact-library.js";
import { publishSessionReport } from "./markdown-reports.js";
import type { RouteContext } from "./context.js";

type Selection = { versions: Array<{ artifactId: string; n: number }> } | { error: string; status: 403 | 404 | 409 };

/**
 * Shared drafts: `POST /takode/drafts/share` posts drafts from the caller's own session or a session
 * it herds into one of the caller's threads, as their normal cards, so a leader never copies a
 * worker's draft by hand. Each post becomes one report showing the version the Library already
 * has: the card is that same artifact (copy marks, star, versions), a newer version collapses it
 * as usual, and like any report it makes the thread unread.
 */
export function createSharedDraftRoutes(ctx: RouteContext, library: () => ArtifactLibrary | null = getArtifactLibrary) {
  const api = new Hono();
  api.post("/takode/drafts/share", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const session = ctx.wsBridge.getSession(auth.callerId);
    if (!session || auth.caller.archived) return c.json({ error: "Publishing session is unavailable." }, 409);
    const lib = library();
    if (!lib) return c.json({ error: "The Library is not running." }, 503);
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid share request." }, 400);
    }
    const target = typeof body.threadKey === "string" ? normalizeThreadTarget(body.threadKey) : null;
    if (!target) return c.json({ error: "Choose an exact quest thread or a topic thread." }, 400);
    // Drafts written moments ago may still be on their way into the Library.
    await lib.idle();
    const selection = selectDrafts(ctx, lib, auth.callerId, body);
    if ("error" in selection) return c.json({ error: selection.error }, selection.status);

    const shared = [];
    for (const { artifactId, n } of selection.versions) {
      const artifact = lib.store.get(artifactId)!;
      const sessionNum = ctx.launcher.getSession(artifact.sessionId)?.sessionNum;
      const content = await lib.store.versionContent(artifactId, n);
      if (content?.kind !== "post") return c.json({ error: `Version ${n} of "${artifact.title}" was not kept.` }, 404);
      const receipt = publishSessionReport(ctx, auth.callerId, session, {
        content: formatDraftPost({
          title: artifact.title,
          parts: content.parts,
          attachments: content.attachments?.map((list) => list.map((attachment) => attachment.path)),
          destination: content.destination,
        }),
        sourcePath: artifact.title,
        unreadText: `Draft: ${artifact.title}\n\n${content.parts.join("\n\n")}`,
        threadKey: target.threadKey,
        sharedDraft: {
          artifactId,
          version: n,
          sessionId: artifact.sessionId,
          ...(typeof sessionNum === "number" ? { sessionNum } : {}),
        },
      });
      // Only the thread can be refused (Main for a leader), so nothing was published before.
      if ("error" in receipt) return c.json({ error: receipt.error }, receipt.status);
      await lib.showVersion(auth.callerId, receipt.message.id, artifactId, n);
      shared.push({ artifactId, title: artifact.title, version: n, parts: content.parts.length });
    }
    return c.json({ threadKey: threadAddress(target.threadKey), drafts: shared }, 201);
  });
  return api;
}

/**
 * The newest versions to share: of the draft `artifact` names; of the draft titled `title` in
 * session `from`; of the drafts message `message` of `from` holds; or of those in its newest message
 * holding any. A message whose draft was revised since is refused rather than shared stale.
 */
function selectDrafts(
  ctx: RouteContext,
  lib: ArtifactLibrary,
  callerId: string,
  body: Record<string, unknown>,
): Selection {
  const mayShareFrom = (sessionId: string) =>
    sessionId === callerId || ctx.launcher.getSession(sessionId)?.herdedBy === callerId;
  const refused = {
    error: "You can share drafts only from your own session or a session you herd.",
    status: 403,
  } as const;

  if (typeof body.artifact === "string") {
    const id = lib.store.resolveId(body.artifact);
    const artifact = id ? lib.store.get(id) : null;
    if (!artifact || artifact.kind !== "post")
      return { error: `No draft ${body.artifact} in the Library.`, status: 404 };
    if (!mayShareFrom(artifact.sessionId)) return refused;
    return { versions: [{ artifactId: artifact.id, n: artifact.latest.n }] };
  }

  const fromId = typeof body.from === "string" ? ctx.resolveId(body.from) : null;
  if (!fromId || !ctx.launcher.getSession(fromId)) return { error: `No session ${String(body.from)}.`, status: 404 };
  if (!mayShareFrom(fromId)) return refused;
  const name = `#${ctx.launcher.getSession(fromId)?.sessionNum ?? fromId}`;

  if (typeof body.title === "string") {
    const wanted = body.title.trim().toLowerCase().replace(/\s+/g, " ");
    // Newest first, so a title used in several threads picks its latest draft.
    const match = lib.store
      .list({ sessionId: fromId, kind: "post", limit: 500 })
      .artifacts.find((artifact) => artifact.title.trim().toLowerCase().replace(/\s+/g, " ") === wanted);
    if (!match) return { error: `${name} has no draft titled "${body.title}".`, status: 404 };
    return { versions: [{ artifactId: match.id, n: match.latest.n }] };
  }

  const history = ctx.wsBridge.getSession(fromId)?.messageHistory ?? [];
  const draftsIn = (index: number) => {
    const messageId = assistantMessageId(history[index]!);
    return messageId
      ? lib.store
          .markersForMessage(fromId, messageId)
          .filter((entry) => entry.marker.kind === "post")
          .map((entry) => entry.marker)
      : [];
  };
  let markers: ReturnType<typeof draftsIn> = [];
  let index: number;
  if (typeof body.message === "number") {
    index = body.message;
    if (!Number.isInteger(index) || !history[index]) return { error: `${name} has no message ${index}.`, status: 404 };
    markers = draftsIn(index);
    if (!markers.length) return { error: `Message ${index} of ${name} has no drafts.`, status: 404 };
  } else {
    index = history.length - 1;
    while (index >= 0 && !(markers = draftsIn(index)).length) index--;
    if (index < 0) return { error: `${name} has no drafts.`, status: 404 };
  }
  for (const marker of markers) {
    const latest = lib.store.get(marker.id)?.latest.n;
    if (latest !== marker.version) {
      return {
        error:
          `"${marker.title}" in message ${index} of ${name} is version ${marker.version}; it was revised since ` +
          `(version ${latest}). Share the newest with --title "${marker.title}".`,
        status: 409,
      };
    }
  }
  return { versions: markers.map((marker) => ({ artifactId: marker.id, n: marker.version })) };
}
