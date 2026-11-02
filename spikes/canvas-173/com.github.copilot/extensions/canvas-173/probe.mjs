import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

const CANVAS_ID = "squad-pod-canvas-173";
const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set(["session.start", "session.resume", "session.idle", "assistant.turn_start"]);
const EMPTY_INPUT = { type: "object", properties: {}, additionalProperties: false };
const HTML = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Canvas 173 probe</title><h1>Canvas 173: synthetic read-only UI</h1><p>No project files, prompts, tool results, or account data are read.</p><p>Native framing is deliberately blocked pending a source-grounded embedding-origin contract. Use the snapshot canvas action for bounded metadata.</p></html>';

/** Project only allowlisted event envelope fields; never traverse event.data. */
export function sanitizeEvent(event) {
    if (!event || !EVENT_TYPES.has(event.type)) return undefined;
    const result = { type: event.type };
    if (typeof event.timestamp === "string" &&
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(event.timestamp)) {
        const time = Date.parse(event.timestamp);
        if (Number.isFinite(time) &&
            new Date(time).toISOString().replace(".000Z", "Z") ===
            event.timestamp.replace(/\.0{3}Z$/, "Z")) result.timestamp = event.timestamp;
    }
    if (typeof event.id === "string" && UUID.test(event.id)) result.eventId = event.id;
    if (typeof event.parentId === "string" && UUID.test(event.parentId)) result.parentEventId = event.parentId;
    // agentId is documented as an opaque string, so it is intentionally not exported.
    return result;
}

