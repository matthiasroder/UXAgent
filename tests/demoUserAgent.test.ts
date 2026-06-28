import { describe, expect, it } from "vitest";
import { isSafeInteractionUrl } from "../src/agents/demoUserAgent.js";
import { isExternalHttpRequest } from "../src/browser/runSession.js";

describe("demo user agent safety", () => {
  it("only allows active interaction on local targets", () => {
    expect(isSafeInteractionUrl("file:///tmp/page.html")).toBe(true);
    expect(isSafeInteractionUrl("http://127.0.0.1:3000/page")).toBe(true);
    expect(isSafeInteractionUrl("http://localhost:3000/page")).toBe(true);
    expect(isSafeInteractionUrl("http://[::1]:3000/page")).toBe(true);
    expect(isSafeInteractionUrl("http://example.com/page")).toBe(false);
    expect(isSafeInteractionUrl("https://example.com/page")).toBe(false);
  });

  it("classifies external HTTP requests for the local-page request guard", () => {
    expect(isExternalHttpRequest("https://example.com/collect")).toBe(true);
    expect(isExternalHttpRequest("http://127.0.0.1:3000/collect")).toBe(false);
    expect(isExternalHttpRequest("file:///tmp/collect")).toBe(false);
  });
});
