// Kord (dev.kord:kord-rest) compatibility verifier.
//
// === Why Kord is NOT gateway-blocked (unlike JDA, see ../jvm-jda/README.md) ===
//
// Kord ships `kord-rest` as a standalone module: `dev.kord.rest.service.RestClient` wraps a
// `RequestHandler` and exposes high-level REST services (`.channel`, `.guild`, `.user`, `.webhook`,
// `.emoji`, `.invite`, `.application`, ...) with **no Gateway/WebSocket dependency at all** — this
// is a materially different architecture from JDA's Gateway-first `JDABuilder`/`JDA` object model.
// Confirmed by reading `RestClient.kt` at kordlib/kord tag `0.14.0`: it is constructed directly
// from a `RequestHandler` (or a bare token, via a top-level `RestClient(token: String)` helper
// that internally builds a default `KtorRequestHandler`), with no gateway/session/login sequence
// anywhere in the class. This verifier only ever touches `kord-rest`; the full `Kord`
// gateway-aware facade (a separate `dev.kord:kord-core` artifact) is never used or depended on.
//
// === The override mechanism (verified by source, not guessed) ===
//
// `KtorRequestHandler.createRequest` (rest/src/commonMain/kotlin/request/KtorRequestHandler.kt,
// tag 0.14.0) builds each outgoing request as:
//
//   url { url.takeFrom(request.baseUrl); encodedPath += request.path; ... }
//
// `request.baseUrl` defaults to `Route.baseUrl`, a hardcoded *getter* (no setter) in
// rest/src/commonMain/kotlin/route/Route.kt:
//
//   public val baseUrl: String get() = "https://discord.com/api/v${KordConfiguration.REST_VERSION}"
//
// So `takeFrom("https://discord.com/api/v10")` sets scheme=https, host=discord.com, and
// (crucially) **path=/api/v10** on the request URL — then `encodedPath += request.path` appends
// the route-specific suffix (e.g. `/channels/123`), producing `/api/v10/channels/123`. Because the
// `/api/v10` path segment is baked in by `takeFrom` before the per-route path is appended, we do
// NOT need to touch the path at all to redirect traffic to Fauxcord: only the protocol/host/port
// need to be rewritten, exactly as the task brief prescribed. This is done via a Ktor
// `HttpRequestPipeline.Before` interceptor installed on a custom `HttpClient(CIO)`, which is then
// handed to `KtorRequestHandler`'s **primary constructor** (confirmed exact parameter list from the
// same source file at tag 0.14.0):
//
//   public class KtorRequestHandler(
//       private val client: HttpClient,
//       private val requestRateLimiter: RequestRateLimiter = ExclusionRequestRateLimiter(),
//       private val clock: Clock = Clock.System,
//       private val parser: Json = jsonDefault,
//       override val token: String,
//   ) : RequestHandler
//
// We call it with named arguments (`client = ..., token = ...`), letting `requestRateLimiter`,
// `clock`, and `parser` fall back to their defaults. `RestClient(requestHandler: RequestHandler)`
// (service/RestClient.kt, same tag) is then just `RestClient(KtorRequestHandler(client, token))`.
//
// === Coverage notes ===
//
// Because kord-rest is a thin, comprehensive REST wrapper (not an object-model library gated by a
// cache/entity graph like Discord.Net/discordgo/Oceanic), it covers noticeably MORE of the 86
// canonical endpoints for real than the other object-model verifiers in this repo — notably
// `GET /guilds/{guild_id}/roles` (`GuildService.getGuildRoles`) and `GET /users/@me/guilds`
// (`UserService.getCurrentUserGuilds`), both of which are "n-a" in `../dotnet-discordnet/Program.cs`
// for the equivalent Discord.Net.Rest client. Endpoints with no wrapper anywhere in `kord-rest`
// (confirmed by reading `RestClient.kt`'s service list and the relevant `*Service.kt` files, and by
// grepping the generated `Route.kt` for the literal path) are recorded as "n-a" with an evidence
// note, most notably:
//   - The new-format `/channels/{id}/messages/pins*` API: `ChannelService.addPinnedMessage`/
//     `deletePinnedMessage`/`getChannelPins` all target the legacy `Route.PinPut`/`PinDelete`/
//     `PinsGet` routes, whose literal path is `/channels/$ChannelId/pins` (confirmed in Route.kt) —
//     there is no `Route` at all for the `/messages/pins` path shape.
//   - `GET /channels/{channel_id}/thread-members/{user_id}` (single-member fetch): `Route.kt` only
//     defines PUT/DELETE `.../thread-members/{@me,$UserId}` and a list-returning GET
//     `.../thread-members`; no single-member GET route exists.
//   - `GET /channels/{channel_id}/threads/search`: no `Route` for a thread-search path exists.
//   - Gateway bootstrap endpoints (`/gateway`, `/gateway/bot`): `Route.GatewayGet`/`GatewayBotGet`
//     exist as internal `Route` objects (used by the separate `kord-gateway` module, not depended
//     on here), but `RestClient` exposes no service wrapping them.
//   - OAuth2 authorization-code-flow endpoints (`/oauth2/@me`, `/oauth2/token`,
//     `/oauth2/token/revoke`): no corresponding `Route`/service exists; only the bot-token
//     `GET /oauth2/applications/@me` is wrapped (`ApplicationService.getCurrentApplicationInfo`,
//     confirmed against `Route.CurrentApplicationInfo`'s literal path).
//   - Destructive calls that would break later rows sharing the same resource (deleting the shared
//     guild/channel/role/webhook that other rows still depend on, or removing the bot itself from
//     the shared guild) are skipped and recorded as "n-a" with a "not exercised: ..." note, matching
//     the pattern used by the other verifiers in this repo.
//
// === UNCERTAIN markers ===
//
// A handful of builder property names (e.g. `content` on the `Message*Builder` DSLs) are extremely
// well-established, ubiquitous Kord API surface backed by the library's own official documentation
// and examples, but were not individually re-confirmed against the tag-0.14.0 source of every single
// abstract builder base class in this session (time-boxed source verification prioritized the
// override mechanism, `Route` literal paths, and top-level service method signatures, which are the
// parts most load-bearing for the pass/n-a verdicts). These are marked `// UNCERTAIN:` inline below;
// everything else in this file (service method names/signatures, `Route` literal paths, the
// `KtorRequestHandler`/`RestClient` constructors, `ArchiveDuration`/`ChannelType`/`OverwriteType`/
// `Permissions()`/`Image.Format` values, and `BulkDeleteRequest`/`ListThreads*Request` shapes) was
// read directly from kordlib/kord's source at git tag `0.14.0` via `gh api`.

