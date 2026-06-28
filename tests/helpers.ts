import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function writeConfig(dir: string, config: unknown): Promise<string> {
  const filePath = path.join(dir, "config.json");
  await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return filePath;
}

export function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runName: "Test Run",
    targetUrl: "http://127.0.0.1:3000/publisher.html",
    personas: [
      {
        id: "reader",
        name: "Reader",
        profile: "Looks for books.",
      },
    ],
    tasks: [
      {
        id: "newsletter",
        title: "Join newsletter",
        description: "Subscribe by email.",
      },
    ],
    ...overrides,
  };
}
