import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CORPUS_FORMAT,
  MODEL_VERSION,
  corpusDir,
  isProtocolCase,
  lintCase,
  loadCorpus,
  loadManifest,
  runModelCase,
  runProtocolEntry,
} from '@dtp/conformance'

const entries = loadCorpus()

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return filesUnder(path)
    return entry.name.endsWith('.json') ? [path] : []
  })
}

describe('corpus manifest', () => {
  it('declares the corpus and model versions', () => {
    const manifest = loadManifest()
    expect(manifest.corpus).toBe(CORPUS_FORMAT)
    expect(manifest.model).toBe(MODEL_VERSION)
  })

  it('lists every case file on disk exactly once', () => {
    const manifest = loadManifest()
    const onDisk = [...filesUnder(join(corpusDir, 'model')), ...filesUnder(join(corpusDir, 'protocol'))]
      .map((path) => relative(corpusDir, path).replace(/\\/g, '/'))
      .sort()
    expect([...manifest.cases].sort()).toEqual(onDisk)
    expect(new Set(manifest.cases).size).toBe(manifest.cases.length)
  })

  it('has unique case ids and well-formed cases', () => {
    const ids = entries.map((e) => e.testCase.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const { file, testCase } of entries) {
      expect(lintCase(testCase), `${file} ${testCase.id}`).toEqual([])
      expect(testCase.model, testCase.id).toBe(MODEL_VERSION)
    }
  })

  it('is a real seed set, not a token few', () => {
    const model = entries.filter((e) => !isProtocolCase(e.testCase))
    const protocol = entries.filter((e) => isProtocolCase(e.testCase))
    expect(model.length).toBeGreaterThanOrEqual(30)
    expect(protocol.length).toBeGreaterThanOrEqual(20)
  })
})

describe('model cases (TypeScript runner)', () => {
  for (const { file, testCase } of entries) {
    if (isProtocolCase(testCase)) continue
    it(`${file} › ${testCase.id} [${testCase.tags.join(' ')}]`, () => {
      const failures = runModelCase(testCase).filter((o) => o.errors.length > 0)
      expect(failures.map((o) => `${o.label}\n  ${o.errors.join('\n  ')}`)).toEqual([])
    })
  }
})

describe('protocol cases (TypeScript runner)', () => {
  for (const { file, testCase } of entries) {
    if (!isProtocolCase(testCase)) continue
    it(`${file} › ${testCase.id}`, async () => {
      expect(await runProtocolEntry(testCase)).toEqual([])
    })
  }
})
