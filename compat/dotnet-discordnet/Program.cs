// Discord.Net.Rest compatibility verifier.
//
// Discord.Net.Rest overrides its REST base URL via `DiscordRestConfig.RestClientProvider`,
// a factory that ignores the URL Discord.Net would normally pass in and always returns a
// client pointed at Fauxcord instead (see docs/libraries.md:
// `RestClientProvider = _ => DefaultRestClientProvider.Instance(FAUXCORD_BASE)`).
// `LoginAsync(TokenType.Bot, token)` takes the *raw* bot token (no "Bot " prefix);
// Discord.Net adds the prefix itself when building the Authorization header.
//
// Discord.Net.Rest is an object-model library (like discord.js/Oceanic/discordgo), so each
// canonical endpoint is mapped to a concrete high-level method on RestGuild/RestTextChannel/
// RestUserMessage/etc. Endpoints with no public wrapper in the Rest-only package are recorded
// as "n-a" with an evidence note, most notably:
//   - Token-authenticated webhook endpoints (GET/PATCH/DELETE /webhooks/{id}/{token}, the
//     webhook-message sub-resource endpoints, and the webhook-execute POST): this surface is
//     unauthenticated-by-token and lives in the separate Discord.Net.Webhook package
//     (DiscordWebhookClient), which is out of scope for a Discord.Net.Rest-only verifier.
//   - The new-format `/channels/{id}/messages/pins*` API: Discord.Net's Pin/Unpin/
//     GetPinnedMessagesAsync wrappers target the legacy `/channels/{id}/pins` endpoints only.
//   - Gateway bootstrap endpoints (`/gateway`, `/gateway/bot`): internal to the Socket/Sharded
//     client connection flow; DiscordRestClient never calls them and exposes no wrapper.
//   - OAuth2 authorization-code-flow endpoints (`/oauth2/@me`, `/oauth2/token`,
//     `/oauth2/token/revoke`) and `/users/@me/guilds`: these serve the OAuth2 user-grant flow
//     (a separate use case with its own token type), not the bot-token Rest client used here.
//
// Destructive calls that would break later rows sharing the same resource (deleting the
// shared guild/channel/role/webhook that other rows still depend on) are skipped and recorded
// as "n-a" with a "not exercised: ..." note, matching the pattern used by the other verifiers.
//
// The canonical endpoint order interleaves some DELETE/GET calls before the PUT/POST that
// creates the resource they act on. Running all non-DELETEs first, then DELETEs last, avoids
// false "Unknown X" errors from resource-lifecycle ordering rather than real Fauxcord/library
// bugs (same fix as the other verifiers).
//
// NOTE ON UNCERTAIN METHODS: a handful of Discord.Net.Rest method names/overloads below are
// flagged "UNCERTAIN" in inline comments because this file was written from documentation and
// prior knowledge without a live NuGet restore/compile to confirm exact signatures (the build
// host here is deliberately network/IO constrained). Please double-check those specific calls
// against the actual installed package before trusting a "pass"/"lib-issue" result for them.

using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Discord;
using Discord.Rest;

var jsonOpts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

var fauxcordBase = Environment.GetEnvironmentVariable("FAUXCORD_BASE");
if (string.IsNullOrEmpty(fauxcordBase))
{
    fauxcordBase = "http://fauxcord:3000/api/v10/";
}
if (!fauxcordBase.EndsWith('/'))
{
    fauxcordBase += "/";
}
// Derive the origin (scheme://host:port) from the API base for /_mock and /_test calls.
var origin = fauxcordBase;
if (origin.EndsWith("/api/v10/", StringComparison.Ordinal))
{
    origin = origin[..^"api/v10/".Length];
}
origin = origin.TrimEnd('/');

var http = new HttpClient();

await WaitHealthyAsync(http, origin);

var setupRaw = await File.ReadAllTextAsync("common/setup.json");
await DoSetupAsync(http, origin, setupRaw);

