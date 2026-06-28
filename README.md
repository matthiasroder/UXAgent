# UXAgent

UXAgent is a planned reusable toolkit for AI-based simulated user panels for browser-based user experience testing.

The goal is to run realistic, recorded interactions between simulated personas and a live website or application, then use the resulting evidence to critique the interface. This repository is intentionally documentation-only for now. It describes what should be built; implementation will happen later.

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

