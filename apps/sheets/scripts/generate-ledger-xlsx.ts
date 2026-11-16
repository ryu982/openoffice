import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import JSZip from 'jszip'

const FEATURES = [
  'formulas',
  'lookup',
  'borders',
  'wrap',
  'cf',
  'dv',
  'merge',
  'filter',
  'freeze',
  'widths',
] as const
type Feature = (typeof FEATURES)[number]

interface LedgerSpec {
  rows: number
  features: ReadonlySet<Feature>
  dvTo: number
  cfTo: number
}

const USAGE =
  'usage: generate-ledger-xlsx.ts <out.xlsx> <rows> [features,comma,separated] [sheets]\n' +
  `features: ${FEATURES.join(', ')}, rich (= all)
` +
  'in the same list: dvto=<row> and cfto=<row> stretch the validation range and the conditional formatting ranges down to that row'

const SEED = 7
const MONTHS = 20
const LEDGER_NAME = '대장'
const LOOKUP_NAME = '코드표'
const FAMILY = '김이박최정강조윤장임한오서신권황안송류전'
const GIVEN = '민서준우지현수아도윤하은예린시우주원채원건우'
const DEPARTMENTS = [
  '총무과',
  '재무과',
  '기획조정실',
  '교육지원과',
  '시설관리팀',
  '정보화팀',
  '민원봉사과',
  '감사담당관',
].map((name, index) => ({ name, weight: 1 + (index + 1) / 10 }))
const CITIES = [
  '서울특별시 종로구',
  '부산광역시 해운대구',
  '대구광역시 수성구',
  '인천광역시 연수구',
  '광주광역시 북구',
  '경기도 수원시 영통구',
]
const GROUP_HEADERS = [
  { text: '기본 정보', from: 'A', to: 'E' },
  { text: '월별 실적', from: 'F', to: 'Y' },
  { text: '요약', from: 'Z', to: 'AD' },
]
const HEADERS = [
  '번호',
  '이름',
  '부서',
  '주소',
  '등록일',
  ...Array.from({ length: MONTHS }, (_, month) => `${month + 1}월차`),
  '합계',
  '평균',
  '판정',
  '가중치',
  '조정액',
]

interface Look {
  format: 'general' | 'integer' | 'date' | 'decimal'
  border: boolean
  align: 'none' | 'center' | 'wrap'
  header: boolean
}

const NUMBER_FORMAT_ID: Record<Look['format'], number> = {
  general: 0,
  integer: 3,
  date: 164,
  decimal: 165,
}
const ALIGNMENT: Record<Look['align'], string> = {
  none: '',
  center: '<alignment horizontal="center" vertical="center"/>',
  wrap: '<alignment vertical="top" wrapText="1"/>',
}

const DEFAULT_LOOK: Look = { format: 'general', border: false, align: 'none', header: false }

class StyleBook {
  private readonly looks: Look[] = []
  private readonly indexes = new Map<string, number>()

  constructor() {
    this.styleAttribute(DEFAULT_LOOK)
  }

  styleAttribute(look: Look): string {
    const key = JSON.stringify(look)
    let index = this.indexes.get(key)
    if (index === undefined) {
      index = this.looks.push(look) - 1
      this.indexes.set(key, index)
    }
    return index === 0 ? '' : ` s="${index}"`
  }

  xml(): string {
    const xfs = this.looks.map((look) => {
      const applied =
        (look.format === 'general' ? '' : ' applyNumberFormat="1"') +
        (look.header ? ' applyFont="1" applyFill="1"' : '') +
        (look.border ? ' applyBorder="1"' : '') +
        (look.align === 'none' ? '' : ' applyAlignment="1"')
      const ids = `numFmtId="${NUMBER_FORMAT_ID[look.format]}" fontId="${look.header ? 1 : 0}" fillId="${look.header ? 2 : 0}" borderId="${look.border ? 1 : 0}" xfId="0"`
      return look.align === 'none'
        ? `<xf ${ids}${applied}/>`
        : `<xf ${ids}${applied}>${ALIGNMENT[look.align]}</xf>`
    })
    return (
      '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="#,##0.0"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '<dxfs count="2"><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFF4CCCC"/><bgColor rgb="FFF4CCCC"/></patternFill></fill></dxf><dxf><font><b/><color rgb="FFC00000"/></font></dxf></dxfs>' +
      '</styleSheet>'
    )
  }
}

