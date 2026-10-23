/** Public CatsCo connector status (no tokens / secrets). */

export type CatsCoLinkState =
  | 'online'
  | 'account_ok'
  | 'offline'
  | 'unreachable'
  | 'unknown';

export interface CatsCoStatusView {
  /** High-level link state for the Host pop. */
  state: CatsCoLinkState;
  /** Human summary, e.g. "Online as ab739c71617b". */
  summary: string;
  /** Dashboard reached (XiaoBa `dashboard --port …`). */
  dashboardReachable: boolean;
  /** Base URL we asked (default http://127.0.0.1:3800). */
  dashboardUrl: string;
  /** CatsCo web / API origin when known. */
  appUrl: string;
  accountOk: boolean;
  connectorReady: boolean;
  serviceRunning: boolean;
  authStatus?: string;
  authError?: string;
  user?: {
    uid: string;
    username: string;
    displayName: string;
  };
  device?: {
    name: string;
    deviceId: string;
  };
  runtimeMode?: string;
  deviceConnectorMode?: boolean;
  /** Connector process uptime seconds when running. */
  uptimeSec?: number;
  /** Cloud Agent p2p chat (Dashboard-bound bot). */
  cloudChatReady?: boolean;
  cloudChatReason?: string;
  botUid?: string;
  botName?: string;
  topicId?: string;
}
