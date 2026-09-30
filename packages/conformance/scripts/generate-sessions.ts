/**
 * Generates corpus/sessions/*.json: scripted sessions for the one-API suite.
 * Events are signed with fixed test keys; expectations are written by hand
 * from resolver-api.md (prefix matchers where the text is server-chosen).
 * Run after `npm run build`: node packages/conformance/scripts/generate-sessions.ts
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools'
import { buildKind10011Event, buildKind32009Event, buildKind32014Event } from '@dtp/trust-protocol'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '..', '..', '..', 'corpus', 'sessions')
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const keyOf = (name: string) => Uint8Array.from(Buffer.from(sha(`dtp-session-key:${name}`), 'hex'))
const T = 1_790_000_000

const root = keyOf('root')
const alice = keyOf('alice')
const bob = keyOf('bob')
const carol = keyOf('carol')
const ROOT = getPublicKey(root)
const ALICE = getPublicKey(alice)
const BOB = getPublicKey(bob)
const CAROL = getPublicKey(carol)
const X = { type: 'i' as const, value: 'user:id:11348282' }
const POST = { type: 'i' as const, value: 'post:id:2080659774136291424' }

const clean = (e: Event): Event => ({ id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags, content: e.content, sig: e.sig })
const trust = async (sk: Uint8Array, subject: { type: 'p' | 'i'; value: string }, value: '1' | '0' | '-1' | '', createdAt: number, extra: { context?: string; scopes?: string[] } = {}) =>
  clean(finalizeEvent(await buildKind32009Event({ subject, value, context: extra.context ?? 'identity', scopes: extra.scopes ?? [], createdAt }), sk))
const rating = async (sk: Uint8Array, score: string, createdAt: number) =>
  clean(finalizeEvent(await buildKind32014Event({ subject: POST, score, scopes: ['x.com'], createdAt }), sk))

const rootAlice = await trust(root, { type: 'p', value: ALICE }, '1', T)
const aliceBob = await trust(alice, { type: 'p', value: BOB }, '1', T + 1)
const bobX = await trust(bob, X, '1', T + 2, { scopes: ['x.com'] })
const alicePost = await trust(alice, POST, '-1', T + 3, { context: '' })
const aliceRating = await rating(alice, '40', T + 4)
const carolBob = await trust(carol, { type: 'p', value: BOB }, '-1', T + 5)
const claim = clean(finalizeEvent(buildKind10011Event({ handle: 'nasa', twitterId: '11348282', createdAt: T + 6 }), carol))
const note = clean(finalizeEvent({ kind: 1, created_at: T, tags: [], content: 'not held' }, alice))
const forged = { ...aliceBob, sig: 'ab'.repeat(64) }
const deletion = clean(finalizeEvent({ kind: 5, created_at: T + 10, content: '', tags: [['e', carolBob.id], ['k', '32009']] }, carol))
const foreignDeletion = clean(finalizeEvent({ kind: 5, created_at: T + 10, content: '', tags: [['e', rootAlice.id]] }, carol))

const ok = (id: string, accepted: boolean, message: unknown = '') => ['OK', id, accepted, message]
const prefix = (p: string) => ({ $prefix: p })

const session = {
  id: 'session-basic-open',
  api: 'v1',
  description: 'Open access (auth.reads = auth.writes = open), empty server. Ingest with OK prefixes, NIP-09, limited REQ, resolver and lookup operations, errors.',
  config: { 'auth.reads': 'open', 'auth.writes': 'open', scopeProfile: 'x.com' },
  steps: [
    { note: 'accept', send: ['EVENT', rootAlice], expect: [ok(rootAlice.id, true)] },
    { send: ['EVENT', aliceBob], expect: [ok(aliceBob.id, true)] },
    { send: ['EVENT', bobX], expect: [ok(bobX.id, true)] },
    { send: ['EVENT', alicePost], expect: [ok(alicePost.id, true)] },
    { send: ['EVENT', aliceRating], expect: [ok(aliceRating.id, true)] },
    { send: ['EVENT', carolBob], expect: [ok(carolBob.id, true)] },
    { send: ['EVENT', claim], expect: [ok(claim.id, true)] },
    { note: 'duplicate', send: ['EVENT', rootAlice], expect: [ok(rootAlice.id, true, prefix('duplicate:'))] },
    { note: 'forged signature', send: ['EVENT', forged], expect: [ok(forged.id, false, prefix('invalid:'))] },
    { note: 'kind not held', send: ['EVENT', note], expect: [ok(note.id, false, prefix('blocked:'))] },
    {
      send: ['DTP', 's1', 'session.update', { defaults: { rootPubkey: ROOT, followTrustThreshold: 75, followTrustRed: 25, bounds: { maxDepth: 4 } } }],
      expect: [['DTP-OK', 's1', { defaults: { rootPubkey: ROOT } }]],
    },
    {
      note: 'two hops',
      send: ['DTP', 'q1', 'trust.query', { subject: { type: 'p', value: BOB } }],
      expect: [['DTP-OK', 'q1', {
        subject: { type: 'p', value: BOB }, context: 'identity', connected: true, degree: 2, trust: 1, distrust: 0,
        resolution: 'trusted', sourceEventIds: [aliceBob.id],
        statements: [{ eventId: aliceBob.id, author: ALICE, value: 1, distance: 1, contextMatch: 'exact' }],
        graphVersion: { $type: 'number' },
      }]],
    },
    {
      note: 'post trust falls back to the global bucket',
      send: ['DTP', 'q2', 'trust.batch', { items: [{ key: 'post', subject: POST }, { key: 'bad', subject: { type: 'x', value: '1' } }] }],
      expect: [['DTP-OK', 'q2', {
        results: { post: { connected: true, degree: 2, distrust: 1, resolution: 'distrusted', statements: [{ eventId: alicePost.id, contextMatch: 'general' }] } },
        errors: { bad: prefix('invalid:') },
      }]],
    },
    {
      send: ['DTP', 'q3', 'rating.query', { subject: POST }],
      expect: [['DTP-OK', 'q3', { degree: 2, claimCount: 1, averageScore: 40, claims: [{ eventId: aliceRating.id, author: ALICE, score: 40, distance: 1 }] }]],
    },
    {
      send: ['DTP', 'l1', 'lookup.incoming', { keys: [`p:${BOB}`], context: 'identity', withTotals: true }],
      expect: [['DTP-OK', 'l1', {
        items: [
          { eventId: carolBob.id, author: CAROL, value: -1, kind: 32009 },
          { eventId: aliceBob.id, author: ALICE, value: 1, kind: 32009 },
        ],
        totals: { trust: 1, neutral: 0, distrust: 1, ratings: 0 },
      }]],
    },
    {
      send: ['DTP', 'l2', 'lookup.counts', { keys: [`p:${ALICE}`], direction: 'outgoing', kinds: [32009, 32014], contextMatch: 'any' }],
      expect: [['DTP-OK', 'l2', { counts: { [`p:${ALICE}`]: { trust: 1, neutral: 0, distrust: 1, ratings: 1 } } }]],
    },
    {
      send: ['DTP', 'f1', 'graph.frontier', { roots: [ROOT], maxDepth: 3 }],
      expect: [['DTP-OK', 'f1', { authors: [{ pubkey: ROOT, depth: 0 }, { pubkey: ALICE, depth: 1, via: ROOT }, { pubkey: BOB, depth: 2, via: ALICE }], reasons: [] }]],
    },
    {
      send: ['DTP', 'c1', 'identity.claims', { twitterId: '11348282' }],
      expect: [['DTP-OK', 'c1', { claims: [{ pubkey: CAROL, eventId: claim.id }] }]],
    },
    { note: 'REQ by id', send: ['REQ', 'r1', { ids: [aliceBob.id] }], expect: [['EVENT', 'r1', aliceBob], ['EOSE', 'r1']] },
    { note: 'REQ outside the limited reads', send: ['REQ', 'r2', { '#p': [BOB] }], expect: [['CLOSED', 'r2', prefix('unsupported:')]] },
    { note: 'unknown op', send: ['DTP', 'e1', 'no.such.op', {}], expect: [['DTP-ERR', 'e1', 'invalid', { $type: 'string' }]] },
    { note: 'bad lookup key', send: ['DTP', 'e2', 'lookup.incoming', { keys: ['nope'] }], expect: [['DTP-ERR', 'e2', 'invalid', { $type: 'string' }]] },
    { note: 'malformed root', send: ['DTP', 'e3', 'trust.query', { rootPubkey: 'nothex', subject: POST }], expect: [['DTP-ERR', 'e3', 'invalid', { $type: 'string' }]] },
    {
      note: 'batch cap',
      send: ['DTP', 'e4', 'trust.batch', { items: Array.from({ length: 201 }, (_, i) => ({ key: `k${i}`, subject: POST })) }],
      expect: [['DTP-ERR', 'e4', 'invalid', { $type: 'string' }]],
    },
    { note: 'only the author may delete', send: ['EVENT', foreignDeletion], expect: [ok(foreignDeletion.id, false, prefix('blocked:'))] },
    { note: 'NIP-09 deletion', send: ['EVENT', deletion], expect: [ok(deletion.id, true)] },
    { note: 'deleted stays deleted', send: ['EVENT', carolBob], expect: [ok(carolBob.id, false, prefix('blocked:'))] },
    {
      send: ['DTP', 'l3', 'lookup.incoming', { keys: [`p:${BOB}`], context: 'identity' }],
      expect: [['DTP-OK', 'l3', { items: [{ eventId: aliceBob.id }] }]],
    },
    { send: ['REQ', 'r3', { ids: [carolBob.id] }], expect: [['EOSE', 'r3']] },
  ],
}

mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, 'basic-open.json'), `${JSON.stringify(session, null, 2)}\n`)
console.log(`sessions: 1 (${session.steps.length} steps)`)
