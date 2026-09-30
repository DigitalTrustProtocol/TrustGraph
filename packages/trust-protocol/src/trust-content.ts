// Ported from AttentionX src/shared/trust-content.ts (imports rewritten for @dtp/* packages).
/**
 * Plain-text sanitization for kind 32009 `content` (human trust reasons).
 * Not structured protocol data — strip markup/script vectors before sign/store.
 */

/** Attention compose / publish clamp (stricter than NIP ≤1024). */
export const ATTENTIONX_TRUST_CONTENT_UI_LIMIT = 144

/**
 * Sanitize optional trust-statement content for local publish.
 * Strips controls and common injection shapes; clamps Unicode length.
 * Empty after sanitize is valid (`""`).
 */
export function sanitizeTrustContent(
  input: string,
  limit: number = ATTENTIONX_TRUST_CONTENT_UI_LIMIT,
): string {
  if (typeof input !== 'string' || input.length === 0) return ''

  let text = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Drop C0/C1 controls except newline; iterate by code point.
  text = [...text]
    .filter((ch) => {
      if (ch === '\n') return true
      const code = ch.codePointAt(0)
      if (code === undefined) return false
      if (code < 0x20) return false
      if (code >= 0x7f && code <= 0x9f) return false
      return true
    })
    .join('')

  // Neutralize markup / URI-scheme injection as plain text (no HTML parse).
  text = text.replace(/[<>]/g, '')
  text = text.replace(/javascript\s*:/gi, '')
  text = text.replace(/vbscript\s*:/gi, '')
  text = text.replace(/data\s*:/gi, '')
  text = text.replace(/\bon[a-z]+\s*=/gi, '')

  text = text.replace(/\n{3,}/g, '\n\n').trim()

  if (!Number.isSafeInteger(limit) || limit < 0) {
    return text
  }
  const chars = [...text]
  if (chars.length > limit) {
    return chars.slice(0, limit).join('')
  }
  return text
}
