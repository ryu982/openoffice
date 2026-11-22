import { test, expect } from '@playwright/test'
import { launchShell, closeAndSaveVideo, screenshotPath, waitForPageWithUrl } from './helpers'

test.describe('home screen', () => {
  test('shows hero, quick-create cards and tab bar', async () => {
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'home-basics' })
    const { page } = launched
    try {
      await expect(page.locator('.home-hero')).toBeVisible()
      // the quick-create cards, the PDF tools card and, always last, the "Open file" browse card
      await expect(page.locator('.quick-card')).toHaveCount(12)
      // picked by kind, not by position: adding an editor to Settings → General must not break this
      const card = (kind: string) => page.locator(`.quick-card[data-kind="${kind}"]`)
      await expect(card('docx')).toContainText('AI Docs')
      await expect(card('xlsx')).toContainText('AI Sheets')
      await expect(card('pptx')).toContainText('AI Slides')
      await expect(card('md')).toContainText('AI Markdown')
      await expect(card('html')).toContainText('AI HTML')
      await expect(card('xmind')).toContainText('Mind Map')
      await expect(card('drawio')).toContainText('Diagram')
      await expect(card('whiteboard')).toContainText('Whiteboard')
      await expect(card('hwp')).toContainText('AI HWP')
      await expect(card('pdf')).toContainText('AI PDF')
      await expect(card('pdfTools')).toContainText('PDF tools')
      await expect(page.locator('.quick-card').last()).toContainText('Open Local File')
      // the agent is not a document to make: it sits in the sidebar, under Ask AI
      // and the project folders (decision 0088)
      const nav = page.locator('.sidebar-nav .nav-label')
      await expect(nav).toHaveText(['Recent', 'Starred', 'Ask AI', 'Projects', 'Agent'])
      await expect(page.locator('.sidebar-nav .nav-item').nth(4)).toHaveAttribute(
        'title',
        'Work in a folder with Claude Code or Codex',
      )
      await expect(page.locator('.tab-bar .tab-item.tab-home')).toBeVisible()
      await page.screenshot({ path: screenshotPath('home-overview') })
      // clicking it opens the agent window
      await page.locator('.sidebar-nav .nav-item').nth(4).click()
      const agent = await waitForPageWithUrl(launched.app, 'agent.html', 30_000)
      await expect(agent.locator('.agent')).toBeVisible()
    } finally {
      await closeAndSaveVideo(launched, 'home-basics')
    }
  })

  test('renders localized UI when GENOFFICE_LANG=zh-CN', async () => {
    const launched = await launchShell({
      onboardingSeen: true,
      lang: 'zh-CN',
      videoDir: 'home-zh-cn',
    })
    const { page } = launched
    try {
      await expect(page.locator('.nav-item .nav-label').first()).toHaveText('最近')
      await page.screenshot({ path: screenshotPath('home-zh-cn') })
    } finally {
      await closeAndSaveVideo(launched, 'home-zh-cn')
    }
  })
})
