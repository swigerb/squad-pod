import { describe, expect, it, vi } from "vitest";
import type { WebviewApi } from "vscode-webview";
import type { WebviewMessage } from "../../src/types.js";
import { createDefaultHostClient, createVSCodeClient } from "./hostClient.js";

describe("VS Code host client adapter", () => {
  it("acquires the API once and preserves typed sends and recovery state behavior", () => {
    let storedState: unknown = { recovery: "existing" };
    let failWrite = false;
    const api: WebviewApi<unknown> = {
      postMessage: vi.fn(),
      getState<T>(): T | undefined {
        return storedState as T | undefined;
      },
      setState<T>(state: T): T {
        if (failWrite) throw new Error("state quota");
        storedState = state;
        return state;
      },
    };
    const acquireApi = vi.fn(() => api);
    const client = createVSCodeClient(acquireApi, new EventTarget());
    const message: WebviewMessage = { type: "setShowAreas", enabled: true };

    client.send(message);
    expect(acquireApi).toHaveBeenCalledOnce();
    expect(api.postMessage).toHaveBeenCalledWith(message);
    expect(client.getState()).toEqual({ recovery: "existing" });
    const newState = { recovery: "updated" };
    expect(client.setState(newState)).toBe(newState);
    expect(client.getState()).toBe(newState);

    failWrite = true;
    expect(() => client.setState({ recovery: "must-not-be-silently-dropped" })).toThrow("state quota");
    expect(storedState).toBe(newState);
  });

  it("delivers messages only while subscribed and disposes idempotently", () => {
    const target = new EventTarget();
    const api: WebviewApi<unknown> = {
      postMessage() {},
      getState<T>(): T | undefined {
        return undefined;
      },
      setState<T>(state: T): T {
        return state;
      },
    };
    const client = createVSCodeClient(() => api, target);
    const listener = vi.fn();
    const dispose = client.subscribe(listener);
    const event = () => target.dispatchEvent(new MessageEvent("message", {
      data: { type: "settingsLoaded", soundEnabled: true, debugEnabled: false, showAreas: true },
    }));

    event();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "settingsLoaded", soundEnabled: true, debugEnabled: false, showAreas: true,
    });

    dispose();
    dispose();
    event();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reports an absent adapter and captures acquisition failures without substituting a client", () => {
    expect(createDefaultHostClient(null)).toEqual({ client: null, error: null });
    const failed = createDefaultHostClient(() => {
      throw new Error("API acquisition failed");
    }, new EventTarget());
    expect(failed.client).toBeNull();
    expect(failed.error).toBe("Error: API acquisition failed");
  });
});