import dev.kord.common.entity.ArchiveDuration
import dev.kord.common.entity.ChannelType
import dev.kord.common.entity.OverwriteType
import dev.kord.common.entity.Permissions
import dev.kord.common.entity.Snowflake
import dev.kord.common.entity.optional.optional
import dev.kord.rest.Image
import dev.kord.rest.json.request.BulkDeleteRequest
import dev.kord.rest.json.request.ChannelModifyPatchRequest
import dev.kord.rest.json.request.ChannelPermissionEditRequest
import dev.kord.rest.json.request.ListThreadsByTimestampRequest
import dev.kord.rest.json.request.ListThreadsBySnowflakeRequest
import dev.kord.rest.request.KtorRequestHandler
import dev.kord.rest.service.RestClient
import dev.kord.rest.service.createTextChannel
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.HttpRequestPipeline
import io.ktor.http.URLProtocol
import io.ktor.http.Url
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.net.URI
import java.net.http.HttpClient as JavaHttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse

/** One canonical (method, path) pair from `common/endpoints.json`. */
private data class EndpointDef(val method: String, val path: String)

/** Maps one endpoint to either an executable probe or an n-a note. `fn == null` => n-a. */
private class CallEntry(val fn: (suspend () -> Unit)? = null, val note: String? = null)

/** One row of the output report for a single canonical endpoint. */
private data class ResultRow(val endpoint: String, val status: String, val note: String)

/** JSON-escapes a string for embedding in a manually-built JSON document. */
private fun jsonEscape(s: String): String {
    val sb = StringBuilder()
    for (c in s) {
        when (c) {
            '"' -> sb.append("\\\"")
            '\\' -> sb.append("\\\\")
            '\n' -> sb.append("\\n")
            '\r' -> sb.append("\\r")
            '\t' -> sb.append("\\t")
            else -> if (c.code < 0x20) sb.append("\\u%04x".format(c.code)) else sb.append(c)
        }
    }
    return sb.toString()
}

