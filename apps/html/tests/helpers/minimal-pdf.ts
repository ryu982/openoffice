/**
 * A small, well-formed PDF with one empty page per size, for fakes of
 * `printToPDF`; `readJobPageSizes` reads its pages back.
 */
export function minimalPdf(sizes: ReadonlyArray<readonly [number, number]>): Uint8Array {
  const objects: string[] = []
  const kids = sizes.map((_, i) => `${i + 3} 0 R`).join(' ')
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${sizes.length} >>`)
  for (const [w, h] of sizes) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] >>`)
  }
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(body)
}

/** The sizes a `pageRanges` text such as "1-3, 5" picks, as Chromium prints them. */
export function pdfPageRanges<T>(pages: readonly T[], ranges: string): T[] {
  const picked = new Set<number>()
  for (const part of ranges.split(',')) {
    const [from, to = from] = part.trim().split('-').map(Number) as [number, number?]
    for (let p = from; p <= (to ?? from); p++) if (p >= 1 && p <= pages.length) picked.add(p)
  }
  return [...picked].sort((a, b) => a - b).map((p) => pages[p - 1]!)
}
