# UXAgent

UXAgent is a reusable toolkit for AI-based simulated user panels for browser-based user experience testing.

The goal is to run realistic, recorded interactions between simulated personas and a live website or application, then use the resulting evidence to critique the interface. The current implementation is a local MVP: it provides a TypeScript CLI, Playwright Chromium browser execution, a deterministic offline demo user agent, separated reviewer logic, sample fixture content, and automated tests.

## What We Want To Build

UXAgent should let a project team define a panel of plausible users, assign them realistic tasks, let them interact with the actual rendered site in a browser, and produce reviewable evidence.

The intended workflow:

1. Define target personas for a project.
2. Define task scenarios for those personas.
3. Open the current website or app in a real browser session.
4. Let each simulated user interact through visible UI actions: mouse movement, clicks, typing, scrolling, waiting, and back/forward navigation.
5. Record each session as a video or screencast.
6. Save screenshots, action logs, task outcomes, and persona-specific think-aloud notes.
7. Run a separate reviewer agent over the recording and trace.
8. Produce a UX critique with evidence, severity, affected journeys, and suggested fixes.

## Current MVP

The MVP implements the workflow locally with:

- JSON run configuration for target URL, run name, optional run ID, personas, tasks, limits, and reviewer settings.
- Real browser execution through Playwright Chromium.
- Deterministic `demo` mode that does not require paid LLM credentials.
- Separate simulated user and reviewer contracts in `src/agents/contracts.ts`.
- Per-session screenshots, action logs, metadata, outcomes, think-aloud notes, and reviews.
- Aggregate JSON and Markdown reports across persona/task sessions.
- A fixture publisher page and sample panel config.

`live` mode is intentionally not implemented yet. It is reserved for a future LLM/browser-agent adapter.

## Setup

```bash
npm install
npx playwright install chromium
npm run build
npm test
```

## Run The Demo

The checked-in sample config uses `${CONFIG_DIR}` so it can resolve the fixture relative to `examples/publisher-panel.json`:

```bash
npm run uxagent -- --config examples/publisher-panel.json --out runs/demo
```

For your own configs, use an absolute `http(s)://` URL, a `file://` URL, or `${CONFIG_DIR}/relative/path.html` for a file path relative to the config file.

## Config Shape

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
      "profile": "Interested in events and essays.",
      "goals": ["Subscribe for updates"],
      "constraints": ["Needs a visible signup path"]
    }
  ],
  "tasks": [
    {
      "id": "join_newsletter",
      "title": "Join the newsletter",
      "description": "Subscribe with an email address.",
      "successCriteria": ["A newsletter confirmation is visible"]
    }
  ],
  "reviewer": {
    "minSeverity": "low"
  }
}
```

`task.startPath` may be used with HTTP(S) targets and must resolve to the same origin as `targetUrl`. It is rejected for `file://` targets in this MVP to avoid local path ambiguity.

In `demo` mode, UXAgent only clicks or types on local targets: `file://`, `localhost`, `127.0.0.1`, or `::1`. For non-local HTTP(S) targets, it captures observation evidence without active interaction.

## Artifacts

Each run writes to `<out>/<safeRunId-or-runName>/`:

- `run-metadata.json`
- `sessions/<personaId>__<taskId>/metadata.json`
- `sessions/<personaId>__<taskId>/actions.json`
- `sessions/<personaId>__<taskId>/screenshots/*.png`
- `sessions/<personaId>__<taskId>/outcome.json`
- `sessions/<personaId>__<taskId>/think-aloud.md`
- `sessions/<personaId>__<taskId>/review.json`
- `sessions/<personaId>__<taskId>/review.md`
- optional `sessions/<personaId>__<taskId>/video.webm`
- `aggregate-report.json`
- `aggregate-report.md`

Screenshots, logs, and outcomes are the reliable minimum artifacts. Video is best-effort and depends on Playwright browser support and `limits.recordVideo`.

## Design Principles

- Use the real rendered browser, not a static DOM snapshot.
- Prefer screenshot-visible interaction over perfect selector-based automation.
- Keep the simulated user and reviewer roles separate.
- Treat synthetic users as a UX red-team and hypothesis generator, not a replacement for real user research.
- Make runs reproducible enough to compare before and after design changes.
- Keep the tool reusable across websites, not hard-coded to a single client project.

## Intended Outputs

Each simulated test run should produce:

- `video.webm` or equivalent screencast
- screenshot sequence
- action log
- persona and task metadata
- final task outcome
- simulated think-aloud notes
- reviewer critique
- aggregate report across personas and tasks

## Initial Use Case

The first motivating use case is UX testing for a publisher website relaunch. Example simulated users may include literary readers, architecture-book buyers, event visitors, newsletter prospects, gift buyers, and internal editors.

The reusable version should support any website where task-based user journeys can be described clearly.

## Research Anchor

This idea is informed by the UXAgent research paper:

- [UXAgent: A System for Simulating Usability Testing of Web Design with LLM Agents](docs/references/uxagent-paper.md)

## Limitations

- The demo user agent is deterministic and deliberately simple. It is useful for validating the harness and producing comparable local runs, not for claiming human-level research coverage.
- Arbitrary websites may produce failed outcomes when the demo strategy cannot identify a task path. That is intentional; the MVP should not fabricate success.
- Live LLM/browser-agent integration is behind the role contracts and remains out of scope until a provider adapter is explicitly chosen.
- UXAgent is a UX red-team and hypothesis generator, not a replacement for real user research.
