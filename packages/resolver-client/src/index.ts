export {
  NIP42_AUTH_KIND,
  ResolverClient,
  type CloseInfo,
  type InstanceChange,
  type PushHandler,
  type PushMessage,
  type ReconnectOptions,
  type RequestOptions,
  type ResolverClientEventName,
  type ResolverClientEvents,
  type ResolverClientOptions,
  type Unsubscribe,
} from './client'
export {
  ResolverError,
  errorCodeFromMessage,
  isResolverErrorCode,
  machinePrefix,
  type ResolverErrorCode,
} from './errors'
export {
  WEBSOCKET_OPEN,
  type WebSocketCloseEventLike,
  type WebSocketConstructor,
  type WebSocketLike,
  type WebSocketMessageEventLike,
} from './socket'
export type * from './types'
export type {
  LookupCountsParams,
  LookupCountsResult,
  LookupPage,
  LookupParams,
  NeighborhoodParams,
  NeighborhoodResult,
  FrontierResult,
  RatingQueryResult,
  TrustQueryResult,
  TrustSubject,
  WireRatingResult,
  WireTrustResult,
} from '@dtp/trust-query'
