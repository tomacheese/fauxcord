import { GatewayIntentBits } from 'discord-api-types/v10'
import { gatewayBus } from './bus'
import { broadcastToAll } from './dispatch'
import type { SessionManager } from './session'

/**
 * gatewayBus のリソース変更イベントを購読し、接続中の Gateway セッションへ
 * Dispatch イベントとして配信するリスナーを登録する。
 * @param manager - セッションマネージャ
 * @returns 登録した全リスナーを解除する関数（主にテスト用）
 */
export function registerGatewaySubscriptions(
  manager: SessionManager
): () => void {
  const onMessageCreate: Parameters<
    typeof gatewayBus.on<'message.create'>
  >[1] = (payload) => {
    broadcastToAll(
      manager,
      'MESSAGE_CREATE',
      payload.message,
      GatewayIntentBits.GuildMessages
    )
  }
  const onMessageUpdate: Parameters<
    typeof gatewayBus.on<'message.update'>
  >[1] = (payload) => {
    broadcastToAll(
      manager,
      'MESSAGE_UPDATE',
      payload.message,
      GatewayIntentBits.GuildMessages
    )
  }
  const onMessageDelete: Parameters<
    typeof gatewayBus.on<'message.delete'>
  >[1] = (payload) => {
    broadcastToAll(
      manager,
      'MESSAGE_DELETE',
      {
        id: payload.messageId,
        channel_id: payload.channelId,
        guild_id: payload.guildId,
      },
      GatewayIntentBits.GuildMessages
    )
  }
  const onReactionAdd: Parameters<
    typeof gatewayBus.on<'message.reaction.add'>
  >[1] = (payload) => {
    broadcastToAll(
      manager,
      'MESSAGE_REACTION_ADD',
      {
        user_id: payload.userId,
        channel_id: payload.channelId,
        message_id: payload.messageId,
        guild_id: payload.guildId,
        emoji: payload.emoji,
      },
      GatewayIntentBits.GuildMessageReactions
    )
  }
  const onReactionRemove: Parameters<
    typeof gatewayBus.on<'message.reaction.remove'>
  >[1] = (payload) => {
    broadcastToAll(
      manager,
      'MESSAGE_REACTION_REMOVE',
      {
        user_id: payload.userId,
        channel_id: payload.channelId,
        message_id: payload.messageId,
        guild_id: payload.guildId,
        emoji: payload.emoji,
      },
      GatewayIntentBits.GuildMessageReactions
    )
  }

  gatewayBus.on('message.create', onMessageCreate)
  gatewayBus.on('message.update', onMessageUpdate)
  gatewayBus.on('message.delete', onMessageDelete)
  gatewayBus.on('message.reaction.add', onReactionAdd)
  gatewayBus.on('message.reaction.remove', onReactionRemove)

  return () => {
    gatewayBus.off('message.create', onMessageCreate)
    gatewayBus.off('message.update', onMessageUpdate)
    gatewayBus.off('message.delete', onMessageDelete)
    gatewayBus.off('message.reaction.add', onReactionAdd)
    gatewayBus.off('message.reaction.remove', onReactionRemove)
  }
}
