import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import type { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import {
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import type { EventEnvelope, EventSubscriberPort } from '@surfgen/core';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';

export const EVENT_SUBSCRIBER = Symbol('EVENT_SUBSCRIBER');

interface ClientState {
  userId: string;
  organizationIds: Set<string>;
}

/**
 * Real-time progress channel. Clients connect, authenticate with their JWT,
 * then receive video.* / pipeline.* events for organizations they belong to.
 *
 * Protocol (JSON messages):
 *   → { type: 'auth', token: '<jwt>' }
 *   ← { type: 'auth.ok' }
 *   ← { type: 'event', name: 'video.progress', payload: {...} }
 */
@Injectable()
@WebSocketGateway({ path: '/ws' })
export class ProgressGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly clients = new Map<WebSocket, ClientState>();
  private subscription: { unsubscribe: () => Promise<void> } | null = null;

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    @Inject(EVENT_SUBSCRIBER) private readonly subscriber: EventSubscriberPort,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscription = await this.subscriber.subscribe(
      ['video.#', 'pipeline.#'],
      async (event) => this.broadcast(event),
      { queueName: 'api-progress-gateway' },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscription?.unsubscribe();
  }

  handleConnection(_client: WebSocket): void {
    // Connection stays unauthenticated until an auth message arrives.
  }

  handleDisconnect(client: WebSocket): void {
    this.clients.delete(client);
  }

  @SubscribeMessage('auth')
  async onAuth(client: WebSocket, payload: { token?: string }): Promise<void> {
    try {
      const verified = await this.authService.verifyAccessToken(payload?.token ?? '');
      const memberships = await this.prisma.membership.findMany({
        where: { userId: verified.sub },
        select: { organizationId: true },
      });
      this.clients.set(client, {
        userId: verified.sub,
        organizationIds: new Set(memberships.map((m) => m.organizationId)),
      });
      client.send(JSON.stringify({ type: 'auth.ok' }));
    } catch {
      client.send(JSON.stringify({ type: 'auth.error', message: 'Invalid token' }));
      client.close(4401, 'unauthorized');
    }
  }

  private broadcast(event: EventEnvelope): void {
    if (!event.organizationId) return;
    const message = JSON.stringify({
      type: 'event',
      name: event.name,
      payload: event.payload,
      occurredAt: event.occurredAt,
    });
    for (const [socket, state] of this.clients) {
      if (state.organizationIds.has(event.organizationId) && socket.readyState === socket.OPEN) {
        socket.send(message);
      }
    }
  }
}