var setup = JsonSerializer.Deserialize<SetupPayload>(setupRaw, jsonOpts)
    ?? throw new InvalidOperationException("failed to parse common/setup.json");

var endpointsRaw = await File.ReadAllTextAsync("common/endpoints.json");
var endpoints = JsonSerializer.Deserialize<List<EndpointDef>>(endpointsRaw, jsonOpts)
    ?? throw new InvalidOperationException("failed to parse common/endpoints.json");

var botId = ulong.Parse(setup.User.Id);
var guildId = ulong.Parse(setup.Guilds[0].Id);
var channelId = ulong.Parse(setup.Guilds[0].Channels[0].Id);
var rawToken = setup.Token.StartsWith("Bot ", StringComparison.Ordinal)
    ? setup.Token["Bot ".Length..]
    : setup.Token;

const string PngDataUri =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

// discordgo/Oceanic pass the raw emoji character to their own internal
// URL-encoding step; Discord.Net's IEmote/Emoji does the same, so use the
// raw character here too.
var reactionEmoji = new Emoji("👍");

// Force the Rest client's base URL to Fauxcord regardless of what Discord.Net
// would normally pass in (the real Discord API URL) — mirrors docs/libraries.md.
var config = new DiscordRestConfig
{
    RestClientProvider = _ => DefaultRestClientProvider.Instance(fauxcordBase),
};

var client = new DiscordRestClient(config);
await client.LoginAsync(TokenType.Bot, rawToken);

// Bootstrap resources referenced by later calls, mirroring the JS/Go verifiers.
// Fall back to placeholder ids when bootstrap itself fails, so the endpoint
// calls below still exercise the wire format.
ulong msgId = 400000000000000001;
ulong bulk1Id = 400000000000000002;
ulong bulk2Id = 400000000000000003;
ulong threadId = channelId;
ulong roleId = guildId;
ulong webhookId = 500000000000000001;
var webhookToken = "compat-token-xyz";
var inviteCode = "compat";
ulong emojiId = 600000000000000001;

RestTextChannel? channel = null;
RestGuild? guild = null;
RestUserMessage? msg = null;
RestRole? role = null;
RestWebhook? webhook = null;
GuildEmote? emoji = null;

try
{
    channel = (RestTextChannel)await client.GetChannelAsync(channelId);
}
catch
{
    // fall through; per-call try/catch below records the real failure per-endpoint
}

try
{
    guild = await client.GetGuildAsync(guildId);
}
catch
{
    // ditto
}

try
{
    if (channel is not null)
    {
        msg = await channel.SendMessageAsync("compat");
        msgId = msg.Id;
    }
}
catch
{
    /* fall back to placeholder id */
}

try
{
    if (channel is not null)
    {
        var b1 = await channel.SendMessageAsync("compat-bulk-1");
        var b2 = await channel.SendMessageAsync("compat-bulk-2");
        bulk1Id = b1.Id;
        bulk2Id = b2.Id;
    }
}
catch
{
    /* fall back to placeholder ids */
}

try
{
    if (guild is not null)
    {
        role = await guild.CreateRoleAsync("compat-role");
        roleId = role.Id;
    }
}
catch
{
    // fall back: the @everyone role id == the guild id in fauxcord
}

try
{
    if (channel is not null)
    {
        webhook = await channel.CreateWebhookAsync("compat-wh");
        webhookId = webhook.Id;
        webhookToken = webhook.Token ?? webhookToken;
    }
}
catch
{
    /* fall back to placeholder ids */
}

try
{
    if (channel is not null)
    {
        var invite = await channel.CreateInviteAsync();
        inviteCode = invite.Code;
    }
}
catch
{
    /* fall back to placeholder code */
}

try
{
    if (guild is not null)
    {
        using var stream = DataUriToStream(PngDataUri);
        emoji = await guild.CreateEmoteAsync("compat", new Image(stream));
        emojiId = emoji.Id;
    }
}
catch
{
    /* fall back to placeholder id */
}

