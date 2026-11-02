// Staged only: copy this directory into a synthetic project's .github/extensions/canvas-173.
// Host SDK injection is required; do not npm-install the SDK or run this in the owning session.
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
