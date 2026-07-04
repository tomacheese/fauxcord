/*
 * Concord (github.com/Cogmasters/concord) compatibility verifier.
 *
 * ============================================================================
 * CONFIRMED FACTS (feasibility basis) — every claim below was verified
 * against the upstream Concord source at github.com/Cogmasters/concord
 * (master branch) via `gh api` / raw.githubusercontent.com fetches. Nothing
 * here is guessed; anything not directly confirmed is marked UNCERTAIN.
 * ============================================================================
 *
 * 1. Base URL is runtime-overridable.
 *    `struct discord_config` (include/discord.h) has a `char *base_url`
 *    field:
 *        "optional override for the REST API base URL
 *         (e.g. `\"http://127.0.0.1:8080\"` for a local test server)
 *         @note when `NULL` (the default) @ref DISCORD_API_BASE_URL is used"
 *    `DISCORD_API_BASE_URL` expands to
 *        "https://discord.com/api/v" DISCORD_VERSION
 *    i.e. it already includes the `/api/v10` suffix, so the override must
 *    also be a *full* base including `/api/v10`, with no trailing slash.
 *    Confirmed at the call site too: src/discord-rest_request.c does
 *        ua_set_url(rqtor->ua, client->config.base_url
 *                                  ? client->config.base_url
 *                                  : DISCORD_API_BASE_URL);
 *    => We set `base_url = "http://<FAUXCORD_ORIGIN>/api/v10"`.
 *
 * 2. The override is genuinely exercised end-to-end, not just parsed.
 *    test/unit-base-url.c is a hermetic Concord test that boots a client
 *    with `base_url` pointed at a local fixture HTTP server and asserts the
 *    request actually landed there. Its comment also reveals a critical
 *    detail: "Booting with a token implies a synchronous GET /users/@me
 *    during _discord_init()" — i.e. `discord_from_config()` itself performs
 *    a blocking network call before returning. This means the Fauxcord
 *    `/_test/setup` call MUST complete successfully before
 *    `discord_from_config()` is invoked, or client construction itself
 *    fails (returns NULL).
 *
 * 3. Token format: NO "Bot " prefix in `discord_config.token`.
 *    unit-base-url.c sets `.token = strdup(TEST_DUMMY_TOKEN)` (a bare
 *    token) and then asserts the outgoing `Authorization` header equals
 *    `"Bot " TEST_DUMMY_TOKEN` — Concord itself prepends "Bot ". `token`
 *    must be heap-allocated (`strdup`) because `discord_cleanup()` frees it.
 *
 * 4. Concord's REST layer is usable without ever starting the Gateway.
 *    Every `discord_*` REST wrapper takes a `struct discord *client` and
 *    issues a plain HTTP request through the user-agent/curl layer;
 *    `discord_run()` (which drives the Gateway event loop) is never called
 *    by this verifier. unit-base-url.c itself never calls discord_run().
 *
 * 5. Synchronous ("blocking") call idiom, confirmed via
 *    include/discord-response.h + real call sites in examples/*.c:
 *      - Typed responses: `DISCORD_RETURN(foo)` generates
 *        `struct discord_ret_foo { ...; struct discord_foo *sync; }`.
 *        Passing `.sync = &local_struct_foo` blocks the calling thread and
 *        writes the decoded response into `local_struct_foo` on success.
 *      - Blank responses (no object): `struct discord_ret { ...; bool
 *        sync; }` — `.sync = true` blocks and discards the response body.
 *      - `discord_get_gateway` / `discord_get_gateway_bot`
 *        (include/gateway.h) are a THIRD, distinct idiom: they take a
 *        plain `struct ccord_szbuf *ret` (no `discord_ret*` wrapper at
 *        all) and are *always* blocking — the header's own doc comment
 *        says "@warning This function blocks the running thread". No
 *        `.sync` field involved for these two.
 *      - `ret = NULL` is also valid when the caller doesn't need the
 *        response and isn't running the call synchronously either — but
 *        that would make the call fire-and-forget/async, which is NOT
 *        what we want here, so every call below sets `.sync` explicitly.
 *
 * 6. Error codes: `CCORDcode` is `typedef int`; `CCORD_OK == 0`
 *    (core/concord-error.h). `const char *discord_strerror(CCORDcode code,
 *    struct discord *client)` (include/discord.h) renders a code to text.
 *    A call is graded "pass" iff its `CCORDcode` return value equals
 *    `CCORD_OK`; anything else is graded "lib-issue" with the code and
 *    `discord_strerror()` text recorded as the note.
 *
 * 7. Build requirement: libcurl must be compiled with `--enable-websockets`
 *    (stated in Concord's own README, and confirmed by
 *    .github/workflows/test_build.yml building curl 8.7.1 from source with
 *    that flag rather than using the distro package) — even though this
 *    verifier's REST-only usage never touches WebSockets, `libdiscord.a`
 *    itself is built assuming that curl capability is present. See the
 *    Dockerfile for the exact build recipe mirroring upstream CI.
 *
 * ============================================================================
 * ENDPOINT COVERAGE NOTES (n-a entries, all confirmed by reading the public
 * headers include/channel.h, include/guild.h, include/webhook.h,
 * include/user.h, include/invite.h, include/oauth2.h, include/emoji.h,
 * include/gateway.h in full — no wrapper function exists for these):
 *   - New-format pins API (`/channels/{id}/messages/pins*`, 3 endpoints):
 *     Concord only has `discord_pin_message` / `discord_unpin_message` /
 *     `discord_get_pinned_messages`, which target the LEGACY
 *     `/channels/{id}/pins*` routes (confirmed via src/api/channel.recipe.h
 *     route definitions and channel.h doc comments referencing "pin.c").
 *   - `GET /channels/{channel_id}/thread-members/{user_id}` (single-member
 *     fetch): channel.h only exposes `discord_list_thread_members` (the
 *     bulk list); no single-member getter exists.
 *   - `GET /channels/{channel_id}/threads/search`: no wrapper in
 *     channel.h at all.
 *   - `POST /oauth2/token` and `POST /oauth2/token/revoke`: oauth2.h
 *     exposes exactly two functions,
 *     `discord_get_current_bot_application_information` and
 *     `discord_get_current_authorization_information` — no token
 *     exchange/revoke wrappers (consistent with Concord being a
 *     bot-focused library, matching the gap already documented for
 *     discordgo in compat/go-discordgo/verify.go).
 *   - Shared-resource-destroying DELETEs (`DELETE /channels/{channel_id}`,
 *     `DELETE /guilds/{guild_id}`, `DELETE /guilds/{guild_id}/roles/{id}`,
 *     `DELETE /guilds/{guild_id}/members/{user_id}` for the bot itself,
 *     `DELETE /webhooks/{id}(/{token})`) are recorded "n-a" with
 *     "not exercised: ..." notes since Concord DOES have wrappers for all
 *     of these but running them would break later rows in the same run
 *     that depend on the shared guild/channel/role/webhook — identical
 *     policy to compat/go-discordgo/verify.go.
 *
 * UNCERTAIN markers are placed inline at the few call sites where the exact
 * runtime behaviour (as opposed to the compile-time signature, which was
 * always confirmed from source) could not be verified without actually
 * running the built binary against Fauxcord.
 */

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <curl/curl.h>

