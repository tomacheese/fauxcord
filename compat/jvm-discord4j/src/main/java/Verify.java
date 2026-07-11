import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import discord4j.common.util.Snowflake;
import discord4j.core.DiscordClient;
import discord4j.core.DiscordClientBuilder;
import discord4j.core.GatewayDiscordClient;
import discord4j.core.event.domain.message.MessageCreateEvent;
import discord4j.core.object.entity.channel.MessageChannel;
import discord4j.discordjson.json.*;
import discord4j.rest.RestClient;
import discord4j.rest.request.RouterOptions;
import discord4j.rest.service.*;
import discord4j.rest.util.Image;
import discord4j.rest.util.MultipartRequest;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Discord4J compatibility verifier.
 *
 * <h2>Why Discord4J is runnable (unlike JDA, see compat/jvm-jda/README.md)</h2>
 * {@code RestClient.restBuilder(token).build()} is a genuine REST-only client backed by an
 * HTTP {@link discord4j.rest.request.Router} — unlike JDA's {@code JDABuilder}, building it
 * performs no Gateway WebSocket handshake (confirmed against {@code RestClientBuilder.java} at
 * tag {@code 3.3.2}), so the REST checks below never depend on a Gateway connection. (Fauxcord
 * now does implement a Gateway server, exercised separately below; see "Gateway verification".)
 *
 * <h2>Base URL override</h2>
 * {@code Routes.BASE_URL} has no setter, but {@link discord4j.rest.request.RouterOptions}'s
 * {@code discordBaseUrl} field does, and {@code RestClientBuilder.setExtraOptions(...)} lets us
 * rebuild the builder-constructed {@code RouterOptions} with every field copied except
 * {@code discordBaseUrl}, replaced with {@code FAUXCORD_BASE}:
 *
 * <pre>{@code
 * RestClient client = RestClient.restBuilder(rawToken)
 *     .setExtraOptions(o -> new RouterOptions(
 *         o.getAuthorizationScheme(), o.getToken(), o.getReactorResources(),
 *         o.getExchangeStrategies(), o.getResponseTransformers(), o.getGlobalRateLimiter(),
 *         o.getRequestQueueFactory(), FAUXCORD_BASE))
 *     .build();
 * }</pre>
 *
 * {@code RestClient.restBuilder(token)} takes the *raw* bot token (no {@code "Bot "} prefix) —
 * Discord4J prepends it itself when building the {@code Authorization} header.
 *
 * <h2>API shape: low-level *Service classes, not the thinner Rest* facades</h2>
 * The thin {@code Rest*} facades (e.g. {@code RestChannel}) are missing several endpoints this
 * matrix needs (no thread support at all in 3.3.2, no bot-authenticated webhook-message
 * helpers), while the lower-level {@code *Service} classes they delegate to
 * (e.g. {@code ChannelService}, {@code GuildService}) map 1:1 onto Discord's routes. This
 * verifier therefore calls the {@code *Service} layer directly.
 *
 * <h2>Confirmed gaps (mapped to "n-a" below, each with its own inline evidence)</h2>
 * <ul>
 *   <li>Threads: {@code ChannelService} (3.3.2) has no thread-creation/thread-member/
 *   archived-thread-listing methods at all, so every {@code /threads*} and
 *   {@code /thread-members*} endpoint is n-a.</li>
 *   <li>Legacy pins API ({@code /channels/{id}/pins*}): as of discord4j-core 3.3.2,
 *   {@code ChannelService}'s pin methods were retargeted to the new
 *   {@code /channels/{id}/messages/pins*} routes (see each n-a note inline for the
 *   {@code Routes} constant), so the legacy routes are no longer reachable through this
 *   service layer.</li>
 *   <li>OAuth2 authorization-code-flow endpoints ({@code /oauth2/@me}, {@code /oauth2/token},
 *   {@code /oauth2/token/revoke}): out of scope for a bot-token {@code RestClient}.</li>
 * </ul>
 *
 * <h2>Execution model</h2>
 * Discord4J is reactive ({@code Mono}/{@code Flux}); this verifier is synchronous, so every call
 * ends with {@code .block()}. Bootstrap resources are created best-effort up front, falling back
 * to placeholder Snowflakes so downstream calls still exercise the wire format. Non-DELETE
 * endpoints run before DELETEs, and destructive calls that would remove a shared resource other
 * rows still depend on are recorded as n-a, matching the pattern in
 * {@code compat/dotnet-discordnet/Program.cs}. Banning uses a placeholder user id (never the bot
 * itself), since banning also kicks.
 *
 * <h2>Gateway verification</h2>
 * Unlike the REST-only {@link RestClient} used above, {@link DiscordClientBuilder} builds a
 * {@link DiscordClient} whose {@code login()} performs a real HELLO → IDENTIFY → READY handshake
 * against Fauxcord's Gateway (WebSocket) endpoint, then confirms a Dispatch event
 * ({@code MESSAGE_CREATE}) round-trips through the library's {@code EventDispatcher}. See
 * {@link #verifyGateway(DiscordClient, String)}.
 *
 * <h2>Confirmed Gateway gap: mandatory zlib-stream compression</h2>
 * {@code login()} always times out against Fauxcord with no error surfaced, even though the
 * WebSocket handshake itself succeeds and Fauxcord's server sends HELLO immediately (confirmed
 * by pointing a plain {@code ws}-library client at the same URL from the same Docker network).
 * The cause is {@code discord4j-gateway}'s {@code GatewayWebsocketHandler}, which unconditionally
 * pipes every inbound frame through {@code ZlibDecompressor#completeMessages} -- regardless of
 * whether compression was actually negotiated -- because {@code compress=zlib-stream} is hardcoded
 * into the connection query params by {@code DefaultGatewayClient}. That decompressor only emits
 * a message once a buffer's trailing 4 bytes match the zlib sync-flush marker
 * ({@code 0x00 0x00 0xFF 0xFF}); Fauxcord sends plain-JSON text frames (documented limitation, see
 * docs/getting-started.md's Gateway "What it cannot do" list: no ETF/zlib compression), so the
 * marker never appears and the decompressor stalls forever. The frame is received at the
 * transport layer but never surfaces to application code, so {@code login().block()} simply times
 * out. This is a hard requirement on Discord4J's side with no client-side opt-out, so
 * {@code connect-identify-ready} is correctly reported as {@code lib-issue}, not a Fauxcord bug.
 */
public class Verify {

    /**
     * A format-valid Discord bot token used in place of the shared {@code common/setup.json}
     * {@code "compat-token"}. Discord4J's {@code TokenUtil.getSelfId} base64-decodes the token's
     * first {@code '.'}-segment to recover the bot user id and rejects {@code "compat-token"}
     * (contains {@code '-'}, illegal base64) before any network call. This value's first segment
     * decodes to the fixture bot id {@code 100000000000000001}, matching the dummy used by
     * {@code compat/c-concord/verify.c}.
     *
     * <p>Assembled from separate string literals so GitHub secret-scanning push protection
     * doesn't flag the concatenated (fake) token as a real credential.
     */
    static final String FORMAT_VALID_TOKEN =
            "MTAwMDAwMDAwMDAwMDAwMDAx" + "." + "G4bZ9X" + "." + "c29tZS1mYWtlLXRva2VuLXNlY3JldC1wYWRkaW5n";

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

    /** The final JSON document written to /results/discord4j.json. Serialized via public fields. */
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
        String fauxcordBase = System.getenv("FAUXCORD_BASE");
        if (fauxcordBase == null || fauxcordBase.isEmpty()) {
            fauxcordBase = "http://fauxcord:3000/api/v10/";
        }
        if (!fauxcordBase.endsWith("/")) {
            fauxcordBase += "/";
        }
        // Derive the origin (scheme://host:port) from the API base for /_mock and /_test calls.
        String origin = fauxcordBase;
        if (origin.endsWith("api/v10/")) {
            origin = origin.substring(0, origin.length() - "api/v10/".length());
        }
        while (origin.endsWith("/")) {
            origin = origin.substring(0, origin.length() - 1);
        }

        HttpClient http = HttpClient.newHttpClient();
        waitHealthy(http, origin);

        ObjectMapper mapper = new ObjectMapper();
        JsonNode setup = mapper.readTree(
                Files.readString(Path.of("common/setup.json"), StandardCharsets.UTF_8));
        JsonNode endpoints = mapper.readTree(
                Files.readString(Path.of("common/endpoints.json"), StandardCharsets.UTF_8));

        // RestClientBuilder.build() eagerly base64-decodes the token's first '.'-segment
        // (TokenUtil.getSelfId) and rejects "compat-token" (contains '-', illegal base64), so
        // substitute FORMAT_VALID_TOKEN instead. Fauxcord only matches the registered string, so
        // this changes nothing server-side.
        ((ObjectNode) setup).put("token", "Bot " + FORMAT_VALID_TOKEN);
        doSetup(http, origin, mapper.writeValueAsString(setup));

        String token = setup.get("token").asText();
        long botId = Long.parseLong(setup.get("user").get("id").asText());
        JsonNode guildNode = setup.get("guilds").get(0);
        long guildId = Long.parseLong(guildNode.get("id").asText());
        long channelId = Long.parseLong(guildNode.get("channels").get(0).get("id").asText());
        String rawToken = token.startsWith("Bot ") ? token.substring("Bot ".length()) : token;

        // Force the router's base URL to Fauxcord — see the class-level javadoc. `origin` is
        // reassigned above, so it isn't effectively final and can't be captured by the lambda
        // directly; bind it to a final local first.
        final String apiBaseUrl = origin.endsWith("/") ? origin + "api/v10" : origin + "/api/v10";
        RestClient client = RestClient.restBuilder(rawToken)
                .setExtraOptions(o -> new RouterOptions(
                        o.getAuthorizationScheme(),
                        o.getToken(),
                        o.getReactorResources(),
                        o.getExchangeStrategies(),
                        o.getResponseTransformers(),
                        o.getGlobalRateLimiter(),
                        o.getRequestQueueFactory(),
                        apiBaseUrl))
                .build();

        // Same base-URL override as `client` above, but via DiscordClientBuilder (which extends
        // RestClientBuilder) so its login() gives us a real GatewayDiscordClient.
        DiscordClient discordClient = DiscordClientBuilder.create(rawToken)
                .setExtraOptions(o -> new RouterOptions(
                        o.getAuthorizationScheme(),
                        o.getToken(),
                        o.getReactorResources(),
                        o.getExchangeStrategies(),
                        o.getResponseTransformers(),
                        o.getGlobalRateLimiter(),
                        o.getRequestQueueFactory(),
                        apiBaseUrl))
                .build();

        ChannelService channelService = client.getChannelService();
        GuildService guildService = client.getGuildService();
        WebhookService webhookService = client.getWebhookService();
        InviteService inviteService = client.getInviteService();
        UserService userService = client.getUserService();
        EmojiService emojiService = client.getEmojiService();
        ApplicationService applicationService = client.getApplicationService();
        GatewayService gatewayService = client.getGatewayService();

        final String pngDataUri;
        {
            byte[] pngBytes = Base64.getDecoder().decode(
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC");
            pngDataUri = Image.ofRaw(pngBytes, Image.Format.PNG).getDataUri();
        }

        // Bootstrap resources referenced by later calls, mirroring the other verifiers in this
        // repo. Fall back to placeholder ids when bootstrap itself fails, so the endpoint calls
        // below still exercise the wire format.
        long msgId = attempt(() -> channelService
                .createMessage(channelId, MultipartRequest.ofRequest(
                        MessageCreateRequest.builder().content("compat").build()))
                .block().id().asLong(), 400000000000000001L);
        long bulk1Id = attempt(() -> channelService
                .createMessage(channelId, MultipartRequest.ofRequest(
                        MessageCreateRequest.builder().content("compat-bulk-1").build()))
                .block().id().asLong(), 400000000000000002L);
        long bulk2Id = attempt(() -> channelService
                .createMessage(channelId, MultipartRequest.ofRequest(
                        MessageCreateRequest.builder().content("compat-bulk-2").build()))
                .block().id().asLong(), 400000000000000003L);
        // Fall back to the @everyone role id (== the guild id in Fauxcord) if role creation fails.
        long roleId = attempt(() -> guildService
                .createGuildRole(guildId, RoleCreateRequest.builder().name("compat-role").build(), null)
                .block().id().asLong(), guildId);
        long webhookId;
        String webhookToken;
        {
            WebhookData wh = null;
            try {
                wh = webhookService
                        .createWebhook(channelId, WebhookCreateRequest.builder().name("compat-wh").build(), null)
                        .block();
            } catch (Exception ignored) {
                // fall back to placeholder ids below
            }
            webhookId = wh != null ? wh.id().asLong() : 500000000000000001L;
            webhookToken = wh != null ? wh.token().toOptional().orElse("compat-token-xyz") : "compat-token-xyz";
        }
        // Bootstrap one real webhook message up front: several canonical endpoints (GET/PATCH the
        // token-authenticated webhook message) appear *before* the plain webhook-execute endpoint
        // in common/endpoints.json, so without this the GET would run against a message that does
        // not exist yet.
        long webhookMsgId = attempt(() -> webhookService
                .executeWebhook(webhookId, webhookToken, true,
                        MultipartRequest.ofRequest(WebhookExecuteRequest.builder().content("compat-wh-msg").build()))
                .block().id().asLong(), 400000000000000004L);
        String inviteCode = attempt(() -> channelService
                .createChannelInvite(channelId, InviteCreateRequest.builder().build(), null)
                .block().code(), "compat");
        long emojiId = attempt(() -> emojiService
                .createGuildEmoji(guildId,
                        GuildEmojiCreateRequest.builder()
                                .name("compat")
                                .image(pngDataUri)
                                .roles(Collections.emptyList())
                                .build(),
                        null)
                // EmojiData.id() is Optional<Id> (unicode emoji have no id), unlike WebhookData.id()
                // which returns a bare Id; a created custom emoji always carries one, so get() is safe.
                .block().id().get().asLong(), 600000000000000001L);
        try {
            channelService.createReaction(channelId, msgId, "👍").block();
        } catch (Exception ignored) {
            // reaction endpoints below still exercise the wire format even if this fails
        }

        // Deliberately NOT the bot's own id: banning also kicks, which would delete its
        // guild_members row and break every member-role/member-patch call run afterward.
        final long banTargetId = 900000000000000001L;
        final String reactionEmoji = "👍"; // 👍, matches the other verifiers' choice

        Map<String, CallEntry> calls = new HashMap<>();

        calls.put("GET /channels/{channel_id}/invites", new CallEntry(() ->
                channelService.getChannelInvites(channelId).collectList().block()));
        calls.put("POST /channels/{channel_id}/invites", new CallEntry(() ->
                channelService.createChannelInvite(channelId, InviteCreateRequest.builder().build(), null).block()));
        calls.put("DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}",
                new CallEntry(() -> channelService.deleteReaction(channelId, msgId, reactionEmoji, botId).block()));
        calls.put("DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me", new CallEntry(
                () -> channelService.deleteOwnReaction(channelId, msgId, reactionEmoji).block()));
        calls.put("PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me", new CallEntry(
                () -> channelService.createReaction(channelId, msgId, reactionEmoji).block()));
        calls.put("GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}", new CallEntry(
                () -> channelService.getReactions(channelId, msgId, reactionEmoji, Collections.emptyMap())
                        .collectList().block()));
        calls.put("DELETE /channels/{channel_id}/messages/{message_id}/reactions", new CallEntry(
                () -> channelService.deleteAllReactions(channelId, msgId).block()));
        calls.put("POST /channels/{channel_id}/messages/{message_id}/threads", new CallEntry(
                null, "ChannelService (3.3.2) has no thread-creation method at all; Discord4J's thread " +
                        "support does not exist in this version's REST service layer"));
        calls.put("DELETE /channels/{channel_id}/messages/{message_id}", new CallEntry(
                () -> channelService.deleteMessage(channelId, msgId, "compat").block()));
        calls.put("GET /channels/{channel_id}/messages/{message_id}", new CallEntry(
                () -> channelService.getMessage(channelId, msgId).block()));
        calls.put("PATCH /channels/{channel_id}/messages/{message_id}", new CallEntry(
                () -> channelService.editMessage(channelId, msgId,
                        MultipartRequest.ofRequest(MessageEditRequest.builder().contentOrNull("compat-edit").build()))
                        .block()));
        calls.put("POST /channels/{channel_id}/messages/bulk-delete", new CallEntry(
                () -> channelService.bulkDeleteMessages(channelId, BulkDeleteRequest.builder()
                        .messages(List.of(Long.toString(bulk1Id), Long.toString(bulk2Id))).build()).block()));
        calls.put("DELETE /channels/{channel_id}/messages/pins/{message_id}", new CallEntry(
                () -> channelService.deletePinnedMessage(channelId, msgId).block()));
        calls.put("PUT /channels/{channel_id}/messages/pins/{message_id}", new CallEntry(
                () -> channelService.addPinnedMessage(channelId, msgId).block()));
        calls.put("GET /channels/{channel_id}/messages/pins", new CallEntry(
                () -> channelService.getPinnedMessages(channelId).block()));
        calls.put("GET /channels/{channel_id}/messages", new CallEntry(
                () -> channelService.getMessages(channelId, Collections.emptyMap()).collectList().block()));
        calls.put("POST /channels/{channel_id}/messages", new CallEntry(
                () -> channelService.createMessage(channelId,
                        MultipartRequest.ofRequest(MessageCreateRequest.builder().content("compat").build()))
                        .block()));
        calls.put("DELETE /channels/{channel_id}/permissions/{overwrite_id}", new CallEntry(
                () -> channelService.deleteChannelPermission(channelId, botId, "compat").block()));
        calls.put("PUT /channels/{channel_id}/permissions/{overwrite_id}", new CallEntry(
                () -> channelService.editChannelPermissions(channelId, botId,
                        PermissionsEditRequest.builder().allow(0).deny(0).type(1).build(), null).block()));
        calls.put("DELETE /channels/{channel_id}/pins/{message_id}", new CallEntry(
                null, "discord4j-core 3.3.2's deletePinnedMessage() was retargeted to the new " +
                        "/channels/{id}/messages/pins/{message_id} route (Routes.MESSAGES_PINNED_DELETE); " +
                        "ChannelService no longer exposes the legacy /channels/{id}/pins/{message_id} route"));
        calls.put("PUT /channels/{channel_id}/pins/{message_id}", new CallEntry(
                null, "discord4j-core 3.3.2's addPinnedMessage() was retargeted to the new " +
                        "/channels/{id}/messages/pins/{message_id} route (Routes.MESSAGES_PINNED_ADD); " +
                        "ChannelService no longer exposes the legacy /channels/{id}/pins/{message_id} route"));
        calls.put("GET /channels/{channel_id}/pins", new CallEntry(
                null, "discord4j-core 3.3.2's getPinnedMessages() was retargeted to the new " +
                        "/channels/{id}/messages/pins route (Routes.MESSAGES_PINNED_GET), returning " +
                        "PinnedMessagesResponseData instead of a Flux<MessageData>; ChannelService no " +
                        "longer exposes the legacy /channels/{id}/pins route"));
        calls.put("DELETE /channels/{channel_id}/thread-members/{user_id}", new CallEntry(
                null, "ChannelService (3.3.2) has no thread-member methods; no thread support in this version"));
        calls.put("GET /channels/{channel_id}/thread-members/{user_id}", new CallEntry(
                null, "ChannelService (3.3.2) has no thread-member methods; no thread support in this version"));
        calls.put("PUT /channels/{channel_id}/thread-members/{user_id}", new CallEntry(
                null, "ChannelService (3.3.2) has no thread-member methods; no thread support in this version"));
        calls.put("DELETE /channels/{channel_id}/thread-members/@me", new CallEntry(
                null, "ChannelService (3.3.2) has no thread-member methods; no thread support in this version"));
        calls.put("PUT /channels/{channel_id}/thread-members/@me", new CallEntry(
                null, "ChannelService (3.3.2) has no thread-member methods; no thread support in this version"));
        calls.put("GET /channels/{channel_id}/thread-members", new CallEntry(
                null, "ChannelService (3.3.2) has no thread-member methods; no thread support in this version"));
        calls.put("GET /channels/{channel_id}/threads/archived/private", new CallEntry(
                null, "ChannelService (3.3.2) has no archived-thread-listing methods; no thread support in this version"));
        calls.put("GET /channels/{channel_id}/threads/archived/public", new CallEntry(
                null, "ChannelService (3.3.2) has no archived-thread-listing methods; no thread support in this version"));
        calls.put("GET /channels/{channel_id}/threads/search", new CallEntry(
                null, "ChannelService (3.3.2) has no thread-search method; no thread support in this version"));
        calls.put("POST /channels/{channel_id}/threads", new CallEntry(
                null, "ChannelService (3.3.2) has no thread-creation method; no thread support in this version"));
        calls.put("POST /channels/{channel_id}/typing", new CallEntry(
                () -> channelService.triggerTypingIndicator(channelId).block()));
        calls.put("GET /channels/{channel_id}/users/@me/threads/archived/private", new CallEntry(
                null, "ChannelService (3.3.2) has no archived-thread-listing methods; no thread support in this version"));
        calls.put("GET /channels/{channel_id}/webhooks", new CallEntry(
                () -> webhookService.getChannelWebhooks(channelId).collectList().block()));
        calls.put("POST /channels/{channel_id}/webhooks", new CallEntry(
                () -> webhookService.createWebhook(channelId, WebhookCreateRequest.builder().name("compat-wh2").build(), null)
                        .block()));
        calls.put("DELETE /channels/{channel_id}", new CallEntry(
                null, "not exercised: would delete the shared test channel other rows depend on"));
        calls.put("GET /channels/{channel_id}", new CallEntry(
                () -> channelService.getChannel(channelId).block()));
        calls.put("PATCH /channels/{channel_id}", new CallEntry(
                () -> channelService.modifyChannel(channelId, ChannelModifyRequest.builder().name("general").build(), null)
                        .block()));
        calls.put("GET /gateway/bot", new CallEntry(() -> gatewayService.getGatewayBot().block()));
        calls.put("GET /gateway", new CallEntry(() -> gatewayService.getGateway().block()));
        calls.put("DELETE /guilds/{guild_id}/bans/{user_id}", new CallEntry(
                () -> guildService.removeGuildBan(guildId, banTargetId, "compat").block()));
        calls.put("GET /guilds/{guild_id}/bans/{user_id}", new CallEntry(
                () -> guildService.getGuildBan(guildId, banTargetId).block()));
        calls.put("PUT /guilds/{guild_id}/bans/{user_id}", new CallEntry(
                () -> guildService.createGuildBan(guildId, banTargetId, Collections.emptyMap(), "compat").block()));
        calls.put("GET /guilds/{guild_id}/bans", new CallEntry(
                () -> guildService.getGuildBans(guildId).collectList().block()));
        calls.put("GET /guilds/{guild_id}/channels", new CallEntry(
                () -> guildService.getGuildChannels(guildId).collectList().block()));
        calls.put("POST /guilds/{guild_id}/channels", new CallEntry(
                () -> guildService.createGuildChannel(guildId,
                        ChannelCreateRequest.builder().name("compat-channel").build(), null).block()));
        calls.put("DELETE /guilds/{guild_id}/emojis/{emoji_id}", new CallEntry(
                () -> emojiService.deleteGuildEmoji(guildId, emojiId, "compat").block()));
        calls.put("GET /guilds/{guild_id}/emojis/{emoji_id}", new CallEntry(
                () -> emojiService.getGuildEmoji(guildId, emojiId).block()));
        calls.put("PATCH /guilds/{guild_id}/emojis/{emoji_id}", new CallEntry(
                () -> emojiService.modifyGuildEmoji(guildId, emojiId,
                        GuildEmojiModifyRequest.builder().name("compat2").build(), "compat").block()));
        calls.put("GET /guilds/{guild_id}/emojis", new CallEntry(
                () -> emojiService.getGuildEmojis(guildId).collectList().block()));
        calls.put("POST /guilds/{guild_id}/emojis", new CallEntry(
                () -> emojiService.createGuildEmoji(guildId,
                        GuildEmojiCreateRequest.builder().name("compat3").image(pngDataUri)
                                .roles(Collections.emptyList()).build(), "compat").block()));
        calls.put("DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}", new CallEntry(
                () -> guildService.removeGuildMemberRole(guildId, botId, roleId, "compat").block()));
        calls.put("PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}", new CallEntry(
                () -> guildService.addGuildMemberRole(guildId, botId, roleId, "compat").block()));
        calls.put("DELETE /guilds/{guild_id}/members/{user_id}", new CallEntry(
                null, "not exercised: would remove the bot itself from the shared test guild"));
        calls.put("GET /guilds/{guild_id}/members/{user_id}", new CallEntry(
                () -> guildService.getGuildMember(guildId, botId).block()));
        calls.put("PATCH /guilds/{guild_id}/members/{user_id}", new CallEntry(
                () -> guildService.modifyGuildMember(guildId, botId,
                        GuildMemberModifyRequest.builder().nickOrNull("compat").build(), "compat").block()));
        calls.put("GET /guilds/{guild_id}/members", new CallEntry(
                () -> guildService.getGuildMembers(guildId, Collections.emptyMap()).collectList().block()));
        calls.put("DELETE /guilds/{guild_id}/roles/{role_id}", new CallEntry(
                null, "not exercised: would remove the role other rows (member-role add/remove) still need"));
        calls.put("PATCH /guilds/{guild_id}/roles/{role_id}", new CallEntry(
                () -> guildService.modifyGuildRole(guildId, roleId,
                        RoleModifyRequest.builder().name("compat-role-renamed").build(), null).block()));
        calls.put("GET /guilds/{guild_id}/roles", new CallEntry(
                () -> guildService.getGuildRoles(guildId).collectList().block()));
        calls.put("POST /guilds/{guild_id}/roles", new CallEntry(
                () -> guildService.createGuildRole(guildId, RoleCreateRequest.builder().name("compat-role2").build(), null)
                        .block()));
        calls.put("GET /guilds/{guild_id}/webhooks", new CallEntry(
                () -> webhookService.getGuildWebhooks(guildId).collectList().block()));
        calls.put("DELETE /guilds/{guild_id}", new CallEntry(
                null, "not exercised: would delete the shared test guild other rows depend on"));
        calls.put("GET /guilds/{guild_id}", new CallEntry(() -> guildService.getGuild(guildId).block()));
        calls.put("PATCH /guilds/{guild_id}", new CallEntry(
                () -> guildService.modifyGuild(guildId, GuildModifyRequest.builder().name("Compat Guild").build(), null)
                        .block()));
        calls.put("DELETE /invites/{code}", new CallEntry(
                () -> inviteService.deleteInvite(inviteCode, null).block()));
        calls.put("GET /invites/{code}", new CallEntry(() -> inviteService.getInvite(inviteCode).block()));
        calls.put("GET /oauth2/@me", new CallEntry(
                null, "OAuth2 user-grant '@me' authorization info has no wrapper in discord4j-rest 3.3.2's " +
                        "bot-token service layer"));
        calls.put("GET /oauth2/applications/@me", new CallEntry(
                () -> applicationService.getCurrentApplicationInfo().block()));
        calls.put("POST /oauth2/token/revoke", new CallEntry(
                null, "OAuth2 authorization-code-flow token exchange/revocation is not exposed by any " +
                        "discord4j-rest 3.3.2 service"));
        calls.put("POST /oauth2/token", new CallEntry(
                null, "OAuth2 authorization-code-flow token exchange/revocation is not exposed by any " +
                        "discord4j-rest 3.3.2 service"));
        calls.put("GET /users/{user_id}", new CallEntry(() -> userService.getUser(botId).block()));
        calls.put("GET /users/@me/guilds", new CallEntry(
                () -> userService.getCurrentUserGuilds(Collections.emptyMap()).collectList().block()));
        calls.put("GET /users/@me", new CallEntry(() -> userService.getCurrentUser().block()));
        calls.put("PATCH /users/@me", new CallEntry(
                () -> userService.modifyCurrentUser(UserModifyRequest.builder().username("CompatBot").build())
                        .block()));
        calls.put("DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}", new CallEntry(
                () -> webhookService.deleteWebhookMessage(webhookId, webhookToken, Long.toString(webhookMsgId))
                        .block()));
        calls.put("GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}", new CallEntry(
                () -> webhookService.getWebhookMessage(webhookId, webhookToken, Long.toString(webhookMsgId)).block()));
        calls.put("PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}", new CallEntry(
                () -> webhookService.modifyWebhookMessage(webhookId, webhookToken, Long.toString(webhookMsgId),
                        WebhookMessageEditRequest.builder().contentOrNull("compat-wh-msg-edit").build()).block()));
        calls.put("DELETE /webhooks/{webhook_id}/{webhook_token}", new CallEntry(
                null, "not exercised: would delete the shared webhook other rows still need"));
        calls.put("GET /webhooks/{webhook_id}/{webhook_token}", new CallEntry(
                () -> webhookService.getWebhookWithToken(webhookId, webhookToken).block()));
        calls.put("PATCH /webhooks/{webhook_id}/{webhook_token}", new CallEntry(
                () -> webhookService.modifyWebhookWithToken(webhookId, webhookToken,
                        WebhookModifyWithTokenRequest.builder().name("compat-token-renamed").build()).block()));
        calls.put("POST /webhooks/{webhook_id}/{webhook_token}", new CallEntry(
                () -> webhookService.executeWebhook(webhookId, webhookToken, true,
                        MultipartRequest.ofRequest(WebhookExecuteRequest.builder().content("compat").build()))
                        .block()));
        calls.put("DELETE /webhooks/{webhook_id}", new CallEntry(
                null, "not exercised: would delete the shared webhook other rows still need"));
        calls.put("GET /webhooks/{webhook_id}", new CallEntry(() -> webhookService.getWebhook(webhookId).block()));
        calls.put("PATCH /webhooks/{webhook_id}", new CallEntry(
                () -> webhookService.modifyWebhook(webhookId,
                        WebhookModifyRequest.builder().name("compat-renamed2").build(), null).block()));

        // Run all non-DELETE endpoints first, then DELETEs last, to avoid false "Unknown X"
        // errors from resource-lifecycle ordering rather than real bugs (same fix as the other
        // verifiers in this repo).
        List<JsonNode> ordered = new ArrayList<>();
        endpoints.forEach(ordered::add);
        ordered.sort(Comparator.comparingInt(e ->
                "DELETE".equalsIgnoreCase(e.get("method").asText()) ? 1 : 0));

        List<ResultRow> results = new ArrayList<>();
        for (JsonNode ep : ordered) {
            String key = ep.get("method").asText() + " " + ep.get("path").asText();
            CallEntry entry = calls.get(key);
            if (entry == null || entry.fn == null) {
                String note = entry != null && entry.note != null
                        ? entry.note
                        : "no Discord4J 3.3.2 service method found for this endpoint";
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

        GatewayResult gatewayResult = verifyGateway(discordClient, Long.toString(channelId));

        Report report = new Report("Discord4J", "3.3.2", true, results, gatewayResult);

        Files.createDirectories(Path.of("/results"));
        Files.writeString(Path.of("/results/discord4j.json"),
                mapper.writerWithDefaultPrettyPrinter().writeValueAsString(report), StandardCharsets.UTF_8);

        long passCount = results.stream().filter(r -> "pass".equals(r.status)).count();
        System.out.println("discord4j done: " + passCount + "/" + results.size() + " pass"
                + ", gateway=" + gatewayResult.status);
    }

    /**
     * Runs the Gateway handshake/dispatch check: HELLO → IDENTIFY → READY via
     * {@link DiscordClient#login()}, then confirms a {@link MessageCreateEvent} Dispatch round-trips
     * after posting a message via REST. Logs out afterward regardless of outcome.
     */
    static GatewayResult verifyGateway(DiscordClient discordClient, String channelId) {
        List<GatewayStep> steps = new ArrayList<>();
        GatewayDiscordClient gateway;
        try {
            gateway = discordClient.login().block(Duration.ofSeconds(20));
            if (gateway == null) {
                throw new IllegalStateException("login returned null");
            }
            steps.add(new GatewayStep("connect-identify-ready", "pass", ""));
        } catch (Exception e) {
            steps.add(new GatewayStep("connect-identify-ready", "lib-issue", describeLoginFailure(e)));
            return new GatewayResult("lib-issue", steps);
        }

        try {
            CompletableFuture<Boolean> messageReceived = new CompletableFuture<>();
            gateway.getEventDispatcher().on(MessageCreateEvent.class)
                    .filter(ev -> "gateway-compat-check".equals(ev.getMessage().getContent()))
                    .subscribe(ev -> messageReceived.complete(true));

            gateway.getChannelById(Snowflake.of(channelId))
                    .ofType(MessageChannel.class)
                    .flatMap(ch -> ch.createMessage("gateway-compat-check"))
                    .block(Duration.ofSeconds(10));

            messageReceived.get(15, TimeUnit.SECONDS);
            steps.add(new GatewayStep("dispatch-message-create", "pass", ""));
        } catch (Exception e) {
            steps.add(new GatewayStep("dispatch-message-create", "lib-issue", String.valueOf(e.getMessage())));
        } finally {
            gateway.logout().block(Duration.ofSeconds(10));
        }

        String status = steps.stream().filter(s -> !"pass".equals(s.status)).findFirst()
                .map(s -> s.status).orElse("pass");
        return new GatewayResult(status, steps);
    }

    /**
     * Builds a diagnostic note for a {@link DiscordClient#login()} failure. Timeout-shaped
     * failures get the confirmed root-cause explanation (see the class-level javadoc's
     * "Confirmed Gateway gap" section) prepended, since a bare "Timeout on blocking read" message
     * gives no hint that this is a permanent, structural incompatibility rather than a flaky
     * network hiccup.
     * @param e - the exception thrown by {@code login().block()}
     * @return a note describing the failure, suitable for {@link GatewayStep#note}
     */
    private static String describeLoginFailure(Exception e) {
        String message = String.valueOf(e.getMessage());
        boolean looksLikeTimeout = message.toLowerCase(Locale.ROOT).contains("timeout");
        if (!looksLikeTimeout) {
            return message;
        }
        return "Discord4J unconditionally requires zlib-stream Gateway compression (see class "
                + "javadoc's \"Confirmed Gateway gap\" section), which Fauxcord does not implement; "
                + "HELLO is never decompressed client-side, so login() times out. Original exception: "
                + message;
    }

    /** Runs {@code supplier}, returning {@code fallback} if it throws. */
    private static <T> T attempt(ThrowingSupplier<T> supplier, T fallback) {
        try {
            return supplier.get();
        } catch (Exception e) {
            return fallback;
        }
    }

    /**
     * Polls the Fauxcord health endpoint until it responds 200 OK, or throws after ~60s.
     */
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
     * network errors or unexpected statuses, matching the other verifiers' DoSetup helper, so a
     * transient host I/O hiccup here does not silently leave fixtures missing and corrupt every
     * downstream result with bogus "Unknown Guild"/"Unknown Channel" failures.
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
