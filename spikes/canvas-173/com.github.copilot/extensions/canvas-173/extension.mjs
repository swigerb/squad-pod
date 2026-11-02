// Staged only: copy this directory into a synthetic project's .github/extensions/canvas-173.
// Host SDK injection is required; do not npm-install the SDK or run this in the owning session.
// Snapshot provenance hashes fixed sibling artifacts at observation time (256 KiB each),
// plus a 16 KiB plugin.json only in the known namespaced package layout (reads cap + 1
// byte to detect growth). No caller paths, source contents, commit proof or immutable
// in-memory-code guarantee are provided.
import { createCanvas, joinSession, CanvasError } from "@github/copilot-sdk/extension";
import { createProbe } from "./probe.mjs";

const probe = createProbe(createCanvas, CanvasError);
const session = await joinSession({ canvases: [probe.canvas] });
probe.bind(session);

// Best-effort provider-local cleanup, not a promise of callbacks on abrupt process loss.
const stop = () => { void probe.dispose(); };
process.once("disconnect", stop);
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
