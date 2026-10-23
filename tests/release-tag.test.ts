import { describe, expect, it } from 'vitest'
import { checkRelease } from '../scripts/release-tag'

describe('checkRelease', () => {
  it('publishes a stable tag that matches package.json as latest', () => {
    expect(checkRelease('v0.2.0', '0.2.0', '0.1.0')).toEqual({ version: '0.2.0', distTag: 'latest' })
    expect(checkRelease('v1.0.0', '1.0.0', null)).toEqual({ version: '1.0.0', distTag: 'latest' })
  })

  it('compares versions numerically, not as strings', () => {
    expect(checkRelease('v0.10.0', '0.10.0', '0.9.3').distTag).toBe('latest')
  })

  it('publishes prereleases under their identifier, never latest', () => {
    expect(checkRelease('v0.2.0-beta.1', '0.2.0-beta.1', '0.1.0').distTag).toBe('beta')
    expect(checkRelease('v1.0.0-RC.2', '1.0.0-RC.2', '0.1.0').distTag).toBe('rc')
    expect(checkRelease('v1.0.0-0', '1.0.0-0', '0.1.0').distTag).toBe('next')
  })

  it('rejects tags that are not v + semver', () => {
    for (const tag of ['0.2.0', 'v0.2', 'v01.2.3', 'v0.2.0+build.1', 'v0.2.0-', 'release-0.2.0', 'v0.2.0-beta..1']) {
      expect(() => checkRelease(tag, tag.replace(/^v/, ''), null), tag).toThrow()
    }
  })

  it('rejects a tag that does not match package.json', () => {
    expect(() => checkRelease('v0.2.0', '0.1.0', '0.1.0')).toThrow(/package\.json/)
  })

  it('rejects a stable version that would move latest backwards or repeat it', () => {
    expect(() => checkRelease('v0.1.0', '0.1.0', '0.1.0')).toThrow(/latest/)
    expect(() => checkRelease('v0.0.9', '0.0.9', '0.1.0')).toThrow(/latest/)
  })
})
