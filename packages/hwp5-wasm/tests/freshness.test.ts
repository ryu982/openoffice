import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CRATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(CRATE_DIR, '..', '..')
const PKG_DIR = join(CRATE_DIR, 'pkg')
const WASM_PATH = join(PKG_DIR, 'hwp5_wasm_bg.wasm')
const MANIFEST_PATH = join(PKG_DIR, 'manifest.json')

function collectSourceFiles(crateDir: string): string[] {
  const files: string[] = ['Cargo.toml', 'Cargo.lock']
  const srcDir = join(crateDir, 'src')
  const walk = (dir: string): void => {
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

function computeSourceSha256(crateDir: string): string {
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

describe('hwp5-wasm prebuilt pkg freshness and hygiene', () => {
  it('contains all expected committed pkg files and no pkg/.gitignore', () => {
    for (const name of [
      'hwp5_wasm.js',
      'hwp5_wasm.d.ts',
      'hwp5_wasm_bg.wasm',
      'hwp5_wasm_bg.wasm.d.ts',
      'manifest.json',
    ]) {
      expect(existsSync(join(PKG_DIR, name)), `missing pkg/${name}`).toBe(true)
    }
    expect(existsSync(join(PKG_DIR, '.gitignore'))).toBe(false)
    expect(existsSync(join(PKG_DIR, 'package.json'))).toBe(false)
  })

  it('matches sourceSha256 and wasmSha256 recorded in pkg/manifest.json', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
      wasmSha256: string
      sourceSha256: string
    }
    const actualSourceSha256 = computeSourceSha256(CRATE_DIR)
    const actualWasmSha256 = createHash('sha256').update(readFileSync(WASM_PATH)).digest('hex')

    expect(manifest.sourceSha256).toBe(actualSourceSha256)
    expect(manifest.wasmSha256).toBe(actualWasmSha256)
  })

  it('contains zero local filesystem path leaks in hwp5_wasm_bg.wasm', () => {
    const wasm = readFileSync(WASM_PATH)
    const home = homedir()
    const cargoHome = process.env.CARGO_HOME ?? join(home, '.cargo')
    const user = basename(home)

    const forbidden = new Set<string>()
    for (const path of [home, cargoHome, CRATE_DIR, REPO_ROOT]) {
      if (!path) continue
      forbidden.add(path)
      forbidden.add(path.replace(/\\/g, '/'))
    }
    if (user && user.length >= 2) {
      forbidden.add(`/Users/${user}`)
      forbidden.add(`/home/${user}`)
      forbidden.add(`\\Users\\${user}`)
    }

    for (const needle of forbidden) {
      expect(wasm.includes(Buffer.from(needle, 'utf8')), `local path leaked: ${needle}`).toBe(false)
    }

    const latin1 = wasm.toString('latin1')
    expect(/[A-Za-z]:\\(?:Users|home|github|work|src|ieum)/i.test(latin1)).toBe(false)
  })
})
