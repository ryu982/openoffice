import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { appStrings } from '../src/renderer/i18n/strings-app'

describe('diagram editor scaffold', () => {
  it('names the editor in every language', () => {
    expect(Object.keys(appStrings)).toHaveLength(LANGS.length)
  })
})
