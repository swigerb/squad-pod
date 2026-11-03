import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CANVAS_ID = "squad-pod-canvas-173";
const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set(["session.start", "session.resume", "session.idle", "assistant.turn_start",
    "tool.execution_start", "tool.execution_complete"]);
const EVENT_LIMIT = 32;
const ALIAS_LIMIT = 128;
const ID_LIMIT = 256;
const METADATA_LIMIT = 4;
const METADATA_DEADLINE_MS = 1000;
const EMPTY_INPUT = { type: "object", properties: {}, additionalProperties: false };
const OPEN_INPUT = {
    type: "object", properties: { syntheticProjectRoot: { type: "string", minLength: 1, maxLength: 4096 } },
    required: ["syntheticProjectRoot"], additionalProperties: false,
};
const HTML = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Canvas 173 probe</title><h1>Canvas 173: synthetic read-only UI</h1><p>No prompts, tool results, account data, or unrelated project file contents are read. Only explicit directory metadata and bounded own-provider artifacts are checked.</p><p>Security headers remain unchanged. The original probe rendered in one native host; universal embedding behavior remains unproven. Use the snapshot canvas action for bounded metadata.</p></html>';

const OWN_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SOURCE_CAP = 256 * 1024;
const MANIFEST_CAP = 16 * 1024;
const normalized = (path) => process.platform === "win32" ? path.toLowerCase() : path;
const sameMetadata = (a, b) => a.ino === b.ino &&
    a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const sameFile = (a, b) => a.dev === b.dev && sameMetadata(a, b);
// Windows Node 24 pathname stats can report dev=0 while handle stats report the volume.
// Keep strict device checks within each stat family and require a nonzero shared file ID.
const sameOpenedFile = (pathStat, handleStat) => pathStat.ino !== 0n &&
    (pathStat.dev === handleStat.dev || (process.platform === "win32" && pathStat.dev === 0n)) &&
    sameMetadata(pathStat, handleStat);
const unavailable = (reason) => ({ status: "unavailable", reason });
function artifactError(error) {
    if (error?.code === "ENOENT") return unavailable("missing");
    if (error?.code === "ELOOP") return unavailable("link");
    const reasons = { EACCES: "permission-denied", EPERM: "permission-denied", EIO: "io-error",
        EMFILE: "resource-limit", ENFILE: "resource-limit", ENOTDIR: "not-directory" };
    const reason = Object.hasOwn(reasons, error?.code) ? reasons[error.code] : undefined;
    return { status: "error", reason: reason ?? "unexpected-error" };
}

// Fixed module-relative paths only. Never accept a path/URL from canvas input or createProbe.
function readOwnArtifact(path, cap, manifest = false) {
    let fd;
    let result;
    const observe = () => {
        const directory = dirname(path);
        // Reject ancestor junctions/symlinks too, without walking or searching ancestors.
        if (normalized(realpathSync.native(directory)) !== normalized(resolve(directory))) return unavailable("link");
        const before = lstatSync(path, { bigint: true });
        if (before.isSymbolicLink()) return unavailable("link");
        if (!before.isFile()) return unavailable("not-regular");
        if (before.nlink !== 1n) return unavailable("link");
        if (before.size > BigInt(cap)) return unavailable("too-large");
        fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        const opened = fstatSync(fd, { bigint: true });
        if (!opened.isFile() || opened.nlink !== 1n || !sameOpenedFile(before, opened)) return unavailable("changed");
        if (normalized(realpathSync.native(directory)) !== normalized(resolve(directory))) return unavailable("link");
        const bytes = Buffer.alloc(cap + 1);
        let length = 0;
        while (length < bytes.length) {
            const count = readSync(fd, bytes, length, bytes.length - length, length);
            if (count === 0) break;
            length += count;
        }
        if (length > cap) return unavailable("too-large");
        const after = lstatSync(path, { bigint: true });
        if (!sameFile(opened, fstatSync(fd, { bigint: true })) || !sameFile(before, after) ||
            !sameOpenedFile(after, opened) ||
            after.isSymbolicLink() || after.nlink !== 1n || BigInt(length) !== opened.size ||
            normalized(realpathSync.native(directory)) !== normalized(resolve(directory))) return unavailable("changed");
        const content = bytes.subarray(0, length);
        const result = { status: "available", sha256: createHash("sha256").update(content).digest("hex"), sizeBytes: length };
        if (manifest) {
            let parsed;
            try { parsed = JSON.parse(content.toString("utf8")); }
            catch { result.version = unavailable("malformed-manifest"); }
            if (!result.version) {
                const version = parsed?.version;
                result.version = typeof version === "string" && version.length <= 64 && !/[^0-9A-Za-z.+-]/.test(version) &&
                    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version)
                    ? { status: "available", value: version } : unavailable("invalid-or-missing-version");
            }
        }
        return result;
    };
    try {
        result = observe();
    } catch (error) {
        result = artifactError(error);
    } finally {
        if (fd !== undefined) {
            try { closeSync(fd); } catch (error) { result = artifactError(error); }
        }
    }
    return result;
}

