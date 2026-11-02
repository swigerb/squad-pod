import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CANVAS_ID = "squad-pod-canvas-173";
const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set(["session.start", "session.resume", "session.idle", "assistant.turn_start"]);
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
    let providerId;
    let disposed = false;
    const instances = new Map();
    const fail = (code, message) => { throw new CanvasError(code, message); };
    const validate = (ctx) => {
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
        } catch { fail("probe_root_unavailable", "Explicit local directories and active session context are required"); }
        if (!sameDirectory(selected, active)) fail("probe_root_mismatch", "Exact active directory match required");
        if (bound && !sameDirectory(selected, bound)) fail("probe_root_changed", "Instance root binding has changed; close before replacement");
        return selected;
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
            if (!entry) {
                if (instances.size >= 4) fail("probe_instance_limit", "At most four instances are supported");
                providerId ??= ctx.extensionId;
                entry = { extensionId: ctx.extensionId, selectedPath, root, events: [], ready: undefined };
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
                entry.hosted = hosted;
                return { title: "Canvas 173 (synthetic root bound)", url: hosted.url };
            } catch (error) {
                if (instances.get(ctx.instanceId) === entry) instances.delete(ctx.instanceId);
                if (instances.size === 0 && unsubscribe) { unsubscribe(); unsubscribe = undefined; }
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
