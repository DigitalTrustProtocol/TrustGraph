/**
 * NIP-09 slot floors (wot-model.md §2.4, gap G11 in the extension). A
 * deletion removes the slot's winner from the heap and records a floor;
 * records for that slot at or below the floor are discarded, so nothing
 * older is revived and the deleted event cannot come back.
 *
 * The ledger holds one number per deleted slot — slot state, not an event
 * list. Stores persist it (Personal Server `slot_floors`) and reload it.
 */

import type { Graph, ITrustEvent } from '@dtp/trust-graph'

export class SlotFloors {
  readonly #floors = new Map<string, number>()

  get size(): number {
    return this.#floors.size
  }

  get(addressKey: string): number | undefined {
    return this.#floors.get(addressKey)
  }

  /** Raise the floor (never lowers it). Returns the effective floor. */
  raise(addressKey: string, createdAt: number): number {
    const current = this.#floors.get(addressKey)
    const next = current === undefined ? createdAt : Math.max(current, createdAt)
    this.#floors.set(addressKey, next)
    return next
  }

  /** True when a record for this slot is at or below the slot's floor. */
  blocks(record: { addressKey: string; created_at: number }): boolean {
    const floor = this.#floors.get(record.addressKey)
    return floor !== undefined && record.created_at <= floor
  }

  entries(): IterableIterator<[string, number]> {
    return this.#floors.entries()
  }

  clear(): void {
    this.#floors.clear()
  }
}

export type FloorApplyResult = 'applied' | 'ignored' | 'blocked'

/** Heap apply that honours slot floors first. `ignored`: not newer than the winner. */
export function applyWithFloors(
  graph: Graph,
  floors: SlotFloors,
  record: ITrustEvent,
): FloorApplyResult {
  if (floors.blocks(record)) return 'blocked'
  return graph.applyTrustEvent(record) ? 'applied' : 'ignored'
}

/** The current heap winner of a slot, if any (including Delete winners). */
export function slotWinner(graph: Graph, addressKey: string): ITrustEvent | undefined {
  const index = graph.edgesIndex.get(addressKey)
  if (index === undefined) return undefined
  return graph.edgesList[index] ?? undefined
}

export interface DeletionOutcome {
  addressKey: string
  /** The winner that was removed, if one was. */
  removed?: ITrustEvent
  floor: number
}

/**
 * NIP-09 `a` target: clear the slot up to the deletion time. A winner newer
 * than the deletion stays (the deletion cannot reach forward in time).
 */
export function deleteSlotAt(
  graph: Graph,
  floors: SlotFloors,
  addressKey: string,
  deletionCreatedAt: number,
): DeletionOutcome {
  const winner = slotWinner(graph, addressKey)
  let removed: ITrustEvent | undefined
  if (winner && winner.created_at <= deletionCreatedAt) {
    graph.removeTrustEvent(winner)
    removed = winner
  }
  const floor = floors.raise(addressKey, deletionCreatedAt)
  return { addressKey, ...(removed ? { removed } : {}), floor }
}

/**
 * NIP-09 `e` target: remove `winner` (the slot's current winner with that id,
 * found by the caller's id index) when the deletion's author wrote it.
 * The floor is the deleted event's `created_at`.
 */
export function deleteWinner(
  graph: Graph,
  floors: SlotFloors,
  winner: ITrustEvent,
  deletionAuthor: string,
): DeletionOutcome | undefined {
  if (winner.pubkey.toLowerCase() !== deletionAuthor.toLowerCase()) return undefined
  const current = slotWinner(graph, winner.addressKey)
  if (!current || current.id !== winner.id) return undefined
  graph.removeTrustEvent(current)
  const floor = floors.raise(winner.addressKey, winner.created_at)
  return { addressKey: winner.addressKey, removed: current, floor }
}
