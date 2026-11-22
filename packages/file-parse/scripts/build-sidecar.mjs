#!/usr/bin/env node
/**
 * Builds the native Rust `ieum-parse-sidecar` release binary.
 *
 *   node scripts/build-sidecar.mjs [--target <triple>] [...extra cargo args]
 *
 * Remaps local filesystem path prefixes (HOME, CARGO_HOME, RUSTUP_HOME, crate
 * dir, and repo root) via `--remap-path-prefix` so no local paths leak into the
 * compiled executable, while explicitly preserving `-C target-feature=+crt-static`
 * on Windows MSVC targets (since setting RUSTFLAGS/CARGO_ENCODED_RUSTFLAGS
 * overrides `.cargo/config.toml`).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(PACKAGE_DIR, '..', '..')
const CRATE_DIR = join(PACKAGE_DIR, 'native', 'parse-sidecar')

const extraArgs = process.argv.slice(2)

function parseTargetTriple(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && i + 1 < args.length) {
      return args[i + 1]
    }
    if (args[i].startsWith('--target=')) {
      return args[i].slice('--target='.length)
    }
  }
  return null
}

function detectHostTriple(env) {
  try {
    const out = execFileSync('rustc', ['-vV'], { env, encoding: 'utf8' })
    const match = /^host:\s*(\S+)/m.exec(out)
    if (match) return match[1]
  } catch {
    // Fall back to platform default below if rustc -vV is unavailable
  }
  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
  }
  return ''
}

function withCargoOnPath(cargoHome) {
  const cargoBin = join(cargoHome, 'bin')
  const currentPath = process.env.PATH ?? ''
  if (existsSync(cargoBin) && !currentPath.split(delimiter).includes(cargoBin)) {
    return `${cargoBin}${delimiter}${currentPath}`
  }
  return currentPath
}

function collectExistingRustflags() {
  if (process.env.CARGO_ENCODED_RUSTFLAGS) {
    return process.env.CARGO_ENCODED_RUSTFLAGS.split('\x1f').filter(Boolean)
  }
  if (process.env.RUSTFLAGS) {
    return process.env.RUSTFLAGS.trim().split(/\s+/).filter(Boolean)
  }
  return []
}

function buildRustflags(cargoHome, rustupHome, home, targetTriple) {
  const flags = collectExistingRustflags()

  // Apply broader prefixes first and more specific prefixes later because rustc
  // evaluates `--remap-path-prefix` in reverse order (last matching prefix wins).
  const addRemap = (from, to) => {
    if (!from) return
    const nativeArg = `--remap-path-prefix=${from}=${to}`
    if (!flags.includes(nativeArg)) flags.push(nativeArg)
    const posix = from.replace(/\\/g, '/')
    if (posix !== from) {
      const posixArg = `--remap-path-prefix=${posix}=${to}`
      if (!flags.includes(posixArg)) flags.push(posixArg)
    }
  }

  addRemap(home, '/home')
  addRemap(REPO_ROOT, '/repo')
  addRemap(cargoHome, '/cargo')
  addRemap(rustupHome, '/rustup')
  addRemap(CRATE_DIR, '/parse-sidecar')

  // Setting CARGO_ENCODED_RUSTFLAGS overrides `.cargo/config.toml` rustflags,
  // so re-apply static CRT linking on Windows MSVC targets here.
  if (targetTriple.endsWith('-windows-msvc')) {
    const hasCrtStatic = flags.some((f) => f.includes('target-feature=+crt-static'))
    if (!hasCrtStatic) {
      flags.push('-C', 'target-feature=+crt-static')
    }
    // Strip any absolute local PDB path that MSVC link.exe may embed.
    flags.push('-C', 'link-arg=/PDBALTPATH:%_PDB%')
  }

  return flags
}

function checkForLocalPathLeaks(binaryBuf, binaryPath, cargoHome, rustupHome, home) {
  const user = basename(home)
  const candidates = new Set()
  for (const raw of [home, cargoHome, rustupHome, CRATE_DIR, REPO_ROOT]) {
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
    if (binaryBuf.includes(Buffer.from(leak, 'utf8'))) {
      throw new Error(`${binaryPath} still contains local path: ${leak}`)
    }
  }
}

const home = homedir()
const cargoHome = process.env.CARGO_HOME ?? join(home, '.cargo')
const rustupHome = process.env.RUSTUP_HOME ?? join(home, '.rustup')
const pathEnv = withCargoOnPath(cargoHome)
const baseEnv = { ...process.env, PATH: pathEnv }

const requestedTarget = parseTargetTriple(extraArgs)
const effectiveTarget = requestedTarget ?? detectHostTriple(baseEnv)
const rustflags = buildRustflags(cargoHome, rustupHome, home, effectiveTarget)

const buildEnv = {
  ...baseEnv,
  CARGO_ENCODED_RUSTFLAGS: rustflags.join('\x1f'),
}
delete buildEnv.RUSTFLAGS

const cargoArgs = [
  'build',
  '--release',
  '--manifest-path',
  'native/parse-sidecar/Cargo.toml',
  '--config',
  'native/parse-sidecar/.cargo/config.toml',
  ...extraArgs,
]

console.log(`[parse-sidecar] cargo ${cargoArgs.join(' ')}`)
execFileSync('cargo', cargoArgs, {
  cwd: PACKAGE_DIR,
  env: buildEnv,
  stdio: 'inherit',
})

const isWindowsTarget = effectiveTarget
  ? effectiveTarget.includes('windows')
  : process.platform === 'win32'
const exeName = isWindowsTarget ? 'ieum-parse-sidecar.exe' : 'ieum-parse-sidecar'
const binaryPath = requestedTarget
  ? join(CRATE_DIR, 'target', requestedTarget, 'release', exeName)
  : join(CRATE_DIR, 'target', 'release', exeName)

if (!existsSync(binaryPath)) {
  throw new Error(`Expected parse-sidecar binary missing: ${binaryPath}`)
}

const binaryBuf = readFileSync(binaryPath)
checkForLocalPathLeaks(binaryBuf, binaryPath, cargoHome, rustupHome, home)
console.log(
  `[parse-sidecar] built ${binaryPath} (${binaryBuf.length} bytes, zero local path leaks)`,
)
