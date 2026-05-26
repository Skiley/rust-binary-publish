# Rendered by rust-binary-publish at release time. Placeholders (__REPO__ etc.)
# are substituted with the consuming project's values before upload.
$ErrorActionPreference = 'Stop'
# Invoke-WebRequest renders a progress bar that is extremely slow when stdout is
# redirected (i.e. run non-interactively) on Windows PowerShell 5.1 — suppress
# it so the download doesn't appear to hang.
$ProgressPreference = 'SilentlyContinue'

$repo = '__REPO__'
$installDir = if ($env:__ENV_PREFIX___INSTALL_DIR) { $env:__ENV_PREFIX___INSTALL_DIR } else { "$env:LOCALAPPDATA\__NAME__\bin" }
# Version precedence: positional arg, then $env:__ENV_PREFIX___VERSION (the
# `iwr ... | iex` invocation form can't pass positional args), then latest.
$version = if ($args[0]) { $args[0] } elseif ($env:__ENV_PREFIX___VERSION) { $env:__ENV_PREFIX___VERSION } else { 'latest' }

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' { 'x86_64' }
  'ARM64' { 'aarch64' }
  default { throw "__NAME__: unsupported architecture: $env:PROCESSOR_ARCHITECTURE" }
}

$target = "$arch-pc-windows-msvc"
$archive = "__PREFIX__-$target.zip"

$url = if ($version -eq 'latest') {
  "https://github.com/$repo/releases/latest/download/$archive"
} else {
  "https://github.com/$repo/releases/download/$version/$archive"
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

try {
  Write-Host "Downloading $archive..."
  Invoke-WebRequest -Uri $url -OutFile (Join-Path $tmp $archive) -UseBasicParsing
  Expand-Archive -Path (Join-Path $tmp $archive) -DestinationPath $tmp

  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  $dest = Join-Path $installDir '__BIN__.exe'

  # Windows won't let you overwrite a running .exe, but it WILL let you rename
  # one. Move any existing binary aside first so an in-place update (which runs
  # this script while the binary may be executing) works. Delete any stale .old
  # from a previous update first (it's a dead file by now and safe to remove).
  if (Test-Path $dest) {
    $old = "$dest.old"
    Remove-Item -Path $old -Force -ErrorAction SilentlyContinue
    Rename-Item -Path $dest -NewName '__BIN__.exe.old' -ErrorAction SilentlyContinue
  }
  Move-Item -Path (Join-Path $tmp "__PREFIX__-$target\__BIN__.exe") -Destination $dest -Force

  # Try to drop the .old now. Succeeds on a manual upgrade (the old binary
  # isn't running), so that path leaves no litter.
  $old = "$dest.old"
  if (Test-Path $old) { Remove-Item -Path $old -Force -ErrorAction SilentlyContinue }

  Write-Host "Installed __BIN__.exe to $dest"

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not ($userPath -split ';' -contains $installDir)) {
    [Environment]::SetEnvironmentVariable('Path', "$userPath;$installDir", 'User')
    Write-Host ""
    Write-Host "Added $installDir to your PATH (open a new shell to use)."
  }
} finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
