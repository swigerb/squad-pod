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
The published Canvas version is **0.1.3**, sourced only from
`standalone/canvas-plugin.json`, independently of VSIX **1.0.0** and the private
standalone observer **0.1.0**. The owner catalog pins the immutable **0.1.3**
distribution; native acceptance remains pending #218. Do not bump
those other products for Canvas.

The package contains Agent Plugins 1.0 metadata, the existing icon as
`assets/preview.png`, namespaced Canvas ESM/UI/sprites, notices and full dependency
licenses. `ws`, `pngjs`, React/React DOM and Scheduler are bundled; native ws
accelerators are disabled in favor of its JS fallbacks. Only Node builtins and
the **host-injected** `@github/copilot-sdk/extension` (experimental v1.0.28
baseline plus optional, narrowly typed runtime RPC methods) remain external. No `node_modules`, SDK install, VS Code
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
    "name": "squad-pod", "version": "0.1.3",
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

## Canvas 0.1.2 host-mediated candidates (#223)

Canvas 0.1.2 is a historical published preview; 0.1.3 is current. The 0.1.2
artifact adds host-mediated charter opening, joined-session usage metrics and
JSON transfers. Native acceptance for 0.1.2 remains pending in #218. CLI usage
import remains OPEN, and browser-transfer gates remain unchanged where native
embedded transfer is still unqualified.

`standalone/src/canvas/hostCapabilities.ts` owns each instance's optional bridge.
The installed experimental SDK's generated RPC declarations document
`canvas.list/open`, `usage.getMetrics()` and `workspaces.createFile({path,content})`.
The shim types only those used methods; it does not claim general SDK parity.
All browser requests pass the existing exact loopback Host/Origin and viewer
cookie boundary. Imports/exports additionally require the per-instance editing
cookie. A missing method or rejection never grants permission; failures use a
stable sanitized reason, never raw SDK exceptions, paths, prompts or credentials.
Host RPC rejections disable that host path for the instance without retries.
The 0.1.3 local-charter and typed-busy exceptions are described below; neither
is a host RPC rejection.
Each SDK await has a one-second deadline; timed-out paths are quarantined for
the instance even if the underlying SDK promise settles later. The operation
slot is released so an unresponsive usage RPC cannot disable unrelated imports
or exports. This does not cancel an in-flight host write/open or automatically
retry it; a timed-out export remains outcome-unconfirmed.
Outcomes can be unconfirmed if the host completed a side effect before rejection
or revocation; no rollback or success is invented.

Charter opening is a user gesture, limited to a current visible member whose
roster declares the fixed `.squad/agents/<slug>/charter.md` (or `.ai-team` only
when `.squad` is absent). `ProjectFiles` rejects symlinks/junctions, traversal and
changed roots. `canvas.list()` must advertise exactly one editor and a compatible
repo-scope/path schema; its provider ID is passed back, not guessed.
A bounded, fixed read-only `git -C <joined-root> rev-parse --show-toplevel`
metadata query determines the worktree root; the verified charter path is
translated to that root, including a nested joined-project prefix.
There is no arbitrary command, terminal or directory-management entry point.
If Git or the host schema is unavailable, opening fails closed.

Joined-session usage is fetched only by its explicit Refresh button. It exposes
only supplied session-level requests, multiplier-applied premium-request cost,
API milliseconds and nano-AI units. It is separate from imported CLI exports
and ledger totals; missing quantities are not zero. No private CLI logs,
cross-session queries, model attribution or billing conversion are introduced.

After editing opt-in, Export (including retained layout copies) writes **exact
validated JSON**, not Markdown, to a generated `squad-pod-layout-<uuid>.json`
session-workspace file and displays its filename. Browser download remains the
fallback; after a rejection the user must explicitly export again to use it.
Import project JSON accepts a slash-separated `.json` path relative to the
joined project; guarded UTF-8 reads and the existing 2 MiB/schema limits precede
draft replacement. It never saves automatically. The browser JSON picker remains
available separately. Native accessibility of exported workspace files and
embedded browser transfers still need owner qualification.

The new headless mocked-SDK smoke in `officeHost.test.ts` exercises a real
provider/loopback listener, auth refusals, session metrics, editing-gated export,
exact JSON bytes and disposal on all three CI operating systems. It does not
run the app, install a plugin, authorize terminal execution or establish native
acceptance. All these capabilities are **Candidate; pending native acceptance (#218)**. See the
[feature matrix](canvas-feature-matrix.md#platform-investigation-static-only-223)
for the static URL/loopback findings and explicit unsupported WSL/remote disposition.

## Canvas 0.1.3 published candidates (#230/#232)

The published 0.1.3 artifact isolates a known local charter refusal to its member,
keeps capabilities available after typed busy refusals, joins duplicate
same-member charter opens, and propagates the actual failure or disposal outcome
to every joined caller. These changes are **Candidate; pending native
acceptance (#218)**. They are not in the historical 0.1.2 artifact. The current
catalog pins immutable `canvas-v0.1.3`; its
[publication receipt](canvas-install.md#published-013-preview-provenance)
records the exact distribution and source identities. Native retesting remains
pending; CI and packaging checks are not native acceptance.

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
   Never move an existing tag. For 0.1.3, publish a GitHub **pre-release**,
   explicitly **not Latest**, with `squad-pod-canvas-0.1.3.zip`,
   `canvas-0.1.3-freeze.json`, `canvas-0.1.3-build-info.json`,
   `canvas-0.1.3-checksums.json` and `SHA256SUMS`. Keep stable VSIX `v1.0.0`
   as Latest.
5. In a separate focused PR, update `.github/plugin/marketplace.json` version,
   `source.ref` and full `source.sha` together. Include the exact provenance in
   the install guide. Require exact-head CI before merging; catalog publication
   is not native acceptance.

Record source SHA/tree, dist SHA/tag, plugin entry/build-info/checksum hashes,
receipt payload byte/file counts, downloadable archive URL/hash and CI run IDs.
Keep the 0.1.0 evidence pins unchanged. New 0.1.3 native checks, including
update/rollback between distinct releases with retained data, belong to #218.
Only the designated owner/Scout should install or qualify the native candidate.

When creating the downloadable archive on Windows, disable checkout-style CRLF
conversion for that command, then compare the ZIP's decompressed payload bytes
to every receipt entry before publication. For example:

```powershell
$version = "0.1.3"
git -c core.autocrlf=false archive --format=zip --prefix=squad-pod/ --output "squad-pod-canvas-$version.zip" "canvas-v${version}:plugins/squad-pod"
```

Default `git archive` settings can otherwise convert text despite byte-exact
Git blobs, invalidating the packaged checksums. The
[published 0.1.3 provenance](canvas-install.md#published-013-preview-provenance)
records the verified archive, not an unverified source ZIP. Historical 0.1.1
and 0.1.2 provenance remains in the same install guide.
