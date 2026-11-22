/**
 * Built-in vector stickers in warm paper-craft style (zero external assets,
 * theme-invariant document artwork with warm-white die-cut edges).
 */
import type { ReactElement, ReactNode } from 'react'

export const STICKER_IDS = [
  'star',
  'heart',
  'check',
  'thumbsup',
  'bulb',
  'fire',
  'trophy',
  'medal',
  'flag',
  'rocket',
  'sparkle',
  'arrow',
  'speech',
  'pencil',
  'book',
  'clock',
  'one',
  'two',
  'three',
] as const

export type StickerId = (typeof STICKER_IDS)[number]

const INK = '#221D17'
const PAPER = '#FFFDF8'
const YELLOW = '#F5C542'
const ORANGE = '#EE8C3A'
const RED = '#E0574F'
const GREEN = '#4FA66A'
const BLUE = '#4C86D0'
const PURPLE = '#8C6CC7'
const SKIN = '#F7CB7C'

function starPath(cx: number, cy: number, rOut: number, rIn: number): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5
    const r = i % 2 === 0 ? rOut : rIn
    pts.push(
      `${i === 0 ? 'M' : 'L'}${(cx + Math.cos(angle) * r).toFixed(1)} ${(cy + Math.sin(angle) * r).toFixed(1)}`,
    )
  }
  return `${pts.join(' ')} Z`
}

function sparklePath(cx: number, cy: number, r: number): string {
  const q = r * 0.26
  return `M${cx} ${cy - r} Q${cx + q} ${cy - q} ${cx + r} ${cy} Q${cx + q} ${cy + q} ${cx} ${cy + r} Q${cx - q} ${cy + q} ${cx - r} ${cy} Q${cx - q} ${cy - q} ${cx} ${cy - r} Z`
}

const SAFE_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,24})$/

function safeTint(tint: string | undefined, fallback: string): string {
  if (typeof tint !== 'string') return fallback
  const trimmed = tint.trim()
  return SAFE_COLOR_RE.test(trimmed) ? trimmed : fallback
}

/** Wraps inner SVG paths with a warm-white die-cut sticker edge. */
function dieCutSvg(inner: string): string {
  return `<g stroke="${PAPER}" stroke-width="10" stroke-linejoin="round" fill="${PAPER}">${inner}</g>${inner}`
}