/**
 * Polls Fauxcord's `/_mock/health` endpoint until it responds 200 OK, or throws after ~60s.
 */
private fun waitHealthy(http: JavaHttpClient, origin: String) {
    repeat(60) {
        try {
            val req = HttpRequest.newBuilder(URI.create("$origin/_mock/health")).GET().build()
            val res = http.send(req, HttpResponse.BodyHandlers.discarding())
            if (res.statusCode() in 200..299) return
        } catch (_: Exception) {
            // not up yet
        }
        Thread.sleep(1000)
    }
    throw IllegalStateException("fauxcord did not become healthy")
}

/**
 * POSTs the shared `common/setup.json` payload to `/_test/setup`. 2xx (created) and 409 (already
 * set up by a prior run against a reused Fauxcord container) both count as success. Retries with
 * backoff on network errors or unexpected statuses, mirroring the other verifiers' `DoSetupAsync`
 * (see e.g. `../dotnet-discordnet/Program.cs`), so a transient hiccup here doesn't silently corrupt
 * every downstream result with bogus "Unknown Guild"/"Unknown Channel" failures.
 */
private fun doSetup(http: JavaHttpClient, origin: String, rawSetupJson: String) {
    var lastError: Exception? = null
    for (attempt in 1..5) {
        try {
            val req = HttpRequest.newBuilder(URI.create("$origin/_test/setup"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(rawSetupJson))
                .build()
            val res = http.send(req, HttpResponse.BodyHandlers.ofString())
            if (res.statusCode() in 200..299 || res.statusCode() == 409) return
            lastError = IllegalStateException("unexpected status ${res.statusCode()}: ${res.body()}")
        } catch (e: Exception) {
            lastError = e
        }
        if (attempt < 5) Thread.sleep(attempt * 1000L)
    }
    throw IllegalStateException("doSetup: failed to POST /_test/setup after 5 attempts", lastError)
}

fun main() {
    val jsonParser = Json { ignoreUnknownKeys = true }

    var fauxcordBase = System.getenv("FAUXCORD_BASE") ?: "http://fauxcord:3000/api/v10/"
    if (!fauxcordBase.endsWith("/")) fauxcordBase += "/"
    // Derive the origin (scheme://host:port) from the API base for /_mock and /_test calls.
    var origin = fauxcordBase
    if (origin.endsWith("api/v10/")) origin = origin.removeSuffix("api/v10/")
    origin = origin.trimEnd('/')

    val fauxcordUrl = Url(fauxcordBase)
    val fauxcordHost = fauxcordUrl.host
    val fauxcordPort = fauxcordUrl.port
    val fauxcordProtocol = if (fauxcordUrl.protocol.name == "https") URLProtocol.HTTPS else URLProtocol.HTTP

    val javaHttp = JavaHttpClient.newHttpClient()
    waitHealthy(javaHttp, origin)

    val setupRaw = File("common/setup.json").readText()
    doSetup(javaHttp, origin, setupRaw)

    val setupJson = jsonParser.parseToJsonElement(setupRaw).jsonObject
    val endpointsRaw = File("common/endpoints.json").readText()
    val endpointsJson = jsonParser.parseToJsonElement(endpointsRaw).jsonArray
    val endpoints = endpointsJson.map { el ->
        val o = el.jsonObject
        EndpointDef(o.getValue("method").jsonPrimitive.content, o.getValue("path").jsonPrimitive.content)
    }

    val token = setupJson.getValue("token").jsonPrimitive.content
    val userObj = setupJson.getValue("user").jsonObject
    val botId = Snowflake(userObj.getValue("id").jsonPrimitive.content)
    val guildObj = setupJson.getValue("guilds").jsonArray[0].jsonObject
    val guildId = Snowflake(guildObj.getValue("id").jsonPrimitive.content)
    val channelObj = guildObj.getValue("channels").jsonArray[0].jsonObject
    val channelId = Snowflake(channelObj.getValue("id").jsonPrimitive.content)

    // Force the ktor HttpClient's target to Fauxcord regardless of what kord-rest would normally
    // send to (the real discord.com host) — see the header comment above for why only
    // protocol/host/port need to change (the /api/v10 path segment is preserved by takeFrom()).
    val ktorClient = HttpClient(CIO) {
        expectSuccess = false
        install(HttpTimeout) {
            requestTimeoutMillis = 30_000
        }
    }
    ktorClient.requestPipeline.intercept(HttpRequestPipeline.Before) {
        context.url.protocol = fauxcordProtocol
        context.url.host = fauxcordHost
        context.url.port = fauxcordPort
    }

    // Primary-constructor call, confirmed exact parameter names/order against
    // KtorRequestHandler.kt at kordlib/kord tag 0.14.0 (see header comment).
    val requestHandler = KtorRequestHandler(client = ktorClient, token = token)
    val rest = RestClient(requestHandler)

    val pngBytes = java.util.Base64.getDecoder().decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
    )

    // Bootstrap resources referenced by later calls, mirroring the other verifiers (see
    // ../dotnet-discordnet/Program.cs). Falls back to placeholder ids when bootstrap itself fails
    // so the endpoint calls below still exercise the wire format.
    var msgId = Snowflake(400000000000000001UL)
    var bulk1Id = Snowflake(400000000000000002UL)
    var bulk2Id = Snowflake(400000000000000003UL)
    var threadId = channelId
    var roleId = guildId
    var webhookId = Snowflake(500000000000000001UL)
    var webhookToken = "compat-token-xyz"
    var inviteCode = "compat"
    var emojiId = Snowflake(600000000000000001UL)
    // Deliberately not the bot's own id: banning a user also kicks them (matches real Discord), so
    // exercising ban/unban against the bot itself would break every member-role/member-patch call
    // that runs afterward. Use a separate, never-actually-a-member placeholder id instead, same as
    // the other verifiers.
    val banTargetId = Snowflake(900000000000000001UL)

    runBlocking {
        try {
            rest.channel.createMessage(channelId) { content = "compat" }.also { msgId = it.id }
        } catch (_: Exception) {
            // fall back to placeholder id
        }
        try {
            val b1 = rest.channel.createMessage(channelId) { content = "compat-bulk-1" }
            val b2 = rest.channel.createMessage(channelId) { content = "compat-bulk-2" }
            bulk1Id = b1.id
            bulk2Id = b2.id
        } catch (_: Exception) {
            // fall back to placeholder ids
        }
        try {
            roleId = rest.guild.createGuildRole(guildId) { name = "compat-role" }.id
        } catch (_: Exception) {
            // fall back: the @everyone role id == the guild id in fauxcord
        }
        try {
            val wh = rest.webhook.createWebhook(channelId, "compat-wh") {}
            webhookId = wh.id
            // Kord models the webhook token as its own `Optional<String>`
            // (distinct from a Kotlin nullable), so unwrap with `.value`
            // before the elvis fallback.
            webhookToken = wh.token.value ?: webhookToken
        } catch (_: Exception) {
            // fall back to placeholder ids
        }
        try {
            threadId = rest.channel.startThread(
                channelId,
                "compat-thread",
                ArchiveDuration.Hour,
                ChannelType.PublicGuildThread,
            ) {}.id
        } catch (_: Exception) {
            // fall back to placeholder id (channelId)
        }
        try {
            inviteCode = rest.channel.createInvite(channelId) {}.code
        } catch (_: Exception) {
            // fall back to placeholder code
        }
        try {
            // createEmoji returns an emoji whose `id` is nullable
            // (`Snowflake?`); keep the placeholder id when it is absent.
            emojiId = rest.emoji.createEmoji(guildId, "compat", Image.raw(pngBytes, Image.Format.PNG)).id ?: emojiId
        } catch (_: Exception) {
            // fall back to placeholder id
        }
        try {
            rest.channel.createReaction(channelId, msgId, "👍") // 👍
        } catch (_: Exception) {
            // ignore: reaction endpoints below still exercise the wire format
        }
    }

    // Endpoint key -> call entry.
    val calls = LinkedHashMap<String, CallEntry>()

    calls["GET /channels/{channel_id}/invites"] = CallEntry({ rest.channel.getChannelInvites(channelId) })
    calls["POST /channels/{channel_id}/invites"] = CallEntry({ rest.channel.createInvite(channelId) {} })
    calls["DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}"] =
        CallEntry({ rest.channel.deleteReaction(channelId, msgId, botId, "👍") })
    calls["DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me"] =
        CallEntry({ rest.channel.deleteOwnReaction(channelId, msgId, "👍") })
    calls["PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me"] =
        CallEntry({ rest.channel.createReaction(channelId, msgId, "👍") })
    calls["GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}"] =
        CallEntry({ rest.channel.getReactions(channelId, msgId, "👍") })
    calls["DELETE /channels/{channel_id}/messages/{message_id}/reactions"] =
        CallEntry({ rest.channel.deleteAllReactions(channelId, msgId) })
    calls["POST /channels/{channel_id}/messages/{message_id}/threads"] = CallEntry({
        rest.channel.startThreadWithMessage(channelId, msgId, "compat-thread-from-msg", ArchiveDuration.Hour) {}
    })
    calls["DELETE /channels/{channel_id}/messages/{message_id}"] =
        CallEntry({ rest.channel.deleteMessage(channelId, msgId) })
    calls["GET /channels/{channel_id}/messages/{message_id}"] =
        CallEntry({ rest.channel.getMessage(channelId, msgId) })
    // UNCERTAIN: `content` is assumed to be a settable property on `UserMessageModifyBuilder`
    // (inherited from an `AbstractMessageModifyBuilder` base not individually re-read at tag
    // 0.14.0 in this session) — this is extremely well-established, ubiquitous Kord API surface
    // per the library's own docs/examples, but not source-confirmed line-by-line here.
    calls["PATCH /channels/{channel_id}/messages/{message_id}"] =
        CallEntry({ rest.channel.editMessage(channelId, msgId) { content = "compat-edit" } })
    calls["POST /channels/{channel_id}/messages/bulk-delete"] =
        CallEntry({ rest.channel.bulkDelete(channelId, BulkDeleteRequest(listOf(bulk1Id, bulk2Id))) })
    calls["DELETE /channels/{channel_id}/messages/pins/{message_id}"] = CallEntry(
        note = "no Route exists for the new-format /messages/pins path; ChannelService.deletePinnedMessage " +
            "targets the legacy Route.PinDelete (\"/channels/\$ChannelId/pins/\$MessageId\") instead",
    )
    calls["PUT /channels/{channel_id}/messages/pins/{message_id}"] = CallEntry(
        note = "no Route exists for the new-format /messages/pins path; ChannelService.addPinnedMessage " +
            "targets the legacy Route.PinPut instead",
    )
    calls["GET /channels/{channel_id}/messages/pins"] = CallEntry(
        note = "no Route exists for the new-format /messages/pins path; ChannelService.getChannelPins " +
            "targets the legacy Route.PinsGet (\"/channels/\$ChannelId/pins\") instead",
    )
    calls["GET /channels/{channel_id}/messages"] = CallEntry({ rest.channel.getMessages(channelId) })
    calls["POST /channels/{channel_id}/messages"] =
        CallEntry({ rest.channel.createMessage(channelId) { content = "compat" } })
    calls["DELETE /channels/{channel_id}/permissions/{overwrite_id}"] =
        CallEntry({ rest.channel.deleteChannelPermission(channelId, botId) })
    calls["PUT /channels/{channel_id}/permissions/{overwrite_id}"] = CallEntry({
        rest.channel.editChannelPermissions(
            channelId,
            botId,
            ChannelPermissionEditRequest(allow = Permissions(), deny = Permissions(), type = OverwriteType.Member),
        )
    })
    calls["DELETE /channels/{channel_id}/pins/{message_id}"] =
        CallEntry({ rest.channel.deletePinnedMessage(channelId, msgId) })
    calls["PUT /channels/{channel_id}/pins/{message_id}"] =
        CallEntry({ rest.channel.addPinnedMessage(channelId, msgId) })
    calls["GET /channels/{channel_id}/pins"] = CallEntry({ rest.channel.getChannelPins(channelId) })
    calls["DELETE /channels/{channel_id}/thread-members/{user_id}"] =
        CallEntry({ rest.channel.removeUserFromThread(threadId, botId) })
    calls["GET /channels/{channel_id}/thread-members/{user_id}"] = CallEntry(
        note = "no Route exists for a single-member thread-members GET; Route.kt only defines the " +
            "PUT/DELETE @me and \$UserId variants plus a list-returning GET",
    )
    calls["PUT /channels/{channel_id}/thread-members/{user_id}"] =
        CallEntry({ rest.channel.addUserToThread(threadId, botId) })
    calls["DELETE /channels/{channel_id}/thread-members/@me"] = CallEntry({ rest.channel.leaveThread(threadId) })
    calls["PUT /channels/{channel_id}/thread-members/@me"] = CallEntry({ rest.channel.joinThread(threadId) })
    calls["GET /channels/{channel_id}/thread-members"] = CallEntry({ rest.channel.listThreadMembers(threadId) })
    calls["GET /channels/{channel_id}/threads/archived/private"] =
        CallEntry({ rest.channel.listPrivateArchivedThreads(channelId, ListThreadsByTimestampRequest()) })
    calls["GET /channels/{channel_id}/threads/archived/public"] =
        CallEntry({ rest.channel.listPublicArchivedThreads(channelId, ListThreadsByTimestampRequest()) })
    calls["GET /channels/{channel_id}/threads/search"] = CallEntry(
        note = "no Route/service wrapper exists for the thread-search endpoint",
    )
    calls["POST /channels/{channel_id}/threads"] = CallEntry({
        rest.channel.startThread(channelId, "compat-thread2", ArchiveDuration.Hour, ChannelType.PublicGuildThread) {}
    })
    calls["POST /channels/{channel_id}/typing"] = CallEntry({ rest.channel.triggerTypingIndicator(channelId) })
    calls["GET /channels/{channel_id}/users/@me/threads/archived/private"] =
        CallEntry({ rest.channel.listJoinedPrivateArchivedThreads(channelId, ListThreadsBySnowflakeRequest()) })
    calls["GET /channels/{channel_id}/webhooks"] = CallEntry({ rest.webhook.getChannelWebhooks(channelId) })
    calls["POST /channels/{channel_id}/webhooks"] =
        CallEntry({ rest.webhook.createWebhook(channelId, "compat-wh2") {} })
    calls["DELETE /channels/{channel_id}"] = CallEntry(
        note = "not exercised: would delete the shared test channel other rows depend on",
    )
    calls["GET /channels/{channel_id}"] = CallEntry({ rest.channel.getChannel(channelId) })
    calls["PATCH /channels/{channel_id}"] = CallEntry({
        rest.channel.patchChannel(channelId, ChannelModifyPatchRequest(name = "general".optional()))
    })
    calls["GET /gateway/bot"] = CallEntry(
        note = "Route.GatewayBotGet exists (used internally by the separate kord-gateway module) " +
            "but RestClient exposes no service wrapping it",
    )
    calls["GET /gateway"] = CallEntry(
        note = "Route.GatewayGet exists (used internally by the separate kord-gateway module) " +
            "but RestClient exposes no service wrapping it",
    )
    calls["DELETE /guilds/{guild_id}/bans/{user_id}"] =
        CallEntry({ rest.guild.deleteGuildBan(guildId, banTargetId) })
    calls["GET /guilds/{guild_id}/bans/{user_id}"] = CallEntry({ rest.guild.getGuildBan(guildId, banTargetId) })
    calls["PUT /guilds/{guild_id}/bans/{user_id}"] = CallEntry({ rest.guild.addGuildBan(guildId, banTargetId) {} })
    calls["GET /guilds/{guild_id}/bans"] = CallEntry({ rest.guild.getGuildBans(guildId) })
    calls["GET /guilds/{guild_id}/channels"] = CallEntry({ rest.guild.getGuildChannels(guildId) })
    calls["POST /guilds/{guild_id}/channels"] =
        CallEntry({ rest.guild.createTextChannel(guildId, "compat-channel") {} })
    calls["DELETE /guilds/{guild_id}/emojis/{emoji_id}"] = CallEntry({ rest.emoji.deleteEmoji(guildId, emojiId) })
    calls["GET /guilds/{guild_id}/emojis/{emoji_id}"] = CallEntry({ rest.emoji.getEmoji(guildId, emojiId) })
    calls["PATCH /guilds/{guild_id}/emojis/{emoji_id}"] =
        CallEntry({ rest.emoji.modifyEmoji(guildId, emojiId) { name = "compat2" } })
    calls["GET /guilds/{guild_id}/emojis"] = CallEntry({ rest.emoji.getEmojis(guildId) })
    calls["POST /guilds/{guild_id}/emojis"] =
        CallEntry({ rest.emoji.createEmoji(guildId, "compat3", Image.raw(pngBytes, Image.Format.PNG)) })
    calls["DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}"] =
        CallEntry({ rest.guild.deleteRoleFromGuildMember(guildId, botId, roleId) })
    calls["PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}"] =
        CallEntry({ rest.guild.addRoleToGuildMember(guildId, botId, roleId) })
    calls["DELETE /guilds/{guild_id}/members/{user_id}"] = CallEntry(
        note = "not exercised: would remove the bot itself from the shared test guild",
    )
    calls["GET /guilds/{guild_id}/members/{user_id}"] = CallEntry({ rest.guild.getGuildMember(guildId, botId) })
    calls["PATCH /guilds/{guild_id}/members/{user_id}"] =
        CallEntry({ rest.guild.modifyGuildMember(guildId, botId) { nickname = "compat" } })
    calls["GET /guilds/{guild_id}/members"] = CallEntry({ rest.guild.getGuildMembers(guildId) })
    calls["DELETE /guilds/{guild_id}/roles/{role_id}"] = CallEntry(
        note = "not exercised: would remove the role other rows (member-role add/remove) still need",
    )
    calls["PATCH /guilds/{guild_id}/roles/{role_id}"] =
        CallEntry({ rest.guild.modifyGuildRole(guildId, roleId) { name = "compat-role-renamed" } })
    // Unlike Discord.Net.Rest (see ../dotnet-discordnet/Program.cs, which marks this "n-a" because
    // RestGuild.Roles is only populated from the cached GET /guilds/{id} payload), Kord's
    // GuildService has a genuine dedicated wrapper for this endpoint.
    calls["GET /guilds/{guild_id}/roles"] = CallEntry({ rest.guild.getGuildRoles(guildId) })
    calls["POST /guilds/{guild_id}/roles"] =
        CallEntry({ rest.guild.createGuildRole(guildId) { name = "compat-role2" } })
    calls["GET /guilds/{guild_id}/webhooks"] = CallEntry({ rest.webhook.getGuildWebhooks(guildId) })
    calls["DELETE /guilds/{guild_id}"] = CallEntry(
        note = "not exercised: would delete the shared test guild other rows depend on",
    )
    calls["GET /guilds/{guild_id}"] = CallEntry({ rest.guild.getGuild(guildId) })
    calls["PATCH /guilds/{guild_id}"] = CallEntry({ rest.guild.modifyGuild(guildId) { name = "Compat Guild" } })
    calls["DELETE /invites/{code}"] = CallEntry({ rest.invite.deleteInvite(inviteCode) })
    calls["GET /invites/{code}"] = CallEntry({ rest.invite.getInvite(inviteCode) })
    calls["GET /oauth2/@me"] = CallEntry(
        note = "OAuth2 user-grant '@me' authorization info has no Route/service on the bot-token RestClient",
    )
    calls["GET /oauth2/applications/@me"] = CallEntry({ rest.application.getCurrentApplicationInfo() })
    calls["POST /oauth2/token/revoke"] = CallEntry(
        note = "OAuth2 authorization-code-flow token exchange/revocation has no Route/service on the " +
            "bot-token RestClient",
    )
    calls["POST /oauth2/token"] = CallEntry(
        note = "OAuth2 authorization-code-flow token exchange/revocation has no Route/service on the " +
            "bot-token RestClient",
    )
    calls["GET /users/{user_id}"] = CallEntry({ rest.user.getUser(botId) })
    // Unlike Discord.Net.Rest (marked "n-a" in ../dotnet-discordnet/Program.cs — bots normally
    // discover guilds via the gateway READY payload, so Discord.Net.Rest exposes no wrapper), Kord's
    // UserService has a genuine dedicated `getCurrentUserGuilds` wrapper for this endpoint.
    calls["GET /users/@me/guilds"] = CallEntry({ rest.user.getCurrentUserGuilds() })
    calls["GET /users/@me"] = CallEntry({ rest.user.getCurrentUser() })
    // UNCERTAIN: `username` is assumed settable on `CurrentUserModifyBuilder` (confirmed present as
    // `public var username: String? by ::_username.delegate()` at tag 0.14.0).
    calls["PATCH /users/@me"] = CallEntry({ rest.user.modifyCurrentUser { username = "CompatBot" } })
    calls["DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}"] =
        CallEntry({ rest.webhook.deleteWebhookMessage(webhookId, webhookToken, msgId) })
    calls["GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}"] =
        CallEntry({ rest.webhook.getWebhookMessage(webhookId, webhookToken, msgId) })
    // UNCERTAIN: `content` is assumed settable on `WebhookMessageModifyBuilder` (same caveat as the
    // message-edit builder above — ubiquitous Kord API surface, not individually re-read here).
    calls["PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}"] = CallEntry({
        rest.webhook.editWebhookMessage(webhookId, webhookToken, msgId) { content = "compat-edit" }
    })
    calls["DELETE /webhooks/{webhook_id}/{webhook_token}"] = CallEntry(
        note = "not exercised: would delete the shared webhook other rows still need",
    )
    calls["GET /webhooks/{webhook_id}/{webhook_token}"] =
        CallEntry({ rest.webhook.getWebhookWithToken(webhookId, webhookToken) })
    calls["PATCH /webhooks/{webhook_id}/{webhook_token}"] =
        CallEntry({ rest.webhook.modifyWebhookWithToken(webhookId, webhookToken) { name = "compat-renamed-token" } })
    // UNCERTAIN: `content` is assumed settable on `WebhookMessageCreateBuilder` (same caveat as above).
    calls["POST /webhooks/{webhook_id}/{webhook_token}"] = CallEntry({
        rest.webhook.executeWebhook(webhookId, webhookToken) { content = "compat" }
    })
    calls["DELETE /webhooks/{webhook_id}"] = CallEntry(
        note = "not exercised: would delete the shared webhook other rows still need",
    )
    calls["GET /webhooks/{webhook_id}"] = CallEntry({ rest.webhook.getWebhook(webhookId) })
    calls["PATCH /webhooks/{webhook_id}"] =
        CallEntry({ rest.webhook.modifyWebhook(webhookId) { name = "compat-renamed2" } })

    // Run all non-DELETE endpoints first, then DELETEs last, to avoid false "Unknown X" errors from
    // resource-lifecycle ordering rather than real bugs (same fix as the other verifiers).
    val ordered = endpoints.sortedBy { if (it.method.equals("DELETE", ignoreCase = true)) 1 else 0 }

    var realCallCount = 0
    var naCount = 0
    val results = mutableListOf<ResultRow>()
    for (ep in ordered) {
        val key = "${ep.method} ${ep.path}"
        val entry = calls[key]
        if (entry?.fn == null) {
            naCount++
            results.add(
                ResultRow(key, "n-a", entry?.note ?: "no high-level kord-rest method found for this endpoint")
            )
            continue
        }
        realCallCount++
        try {
            runBlocking { entry.fn.invoke() }
            results.add(ResultRow(key, "pass", ""))
        } catch (e: Exception) {
            var message = "${e::class.simpleName}: ${e.message}"
            if (message.length > 300) message = message.take(300)
            results.add(ResultRow(key, "lib-issue", message))
        }
    }

    File("/results").mkdirs()
    val sb = StringBuilder()
    sb.append("{\n")
    sb.append("  \"library\": \"kord\",\n")
    sb.append("  \"version\": \"0.14.0\",\n")
    sb.append("  \"baseUrlOverridable\": true,\n")
    sb.append("  \"results\": [\n")
    results.forEachIndexed { i, r ->
        sb.append("    { \"endpoint\": \"${jsonEscape(r.endpoint)}\", ")
        sb.append("\"status\": \"${jsonEscape(r.status)}\", ")
        sb.append("\"note\": \"${jsonEscape(r.note)}\" }")
        sb.append(if (i != results.lastIndex) ",\n" else "\n")
    }
    sb.append("  ]\n")
    sb.append("}\n")
    File("/results/kord.json").writeText(sb.toString())

    val passCount = results.count { it.status == "pass" }
    println("kord done: $passCount/${results.size} pass (real calls: $realCallCount, n-a: $naCount)")
}
