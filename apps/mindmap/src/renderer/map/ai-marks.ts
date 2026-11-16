/**
 * The mark on the topics the last AI run added or changed (ai/AiPanel.tsx).
 * It is a class on the drawn topic and nothing else: the node data, the file,
 * the clipboard and the model never see it, and the export copy takes it off
 * (`export/snapshot.ts`), so pictures, PDF and print show the map unmarked.
 * The look is in `styles.css`, in the shared mark tokens.
 */

export const AI_MARK_CLASS = 'mm-ai-changed'

/** A drawn topic and the id of the node it shows. */
type DrawnTopic = Element & { nodeObj?: { id?: unknown } }

/**
 * Puts the mark on the drawn topics whose id is in `ids` and takes it off
 * every other one. The library draws topics anew when it lays the map out, so
 * the controller calls this after every drawing.
 */
export function drawAiMarks(nodes: ParentNode, ids: ReadonlySet<string>): void {
  for (const topic of nodes.querySelectorAll<DrawnTopic>('me-tpc')) {
    const id = topic.nodeObj?.id
    topic.classList.toggle(AI_MARK_CLASS, typeof id === 'string' && ids.has(id))
  }
}
