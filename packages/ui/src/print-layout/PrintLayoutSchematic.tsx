import { useId, useMemo, type ReactElement } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { PageSize, PrintLayoutOptions } from '@genoffice/print-layout/plan'
import { printLayoutText } from '../strings-print-layout'
import {
  layoutSchematic,
  printLayoutIssueText,
  labelCellsOf,
  PRINT_LAYOUT_SCHEMATIC_FACES,
  type SchematicFace,
} from './model'
import './print-layout.css'

export interface PrintLayoutSchematicProps {
  lang: Lang
  /** the job's page sizes in points (/Rotate applied); null while the editor counts them */
  pages: readonly PageSize[] | null
  options: PrintLayoutOptions
  /** how many faces to draw */
  maxFaces?: number | undefined
}

/** Longest side of one drawn face, in CSS pixels */
const FACE_PX = 132

function caption(lang: Lang, f: SchematicFace): string {
  if (f.booklet) {
    return printLayoutText(lang, f.booklet.side === 'front' ? 'bookletFront' : 'bookletBack', {
      sheet: f.booklet.sheet,
    })
  }
  if (f.poster) return printLayoutText(lang, 'posterTile', f.poster)
  return printLayoutText(lang, 'faceCaption', { face: f.face })
}

function Face({ lang, face, clipId }: { lang: Lang; face: SchematicFace; clipId: string }) {
  const scale = FACE_PX / Math.max(face.width, face.height)
  const fontFor = (w: number, h: number) => Math.max(6, Math.min(w, h) * 0.4)
  return (
    <figure
      className="gs-pl-face"
      data-pl-face={face.face}
      data-excluded={face.excluded ? 'true' : 'false'}
    >
      <svg
        className="gs-pl-face-svg"
        width={Math.round(face.width * scale)}
        height={Math.round(face.height * scale)}
        viewBox={`0 0 ${face.width} ${face.height}`}
        aria-hidden="true"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={face.width} height={face.height} />
          </clipPath>
        </defs>
        <rect className="gs-pl-sheet" x={0} y={0} width={face.width} height={face.height} />
        <g clipPath={`url(#${clipId})`}>
          {face.cells.map((c, i) => {
            const kind = c.start
              ? 'start'
              : c.skipped
                ? 'skipped'
                : c.page === null
                  ? 'empty'
                  : 'page'
            const area = c.content ?? c.box
            return (
              <g key={i} data-pl-cell={kind}>
                {c.labelCell !== undefined && (
                  <rect
                    className={`gs-pl-label-cell${c.skipped ? ' skipped' : ''}${c.start ? ' start' : ''}`}
                    x={c.box.x}
                    y={c.box.y}
                    width={c.box.width}
                    height={c.box.height}
                  />
                )}
                {c.page !== null && c.content && (
                  <rect
                    className="gs-pl-page"
                    x={c.content.x}
                    y={c.content.y}
                    width={c.content.width}
                    height={c.content.height}
                  />
                )}
                {c.blank && (
                  <rect
                    className="gs-pl-blank"
                    x={c.box.x}
                    y={c.box.y}
                    width={c.box.width}
                    height={c.box.height}
                  />
                )}
                {c.page !== null && (
                  <text
                    className="gs-pl-page-number"
                    data-pl-page={c.page}
                    x={area.x + area.width / 2}
                    y={area.y + area.height / 2}
                    fontSize={fontFor(
                      Math.min(area.width, face.width),
                      Math.min(area.height, face.height),
                    )}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {c.page}
                  </text>
                )}
              </g>
            )
          })}
          {face.cutMarks.map((m, i) => (
            <line key={i} className="gs-pl-cut" x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} />
          ))}
        </g>
      </svg>
      <figcaption className="gs-pl-face-caption">{caption(lang, face)}</figcaption>
      {face.excluded && (
        <span className="gs-pl-face-tag">{printLayoutText(lang, 'faceExcluded')}</span>
      )}
      {face.cells.some((c) => c.blank) && (
        <span className="gs-pl-face-tag">{printLayoutText(lang, 'blankPage')}</span>
      )}
      {face.cells.some((c) => c.start) && (
        <span className="gs-pl-face-tag">{printLayoutText(lang, 'labelStartMark')}</span>
      )}
    </figure>
  )
}

/**
 * Layout diagram (spec 4.7): the first few faces of the plan with page numbers,
 * empty cells, booklet sides, faces the odd/even filter drops, poster pieces and
 * label cells. No page pictures; it follows the options at once.
 */
export function PrintLayoutSchematic(props: PrintLayoutSchematicProps): ReactElement {
  const { lang, pages, options, maxFaces = PRINT_LAYOUT_SCHEMATIC_FACES } = props
  const baseId = useId()
  const view = useMemo(
    () => (pages ? layoutSchematic(pages, options, maxFaces) : null),
    [pages, options, maxFaces],
  )
  const label = printLayoutText(lang, 'schematicLabel')
  if (!pages || !view) {
    return (
      <div className="gs-pl-schematic" role="group" aria-label={label}>
        <p className="gs-pl-hint">{printLayoutText(lang, 'pagesLoading')}</p>
      </div>
    )
  }
  if (view.issue) {
    return (
      <div className="gs-pl-schematic" role="group" aria-label={label}>
        <p className="gs-pl-hint">
          {printLayoutIssueText(lang, view.issue, {
            pageCount: pages.length,
            cellCount: labelCellsOf(options),
          })}
        </p>
      </div>
    )
  }
  const more = view.totalFaces - view.faces.length
  return (
    <div className="gs-pl-schematic" role="group" aria-label={label}>
      <div className="gs-pl-faces">
        {view.faces.map((f) => (
          <Face key={f.face} lang={lang} face={f} clipId={`${baseId}-clip-${f.face}`} />
        ))}
        {more > 0 && (
          <span className="gs-pl-more" data-pl="more-faces">
            {printLayoutText(lang, 'moreFaces', { count: more })}
          </span>
        )}
      </div>
      {options.reverse && <p className="gs-pl-hint">{printLayoutText(lang, 'reverseNote')}</p>}
    </div>
  )
}
