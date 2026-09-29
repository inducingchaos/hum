# Question rounds

## Round 1 (2026-09-27): answered

Owner's reply, verbatim: "1a, 2a, 3b, 4a, 5a, 6a, 7a with shortcut to clear, 8a, 9a, 10a, 11a definitely as I use next/prev/play/pause from my M2 air control strip, 12a, 13a, 14a, 15: Ghostty." They also added: "make it 100% keyboard-controllable if possible with a toggleable menu that shows all shortcuts."

| # | Topic | Options | **Answer** |
| --- | --- | --- | --- |
| 1 | Length variants when shuffling | a one per song, longest / b one per song, chosen length / c every length | **a: dedupe, longest** |
| 2 | Filter matching | a whole segments + unique-prefix fallback / b exact only / c any prefix | **a** |
| 3 | Search scope | a name only / b name + metadata tags | **b** |
| 4 | Launch with no args | a resume last filter/track/position / b shuffle one folder / c shuffle all / d idle | **a: resume** |
| 5 | CLI args (`pnpm play grey dark`) | a yes + `/` inside / b TUI only | **a** |
| 6 | Repeat | a cycle off/all/one / b repeat-one toggle | **a** |
| 7 | Cache cap | a 2 GB LRU / b 5 GB / c 10 GB / d minimal | **a, plus a shortcut to clear the cache** |
| 8 | Now-playing density | a name, path, time bar, next up / b + tags / c + nerd panel | **a: minimal** |
| 9 | Palette | a terminal default + one accent / b amber / c green / d mono | **a** |
| 10 | Mouse | a keyboard only, ⏻ decorative / b clickable | **a** |
| 11 | Media keys / Now Playing | a yes / b no | **a: definitely.** Owner uses next/prev/play/pause from the M2 Air control strip |
| 12 | Runtime | a Bun / b Node+tsx / c Node strip-types | **a: Bun** |
| 13 | TUI approach | a hand-rolled ANSI / b Ink / c other | **a** |
| 14 | Tree labels | a name + count / b + hours/GB / c name only | **a** |
| 15 | Terminal app + extras | free text | **Ghostty.** Plus: 100% keyboard, toggleable shortcut menu |

## Round 2 (2026-09-28): iPhone PWA, answered

Asked in turn 10. Owner's reply (turn 11), verbatim: "1a, 2a, 3a, 4a plus maybe a few history with a very small storage cap or a backwards-count from current, 5 is good, 6a, 7a is fine although I've never touched preact so this will be interesting, 8a, 9 I'm on almost the latest which is 26.6.2 which is a reasonable standard, and the speaker is BT but I may want to airplay to my mac BUT I can easily do that from control center, 10a - come up with a more minimalist/brutalist/clean name/codename for this app and hopefully it will be available as a clean vercel.app subdomain."

Summary: all (a). 4: also keep the last 2 played cached. 9: iOS 26.6.2, Bluetooth speaker, AirPlay via Control Center. 10: codename wanted (proposed `hum`, plan-web §2).

| # | Topic | Options |
| --- | --- | --- |
| 1 | Auth / backend | **a** static PWA, "Sign in with Dropbox" (PKCE in the browser) is the only auth, no server / b a + a site gate (Vercel password or a passcode function) / c Vercel functions proxy Dropbox, token server-side |
| 2 | Library index | **a** phone builds it from Dropbox (~30 s once, then deltas) / b the CLI exports it and it ships with the deploy / c a Vercel function builds it |
| 3 | Favourites/history/resume across Mac and phone | **a** per device for v1 / b synced through a small store (Upstash/Vercel KV, one function) / c phone only |
| 4 | Offline | **a** prefetch window only (now + next 3, ~100 MB, LRU ~1 GB) / b a + "keep favourites offline" / c big offline library |
| 5 | v1 scope | player + rolling list, filter chips, shuffle/repeat/dedupe, favourites, search. Cut or add? |
| 6 | Repo layout | **a** pnpm workspace, same repo: CLI stays, add `web/`, extract pure core (filter/queue/search/model/normalize) to a shared package; no Turborepo yet / b Turborepo `apps/` + `packages/` / c separate repo |
| 7 | Web stack | **a** Vite + Preact + TS, hand-written service worker / b Next.js (like the owner's other projects) / c SvelteKit or Solid |
| 8 | Look | **a** blend: TUI layout and peach accent, ALTERED's type/spacing and bottom bar / b TUI-faithful / c ALTERED-faithful |
| 9 | iPhone + speaker | iOS version? AirPlay or Bluetooth speaker? |
| 10 | Domain | **a** `*.vercel.app` / b a subdomain of the owner's domain |

## Round 3 (2026-09-28): plan-web approval, answered

Asked in turn 11 with `docs/plan-web.md`. Owner's reply (turn 12), close to verbatim: "1. Hum is fine. 2. I will do that in the next round, as the current codebase has no `web/`. You have approval to auto-merge to main or just commit to main, either or, for this codebase. Once that is done I will connect the Vercel project and report back. As well as add those redirect URLs. And about branching, if you suggest a better workflow let me know but in this codebase and project I really don't want to touch git or github. So figure out a plan and write your own rules. 3. Yes, that's fine, push to main. We're the only consumer it's a personal project. 4. Approve."

Answers: codename `hum`; owner does Vercel + Dropbox redirect URIs after `web/` exists; push to `main` (rules in AGENTS.md "Git workflow"); plan approved.


1. Codename `hum`? (backup: `lull`)
2. Approve the two owner actions: create the Vercel project (root `web`) and add redirect URIs in the Dropbox app console.
3. Branch: push to `main` (AGENTS.md rule, Vercel production = main), or keep this session's branch and point Vercel production at it?
4. Approve the plan (including ASSUMPTIONs: 1 GB cap, separate web Dropbox client, narrow-screen column)?

## Round 4 (2026-09-29): native iOS app

Asked in turn 15, with the stack recommendation (native Swift + SwiftUI, zero third-party deps; D17 proposed).

| # | Topic | Options |
| --- | --- | --- |
| 1 | Stack | **a** native Swift/SwiftUI, no deps (recommended) / b Expo / c Capacitor wrapping the PWA |
| 2 | Apple Developer Program ($99/yr) | **a** have it or will get it (TestFlight, 1-year signing) / b free Personal Team (re-sign from Xcode every 7 days, no TestFlight) |
| 3 | Mac | Xcode version installed? Apple Silicon? Fine with Xcode + one `brew install xcodegen` (or none: agent hand-writes the project file)? |
| 4 | CI | **a** GitHub Actions macOS runner builds + runs unit/UI tests on the Simulator for every push (private repo: macOS minutes bill 10×, ~200 min/month on the free plan, ~6 min/run) / b no CI, owner's Mac only |
| 5 | Scope for v1 | exact parity with hum (NOW / QUEUE / filter sheet / favourites / SYS log) / parity + native extras (see list) / smaller |
| 6 | Name + bundle id | app name `hum`? bundle id e.g. `com.rileybarabash.hum`? |
| 7 | State | fresh on the phone (resync, no migration) / import PWA favourites once (paste an export) |
| 8 | PWA after the app works | keep deployed as is / freeze / retire |

Answers (turn 16): 1a · 2a (has the paid account) · 3: M2 Air, Xcode 26.6 (27.0 / 27.2 beta possible), `brew install xcodegen` OK · 4a, but make the repo public instead of spending private minutes (after an audit) · 5a **in two looks** (native SwiftUI vs PWA replica) · 6 yes (`hum`, `com.rileybarabash.hum`) · 7a (fresh) · 8 freeze and leave it (no deploys, don't delete).
