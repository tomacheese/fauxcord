// Serenity compatibility verifier.
//
// FEASIBILITY: serenity's `HttpBuilder::proxy(url)` redirects all REST
// traffic to a given origin. Unlike Discord.Net/discordgo (which want the
// *full* base including `/api/v10/`), serenity's proxy replaces only the
// scheme+host+port — serenity appends `/api/vN/...` itself. So the value
// passed to `.proxy()` here is the bare origin, not `FAUXCORD_BASE` as-is;
// see `proxy_origin_from` below.
//
// CONFIDENCE CAVEAT: written from training-data knowledge of serenity's
// public API with no network access to verify signatures against the exact
// 0.12.x patch, and without running `cargo build`/`cargo check`. The
// `.proxy()` mechanism itself is high-confidence (a documented serenity
// feature). Lower-confidence spots, flagged inline where relevant: exact
// parameter shapes for less-common `Http` methods (thread management,
// permission overwrites, webhook-message CRUD), and whether raw-map bodies
// work without serenity's separate "builder" feature (deliberately not
// enabled here, see Cargo.toml). If compilation disagrees with a signature
// here, treat it as a bug to fix, not evidence the `.proxy()` mechanism
// itself is unsound.

use serenity::http::{Http, HttpBuilder};
use serenity::model::channel::{PermissionOverwrite, PermissionOverwriteType, ReactionType};
use serenity::model::id::{ChannelId, EmojiId, GuildId, MessageId, RoleId, UserId, WebhookId};
use serenity::model::permissions::Permissions;
use secrecy::ExposeSecret;
use serde_json::{json, Map, Value};
use std::fs;
use std::time::Duration;

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

/// The final JSON document written to /results/serenity.json.
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
    bot: UserId,
    guild: GuildId,
    channel: ChannelId,
    message: MessageId,
    thread_msg: MessageId,
    bulk_a: MessageId,
    bulk_b: MessageId,
    thread: ChannelId,
    role: RoleId,
    emoji: EmojiId,
    ban_target: UserId,
    webhook_id: WebhookId,
    webhook_token: String,
    webhook_msg: Option<MessageId>,
    invite_code: String,
}

/// Shorthand for the JSON body type most `Http` methods accept for
/// create/edit calls in this vintage of serenity.
type JsonMap = Map<String, Value>;

