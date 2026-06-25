# rust-binary-publish

A reusable GitHub Actions release pipeline. One `workflow_call` workflow turns a
single **input** (how to produce the release artifacts) into one or more
**outputs** (where they get published).

Today it supports one input type — **`rust-binaries`** (cross-compiled Rust CLI
binaries) — and two output types — **`github-release`** and **`npm-package`**.
The input/output split keeps it open to new producers and new destinations
without changing the contract.

For `rust-binaries` the pipeline:

1. **Builds** the binary across a cross-target matrix (Linux musl, macOS, Windows MSVC).
2. **Packages** each target into a `.tar.xz` (Unix) / `.zip` (Windows) archive
   containing the binary plus the project README.

`github-release` then renders & uploads `install.sh` (`curl … | sh`) and
`install.ps1` (`iwr … | iex`), attaches every archive, any extra assets, and a
`sha256.sum`, and cuts the release. `npm-package` bundles every platform binary
behind a tiny zero-dependency dispatch stub (`process.platform + '-' +
process.arch`) and publishes to npm. Outputs are independent — request any
subset.

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

```
x86_64-unknown-linux-musl    (ubuntu-24.04)
aarch64-unknown-linux-musl   (ubuntu-24.04-arm)
aarch64-apple-darwin         (macos-latest)
x86_64-apple-darwin          (macos-latest)
x86_64-pc-windows-msvc       (windows-2025)
aarch64-pc-windows-msvc      (windows-2025)
```

Override via `input.targets` (JSON). The npm bundler maps each Rust triple to
its `process.platform-process.arch` key automatically.
