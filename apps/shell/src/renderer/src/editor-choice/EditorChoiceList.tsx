import { useId } from 'react'
import {
  EDITOR_ITEM_IDS,
  isLastEditorOn,
  setEditorItemOn,
  type EditorItemId,
} from '../../../shared/editor-choice'
import { editorItemName, editorPickText } from '../i18n/strings-editor-pick'
import { useI18n } from '../locale'
import './editor-choice.css'

/** the formats under an item's name; the PDF tools have none and say what they do */
const ITEM_FORMATS: Readonly<Record<EditorItemId, string | null>> = {
  docs: '.docx · .odt',
  sheets: '.xlsx · .xls · .csv · .ods',
  slides: '.pptx · .ppt',
  pdf: '.pdf',
  pdfTools: null,
  markdown: '.md · .txt',
  html: '.html · .htm',
  mindmap: '.xmind',
  diagram: '.drawio · .vsdx',
  hwp: '.hwp · .hwpx',
  epub: '.epub',
}

export interface EditorChoiceListProps {
  /** the items turned off */
  off: readonly EditorItemId[]
  aiFeatures: boolean
  /** an item was switched; the new off list (the last editor never leaves it empty of editors) */
  onOffChange: (off: EditorItemId[]) => void
  onAiFeaturesChange: (on: boolean) => void
  /** items whose editor has documents open now: marked "Documents open" */
  openItems?: ReadonlySet<EditorItemId>
  /** every switch waits (a save is under way) */
  disabled?: boolean
}

/**
 * The eleven items (ten editors and the PDF tools) and AI, each with an
 * on/off switch. The first-run pick step, the one-time picker on Home and
 * Settings → Editors and AI show this same list. The last editor on cannot
 * be switched off: its switch is disabled and the row says why. The PDF tools
 * are not an editor and never count.
 */
export function EditorChoiceList({
  off,
  aiFeatures,
  onOffChange,
  onAiFeaturesChange,
  openItems,
  disabled = false,
}: EditorChoiceListProps) {
  const { lang } = useI18n()
  const baseId = useId()
  const choice = { off: [...off] }

  return (
    <div className="ec-list-wrap">
      <ul className="ec-list" aria-label={editorPickText(lang, 'pickEditorsLabel')}>
        {EDITOR_ITEM_IDS.map((item) => {
          const on = !off.includes(item)
          const last = isLastEditorOn(choice, item)
          const name = editorItemName(lang, item)
          const nameId = `${baseId}-${item}-name`
          const reasonId = `${baseId}-${item}-reason`
          const formats = ITEM_FORMATS[item]
          return (
            <li key={item} className="ec-row" data-item={item} data-on={on}>
              <div className="ec-row-text">
                <span className="ec-row-name" id={nameId}>
                  {name}
                </span>
                <span className="ec-row-hint">
                  {formats ?? editorPickText(lang, 'itemPdfToolsHint')}
                </span>
                {openItems?.has(item) && (
                  <span className="ec-row-open">{editorPickText(lang, 'pickOpenDocs')}</span>
                )}
                {last && (
                  <span className="ec-row-reason" id={reasonId}>
                    {editorPickText(lang, 'pickLastEditor')}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="ec-switch"
                role="switch"
                aria-checked={on}
                aria-labelledby={nameId}
                aria-describedby={last ? reasonId : undefined}
                disabled={disabled || last}
                onClick={() => onOffChange(setEditorItemOn(choice, item, !on).off)}
              />
            </li>
          )
        })}
      </ul>
      <div className="ec-row ec-row-ai" data-item="ai" data-on={aiFeatures}>
        <div className="ec-row-text">
          <span className="ec-row-name" id={`${baseId}-ai-name`}>
            {editorPickText(lang, 'pickAiName')}
          </span>
          <span className="ec-row-hint">{editorPickText(lang, 'pickAiHint')}</span>
        </div>
        <button
          type="button"
          className="ec-switch"
          role="switch"
          aria-checked={aiFeatures}
          aria-labelledby={`${baseId}-ai-name`}
          disabled={disabled}
          onClick={() => onAiFeaturesChange(!aiFeatures)}
        />
      </div>
    </div>
  )
}
