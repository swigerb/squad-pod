import * as sdk from '@github/copilot-sdk/extension';
import { fileURLToPath } from 'node:url';
import { startOfficeExtension } from './provider.js';

// SDK resolution belongs to the host; this entry never installs or bundles it.
await startOfficeExtension(sdk, {
  staticRoot: fileURLToPath(new URL('./canvas-browser', import.meta.url)),
  bundledAssetsRoot: fileURLToPath(new URL('./assets', import.meta.url)),
});
