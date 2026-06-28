import { describe, expect, it } from "vitest";
import { createLivePolicy, shouldBlockHttpRequest, shouldBlockNetworkRequest, validateLiveAction } from "../src/safety/livePolicy.js";
import type { LiveConfig, LiveElementSnapshot } from "../src/types.js";

const liveConfig: LiveConfig = {
  provider: "openai",
  model: "test-model",
  apiKeyEnv: "OPENAI_API_KEY",
  allowedOrigins: ["https://example.test"],
  includeScreenshots: false,
  maxActionRepairs: 1,
  permissions: {
    allowClicks: true,
    allowTyping: true,
    allowFormSubmit: false,
    allowExternalNavigation: false,
    allowDestructiveClicks: false,
  },
  testData: {
    email: "uxagent-test@example.com",
  },
};

const button: LiveElementSnapshot = {
  id: "el_1",
  tagName: "button",
  role: "button",
  text: "Subscribe",
  visible: true,
  enabled: true,
  isInput: false,
  isClickable: true,
  isSubmit: true,
  isDestructive: false,
};

const input: LiveElementSnapshot = {
  id: "el_2",
  tagName: "input",
  role: "textbox",
  text: "",
  label: "Email",
  visible: true,
  enabled: true,
  isInput: true,
  isClickable: false,
  isSubmit: false,
  isDestructive: false,
};

const destructiveLink: LiveElementSnapshot = {
  id: "el_3",
  tagName: "a",
  role: "link",
  text: "Delete project",
  href: "https://example.test/delete",
  visible: true,
  enabled: true,
  isInput: false,
  isClickable: true,
  isSubmit: false,
  isDestructive: true,
};

const allowedOtherOriginLink: LiveElementSnapshot = {
  id: "el_4",
  tagName: "a",
  role: "link",
  text: "Book call",
  href: "https://booking.example.test/start",
  visible: true,
  enabled: true,
  isInput: false,
  isClickable: true,
  isSubmit: false,
  isDestructive: false,
};

describe("live safety policy", () => {
  it("blocks form submission by default", () => {
    const result = validateLiveAction(createLivePolicy(liveConfig), {
      currentUrl: "https://example.test/",
      elements: [button],
      action: {
        action: "click",
        targetId: "el_1",
        reason: "Subscribe to the newsletter.",
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Form submission/);
  });

  it("allows typing configured test data only", () => {
    const policy = createLivePolicy(liveConfig);
    const allowed = validateLiveAction(policy, {
      currentUrl: "https://example.test/",
      elements: [input],
      action: {
        action: "type",
        targetId: "el_2",
        valueKey: "email",
        reason: "Use test email.",
      },
    });
    const blocked = validateLiveAction(policy, {
      currentUrl: "https://example.test/",
      elements: [input],
      action: {
        action: "type",
        targetId: "el_2",
        valueKey: "personal_email",
        reason: "Use unknown data.",
      },
    });

    expect(allowed.allowed).toBe(true);
    expect(allowed.value).toBe("uxagent-test@example.com");
    expect(blocked.allowed).toBe(false);
  });

  it("blocks external requests unless origin is allowed", () => {
    const policy = createLivePolicy(liveConfig);

    expect(shouldBlockHttpRequest("https://third-party.test/collect", policy)).toBe(true);
    expect(shouldBlockHttpRequest("https://example.test/page", policy)).toBe(false);
  });

  it("blocks mutating same-origin requests while form submission is disabled", () => {
    const policy = createLivePolicy(liveConfig);

    expect(shouldBlockNetworkRequest("https://example.test/api", "GET", policy)).toBe(false);
    expect(shouldBlockNetworkRequest("https://example.test/api", "POST", policy)).toBe(true);
  });

  it("blocks non-http network protocols except browser-internal URLs", () => {
    const policy = createLivePolicy(liveConfig);

    expect(shouldBlockNetworkRequest("wss://example.test/socket", "GET", policy)).toBe(true);
    expect(shouldBlockNetworkRequest("ftp://example.test/file", "GET", policy)).toBe(true);
    expect(shouldBlockNetworkRequest("data:text/plain,hello", "GET", policy)).toBe(false);
    expect(shouldBlockNetworkRequest("about:blank", "GET", policy)).toBe(false);
  });

  it("blocks actions when current page origin is outside the live allowlist", () => {
    const result = validateLiveAction(createLivePolicy(liveConfig), {
      currentUrl: "https://evil.test/",
      elements: [input],
      action: {
        action: "type",
        targetId: "el_2",
        valueKey: "email",
        reason: "Type test data.",
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not allowed/);
  });

  it("blocks destructive-looking clicks by default", () => {
    const result = validateLiveAction(createLivePolicy(liveConfig), {
      currentUrl: "https://example.test/",
      elements: [destructiveLink],
      action: {
        action: "click",
        targetId: "el_3",
        reason: "Delete stale content.",
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Destructive/);
  });

  it("requires both allowed origin and cross-origin navigation permission for cross-origin links", () => {
    const blocked = validateLiveAction(
      createLivePolicy({
        ...liveConfig,
        allowedOrigins: ["https://example.test", "https://booking.example.test"],
      }),
      {
        currentUrl: "https://example.test/",
        elements: [allowedOtherOriginLink],
        action: {
          action: "click",
          targetId: "el_4",
          reason: "Open booking flow.",
        },
      },
    );
    const allowed = validateLiveAction(
      createLivePolicy({
        ...liveConfig,
        allowedOrigins: ["https://example.test", "https://booking.example.test"],
        permissions: {
          ...liveConfig.permissions,
          allowExternalNavigation: true,
        },
      }),
      {
        currentUrl: "https://example.test/",
        elements: [allowedOtherOriginLink],
        action: {
          action: "click",
          targetId: "el_4",
          reason: "Open booking flow.",
        },
      },
    );
    const outsideAllowlist = validateLiveAction(
      createLivePolicy({
        ...liveConfig,
        permissions: {
          ...liveConfig.permissions,
          allowExternalNavigation: true,
        },
      }),
      {
        currentUrl: "https://example.test/",
        elements: [allowedOtherOriginLink],
        action: {
          action: "click",
          targetId: "el_4",
          reason: "Open booking flow.",
        },
      },
    );

    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/Cross-origin/);
    expect(allowed.allowed).toBe(true);
    expect(outsideAllowlist.allowed).toBe(false);
    expect(outsideAllowlist.reason).toMatch(/outside live.allowedOrigins/);
  });
});
