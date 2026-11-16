import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { decodeCommandOutput } from '@genoffice/electron-utils'
import type { EditorItemId } from '@genoffice/electron-utils/app-choice'
import type { DefaultAppStatus } from '../shared/home-api'

// macOS writes the LaunchServices user choice via osascript (no helper binary to
// ship), Linux via xdg-mime; Windows apps cannot set defaults, only open the page.

interface OfficeType {
  ext: string
  uti: string
  mime: string
  /** Windows ProgId written by the NSIS installer = win.fileAssociations[].name in electron-builder.cjs */
  progId: string
  /** the editor that opens it (Settings → Editors and AI) */
  item: EditorItemId
}

export const OFFICE_TYPES: readonly OfficeType[] = [
  {
    ext: 'docx',
    uti: 'org.openxmlformats.wordprocessingml.document',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    progId: 'IeumOffice.WordDocument',
    item: 'docs',
  },
  {
    ext: 'xlsx',
    uti: 'org.openxmlformats.spreadsheetml.sheet',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    progId: 'IeumOffice.ExcelWorkbook',
    item: 'sheets',
  },
  {
    ext: 'xlsm',
    uti: 'org.openxmlformats.spreadsheetml.sheet.macroenabled',
    mime: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    progId: 'IeumOffice.ExcelMacroEnabledWorkbook',
    item: 'sheets',
  },
  {
    ext: 'xls',
    uti: 'com.microsoft.excel.xls',
    mime: 'application/vnd.ms-excel',
    progId: 'IeumOffice.Excel972003Workbook',
    item: 'sheets',
  },
  {
    ext: 'pptx',
    uti: 'org.openxmlformats.presentationml.presentation',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    progId: 'IeumOffice.PowerPointPresentation',
    item: 'slides',
  },
  // draw.io diagrams. macOS knows the type by the identifier draw.io exports;
  // electron-builder.cjs imports the same declaration (mac.extendInfo) so the
  // type resolves where draw.io is not installed. Both extensions share it.
  {
    ext: 'drawio',
    uti: 'com.jgraph.drawio',
    mime: 'application/vnd.jgraph.mxfile',
    progId: 'IeumOffice.Diagram',
    item: 'diagram',
  },
  {
    ext: 'dio',
    uti: 'com.jgraph.drawio',
    mime: 'application/vnd.jgraph.mxfile',
    progId: 'IeumOffice.Diagram',
    item: 'diagram',
  },
]

const LINUX_DESKTOP_ID = 'ieumoffice.desktop'
const WINDOWS_DEFAULT_APPS_URL = 'ms-settings:defaultapps'

export type RunCommand = (cmd: string, args: string[]) => Promise<string>

export interface DefaultAppDeps {
  platform: NodeJS.Platform
  /** packaged app only: dev builds run inside Electron.app and must never claim the types */
  packaged: boolean
  exePath: string
  run: RunCommand
  openExternal: (url: string) => Promise<void>
  readFile?: (path: string) => string
  /**
   * The editors turned off now: their types are neither checked nor claimed
   * (Settings → Editors and AI). Absent = all on.
   */
  editorsOff?: () => readonly EditorItemId[]
}

export interface DefaultAppService {
  status(): Promise<DefaultAppStatus>
  /** apply (mac/linux) or open the system page (win); resolves to the status afterwards */
  set(): Promise<DefaultAppStatus>
}

const UNSUPPORTED: DefaultAppStatus = { state: 'unsupported', others: [], manualOnly: false }

export function execFileRunner(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: 15_000, windowsHide: true, encoding: 'buffer' },
      (err, stdout) => {
        if (err) reject(err)
        else resolve(decodeCommandOutput(stdout))
      },
    )
  })
}

