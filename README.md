# rust-binary-publish

A reusable GitHub Actions release pipeline for Rust CLI projects that ship
prebuilt binaries. One `workflow_call` workflow handles the whole release:

1. **Build** the binary for a cross-target matrix (Linux musl, macOS, Windows MSVC).
2. **Package** each target into a `.tar.xz` (Unix) / `.zip` (Windows) archive
   containing the binary plus the project README.
3. **Render & upload install scripts** — `install.sh` (`curl … | sh`) and
   `install.ps1` (`iwr … | iex`), parameterized per project.
4. **Create the GitHub Release** with all archives, install scripts, any extra
   assets, and a `sha256.sum`.
5. **Publish an npm package** that bundles every platform binary behind a tiny
   zero-dependency dispatch stub (`process.platform + '-' + process.arch`).

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
        uses: Skiley/rust-binary-publish/.github/workflows/release.yml@v1.0.0
        permissions:
            contents: write
            id-token: write
        with:
            bin: myproject
            crate: myproject-cli
            npm-description: "myproject CLI — Great CLI"
            npm-package: "@org/package"
            tag: ${{ inputs.tag || github.ref_name }}
        secrets:
            NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

> **Pin a version.** Reference the workflow at a released tag. The
> pipeline checks out its own tooling (npm bundler + install-script templates)
> at the exact same revision via `github.job_workflow_sha`, so the version you
> pin governs the entire release behavior.

## Inputs

| Input             | Required | Default              | Description                                                                 |
|-------------------|----------|----------------------|-----------------------------------------------------------------------------|
| `bin`             | yes      | —                    | Binary name produced by cargo.                                              |
| `npm-package`     | yes      | —                    | Full npm package name incl. scope (e.g. `@org/package`).                    |
| `npm-description` | yes      | —                    | Description for the generated `package.json`.                               |
| `crate`           | no       | `""`                 | `cargo build -p <crate>`. Empty builds the workspace default.               |
| `archive-prefix`  | no       | `<repo-name>-cli`    | Archive name prefix.                                                        |
| `env-prefix`      | no       | uppercased repo name | Env-var prefix in the install scripts (e.g. `MYCLI` → `MYCLI_INSTALL_DIR`). |
| `readme`          | no       | `README.md`          | README bundled into each archive.                                           |
| `targets`         | no       | 6 default targets    | JSON array of `{ target, runner }`.                                         |
| `extra-assets`    | no       | `""`                 | Newline-separated extra files to attach to the release.                     |
| `publish-npm`     | no       | `true`               | Whether to build & publish the npm package.                                 |
| `tag`             | no       | triggering ref name  | Release tag to build.                                                       |

Secret `NPM_TOKEN` is required only when `publish-npm` is `true`, and you're not using trusted publishing.

## Default targets

```
x86_64-unknown-linux-musl    (ubuntu-24.04)
aarch64-unknown-linux-musl   (ubuntu-24.04-arm)
aarch64-apple-darwin         (macos-latest)
x86_64-apple-darwin          (macos-latest)
x86_64-pc-windows-msvc       (windows-2025)
aarch64-pc-windows-msvc      (windows-2025)
```

Override via the `targets` input (JSON). The npm bundler maps each Rust triple
to its `process.platform-process.arch` key automatically.
