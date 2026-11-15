import { byteRangeResponse } from "./byte-range-response.js";

/**
 * Media players ask for byte ranges (Safari requires them to play video). Covers the range
 * forms players send, and that unanswerable or multi-part ranges fall back as HTTP allows.
 */
describe("byteRangeResponse", () => {
  const body = new Blob(["0123456789"]);
  const respond = (range?: string) => byteRangeResponse(body, 10, range, { "Content-Type": "video/mp4" });

  it("serves the whole file without a range, and the asked-for slice with one", async () => {
    const whole = respond();
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-length")).toBe("10");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("content-type")).toBe("video/mp4");

    for (const [range, text, contentRange] of [
      ["bytes=0-1", "01", "bytes 0-1/10"],
      ["bytes=7-", "789", "bytes 7-9/10"],
      ["bytes=-3", "789", "bytes 7-9/10"],
      // An end past the file is cut to the file's last byte.
      ["bytes=8-99", "89", "bytes 8-9/10"],
    ]) {
      const part = respond(range);
      expect(part.status, range).toBe(206);
      expect(part.headers.get("content-range"), range).toBe(contentRange);
      expect(await part.text(), range).toBe(text);
    }
  });

  it("refuses a range past the end and serves several ranges as the whole file", async () => {
    const past = respond("bytes=10-");
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */10");

    const several = respond("bytes=0-1,4-5");
    expect(several.status).toBe(200);
    expect(await several.text()).toBe("0123456789");
  });
});
