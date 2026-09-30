/**
 * Corpus loading (conformance.md § Corpus layout). `@name` placeholders in
 * any string expand to `sha256(name)` as lowercase hex, so cases stay
 * readable and every runner derives identical ids and pubkeys.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CORPUS_FORMAT = 'dtp-wot-corpus/1'
export const MODEL_VERSION = 'dtp-wot/1'

/** `TrustGraph/corpus`, resolved from this module (works from src and dist). */
export const corpusDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'corpus')

export interface CorpusManifest {
  corpus: string
  model: string
  cases: string[]
  /** Session-suite files (conformance.md § One API). */
  sessions?: string[]
}

const PLACEHOLDER = /@([A-Za-z0-9_.-]+)/g

export function placeholderHex(name: string): string {
  return createHash('sha256').update(name, 'utf8').digest('hex')
}

/** Deep copy with every `@name` inside strings replaced by its hex. */
export function expandPlaceholders<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER, (_m, name: string) => placeholderHex(name)) as T
  }
  if (Array.isArray(value)) return value.map((item) => expandPlaceholders(item)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      out[expandPlaceholders(key)] = expandPlaceholders(item)
    }
    return out as T
  }
  return value
}

export function loadManifest(dir = corpusDir): CorpusManifest {
  return JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as CorpusManifest
}

export interface LoadedCase<T> {
  file: string
  raw: T
  expanded: T
}

export function loadCase<T>(file: string, dir = corpusDir): LoadedCase<T> {
  const raw = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as T
  return { file, raw, expanded: expandPlaceholders(raw) }
}