function artifactProvenance() {
    // Package root is exactly ../../../ from com.github.copilot/extensions/canvas-173.
    // A project-local .github/extensions/canvas-173 must never inspect repository plugin.json.
    const extensions = dirname(OWN_DIRECTORY);
    const namespace = dirname(extensions);
    const packaged = basename(OWN_DIRECTORY) === "canvas-173" && basename(extensions) === "extensions" &&
        basename(namespace) === "com.github.copilot";
    return {
        scope: "own-artifacts-at-observation-time",
        limitation: "On-disk bytes, not immutable in-memory code or source-commit proof; concurrent privileged substitution cannot be excluded.",
        maxArtifactBytes: { source: SOURCE_CAP, manifest: MANIFEST_CAP },
        readCapsBytes: { source: SOURCE_CAP + 1, manifest: MANIFEST_CAP + 1 },
        artifacts: {
            "extension.mjs": readOwnArtifact(join(OWN_DIRECTORY, "extension.mjs"), SOURCE_CAP),
            "probe.mjs": readOwnArtifact(join(OWN_DIRECTORY, "probe.mjs"), SOURCE_CAP),
            "plugin.json": packaged ? readOwnArtifact(join(dirname(namespace), "plugin.json"), MANIFEST_CAP, true)
                : unavailable("unsupported-layout"),
        },
    };
}

// Metadata only, on these explicit paths: no content reads, discovery, cwd or workspace fallback.
function directoryIdentity(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 4096 ||
        /[\x00-\x1f\x7f]/.test(value) || !isAbsolute(value) ||
        (process.platform === "win32" && (!/^[A-Za-z]:[\\/]/.test(value) || value.slice(2).includes(":"))) ||
        (process.platform !== "win32" && value.startsWith("//"))) throw new Error("invalid");
    const canonical = realpathSync.native(value);
    if (process.platform === "win32" && !/^[A-Za-z]:[\\/]/.test(canonical)) throw new Error("nonlocal");
    const stat = statSync(canonical, { bigint: true });
    if (!stat.isDirectory()) throw new Error("not directory");
    return { canonical: process.platform === "win32" ? canonical.toLowerCase() : canonical, dev: stat.dev, ino: stat.ino };
}
const sameDirectory = (a, b) => a.canonical === b.canonical && a.dev === b.dev && a.ino === b.ino;

function runtimeProvenance() {
    const available = (value, valid) => valid ? { status: "available", value } : { status: "unavailable" };
    return {
        scope: "extension-process",
        node: available(process.version, /^v\d+\.\d+\.\d+$/.test(process.version)),
        platform: available(process.platform, ["win32", "linux", "darwin", "aix", "freebsd", "openbsd", "sunos", "android", "netbsd"].includes(process.platform)),
        arch: available(process.arch, ["arm", "arm64", "ia32", "loong64", "mips", "mipsel", "ppc", "ppc64", "riscv64", "s390", "s390x", "x64"].includes(process.arch)),
        sdkVersion: { status: "unavailable" },
        appVersion: { status: "unavailable" },
    };
}

function observation() {
    return { generation: randomBytes(16).toString("hex"), events: [], aliases: new Map(),
        nextAlias: 0, accepted: 0, ignored: 0, eventEvictions: 0, aliasEvictions: 0 };
}
function alias(state, kind, value, uuid = false) {
    if (value === undefined) return unavailable("missing");
    if (typeof value !== "string" || value.length === 0 || value.length > ID_LIMIT ||
        (uuid && !UUID.test(value))) return unavailable("invalid-or-oversized");
    const key = `${kind}:${value}`;
    if (!state.aliases.has(key)) {
        if (state.aliases.size === ALIAS_LIMIT) {
            state.aliases.delete(state.aliases.keys().next().value);
            state.aliasEvictions++;
        }
        state.aliases.set(key, `${state.generation}-${kind}-${++state.nextAlias}`);
    }
    return { status: "available", alias: state.aliases.get(key) };
}
function producerTime(value) {
    if (value === undefined) return unavailable("missing");
    // Validate a bounded UTC ISO subset without retaining producer-controlled strings.
    if (typeof value !== "string" || value.length > 24 ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) {
        return unavailable("invalid-or-unsupported-format");
    }
    const time = Date.parse(value);
    const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction = "") => `.${fraction.padEnd(3, "0")}Z`);
    return Number.isFinite(time) && new Date(time).toISOString() === canonical
        ? { status: "valid" } : unavailable("invalid-or-unsupported-format");
}