try
{
    if (msg is not null)
    {
        await msg.AddReactionAsync(reactionEmoji);
    }
}
catch
{
    // ignore: reaction endpoints below still exercise the wire format
}

// Endpoint key -> call entry. `Fn == null` => n-a (Note required).
var calls = new Dictionary<string, CallEntry>
{
    ["GET /channels/{channel_id}/invites"] = new(async () =>
    {
        _ = await channel!.GetInvitesAsync();
    }),
    ["POST /channels/{channel_id}/invites"] = new(async () =>
    {
        _ = await channel!.CreateInviteAsync();
    }),
    // UNCERTAIN: RemoveReactionAsync(IEmote, ulong userId, ...) overload — believed to
    // exist alongside the IUser overload, but not confirmed against a live package.
    ["DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}"] = new(async () =>
    {
        await msg!.RemoveReactionAsync(reactionEmoji, botId);
    }),
    ["DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me"] = new(async () =>
    {
        await msg!.RemoveReactionAsync(reactionEmoji, client.CurrentUser.Id);
    }),
    ["PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me"] = new(async () =>
    {
        await msg!.AddReactionAsync(reactionEmoji);
    }),
    ["GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}"] = new(async () =>
    {
        _ = await msg!.GetReactionUsersAsync(reactionEmoji, 100).FlattenAsync();
    }),
    ["DELETE /channels/{channel_id}/messages/{message_id}/reactions"] = new(async () =>
    {
        await msg!.RemoveAllReactionsAsync();
    }),
    // UNCERTAIN: assumes CreateThreadAsync has a `message:` named parameter to target the
    // thread-from-message endpoint (vs. the standalone-thread endpoint used below).
    ["POST /channels/{channel_id}/messages/{message_id}/threads"] = new(async () =>
    {
        _ = await channel!.CreateThreadAsync("compat-thread", message: msg);
    }),
    ["DELETE /channels/{channel_id}/messages/{message_id}"] = new(async () =>
    {
        await msg!.DeleteAsync();
    }),
    ["GET /channels/{channel_id}/messages/{message_id}"] = new(async () =>
    {
        _ = await channel!.GetMessageAsync(msgId);
    }),
    ["PATCH /channels/{channel_id}/messages/{message_id}"] = new(async () =>
    {
        await msg!.ModifyAsync(x => x.Content = "compat-edit");
    }),
    // UNCERTAIN: assumes an IEnumerable<ulong> overload of DeleteMessagesAsync exists
    // alongside the IEnumerable<IMessage> one.
    ["POST /channels/{channel_id}/messages/bulk-delete"] = new(async () =>
    {
        await channel!.DeleteMessagesAsync(new[] { bulk1Id, bulk2Id });
    }),
    ["DELETE /channels/{channel_id}/messages/pins/{message_id}"] = new(
        null,
        "Discord.Net's UnpinAsync targets the legacy /channels/{id}/pins endpoint, not the new /messages/pins API"),
    ["PUT /channels/{channel_id}/messages/pins/{message_id}"] = new(
        null,
        "Discord.Net's PinAsync targets the legacy /channels/{id}/pins endpoint, not the new /messages/pins API"),
    ["GET /channels/{channel_id}/messages/pins"] = new(
        null,
        "Discord.Net's GetPinnedMessagesAsync targets the legacy /channels/{id}/pins endpoint, not the new /messages/pins API"),
    ["GET /channels/{channel_id}/messages"] = new(async () =>
    {
        _ = await channel!.GetMessagesAsync(50).FlattenAsync();
    }),
    ["POST /channels/{channel_id}/messages"] = new(async () =>
    {
        _ = await channel!.SendMessageAsync("compat");
    }),
    ["DELETE /channels/{channel_id}/permissions/{overwrite_id}"] = new(async () =>
    {
        var botUser = await client.GetUserAsync(botId);
        await channel!.RemovePermissionOverwriteAsync(botUser);
    }),
    ["PUT /channels/{channel_id}/permissions/{overwrite_id}"] = new(async () =>
    {
        var botUser = await client.GetUserAsync(botId);
        await channel!.AddPermissionOverwriteAsync(botUser, new OverwritePermissions());
    }),
    ["DELETE /channels/{channel_id}/pins/{message_id}"] = new(async () =>
    {
        await msg!.UnpinAsync();
    }),
    ["PUT /channels/{channel_id}/pins/{message_id}"] = new(async () =>
    {
        await msg!.PinAsync();
    }),
    ["GET /channels/{channel_id}/pins"] = new(async () =>
    {
        _ = await channel!.GetPinnedMessagesAsync();
    }),
    // UNCERTAIN: no confirmed single-member GET wrapper on IThreadChannel; only the
    // list-returning GetUsersAsync() below is documented with confidence.
    ["GET /channels/{channel_id}/thread-members/{user_id}"] = new(
        null,
        "no confirmed single-member GET wrapper on IThreadChannel; only the paged GetUsersAsync() (list) is documented"),
    ["DELETE /channels/{channel_id}/thread-members/{user_id}"] = new(async () =>
    {
        var thread = (RestThreadChannel)await client.GetChannelAsync(threadId);
        var guildUser = await guild!.GetUserAsync(botId);
        await thread.RemoveUserAsync(guildUser);
    }),
    ["PUT /channels/{channel_id}/thread-members/{user_id}"] = new(async () =>
    {
        var thread = (RestThreadChannel)await client.GetChannelAsync(threadId);
        var guildUser = await guild!.GetUserAsync(botId);
        await thread.AddUserAsync(guildUser);
    }),
    ["DELETE /channels/{channel_id}/thread-members/@me"] = new(async () =>
    {
        var thread = (RestThreadChannel)await client.GetChannelAsync(threadId);
        await thread.LeaveAsync();
    }),
    ["PUT /channels/{channel_id}/thread-members/@me"] = new(async () =>
    {
        var thread = (RestThreadChannel)await client.GetChannelAsync(threadId);
        await thread.JoinAsync();
    }),
    ["GET /channels/{channel_id}/thread-members"] = new(async () =>
    {
        var thread = (RestThreadChannel)await client.GetChannelAsync(threadId);
        _ = await thread.GetUsersAsync().FlattenAsync();
    }),
    ["GET /channels/{channel_id}/threads/archived/private"] = new(async () =>
    {
        _ = await channel!.GetPrivateArchivedThreadsAsync().FlattenAsync();
    }),
    ["GET /channels/{channel_id}/threads/archived/public"] = new(async () =>
    {
        _ = await channel!.GetPublicArchivedThreadsAsync().FlattenAsync();
    }),
    ["GET /channels/{channel_id}/threads/search"] = new(
        null,
        "no high-level wrapper for the thread search endpoint"),
    ["POST /channels/{channel_id}/threads"] = new(async () =>
    {
        var thread = await channel!.CreateThreadAsync("compat-thread2");
        threadId = thread.Id;
    }),
    ["POST /channels/{channel_id}/typing"] = new(async () =>
    {
        await channel!.TriggerTypingAsync();
    }),
    ["GET /channels/{channel_id}/users/@me/threads/archived/private"] = new(async () =>
    {
        _ = await channel!.GetJoinedPrivateArchivedThreadsAsync().FlattenAsync();
    }),
    ["GET /channels/{channel_id}/webhooks"] = new(async () =>
    {
        _ = await channel!.GetWebhooksAsync();
    }),
    ["POST /channels/{channel_id}/webhooks"] = new(async () =>
    {
        _ = await channel!.CreateWebhookAsync("compat-wh2");
    }),
    ["DELETE /channels/{channel_id}"] = new(
        null,
        "not exercised: would delete the shared test channel other rows depend on"),
    ["GET /channels/{channel_id}"] = new(async () =>
    {
        _ = await client.GetChannelAsync(channelId);
    }),
    ["PATCH /channels/{channel_id}"] = new(async () =>
    {
        await channel!.ModifyAsync(x => x.Name = "general");
    }),
    ["GET /gateway/bot"] = new(
        null,
        "gateway bootstrap info is internal to the Socket/Sharded client connection flow; DiscordRestClient exposes no wrapper"),
    ["GET /gateway"] = new(
        null,
        "gateway bootstrap info is internal to the Socket/Sharded client connection flow; DiscordRestClient exposes no wrapper"),
    ["DELETE /guilds/{guild_id}/bans/{user_id}"] = new(async () =>
    {
        await guild!.RemoveBanAsync(botId);
    }),
    ["GET /guilds/{guild_id}/bans/{user_id}"] = new(async () =>
    {
        _ = await guild!.GetBanAsync(botId);
    }),
    ["PUT /guilds/{guild_id}/bans/{user_id}"] = new(async () =>
    {
        await guild!.AddBanAsync(botId, pruneDays: 0, reason: "compat");
    }),
    // UNCERTAIN: GetBansAsync() is treated as paged (IAsyncEnumerable), matching
    // GetUsersAsync()'s shape; older Discord.Net versions may return a plain
    // Task<IReadOnlyCollection<RestBan>> instead.
    ["GET /guilds/{guild_id}/bans"] = new(async () =>
    {
        _ = await guild!.GetBansAsync().FlattenAsync();
    }),
    ["GET /guilds/{guild_id}/channels"] = new(async () =>
    {
        _ = await guild!.GetChannelsAsync();
    }),
    ["POST /guilds/{guild_id}/channels"] = new(async () =>
    {
        _ = await guild!.CreateTextChannelAsync("compat-channel");
    }),
    ["DELETE /guilds/{guild_id}/emojis/{emoji_id}"] = new(async () =>
    {
        await guild!.DeleteEmoteAsync(emoji!);
    }),
    ["GET /guilds/{guild_id}/emojis/{emoji_id}"] = new(async () =>
    {
        _ = await guild!.GetEmoteAsync(emojiId);
    }),
    ["PATCH /guilds/{guild_id}/emojis/{emoji_id}"] = new(async () =>
    {
        emoji = await guild!.ModifyEmoteAsync(emoji!, x => x.Name = "compat2");
    }),
    ["GET /guilds/{guild_id}/emojis"] = new(async () =>
    {
        _ = await guild!.GetEmotesAsync();
    }),
    ["POST /guilds/{guild_id}/emojis"] = new(async () =>
    {
        using var stream = DataUriToStream(PngDataUri);
        _ = await guild!.CreateEmoteAsync("compat3", new Image(stream));
    }),
    ["DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}"] = new(async () =>
    {
        var guildUser = await guild!.GetUserAsync(botId);
        await guildUser.RemoveRoleAsync(role!);
    }),
    ["PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}"] = new(async () =>
    {
        var guildUser = await guild!.GetUserAsync(botId);
        await guildUser.AddRoleAsync(role!);
    }),
    ["DELETE /guilds/{guild_id}/members/{user_id}"] = new(
        null,
        "not exercised: would remove the bot itself from the shared test guild"),
    ["GET /guilds/{guild_id}/members/{user_id}"] = new(async () =>
    {
        _ = await guild!.GetUserAsync(botId);
    }),
    ["PATCH /guilds/{guild_id}/members/{user_id}"] = new(async () =>
    {
        var guildUser = await guild!.GetUserAsync(botId);
        await guildUser.ModifyAsync(x => x.Nickname = "compat");
    }),
    ["GET /guilds/{guild_id}/members"] = new(async () =>
    {
        _ = await guild!.GetUsersAsync().FlattenAsync();
    }),
    ["DELETE /guilds/{guild_id}/roles/{role_id}"] = new(
        null,
        "not exercised: would remove the role other rows (member-role add/remove) still need"),
    ["PATCH /guilds/{guild_id}/roles/{role_id}"] = new(async () =>
    {
        await role!.ModifyAsync(x => x.Name = "compat-role-renamed");
    }),
    // UNCERTAIN: RestGuild does not appear to expose a dedicated "fetch roles fresh"
    // async wrapper for this endpoint — the Roles collection is populated from the
    // cached guild payload obtained via GET /guilds/{id} instead. If a GetRolesAsync()
    // does exist on a current RestGuild, this should be switched to "pass".
    ["GET /guilds/{guild_id}/roles"] = new(
        null,
        "no confirmed dedicated wrapper; RestGuild.Roles is populated from the cached guild object (from GET /guilds/{id}), not a fresh call to this endpoint"),
    ["POST /guilds/{guild_id}/roles"] = new(async () =>
    {
        _ = await guild!.CreateRoleAsync("compat-role2");
    }),
    ["GET /guilds/{guild_id}/webhooks"] = new(async () =>
    {
        _ = await guild!.GetWebhooksAsync();
    }),
    ["DELETE /guilds/{guild_id}"] = new(
        null,
        "not exercised: would delete the shared test guild other rows depend on"),
    ["GET /guilds/{guild_id}"] = new(async () =>
    {
        _ = await client.GetGuildAsync(guildId);
    }),
    ["PATCH /guilds/{guild_id}"] = new(async () =>
    {
        await guild!.ModifyAsync(x => x.Name = "Compat Guild");
    }),
    ["DELETE /invites/{code}"] = new(async () =>
    {
        var invite = await client.GetInviteAsync(inviteCode);
        if (invite is not null)
        {
            await invite.DeleteAsync();
        }
    }),
    ["GET /invites/{code}"] = new(async () =>
    {
        _ = await client.GetInviteAsync(inviteCode);
    }),
    ["GET /oauth2/@me"] = new(
        null,
        "OAuth2 user-grant '@me' authorization info has no wrapper on the bot-token DiscordRestClient"),
    ["GET /oauth2/applications/@me"] = new(async () =>
    {
        _ = await client.GetApplicationInfoAsync();
    }),
    ["POST /oauth2/token/revoke"] = new(
        null,
        "OAuth2 authorization-code-flow token exchange/revocation is not exposed by the bot-token DiscordRestClient"),
    ["POST /oauth2/token"] = new(
        null,
        "OAuth2 authorization-code-flow token exchange/revocation is not exposed by the bot-token DiscordRestClient"),
    ["GET /users/{user_id}"] = new(async () =>
    {
        _ = await client.GetUserAsync(botId);
    }),
    ["GET /users/@me/guilds"] = new(
        null,
        "serves the OAuth2 user-grant guild list; not exposed by the bot-token DiscordRestClient (bots discover guilds via the gateway READY payload instead)"),
    ["GET /users/@me"] = new(async () =>
    {
        _ = await client.GetCurrentUserAsync();
    }),
    ["PATCH /users/@me"] = new(async () =>
    {
        await client.CurrentUser.ModifyAsync(x => x.Username = "CompatBot");
    }),
    ["DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}"] = new(
        null,
        "token-authenticated webhook-message endpoints belong to the separate Discord.Net.Webhook package (DiscordWebhookClient), out of scope for a Rest-only verifier"),
    ["GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}"] = new(
        null,
        "token-authenticated webhook-message endpoints belong to the separate Discord.Net.Webhook package (DiscordWebhookClient), out of scope for a Rest-only verifier"),
    ["PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}"] = new(
        null,
        "token-authenticated webhook-message endpoints belong to the separate Discord.Net.Webhook package (DiscordWebhookClient), out of scope for a Rest-only verifier"),
    ["DELETE /webhooks/{webhook_id}/{webhook_token}"] = new(
        null,
        "not exercised (would delete the shared webhook other rows still need); also token-authenticated webhook access is Discord.Net.Webhook's responsibility, not Discord.Net.Rest's"),
    ["GET /webhooks/{webhook_id}/{webhook_token}"] = new(
        null,
        "token-authenticated (unauthenticated) webhook GET belongs to the separate Discord.Net.Webhook package; DiscordRestClient only exposes the bot-authenticated GetWebhookAsync(id) overload"),
    ["PATCH /webhooks/{webhook_id}/{webhook_token}"] = new(
        null,
        "token-authenticated (unauthenticated) webhook PATCH belongs to the separate Discord.Net.Webhook package; use the bot-authenticated RestWebhook.ModifyAsync() instead"),
    ["POST /webhooks/{webhook_id}/{webhook_token}"] = new(
        null,
        "webhook execute (token-authenticated) belongs to the separate Discord.Net.Webhook package (DiscordWebhookClient), out of scope for a Rest-only verifier"),
    ["DELETE /webhooks/{webhook_id}"] = new(
        null,
        "not exercised: would delete the shared webhook other rows still need"),
    ["GET /webhooks/{webhook_id}"] = new(async () =>
    {
        _ = await client.GetWebhookAsync(webhookId);
    }),
    ["PATCH /webhooks/{webhook_id}"] = new(async () =>
    {
        await webhook!.ModifyAsync(x => x.Name = "compat-renamed2");
    }),
};

