import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

export type AlertType =
  | 'blocked_access' // device tried a blocked domain/category
  | 'bypass_attempt' // DoH/DoT/VPN/custom-DNS detected
  | 'mac_randomized' // new randomized-MAC device appeared
  | 'quota_exceeded' // profile hit its daily limit
  | 'bedtime_pause' // schedule paused a profile
  | 'device_new'; // previously unseen device joined

export interface Alert {
  type: AlertType;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  profileId?: string | null;
  deviceId?: string | null;
  domain?: string;
  at: string; // ISO
}

/**
 * Fan-out hub for real-time notifications. Feature services call `emitAlert()`;
 * the React dashboard subscribes over Socket.IO. This is also the natural place
 * to add an outbound webhook (Discord/Slack/ntfy) — see emitAlert().
 */
@WebSocketGateway({
  cors: { origin: (process.env.CORS_ORIGIN ?? '*').split(',') },
})
export class EventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    this.logger.debug(`dashboard connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`dashboard disconnected: ${client.id}`);
  }

  /** Broadcast an alert to all connected dashboards (+ optional webhook). */
  emitAlert(alert: Alert): void {
    this.server?.emit('alert', alert);
    this.maybeWebhook(alert);
  }

  /** Push a live activity row for the streaming feed. */
  emitActivity(row: unknown): void {
    this.server?.emit('activity', row);
  }

  private maybeWebhook(alert: Alert): void {
    const url = process.env.ALERT_WEBHOOK_URL;
    if (!url) return;
    // Fire-and-forget; never let webhook failure affect the request path.
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `[${alert.severity}] ${alert.message}` }),
    }).catch((e) => this.logger.warn(`webhook failed: ${e.message}`));
  }
}
