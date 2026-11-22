import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import {
  AiMark,
  aiPanelInitiallyOpen,
  effectiveAiPanelOpen,
  onAiRailClick,
  rememberAiPanelOpen,
  useSplitPaneRole,
} from '@genoffice/ui'
import '@genoffice/ui/ai-model-picker.css'
import '@genoffice/ui/ai-usage.css'
import '@genoffice/ui/ai-panel-prefs.css'
import './ai-panel.css'
import '@genoffice/ui/ai-panel.css'
import type { WhiteboardAiHost } from '../../shared/ai-host'
import type { WhiteboardHandoff } from '../../shared/ipc'
import { useI18n } from '../i18n/locale'
import { AiPanel } from './AiPanel'

const OPEN_KEY = 'whiteboardapp.showAi'

export interface WhiteboardAiDockProps {
  host: WhiteboardAiHost
  filePath: string | null
  open: boolean
  setOpen(open: boolean): void
  handoff?: WhiteboardHandoff | null
  onHandoffConsumed?(): void
}

export function useWhiteboardAiOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => aiPanelInitiallyOpen(OPEN_KEY))
  useEffect(() => rememberAiPanelOpen(OPEN_KEY, open), [open])
  return [open, setOpen]
}

export function WhiteboardAiDock({
  host,
  filePath,
  open: prefOpen,
  setOpen,
  handoff,
  onHandoffConsumed,
}: WhiteboardAiDockProps): ReactElement {
  const { t } = useI18n()
  const { role, requestFocus } = useSplitPaneRole()
  const open = effectiveAiPanelOpen(prefOpen, role)

  return (
    <div className={`ai-dock${open ? '' : ' collapsed'}`} data-ai-open={open}>
      {!open && (
        <button
          type="button"
          className="ai-rail"
          data-tip={t('aiOpenAssistant')}
          aria-label={t('aiOpenAssistant')}
          onClick={() => onAiRailClick(role, prefOpen, setOpen, requestFocus)}
        >
          <AiMark size={18} />
        </button>
      )}
      <AiPanel
        host={host}
        filePath={filePath}
        handoff={handoff}
        onCollapse={() => setOpen(false)}
        onHandoffConsumed={onHandoffConsumed}
      />
    </div>
  )
}
