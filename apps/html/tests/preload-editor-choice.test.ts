// The editor's preload hands its screen the editor choice and AI-off switch
// (Settings › Editors and AI) to read and hear only: changing it, or stopping
// the running AI jobs, stays with the shell's own windows.
import { describe, expect, it, vi } from 'vitest'
import { APP_CHOICE_CHANNELS } from '@genoffice/electron-utils/app-choice'

const electron = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => electron.exposed.set(name, api),
  },
  ipcRenderer: {
    invoke: electron.invoke,
    send: vi.fn(),
    on: electron.on,
    removeListener: electron.removeListener,
  },
  webUtils: { getPathForFile: () => '' },
}))
vi.mock('@genoffice/electron-utils/drop-open', () => ({ installDropOpenBridge: () => undefined }))

interface ReadOnlyChoice {
  get(): Promise<unknown>
  onChange(listener: (choice: unknown) => void): () => void
}

describe('window.aiOfficeEditorChoice', () => {
  it('exposes get and onChange only, normalizing what the shell answers', async () => {
    await import('../src/preload/index')
    const bridge = electron.exposed.get('aiOfficeEditorChoice') as ReadOnlyChoice
    expect(Object.keys(bridge).sort()).toEqual(['get', 'onChange'])

    electron.invoke.mockResolvedValueOnce({ off: ['pdf', 'nope'], aiFeatures: false })
    expect(await bridge.get()).toEqual({ off: ['pdf'], aiFeatures: false, locked: false })
    expect(electron.invoke).toHaveBeenLastCalledWith(APP_CHOICE_CHANNELS.get)

    const heard: unknown[] = []
    const stop = bridge.onChange((choice) => heard.push(choice))
    const [channel, handler] = electron.on.mock.calls.find(
      ([name]) => name === APP_CHOICE_CHANNELS.changed,
    )!
    expect(channel).toBe(APP_CHOICE_CHANNELS.changed)
    handler({}, { off: [], aiFeatures: true })
    expect(heard).toEqual([{ off: [], aiFeatures: true, locked: false }])
    stop()
    expect(electron.removeListener).toHaveBeenCalledWith(APP_CHOICE_CHANNELS.changed, handler)
  })
})
