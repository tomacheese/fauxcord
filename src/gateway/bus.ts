import { EventEmitter } from 'node:events'

/** Mapping of event names to their payloads exchanged over gatewayBus */
export interface GatewayBusEvents {
  'message.create': {
    guildId: string | undefined
    channelId: string
    message: Record<string, unknown>
  }
  'message.update': {
    guildId: string | undefined
    channelId: string
    message: Record<string, unknown>
  }
  'message.delete': {
    guildId: string | undefined
    channelId: string
    messageId: string
  }
  'message.reaction.add': {
    guildId: string | undefined
    channelId: string
    messageId: string
    userId: string
    emoji: Record<string, unknown>
  }
  'message.reaction.remove': {
    guildId: string | undefined
    channelId: string
    messageId: string
    userId: string
    emoji: Record<string, unknown>
  }
  'guild.create': { guild: Record<string, unknown> }
  'channel.create': { channel: Record<string, unknown> }
  'channel.update': { channel: Record<string, unknown> }
  'channel.delete': { channel: Record<string, unknown> }
  'guild.member.add': { guildId: string; member: Record<string, unknown> }
  'guild.member.update': { guildId: string; member: Record<string, unknown> }
  'guild.member.remove': {
    guildId: string
    userId: string
    user: Record<string, unknown>
  }
  'guild.role.create': { guildId: string; role: Record<string, unknown> }
  'guild.role.update': { guildId: string; role: Record<string, unknown> }
  'guild.role.delete': { guildId: string; roleId: string }
}

/**
 * Typed internal event bus that decouples the REST service layer from the
 * Gateway dispatch layer.
 */
// eslint-disable-next-line unicorn/prefer-event-target -- Node's EventEmitter API (on/emit/off/setMaxListeners) is required here; EventTarget lacks equivalent typed payload ergonomics.
class TypedGatewayBus extends EventEmitter {
  /**
   * Emits an event.
   * @param event - Event name
   * @param payload - Event payload
   * @returns true if a listener existed
   */
  emit<K extends keyof GatewayBusEvents>(
    event: K,
    payload: GatewayBusEvents[K]
  ): boolean {
    return super.emit(event, payload)
  }

  /**
   * Registers an event listener.
   * @param event - Event name
   * @param listener - Listener function
   * @returns this
   */
  on<K extends keyof GatewayBusEvents>(
    event: K,
    listener: (payload: GatewayBusEvents[K]) => void
  ): this {
    return super.on(event, listener)
  }

  /**
   * Removes an event listener.
   * @param event - Event name
   * @param listener - Listener function
   * @returns this
   */
  off<K extends keyof GatewayBusEvents>(
    event: K,
    listener: (payload: GatewayBusEvents[K]) => void
  ): this {
    return super.off(event, listener)
  }
}

/** Singleton Gateway internal bus shared across the whole app */
export const gatewayBus = new TypedGatewayBus()
// Raise the listener limit so frequent emits from the REST layer don't
// trigger Node's max-listeners warning (leaves headroom for more concurrent
// sessions).
gatewayBus.setMaxListeners(50)
