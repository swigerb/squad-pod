import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostClientProvider } from '../HostClientContext.js';
import { createHostClientFixture } from '../__tests__/hostClientFixture.js';
import { OfficeState } from '../office/engine/officeState.js';
import * as assetLoader from '../office/sprites/assetLoader.js';
import { useExtensionMessages } from './useExtensionMessages.js';
import type { OutboundMessage } from '../../../src/types.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => vi.restoreAllMocks());

describe('office hook initialization lifetime', () => {
  it.each(['construction', 'send'] as const)('cleans up failed diagnostic %s and fences retained delivery', phase => {
    const client = createHostClientFixture();
    const office = new OfficeState();
    const getOffice = () => office;
    const observe = vi.spyOn(office, 'setObservedTasks');
    let retained: ((message: OutboundMessage) => void) | undefined;
    const lateMessage: OutboundMessage = {
      type: 'observedTasks', snapshot: { tasks: [], sessionId: null, limited: false },
    };
    const unsubscribe = vi.fn(() => retained?.(lateMessage));
    vi.mocked(client.subscribe).mockImplementation(listener => {
      retained = listener;
      client.events.push('subscribe');
      return unsubscribe;
    });
    const failure = new Error(`diagnostic ${phase}`);
    if (phase === 'construction') {
      vi.spyOn(assetLoader, 'getFullDiagnosticReport').mockImplementation(() => { throw failure; });
    } else {
      vi.mocked(client.send).mockImplementation(message => {
        if (message.type === 'diagnosticReport') throw failure;
        client.events.push(`send:${message.type}`);
      });
    }
    function Probe() {
      useExtensionMessages(getOffice);
      return null;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      expect(() => act(() => root.render(
        <HostClientProvider client={client}><Probe /></HostClientProvider>,
      ))).toThrow(failure);
      expect(client.events.slice(0, 2)).toEqual(['subscribe', 'send:webviewReady']);
      expect(unsubscribe).toHaveBeenCalledOnce();
      retained?.(lateMessage);
      expect(observe).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
    }
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