#include "discord.h"

/* ---- Fixed test fixture, mirrors compat/common/setup.json verbatim -------
 * (hardcoded per task instructions rather than parsed at runtime, since
 * plain C has no JSON parser available in this build without adding an
 * extra dependency; the string below is the exact byte-for-byte payload of
 * common/setup.json, kept in sync by hand). */
#define SETUP_JSON                                                           \
    "{"                                                                      \
    "\"token\":\"Bot compat-token\","                                        \
    "\"user\":{\"id\":\"100000000000000001\",\"username\":\"CompatBot\"},"   \
    "\"guilds\":[{\"id\":\"200000000000000001\",\"name\":\"Compat Guild\","  \
    "\"channels\":[{\"id\":\"300000000000000001\",\"name\":\"general\","     \
    "\"type\":0}]}]"                                                         \
    "}"

/* discord_config.token must NOT include the "Bot " prefix (see CONFIRMED
 * FACT #3 above); Fauxcord's setup token above does include it because
 * that's the wire format /_test/setup expects. */
#define BOT_TOKEN "compat-token"
#define GUILD_ID 200000000000000001ULL
#define CHANNEL_ID 300000000000000001ULL
#define BOT_USER_ID 100000000000000001ULL

/* ---------------------------------------------------------------------- */
/* Result reporting                                                        */
/* ---------------------------------------------------------------------- */

#define MAX_RESULTS 128
#define NOTE_LEN 400

struct result {
    const char *endpoint;
    const char *status; /* "pass" | "n-a" | "lib-issue" */
    char note[NOTE_LEN];
};

static struct result g_results[MAX_RESULTS];
static int g_nresults = 0;

/**
 * @brief Record the outcome of a real Concord call.
 *
 * @param endpoint canonical "METHOD /path" string from common/endpoints.json
 * @param code the CCORDcode returned by the discord_* call
 * @param client the discord client, needed by discord_strerror()
 */
static void
record_call(const char *endpoint, CCORDcode code, struct discord *client)
{
    struct result *r = &g_results[g_nresults++];
    r->endpoint = endpoint;
    if (code == CCORD_OK) {
        r->status = "pass";
        r->note[0] = '\0';
    }
    else {
        r->status = "lib-issue";
        snprintf(r->note, sizeof r->note, "CCORDcode %d: %s", code,
                 discord_strerror(code, client));
    }
}

/**
 * @brief Record an endpoint that is not exercised (no wrapper, or a
 *      shared-resource-destroying delete skipped on purpose).
 */
static void
record_na(const char *endpoint, const char *note)
{
    struct result *r = &g_results[g_nresults++];
    r->endpoint = endpoint;
    r->status = "n-a";
    snprintf(r->note, sizeof r->note, "%s", note);
}

/**
 * @brief Write a JSON-escaped copy of `s` to `out` (size `outsz`).
 */
static void
json_escape(char *out, size_t outsz, const char *s)
{
    size_t o = 0;
    for (; *s && o + 2 < outsz; s++) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') {
            out[o++] = '\\';
            out[o++] = (char)c;
        }
        else if (c == '\n') {
            out[o++] = '\\';
            out[o++] = 'n';
        }
        else if (c < 0x20) {
            /* skip other control characters */
        }
        else {
            out[o++] = (char)c;
        }
    }
    out[o] = '\0';
}

/**
 * @brief Write the accumulated results to /results/concord.json, matching
 *      the schema documented in compat/README.md's "Result JSON schema"
 *      section.
 *
 * @param version the Concord version string used for this run
 */
static void
write_report(const char *version)
{
    FILE *f = fopen("/results/concord.json", "w");
    if (!f) {
        fprintf(stderr, "failed to open /results/concord.json for writing\n");
        exit(1);
    }

    fprintf(f, "{\n");
    fprintf(f, "  \"library\": \"concord\",\n");
    fprintf(f, "  \"version\": \"%s\",\n", version);
    fprintf(f, "  \"baseUrlOverridable\": true,\n");
    fprintf(f, "  \"results\": [\n");
    for (int i = 0; i < g_nresults; i++) {
        char ep_esc[300], note_esc[NOTE_LEN * 2];
        json_escape(ep_esc, sizeof ep_esc, g_results[i].endpoint);
        json_escape(note_esc, sizeof note_esc, g_results[i].note);
        fprintf(f, "    { \"endpoint\": \"%s\", \"status\": \"%s\", \"note\": \"%s\" }%s\n",
                ep_esc, g_results[i].status, note_esc,
                (i + 1 < g_nresults) ? "," : "");
    }
    fprintf(f, "  ]\n");
    fprintf(f, "}\n");
    fclose(f);
}

/* ---------------------------------------------------------------------- */
/* Bootstrap HTTP helpers (libcurl) — used only for /_mock/health and
 * /_test/setup, i.e. Fauxcord's own test-control API, not Discord's REST
 * API. All actual Discord REST calls below go through libdiscord.        */
/* ---------------------------------------------------------------------- */

static size_t
discard_cb(void *ptr, size_t size, size_t nmemb, void *userdata)
{
    (void)ptr;
    (void)userdata;
    return size * nmemb;
}

/**
 * @brief Poll GET {origin}/_mock/health until it returns HTTP 200.
 */
static int
wait_healthy(const char *origin)
{
    char url[300];
    snprintf(url, sizeof url, "%s/_mock/health", origin);

    for (int i = 0; i < 60; i++) {
        CURL *curl = curl_easy_init();
        long http_code = 0;
        if (curl) {
            curl_easy_setopt(curl, CURLOPT_URL, url);
            curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, discard_cb);
            curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L);
            if (curl_easy_perform(curl) == CURLE_OK) {
                curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);
            }
            curl_easy_cleanup(curl);
        }
        if (http_code == 200) return 0;
        sleep(1);
    }
    return -1;
}

/**
 * @brief POST {origin}/_test/setup with the fixed setup payload.
 *
 * Mirrors compat/go-discordgo/verify.go's doSetup(): retries with backoff
 * on network errors or unexpected statuses, treats 2xx and 409 (already
 * set up by a prior run against a reused Fauxcord container) as success,
 * and aborts loudly if setup never succeeds — a silent failure here would
 * leave the guild/channel fixtures missing while every downstream call
 * fails with a misleading "Unknown Guild"/"Unknown Channel" instead of the
 * real signal.
 */