/** /Applications/GenOffice.app/Contents/MacOS/GenOffice → /Applications/GenOffice.app */
export function macAppBundlePath(exePath: string): string | null {
  let dir = exePath
  for (let i = 0; i < 6; i++) {
    dir = dirname(dir)
    if (dir.endsWith('.app')) return dir
    if (dir === dirname(dir)) break
  }
  return null
}

// JXA: argv[0] = our .app path, argv[1..] = UTIs → JSON [{uti, id, name}] of the
// current handler per type (id === own bundle id when we are the default).
const MAC_STATUS_SCRIPT = `function run(argv) {
  ObjC.import('CoreServices'); ObjC.import('AppKit')
  var ws = $.NSWorkspace.sharedWorkspace
  var me = $.NSBundle.bundleWithPath(argv[0]).bundleIdentifier.js
  var out = { me: me, types: [] }
  for (var i = 1; i < argv.length; i++) {
    var ref = $.LSCopyDefaultRoleHandlerForContentType($(argv[i]), 0xFFFFFFFF)
    var obj = ObjC.castRefToObject(ref)
    var id = obj.isNil() ? null : obj.js
    var name = null
    if (id) {
      var url = ws.URLForApplicationWithBundleIdentifier(id)
      if (!url.isNil()) {
        var b = $.NSBundle.bundleWithURL(url)
        name = ObjC.unwrap(b.objectForInfoDictionaryKey('CFBundleDisplayName')) ||
          ObjC.unwrap(b.objectForInfoDictionaryKey('CFBundleName')) || null
      }
    }
    out.types.push({ uti: argv[i], id: id, name: name })
  }
  return JSON.stringify(out)
}`

const MAC_SET_SCRIPT = `function run(argv) {
  ObjC.import('CoreServices')
  var me = $.NSBundle.bundleWithPath(argv[0]).bundleIdentifier.js
  var failed = []
  for (var i = 1; i < argv.length; i++) {
    if ($.LSSetDefaultRoleHandlerForContentType($(argv[i]), 0xFFFFFFFF, $(me)) !== 0) failed.push(argv[i])
  }
  return JSON.stringify({ me: me, failed: failed })
}`

function summarize(owners: Array<string | null>, ours: (id: string) => boolean): DefaultAppStatus {
  const others: string[] = []
  let allOurs = true
  let known = false
  for (const owner of owners) {
    if (owner === null) {
      allOurs = false
      continue
    }
    known = true
    if (ours(owner)) continue
    allOurs = false
    if (!others.includes(owner)) others.push(owner)
  }
  if (!known) return { state: 'unknown', others: [], manualOnly: false }
  return { state: allOurs ? 'default' : 'other', others, manualOnly: false }
}

export function parseMacStatus(json: string): DefaultAppStatus {
  const data = JSON.parse(json) as {
    me: string
    types: Array<{ id: string | null; name: string | null }>
  }
  const owners = data.types.map((t) =>
    t.id === null ? null : t.id === data.me ? data.me : (t.name ?? t.id),
  )
  return summarize(owners, (id) => id === data.me)
}

export function parseLinuxStatus(outputs: string[]): DefaultAppStatus {
  const owners = outputs.map((o) => o.trim() || null)
  return summarize(owners, (id) => id === LINUX_DESKTOP_ID)
}

/** value of a `reg query` line: `    ProgId    REG_SZ    Word.Document.12` */
export function parseRegValue(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s*\S.*?\s+REG_\w+\s+(.+?)\s*$/.exec(line)
    if (m) return m[1]
  }
  return null
}

function linuxDesktopName(id: string, readFile: (p: string) => string): string {
  const dirs = [
    join(homedir(), '.local/share/applications'),
    '/usr/local/share/applications',
    '/usr/share/applications',
  ]
  for (const dir of dirs) {
    try {
      const m = /^Name=(.+)$/m.exec(readFile(join(dir, id)))
      if (m) return m[1].trim()
    } catch {
      // not installed there
    }
  }
  return id.replace(/\.desktop$/, '')
}