/** Build the real SDK canvas declaration with injectable SDK constructors for synthetic tests. */
export function createProbe(createCanvas, CanvasError) {
    let session;
    let unsubscribe;
    let disposed = false;
    const instances = new Map();
    const fail = (code, message) => { throw new CanvasError(code, message); };
    const validate = (ctx, input = false) => {
        if (disposed) fail("probe_disposed", "Provider is closed");
        if (!session) fail("probe_not_ready", "Joined session is not ready");
        if (ctx?.sessionId !== session.sessionId) fail("probe_session_mismatch", "Exact joined session required");
        if (ctx.canvasId !== CANVAS_ID || !INSTANCE_ID.test(ctx.instanceId ?? "") ||
            typeof ctx.extensionId !== "string" || ctx.extensionId.length === 0 || ctx.extensionId.length > 256) {
            fail("probe_context_invalid", "Invalid canvas context");
        }
        if (input && ctx.input !== undefined &&
            (ctx.input === null || typeof ctx.input !== "object" || Array.isArray(ctx.input) ||
                Object.getOwnPropertyNames(ctx.input).length !== 0)) {
            fail("probe_input_invalid", "Only an empty object or omitted input is supported");
        }
        const entry = instances.get(ctx.instanceId);
        if (entry && entry.extensionId !== ctx.extensionId) {
            fail("probe_provider_mismatch", "Instance belongs to another provider");
        }
        return entry;
    };
    const subscribe = () => {
        if (!unsubscribe) unsubscribe = session.on((event) => {
            const metadata = sanitizeEvent(event);
            if (!metadata || disposed) return;
            for (const entry of instances.values()) {
                if (entry.events.some((item) => metadata.eventId && item.eventId === metadata.eventId)) continue;
                entry.events.push(metadata);
                if (entry.events.length > 32) entry.events.shift();
            }
        });
    };
    const closeEntry = async (entry) => {
        const hosted = await entry.ready;
        hosted.server.closeAllConnections();
        await new Promise((resolve, reject) => hosted.server.close((error) => error ? reject(error) : resolve()));
        entry.events.length = 0;
    };
    const close = async (ctx) => {
        const entry = validate(ctx);
        if (!entry) return;
        instances.delete(ctx.instanceId);
        if (instances.size === 0 && unsubscribe) { unsubscribe(); unsubscribe = undefined; }
        await closeEntry(entry);
    };
    const canvas = createCanvas({
        id: CANVAS_ID,
        displayName: "Canvas 173 feasibility probe",
        description: "Synthetic read-only probe of exact joined-session metadata; native embedding remains gated.",
        inputSchema: EMPTY_INPUT,
        open: async (ctx) => {
            let entry = validate(ctx, true);
            if (!entry) {
                if (instances.size >= 4) fail("probe_instance_limit", "At most four instances are supported");
                entry = { extensionId: ctx.extensionId, events: [], ready: undefined };
                instances.set(ctx.instanceId, entry);
                entry.ready = startServer();
                try { subscribe(); } catch {
                    instances.delete(ctx.instanceId);
                    await closeEntry(entry);
                    fail("probe_subscription_failed", "Session event subscription failed");
                }
            }
            try {
                const hosted = await entry.ready;
                if (disposed || instances.get(ctx.instanceId) !== entry) {
                    fail("probe_closed", "Instance closed while opening");
                }
                return { title: "Canvas 173 (embedding gated)", url: hosted.url };
            } catch (error) {
                if (instances.get(ctx.instanceId) === entry) instances.delete(ctx.instanceId);
                if (instances.size === 0 && unsubscribe) { unsubscribe(); unsubscribe = undefined; }
                if (error instanceof CanvasError) throw error;
                fail("probe_open_failed", "Loopback server could not start");
            }
        },
        actions: [{
            name: "snapshot",
            description: "Return at most 32 sanitized event envelopes for this exact joined session and open instance.",
            inputSchema: EMPTY_INPUT,
            handler: (ctx) => {
                const entry = validate(ctx, true);
                if (ctx.actionName !== "snapshot") fail("probe_action_unknown", "Unknown action");
                if (!entry) fail("probe_instance_missing", "Open the instance first");
                return {
                    joinedSessionId: session.sessionId,
                    selectedProjectRoot: { status: "unavailable", reason: "Working directory is not selected-project root authority" },
                    sessionArtifactWorkspaceAvailable: typeof session.workspacePath === "string",
                    activeWorkingDirectoryAvailable: typeof ctx.session?.workingDirectory === "string",
                    model: { status: "unavailable" },
                    contextUsage: { status: "unavailable" },
                    replay: "unproven; subscription only, no history reads",
                    events: entry.events.map((event) => ({ ...event })),
                };
            },
        }],
        onClose: close,
    });
    return {
        canvas,
        bind(joinedSession) {
            if (session || disposed || typeof joinedSession?.sessionId !== "string" ||
                !INSTANCE_ID.test(joinedSession.sessionId) || typeof joinedSession.on !== "function") {
                fail("probe_binding_invalid", "A single valid joined session is required");
            }
            session = joinedSession;
        },
        async dispose() {
            if (disposed) return;
            disposed = true;
            if (unsubscribe) { unsubscribe(); unsubscribe = undefined; }
            const entries = [...instances.values()];
            instances.clear();
            await Promise.all(entries.map(closeEntry));
            session = undefined;
        },
    };
}

/** Serve only a static synthetic page under a per-instance capability, with framing denied. */
async function startServer() {
    const secret = randomBytes(32).toString("base64url");
    const path = `/${secret}/`;
    let host;
    const server = createServer((req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Content-Security-Policy", "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        const end = (status, message) => { res.writeHead(status); res.end(message); };
        if (req.method !== "GET") return end(405, "Method not allowed");
        if (req.headers.host !== host || (req.headers.origin !== undefined && req.headers.origin !== `http://${host}`)) {
            return end(403, "Forbidden");
        }
        // Compare the entire request target: no alternate routes, query parameters or absolute URLs.
        const got = Buffer.from(req.url ?? "");
        const expected = Buffer.from(path);
        if (got.length !== expected.length || !timingSafeEqual(got, expected)) return end(403, "Forbidden");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        end(200, HTML);
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.maxConnections = 8;
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    host = `127.0.0.1:${server.address().port}`;
    return { server, url: `http://${host}${path}` };
}
