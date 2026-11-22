#!/usr/bin/env node
/**
 * Rebuilds packages/whiteboard-engine/pkg: the Rust Whiteboard WebAssembly core.
 *
 *   node tools/build-whiteboard-engine.mjs
 *
 * Runs `wasm-pack build --target web --release --out-dir ../pkg` with remapped path
 * prefixes so no local filesystem paths leak into the compiled WASM binary, removes
 * generated `.gitignore` / `package.json` inside `pkg/`, verifies zero local path
 * leaks, and writes `pkg/manifest.json` with deterministic `sourceSha256` and `wasmSha256`.
 *
 * Normal app builds and CI never run this script; they consume the committed `pkg/`
 * and verify freshness via `packages/whiteboard-engine/tests/freshness.test.ts`.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_ROOT = join(ROOT, 'packages', 'whiteboard-engine')
const CRATE_DIR = join(PKG_ROOT, 'rust')
const PKG_DIR = join(PKG_ROOT, 'pkg')
const WASM_FILE = join(PKG_DIR, 'whiteboard_engine_bg.wasm')
const MANIFEST_FILE = join(PKG_DIR, 'manifest.json')

const REQUIRED_PKG_FILES = [
  'whiteboard_engine.js',
  'whiteboard_engine.d.ts',
  'whiteboard_engine_bg.wasm',
  'whiteboard_engine_bg.wasm.d.ts',
]

function collectSourceFiles(crateDir) {
  const files = []
  for (const top of ['Cargo.toml', 'Cargo.lock']) {
    const abs = join(crateDir, top)
    if (!existsSync(abs)) {
      throw new Error(`Missing required source file: ${abs}`)
    }
    files.push(top)
  }

  const srcDir = join(crateDir, 'src')
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry)
      const st = statSync(abs)
      if (st.isDirectory()) {
        walk(abs)
      } else if (entry.endsWith('.rs')) {
        files.push(relative(crateDir, abs).replace(/\\/g, '/'))
      }
    }
  }
  walk(srcDir)
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return files
}

function computeSourceSha256(crateDir) {
  const hash = createHash('sha256')
  for (const rel of collectSourceFiles(crateDir)) {
    const raw = readFileSync(join(crateDir, rel), 'utf8')
    const normalized = raw.replace(/\r\n/g, '\n')
    hash.update(`${rel}\0`)
    hash.update(normalized, 'utf8')
    hash.update('\0')
  }
  return hash.digest('hex')
}

function buildEnv(cargoHome, crateDir, rootDir) {
  const cargoBin = join(cargoHome, 'bin')
  const currentPath = process.env.PATH ?? ''
  const nextPath =
    existsSync(cargoBin) && !currentPath.split(delimiter).includes(cargoBin)
      ? `${cargoBin}${delimiter}${currentPath}`
      : currentPath

  const remaps = new Set()
  const addRemap = (from, to) => {
    remaps.add(`--remap-path-prefix=${from}=${to}`)
    const posix = from.replace(/\\/g, '/')
    if (posix !== from) {
      remaps.add(`--remap-path-prefix=${posix}=${to}`)
    }
  }
  addRemap(cargoHome, '/cargo')
  addRemap(crateDir, '/whiteboard-engine')
  addRemap(rootDir, '/repo')

  const existingFlags = (process.env.RUSTFLAGS ?? '').trim()
  const rustflags = [existingFlags, ...remaps].filter(Boolean).join(' ')

  return {
    ...process.env,
    PATH: nextPath,
    RUSTFLAGS: rustflags,
  }
}

function resolveWasmPack(cargoHome) {
  const exe = process.platform === 'win32' ? 'wasm-pack.exe' : 'wasm-pack'
  const candidate = join(cargoHome, 'bin', exe)
  return existsSync(candidate) ? candidate : 'wasm-pack'
}

function checkForLocalPathLeaks(wasm, cargoHome, crateDir, rootDir) {
  const home = homedir()
  const user = basename(home)
  const candidates = new Set()
  for (const raw of [home, cargoHome, crateDir, rootDir]) {
    if (!raw) continue
    candidates.add(raw)
    candidates.add(raw.replace(/\\/g, '/'))
  }
  if (user && user.length >= 2) {
    candidates.add(`/Users/${user}`)
    candidates.add(`/home/${user}`)
    candidates.add(`\\Users\\${user}`)
    candidates.add(`/Users/${user}/`)
    candidates.add(`\\Users\\${user}\\`)
  }
  for (const leak of candidates) {
    if (wasm.includes(Buffer.from(leak, 'utf8'))) {
      throw new Error(`whiteboard_engine_bg.wasm still contains the local path: ${leak}`)
    }
  }
  const latin1 = wasm.toString('latin1')
  const driveMatch = /[A-Za-z]:\\(?:Users|home|github|work|src|ieum)/i.exec(latin1)
  if (driveMatch) {
    throw new Error(
      `whiteboard_engine_bg.wasm still contains a Windows local path: ${driveMatch[0]}`,
    )
  }
}

const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo')
const env = buildEnv(cargoHome, CRATE_DIR, ROOT)
const wasmPack = resolveWasmPack(cargoHome)

console.log(`> ${wasmPack} build --target web --release --out-dir ../pkg`)
execFileSync(wasmPack, ['build', '--target', 'web', '--release', '--out-dir', '../pkg'], {
  cwd: CRATE_DIR,
  env,
  stdio: 'inherit',
})

for (const unwanted of ['.gitignore', 'package.json', 'README.md']) {
  const target = join(PKG_DIR, unwanted)
  if (existsSync(target)) {
    rmSync(target, { force: true })
  }
}

for (const required of REQUIRED_PKG_FILES) {
  const target = join(PKG_DIR, required)
  if (!existsSync(target)) {
    throw new Error(`Expected wasm-pack output missing: ${target}`)
  }
}

const wasm = readFileSync(WASM_FILE)
checkForLocalPathLeaks(wasm, cargoHome, CRATE_DIR, ROOT)

const wasmSha256 = createHash('sha256').update(wasm).digest('hex')
const sourceSha256 = computeSourceSha256(CRATE_DIR)
const manifest = { wasmSha256, sourceSha256 }
writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log(
  `packages/whiteboard-engine/pkg: built (${wasm.length} bytes, wasmSha256=${wasmSha256.slice(0, 12)}, sourceSha256=${sourceSha256.slice(0, 12)})`,
)
