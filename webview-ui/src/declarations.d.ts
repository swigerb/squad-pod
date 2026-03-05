// VS Code Webview API type declarations
declare module 'vscode-webview' {
  export interface WebviewApi<StateType> {
    postMessage(message: unknown): void;
    getState(): StateType | undefined;
    setState<T extends StateType>(newState: T): T;
  }
}

declare function acquireVsCodeApi<StateType = unknown>(): import('vscode-webview').WebviewApi<StateType>;

// CSS module declarations
declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}
