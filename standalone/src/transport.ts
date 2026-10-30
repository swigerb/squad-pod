import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import type { OutboundMessage, WebviewMessage } from '../../src/types.js';

export interface TransportOptions {
  port?: number;
  host?: string;
  staticRoot: string;
  snapshot: () => Promise<OutboundMessage[]>;
  subscribe: (listener: (messages: OutboundMessage[]) => void) => () => void;
  onRead?: (message: WebviewMessage) => Promise<OutboundMessage[]>;
}

const MAX_CONNECTIONS = 8;
const MAX_INBOUND = 4096;
const MAX_FRAME = 8 * 1024 * 1024;
const MAX_QUEUE = 16 * 1024 * 1024;
const READ_TIMEOUT = 5000;
const SEND_TIMEOUT = 10_000;
const HEARTBEAT = 15_000;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

function credential(): string {
  return randomBytes(32).toString('base64url');
}

function equalCredential(candidate: string, expected: string): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(candidate), hash(expected));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length
    && expected.every(key => Object.hasOwn(value, key));
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
  let value: string | undefined;
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    if (request.rawHeaders[i].toLowerCase() !== name) { continue; }
    if (value !== undefined) { return undefined; }
    value = request.rawHeaders[i + 1];
  }
  return value;
}

// Cache the indexed bundle, not paths: later symlink/file replacements cannot expose the project.
async function indexStatic(root: string): Promise<Map<string, { bytes: Buffer; mime: string }>> {
  const files = new Map<string, { bytes: Buffer; mime: string }>();
  const absolute = resolve(root);
  if (!(await lstat(absolute)).isDirectory() || (await lstat(absolute)).isSymbolicLink()) {
    throw new Error('Static root must be a regular directory');
  }
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) { continue; }
      const path = join(directory, entry.name);
      const url = `${prefix}/${entry.name}`;
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) { continue; }
      if (stat.isDirectory()) {
        await visit(path, url);
      } else if (stat.isFile() && MIME[extname(entry.name).toLowerCase()]) {
        files.set(url, { bytes: await readFile(path), mime: MIME[extname(entry.name).toLowerCase()] });
      }
    }
  }
  await visit(absolute, '');
  if (!files.has('/index.html')) { throw new Error('Static bundle requires index.html'); }
  return files;
}

