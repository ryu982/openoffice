import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Which open paths go through the editor gate and with which origin
 * (editor choice spec 7.2, 7.5, 7.6). index.ts cannot be loaded outside a
 * running Electron, so the wiring is pinned by reading the source; the gate's
 * own decisions are tested in editor-gate.test.ts.
 */

const main = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')

function fnSource(name: string): string {
  const start = main.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`no ${name}`)
  const end = main.indexOf('\nfunction ', start + 1)
  return main.slice(start, end < 0 ? undefined : end)
}

describe('the router', () => {
  it('asks the gate first; a person is the origin when none is given', () => {
    const open = fnSource('openDocumentPath')
    expect(open).toMatch(
      /function openDocumentPath\(filePath: string, origin: OpenOrigin = 'user'\)/,
    )
    expect(open).toMatch(
      /const gated = openGate\.check\(filePath, origin, \(path\) => openDocumentPath\(path, origin\)\)\n {2}if \(gated !== null\) return gated/,
    )
  })

  it('knows a file by the editor the router opens it with, and an open file without loading tabs', () => {
    expect(fnSource('editorItemOfPath')).toMatch(
      /legacyEditorFor\(filePath\) \?\? appForPath\(filePath\)/,
    )
    const isOpen = fnSource('isDocumentOpen')
    expect(isOpen).toMatch(/tabManager\?\.openFilePaths\(\)/)
    expect(isOpen).toMatch(/detachedFilePaths\(\)/)
    expect(isOpen).not.toMatch(/findTabByPath/)
  })

  it('turns an editor on through the one choice service and installs the gate for other modules', () => {
    expect(main).toMatch(/setChoice: \(patch\) => editorChoiceService\?\.set\(patch\)/)
    expect(main).toMatch(/installEditorGate\(openGate\)/)
    expect(main).toMatch(/const editorChoice = registerEditorChoiceIpc\(/)
    expect(main).toMatch(/editorChoiceService = editorChoice\b/)
  })
})

describe('a person opening several files at once asks once per editor', () => {
  it('launch files and second-instance files; Home only when nothing opened', () => {
    const launch = fnSource('openLaunchPaths')
    expect(launch).toMatch(/requestOpenPaths\(paths\)\.then\(\(opened\) => \{/)
    expect(launch).toMatch(/if \(!opened\) tabManager\?\.openHomeTab\(\)/)
  })

  it("File → Open and Home's browse", () => {
    expect(fnSource('openFileViaDialog')).toMatch(/void requestOpenPaths\(result\.filePaths\)/)
    expect(main.match(/void requestOpenPaths\(result\.filePaths\)/g)).toHaveLength(2)
    expect(main).not.toMatch(/for \(const path of result\.filePaths\) openDocumentPath\(path\)/)
  })

  it('a drop, with the skill question while AI is off', () => {
    const drop = main.slice(main.indexOf('const droppedFilesDeps = '))
    const deps = drop.slice(0, drop.indexOf('\n})\n'))
    expect(deps).toMatch(/openPaths: \(paths\) => requestOpenPaths\(paths\)/)
    expect(deps).toMatch(/aiFeaturesOn,/)
    expect(deps).toMatch(/askAiOnForSkills: \(\) => openGate\.askAiOnForSkills\(\)/)
  })
})

describe('origins of the other open paths', () => {
  it('the terminal command and a crashed tab never ask', () => {
    expect(main).toMatch(/openDocument: \(path\) => openDocumentPath\(path, 'automation'\)/)
    expect(main).toMatch(/reopen: \(filePath\) => void openDocumentPath\(filePath, 'automation'\)/)
  })

  it('a Drive pick asks like any open, without going through Drive again', () => {
    expect(main).toMatch(
      /openPath: \(path\) =>\s*openGate\.check\(path, 'user', \(picked\) => routeDocumentPath\(picked\)\) \?\?\s*routeDocumentPath\(path\)/,
    )
  })

  it('the project screen waits for the answer before it looks for the tab', () => {
    expect(main).toMatch(
      /openDocument: async \(path\) => \{\s*if \(!\(await openDocumentPathAnswered\(path\)\)\) return null/,
    )
  })
})

describe('restoring at launch', () => {
  it('asks about restored tabs before the strip is rebuilt; the list asks again', () => {
    expect(main).toMatch(
      /askRestore: \(tabs, \{ fromList \}\) =>\s*openGate\.askRestore\(\s*tabs\.map\(\(tab\) => \(\{ key: tab\.key, item: editorItemOfTabKind\(tab\.kind\) \}\)\),\s*\{ askAgain: fromList \},/,
    )
  })

  it('asks about the remembered split and forgets a declined document', () => {
    const restore = fnSource('restoreSplitMemoryOrHome')
    expect(restore).toMatch(/openGate\.askRestore\(/)
    expect(restore).toMatch(/forgetSplitMemoryPaths\(\[\.\.\.refused\]/)
    expect(restore).toMatch(/placeSplitMemoryOrHome\(\)/)
  })
})
