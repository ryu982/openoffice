/**
 * Crisp 24x24 line icons for the whiteboard workspace chrome (vertical tool rail,
 * header, bottom-left undo/zoom pills, dark floating format bar, and shape picker).
 */
import type { ReactElement, ReactNode } from 'react'
import type { ShapeKind } from '@genoffice/whiteboard-engine'
import { shapePath } from '../canvas/shape-paths'

interface IconProps {
  readonly size?: number
  readonly strokeWidth?: number
}

function makeIcon(paths: ReactNode, defaultStroke = 1.8) {
  return function LineIcon({ size = 20, strokeWidth = defaultStroke }: IconProps): ReactElement {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {paths}
      </svg>
    )
  }
}

export const SelectIcon = makeIcon(<path d="M5 3l13 6.5-5.5 1.8L10.5 17z" />)
export const StickyIcon = makeIcon(
  <>
    <path d="M4 4h16v10l-6 6H4z" />
    <path d="M14 20v-6h6" />
  </>,
)
export const TextIcon = makeIcon(
  <>
    <path d="M5 7V5h14v2" />
    <path d="M12 5v14" />
    <path d="M9 19h6" />
  </>,
)
export const ShapeIcon = makeIcon(
  <>
    <rect x="3" y="3" width="10" height="10" rx="1.5" />
    <circle cx="16.5" cy="16.5" r="4.5" />
  </>,
)
export const ConnectorIcon = makeIcon(
  <>
    <path d="M5 19L18 6" />
    <path d="M10 6h8v8" />
  </>,
)
export const PenIcon = makeIcon(
  <>
    <path d="M4 20l1-4L16 5l3 3L8 19z" />
    <path d="M13.5 7.5l3 3" />
  </>,
)
export const HighlighterIcon = makeIcon(
  <>
    <path d="M9 15l-4 4h5l2-2" />
    <path d="M9 15l7.5-9.5a2 2 0 0 1 3 0l.5.5a2 2 0 0 1 0 3L11 16.5z" />
    <path d="M4 21h16" />
  </>,
)
export const EraserIcon = makeIcon(
  <>
    <path d="M8.5 20H20" />
    <path d="M4.6 14.6l8.8-8.8a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L12.4 18.4a2 2 0 0 1-1.4.6H8a2 2 0 0 1-1.4-.6l-2-2a2 2 0 0 1 0-2.8z" />
    <path d="M9 10l5 5" />
  </>,
)
export const ImageIcon = makeIcon(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="M21 16l-5-5-8 8" />
  </>,
)
export const TableIcon = makeIcon(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M15 4.5v15" />
  </>,
)
export const StickerToolIcon = makeIcon(
  <path d="M12 3.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" />,
)
export const LinkIcon = makeIcon(
  <>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l2.2-2.2a4.5 4.5 0 0 0-6.4-6.4L10.8 6.8" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-2.2 2.2a4.5 4.5 0 0 0 6.4 6.4l1.4-1.4" />
  </>,
)
export const PdfIcon = makeIcon(
  <>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
    <path d="M9 13h6M9 16.5h4" />
  </>,
)
export const UndoIcon = makeIcon(
  <>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-4" />
  </>,
)
export const RedoIcon = makeIcon(
  <>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9a5 5 0 0 0 0 10h4" />
  </>,
)
export const MinusIcon = makeIcon(<path d="M5 12h14" />, 2)
export const PlusIcon = makeIcon(
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>,
  2,
)
export const FitIcon = makeIcon(
  <>
    <path d="M4 9V4h5" />
    <path d="M20 9V4h-5" />
    <path d="M4 15v5h5" />
    <path d="M20 15v5h-5" />
  </>,
)
export const PresentIcon = makeIcon(
  <>
    <rect x="3" y="4" width="18" height="12" rx="1.5" />
    <path d="M12 16v4" />
    <path d="M8 20h8" />
    <path d="M10.5 8l3.5 2-3.5 2z" />
  </>,
)
export const ExportIcon = makeIcon(
  <>
    <path d="M12 4v11" />
    <path d="M7.5 10.5L12 15l4.5-4.5" />
    <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
  </>,
)
export const PrintIcon = makeIcon(
  <>
    <path d="M6 9V4h12v5" />
    <rect x="4" y="9" width="16" height="8" rx="1.5" />
    <path d="M7 14h10v6H7z" />
  </>,
)
export const FrontIcon = makeIcon(
  <>
    <path d="M7 11l5-5 5 5" />
    <path d="M7 17l5-5 5 5" />
  </>,
)
export const BackIcon = makeIcon(
  <>
    <path d="M7 7l5 5 5-5" />
    <path d="M7 13l5 5 5-5" />
  </>,
)
export const DuplicateIcon = makeIcon(
  <>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </>,
)
export const TrashIcon = makeIcon(
  <>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
  </>,
)
export const AlignLeftIcon = makeIcon(
  <>
    <path d="M4 6h16" />
    <path d="M4 12h11" />
    <path d="M4 18h14" />
  </>,
)
export const AlignCenterIcon = makeIcon(
  <>
    <path d="M4 6h16" />
    <path d="M6.5 12h11" />
    <path d="M5 18h14" />
  </>,
)
export const AlignRightIcon = makeIcon(
  <>
    <path d="M4 6h16" />
    <path d="M9 12h11" />
    <path d="M6 18h14" />
  </>,
)
export const SolidLineIcon = makeIcon(<path d="M4 12h16" />, 2.2)
export const DashedLineIcon = makeIcon(<path d="M4 12h4M10.5 12h3M16 12h4" />, 2.2)
export const ArrowStartIcon = makeIcon(
  <>
    <path d="M20 12H6" />
    <path d="M11 7l-5 5 5 5" />
  </>,
)
export const ArrowEndIcon = makeIcon(
  <>
    <path d="M4 12h14" />
    <path d="M13 7l5 5-5 5" />
  </>,
)
export const LineEndIcon = makeIcon(<path d="M5 12h14" />, 2)

export function ShapeKindGlyph({
  kind,
  size = 20,
}: {
  kind: ShapeKind
  size?: number
}): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="translate(3, 4)">
        <path d={shapePath(kind, 18, 16, 1)} />
      </g>
    </svg>
  )
}
