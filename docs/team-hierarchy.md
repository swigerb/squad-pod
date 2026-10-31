# Team identity and transient hierarchy

The `.squad/team.md` roster remains the membership authority (including the
existing hidden-member policy). Observation never writes that roster, assigns
roles, creates persistent members, or infers membership from task display names.

## Producer evidence

| Producer | Pinned evidence | Supported interpretation |
| --- | --- | --- |
| Squad stable v1.1.0, `c24da2aad2ab7576f6b68dec2bc50b2fe2dc7a8a` | [Coordinator](https://github.com/bradygaster/squad/blob/c24da2aad2ab7576f6b68dec2bc50b2fe2dc7a8a/.github/agents/squad.agent.md): CLI dispatch uses `general-purpose` and the lowercase roster cast name in `name`; adding a member explicitly edits the roster. [Config schema](https://github.com/bradygaster/squad/blob/c24da2aad2ab7576f6b68dec2bc50b2fe2dc7a8a/packages/squad-sdk/src/config/schema.ts): `AgentConfig` has name/role/charter/model/tools/status, not a parent relationship. [State schema](https://github.com/bradygaster/squad/blob/c24da2aad2ab7576f6b68dec2bc50b2fe2dc7a8a/packages/squad-sdk/src/state/schema.ts) maps team/agents to roster and agent directories. | Exact, unique roster ID/folder matches on Squad general-purpose dispatches attribute activity to an existing member. These are not promotion events or a durable parent graph. |
| Copilot CLI 1.0.105 | Official release archive's shipped `package/copilot-sdk/generated/session-events.d.ts`, preserved with provenance in [the #102 evidence artifact](https://github.com/swigerb/squad-pod/issues/102/artifacts/1). Declaration member SHA-256: `b324b24dcee4a16384ef6af46efe64bfe2f032633ae2f7208e969a196cb00f3e`. The corresponding shipped `cli-main.js` task-registry reconstruction joins `subagent.started.data.toolCallId` to task dispatches, uses the envelope agent ID as the canonical instance ID, and treats `completed.cancelled` as cancellation. | Envelope `agentId` is a subagent instance ID, not a roster name. `subagent.selected.data.agentName` is the internal selected custom-agent name; `agentDisplayName` is display-only. `subagent.started/completed/failed.data.toolCallId` identifies the spawning call. `completed.cancelled: true` means aborted. |
| Public Copilot SDK, `e22b95e6ead5e1de7e9a68d3087b8d28dc5f364a` | [Generated event declarations](https://github.com/github/copilot-sdk/blob/e22b95e6ead5e1de7e9a68d3087b8d28dc5f364a/nodejs/src/generated/session-events.ts). The relevant fields were compared with the exact 1.0.105 declarations above. | Corroboration, not a substitute for version-specific producer evidence or a real-session acceptance run. |
| Pixel Agents v1.5.0, `b1bafd02896d90d83457266575a1e8e5011ce997` | [TeamProvider](https://github.com/pixel-agents-hq/pixel-agents/blob/b1bafd02896d90d83457266575a1e8e5011ce997/core/src/teamProvider.ts) and [SubagentWatch](https://github.com/pixel-agents-hq/pixel-agents/blob/b1bafd02896d90d83457266575a1e8e5011ce997/server/src/subagentWatch.ts) distinguish persistent teammates from transient spawns. | Its Claude-specific named-background promotion, sidecar files and team configuration are not Squad contracts and are not copied as identity rules. |

These are static shipped-source/schema findings. No private session logs or paid
real launches were inspected or executed to establish them.

## Implemented display contract

The consented live adapter projects only bounded identity/lifecycle metadata.
A task becomes eligible for a temporary character only after `subagent.started`,
not after dispatch. It must have an explicit, running same-session parent call
whose ancestry resolves to a visible roster member. Missing/cyclic/cross-session
links stay unknown. `started.data.parentId` is a task-registry ID: it is **not**
assumed to equal `parentToolCallId` or a roster ID.

Characters are keyed by `(session ID, instance ID)` when the producer supplies
an instance ID, otherwise `(session ID, spawning call ID)`. Display names never
deduplicate calls. A terminal alias wins over another call for the same instance.
An instance's selected custom-agent identity is joined only through the matching
envelope instance ID. An exact roster match uses the existing roster character,
including when selection or roster arrival follows the spawn. A task named like
a roster member, without the supported attribution/selection evidence, is not
promoted. Unknown/non-general-purpose calls remain unattributed unless a matching
custom-selection event supplies authoritative identity.

Temporary characters inherit a hue-shifted parent appearance, occupy free floor
near that member, and show a **Subtask / Parent** label. Nested calls link to their
nearest observed roster ancestor; they do not imply durable reporting lines.
There is no default line from a label to a character; a small pointer appears only
when modest crowding displaces a label. They have no seat, details/charter action,
appearance preference or layout persistence. If no floor is available, the task
remains in Telemetry without a character. Roster names, roles, seats and appearance
stay authoritative.

Completion, failure, cancellation, ended/missing parents, session changes,
source loss/error, five-minute source staleness, and disabling observation remove
temporary characters. Dispatch completion does not. Reconnect restores only the
bounded in-flight inventory and never restores terminal calls. The existing
64-task/16-recent-completion limits and partial-coverage flag still apply.

## Unsupported disposition and acceptance

Squad v1.1.0 exposes no durable hierarchy or authoritative automatic promotion
contract in the audited roster/config/state surfaces. Those criteria remain
unsupported; the transient view is not their implementation. A manually edited
roster remains authoritative but is not evidence that a producer promoted a
teammate. The [technical unsupported disposition](https://github.com/swigerb/squad-pod/issues/111#issuecomment-6533950112)
is recorded on issue #111; native and real-producer acceptance remain separate.

The shared webview supports the same snapshot protocol in any host. Standalone
live observation is default-off and requires local CLI consent via
`--live-activity`; the read-only browser cannot enable session-log reads.
Opted-in observation forwards the same bounded task/instance/selected-agent
projection and temporary characters without promoting roster members. With no
active owned run it follows the newest exact-canonical-workspace Squad session,
visibly labeled as project matching rather than ownership. With `--terminals`,
new compatible owned launches add a private server-generated `--session-id` UUID;
while an active owned run awaits its exact fresh source, unrelated project
sessions cannot supply fallback activity. See the [standalone channel and
exact-owned boundary](standalone-channels.md) for read scope, fixed argv,
sanitized-home mismatch, revocation and cleanup.

Unit/host/webview/engine tests and production-browser fixtures establish the
projection, character lifecycle, rendering and deduplication behavior. Fixtures
use the compiled provider, production webview, packaged sprites, and injected
synthetic homes. They are not native VS Code or real Squad-session evidence.
Native acceptance must identify the exact CLI/product versions, approve the
specific disposable sources, and exercise an actually emitted start, parent,
selection (when produced), completion/failure/cancellation and stale transition.
Absent producer fields are NOT-PRODUCED, never inferred.