/** Pure SVG markup string for a sticker (used by both live DOM and SVG/PNG/PDF export). */
export function stickerInnerSvg(stickerId: string, tint?: string): string {
  const accent = safeTint(tint, YELLOW)
  switch (stickerId) {
    case 'star':
      return dieCutSvg(
        `<path d="${starPath(50, 52, 40, 18)}" fill="${accent}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>`,
      )
    case 'heart':
      return dieCutSvg(
        `<path d="M50 84 C20 62 12 42 18 28 C24 14 40 16 50 30 C60 16 76 14 82 28 C88 42 80 62 50 84 Z" fill="${safeTint(tint, RED)}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>`,
      )
    case 'check':
      return `${dieCutSvg(`<circle cx="50" cy="50" r="38" fill="${safeTint(tint, GREEN)}" stroke="${INK}" stroke-width="3.2"/>`)}<path d="M30 52 L44 66 L72 36" fill="none" stroke="${PAPER}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`
    case 'thumbsup':
      return dieCutSvg(
        `<rect x="14" y="46" width="18" height="38" rx="3" fill="${safeTint(tint, BLUE)}" stroke="${INK}" stroke-width="3.2"/><path d="M34 48 H46 L52 24 C54 18 63 18 64 26 L62 44 H78 C84 44 88 50 86 56 L80 78 C79 82 76 84 72 84 H34 Z" fill="${SKIN}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>`,
      )
    case 'bulb':
      return `<path d="M50 4V11M18 18L23 23M82 18L77 23M8 42H15M85 42H92" fill="none" stroke="${ORANGE}" stroke-width="3.5" stroke-linecap="round"/>${dieCutSvg(`<path d="M36 66 C36 56 24 50 24 38 C24 24 36 14 50 14 C64 14 76 24 76 38 C76 50 64 56 64 66 Z" fill="${accent}" stroke="${INK}" stroke-width="3.2"/><rect x="38" y="66" width="24" height="16" rx="4" fill="#B8B0A4" stroke="${INK}" stroke-width="3.2"/>`)}<path d="M39 74H61M44 88H56" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`
    case 'fire':
      return `${dieCutSvg(`<path d="M50 12 C66 28 80 44 76 64 C73 78 62 88 50 88 C36 88 24 78 24 62 C24 46 36 38 38 26 C42 32 45 34 46 28 C48 22 48 16 50 12 Z" fill="${safeTint(tint, ORANGE)}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>`)}<path d="M50 48 C58 56 62 64 58 74 C56 80 52 82 50 82 C44 82 40 76 42 68 C43 60 47 54 50 48 Z" fill="${YELLOW}"/>`
    case 'trophy':
      return dieCutSvg(
        `<path d="M30 26 H16 C16 42 23 50 34 50 M70 26 H84 C84 42 77 50 66 50" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/><path d="M28 16 H72 V36 C72 52 62 62 50 62 C38 62 28 52 28 36 Z" fill="${accent}" stroke="${INK}" stroke-width="3.2"/><rect x="44" y="62" width="12" height="12" fill="${accent}" stroke="${INK}" stroke-width="3.2"/><rect x="30" y="74" width="40" height="12" rx="3" fill="${ORANGE}" stroke="${INK}" stroke-width="3.2"/>`,
      )
    case 'medal':
      return `${dieCutSvg(`<path d="M28 8 H44 L56 40 H40 Z" fill="${BLUE}" stroke="${INK}" stroke-width="3.2"/><path d="M72 8 H56 L44 40 H60 Z" fill="${RED}" stroke="${INK}" stroke-width="3.2"/><circle cx="50" cy="64" r="25" fill="${accent}" stroke="${INK}" stroke-width="3.2"/>`)}<path d="${starPath(50, 65, 13, 6)}" fill="${ORANGE}"/>`
    case 'flag':
      return dieCutSvg(
        `<path d="M28 18 H80 L70 34 L80 50 H28 Z" fill="${safeTint(tint, RED)}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/><rect x="20" y="10" width="8" height="80" rx="3" fill="#9A6A43" stroke="${INK}" stroke-width="3.2"/>`,
      )
    case 'rocket':
      return dieCutSvg(
        `<path d="M40 76 L50 92 L60 76 Z" fill="${ORANGE}" stroke="${INK}" stroke-width="3.2"/><path d="M36 54 L20 70 V80 L38 72 Z M64 54 L80 70 V80 L62 72 Z" fill="${RED}" stroke="${INK}" stroke-width="3.2"/><path d="M50 8 C68 24 72 48 64 76 H36 C28 48 32 24 50 8 Z" fill="${PAPER}" stroke="${INK}" stroke-width="3.2"/><circle cx="50" cy="38" r="9" fill="${safeTint(tint, BLUE)}" stroke="${INK}" stroke-width="3.2"/>`,
      )
    case 'sparkle':
      return dieCutSvg(
        `<path d="${sparklePath(42, 56, 34)}" fill="${accent}" stroke="${INK}" stroke-width="3.2"/><path d="${sparklePath(76, 22, 15)}" fill="${accent}" stroke="${INK}" stroke-width="2.8"/>`,
      )
    case 'arrow':
      return dieCutSvg(
        `<path d="M12 38 H54 V20 L88 50 L54 80 V62 H12 Z" fill="${safeTint(tint, GREEN)}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>`,
      )
    case 'speech':
      return `${dieCutSvg(`<path d="M14 24 Q14 12 26 12 H74 Q86 12 86 24 V56 Q86 68 74 68 H46 L26 86 L30 68 H26 Q14 68 14 56 Z" fill="${safeTint(tint, '#CFE3F7')}" stroke="${INK}" stroke-width="3.2"/>`)}<circle cx="34" cy="40" r="5" fill="${INK}"/><circle cx="50" cy="40" r="5" fill="${INK}"/><circle cx="66" cy="40" r="5" fill="${INK}"/>`
    case 'pencil':
      return dieCutSvg(
        `<g transform="rotate(-45 50 50)"><rect x="22" y="38" width="48" height="24" fill="${accent}" stroke="${INK}" stroke-width="3.2"/><rect x="10" y="38" width="12" height="24" rx="3" fill="#F2A99F" stroke="${INK}" stroke-width="3.2"/><path d="M70 38 L92 50 L70 62 Z" fill="${SKIN}" stroke="${INK}" stroke-width="3.2"/><path d="M85 46 L92 50 L85 54 Z" fill="${INK}"/></g>`,
      )
    case 'book':
      return dieCutSvg(
        `<path d="M50 26 C40 18 24 16 10 20 V78 C24 74 40 76 50 84 Z" fill="${PAPER}" stroke="${INK}" stroke-width="3.2"/><path d="M50 26 C60 18 76 16 90 20 V78 C76 74 60 76 50 84 Z" fill="${PAPER}" stroke="${INK}" stroke-width="3.2"/><path d="M10 78 C24 74 40 76 50 84 C60 76 76 74 90 78 V86 H10 Z" fill="${safeTint(tint, BLUE)}" stroke="${INK}" stroke-width="3.2"/>`,
      )
    case 'clock':
      return `${dieCutSvg(`<circle cx="50" cy="50" r="38" fill="${PAPER}" stroke="${INK}" stroke-width="4"/>`)}<path d="M50 18V23M50 77V82M18 50H23M77 50H82" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><path d="M50 50 V28 M50 50 L66 60" stroke="${safeTint(tint, RED)}" stroke-width="4.5" stroke-linecap="round"/><circle cx="50" cy="50" r="4" fill="${INK}"/>`
    case 'one':
    case 'two':
    case 'three': {
      const fill = stickerId === 'one' ? RED : stickerId === 'two' ? BLUE : PURPLE
      const digit = stickerId === 'one' ? '1' : stickerId === 'two' ? '2' : '3'
      return `${dieCutSvg(`<circle cx="50" cy="50" r="38" fill="${safeTint(tint, fill)}" stroke="${INK}" stroke-width="3.2"/>`)}<text x="50" y="65" text-anchor="middle" font-size="46" font-weight="800" fill="${PAPER}" font-family="system-ui, sans-serif">${digit}</text>`
    }
    default:
      return dieCutSvg(
        `<circle cx="50" cy="50" r="36" fill="${accent}" stroke="${INK}" stroke-width="3.2"/>`,
      )
  }
}

