import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import {
  ParseSidecarClient,
  SidecarInfraError,
  getInteractiveParseSidecar,
  isParseSidecarEnabled,
  resolveParseSidecarPath,
  stopParseSidecar,
} from '../src/index'

const tempDirs: string[] = []

function makeTempDir(prefix = 'sidecar-client-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function writeFakeSidecarScript(code: string): string {
  const dir = makeTempDir('fake-sidecar-')
  const scriptPath = join(dir, 'fake-sidecar.mjs')
  writeFileSync(scriptPath, code, 'utf8')
  return scriptPath
}

const clientsToCleanup: ParseSidecarClient[] = []

function trackClient(client: ParseSidecarClient): ParseSidecarClient {
  clientsToCleanup.push(client)
  return client
}

afterEach(() => {
  while (clientsToCleanup.length > 0) {
    clientsToCleanup.pop()!.stop()
  }
  stopParseSidecar()
})

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('isParseSidecarEnabled', () => {
  it('defaults to enabled when env var is unset or truthy', () => {
    expect(isParseSidecarEnabled({})).toBe(true)
    expect(isParseSidecarEnabled({ GENOFFICE_PARSE_SIDECAR: '' })).toBe(true)
    expect(isParseSidecarEnabled({ GENOFFICE_PARSE_SIDECAR: '1' })).toBe(true)
    expect(isParseSidecarEnabled({ GENOFFICE_PARSE_SIDECAR: 'on' })).toBe(true)
  })

  it('disables sidecar on 0 or off (case-insensitive, trimmed)', () => {
    expect(isParseSidecarEnabled({ GENOFFICE_PARSE_SIDECAR: '0' })).toBe(false)
    expect(isParseSidecarEnabled({ GENOFFICE_PARSE_SIDECAR: ' 0 ' })).toBe(false)
    expect(isParseSidecarEnabled({ GENOFFICE_PARSE_SIDECAR: 'off' })).toBe(false)
    expect(isParseSidecarEnabled({ GENOFFICE_PARSE_SIDECAR: 'OFF' })).toBe(false)
    expect(isParseSidecarEnabled({ GENOFFICE_PARSE_SIDECAR: '  Off  ' })).toBe(false)
  })
})

describe('resolveParseSidecarPath', () => {
  it('prefers GENOFFICE_PARSE_SIDECAR_PATH when non-empty', () => {
    expect(
      resolveParseSidecarPath({
        env: { GENOFFICE_PARSE_SIDECAR_PATH: '  /custom/ieum-parse-sidecar  ' },
        exists: () => false,
      }),
    ).toBe('/custom/ieum-parse-sidecar')
  })

  it('resolves packaged binary under resourcesPath/native when present', () => {
    const exe = process.platform === 'win32' ? 'ieum-parse-sidecar.exe' : 'ieum-parse-sidecar'
    const expected = join('/app/resources', 'native', exe)
    expect(
      resolveParseSidecarPath({
        env: {},
        resourcesPath: '/app/resources',
        exists: (p) => p === expected,
      }),
    ).toBe(expected)
  })

  it('checks Windows target triple fallback paths on win32', () => {
    const checked: string[] = []
    const found = resolveParseSidecarPath({
      env: {},
      resourcesPath: undefined,
      platform: 'win32',
      exists: (p) => {
        checked.push(p)
        return p.includes('aarch64-pc-windows-msvc')
      },
    })
    expect(found).toContain('aarch64-pc-windows-msvc')
    expect(checked.some((p) => p.includes('x86_64-pc-windows-gnu'))).toBe(true)
  })

  it('returns null when no binary exists anywhere', () => {
    expect(
      resolveParseSidecarPath({
        env: {},
        resourcesPath: '/missing/resources',
        exists: () => false,
      }),
    ).toBeNull()
  })

  it('finds the built workspace binary by default', () => {
    const bin = resolveParseSidecarPath({ env: {} })
    expect(bin).toBeTruthy()
    expect(bin!).toMatch(/ieum-parse-sidecar(\.exe)?$/)
  })
})

