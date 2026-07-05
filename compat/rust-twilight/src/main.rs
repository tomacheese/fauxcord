// Twilight compatibility verifier.
//
// FEASIBILITY: twilight-http's `ClientBuilder` has a documented `.proxy(host,
// use_http)` method, intended for redirecting all REST traffic through
// "twilight's HTTP proxy server" (see the docs.rs page for
// `twilight_http::client::ClientBuilder::proxy`). Confirmed signature:
// `pub fn proxy(self, proxy_url: String, use_http: bool) -> Self`.
//
// Unlike serenity's `.proxy(url)` (which takes a full URL: scheme + host +
// port) or Discord.Net's/discordgo's overrides (which want the *full* base
// including `/api/v10/`), twilight's `proxy_url` argument is HOST:PORT ONLY
// — no scheme, no `/api` path. Twilight's own route-building code appends
// `/api/vN/...` itself, and the `use_http` bool separately controls
// http-vs-https. So the value handed to `.proxy()` here is derived from
// `FAUXCORD_BASE` by stripping both the scheme and the `/api/v10` suffix
// (e.g. `http://fauxcord:3000/api/v10` -> `fauxcord:3000`), with
// `use_http: true` passed alongside it; see `bare_host_from` below.
//
// CONFIDENCE CAVEAT (read before assuming this file compiles as-is): unlike
// rust-serenity (authored from training-data knowledge with no network
// access), this file's method names and signatures were checked in this
// session against the actual `twilight-http-0.16.0` tag of
// https://github.com/twilight-rs/twilight (via `gh api
// repos/twilight-rs/twilight/contents/...`) and against docs.rs/twilight-http
// 0.16.0. That said, `cargo build`/`cargo check` were still NOT run in this
// environment (disallowed by this task's constraints), so:
//   - The `.proxy()` mechanism itself, the overall `IntoFuture`-based
//     `builder.method(...).await` call shape (confirmed directly from
//     `create_message.rs`'s `impl IntoFuture`), and the majority of the
//     endpoint-to-method mappings below are HIGH confidence (read from the
//     pinned tag's actual source, not reconstructed from memory).
//   - A handful of items were not directly inspected line-by-line in this
//     session and are flagged inline with `// UNCERTAIN:` where they occur
//     (mainly: exact `AutoArchiveDuration`/`ChannelType` variant names used
//     for thread bootstrap, and whether `twilight-http`'s default feature
//     set pulls in a working TLS backend without extra Cargo.toml feature
//     flags).
//   - If a real `cargo build` disagrees with a signature here, treat it as a
//     signature-detail bug to fix, not evidence the `.proxy()` override
//     itself is unsound (that part is corroborated by both the docs.rs page
//     and this task's brief).
//
// AWAIT STYLE: twilight-http request builders implement `std::future::
// IntoFuture` directly (see `create_message.rs`: `impl IntoFuture for
// CreateMessage<'_> { type Output = Result<Response<T>, Error>; ... }`).
// There is no separate `.exec()` step (that was an older twilight-http API,
// pre-0.16) — you call `client.method(...).builder_calls().await` directly,
// getting back `Result<Response<T>, Error>`. Deserializing the body further
// requires an additional `.model().await`, which this file only does where
// the bootstrap needs a real ID out of the response (message/thread/role/
// webhook/invite/emoji creation); endpoint-matrix probes that don't need the
// body just check `.await.is_ok()`.
//
// UNCERTAIN: GET /gateway/bot via `client.gateway().authed().await` is a
// real bot-authed endpoint per docs.rs, but has not been exercised against
// Fauxcord in this offline session (recorded as a real call, not n-a).

