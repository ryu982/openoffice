import { expect, test } from '@playwright/test'
import { openSource } from './helpers'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('drag selection opens a toolbar and applies formatting to the selected text', async ({
  page,
}) => {
  await openSource(page, true, false, 'Format this text.\n\n* untouched  \n')
  const paragraph = page.locator('.doc-editor > p').first()
  const bar = page.getByRole('group', { name: 'Selection formatting' })
  await expect(paragraph).toHaveText('Format this text.')
  await expect(bar).toBeHidden()

  const selection = await paragraph.evaluate((element) => {
    const range = document.createRange()
    range.setStart(element.firstChild!, 0)
    range.setEnd(element.firstChild!, 6)
    const { left, right, top, height } = range.getBoundingClientRect()
    return { left, right, y: top + height / 2 }
  })
  await page.mouse.move(selection.left, selection.y)
  await page.mouse.down()
  await page.mouse.move(selection.right, selection.y, { steps: 4 })
  await expect(bar).toBeHidden()
  await page.mouse.up()
  await expect(bar).toBeVisible()

  const bold = bar.getByRole('button', { name: 'Bold' })
  await bold.click()
  await expect(paragraph.locator('strong')).toHaveText('Format')
  await expect(bold).toHaveAttribute('aria-pressed', 'true')
  await bar.getByRole('button', { name: 'Text' }).click()
  await bar.getByRole('option', { name: 'Heading 2' }).click()
  await expect(page.locator('.doc-editor h2 strong')).toHaveText('Format')

  await page.evaluate(() => window.dispatchEvent(new Event('test:save')))
  await expect(page.locator('body')).toHaveAttribute(
    'data-saved',
    '## **Format** this text.\n\n* untouched  \n',
  )
  await page.keyboard.press('Escape')
  await expect(bar).toBeHidden()
  await page.keyboard.press('End')
  await expect(bar).toBeHidden()
})

test('keyboard selection supports shortcuts, links, and the source-view toggle', async ({
  page,
}) => {
  await openSource(page, false, false, 'Example text')
  const editor = page.locator('.doc-editor')
  await expect(editor).toHaveText('Example text')
  const bar = page.getByRole('group', { name: 'Selection formatting' })
  await editor.press('End')
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft')
  await expect(bar).toBeVisible()
  await page.keyboard.press('Alt+F10')
  await expect(bar.getByRole('button', { name: 'Text' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(bar).toBeHidden()
  await expect(editor).toBeFocused()

  await page.keyboard.press(`${mod}+Shift+E`)
  await expect(editor.locator('code')).toHaveText('text')
  await page.keyboard.press(`${mod}+Shift+E`)
  await expect(editor.locator('code')).toHaveCount(0)
  await page.keyboard.press(`${mod}+Shift+X`)
  await expect(editor.locator('s')).toHaveText('text')
  await page.keyboard.press(`${mod}+Shift+X`)
  await page.keyboard.press(`${mod}+Shift+M`)
  await expect(editor.locator('mark')).toHaveText('text')
  await page.keyboard.press(`${mod}+Shift+M`)

  await page.keyboard.press(`${mod}+K`)
  const url = bar.getByRole('textbox', { name: 'Enter URL' })
  await expect(url).toBeFocused()
  await url.fill('https://example.test')
  await url.press('Enter')
  await expect(editor.locator('a')).toHaveText('text')
  await page.keyboard.press(`${mod}+K`)
  await expect(url).toHaveValue('https://example.test')
  await bar.getByRole('button', { name: 'Remove link' }).click()
  await expect(editor.locator('a')).toHaveCount(0)
  await page.keyboard.press(`${mod}+Alt+q`)
  await expect(editor.locator('blockquote')).toHaveText('Example text')
  await page.keyboard.press(`${mod}+Alt+0`)
  await expect(editor.locator('blockquote')).toHaveCount(0)
  await page.keyboard.press(`${mod}+Alt+2`)
  await expect(editor.locator('h2')).toHaveText('Example text')
  await page.keyboard.press(`${mod}+Alt+0`)
  await expect(editor.locator('h2')).toHaveCount(0)
  await expect(editor.locator('p').first()).toHaveText('Example text')
  await page.keyboard.press(`${mod}+Shift+8`)
  await expect(editor.locator('ul li')).toHaveText('Example text')
  await page.keyboard.press(`${mod}+E`)
  await expect(bar).toBeHidden()
  await expect(page.locator('.source-textarea')).toHaveValue(/[-*] Example text/)
})
