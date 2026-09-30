// Ported subset of AttentionX src/shared/graph-deeplink.ts: the wire node id
// helpers (`<type>:<value>`). URL and Chrome-message helpers stay in AttentionX.
import type { TrustSubject } from '../types'

/** Stable node id for a trust subject (matches heap Graph View ids). */
export function subjectNodeId(subject: TrustSubject): string {
  return `${subject.type}:${subject.value}`
}

/** Parse a graph node id back into a TrustSubject when possible. */
export function parseNodeId(nodeId: string): TrustSubject | undefined {
  const colon = nodeId.indexOf(':')
  if (colon <= 0) return undefined
  const type = nodeId.slice(0, colon)
  const value = nodeId.slice(colon + 1)
  if ((type === 'p' || type === 'e' || type === 'i') && value) {
    return { type, value }
  }
  return undefined
}
