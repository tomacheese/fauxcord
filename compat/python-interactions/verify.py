"""discord-py-interactions (interactions.py) 5.16.0 compatibility verifier.

interactions.py is a bot-focused, gateway-oriented library, but its REST
plumbing is fully decoupled from the gateway: `interactions.api.http.
http_client.HTTPClient` is a standalone class with no dependency on
`interactions.Client`/the gateway. Every call below goes through a bare
`HTTPClient` instance -- never through a full `Client()` -- so no gateway
connection is ever opened, matching the "gateway-free" methodology used by
compat/python-hikari/verify.py and compat/python-discordpy/verify.py for the
same class of decisions. All of the following was source-verified in this
session against the pinned `5.16.0` git tag of
https://github.com/interactions-py/interactions.py (not master, not
guessed/by-analogy), unless explicitly marked otherwise.

Key decisions worth documenting explicitly:

* Base URL override: confirmed via source
  (`interactions/api/http/route.py`): `Route.BASE` is a `ClassVar[str]`,
  default `f"https://discord.com/api/v{__api_version__}"`. There is no
  per-instance override -- every `HTTPClient`/`Route` in the process shares
  this class attribute -- so it must be reassigned at module scope *before*
  any request is made: `Route.BASE = FAUXCORD_BASE`. This exactly matches
  the mechanism described for this verifier's task brief and is asserted
  with high confidence (direct source read, both on `master` and on the
  `5.16.0` tag).
* Gateway-free client construction: `HTTPClient` (source-verified in
  `interactions/api/http/http_client.py`) is NOT re-exported from the
  top-level `interactions` package (`from interactions import HTTPClient`
  fails); it is imported directly from
  `interactions.api.http.http_client`. Its `__init__` takes only transport
  options (`connector`, `logger`, `show_ratelimit_tracebacks`, `proxy`) --
  no `Client`/gateway object is required to construct or use it.
  `interactions.Client.__init__` does construct its own internal
  `HTTPClient` (`self.http = HTTPClient(...)`, `client.py:365`), but reusing
  that would require calling `Client.astart()`/`Client.login()`, which (per
  `client.py:955`, `await self.http.login(self.token)`, immediately followed
  by gateway-connection code) is entangled with opening a real Gateway
  WebSocket -- something Fauxcord cannot serve (see
  docs/getting-started.md: "What it cannot do: WebSocket"). Constructing a
  bare `HTTPClient()` directly sidesteps this entirely.
* Login/session init: confirmed necessary and sufficient. `HTTPClient.
  __init__` does not open an aiohttp session (`self.__session: ClientSession
  | None = None`); `HTTPClient.request()` unconditionally does
  `if self.__session.closed: await self.login(...)`, which raises
  `AttributeError` on a `None` session. `HTTPClient.login(token)` (source-
  verified) opens the `ClientSession`, sets `self.token = token`, and then
  issues one real `GET /users/@me` call to validate the token and fetch the
  bot's own user data -- no gateway handshake, no WebSocket, just a plain
  HTTP GET. This verifier therefore explicitly calls
  `await client.login(TOKEN)` once, before any other endpoint call, exactly
  mirroring `Client.astart()`'s use of the same method minus the gateway
  part that follows it there.
* Token format: `HTTPClient.request()` hardcodes
  `kwargs["headers"]["Authorization"] = f"Bot {self.token}"` (source-
  verified, `http_client.py`) -- i.e. `self.token` must NOT already include
  the `"Bot "` prefix. `setup.json`'s token does include the prefix (as
  Fauxcord's `/_test/setup` expects), so it is stripped before being passed
  to `login()`, the same convention as hikari/discord.py's login calls.
* Pins -- new vs. legacy API shape: source-verified across every file in
  `interactions/api/http/http_requests/` (`messages.py`, `channels.py`) --
  the only pin-related wrappers that exist anywhere in the library are
  `pin_message`/`unpin_message` (both hitting the legacy
  `PUT`/`DELETE /channels/{channel_id}/pins/{message_id}`) and
  `get_pinned_messages` (hitting the legacy `GET
  /channels/{channel_id}/pins`, confirmed by reading its body: `Route("GET",
  "/channels/{channel_id}/pins", ...)`). No wrapper anywhere targets the
  newer `/channels/{channel_id}/messages/pins*` shape that discord.py 2.7+
  uses internally -- this is a confirmed absence, not a guess, so the three
  new-format pin endpoints are recorded `n-a`.
* OAuth2 handling: `interactions.py`'s `HTTPClient` is bot-token-only --
  `request()` unconditionally sends `Authorization: Bot {token}` with no
  Bearer/user-token code path anywhere in the class (source-verified, no
  second branch exists). Consequently:
  - `POST /oauth2/token` and `POST /oauth2/token/revoke`: no wrapper exists
    anywhere in the library (only `bot.py`'s `BotRequests` mixin touches
    `/oauth2/*`, and it only has the two `GET` methods below) -- the library
    has no OAuth2 grant-flow support at all (neither client_credentials nor
    authorization_code). Both recorded `n-a`.
  - `GET /oauth2/applications/@me` (`get_current_bot_information`) and
    `GET /oauth2/@me` (`get_current_authorisation_information`) do have
    public wrappers and are exercised for real. Note that
    `get_current_authorisation_information` is, per the point above, sent
    with the bot's own `Bot`-prefixed Authorization header rather than a
    genuine OAuth2 bearer/user access token -- this is a real library
    limitation (not a verifier shortcut): interactions.py has no way to
    drive a true `/oauth2/@me` bearer-token call. Whatever Fauxcord returns
    for that mismatched auth scheme is recorded honestly as `pass` or
    `lib-issue`, not faked.
* Return values are plain dicts, not model objects: unlike hikari (whose
  `RESTClientImpl` returns rich objects with `.id` etc.), `HTTPClient`'s
  methods return the raw JSON payload cast to a `discord_typings.*` TypedDict
  (e.g. `create_message(...)` returns a `dict`, not a `Message`). Bootstrap
  code below therefore indexes results with `["id"]`/`["token"]`/etc., not
  attribute access.
* List/pagination endpoints are single-shot, not async generators: unlike
  hikari's `RESTClientImpl` (which exposes `fetch_messages`,
  `fetch_members`, etc. as async iterators that auto-paginate), every
  "list"-shaped `HTTPClient` method here (`list_members`, `get_guild_bans`,
  `list_public_archived_threads`, `get_channel_messages`, ...) is a single
  plain `await` returning one page as a list/dict -- source-verified, no
  generator anywhere in these files. No `async for` loops are needed.
* Gateway bootstrap info (`GET /gateway`, `GET /gateway/bot`): unlike the
  higher-level per-resource wrappers, these two are defined directly on
  `HTTPClient` itself (`get_gateway()`, `get_gateway_bot()`, source-verified
  in `http_client.py`) and are genuine standalone calls with no gateway
  connection ever opened -- exercised for real.
* Thread member lookup and thread search: `interactions/api/http/
  http_requests/threads.py` was read in full; it defines `join_thread`,
  `leave_thread`, `add_thread_member`, `remove_thread_member`,
  `list_thread_members` (plural only), `list_public_archived_threads`,
  `list_private_archived_threads`, `list_joined_private_archived_threads`,
  `list_active_threads`, `create_thread`, `create_forum_thread`. There is no
  singular "get one thread member" wrapper anywhere in the file, and no
  "thread search" wrapper anywhere in the library -- both confirmed absences,
  recorded `n-a`.
* `create_thread(channel_id, name, auto_archive_duration, ..., message_id=
  MISSING, ...)` (source-verified): passing `message_id=` routes the POST to
  `/channels/{channel_id}/messages/{message_id}/threads` (thread-from-
  message); omitting it routes to `/channels/{channel_id}/threads`
  (standalone thread). Both endpoint rows use this one method with/without
  `message_id`.
* `create_message`/`edit_message` take `payload` as their *first* positional
  argument, `channel_id` second (source-verified, an unusual order relative
  to almost every other method in this library, which take the resource
  path ids first) -- easy to get backwards, called out here explicitly.
* Emoji image payload: `create_guild_emoji(payload, guild_id, ...)` passes
  `payload` straight through as the JSON body with no client-side encoding
  helper (source-verified, no `image=`/file-upload helper exists on this
  method) -- the caller must supply the `image` field pre-encoded as a
  `data:image/png;base64,...` URI per the real Discord API contract, which
  this verifier does by hand.
* DELETE-last ordering: identical fix to compat/python-hikari/verify.py,
  compat/python-discordpy/verify.py, and the JS verifiers -- the canonical
  endpoint order in common/endpoints.json sometimes lists a DELETE/GET
  before the PUT/POST that creates the resource it acts on. Running every
  non-DELETE call first, then all DELETEs last, avoids false "Unknown X"
  errors caused by resource-lifecycle ordering rather than real
  library/Fauxcord bugs.
* Shared-resource DELETEs (`DELETE /channels/{channel_id}`,
  `DELETE /guilds/{guild_id}`, `DELETE /guilds/{guild_id}/members/{user_id}`,
  `DELETE /guilds/{guild_id}/roles/{role_id}`,
  `DELETE /webhooks/{webhook_id}[/{webhook_token}]`) are recorded `n-a` with
  a `not exercised: ...` note instead of being called, even though public
  wrappers exist for all of them (`delete_channel`, `delete_guild`,
  `remove_guild_member`, `delete_guild_role`, `delete_webhook`) -- calling
  them for real would delete a resource that other rows still depend on,
  same pattern as the other verifiers in this repo.
* Gateway phase, separate client instance: unlike discord.py/Nextcord (whose
  REST calls above already go through the same `Client` object that later
  opens the gateway), the REST phase here uses a bare `HTTPClient` with no
  gateway support at all (see the "Gateway-free client construction" bullet
  above), so the Gateway phase constructs its own `interactions.Client`.
  Source-verified (`interactions/client/client.py`, tag `5.16.0`):
  `Client.__init__` takes a `token` kwarg, `astart()` calls
  `await self.login(token)` then `await self._connection_state.start()`
  (opens the real websocket), and the IDENTIFY payload
  (`interactions/api/gateway/gateway.py`, `_identify()`) sends
  `self.state.client.http.token` verbatim -- the same *raw*, unprefixed
  token `HTTPClient.login()` uses above, not a `"Bot "`-prefixed string.
  `TOKEN` (already stripped of its `"Bot "` prefix for the REST client) is
  reused here for that reason.
* Listener registration: `interactions.listen()` is the library's
  module-level decorator (source-verified,
  `interactions/models/internal/listener.py`) -- it does not require a bound
  `Client` and infers the event from the decorated function's name
  (`on_ready` -> `Ready`) unless an explicit event is given; the resulting
  `Listener` object still has to be registered on the bot instance via
  `bot.add_listener(...)`, which is why both are used together below rather
  than the instance-bound `@bot.listen()` form.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

import aiohttp
import interactions
from interactions import ChannelType, OverwriteType, Permissions
from interactions.api.http.http_client import HTTPClient
from interactions.api.http.route import Route

# --- configuration -----------------------------------------------------

FAUXCORD_BASE = os.environ.get("FAUXCORD_BASE", "http://fauxcord:3000/api/v10")
ORIGIN = re.sub(r"/api/v10$", "", FAUXCORD_BASE)

# Route.BASE is a ClassVar shared by every Route/HTTPClient in the process,
# so it must be reassigned before any request is made (see module docstring).
Route.BASE = FAUXCORD_BASE

COMMON_DIR = Path(__file__).resolve().parent / "common"
SETUP = json.loads((COMMON_DIR / "setup.json").read_text(encoding="utf-8"))
ENDPOINTS = json.loads((COMMON_DIR / "endpoints.json").read_text(encoding="utf-8"))

BOT = SETUP["user"]["id"]
GUILD = SETUP["guilds"][0]["id"]
CH = SETUP["guilds"][0]["channels"][0]["id"]
# HTTPClient.request() adds "Bot " itself, so the prefix from setup.json's
# token is stripped before login() (see module docstring).
TOKEN = SETUP["token"].removeprefix("Bot ")
EMOJI = "\U0001f44d"  # thumbs up
# 1x1 transparent PNG, same fixture used by the other verifiers.
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)
PNG_DATA_URI = "data:image/png;base64," + base64.b64encode(PNG_BYTES).decode("ascii")


# --- bootstrap helpers ---------------------------------------------------


async def wait_healthy() -> None:
    """Poll Fauxcord's `/_mock/health` endpoint until it responds ok.

    Retries up to 60 times, 1 second apart, matching the other verifiers'
    startup wait loop.
    """
    async with aiohttp.ClientSession() as session:
        for _ in range(60):
            try:
                async with session.get(f"{ORIGIN}/_mock/health") as resp:
                    if resp.status == 200:
                        return
            except aiohttp.ClientError:
                pass  # not up yet
            await asyncio.sleep(1)
    raise RuntimeError("fauxcord did not become healthy")


async def do_setup() -> None:
    """POST the shared setup payload.

    200/201 (created) and 409 (already set up by a prior run against a
    reused Fauxcord container) both count as success. Retries with backoff
    on network errors or unexpected statuses (see js-oceanic/verify.mjs's
    doSetup docstring for the incident this guards against). Raises if
    setup never succeeds so a genuine failure is loud instead of
    corrupting every downstream result.
    """
    max_attempts = 5
    last_status: int | None = None
    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(f"{ORIGIN}/_test/setup", json=SETUP) as res:
                    if res.ok or res.status == 409:
                        return
                    last_status = res.status
        except aiohttp.ClientError as e:
            last_error = e
        if attempt < max_attempts:
            await asyncio.sleep(attempt)
    raise RuntimeError(
        f"do_setup: failed to POST /_test/setup after {max_attempts} attempts "
        f"(last_status={last_status}, last_error={last_error})"
    )


# --- main verification run ------------------------------------------------

Note = Optional[str]
CallEntry = tuple[Optional[Callable[[], Awaitable[Any]]], Note]


def _classify_gateway_error(err: BaseException | None) -> tuple[str, str]:
    """Classify a Gateway connect failure as a Fauxcord bug or a lib issue.

    interactions.py's `ClientUser` (source-verified,
    `interactions/models/discord/user.py`, tag `5.16.0`) declares `verified`
    as a required keyword-only field with no default, and the gateway's
    internal READY handler constructs it straight from `d.user` before ever
    firing the `Ready` listener. Fauxcord's READY payload's `user` object
    (`src/gateway/server.ts`) used to only send `{id, username, bot}` -- no
    `verified` -- so `ClientUser(**user_data)` raised `TypeError` before
    `on_ready` ever ran. Real Discord's own READY payload does include
    `verified` for the bot's own user (per the Discord API docs, the
    identify/`users/@me` context always returns it, unlike third-party user
    objects), so this was a genuine Fauxcord gap, the same class of bug as
    the missing `application` field fixed earlier -- not an interactions.py
    issue. This has since been fixed on the Fauxcord side (the READY `user`
    object now matches the REST `/users/@me` shape, including `verified`),
    so this branch is expected to be dead code during normal runs; it is
    kept as a regression guard in case the READY payload's `user` shape
    ever drops the field again.
    @param err - The exception raised while `astart()` was processing READY, if any.
    @returns A `(status, note)` tuple.
    """
    is_missing_verified = isinstance(err, TypeError) and "verified" in str(err)
    if is_missing_verified:
        return (
            "fauxcord-fix",
            "Fauxcord's READY payload's user object omits `verified`, which "
            "interactions.py's ClientUser requires with no default "
            "(src/gateway/server.ts); real Discord always includes it for "
            "the bot's own user",
        )
    return ("lib-issue", str(err)[:300] if err is not None else "ready timeout")


async def main() -> None:
    await wait_healthy()
    await do_setup()

    # Bare HTTPClient, no interactions.Client/gateway involved (see module
    # docstring for why).
    client = HTTPClient()
    try:
        await client.login(TOKEN)

        # --- bootstrap resources referenced by later calls -------------
        # Best-effort: a failed step falls back to a placeholder id so
        # dependent rows still run (recorded as lib-issue) instead of
        # crashing the whole run.
        msg = await client.create_message({"content": "compat"}, CH)
        MSG = msg["id"]

        pin_msg = await client.create_message({"content": "compat-pin"}, CH)
        try:
            await client.pin_message(CH, pin_msg["id"])
        except Exception:
            pass  # bootstrap best-effort; the scored PUT row retries this

        thread_src_msg = await client.create_message({"content": "compat-thread-src"}, CH)
        try:
            boot_thread = await client.create_thread(
                CH, "compat-thread-boot", 60, message_id=thread_src_msg["id"]
            )
            await client.join_thread(boot_thread["id"])
        except Exception:
            boot_thread = None

        try:
            role = await client.create_guild_role(GUILD, {"name": "compat-role"})
        except Exception:
            role = None
        ROLE = role["id"] if role is not None else GUILD  # @everyone role id == guild id

        try:
            webhook = await client.create_webhook(CH, "compat-wh")
            WEBHOOK_ID = webhook["id"]
            WEBHOOK_TOKEN = webhook["token"]
        except Exception:
            webhook = None
            WEBHOOK_ID = 500000000000000001
            WEBHOOK_TOKEN = "compat-token-xyz"

        try:
            wh_msg = await client.execute_webhook(
                WEBHOOK_ID, WEBHOOK_TOKEN, {"content": "compat"}, wait=True
            )
            WH_MSG_ID = wh_msg["id"]
        except Exception:
            WH_MSG_ID = 400000000000000099

        try:
            invite = await client.create_channel_invite(CH)
            CODE = invite["code"]
        except Exception:
            CODE = "compat"

        try:
            emoji_obj = await client.create_guild_emoji(
                {"name": "compat", "image": PNG_DATA_URI}, GUILD
            )
            EMOJI_ID = emoji_obj["id"]
        except Exception:
            emoji_obj = None
            EMOJI_ID = 600000000000000001

        try:
            await client.create_reaction(CH, msg["id"], EMOJI)
        except Exception:
            pass  # reaction endpoints may still exercise the wire format

        try:
            await client.create_guild_ban(GUILD, BOT)
        except Exception:
            pass  # bootstrap best-effort; some rows depend on the ban existing

        # --- endpoint -> call table --------------------------------------
        # `fn` is a zero-arg callable returning an awaitable; `None` means
        # n-a (a note is then required as the second tuple element).

        async def bulk_delete() -> None:
            m1 = await client.create_message({"content": "compat-bulk-1"}, CH)
            m2 = await client.create_message({"content": "compat-bulk-2"}, CH)
            await client.bulk_delete_messages(CH, [m1["id"], m2["id"]])

        async def create_thread_from_message() -> None:
            await client.create_thread(CH, "compat-thread-scored", 60, message_id=MSG)

        async def create_standalone_thread() -> None:
            await client.create_thread(CH, "compat-thread-standalone", 60)

        async def set_permission_overwrite() -> None:
            await client.edit_channel_permission(
                CH, BOT, OverwriteType.MEMBER, allow=Permissions.VIEW_CHANNEL
            )

        async def clear_permission_overwrite() -> None:
            await client.delete_channel_permission(CH, BOT)

        async def edit_bot_webhook() -> None:
            await client.modify_webhook(WEBHOOK_ID, "compat-renamed2", None, CH)

        calls: dict[str, CallEntry] = {
            "GET /channels/{channel_id}/invites": (
                lambda: client.get_channel_invites(CH),
                None,
            ),
            "POST /channels/{channel_id}/invites": (
                lambda: client.create_channel_invite(CH),
                None,
            ),
            "DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}": (
                lambda: client.remove_user_reaction(CH, MSG, EMOJI, BOT),
                None,
            ),
            "DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me": (
                lambda: client.remove_self_reaction(CH, MSG, EMOJI),
                None,
            ),
            "PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me": (
                lambda: client.create_reaction(CH, MSG, EMOJI),
                None,
            ),
            "GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}": (
                lambda: client.get_reactions(CH, MSG, EMOJI),
                None,
            ),
            "DELETE /channels/{channel_id}/messages/{message_id}/reactions": (
                lambda: client.clear_reactions(CH, MSG),
                None,
            ),
            "POST /channels/{channel_id}/messages/{message_id}/threads": (
                create_thread_from_message,
                None,
            ),
            "DELETE /channels/{channel_id}/messages/{message_id}": (
                lambda: client.delete_message(CH, MSG),
                None,
            ),
            "GET /channels/{channel_id}/messages/{message_id}": (
                lambda: client.get_message(CH, MSG),
                None,
            ),
            "PATCH /channels/{channel_id}/messages/{message_id}": (
                lambda: client.edit_message({"content": "compat-edit"}, CH, MSG),
                None,
            ),
            "GET /channels/{channel_id}/messages": (
                lambda: client.get_channel_messages(CH),
                None,
            ),
            "POST /channels/{channel_id}/messages": (
                lambda: client.create_message({"content": "compat"}, CH),
                None,
            ),
            "POST /channels/{channel_id}/messages/bulk-delete": (bulk_delete, None),
            "DELETE /channels/{channel_id}/messages/pins/{message_id}": (
                None,
                "no wrapper found anywhere in interactions.py 5.16.0 for the newer "
                "/messages/pins API shape (source-verified across messages.py and "
                "channels.py); only the legacy /channels/{channel_id}/pins* routes are "
                "implemented (pin_message/unpin_message/get_pinned_messages)",
            ),
            "PUT /channels/{channel_id}/messages/pins/{message_id}": (
                None,
                "no wrapper found anywhere in interactions.py 5.16.0 for the newer "
                "/messages/pins API shape (source-verified across messages.py and "
                "channels.py); only the legacy /channels/{channel_id}/pins* routes are "
                "implemented (pin_message/unpin_message/get_pinned_messages)",
            ),
            "GET /channels/{channel_id}/messages/pins": (
                None,
                "no wrapper found anywhere in interactions.py 5.16.0 for the newer "
                "/messages/pins API shape (source-verified across messages.py and "
                "channels.py); only the legacy /channels/{channel_id}/pins* routes are "
                "implemented (pin_message/unpin_message/get_pinned_messages)",
            ),
            "DELETE /channels/{channel_id}/permissions/{overwrite_id}": (
                clear_permission_overwrite,
                None,
            ),
            "PUT /channels/{channel_id}/permissions/{overwrite_id}": (
                set_permission_overwrite,
                None,
            ),
            "DELETE /channels/{channel_id}/pins/{message_id}": (
                lambda: client.unpin_message(CH, pin_msg["id"]),
                None,
            ),
            "PUT /channels/{channel_id}/pins/{message_id}": (
                lambda: client.pin_message(CH, pin_msg["id"]),
                None,
            ),
            "GET /channels/{channel_id}/pins": (
                lambda: client.get_pinned_messages(CH),
                None,
            ),
            "DELETE /channels/{channel_id}/thread-members/{user_id}": (
                (
                    (lambda: client.remove_thread_member(boot_thread["id"], BOT))
                    if boot_thread is not None
                    else None
                ),
                None if boot_thread is not None else "not exercised: bootstrap thread creation failed",
            ),
            "GET /channels/{channel_id}/thread-members/{user_id}": (
                None,
                "no singular 'get one thread member' wrapper found anywhere in "
                "interactions.py 5.16.0's threads.py (source-verified); only the "
                "plural list_thread_members is implemented",
            ),
            "PUT /channels/{channel_id}/thread-members/{user_id}": (
                (
                    (lambda: client.add_thread_member(boot_thread["id"], BOT))
                    if boot_thread is not None
                    else None
                ),
                None if boot_thread is not None else "not exercised: bootstrap thread creation failed",
            ),
            "DELETE /channels/{channel_id}/thread-members/@me": (
                (
                    (lambda: client.leave_thread(boot_thread["id"]))
                    if boot_thread is not None
                    else None
                ),
                None if boot_thread is not None else "not exercised: bootstrap thread creation failed",
            ),
            "PUT /channels/{channel_id}/thread-members/@me": (
                (
                    (lambda: client.join_thread(boot_thread["id"]))
                    if boot_thread is not None
                    else None
                ),
                None if boot_thread is not None else "not exercised: bootstrap thread creation failed",
            ),
            "GET /channels/{channel_id}/thread-members": (
                (
                    (lambda: client.list_thread_members(boot_thread["id"]))
                    if boot_thread is not None
                    else None
                ),
                None if boot_thread is not None else "not exercised: bootstrap thread creation failed",
            ),
            "GET /channels/{channel_id}/threads/archived/private": (
                lambda: client.list_private_archived_threads(CH),
                None,
            ),
            "GET /channels/{channel_id}/threads/archived/public": (
                lambda: client.list_public_archived_threads(CH),
                None,
            ),
            "GET /channels/{channel_id}/threads/search": (
                None,
                "no thread-search wrapper found anywhere in interactions.py 5.16.0 "
                "(source-verified across all files in api/http/http_requests/)",
            ),
            "POST /channels/{channel_id}/threads": (create_standalone_thread, None),
            "POST /channels/{channel_id}/typing": (
                lambda: client.trigger_typing_indicator(CH),
                None,
            ),
            "GET /channels/{channel_id}/users/@me/threads/archived/private": (
                lambda: client.list_joined_private_archived_threads(CH),
                None,
            ),
            "GET /channels/{channel_id}/webhooks": (
                lambda: client.get_channel_webhooks(CH),
                None,
            ),
            "POST /channels/{channel_id}/webhooks": (
                lambda: client.create_webhook(CH, "compat-wh2"),
                None,
            ),
            "DELETE /channels/{channel_id}": (
                None,
                "not exercised: would delete the shared test channel other rows depend on",
            ),
            "GET /channels/{channel_id}": (lambda: client.get_channel(CH), None),
            "PATCH /channels/{channel_id}": (
                lambda: client.modify_channel(CH, {"name": "general"}),
                None,
            ),
            "GET /gateway/bot": (client.get_gateway_bot, None),
            "GET /gateway": (client.get_gateway, None),
            "DELETE /guilds/{guild_id}/bans/{user_id}": (
                lambda: client.remove_guild_ban(GUILD, BOT),
                None,
            ),
            "GET /guilds/{guild_id}/bans/{user_id}": (
                lambda: client.get_guild_ban(GUILD, BOT),
                None,
            ),
            "PUT /guilds/{guild_id}/bans/{user_id}": (
                lambda: client.create_guild_ban(GUILD, BOT),
                None,
            ),
            "GET /guilds/{guild_id}/bans": (lambda: client.get_guild_bans(GUILD), None),
            "GET /guilds/{guild_id}/channels": (
                lambda: client.get_guild_channels(GUILD),
                None,
            ),
            "POST /guilds/{guild_id}/channels": (
                lambda: client.create_guild_channel(GUILD, "compat-channel", ChannelType.GUILD_TEXT),
                None,
            ),
            "DELETE /guilds/{guild_id}/emojis/{emoji_id}": (
                (
                    (lambda: client.delete_guild_emoji(GUILD, emoji_obj["id"]))
                    if emoji_obj is not None
                    else None
                ),
                None if emoji_obj is not None else "not exercised: bootstrap emoji creation failed",
            ),
            "GET /guilds/{guild_id}/emojis/{emoji_id}": (
                lambda: client.get_guild_emoji(GUILD, EMOJI_ID),
                None,
            ),
            "PATCH /guilds/{guild_id}/emojis/{emoji_id}": (
                (
                    (lambda: client.modify_guild_emoji({"name": "compat2"}, GUILD, emoji_obj["id"]))
                    if emoji_obj is not None
                    else None
                ),
                None if emoji_obj is not None else "not exercised: bootstrap emoji creation failed",
            ),
            "GET /guilds/{guild_id}/emojis": (
                lambda: client.get_all_guild_emoji(GUILD),
                None,
            ),
            "POST /guilds/{guild_id}/emojis": (
                lambda: client.create_guild_emoji(
                    {"name": "compat3", "image": PNG_DATA_URI}, GUILD
                ),
                None,
            ),
            "DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}": (
                lambda: client.remove_guild_member_role(GUILD, BOT, ROLE),
                None,
            ),
            "PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}": (
                lambda: client.add_guild_member_role(GUILD, BOT, ROLE),
                None,
            ),
            "DELETE /guilds/{guild_id}/members/{user_id}": (
                None,
                "not exercised: would remove the bot itself from the shared test guild",
            ),
            "GET /guilds/{guild_id}/members/{user_id}": (
                lambda: client.get_member(GUILD, BOT),
                None,
            ),
            "PATCH /guilds/{guild_id}/members/{user_id}": (
                lambda: client.modify_guild_member(GUILD, BOT, nickname="compat"),
                None,
            ),
            "GET /guilds/{guild_id}/members": (lambda: client.list_members(GUILD), None),
            "DELETE /guilds/{guild_id}/roles/{role_id}": (
                None,
                "not exercised: would remove the role other rows (member-role add/remove) "
                "still need",
            ),
            "PATCH /guilds/{guild_id}/roles/{role_id}": (
                (
                    (
                        lambda: client.modify_guild_role(
                            GUILD, role["id"], {"name": "compat-role-renamed"}
                        )
                    )
                    if role is not None
                    else None
                ),
                None if role is not None else "not exercised: bootstrap role creation failed",
            ),
            "GET /guilds/{guild_id}/roles": (lambda: client.get_roles(GUILD), None),
            "POST /guilds/{guild_id}/roles": (
                lambda: client.create_guild_role(GUILD, {"name": "compat-role2"}),
                None,
            ),
            "GET /guilds/{guild_id}/webhooks": (
                lambda: client.get_guild_webhooks(GUILD),
                None,
            ),
            "DELETE /guilds/{guild_id}": (
                None,
                "not exercised: would delete the shared test guild other rows depend on "
                "(a public delete_guild wrapper does exist, unlike hikari, but real "
                "Discord also rejects this for bot tokens -- owner-only user-token "
                "action -- so calling it for real would either delete the shared guild "
                "or surface a spec-irrelevant auth error)",
            ),
            "GET /guilds/{guild_id}": (lambda: client.get_guild(GUILD), None),
            "PATCH /guilds/{guild_id}": (
                lambda: client.modify_guild(GUILD, name="Compat Guild"),
                None,
            ),
            "DELETE /invites/{code}": (lambda: client.delete_invite(CODE), None),
            "GET /invites/{code}": (lambda: client.get_invite(CODE), None),
            "GET /oauth2/@me": (client.get_current_authorisation_information, None),
            "GET /oauth2/applications/@me": (client.get_current_bot_information, None),
            "POST /oauth2/token/revoke": (
                None,
                "no OAuth2 grant-flow wrapper of any kind exists in interactions.py "
                "5.16.0 (source-verified: bot.py's BotRequests mixin only implements "
                "the two GET endpoints below; no POST /oauth2/token* wrapper anywhere)",
            ),
            "POST /oauth2/token": (
                None,
                "no OAuth2 grant-flow wrapper of any kind exists in interactions.py "
                "5.16.0 (source-verified: bot.py's BotRequests mixin only implements "
                "the two GET endpoints below; no POST /oauth2/token* wrapper anywhere)",
            ),
            "GET /users/{user_id}": (lambda: client.get_user(BOT), None),
            "GET /users/@me/guilds": (client.get_user_guilds, None),
            "GET /users/@me": (client.get_current_user, None),
            "PATCH /users/@me": (
                lambda: client.modify_client_user({"username": "CompatBot"}),
                None,
            ),
            "DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}": (
                lambda: client.delete_webhook_message(WEBHOOK_ID, WEBHOOK_TOKEN, WH_MSG_ID),
                None,
            ),
            "GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}": (
                lambda: client.get_webhook_message(WEBHOOK_ID, WEBHOOK_TOKEN, WH_MSG_ID),
                None,
            ),
            "PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}": (
                lambda: client.edit_webhook_message(
                    WEBHOOK_ID, WEBHOOK_TOKEN, WH_MSG_ID, {"content": "compat-edit"}
                ),
                None,
            ),
            "DELETE /webhooks/{webhook_id}/{webhook_token}": (
                None,
                "not exercised: would delete the shared webhook other rows still need",
            ),
            "GET /webhooks/{webhook_id}/{webhook_token}": (
                lambda: client.get_webhook(WEBHOOK_ID, WEBHOOK_TOKEN),
                None,
            ),
            "PATCH /webhooks/{webhook_id}/{webhook_token}": (
                lambda: client.modify_webhook(
                    WEBHOOK_ID, "compat-renamed", None, CH, webhook_token=WEBHOOK_TOKEN
                ),
                None,
            ),
            "POST /webhooks/{webhook_id}/{webhook_token}": (
                lambda: client.execute_webhook(
                    WEBHOOK_ID, WEBHOOK_TOKEN, {"content": "compat"}, wait=True
                ),
                None,
            ),
            "DELETE /webhooks/{webhook_id}": (
                None,
                "not exercised: would delete the shared webhook other rows still need",
            ),
            "GET /webhooks/{webhook_id}": (
                lambda: client.get_webhook(WEBHOOK_ID),
                None,
            ),
            "PATCH /webhooks/{webhook_id}": (edit_bot_webhook, None),
        }

        # Run non-DELETEs before DELETEs to avoid false "Unknown X" errors
        # from resource-lifecycle ordering (see module docstring).
        ordered = sorted(ENDPOINTS, key=lambda e: e["method"] == "DELETE")

        results: dict[str, dict[str, Any]] = {}
        for entry in ordered:
            method = entry["method"]
            path = entry["path"]
            key = f"{method} {path}"
            call_entry = calls.get(key)
            if call_entry is None or call_entry[0] is None:
                note = (
                    call_entry[1]
                    if call_entry is not None
                    else "no high-level interactions.py method found for this endpoint"
                )
                results[key] = {"endpoint": key, "status": "n-a", "note": note}
                continue
            fn = call_entry[0]
            try:
                await fn()
                results[key] = {"endpoint": key, "status": "pass", "note": ""}
            except Exception as err:  # noqa: BLE001 - recorded as a result row, not raised
                results[key] = {
                    "endpoint": key,
                    "status": "lib-issue",
                    "note": str(err)[:300],
                }

        # Re-key back to common/endpoints.json order for a stable matrix.
        ordered_results = [results[f"{e['method']} {e['path']}"] for e in ENDPOINTS]

        async def verify_gateway() -> dict:
            """Run the Gateway connect + dispatch verification using
            interactions.py's high-level `Client` (separate from the raw
            `HTTPClient` used for REST above, which has no gateway support at
            all -- see module docstring).
            """
            steps: list[dict] = []
            bot = interactions.Client(token=TOKEN)
            ready_event = asyncio.Event()
            message_event = asyncio.Event()

            @interactions.listen()
            async def on_ready() -> None:
                ready_event.set()

            @interactions.listen()
            async def on_message_create(
                event: interactions.events.MessageCreate,
            ) -> None:
                if event.message.content == "gateway-compat-check":
                    message_event.set()

            bot.add_listener(on_ready)
            bot.add_listener(on_message_create)

            start_task = asyncio.create_task(bot.astart())
            ready_task = asyncio.create_task(ready_event.wait())
            done, _pending = await asyncio.wait(
                {start_task, ready_task},
                timeout=20,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if ready_task not in done:
                # Either the 20s guard elapsed, or astart() itself raised
                # before READY (e.g. the gateway closed the socket during
                # IDENTIFY, or READY's `user` payload failed to parse). Pull
                # the real exception out of start_task when available
                # instead of reporting a bare timeout, same approach as
                # compat/python-discordpy/verify.py's verify_gateway().
                err: BaseException | None = None
                if start_task in done and not start_task.cancelled():
                    err = start_task.exception()
                status, note = _classify_gateway_error(err)
                steps.append(
                    {
                        "step": "connect-identify-ready",
                        "status": status,
                        "note": note,
                    }
                )
                ready_task.cancel()
                start_task.cancel()
                await asyncio.gather(ready_task, start_task, return_exceptions=True)
                # Client.stop() -> _connection_state.stop() unconditionally
                # calls self.gateway.close(), which raises TypeError when
                # the connect failed before a gateway object was ever
                # assigned (e.g. the READY parse crash above). Best-effort:
                # the connect-phase result above is already recorded, so a
                # cleanup-only failure here shouldn't overwrite it.
                try:
                    await bot.stop()
                except Exception:  # noqa: BLE001
                    pass
                return {"status": status, "steps": steps}

            steps.append(
                {"step": "connect-identify-ready", "status": "pass", "note": ""}
            )

            try:
                channel = await bot.fetch_channel(int(CH))
                await channel.send("gateway-compat-check")
                await asyncio.wait_for(message_event.wait(), timeout=15)
                steps.append(
                    {"step": "dispatch-message-create", "status": "pass", "note": ""}
                )
            except Exception as err:  # noqa: BLE001
                steps.append(
                    {
                        "step": "dispatch-message-create",
                        "status": "lib-issue",
                        "note": str(err)[:300],
                    }
                )
            finally:
                await bot.stop()
                start_task.cancel()
                await asyncio.gather(start_task, return_exceptions=True)

            failed = next((s for s in steps if s["status"] != "pass"), None)
            return {"status": failed["status"] if failed else "pass", "steps": steps}

        gateway_result = await verify_gateway()

        output = {
            "library": "interactions.py",
            "version": "5.16.0",
            "baseUrlOverridable": True,
            "results": ordered_results,
            "gateway": gateway_result,
        }
        Path("/results").mkdir(parents=True, exist_ok=True)
        Path("/results/interactions.json").write_text(
            json.dumps(output, indent=2), encoding="utf-8"
        )

        pass_count = sum(1 for r in ordered_results if r["status"] == "pass")
        print(f"interactions.py done: {pass_count}/{len(ordered_results)} pass")
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
