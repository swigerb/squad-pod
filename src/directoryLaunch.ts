import * as fs from 'fs';
import * as path from 'path';
import { validateDirectoryName, validateDirectoryPath } from './directories.js';

export const SQUAD_CLI_COMMAND = 'copilot --agent squad';

export interface SquadTerminal {
  show(): void;
  sendText(text: string, addNewLine?: boolean): void;
}

export interface SquadLaunchHost {
  isTrusted: boolean;
  createTerminal(name: string, cwd: string): SquadTerminal;
}

export function findCopilotExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const searchPath = env.PATH ?? '';
  const directories = searchPath.split(path.delimiter).filter(Boolean);
  const extensions = platform === 'win32'
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `copilot${extension}`);
      try {
        fs.accessSync(candidate, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) { return candidate; }
      } catch {
        // Continue through PATH; the caller reports a missing CLI explicitly.
      }
    }
  }
  return null;
}

export function launchSquadInTerminal(
  name: unknown,
  directoryPath: unknown,
  host: SquadLaunchHost,
  hasCopilot: () => boolean = () => findCopilotExecutable() !== null,
): string {
  if (!host.isTrusted) {
    throw new Error('Trust this VS Code workspace before launching Squad.');
  }
  const validName = validateDirectoryName(name);
  const cwd = validateDirectoryPath(directoryPath);
  if (!hasCopilot()) {
    throw new Error('The Copilot CLI executable was not found on PATH. Install or enable `copilot` and try again.');
  }

  const terminal = host.createTerminal(`Squad: ${validName}`, cwd);
  terminal.show();
  terminal.sendText(SQUAD_CLI_COMMAND, true);
  return cwd;
}
