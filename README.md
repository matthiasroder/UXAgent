# UXAgent

UXAgent runs simulated UX test panels against real browser pages and turns the sessions into evidence you can review.

Give it a website, a panel of personas, and a set of tasks. UXAgent opens the page in Chromium, lets each simulated user attempt the task, captures the trace, and writes a reviewer report with outcomes, evidence, severity, affected journeys, and suggested fixes.

It is built for teams that want a fast UX red-team pass before or after design changes: not a replacement for real user research, but a practical way to surface friction, compare flows, and keep interface critiques grounded in browser evidence.

## What It Does

- Runs persona x task panels from a JSON config.
- Uses a real rendered browser through Playwright Chromium.
- Captures screenshots, action logs, metadata, outcomes, and think-aloud notes for every session.
- Separates the simulated user from the reviewer, so interaction evidence and critique stay distinct.
- Produces per-session reviews plus an aggregate report across the panel.
- Runs deterministic local `demo` panels without LLM credentials.
- Runs OpenAI-backed `live` panels with explicit origin and action permissions.
- Supports optional Playwright video recording with `limits.recordVideo`.

## Quick Start

```bash
npm install
npx playwright install chromium
npm run build
npm test
```

Run the bundled publisher demo:

```bash
npm run uxagent -- --config examples/publisher-panel.json --out runs/demo
```

Open the generated report:

```bash
open runs/demo/publisher-demo/aggregate-report.md
```

## Example Panel

```json
{
  "runName": "Publisher Relaunch Demo",
  "runId": "publisher-demo",
  "targetUrl": "${CONFIG_DIR}/fixtures/publisher.html",
  "mode": "demo",
  "limits": {
    "maxSteps": 8,
    "actionDelayMs": 0,
    "navigationTimeoutMs": 30000,
    "recordVideo": false
  },
  "personas": [
    {
      "id": "newsletter_prospect",
      "name": "Newsletter Prospect",
      "profile": "Interested in events and essays but not ready to buy today.",
      "goals": ["Subscribe for updates"],
      "constraints": ["Needs a visible, low-friction signup path"]
    }
  ],
  "tasks": [
    {
      "id": "join_newsletter",
      "title": "Join the newsletter",
      "description": "Subscribe to the publisher newsletter with an email address.",
      "successCriteria": ["A newsletter confirmation is visible"]
    }
  ],
  "reviewer": {
    "minSeverity": "low"
  }
}
```

`targetUrl` can be:

- an absolute `http://` or `https://` URL
- a `file://` URL
- a `${CONFIG_DIR}/relative/path.html` file path resolved relative to the config file

`task.startPath` is available for HTTP(S) targets and must stay on the same origin as `targetUrl`. It is rejected for `file://` targets to avoid local filesystem ambiguity.

## Live Mode

`live` mode uses an OpenAI-backed browser agent. The model sees the persona, task, visible page state, recent action history, available element IDs, and optional screenshot context. It can propose one action at a time, and UXAgent validates that action before Playwright executes anything.

Set an API key:

```bash
export OPENAI_API_KEY=...
```

Run a live panel:

```bash
npm run uxagent -- --config examples/themindshift-live-panel.json --out runs/live
```

Live mode requires explicit `allowedOrigins`:

```json
{
  "mode": "live",
  "live": {
    "provider": "openai",
    "model": "gpt-5.5",
    "apiKeyEnv": "OPENAI_API_KEY",
    "allowedOrigins": ["https://themindshift.global"],
    "includeScreenshots": true,
    "maxActionRepairs": 1,
    "permissions": {
      "allowClicks": true,
      "allowTyping": true,
      "allowFormSubmit": false,
      "allowExternalNavigation": false,
      "allowDestructiveClicks": false
    },
    "testData": {
      "email": "uxagent-test@example.com",
      "name": "UXAgent Test"
    }
  }
}
```

The model can only choose from these actions:

- `observe`
- `click`
- `type`
- `scroll`
- `wait`
- `back`
- `finish`
- `fail`

It does not get raw Playwright access. Clicks and typing are checked against the current page snapshot, the configured origin policy, and the configured permissions.

## Output

Each run writes to `<out>/<safeRunId-or-runName>/`.

