// Twilight compatibility verifier.
//
// FEASIBILITY: twilight-http's `ClientBuilder::proxy(host, use_http)`
// redirects all REST traffic through a proxy. Confirmed signature:
// `pub fn proxy(self, proxy_url: String, use_http: bool) -> Self`.
//
// Unlike serenity's `.proxy(url)` (a full URL) or Discord.Net's/discordgo's
// overrides (the *full* base including `/api/v10/`), twilight's `proxy_url`
// is HOST:PORT ONLY — no scheme, no `/api` path; twilight appends
// `/api/vN/...` itself and takes http-vs-https as the separate `use_http`
// bool. So the value handed to `.proxy()` here is `FAUXCORD_BASE` with both
// the scheme and the `/api/v10` suffix stripped; see `bare_host_from` below.
//
// CONFIDENCE CAVEAT: unlike rust-serenity (training-data knowledge only),
// this file's method names and signatures were checked against the actual
// `twilight-http-0.16.0` tag of twilight-rs/twilight and docs.rs, though
// `cargo build`/`cargo check` were still not run here. The `.proxy()`
// mechanism, the `IntoFuture`-based call shape, and most endpoint mappings
// are high confidence (read from the pinned tag's source). A few items
// weren't inspected line-by-line and are flagged inline with
// `// UNCERTAIN:` (mainly thread-bootstrap enum variant names, and whether
// the default feature set pulls in a working TLS backend). If a real
// `cargo build` disagrees with a signature here, treat it as a bug to fix,
// not evidence the `.proxy()` override itself is unsound.
//
// AWAIT STYLE: twilight-http request builders implement `IntoFuture`
// directly (no separate `.exec()` step, unlike pre-0.16), so
// `client.method(...).await` returns `Result<Response<T>, Error>` directly.
// Deserializing the body needs an additional `.model().await`, done only
// where bootstrap needs a real ID out of the response; matrix probes that
// don't need the body just check `.await.is_ok()`.
//
// UNCERTAIN: GET /gateway/bot via `client.gateway().authed().await` is a
// real bot-authed endpoint per docs.rs, but has not been exercised against
// Fauxcord in this offline session (recorded as a real call, not n-a).

use serde_json::Value;
use std::fs;
use std::time::Duration;
use twilight_gateway::{ConfigBuilder as GwConfigBuilder, Shard, ShardId, StreamExt as _};
use twilight_http::request::channel::reaction::RequestReactionType;
use twilight_http::Client;
use twilight_model::channel::thread::AutoArchiveDuration;
use twilight_model::channel::ChannelType;
use twilight_model::gateway::event::Event;
use twilight_model::gateway::Intents;
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

/// One step of the Gateway connect/dispatch verification.
#[derive(serde::Serialize)]
struct GatewayStep {
    step: String,
    status: String,
    note: String,
}

/// The overall Gateway verification outcome.
#[derive(serde::Serialize)]
struct GatewayResult {
    status: String,
    steps: Vec<GatewayStep>,
}

/// The final JSON document written to /results/twilight.json.
#[derive(serde::Serialize)]
struct Report {
    library: &'static str,
    version: &'static str,
    #[serde(rename = "baseUrlOverridable")]
    base_url_overridable: bool,
    results: Vec<EndpointResult>,
    gateway: GatewayResult,
}

/// Resources bootstrapped before the endpoint matrix runs, so later calls
/// (edit/delete/get on a message, member-role add/remove, etc.) have a real
/// target instead of a synthetic id that would 404.
struct Ctx {
    bot: Id<UserMarker>,
    /// A throwaway user id used only as the target of the ban endpoints. It is
    /// deliberately NOT the bot: Fauxcord's ban implies a kick (it deletes the
    /// target's `guild_members` row), so banning `bot` would evict the bot from
    /// the guild and make every later member/role probe 404 with "Unknown
    /// Member". Mirrors rust-serenity's `ban_target` / go-discordgo's
    /// `BAN_TARGET` (same id, same reason).
    ban_target: Id<UserMarker>,
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

/// Derives the `ws://`/`wss://` origin (scheme+host+port, no path) that
/// `twilight-gateway`'s `ConfigBuilder::proxy_url` expects, from the
/// `http(s)://`-scheme origin returned by `origin_from`. Unlike
/// `twilight-http`'s `.proxy(host, use_http)`, `proxy_url` replaces the
/// default `wss://gateway.discord.gg` outright and keeps its own scheme, so
/// the `http`/`https` scheme must be swapped for `ws`/`wss` rather than
/// stripped.
fn gateway_url_from(origin: &str) -> String {
    if let Some(rest) = origin.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = origin.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        origin.to_string()
    }
}

