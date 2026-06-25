# rust-binary-publish

A reusable GitHub Actions release pipeline. One `workflow_call` workflow turns a
single **input** (how to produce the release artifacts) into one or more
**outputs** (where they get published).

Today it supports two input types — **`rust-binaries`** (cross-compiled Rust CLI
binaries) and **`tauri-app`** (per-OS Tauri desktop bundles) — and two output
types — **`github-release`** and **`npm-package`**. The input/output split keeps
it open to new producers and new destinations without changing the contract.

**`rust-binaries`** builds the binary across a cross-target matrix (Linux musl,
macOS, Windows MSVC) and packages each target into a `.tar.xz` (Unix) / `.zip`
(Windows) archive containing the binary plus the project README.

**`tauri-app`** builds the Tauri app on a per-OS runner matrix (Tauri bundles
can't be cross-compiled) and collects the installers it produces — `.deb` /
`.rpm` / `.AppImage` (Linux), `.dmg` / `.app.tar.gz` (macOS), `.msi` / NSIS
`.exe` (Windows).

`github-release` attaches every produced artifact, any extra assets, and a
`sha256.sum`, then cuts the release. For `rust-binaries` it additionally renders
& uploads `install.sh` (`curl … | sh`) and `install.ps1` (`iwr … | iex`).
`npm-package` (rust-binaries only) bundles every platform binary behind a tiny
zero-dependency dispatch stub (`process.platform + '-' + process.arch`) and
publishes to npm. Outputs are independent — request any subset.

## Inputs are JSON strings

GitHub reusable workflows only accept **scalar** inputs (`string` / `number` /
`boolean`) — you cannot pass a YAML object or array to `with:`. So the
structured `input` and `outputs` are passed as **JSON strings** and parsed
inside the workflow.

## Usage

In the consumer repo, replace the bespoke release workflow with a thin caller:

```yaml
# .github/workflows/release.yml

name: Release
on:
  push:
    tags: ["v*.*.*"]
  workflow_dispatch:
    inputs:
      tag:
        description: "Tag to release"
        required: true

jobs:
  release:
    uses: Skiley/rust-binary-publish/.github/workflows/release.yml@v2.0.0
    permissions:
      contents: write
      id-token: write
    with:
      tag: ${{ inputs.tag || github.ref_name }}
      input: |
        {
          "type": "rust-binaries",
          "binary-name": "myproject",
          "crate": "myproject-cli"
        }
      outputs: |
        [
          {
            "type": "github-release",
            "extra-assets": "schema/myproject.schema.json"
          },
          {
            "type": "npm-package",
            "package-name": "@org/myproject",
            "package-description": "myproject CLI — Great CLI"
          }
        ]
    secrets:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

> **Pin a version.** Reference the workflow at a released tag. The pipeline
> checks out its own tooling (npm bundler + install-script templates) at the
> exact same revision via `github.job_workflow_sha`, so the version you pin
> governs the entire release behavior.

## Permissions

Grant the caller `permissions:` the outputs you request — the workflow's jobs
inherit them:

| Output           | Required caller permission       |
|------------------|----------------------------------|
| `github-release` | `contents: write`                |
| `npm-package`    | `id-token: write` (for npm provenance), plus `contents: write` |

A `github-release`-only consumer (e.g. a Tauri app) needs just
`contents: write` — it must **not** be forced to grant `id-token: write`.

## `input`

A JSON object — `{ "type": <input-type>, … }`.

### `rust-binaries`

| Field            | Required | Default           | Description                                  |
|------------------|----------|-------------------|----------------------------------------------|
| `binary-name`    | yes      | —                 | Binary name produced by cargo.               |
| `crate`          | no       | workspace default | `cargo build -p <crate>`.                    |
| `targets`        | no       | 6 default targets | JSON array of `{ target, runner }`.          |
| `readme`         | no       | `README.md`       | README bundled into each archive.            |
| `archive-prefix` | no       | `<repo-name>-cli` | Archive name prefix.                         |

### `tauri-app`

Builds the Tauri app once per OS (bundles can't be cross-compiled) and attaches
every installer it produces. Compatible with the `github-release` output only.

| Field             | Required | Default                          | Description                                                          |
|-------------------|----------|----------------------------------|----------------------------------------------------------------------|
| `project-path`    | no       | `.`                              | Directory containing the Tauri app (with `src-tauri/`).              |
| `package-manager` | no       | detect from lockfile             | `pnpm` / `yarn` / `npm` / `bun`.                                     |
| `node-version`    | no       | `24`                             | Node version to set up.                                              |
| `linux-deps`      | no       | Tauri/WebKit apt set             | Space-separated apt packages installed on Linux runners.            |
| `install-command` | no       | per package manager              | JS dependency install command (e.g. `pnpm install --frozen-lockfile`).|
| `build-command`   | no       | `node_modules/.bin/tauri build`  | Build command, run in `project-path`.                               |
| `post-build`      | no       | —                                | Command run after the build (every OS), in `project-path`.          |
| `targets`         | no       | 4 default targets                | JSON array of `{ key, runner, args?, rust-targets? }`.              |

Each `targets` entry: `key` names the uploaded artifact, `runner` is the GitHub
runner, `args` are appended to the build command (e.g.
`--target universal-apple-darwin`), and `rust-targets` is a comma-separated list
of Rust targets to install for that runner.

## `outputs`

A JSON array of `{ "type": <output-type>, … }`. At least one supported output is
required; unknown types are ignored with a warning.

### `github-release`

| Field          | Required | Default              | Description                                                        |
|----------------|----------|----------------------|--------------------------------------------------------------------|
| `extra-assets` | no       | —                    | Newline-separated extra files to attach.                           |
| `env-prefix`   | no       | uppercased repo name | Env-var prefix in install scripts (`MYCLI` → `MYCLI_INSTALL_DIR`). |

### `npm-package`

| Field                 | Required | Description                                   |
|-----------------------|----------|-----------------------------------------------|
| `package-name`        | yes      | Full npm name incl. scope (`@org/package`).   |
| `package-description` | yes      | Description for the generated `package.json`. |

Secret `NPM_TOKEN` is required for the `npm-package` output only when you're not
using npm trusted publishing.

## Top-level inputs

| Input | Required | Default             | Description           |
|-------|----------|---------------------|-----------------------|
| `tag` | no       | triggering ref name | Release tag to build. |

## Default targets

`rust-binaries`:

```
x86_64-unknown-linux-musl    (ubuntu-24.04)
aarch64-unknown-linux-musl   (ubuntu-24.04-arm)
aarch64-apple-darwin         (macos-latest)
x86_64-apple-darwin          (macos-latest)
x86_64-pc-windows-msvc       (windows-2025)
aarch64-pc-windows-msvc      (windows-2025)
```

The npm bundler maps each Rust triple to its `process.platform-process.arch` key
automatically.

`tauri-app`:

```
linux-x86_64       (ubuntu-24.04)
linux-aarch64      (ubuntu-24.04-arm)
macos-universal    (macos-latest, --target universal-apple-darwin)
windows-x86_64     (windows-latest)
```

Override either via `input.targets` (JSON).

## Tauri example

```yaml
jobs:
  release:
    uses: Skiley/rust-binary-publish/.github/workflows/release.yml@v2.0.0
    permissions:
      contents: write
    with:
      tag: ${{ inputs.tag || github.ref_name }}
      input: |
        {
          "type": "tauri-app",
          "post-build": "bash scripts/fix-appimage.sh"
        }
      outputs: |
        [
          { "type": "github-release" }
        ]
```
