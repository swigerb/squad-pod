# Source-grounded task bubbles

This is an enhancement, not recovery of a previously implemented conversation
feature. Bubbles are deterministic, fixed phrases about current observed tasks
or tools, not generated summaries, dialogue, or evidence of collaboration.

## Frozen producer boundary

The producer remains Squad **1.1.0** at
`c24da2aad2ab7576f6b68dec2bc50b2fe2dc7a8a` and Copilot CLI **1.0.105**.
The [identity evidence](team-hierarchy.md#producer-evidence) records the exact
shipped CLI declaration checksum and source provenance. The corresponding frozen
[Squad coordinator](https://github.com/bradygaster/squad/blob/c24da2aad2ab7576f6b68dec2bc50b2fe2dc7a8a/.github/agents/squad.agent.md)
dispatches tasks; the already-consented adapter joins spawning call IDs, running
lifecycles and exact roster attribution. No new producer, private source, session
discovery mechanism, AI call, or consent scope is added here.

The corroborating public SDK declarations at
[`e22b95e6ead5e1de7e9a68d3087b8d28dc5f364a`](https://github.com/github/copilot-sdk/blob/e22b95e6ead5e1de7e9a68d3087b8d28dc5f364a/nodejs/src/generated/session-events.ts)
include `session.handoff` for remote/local **session transfer** with free-text
context/summary. That is not an authoritative inter-agent handoff or conversation
contract, is not in this adapter's event allowlist, and is not read for bubbles.
This corroboration does not establish that CLI 1.0.105 emits it. Parent call IDs,
transient parent links, nearby characters, tool dispatches and task completion do
not establish who said something to whom. Explicit inter-agent handoff/dialogue
remains **unsupported** in this slice.

## Privacy and lifecycle

Only a running task in the current snapshot with an explicit roster `agentId`
can produce a bubble, while the member is active with a live-sourced task and the
live observer is following. Task records must match their snapshot's full session
ID. The source's shortened display ID is checked for display consistency only,
not treated as proof of ownership: matching-workspace and exact-owned selection
remain the adapter's existing responsibility.
Two full session IDs can share that display prefix. The prefix check alone cannot
detect such a switch; the adapter's clearing/current-snapshot ordering remains
required. Tests of changed display IDs do not claim otherwise.

Text is restricted to fixed phrases such as **CLI task: Task in progress** and
**CLI tool: Reading a file**. Tool names select a finite phrase table; unknown
names fall back to the task phrase. No task description, prompt, argument,
filename, command token, output, result, model response, secret, or arbitrary
producer text is copied into bubble text. Text is at most 40 characters. Partial
observation remains partial; the bubble does not claim complete task coverage.

Completed, failed, aborted, idle, unavailable, switched and stale sources withhold
the bubble rather than retaining old text. Source staleness uses the existing
adapter's five-minute no-new-bytes boundary; it is not an invented tool duration.
Standalone transport disconnect also invalidates the task snapshot; reconnect
must receive fresh current metadata before summaries can reappear.
Existing details/Telemetry continue to expose their separately bounded source
information and unavailable/partial states.

The **Task bubbles** toggle affects this view only, including read-only
standalone viewers. It sends no host command, saves no project setting, grants no
office-control/terminal authority, and cannot enable private-source observation.
It resets when the view is remounted. Permission, wait, tool/history and context
indicators remain independent of this suppression.

## Acceptance boundary

Synthetic projection, host/webview and production-browser checks can establish
privacy gates, text, lifecycle, keyboard access and layout integration. They do
not establish a real producer conversation, native VS Code compatibility,
physical-device behavior, or paid-session acceptance. No native installation,
new private log read or real producer launch is required for this feature.
