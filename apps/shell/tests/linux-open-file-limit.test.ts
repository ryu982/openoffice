/**
 * Linux: the installed app starts through a launcher that raises the open-file
 * soft limit before Chromium forks its zygote (#488).
 *
 * Renderers inherit the zygote's limit, and the zygote is forked before any app
 * code runs, so nothing in the main process can raise it. A desktop session
 * starts programs at a soft limit of 1024; the Hangul editor holds one open file
 * per font it has touched, and past the limit the renderer blocks forever. The
 * launcher is a payload file, and the deb/rpm post-install step points the
 * desktop entry at it because electron-builder refuses a custom Exec.
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const SHELL_DIR = resolve(import.meta.dirname, '..')
const BUILD_DIR = join(SHELL_DIR, 'build')
const LAUNCH_SCRIPT = join(BUILD_DIR, 'linux-launch.sh')
const INSTALL_SCRIPT = join(BUILD_DIR, 'linux-after-install.sh')
/** Where the launcher lands inside the installed app, relative to its root. */
const PAYLOAD = 'resources/ieumoffice-launch'

const require = createRequire(import.meta.url)
// Inspect packaging metadata without downloading Electron or compiling OCR
// helpers (same approach as linux-kde-templates.test.ts).
const configModule = { exports: {} as ReturnType<typeof require> }
runInNewContext(readFileSync(join(SHELL_DIR, 'electron-builder.cjs'), 'utf8'), {
  module: configModule,
  __dirname: SHELL_DIR,
  process: { platform: 'linux', arch: 'x64', env: {} },
  require: (id: string) =>
    id === 'node:fs' ? { ...require(id), existsSync: () => true } : require(id),
})
const config = configModule.exports

describe('Linux package: the open-file limit launcher (#488)', () => {
  it('ships the launcher in the Linux payload under the name the install step uses', () => {
    const resources = config.linux.extraResources as { from: string; to: string }[]
    expect(resources).toContainEqual({ from: 'build/linux-launch.sh', to: 'ieumoffice-launch' })
    expect(readFileSync(INSTALL_SCRIPT, 'utf-8')).toContain(`launch="$app/${PAYLOAD}"`)
  })

  it('raises the soft limit to the hard limit and then starts the app binary', () => {
    const body = readFileSync(LAUNCH_SCRIPT, 'utf-8')
    expect(body.startsWith('#!/bin/sh\n')).toBe(true)
    const commands = body.split('\n').filter((line) => line && !line.startsWith('#'))
    expect(commands).toEqual([
      'ulimit -Sn "$(ulimit -Hn)" 2>/dev/null || true',
      'self="$(readlink -f "$0" 2>/dev/null)" || self="$0"',
      'exec "${self%/*}/../ieumoffice" "$@"',
    ])
  })
})

