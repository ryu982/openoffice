import { useCallback, useEffect, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { UserSkillsBridge } from '@genoffice/electron-utils/user-skills-bridge'
import type {
  UserSkillVersionDiff,
  UserSkillVersionReason,
  UserSkillVersionView,
} from '@genoffice/electron-utils/user-skills-channels'
import { skillsText, type SkillsStringKey } from '../i18n/strings-skills'
import { failureKey, formatSkillSize } from './skills-model'

const REASON_KEY: Record<UserSkillVersionReason, SkillsStringKey> = {
  edit: 'versionReasonEdit',
  replace: 'versionReasonReplace',
  update: 'versionReasonUpdate',
  restore: 'versionReasonRestore',
}

const FILE_CHANGE_KEY: Record<UserSkillVersionDiff['files'][number]['change'], SkillsStringKey> = {
  added: 'versionFileAdded',
  removed: 'versionFileRemoved',
  modified: 'versionFileModified',
}

const LINE_MARK: Record<UserSkillVersionDiff['skillMd'][number]['kind'], string> = {
  added: '+',
  removed: '−',
  same: ' ',
  gap: ' ',
}

/** The version that is open: its comparison once read, and the delete question */
interface Opened {
  id: string
  diff: UserSkillVersionDiff | null
  asksRemove: boolean
}

/**
 * The earlier versions kept of an own skill: when each was kept, why and how
 * large it is, newest first. Opening one shows what going back would change;
 * the person goes back to it or deletes it there. `blocked` keeps going back
 * off while the editor holds unsaved text, which a restore would throw away.
 */
export function SkillVersions({
  api,
  skillId,
  lang,
  locale,
  blocked,
  onRestored,
}: {
  api: UserSkillsBridge
  skillId: string
  lang: Lang
  locale: string
  blocked: boolean
  onRestored: () => void
}) {
  const s = (key: SkillsStringKey, params?: Record<string, string | number>) =>
    skillsText(lang, key, params)
  const [versions, setVersions] = useState<UserSkillVersionView[] | null>(null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<SkillsStringKey | null>(null)

  const load = useCallback(async () => {
    const answer = await api.versions(skillId)
    setVersions(answer.ok ? answer.versions : [])
    if (!answer.ok) setErrorKey(failureKey(answer.reason) ?? 'failGeneric')
  }, [api, skillId])

  useEffect(() => {
    void load()
  }, [load])

  const open = async (id: string) => {
    setErrorKey(null)
    if (opened?.id === id) {
      setOpened(null)
      return
    }
    setOpened({ id, diff: null, asksRemove: false })
    const answer = await api.compareVersion(skillId, id)
    if (!answer.ok) {
      setOpened(null)
      setErrorKey(failureKey(answer.reason) ?? 'failGeneric')
      return
    }
    setOpened((now) => (now?.id === id ? { ...now, diff: answer.diff } : now))
  }

  const restore = async (id: string) => {
    setBusy(true)
    setErrorKey(null)
    const answer = await api.restoreVersion(skillId, id)
    setBusy(false)
    if (answer.ok) onRestored()
    else setErrorKey(failureKey(answer.reason) ?? 'failGeneric')
  }

  const remove = async (id: string) => {
    setBusy(true)
    setErrorKey(null)
    const answer = await api.removeVersion(skillId, id)
    setBusy(false)
    if (!answer.ok) setErrorKey(failureKey(answer.reason) ?? 'failGeneric')
    setOpened(null)
    await load()
  }

  const when = (version: UserSkillVersionView) =>
    new Date(version.at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="skl-field" data-skill-versions="">
      <span className="skl-field-label">{s('versionsTitle')}</span>
      {versions === null ? (
        <span className="set-field-desc">{s('loading')}</span>
      ) : versions.length === 0 ? (
        <span className="set-field-desc">{s('versionsNone')}</span>
      ) : (
        <>
          <span className="set-field-desc" data-skill-versions-total="">
            {s('versionsTotal', {
              n: versions.length,
              size: formatSkillSize(
                versions.reduce((sum, version) => sum + version.bytes, 0),
                locale,
              ),
            })}
          </span>
          <ul className="skl-versions">
            {versions.map((version) => {
              const isOpen = opened?.id === version.id
              return (
                <li key={version.id} className="skl-version" data-version-id={version.id}>
                  <div className="skl-version-row">
                    <span className="skl-version-when">{when(version)}</span>
                    <span className="skl-version-why" data-version-reason={version.reason}>
                      {s(REASON_KEY[version.reason])}
                    </span>
                    <span className="set-field-desc skl-version-size">
                      {formatSkillSize(version.bytes, locale)}
                    </span>
                    <button
                      type="button"
                      className="set-btn"
                      aria-expanded={isOpen}
                      onClick={() => void open(version.id)}
                    >
                      {s('versionCompare')}
                    </button>
                  </div>
                  {isOpen && opened && (
                    <VersionDetail
                      opened={opened}
                      text={s}
                      busy={busy}
                      blocked={blocked}
                      onRestore={() => void restore(version.id)}
                      onAskRemove={(asks) => setOpened({ ...opened, asksRemove: asks })}
                      onRemove={() => void remove(version.id)}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {errorKey && (
        <span className="set-field-desc skl-error" role="alert">
          {s(errorKey)}
        </span>
      )}
    </div>
  )
}

function VersionDetail({
  opened,
  text,
  busy,
  blocked,
  onRestore,
  onAskRemove,
  onRemove,
}: {
  opened: Opened
  text: (key: SkillsStringKey, params?: Record<string, string | number>) => string
  busy: boolean
  blocked: boolean
  onRestore: () => void
  onAskRemove: (asks: boolean) => void
  onRemove: () => void
}) {
  const { diff } = opened
  if (!diff) return <p className="set-field-desc skl-version-detail">{text('loading')}</p>
  return (
    <div className="skl-version-detail">
      {diff.same ? (
        <p className="set-field-desc" data-version-same="">
          {text('versionSame')}
        </p>
      ) : (
        <>
          {diff.skillMd.length > 0 && (
            <>
              <code className="skl-version-file">SKILL.md</code>
              <span className="set-field-desc">{text('versionDiffLegend')}</span>
              <div className="skl-diff" role="group" aria-label="SKILL.md">
                {diff.skillMd.map((line, index) => (
                  <div key={index} className="skl-diff-line" data-kind={line.kind}>
                    <span className="skl-diff-mark" aria-hidden="true">
                      {LINE_MARK[line.kind]}
                    </span>
                    <span className="skl-diff-text">
                      {line.kind === 'gap' ? text('versionDiffGap', { n: line.text }) : line.text}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          {diff.files.length > 0 && (
            <ul className="skl-files" data-version-files="">
              {diff.files.map((file) => (
                <li key={file.rel}>
                  <code>{file.rel}</code>
                  <span className="skl-change">{text(FILE_CHANGE_KEY[file.change])}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {opened.asksRemove ? (
        <div className="skl-confirm" role="alertdialog" aria-label={text('versionRemoveAsk')}>
          <span className="set-field-desc">{text('versionRemoveAsk')}</span>
          <div className="skl-confirm-actions">
            <button type="button" className="set-btn" autoFocus onClick={() => onAskRemove(false)}>
              {text('cancel')}
            </button>
            <button type="button" className="set-btn danger" disabled={busy} onClick={onRemove}>
              {text('versionRemove')}
            </button>
          </div>
        </div>
      ) : (
        <div className="skl-version-actions">
          {!diff.same && (
            <span className="set-field-desc" data-version-note={blocked ? 'unsaved' : 'kept'}>
              {text(blocked ? 'versionRestoreUnsaved' : 'versionRestoreNote')}
            </span>
          )}
          <button
            type="button"
            className="set-btn"
            disabled={busy}
            onClick={() => onAskRemove(true)}
          >
            {text('versionRemove')}
          </button>
          <button
            type="button"
            className="set-btn primary"
            disabled={busy || blocked || diff.same}
            onClick={onRestore}
          >
            {text('versionRestore')}
          </button>
        </div>
      )}
    </div>
  )
}
