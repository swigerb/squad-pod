# Standalone-only terminal notices

This file and `dist/terminal-licenses/` ship only in the private standalone
package, not in the VSIX. The repository's canonical LICENSE and
THIRD_PARTY_NOTICES.md are also copied unchanged into that package.

| Component | Provenance and license payload |
|---|---|
| `node-pty@1.1.0` | Official Microsoft node-pty npm distribution, MIT; Christopher Jeffrey (2012-2015), Daniel Imms (2016), Microsoft Corporation (2018-present). Installed intact under `node_modules/node-pty`, with its complete multi-notice LICENSE, winpty `deps/winpty/LICENSE`, native prebuilds, source and packaged ConPTY/OpenConsole binaries. Its `node-addon-api` dependency retains its own LICENSE.md. |
| `@xterm/xterm@6.0.0` | Official xterm.js npm distribution, MIT; xterm.js authors (2017-2019), SourceLair Private Company (2014-2016), Christopher Jeffrey (2012-2013). Its exact full LICENSE is copied into `dist/terminal-licenses/xterm-LICENSE`. Bundled only into the standalone browser. |
| `@xterm/addon-fit@0.11.0` | Official xterm.js npm distribution, MIT; xterm.js authors (2019). Its exact full LICENSE is copied into `dist/terminal-licenses/addon-fit-LICENSE`. Bundled only into the standalone browser. |

Dependency integrity/resolved feed URLs are recorded in the standalone and
webview lockfiles. The native package tarball was inspected, not inferred from
version metadata: SHA-512
`20JqtutY6JPXTUnL0ij1uad7Qe1baT46lyolh2sSENDd4sTzKZ4nmAFkeAARDKwmlLjPx6XKRlwRUxwjOy+lUg==`.
It includes Windows x64/arm64 `conpty.node`, console-list helper, ConPTY DLL and
OpenConsole.exe, and macOS x64/arm64 `pty.node`/spawn-helper. It includes Linux
native sources rather than Linux prebuilds. The installed acceptance report
records the loaded native version/license hash and actual packaged bytes.

The smaller `@lydell/node-pty@1.2.0-beta.15` distribution and its Windows x64
artifact were also inspected; they redistribute a beta Microsoft build.
They are not dependencies of this implementation. No public-registry access,
global installation or custom native binary was required on the Windows host.