/// Renders an error together with its full `source()` chain.
///
/// `twilight-gateway`'s `ReceiveMessageError::Display` only prints its own
/// summary (e.g. "gateway event could not be deserialized: event=...") and
/// omits the wrapped `serde_json::Error`, which is only reachable via
/// `std::error::Error::source()`. Without walking that chain, the actual
/// missing/mismatched-field detail needed to tell a genuine Fauxcord bug
/// apart from a benign library quirk is lost.
fn describe_error(err: &(dyn std::error::Error + 'static)) -> String {
    let mut out = err.to_string();
    let mut source = err.source();
    while let Some(e) = source {
        out.push_str(" | caused by: ");
        out.push_str(&e.to_string());
        source = e.source();
    }
    out
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
/// js-oceanic/verify.mjs's doSetup docstring, and rust-serenity's
/// `do_setup` for the same fix). Panics if setup never succeeds so a
/// genuine failure is loud instead of corrupting every downstream result.
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

// --- Gateway phase ---
// CAVEAT: written without a `cargo build` in the loop (same caveat as the
// REST phase above).

/// Runs the Gateway connect + dispatch verification for twilight: opens a
/// `Shard` against Fauxcord's Gateway (HELLO -> IDENTIFY -> READY), then
/// sends a message over REST and confirms a matching MESSAGE_CREATE arrives
/// over the same shard.
///
/// `ws_url` (scheme `ws://`/`wss://`) is used for the Shard's `proxy_url`;
/// `bare_host` (no scheme) and `use_http` are used for the REST client that
/// dispatches the message, matching `twilight-http`'s `.proxy()` shape.
/// `token` is the real `"Bot <token>"` string returned by `/_test/setup` —
/// Fauxcord's Gateway requires a token registered against a real Bot
/// (DISABLE_AUTH is not set for this harness), so a synthetic placeholder
/// would fail IDENTIFY.
async fn verify_gateway(
    bare_host: &str,
    use_http: bool,
    ws_url: &str,
    token: &str,
    channel_id: u64,
) -> GatewayResult {
    let mut steps = vec![];
    let gw_config = GwConfigBuilder::new(
        token.to_owned(),
        Intents::GUILDS | Intents::GUILD_MESSAGES | Intents::MESSAGE_CONTENT,
    )
    .proxy_url(ws_url.to_owned())
    .build();
    let mut shard = Shard::with_config(ShardId::ONE, gw_config);

    let ready_result = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            match shard.next_event(twilight_gateway::EventTypeFlags::all()).await {
                Some(Ok(Event::Ready(_))) => return Ok(()),
                Some(Ok(_)) => continue,
                Some(Err(e)) => return Err(describe_error(&e)),
                None => return Err("stream ended".to_string()),
            }
        }
    })
    .await;

    match ready_result {
        Ok(Ok(())) => steps.push(GatewayStep {
            step: "connect-identify-ready".into(),
            status: "pass".into(),
            note: "".into(),
        }),
        Ok(Err(e)) => {
            steps.push(GatewayStep {
                step: "connect-identify-ready".into(),
                status: "lib-issue".into(),
                note: e,
            });
            return GatewayResult {
                status: "lib-issue".into(),
                steps,
            };
        }
        Err(_) => {
            steps.push(GatewayStep {
                step: "connect-identify-ready".into(),
                status: "lib-issue".into(),
                note: "ready timeout".into(),
            });
            return GatewayResult {
                status: "lib-issue".into(),
                steps,
            };
        }
    }

    // Reuse the same proxy target as the REST phase (a fresh twilight-http
    // client, since this function's signature does not receive the caller's
    // REST `client` — only the bare host/scheme/token) to send the message;
    // then poll for MESSAGE_CREATE over the shard.
    let http_client = Client::builder()
        .proxy(bare_host.to_owned(), use_http)
        .token(token.to_owned())
        .build();
    if let Err(e) = http_client
        .create_message(Id::<ChannelMarker>::new(channel_id))
        .content("gateway-compat-check")
        .await
    {
        steps.push(GatewayStep {
            step: "dispatch-message-create".into(),
            status: "lib-issue".into(),
            note: e.to_string(),
        });
    } else {
        let msg_result = tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                match shard.next_event(twilight_gateway::EventTypeFlags::all()).await {
                    Some(Ok(Event::MessageCreate(m))) if m.content == "gateway-compat-check" => {
                        return Ok(())
                    }
                    Some(Ok(_)) => continue,
                    Some(Err(e)) => return Err(describe_error(&e)),
                    None => return Err("stream ended".to_string()),
                }
            }
        })
        .await;
        match msg_result {
            Ok(Ok(())) => steps.push(GatewayStep {
                step: "dispatch-message-create".into(),
                status: "pass".into(),
                note: "".into(),
            }),
            Ok(Err(e)) => steps.push(GatewayStep {
                step: "dispatch-message-create".into(),
                status: "lib-issue".into(),
                note: e,
            }),
            Err(_) => steps.push(GatewayStep {
                step: "dispatch-message-create".into(),
                status: "lib-issue".into(),
                note: "messageCreate timeout".into(),
            }),
        }
    }

    let status = steps
        .iter()
        .find(|s| s.status != "pass")
        .map(|s| s.status.clone())
        .unwrap_or_else(|| "pass".into());
    GatewayResult { status, steps }
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
    // `remember_invalid_token(false)` is essential here: by default twilight
    // remembers the first 401 it sees and refuses all further authenticated
    // requests (an API-ban safeguard). This matrix deliberately exercises a
    // Bearer-only endpoint (`GET /oauth2/@me`) with a Bot token, which
    // legitimately 401s; without disabling the safeguard, that would poison
    // every later probe with a false "token invalid" failure.
    // Cloned before the moves into `.proxy()`/`.token()` below: the Gateway
    // phase needs the same bare host and real Bot token (Fauxcord's Gateway
    // requires a token registered via /_test/setup — DISABLE_AUTH is not set
    // for this harness) to build its own client and shard config.
    let bare_host_for_gateway = bare_host.clone();
    let token_for_gateway = token.clone();
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

    // Ban target: a throwaway user id that is never the bot (see the `Ctx`
    // field comment). Pre-ban it so the `GET /guilds/{id}/bans/{user_id}` probe
    // — which the canonical order runs before the `PUT` that creates a ban —
    // has an existing ban to read instead of 404ing (mirrors rust-serenity's
    // bootstrap ban).
    let ban_target = Id::<UserMarker>::new(700_000_000_000_000_001);
    let _ = client.create_ban(guild, ban_target).await;

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
        ban_target,
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

    let gateway_ws_url = gateway_url_from(&origin);
    let gateway = verify_gateway(
        &bare_host_for_gateway,
        true,
        &gateway_ws_url,
        &token_for_gateway,
        channel_id,
    )
    .await;

    let report = Report {
        library: "twilight",
        // Reflects the major line pinned in Cargo.toml; the exact patch
        // resolved by `cargo fetch` is not known in this offline session.
        version: "0.16.x",
        base_url_overridable: true,
        results,
        gateway,
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
            call!(client.delete_ban(ctx.guild, ctx.ban_target))
        }
        "GET /guilds/{guild_id}/bans/{user_id}" => call!(client.ban(ctx.guild, ctx.ban_target)),
        "PUT /guilds/{guild_id}/bans/{user_id}" => {
            call!(client.create_ban(ctx.guild, ctx.ban_target))
        }
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
