# Canvas plugin development (experimental)

The Canvas artifact is independent of the VSIX and private standalone CLI.
From the repository root, with the locked root, `webview-ui` and `standalone`
dependencies restored through your configured npm registry:

```powershell
npm run build:canvas
node scripts\verify-canvas-plugin.mjs
node --test scripts\verify-canvas-plugin.test.mjs
```

`plugins/squad-pod/` is generated, gitignored, ready to run and excluded from
the VSIX. Do not commit it to master. Distribution commits/catalog publication
are separate release work (#181/C11); end users must not run npm builds.
The plugin version starts at **0.1.0**, independently of the VSIX version.

The package contains Agent Plugins 1.0 metadata, the existing icon as
`assets/preview.png`, namespaced Canvas ESM/UI/sprites, notices and full dependency
licenses. `ws`, `pngjs`, React/React DOM and Scheduler are bundled; native ws
accelerators are disabled in favor of its JS fallbacks. Only Node builtins and
the **host-injected** `@github/copilot-sdk/extension` (experimental v1.0.28
development contract) remain external. No `node_modules`, SDK install, VS Code
runtime or `node-pty` is required. Runtime code must never write to stdout.

`build-info.json` records actual esbuild/Vite inputs, imports, exact dependency
versions/licenses and the source commit plus dirty-worktree flag.
The verifier writes deterministic `checksums.json` with SHA-256 and byte count
for every payload file except itself, source provenance and code/asset license
inventory. It rejects unexpected files, common secrets, symlinks, missing or
non-relative resources, modified sprites/manifests, forbidden imports and files
over 10 MiB or packages over 40 MiB. This is a bounded artifact audit, not a
general secret scanner or a signature. Rebuild after source changes; release
provenance must come from an approved clean source commit.

## Optional local marketplace test — owner-operated only

These are instructions, not steps performed by the build or CI. Plugin code runs
with your local privileges. Obtain owner approval before installation, and do
not change app trust/settings or point it at unrelated projects.

Create a separate local marketplace directory with
`.github/plugin/marketplace.json`, copy the complete built directory to its
`plugins/squad-pod/`, and use this catalog (paths are relative to its root):

```json
{
  "name": "squad-pod-local",
  "owner": { "name": "Brian Swiger" },
  "plugins": [{
    "name": "squad-pod", "version": "0.1.0",
    "description": "Experimental read-only Squad Pod Canvas",
    "source": "./plugins/squad-pod"
  }]
}
```

For **CLI packaging-only** testing, register the local directory with
`copilot plugin marketplace add .\canvas-marketplace`, then run
`copilot plugin install squad-pod@squad-pod-local` and `copilot plugin list`.
Use an absolute directory path if invoking from elsewhere. Remove it with
`copilot plugin uninstall squad-pod@squad-pod-local` followed by
`copilot plugin marketplace remove squad-pod-local`; delete the local test
directory only after removing its registration.

For native app acceptance, Scout owns installation/removal and exact host-build
qualification. In **Customize**, use marketplace settings to add the approved
marketplace and install from Browse; remove/disable under Installed and remove
the test marketplace afterward. Published app documentation describes GitHub/Git
marketplaces, not guaranteed local-directory support: do not infer native local
marketplace support from CLI success or edit app settings to force it. If the
qualified app cannot consume the local marketplace, record that limitation and
defer native installation to the separately approved immutable distribution.

The automated smoke uses only a synthetic project and an injected SDK stub. It
proves dependency-free ESM startup and static UI serving, **not** native app
acceptance, SDK compatibility, real-session observation or editor behavior.
No install, publication, tag, or app configuration change is part of this issue.
