---
title: Install
description: Build Joinery from source. There are no packaged installers yet — they arrive with v1.
sidebar:
  order: 1
---

Joinery has no tagged releases and no packaged installers today. Packaged builds — a macOS DMG
and a Windows installer — arrive with v1. Until then you build from source, which is four
commands.

## Build from source

Check [Prerequisites](../prerequisites/) first: you need Node.js 20 or later, pnpm 11 or later,
and on macOS the Xcode Command Line Tools for the native modules.

```bash
git clone https://github.com/cadam11/joinery.git
cd joinery
pnpm install
pnpm run dev
```

`pnpm run dev` builds every package, then starts the Vite renderer and the Electron main process
together with hot reload. The window opens on the welcome tab — see [First run](../first-run/).

> **Note** — `pnpm install` fetches an Electron binary and compiles native modules (`keytar` for
> the keychain, `ssh2` for tunnelling). The first install is therefore slower than the ones after
> it.

## Build a packaged app locally

You can produce the same artifacts the v1 release will ship, unsigned:

```bash
pnpm run package:mac   # macOS DMG (arm64 + x64)
pnpm run package       # the current platform
```

Neither is code-signed or notarized yet, so macOS Gatekeeper and Windows SmartScreen will warn
about a locally built app.

## Keeping a source install current

```bash
git pull
pnpm install
pnpm run dev
```

Run `pnpm install` after every pull: dependencies move with the code, and a stale
`node_modules` is the usual cause of a build that worked yesterday.

## What is not here yet

- **Downloads.** No release has been tagged, so there is nothing to download. The repository's
  release workflow builds macOS and Windows installers on a tag push, and no tag has been
  pushed.
- **Auto-update.** Not implemented.

<details>
<summary>Where this page's facts come from</summary>

Every claim above was checked against the repository at the commit this page was written from.

| Claim                                                                         | Source                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| No tagged releases, no packaged installers; packaged builds arrive with v1    | `README.md:180-189`                                                |
| `git clone` → `cd` → `pnpm install` → `pnpm run dev`                          | `README.md:226-233`, `CONTRIBUTING.md:31-37`                       |
| `pnpm run dev` builds first, then runs renderer and main concurrently         | `package.json:14` (`"dev": "pnpm run build && concurrently -k …"`) |
| Node 20+, pnpm 11+, Xcode Command Line Tools                                  | `package.json:8-11` (`engines`), `CONTRIBUTING.md:26-28`           |
| Native modules built at install time: `keytar`, `ssh2`, `electron`, `esbuild` | `pnpm-workspace.yaml` (`allowBuilds`)                              |
| `pnpm run package:mac` / `pnpm run package`                                   | `package.json:69-72`, `CONTRIBUTING.md:47-51`                      |
| Code signing and notarization are not done                                    | `README.md:187-189, 396-399`                                       |
| The release workflow builds installers on a tag push                          | `README.md:247-248`, `.github/workflows/build-release.yml`         |

</details>
