/**
 * Generates corpus/protocol/*.json: signed events plus hand-written
 * expectations (verdict, OK prefix, normalized record in model field names).
 * Expected `d` / addressKey values are computed here from the NIP-32009
 * material rule with node:crypto, independently of @dtp/trust-protocol.
 *
 * Signatures use random aux data, so re-running rewrites the files with new
 * `sig` values; the verdicts stay the same. Run after `npm run build`:
 *   node packages/conformance/scripts/generate-protocol-cases.ts
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finalizeEvent, getPublicKey, nip19, type Event, type EventTemplate } from 'nostr-tools'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '..', '..', '..', 'corpus', 'protocol')

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const keyOf = (name: string) => Uint8Array.from(Buffer.from(sha(`dtp-corpus-key:${name}`), 'hex'))
const alice = keyOf('alice')
const carol = keyOf('carol')
const alicePub = getPublicKey(alice)
const carolPub = getPublicKey(carol)
const carolNpub = nip19.npubEncode(carolPub)
const T = 1_790_000_000

function material(subject: { type: string; value: string }, scopes: string[], context: string): string {
  const scope = [...new Set(scopes)].sort().join(',')
  if (subject.type === 'p' || subject.type === 'e') return `${subject.type}:${subject.value}:${scope}:${context}`
  return `${subject.value}:${scope}:${context}`
}

const dOf = (subject: { type: string; value: string }, scopes: string[] = [], context = '') =>
  sha(material(subject, scopes, context))

function sign(template: EventTemplate, key = alice): Event {
  const event = finalizeEvent(template, key)
  return { id: event.id, pubkey: event.pubkey, created_at: event.created_at, kind: event.kind, tags: event.tags, content: event.content, sig: event.sig }
}

interface Spec {
  subject: { type: 'p' | 'e' | 'i'; value: string }
  value?: string
  score?: string
  context?: string
  scopes?: string[]
  hints?: string[]
  k?: string
  labels?: Array<[string, string?]>
  x?: number
  y?: number
  content?: string
  kind?: 32009 | 32014
  d?: string
  extra?: string[][]
}

function statement(spec: Spec, key = alice): Event {
  const kind = spec.kind ?? 32009
  const scopes = spec.scopes ?? []
  const context = spec.context ?? ''
  const tags: string[][] = [
    ['d', spec.d ?? dOf(spec.subject, scopes, context)],
    [spec.subject.type, spec.subject.value, ...(spec.hints ?? [])],
    kind === 32009 ? ['v', spec.value ?? '1'] : ['score', spec.score ?? '50'],
  ]
  if (spec.k) tags.push(['k', spec.k])
  else if (spec.subject.type === 'i') {
    const cls = /^(user:id|post:id):/.exec(spec.subject.value)?.[1]
    if (cls) tags.push(['k', cls])
  }
  for (const scope of [...scopes].sort()) tags.push(['s', scope])
  if (context) tags.push(['c', context])
  for (const [label, hint] of spec.labels ?? []) tags.push(hint ? ['l', label, hint] : ['l', label])
  if (spec.x !== undefined) tags.push(['x', String(spec.x)])
  if (spec.y !== undefined) tags.push(['y', String(spec.y)])
  tags.push(...(spec.extra ?? []))
  return sign({ kind, created_at: T, content: spec.content ?? '', tags }, key)
}

const X = { type: 'i' as const, value: 'user:id:11348282' }
const POST = { type: 'i' as const, value: 'post:id:2080659774136291424' }

type Case = { id: string; model: string; tags: string[]; profile: string; description: string; event: Event; expect: Record<string, unknown> }

function valid(id: string, description: string, event: Event, record: Record<string, unknown>, tags: string[] = []): Case {
  return { id, model: 'dtp-wot/1', tags: ['protocol', ...tags], profile: 'x.com', description, event, expect: { valid: true, eligible: true, record } }
}
function rejected(id: string, description: string, event: unknown, prefix: 'invalid' | 'blocked', tags: string[] = []): Case {
  return {
    id,
    model: 'dtp-wot/1',
    tags: ['protocol', ...tags],
    profile: 'x.com',
    description,
    event: event as Event,
    expect: { valid: prefix === 'blocked', prefix, eligible: false },
  }
}

// ---- kind 32009 ---------------------------------------------------------

const trustCases: Case[] = []
{
  const e = statement({ subject: X, context: 'identity', scopes: ['x.com'], hints: [carolNpub] })
  trustCases.push(
    valid('protocol-32009-person-trust-hint', 'Person trust with c=identity, s=x.com and a bare npub hint: hintPubkey is the hint, scopeRank 2.', e, {
      addressKey: `32009:${alicePub}:${dOf(X, ['x.com'], 'identity')}`,
      id: e.id, pubkey: alicePub, kind: 32009, created_at: T, subjectType: 'i', subject: X.value,
      context: 'identity', value: 1, scopeRank: 2, hintPubkey: carolPub, activate: null, expire: null, labels: [],
    }, ['hint', 'scope']),
  )
}
{
  const e = statement({ subject: X, context: 'identity', hints: [carolNpub] })
  trustCases.push(
    valid('protocol-32009-empty-scope-hint-ignored', 'Empty scope set is eligible (scopeRank 1), but the npub hint is not interpreted without s=x.com.', e, {
      addressKey: `32009:${alicePub}:${dOf(X, [], 'identity')}`, scopeRank: 1, hintPubkey: null, value: 1,
    }, ['hint', 'scope']),
  )
}
{
  const e = statement({ subject: POST, value: '', scopes: ['x.com'] })
  trustCases.push(valid('protocol-32009-delete', 'Empty v is a Delete: a valid record without a value.', e, { value: null, context: '', subject: POST.value }, ['delete']))
}
{
  const e = statement({ subject: POST, value: '0' })
  trustCases.push(valid('protocol-32009-neutral', 'Neutral (v=0) is an active value.', e, { value: 0, scopeRank: 1 }))
}
{
  const e = statement({ subject: { type: 'p', value: carolPub }, value: '-1', context: 'identity', x: T - 10, y: T + 10 })
  trustCases.push(
    valid('protocol-32009-pubkey-window', 'p subject with an x / y activity window.', e, {
      subjectType: 'p', subject: carolPub, value: -1, activate: T - 10, expire: T + 10,
      addressKey: `32009:${alicePub}:${dOf({ type: 'p', value: carolPub }, [], 'identity')}`,
    }, ['activity']),
  )
}
{
  const e = statement({ subject: X, context: 'identity', scopes: ['x.com'], labels: [['reviewer', 'Trusted <b>reviewer</b>'], ['press']] })
  trustCases.push(
    valid('protocol-32009-labels', 'Labels with sanitized display hints; labels never enter d.', e, {
      labels: ['reviewer', 'press'], labelHints: { reviewer: 'Trusted breviewer/b' },
      addressKey: `32009:${alicePub}:${dOf(X, ['x.com'], 'identity')}`,
    }, ['labels']),
  )
}
{
  const e = statement({ subject: X, scopes: ['x.com', 'example.com'], context: 'identity' })
  trustCases.push(valid('protocol-32009-multi-scope-with-xcom', 'A scope set that contains x.com is eligible with rank 2.', e, { scopeRank: 2 }, ['scope']))
}
{
  const good = statement({ subject: X, context: 'identity' })
  trustCases.push(rejected('protocol-32009-bad-signature', 'Signature does not verify.', { ...good, sig: 'ab'.repeat(64) }, 'invalid', ['signature']))
  trustCases.push(rejected('protocol-32009-id-mismatch', 'Content changed after signing: id no longer matches.', { ...good, content: 'tampered' }, 'invalid', ['signature']))
}
trustCases.push(rejected('protocol-32009-d-mismatch', 'd does not match subject, scope, and context.', statement({ subject: X, context: 'identity', d: sha('wrong') }), 'invalid', ['d']))
trustCases.push(rejected('protocol-32009-two-subjects', 'Exactly one subject tag is allowed.', statement({ subject: X, extra: [['p', carolPub]] }), 'invalid', ['subject']))
trustCases.push(rejected('protocol-32009-bad-value', 'v must be 1, 0, -1, or empty.', statement({ subject: X, value: '2' }), 'invalid', ['value']))
trustCases.push(rejected('protocol-32009-malformed-npub-hint', 'A malformed npub hint makes the event invalid (NIP-32009 checklist item 7).', statement({ subject: X, scopes: ['x.com'], hints: ['npub1notanpub'] }), 'invalid', ['hint']))
trustCases.push(rejected('protocol-32009-window-order', 'x must not be after y.', statement({ subject: X, x: T + 10, y: T }), 'invalid', ['activity']))
trustCases.push(rejected('protocol-32009-content-limit', 'content is limited to 1024 Unicode characters.', statement({ subject: X, content: 'é'.repeat(1025) }), 'invalid', ['content']))
trustCases.push(rejected('protocol-32009-context-grammar', 'c must be canonical lowercase segments.', statement({ subject: X, context: 'Identity', d: dOf(X, [], 'Identity') }), 'invalid', ['context']))
trustCases.push(rejected('protocol-32009-k-mismatch', 'k must be the class prefix of the i subject.', statement({ subject: X, k: 'post:id' }), 'invalid', ['subject']))
trustCases.push(rejected('protocol-32009-ext-twitter-subject', 'Platform names never appear in i subjects.', statement({ subject: { type: 'i', value: 'ext:twitter_id:1' }, k: 'ext' }), 'invalid', ['subject']))
trustCases.push(rejected('protocol-32009-ineligible-scope', 'Scope set without x.com is ineligible for profile x.com: blocked.', statement({ subject: X, scopes: ['example.com'] }), 'blocked', ['scope']))

// ---- kind 32014 ---------------------------------------------------------

const ratingCases: Case[] = []
{
  const e = statement({ kind: 32014, subject: POST, score: '87.5', scopes: ['x.com'], labels: [['genuine']] })
  ratingCases.push(
    valid('protocol-32014-rating', 'Rating with s=x.com, fractional score, and a label.', e, {
      kind: 32014, value: 87.5, scopeRank: 2, labels: ['genuine'], context: '',
      addressKey: `32014:${alicePub}:${dOf(POST, ['x.com'], '')}`,
    }, ['rating']),
  )
}
{
  const e = statement({ kind: 32014, subject: POST, score: '', scopes: ['x.com'] })
  ratingCases.push(valid('protocol-32014-cancel', 'Empty score deletes the rating slot.', e, { kind: 32014, value: null }, ['rating', 'delete']))
}
{
  const e = statement({ kind: 32014, subject: POST, score: '0', scopes: ['x.com'] })
  ratingCases.push(valid('protocol-32014-zero', 'A score of 0 is an active rating.', e, { value: 0 }, ['rating']))
}
ratingCases.push(rejected('protocol-32014-no-scope', 'Ratings require s=x.com in profile x.com.', statement({ kind: 32014, subject: POST, score: '50' }), 'blocked', ['rating', 'scope']))
ratingCases.push(rejected('protocol-32014-score-range', 'Score above 100.', statement({ kind: 32014, subject: POST, score: '101', scopes: ['x.com'] }), 'invalid', ['rating']))
ratingCases.push(rejected('protocol-32014-score-leading-zero', 'Score must be canonical (no leading zero).', statement({ kind: 32014, subject: POST, score: '08', scopes: ['x.com'] }), 'invalid', ['rating']))
ratingCases.push(rejected('protocol-32014-score-digits', 'At most 6 fraction digits.', statement({ kind: 32014, subject: POST, score: '1.1234567', scopes: ['x.com'] }), 'invalid', ['rating']))

// ---- kind 10011 ---------------------------------------------------------

const identityCases: Case[] = []
{
  const e = sign({ kind: 10011, created_at: T, content: '', tags: [['i', 'twitter:nasa'], ['i', 'twitter_id:11348282'], ['i', 'github:nasa', 'gist']] }, carol)
  identityCases.push({
    id: 'protocol-10011-claim', model: 'dtp-wot/1', tags: ['protocol', 'claim'], profile: 'x.com',
    description: 'Winning 10011 with twitter + twitter_id: the claim (pubkey, twitterId).',
    event: e,
    expect: { valid: true, eligible: true, record: { addressKey: `10011:${carolPub}:`, kind: 10011 }, claim: { pubkey: carolPub, twitterId: '11348282', eventId: e.id } },
  })
}
{
  const e = sign({ kind: 10011, created_at: T, content: '', tags: [['i', 'github:nasa', 'gist']] }, carol)
  identityCases.push({
    id: 'protocol-10011-revoked', model: 'dtp-wot/1', tags: ['protocol', 'claim'], profile: 'x.com',
    description: 'A valid 10011 without X tags is a slot winner that claims nothing (revocation).',
    event: e, expect: { valid: true, eligible: true, record: { addressKey: `10011:${carolPub}:` }, claim: null },
  })
}
{
  const e = sign({ kind: 10011, created_at: T, content: '', tags: [['i', 'twitter:NASA'], ['i', 'twitter_id:11348282']] }, carol)
  identityCases.push({
    id: 'protocol-10011-malformed-claim', model: 'dtp-wot/1', tags: ['protocol', 'claim'], profile: 'x.com',
    description: 'Non-canonical handle: the signed 10011 is kept as the winner, but it carries no claim (treated as none).',
    event: e, expect: { valid: true, eligible: true, claim: null },
  })
}
{
  const e = sign({ kind: 10011, created_at: T, content: '', tags: [['i', 'twitter:nasa'], ['i', 'twitter_id:11348282']] }, carol)
  identityCases.push(rejected('protocol-10011-bad-signature', '10011 with a forged signature.', { ...e, sig: 'cd'.repeat(64) }, 'invalid', ['claim', 'signature']))
}

// ---- kind 5 and others --------------------------------------------------

const otherCases: Case[] = []
{
  const target = statement({ subject: X, context: 'identity' })
  const d = dOf(X, [], 'identity')
  const e = sign({ kind: 5, created_at: T + 5, content: '', tags: [['e', target.id], ['a', `32009:${alicePub}:${d}`], ['a', `32009:${carolPub}:${d}`], ['a', `30023:${alicePub}:note`], ['k', '32009']] })
  otherCases.push({
    id: 'protocol-5-deletion', model: 'dtp-wot/1', tags: ['protocol', 'nip09'], profile: 'x.com',
    description: 'NIP-09: e targets are kept; a targets only for the author and held kinds.',
    event: e, expect: { valid: true, eligible: true, deletion: { eventIds: [target.id], addressKeys: [`32009:${alicePub}:${d}`] } },
  })
}
otherCases.push(
  rejected('protocol-5-foreign-targets-only', 'A deletion that only targets other kinds is not accepted.', sign({ kind: 5, created_at: T, content: '', tags: [['a', `30023:${alicePub}:note`]] }), 'blocked', ['nip09']),
)
otherCases.push(
  rejected('protocol-5-malformed-e', 'e tags must carry a 64-hex id.', sign({ kind: 5, created_at: T, content: '', tags: [['e', 'nothex']] }), 'invalid', ['nip09']),
)
otherCases.push(rejected('protocol-kind-1-blocked', 'Kinds other than 32009, 32014, 10011, 5 are not held.', sign({ kind: 1, created_at: T, content: 'hello', tags: [] }), 'blocked'))
otherCases.push(rejected('protocol-not-an-event', 'A JSON object that is not a signed event.', { kind: 32009, tags: [] }, 'invalid'))

mkdirSync(out, { recursive: true })
const files: Record<string, Case[]> = {
  'kind-32009.json': trustCases,
  'kind-32014.json': ratingCases,
  'kind-10011.json': identityCases,
  'kind-5-and-others.json': otherCases,
}
for (const [name, cases] of Object.entries(files)) {
  writeFileSync(resolve(out, name), `${JSON.stringify({ cases }, null, 2)}\n`)
}
console.log(Object.entries(files).map(([n, c]) => `${n}: ${c.length}`).join('\n'))