use serde_json::Value;
use std::fs;
use std::time::Duration;
use twilight_http::request::channel::reaction::RequestReactionType;
use twilight_http::Client;
use twilight_model::channel::thread::AutoArchiveDuration;
use twilight_model::channel::ChannelType;
use twilight_model::guild::Permissions;
use twilight_model::http::permission_overwrite::{PermissionOverwrite, PermissionOverwriteType};
use twilight_model::id::marker::{
    ChannelMarker, EmojiMarker, GuildMarker, MessageMarker, RoleMarker, UserMarker, WebhookMarker,
};
use twilight_model::id::Id;

/// One canonical (method, path) pair from common/endpoints.json.
#[derive(serde::Deserialize, Clone)]
struct Endpoint {
    method: String,
    path: String,
}

/// One row of the output report for a single canonical endpoint.
#[derive(serde::Serialize)]
struct EndpointResult {
    endpoint: String,
    status: &'static str,
    note: String,
}

/// The final JSON document written to /results/twilight.json.
#[derive(serde::Serialize)]
struct Report {
    library: &'static str,
    version: &'static str,
    #[serde(rename = "baseUrlOverridable")]
    base_url_overridable: bool,
    results: Vec<EndpointResult>,
}

/// Resources bootstrapped before the endpoint matrix runs, so later calls
/// (edit/delete/get on a message, member-role add/remove, etc.) have a real
/// target instead of a synthetic id that would 404.
struct Ctx {
    bot: Id<UserMarker>,
    guild: Id<GuildMarker>,
    channel: Id<ChannelMarker>,
    message: Id<MessageMarker>,
    bulk_a: Id<MessageMarker>,
    bulk_b: Id<MessageMarker>,
    thread: Id<ChannelMarker>,
    role: Id<RoleMarker>,
    emoji: Id<EmojiMarker>,
    webhook_id: Id<WebhookMarker>,
    webhook_token: String,
    webhook_msg: Option<Id<MessageMarker>>,
    invite_code: String,
}

/// Derives the bare origin (scheme+host+port, no path) used for the plain
/// `reqwest` health-check/setup calls, from the `/api/v10`-suffixed
/// `FAUXCORD_BASE` used by every other verifier in this repo.
fn origin_from(base: &str) -> String {
    let trimmed = base.trim_end_matches('/');
    let trimmed = trimmed.strip_suffix("/api/v10").unwrap_or(trimmed);
    trimmed.to_string()
}

/// Derives the bare `host:port` (no scheme) that twilight's
/// `ClientBuilder::proxy()` expects, from the scheme-including origin
/// returned by `origin_from`. Twilight's route-building code appends
/// `/api/vN/...` itself and takes the http-vs-https choice as a separate
/// `bool` argument, so the scheme must not be part of this string.
fn bare_host_from(origin: &str) -> String {
    origin
        .strip_prefix("https://")
        .or_else(|| origin.strip_prefix("http://"))
        .unwrap_or(origin)
        .to_string()
}

/// Polls the SUT health endpoint until it responds 200 OK.
async fn wait_healthy(client: &reqwest::Client, origin: &str) {
    let url = format!("{origin}/_mock/health");
    for _ in 0..60 {
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                return;
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    eprintln!("fauxcord did not become healthy in time; continuing anyway");
}

/// POSTs the shared setup payload. 200/201 (created) and 409 (already set
/// up by a prior run against a reused Fauxcord container) both count as
/// success. Retries with backoff on network errors or unexpected statuses:
/// a transient host I/O hiccup here previously caused the setup POST to
/// fail silently in another verifier (see js-oceanic/verify.mjs's doSetup
/// docstring for the incident, and rust-serenity/src/main.rs's `do_setup`
/// for the same fix applied there), which left the guild/channel fixtures
/// missing while the rest of the run proceeded anyway and produced a wave
/// of bogus "Unknown Guild"/"Unknown Channel" results with no real signal.
/// Panics if setup never succeeds so a genuine failure is loud instead of
/// corrupting every downstream result.
async fn do_setup(client: &reqwest::Client, origin: &str, raw: &str) {
    const MAX_ATTEMPTS: u32 = 5;
    let mut last_status: Option<reqwest::StatusCode> = None;
    let mut last_error: Option<String> = None;
    for attempt in 1..=MAX_ATTEMPTS {
        match client
            .post(format!("{origin}/_test/setup"))
            .header("content-type", "application/json")
            .body(raw.to_string())
            .send()
            .await
        {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() || status == reqwest::StatusCode::CONFLICT {
                    return;
                }
                last_status = Some(status);
            }
            Err(e) => {
                last_error = Some(e.to_string());
            }
        }
        if attempt < MAX_ATTEMPTS {
            tokio::time::sleep(Duration::from_secs(attempt as u64)).await;
        }
    }
    panic!(
        "do_setup: failed to POST /_test/setup after {MAX_ATTEMPTS} attempts \
         (last_status={last_status:?}, last_error={last_error:?})"
    );
}