// Run all non-DELETE endpoints first, then DELETEs last, to avoid false
// "Unknown X" errors from resource-lifecycle ordering rather than real bugs.
var ordered = endpoints
    .OrderBy(e => e.Method.Equals("DELETE", StringComparison.OrdinalIgnoreCase) ? 1 : 0)
    .ToList();

var results = new List<ResultRow>();
foreach (var ep in ordered)
{
    var key = $"{ep.Method} {ep.Path}";
    if (!calls.TryGetValue(key, out var entry) || entry.Fn is null)
    {
        results.Add(new ResultRow(
            key,
            "n-a",
            entry?.Note ?? "no high-level Discord.Net.Rest method found for this endpoint"));
        continue;
    }

    try
    {
        await entry.Fn();
        results.Add(new ResultRow(key, "pass", ""));
    }
    catch (Exception ex)
    {
        var message = ex.Message;
        if (message.Length > 300)
        {
            message = message[..300];
        }
        results.Add(new ResultRow(key, "lib-issue", message));
    }
}

var report = new Report(
    "Discord.Net.Rest",
    // Kept in sync with DiscordNetVerify.csproj's PackageReference version — see the
    // uncertainty note there re: docs/libraries.md's "3.20.0".
    "3.15.2",
    true,
    results);

var outputOpts = new JsonSerializerOptions
{
    WriteIndented = true,
    DefaultIgnoreCondition = JsonIgnoreCondition.Never,
};
Directory.CreateDirectory("/results");
await File.WriteAllTextAsync("/results/discordnet.json", JsonSerializer.Serialize(report, outputOpts), Encoding.UTF8);