/** the Office types whose editor is on, in OFFICE_TYPES order */
export function claimableOfficeTypes(off: readonly EditorItemId[]): OfficeType[] {
  return OFFICE_TYPES.filter((t) => !off.includes(t.item))
}

export function createDefaultAppService(deps: DefaultAppDeps): DefaultAppService {
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, 'utf8'))
  const types = (): OfficeType[] => claimableOfficeTypes(deps.editorsOff?.() ?? [])
  const utisOf = (list: OfficeType[]): string[] => list.map((t) => t.uti)
  const mimesOf = (list: OfficeType[]): string[] => list.map((t) => t.mime)

  const macBundle = deps.platform === 'darwin' ? macAppBundlePath(deps.exePath) : null

  async function status(): Promise<DefaultAppStatus> {
    if (!deps.packaged) return UNSUPPORTED
    const list = types()
    // every editor with an Office type is off: there is nothing to make default
    if (list.length === 0) return UNSUPPORTED
    const utis = utisOf(list)
    const mimes = mimesOf(list)
    try {
      if (deps.platform === 'darwin') {
        if (!macBundle) return UNSUPPORTED
        const out = await deps.run('osascript', [
          '-l',
          'JavaScript',
          '-e',
          MAC_STATUS_SCRIPT,
          macBundle,
          ...utis,
        ])
        return parseMacStatus(out)
      }
      if (deps.platform === 'linux') {
        const outs = await Promise.all(
          mimes.map((m) => deps.run('xdg-mime', ['query', 'default', m])),
        )
        const st = parseLinuxStatus(outs)
        return { ...st, others: st.others.map((id) => linuxDesktopName(id, readFile)) }
      }
      if (deps.platform === 'win32') {
        const owners = await Promise.all(list.map((t) => windowsOwner(t)))
        const st = summarize(owners, (id) => OFFICE_TYPES.some((t) => t.progId === id))
        const names = await Promise.all(st.others.map((id) => windowsProgIdName(id)))
        return { ...st, others: [...new Set(names)], manualOnly: true }
      }
    } catch {
      return { state: 'unknown', others: [], manualOnly: deps.platform === 'win32' }
    }
    return UNSUPPORTED
  }

  async function windowsOwner(t: OfficeType): Promise<string | null> {
    const userChoice = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${t.ext}\\UserChoice`
    try {
      const v = parseRegValue(await deps.run('reg', ['query', userChoice, '/v', 'ProgId']))
      if (v) return v
    } catch {
      // no explicit user choice: fall through to the class default
    }
    try {
      return parseRegValue(await deps.run('reg', ['query', `HKCR\\.${t.ext}`, '/ve']))
    } catch {
      return null
    }
  }

  async function windowsProgIdName(progId: string): Promise<string> {
    try {
      const name =
        parseRegValue(await deps.run('reg', ['query', `HKCR\\${progId}`, '/ve'])) ?? progId
      // A code page we still cannot decode would surface as replacement
      // characters. The ProgId is ASCII and stays readable, so prefer it.
      return name.includes('\uFFFD') ? progId : name
    } catch {
      return progId
    }
  }

  async function set(): Promise<DefaultAppStatus> {
    if (!deps.packaged) return UNSUPPORTED
    const list = types()
    if (list.length === 0) return UNSUPPORTED
    const utis = utisOf(list)
    const mimes = mimesOf(list)
    try {
      if (deps.platform === 'darwin' && macBundle) {
        await deps.run('osascript', ['-l', 'JavaScript', '-e', MAC_SET_SCRIPT, macBundle, ...utis])
      } else if (deps.platform === 'linux') {
        await deps.run('xdg-mime', ['default', LINUX_DESKTOP_ID, ...mimes])
      } else if (deps.platform === 'win32') {
        await deps.openExternal(WINDOWS_DEFAULT_APPS_URL)
      }
    } catch {
      // status() below reports whatever actually stuck
    }
    return status()
  }

  return { status, set }
}
