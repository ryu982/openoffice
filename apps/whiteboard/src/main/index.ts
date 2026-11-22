/** Standalone dev entry point for `@genoffice/whiteboard`. */
import { app, BrowserWindow } from 'electron'
import { createWhiteboardView, registerWhiteboardIpc } from './whiteboard-main'

export function startWhiteboardStandalone(): void {
  void app.whenReady().then(() => {
    registerWhiteboardIpc()
    const win = new BrowserWindow({ width: 1280, height: 860 })
    const filePath = process.argv.find((a) => /\.(whiteboard|excalidraw(\.(png|svg))?)$/i.test(a))
    const view = createWhiteboardView({ filePath })
    win.contentView.addChildView(view)
    const resize = () => {
      const [width, height] = win.getContentSize()
      view.setBounds({ x: 0, y: 0, width, height })
    }
    resize()
    win.on('resize', resize)
  })
}

if (require.main === module) {
  startWhiteboardStandalone()
}