describe('ParseSidecarClient live binary protocol', () => {
  it('round-trips extract_file (with and without tokenize), scan_dir, tokenize_text, cancel, and shutdown', async () => {
    const dir = makeTempDir('sidecar-roundtrip-')
    const csvPath = join(dir, 'sample.csv')
    writeFileSync(csvPath, 'name,code\nAlice,02139\n', 'utf8')
    const subDir = join(dir, 'sub')
    mkdirSync(subDir)
    writeFileSync(join(subDir, 'notes.md'), '# Notes\n', 'utf8')

    const client = trackClient(new ParseSidecarClient({ idleTimeoutMs: null }))

    const extracted = await client.extractFile({
      path: csvPath,
      ext: 'csv',
      tokenize: true,
      maxBodyChars: 200,
    })
    expect(extracted).toEqual({
      status: 'ok',
      text: 'name,code\nAlice,02139\n',
      tokens: {
        bi: 'name code alice 02139',
        uni: 'name code alice 02139',
      },
    })
    expect(client.pid()).toBeGreaterThan(0)

    const plain = await client.extractFile({ path: csvPath, ext: 'csv' })
    expect(plain).toEqual({
      status: 'ok',
      text: 'name,code\nAlice,02139\n',
    })

    const scanned = await client.scanDir({ root: dir, maxDepth: 4, maxFiles: 100 })
    expect(scanned.truncated).toBe(false)
    expect(scanned.files.length).toBe(2)
    expect(scanned.files.every((f) => typeof f.mtimeMs === 'number' && f.sizeBytes > 0)).toBe(true)

    const tokens = await client.tokenizeText('ＡＢＣ 한글검색')
    expect(tokens).toEqual({
      bi: 'abc 한글 글검 검색',
      uni: 'abc 한 글 검 색',
    })

    const cancelRes = await client.cancel('nonexistent-request-id')
    expect(cancelRes).toEqual({ cancelled: false })

    // extract_thumbnail round-trip (ok + not_found + malformed_response handled below)
    const zip = new JSZip()
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xaa, 0xbb])
    zip.file('docProps/thumbnail.png', fakePng)
    const docxPath = join(dir, 'thumb.docx')
    writeFileSync(docxPath, await zip.generateAsync({ type: 'nodebuffer' }))
    const thumbOk = await client.extractThumbnail({ path: docxPath, ext: 'docx' })
    expect(thumbOk).toEqual({
      status: 'ok',
      mime: 'image/png',
      dataBase64: fakePng.toString('base64'),
      entry: 'docProps/thumbnail.png',
    })

    const noThumbZip = new JSZip()
    noThumbZip.file('word/document.xml', '<w:document/>')
    const noThumbPath = join(dir, 'no-thumb.docx')
    writeFileSync(noThumbPath, await noThumbZip.generateAsync({ type: 'nodebuffer' }))
    const thumbMissing = await client.extractThumbnail({ path: noThumbPath, ext: 'docx' })
    expect(thumbMissing).toEqual({ status: 'not_found' })

    await client.shutdown()
    expect(client.pid()).toBeNull()
  })

  it('throws SidecarInfraError(malformed_response) on malformed extract_thumbnail result', async () => {
    const script = writeFakeSidecarScript(`
import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const req = JSON.parse(line)
  process.stdout.write(JSON.stringify({
    version: 1,
    requestId: req.requestId,
    ok: true,
    result: { status: 'ok', mime: 'image/png' },
  }) + '\\n')
})
`)
    const client = trackClient(
      new ParseSidecarClient({
        binaryPath: process.execPath,
        args: [script],
        idleTimeoutMs: null,
      }),
    )

    await expect(
      client.extractThumbnail({ path: '/tmp/fake.docx', ext: 'docx' }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof SidecarInfraError && err.code === 'malformed_response',
    )
  })

  it('matches concurrent out-of-order responses by requestId', async () => {
    const script = writeFakeSidecarScript(`
import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const req = JSON.parse(line)
  const delay = req.text === 'slow' ? 120 : 10
  setTimeout(() => {
    process.stdout.write(JSON.stringify({
      version: 1,
      requestId: req.requestId,
      ok: true,
      result: { bi: req.text + '-bi', uni: req.text + '-uni' },
    }) + '\\n')
  }, delay)
})
`)
    const client = trackClient(
      new ParseSidecarClient({
        binaryPath: process.execPath,
        args: [script],
        idleTimeoutMs: null,
      }),
    )

    const order: string[] = []
    const slowP = client.tokenizeText('slow').then((res) => {
      order.push('slow')
      return res
    })
    const fastP = client.tokenizeText('fast').then((res) => {
      order.push('fast')
      return res
    })

    const [slow, fast] = await Promise.all([slowP, fastP])
    expect(slow).toEqual({ bi: 'slow-bi', uni: 'slow-uni' })
    expect(fast).toEqual({ bi: 'fast-bi', uni: 'fast-uni' })
    expect(order).toEqual(['fast', 'slow'])
  })

  it('shuts down automatically after idleTimeoutMs and respawns on next request', async () => {
    const client = trackClient(new ParseSidecarClient({ idleTimeoutMs: 80 }))

    const first = await client.tokenizeText('hello world')
    expect(first.bi).toBe('hello world')
    const firstPid = client.pid()
    expect(firstPid).toBeGreaterThan(0)

    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(client.pid()).toBeNull()

    const second = await client.tokenizeText('second call')
    expect(second.bi).toBe('second call')
    const secondPid = client.pid()
    expect(secondPid).toBeGreaterThan(0)
    expect(secondPid).not.toBe(firstPid)
  })

  it('kills child on timeout when killOnTimeout is true and respawns on next call', async () => {
    const script = writeFakeSidecarScript(`
import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const req = JSON.parse(line)
  if (req.text === 'hang') {
    // intentionally never reply
    return
  }
  process.stdout.write(JSON.stringify({
    version: 1,
    requestId: req.requestId,
    ok: true,
    result: { bi: String(process.pid), uni: req.text },
  }) + '\\n')
})
`)
    const client = trackClient(
      new ParseSidecarClient({
        binaryPath: process.execPath,
        args: [script],
        requestTimeoutMs: 120,
        killOnTimeout: true,
        idleTimeoutMs: null,
      }),
    )

    const before = await client.tokenizeText('ok', { timeoutMs: 5_000 })
    const firstPid = client.pid()
    expect(firstPid).toBe(Number(before.bi))

    await expect(client.tokenizeText('hang')).rejects.toMatchObject({
      name: 'SidecarInfraError',
      code: 'request_timeout',
    })
    expect(client.pid()).toBeNull()

    const after = await client.tokenizeText('recovered', { timeoutMs: 5_000 })
    expect(after.uni).toBe('recovered')
    expect(client.pid()).not.toBe(firstPid)
  })

  it('stop() immediately terminates child and rejects pending requests with SidecarInfraError', async () => {
    const script = writeFakeSidecarScript(`
import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin })
rl.on('line', () => {
  // hold request open
})
`)
    const client = trackClient(
      new ParseSidecarClient({
        binaryPath: process.execPath,
        args: [script],
        idleTimeoutMs: null,
      }),
    )

    const pending = client.tokenizeText('wait')
    expect(client.pid()).toBeGreaterThan(0)
    client.stop()
    expect(client.pid()).toBeNull()

    await expect(pending).rejects.toSatisfy(
      (err: unknown) => err instanceof SidecarInfraError && err.code === 'stopped',
    )
  })

  it('triggers SidecarInfraError on protocol version mismatch', async () => {
    const script = writeFakeSidecarScript(`
import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const req = JSON.parse(line)
  process.stdout.write(JSON.stringify({
    version: 99,
    requestId: req.requestId,
    ok: true,
    result: { bi: 'x', uni: 'x' },
  }) + '\\n')
})
`)
    const client = trackClient(
      new ParseSidecarClient({
        binaryPath: process.execPath,
        args: [script],
        idleTimeoutMs: null,
      }),
    )

    await expect(client.tokenizeText('hello')).rejects.toSatisfy(
      (err: unknown) => err instanceof SidecarInfraError && err.code === 'protocol_mismatch',
    )
    expect(client.pid()).toBeNull()
  })

  it('triggers SidecarInfraError on malformed stdout line', async () => {
    const script = writeFakeSidecarScript(`
import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin })
rl.on('line', () => {
  process.stdout.write('not-valid-json\\n')
})
`)
    const client = trackClient(
      new ParseSidecarClient({
        binaryPath: process.execPath,
        args: [script],
        idleTimeoutMs: null,
      }),
    )

    await expect(client.tokenizeText('hello')).rejects.toSatisfy(
      (err: unknown) => err instanceof SidecarInfraError && err.code === 'malformed_response',
    )
    expect(client.pid()).toBeNull()
  })

  it('triggers SidecarInfraError when child exits unexpectedly mid-request', async () => {
    const script = writeFakeSidecarScript(`
import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin })
rl.on('line', () => {
  process.stderr.write('simulated crash\\n')
  process.exit(42)
})
`)
    const client = trackClient(
      new ParseSidecarClient({
        binaryPath: process.execPath,
        args: [script],
        idleTimeoutMs: null,
      }),
    )

    await expect(client.tokenizeText('boom')).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SidecarInfraError &&
        err.code === 'process_exited' &&
        err.message.includes('simulated crash'),
    )
    expect(client.pid()).toBeNull()
  })

  it('supports interactive singleton lifecycle and lowPriority option', async () => {
    const lowPrio = trackClient(new ParseSidecarClient({ lowPriority: true, idleTimeoutMs: null }))
    expect((await lowPrio.tokenizeText('priority check')).bi).toBe('priority check')

    const singleton = getInteractiveParseSidecar()
    expect(getInteractiveParseSidecar()).toBe(singleton)
    expect((await singleton.tokenizeText('singleton')).bi).toBe('singleton')
    expect(singleton.pid()).toBeGreaterThan(0)
    stopParseSidecar()
    expect(singleton.pid()).toBeNull()
  })
})
