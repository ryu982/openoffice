/**
 * File-index 4-pillar risk verification suite:
 * 1. scan_dir differential equivalence (Rust sidecar vs TS scanFiles) including hidden dirs & symlinks
 * 2. CJK 14-range + NFKC + fullwidth + combining marks + emoji tokenizer differential equivalence
 *    + 1,000,000-character body tokenization benchmark (Rust vs TS)
 * 3. Timeout-restart isolation: indexing sidecar timeout/kill does NOT disrupt interactive requests
 * 4. 105 MiB media-heavy DOCX end-to-end indexing + synchronous FileIndexStore.search()
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { performance } from 'node:perf_hooks'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getInteractiveParseSidecar,
  parseFileToText,
  ParseSidecarClient,
  resolveParseSidecarPath,
  stopParseSidecar,
} from '@genoffice/file-parse'
import { FileIndexer } from '../src/main/file-index/indexer'
import { scanFiles } from '../src/main/file-index/scan'
import { FileIndexStore } from '../src/main/file-index/store'
import { toIndexText, tokenize } from '../src/main/file-index/tokenize'

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

let workDir: string
let storeDir: string
let store: FileIndexStore
let indexer: FileIndexer | null = null

async function makeDocx(text: string, mediaMiB = 0): Promise<Uint8Array> {
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
  if (mediaMiB > 0) {
    zip.file('word/media/clip.bin', Buffer.alloc(mediaMiB * 1024 * 1024), { compression: 'STORE' })
  }
  return zip.generateAsync({ type: 'uint8array', compression: mediaMiB > 0 ? 'STORE' : 'DEFLATE' })
}

beforeEach(() => {
  expect(resolveParseSidecarPath(), 'compiled ieum-parse-sidecar binary must exist').toBeTruthy()
  workDir = mkdtempSync(join(tmpdir(), 'ieum-index-risk-'))
  storeDir = mkdtempSync(join(tmpdir(), 'ieum-index-risk-db-'))
  store = new FileIndexStore(join(storeDir, 'index.db'))
})

afterEach(() => {
  indexer?.stop()
  indexer = null
  stopParseSidecar()
  store.close()
  rmSync(workDir, { recursive: true, force: true })
  rmSync(storeDir, { recursive: true, force: true })
})

describe('file-index Track A risk verification', () => {
  it('matches TS scanFiles() identically for nested trees, hidden entries, ignored dirs, and symlinked dirs', async () => {
    const root = join(workDir, 'tree')
    mkdirSync(join(root, 'docs', 'nested'), { recursive: true })
    mkdirSync(join(root, '.git'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(workDir, 'external-target'), { recursive: true })

    writeFileSync(join(root, 'readme.md'), '# hello')
    writeFileSync(join(root, 'data.csv'), 'a,b\n1,2\n')
    writeFileSync(join(root, 'docs', 'spec.docx'), 'placeholder')
    writeFileSync(join(root, 'docs', 'nested', 'chart.drawio.svg'), '<svg/>')
    writeFileSync(join(root, 'docs', 'ignored.exe'), 'bin')
    writeFileSync(join(root, '.hidden.md'), 'hidden')
    writeFileSync(join(root, '.git', 'HEAD.txt'), 'ref')
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.md'), 'dep')
    writeFileSync(join(workDir, 'external-target', 'escape.md'), 'outside')

    // Best-effort directory symlink/junction (Windows uses junction without admin)
    try {
      symlinkSync(
        join(workDir, 'external-target'),
        join(root, 'linked-dir'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    } catch {
      // Ignore if environment forbids symlinks/junctions
    }

    const tsResult = scanFiles(root)
    const client = new ParseSidecarClient()
    try {
      const rustResult = await client.scanDir({ root })
      expect(rustResult.truncated).toBe(tsResult.truncated)
      const tsPaths = tsResult.files.map((f) => normalize(f.path)).sort()
      const rustPaths = rustResult.files.map((f) => normalize(f.path)).sort()
      expect(rustPaths).toEqual(tsPaths)
      expect(rustPaths.some((p) => p.includes('escape.md'))).toBe(false)
      expect(rustPaths.some((p) => p.includes('.hidden.md'))).toBe(false)
      expect(rustPaths.some((p) => p.includes('node_modules'))).toBe(false)
    } finally {
      await client.shutdown()
    }
  })

  it('matches TS tokenize() identically across all 14 CJK ranges, NFKC, combining marks, emojis, and 1M chars', async () => {
    const corpus: string[] = [
      // Hangul syllables, compat jamo, jamo, jamo ext-A
      '한글 문서 검색 테스트 ㄱㄴㄷ 각 \uA960\uA961',
      // Hiragana, Katakana, Halfwidth Katakana, CJK iteration marks (々 〆 〇)
      'ひらがな カタカナ ｶﾀｶﾅ 佐々木 〆切 〇〇',
      // CJK Radicals, Bopomofo, Bopomofo Ext, CJK Ext-A, Unified, Compat Ideographs, Ext-B (surrogate pair)
      '\u2E80\u2E81 ㄅㄆㄇ \u31A0\u31A1 \u3400\u3401 漢字検索 豈更 𠮷野家',
      // Fullwidth ASCII & digits (NFKC folding), mixed case, punctuation
      'ＡＢＣ１２３ Hello-WORLD_2026! café vs cafe\u0301',
      // Single-char CJK interspersed with Latin & digits & emojis
      'A한B글C 🚀 테스트 👨‍👩‍👧‍👦 끝',
      // Empty & whitespace/punctuation only
      '   --- !!! ...   ',
    ]

    const client = new ParseSidecarClient()
    try {
      for (const sample of corpus) {
        const tsTok = tokenize(sample)
        const rustTok = await client.tokenizeText(sample)
        expect(rustTok.bi, `bi mismatch for ${JSON.stringify(sample)}`).toBe(toIndexText(tsTok.bi))
        expect(rustTok.uni, `uni mismatch for ${JSON.stringify(sample)}`).toBe(
          toIndexText(tsTok.uni),
        )
      }

      // 1,000,000-char differential + timing benchmark (Rust vs TS)
      const unit = '이음오피스 검색 엔진 2026 NFKC ＡＢＣ 東京 𠮷野家 보고서 요약 '
      const million = unit.repeat(Math.ceil(1_000_000 / unit.length)).slice(0, 1_000_000)

      const t0Ts = performance.now()
      const tsMil = tokenize(million)
      const tsBi = toIndexText(tsMil.bi)
      const tsUni = toIndexText(tsMil.uni)
      const tsMs = performance.now() - t0Ts

      const t0Rust = performance.now()
      const rustMil = await client.tokenizeText(million)
      const rustMs = performance.now() - t0Rust

      expect(rustMil.bi).toBe(tsBi)
      expect(rustMil.uni).toBe(tsUni)
      console.info(
        `[perf-baseline:file-index-tokenize-1M] rust=${rustMs.toFixed(1)}ms ts=${tsMs.toFixed(1)}ms`,
      )
    } finally {
      await client.shutdown()
    }
  }, 30_000)

  it('isolates indexing sidecar timeout-restart from concurrent interactive parseFileToText calls', async () => {
    // Slow/stalling mock sidecar for the indexing client only
    const stallScript = join(workDir, 'stall-sidecar.cjs')
    writeFileSync(
      stallScript,
      `const rl = require('node:readline').createInterface({ input: process.stdin });
       rl.on('line', () => { /* intentionally never respond to trigger timeout */ });`,
    )
    const indexingClient = new ParseSidecarClient({
      binaryPath: process.execPath,
      args: [stallScript],
      requestTimeoutMs: 150,
      killOnTimeout: true,
    })

    const docPath = join(workDir, 'interactive.docx')
    writeFileSync(docPath, await makeDocx('InteractiveRequestMustSurvive'))

    try {
      const [indexingOutcome, interactiveOutcome] = await Promise.allSettled([
        indexingClient.extractFile({ path: docPath, ext: 'docx' }),
        parseFileToText(docPath),
      ])

      expect(indexingOutcome.status).toBe('rejected')
      expect(interactiveOutcome.status).toBe('fulfilled')
      if (interactiveOutcome.status === 'fulfilled') {
        expect(interactiveOutcome.value.ok).toBe(true)
        expect(interactiveOutcome.value.text).toContain('InteractiveRequestMustSurvive')
      }
      // Interactive singleton stays healthy and distinct from indexing client
      expect(getInteractiveParseSidecar().pid()).not.toBeNull()
    } finally {
      indexingClient.stop()
    }
  })

  it('indexes a 105 MiB media-heavy DOCX through FileIndexer and answers FileIndexStore.search()', async () => {
    const folder = join(workDir, 'big-folder')
    mkdirSync(folder, { recursive: true })
    const bigDocx = join(folder, 'deck-105m.docx')
    writeFileSync(bigDocx, await makeDocx('대용량 문서 색인 고유키워드 AlphaOmega99', 105))

    const spyWorker = join(__dirname, 'file-index-test-worker.mjs')
    indexer = new FileIndexer(
      store,
      spyWorker,
      { roots: () => [folder], extraPaths: () => [] },
      30_000,
    )
    const t0 = performance.now()
    await indexer.scan()
    await vi.waitFor(
      () => {
        expect(indexer!.progress()).toMatchObject({ pending: 0, scanning: false })
        expect(store.listAll().get(bigDocx)?.status).toBe('ok')
      },
      { timeout: 25_000, interval: 25 },
    )
    const elapsedMs = performance.now() - t0

    const hits = store.search('고유키워드')
    expect(hits.total).toBe(1)
    expect(hits.hits[0]!.path).toBe(bigDocx)
    expect(hits.hits[0]!.snippet).not.toBeNull()
    console.info(`[perf-baseline:index-105m-docx] scan+index+search=${elapsedMs.toFixed(1)}ms`)
  }, 45_000)
})