Console.WriteLine($"discordnet done: {results.Count(r => r.Status == "pass")}/{results.Count} pass");

/// <summary>
/// Polls the Fauxcord health endpoint until it responds 200 OK, or throws after ~60s.
/// </summary>
static async Task WaitHealthyAsync(HttpClient http, string origin)
{
    for (var i = 0; i < 60; i++)
    {
        try
        {
            var resp = await http.GetAsync($"{origin}/_mock/health");
            if (resp.IsSuccessStatusCode)
            {
                return;
            }
        }
        catch
        {
            // not up yet
        }
        await Task.Delay(1000);
    }
    throw new InvalidOperationException("fauxcord did not become healthy");
}

/// <summary>
/// POSTs the shared setup payload. 200/201 (created) and 409 (already set
/// up by a prior run against a reused Fauxcord container) both count as
/// success. Retries with backoff on network errors or unexpected statuses:
/// a transient host I/O hiccup here previously caused the setup POST to
/// fail silently in another verifier (see js-oceanic/verify.mjs's doSetup
/// docstring for the incident), which left the guild/channel fixtures
/// missing while the rest of the run proceeded anyway and produced a wave
/// of bogus "Unknown Guild"/"Unknown Channel" results with no real signal.
/// Throws if setup never succeeds so a genuine failure is loud instead of
/// corrupting every downstream result.
/// </summary>
static async Task DoSetupAsync(HttpClient http, string origin, string rawSetupJson)
{
    const int maxAttempts = 5;
    System.Net.HttpStatusCode? lastStatus = null;
    Exception? lastError = null;
    for (var attempt = 1; attempt <= maxAttempts; attempt++)
    {
        try
        {
            var content = new StringContent(rawSetupJson, Encoding.UTF8, "application/json");
            var res = await http.PostAsync($"{origin}/_test/setup", content);
            if (res.IsSuccessStatusCode || res.StatusCode == System.Net.HttpStatusCode.Conflict)
            {
                return;
            }
            lastStatus = res.StatusCode;
        }
        catch (Exception e)
        {
            lastError = e;
        }
        if (attempt < maxAttempts)
        {
            await Task.Delay(TimeSpan.FromSeconds(attempt));
        }
    }
    throw new InvalidOperationException(
        $"DoSetupAsync: failed to POST /_test/setup after {maxAttempts} attempts " +
        $"(lastStatus={lastStatus}, lastError={lastError})");
}