#[tokio::main]
async fn main() {
    let base =
        std::env::var("FAUXCORD_BASE").unwrap_or_else(|_| "http://fauxcord:3000/api/v10".into());
    let origin = origin_from(&base);
    let bare_host = bare_host_from(&origin);

    let plain_client = reqwest::Client::new();
    wait_healthy(&plain_client, &origin).await;

    let setup_raw = fs::read_to_string("common/setup.json").expect("read common/setup.json");
    do_setup(&plain_client, &origin, &setup_raw).await;
    let setup: Value = serde_json::from_str(&setup_raw).expect("parse common/setup.json");

    let endpoints_raw =
        fs::read_to_string("common/endpoints.json").expect("read common/endpoints.json");
    let endpoints: Vec<Endpoint> =
        serde_json::from_str(&endpoints_raw).expect("parse common/endpoints.json");

    let token = setup["token"].as_str().expect("setup.token").to_string();
    let bot_id: u64 = setup["user"]["id"]
        .as_str()
        .expect("setup.user.id")
        .parse()
        .expect("bot id is numeric");
    let guild_id: u64 = setup["guilds"][0]["id"]
        .as_str()
        .expect("setup.guilds[0].id")
        .parse()
        .expect("guild id is numeric");
    let channel_id: u64 = setup["guilds"][0]["channels"][0]["id"]
        .as_str()
        .expect("setup.guilds[0].channels[0].id")
        .parse()
        .expect("channel id is numeric");

    let bot = Id::<UserMarker>::new(bot_id);
    let guild = Id::<GuildMarker>::new(guild_id);
    let channel = Id::<ChannelMarker>::new(channel_id);

    // See the module-level comment: proxy() takes bare `host:port` (no
    // scheme, no `/api` path) plus a separate `use_http` bool; twilight's
    // own request-building code appends `/api/vN/...` itself.
    // `remember_invalid_token(false)` is essential for endpoint-matrix probing.
    // By default twilight "remembers" the first 401 it sees and then refuses to
    // send any further authenticated request (an API-ban safeguard), returning
    // `ErrorType::Unauthorized` without hitting the server. This matrix
    // deliberately exercises a Bearer-only endpoint (`GET /oauth2/@me`) with a
    // Bot token, which legitimately 401s; leaving the safeguard on would poison
    // every subsequent probe (users/webhooks/all DELETEs) with a false
    // "token invalid" failure instead of testing them. Disabling it makes each
    // endpoint independent, which is what a compatibility matrix needs.
    let client = Client::builder()
        .token(token)
        .remember_invalid_token(false)
        .proxy(bare_host, true)
        .build();

    // Reaction emoji: pass the raw unicode name via `RequestReactionType`,
    // not a pre-encoded string — twilight's `Display`/url-encoding handles
    // that internally (same reasoning as the JS/serenity verifiers' EMOJI
    // comment).
    let reaction = RequestReactionType::Unicode { name: "\u{1F44D}" };

    // --- Bootstrap resources referenced by later calls. Best-effort: fall
    // back to a placeholder id on failure so later rows still exercise the
    // wire format (mirrors rust-serenity's/js-oceanic's/go-discordgo's
    // bootstrap section). ---

    let mut message = Id::<MessageMarker>::new(400_000_000_000_000_001);
    if let Ok(resp) = client.create_message(channel).content("compat").await {
        if let Ok(m) = resp.model().await {
            message = m.id;
        }
    }

    let mut bulk_a = Id::<MessageMarker>::new(400_000_000_000_000_002);
    if let Ok(resp) = client
        .create_message(channel)
        .content("compat-bulk-1")
        .await
    {
        if let Ok(m) = resp.model().await {
            bulk_a = m.id;
        }
    }
    let mut bulk_b = Id::<MessageMarker>::new(400_000_000_000_000_003);
    if let Ok(resp) = client
        .create_message(channel)
        .content("compat-bulk-2")
        .await
    {
        if let Ok(m) = resp.model().await {
            bulk_b = m.id;
        }
    }

    // Thread bootstrap: fall back to the plain channel id so thread-member
    // rows still run against *something* rather than being skipped outright.
    let mut thread = channel;
    if let Ok(resp) = client
        .create_thread_from_message(channel, message, "compat-thread")
        .auto_archive_duration(AutoArchiveDuration::Hour)
        .await
    {
        if let Ok(ch) = resp.model().await {
            thread = ch.id;
        }
    }

    // Role bootstrap: fall back to the guild id, since Fauxcord's
    // auto-generated @everyone role id == the guild id.
    let mut role = Id::<RoleMarker>::new(guild_id);
    if let Ok(resp) = client.create_role(guild).name("compat-role").await {
        if let Ok(r) = resp.model().await {
            role = r.id;
        }
    }

    let mut webhook_id = Id::<WebhookMarker>::new(500_000_000_000_000_001);
    let mut webhook_token = "compat-token-xyz".to_string();
    if let Ok(resp) = client.create_webhook(channel, "compat-wh").await {
        if let Ok(wh) = resp.model().await {
            webhook_id = wh.id;
            webhook_token = wh.token.unwrap_or(webhook_token);
        }
    }

    let mut invite_code = "compat".to_string();
    if let Ok(resp) = client.create_invite(channel).await {
        if let Ok(inv) = resp.model().await {
            invite_code = inv.code;
        }
    }

    let mut emoji = Id::<EmojiMarker>::new(600_000_000_000_000_001);
    if let Ok(resp) = client
        .create_emoji(
            guild,
            "compat",
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
        )
        .await
    {
        if let Ok(e) = resp.model().await {
            emoji = e.id;
        }
    }

    // Best-effort: reaction endpoints still exercise the wire format on
    // failure below.
    let _ = client.create_reaction(channel, message, &reaction).await;

    // Capture a webhook-authored message id for the webhook-message
    // endpoints (mirrors rust-serenity's/go-discordgo's webhook-message-id
    // capture). `.wait()` (no args) converts `ExecuteWebhook` into
    // `ExecuteWebhookAndWait`, whose response body is the created message
    // (confirmed from twilight-http's execute_webhook.rs source: `wait()`
    // is the only way to get a `Message` back, matching Discord's
    // `?wait=true` query param).
    let webhook_msg = match client
        .execute_webhook(webhook_id, &webhook_token)
        .content("compat-webhook-msg")
        .wait()
        .await
    {
        Ok(resp) => resp.model().await.ok().map(|m| m.id),
        Err(_) => None,
    };

    let ctx = Ctx {
        bot,
        guild,
        channel,
        message,
        bulk_a,
        bulk_b,
        thread,
        role,
        emoji,
        webhook_id,
        webhook_token,
        webhook_msg,
        invite_code,
    };

    // The canonical endpoint order runs some DELETE/GET calls before the
    // PUT/POST that creates the resource they act on (e.g. ban DELETE/GET
    // before the PUT that creates the ban). Running all non-DELETEs first,
    // then DELETEs last, avoids false "Unknown X" errors from resource-
    // lifecycle ordering rather than real Fauxcord/library bugs (same fix
    // as every other verifier in this repo).
    let mut ordered = endpoints.clone();
    ordered.sort_by_key(|e| e.method == "DELETE");

    let mut results = Vec::with_capacity(ordered.len());
    for ep in &ordered {
        let key = format!("{} {}", ep.method, ep.path);
        let outcome = run_one(&client, &ctx, &reaction, &key).await;
        results.push(match outcome {
            Outcome::Pass => EndpointResult {
                endpoint: key,
                status: "pass",
                note: String::new(),
            },
            Outcome::Fail(msg) => EndpointResult {
                endpoint: key,
                status: "lib-issue",
                note: msg.chars().take(300).collect(),
            },
            Outcome::NotApplicable(note) => EndpointResult {
                endpoint: key,
                status: "n-a",
                note: note.to_string(),
            },
        });
    }

    let pass_count = results.iter().filter(|r| r.status == "pass").count();
    let total = results.len();

    let report = Report {
        library: "twilight",
        // Reflects the major line pinned in Cargo.toml; the exact patch
        // resolved by `cargo fetch` is not known in this offline session.
        version: "0.16.x",
        base_url_overridable: true,
        results,
    };
    fs::write(
        "/results/twilight.json",
        serde_json::to_string_pretty(&report).expect("serialize report"),
    )
    .expect("write /results/twilight.json");

    println!("twilight done: {pass_count}/{total} pass");
}

