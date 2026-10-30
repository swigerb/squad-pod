/**
 * extension.ts — Squad Pod VS Code extension entry point.
 *
 * Registers the webview panel view provider and commands.
 */

import * as vscode from 'vscode';
import { SquadPodViewProvider } from './SquadPodViewProvider.js';
import { VIEW_ID, COMMAND_SHOW_PANEL, COMMAND_EXPORT_DEFAULT_LAYOUT, CONFIG_KEY_AUTO_SHOW_PANEL } from './constants.js';

let providerInstance: SquadPodViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  const provider = new SquadPodViewProvider(context);
  providerInstance = provider;

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_SHOW_PANEL, () => provider.showPanel()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_EXPORT_DEFAULT_LAYOUT, () => {
      provider.exportDefaultLayout();
    }),
  );

  if (vscode.workspace.getConfiguration().get<boolean>(CONFIG_KEY_AUTO_SHOW_PANEL, false)) {
    // View resolution can wait for activation; don't await focus here.
    void provider.showPanel().catch((error: unknown) => {
      void vscode.window.showErrorMessage(`Squad Pod could not show panel: ${String(error)}`);
    });
  }
}

export function deactivate() {
  providerInstance?.dispose();
}
