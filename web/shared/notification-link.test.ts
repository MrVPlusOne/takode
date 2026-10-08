import { formatNotificationMarkdownLink, parseNotificationLinkHref } from "./notification-link.js";

describe("notification link syntax", () => {
  it("parses the canonical session-scoped notification href", () => {
    // Notification IDs repeat across sessions, so the link must carry both numbers.
    expect(parseNotificationLinkHref("session:12:notification:3")).toEqual({
      sessionNum: 12,
      notificationId: "n-3",
    });
    // The raw stored `n-3` form is accepted too, since agents see it in JSON output.
    expect(parseNotificationLinkHref(" session:12:notification:n-3 ")).toEqual({
      sessionNum: 12,
      notificationId: "n-3",
    });
  });

  it("does not claim plain session, message, or malformed links", () => {
    expect(parseNotificationLinkHref("session:12")).toBeNull();
    expect(parseNotificationLinkHref("session:12:42")).toBeNull();
    expect(parseNotificationLinkHref("session:12:notification:")).toBeNull();
    expect(parseNotificationLinkHref("notification:3")).toBeNull();
    expect(parseNotificationLinkHref(undefined)).toBeNull();
  });

  it("formats a link whose label survives Markdown and round-trips through the parser", () => {
    const link = formatNotificationMarkdownLink(12, "n-3", "Pick [A]\nor B");
    expect(link).toBe("[Pick \\[A\\] or B](session:12:notification:3)");
    expect(parseNotificationLinkHref(link.slice(link.indexOf("](") + 2, -1))).toEqual({
      sessionNum: 12,
      notificationId: "n-3",
    });
    expect(formatNotificationMarkdownLink(12, "n-3", "  ")).toBe("[question](session:12:notification:3)");
  });
});