/// <summary>
/// Decodes a `data:image/...;base64,...` URI into a seekable stream suitable for
/// Discord.Net's <see cref="Image"/> constructor.
/// </summary>
static Stream DataUriToStream(string dataUri)
{
    var base64 = dataUri[(dataUri.IndexOf(',') + 1)..];
    var bytes = Convert.FromBase64String(base64);
    return new MemoryStream(bytes);
}

/// <summary>One canonical (method, path) pair from common/endpoints.json.</summary>
internal sealed class EndpointDef
{
    [JsonPropertyName("method")]
    public string Method { get; set; } = "";

    [JsonPropertyName("path")]
    public string Path { get; set; } = "";
}

/// <summary>One channel entry in common/setup.json.</summary>
internal sealed class SetupChannel
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("type")]
    public int Type { get; set; }
}

/// <summary>One guild entry in common/setup.json.</summary>
internal sealed class SetupGuild
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("channels")]
    public List<SetupChannel> Channels { get; set; } = new();
}

/// <summary>The user entry in common/setup.json.</summary>
internal sealed class SetupUser
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("username")]
    public string Username { get; set; } = "";
}

/// <summary>Mirrors the shape of common/setup.json.</summary>
internal sealed class SetupPayload
{
    [JsonPropertyName("token")]
    public string Token { get; set; } = "";

    [JsonPropertyName("user")]
    public SetupUser User { get; set; } = new();

    [JsonPropertyName("guilds")]
    public List<SetupGuild> Guilds { get; set; } = new();
}

/// <summary>Maps one endpoint to either an executable probe (Fn) or an n-a Note.</summary>
internal sealed class CallEntry
{
    public Func<Task>? Fn { get; }
    public string? Note { get; }

    public CallEntry(Func<Task> fn)
    {
        Fn = fn;
        Note = null;
    }

    public CallEntry(Func<Task>? fn, string note)
    {
        Fn = fn;
        Note = note;
    }
}

/// <summary>One row of the output report for a single canonical endpoint.</summary>
internal sealed record ResultRow(
    [property: JsonPropertyName("endpoint")] string Endpoint,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("note")] string Note);

/// <summary>The final JSON document written to /results/discordnet.json.</summary>
internal sealed record Report(
    [property: JsonPropertyName("library")] string Library,
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("baseUrlOverridable")] bool BaseUrlOverridable,
    [property: JsonPropertyName("results")] List<ResultRow> Results);
