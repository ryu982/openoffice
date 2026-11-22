import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getInteractiveParseSidecar,
  ParseSidecarClient,
  stopParseSidecar,
} from '@genoffice/file-parse'
import { setRedactExt } from '../../../packages/pptx-engine/src/redaction-xml'
import {
  extractText,
  MAX_EXTRACT_BYTES,
  ZIP_INDEX_UNLIMITED_EXTS,
} from '../src/main/file-index/extract'
import { FileIndexer } from '../src/main/file-index/indexer'
import { FileIndexStore } from '../src/main/file-index/store'
import * as tokenizeModule from '../src/main/file-index/tokenize'

const REAL_WORKER = join(__dirname, '../src/main/file-index/extract-worker.ts')
const SPY_WORKER = join(__dirname, 'file-index-test-worker.mjs')

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

async function makeDocx(text: string): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'word/document.xml',
    `${XML_DECL}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function makeRedactedPptx(secret: string, label: string): Promise<Uint8Array> {
  const zip = new JSZip()
  const rPr = setRedactExt('<a:rPr lang="en-US"/>', label)
  zip.file(
    'ppt/slides/slide1.xml',
    `${XML_DECL}<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<p:cSld><p:spTree><p:sp><p:txBody>' +
      `<a:p><a:r><a:t>Public intro </a:t></a:r><a:r>${rPr}<a:t>${secret}</a:t></a:r></a:p>` +
      '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

let dir: string
let storeDir: string
let store: FileIndexStore
let indexer: FileIndexer | null = null
const savedEnv: Record<string, string | undefined> = {}

function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ieum-file-index-sidecar-'))
  storeDir = mkdtempSync(join(tmpdir(), 'ieum-file-index-db-'))
  store = new FileIndexStore(join(storeDir, 'index.db'))
})

afterEach(() => {
  indexer?.stop()
  indexer = null
  stopParseSidecar()
  store.close()
  rmSync(dir, { recursive: true, force: true })
  rmSync(storeDir, { recursive: true, force: true })
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete savedEnv[k]
  }
  vi.restoreAllMocks()
})

