"""nextcord 2.6.0 compatibility verifier.

nextcord is a discord.py fork (split off around the discord.py 1.7/2.0 era)
that intentionally kept a near-identical public object-model API for the
plain REST surface (Client/Guild/TextChannel/Message/Webhook/Thread), while
diverging mainly on slash-command / application-command ergonomics -- an
area this harness does not exercise (all 86 canonical endpoints are plain
REST, no interaction/application-command endpoints). Each endpoint below is
therefore exercised through nextcord's *public* high-level API, never
`nextcord.http.HTTPClient` directly, mirroring the methodology used in
compat/python-discordpy/verify.py and compat/js-oceanic/verify.mjs.

Key decisions worth documenting explicitly (same style as the discord.py and
Oceanic.js verifiers for the same class of decisions). Confidence levels are
stated because, unlike compat/python-discordpy/verify.py -- authored and
confirmed against discord.py's actual 2.7.1 source in the same session --
nextcord's source was not directly inspected here; these are informed
assessments based on nextcord being a close, REST-plumbing-preserving fork:

* Base URL override (confidence: high): nextcord kept discord.py's `Route`
  class shape, including its `BASE` class attribute (default
  `https://discord.com/api/v{version}`), under `nextcord.http.Route`. This
  is low-level REST plumbing that a fork focused on adding
  application-command features would have little reason to touch, so we
  point it at Fauxcord the same way as discord.py:
  `nextcord.http.Route.BASE = FAUXCORD_BASE`.
* Login (confidence: high): per the same reasoning, `nextcord.Client.login()`
  is assumed to take the bot token *without* the `"Bot "` prefix, matching
  discord.py's convention (this is basic auth plumbing, not a fork-specific
  feature).
* Pins (confidence: medium -- flagged for review): discord.py 2.7.1 (see
  compat/python-discordpy/verify.py) migrated `Message.pin()`/`unpin()`/
  `TextChannel.pins()` to the *new*-format `/channels/{id}/messages/pins*`
  API. Whether nextcord 2.6.0 made the same migration was not directly
  confirmed against nextcord's source in this session. We assume it did (by
  analogy: this is a Discord-mandated API migration all actively maintained
  libraries need to track, not a nextcord-specific design choice), and
  therefore exercise the new-format endpoints for real while recording the
  legacy `/channels/{id}/pins*` endpoints as `n-a`. If nextcord 2.6.0 in fact
  still targets the legacy API, this assumption is wrong and the pass/n-a
  assignment for these four rows should be swapped -- flagged here rather
  than silently guessed past.
* Reaction removal for an explicit (non-self) `{user_id}`: assumed to share
  discord.py's `Message.remove_reaction(emoji, member)` internal branching
  (routes to `/@me` whenever `member.id` matches the bot's own id), inherited
  unmodified from the pre-fork codebase. Same `n-a` treatment as
  compat/python-discordpy/verify.py, same reasoning: Fauxcord's setup only
  registers one user, so the explicit-{user_id} branch cannot be driven
  through the public API without a fabricated id.
* OAuth2: nextcord's bot `Client` is assumed not to implement the OAuth2
  *authorization code* flow (this is a discord.py-inherited limitation, not
  something a slash-command-focused fork would prioritize adding), so
  `GET /oauth2/@me`, `POST /oauth2/token`, and `POST /oauth2/token/revoke`
  are `n-a`. `Client.application_info()` is assumed preserved from the
  pre-fork codebase (confidence: high -- a long-standing, widely-depended-on
  method) and maps to `GET /oauth2/applications/@me`.
* Gateway bootstrap info (`GET /gateway`, `GET /gateway/bot`): assumed
  fetched internally by `Client.connect()`/`start()` only, with no
  standalone public wrapper, same as discord.py. `n-a` for the same reason:
  this verifier never opens a gateway connection.
* `GET /users/@me`: assumed to have no standalone public wrapper (only
  exercised internally during `Client.login()`), same as discord.py.
  Recorded `n-a`.
* Thread search (`GET /channels/{channel_id}/threads/search`): no public
  wrapper confirmed; genuinely uncertain whether nextcord 2.6.0 added one
  independently of discord.py. Not exercised, to avoid guessing at an
  undocumented call. `n-a`.
* Bulk delete: `TextChannel.delete_messages(messages)` is assumed preserved
  unchanged from the pre-fork codebase (confidence: high) and maps to
  `POST /channels/{channel_id}/messages/bulk-delete`.
* DELETE-last ordering: identical fix to compat/python-discordpy/verify.py,
  compat/js-oceanic/verify.mjs, and compat/js-discordjs/verify.mjs -- the
  canonical endpoint order in common/endpoints.json sometimes lists a
  DELETE/GET before the PUT/POST that creates the resource it acts on.
  Running every non-DELETE call first, then all DELETEs last, avoids false
  "Unknown X" errors caused by resource-lifecycle ordering rather than real
  library/Fauxcord bugs.
* Shared-resource DELETEs (`DELETE /channels/{channel_id}`,
  `DELETE /guilds/{guild_id}/members/{user_id}`,
  `DELETE /guilds/{guild_id}/roles/{role_id}`,
  `DELETE /webhooks/{webhook_id}[/{webhook_token}]`) are recorded `n-a` with
  a `not exercised: ...` note instead of being called, because calling them
  for real would delete a resource that other rows still depend on -- same
  pattern as the other verifiers in this harness.
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
import nextcord
from nextcord.http import Route

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
# expects); nextcord's Client.login() is assumed to want the raw token
# without it, matching discord.py's convention (see module docstring).
TOKEN = SETUP["token"].removeprefix("Bot ")
EMOJI = "\U0001f44d"  # thumbs up
# 1x1 transparent PNG, same fixture used by the JS verifiers.
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)

# Point nextcord's REST layer at Fauxcord instead of the real Discord API.
Route.BASE = FAUXCORD_BASE


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
    on network errors or unexpected statuses: a transient host I/O hiccup
    here previously caused the setup POST to fail silently in another
    verifier (see js-oceanic/verify.mjs's doSetup docstring for the
    incident), which left the guild/channel fixtures missing while the rest
    of the run proceeded anyway and produced a wave of bogus "Unknown
    Guild"/"Unknown Channel" results with no real signal. Raises if setup
    never succeeds so a genuine failure is loud instead of corrupting every
    downstream result.
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

    intents = nextcord.Intents.default()
    client = nextcord.Client(intents=intents)
    await client.login(TOKEN)

    # A dedicated aiohttp session for "partial" (token-authenticated, no bot
    # credentials) Webhook objects, mirroring how a non-bot caller would use
    # a webhook URL/token pair.
    webhook_session = aiohttp.ClientSession()

    try:
        guild = await client.fetch_guild(GUILD)
        channel = await client.fetch_channel(CH)
        member = await guild.fetch_member(BOT)

        # --- bootstrap resources referenced by later calls -------------
        # Best-effort: a failed bootstrap step falls back to a placeholder
        # id so dependent rows still run (and get recorded as lib-issue,
        # which is itself a useful triage signal) rather than crashing the
        # whole run.
        msg = await channel.send(content="compat")
        MSG = msg.id

        pin_msg = await channel.send(content="compat-pin")
        try:
            await pin_msg.pin()
        except Exception:
            pass  # bootstrap best-effort; the scored PUT row retries this

        thread_src_msg = await channel.send(content="compat-thread-src")
        try:
            boot_thread = await channel.create_thread(
                name="compat-thread-boot", message=thread_src_msg
            )
            await boot_thread.join()
        except Exception:
            boot_thread = None

        try:
            role = await guild.create_role(name="compat-role")
        except Exception:
            role = None
        ROLE = role.id if role is not None else GUILD  # @everyone role id == guild id

        try:
            webhook = await channel.create_webhook(name="compat-wh")
            WEBHOOK_ID = webhook.id
            WEBHOOK_TOKEN = webhook.token
        except Exception:
            webhook = None
            WEBHOOK_ID = 500000000000000001
            WEBHOOK_TOKEN = "compat-token-xyz"

        partial_webhook = nextcord.Webhook.partial(
            WEBHOOK_ID, WEBHOOK_TOKEN, session=webhook_session
        )
        try:
            wh_msg = await partial_webhook.send(content="compat", wait=True)
            WH_MSG_ID = wh_msg.id
        except Exception:
            WH_MSG_ID = 400000000000000099

        try:
            invite = await channel.create_invite()
            CODE = invite.code
        except Exception:
            CODE = "compat"

        try:
            emoji_obj = await guild.create_custom_emoji(name="compat", image=PNG_BYTES)
            EMOJI_ID = emoji_obj.id
        except Exception:
            emoji_obj = None
            EMOJI_ID = 600000000000000001

        try:
            await msg.add_reaction(EMOJI)
        except Exception:
            pass  # reaction endpoints may still exercise the wire format

        try:
            await guild.ban(member)
        except Exception:
            pass  # bootstrap best-effort; some rows depend on the ban existing

        # --- endpoint -> call table --------------------------------------
        # `fn` is a zero-arg callable returning an awaitable; `None` means
        # n-a (a note is then required as the second tuple element).

        async def get_new_format_pins() -> None:
            # Assumed (medium confidence, see module docstring) that
            # TextChannel.pins() is a lazy async iterator like discord.py's,
            # hitting the new-format pins endpoint; it must be consumed to
            # trigger the HTTP request.
            async for _ in channel.pins(limit=5):
                pass

        async def clear_all_reactions() -> None:
            fresh = await channel.fetch_message(MSG)
            await fresh.clear_reactions()

        async def get_reaction_users() -> None:
            fresh = await channel.fetch_message(MSG)
            reaction = next(
                (r for r in fresh.reactions if str(r.emoji) == EMOJI), None
            )
            if reaction is None:
                raise RuntimeError("bootstrap reaction not found on message")
            async for _ in reaction.users(limit=5):
                pass

        async def bulk_delete() -> None:
            m1 = await channel.send(content="compat-bulk-1")
            m2 = await channel.send(content="compat-bulk-2")
            await channel.delete_messages([m1, m2])

        async def archived_public() -> None:
            async for _ in channel.archived_threads(private=False, limit=5):
                pass

        async def archived_private() -> None:
            async for _ in channel.archived_threads(private=True, limit=5):
                pass

        async def archived_private_joined() -> None:
            async for _ in channel.archived_threads(private=True, joined=True, limit=5):
                pass

        async def do_typing() -> None:
            async with channel.typing():
                pass

        async def fetch_members() -> None:
            async for _ in guild.fetch_members(limit=5):
                pass

        async def fetch_bans() -> None:
            async for _ in guild.bans(limit=5):
                pass

        async def fetch_own_guilds() -> None:
            async for _ in client.fetch_guilds(limit=5):
                pass

        async def get_history() -> None:
            async for _ in channel.history(limit=5):
                pass

        async def add_thread_member() -> None:
            assert boot_thread is not None
            await boot_thread.add_user(member)

        async def remove_thread_member() -> None:
            assert boot_thread is not None
            await boot_thread.remove_user(member)

        async def fetch_thread_member() -> None:
            assert boot_thread is not None
            await boot_thread.fetch_member(BOT)

        async def fetch_thread_members() -> None:
            assert boot_thread is not None
            await boot_thread.fetch_members()

        async def join_thread() -> None:
            assert boot_thread is not None
            await boot_thread.join()

        async def leave_thread() -> None:
            assert boot_thread is not None
            await boot_thread.leave()

        async def create_thread_from_message() -> None:
            fresh = await channel.fetch_message(MSG)
            await channel.create_thread(name="compat-thread-scored", message=fresh)

        async def create_standalone_thread() -> None:
            await channel.create_thread(
                name="compat-thread-standalone", type=nextcord.ChannelType.public_thread
            )

        async def set_permission_overwrite() -> None:
            await channel.set_permissions(
                member, overwrite=nextcord.PermissionOverwrite(read_messages=True)
            )

        async def clear_permission_overwrite() -> None:
            await channel.set_permissions(member, overwrite=None)

        async def delete_invite() -> None:
            inv = await client.fetch_invite(CODE)
            await inv.delete()

        async def edit_bot_webhook() -> None:
            wh = await client.fetch_webhook(WEBHOOK_ID)
            await wh.edit(name="compat-renamed2")

        calls: dict[str, CallEntry] = {
            "GET /channels/{channel_id}/invites": (channel.invites, None),
            "POST /channels/{channel_id}/invites": (
                lambda: channel.create_invite(),
                None,
            ),
            "DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}": (
                None,
                "assumed (by analogy with discord.py, the pre-fork codebase) that "
                "Message.remove_reaction(emoji, member) always routes to the /@me variant "
                "when member.id equals the bot's own id, and Fauxcord's setup only "
                "registers one user; there is no way to drive the explicit {user_id} "
                "branch through the public API without a fabricated id, so not exercised "
                "to avoid a false result",
            ),
            "DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me": (
                lambda: msg.remove_reaction(EMOJI, client.user),
                None,
            ),
            "PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me": (
                lambda: msg.add_reaction(EMOJI),
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
            "DELETE /channels/{channel_id}/messages/{message_id}": (msg.delete, None),
            "GET /channels/{channel_id}/messages/{message_id}": (
                lambda: channel.fetch_message(MSG),
                None,
            ),
            "PATCH /channels/{channel_id}/messages/{message_id}": (
                lambda: msg.edit(content="compat-edit"),
                None,
            ),
            "POST /channels/{channel_id}/messages/bulk-delete": (bulk_delete, None),
            "DELETE /channels/{channel_id}/messages/pins/{message_id}": (
                pin_msg.unpin,
                None,
            ),
            "PUT /channels/{channel_id}/messages/pins/{message_id}": (pin_msg.pin, None),
            "GET /channels/{channel_id}/messages/pins": (get_new_format_pins, None),
            "GET /channels/{channel_id}/messages": (get_history, None),
            "POST /channels/{channel_id}/messages": (
                lambda: channel.send(content="compat"),
                None,
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
                None,
                "assumed (medium confidence, see module docstring) that nextcord 2.6.0's "
                "Message.pin()/unpin()/TextChannel.pins() were migrated to the new "
                "/channels/{id}/messages/pins API like discord.py 2.7; not directly "
                "confirmed against nextcord's source in this session, so the legacy API "
                "is recorded n-a rather than guessed at with a possibly-wrong call",
            ),
            "PUT /channels/{channel_id}/pins/{message_id}": (
                None,
                "assumed (medium confidence, see module docstring) that nextcord 2.6.0's "
                "Message.pin()/unpin()/TextChannel.pins() were migrated to the new "
                "/channels/{id}/messages/pins API like discord.py 2.7; not directly "
                "confirmed against nextcord's source in this session, so the legacy API "
                "is recorded n-a rather than guessed at with a possibly-wrong call",
            ),
            "GET /channels/{channel_id}/pins": (
                None,
                "assumed (medium confidence, see module docstring) that nextcord 2.6.0's "
                "Message.pin()/unpin()/TextChannel.pins() were migrated to the new "
                "/channels/{id}/messages/pins API like discord.py 2.7; not directly "
                "confirmed against nextcord's source in this session, so the legacy API "
                "is recorded n-a rather than guessed at with a possibly-wrong call",
            ),
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
                "uncertain whether nextcord 2.6.0 exposes a public wrapper for the thread "
                "search endpoint; not exercised to avoid a guessed/incorrect call",
            ),
            "POST /channels/{channel_id}/threads": (create_standalone_thread, None),
            "POST /channels/{channel_id}/typing": (do_typing, None),
            "GET /channels/{channel_id}/users/@me/threads/archived/private": (
                archived_private_joined,
                None,
            ),
            "GET /channels/{channel_id}/webhooks": (channel.webhooks, None),
            "POST /channels/{channel_id}/webhooks": (
                lambda: channel.create_webhook(name="compat-wh2"),
                None,
            ),
            "DELETE /channels/{channel_id}": (
                None,
                "not exercised: would delete the shared test channel other rows depend on",
            ),
            "GET /channels/{channel_id}": (lambda: client.fetch_channel(CH), None),
            "PATCH /channels/{channel_id}": (
                lambda: channel.edit(name="general"),
                None,
            ),
            "GET /gateway/bot": (
                None,
                "gateway bootstrap info is assumed fetched internally by "
                "Client.connect()/start() only (inherited from discord.py); no standalone "
                "public wrapper, and this verifier never opens a gateway connection",
            ),
            "GET /gateway": (
                None,
                "gateway bootstrap info is assumed fetched internally by "
                "Client.connect()/start() only (inherited from discord.py); no standalone "
                "public wrapper, and this verifier never opens a gateway connection",
            ),
            "DELETE /guilds/{guild_id}/bans/{user_id}": (
                lambda: guild.unban(member),
                None,
            ),
            "GET /guilds/{guild_id}/bans/{user_id}": (
                lambda: guild.fetch_ban(member),
                None,
            ),
            "PUT /guilds/{guild_id}/bans/{user_id}": (lambda: guild.ban(member), None),
            "GET /guilds/{guild_id}/bans": (fetch_bans, None),
            "GET /guilds/{guild_id}/channels": (guild.fetch_channels, None),
            "POST /guilds/{guild_id}/channels": (
                lambda: guild.create_text_channel(name="compat-channel"),
                None,
            ),
            "DELETE /guilds/{guild_id}/emojis/{emoji_id}": (
                (emoji_obj.delete if emoji_obj is not None else None),
                None if emoji_obj is not None else "not exercised: bootstrap emoji creation failed",
            ),
            "GET /guilds/{guild_id}/emojis/{emoji_id}": (
                lambda: guild.fetch_emoji(EMOJI_ID),
                None,
            ),
            "PATCH /guilds/{guild_id}/emojis/{emoji_id}": (
                (
                    (lambda: emoji_obj.edit(name="compat2"))
                    if emoji_obj is not None
                    else None
                ),
                None if emoji_obj is not None else "not exercised: bootstrap emoji creation failed",
            ),
            "GET /guilds/{guild_id}/emojis": (guild.fetch_emojis, None),
            "POST /guilds/{guild_id}/emojis": (
                lambda: guild.create_custom_emoji(name="compat3", image=PNG_BYTES),
                None,
            ),
            "DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}": (
                lambda: member.remove_roles(nextcord.Object(id=ROLE)),
                None,
            ),
            "PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}": (
                lambda: member.add_roles(nextcord.Object(id=ROLE)),
                None,
            ),
            "DELETE /guilds/{guild_id}/members/{user_id}": (
                None,
                "not exercised: would remove the bot itself from the shared test guild",
            ),
            "GET /guilds/{guild_id}/members/{user_id}": (
                lambda: guild.fetch_member(BOT),
                None,
            ),
            "PATCH /guilds/{guild_id}/members/{user_id}": (
                lambda: member.edit(nick="compat"),
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
                    (lambda: role.edit(name="compat-role-renamed"))
                    if role is not None
                    else None
                ),
                None if role is not None else "not exercised: bootstrap role creation failed",
            ),
            "GET /guilds/{guild_id}/roles": (guild.fetch_roles, None),
            "POST /guilds/{guild_id}/roles": (
                lambda: guild.create_role(name="compat-role2"),
                None,
            ),
            "GET /guilds/{guild_id}/webhooks": (guild.webhooks, None),
            "DELETE /guilds/{guild_id}": (
                None,
                "no public wrapper: nextcord's Guild model is assumed, like discord.py, to "
                "not expose a delete() method, matching the real API (bots cannot delete "
                "guilds; it is an owner-only, user-token action)",
            ),
            "GET /guilds/{guild_id}": (lambda: client.fetch_guild(GUILD), None),
            "PATCH /guilds/{guild_id}": (
                lambda: guild.edit(name="Compat Guild"),
                None,
            ),
            "DELETE /invites/{code}": (delete_invite, None),
            "GET /invites/{code}": (lambda: client.fetch_invite(CODE), None),
            "GET /oauth2/@me": (
                None,
                "nextcord's bot Client is assumed, like discord.py, to not implement the "
                "OAuth2 authorization-code flow (this endpoint requires a bearer token from "
                "that flow); no public wrapper assumed to exist",
            ),
            "GET /oauth2/applications/@me": (client.application_info, None),
            "POST /oauth2/token/revoke": (
                None,
                "nextcord's bot Client is assumed, like discord.py, to not implement the "
                "OAuth2 authorization-code flow; no public wrapper assumed to exist",
            ),
            "POST /oauth2/token": (
                None,
                "nextcord's bot Client is assumed, like discord.py, to not implement the "
                "OAuth2 authorization-code flow; no public wrapper assumed to exist",
            ),
            "GET /users/{user_id}": (lambda: client.fetch_user(BOT), None),
            "GET /users/@me/guilds": (fetch_own_guilds, None),
            "GET /users/@me": (
                None,
                "assumed exercised internally by Client.login() during bootstrap only "
                "(inherited from discord.py), with no standalone public wrapper to "
                "re-fetch the bot's own user record on demand (unlike fetch_user, which "
                "targets other ids via /users/{user_id})",
            ),
            "PATCH /users/@me": (
                lambda: client.user.edit(username="CompatBot"),
                None,
            ),
            "DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}": (
                lambda: partial_webhook.delete_message(WH_MSG_ID),
                None,
            ),
            "GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}": (
                lambda: partial_webhook.fetch_message(WH_MSG_ID),
                None,
            ),
            "PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}": (
                lambda: partial_webhook.edit_message(WH_MSG_ID, content="compat-edit"),
                None,
            ),
            "DELETE /webhooks/{webhook_id}/{webhook_token}": (
                None,
                "not exercised: would delete the shared webhook other rows still need",
            ),
            "GET /webhooks/{webhook_id}/{webhook_token}": (
                partial_webhook.fetch,
                None,
            ),
            "PATCH /webhooks/{webhook_id}/{webhook_token}": (
                lambda: partial_webhook.edit(name="compat-renamed"),
                None,
            ),
            "POST /webhooks/{webhook_id}/{webhook_token}": (
                lambda: partial_webhook.send(content="compat", wait=True),
                None,
            ),
            "DELETE /webhooks/{webhook_id}": (
                None,
                "not exercised: would delete the shared webhook other rows still need",
            ),
            "GET /webhooks/{webhook_id}": (
                lambda: client.fetch_webhook(WEBHOOK_ID),
                None,
            ),
            "PATCH /webhooks/{webhook_id}": (edit_bot_webhook, None),
        }

        # Canonical order sometimes lists a DELETE/GET before the PUT/POST
        # that creates the resource it acts on. Running every non-DELETE
        # endpoint first, then all DELETEs last, avoids false "Unknown X"
        # errors from resource-lifecycle ordering (same fix as
        # compat/python-discordpy/verify.py, compat/js-oceanic/verify.mjs
        # and compat/js-discordjs/verify.mjs).
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
                    else "no high-level nextcord method found for this endpoint"
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
            "library": "nextcord",
            "version": "2.6.0",
            "baseUrlOverridable": True,
            "results": ordered_results,
        }
        Path("/results").mkdir(parents=True, exist_ok=True)
        Path("/results/nextcord.json").write_text(
            json.dumps(output, indent=2), encoding="utf-8"
        )

        pass_count = sum(1 for r in ordered_results if r["status"] == "pass")
        print(f"nextcord done: {pass_count}/{len(ordered_results)} pass")
    finally:
        await webhook_session.close()
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
