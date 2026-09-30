export interface WebSocketMessageEventLike {
  data?: unknown
}

export interface WebSocketCloseEventLike {
  code?: number
  reason?: string
}

/**
 * The subset of the WHATWG WebSocket the client uses, so the browser / MV3
 * service worker socket, the Node 24+ global `WebSocket`, and test fakes all
 * fit. `addEventListener` is preferred; the `on*` handlers are the fallback.
 */
export interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener?(type: string, listener: (event: any) => void): void
  onopen?: ((event: any) => void) | null
  onmessage?: ((event: any) => void) | null
  onclose?: ((event: any) => void) | null
  onerror?: ((event: any) => void) | null
}

export type WebSocketConstructor = new (url: string) => WebSocketLike

export const WEBSOCKET_OPEN = 1
