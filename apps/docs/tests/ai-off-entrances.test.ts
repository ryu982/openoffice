// Settings › Editors and AI: while AI is off the Word editor draws no AI entry
// (ribbon, Review tab, right-click menu, shortcut sheet); turning AI back on
// brings them all back without a reload. The choice comes in through the same
// provider main.tsx mounts, fed by a fake of the preload's read-and-hear bridge.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { AppChoiceSource, AppChoiceState } from '@genoffice/ui'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { computeFormatState } from '../src/renderer/components/ribbon-format-state'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { EditorContextMenu } from '../src/renderer/components/ContextMenu'
import { ShortcutsDialog } from '../src/renderer/components/ShortcutsDialog'
import { AiVisibilityProvider } from '../src/renderer/ai-visibility'
import { LocaleProvider, setModuleLang, t } from '../src/renderer/i18n/locale'
import { ribbonProps } from './helpers/ribbon-props'

const choice = (aiFeatures: boolean): AppChoiceState => ({ off: [], aiFeatures, locked: false })

/** the preload's bridge as the screen sees it: answers `current`, and `change` broadcasts */
function fakeSource(current: AppChoiceState) {
  const listeners = new Set<(c: AppChoiceState) => void>()
  const source: AppChoiceSource = {
    get: async () => current,
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    source,
    change(next: AppChoiceState) {
      current = next
      for (const listener of listeners) listener(next)
    },
  }
}

function makeEditor(): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'docParagraph',
          attrs: { docxIndex: 0 },
          content: [{ type: 'text', text: 'call the client about the order' }],
        },
      ],
    },
  })
}

const noop = () => {}
const tipped = (container: Element, key: Parameters<typeof t>[0]) =>
  container.querySelector(`[data-tip="${t(key)}"]`)
const labelled = (container: Element, label: string) =>
  [...container.querySelectorAll('.ctx-label')].some((el) => el.textContent === label)