describe.skipIf(process.platform !== 'linux')('Linux launcher in a sandbox (#488)', () => {
  /** An app tree whose "binary" reports the limits and arguments it was started with. */
  function makeApp() {
    const root = mkdtempSync(join(tmpdir(), 'genoffice-nofile-'))
    const app = join(root, 'opt', 'IeumOffice')
    mkdirSync(join(app, 'resources'), { recursive: true })
    const binary = join(app, 'ieumoffice')
    writeFileSync(
      binary,
      '#!/bin/sh\necho "soft=$(ulimit -Sn)"\necho "hard=$(ulimit -Hn)"\nfor arg in "$@"; do echo "arg=$arg"; done\n',
    )
    chmodSync(binary, 0o755)
    const launcher = join(app, PAYLOAD)
    copyFileSync(LAUNCH_SCRIPT, launcher)
    chmodSync(launcher, 0o755)
    return { root, app, launcher }
  }

  /** Starts `file` the way a desktop session would: with a soft limit below the hard one. */
  function startLow(file: string, args: string[]) {
    const result = spawnSync('sh', ['-c', 'ulimit -Sn 256 && exec "$0" "$@"', file, ...args], {
      encoding: 'utf-8',
    })
    const lines = result.stdout.split('\n').filter(Boolean)
    const value = (key: string) =>
      lines.find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1)
    return {
      code: result.status,
      soft: value('soft'),
      hard: value('hard'),
      args: lines.filter((line) => line.startsWith('arg=')).map((line) => line.slice(4)),
    }
  }

  it('keeps the checked-in launcher executable', () => {
    expect(statSync(LAUNCH_SCRIPT).mode & 0o111).not.toBe(0)
    const result = spawnSync('sh', ['-n', LAUNCH_SCRIPT], { encoding: 'utf-8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('hands the app a soft limit equal to the hard limit', () => {
    const t = makeApp()
    // the binary started directly keeps the low limit: this is what the launcher is for
    const direct = startLow(join(t.app, 'ieumoffice'), [])
    expect(direct.soft).toBe('256')
    expect(direct.hard).not.toBe('256')

    const launched = startLow(t.launcher, [])
    expect(launched.code).toBe(0)
    expect(launched.soft).toBe(launched.hard)
  })

  it('passes every argument through unchanged', () => {
    const t = makeApp()
    const args = ['/home/me/새 문서 1.hwp', '--flag=a b', '', '*']
    expect(startLow(t.launcher, args).args).toEqual(args)
  })

  it('finds the binary when it is reached through a symlink', () => {
    const t = makeApp()
    const link = join(t.root, 'start-here')
    symlinkSync(t.launcher, link)
    const launched = startLow(link, ['one'])
    expect(launched.code).toBe(0)
    expect(launched.args).toEqual(['one'])
    expect(launched.soft).toBe(launched.hard)
  })
})

describe.skipIf(process.platform === 'win32')(
  'Linux post-install: the desktop entry (#488)',
  () => {
    // The script hardcodes the package paths; a copy with the install root and the
    // applications directory swapped runs against a temp tree (same approach as
    // linux-kde-templates.test.ts), so it needs no root and touches no real entry.
    function makeRoot(options: { launcher: boolean; exec?: (app: string) => string }) {
      const root = mkdtempSync(join(tmpdir(), 'genoffice-desktop-entry-'))
      const app = join(root, 'opt', 'IeumOffice')
      const bin = join(root, 'usr', 'bin')
      const applications = join(root, 'usr', 'share', 'applications')
      mkdirSync(join(app, 'resources', 'cli'), { recursive: true })
      mkdirSync(bin, { recursive: true })
      mkdirSync(applications, { recursive: true })
      const cli = join(app, 'resources', 'cli', 'ieumoffice')
      writeFileSync(cli, '#!/bin/sh\n')
      chmodSync(cli, 0o755)
      if (options.launcher) {
        copyFileSync(LAUNCH_SCRIPT, join(app, PAYLOAD))
        chmodSync(join(app, PAYLOAD), 0o755)
      }
      // the entry as electron-builder writes it for deb and rpm
      const entry = join(applications, 'ieumoffice.desktop')
      const lines = (exec: string) => [
        '[Desktop Entry]',
        'Name=IeumOffice',
        `Exec=${exec}`,
        'Terminal=false',
        'Type=Application',
        'Icon=ieumoffice',
        'StartupWMClass=ieumoffice',
        'MimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document;',
        'Categories=Office;',
        '',
      ]
      writeFileSync(entry, lines(options.exec?.(app) ?? `${app}/ieumoffice %U`).join('\n'))
      const file = join(root, 'linux-after-install.sh')
      writeFileSync(
        file,
        readFileSync(INSTALL_SCRIPT, 'utf-8')
          .replaceAll('/opt/IeumOffice', app)
          .replaceAll('/usr/share/applications', applications)
          .replaceAll('/usr/bin/', `${bin}/`),
      )
      const install = () => spawnSync('sh', [file], { encoding: 'utf-8' }).status
      const read = () => readFileSync(entry, 'utf-8').split('\n')
      return { app, install, read, lines }
    }

    it('points the entry at the launcher and changes nothing else', () => {
      const t = makeRoot({ launcher: true })
      expect(t.install()).toBe(0)
      expect(t.read()).toEqual(t.lines(`${t.app}/${PAYLOAD} %U`))
    })

    it('gives the same entry when the step runs again, as on an upgrade', () => {
      const t = makeRoot({ launcher: true })
      expect(t.install()).toBe(0)
      expect(t.install()).toBe(0)
      expect(t.read()).toEqual(t.lines(`${t.app}/${PAYLOAD} %U`))
    })

    it('keeps the entry on the binary when the payload has no launcher', () => {
      const t = makeRoot({ launcher: false })
      expect(t.install()).toBe(0)
      expect(t.read()).toEqual(t.lines(`${t.app}/ieumoffice %U`))
    })

    it('repoints an entry whose Exec line ends at the binary', () => {
      const t = makeRoot({ launcher: true, exec: (app) => `${app}/ieumoffice` })
      expect(t.install()).toBe(0)
      expect(t.read()).toEqual(t.lines(`${t.app}/${PAYLOAD}`))
    })

    it('leaves alone an Exec line that does not start our binary directly', () => {
      const wrapped = (app: string) => `env LANG=ko_KR.UTF-8 ${app}/ieumoffice %U`
      const other = (app: string) => `${app}/ieumoffice-other %U`
      for (const exec of [wrapped, other]) {
        const t = makeRoot({ launcher: true, exec })
        expect(t.install()).toBe(0)
        expect(t.read()).toEqual(t.lines(exec(t.app)))
      }
    })
  },
)
