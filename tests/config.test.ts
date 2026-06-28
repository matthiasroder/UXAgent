import { describe, expect, it } from "vitest";
import { loadConfig, ConfigError } from "../src/config.js";
import { baseConfig, tempDir, writeConfig } from "./helpers.js";

describe("config validation", () => {
  it("applies defaults and resolves same-origin startPath", async () => {
    const dir = await tempDir("uxagent-config-");
    const configPath = await writeConfig(
      dir,
      baseConfig({
        runId: "stable-run",
        targetUrl: "http://example.test/base/",
        tasks: [
          {
            id: "newsletter",
            title: "Join newsletter",
            description: "Subscribe by email.",
            startPath: "/newsletter",
          },
        ],
      }),
    );

    const config = await loadConfig(configPath);

    expect(config.mode).toBe("demo");
    expect(config.limits.maxSteps).toBe(12);
    expect(config.reviewer.minSeverity).toBe("low");
    expect(config.runId).toBe("stable-run");
    expect(config.tasks[0]?.resolvedUrl).toBe("http://example.test/newsletter");
  });

  it("resolves CONFIG_DIR targetUrl placeholders to file URLs", async () => {
    const dir = await tempDir("uxagent-config-");
    const configPath = await writeConfig(dir, baseConfig({ targetUrl: "${CONFIG_DIR}/fixture.html" }));

    const config = await loadConfig(configPath);

    expect(config.targetUrl).toMatch(/^file:\/\//);
    expect(config.targetUrl).toContain("/fixture.html");
  });

  it("rejects empty personas and tasks before browser work", async () => {
    const dir = await tempDir("uxagent-config-");
    const configPath = await writeConfig(dir, baseConfig({ personas: [], tasks: [] }));

    await expect(loadConfig(configPath)).rejects.toThrow(ConfigError);
    await expect(loadConfig(configPath)).rejects.toThrow(/personas|tasks/);
  });

  it("rejects external startPath origin", async () => {
    const dir = await tempDir("uxagent-config-");
    const configPath = await writeConfig(
      dir,
      baseConfig({
        targetUrl: "https://example.test/",
        tasks: [
          {
            id: "escape",
            title: "Escape",
            description: "Try an unsafe path.",
            startPath: "https://other.example/path",
          },
        ],
      }),
    );

    await expect(loadConfig(configPath)).rejects.toThrow(/same|origin|targetUrl/);
  });

  it("rejects startPath for file URLs", async () => {
    const dir = await tempDir("uxagent-config-");
    const configPath = await writeConfig(
      dir,
      baseConfig({
        targetUrl: "file:///tmp/publisher.html",
        tasks: [
          {
            id: "file_path",
            title: "File path",
            description: "Try a file startPath.",
            startPath: "../secret",
          },
        ],
      }),
    );

    await expect(loadConfig(configPath)).rejects.toThrow(/not supported for file/);
  });

  it("rejects empty startPath for file URLs when the property is present", async () => {
    const dir = await tempDir("uxagent-config-");
    const configPath = await writeConfig(
      dir,
      baseConfig({
        targetUrl: "file:///tmp/publisher.html",
        tasks: [
          {
            id: "file_path",
            title: "File path",
            description: "Try an empty file startPath.",
            startPath: "",
          },
        ],
      }),
    );

    await expect(loadConfig(configPath)).rejects.toThrow(/not supported for file/);
  });

  it("rejects null-byte startPath values", async () => {
    const dir = await tempDir("uxagent-config-");
    const configPath = await writeConfig(
      dir,
      baseConfig({
        tasks: [
          {
            id: "unsafe_path",
            title: "Unsafe path",
            description: "Try a null byte.",
            startPath: "/safe\0unsafe",
          },
        ],
      }),
    );

    await expect(loadConfig(configPath)).rejects.toThrow(/null byte/);
  });

  it("rejects IDs that collide after filesystem normalization", async () => {
    const dir = await tempDir("uxagent-config-");
    const configPath = await writeConfig(
      dir,
      baseConfig({
        personas: [
          {
            id: "Reader",
            name: "Reader",
            profile: "Profile.",
          },
          {
            id: "reader",
            name: "Reader 2",
            profile: "Profile.",
          },
        ],
      }),
    );

    await expect(loadConfig(configPath)).rejects.toThrow(/collide/);
  });

  it("rejects double underscores in IDs because they conflict with session paths", async () => {
    const dir = await tempDir("uxagent-config-");
    const configPath = await writeConfig(
      dir,
      baseConfig({
        tasks: [
          {
            id: "buy__book",
            title: "Buy book",
            description: "Buy.",
          },
        ],
      }),
    );

    await expect(loadConfig(configPath)).rejects.toThrow(/reserved for session paths/);
  });

  it("requires live config when mode is live", async () => {
    const dir = await tempDir("uxagent-live-");
    const configPath = await writeConfig(dir, baseConfig({ mode: "live" }));

    await expect(loadConfig(configPath)).rejects.toThrow(/requires a live configuration/);
  });

  it("requires live allowedOrigins to include the target origin", async () => {
    const dir = await tempDir("uxagent-live-");
    const configPath = await writeConfig(
      dir,
      baseConfig({
        mode: "live",
        targetUrl: "https://example.test/",
        live: {
          allowedOrigins: ["https://other.test"],
        },
      }),
    );

    await expect(loadConfig(configPath)).rejects.toThrow(/allowedOrigins/);
  });

  it("applies live defaults", async () => {
    const dir = await tempDir("uxagent-live-");
    const configPath = await writeConfig(
      dir,
      baseConfig({
        mode: "live",
        targetUrl: "https://example.test/",
        live: {
          allowedOrigins: ["https://example.test"],
        },
      }),
    );

    const config = await loadConfig(configPath);

    expect(config.live?.provider).toBe("openai");
    expect(config.live?.apiKeyEnv).toBe("OPENAI_API_KEY");
    expect(config.live?.permissions.allowFormSubmit).toBe(false);
  });

  it("rejects file targets in live mode", async () => {
    const dir = await tempDir("uxagent-live-file-");
    const configPath = await writeConfig(
      dir,
      baseConfig({
        mode: "live",
        targetUrl: "file:///tmp/page.html",
        live: {
          allowedOrigins: ["file:///tmp/page.html"],
        },
      }),
    );

    await expect(loadConfig(configPath)).rejects.toThrow(/http\(s\) targetUrl/);
  });

  it("rejects non-http allowed origins in live mode", async () => {
    const dir = await tempDir("uxagent-live-origin-");
    const configPath = await writeConfig(
      dir,
      baseConfig({
        mode: "live",
        targetUrl: "https://example.test/",
        live: {
          allowedOrigins: ["file:///tmp/page.html"],
        },
      }),
    );

    await expect(loadConfig(configPath)).rejects.toThrow(/http\(s\) origins/);
  });
});
