import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
  | 'device_new' // previously unseen device joined
  | 'system_down' // a component (AdGuard/router) went unreachable
  | 'system_recovered'; // a component came back

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

  constructor(private readonly jwt: JwtService) {}

  /** Reject any socket that doesn't present a valid JWT in its handshake. */
  handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string) ||
      (client.handshake.query?.token as string) ||
      '';
    try {
      this.jwt.verify(token);
      this.logger.debug(`dashboard connected: ${client.id}`);
    } catch {
      this.logger.debug(`rejected unauthenticated socket: ${client.id}`);
      client.disconnect(true);
    }
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
