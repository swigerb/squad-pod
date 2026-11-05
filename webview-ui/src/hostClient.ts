import type { WebviewApi } from "vscode-webview";
import type { OutboundMessage } from "../../src/types.js";
import type { HostClient } from "../../src/core/officeChannel.js";
import { VSCODE_HOST_CAPABILITIES } from "../../src/core/hostCapabilities.js";
export type { HostClient, HostAction, HostCapabilities } from "../../src/core/officeChannel.js";

type MessageTarget = Pick<Window, "addEventListener" | "removeEventListener">;

export function createVSCodeClient(
  acquireApi: () => WebviewApi<unknown>,
  target: MessageTarget,
): HostClient {
  const api = acquireApi();

  return {
    capabilities: VSCODE_HOST_CAPABILITIES,
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

let defaultHost: ReturnType<typeof createDefaultHostClient> | undefined;
export function getDefaultHost() {
  return defaultHost ??= createDefaultHostClient();
}