/// Outcome of probing a single canonical endpoint.
enum Outcome {
    Pass,
    Fail(String),
    NotApplicable(&'static str),
}

/// Maps one canonical "METHOD /path" key to its twilight-http `Client` call
/// (or an `n-a` verdict with an evidence note when no high-level wrapper
/// exists, or when running the call would destroy a resource other rows
/// still need).
async fn run_one(
    client: &Client,
    ctx: &Ctx,
    reaction: &RequestReactionType<'_>,
    key: &str,
) -> Outcome {
    macro_rules! call {
        ($e:expr) => {
            match $e.await {
                Ok(_) => Outcome::Pass,
                Err(e) => Outcome::Fail(format!("{e}")),
            }
        };
    }

    match key {
        "GET /channels/{channel_id}/invites" => call!(client.channel_invites(ctx.channel)),
        "POST /channels/{channel_id}/invites" => call!(client.create_invite(ctx.channel)),
        "DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}" => {
            call!(client.delete_reaction(ctx.channel, ctx.message, reaction, ctx.bot))
        }
        "DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me" => {
            call!(client.delete_current_user_reaction(ctx.channel, ctx.message, reaction))
        }
        "PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me" => {
            call!(client.create_reaction(ctx.channel, ctx.message, reaction))
        }
        "GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}" => {
            call!(client.reactions(ctx.channel, ctx.message, reaction))
        }
        "DELETE /channels/{channel_id}/messages/{message_id}/reactions" => {
            call!(client.delete_all_reactions(ctx.channel, ctx.message))
        }
        "POST /channels/{channel_id}/messages/{message_id}/threads" => call!(client
            .create_thread_from_message(ctx.channel, ctx.message, "compat-thread2")
            .auto_archive_duration(AutoArchiveDuration::Hour)),
        "DELETE /channels/{channel_id}/messages/{message_id}" => {
            call!(client.delete_message(ctx.channel, ctx.message))
        }
        "GET /channels/{channel_id}/messages/{message_id}" => {
            call!(client.message(ctx.channel, ctx.message))
        }
        "PATCH /channels/{channel_id}/messages/{message_id}" => call!(client
            .update_message(ctx.channel, ctx.message)
            .content(Some("compat-edit"))),
        "POST /channels/{channel_id}/messages/bulk-delete" => {
            call!(client.delete_messages(ctx.channel, &[ctx.bulk_a, ctx.bulk_b]))
        }
        "DELETE /channels/{channel_id}/messages/pins/{message_id}" => Outcome::NotApplicable(
            "twilight-http's delete_pin targets the legacy /channels/{id}/pins endpoint, not the new /messages/pins API (confirmed via routing.rs's Route::UnpinMessage -> Path::ChannelsIdPinsMessageId)",
        ),
        "PUT /channels/{channel_id}/messages/pins/{message_id}" => Outcome::NotApplicable(
            "twilight-http's create_pin targets the legacy /channels/{id}/pins endpoint, not the new /messages/pins API",
        ),
        "GET /channels/{channel_id}/messages/pins" => Outcome::NotApplicable(
            "twilight-http's pins targets the legacy /channels/{id}/pins endpoint, not the new /messages/pins API",
        ),
        "GET /channels/{channel_id}/messages" => call!(client.channel_messages(ctx.channel)),
        "POST /channels/{channel_id}/messages" => {
            call!(client.create_message(ctx.channel).content("compat"))
        }
        "DELETE /channels/{channel_id}/permissions/{overwrite_id}" => {
            call!(client.delete_channel_permission(ctx.channel).member(ctx.bot))
        }
        "PUT /channels/{channel_id}/permissions/{overwrite_id}" => {
            let overwrite = PermissionOverwrite {
                allow: Some(Permissions::empty()),
                deny: Some(Permissions::empty()),
                id: ctx.bot.cast(),
                kind: PermissionOverwriteType::Member,
            };
            call!(client.update_channel_permission(ctx.channel, &overwrite))
        }
        "DELETE /channels/{channel_id}/pins/{message_id}" => {
            call!(client.delete_pin(ctx.channel, ctx.message))
        }
        "PUT /channels/{channel_id}/pins/{message_id}" => {
            call!(client.create_pin(ctx.channel, ctx.message))
        }
        "GET /channels/{channel_id}/pins" => call!(client.pins(ctx.channel)),
        "DELETE /channels/{channel_id}/thread-members/{user_id}" => {
            call!(client.remove_thread_member(ctx.thread, ctx.bot))
        }
        "GET /channels/{channel_id}/thread-members/{user_id}" => {
            call!(client.thread_member(ctx.thread, ctx.bot))
        }
        "PUT /channels/{channel_id}/thread-members/{user_id}" => {
            call!(client.add_thread_member(ctx.thread, ctx.bot))
        }
        "DELETE /channels/{channel_id}/thread-members/@me" => {
            call!(client.leave_thread(ctx.thread))
        }
        "PUT /channels/{channel_id}/thread-members/@me" => call!(client.join_thread(ctx.thread)),
        "GET /channels/{channel_id}/thread-members" => {
            call!(client.thread_members(ctx.thread))
        }
        "GET /channels/{channel_id}/threads/archived/private" => {
            call!(client.private_archived_threads(ctx.channel))
        }
        "GET /channels/{channel_id}/threads/archived/public" => {
            call!(client.public_archived_threads(ctx.channel))
        }
        "GET /channels/{channel_id}/threads/search" => Outcome::NotApplicable(
            "no high-level twilight-http wrapper for the thread search endpoint (not present in client.rs's method list as of 0.16.0)",
        ),
        "POST /channels/{channel_id}/threads" => call!(client
            .create_thread(ctx.channel, "compat-thread3", ChannelType::PublicThread)
            .auto_archive_duration(AutoArchiveDuration::Hour)),
        "POST /channels/{channel_id}/typing" => call!(client.create_typing_trigger(ctx.channel)),
        "GET /channels/{channel_id}/users/@me/threads/archived/private" => {
            call!(client.joined_private_archived_threads(ctx.channel))
        }
        "GET /channels/{channel_id}/webhooks" => call!(client.channel_webhooks(ctx.channel)),
        "POST /channels/{channel_id}/webhooks" => {
            call!(client.create_webhook(ctx.channel, "compat-wh2"))
        }
        "DELETE /channels/{channel_id}" => Outcome::NotApplicable(
            "not exercised: would delete the shared test channel other rows depend on",
        ),
        "GET /channels/{channel_id}" => call!(client.channel(ctx.channel)),
        "PATCH /channels/{channel_id}" => {
            call!(client.update_channel(ctx.channel).name("general"))
        }
        "GET /gateway/bot" => call!(client.gateway().authed()),
        "GET /gateway" => call!(client.gateway()),
        "DELETE /guilds/{guild_id}/bans/{user_id}" => {
            call!(client.delete_ban(ctx.guild, ctx.bot))
        }
        "GET /guilds/{guild_id}/bans/{user_id}" => call!(client.ban(ctx.guild, ctx.bot)),
        "PUT /guilds/{guild_id}/bans/{user_id}" => call!(client.create_ban(ctx.guild, ctx.bot)),
        "GET /guilds/{guild_id}/bans" => call!(client.bans(ctx.guild)),
        "GET /guilds/{guild_id}/channels" => call!(client.guild_channels(ctx.guild)),
        "POST /guilds/{guild_id}/channels" => {
            call!(client.create_guild_channel(ctx.guild, "compat-channel"))
        }
        "DELETE /guilds/{guild_id}/emojis/{emoji_id}" => {
            call!(client.delete_emoji(ctx.guild, ctx.emoji))
        }
        "GET /guilds/{guild_id}/emojis/{emoji_id}" => call!(client.emoji(ctx.guild, ctx.emoji)),
        "PATCH /guilds/{guild_id}/emojis/{emoji_id}" => {
            call!(client.update_emoji(ctx.guild, ctx.emoji).name("compat2"))
        }
        "GET /guilds/{guild_id}/emojis" => call!(client.emojis(ctx.guild)),
        "POST /guilds/{guild_id}/emojis" => call!(client.create_emoji(
            ctx.guild,
            "compat3",
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
        )),
        "DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}" => {
            call!(client.remove_guild_member_role(ctx.guild, ctx.bot, ctx.role))
        }
        "PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}" => {
            call!(client.add_guild_member_role(ctx.guild, ctx.bot, ctx.role))
        }
        "DELETE /guilds/{guild_id}/members/{user_id}" => Outcome::NotApplicable(
            "not exercised: would remove the bot itself from the shared test guild",
        ),
        "GET /guilds/{guild_id}/members/{user_id}" => call!(client.guild_member(ctx.guild, ctx.bot)),
        "PATCH /guilds/{guild_id}/members/{user_id}" => call!(client
            .update_guild_member(ctx.guild, ctx.bot)
            .nick(Some("compat"))),
        "GET /guilds/{guild_id}/members" => call!(client.guild_members(ctx.guild)),
        "DELETE /guilds/{guild_id}/roles/{role_id}" => Outcome::NotApplicable(
            "not exercised: would remove the role other rows (member-role add/remove) still need",
        ),
        "PATCH /guilds/{guild_id}/roles/{role_id}" => call!(client
            .update_role(ctx.guild, ctx.role)
            .name(Some("compat-role-renamed"))),
        "GET /guilds/{guild_id}/roles" => call!(client.roles(ctx.guild)),
        "POST /guilds/{guild_id}/roles" => {
            call!(client.create_role(ctx.guild).name("compat-role2"))
        }
        "GET /guilds/{guild_id}/webhooks" => call!(client.guild_webhooks(ctx.guild)),
        "DELETE /guilds/{guild_id}" => Outcome::NotApplicable(
            "not exercised: would delete the shared test guild other rows depend on (a high-level wrapper, delete_guild, does exist in twilight-http unlike serenity, but running it would break every later row in this run)",
        ),
        "GET /guilds/{guild_id}" => call!(client.guild(ctx.guild)),
        "PATCH /guilds/{guild_id}" => call!(client.update_guild(ctx.guild).name("Compat Guild")),
        "DELETE /invites/{code}" => call!(client.delete_invite(&ctx.invite_code)),
        "GET /invites/{code}" => call!(client.invite(&ctx.invite_code)),
        "GET /oauth2/@me" => call!(client.current_authorization()),
        "GET /oauth2/applications/@me" => call!(client.current_user_application()),
        "POST /oauth2/token/revoke" | "POST /oauth2/token" => Outcome::NotApplicable(
            "twilight-http has no OAuth2 code-grant token-exchange wrappers (out of scope for a bot-focused HTTP client; not present in client.rs's method list as of 0.16.0)",
        ),
        "GET /users/{user_id}" => call!(client.user(ctx.bot)),
        "GET /users/@me/guilds" => call!(client.current_user_guilds()),
        "GET /users/@me" => call!(client.current_user()),
        "PATCH /users/@me" => call!(client.update_current_user().username("CompatBot")),
        "DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}" => {
            webhook_msg_call(ctx, || {
                client.delete_webhook_message(
                    ctx.webhook_id,
                    &ctx.webhook_token,
                    ctx.webhook_msg.unwrap(),
                )
            })
            .await
        }
        "GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}" => {
            webhook_msg_call(ctx, || {
                client.webhook_message(ctx.webhook_id, &ctx.webhook_token, ctx.webhook_msg.unwrap())
            })
            .await
        }
        "PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}" => {
            webhook_msg_call(ctx, || {
                client
                    .update_webhook_message(
                        ctx.webhook_id,
                        &ctx.webhook_token,
                        ctx.webhook_msg.unwrap(),
                    )
                    .content(Some("compat-edit"))
            })
            .await
        }
        "DELETE /webhooks/{webhook_id}/{webhook_token}" => Outcome::NotApplicable(
            "not exercised: would delete the shared webhook other rows still need",
        ),
        "GET /webhooks/{webhook_id}/{webhook_token}" => {
            call!(client.webhook(ctx.webhook_id).token(&ctx.webhook_token))
        }
        "PATCH /webhooks/{webhook_id}/{webhook_token}" => call!(client
            .update_webhook_with_token(ctx.webhook_id, &ctx.webhook_token)
            .name("compat-renamed")),
        "POST /webhooks/{webhook_id}/{webhook_token}" => call!(client
            .execute_webhook(ctx.webhook_id, &ctx.webhook_token)
            .content("compat")),
        "DELETE /webhooks/{webhook_id}" => Outcome::NotApplicable(
            "not exercised: would delete the shared webhook other rows still need",
        ),
        "GET /webhooks/{webhook_id}" => call!(client.webhook(ctx.webhook_id)),
        "PATCH /webhooks/{webhook_id}" => {
            call!(client.update_webhook(ctx.webhook_id).name("compat-renamed2"))
        }
        _ => Outcome::NotApplicable("no high-level twilight-http Client method found for this endpoint"),
    }
}

/// Wraps a webhook-message probe so it is skipped (recorded as `n-a`) when no
/// webhook-authored message id was captured during bootstrap (mirrors
/// rust-serenity's/go-discordgo's `webhook_msg_call`/`webhookMsgCall`).
async fn webhook_msg_call<F, Fut, T>(ctx: &Ctx, f: F) -> Outcome
where
    F: FnOnce() -> Fut,
    // twilight-http request builders implement `IntoFuture`, not `Future`
    // directly (their `.await` desugars through `into_future()`), so the bound
    // must be `IntoFuture` — a `Future` bound rejects the builder types.
    Fut: std::future::IntoFuture<Output = Result<T, twilight_http::Error>>,
{
    if ctx.webhook_msg.is_none() {
        return Outcome::NotApplicable(
            "not exercised: no message id captured for a webhook-authored message in this run",
        );
    }
    match f().await {
        Ok(_) => Outcome::Pass,
        Err(e) => Outcome::Fail(format!("{e}")),
    }
}
