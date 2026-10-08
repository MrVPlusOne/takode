import { insecureCoordinatorUrlProblem } from "./host-agent.js";

describe("insecureCoordinatorUrlProblem", () => {
  // The host token and all session traffic cross this link, so plain http is
  // only accepted on this machine (or a local tunnel) unless explicitly allowed.
  it("accepts https and loopback http and refuses other plain http unless allowed", () => {
    expect(insecureCoordinatorUrlProblem("https://takode.example.com", false)).toBeNull();
    expect(insecureCoordinatorUrlProblem("http://127.0.0.1:3456", false)).toBeNull();
    expect(insecureCoordinatorUrlProblem("http://localhost:3456", false)).toBeNull();
    expect(insecureCoordinatorUrlProblem("http://10.0.0.5:3456", false)).toContain("not encrypted");
    expect(insecureCoordinatorUrlProblem("http://10.0.0.5:3456", true)).toBeNull();
    expect(insecureCoordinatorUrlProblem("ftp://host", true)).toContain("must start with https:// or http://");
    expect(insecureCoordinatorUrlProblem("not a url", false)).toContain("Not a valid coordinator URL");
  });
});
