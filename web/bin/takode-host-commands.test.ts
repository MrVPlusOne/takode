import { hostVersionLine } from "./takode-host-commands.js";

const SERVER = "b".repeat(40);
const OTHER = "a".repeat(40);

// `takode host list` says what an auto-updating host on another build is
// waiting for, using the reason the server reports.
describe("hostVersionLine", () => {
  const host = { id: "h1", name: "devbox", build: OTHER, buildMismatch: true, autoUpdate: true };

  it("names what a pending auto-update waits for", () => {
    expect(hostVersionLine({ ...host, updateWaitingFor: "the landing run there finishes" }, SERVER)).toBe(
      "takode aaaaaaaa, differs from this server (bbbbbbbb), auto-update waits until the landing run there finishes",
    );
    expect(hostVersionLine({ ...host, updateWaitingFor: null }, SERVER)).toContain("auto-update pending");
    expect(hostVersionLine({ ...host, updating: true }, SERVER)).toContain("updating");
    expect(hostVersionLine({ ...host, updateError: "uncommitted changes" }, SERVER)).toContain(
      "auto-update failed: uncommitted changes",
    );
    expect(hostVersionLine({ ...host, build: SERVER, buildMismatch: false }, SERVER)).toBe(
      "takode bbbbbbbb, auto-update on",
    );
  });
});
