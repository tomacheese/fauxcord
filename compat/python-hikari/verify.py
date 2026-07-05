"""hikari 2.5.0 compatibility verifier.

hikari is unusual among the libraries in this compat matrix: it ships a
first-class, documented, gateway-free REST client (`hikari.RESTApp` /
`RESTClientImpl`) with flat public methods (`rest.fetch_channel(...)`, etc.)
directly on the client object, rather than an object model reached via a
logged-in gateway `Client`/`Bot` (contrast discord.py). Every call below uses
that public `RESTClientImpl` surface, never an internal/private HTTP layer.

Key decisions worth documenting explicitly (mirrors the comment style used in
compat/js-oceanic/verify.mjs and compat/python-discordpy/verify.py):

* Base URL override: `hikari.RESTApp(url=...)` and `RESTClientImpl`'s
  `rest_url` param are documented as overridable to point at a mock/non-
  Discord origin (see hikari's RESTApp/RESTClientImpl API reference:
  https://docs.hikari-py.dev/en/latest/reference/hikari/impl/rest/). We pass
  `url=FAUXCORD_BASE`, matching that documented contract.
* Client acquisition: `RESTApp` is a factory, not a request client itself.
  `await rest_app.start()` then `async with rest_app.acquire(token, type) as
  rest:` yields the actual `RESTClientImpl`; `rest_app.close()` tears it down.
* Login/token format: per docs/libraries.md, hikari's token is passed
  *without* the `"Bot "` prefix to `acquire()` (`TokenType.BOT` supplies it
  internally), same convention as discord.py's `Client.login()`.
* Reaction removal for an explicit (non-self) `{user_id}`: unlike discord.py
  (whose single `remove_reaction()` branches internally to `/@me` when the
  member id matches the bot's own), hikari exposes two distinct methods --
  `delete_my_reaction()` (always `/@me`) and `delete_reaction(...)` (always
  the explicit `{user_id}` route). So the explicit-id endpoint can be
  exercised for real here even with only one registered test user, unlike
  the discord.py verifier's `n-a` for this row.
* Pins: it wasn't confirmed during authoring whether hikari's
  `fetch_pins`/`pin_message`/`unpin_message` migrated to the newer
  `/channels/{id}/messages/pins*` shape discord.py 2.7+ uses. Rather than
  guess, they're treated as exercising the legacy `/channels/{id}/pins*`
  routes, and the newer `/messages/pins*` routes are recorded `n-a`.
* Gateway bootstrap info (`GET /gateway`, `GET /gateway/bot`): unlike
  discord.py (fetched only internally by `connect()`/`start()`), hikari
  exposes standalone public methods for both (`fetch_gateway_url()`,
  `fetch_gateway_bot_info()`), callable with no gateway connection opened.
* Thread search (`GET /channels/{channel_id}/threads/search`): no public
  wrapper found on hikari's `RESTClient`; `n-a` rather than guessing.
* OAuth2: hikari can drive the client_credentials grant end to end via
  `authorize_client_credentials_token(client, secret, scopes)`, which maps to
  `POST /oauth2/token`. Fauxcord auto-registers unseen `client_id`s, so a
  throwaway id/secret works without extra bootstrap. The resulting bearer
  token is used to acquire a second, short-lived `TokenType.BEARER` client
  for `fetch_authorization()` (`GET /oauth2/@me`). `fetch_application()`
  covers `GET /oauth2/applications/@me`. `revoke_access_token()`'s parameter
  order wasn't independently source-verified during authoring, so a wrong
  signature will surface honestly as a `lib-issue` rather than a faked pass.
  `authorize_access_token`/`refresh_access_token` (auth-code grant) aren't
  exercised: they need a real `code`/`refresh_token` from the interactive
  `/oauth2/authorize` redirect, which this non-interactive verifier can't do.
* Bulk delete: `rest.delete_messages(channel, messages)` wraps
  `POST /channels/{channel_id}/messages/bulk-delete`; uses two throwaway
  messages so the shared `MSG` used by other rows is untouched.
* DELETE-last ordering: same fix as the other verifiers in this repo --
  common/endpoints.json sometimes lists a DELETE/GET before the PUT/POST that
  creates the resource it acts on, causing false "Unknown X" errors. Running
  all non-DELETE calls first, then DELETEs last, avoids that.
* Shared-resource DELETEs (channel, guild member, guild role, webhook) are
  recorded `n-a` instead of called, since deleting them would break other
  rows that depend on the resource still existing -- same pattern as the
  other verifiers.
* `DELETE /guilds/{guild_id}`: hikari has no `delete_guild` method, matching
  the real API (bots cannot delete guilds) -- `n-a`.
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
import hikari

# --- configuration -----------------------------------------------------

FAUXCORD_BASE = os.environ.get("FAUXCORD_BASE", "http://fauxcord:3000/api/v10")
ORIGIN = re.sub(r"/api/v10$", "", FAUXCORD_BASE)

COMMON_DIR = Path(__file__).resolve().parent / "common"
SETUP = json.loads((COMMON_DIR / "setup.json").read_text(encoding="utf-8"))
ENDPOINTS = json.loads((COMMON_DIR / "endpoints.json").read_text(encoding="utf-8"))

BOT = SETUP["user"]["id"]
GUILD = SETUP["guilds"][0]["id"]
CH = SETUP["guilds"][0]["channels"][0]["id"]
# setup.json's token includes the "Bot " prefix (as Fauxcord's /_test/setup
# expects); hikari's RESTApp.acquire() wants the raw token without it, with
# the prefix supplied separately via token_type=hikari.TokenType.BOT.
TOKEN = SETUP["token"].removeprefix("Bot ")
EMOJI = "\U0001f44d"  # thumbs up
# 1x1 transparent PNG, same fixture used by the other verifiers.
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)


# --- bootstrap helpers ---------------------------------------------------


async def wait_healthy() -> None:
    """Poll `/_mock/health` until it responds ok (60 retries, 1s apart), matching the other verifiers' startup wait loop."""
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

    200/201 and 409 (already set up by a prior run against a reused
    container) both count as success. Retries with backoff on network
    errors or unexpected statuses; raises after exhausting attempts so a
    genuine failure is loud instead of corrupting every downstream result.
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