static int
do_setup(const char *origin)
{
    char url[300];
    snprintf(url, sizeof url, "%s/_test/setup", origin);

    const int max_attempts = 5;
    long last_status = 0;
    for (int attempt = 1; attempt <= max_attempts; attempt++) {
        CURL *curl = curl_easy_init();
        long http_code = 0;
        CURLcode res = CURLE_FAILED_INIT;
        if (curl) {
            struct curl_slist *headers = NULL;
            headers = curl_slist_append(headers, "Content-Type: application/json");
            curl_easy_setopt(curl, CURLOPT_URL, url);
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, SETUP_JSON);
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
            curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, discard_cb);
            curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);
            res = curl_easy_perform(curl);
            if (res == CURLE_OK) {
                curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);
            }
            curl_slist_free_all(headers);
            curl_easy_cleanup(curl);
        }
        if (res == CURLE_OK && (http_code < 400 || http_code == 409)) {
            return 0;
        }
        last_status = http_code;
        if (attempt < max_attempts) sleep((unsigned)attempt);
    }
    fprintf(stderr, "do_setup: failed to POST /_test/setup after %d attempts (lastStatus=%ld)\n",
            max_attempts, last_status);
    return -1;
}

/* ---------------------------------------------------------------------- */
/* main                                                                    */
/* ---------------------------------------------------------------------- */

