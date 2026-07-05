import { EventEmitter } from 'node:events'

/** gatewayBus がやり取りするイベント名とペイロードの対応表 */
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
 * REST サービス層と Gateway 配信層を疎結合にするための型付き内部イベントバス。
 */
// eslint-disable-next-line unicorn/prefer-event-target -- Node's EventEmitter API (on/emit/off/setMaxListeners) is required here; EventTarget lacks equivalent typed payload ergonomics.
class TypedGatewayBus extends EventEmitter {
  /**
   * イベントを発行する。
   * @param event - イベント名
   * @param payload - イベントペイロード
   * @returns リスナーが存在すれば true
   */
  emit<K extends keyof GatewayBusEvents>(
    event: K,
    payload: GatewayBusEvents[K]
  ): boolean {
    return super.emit(event, payload)
  }

  /**
   * イベントリスナーを登録する。
   * @param event - イベント名
   * @param listener - リスナー関数
   * @returns this
   */
  on<K extends keyof GatewayBusEvents>(
    event: K,
    listener: (payload: GatewayBusEvents[K]) => void
  ): this {
    return super.on(event, listener)
  }

  /**
   * イベントリスナーを解除する。
   * @param event - イベント名
   * @param listener - リスナー関数
   * @returns this
   */
  off<K extends keyof GatewayBusEvents>(
    event: K,
    listener: (payload: GatewayBusEvents[K]) => void
  ): this {
    return super.off(event, listener)
  }
}

/** アプリ全体で共有するシングルトンの Gateway 内部バス */
export const gatewayBus = new TypedGatewayBus()
// REST 層からの emit が多発してもリスナー数上限警告が出ないようにする
// (最大同時セッション数に応じて増やせる余地を持たせる)
gatewayBus.setMaxListeners(50)
