import type { CatsCoLinkState, CatsCoStatusView } from '@remotepad/shared';
import { resolveCatsCoChatTarget } from './catsco-chat.ts';
import { config } from './config.ts';

type DashCatsStatus = {
  connected?: boolean;
  connectorReady?: boolean;
  chatReady?: boolean;
  authStatus?: string;
  authError?: string;
  user?: { uid?: string; username?: string; display_name?: string };
  device?: { name?: string; deviceId?: string; bodyId?: string };
  deviceConnectorMode?: boolean;
  runtimeMode?: string;
  httpBaseUrl?: string;
  service?: { status?: string; uptime?: number; pid?: number };
};

/**
 * Read CatsCo connector status from the already-running XiaoBa Dashboard.
 * Does not start or stop the connector. Never returns tokens.
 */
export async function readCatsCoStatus(): Promise<CatsCoStatusView> {
  if (config.catscoLocalOnly) {
    // No Dashboard on this machine by design; the panel reads local session files.
    return {
      state: 'online',
      summary: 'Attached to the agent on this machine (local session files)',
      dashboardReachable: false,
      dashboardUrl: '',
      appUrl: 'https://app.catsco.cc',
      accountOk: true,
      connectorReady: true,
      serviceRunning: true,
    };
  }
  const dashboardUrl = config.catscoDashboardUrl.replace(/\/$/, '');
  const appUrl = 'https://app.catsco.cc';
  const base: CatsCoStatusView = {
    state: 'unreachable',
    summary: 'CatsCo Dashboard not reachable',
    dashboardReachable: false,
    dashboardUrl,
    appUrl,
    accountOk: false,
    connectorReady: false,
    serviceRunning: false,
  };

  try {
    const res = await fetch(`${dashboardUrl}/api/cats/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return {
        ...base,
        summary: `Dashboard returned HTTP ${res.status}`,
        state: 'unreachable',
      };
    }
    const raw = await res.json() as DashCatsStatus;
    const view = mapDashStatus(raw, dashboardUrl, appUrl);
    try {
      const chat = await resolveCatsCoChatTarget();
      view.cloudChatReady = chat.ready;
      view.cloudChatReason = chat.reason;
      view.botUid = chat.botUid || undefined;
      view.botName = chat.botName || undefined;
      view.topicId = chat.topicId || undefined;
      if (chat.appUrl) view.appUrl = chat.appUrl;
    } catch {
      view.cloudChatReady = false;
    }
    return view;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      summary: `No Dashboard at ${dashboardUrl} (${shortErr(message)})`,
      state: 'unreachable',
    };
  }
}

function mapDashStatus(raw: DashCatsStatus, dashboardUrl: string, fallbackApp: string): CatsCoStatusView {
  const appUrl = String(raw.httpBaseUrl || fallbackApp).replace(/\/$/, '') || fallbackApp;
  const accountOk = Boolean(raw.connected) && raw.authStatus !== 'invalid';
  const connectorReady = Boolean(raw.connectorReady);
  const serviceRunning = String(raw.service?.status || '') === 'running';
  const user = raw.user?.uid
    ? {
      uid: String(raw.user.uid),
      username: String(raw.user.username || ''),
      displayName: String(raw.user.display_name || raw.user.username || ''),
    }
    : undefined;
  const deviceName = String(raw.device?.name || '').trim();
  const deviceId = String(raw.device?.deviceId || raw.device?.bodyId || '').trim();
  const device = deviceId || deviceName
    ? { name: deviceName || deviceId, deviceId: deviceId || deviceName }
    : undefined;

  const state = linkState({ accountOk, connectorReady, serviceRunning });
  return {
    state,
    summary: summaryFor(state, user, device),
    dashboardReachable: true,
    dashboardUrl,
    appUrl,
    accountOk,
    connectorReady,
    serviceRunning,
    authStatus: raw.authStatus,
    authError: raw.authError || undefined,
    user,
    device,
    runtimeMode: raw.runtimeMode,
    deviceConnectorMode: Boolean(raw.deviceConnectorMode),
    uptimeSec: typeof raw.service?.uptime === 'number' ? Math.round(raw.service.uptime) : undefined,
  };
}

function linkState(flags: {
  accountOk: boolean;
  connectorReady: boolean;
  serviceRunning: boolean;
}): CatsCoLinkState {
  if (flags.accountOk && flags.connectorReady && flags.serviceRunning) return 'online';
  if (flags.accountOk) return 'account_ok';
  if (!flags.accountOk && !flags.serviceRunning) return 'offline';
  return 'unknown';
}

function summaryFor(
  state: CatsCoLinkState,
  user: CatsCoStatusView['user'],
  device: CatsCoStatusView['device'],
): string {
  const who = user?.displayName || user?.username || '';
  const asDevice = device?.name ? ` as ${device.name}` : '';
  if (state === 'online') {
    return who ? `Online${asDevice} · ${who}` : `Online${asDevice}`;
  }
  if (state === 'account_ok') {
    return who
      ? `Signed in as ${who}${asDevice ? ` · device${asDevice}` : ''} (connector not fully up)`
      : 'Signed in (connector not fully up)';
  }
  if (state === 'offline') return 'Offline — start XiaoBa Dashboard / connector';
  if (state === 'unreachable') return 'CatsCo Dashboard not reachable';
  return 'CatsCo status unknown';
}

function shortErr(message: string): string {
  const line = message.split('\n')[0] || message;
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}
