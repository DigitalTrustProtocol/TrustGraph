/** TypeScript protocol runner: `classifyEvent` → canonical verdict in model field names. */

import { classifyEvent, type ScopeProfileName } from '@dtp/trust-protocol'
import type { ProtocolCase } from './types'

export interface ProtocolVerdict {
  valid: boolean
  prefix?: 'invalid' | 'blocked'
  eligible: boolean
  record?: Record<string, unknown>
  claim?: { pubkey: string; twitterId: string; eventId: string } | null
  deletion?: { eventIds: string[]; addressKeys: string[] }
  message?: string
}

export async function runProtocolCase(testCase: ProtocolCase): Promise<ProtocolVerdict> {
  const result = await classifyEvent(testCase.event, {
    profile: testCase.profile as ScopeProfileName,
    now: 0,
  })
  switch (result.type) {
    case 'rejected':
      return {
        valid: result.prefix !== 'invalid',
        prefix: result.prefix,
        eligible: false,
        message: result.message,
      }
    case 'statement': {
      const r = result.record
      return {
        valid: true,
        eligible: true,
        record: {
          addressKey: r.addressKey,
          id: r.id,
          pubkey: r.pubkey,
          kind: r.kind,
          created_at: r.created_at,
          subjectType: r.subjectType,
          subject: r.subject,
          context: r.c_tag ?? '',
          value: r.nValue ?? null,
          activate: r.activate ?? null,
          expire: r.expire ?? null,
          scopeRank: r.scopeRank ?? null,
          hintPubkey: r.hintPubkey ?? null,
          labels: r.labels ?? [],
          labelHints: r.labelHints ?? null,
        },
      }
    }
    case 'identity':
      return {
        valid: true,
        eligible: true,
        record: { addressKey: result.record.addressKey, id: result.record.id, kind: result.record.kind },
        claim: result.claim
          ? { pubkey: result.claim.pubkey, twitterId: result.claim.twitterId, eventId: result.claim.eventId }
          : null,
      }
    case 'deletion':
      return {
        valid: true,
        eligible: true,
        deletion: {
          eventIds: result.deletion.eventIds,
          addressKeys: result.deletion.addresses.map((a) => a.addressKey),
        },
      }
    default: {
      const _exhaustive: never = result
      return _exhaustive
    }
  }
}
