import type { LayoutData } from '../types.js';

/** Optional joined-session bridge; availability is not native acceptance. */
export interface CanvasHostBridge {
  charter: boolean;
  usage: boolean;
  export: boolean;
  openCharter(slug: string): Promise<void>;
  getUsage(): Promise<CanvasUsageQuantity[]>;
  exportLayout(content: string): Promise<string>;
  importLayout(path: string): Promise<LayoutData>;
}

export interface CanvasUsageQuantity {
  label: string;
  value: number;
  unit: string;
}

export type CanvasHostRequest =
  | { operation: 'capabilities' | 'usage' }
  | { operation: 'charter'; slug: string }
  | { operation: 'export'; content: string }
  | { operation: 'import'; path: string };

export type CanvasHostResult = {
  ok: true;
  capabilities?: { charter: boolean; usage: boolean; export: boolean };
  quantities?: CanvasUsageQuantity[];
  layout?: LayoutData;
  path?: string;
} | { ok: false; reason: string };
