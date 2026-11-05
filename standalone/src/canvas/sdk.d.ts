/** Host-injected experimental SDK contract; optional runtime methods are capability-gated. */
declare module '@github/copilot-sdk/extension' {
  export interface ToolResultObject {
    textResultForLlm: string;
    resultType: 'success' | 'failure' | 'rejected' | 'denied' | 'timeout';
    binaryResultsForLlm?: Array<{ data: string; mimeType: string; type: 'image' | 'resource'; description?: string }>;
  }
  export interface CanvasContext {
    sessionId: string; extensionId: string; canvasId: string; instanceId: string;
    input?: unknown; actionName?: string;
  }
  export interface JoinedSession {
    sessionId: string;
    rpc?: {
      metadata?: { snapshot(): Promise<unknown> };
      canvas?: {
        list?(): Promise<unknown>;
        open(params: {
          extensionId?: string; canvasId: string; instanceId: string; input: { scope: 'repo'; path: string };
        }): Promise<unknown>;
      };
      usage?: { getMetrics(): Promise<unknown> };
      workspaces?: { createFile(params: { path: string; content: string }): Promise<void> };
    };
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
