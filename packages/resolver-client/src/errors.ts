export type ResolverErrorCode =
  | 'invalid'
  | 'auth-required'
  | 'restricted'
  | 'rate-limited'
  | 'error'
  | 'busy'
  | 'cancelled'
  | 'not-found'
  | 'unsupported'
  | 'timeout'
  | 'blocked'
  | 'duplicate'

const ERROR_CODES: ReadonlySet<string> = new Set<ResolverErrorCode>([
  'invalid',
  'auth-required',
  'restricted',
  'rate-limited',
  'error',
  'busy',
  'cancelled',
  'not-found',
  'unsupported',
  'timeout',
  'blocked',
  'duplicate',
])

export function isResolverErrorCode(value: unknown): value is ResolverErrorCode {
  return typeof value === 'string' && ERROR_CODES.has(value)
}

export class ResolverError extends Error {
  readonly code: ResolverErrorCode

  constructor(code: ResolverErrorCode, message: string) {
    super(message)
    this.name = 'ResolverError'
    this.code = code
  }
}

/** NIP-01 machine-readable prefix: `"auth-required: sign in"` → `"auth-required"`. */
export function machinePrefix(message: unknown): string | undefined {
  if (typeof message !== 'string') return undefined
  return /^([a-z][a-z0-9-]*):/.exec(message)?.[1]
}

/** Known machine prefix of an `OK` / `CLOSED` message, else `fallback`. */
export function errorCodeFromMessage(
  message: unknown,
  fallback: ResolverErrorCode = 'error',
): ResolverErrorCode {
  const prefix = machinePrefix(message)
  return isResolverErrorCode(prefix) ? prefix : fallback
}
