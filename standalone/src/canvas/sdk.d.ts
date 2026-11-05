/** Host-injected experimental SDK contract (public v1.0.28 surface only). */
declare module '@github/copilot-sdk/extension' {
  export interface CanvasContext {
    sessionId: string; extensionId: string; canvasId: string; instanceId: string;
    input?: unknown; actionName?: string;
  }
  export interface JoinedSession {
    sessionId: string;
    rpc?: { metadata?: { snapshot(): Promise<unknown> } };
    on(handler: (event: { type: string; id?: string; agentId?: string; timestamp?: string; data?: unknown }) => void): () => void;
  }
  export interface CanvasDefinition {
    id: string; displayName: string; description: string; inputSchema: object;
    open(ctx: CanvasContext): Promise<{ title: string; url: string }>;
    onClose(ctx: CanvasContext): Promise<void>;
    actions: Array<{
      name: string; description: string; inputSchema: object;
      handler(ctx: CanvasContext): Promise<unknown>;
    }>;
  }
  export class CanvasError extends Error { constructor(code: string, message: string); }
  export function createCanvas(definition: CanvasDefinition): CanvasDefinition;
  export function joinSession(options: { canvases: CanvasDefinition[] }): Promise<JoinedSession>;
}