int
main(void)
{
    curl_global_init(CURL_GLOBAL_DEFAULT);

    /* Every other verifier in this repo reads `FAUXCORD_BASE` (the full
     * `/api/v10`-suffixed base set by docker-compose.yml); this one needs
     * the bare origin too (for /_mock/health and /_test/setup, which are
     * NOT under /api/v10), so it derives it by stripping the suffix, same
     * as compat/rust-twilight/src/main.rs's origin_from() and
     * compat/python-interactions/verify.py's ORIGIN. */
    const char *fauxcord_base = getenv("FAUXCORD_BASE");
    if (!fauxcord_base || !*fauxcord_base) fauxcord_base = "http://fauxcord:3000/api/v10";

    char origin_buf[300];
    snprintf(origin_buf, sizeof origin_buf, "%s", fauxcord_base);
    size_t len = strlen(origin_buf);
    while (len > 0 && origin_buf[len - 1] == '/') origin_buf[--len] = '\0';
    static const char SUFFIX[] = "/api/v10";
    size_t suffix_len = strlen(SUFFIX);
    if (len >= suffix_len && strcmp(origin_buf + len - suffix_len, SUFFIX) == 0) {
        origin_buf[len - suffix_len] = '\0';
    }
    const char *origin = origin_buf;

    char base_url[300];
    snprintf(base_url, sizeof base_url, "%s/api/v10", origin);

    if (wait_healthy(origin) != 0) {
        fprintf(stderr, "fauxcord did not become healthy\n");
        return 1;
    }
    if (do_setup(origin) != 0) {
        return 1;
    }

    /* discord_from_config() copies the struct by value; discord_cleanup()
     * frees config.token, so it must be heap-allocated (CONFIRMED FACT #3).
     * base_url is only borrowed/copied internally by ua_set_url(), so a
     * stack buffer is fine for it. Booting also performs a synchronous
     * GET /users/@me (CONFIRMED FACT #2), which is why /_test/setup above
     * must run first. */
    struct discord *client = discord_from_config(&(struct discord_config){
        .token = strdup(BOT_TOKEN),
        .base_url = base_url,
        .log = { .quiet = true },
    });
    if (!client) {
        fprintf(stderr, "discord_from_config() failed: could not boot client "
                        "against fauxcord (GET /users/@me during init)\n");
        return 1;
    }

    /* ---- Bootstrap phase: create shared resources exercised by later
     * calls, falling back to placeholder snowflakes on failure so the
     * endpoint calls below still exercise the wire format, mirroring
     * compat/go-discordgo/verify.go's bootstrap. */
    u64snowflake MSG = 400000000000000001ULL;
    u64snowflake BULK1 = 400000000000000002ULL;
    u64snowflake BULK2 = 400000000000000003ULL;
    u64snowflake THREAD = CHANNEL_ID;
    u64snowflake ROLE = GUILD_ID; /* @everyone role id == guild id in fauxcord */
    u64snowflake WEBHOOK_ID = 500000000000000001ULL;
    char WEBHOOK_TOKEN[128] = "compat-token-xyz";
    char INVITE_CODE[64] = "compat";
    u64snowflake EMOJI_ID = 600000000000000001ULL;
    u64snowflake WEBHOOK_MSG_ID = 0; /* 0 == not captured */
    static const char EMOJI_NAME[] = "\xF0\x9F\x91\x8D"; /* "👍" (UTF-8) */
    static const char PNG_DATA_URI[] =
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/"
        "pLvAAAAAElFTkSuQmCC";

    {
        struct discord_message msg_ret = { 0 };
        struct discord_ret_message ret = { .sync = &msg_ret };
        struct discord_create_message params = { .content = "compat" };
        if (discord_create_message(client, CHANNEL_ID, &params, &ret) == CCORD_OK)
            MSG = msg_ret.id;
    }
    {
        struct discord_message msg_ret = { 0 };
        struct discord_ret_message ret = { .sync = &msg_ret };
        struct discord_create_message params = { .content = "compat-bulk-1" };
        if (discord_create_message(client, CHANNEL_ID, &params, &ret) == CCORD_OK)
            BULK1 = msg_ret.id;
    }
    {
        struct discord_message msg_ret = { 0 };
        struct discord_ret_message ret = { .sync = &msg_ret };
        struct discord_create_message params = { .content = "compat-bulk-2" };
        if (discord_create_message(client, CHANNEL_ID, &params, &ret) == CCORD_OK)
            BULK2 = msg_ret.id;
    }
    {
        struct discord_channel ch_ret = { 0 };
        struct discord_ret_channel ret = { .sync = &ch_ret };
        struct discord_start_thread_with_message params = {
            .name = "compat-thread",
            .auto_archive_duration = 60,
        };
        if (discord_start_thread_with_message(client, CHANNEL_ID, MSG, &params, &ret) == CCORD_OK)
            THREAD = ch_ret.id;
    }
    {
        struct discord_role role_ret = { 0 };
        struct discord_ret_role ret = { .sync = &role_ret };
        struct discord_create_guild_role params = { .name = "compat-role" };
        if (discord_create_guild_role(client, GUILD_ID, &params, &ret) == CCORD_OK)
            ROLE = role_ret.id;
    }
    {
        struct discord_webhook wh_ret = { 0 };
        struct discord_ret_webhook ret = { .sync = &wh_ret };
        struct discord_create_webhook params = { .name = "compat-wh" };
        if (discord_create_webhook(client, CHANNEL_ID, &params, &ret) == CCORD_OK) {
            WEBHOOK_ID = wh_ret.id;
            if (wh_ret.token)
                snprintf(WEBHOOK_TOKEN, sizeof WEBHOOK_TOKEN, "%s", wh_ret.token);
        }
    }
    {
        struct discord_invite inv_ret = { 0 };
        struct discord_ret_invite ret = { .sync = &inv_ret };
        struct discord_create_channel_invite params = { 0 };
        if (discord_create_channel_invite(client, CHANNEL_ID, &params, &ret) == CCORD_OK
            && inv_ret.code)
            snprintf(INVITE_CODE, sizeof INVITE_CODE, "%s", inv_ret.code);
    }
    {
        struct discord_emoji emoji_ret = { 0 };
        struct discord_ret_emoji ret = { .sync = &emoji_ret };
        struct discord_create_guild_emoji params = {
            .name = "compat",
            .image = (char *)PNG_DATA_URI,
        };
        if (discord_create_guild_emoji(client, GUILD_ID, &params, &ret) == CCORD_OK)
            EMOJI_ID = emoji_ret.id;
    }
    /* Best-effort: reaction endpoints still exercise the wire format even
     * if this fails. */
    {
        struct discord_ret ret = { .sync = true };
        discord_create_reaction(client, CHANNEL_ID, MSG, 0, EMOJI_NAME, &ret);
    }
    /* Capture a webhook-authored message id for the webhook-message
     * endpoints; wait=true is required for Concord to receive the created
     * message body back synchronously (discord_execute_webhook's `wait`
     * field, confirmed in src/api/webhook.recipe.h). */
    {
        struct discord_message msg_ret = { 0 };
        struct discord_ret_message ret = { .sync = &msg_ret };
        struct discord_execute_webhook params = {
            .wait = true,
            .content = "compat-webhook-msg",
        };
        if (discord_execute_webhook(client, WEBHOOK_ID, WEBHOOK_TOKEN, &params, (struct discord_ret *)&ret) == CCORD_OK)
            WEBHOOK_MSG_ID = msg_ret.id;
    }

    /* ---- Endpoint calls, in the canonical order from
     * compat/common/endpoints.json with non-DELETE methods first and
     * DELETE last (stable within each group), same ordering rationale as
     * compat/go-discordgo/verify.go: several DELETE/GET rows act on
     * resources created earlier in this same list (e.g. the ban DELETE
     * comes after the PUT that creates it), so running every non-DELETE
     * first avoids false "Unknown X" results from lifecycle ordering
     * rather than real bugs. */

    /* GET /channels/{channel_id}/invites */
    {
        struct discord_invites inv_ret = { 0 };
        struct discord_ret_invites ret = { .sync = &inv_ret };
        record_call("GET /channels/{channel_id}/invites",
                    discord_get_channel_invites(client, CHANNEL_ID, &ret), client);
    }
    /* POST /channels/{channel_id}/invites */
    {
        struct discord_invite inv_ret = { 0 };
        struct discord_ret_invite ret = { .sync = &inv_ret };
        struct discord_create_channel_invite params = { 0 };
        record_call("POST /channels/{channel_id}/invites",
                    discord_create_channel_invite(client, CHANNEL_ID, &params, &ret), client);
    }
    /* PUT .../reactions/{emoji_name}/@me */
    {
        struct discord_ret ret = { .sync = true };
        record_call("PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me",
                    discord_create_reaction(client, CHANNEL_ID, MSG, 0, EMOJI_NAME, &ret), client);
    }
    /* GET .../reactions/{emoji_name} */
    {
        struct discord_users users_ret = { 0 };
        struct discord_ret_users ret = { .sync = &users_ret };
        struct discord_get_reactions params = { .limit = 25 };
        record_call("GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}",
                    discord_get_reactions(client, CHANNEL_ID, MSG, 0, EMOJI_NAME, &params, &ret), client);
    }
    /* POST .../messages/{message_id}/threads */
    {
        struct discord_channel ch_ret = { 0 };
        struct discord_ret_channel ret = { .sync = &ch_ret };
        struct discord_start_thread_with_message params = {
            .name = "compat-thread2",
            .auto_archive_duration = 60,
        };
        record_call("POST /channels/{channel_id}/messages/{message_id}/threads",
                    discord_start_thread_with_message(client, CHANNEL_ID, MSG, &params, &ret), client);
    }
    /* GET .../messages/{message_id} */
    {
        struct discord_message msg_ret = { 0 };
        struct discord_ret_message ret = { .sync = &msg_ret };
        record_call("GET /channels/{channel_id}/messages/{message_id}",
                    discord_get_channel_message(client, CHANNEL_ID, MSG, &ret), client);
    }
    /* PATCH .../messages/{message_id} */
    {
        struct discord_message msg_ret = { 0 };
        struct discord_ret_message ret = { .sync = &msg_ret };
        struct discord_edit_message params = { .content = "compat-edit" };
        record_call("PATCH /channels/{channel_id}/messages/{message_id}",
                    discord_edit_message(client, CHANNEL_ID, MSG, &params, &ret), client);
    }
    /* POST .../messages/bulk-delete */
    {
        struct discord_ret ret = { .sync = true };
        u64snowflake ids[2] = { BULK1, BULK2 };
        struct snowflakes msgs = { .size = 2, .array = ids, .realsize = 2 };
        struct discord_bulk_delete_messages params = { .messages = &msgs };
        record_call("POST /channels/{channel_id}/messages/bulk-delete",
                    discord_bulk_delete_messages(client, CHANNEL_ID, &params, &ret), client);
    }
    /* PUT .../messages/pins/{message_id} (new format) */
    record_na("PUT /channels/{channel_id}/messages/pins/{message_id}",
              "no wrapper: discord_pin_message() targets the legacy "
              "/channels/{id}/pins/{message_id} route, not the new "
              "/messages/pins API (confirmed via include/channel.h)");
    /* GET .../messages/pins (new format) */
    record_na("GET /channels/{channel_id}/messages/pins",
              "no wrapper: discord_get_pinned_messages() targets the "
              "legacy /channels/{id}/pins route, not the new "
              "/messages/pins API (confirmed via include/channel.h)");
    /* GET .../messages */
    {
        struct discord_messages msgs_ret = { 0 };
        struct discord_ret_messages ret = { .sync = &msgs_ret };
        struct discord_get_channel_messages params = { .limit = 50 };
        record_call("GET /channels/{channel_id}/messages",
                    discord_get_channel_messages(client, CHANNEL_ID, &params, &ret), client);
    }
    /* POST .../messages */
    {
        struct discord_message msg_ret = { 0 };
        struct discord_ret_message ret = { .sync = &msg_ret };
        struct discord_create_message params = { .content = "compat" };
        record_call("POST /channels/{channel_id}/messages",
                    discord_create_message(client, CHANNEL_ID, &params, &ret), client);
    }
    /* PUT .../permissions/{overwrite_id} */
    {
        struct discord_ret ret = { .sync = true };
        struct discord_edit_channel_permissions params = { .allow = 0, .deny = 0, .type = 1 };
        record_call("PUT /channels/{channel_id}/permissions/{overwrite_id}",
                    discord_edit_channel_permissions(client, CHANNEL_ID, BOT_USER_ID, &params, &ret), client);
    }
    /* PUT .../pins/{message_id} (legacy) */
    {
        struct discord_ret ret = { .sync = true };
        struct discord_pin_message params = { 0 };
        record_call("PUT /channels/{channel_id}/pins/{message_id}",
                    discord_pin_message(client, CHANNEL_ID, MSG, &params, &ret), client);
    }
    /* GET .../pins (legacy) */
    {
        struct discord_messages msgs_ret = { 0 };
        struct discord_ret_messages ret = { .sync = &msgs_ret };
        record_call("GET /channels/{channel_id}/pins",
                    discord_get_pinned_messages(client, CHANNEL_ID, &ret), client);
    }
    /* GET .../thread-members/{user_id} */
    record_na("GET /channels/{channel_id}/thread-members/{user_id}",
              "no wrapper: include/channel.h only exposes "
              "discord_list_thread_members() (the bulk list), no "
              "single-member getter");
    /* PUT .../thread-members/{user_id} */
    {
        struct discord_ret ret = { .sync = true };
        record_call("PUT /channels/{channel_id}/thread-members/{user_id}",
                    discord_add_thread_member(client, THREAD, BOT_USER_ID, &ret), client);
    }
    /* PUT .../thread-members/@me */
    {
        struct discord_ret ret = { .sync = true };
        record_call("PUT /channels/{channel_id}/thread-members/@me",
                    discord_join_thread(client, THREAD, &ret), client);
    }
    /* GET .../thread-members */
    {
        struct discord_thread_members tm_ret = { 0 };
        struct discord_ret_thread_members ret = { .sync = &tm_ret };
        record_call("GET /channels/{channel_id}/thread-members",
                    discord_list_thread_members(client, THREAD, &ret), client);
    }
    /* GET .../threads/archived/private */
    {
        struct discord_thread_response_body body_ret = { 0 };
        struct discord_ret_thread_response_body ret = { .sync = &body_ret };
        record_call("GET /channels/{channel_id}/threads/archived/private",
                    discord_list_private_archived_threads(client, CHANNEL_ID, 0, 50, &ret), client);
    }
    /* GET .../threads/archived/public */
    {
        struct discord_thread_response_body body_ret = { 0 };
        struct discord_ret_thread_response_body ret = { .sync = &body_ret };
        record_call("GET /channels/{channel_id}/threads/archived/public",
                    discord_list_public_archived_threads(client, CHANNEL_ID, 0, 50, &ret), client);
    }
    /* GET .../threads/search */
    record_na("GET /channels/{channel_id}/threads/search",
              "no wrapper in include/channel.h for the thread search endpoint");
    /* POST .../threads (without message) */
    {
        struct discord_channel ch_ret = { 0 };
        struct discord_ret_channel ret = { .sync = &ch_ret };
        struct discord_start_thread_without_message params = {
            .name = "compat-thread3",
            .auto_archive_duration = 60,
            .type = DISCORD_CHANNEL_GUILD_PUBLIC_THREAD,
        };
        record_call("POST /channels/{channel_id}/threads",
                    discord_start_thread_without_message(client, CHANNEL_ID, &params, &ret), client);
    }
    /* POST .../typing */
    {
        struct discord_ret ret = { .sync = true };
        record_call("POST /channels/{channel_id}/typing",
                    discord_trigger_typing_indicator(client, CHANNEL_ID, &ret), client);
    }
    /* GET .../users/@me/threads/archived/private */
    {
        struct discord_thread_response_body body_ret = { 0 };
        struct discord_ret_thread_response_body ret = { .sync = &body_ret };
        record_call("GET /channels/{channel_id}/users/@me/threads/archived/private",
                    discord_list_joined_private_archived_threads(client, CHANNEL_ID, 0, 50, &ret), client);
    }
    /* GET .../webhooks (channel) */
    {
        struct discord_webhooks whs_ret = { 0 };
        struct discord_ret_webhooks ret = { .sync = &whs_ret };
        record_call("GET /channels/{channel_id}/webhooks",
                    discord_get_channel_webhooks(client, CHANNEL_ID, &ret), client);
    }
    /* POST .../webhooks (channel) */
    {
        struct discord_webhook wh_ret = { 0 };
        struct discord_ret_webhook ret = { .sync = &wh_ret };
        struct discord_create_webhook params = { .name = "compat-wh2" };
        record_call("POST /channels/{channel_id}/webhooks",
                    discord_create_webhook(client, CHANNEL_ID, &params, &ret), client);
    }
    /* GET /channels/{channel_id} */
    {
        struct discord_channel ch_ret = { 0 };
        struct discord_ret_channel ret = { .sync = &ch_ret };
        record_call("GET /channels/{channel_id}",
                    discord_get_channel(client, CHANNEL_ID, &ret), client);
    }
    /* PATCH /channels/{channel_id} */
    {
        struct discord_channel ch_ret = { 0 };
        struct discord_ret_channel ret = { .sync = &ch_ret };
        struct discord_modify_channel params = { .name = "general" };
        record_call("PATCH /channels/{channel_id}",
                    discord_modify_channel(client, CHANNEL_ID, &params, &ret), client);
    }
    /* GET /gateway/bot — UNCERTAIN: this idiom (struct ccord_szbuf*, always
     * blocking, no discord_ret wrapper) is confirmed from the header
     * doc-comment and signature, but was not exercised against a live
     * Fauxcord instance while drafting this file. */
    {
        struct ccord_szbuf gw_ret = { 0 };
        record_call("GET /gateway/bot",
                    discord_get_gateway_bot(client, &gw_ret), client);
    }
    /* GET /gateway — same idiom/caveat as above */
    {
        struct ccord_szbuf gw_ret = { 0 };
        record_call("GET /gateway",
                    discord_get_gateway(client, &gw_ret), client);
    }
    /* GET /guilds/{guild_id}/bans/{user_id} */
    {
        struct discord_ban ban_ret = { 0 };
        struct discord_ret_ban ret = { .sync = &ban_ret };
        record_call("GET /guilds/{guild_id}/bans/{user_id}",
                    discord_get_guild_ban(client, GUILD_ID, BOT_USER_ID, &ret), client);
    }
    /* PUT /guilds/{guild_id}/bans/{user_id} */
    {
        struct discord_ret ret = { .sync = true };
        struct discord_create_guild_ban params = { .delete_message_days = 0 };
        record_call("PUT /guilds/{guild_id}/bans/{user_id}",
                    discord_create_guild_ban(client, GUILD_ID, BOT_USER_ID, &params, &ret), client);
    }
    /* GET /guilds/{guild_id}/bans */
    {
        struct discord_bans bans_ret = { 0 };
        struct discord_ret_bans ret = { .sync = &bans_ret };
        record_call("GET /guilds/{guild_id}/bans",
                    discord_get_guild_bans(client, GUILD_ID, &ret), client);
    }
    /* GET /guilds/{guild_id}/channels */
    {
        struct discord_channels chs_ret = { 0 };
        struct discord_ret_channels ret = { .sync = &chs_ret };
        record_call("GET /guilds/{guild_id}/channels",
                    discord_get_guild_channels(client, GUILD_ID, &ret), client);
    }
    /* POST /guilds/{guild_id}/channels */
    {
        struct discord_channel ch_ret = { 0 };
        struct discord_ret_channel ret = { .sync = &ch_ret };
        struct discord_create_guild_channel params = {
            .name = "compat-channel",
            .type = DISCORD_CHANNEL_GUILD_TEXT,
        };
        record_call("POST /guilds/{guild_id}/channels",
                    discord_create_guild_channel(client, GUILD_ID, &params, &ret), client);
    }
    /* GET /guilds/{guild_id}/emojis/{emoji_id} */
    {
        struct discord_emoji emoji_ret = { 0 };
        struct discord_ret_emoji ret = { .sync = &emoji_ret };
        record_call("GET /guilds/{guild_id}/emojis/{emoji_id}",
                    discord_get_guild_emoji(client, GUILD_ID, EMOJI_ID, &ret), client);
    }
    /* PATCH /guilds/{guild_id}/emojis/{emoji_id} */
    {
        struct discord_emoji emoji_ret = { 0 };
        struct discord_ret_emoji ret = { .sync = &emoji_ret };
        struct discord_modify_guild_emoji params = { .name = "compat2" };
        record_call("PATCH /guilds/{guild_id}/emojis/{emoji_id}",
                    discord_modify_guild_emoji(client, GUILD_ID, EMOJI_ID, &params, &ret), client);
    }
    /* GET /guilds/{guild_id}/emojis */
    {
        struct discord_emojis emojis_ret = { 0 };
        struct discord_ret_emojis ret = { .sync = &emojis_ret };
        record_call("GET /guilds/{guild_id}/emojis",
                    discord_list_guild_emojis(client, GUILD_ID, &ret), client);
    }
    /* POST /guilds/{guild_id}/emojis */
    {
        struct discord_emoji emoji_ret = { 0 };
        struct discord_ret_emoji ret = { .sync = &emoji_ret };
        struct discord_create_guild_emoji params = {
            .name = "compat3",
            .image = (char *)PNG_DATA_URI,
        };
        record_call("POST /guilds/{guild_id}/emojis",
                    discord_create_guild_emoji(client, GUILD_ID, &params, &ret), client);
    }
    /* PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id} */
    {
        struct discord_ret ret = { .sync = true };
        struct discord_add_guild_member_role params = { 0 };
        record_call("PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}",
                    discord_add_guild_member_role(client, GUILD_ID, BOT_USER_ID, ROLE, &params, &ret), client);
    }
    /* GET /guilds/{guild_id}/members/{user_id} */
    {
        struct discord_guild_member member_ret = { 0 };
        struct discord_ret_guild_member ret = { .sync = &member_ret };
        record_call("GET /guilds/{guild_id}/members/{user_id}",
                    discord_get_guild_member(client, GUILD_ID, BOT_USER_ID, &ret), client);
    }
    /* PATCH /guilds/{guild_id}/members/{user_id} */
    {
        struct discord_guild_member member_ret = { 0 };
        struct discord_ret_guild_member ret = { .sync = &member_ret };
        struct discord_modify_guild_member params = { .nick = "compat" };
        record_call("PATCH /guilds/{guild_id}/members/{user_id}",
                    discord_modify_guild_member(client, GUILD_ID, BOT_USER_ID, &params, &ret), client);
    }
    /* GET /guilds/{guild_id}/members */
    {
        struct discord_guild_members members_ret = { 0 };
        struct discord_ret_guild_members ret = { .sync = &members_ret };
        struct discord_list_guild_members params = { .limit = 100 };
        record_call("GET /guilds/{guild_id}/members",
                    discord_list_guild_members(client, GUILD_ID, &params, &ret), client);
    }
    /* PATCH /guilds/{guild_id}/roles/{role_id} */
    {
        struct discord_role role_ret = { 0 };
        struct discord_ret_role ret = { .sync = &role_ret };
        struct discord_modify_guild_role params = { .name = "compat-role-renamed" };
        record_call("PATCH /guilds/{guild_id}/roles/{role_id}",
                    discord_modify_guild_role(client, GUILD_ID, ROLE, &params, &ret), client);
    }
    /* GET /guilds/{guild_id}/roles */
    {
        struct discord_roles roles_ret = { 0 };
        struct discord_ret_roles ret = { .sync = &roles_ret };
        record_call("GET /guilds/{guild_id}/roles",
                    discord_get_guild_roles(client, GUILD_ID, &ret), client);
    }
    /* POST /guilds/{guild_id}/roles */
    {
        struct discord_role role_ret = { 0 };
        struct discord_ret_role ret = { .sync = &role_ret };
        struct discord_create_guild_role params = { .name = "compat-role2" };
        record_call("POST /guilds/{guild_id}/roles",
                    discord_create_guild_role(client, GUILD_ID, &params, &ret), client);
    }
    /* GET /guilds/{guild_id}/webhooks */
    {
        struct discord_webhooks whs_ret = { 0 };
        struct discord_ret_webhooks ret = { .sync = &whs_ret };
        record_call("GET /guilds/{guild_id}/webhooks",
                    discord_get_guild_webhooks(client, GUILD_ID, &ret), client);
    }
    /* GET /guilds/{guild_id} */
    {
        struct discord_guild guild_ret = { 0 };
        struct discord_ret_guild ret = { .sync = &guild_ret };
        record_call("GET /guilds/{guild_id}",
                    discord_get_guild(client, GUILD_ID, &ret), client);
    }
    /* PATCH /guilds/{guild_id} */
    {
        struct discord_guild guild_ret = { 0 };
        struct discord_ret_guild ret = { .sync = &guild_ret };
        struct discord_modify_guild params = { .name = "Compat Guild" };
        record_call("PATCH /guilds/{guild_id}",
                    discord_modify_guild(client, GUILD_ID, &params, &ret), client);
    }
    /* GET /invites/{code} */
    {
        struct discord_invite inv_ret = { 0 };
        struct discord_ret_invite ret = { .sync = &inv_ret };
        struct discord_get_invite params = { 0 };
        record_call("GET /invites/{code}",
                    discord_get_invite(client, INVITE_CODE, &params, &ret), client);
    }
    /* GET /oauth2/@me — UNCERTAIN: this requires a bearer/OAuth2 token per
     * Discord's real API; Concord's wrapper is called here with the bot's
     * own client (Bot-token auth), matching how the other verifiers
     * probe endpoints outside their "intended" auth flow to test wire
     * compatibility rather than semantic correctness. Whether Fauxcord's
     * mock accepts Bot auth on this route was not independently verified
     * here. */
    {
        struct discord_auth_response auth_ret = { 0 };
        struct discord_ret_auth_response ret = { .sync = &auth_ret };
        record_call("GET /oauth2/@me",
                    discord_get_current_authorization_information(client, &ret), client);
    }
    /* GET /oauth2/applications/@me */
    {
        struct discord_application app_ret = { 0 };
        struct discord_ret_application ret = { .sync = &app_ret };
        record_call("GET /oauth2/applications/@me",
                    discord_get_current_bot_application_information(client, &ret), client);
    }
    /* POST /oauth2/token/revoke */
    record_na("POST /oauth2/token/revoke",
              "no wrapper: include/oauth2.h exposes only "
              "discord_get_current_bot_application_information() and "
              "discord_get_current_authorization_information() — no "
              "token-exchange/revoke support (bot-focused library)");
    /* POST /oauth2/token */
    record_na("POST /oauth2/token",
              "no wrapper: include/oauth2.h exposes only "
              "discord_get_current_bot_application_information() and "
              "discord_get_current_authorization_information() — no "
              "token-exchange/revoke support (bot-focused library)");
    /* GET /users/{user_id} */
    {
        struct discord_user user_ret = { 0 };
        struct discord_ret_user ret = { .sync = &user_ret };
        record_call("GET /users/{user_id}",
                    discord_get_user(client, BOT_USER_ID, &ret), client);
    }
    /* GET /users/@me/guilds */
    {
        struct discord_guilds guilds_ret = { 0 };
        struct discord_ret_guilds ret = { .sync = &guilds_ret };
        record_call("GET /users/@me/guilds",
                    discord_get_current_user_guilds(client, &ret), client);
    }
    /* GET /users/@me */
    {
        struct discord_user user_ret = { 0 };
        struct discord_ret_user ret = { .sync = &user_ret };
        record_call("GET /users/@me",
                    discord_get_current_user(client, &ret), client);
    }
    /* PATCH /users/@me */
    {
        struct discord_user user_ret = { 0 };
        struct discord_ret_user ret = { .sync = &user_ret };
        struct discord_modify_current_user params = { .username = "CompatBot" };
        record_call("PATCH /users/@me",
                    discord_modify_current_user(client, &params, &ret), client);
    }
    /* GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id} */
    if (WEBHOOK_MSG_ID != 0) {
        struct discord_message msg_ret = { 0 };
        struct discord_ret_message ret = { .sync = &msg_ret };
        record_call("GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}",
                    discord_get_webhook_message(client, WEBHOOK_ID, WEBHOOK_TOKEN, WEBHOOK_MSG_ID, &ret), client);
    }
    else {
        record_na("GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}",
                  "not exercised: no message id captured for a webhook-authored message in this run");
    }
    /* PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id} */
    if (WEBHOOK_MSG_ID != 0) {
        struct discord_message msg_ret = { 0 };
        struct discord_ret_message ret = { .sync = &msg_ret };
        struct discord_edit_webhook_message params = { .content = "compat-edit" };
        record_call("PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}",
                    discord_edit_webhook_message(client, WEBHOOK_ID, WEBHOOK_TOKEN, WEBHOOK_MSG_ID, &params, &ret), client);
    }
    else {
        record_na("PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}",
                  "not exercised: no message id captured for a webhook-authored message in this run");
    }
    /* GET /webhooks/{webhook_id}/{webhook_token} */
    {
        struct discord_webhook wh_ret = { 0 };
        struct discord_ret_webhook ret = { .sync = &wh_ret };
        record_call("GET /webhooks/{webhook_id}/{webhook_token}",
                    discord_get_webhook_with_token(client, WEBHOOK_ID, WEBHOOK_TOKEN, &ret), client);
    }
    /* PATCH /webhooks/{webhook_id}/{webhook_token} */
    {
        struct discord_webhook wh_ret = { 0 };
        struct discord_ret_webhook ret = { .sync = &wh_ret };
        struct discord_modify_webhook_with_token params = { .name = "compat-renamed" };
        record_call("PATCH /webhooks/{webhook_id}/{webhook_token}",
                    discord_modify_webhook_with_token(client, WEBHOOK_ID, WEBHOOK_TOKEN, &params, &ret), client);
    }
    /* POST /webhooks/{webhook_id}/{webhook_token} */
    {
        struct discord_ret ret = { .sync = true };
        struct discord_execute_webhook params = { .content = "compat" };
        record_call("POST /webhooks/{webhook_id}/{webhook_token}",
                    discord_execute_webhook(client, WEBHOOK_ID, WEBHOOK_TOKEN, &params, &ret), client);
    }
    /* GET /webhooks/{webhook_id} */
    {
        struct discord_webhook wh_ret = { 0 };
        struct discord_ret_webhook ret = { .sync = &wh_ret };
        record_call("GET /webhooks/{webhook_id}",
                    discord_get_webhook(client, WEBHOOK_ID, &ret), client);
    }
    /* PATCH /webhooks/{webhook_id} */
    {
        struct discord_webhook wh_ret = { 0 };
        struct discord_ret_webhook ret = { .sync = &wh_ret };
        struct discord_modify_webhook params = { .name = "compat-renamed2" };
        record_call("PATCH /webhooks/{webhook_id}",
                    discord_modify_webhook(client, WEBHOOK_ID, &params, &ret), client);
    }

    /* ---- DELETE calls last ---- */

    /* DELETE .../reactions/{emoji_name}/{user_id} */
    {
        struct discord_ret ret = { .sync = true };
        record_call("DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}",
                    discord_delete_user_reaction(client, CHANNEL_ID, MSG, BOT_USER_ID, 0, EMOJI_NAME, &ret), client);
    }
    /* DELETE .../reactions/{emoji_name}/@me */
    {
        struct discord_ret ret = { .sync = true };
        record_call("DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me",
                    discord_delete_own_reaction(client, CHANNEL_ID, MSG, 0, EMOJI_NAME, &ret), client);
    }
    /* DELETE .../reactions (all) */
    {
        struct discord_ret ret = { .sync = true };
        record_call("DELETE /channels/{channel_id}/messages/{message_id}/reactions",
                    discord_delete_all_reactions(client, CHANNEL_ID, MSG, &ret), client);
    }
    /* DELETE .../messages/{message_id} */
    {
        struct discord_ret ret = { .sync = true };
        struct discord_delete_message params = { 0 };
        record_call("DELETE /channels/{channel_id}/messages/{message_id}",
                    discord_delete_message(client, CHANNEL_ID, MSG, &params, &ret), client);
    }
    /* DELETE .../messages/pins/{message_id} (new format) */
    record_na("DELETE /channels/{channel_id}/messages/pins/{message_id}",
              "no wrapper: discord_unpin_message() targets the legacy "
              "/channels/{id}/pins/{message_id} route, not the new "
              "/messages/pins API (confirmed via include/channel.h)");
    /* DELETE .../permissions/{overwrite_id} */
    {
        struct discord_ret ret = { .sync = true };
        struct discord_delete_channel_permission params = { 0 };
        record_call("DELETE /channels/{channel_id}/permissions/{overwrite_id}",
                    discord_delete_channel_permission(client, CHANNEL_ID, BOT_USER_ID, &params, &ret), client);
    }
    /* DELETE .../pins/{message_id} (legacy) — MSG was already deleted above,
     * so this exercises the unpin-of-an-already-gone-message path; still a
     * real wire-format call. */
    {
        struct discord_ret ret = { .sync = true };
        struct discord_unpin_message params = { 0 };
        record_call("DELETE /channels/{channel_id}/pins/{message_id}",
                    discord_unpin_message(client, CHANNEL_ID, MSG, &params, &ret), client);
    }
    /* DELETE .../thread-members/{user_id} */
    {
        struct discord_ret ret = { .sync = true };
        record_call("DELETE /channels/{channel_id}/thread-members/{user_id}",
                    discord_remove_thread_member(client, THREAD, BOT_USER_ID, &ret), client);
    }
    /* DELETE .../thread-members/@me */
    {
        struct discord_ret ret = { .sync = true };
        record_call("DELETE /channels/{channel_id}/thread-members/@me",
                    discord_leave_thread(client, THREAD, &ret), client);
    }
    /* DELETE /channels/{channel_id} — shared resource, not exercised */
    record_na("DELETE /channels/{channel_id}",
              "not exercised: would delete the shared test channel other rows depend on");
    /* DELETE /guilds/{guild_id}/bans/{user_id} */
    {
        struct discord_ret ret = { .sync = true };
        struct discord_remove_guild_ban params = { 0 };
        record_call("DELETE /guilds/{guild_id}/bans/{user_id}",
                    discord_remove_guild_ban(client, GUILD_ID, BOT_USER_ID, &params, &ret), client);
    }
    /* DELETE /guilds/{guild_id}/emojis/{emoji_id} */
    {
        struct discord_ret ret = { .sync = true };
        struct discord_delete_guild_emoji params = { 0 };
        record_call("DELETE /guilds/{guild_id}/emojis/{emoji_id}",
                    discord_delete_guild_emoji(client, GUILD_ID, EMOJI_ID, &params, &ret), client);
    }
    /* DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id} */
    {
        struct discord_ret ret = { .sync = true };
        struct discord_remove_guild_member_role params = { 0 };
        record_call("DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}",
                    discord_remove_guild_member_role(client, GUILD_ID, BOT_USER_ID, ROLE, &params, &ret), client);
    }
    /* DELETE /guilds/{guild_id}/members/{user_id} — bot itself, not exercised */
    record_na("DELETE /guilds/{guild_id}/members/{user_id}",
              "not exercised: would remove the bot itself from the shared test guild");
    /* DELETE /guilds/{guild_id}/roles/{role_id} — shared role, not exercised */
    record_na("DELETE /guilds/{guild_id}/roles/{role_id}",
              "not exercised: would remove the role other rows (member-role add/remove) still need");
    /* DELETE /guilds/{guild_id} — shared guild, not exercised */
    record_na("DELETE /guilds/{guild_id}",
              "not exercised: would delete the shared test guild other rows depend on");
    /* DELETE /invites/{code} */
    {
        struct discord_invite inv_ret = { 0 };
        struct discord_ret_invite ret = { .sync = &inv_ret };
        struct discord_delete_invite params = { 0 };
        record_call("DELETE /invites/{code}",
                    discord_delete_invite(client, INVITE_CODE, &params, &ret), client);
    }
    /* DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id} */
    if (WEBHOOK_MSG_ID != 0) {
        struct discord_ret ret = { .sync = true };
        record_call("DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}",
                    discord_delete_webhook_message(client, WEBHOOK_ID, WEBHOOK_TOKEN, WEBHOOK_MSG_ID, &ret), client);
    }
    else {
        record_na("DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}",
                  "not exercised: no message id captured for a webhook-authored message in this run");
    }
    /* DELETE /webhooks/{webhook_id}/{webhook_token} — shared webhook, not exercised */
    record_na("DELETE /webhooks/{webhook_id}/{webhook_token}",
              "not exercised: would delete the shared webhook other rows still need");
    /* DELETE /webhooks/{webhook_id} — same shared webhook, not exercised */
    record_na("DELETE /webhooks/{webhook_id}",
              "not exercised: would delete the shared webhook other rows still need");

    write_report("master (git clone --depth 1, built at image build time)");

    int pass_count = 0;
    for (int i = 0; i < g_nresults; i++) {
        if (strcmp(g_results[i].status, "pass") == 0) pass_count++;
    }
    printf("concord done: %d/%d pass (%d n-a)\n", pass_count, g_nresults,
           (int)(g_nresults - pass_count));
    for (int i = 0; i < g_nresults; i++) {
        if (strcmp(g_results[i].status, "n-a") != 0
            && strcmp(g_results[i].status, "pass") != 0) {
            /* lib-issue, not fatal, just surfaced for the run log */
            fprintf(stderr, "lib-issue: %s: %s\n", g_results[i].endpoint, g_results[i].note);
        }
    }

    discord_cleanup(client);
    curl_global_cleanup();
    return 0;
}
