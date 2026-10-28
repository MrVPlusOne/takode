import { describe, expect, it, vi } from "vitest";
import { createExportRoutes } from "./exports.js";

/**
 * Exports of a card the browser built into a standalone page: the server's Chrome prints it as a
 * PDF or captures it as a PNG. A stand-in renderer replaces Chrome here.
 */
describe("export routes", () => {
  const post = (app: ReturnType<typeof createExportRoutes>, body: unknown) =>
    app.request("/exports/document", { method: "POST", body: JSON.stringify(body) });

  it("returns the rendered file with its type, at a clamped width", async () => {
    const renderDocument = vi.fn(async () => Buffer.from("%PDF-1.7"));
    const app = createExportRoutes({ renderer: { renderDocument } });
    const response = await post(app, { html: "<p>Hi</p>", format: "pdf", width: 5000 });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(await response.text()).toBe("%PDF-1.7");
    expect(renderDocument).toHaveBeenCalledWith({ html: "<p>Hi</p>", format: "pdf", width: 1600 });
  });

  it("refuses requests without a document or a known format, and reports a failed render", async () => {
    const app = createExportRoutes({
      renderer: {
        renderDocument: async () => {
          throw new Error("No headless Chrome");
        },
      },
    });
    expect((await post(app, { format: "pdf" })).status).toBe(400);
    expect((await post(app, { html: "<p>Hi</p>", format: "docx" })).status).toBe(400);
    const failed = await post(app, { html: "<p>Hi</p>", format: "png" });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "Export failed: No headless Chrome" });
  });
});