/// Converts a `serde_json::json!` object literal into the map type `Http`
/// methods expect.
fn jmap(v: Value) -> JsonMap {
    match v {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

/// Derives the bare origin (scheme+host+port, no path) that serenity's
/// `.proxy()` expects, from the `/api/v10`-suffixed `FAUXCORD_BASE` used by
/// every other verifier in this repo.
fn proxy_origin_from(base: &str) -> String {
    let trimmed = base.trim_end_matches('/');
    let trimmed = trimmed.strip_suffix("/api/v10").unwrap_or(trimmed);
    trimmed.to_string()
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

/// POSTs the shared setup payload. 200/201 and 409 (already set up by a
/// prior run against a reused Fauxcord container) both count as success.
/// Retries with backoff on network errors or unexpected statuses, since a
/// transient hiccup here previously caused setup to fail silently and
/// produced a wave of bogus "Unknown Guild/Channel" results (see
/// js-oceanic/verify.mjs's doSetup docstring). Panics if setup never
/// succeeds so a genuine failure is loud instead of corrupting every
/// downstream result.
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
    let origin = proxy_origin_from(&base);

    // Neither reqwest::Client::new() nor serenity's default HttpBuilder set a
    // per-request timeout, so a single stalled connection can hang this
    // entire sequential run with no output (confirmed cause of a prior run
    // that never wrote /results/serenity.json). An explicit timeout turns a
    // hang into a bounded Outcome::Fail instead.
    let request_timeout = Duration::from_secs(15);
    let plain_client = reqwest::Client::builder()
        .timeout(request_timeout)
        .build()
        .expect("build reqwest client");
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

    let bot = UserId::new(bot_id);
    let guild = GuildId::new(guild_id);
    let channel = ChannelId::new(channel_id);

    // See the module-level comment: proxy() takes the bare origin, and
    // serenity's own request-building code appends /api/vN/... itself.
    let proxy_url: reqwest::Url = origin.parse().expect("FAUXCORD_BASE is a valid URL");
    let http_client = reqwest::Client::builder()
        .timeout(request_timeout)
        .build()
        .expect("build reqwest client for serenity Http");
    // `ratelimiter_disabled(true)` is REQUIRED alongside `.proxy()`: serenity
    // only honors the proxy on its non-ratelimited request path — the default
    // ratelimiter rebuilds requests with `proxy = None`, sending them to real
    // Discord instead of Fauxcord. serenity's own docs pair these settings.
    let http: Http = HttpBuilder::new(&token)
        .client(http_client)
        .proxy(proxy_url)
        .ratelimiter_disabled(true)
        .build();

    // Reaction emoji: pass the raw unicode character, not a pre-encoded
    // string — serenity's ReactionType Display/url-encoding handles that
    // internally (same reasoning as the JS verifiers' EMOJI comment).
    let reaction = ReactionType::Unicode("\u{1F44D}".to_string());

    // --- Bootstrap resources referenced by later calls. Best-effort: fall
    // back to a placeholder id on failure so later rows still exercise the
    // wire format (mirrors js-oceanic/go-discordgo's bootstrap section). ---

    let mut message = MessageId::new(400_000_000_000_000_001);
    if let Ok(m) = http
        .send_message(channel, Vec::new(), &jmap(json!({ "content": "compat" })))
        .await
    {
        message = m.id;
    }

    // Dedicated message for the in-loop POST .../threads probe. The bootstrap
    // below starts a thread from `message`, and both Discord and Fauxcord
    // allow only one thread per message (error 160004), so reusing `message`
    // would make that probe fail with "a thread has already been created".
    let mut thread_msg = MessageId::new(400_000_000_000_000_004);
    if let Ok(m) = http
        .send_message(
            channel,
            Vec::new(),
            &jmap(json!({ "content": "compat-thread-src" })),
        )
        .await
    {
        thread_msg = m.id;
    }

    let mut bulk_a = MessageId::new(400_000_000_000_000_002);
    if let Ok(m) = http
        .send_message(
            channel,
            Vec::new(),
            &jmap(json!({ "content": "compat-bulk-1" })),
        )
        .await
    {
        bulk_a = m.id;
    }
    let mut bulk_b = MessageId::new(400_000_000_000_000_003);
    if let Ok(m) = http
        .send_message(
            channel,
            Vec::new(),
            &jmap(json!({ "content": "compat-bulk-2" })),
        )
        .await
    {
        bulk_b = m.id;
    }

    // Thread bootstrap: fall back to the plain channel id so thread-member
    // rows still run against *something* rather than being skipped outright.
    let mut thread = channel;
    if let Ok(ch) = http
        .create_thread_from_message(
            channel,
            message,
            &jmap(json!({ "name": "compat-thread", "auto_archive_duration": 60 })),
            None,
        )
        .await
    {
        thread = ch.id;
    }

    // Role bootstrap: fall back to the guild id, since Fauxcord's
    // auto-generated @everyone role id == the guild id.
    let mut role = RoleId::new(guild_id);
    if let Ok(r) = http
        .create_role(guild, &jmap(json!({ "name": "compat-role" })), None)
        .await
    {
        role = r.id;
    }

    let mut webhook_id = WebhookId::new(500_000_000_000_000_001);
    let mut webhook_token = "compat-token-xyz".to_string();
    if let Ok(wh) = http
        .create_webhook(channel, &jmap(json!({ "name": "compat-wh" })), None)
        .await
    {
        webhook_id = wh.id;
        // `wh.token` is `Option<SecretString>`; expose it to recover the raw
        // token string the webhook-with-token endpoints below need.
        webhook_token = wh
            .token
            .map(|t| t.expose_secret().clone())
            .unwrap_or(webhook_token);
    }

    let mut invite_code = "compat".to_string();
    if let Ok(inv) = http.create_invite(channel, &jmap(json!({})), None).await {
        invite_code = inv.code;
    }

    let mut emoji = EmojiId::new(600_000_000_000_000_001);
    if let Ok(e) = http
        .create_emoji(
            guild,
            &json!({
                "name": "compat",
                "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
            }),
            None,
        )
        .await
    {
        emoji = e.id;
    }

    // A throwaway ban target distinct from the bot. Banning a user removes
    // their guild membership (Discord — and Fauxcord — kick on ban), so
    // banning the bot itself would make every later /guilds/{id}/members/
    // {bot_id} probe 404. Banning a separate synthetic user keeps the bot's
    // own membership intact (mirrors go-discordgo's BAN_TARGET).
    let ban_target = UserId::new(700_000_000_000_000_001);

    // Bootstrap the ban so GET /guilds/{id}/bans/{user_id} finds it even when
    // that probe runs before the in-loop PUT ban (the runner defers DELETEs
    // but not GET/PUT ordering).
    let _ = http.ban_user(guild, ban_target, 0, None).await;

    // Best-effort: reaction endpoints still exercise the wire format on
    // failure below.
    let _ = http.create_reaction(channel, message, &reaction).await;

    // Capture a webhook-authored message id for the webhook-message
    // endpoints (mirrors go-discordgo's WEBHOOK_MSG capture).
    let webhook_msg = http
        .execute_webhook(
            webhook_id,
            None,
            &webhook_token,
            true,
            Vec::new(),
            &jmap(json!({ "content": "compat-webhook-msg" })),
        )
        .await
        .ok()
        .flatten()
        .map(|m| m.id);

    let ctx = Ctx {
        bot,
        guild,
        channel,
        message,
        thread_msg,
        bulk_a,
        bulk_b,
        thread,
        role,
        emoji,
        ban_target,
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

    let total_endpoints = ordered.len();
    let mut results = Vec::with_capacity(total_endpoints);
    for (i, ep) in ordered.iter().enumerate() {
        let key = format!("{} {}", ep.method, ep.path);
        // Per-endpoint progress line on stderr, so container logs show
        // whether a stalled run made any progress (previously silent until
        // the final summary line).
        eprintln!("[{}/{total_endpoints}] {key}", i + 1);
        let outcome = run_one(&http, &ctx, &reaction, &key).await;
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
        library: "serenity",
        // Reflects the major line pinned in Cargo.toml; the exact patch
        // resolved by `cargo fetch` is not known in this offline session.
        version: "0.12.x",
        base_url_overridable: true,
        results,
    };
    fs::write(
        "/results/serenity.json",
        serde_json::to_string_pretty(&report).expect("serialize report"),
    )
    .expect("write /results/serenity.json");

    println!("serenity done: {pass_count}/{total} pass");
}

/// Outcome of probing a single canonical endpoint.
enum Outcome {
    Pass,
    Fail(String),
    NotApplicable(&'static str),
}

/// Maps one canonical "METHOD /path" key to its serenity `Http` call (or an
/// `n-a` verdict with an evidence note when no high-level wrapper exists, or
/// when running the call would destroy a resource other rows still need).
async fn run_one(http: &Http, ctx: &Ctx, reaction: &ReactionType, key: &str) -> Outcome {
    macro_rules! call {
        ($e:expr) => {
            match $e.await {
                Ok(_) => Outcome::Pass,
                Err(e) => Outcome::Fail(format!("{e}")),
            }
        };
    }

    match key {
        "GET /channels/{channel_id}/invites" => call!(http.get_channel_invites(ctx.channel)),
        "POST /channels/{channel_id}/invites" => {
            call!(http.create_invite(ctx.channel, &jmap(json!({})), None))
        }
        "DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}" => {
            call!(http.delete_reaction(ctx.channel, ctx.message, ctx.bot, reaction))
        }
        "DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me" => {
            call!(http.delete_reaction_me(ctx.channel, ctx.message, reaction))
        }
        "PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me" => {
            call!(http.create_reaction(ctx.channel, ctx.message, reaction))
        }
        "GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}" => {
            call!(http.get_reaction_users(ctx.channel, ctx.message, reaction, 100, None))
        }
        "DELETE /channels/{channel_id}/messages/{message_id}/reactions" => {
            call!(http.delete_message_reactions(ctx.channel, ctx.message))
        }
        "POST /channels/{channel_id}/messages/{message_id}/threads" => call!(
            http.create_thread_from_message(
                ctx.channel,
                ctx.thread_msg,
                &jmap(json!({ "name": "compat-thread2", "auto_archive_duration": 60 })),
                None,
            )
        ),
        "DELETE /channels/{channel_id}/messages/{message_id}" => {
            call!(http.delete_message(ctx.channel, ctx.message, None))
        }
        "GET /channels/{channel_id}/messages/{message_id}" => {
            call!(http.get_message(ctx.channel, ctx.message))
        }
        "PATCH /channels/{channel_id}/messages/{message_id}" => call!(http.edit_message(
            ctx.channel,
            ctx.message,
            &jmap(json!({ "content": "compat-edit" })),
            Vec::new(),
        )),
        "POST /channels/{channel_id}/messages/bulk-delete" => {
            call!(http.delete_messages(
                ctx.channel,
                &json!({ "messages": [ctx.bulk_a.to_string(), ctx.bulk_b.to_string()] }),
                None,
            ))
        }
        "DELETE /channels/{channel_id}/messages/pins/{message_id}" => Outcome::NotApplicable(
            "serenity's unpin_message targets the legacy /channels/{id}/pins endpoint, not the new /messages/pins API",
        ),
        "PUT /channels/{channel_id}/messages/pins/{message_id}" => Outcome::NotApplicable(
            "serenity's pin_message targets the legacy /channels/{id}/pins endpoint, not the new /messages/pins API",
        ),
        "GET /channels/{channel_id}/messages/pins" => Outcome::NotApplicable(
            "serenity's get_pins targets the legacy /channels/{id}/pins endpoint, not the new /messages/pins API",
        ),
        "GET /channels/{channel_id}/messages" => call!(http.get_messages(ctx.channel, None, None)),
        "POST /channels/{channel_id}/messages" => {
            call!(http.send_message(ctx.channel, Vec::new(), &jmap(json!({ "content": "compat" }))))
        }
        "DELETE /channels/{channel_id}/permissions/{overwrite_id}" => {
            call!(http.delete_permission(ctx.channel, ctx.bot.into(), None))
        }
        "PUT /channels/{channel_id}/permissions/{overwrite_id}" => {
            let overwrite = PermissionOverwrite {
                allow: Permissions::empty(),
                deny: Permissions::empty(),
                kind: PermissionOverwriteType::Member(ctx.bot),
            };
            call!(http.create_permission(ctx.channel, ctx.bot.into(), &overwrite, None))
        }
        "DELETE /channels/{channel_id}/pins/{message_id}" => {
            call!(http.unpin_message(ctx.channel, ctx.message, None))
        }
        "PUT /channels/{channel_id}/pins/{message_id}" => {
            call!(http.pin_message(ctx.channel, ctx.message, None))
        }
        "GET /channels/{channel_id}/pins" => call!(http.get_pins(ctx.channel)),
        "DELETE /channels/{channel_id}/thread-members/{user_id}" => {
            call!(http.remove_thread_channel_member(ctx.thread, ctx.bot))
        }
        "GET /channels/{channel_id}/thread-members/{user_id}" => {
            call!(http.get_thread_channel_member(ctx.thread, ctx.bot, false))
        }
        "PUT /channels/{channel_id}/thread-members/{user_id}" => {
            call!(http.add_thread_channel_member(ctx.thread, ctx.bot))
        }
        "DELETE /channels/{channel_id}/thread-members/@me" => {
            call!(http.leave_thread_channel(ctx.thread))
        }
        "PUT /channels/{channel_id}/thread-members/@me" => {
            call!(http.join_thread_channel(ctx.thread))
        }
        "GET /channels/{channel_id}/thread-members" => {
            call!(http.get_channel_thread_members(ctx.thread))
        }
        "GET /channels/{channel_id}/threads/archived/private" => {
            call!(http.get_channel_archived_private_threads(ctx.channel, None, None))
        }
        "GET /channels/{channel_id}/threads/archived/public" => {
            call!(http.get_channel_archived_public_threads(ctx.channel, None, None))
        }
        "GET /channels/{channel_id}/threads/search" => {
            Outcome::NotApplicable("no high-level wrapper for the thread search endpoint")
        }
        "POST /channels/{channel_id}/threads" => call!(http.create_thread(
            ctx.channel,
            &jmap(json!({ "name": "compat-thread3", "type": 11, "auto_archive_duration": 60 })),
            None,
        )),
        "POST /channels/{channel_id}/typing" => call!(http.broadcast_typing(ctx.channel)),
        "GET /channels/{channel_id}/users/@me/threads/archived/private" => {
            call!(http.get_channel_joined_archived_private_threads(ctx.channel, None, None))
        }
        "GET /channels/{channel_id}/webhooks" => call!(http.get_channel_webhooks(ctx.channel)),
        "POST /channels/{channel_id}/webhooks" => {
            call!(http.create_webhook(ctx.channel, &jmap(json!({ "name": "compat-wh2" })), None))
        }
        "DELETE /channels/{channel_id}" => Outcome::NotApplicable(
            "not exercised: would delete the shared test channel other rows depend on",
        ),
        "GET /channels/{channel_id}" => call!(http.get_channel(ctx.channel)),
        "PATCH /channels/{channel_id}" => {
            call!(http.edit_channel(ctx.channel, &jmap(json!({ "name": "general" })), None))
        }
        "GET /gateway/bot" | "GET /gateway" => Outcome::NotApplicable(
            "requires serenity's \"gateway\" feature, intentionally excluded from this HTTP-only build",
        ),
        "DELETE /guilds/{guild_id}/bans/{user_id}" => {
            call!(http.remove_ban(ctx.guild, ctx.ban_target, None))
        }
        "GET /guilds/{guild_id}/bans/{user_id}" => call!(http.get_ban(ctx.guild, ctx.ban_target)),
        "PUT /guilds/{guild_id}/bans/{user_id}" => {
            call!(http.ban_user(ctx.guild, ctx.ban_target, 0, None))
        }
        "GET /guilds/{guild_id}/bans" => call!(http.get_bans(ctx.guild, None, None)),
        "GET /guilds/{guild_id}/channels" => call!(http.get_channels(ctx.guild)),
        "POST /guilds/{guild_id}/channels" => call!(http.create_channel(
            ctx.guild,
            &jmap(json!({ "name": "compat-channel", "type": 0 })),
            None,
        )),
        "DELETE /guilds/{guild_id}/emojis/{emoji_id}" => {
            call!(http.delete_emoji(ctx.guild, ctx.emoji, None))
        }
        "GET /guilds/{guild_id}/emojis/{emoji_id}" => call!(http.get_emoji(ctx.guild, ctx.emoji)),
        "PATCH /guilds/{guild_id}/emojis/{emoji_id}" => call!(http.edit_emoji(
            ctx.guild,
            ctx.emoji,
            &json!({ "name": "compat2" }),
            None,
        )),
        "GET /guilds/{guild_id}/emojis" => call!(http.get_emojis(ctx.guild)),
        "POST /guilds/{guild_id}/emojis" => call!(http.create_emoji(
            ctx.guild,
            &json!({
                "name": "compat3",
                "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
            }),
            None,
        )),
        "DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}" => {
            call!(http.remove_member_role(ctx.guild, ctx.bot, ctx.role, None))
        }
        "PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}" => {
            call!(http.add_member_role(ctx.guild, ctx.bot, ctx.role, None))
        }
        "DELETE /guilds/{guild_id}/members/{user_id}" => Outcome::NotApplicable(
            "not exercised: would remove the bot itself from the shared test guild",
        ),
        "GET /guilds/{guild_id}/members/{user_id}" => call!(http.get_member(ctx.guild, ctx.bot)),
        "PATCH /guilds/{guild_id}/members/{user_id}" => call!(http.edit_member(
            ctx.guild,
            ctx.bot,
            &jmap(json!({ "nick": "compat" })),
            None,
        )),
        "GET /guilds/{guild_id}/members" => call!(http.get_guild_members(ctx.guild, None, None)),
        "DELETE /guilds/{guild_id}/roles/{role_id}" => Outcome::NotApplicable(
            "not exercised: would remove the role other rows (member-role add/remove) still need",
        ),
        "PATCH /guilds/{guild_id}/roles/{role_id}" => call!(http.edit_role(
            ctx.guild,
            ctx.role,
            &jmap(json!({ "name": "compat-role-renamed" })),
            None,
        )),
        "GET /guilds/{guild_id}/roles" => call!(http.get_guild_roles(ctx.guild)),
        "POST /guilds/{guild_id}/roles" => {
            call!(http.create_role(ctx.guild, &jmap(json!({ "name": "compat-role2" })), None))
        }
        "GET /guilds/{guild_id}/webhooks" => call!(http.get_guild_webhooks(ctx.guild)),
        "DELETE /guilds/{guild_id}" => Outcome::NotApplicable(
            "no high-level wrapper: bots cannot delete guilds in the real Discord API (owner-only)",
        ),
        "GET /guilds/{guild_id}" => call!(http.get_guild(ctx.guild)),
        "PATCH /guilds/{guild_id}" => {
            call!(http.edit_guild(ctx.guild, &jmap(json!({ "name": "Compat Guild" })), None))
        }
        "DELETE /invites/{code}" => call!(http.delete_invite(&ctx.invite_code, None)),
        "GET /invites/{code}" => call!(http.get_invite(&ctx.invite_code, false, false, None)),
        "GET /oauth2/@me" => Outcome::NotApplicable(
            "serenity's Http targets bot-token REST calls; no wrapper for the OAuth2 bearer-token current-authorization-info endpoint",
        ),
        "GET /oauth2/applications/@me" => call!(http.get_current_application_info()),
        "POST /oauth2/token/revoke" | "POST /oauth2/token" => Outcome::NotApplicable(
            "serenity has no OAuth2 code-grant token-exchange wrappers (out of scope for a bot-focused HTTP client)",
        ),
        "GET /users/{user_id}" => call!(http.get_user(ctx.bot)),
        "GET /users/@me/guilds" => call!(http.get_guilds(None, None)),
        "GET /users/@me" => call!(http.get_current_user()),
        "PATCH /users/@me" => {
            call!(http.edit_profile(&jmap(json!({ "username": "CompatBot" }))))
        }
        "DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}" => {
            webhook_msg_call(ctx, || {
                http.delete_webhook_message(ctx.webhook_id, None, &ctx.webhook_token, ctx.webhook_msg.unwrap())
            })
            .await
        }
        "GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}" => {
            webhook_msg_call(ctx, || {
                http.get_webhook_message(ctx.webhook_id, None, &ctx.webhook_token, ctx.webhook_msg.unwrap())
            })
            .await
        }
        "PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}" => {
            // Bind the body here (not inside the closure) so it outlives the
            // future the closure returns; `edit_webhook_message` borrows it.
            let body = jmap(json!({ "content": "compat-edit" }));
            webhook_msg_call(ctx, || {
                http.edit_webhook_message(
                    ctx.webhook_id,
                    None,
                    &ctx.webhook_token,
                    ctx.webhook_msg.unwrap(),
                    &body,
                    Vec::new(),
                )
            })
            .await
        }
        "DELETE /webhooks/{webhook_id}/{webhook_token}" => Outcome::NotApplicable(
            "not exercised: would delete the shared webhook other rows still need",
        ),
        "GET /webhooks/{webhook_id}/{webhook_token}" => {
            call!(http.get_webhook_with_token(ctx.webhook_id, &ctx.webhook_token))
        }
        "PATCH /webhooks/{webhook_id}/{webhook_token}" => call!(http.edit_webhook_with_token(
            ctx.webhook_id,
            &ctx.webhook_token,
            &jmap(json!({ "name": "compat-renamed" })),
            None,
        )),
        "POST /webhooks/{webhook_id}/{webhook_token}" => call!(http.execute_webhook(
            ctx.webhook_id,
            None,
            &ctx.webhook_token,
            false,
            Vec::new(),
            &jmap(json!({ "content": "compat" })),
        )),
        "DELETE /webhooks/{webhook_id}" => Outcome::NotApplicable(
            "not exercised: would delete the shared webhook other rows still need",
        ),
        "GET /webhooks/{webhook_id}" => call!(http.get_webhook(ctx.webhook_id)),
        "PATCH /webhooks/{webhook_id}" => {
            call!(http.edit_webhook(ctx.webhook_id, &jmap(json!({ "name": "compat-renamed2" })), None))
        }
        _ => Outcome::NotApplicable("no high-level serenity Http method found for this endpoint"),
    }
}

/// Wraps a webhook-message probe so it is skipped (recorded as `n-a`) when no
/// webhook-authored message id was captured during bootstrap (mirrors
/// go-discordgo's `webhookMsgCall`).
async fn webhook_msg_call<F, Fut, T, E>(ctx: &Ctx, f: F) -> Outcome
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Display,
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