```text
runs/demo/publisher-demo/
  run-metadata.json
  aggregate-report.md
  aggregate-report.json
  sessions/
    newsletter_prospect__join_newsletter/
      metadata.json
      actions.json
      outcome.json
      think-aloud.md
      review.md
      review.json
      screenshots/
        initial.png
        step-1-observe.png
        step-2-type.png
        step-3-click.png
        final.png
      video.webm        # only when recordVideo is enabled and available
```

The Markdown files are meant for humans. The JSON files are stable enough for scripts, regression comparisons, and future dashboards.

## Evidence Model

UXAgent treats screenshots and logs as the reliable baseline. They are always captured, easy to inspect, and straightforward to test.

Video is optional:

```json
{
  "limits": {
    "recordVideo": true
  }
}
```

When video recording is enabled, UXAgent asks Playwright to save `video.webm`. If local browser video support fails, the run still preserves the core evidence: screenshots, actions, outcomes, think-aloud notes, and reports.

## Demo Mode Safety

`demo` mode is deterministic and credential-free. It actively clicks and types only on local targets:

- `file://`
- `localhost`
- `127.0.0.1`
- `::1`

For non-local HTTP(S) targets, UXAgent captures observation evidence without active interaction. For local pages, it also blocks non-local HTTP(S) requests after initial navigation so a fixture cannot accidentally submit data to an external service.

## Live Mode Safety

Live mode is active, but bounded:

- `allowedOrigins` is required and must include the target origin.
- Live mode requires an HTTP(S) `targetUrl`; use `demo` for `file://` fixtures.
- HTTP(S) requests outside `allowedOrigins` are always blocked.
- Service workers are disabled in live browser contexts so request guards cannot be bypassed by cached handlers.
- WebSocket traffic is mocked locally and does not connect to external servers.
- Other non-HTTP(S) network channels are blocked except browser-internal `data:`, `blob:`, and `about:` URLs.
- Same-origin `POST`/mutating requests are blocked while `allowFormSubmit` is false.
- Cross-origin navigation among configured allowed origins requires `allowExternalNavigation`.
- Form submission is disabled by default.
- Destructive-looking clicks are disabled by default.
- Typing can only use values from `live.testData`.
- Missing API credentials fail before browser launch.
- Blocked model actions are logged as evidence instead of being executed.

## CLI

```bash
npm run uxagent -- --config <config.json> --out <output-dir>
```

Options:

- `--config`, `-c`: JSON run configuration
- `--out`, `-o`: output directory, defaults to `runs`
- `--help`, `-h`: show help

## Configuration Reference

Top-level fields:

- `runName`: human-readable run name
- `runId`: optional stable ID for reproducible output paths
- `targetUrl`: page URL or `${CONFIG_DIR}` file path
- `mode`: `demo` or `live`
- `limits.maxSteps`: maximum simulated-user steps per task
- `limits.actionDelayMs`: delay between actions
- `limits.navigationTimeoutMs`: browser navigation timeout
- `limits.recordVideo`: enable optional Playwright video
- `personas`: one or more simulated users
- `tasks`: one or more task scenarios
- `reviewer.minSeverity`: filters displayed Markdown findings; JSON reports keep the full structure
- `live.provider`: currently `openai`
- `live.model`: OpenAI model name
- `live.apiKeyEnv`: environment variable used for the API key
- `live.allowedOrigins`: origins where live mode may actively interact
- `live.includeScreenshots`: include viewport screenshots in model prompts
- `live.maxActionRepairs`: retry malformed model action output up to this many times
- `live.permissions`: click, typing, form, navigation, and destructive-action controls
- `live.testData`: named values the agent is allowed to type

Persona and task IDs are validated and normalized for filesystem-safe artifact paths. IDs that would collide after normalization are rejected.

## Current Boundaries

UXAgent is usable today as a local evidence harness, deterministic demo runner, and OpenAI-backed live browser agent.

The deterministic demo user is simple by design. It is good for validating the harness, comparing fixture flows, and producing reviewable artifacts. Live mode is more capable, but it is still a bounded synthetic UX red-team pass, not broad autonomous user research.

## Research Anchor

UXAgent is informed by:

- [UXAgent: A System for Simulating Usability Testing of Web Design with LLM Agents](docs/references/uxagent-paper.md)

This repository is a separate implementation focused on a reusable local toolkit.
