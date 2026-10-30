import { vi } from "vitest";
import type { OutboundMessage } from "../../../src/types.js";
import type { HostClient } from "../hostClient.js";

export type HostClientFixture = HostClient & {
  events: string[];
  emit(message: OutboundMessage): void;
};

export function createHostClientFixture(): HostClientFixture {
  const listeners = new Set<(message: OutboundMessage) => void>();
  const events: string[] = [];
  return {
    events,
    send: vi.fn((message) => {
      events.push(`send:${message.type}`);
    }),
    subscribe: vi.fn((listener) => {
      events.push("subscribe");
      listeners.add(listener);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        listeners.delete(listener);
      };
    }),
    getState: vi.fn(() => undefined),
    setState<T>(state: T): T {
      return state;
    },
    emit(message) {
      listeners.forEach((listener) => listener(message));
    },
  };
}
