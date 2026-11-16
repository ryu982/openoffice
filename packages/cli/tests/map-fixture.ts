import { writeFileSync } from 'node:fs'
import {
  createXmindDocumentFromSheets,
  newSheet,
  newTopic,
  type XmindTopic,
} from '@genoffice/xmind-engine'

/** The line values styledMap writes on A, as the file holds them. */
export const LINE_A = {
  'line-class': 'org.xmind.branchConnection.curve',
  'line-width': '3pt',
  'line-color': '#112233',
} as const

/**
 * The map the `map-*` tests read and edit: one sheet "Plan", Root with A and B,
 * A1 under A, a floating topic under A1 (a preserved element), and a note and a
 * link on B. Built with the engine into a temp dir; nothing here touches a real
 * program or a real user's files.
 */
export async function sampleMap(path: string) {
  const sheet = newSheet({ title: 'Plan', rootTitle: 'Root' })
  const a = newTopic('A')
  const b = newTopic('B')
  const a1 = newTopic('A1')
  a1.children = { detached: [{ id: 'float-1', title: 'Floating' }] }
  a.children = { attached: [a1] }
  b.notes = { plain: { content: 'B note' } }
  b.href = 'https://example.com/b'
  sheet.rootTopic.children = { attached: [a, b] }
  const document = await createXmindDocumentFromSheets([sheet])
  writeFileSync(path, await document.save())
  return { root: sheet.rootTopic.id, a: a.id, b: b.id, a1: a1.id, float: 'float-1' }
}

/**
 * A map for the line inheritance of decision 0102: A carries line values
 * written on itself, B carries none, D carries one value the engine does not
 * write (`2.5pt`), and C with C1 below Root is there to move in. C1 carries
 * values of its own to show the parent's overwriting the matching keys and
 * leaving the others.
 */
export async function styledMap(path: string) {
  const sheet = newSheet({ title: 'Styled', rootTitle: 'Root' })
  const a = newTopic('A')
  a.style = { id: 'style-a', properties: { ...LINE_A } }
  const a1 = newTopic('A1')
  a.children = { attached: [a1] }
  const b = newTopic('B')
  const d = newTopic('D')
  d.style = { id: 'style-d', properties: { 'line-width': '2.5pt', 'line-color': '#112233' } }
  const c = newTopic('C')
  const c1 = newTopic('C1')
  c1.style = { id: 'style-c1', properties: { 'line-color': '#445566', 'line-pattern': 'dot' } }
  c.children = { attached: [c1] }
  sheet.rootTopic.children = { attached: [a, b, c, d] }
  const document = await createXmindDocumentFromSheets([sheet])
  writeFileSync(path, await document.save())
  return {
    root: sheet.rootTopic.id,
    a: a.id,
    a1: a1.id,
    b: b.id,
    c: c.id,
    c1: c1.id,
    d: d.id,
  }
}

/**
 * A map with summaries: A holds a summary over A1 (the summary record on A,
 * its summary topic below A), and B holds a summary whose summary topic has a
 * branch below it — a delete of that summary topic would take the branch.
 */
export async function summaryMap(path: string) {
  const sheet = newSheet({ title: 'Sums', rootTitle: 'Root' })
  const a = newTopic('A')
  const a1 = newTopic('A1')
  a.children = { attached: [a1], summary: [{ id: 'sum-topic-1', title: 'Sum' }] }
  a.summaries = [{ id: 'sum-record-1', range: '(0,0)', topicId: 'sum-topic-1' }]
  const b = newTopic('B')
  const b1 = newTopic('B1')
  b.children = {
    attached: [b1],
    summary: [
      {
        id: 'sum-topic-2',
        title: 'Guarded',
        children: { attached: [{ id: 'sum-branch-1', title: 'Under' }] },
      },
    ],
  }
  b.summaries = [{ id: 'sum-record-2', range: '(0,0)', topicId: 'sum-topic-2' }]
  sheet.rootTopic.children = { attached: [a, b] }
  const document = await createXmindDocumentFromSheets([sheet])
  writeFileSync(path, await document.save())
  return {
    root: sheet.rootTopic.id,
    a: a.id,
    a1: a1.id,
    b: b.id,
    summary: 'sum-topic-1',
    guarded: 'sum-topic-2',
    under: 'sum-branch-1',
  }
}

/** Two sheets that both hold a topic with the id `dup-1`: no op can say which one it means. */
export async function twoSheetMap(path: string) {
  const first = newSheet({ title: 'First', rootTitle: 'Root one' })
  const dupOne: XmindTopic = { id: 'dup-1', title: 'Dup' }
  first.rootTopic.children = { attached: [dupOne] }
  const second = newSheet({ title: 'Second', rootTitle: 'Root two' })
  const dupTwo: XmindTopic = { id: 'dup-1', title: 'Dup' }
  second.rootTopic.children = { attached: [dupTwo] }
  const document = await createXmindDocumentFromSheets([first, second])
  writeFileSync(path, await document.save())
  return { dup: 'dup-1' }
}
