#!/usr/bin/env node
// Build the ieum-parse-sidecar as a macOS universal (fat) binary for release
// packaging: compile both Apple targets through build-sidecar.mjs (preserving
// --remap-path-prefix and local path-leak checks on every slice) and
// lipo-merge them into native/parse-sidecar/target/release/ieum-parse-sidecar.
// Both mac arch packages (arm64 + x64) ship the same fat sidecar.
//
// Dev builds stay on plain `native:build` (host arch only, no extra rustup
// targets required); this script is called by release packaging (root dist:mac
// and mac-build.yml). It needs both targets installed:
//   rustup target add x86_64-apple-darwin aarch64-apple-darwin

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function fatal(msg) {
  console.error(`[parse-sidecar-universal] ERROR: ${msg}`)
  process.exit(1)
}

if (process.platform !== 'darwin') fatal('macOS only (needs lipo)')

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const packageDir = join(scriptsDir, '..')
const buildScript = join(scriptsDir, 'build-sidecar.mjs')
const TARGETS = ['x86_64-apple-darwin', 'aarch64-apple-darwin']

for (const target of TARGETS) {
  console.log(`[parse-sidecar-universal] building target ${target}`)
  execFileSync(process.execPath, [buildScript, '--target', target], {
    cwd: packageDir,
    stdio: 'inherit',
  })
}

const outDir = join(packageDir, 'native/parse-sidecar/target/release')
mkdirSync(outDir, { recursive: true })
const out = join(outDir, 'ieum-parse-sidecar')
execFileSync(
  'lipo',
  [
    '-create',
    ...TARGETS.map((t) =>
      join(packageDir, 'native/parse-sidecar/target', t, 'release/ieum-parse-sidecar'),
    ),
    '-output',
    out,
  ],
  { stdio: 'inherit' },
)

const archs = execFileSync('lipo', ['-archs', out], { encoding: 'utf8' }).trim()
if (!archs.includes('x86_64') || !archs.includes('arm64')) {
  fatal(`merge produced "${archs}" — expected x86_64 + arm64`)
}
console.log(`[parse-sidecar-universal] ${out} (${archs})`)