function DieCut({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <>
      <g stroke={PAPER} strokeWidth={10} strokeLinejoin="round" fill={PAPER}>
        {children}
      </g>
      {children}
    </>
  )
}

export function StickerIcon({
  stickerId,
  tint,
  size,
}: {
  stickerId: string
  tint?: string
  size?: number
}): ReactElement {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size ?? '100%'}
      height={size ?? '100%'}
      style={{ overflow: 'visible', filter: 'drop-shadow(0 1px 1.5px rgba(34, 29, 23, 0.24))' }}
      aria-hidden="true"
      focusable="false"
    >
      {renderStickerElements(stickerId, tint)}
    </svg>
  )
}

function renderStickerElements(stickerId: string, tint?: string): ReactElement {
  const accent = safeTint(tint, YELLOW)
  switch (stickerId) {
    case 'star':
      return (
        <DieCut>
          <path
            d={starPath(50, 52, 40, 18)}
            fill={accent}
            stroke={INK}
            strokeWidth={3.2}
            strokeLinejoin="round"
          />
        </DieCut>
      )
    case 'heart':
      return (
        <DieCut>
          <path
            d="M50 84 C20 62 12 42 18 28 C24 14 40 16 50 30 C60 16 76 14 82 28 C88 42 80 62 50 84 Z"
            fill={safeTint(tint, RED)}
            stroke={INK}
            strokeWidth={3.2}
            strokeLinejoin="round"
          />
        </DieCut>
      )
    case 'check':
      return (
        <>
          <DieCut>
            <circle
              cx={50}
              cy={50}
              r={38}
              fill={safeTint(tint, GREEN)}
              stroke={INK}
              strokeWidth={3.2}
            />
          </DieCut>
          <path
            d="M30 52 L44 66 L72 36"
            fill="none"
            stroke={PAPER}
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )
    case 'thumbsup':
      return (
        <DieCut>
          <rect
            x={14}
            y={46}
            width={18}
            height={38}
            rx={3}
            fill={safeTint(tint, BLUE)}
            stroke={INK}
            strokeWidth={3.2}
          />
          <path
            d="M34 48 H46 L52 24 C54 18 63 18 64 26 L62 44 H78 C84 44 88 50 86 56 L80 78 C79 82 76 84 72 84 H34 Z"
            fill={SKIN}
            stroke={INK}
            strokeWidth={3.2}
            strokeLinejoin="round"
          />
        </DieCut>
      )
    case 'bulb':
      return (
        <>
          <path
            d="M50 4V11M18 18L23 23M82 18L77 23M8 42H15M85 42H92"
            fill="none"
            stroke={ORANGE}
            strokeWidth={3.5}
            strokeLinecap="round"
          />
          <DieCut>
            <path
              d="M36 66 C36 56 24 50 24 38 C24 24 36 14 50 14 C64 14 76 24 76 38 C76 50 64 56 64 66 Z"
              fill={accent}
              stroke={INK}
              strokeWidth={3.2}
            />
            <rect
              x={38}
              y={66}
              width={24}
              height={16}
              rx={4}
              fill="#B8B0A4"
              stroke={INK}
              strokeWidth={3.2}
            />
          </DieCut>
          <path
            d="M39 74H61M44 88H56"
            fill="none"
            stroke={INK}
            strokeWidth={3}
            strokeLinecap="round"
          />
        </>
      )
    case 'fire':
      return (
        <>
          <DieCut>
            <path
              d="M50 12 C66 28 80 44 76 64 C73 78 62 88 50 88 C36 88 24 78 24 62 C24 46 36 38 38 26 C42 32 45 34 46 28 C48 22 48 16 50 12 Z"
              fill={safeTint(tint, ORANGE)}
              stroke={INK}
              strokeWidth={3.2}
              strokeLinejoin="round"
            />
          </DieCut>
          <path
            d="M50 48 C58 56 62 64 58 74 C56 80 52 82 50 82 C44 82 40 76 42 68 C43 60 47 54 50 48 Z"
            fill={YELLOW}
          />
        </>
      )
    case 'trophy':
      return (
        <DieCut>
          <path
            d="M30 26 H16 C16 42 23 50 34 50 M70 26 H84 C84 42 77 50 66 50"
            fill="none"
            stroke={INK}
            strokeWidth={3.5}
            strokeLinecap="round"
          />
          <path
            d="M28 16 H72 V36 C72 52 62 62 50 62 C38 62 28 52 28 36 Z"
            fill={accent}
            stroke={INK}
            strokeWidth={3.2}
          />
          <rect x={44} y={62} width={12} height={12} fill={accent} stroke={INK} strokeWidth={3.2} />
          <rect
            x={30}
            y={74}
            width={40}
            height={12}
            rx={3}
            fill={ORANGE}
            stroke={INK}
            strokeWidth={3.2}
          />
        </DieCut>
      )
    case 'medal':
      return (
        <>
          <DieCut>
            <path d="M28 8 H44 L56 40 H40 Z" fill={BLUE} stroke={INK} strokeWidth={3.2} />
            <path d="M72 8 H56 L44 40 H60 Z" fill={RED} stroke={INK} strokeWidth={3.2} />
            <circle cx={50} cy={64} r={25} fill={accent} stroke={INK} strokeWidth={3.2} />
          </DieCut>
          <path d={starPath(50, 65, 13, 6)} fill={ORANGE} />
        </>
      )
    case 'flag':
      return (
        <DieCut>
          <path
            d="M28 18 H80 L70 34 L80 50 H28 Z"
            fill={safeTint(tint, RED)}
            stroke={INK}
            strokeWidth={3.2}
            strokeLinejoin="round"
          />
          <rect
            x={20}
            y={10}
            width={8}
            height={80}
            rx={3}
            fill="#9A6A43"
            stroke={INK}
            strokeWidth={3.2}
          />
        </DieCut>
      )
    case 'rocket':
      return (
        <DieCut>
          <path d="M40 76 L50 92 L60 76 Z" fill={ORANGE} stroke={INK} strokeWidth={3.2} />
          <path
            d="M36 54 L20 70 V80 L38 72 Z M64 54 L80 70 V80 L62 72 Z"
            fill={RED}
            stroke={INK}
            strokeWidth={3.2}
          />
          <path
            d="M50 8 C68 24 72 48 64 76 H36 C28 48 32 24 50 8 Z"
            fill={PAPER}
            stroke={INK}
            strokeWidth={3.2}
          />
          <circle
            cx={50}
            cy={38}
            r={9}
            fill={safeTint(tint, BLUE)}
            stroke={INK}
            strokeWidth={3.2}
          />
        </DieCut>
      )
    case 'sparkle':
      return (
        <DieCut>
          <path d={sparklePath(42, 56, 34)} fill={accent} stroke={INK} strokeWidth={3.2} />
          <path d={sparklePath(76, 22, 15)} fill={accent} stroke={INK} strokeWidth={2.8} />
        </DieCut>
      )
    case 'arrow':
      return (
        <DieCut>
          <path
            d="M12 38 H54 V20 L88 50 L54 80 V62 H12 Z"
            fill={safeTint(tint, GREEN)}
            stroke={INK}
            strokeWidth={3.2}
            strokeLinejoin="round"
          />
        </DieCut>
      )
    case 'speech':
      return (
        <>
          <DieCut>
            <path
              d="M14 24 Q14 12 26 12 H74 Q86 12 86 24 V56 Q86 68 74 68 H46 L26 86 L30 68 H26 Q14 68 14 56 Z"
              fill={safeTint(tint, '#CFE3F7')}
              stroke={INK}
              strokeWidth={3.2}
            />
          </DieCut>
          <circle cx={34} cy={40} r={5} fill={INK} />
          <circle cx={50} cy={40} r={5} fill={INK} />
          <circle cx={66} cy={40} r={5} fill={INK} />
        </>
      )
    case 'pencil':
      return (
        <DieCut>
          <g transform="rotate(-45 50 50)">
            <rect
              x={22}
              y={38}
              width={48}
              height={24}
              fill={accent}
              stroke={INK}
              strokeWidth={3.2}
            />
            <rect
              x={10}
              y={38}
              width={12}
              height={24}
              rx={3}
              fill="#F2A99F"
              stroke={INK}
              strokeWidth={3.2}
            />
            <path d="M70 38 L92 50 L70 62 Z" fill={SKIN} stroke={INK} strokeWidth={3.2} />
            <path d="M85 46 L92 50 L85 54 Z" fill={INK} />
          </g>
        </DieCut>
      )
    case 'book':
      return (
        <DieCut>
          <path
            d="M50 26 C40 18 24 16 10 20 V78 C24 74 40 76 50 84 Z"
            fill={PAPER}
            stroke={INK}
            strokeWidth={3.2}
          />
          <path
            d="M50 26 C60 18 76 16 90 20 V78 C76 74 60 76 50 84 Z"
            fill={PAPER}
            stroke={INK}
            strokeWidth={3.2}
          />
          <path
            d="M10 78 C24 74 40 76 50 84 C60 76 76 74 90 78 V86 H10 Z"
            fill={safeTint(tint, BLUE)}
            stroke={INK}
            strokeWidth={3.2}
          />
        </DieCut>
      )
    case 'clock':
      return (
        <>
          <DieCut>
            <circle cx={50} cy={50} r={38} fill={PAPER} stroke={INK} strokeWidth={4} />
          </DieCut>
          <path
            d="M50 18V23M50 77V82M18 50H23M77 50H82"
            stroke={INK}
            strokeWidth={3}
            strokeLinecap="round"
          />
          <path
            d="M50 50 V28 M50 50 L66 60"
            stroke={safeTint(tint, RED)}
            strokeWidth={4.5}
            strokeLinecap="round"
          />
          <circle cx={50} cy={50} r={4} fill={INK} />
        </>
      )
    case 'one':
    case 'two':
    case 'three': {
      const fill = stickerId === 'one' ? RED : stickerId === 'two' ? BLUE : PURPLE
      const digit = stickerId === 'one' ? '1' : stickerId === 'two' ? '2' : '3'
      return (
        <>
          <DieCut>
            <circle
              cx={50}
              cy={50}
              r={38}
              fill={safeTint(tint, fill)}
              stroke={INK}
              strokeWidth={3.2}
            />
          </DieCut>
          <text x={50} y={65} textAnchor="middle" fontSize={46} fontWeight={800} fill={PAPER}>
            {digit}
          </text>
        </>
      )
    }
    default:
      return (
        <DieCut>
          <circle cx={50} cy={50} r={36} fill={accent} stroke={INK} strokeWidth={3.2} />
        </DieCut>
      )
  }
}