describe('AI entrances of the Word editor follow the AI switch', () => {
  let editor: Editor
  let root: Root
  let container: HTMLElement

  beforeEach(() => {
    setModuleLang('en')
    editor = makeEditor()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    ;(window as unknown as { desktop: unknown }).desktop = { onLanguageChanged: () => () => {} }
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    editor.destroy()
    setModuleLang('zh')
  })

  async function mount(source: AppChoiceSource, initial: AppChoiceState, child: ReactElement) {
    await act(async () => {
      root.render(
        createElement(LocaleProvider, {
          initial: 'en',
          children: createElement(AiVisibilityProvider, { source, initial, children: child }),
        }),
      )
    })
  }

  it('hides the Home AI group while AI is off and shows it again when AI is turned on', async () => {
    const bridge = fakeSource(choice(false))
    await mount(
      bridge.source,
      choice(false),
      createElement(Ribbon, ribbonProps(editor, computeFormatState(editor))),
    )
    expect(container.querySelector('.ai-entry')).toBeNull()
    expect(tipped(container, 'aiSummarizeBtn')).toBeNull()
    // the rest of the Home tab is still there
    expect(container.querySelector('.ribbon-group')).not.toBeNull()

    await act(async () => bridge.change(choice(true)))
    expect(tipped(container, 'aiOpenAssistant')).not.toBeNull()
    expect(tipped(container, 'aiSummarizeBtn')).not.toBeNull()
    expect(container.querySelectorAll('.ai-entry').length).toBe(5)
  })

  it('draws no AI part even before the first answer when the start value is off', async () => {
    // the answer never comes: the initial value read before mounting decides
    const silent: AppChoiceSource = { get: () => new Promise(() => {}), onChange: () => noop }
    await mount(
      silent,
      choice(false),
      createElement(Ribbon, ribbonProps(editor, computeFormatState(editor))),
    )
    expect(container.querySelector('.ai-entry')).toBeNull()
  })

  it('hides the Review tab AI actions (Editor, Translate, AI comments, AI revisions)', async () => {
    const bridge = fakeSource(choice(false))
    const review = () =>
      createElement(Ribbon, {
        ...ribbonProps(editor, computeFormatState(editor)),
        tabRequest: { tab: 'review', nonce: 1 },
      })
    await mount(bridge.source, choice(false), review())
    // the Review tab is showing: spelling stays, it is not AI
    expect(tipped(container, 'ribbonSpellcheckTip')).not.toBeNull()
    expect(tipped(container, 'ribbonEditorTip')).toBeNull()
    expect(tipped(container, 'ribbonTranslateTip')).toBeNull()
    expect(container.textContent).not.toContain(t('ribbonAiComments'))
    expect(container.textContent).not.toContain(t('ribbonAiRevisions'))

    await act(async () => bridge.change(choice(true)))
    expect(tipped(container, 'ribbonEditorTip')).not.toBeNull()
    expect(tipped(container, 'ribbonTranslateTip')).not.toBeNull()
    expect(container.textContent).toContain(t('ribbonAiComments'))
    expect(container.textContent).toContain(t('ribbonAiRevisions'))
  })

  it('leaves the AI items and withholding out of the right-click menu', async () => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 9)))
    const bridge = fakeSource(choice(false))
    const menu = createElement(EditorContextMenu, {
      editor,
      menu: { x: 10, y: 10 },
      onClose: noop,
      onFontDialog: noop,
      onParagraphDialog: noop,
      onLink: noop,
      onNewComment: noop,
      onViewImage: noop,
      onSaveImageAs: noop,
      onAiPreset: noop,
      onRedact: noop,
      onUnredact: noop,
    })
    await mount(bridge.source, choice(false), menu)
    const aiLabels = [t('appSynonyms'), t('appEasyWords'), t('appTranslate'), t('redactMenuLabel')]
    expect(labelled(document.body, t('appCopy'))).toBe(true)
    for (const label of aiLabels) expect(labelled(document.body, label), label).toBe(false)

    await act(async () => bridge.change(choice(true)))
    for (const label of aiLabels) expect(labelled(document.body, label), label).toBe(true)
  })

  it('does not list the AI proofread key (F7) in the shortcut sheet', async () => {
    const bridge = fakeSource(choice(false))
    await mount(bridge.source, choice(false), createElement(ShortcutsDialog, { onClose: noop }))
    expect(document.body.textContent).toContain(t('appWordCountTitle'))
    expect(document.body.textContent).not.toContain(t('appScProofread'))

    await act(async () => bridge.change(choice(true)))
    expect(document.body.textContent).toContain(t('appScProofread'))
  })
})

// The App, its preload and its entry are too large to mount here: their wiring is read as text
describe('wiring of the AI switch in the Word editor', () => {
  const source = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8')

  it('exposes the choice to read and hear only, never to change', () => {
    const preload = source('src/preload/index.ts')
    expect(preload).toMatch(
      /exposeInMainWorld\(APP_CHOICE_BRIDGE_KEY, \{\s*get: editorChoice\.get,\s*onChange: editorChoice\.onChange,\s*\}\)/,
    )
    expect(preload).not.toMatch(/editorChoice\.(set|stopAllAiJobs)/)
  })

  it('mounts the App under the provider, started from the value read before the first frame', () => {
    const main = source('src/renderer/main.tsx')
    expect(main).toContain('const choice = await initialAppChoice(choiceSource)')
    expect(main).toMatch(
      /<AiVisibilityProvider source=\{choiceSource\} initial=\{choice\}>\s*<App \/>/,
    )
  })

  it('draws the AI dock and Ask AI only while AI is on, and ignores AI menu commands and F7 when off', () => {
    const app = source('src/renderer/App.tsx')
    expect(app).toMatch(/\{doc && aiOn && \(\s*<div\s*className=\{`ai-dock/)
    expect(app).toMatch(/\{doc && aiOn && \(\s*<AiAskPopover/)
    expect(app).toContain('if (!aiOnRef.current) return')
    expect(app).toContain('if (aiOnRef.current) setShowAi((v) => !v)')
  })
})
