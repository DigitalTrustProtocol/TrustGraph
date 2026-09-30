import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatDuration,
  formatLatency,
  formatNumber,
  formatPercent,
  formatRate,
  formatRelative,
  formatTimestamp,
  NA,
  shortPubkey,
} from '../src/app/format'

describe('format helpers', () => {
  it('renders null, undefined and non-finite numbers as n/a', () => {
    for (const fn of [formatNumber, formatBytes, formatDuration, formatRate, formatPercent, formatLatency, formatTimestamp]) {
      expect(fn(null)).toBe(NA)
      expect(fn(undefined)).toBe(NA)
      expect(fn(Number.NaN)).toBe(NA)
    }
    expect(formatRelative(null, 0)).toBe(NA)
  })

  it('groups numbers', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(formatNumber(219.456)).toBe('219.46')
  })

  it('formats bytes in binary units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KiB')
    expect(formatBytes(1536)).toBe('1.5 KiB')
    expect(formatBytes(12_582_912)).toBe('12.0 MiB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GiB')
    expect(formatBytes(2 * 1024 ** 4)).toBe('2.0 TiB')
  })

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(42.9)).toBe('42s')
    expect(formatDuration(303)).toBe('5m 3s')
    expect(formatDuration(7500)).toBe('2h 5m')
    expect(formatDuration(93_784)).toBe('1d 2h')
    expect(formatDuration(-5)).toBe('0s')
  })

  it('formats rates, percentages and latencies', () => {
    expect(formatRate(2.44)).toBe('2.4/s')
    expect(formatRate(0)).toBe('0.0/s')
    expect(formatPercent(0.9)).toBe('90.0 %')
    expect(formatLatency(0.0012)).toBe('1.2 ms')
    expect(formatLatency(2.4)).toBe('2.40 s')
  })

  it('formats timestamps as ISO and relative', () => {
    expect(formatTimestamp(0)).toBe('1970-01-01T00:00:00Z')
    expect(formatTimestamp(1_790_000_000)).toBe('2026-09-21T14:13:20Z')
    expect(formatTimestamp(1_790_000_000_000)).toBe('2026-09-21T14:13:20Z')
    expect(formatRelative(1000, 1300)).toBe('5m 0s ago')
    expect(formatRelative(1060, 1000)).toBe('in 1m 0s')
    expect(formatRelative(1000, 1000)).toBe('now')
  })

  it('shortens pubkeys', () => {
    const pubkey = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
    expect(shortPubkey(pubkey)).toBe('a1b2c3d4…8f90')
    expect(shortPubkey(null)).toBe('anonymous')
    expect(shortPubkey('short')).toBe('short')
  })
})