function staticPath(url: string): string | undefined {
  if (!url.startsWith('/') || url.startsWith('//') || /[?#\\\0]/.test(url)) { return undefined; }
  let path: string;
  try { path = decodeURIComponent(url); } catch { return undefined; }
  if (/[\\\0?#]/.test(path) || path.split('/').some(part => part === '.' || part === '..')) {
    return undefined;
  }
  return path === '/' ? '/index.html' : path;
}

function command(payload: unknown): { message?: WebviewMessage; error?: string } {
  if (!record(payload) || !keys(payload, ['version', 'kind', 'message'])
    || payload.version !== 1 || payload.kind !== 'office' || !record(payload.message)) {
    return { error: 'INVALID_MESSAGE' };
  }
  const message = payload.message;
  if (typeof message.type !== 'string') { return { error: 'INVALID_MESSAGE' }; }
  if (message.type !== 'webviewReady' && message.type !== 'getSettings'
    && message.type !== 'requestAgentDetail') {
    return { error: 'READ_ONLY' };
  }
  if (message.type === 'requestAgentDetail') {
    if (!keys(message, ['type', 'agentId']) || typeof message.agentId !== 'string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(message.agentId)) {
      return { error: 'INVALID_MESSAGE' };
    }
    return { message: { type: 'requestAgentDetail', agentId: message.agentId } };
  }
  if (!keys(message, ['type'])) { return { error: 'INVALID_MESSAGE' }; }
  return { message: { type: message.type } };
}

export async function startTransport(options: TransportOptions): Promise<{
  port: number;
  token: string;
  rotate: () => string;
  dispose: () => Promise<void>;
}> {
  // The browser origin is intentionally canonical; never resolve hostnames or bind all interfaces.
  if (options.host !== undefined && options.host !== '127.0.0.1') {
    throw new Error('Only the 127.0.0.1 loopback listener is supported');
  }
  if (options.port !== undefined
    && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) {
    throw new Error('Invalid port');
  }
  const files = await indexStatic(options.staticRoot);
  let token = credential();
  let session = credential();
  let disposed = false;
  let disposal: Promise<void> | undefined;
  let port = 0;
  const sockets = new Set<Socket>();
  const cleanups = new Map<WebSocket, () => void>();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_INBOUND,
    perMessageDeflate: false,
    clientTracking: true,
  });
  const origin = () => `http://127.0.0.1:${port}`;
  const cookieName = () => `squad_office_${port}`;
  const validHost = (request: IncomingMessage) => {
    const host = singleHeader(request, 'host');
    // URL normalization would also accept alternative numeric IP spellings and userinfo.
    return host === `127.0.0.1:${port}`;
  };
  const validOrigin = (request: IncomingMessage) => singleHeader(request, 'origin') === origin();
  const authenticated = (request: IncomingMessage) => {
    const header = singleHeader(request, 'cookie');
    if (!header || header.length > 4096) { return false; }
    const cookies = header.split(';').map(part => part.trim().split('='));
    const matches = cookies.filter(([name]) => name === cookieName());
    return matches.length === 1 && matches[0].length === 2
      && equalCredential(matches[0][1], session);
  };
  const headers = (response: ServerResponse) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', [
      "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:", "font-src 'self'", "media-src 'self'",
      `connect-src 'self' ws://127.0.0.1:${port}`, "base-uri 'none'",
      "frame-ancestors 'none'", "form-action 'self'", "object-src 'none'",
    ].join('; '));
  };
  const reply = (response: ServerResponse, status: number, code: string) => {
    if (response.writableEnded || response.destroyed) { return; }
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ version: 1, kind: 'error', code }));
  };
  const server = createServer({ maxHeaderSize: MAX_INBOUND }, (request, response) => {
    headers(response);
    if (!validHost(request)) { reply(response, 403, 'FORBIDDEN'); return; }
    if (request.url === '/auth' && request.method === 'POST') {
      if (!validOrigin(request)) { reply(response, 403, 'FORBIDDEN'); return; }
      if (singleHeader(request, 'content-type')?.toLowerCase().split(';')[0].trim() !== 'application/json') {
        reply(response, 415, 'INVALID_MESSAGE'); return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      const timeout = setTimeout(() => {
        reply(response, 408, 'TIMEOUT');
        request.destroy();
      }, READ_TIMEOUT);
      request.once('close', () => clearTimeout(timeout));
      request.on('error', () => clearTimeout(timeout));
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_INBOUND) {
          clearTimeout(timeout);
          reply(response, 413, 'TOO_LARGE');
          response.once('finish', () => request.destroy());
          return;
        }
        chunks.push(chunk);
      });
      request.once('end', () => {
        clearTimeout(timeout);
        if (size > MAX_INBOUND || disposed) { return; }
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { reply(response, 400, 'INVALID_MESSAGE'); return; }
        if (!record(body) || !keys(body, ['token']) || typeof body.token !== 'string'
          || body.token.length > 128 || !equalCredential(body.token, token)) {
          reply(response, 403, 'FORBIDDEN'); return;
        }
        response.setHeader('Set-Cookie', `${cookieName()}=${session}; HttpOnly; SameSite=Strict; Path=/`);
        response.writeHead(204);
        response.end();
      });
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      reply(response, 405, 'METHOD_NOT_ALLOWED'); return;
    }
    const path = staticPath(request.url ?? '');
    const file = path && files.get(path);
    if (!file) { reply(response, 404, 'NOT_FOUND'); return; }
    response.writeHead(200, { 'Content-Type': file.mime, 'Content-Length': file.bytes.length });
    response.end(request.method === 'HEAD' ? undefined : file.bytes);
  });
  server.maxConnections = MAX_CONNECTIONS;
  server.headersTimeout = READ_TIMEOUT;
  server.requestTimeout = READ_TIMEOUT;
  server.keepAliveTimeout = 1000;
  server.setTimeout(SEND_TIMEOUT, socket => socket.destroy());
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('upgrade', (request, socket, head) => {
    if (disposed || request.method !== 'GET' || request.url !== '/office'
      || !validHost(request) || !validOrigin(request) || !authenticated(request)
      || wss.clients.size >= MAX_CONNECTIONS) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    let active = true;
    let ready = false;
    let initializing = false;
    let busy = false;
    let alive = true;
    let faults = 0;
    let windowStart = Date.now();
    let received = 0;
    let queued = 0;
    let pending: string[] = [];
    let unsubscribe: (() => void) | undefined;
    let sendTimer: ReturnType<typeof setTimeout> | undefined;
    let readTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (!active) { return; }
      active = false;
      clearInterval(heartbeat);
      clearTimeout(sendTimer);
      clearTimeout(readTimer);
      pending = [];
      queued = 0;
      cleanups.delete(ws);
      try { unsubscribe?.(); } catch { /* Subscriber teardown must not leak sockets. */ }
    };
    const stop = () => { cleanup(); ws.terminate(); };
    const heartbeat = setInterval(() => {
      if (!alive) { stop(); return; }
      alive = false;
      ws.ping(undefined, undefined, error => { if (error) { stop(); } });
    }, HEARTBEAT);
    heartbeat.unref();
    cleanups.set(ws, cleanup);
    ws.on('close', cleanup);
    ws.on('error', stop);
    ws.on('pong', () => { alive = true; });
    const sendFrame = (frame: string, deferred = false) => {
      if (!active || ws.readyState !== WebSocket.OPEN) { return; }
      const bytes = Buffer.byteLength(frame);
      if (bytes > MAX_FRAME || queued + bytes > MAX_QUEUE || ws.bufferedAmount > MAX_QUEUE) {
        stop(); return;
      }
      queued += bytes;
      if (!sendTimer) {
        sendTimer = setTimeout(stop, SEND_TIMEOUT);
        sendTimer.unref();
      }
      if (deferred) { pending.push(frame); return; }
      ws.send(frame, error => {
        if (!active) { return; }
        queued -= bytes;
        if (error) { stop(); return; }
        if (queued === 0) { clearTimeout(sendTimer); sendTimer = undefined; }
      });
    };
    const error = (code: string) => {
      sendFrame(JSON.stringify({ version: 1, kind: 'error', code }));
      if (++faults >= 8) { stop(); }
    };
    const sendMessages = (messages: OutboundMessage[], deferred = false) => {
      for (const message of messages) {
        if (!active) { break; }
        try { sendFrame(JSON.stringify({ version: 1, kind: 'office', message }), deferred); }
        catch { error('INTERNAL_ERROR'); stop(); break; }
      }
    };
    // One bounded, timed read at a time; no promise chain can accumulate under a command flood.
    const read = async (message: WebviewMessage) => {
      busy = true;
      if (message.type === 'webviewReady') { ready = true; initializing = true; }
      readTimer = setTimeout(() => { error('TIMEOUT'); stop(); }, READ_TIMEOUT);
      readTimer.unref();
      try {
        const messages = await (message.type === 'webviewReady'
          ? options.snapshot()
          : options.onRead?.(message) ?? Promise.resolve([]));
        if (!active) { return; }
        sendMessages(messages);
        if (initializing) {
          initializing = false;
          const events = pending;
          pending = [];
          for (const frame of events) {
            queued -= Buffer.byteLength(frame);
            sendFrame(frame);
          }
        }
      } catch {
        if (active) { error('INTERNAL_ERROR'); stop(); }
      } finally {
        clearTimeout(readTimer);
        busy = false;
      }
    };
    try {
      unsubscribe = options.subscribe(messages => {
        if (ready && active) { sendMessages(messages, initializing); }
      });
    } catch { stop(); return; }
    ws.on('message', (data, binary) => {
      if (!active) { return; }
      const now = Date.now();
      if (now - windowStart >= 1000) { windowStart = now; received = 0; }
      if (++received > 32) { error('RATE_LIMIT'); stop(); return; }
      if (binary) { error('INVALID_MESSAGE'); return; }
      let payload: unknown;
      try { payload = JSON.parse(data.toString()); }
      catch { error('INVALID_MESSAGE'); return; }
      const parsed = command(payload);
      if (!parsed.message) { error(parsed.error!); return; }
      if (busy) { error('BUSY'); return; }
      if (parsed.message.type === 'webviewReady' && ready) { error('ALREADY_READY'); return; }
      if (parsed.message.type !== 'webviewReady' && !ready) { error('NOT_READY'); return; }
      void read(parsed.message);
    });
  });

  try {
    await new Promise<void>((accept, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 0, '127.0.0.1', () => {
        server.off('error', reject);
        accept();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') { throw new Error('Listener has no address'); }
    port = address.port;
  } catch (error) {
    wss.close();
    server.close();
    throw error;
  }
  return {
    port,
    get token() { return token; },
    rotate: () => {
      token = credential();
      session = credential();
      for (const ws of wss.clients) { cleanups.get(ws)?.(); ws.terminate(); }
      return token;
    },
    dispose: () => {
      if (disposal) { return disposal; }
      disposed = true;
      for (const ws of wss.clients) { cleanups.get(ws)?.(); ws.terminate(); }
      disposal = new Promise<void>((accept, reject) => {
        server.close(error => { if (error) { reject(error); } else { accept(); } });
        for (const socket of sockets) { socket.destroy(); }
      }).then(() => new Promise<void>(accept => wss.close(() => accept())));
      return disposal;
    },
  };
}
