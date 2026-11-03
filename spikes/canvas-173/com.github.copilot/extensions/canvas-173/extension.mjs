// Staged only: copy this directory into a synthetic project's .github/extensions/canvas-173.
// Host SDK injection is required; do not npm-install the SDK or run this in the owning session.
// Snapshot provenance hashes fixed sibling artifacts at observation time (256 KiB each),
// plus a 16 KiB plugin.json only in the known namespaced package layout (reads cap + 1
// byte to detect growth). No caller paths, source contents, commit proof or immutable
// in-memory-code guarantee are provided.
// Public contract reference, not installed SDK version proof:
// github/copilot-sdk v1.0.28 nodejs/src/{extension.ts,canvas.ts,session.ts,
// generated/session-events.ts,generated/rpc.ts}. session.on envelopes use parentId for the previous
// EVENT, never agent hierarchy. Only six allowlisted types, UUID event IDs and bounded
// opaque actor/toolCallId correlations are projected as volatile generation aliases.
// Per instance: 32 events, 128 shared FIFO aliases, 256-character IDs; eviction counts
// disclose partial coverage. Producer timestamps expose validity only (UTC ISO subset);
// absent actor IDs do not prove a root actor. No event.data except toolCallId is read.
// context_changed clears every observation synchronously without reading its data.
// Only a new matching host open callback reattaches; workspacePath grants no authority.
// Close/dispose clears state and owns unsubscribe; old queued callbacks cannot revive it.
// Unsubscribe failure permanently fails this provider lifetime closed; no automatic retry.
// A replacement open callback retains the bounded listener but starts a fresh generation,
// including when the preceding open is still awaiting initial listener readiness.
import { createCanvas, joinSession, CanvasError } from "@github/copilot-sdk/extension";
import { createProbe } from "./probe.mjs";

const probe = createProbe(createCanvas, CanvasError);
const session = await joinSession({ canvases: [probe.canvas] });
probe.bind(session);

// Best-effort provider-local cleanup, not a promise of callbacks on abrupt process loss.
const stop = () => {
    void probe.dispose().catch(() => {
        console.error("probe_disposal_failed: Provider cleanup failed");
    });
};
process.once("disconnect", stop);
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