/** Project public v1.0.28 envelopes and toolCallId only; raw values never leave volatile state. */
export function sanitizeEvent(event, state = observation()) {
    if (!event || !EVENT_TYPES.has(event.type)) return undefined;
    return {
        type: event.type,
        event: alias(state, "event", event.id, true),
        previousEvent: event.parentId === null ? { status: "none" } : alias(state, "event", event.parentId, true),
        actor: alias(state, "actor", event.agentId),
        toolCall: event.type.startsWith("tool.execution_")
            ? alias(state, "tool", event.data?.toolCallId) : unavailable("not-applicable"),
        receiptTime: { status: "valid", unixMs: Date.now() },
        producerTime: producerTime(event.timestamp),
    };
}

/** Build the real SDK canvas declaration with injectable SDK constructors for synthetic tests. */
export function createProbe(createCanvas, CanvasError) {
    let session;
    let providerId;
    let disposed = false;
    let cleanupFailed = false;
    let metadataInFlight = 0;
    const instances = new Map();
    const fail = (code, message) => { throw new CanvasError(code, message); };
    const requireCleanup = () => {
        if (cleanupFailed) fail("probe_cleanup_failed", "Observation cleanup failed; provider lifetime is closed");
    };
    const releaseAll = (subscriptions) => {
        for (const unsubscribe of subscriptions) {
            try { unsubscribe?.(); }
            catch {
                cleanupFailed = true;
                // Latch failure before draining other owners; never retry the failed unsubscribe.
                subscriptions.push(...[...instances.values()].map(revoke));
            }
        }
        return !cleanupFailed;
    };
    const release = (unsubscribe) => releaseAll([unsubscribe]);
    const revoke = (entry) => {
        const state = entry.observation;
        entry.observation = undefined;
        if (!state) return;
        state.events.length = 0;
        state.aliases.clear();
        state.nextAlias = state.accepted = state.ignored = state.eventEvictions = state.aliasEvictions = 0;
        const unsubscribe = state.unsubscribe;
        state.unsubscribe = undefined;
        return unsubscribe;
    };
    const revokeAll = () => {
        // Clear all authority before calling upstream code, which may be reentrant.
        const subscriptions = [...instances.values()].map(revoke);
        return releaseAll(subscriptions);
    };
    const validate = (ctx, closing = false) => {
        if (!closing) requireCleanup();
        if (disposed) fail("probe_disposed", "Provider is closed");
        if (!session) fail("probe_not_ready", "Joined session is not ready");
        if (ctx?.sessionId !== session.sessionId) fail("probe_session_mismatch", "Exact joined session required");
        if (ctx.canvasId !== CANVAS_ID || typeof ctx.instanceId !== "string" || !INSTANCE_ID.test(ctx.instanceId) ||
            typeof ctx.extensionId !== "string" || ctx.extensionId.length === 0 || ctx.extensionId.length > 256) {
            fail("probe_context_invalid", "Invalid canvas context");
        }
        const entry = instances.get(ctx.instanceId);
        if ((providerId && providerId !== ctx.extensionId) || (entry && entry.extensionId !== ctx.extensionId)) {
            fail("probe_provider_mismatch", "Instance belongs to another provider");
        }
        return entry;
    };
    const bindRoot = (ctx, selectedPath, bound) => {
        let selected;
        let active;
        try {
            selected = directoryIdentity(selectedPath);
            active = directoryIdentity(ctx.session?.workingDirectory);
        } catch { revokeAll(); requireCleanup(); fail("probe_root_unavailable", "Explicit local directories and active session context are required"); }
        if (!sameDirectory(selected, active)) { revokeAll(); requireCleanup(); fail("probe_root_mismatch", "Exact active directory match required"); }
        if (bound && !sameDirectory(selected, bound)) { revokeAll(); requireCleanup(); fail("probe_root_changed", "Instance root binding has changed; close before replacement"); }
        return selected;
    };
    const subscribe = (entry) => {
        requireCleanup();
        if (entry.observation) return;
        const state = observation();
        entry.observation = state;
        try {
            const unsubscribe = session.on((event) => {
                if (disposed || cleanupFailed || entry.observation !== state) return;
                if (event?.type === "session.context_changed") { revokeAll(); requireCleanup(); return; }
                if (!state.authorized) return;
                const metadata = sanitizeEvent(event, state);
                if (!metadata) { state.ignored++; return; }
                state.accepted++;
                state.events.push(metadata);
                if (state.events.length > EVENT_LIMIT) { state.events.shift(); state.eventEvictions++; }
            });
            if (typeof unsubscribe !== "function") throw new Error("invalid subscription");
            if (entry.observation === state) state.unsubscribe = unsubscribe;
            else release(unsubscribe); // A synchronous context event can revoke during registration.
            requireCleanup();
        } catch {
            release(revoke(entry));
            requireCleanup();
            fail("probe_subscription_failed", "Session event subscription failed");
        }
    };
    const requireObservation = (entry) => {
        if (!entry.observation) {
            fail("probe_observation_revoked", "Observation revoked; a new matching open callback is required");
        }
        return entry.observation;
    };
    const authorize = async (ctx, entry, state) => {
        let timer;
        let result;
        try {
            const metadata = session.rpc?.metadata;
            if (typeof metadata?.snapshot !== "function") result = { code: "probe_metadata_missing" };
            else if (metadataInFlight >= METADATA_LIMIT) result = { code: "probe_metadata_limit" };
            else {
                metadataInFlight++;
                // A timed-out RPC still occupies its slot until it settles; no cancellation or retry is assumed.
                const request = Promise.resolve().then(() => metadata.snapshot()).then(
                    (value) => ({ value }), () => ({ code: "probe_metadata_rejected" }),
                ).finally(() => { metadataInFlight--; });
                result = await Promise.race([request, new Promise((resolve) => {
                    timer = setTimeout(() => resolve({ code: "probe_metadata_deadline" }), METADATA_DEADLINE_MS);
                })]);
            }
        } catch { result = { code: "probe_metadata_rejected" }; }
        finally { clearTimeout(timer); }
        requireCleanup();
        if (disposed || instances.get(ctx.instanceId) !== entry || entry.observation !== state) {
            fail("probe_closed", "Instance closed while opening");
        }
        let code = result.code;
        if (!code) {
            try {
                const value = result.value;
                if (!value || typeof value !== "object" || Array.isArray(value) ||
                    typeof value.sessionId !== "string" || value.sessionId !== session.sessionId ||
                    value.sessionId !== ctx.sessionId ||
                    !sameDirectory(directoryIdentity(value.workingDirectory), entry.root)) {
                    code = "probe_metadata_mismatch";
                }
            } catch { code = "probe_metadata_mismatch"; }
        }
        if (code) {
            revokeAll();
            requireCleanup();
            fail(code, "Independent session metadata authority unavailable");
        }
        bindRoot(ctx, entry.selectedPath, entry.root);
        state.authorized = true;
    };
    const closeEntry = (entry) => entry.closing ??= (async () => {
        let hosted;
        try { hosted = await entry.ready; } catch { return; }
        hosted.server.closeAllConnections();
        await new Promise((resolve, reject) => hosted.server.close((error) => error ? reject(error) : resolve()));
    })();
    const close = async (ctx) => {
        const entry = validate(ctx, true);
        if (!entry) { requireCleanup(); return; }
        release(revoke(entry));
        instances.delete(ctx.instanceId);
        await closeEntry(entry);
        requireCleanup();
    };
    const canvas = createCanvas({
        id: CANVAS_ID,
        displayName: "Canvas 173 feasibility probe",
        description: "Synthetic read-only probe bound to an explicitly selected root matching the exact joined session active directory.",
        inputSchema: OPEN_INPUT,
        open: async (ctx) => {
            let entry = validate(ctx);
            if (!ctx.input || typeof ctx.input !== "object" || Array.isArray(ctx.input) ||
                Object.getOwnPropertyNames(ctx.input).length !== 1 ||
                !Object.hasOwn(ctx.input, "syntheticProjectRoot")) {
                fail("probe_input_invalid", "Only an explicit syntheticProjectRoot is supported");
            }
            const selectedPath = ctx.input.syntheticProjectRoot;
            if (entry) bindRoot(ctx, entry.selectedPath, entry.root);
            const root = bindRoot(ctx, selectedPath, entry?.root);
            // Replacement revokes even before listener readiness; pending opens own generations too.
            if (entry) release(revoke(entry));
            requireCleanup();
            if (!entry) {
                if (instances.size >= 4) fail("probe_instance_limit", "At most four instances are supported");
                providerId ??= ctx.extensionId;
                entry = { extensionId: ctx.extensionId, selectedPath, root, observation: undefined, ready: undefined };
                instances.set(ctx.instanceId, entry);
                entry.ready = startServer();
            }
            let openingObservation;
            try {
                subscribe(entry);
                openingObservation = requireObservation(entry);
                await authorize(ctx, entry, openingObservation);
                const hosted = await entry.ready;
                requireCleanup();
                if (disposed || instances.get(ctx.instanceId) !== entry || entry.observation !== openingObservation) {
                    fail("probe_closed", "Instance closed while opening");
                }
                entry.hosted = hosted;
                return { title: "Canvas 173 (synthetic root bound)", url: hosted.url };
            } catch (error) {
                if (openingObservation && entry.observation && entry.observation !== openingObservation) throw error;
                release(revoke(entry));
                if (instances.get(ctx.instanceId) === entry) instances.delete(ctx.instanceId);
                await closeEntry(entry);
                requireCleanup();
                if (error instanceof CanvasError) throw error;
                fail("probe_open_failed", "Loopback server could not start");
            }
        },
        actions: [{
            name: "snapshot",
            description: "Return bounded own-artifact provenance and at most 32 sanitized event envelopes for this exact joined session and open instance.",
            inputSchema: EMPTY_INPUT,
            handler: (ctx) => {
                const entry = validate(ctx);
                if (ctx.input !== undefined &&
                    (ctx.input === null || typeof ctx.input !== "object" || Array.isArray(ctx.input) ||
                        Object.getOwnPropertyNames(ctx.input).length !== 0)) {
                    fail("probe_input_invalid", "Only an empty object or omitted action input is supported");
                }
                if (ctx.actionName !== "snapshot") fail("probe_action_unknown", "Unknown action");
                if (!entry) fail("probe_instance_missing", "Open the instance first");
                if (!entry.hosted) fail("probe_instance_not_ready", "Instance is not ready");
                bindRoot(ctx, entry.selectedPath, entry.root);
                const state = requireObservation(entry);
                if (!state.authorized) fail("probe_observation_revoked", "Independent session metadata authority pending");
                return {
                    exactJoinedSession: true,
                    selectedProjectRoot: { status: "matched", scope: "explicit-synthetic-root-equality-only" },
                    sessionArtifactWorkspaceAvailable: typeof session.workspacePath === "string",
                    activeWorkingDirectoryAvailable: true,
                    runtime: runtimeProvenance(),
                    artifactProvenance: artifactProvenance(),
                    listener: { scope: "this-instance", transport: "ipv4-loopback", port: entry.hosted.port },
                    model: { status: "unavailable" },
                    contextUsage: { status: "unavailable" },
                    replay: "unproven; subscription only, no history reads",
                    observation: {
                        generation: state.generation, scope: "this-instance-live-subscription-only",
                        limits: { events: EVENT_LIMIT, aliases: ALIAS_LIMIT, idCharacters: ID_LIMIT },
                        accepted: state.accepted, ignored: state.ignored, retained: state.events.length,
                        eventEvictions: state.eventEvictions, aliasEvictions: state.aliasEvictions,
                        retainedAliases: state.aliases.size,
                        previousEventMeaning: "chronologically-previous-event; not agent hierarchy",
                        correlation: "volatile; evicted IDs receive fresh aliases; no history or completeness claim",
                    },
                    events: structuredClone(state.events),
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
            if (disposed) { requireCleanup(); return; }
            disposed = true;
            revokeAll();
            const entries = [...instances.values()];
            instances.clear();
            const results = await Promise.allSettled(entries.map(closeEntry));
            session = undefined;
            requireCleanup();
            if (results.some((result) => result.status === "rejected")) {
                fail("probe_disposal_failed", "Provider cleanup failed");
            }
        },
    };
}

/** Serve only a static synthetic page under a per-instance capability, preserving restrictive headers. */
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
    return { server, url: `http://${host}${path}`, port: server.address().port };
}
