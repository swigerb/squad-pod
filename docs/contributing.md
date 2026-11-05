# Build and contribute

Source builds require Node.js 22.13 or later:

```powershell
git clone https://github.com/swigerb/squad-pod.git
cd squad-pod
npm run install:all
npm run build
```

Open the project in VS Code and press **F5** to launch the Extension Development Host.

| Command | Description |
|---|---|
| `npm run lint` | Lint the extension host |
| `npm run check-types` | Type-check the extension and webview |
| `npm run test:all` | Run extension and webview tests |
| `npm run build` | Build the extension and webview |
| `npm run verify` | Run lint, type checks, tests, builds, and provider smoke checks |
| `npm run package` | Build and audit a stable-channel VSIX |

`src/` contains the extension host; `webview-ui/src/` contains the shared React office and editor. Typed messages connect the two.

The [testing guide](testing.md) covers automated checks, package verification and evidence. The [native acceptance plan](native-acceptance.md) retains the comprehensive historical campaign and instructions for separately approved native/real-session work.

Questions, bugs and feature requests: [open a GitHub issue](https://github.com/swigerb/squad-pod/issues).

## How we built this

Squad Pod began with the question, *What if [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) worked with Squad?* A Simpsons-themed Squad team helped build the extension:

| Agent | Role | Contribution |
|---|---|---|
| Homer Simpson | Lead | Architecture and code review |
| Lisa Simpson | Core developer | Extension host |
| Bart Simpson | Frontend developer | Webview and office |
| Marge Simpson | Tester | Tests and edge cases |
| Ned Flanders | DevRel | Documentation |
| Scribe | Session logger | Decisions and session notes |

The original [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) by [Pablo De Lucca](https://github.com/pablodelucca) watches Claude Code transcripts. Squad Pod adapts its virtual-office idea to Squad's team roster and files.

## Roadmap

- Adopt a supported Squad event API when available.
- Visualize team ceremonies in the office.
