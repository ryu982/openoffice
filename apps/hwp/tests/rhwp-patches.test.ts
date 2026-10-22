import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RENDERER_SCHEME } from '../../../packages/electron-utils/src/renderer-scheme'
import {
  AGENT_PLUGIN_MODULE,
  APP_SCHEME,
  OPTION_KEYS,
  PASSWORD_FLAG,
  applyPatch,
  missingPluginHooks,
  pluginHooks,
} from '../scripts/rhwp-patches.mjs'
import { AGENT_PLUGIN_ID } from '../studio-plugin/agent-plugin.mjs'

const require = createRequire(import.meta.url)

describe('rhwp scheme patches', () => {
  it('admit the scheme the packaged renderers are served from', () => {
    expect(APP_SCHEME).toBe(RENDERER_SCHEME)
  })

  it('apply to the installed @rhwp/editor transport', () => {
    const transport = join(dirname(require.resolve('@rhwp/editor')), 'transport.js')
    const patched = applyPatch('sdk-scheme', readFileSync(transport, 'utf8'))
    expect(patched).toContain(`targetUrl.protocol !== '${APP_SCHEME}:'`)
    // http and https stay accepted: the dev server origin depends on them
    expect(patched).toContain("targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:'")
  })

  it('patch the studio origin check', () => {
    const source = "    return protocol === 'http:' || protocol === 'https:';\n"
    expect(applyPatch('studio-scheme', source)).toBe(
      `    return protocol === 'http:' || protocol === 'https:' || protocol === '${APP_SCHEME}:';\n`,
    )
  })
})

describe('rhwp password-flag patch', () => {
  it('adds the protection flag to the command context, next to the dirty flag', () => {
    const source = [
      '  return {',
      '    hasDocument: hasDoc,',
      '    isDirty: documentState.isDirty(),',
      '  };',
      '',
    ].join('\n')
    expect(applyPatch('studio-password-flag', source)).toBe(
      [
        '  return {',
        '    hasDocument: hasDoc,',
        '    isDirty: documentState.isDirty(),',
        `    ${PASSWORD_FLAG}: wasm.requiresPasswordForSave,`,
        '  };',
        '',
      ].join('\n'),
    )
  })
})

describe('rhwp plugin-allow patch', () => {
  it('lets the studio load the app plugin, and nothing else new', () => {
    const source = [
      'async function resolvePlugin(id: string): Promise<StudioPlugin | null> {',
      "  if (id === 'hwpctrl') return hwpctrlPlugin;",
      "  if (import.meta.env.DEV && id === 'dev-probe') {",
      '    return devProbePlugin;',
      '  }',
      '  return null;',
      '}',
      '',
    ].join('\n')
    const patched = applyPatch('studio-plugin-allow', source)
    expect(patched).toContain(`if (id === '${AGENT_PLUGIN_ID}') {`)
    expect(patched).toContain(`import('${AGENT_PLUGIN_MODULE}')`)
    // the studio's own entries stay, in their order
    expect(patched.indexOf("id === 'hwpctrl'")).toBeLessThan(patched.indexOf(AGENT_PLUGIN_ID))
    expect(patched).toContain("  if (import.meta.env.DEV && id === 'dev-probe') {")
    expect(patched.split('if (').length).toBe(source.split('if (').length + 1)
  })
})

describe('rhwp option-keys patch', () => {
  // rhwp v0.8.7 src/command/shortcut-map.ts, the line spacing and font size chords
  const source = [
    "  [{ key: 'a', alt: true, shift: true }, 'format:line-spacing-decrease'],",
    "  [{ key: 'ㅁ', alt: true, shift: true }, 'format:line-spacing-decrease'],",
    "  [{ key: 'z', alt: true, shift: true }, 'format:line-spacing-increase'],",
    "  [{ key: 'ㅋ', alt: true, shift: true }, 'format:line-spacing-increase'],",
    '',
    "  [{ key: 'e', alt: true, shift: true }, 'format:font-size-increase'],",
    "  [{ key: 'ㄷ', alt: true, shift: true }, 'format:font-size-increase'],",
    "  [{ key: 'r', alt: true, shift: true }, 'format:font-size-decrease'],",
    "  [{ key: 'ㄱ', alt: true, shift: true }, 'format:font-size-decrease'],",
    '',
  ].join('\n')

  it('adds the physical key to the four chords Option rewrites on the Mac', () => {
    const patched = applyPatch('studio-option-keys', source)
    for (const [letter, command] of OPTION_KEYS) {
      expect(patched).toContain(
        `  [{ key: '${letter}', code: 'Key${letter.toUpperCase()}', alt: true, shift: true }, '${command}'],`,
      )
    }
    // the Korean-layout entries stay as they were, and nothing else is added
    expect(patched).toContain(
      "  [{ key: 'ㅁ', alt: true, shift: true }, 'format:line-spacing-decrease'],",
    )
    expect(patched.split('\n').length).toBe(source.split('\n').length)
    expect(patched.match(/code: /g)).toHaveLength(4)
  })

  it('fails when any one of the four lines changed upstream', () => {
    const changed = source.replace("key: 'z', alt: true", "key: 'z', code: 'KeyZ', alt: true")
    expect(() => applyPatch('studio-option-keys', changed)).toThrow(/rhwp patch studio-option-keys/)
  })
})

describe('a patch whose text is gone', () => {
  it('fails loudly instead of building an unpatched editor', () => {
    expect(() => applyPatch('sdk-scheme', 'export class EditorTransport {}')).toThrow(/rhwp patch/)
    expect(() => applyPatch('studio-scheme', 'export const x = 1')).toThrow(/rhwp patch/)
    expect(() => applyPatch('studio-password-flag', 'return { hasDocument }')).toThrow(/rhwp patch/)
    expect(() => applyPatch('studio-plugin-allow', 'return null')).toThrow(/rhwp patch/)
  })

  it('refuses to guess between two matches', () => {
    const twice = "return protocol === 'http:' || protocol === 'https:';\n".repeat(2)
    expect(() => applyPatch('studio-scheme', twice)).toThrow(/exactly one/)
  })
})

describe('what the plugin reaches into the studio for', () => {
  const complete = (file: string) =>
    pluginHooks.find((hook) => hook.file === file)?.needles.join('\n') ?? null

  it('is all there in a source that has every name', () => {
    expect(missingPluginHooks(complete)).toEqual([])
  })

  it('names the file and the name when one is gone', () => {
    const renamed = (file: string) =>
      (complete(file) ?? '').replace('getSelectionOrdered()', 'selectionInOrder()')
    expect(missingPluginHooks(renamed)).toEqual(['src/engine/cursor.ts: getSelectionOrdered()'])
  })

  it('counts every name of a file that is gone', () => {
    const gone = (file: string) => (file === 'src/automation/types.ts' ? null : complete(file))
    expect(missingPluginHooks(gone)).toEqual([
      'src/automation/types.ts: registerCommand(def: ExtCommandDef): void',
    ])
  })
})
