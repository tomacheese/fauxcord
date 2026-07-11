import { GatewayIntentBits } from 'discord-api-types/v10'
import { gatewayBus } from './bus'
import { broadcastToAll } from './dispatch'
import type { SessionManager } from './session'

/**
 * Subscribes to resource-change events on gatewayBus and registers listeners
 * that forward them as Dispatch events to connected Gateway sessions.
 * @param manager - Session manager
 * @returns A function that unregisters all registered listeners (mainly for
 * tests)
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
      // Real Discord's MESSAGE_CREATE dispatch adds `guild_id` and the
      // author's `member` object on top of the base Message object for
      // guild channels; libraries (e.g. JDA) rely on both to route the
      // event and build the message's author Member.
      {
        ...payload.message,
        ...(payload.guildId && { guild_id: payload.guildId }),
        ...(payload.member && { member: payload.member }),
      },
      GatewayIntentBits.GuildMessages
    )
  }
  const onMessageUpdate: Parameters<
    typeof gatewayBus.on<'message.update'>
  >[1] = (payload) => {
    broadcastToAll(
      manager,
      'MESSAGE_UPDATE',
      {
        ...payload.message,
        ...(payload.guildId && { guild_id: payload.guildId }),
        ...(payload.member && { member: payload.member }),
      },
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
  const onGuildCreate: Parameters<typeof gatewayBus.on<'guild.create'>>[1] = (
    payload
  ) => {
    broadcastToAll(
      manager,
      'GUILD_CREATE',
      payload.guild,
      GatewayIntentBits.Guilds
    )
  }
  const onChannelCreate: Parameters<
    typeof gatewayBus.on<'channel.create'>
  >[1] = (payload) => {
    broadcastToAll(
      manager,
      'CHANNEL_CREATE',
      payload.channel,
      GatewayIntentBits.Guilds
    )
  }
  const onChannelUpdate: Parameters<
    typeof gatewayBus.on<'channel.update'>
  >[1] = (payload) => {
    broadcastToAll(
      manager,
      'CHANNEL_UPDATE',
      payload.channel,
      GatewayIntentBits.Guilds
    )
  }
  const onChannelDelete: Parameters<
    typeof gatewayBus.on<'channel.delete'>
  >[1] = (payload) => {
    broadcastToAll(
      manager,
      'CHANNEL_DELETE',
      payload.channel,
      GatewayIntentBits.Guilds
    )
  }
  const onGuildMemberAdd: Parameters<
    typeof gatewayBus.on<'guild.member.add'>
  >[1] = (payload) => {
    broadcastToAll(
      manager,
      'GUILD_MEMBER_ADD',
      { ...payload.member, guild_id: payload.guildId },
      GatewayIntentBits.GuildMembers
    )
  }
  const onGuildMemberUpdate: Parameters<
    typeof gatewayBus.on<'guild.member.update'>
  >[1] = (payload) => {
    broadcastToAll(
      manager,
      'GUILD_MEMBER_UPDATE',
      { ...payload.member, guild_id: payload.guildId },
      GatewayIntentBits.GuildMembers
    )
  }
  const onGuildMemberRemove: Parameters<
    typeof gatewayBus.on<'guild.member.remove'>
  >[1] = (payload) => {
    broadcastToAll(
      manager,
      'GUILD_MEMBER_REMOVE',
      { guild_id: payload.guildId, user: payload.user },
      GatewayIntentBits.GuildMembers
    )
  }
  const onGuildRoleCreate: Parameters<
    typeof gatewayBus.on<'guild.role.create'>
  >[1] = (payload) => {
    broadcastToAll(
      manager,
      'GUILD_ROLE_CREATE',
      { guild_id: payload.guildId, role: payload.role },
      GatewayIntentBits.Guilds
    )
  }
  const onGuildRoleUpdate: Parameters<
    typeof gatewayBus.on<'guild.role.update'>
  >[1] = (payload) => {
    broadcastToAll(
      manager,
      'GUILD_ROLE_UPDATE',
      { guild_id: payload.guildId, role: payload.role },
      GatewayIntentBits.Guilds
    )
  }
  const onGuildRoleDelete: Parameters<
    typeof gatewayBus.on<'guild.role.delete'>
  >[1] = (payload) => {
    broadcastToAll(
      manager,
      'GUILD_ROLE_DELETE',
      { guild_id: payload.guildId, role_id: payload.roleId },
      GatewayIntentBits.Guilds
    )
  }

  gatewayBus.on('message.create', onMessageCreate)
  gatewayBus.on('message.update', onMessageUpdate)
  gatewayBus.on('message.delete', onMessageDelete)
  gatewayBus.on('message.reaction.add', onReactionAdd)
  gatewayBus.on('message.reaction.remove', onReactionRemove)
  gatewayBus.on('guild.create', onGuildCreate)
  gatewayBus.on('channel.create', onChannelCreate)
  gatewayBus.on('channel.update', onChannelUpdate)
  gatewayBus.on('channel.delete', onChannelDelete)
  gatewayBus.on('guild.member.add', onGuildMemberAdd)
  gatewayBus.on('guild.member.update', onGuildMemberUpdate)
  gatewayBus.on('guild.member.remove', onGuildMemberRemove)
  gatewayBus.on('guild.role.create', onGuildRoleCreate)
  gatewayBus.on('guild.role.update', onGuildRoleUpdate)
  gatewayBus.on('guild.role.delete', onGuildRoleDelete)

  return () => {
    gatewayBus.off('message.create', onMessageCreate)
    gatewayBus.off('message.update', onMessageUpdate)
    gatewayBus.off('message.delete', onMessageDelete)
    gatewayBus.off('message.reaction.add', onReactionAdd)
    gatewayBus.off('message.reaction.remove', onReactionRemove)
    gatewayBus.off('guild.create', onGuildCreate)
    gatewayBus.off('channel.create', onChannelCreate)
    gatewayBus.off('channel.update', onChannelUpdate)
    gatewayBus.off('channel.delete', onChannelDelete)
    gatewayBus.off('guild.member.add', onGuildMemberAdd)
    gatewayBus.off('guild.member.update', onGuildMemberUpdate)
    gatewayBus.off('guild.member.remove', onGuildMemberRemove)
    gatewayBus.off('guild.role.create', onGuildRoleCreate)
    gatewayBus.off('guild.role.update', onGuildRoleUpdate)
    gatewayBus.off('guild.role.delete', onGuildRoleDelete)
  }
}
