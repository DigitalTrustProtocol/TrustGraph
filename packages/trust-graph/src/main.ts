// Package entry. `index.ts` is the vendored barrel and stays byte-identical;
// this file adds the package-local modules that replaced its external imports.
export * from './index'
export * from './constants'
export * from './threshold'
export type { TrustEdgeRecord } from './record'