describe('file-index sidecar integration', () => {
  it('lifts the 64 MiB cap only for the 7 ZIP document formats', async () => {
    expect([...ZIP_INDEX_UNLIMITED_EXTS].sort()).toEqual([
      'docx',
      'epub',
      'odt',
      'pptx',
      'xlsm',
      'xlsx',
      'xmind',
    ])
    expect(MAX_EXTRACT_BYTES).toBe(64 * 1024 * 1024)

    // Non-ZIP > 64 MiB stays name-only
    const bigTxt = join(dir, 'huge.txt')
    const { openSync, ftruncateSync, closeSync } = await import('node:fs')
    const fd = openSync(bigTxt, 'w')
    ftruncateSync(fd, MAX_EXTRACT_BYTES + 1024)
    closeSync(fd)
    expect(await extractText(bigTxt)).toEqual({ kind: 'name-only' })

    // ZIP document > 64 MiB extracts body text instead of falling back to name-only
    const zip = new JSZip()
    zip.file(
      '[Content_Types].xml',
      `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    )
    zip.file(
      '_rels/.rels',
      `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    )
    zip.file(
      'word/document.xml',
      `${XML_DECL}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        '<w:body><w:p><w:r><w:t>LargeMediaDocxBodyToken</w:t></w:r></w:p></w:body></w:document>',
    )
    // Stored media entry pushing the ZIP over 64 MiB without slow deflate
    zip.file('word/media/large.bin', Buffer.alloc(65 * 1024 * 1024), { compression: 'STORE' })
    const bigDocx = join(dir, 'huge-media.docx')
    writeFileSync(bigDocx, await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }))
    const extracted = await extractText(bigDocx)
    expect(extracted.kind).toBe('text')
    if (extracted.kind === 'text') {
      expect(extracted.text).toContain('LargeMediaDocxBodyToken')
    }
  }, 30_000)

  it('uses pretokenized body in FileIndexStore.upsert without running main-thread tokenize on body', () => {
    const spy = vi.spyOn(tokenizeModule, 'tokenize')
    store.upsert(
      { path: join(dir, 'report.docx'), mtimeMs: 100, sizeBytes: 50 },
      '인공지능 보고서 초안',
      'ok',
      { bi: '인공 공지 지능 보고 고서 초안', uni: '인 공 지 능 보 고 서 초 안' },
    )
    // tokenize is called for name and dirname only (2 calls), never for body
    expect(spy).toHaveBeenCalledTimes(2)
    expect(store.search('인공').total).toBe(1)
    expect(store.search('초안').total).toBe(1)
  })

  it('indexes ZIP documents in parallel via dedicated sidecar with pretokenization and scan_dir', async () => {
    const f1 = join(dir, 'alpha.docx')
    const f2 = join(dir, 'beta.docx')
    const f3 = join(dir, 'table.csv')
    writeFileSync(f1, await makeDocx('양자컴퓨팅 연구 요약'))
    writeFileSync(f2, await makeDocx('신재생에너지 보고서'))
    writeFileSync(f3, 'item,qty\n사과,42\n')

    indexer = new FileIndexer(
      store,
      SPY_WORKER,
      { roots: () => [dir], extraPaths: () => [] },
      30_000,
      1024,
      { concurrency: 2 },
    )
    const askSpy = vi.spyOn(indexer as unknown as { ask: (r: unknown) => unknown }, 'ask')
    await indexer.scan()
    await vi.waitFor(
      () => {
        expect(indexer!.progress()).toMatchObject({ pending: 0, scanning: false })
        expect(store.listAll().get(f1)?.status).toBe('ok')
        expect(store.listAll().get(f2)?.status).toBe('ok')
        expect(store.listAll().get(f3)?.status).toBe('ok')
      },
      { timeout: 10_000, interval: 25 },
    )
    // Neither scan nor sidecar-handled files should hit the fallback Worker
    expect(askSpy).not.toHaveBeenCalled()
    expect(store.search('양자컴퓨팅').hits.map((h) => h.name)).toEqual(['alpha.docx'])
    expect(store.search('신재생에너지').hits.map((h) => h.name)).toEqual(['beta.docx'])
    expect(store.search('사과').hits.map((h) => h.name)).toEqual(['table.csv'])
  })

  it('gradually re-extracts previously name-only ZIP rows without bumping EXTRACT_VERSION', async () => {
    const f1 = join(dir, 'previously-large.docx')
    const bytes = await makeDocx('점진재추출 검증문구')
    writeFileSync(f1, bytes)
    const f2 = join(dir, 'unchanged.pdf')
    writeFileSync(f2, '%PDF-1.4\n')

    // Seed DB with same mtime/size as disk, both marked name-only (as if skipped under old 64 MiB cap)
    const st1 = (await import('node:fs')).statSync(f1)
    const st2 = (await import('node:fs')).statSync(f2)
    store.upsert({ path: f1, mtimeMs: st1.mtimeMs, sizeBytes: st1.size }, null, 'name-only')
    store.upsert({ path: f2, mtimeMs: st2.mtimeMs, sizeBytes: st2.size }, null, 'name-only')

    indexer = new FileIndexer(
      store,
      SPY_WORKER,
      { roots: () => [dir], extraPaths: () => [] },
      30_000,
    )
    const askSpy = vi.spyOn(indexer as unknown as { ask: (r: unknown) => unknown }, 'ask')
    await indexer.scan()
    await vi.waitFor(
      () => {
        expect(indexer!.progress()).toMatchObject({ pending: 0, scanning: false })
        expect(store.listAll().get(f1)?.status).toBe('ok')
      },
      { timeout: 10_000, interval: 25 },
    )
    expect(store.search('점진재추출').total).toBe(1)
    // Non-ZIP name-only file with unchanged mtime/size stays untouched
    expect(store.listAll().get(f2)?.status).toBe('name-only')
    expect(askSpy).not.toHaveBeenCalled()
  })

  it('never falls back to Worker when sidecar rejects a file (content_mismatch)', async () => {
    const fakeDocx = join(dir, 'fake.docx')
    writeFileSync(fakeDocx, 'not a zip archive at all')

    indexer = new FileIndexer(
      store,
      SPY_WORKER,
      { roots: () => [dir], extraPaths: () => [] },
      30_000,
    )
    const askSpy = vi.spyOn(indexer as unknown as { ask: (r: unknown) => unknown }, 'ask')
    await indexer.scan()
    await vi.waitFor(
      () => {
        expect(indexer!.progress()).toMatchObject({ pending: 0, scanning: false })
        expect(store.listAll().get(fakeDocx)?.status).toBe('error')
      },
      { timeout: 10_000, interval: 25 },
    )
    expect(askSpy).not.toHaveBeenCalled()
  })

  it('delegates redacted pptx to Worker and never indexes withheld secret words', async () => {
    const secret = 'TOP_SECRET_INDEX_TOKEN_98765'
    const deck = join(dir, 'secret.pptx')
    writeFileSync(deck, await makeRedactedPptx(secret, 'hidden client'))

    // Worker double that runs real extractText via TS fallback
    const realExtract = await extractText(deck)
    expect(realExtract.kind).toBe('text')
    if (realExtract.kind === 'text') {
      expect(realExtract.text).toContain('{{hidden client}}')
      expect(realExtract.text).not.toContain(secret)
    }

    // Verify FileIndexer delegates redaction_present to Worker (not indexing secret)
    // and passes GENOFFICE_PARSE_SIDECAR=0 so the worker never spawns a third sidecar.
    const workerSpyPath = join(dir, 'redact-worker.mjs')
    const envCapturePath = join(dir, 'worker-env.txt')
    writeFileSync(
      workerSpyPath,
      [
        "import { writeFileSync } from 'node:fs'",
        "import { parentPort } from 'node:worker_threads'",
        `writeFileSync(${JSON.stringify(envCapturePath)}, String(process.env.GENOFFICE_PARSE_SIDECAR ?? 'unset'))`,
        'parentPort.on("message", (req) => {',
        '  parentPort.postMessage({ id: req.id, type: "extract", result: { kind: "text", text: "Public intro {{hidden client}}" } })',
        '})',
      ].join('\n'),
    )
    indexer = new FileIndexer(
      store,
      workerSpyPath,
      { roots: () => [dir], extraPaths: () => [] },
      30_000,
    )
    await indexer.scan()
    await vi.waitFor(
      () => {
        expect(indexer!.progress()).toMatchObject({ pending: 0, scanning: false })
        expect(store.listAll().get(deck)?.status).toBe('ok')
      },
      { timeout: 10_000, interval: 25 },
    )
    expect(readFileSync(envCapturePath, 'utf8')).toBe('0')
    expect(store.search(secret).total).toBe(0)
    expect(store.search('hidden').total).toBe(1)
  })

  it('falls back cleanly to Worker when GENOFFICE_PARSE_SIDECAR=0', async () => {
    setEnv('GENOFFICE_PARSE_SIDECAR', '0')
    const f1 = join(dir, 'fallback.docx')
    writeFileSync(f1, await makeDocx('hello'))

    indexer = new FileIndexer(
      store,
      SPY_WORKER,
      { roots: () => [dir], extraPaths: () => [] },
      30_000,
    )
    await indexer.scan()
    await vi.waitFor(
      () => {
        expect(indexer!.progress()).toMatchObject({ pending: 0, scanning: false })
        expect(store.listAll().get(f1)?.status).toBe('ok')
      },
      { timeout: 10_000, interval: 25 },
    )
    expect(store.search('body').total).toBe(1)
  })

  it('isolates indexer sidecar timeout/restart from interactive sidecar instance', async () => {
    const f1 = join(dir, 'hang.docx')
    const f2 = join(dir, 'interactive.docx')
    writeFileSync(f1, await makeDocx('indexer doc'))
    writeFileSync(f2, await makeDocx('interactive doc'))

    // Fake sidecar script for indexer that hangs on extract_file (never replies)
    const hangScript = join(dir, 'hang-sidecar.mjs')
    writeFileSync(
      hangScript,
      [
        "import { createInterface } from 'node:readline'",
        'const rl = createInterface({ input: process.stdin })',
        'rl.on("line", (line) => {',
        '  const req = JSON.parse(line)',
        '  if (req.command === "scan_dir") {',
        `    process.stdout.write(JSON.stringify({ version: 1, requestId: req.requestId, ok: true, result: { files: [{ path: ${JSON.stringify(f1)}, mtimeMs: 1, sizeBytes: 10 }], truncated: false } }) + "\\n")`,
        '  }',
        '  // hang on extract_file to trigger requestTimeoutMs',
        '})',
      ].join('\n'),
    )

    const interactive = getInteractiveParseSidecar()
    expect(interactive).not.toBeNull()
    const beforeInteractive = await interactive!.extractFile({ path: f2, ext: 'docx' })
    expect(beforeInteractive.status).toBe('ok')
    const interactivePid = interactive!.pid()
    expect(interactivePid).toBeGreaterThan(0)

    const hangingIndexerClient = new ParseSidecarClient({
      binaryPath: process.execPath,
      args: [hangScript],
      requestTimeoutMs: 300,
      killOnTimeout: true,
      idleTimeoutMs: null,
    })

    indexer = new FileIndexer(
      store,
      SPY_WORKER,
      { roots: () => [dir], extraPaths: () => [] },
      300,
      1024,
      { sidecarClient: hangingIndexerClient },
    )
    await indexer.scan()
    await vi.waitFor(
      () => {
        expect(indexer!.progress()).toMatchObject({ pending: 0, scanning: false })
        expect(store.listAll().get(f1)?.status).toBe('error')
      },
      { timeout: 5_000, interval: 25 },
    )

    // Interactive sidecar remained completely untouched (same PID, still answers)
    expect(interactive!.pid()).toBe(interactivePid)
    const afterInteractive = await interactive!.extractFile({ path: f2, ext: 'docx' })
    expect(afterInteractive.status).toBe('ok')
    if (afterInteractive.status === 'ok') {
      expect(afterInteractive.text).toContain('interactive doc')
    }

    // Ensure REAL_WORKER reference stays valid (unused lint avoidance)
    expect(typeof REAL_WORKER).toBe('string')
  })
})
