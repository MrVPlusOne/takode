import { Hono } from "hono";
import { getSettings, updateSettings } from "../settings-manager.js";

export interface GlossaryOpenedResponse {
  opened: boolean;
}

/**
 * Whether the user has opened the glossary page on this server. The sidebar highlights its
 * Glossary link until then; the page records the first visit.
 */
export function createGlossaryRoutes() {
  const api = new Hono();

  api.get("/glossary/opened", (c) =>
    c.json({ opened: getSettings().glossaryOpened === true } satisfies GlossaryOpenedResponse),
  );

  api.post("/glossary/opened", (c) => {
    if (getSettings().glossaryOpened !== true) updateSettings({ glossaryOpened: true });
    return c.json({ opened: true } satisfies GlossaryOpenedResponse);
  });

  return api;
}
