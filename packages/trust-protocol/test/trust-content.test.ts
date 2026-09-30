// Ported from AttentionX src/shared/trust-content.test.ts (imports rewritten for @dtp/* packages).
import { describe, expect, it } from 'vitest'
import {
  ATTENTIONX_TRUST_CONTENT_UI_LIMIT,
  sanitizeTrustContent,
} from '../src/trust-content'

describe('sanitizeTrustContent', () => {
  it('returns empty for empty or non-stringish empty', () => {
    expect(sanitizeTrustContent('')).toBe('')
    expect(sanitizeTrustContent('   ')).toBe('')
  })

  it('trims and keeps plain text', () => {
    expect(sanitizeTrustContent('  hello world  ')).toBe('hello world')
  })

  it('strips control characters but keeps newlines', () => {
    expect(sanitizeTrustContent('a\0b\nc\td')).toBe('ab\ncd')
  })

  it('normalizes CR and CRLF to LF', () => {
    expect(sanitizeTrustContent('a\r\nb\rc')).toBe('a\nb\nc')
  })

  it('strips angle brackets and script-like markup', () => {
    expect(sanitizeTrustContent('<script>alert(1)</script>')).toBe(
      'scriptalert(1)/script',
    )
    expect(sanitizeTrustContent('x <b>y</b>')).toBe('x by/b')
  })

  it('strips javascript: data: vbscript: and on*= handlers', () => {
    expect(sanitizeTrustContent('see javascript:alert(1)')).toBe('see alert(1)')
    expect(sanitizeTrustContent('data:text/html,x')).toBe('text/html,x')
    expect(sanitizeTrustContent('vbscript:msg')).toBe('msg')
    expect(sanitizeTrustContent('onclick=evil')).toBe('evil')
  })

  it('collapses excessive blank lines', () => {
    expect(sanitizeTrustContent('a\n\n\n\nb')).toBe('a\n\nb')
  })

  it('clamps to UI limit by Unicode characters', () => {
    const long = '😀'.repeat(ATTENTIONX_TRUST_CONTENT_UI_LIMIT + 10)
    const out = sanitizeTrustContent(long)
    expect([...out].length).toBe(ATTENTIONX_TRUST_CONTENT_UI_LIMIT)
  })

  it('accepts a custom limit', () => {
    expect(sanitizeTrustContent('abcdef', 3)).toBe('abc')
  })
})
