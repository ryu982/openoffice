import { afterEach, describe, expect, it } from 'vitest'
import { setAppChoiceSource, type EditorItemId } from '../src/app-choice'
import {
  aiCreateRefusal,
  editorItemOfCreateType,
  withOffDocumentKinds,
} from '../src/ai-create-guard'

const off = (...items: EditorItemId[]) =>
  setAppChoiceSource(() => ({ off: items, aiFeatures: true, locked: false }))

afterEach(() => setAppChoiceSource(null))

const CREATE_TOOL = {
  name: 'create_document',
  description: 'Create a NEW standalone file.',
  inputSchema: {
    type: 'object',
    properties: { type: { type: 'string', enum: ['docx', 'pdf', 'md', 'html'] } },
  },
}
const OTHER_TOOL = { name: 'insert_content', description: 'Insert.', inputSchema: {} }

describe('editorItemOfCreateType', () => {
  it('names the editor that opens each type the AI can make', () => {
    expect(editorItemOfCreateType('docx')).toBe('docs')
    expect(editorItemOfCreateType('pdf')).toBe('pdf')
    expect(editorItemOfCreateType('md')).toBe('markdown')
    expect(editorItemOfCreateType('html')).toBe('html')
    expect(editorItemOfCreateType('xlsx')).toBe('sheets')
    expect(editorItemOfCreateType('csv')).toBe('sheets')
    expect(editorItemOfCreateType('pptx')).toBe('slides')
    expect(editorItemOfCreateType('hwpx')).toBe('hwp')
    expect(editorItemOfCreateType('hwp')).toBe('hwp')
    expect(editorItemOfCreateType('xmind')).toBe('mindmap')
    expect(editorItemOfCreateType('drawio')).toBe('diagram')
    expect(editorItemOfCreateType('epub')).toBe('epub')
  })

  it('knows no editor for an unknown type', () => {
    expect(editorItemOfCreateType('exe')).toBeNull()
    expect(editorItemOfCreateType(undefined)).toBeNull()
    expect(editorItemOfCreateType('toString')).toBeNull()
  })
})

describe('aiCreateRefusal', () => {
  it('lets every type through while everything is on (and with no source set)', () => {
    for (const type of ['docx', 'pdf', 'md', 'html', 'xlsx', 'csv']) {
      expect(aiCreateRefusal(type)).toBeNull()
    }
  })

  it('refuses a type whose editor is off, with a reason the AI can pass on', () => {
    off('docs', 'markdown')
    const docx = aiCreateRefusal('docx')
    expect(docx).toContain('.docx')
    expect(docx).toContain('turned off')
    expect(docx).toContain('Settings → Editors and AI')
    expect(aiCreateRefusal('md')).toContain('Markdown')
    expect(aiCreateRefusal('pdf')).toBeNull()
    expect(aiCreateRefusal('html')).toBeNull()
  })

  it('refuses spreadsheet types when the spreadsheet editor is off', () => {
    off('sheets')
    expect(aiCreateRefusal('xlsx')).toContain('turned off')
    expect(aiCreateRefusal('csv')).toContain('turned off')
  })

  it('reads the choice at the moment it is asked', () => {
    let items: EditorItemId[] = []
    setAppChoiceSource(() => ({ off: items, aiFeatures: true, locked: false }))
    expect(aiCreateRefusal('html')).toBeNull()
    items = ['html']
    expect(aiCreateRefusal('html')).not.toBeNull()
  })

  it('leaves unknown types to the creator, which names them', () => {
    off('docs')
    expect(aiCreateRefusal('exe')).toBeNull()
  })
})

describe('withOffDocumentKinds', () => {
  it('returns the very same tools while every type the tool makes is on', () => {
    const tools = [CREATE_TOOL, OTHER_TOOL]
    expect(withOffDocumentKinds(tools)).toBe(tools)
    off('sheets', 'slides')
    // the tool makes none of these
    expect(withOffDocumentKinds(tools)).toBe(tools)
  })

  it('tells the model on the create tool which of its types it must not make', () => {
    off('docs', 'html')
    const tools = [CREATE_TOOL, OTHER_TOOL]
    const out = withOffDocumentKinds(tools)
    expect(out).not.toBe(tools)
    const create = out[0]!
    expect(create.description.startsWith(CREATE_TOOL.description)).toBe(true)
    expect(create.description).toContain("'docx'")
    expect(create.description).toContain("'html'")
    expect(create.description).not.toContain("'pdf'")
    expect(create.description).toContain('Settings → Editors and AI')
    // the schema and the other tools are untouched, the input array is not changed
    expect(create.inputSchema).toBe(CREATE_TOOL.inputSchema)
    expect(out[1]).toBe(OTHER_TOOL)
    expect(tools[0]).toBe(CREATE_TOOL)
    expect(CREATE_TOOL.description).toBe('Create a NEW standalone file.')
  })

  it('uses every known type when the tool lists none', () => {
    off('sheets')
    const bare = { name: 'create_document', description: 'Create.', inputSchema: {} }
    const [create] = withOffDocumentKinds([bare])
    expect(create!.description).toContain("'xlsx'")
    expect(create!.description).toContain("'csv'")
  })
})
