# Environment

Checked 2026-09-27 on the owner's Mac.

| Thing | Status |
| --- | --- |
| macOS | 26.5.2, arm64 (Apple Silicon) |
| Node | v22.20.0 (via nvm) |
| pnpm | 11.13.0 (Homebrew) |
| Bun | 1.3.9 (Homebrew) |
| Homebrew | installed |
| mpv | **not installed** |
| ffplay / ffmpeg | not installed |
| afplay | present (macOS built-in; no gapless, no IPC control) |
| rclone | not installed |
| Xcode | installed (`/Applications/Xcode.app`), Swift 6.3.3, target arm64-apple-macosx26.0. `swiftc` compiles AVFoundation code with no prompts (verified). |
| osascript | present (AppleScript + JXA) |
| Dropbox desktop app | **not installed** (no `~/Library/CloudStorage` Dropbox mount) |
| GitHub CLI | authenticated as `inducingchaos`, SSH protocol |

Repo: `github.com/inducingchaos/hum` (**public** since turn 16; renamed from an earlier name). Local clone on the Mac under `~/Workspace/containers/`.

## Cloud sessions (Claude Code on the web, turn 12)

- Linux container, Node 22.22, pnpm **10.33** (the Mac has 11.13; lockfile v9 works with both), Bun 1.3.11, Chromium 1194 at `/opt/pw-browsers` (Playwright 1.56).
- Network: npm registry works; `vercel.app` and Dropbox are **blocked** by the container's proxy, so no real Dropbox or Vercel checks from here. Mac-only suites (engine, player, e2e TUI) can't run.
- Handed branch `claude/serene-wozniak-z7fbsf`; `main` is fast-forwarded from it (AGENTS.md "Git workflow").

## Owner's iPhone (turn 13)

- iOS 26.6.2; Safari's user agent still says `OS 18_7` (Apple froze the UA version), so don't read the OS version from the UA.
- The PWA is installed from the Vercel deployment (project root `web/`). Git deployments are off since turn 16 (`web/vercel.json`), so the installed app stays on its last build.
- Dropbox redirect URIs registered: `<deployment>/auth`, `http://localhost:5173/auth`. Sign-in via the redirect button worked.

## Cloud container network (turn 14)

- Full egress works for curl/node/npm (verified: the Vercel deployment, Dropbox API + CORS preflight).
- ~~Headless Chromium can't load external HTTPS here~~ **Fixed (turn 15):** launch Chromium with `proxy: { server: process.env.HTTPS_PROXY }` and `--ignore-certificate-errors-spki-list=<sha256 of the proxy CA's public key>`. That trusts exactly the agent proxy's CA (the same trust curl gets from `/root/.ccr/ca-bundle.crt`), not "ignore all cert errors". Hash: `openssl x509 -in /root/.ccr/agent-proxy-ca.crt -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`. Verified: the deployed PWA loads (200, title `hum`). Before this, the agent tried NSS (`certutil` missing) and proxy-only (still `ERR_CERT_AUTHORITY_INVALID`). The hash can change per container, so compute it at runtime. Not yet wired into `web/e2e` (`HUM_URL=`).

## iOS toolchain (turn 16)

- **Cloud container:** Swift 6.3.3 for Linux (swift.org tarball) unpacked into `.cache/swift/` (gitignored, ~2 GB; re-download if the container is fresh: `curl -sSL https://download.swift.org/swift-6.3.3-release/ubuntu2404/swift-6.3.3-RELEASE/swift-6.3.3-RELEASE-ubuntu24.04.tar.gz | tar xz -C .cache/swift`). Runs `swift test` for `ios/HumCore` (Foundation only): `PATH=$PWD/.cache/swift/swift-6.3.3-RELEASE-ubuntu24.04/usr/bin:$PATH swift test --package-path ios/HumCore --scratch-path .cache/swift-build`. SwiftUI/AVFoundation/UIKit don't exist on Linux, so the app only compiles on macOS.
- **CI:** `.github/workflows/ios.yml` on `macos-26` runners (free because the repo is public; the job is skipped if it goes private). Triggered by pushes to `main` touching `ios/`, `test/cases/`, or the workflow. The agent reads results with the GitHub MCP tools (`actions_list`, `get_job_logs`) or the public API (`curl https://api.github.com/repos/inducingchaos/hum/actions/runs/<id>`), and downloads the `screenshots` artifact via `actions_get` → `download_workflow_run_artifact`.
- **Owner's Mac:** M2 Air, Xcode 26.6, paid Apple Developer account. `brew install xcodegen` approved (turn 16).
