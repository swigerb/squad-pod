import type { WebviewApi } from "vscode-webview";
import type { OutboundMessage, WebviewMessage } from "../../src/types.js";

export interface HostClient {
  send(message: WebviewMessage): void;
  subscribe(listener: (message: OutboundMessage) => void): () => void;
  getState(): unknown | undefined;
  setState<T>(state: T): T;
}

type MessageTarget = Pick<Window, "addEventListener" | "removeEventListener">;

export function createVSCodeClient(
  acquireApi: () => WebviewApi<unknown>,
  target: MessageTarget,
): HostClient {
  const api = acquireApi();

  return {
    send(message) {
      api.postMessage(message);
    },
    subscribe(listener) {
      let disposed = false;
      const handleMessage = (event: MessageEvent) => {
        const message = event.data as OutboundMessage | null;
        if (!message || typeof message.type !== "string") return;
        listener(message);
      };
      target.addEventListener("message", handleMessage);
      return () => {
        if (disposed) return;
        disposed = true;
        target.removeEventListener("message", handleMessage);
      };
    },
    getState() {
      return api.getState();
    },
    setState<T>(state: T): T {
      return api.setState(state);
    },
  };
}

export function createDefaultHostClient(
  acquireApi: (() => WebviewApi<unknown>) | null =
    typeof acquireVsCodeApi === "function" ? acquireVsCodeApi : null,
  target?: MessageTarget,
): { client: HostClient | null; error: string | null } {
  if (!acquireApi) return { client: null, error: null };
  try {
    return { client: createVSCodeClient(acquireApi, target ?? window), error: null };
  } catch (error) {
    return { client: null, error: String(error) };
  }
}

const defaultHost = createDefaultHostClient();
export const defaultHostClient = defaultHost.client;
export const defaultHostError = defaultHost.error;
