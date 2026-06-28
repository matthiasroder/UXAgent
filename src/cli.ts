#!/usr/bin/env node
import path from "node:path";
import { ConfigError } from "./config.js";
import { runUxAgent, UnsupportedModeError } from "./runner.js";

interface CliArgs {
  config?: string;
  out: string;
  help: boolean;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      printHelp();
      return 0;
    }

    if (!args.config) {
      console.error("Missing required --config <file>.");
      printHelp();
      return 1;
    }

    const result = await runUxAgent({
      configPath: path.resolve(args.config),
      outDir: path.resolve(args.out),
    });
    console.log(`UXAgent run written to ${result.runDir}`);
    if (result.exitCode !== 0) {
      console.error("One or more sessions ended with an error. Inspect the session artifacts for details.");
    }
    return result.exitCode;
  } catch (error) {
    if (error instanceof ConfigError || error instanceof UnsupportedModeError) {
      console.error(error.message);
      return 1;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { out: "runs", help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--config" || arg === "-c") {
      args.config = argv[++index];
    } else if (arg === "--out" || arg === "-o") {
      args.out = argv[++index] ?? args.out;
    } else {
      throw new ConfigError(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`UXAgent

Usage:
  npm run uxagent -- --config examples/publisher-panel.json --out runs/demo

Options:
  -c, --config <file>  JSON run configuration
  -o, --out <dir>      Output directory, defaults to runs
  -h, --help           Show this help
`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await main();
  process.exitCode = code;
}
