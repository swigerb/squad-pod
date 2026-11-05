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
The plugin version is **0.1.1**, sourced only from
`standalone/canvas-plugin.json`, independently of VSIX **1.0.0** and the private
standalone observer **0.1.0**. Do not bump those other products for Canvas.

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
    "name": "squad-pod", "version": "0.1.1",
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
These checks do not install the plugin or change app configuration.

## Immutable preview publication

Use the repository's manual Canvas path, not the retired Squad/npm release
workflows. Never publish this plugin to npm or commit generated `plugins/` to
master.

1. Prepare a focused source/version/docs PR targeting master. Run the build,
   verifier and packaging tests above. Require green exact-head CI and no
   actionable review blocker before merging.
2. Build again from the approved **clean source commit** after green CI.
   Verify `build-info.json` has its exact source SHA and `sourceDirty: false`.
   Preserve `checksums.json`, dependency licenses and third-party notices.
3. Make an additive distribution commit containing `plugins/squad-pod/` on
   `canvas-dist`, retaining its prior release history. Preserve payload bytes;
   verify Git blobs match the checksum receipt (including on Windows).
4. Create a new immutable `canvas-v<version>` tag at that distribution commit.
   Never move an existing tag. Publish a GitHub **pre-release**, explicitly
   **not Latest**, with a downloadable plugin archive and its SHA-256. Keep
   stable VSIX `v1.0.0` as Latest.
5. In a separate focused PR, update `.github/plugin/marketplace.json` version,
   `source.ref` and full `source.sha` together. Include the exact provenance in
   the install guide. Require exact-head CI before merging; catalog publication
   is not native acceptance.

Record source SHA/tree, dist SHA/tag, plugin entry/build-info/checksum hashes,
receipt payload byte/file counts, downloadable archive URL/hash and CI run IDs.
Keep the 0.1.0 evidence pins unchanged. New 0.1.1 native checks, including
update/rollback between distinct releases with retained data, belong to #218.
Only the designated owner/Scout should install or qualify the native candidate.

When creating the downloadable archive on Windows, disable checkout-style CRLF
conversion for that command, then compare the ZIP's decompressed payload bytes
to every receipt entry before publication. For example:

```powershell
git -c core.autocrlf=false archive --format=zip --prefix=squad-pod/ --output squad-pod-canvas-0.1.1.zip canvas-v0.1.1:plugins/squad-pod
```

Default `git archive` settings can otherwise convert text despite byte-exact
Git blobs, invalidating the packaged checksums. The
[published provenance](canvas-install.md#published-011-preview-provenance)
records the verified 0.1.1 archive, not an unverified source ZIP.