class SharedStrings {
  private readonly indexes = new Map<string, number>()
  private references = 0

  index(text: string): number {
    this.references += 1
    let index = this.indexes.get(text)
    if (index === undefined) {
      index = this.indexes.size
      this.indexes.set(text, index)
    }
    return index
  }

  xml(): string {
    return (
      `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.references}" uniqueCount="${this.indexes.size}">` +
      [...this.indexes.keys()].map((text) => `<si><t>${escapeXml(text)}</t></si>`).join('') +
      '</sst>'
    )
  }
}

async function main(): Promise<void> {
  const out = process.argv[2]
  const rows = Number(process.argv[3])
  const sheets = Number(process.argv[5] ?? 1)
  if (!out || !Number.isInteger(rows) || rows <= 0 || !Number.isInteger(sheets) || sheets <= 0) {
    throw new Error(USAGE)
  }
  const spec: LedgerSpec = { rows, ...parseFeatures(process.argv[4] ?? '') }
  const random = mulberry32(SEED)
  const styles = new StyleBook()
  const strings = new SharedStrings()

  const parts: { name: string; xml: string }[] = []
  const filters: string[] = []
  for (let index = 0; index < sheets; index += 1) {
    const name = index === 0 ? LEDGER_NAME : `${LEDGER_NAME}${index + 1}`
    const ledger = ledgerSheet(spec, styles, strings, random)
    if (ledger.filterRange) {
      filters.push(
        `<definedName name="_xlnm._FilterDatabase" localSheetId="${parts.length}" hidden="1">'${name}'!${ledger.filterRange}</definedName>`,
      )
    }
    parts.push({ name, xml: ledger.xml })
    if (index === 0 && spec.features.has('lookup')) {
      parts.push({ name: LOOKUP_NAME, xml: lookupSheet(strings) })
    }
  }

  const zip = new JSZip()
  // A fixed entry date, and no folder entries (JSZip dates those with the
  // current time), keep the archive bytes the same from run to run.
  const add = (path: string, content: string): void => {
    zip.file(path, content, { date: new Date(Date.UTC(2000, 0, 1)), createFolders: false })
  }
  add(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      parts
        .map(
          (_, index) =>
            `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
  )
  add(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  )
  add(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      parts
        .map(
          (part, index) =>
            `<sheet name="${part.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
        )
        .join('') +
      '</sheets>' +
      (filters.length > 0 ? `<definedNames>${filters.join('')}</definedNames>` : '') +
      '</workbook>',
  )
  add(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      parts
        .map(
          (_, index) =>
            `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
        )
        .join('') +
      `<Relationship Id="rId${parts.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${parts.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  )
  add('xl/styles.xml', styles.xml())
  add('xl/sharedStrings.xml', strings.xml())
  parts.forEach((part, index) => add(`xl/worksheets/sheet${index + 1}.xml`, part.xml))
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await writeFile(resolve(out), buffer)
  process.stdout.write(
    `${out}: ${rows} rows x ${HEADERS.length} columns x ${sheets} sheets, features=${[...spec.features].sort().join(',') || 'none'}, dvto=${spec.dvTo}, cfto=${spec.cfTo}, ${buffer.length} bytes\n`,
  )
}

function parseFeatures(list: string): Omit<LedgerSpec, 'rows'> {
  const features = new Set<Feature>()
  const ranges = { dvto: 0, cfto: 0 }
  for (const item of list.split(',').filter(Boolean)) {
    const [key, value] = item.split('=')
    if (value !== undefined) {
      const row = Number(value)
      if ((key !== 'dvto' && key !== 'cfto') || !Number.isInteger(row) || row <= 0) {
        throw new Error(`unknown option: ${item}\n${USAGE}`)
      }
      ranges[key] = row
    } else if (item === 'rich') {
      for (const feature of FEATURES) features.add(feature)
    } else if ((FEATURES as readonly string[]).includes(item)) {
      features.add(item as Feature)
    } else {
      throw new Error(`unknown feature: ${item}\n${USAGE}`)
    }
  }
  return { features, dvTo: ranges.dvto, cfTo: ranges.cfto }
}

function ledgerSheet(
  spec: LedgerSpec,
  styles: StyleBook,
  strings: SharedStrings,
  random: () => number,
): { xml: string; filterRange: string | null } {
  const { rows, features } = spec
  const head = features.has('merge') ? 2 : 1
  const last = head + rows
  const int = (low: number, high: number): number => low + Math.floor(random() * (high - low + 1))
  const pick = <T>(list: ArrayLike<T>): T => list[int(0, list.length - 1)] as T

  const border = features.has('borders')
  const center: Look['align'] = border ? 'center' : 'none'
  const wrap: Look['align'] = features.has('wrap') ? 'wrap' : 'none'
  const styled = (format: Look['format'], align: Look['align'] = 'none'): string =>
    styles.styleAttribute({ format, border, align, header: false })
  const headerStyle = border
    ? styles.styleAttribute({ format: 'general', border, align: center, header: true })
    : ''
  const style = {
    id: styled('general', center),
    name: styled('general'),
    dept: styled('general', center),
    address: styled('general', wrap),
    date: styled('date', center),
    amount: styled('integer'),
    mean: styled('decimal'),
    verdict: styled('general', center),
    weight: styled('general'),
  }

  const lines: string[] = []
  if (features.has('merge')) {
    lines.push(
      `<row r="1">${GROUP_HEADERS.map((group) => textCell(strings, `${group.from}1`, '', group.text)).join('')}</row>`,
    )
  }
  lines.push(
    `<row r="${head}">${HEADERS.map((text, index) => textCell(strings, `${columnLetter(index)}${head}`, headerStyle, text)).join('')}</row>`,
  )
  for (let index = 0; index < rows; index += 1) {
    const r = head + 1 + index
    const name = pick(FAMILY) + pick(GIVEN) + pick(GIVEN)
    const dept = pick(DEPARTMENTS)
    const address = `${pick(CITIES)} 가상로${int(1, 400)}번길 ${int(1, 99)}, ${int(101, 120)}동 ${int(101, 2504)}호 (우편 ${int(10000, 63999)})`
    let line =
      `<row r="${r}">` +
      numberCell(`A${r}`, style.id, index + 1) +
      textCell(strings, `B${r}`, style.name, name) +
      textCell(strings, `C${r}`, style.dept, dept.name) +
      textCell(strings, `D${r}`, style.address, address) +
      numberCell(`E${r}`, style.date, 45000 + (index % 700))
    let total = 0
    for (let month = 0; month < MONTHS; month += 1) {
      const amount = int(0, 100000)
      total += amount
      line += numberCell(`${columnLetter(5 + month)}${r}`, style.amount, amount)
    }
    const verdict = total > 1000000 ? '초과' : total > 800000 ? '주의' : '정상'
    const adjusted = Math.round(total * dept.weight)
    if (features.has('formulas')) {
      line +=
        formulaCell(`Z${r}`, style.amount, `SUM(F${r}:Y${r})`, total) +
        formulaCell(`AA${r}`, style.mean, `AVERAGE(F${r}:Y${r})`, total / MONTHS) +
        formulaCell(
          `AB${r}`,
          style.verdict,
          `IF(Z${r}>1000000,"초과",IF(Z${r}>800000,"주의","정상"))`,
          verdict,
        )
    } else {
      line +=
        numberCell(`Z${r}`, style.amount, total) +
        numberCell(`AA${r}`, style.mean, total / MONTHS) +
        textCell(strings, `AB${r}`, style.verdict, verdict)
    }
    if (features.has('lookup')) {
      line +=
        formulaCell(
          `AC${r}`,
          style.weight,
          `VLOOKUP(C${r},${LOOKUP_NAME}!$A$1:$B$${DEPARTMENTS.length},2,FALSE)`,
          dept.weight,
        ) + formulaCell(`AD${r}`, style.amount, `ROUND(Z${r}*AC${r},0)`, adjusted)
    } else {
      line +=
        numberCell(`AC${r}`, style.weight, dept.weight) +
        numberCell(`AD${r}`, style.amount, adjusted)
    }
    lines.push(line + '</row>')
  }

  const view = features.has('freeze')
    ? `<pane xSplit="2" ySplit="${head}" topLeftCell="C${head + 1}" activePane="bottomRight" state="frozen"/><selection pane="topRight"/><selection pane="bottomLeft"/><selection pane="bottomRight" activeCell="A1" sqref="A1"/>`
    : '<selection activeCell="A1" sqref="A1"/>'
  const widths =
    features.has('widths') || features.has('wrap')
      ? '<cols><col min="2" max="2" width="12" customWidth="1"/><col min="4" max="4" width="24" customWidth="1"/></cols>'
      : ''
  const filterRange = features.has('filter') ? `A${head}:AD${last}` : null
  const merges = features.has('merge')
    ? `<mergeCells count="${GROUP_HEADERS.length}">${GROUP_HEADERS.map((group) => `<mergeCell ref="${group.from}1:${group.to}1"/>`).join('')}</mergeCells>`
    : ''
  const cfLast = Math.max(last, spec.cfTo)
  const formats = features.has('cf')
    ? `<conditionalFormatting sqref="Z${head + 1}:Z${cfLast}"><cfRule type="cellIs" priority="1" operator="greaterThan" dxfId="0"><formula>1000000</formula></cfRule></conditionalFormatting>` +
      `<conditionalFormatting sqref="F${head + 1}:Y${cfLast}"><cfRule type="colorScale" priority="2"><colorScale><cfvo type="min"/><cfvo type="max"/><color rgb="FFFFFFFF"/><color rgb="FF63BE7B"/></colorScale></cfRule></conditionalFormatting>` +
      `<conditionalFormatting sqref="AB${head + 1}:AB${cfLast}"><cfRule type="cellIs" priority="3" operator="equal" dxfId="1"><formula>"초과"</formula></cfRule></conditionalFormatting>`
    : ''
  const validation = features.has('dv')
    ? `<dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="C${head + 1}:C${Math.max(last, spec.dvTo)}"><formula1>"${DEPARTMENTS.map((dept) => dept.name).join(',')}"</formula1></dataValidation></dataValidations>`
    : ''
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:AD${last}"/>` +
    `<sheetViews><sheetView workbookViewId="0">${view}</sheetView></sheetViews>` +
    '<sheetFormatPr baseColWidth="8" defaultRowHeight="15"/>' +
    widths +
    `<sheetData>\n${lines.join('\n')}\n</sheetData>` +
    (filterRange ? `<autoFilter ref="${filterRange}"/>` : '') +
    merges +
    formats +
    validation +
    '<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/>' +
    '</worksheet>'
  return {
    xml,
    filterRange: filterRange ? `$A$${head}:$AD$${last}` : null,
  }
}

function lookupSheet(strings: SharedStrings): string {
  const lines = DEPARTMENTS.map(
    (dept, index) =>
      `<row r="${index + 1}">${textCell(strings, `A${index + 1}`, '', dept.name)}${numberCell(`B${index + 1}`, '', dept.weight)}</row>`,
  )
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:B${DEPARTMENTS.length}"/>` +
    `<sheetData>${lines.join('')}</sheetData>` +
    '</worksheet>'
  )
}

function numberCell(ref: string, style: string, value: number): string {
  return `<c r="${ref}"${style}><v>${value}</v></c>`
}

function textCell(strings: SharedStrings, ref: string, style: string, value: string): string {
  return `<c r="${ref}"${style} t="s"><v>${strings.index(value)}</v></c>`
}

function formulaCell(ref: string, style: string, formula: string, cached: number | string): string {
  return typeof cached === 'string'
    ? `<c r="${ref}"${style} t="str"><f>${escapeXml(formula)}</f><v>${escapeXml(cached)}</v></c>`
    : `<c r="${ref}"${style}><f>${escapeXml(formula)}</f><v>${cached}</v></c>`
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function columnLetter(index: number): string {
  let value = index + 1
  let letters = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    letters = String.fromCharCode(65 + remainder) + letters
    value = Math.floor((value - 1) / 26)
  }
  return letters
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

void main()
