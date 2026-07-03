/**
 * Build script: bundles entry points with esbuild, copies static assets,
 * and emits per-browser manifests into dist/chrome and dist/firefox.
 *
 * Usage: node scripts/build.js [--zip]
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const shouldZip = process.argv.includes('--zip');

const ENTRY_POINTS = ['background.js', 'content/inject.js', 'options/options.js', 'popup/popup.js'];

const STATIC_ASSETS = [
  'icons',
  '_locales',
  'options/options.html',
  'options/options.css',
  'popup/popup.html',
  'popup/popup.css',
];

const baseManifest = JSON.parse(readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
baseManifest.version = version;

const targets = {
  chrome: (manifest) => manifest,
  firefox: (manifest) => ({
    ...manifest,
    // Firefox MV3 uses an event page instead of a service worker.
    background: { scripts: [manifest.background.service_worker] },
    browser_specific_settings: {
      gecko: {
        id: 'github-pr-notifications@hbmartin.github.io',
        strict_min_version: '121.0',
      },
    },
  }),
};

function ensureZipExecutable() {
  try {
    execFileSync('zip', ['-v'], { stdio: 'ignore' });
  } catch {
    throw new Error(
      'npm run build:zip requires the zip executable. Install zip or run npm run build without --zip.'
    );
  }
}

if (shouldZip) ensureZipExecutable();

rmSync(dist, { recursive: true, force: true });

for (const [browser, transform] of Object.entries(targets)) {
  const outdir = path.join(dist, browser);
  mkdirSync(outdir, { recursive: true });

  await build({
    entryPoints: ENTRY_POINTS.map((entry) => path.join(src, entry)),
    outdir,
    outbase: src,
    bundle: true,
    format: 'iife',
    target: ['chrome110', 'firefox121'],
    sourcemap: false,
    minify: false,
    logLevel: 'error',
  });

  for (const asset of STATIC_ASSETS) {
    const from = path.join(src, asset);
    if (!existsSync(from)) continue;
    cpSync(from, path.join(outdir, asset), { recursive: true });
  }

  writeFileSync(
    path.join(outdir, 'manifest.json'),
    JSON.stringify(transform(baseManifest), null, 2)
  );

  if (shouldZip) {
    const zipName = `github-pr-notifications-${browser}-v${version}.zip`;
    execFileSync('zip', ['-r', '-q', path.join(dist, zipName), '.'], { cwd: outdir });
    console.log(`created dist/${zipName}`);
  }
}

console.log(`built dist/chrome and dist/firefox (v${version})`);