async def main() -> None:
    await wait_healthy()
    await do_setup()

    # Point hikari's REST-only client factory at Fauxcord instead of the real
    # Discord API (see module docstring for the citation on `url=`).
    rest_app = hikari.RESTApp(url=FAUXCORD_BASE)
    await rest_app.start()

    try:
        async with rest_app.acquire(TOKEN, hikari.TokenType.BOT) as rest:
            # --- bootstrap resources referenced by later calls -------------
            # Best-effort: a failed bootstrap step falls back to a
            # placeholder id so dependent rows still run (recorded as
            # lib-issue) instead of crashing the whole run.
            msg = await rest.create_message(CH, content="compat")
            MSG = msg.id

            pin_msg = await rest.create_message(CH, content="compat-pin")
            try:
                await rest.pin_message(CH, pin_msg.id)
            except Exception:
                pass  # bootstrap best-effort; the scored PUT row retries this

            thread_src_msg = await rest.create_message(CH, content="compat-thread-src")
            try:
                boot_thread = await rest.create_message_thread(
                    CH, thread_src_msg.id, "compat-thread-boot"
                )
                await rest.join_thread(boot_thread.id)
            except Exception:
                boot_thread = None

            try:
                role = await rest.create_role(GUILD, name="compat-role")
            except Exception:
                role = None
            ROLE = role.id if role is not None else GUILD  # @everyone role id == guild id

            try:
                webhook = await rest.create_webhook(CH, "compat-wh")
                WEBHOOK_ID = webhook.id
                WEBHOOK_TOKEN = webhook.token
            except Exception:
                webhook = None
                WEBHOOK_ID = 500000000000000001
                WEBHOOK_TOKEN = "compat-token-xyz"

            try:
                wh_msg = await rest.execute_webhook(
                    WEBHOOK_ID, WEBHOOK_TOKEN, content="compat", wait=True
                )
                WH_MSG_ID = wh_msg.id
            except Exception:
                WH_MSG_ID = 400000000000000099

            try:
                invite = await rest.create_invite(CH)
                CODE = invite.code
            except Exception:
                CODE = "compat"

            try:
                emoji_obj = await rest.create_emoji(GUILD, "compat", PNG_BYTES)
                EMOJI_ID = emoji_obj.id
            except Exception:
                emoji_obj = None
                EMOJI_ID = 600000000000000001

            try:
                await rest.add_reaction(CH, msg.id, EMOJI)
            except Exception:
                pass  # reaction endpoints may still exercise the wire format

            try:
                await rest.ban_user(GUILD, BOT)
            except Exception:
                pass  # bootstrap best-effort; some rows depend on the ban existing

            # --- endpoint -> call table --------------------------------------
            # `fn` is a zero-arg callable returning an awaitable; `None` means
            # n-a (a note is then required as the second tuple element).

            async def get_legacy_pins() -> None:
                await rest.fetch_pins(CH)

            async def clear_all_reactions() -> None:
                await rest.delete_all_reactions(CH, MSG)

            async def get_reaction_users() -> None:
                async for _ in rest.fetch_reactions_for_emoji(CH, MSG, EMOJI):
                    pass

            async def bulk_delete() -> None:
                m1 = await rest.create_message(CH, content="compat-bulk-1")
                m2 = await rest.create_message(CH, content="compat-bulk-2")
                await rest.delete_messages(CH, [m1.id, m2.id])

            async def archived_public() -> None:
                async for _ in rest.fetch_public_archived_threads(CH):
                    pass

            async def archived_private() -> None:
                async for _ in rest.fetch_private_archived_threads(CH):
                    pass

            async def archived_private_joined() -> None:
                async for _ in rest.fetch_joined_private_archived_threads(CH):
                    pass

            async def fetch_members() -> None:
                async for _ in rest.fetch_members(GUILD):
                    pass

            async def fetch_bans() -> None:
                async for _ in rest.fetch_bans(GUILD):
                    pass

            async def fetch_own_guilds() -> None:
                await rest.fetch_my_guilds()

            async def get_history() -> None:
                async for _ in rest.fetch_messages(CH):
                    pass

            async def add_thread_member() -> None:
                assert boot_thread is not None
                await rest.add_thread_member(boot_thread.id, BOT)

            async def remove_thread_member() -> None:
                assert boot_thread is not None
                await rest.remove_thread_member(boot_thread.id, BOT)

            async def fetch_thread_member() -> None:
                assert boot_thread is not None
                await rest.fetch_thread_member(boot_thread.id, BOT)

            async def fetch_thread_members() -> None:
                assert boot_thread is not None
                await rest.fetch_thread_members(boot_thread.id)

            async def join_thread() -> None:
                assert boot_thread is not None
                await rest.join_thread(boot_thread.id)

            async def leave_thread() -> None:
                assert boot_thread is not None
                await rest.leave_thread(boot_thread.id)

            async def create_thread_from_message() -> None:
                await rest.create_message_thread(CH, MSG, "compat-thread-scored")

            async def create_standalone_thread() -> None:
                await rest.create_thread(
                    CH, hikari.ChannelType.GUILD_PUBLIC_THREAD, "compat-thread-standalone"
                )

            async def set_permission_overwrite() -> None:
                await rest.edit_permission_overwrite(
                    CH, BOT, target_type=hikari.PermissionOverwriteType.MEMBER, allow=hikari.Permissions.VIEW_CHANNEL
                )

            async def clear_permission_overwrite() -> None:
                await rest.delete_permission_overwrite(CH, BOT)

            async def delete_invite() -> None:
                await rest.delete_invite(CODE)

            async def edit_bot_webhook() -> None:
                await rest.edit_webhook(WEBHOOK_ID, name="compat-renamed2")

            async def oauth2_token_client_credentials() -> str:
                """POST /oauth2/token via client_credentials; returns the access token for `oauth2_me` to reuse against GET /oauth2/@me."""
                client_id = 999000000000000001
                token_response = await rest.authorize_client_credentials_token(
                    client_id, "compat-client-secret", scopes=[hikari.OAuth2Scope.IDENTIFY]
                )
                return token_response.access_token

            async def oauth2_revoke() -> None:
                client_id = 999000000000000001
                access_token = await oauth2_token_client_credentials()
                await rest.revoke_access_token(
                    client_id, "compat-client-secret", access_token
                )

            async def oauth2_me() -> None:
                access_token = await oauth2_token_client_credentials()
                async with rest_app.acquire(
                    access_token, hikari.TokenType.BEARER
                ) as bearer_rest:
                    await bearer_rest.fetch_authorization()

            calls: dict[str, CallEntry] = {
                "GET /channels/{channel_id}/invites": (
                    lambda: rest.fetch_channel_invites(CH),
                    None,
                ),
                "POST /channels/{channel_id}/invites": (
                    lambda: rest.create_invite(CH),
                    None,
                ),
                "DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}": (
                    lambda: rest.delete_reaction(CH, MSG, BOT, EMOJI),
                    None,
                ),
                "DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me": (
                    lambda: rest.delete_my_reaction(CH, MSG, EMOJI),
                    None,
                ),
                "PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me": (
                    lambda: rest.add_reaction(CH, MSG, EMOJI),
                    None,
                ),
                "GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}": (
                    get_reaction_users,
                    None,
                ),
                "DELETE /channels/{channel_id}/messages/{message_id}/reactions": (
                    clear_all_reactions,
                    None,
                ),
                "POST /channels/{channel_id}/messages/{message_id}/threads": (
                    create_thread_from_message,
                    None,
                ),
                "DELETE /channels/{channel_id}/messages/{message_id}": (
                    lambda: rest.delete_message(CH, MSG),
                    None,
                ),
                "GET /channels/{channel_id}/messages/{message_id}": (
                    lambda: rest.fetch_message(CH, MSG),
                    None,
                ),
                "PATCH /channels/{channel_id}/messages/{message_id}": (
                    lambda: rest.edit_message(CH, MSG, content="compat-edit"),
                    None,
                ),
                "GET /channels/{channel_id}/messages": (get_history, None),
                "POST /channels/{channel_id}/messages": (
                    lambda: rest.create_message(CH, content="compat"),
                    None,
                ),
                "POST /channels/{channel_id}/messages/bulk-delete": (bulk_delete, None),
                "DELETE /channels/{channel_id}/messages/pins/{message_id}": (
                    None,
                    "hikari's fetch_pins/pin_message/unpin_message were not confirmed (during "
                    "authoring) to have migrated to the newer /messages/pins API shape that "
                    "discord.py 2.7+ uses; no changelog/doc evidence of that migration was "
                    "found, so this endpoint is not exercised to avoid a guessed call",
                ),
                "PUT /channels/{channel_id}/messages/pins/{message_id}": (
                    None,
                    "hikari's fetch_pins/pin_message/unpin_message were not confirmed (during "
                    "authoring) to have migrated to the newer /messages/pins API shape that "
                    "discord.py 2.7+ uses; no changelog/doc evidence of that migration was "
                    "found, so this endpoint is not exercised to avoid a guessed call",
                ),
                "GET /channels/{channel_id}/messages/pins": (
                    None,
                    "hikari's fetch_pins/pin_message/unpin_message were not confirmed (during "
                    "authoring) to have migrated to the newer /messages/pins API shape that "
                    "discord.py 2.7+ uses; no changelog/doc evidence of that migration was "
                    "found, so this endpoint is not exercised to avoid a guessed call",
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
                    lambda: rest.unpin_message(CH, pin_msg.id),
                    None,
                ),
                "PUT /channels/{channel_id}/pins/{message_id}": (
                    lambda: rest.pin_message(CH, pin_msg.id),
                    None,
                ),
                "GET /channels/{channel_id}/pins": (get_legacy_pins, None),
                "DELETE /channels/{channel_id}/thread-members/{user_id}": (
                    remove_thread_member,
                    None,
                ),
                "GET /channels/{channel_id}/thread-members/{user_id}": (
                    fetch_thread_member,
                    None,
                ),
                "PUT /channels/{channel_id}/thread-members/{user_id}": (
                    add_thread_member,
                    None,
                ),
                "DELETE /channels/{channel_id}/thread-members/@me": (leave_thread, None),
                "PUT /channels/{channel_id}/thread-members/@me": (join_thread, None),
                "GET /channels/{channel_id}/thread-members": (fetch_thread_members, None),
                "GET /channels/{channel_id}/threads/archived/private": (
                    archived_private,
                    None,
                ),
                "GET /channels/{channel_id}/threads/archived/public": (
                    archived_public,
                    None,
                ),
                "GET /channels/{channel_id}/threads/search": (
                    None,
                    "no public wrapper found on hikari's RESTClient surface for the thread "
                    "search endpoint; not exercised to avoid a guessed/incorrect call",
                ),
                "POST /channels/{channel_id}/threads": (create_standalone_thread, None),
                "POST /channels/{channel_id}/typing": (
                    lambda: rest.trigger_typing(CH),
                    None,
                ),
                "GET /channels/{channel_id}/users/@me/threads/archived/private": (
                    archived_private_joined,
                    None,
                ),
                "GET /channels/{channel_id}/webhooks": (
                    lambda: rest.fetch_channel_webhooks(CH),
                    None,
                ),
                "POST /channels/{channel_id}/webhooks": (
                    lambda: rest.create_webhook(CH, "compat-wh2"),
                    None,
                ),
                "DELETE /channels/{channel_id}": (
                    None,
                    "not exercised: would delete the shared test channel other rows depend on",
                ),
                "GET /channels/{channel_id}": (lambda: rest.fetch_channel(CH), None),
                "PATCH /channels/{channel_id}": (
                    lambda: rest.edit_channel(CH, name="general"),
                    None,
                ),
                "GET /gateway/bot": (rest.fetch_gateway_bot_info, None),
                "GET /gateway": (rest.fetch_gateway_url, None),
                "DELETE /guilds/{guild_id}/bans/{user_id}": (
                    lambda: rest.unban_user(GUILD, BOT),
                    None,
                ),
                "GET /guilds/{guild_id}/bans/{user_id}": (
                    lambda: rest.fetch_ban(GUILD, BOT),
                    None,
                ),
                "PUT /guilds/{guild_id}/bans/{user_id}": (
                    lambda: rest.ban_user(GUILD, BOT),
                    None,
                ),
                "GET /guilds/{guild_id}/bans": (fetch_bans, None),
                "GET /guilds/{guild_id}/channels": (
                    lambda: rest.fetch_guild_channels(GUILD),
                    None,
                ),
                "POST /guilds/{guild_id}/channels": (
                    lambda: rest.create_guild_text_channel(GUILD, "compat-channel"),
                    None,
                ),
                "DELETE /guilds/{guild_id}/emojis/{emoji_id}": (
                    (
                        (lambda: rest.delete_emoji(GUILD, emoji_obj.id))
                        if emoji_obj is not None
                        else None
                    ),
                    None if emoji_obj is not None else "not exercised: bootstrap emoji creation failed",
                ),
                "GET /guilds/{guild_id}/emojis/{emoji_id}": (
                    lambda: rest.fetch_emoji(GUILD, EMOJI_ID),
                    None,
                ),
                "PATCH /guilds/{guild_id}/emojis/{emoji_id}": (
                    (
                        (lambda: rest.edit_emoji(GUILD, emoji_obj.id, name="compat2"))
                        if emoji_obj is not None
                        else None
                    ),
                    None if emoji_obj is not None else "not exercised: bootstrap emoji creation failed",
                ),
                "GET /guilds/{guild_id}/emojis": (
                    lambda: rest.fetch_guild_emojis(GUILD),
                    None,
                ),
                "POST /guilds/{guild_id}/emojis": (
                    lambda: rest.create_emoji(GUILD, "compat3", PNG_BYTES),
                    None,
                ),
                "DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}": (
                    lambda: rest.remove_role_from_member(GUILD, BOT, ROLE),
                    None,
                ),
                "PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}": (
                    lambda: rest.add_role_to_member(GUILD, BOT, ROLE),
                    None,
                ),
                "DELETE /guilds/{guild_id}/members/{user_id}": (
                    None,
                    "not exercised: would remove the bot itself from the shared test guild",
                ),
                "GET /guilds/{guild_id}/members/{user_id}": (
                    lambda: rest.fetch_member(GUILD, BOT),
                    None,
                ),
                "PATCH /guilds/{guild_id}/members/{user_id}": (
                    lambda: rest.edit_member(GUILD, BOT, nickname="compat"),
                    None,
                ),
                "GET /guilds/{guild_id}/members": (fetch_members, None),
                "DELETE /guilds/{guild_id}/roles/{role_id}": (
                    None,
                    "not exercised: would remove the role other rows (member-role add/remove) "
                    "still need",
                ),
                "PATCH /guilds/{guild_id}/roles/{role_id}": (
                    (
                        (lambda: rest.edit_role(GUILD, role.id, name="compat-role-renamed"))
                        if role is not None
                        else None
                    ),
                    None if role is not None else "not exercised: bootstrap role creation failed",
                ),
                "GET /guilds/{guild_id}/roles": (lambda: rest.fetch_roles(GUILD), None),
                "POST /guilds/{guild_id}/roles": (
                    lambda: rest.create_role(GUILD, name="compat-role2"),
                    None,
                ),
                "GET /guilds/{guild_id}/webhooks": (
                    lambda: rest.fetch_guild_webhooks(GUILD),
                    None,
                ),
                "DELETE /guilds/{guild_id}": (
                    None,
                    "no public wrapper: hikari's RESTClient does not expose a delete_guild "
                    "method, matching the real API (bots cannot delete guilds; it is an "
                    "owner-only, user-token action)",
                ),
                "GET /guilds/{guild_id}": (lambda: rest.fetch_guild(GUILD), None),
                "PATCH /guilds/{guild_id}": (
                    lambda: rest.edit_guild(GUILD, name="Compat Guild"),
                    None,
                ),
                "DELETE /invites/{code}": (delete_invite, None),
                "GET /invites/{code}": (lambda: rest.fetch_invite(CODE), None),
                "GET /oauth2/@me": (oauth2_me, None),
                "GET /oauth2/applications/@me": (rest.fetch_application, None),
                "POST /oauth2/token/revoke": (oauth2_revoke, None),
                "POST /oauth2/token": (oauth2_token_client_credentials, None),
                "GET /users/{user_id}": (lambda: rest.fetch_user(BOT), None),
                "GET /users/@me/guilds": (fetch_own_guilds, None),
                "GET /users/@me": (rest.fetch_my_user, None),
                "PATCH /users/@me": (
                    lambda: rest.edit_my_user(username="CompatBot"),
                    None,
                ),
                "DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}": (
                    lambda: rest.delete_webhook_message(WEBHOOK_ID, WEBHOOK_TOKEN, WH_MSG_ID),
                    None,
                ),
                "GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}": (
                    lambda: rest.fetch_webhook_message(WEBHOOK_ID, WEBHOOK_TOKEN, WH_MSG_ID),
                    None,
                ),
                "PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}": (
                    lambda: rest.edit_webhook_message(
                        WEBHOOK_ID, WEBHOOK_TOKEN, WH_MSG_ID, content="compat-edit"
                    ),
                    None,
                ),
                "DELETE /webhooks/{webhook_id}/{webhook_token}": (
                    None,
                    "not exercised: would delete the shared webhook other rows still need",
                ),
                "GET /webhooks/{webhook_id}/{webhook_token}": (
                    lambda: rest.fetch_webhook(WEBHOOK_ID, token=WEBHOOK_TOKEN),
                    None,
                ),
                "PATCH /webhooks/{webhook_id}/{webhook_token}": (
                    lambda: rest.edit_webhook(
                        WEBHOOK_ID, token=WEBHOOK_TOKEN, name="compat-renamed"
                    ),
                    None,
                ),
                "POST /webhooks/{webhook_id}/{webhook_token}": (
                    lambda: rest.execute_webhook(
                        WEBHOOK_ID, WEBHOOK_TOKEN, content="compat", wait=True
                    ),
                    None,
                ),
                "DELETE /webhooks/{webhook_id}": (
                    None,
                    "not exercised: would delete the shared webhook other rows still need",
                ),
                "GET /webhooks/{webhook_id}": (
                    lambda: rest.fetch_webhook(WEBHOOK_ID),
                    None,
                ),
                "PATCH /webhooks/{webhook_id}": (edit_bot_webhook, None),
            }

            # Run non-DELETE endpoints first, DELETEs last -- avoids false
            # "Unknown X" errors from resource-lifecycle ordering (see
            # module docstring).
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
                        else "no high-level hikari method found for this endpoint"
                    )
                    results[key] = {"endpoint": key, "status": "n-a", "note": note}
                    continue
                fn = call_entry[0]
                try:
                    await fn()
                    results[key] = {"endpoint": key, "status": "pass", "note": ""}
                except Exception as err:  # noqa: BLE001 - deliberately broad: any
                    # exception from the library call is recorded as a result row,
                    # not raised, so one bad endpoint doesn't abort the whole run.
                    results[key] = {
                        "endpoint": key,
                        "status": "lib-issue",
                        "note": str(err)[:300],
                    }

            # Re-key back to common/endpoints.json order for a stable matrix.
            ordered_results = [
                results[f"{e['method']} {e['path']}"] for e in ENDPOINTS
            ]

            output = {
                "library": "hikari",
                "version": "2.5.0",
                "baseUrlOverridable": True,
                "results": ordered_results,
            }
            Path("/results").mkdir(parents=True, exist_ok=True)
            Path("/results/hikari.json").write_text(
                json.dumps(output, indent=2), encoding="utf-8"
            )

            pass_count = sum(1 for r in ordered_results if r["status"] == "pass")
            print(f"hikari done: {pass_count}/{len(ordered_results)} pass")
    finally:
        await rest_app.close()


if __name__ == "__main__":
    asyncio.run(main())
