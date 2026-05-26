#!/usr/bin/env node
// Build a single npm package that bundles every platform binary.
//
// Layout: one package (e.g. @scope/name) bundles all platform binaries under
// `bin/<key>/<bin>[.exe]` and ships a tiny zero-dependency stub at
// `bin/<bin>.js` that dispatches at runtime by `process.platform + '-' +
// process.arch`.
//
// Tradeoff vs. the optionalDependencies pattern (esbuild/swc/biome/turbo):
// every install pulls all binaries instead of one, but the install path is
// bulletproof — there's no `--ignore-scripts` / `--no-optional` /
// corporate-mirror / sandbox failure mode where the platform-specific package
// gets skipped and the wrapper can't find its binary.
//
// Usage:
//   node build-npm-package.mjs \
//     --package @scope/name \
//     --bin <binary-name> \
//     --description "<text>" \
//     --repo https://github.com/owner/repo \
//     --prefix <archive-prefix> \
//     --targets '[{"target":"x86_64-unknown-linux-musl"}, ...]' \
//     --version 0.1.0 \
//     --artifacts <dir> \
//     --out <dir>
//
// Reads archives named like the release produces: <prefix>-<triple>.{tar.xz|zip}

import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// --- arg parsing --------------------------------------------------------

function parseArgs(argv) {
	const wanted = ['package', 'bin', 'description', 'repo', 'prefix', 'targets', 'version', 'artifacts', 'out'];
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) throw new Error(`unexpected arg: ${a}`);
		const key = a.slice(2);
		if (!wanted.includes(key)) throw new Error(`unknown arg: ${a}`);
		args[key] = argv[++i];
	}
	for (const k of wanted) {
		if (!args[k]) throw new Error(`missing required --${k}`);
	}
	return args;
}

// --- target triple -> npm platform key ----------------------------------

// npm dispatches by `${process.platform}-${process.arch}`.
function tripleToKey(triple) {
	const arch = triple.startsWith('aarch64') ? 'arm64' : triple.startsWith('x86_64') ? 'x64' : null;
	if (!arch) throw new Error(`unsupported arch in triple: ${triple}`);
	if (triple.includes('windows')) return `win32-${arch}`;
	if (triple.includes('apple-darwin')) return `darwin-${arch}`;
	if (triple.includes('linux')) return `linux-${arch}`;
	throw new Error(`unsupported os in triple: ${triple}`);
}

function platformsFor(targetsJson, prefix, bin) {
	const targets = JSON.parse(targetsJson);
	return targets.map(({ target }) => {
		const isWindows = target.includes('windows');
		const ext = isWindows ? 'zip' : 'tar.xz';
		return {
			key: tripleToKey(target),
			archive: `${prefix}-${target}.${ext}`,
			bin: isWindows ? `${bin}.exe` : bin,
		};
	});
}

// --- archive extraction -------------------------------------------------

function extractBinary(archivePath, binName, destDir) {
	mkdirSync(destDir, { recursive: true });
	if (archivePath.endsWith('.tar.xz')) {
		// Tarballs contain a top-level dir like <prefix>-<triple>/<bin>; strip it.
		execFileSync('tar', ['-xJf', archivePath, '--strip-components=1', '-C', destDir], { stdio: 'inherit' });
	} else if (archivePath.endsWith('.zip')) {
		const tmp = join(destDir, '.tmp');
		mkdirSync(tmp, { recursive: true });
		execFileSync('unzip', ['-q', archivePath, '-d', tmp], { stdio: 'inherit' });
		const found = execFileSync('find', [tmp, '-name', binName, '-type', 'f'], { encoding: 'utf8' })
			.trim()
			.split('\n')[0];
		if (!found) throw new Error(`binary ${binName} not found in ${archivePath}`);
		copyFileSync(found, join(destDir, binName));
		rmSync(tmp, { recursive: true, force: true });
	} else {
		throw new Error(`unsupported archive format: ${archivePath}`);
	}
}

// --- package builder ----------------------------------------------------

function writePackage({ outDir, args, platforms }) {
	const pkgDir = join(outDir, 'pkg');
	const binDir = join(pkgDir, 'bin');
	mkdirSync(binDir, { recursive: true });

	for (const platform of platforms) {
		const archivePath = join(resolve(args.artifacts), platform.archive);
		if (!existsSync(archivePath)) throw new Error(`missing artifact: ${archivePath}`);
		const platDir = join(binDir, platform.key);
		extractBinary(archivePath, platform.bin, platDir);
		// Best-effort exec bit for Unix binaries (unzip'd .exe carries no Unix
		// mode; chmod is a no-op on Windows and the .exe doesn't need it).
		if (!platform.bin.endsWith('.exe')) {
			chmodSync(join(platDir, platform.bin), 0o755);
		}
		console.log(`  bundled ${platform.key}`);
	}

	const pkgJson = {
		name: args.package,
		version: args.version,
		description: args.description,
		repository: args.repo,
		homepage: args.repo,
		license: 'MIT',
		bin: { [args.bin]: `bin/${args.bin}.js` },
		files: ['bin'],
		engines: { node: '>=16' },
	};
	writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n');

	const binaries = Object.fromEntries(platforms.map((p) => [p.key, p.bin]));
	const stub = `#!/usr/bin/env node
// Picks the bundled binary for the current platform/arch and execs it.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const KEY = process.platform + '-' + process.arch;
const BINARIES = ${JSON.stringify(binaries, null, 2)};

const bin = BINARIES[KEY];
if (!bin) {
	console.error(\`${args.bin}: unsupported platform \${KEY}. Supported: \${Object.keys(BINARIES).join(', ')}\`);
	process.exit(1);
}

const binPath = path.join(__dirname, KEY, bin);
const result = spawnSync(binPath, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
	console.error(\`${args.bin}: failed to spawn \${binPath}: \${result.error.message}\`);
	process.exit(1);
}
process.exit(result.status == null ? 1 : result.status);
`;
	writeFileSync(join(binDir, `${args.bin}.js`), stub, { mode: 0o755 });

	writeFileSync(join(pkgDir, 'README.md'), `# ${args.package}\n\nSee ${args.repo} for documentation.\n`);

	return pkgDir;
}

// --- main ---------------------------------------------------------------

function main() {
	const args = parseArgs(process.argv.slice(2));
	const platforms = platformsFor(args.targets, args.prefix, args.bin);
	const outAbs = resolve(args.out);
	rmSync(outAbs, { recursive: true, force: true });
	mkdirSync(outAbs, { recursive: true });
	console.log(`Building npm package ${args.package}@${args.version}`);
	const pkgDir = writePackage({ outDir: outAbs, args, platforms });
	console.log(`Wrote package to ${pkgDir}`);
}

main();
