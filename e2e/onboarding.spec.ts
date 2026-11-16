import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PRODUCT_NAME } from '../packages/i18n/src/product'
import { launchShell, closeAndSaveVideo, screenshotPath } from './helpers'

test.describe('first-run onboarding', () => {
  test('fresh install walks all slides and persists the seen flag', async () => {
    const launched = await launchShell({ videoDir: 'onboarding-walkthrough' })
    const { page, userDataDir } = launched
    try {
      const overlay = page.locator('.onb-overlay')
      await expect(overlay).toBeVisible()
      await expect(page.locator('.onb-slide.active .onb-title')).toHaveText(
        `Welcome to ${PRODUCT_NAME}`,
      )
      await page.screenshot({ path: screenshotPath('onboarding-slide-1') })

      // the pick step: every editor and AI start on; passing it untouched keeps the app as it was
      await page.locator('.onb-next').click()
      const pick = page.locator('.onb-slide.active[data-step="pick"]')
      await expect(pick).toBeVisible()
      await expect(pick.locator('.ec-row [role="switch"]')).toHaveCount(12)
      await expect(pick.locator('.ec-row [role="switch"][aria-checked="false"]')).toHaveCount(0)
      await page.screenshot({ path: screenshotPath('onboarding-slide-2') })

      await page.locator('.onb-next').click()
      await expect(page.locator('.onb-slide.active .onb-connect')).toBeVisible()
      await page.screenshot({ path: screenshotPath('onboarding-slide-3') })

      await page.locator('.onb-next').click()
      await expect(page.locator('.onb-slide.active .onb-title')).toHaveText('You’re all set')
      await page.screenshot({ path: screenshotPath('onboarding-slide-4') })

      // last slide's primary button finishes the onboarding
      await page.locator('.onb-next').click()
      await expect(overlay).toBeHidden()
      await expect(page.locator('.home-hero')).toBeVisible()
      await page.screenshot({ path: screenshotPath('onboarding-done-home') })

      await expect
        .poll(async () => {
          const raw = await readFile(join(userDataDir, 'app-settings.json'), 'utf8')
          return (JSON.parse(raw) as { onboardingSeen?: boolean }).onboardingSeen
        })
        .toBe(true)
      // passing the pick step marks it seen and stores nothing else: all on
      const saved = JSON.parse(await readFile(join(userDataDir, 'app-settings.json'), 'utf8')) as {
        editorPickSeen?: boolean
        editors?: { off?: string[] }
        aiFeatures?: unknown
      }
      expect(saved.editorPickSeen).toBe(true)
      expect(saved.editors?.off ?? []).toEqual([])
      expect(saved.aiFeatures).not.toBe(false)
    } finally {
      await closeAndSaveVideo(launched, 'onboarding-walkthrough')
    }

    // second launch with the same userData must not show the onboarding again
    const relaunch = await launchShell({
      userDataDir: launched.userDataDir,
      videoDir: 'onboarding-relaunch',
    })
    try {
      await expect(relaunch.page.locator('.home-hero')).toBeVisible()
      await expect(relaunch.page.locator('.onb-overlay')).toHaveCount(0)
      await expect(relaunch.page.locator('.ec-pick-dialog')).toHaveCount(0)
      await relaunch.page.screenshot({ path: screenshotPath('onboarding-relaunch-no-overlay') })
    } finally {
      await closeAndSaveVideo(relaunch, 'onboarding-relaunch')
    }
  })

  test('skip dismisses the onboarding and persists the seen flag', async () => {
    const launched = await launchShell({ videoDir: 'onboarding-skip' })
    const { page, userDataDir } = launched
    try {
      await expect(page.locator('.onb-overlay')).toBeVisible()
      await page.locator('.onb-skip').click()
      await expect(page.locator('.onb-overlay')).toBeHidden()
      await page.screenshot({ path: screenshotPath('onboarding-skipped-home') })

      await expect
        .poll(async () => {
          const raw = await readFile(join(userDataDir, 'app-settings.json'), 'utf8')
          return (JSON.parse(raw) as { onboardingSeen?: boolean }).onboardingSeen
        })
        .toBe(true)
    } finally {
      await closeAndSaveVideo(launched, 'onboarding-skip')
    }
  })
})
