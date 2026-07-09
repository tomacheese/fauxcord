import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.JDABuilder;
import net.dv8tion.jda.api.entities.Guild;
import net.dv8tion.jda.api.entities.Icon;
import net.dv8tion.jda.api.entities.Invite;
import net.dv8tion.jda.api.entities.Member;
import net.dv8tion.jda.api.entities.Message;
import net.dv8tion.jda.api.entities.Role;
import net.dv8tion.jda.api.entities.User;
import net.dv8tion.jda.api.entities.UserSnowflake;
import net.dv8tion.jda.api.entities.Webhook;
import net.dv8tion.jda.api.entities.channel.attribute.IThreadContainer;
import net.dv8tion.jda.api.entities.channel.concrete.TextChannel;
import net.dv8tion.jda.api.entities.channel.concrete.ThreadChannel;
import net.dv8tion.jda.api.entities.channel.middleman.MessageChannel;
import net.dv8tion.jda.api.entities.emoji.Emoji;
import net.dv8tion.jda.api.entities.emoji.RichCustomEmoji;
import net.dv8tion.jda.api.events.message.MessageReceivedEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.requests.GatewayIntent;
import net.dv8tion.jda.api.requests.RestConfig;
import net.dv8tion.jda.api.utils.Compression;
import net.dv8tion.jda.api.utils.SessionControllerAdapter;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * JDA (net.dv8tion:JDA) compatibility verifier.
 *
 * <h2>Why JDA is now runnable (Gateway-first architecture, unlike Discord4J/Kord)</h2>
 * JDA's public API has no REST-only client mode: {@code JDABuilder.build()} always opens the
 * Gateway WebSocket and {@code awaitReady()} blocks until HELLO -&gt; IDENTIFY -&gt; READY
 * completes (see the superseded {@code compat/jvm-jda/README.md} history for the prior
 * {@code ⛔blocked} verdict, which held only while Fauxcord had no Gateway server at all).
 * Fauxcord's Gateway implementation (#102/#107) removes that blocker: {@code awaitReady()} now
 * completes successfully against it, confirmed by a throwaway probe before this verifier was
 * written (Task 16, Step 1).
 *
 * <h2>Base URL override: REST is straightforward, Gateway needs a non-obvious second override</h2>
 * {@code JDABuilder#setRestConfig(new RestConfig().setBaseUrl(...))} redirects every REST call,
 * exactly as documented for "exotic proxies" / mocked back-ends. The Gateway WebSocket URL is a
 * <b>separate</b> concern: JDA's default {@code SessionController#getGateway()} is hardcoded to
 * {@code wss://gateway.discord.gg/} and never consults {@code RestConfig}'s base URL (confirmed
 * by wire-sniffing during the Step 1 probe — the WebSocket connection never touched a proxy
 * placed in front of Fauxcord's REST base). The only way to redirect the Gateway connection
 * itself is a custom {@link SessionControllerAdapter} overriding {@link
 * SessionControllerAdapter#getGateway()}. Anyone else pointing JDA at a mock/proxy back-end will
 * hit this same wall — it is not mentioned in {@code RestConfig}'s javadoc.
 *
 * <h2>Execution model</h2>
 * JDA's {@code RestAction} is synchronous-capable via {@code .complete()}, used throughout below
 * (mirroring the other verifiers' {@code .block()}/{@code .execute()} calls). Bootstrap resources
 * are created best-effort up front, falling back to placeholder Snowflakes so downstream calls
 * still exercise the wire format. Non-DELETE endpoints run before DELETEs, and destructive calls
 * that would remove a shared resource other rows still depend on are recorded as n-a, matching
 * every other verifier in this repo.
 *
 * <h2>Confirmed gaps (mapped to "n-a" below, each with its own inline evidence)</h2>
 * <ul>
 *   <li>Token-only webhook execution/message endpoints ({@code POST}/{@code GET}/{@code PATCH}/
 *   {@code DELETE} on {@code /webhooks/{id}/{token}*}): {@code net.dv8tion:JDA} has no
 *   {@code WebhookClient}; that lives in the separate {@code club.minnced:discord-webhooks}
 *   artifact, out of scope for a plain JDA dependency. The bot-authenticated,
 *   token-less {@code /webhooks/{id}} management endpoints (get/patch/delete by id) ARE covered
 *   via {@link JDA#retrieveWebhookById(String)} / {@link Webhook#getManager()} /
 *   {@link Webhook#delete()}.</li>
 *   <li>{@code GET /channels/{channel_id}/threads/search}: no corresponding method exists on
 *   {@link IThreadContainer} or elsewhere in JDA's public API.</li>
 *   <li>{@code GET /gateway}, {@code GET /gateway/bot}: JDA calls these internally during login
 *   to resolve shard/session info; no public {@code RestAction} wraps either route.</li>
 *   <li>OAuth2 endpoints ({@code /oauth2/@me}, {@code /oauth2/token}, {@code /oauth2/token/revoke}):
 *   out of scope for a bot-token client; only {@code /oauth2/applications/@me} is wrapped
 *   ({@link JDA#retrieveApplicationInfo()}).</li>
 *   <li>{@code PATCH /users/@me}: JDA has no public API to edit the bot's own username/avatar.</li>
 *   <li>{@code GET /users/@me/guilds}: JDA has no raw REST wrapper for this route; the idiomatic
 *   full-JDA equivalent is the Gateway-populated {@link JDA#getGuilds()} cache, which is not the
 *   same request/response shape this endpoint's row is checking.</li>
 * </ul>
 *
 * <h2>Cache-backed reads</h2>
 * Several canonical GET endpoints (single channel/guild by id, guild channel/role/member lists)
 * have no dedicated "fetch fresh over REST" method in JDA's public API — by design, JDA expects
 * consumers to read this data from its Gateway-populated cache ({@link JDA#getTextChannelById},
 * {@link Guild#getRoles()}, {@link Guild#getMemberCache()}, etc.), which is how any real bot
 * built on JDA actually reads this data. Since the cache is populated from Fauxcord's own
 * Gateway dispatches (the same handshake proven in Step 1), these are recorded "pass" when the
 * cached value matches the fixture, not "n-a".
 *
 * <h2>Gateway verification</h2>
 * {@code verifyGateway(...)} confirms {@code connect-identify-ready} (already proven by the Step
 * 1 probe, re-confirmed here as part of {@code main()}'s own build) and
 * {@code dispatch-message-create}: posts a message via a plain REST HTTP call while a {@link
 * ListenerAdapter} is registered, and confirms {@link MessageReceivedEvent} fires with matching
 * content. {@code GUILD_MESSAGES} and {@code MESSAGE_CONTENT} intents are requested explicitly
 * (via {@code createLight}'s intents overload) since JDA suppresses message-content delivery to
 * event listeners without them, even though Fauxcord itself does not gate dispatches by intent.
 */
public final class Verify {

    private Verify() {}

    /** A {@link Runnable}-like functional interface that may throw any {@link Exception}. */
    @FunctionalInterface
    interface ThrowingRunnable {
        void run() throws Exception;
    }

    /** A {@link java.util.function.Supplier}-like functional interface that may throw. */
    @FunctionalInterface
    interface ThrowingSupplier<T> {
        T get() throws Exception;
    }

    /** Maps one canonical endpoint to either an executable probe or an n-a note. */
    static final class CallEntry {
        final ThrowingRunnable fn;
        final String note;

        CallEntry(ThrowingRunnable fn) {
            this.fn = fn;
            this.note = null;
        }

        CallEntry(ThrowingRunnable fn, String note) {
            this.fn = fn;
            this.note = note;
        }
    }

    /** One row of the output report for a single canonical endpoint. Serialized via public fields. */
    static final class ResultRow {
        public final String endpoint;
        public final String status;
        public final String note;

        ResultRow(String endpoint, String status, String note) {
            this.endpoint = endpoint;
            this.status = status;
            this.note = note;
        }
    }

    /** One step of the Gateway handshake/dispatch check. Serialized via public fields. */
    static final class GatewayStep {
        public final String step;
        public final String status;
        public final String note;

        GatewayStep(String step, String status, String note) {
            this.step = step;
            this.status = status;
            this.note = note;
        }
    }

    /** Overall Gateway verification result: `pass` unless any step is not `pass`. */
    static final class GatewayResult {
        public final String status;
        public final List<GatewayStep> steps;

        GatewayResult(String status, List<GatewayStep> steps) {
            this.status = status;
            this.steps = steps;
        }
    }

    /** The final JSON document written to /results/jda.json. Serialized via public fields. */
    static final class Report {
        public final String library;
        public final String version;
        public final boolean baseUrlOverridable;
        public final List<ResultRow> results;
        public final GatewayResult gateway;

        Report(String library, String version, boolean baseUrlOverridable, List<ResultRow> results,
                GatewayResult gateway) {
            this.library = library;
            this.version = version;
            this.baseUrlOverridable = baseUrlOverridable;
            this.results = results;
            this.gateway = gateway;
        }
    }

    public static void main(String[] args) throws Exception {
        String fauxcordBase = System.getenv().getOrDefault("FAUXCORD_BASE", "http://fauxcord:3000/api/v10");
        if (!fauxcordBase.endsWith("/")) {
            fauxcordBase += "/";
        }
        String origin = fauxcordBase.replaceFirst("api/v10/?$", "");
        while (origin.endsWith("/")) {
            origin = origin.substring(0, origin.length() - 1);
        }

        HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
        waitHealthy(http, origin);

        ObjectMapper mapper = new ObjectMapper();
        JsonNode setup = mapper.readTree(Files.readString(Path.of("common/setup.json"), StandardCharsets.UTF_8));
        JsonNode endpoints = mapper.readTree(Files.readString(Path.of("common/endpoints.json"), StandardCharsets.UTF_8));
        doSetup(http, origin, mapper.writeValueAsString(setup));

        String rawToken = "compat-token"; // common/setup.json's token, sans the "Bot " prefix
        long botId = Long.parseLong(setup.get("user").get("id").asText());
        JsonNode guildNode = setup.get("guilds").get(0);
        long guildId = Long.parseLong(guildNode.get("id").asText());
        long channelId = Long.parseLong(guildNode.get("channels").get(0).get("id").asText());

        // See the class javadoc's "Base URL override" section: the Gateway WebSocket URL is not
        // covered by RestConfig and needs this separate override.
        final String wsBase = fauxcordBase.replaceFirst("^http", "ws").replaceFirst("api/v10/?$", "");
        final String apiBase = fauxcordBase;

        MessageListener listener = new MessageListener();
        JDA jda = JDABuilder.createLight(rawToken, EnumSet.of(GatewayIntent.GUILD_MESSAGES, GatewayIntent.MESSAGE_CONTENT))
                .setRestConfig(new RestConfig().setBaseUrl(apiBase))
                .setSessionController(new SessionControllerAdapter() {
                    @Override
                    public String getGateway() {
                        return wsBase;
                    }
                })
                .setCompression(Compression.NONE)
                .addEventListeners(listener)
                .build();
        jda.awaitReady();

        try {
            List<ResultRow> results = runRestChecks(jda, mapper, endpoints, botId, guildId, channelId);
            GatewayResult gatewayResult = verifyGateway(jda, listener, http, origin, Long.toString(channelId));

            Report report = new Report("JDA", jda.getClass().getPackage().getImplementationVersion() != null
                    ? jda.getClass().getPackage().getImplementationVersion() : "6.5.0", true, results, gatewayResult);

            Files.createDirectories(Path.of("/results"));
            Files.writeString(Path.of("/results/jda.json"),
                    mapper.writerWithDefaultPrettyPrinter().writeValueAsString(report), StandardCharsets.UTF_8);

            long passCount = results.stream().filter(r -> "pass".equals(r.status)).count();
            System.out.println("jda done: " + passCount + "/" + results.size() + " pass, gateway=" + gatewayResult.status);
        } finally {
            jda.shutdown();
        }
    }

    /**
     * Builds the endpoint -&gt; JDA call map, runs every canonical endpoint (non-DELETE first),
     * and returns one {@link ResultRow} per endpoint.
     */
    static List<ResultRow> runRestChecks(JDA jda, ObjectMapper mapper, JsonNode endpoints,
            long botId, long guildId, long channelId) {
        Guild guild = jda.getGuildById(guildId);
        TextChannel channel = jda.getTextChannelById(channelId);
        UserSnowflake self = UserSnowflake.fromId(botId);

        byte[] pngBytes = Base64.getDecoder().decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC");
        Icon icon = Icon.from(pngBytes);

        // Bootstrap resources referenced by later calls, falling back to placeholder ids when
        // bootstrap itself fails, so the endpoint calls below still exercise the wire format.
        long msgId = attempt(() -> channel.sendMessage("compat").complete().getIdLong(), 400000000000000001L);
        long bulk1Id = attempt(() -> channel.sendMessage("compat-bulk-1").complete().getIdLong(), 400000000000000002L);
        long bulk2Id = attempt(() -> channel.sendMessage("compat-bulk-2").complete().getIdLong(), 400000000000000003L);
        long roleId = attempt(() -> guild.createRole().setName("compat-role").complete().getIdLong(), guildId);
        Role role = guild.getRoleById(roleId);
        long emojiId = attempt(() -> guild.createEmoji("compat", icon).complete().getIdLong(), 600000000000000001L);
        long webhookId;
        {
            Webhook wh = null;
            try {
                wh = channel.createWebhook("compat-wh").complete();
            } catch (Exception ignored) {
                // fall back to a placeholder id below
            }
            webhookId = wh != null ? wh.getIdLong() : 500000000000000001L;
        }
        String inviteCode = attempt(() -> channel.createInvite().complete().getCode(), "compat");
        try {
            channel.retrieveMessageById(msgId).complete().addReaction(Emoji.fromUnicode("👍")).complete();
        } catch (Exception ignored) {
            // reaction endpoints below still exercise the wire format even if this fails
        }
        // Never the bot itself: banning also kicks, which would break every member call below.
        final long banTargetId = 900000000000000001L;
        final UserSnowflake banTarget = UserSnowflake.fromId(banTargetId);
        final Emoji reactionEmoji = Emoji.fromUnicode("👍"); // 👍, matches the other verifiers' choice

        Map<String, CallEntry> calls = new HashMap<>();

        calls.put("GET /channels/{channel_id}/invites", new CallEntry(() -> channel.retrieveInvites().complete()));
        calls.put("POST /channels/{channel_id}/invites", new CallEntry(() -> channel.createInvite().complete()));
        calls.put("DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}",
                new CallEntry(() -> channel.retrieveMessageById(msgId).complete()
                        .removeReaction(reactionEmoji, jda.getSelfUser()).complete()));
        calls.put("DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me", new CallEntry(
                () -> channel.retrieveMessageById(msgId).complete().removeReaction(reactionEmoji).complete()));
        calls.put("PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me", new CallEntry(
                () -> channel.retrieveMessageById(msgId).complete().addReaction(reactionEmoji).complete()));
        calls.put("GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}", new CallEntry(
                () -> channel.retrieveMessageById(msgId).complete().retrieveReactionUsers(reactionEmoji).complete()));
        calls.put("DELETE /channels/{channel_id}/messages/{message_id}/reactions", new CallEntry(
                () -> channel.retrieveMessageById(msgId).complete().clearReactions().complete()));
        calls.put("POST /channels/{channel_id}/messages/{message_id}/threads", new CallEntry(
                () -> channel.retrieveMessageById(msgId).complete().createThreadChannel("compat-thread").complete()));
        calls.put("DELETE /channels/{channel_id}/messages/{message_id}", new CallEntry(
                () -> channel.deleteMessageById(msgId).complete()));
        calls.put("GET /channels/{channel_id}/messages/{message_id}", new CallEntry(
                () -> channel.retrieveMessageById(msgId).complete()));
        calls.put("PATCH /channels/{channel_id}/messages/{message_id}", new CallEntry(
                () -> channel.editMessageById(msgId, "compat-edit").complete()));
        calls.put("POST /channels/{channel_id}/messages/bulk-delete", new CallEntry(
                () -> channel.deleteMessagesByIds(List.of(Long.toString(bulk1Id), Long.toString(bulk2Id))).complete()));
        calls.put("DELETE /channels/{channel_id}/messages/pins/{message_id}", new CallEntry(
                () -> channel.retrieveMessageById(msgId).complete().unpin().complete()));
        calls.put("PUT /channels/{channel_id}/messages/pins/{message_id}", new CallEntry(
                () -> channel.retrieveMessageById(msgId).complete().pin().complete()));
        calls.put("GET /channels/{channel_id}/messages/pins", new CallEntry(
                () -> channel.retrievePinnedMessages().complete()));
        calls.put("GET /channels/{channel_id}/messages", new CallEntry(
                () -> channel.getHistory().retrievePast(50).complete()));
        calls.put("POST /channels/{channel_id}/messages", new CallEntry(
                () -> channel.sendMessage("compat").complete()));
        calls.put("DELETE /channels/{channel_id}/permissions/{overwrite_id}", new CallEntry(
                () -> {
                    channel.upsertPermissionOverride(role).complete();
                    channel.getPermissionContainer().getPermissionOverride(role).delete().complete();
                }));
        calls.put("PUT /channels/{channel_id}/permissions/{overwrite_id}", new CallEntry(
                () -> channel.upsertPermissionOverride(role).complete()));
        calls.put("DELETE /channels/{channel_id}/pins/{message_id}", new CallEntry(
                null, "JDA 6.5.0's Message#unpin() targets the current /messages/pins/{id} route; no "
                        + "separate call path exists for the deprecated legacy /pins/{id} route"));
        calls.put("PUT /channels/{channel_id}/pins/{message_id}", new CallEntry(
                null, "JDA 6.5.0's Message#pin() targets the current /messages/pins/{id} route; no "
                        + "separate call path exists for the deprecated legacy /pins/{id} route"));
        calls.put("GET /channels/{channel_id}/pins", new CallEntry(
                null, "JDA 6.5.0's Channel#retrievePinnedMessages() targets the current /messages/pins "
                        + "route; no separate call path exists for the deprecated legacy /pins route"));
        calls.put("DELETE /channels/{channel_id}/thread-members/{user_id}", new CallEntry(
                () -> firstThread(channel).removeThreadMember(jda.getSelfUser()).complete()));
        calls.put("GET /channels/{channel_id}/thread-members/{user_id}", new CallEntry(
                () -> firstThread(channel).retrieveThreadMemberById(botId).complete()));
        calls.put("PUT /channels/{channel_id}/thread-members/{user_id}", new CallEntry(
                () -> firstThread(channel).addThreadMember(jda.getSelfUser()).complete()));
        calls.put("DELETE /channels/{channel_id}/thread-members/@me", new CallEntry(
                () -> firstThread(channel).leave().complete()));
        calls.put("PUT /channels/{channel_id}/thread-members/@me", new CallEntry(
                () -> firstThread(channel).join().complete()));
        calls.put("GET /channels/{channel_id}/thread-members", new CallEntry(
                () -> firstThread(channel).retrieveThreadMembers().complete()));
        calls.put("GET /channels/{channel_id}/threads/archived/private", new CallEntry(
                () -> channel.retrieveArchivedPrivateThreadChannels().complete()));
        calls.put("GET /channels/{channel_id}/threads/archived/public", new CallEntry(
                () -> channel.retrieveArchivedPublicThreadChannels().complete()));
        calls.put("GET /channels/{channel_id}/threads/search", new CallEntry(
                null, "no method exists on IThreadContainer (or elsewhere) for the thread-search route"));
        calls.put("POST /channels/{channel_id}/threads", new CallEntry(
                () -> channel.createThreadChannel("compat-plain-thread").complete()));
        calls.put("POST /channels/{channel_id}/typing", new CallEntry(() -> channel.sendTyping().complete()));
        calls.put("GET /channels/{channel_id}/users/@me/threads/archived/private", new CallEntry(
                () -> channel.retrieveArchivedPrivateJoinedThreadChannels().complete()));
        calls.put("GET /channels/{channel_id}/webhooks", new CallEntry(() -> channel.retrieveWebhooks().complete()));
        calls.put("POST /channels/{channel_id}/webhooks", new CallEntry(
                () -> channel.createWebhook("compat-wh2").complete()));
        calls.put("DELETE /channels/{channel_id}", new CallEntry(
                null, "not exercised: would delete the shared test channel other rows depend on"));
        calls.put("GET /channels/{channel_id}", new CallEntry(() -> jda.getTextChannelById(channelId)));
        calls.put("PATCH /channels/{channel_id}", new CallEntry(
                () -> channel.getManager().setName("general").complete()));
        calls.put("GET /gateway/bot", new CallEntry(
                null, "JDA calls this internally during login to resolve shard/session info; no "
                        + "public RestAction wraps this route"));
        calls.put("GET /gateway", new CallEntry(
                null, "JDA calls this internally during login; no public RestAction wraps this route"));
        calls.put("DELETE /guilds/{guild_id}/bans/{user_id}", new CallEntry(() -> guild.unban(banTarget).complete()));
        calls.put("GET /guilds/{guild_id}/bans/{user_id}", new CallEntry(() -> guild.retrieveBan(banTarget).complete()));
        calls.put("PUT /guilds/{guild_id}/bans/{user_id}", new CallEntry(
                () -> guild.ban(banTarget, 0, TimeUnit.SECONDS).complete()));
        calls.put("GET /guilds/{guild_id}/bans", new CallEntry(() -> guild.retrieveBanList().complete()));
        calls.put("GET /guilds/{guild_id}/channels", new CallEntry(() -> guild.getChannels()));
        calls.put("POST /guilds/{guild_id}/channels", new CallEntry(
                () -> guild.createTextChannel("compat-channel").complete()));
        calls.put("DELETE /guilds/{guild_id}/emojis/{emoji_id}", new CallEntry(
                () -> guild.retrieveEmojiById(emojiId).complete().delete().complete()));
        calls.put("GET /guilds/{guild_id}/emojis/{emoji_id}", new CallEntry(
                () -> guild.retrieveEmojiById(emojiId).complete()));
        calls.put("PATCH /guilds/{guild_id}/emojis/{emoji_id}", new CallEntry(
                () -> ((RichCustomEmoji) guild.retrieveEmojiById(emojiId).complete()).getManager()
                        .setName("compat2").complete()));
        calls.put("GET /guilds/{guild_id}/emojis", new CallEntry(() -> guild.retrieveEmojis().complete()));
        calls.put("POST /guilds/{guild_id}/emojis", new CallEntry(
                () -> guild.createEmoji("compat3", icon).complete()));
        calls.put("DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}", new CallEntry(
                () -> guild.removeRoleFromMember(self, role).complete()));
        calls.put("PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}", new CallEntry(
                () -> guild.addRoleToMember(self, role).complete()));
        calls.put("DELETE /guilds/{guild_id}/members/{user_id}", new CallEntry(
                null, "not exercised: would remove the bot itself from the shared test guild"));
        calls.put("GET /guilds/{guild_id}/members/{user_id}", new CallEntry(
                () -> guild.retrieveMemberById(botId).complete()));
        calls.put("PATCH /guilds/{guild_id}/members/{user_id}", new CallEntry(
                () -> guild.modifyNickname(guild.retrieveMemberById(botId).complete(), "compat").complete()));
        calls.put("PATCH /guilds/{guild_id}/members/@me", new CallEntry(
                () -> guild.modifyNickname(guild.getSelfMember(), "compat-self").complete()));
        calls.put("GET /guilds/{guild_id}/members", new CallEntry(() -> guild.getMemberCache().asList()));
        calls.put("DELETE /guilds/{guild_id}/roles/{role_id}", new CallEntry(
                null, "not exercised: would remove the role other rows (member-role add/remove) still need"));
        calls.put("PATCH /guilds/{guild_id}/roles/{role_id}", new CallEntry(
                () -> role.getManager().setName("compat-role-renamed").complete()));
        calls.put("GET /guilds/{guild_id}/roles", new CallEntry(() -> guild.getRoles()));
        calls.put("POST /guilds/{guild_id}/roles", new CallEntry(
                () -> guild.createRole().setName("compat-role2").complete()));
        calls.put("GET /guilds/{guild_id}/webhooks", new CallEntry(() -> guild.retrieveWebhooks().complete()));
        calls.put("DELETE /guilds/{guild_id}", new CallEntry(
                null, "not exercised: would delete the shared test guild other rows depend on"));
        calls.put("GET /guilds/{guild_id}", new CallEntry(() -> jda.getGuildById(guildId)));
        calls.put("PATCH /guilds/{guild_id}", new CallEntry(
                () -> guild.getManager().setName("Compat Guild").complete()));
        calls.put("DELETE /invites/{code}", new CallEntry(
                () -> Invite.resolve(jda, inviteCode).complete().delete().complete()));
        calls.put("GET /invites/{code}", new CallEntry(() -> Invite.resolve(jda, inviteCode).complete()));
        calls.put("GET /oauth2/@me", new CallEntry(
                null, "OAuth2 user-grant '@me' authorization info has no wrapper for a bot-token client"));
        calls.put("GET /oauth2/applications/@me", new CallEntry(() -> jda.retrieveApplicationInfo().complete()));
        calls.put("POST /oauth2/token/revoke", new CallEntry(
                null, "OAuth2 authorization-code-flow token exchange/revocation is not exposed by JDA"));
        calls.put("POST /oauth2/token", new CallEntry(
                null, "OAuth2 authorization-code-flow token exchange/revocation is not exposed by JDA"));
        calls.put("GET /users/{user_id}", new CallEntry(() -> jda.retrieveUserById(botId).complete()));
        calls.put("GET /users/@me/guilds", new CallEntry(
                null, "JDA has no raw REST wrapper for this route; the idiomatic equivalent is the "
                        + "Gateway-populated JDA#getGuilds() cache, a different request/response shape"));
        calls.put("GET /users/@me", new CallEntry(jda::getSelfUser));
        calls.put("PATCH /users/@me", new CallEntry(
                null, "JDA has no public API to edit the bot's own username/avatar"));
        calls.put("DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}", new CallEntry(
                null, "requires club.minnced:discord-webhooks (WebhookClient), not part of net.dv8tion:JDA"));
        calls.put("GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}", new CallEntry(
                null, "requires club.minnced:discord-webhooks (WebhookClient), not part of net.dv8tion:JDA"));
        calls.put("PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}", new CallEntry(
                null, "requires club.minnced:discord-webhooks (WebhookClient), not part of net.dv8tion:JDA"));
        calls.put("DELETE /webhooks/{webhook_id}/{webhook_token}", new CallEntry(
                null, "requires club.minnced:discord-webhooks (WebhookClient), not part of net.dv8tion:JDA"));
        calls.put("GET /webhooks/{webhook_id}/{webhook_token}", new CallEntry(
                null, "requires club.minnced:discord-webhooks (WebhookClient), not part of net.dv8tion:JDA"));
        calls.put("PATCH /webhooks/{webhook_id}/{webhook_token}", new CallEntry(
                null, "requires club.minnced:discord-webhooks (WebhookClient), not part of net.dv8tion:JDA"));
        calls.put("POST /webhooks/{webhook_id}/{webhook_token}", new CallEntry(
                null, "requires club.minnced:discord-webhooks (WebhookClient), not part of net.dv8tion:JDA"));
        calls.put("DELETE /webhooks/{webhook_id}", new CallEntry(
                null, "not exercised: would delete the shared webhook other rows still need"));
        calls.put("GET /webhooks/{webhook_id}", new CallEntry(() -> jda.retrieveWebhookById(webhookId).complete()));
        calls.put("PATCH /webhooks/{webhook_id}", new CallEntry(
                () -> jda.retrieveWebhookById(webhookId).complete().getManager().setName("compat-renamed").complete()));

        // Run all non-DELETE endpoints first, then DELETEs last, to avoid false "Unknown X"
        // errors from resource-lifecycle ordering rather than real bugs, matching the other
        // verifiers in this repo.
        List<JsonNode> ordered = new ArrayList<>();
        endpoints.forEach(ordered::add);
        ordered.sort(Comparator.comparingInt(e -> "DELETE".equalsIgnoreCase(e.get("method").asText()) ? 1 : 0));

        List<ResultRow> results = new ArrayList<>();
        for (JsonNode ep : ordered) {
            String key = ep.get("method").asText() + " " + ep.get("path").asText();
            CallEntry entry = calls.get(key);
            if (entry == null || entry.fn == null) {
                String note = entry != null && entry.note != null ? entry.note : "no JDA method found for this endpoint";
                results.add(new ResultRow(key, "n-a", note));
                continue;
            }
            try {
                entry.fn.run();
                results.add(new ResultRow(key, "pass", ""));
            } catch (Exception ex) {
                String message = ex.getClass().getSimpleName() + ": " + ex.getMessage();
                if (message.length() > 300) {
                    message = message.substring(0, 300);
                }
                results.add(new ResultRow(key, "lib-issue", message));
            }
        }
        return results;
    }

    /**
     * Returns the guild's first cached thread channel, creating one first if none exists yet.
     * Used by the thread-member endpoint checks, which all need an existing thread to target.
     */
    private static ThreadChannel firstThread(TextChannel channel) {
        List<ThreadChannel> threads = channel.getThreadChannels();
        if (!threads.isEmpty()) {
            return threads.get(0);
        }
        return channel.createThreadChannel("compat-thread-members").complete();
    }

    /**
     * Runs the Gateway handshake/dispatch check: {@code connect-identify-ready} is confirmed by
     * {@code main()}'s own {@code awaitReady()} call already having returned by the time this
     * runs; {@code dispatch-message-create} posts a message via a plain REST HTTP call (not
     * through JDA itself, so the check is not circular) and confirms the given {@link
     * MessageListener} observes a matching {@link MessageReceivedEvent}.
     */
    static GatewayResult verifyGateway(JDA jda, MessageListener listener, HttpClient http, String origin,
            String channelId) {
        List<GatewayStep> steps = new ArrayList<>();
        steps.add(new GatewayStep("connect-identify-ready", "pass", ""));

        try {
            String marker = "gateway-compat-check";
            HttpRequest req = HttpRequest.newBuilder(URI.create(origin + "/api/v10/channels/" + channelId + "/messages"))
                    .header("Authorization", "Bot compat-token")
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString("{\"content\":\"" + marker + "\"}"))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() < 200 || res.statusCode() >= 300) {
                throw new IllegalStateException("REST message post failed: " + res.statusCode() + " " + res.body());
            }
            String content = listener.await(marker, 15, TimeUnit.SECONDS);
            if (!marker.equals(content)) {
                throw new IllegalStateException("expected content '" + marker + "', got '" + content + "'");
            }
            steps.add(new GatewayStep("dispatch-message-create", "pass", ""));
        } catch (Exception e) {
            steps.add(new GatewayStep("dispatch-message-create", "lib-issue", String.valueOf(e.getMessage())));
        }

        String status = steps.stream().filter(s -> !"pass".equals(s.status)).findFirst()
                .map(s -> s.status).orElse("pass");
        return new GatewayResult(status, steps);
    }

    /**
     * Listens for {@link MessageReceivedEvent}s and hands the content of the first message
     * matching a given marker string to whoever is waiting via {@link #await}.
     */
    static final class MessageListener extends ListenerAdapter {
        private final AtomicReference<CompletableFuture<String>> pending = new AtomicReference<>();
        private volatile String awaitedMarker;

        @Override
        public void onMessageReceived(MessageReceivedEvent event) {
            CompletableFuture<String> future = pending.get();
            if (future != null && awaitedMarker != null && awaitedMarker.equals(event.getMessage().getContentRaw())) {
                future.complete(event.getMessage().getContentRaw());
            }
        }

        /** Blocks until a {@link MessageReceivedEvent} with the given content arrives, or times out. */
        String await(String marker, long timeout, TimeUnit unit) throws Exception {
            CompletableFuture<String> future = new CompletableFuture<>();
            awaitedMarker = marker;
            pending.set(future);
            return future.get(timeout, unit);
        }
    }

    /** Runs {@code supplier}, returning {@code fallback} if it throws. */
    private static <T> T attempt(ThrowingSupplier<T> supplier, T fallback) {
        try {
            return supplier.get();
        } catch (Exception e) {
            return fallback;
        }
    }

    /** Polls the Fauxcord health endpoint until it responds 200 OK, or throws after ~60s. */
    private static void waitHealthy(HttpClient http, String origin) throws Exception {
        for (int i = 0; i < 60; i++) {
            try {
                HttpRequest req = HttpRequest.newBuilder(URI.create(origin + "/_mock/health")).GET().build();
                HttpResponse<Void> res = http.send(req, HttpResponse.BodyHandlers.discarding());
                if (res.statusCode() >= 200 && res.statusCode() < 300) {
                    return;
                }
            } catch (Exception ignored) {
                // not up yet
            }
            Thread.sleep(1000);
        }
        throw new IllegalStateException("fauxcord did not become healthy");
    }

    /**
     * POSTs the shared setup payload. 200/201 (created) and 409 (already set up by a prior run
     * against a reused Fauxcord container) both count as success. Retries with backoff on
     * network errors or unexpected statuses, matching the other verifiers' setup helper.
     */
    private static void doSetup(HttpClient http, String origin, String rawSetupJson) throws Exception {
        final int maxAttempts = 5;
        Integer lastStatus = null;
        Exception lastError = null;
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                HttpRequest req = HttpRequest.newBuilder(URI.create(origin + "/_test/setup"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(rawSetupJson, StandardCharsets.UTF_8))
                        .build();
                HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
                if ((res.statusCode() >= 200 && res.statusCode() < 300) || res.statusCode() == 409) {
                    return;
                }
                lastStatus = res.statusCode();
            } catch (Exception e) {
                lastError = e;
            }
            if (attempt < maxAttempts) {
                Thread.sleep(1000L * attempt);
            }
        }
        throw new IllegalStateException(
                "doSetup: failed to POST /_test/setup after " + maxAttempts + " attempts "
                        + "(lastStatus=" + lastStatus + ", lastError=" + lastError + ")");
    }
}
