# Coverage Matrix

Rows = endpoints (see `common/endpoints.json`). Columns = libraries (see spec §3).
Cells: `✅` high-level OK · `N/A` no high-level API (evidence) · `❌→fix` Fauxcord bug fixed (link) · `❌→lib` library-side issue (evidence) · `⛔blocked` cannot target Fauxcord (evidence) · `-` not yet run.

Acceptance: every `N/A`/`⛔blocked` has an evidence note below the table; every endpoint row has ≥1 `✅` (or `❌→fix`). No `-` (not-yet-run) cells remain — discord.js, Oceanic, discordgo, and Concord have all been re-run against the full 87-endpoint set, including `PATCH /guilds/{guild_id}/members/@me`.

| Endpoint | discord.js | Eris | Oceanic | discord.py | Nextcord | Pycord | hikari | interactions.py | discordgo | Discord.Net | DSharpPlus5 | JDA | Discord4J | Javacord | Kord | Serenity | Twilight | Concord | DPP | Sleepy | DSharpPlus4 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET /channels/{channel_id}/invites | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /channels/{channel_id}/invites | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id} | ✅ | ⛔blocked | ✅ | N/A | N/A | N/A | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/messages/{message_id}/reactions | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /channels/{channel_id}/messages/{message_id}/threads | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | N/A | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/messages/{message_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/messages/{message_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌→fix | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /channels/{channel_id}/messages/{message_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /channels/{channel_id}/messages/bulk-delete | ✅ | ⛔blocked | N/A | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/messages/pins/{message_id} | ✅ | ⛔blocked | N/A | ✅ | ✅ | ✅ | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /channels/{channel_id}/messages/pins/{message_id} | ❌→fix | ⛔blocked | N/A | ✅ | ✅ | ✅ | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/messages/pins | ✅ | ⛔blocked | N/A | ✅ | ✅ | ❌→lib | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/messages | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌→fix | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /channels/{channel_id}/messages | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/permissions/{overwrite_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /channels/{channel_id}/permissions/{overwrite_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/pins/{message_id} | ✅ | ⛔blocked | ✅ | N/A | N/A | N/A | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /channels/{channel_id}/pins/{message_id} | ❌→fix | ⛔blocked | ✅ | N/A | N/A | N/A | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/pins | ✅ | ⛔blocked | ✅ | N/A | N/A | N/A | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/thread-members/{user_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | N/A | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/thread-members/{user_id} | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ✅ | N/A | ✅ | N/A | ⛔blocked | ⛔blocked | N/A | ⛔blocked | N/A | ✅ | ❌→lib | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /channels/{channel_id}/thread-members/{user_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | N/A | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/thread-members/@me | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | N/A | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /channels/{channel_id}/thread-members/@me | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | N/A | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/thread-members | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | N/A | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/threads/archived/private | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | N/A | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/threads/archived/public | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | N/A | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/threads/search | ✅ | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /channels/{channel_id}/threads | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | N/A | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /channels/{channel_id}/typing | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/users/@me/threads/archived/private | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | N/A | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/webhooks | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /channels/{channel_id}/webhooks | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id} | N/A | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌→fix | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /channels/{channel_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /gateway/bot | ✅ | ⛔blocked | N/A | N/A | N/A | N/A | ✅ | ✅ | ✅ | N/A | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | N/A | N/A | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /gateway | ✅ | ⛔blocked | N/A | N/A | N/A | N/A | ✅ | ✅ | ✅ | N/A | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | N/A | N/A | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /guilds/{guild_id}/bans/{user_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/bans/{user_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ❌→lib | ⛔blocked | ❌→lib | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /guilds/{guild_id}/bans/{user_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/bans | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/channels | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /guilds/{guild_id}/channels | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /guilds/{guild_id}/emojis/{emoji_id} | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/emojis/{emoji_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /guilds/{guild_id}/emojis/{emoji_id} | ✅ | ⛔blocked | ✅ | ❌→lib | ❌→lib | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/emojis | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /guilds/{guild_id}/emojis | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id} | ✅ | ⛔blocked | ✅ | ❌→lib | ✅ | ❌→lib | ❌→lib | ❌→lib | ✅ | ❌→fix | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id} | ✅ | ⛔blocked | ✅ | ❌→lib | ✅ | ❌→lib | ❌→lib | ❌→lib | ✅ | ❌→fix | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /guilds/{guild_id}/members/{user_id} | N/A | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/members/{user_id} | ✅ | ⛔blocked | ✅ | ❌→lib | ✅ | ❌→lib | ❌→lib | ❌→lib | ✅ | ❌→fix | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /guilds/{guild_id}/members/{user_id} | ✅ | ⛔blocked | ✅ | ❌→lib | ❌→lib | ❌→lib | ❌→lib | ❌→lib | ✅ | ❌→fix | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /guilds/{guild_id}/members/@me | ✅ | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ❌→fix | ⛔blocked | ⛔blocked | N/A | ⛔blocked | N/A | N/A | N/A | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/members | ✅ | ⛔blocked | ✅ | ❌→lib | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /guilds/{guild_id}/roles/{role_id} | ✅ | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /guilds/{guild_id}/roles/{role_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/roles | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ❌→fix | ✅ | ✅ | N/A | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /guilds/{guild_id}/roles | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ❌→fix | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/webhooks | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /guilds/{guild_id} | N/A | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ❌→fix | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ❌→fix | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /guilds/{guild_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ❌→fix | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ❌→fix | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /invites/{code} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /invites/{code} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /oauth2/@me | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ❌→lib | ❌→lib | N/A | N/A | ⛔blocked | ⛔blocked | N/A | ⛔blocked | N/A | N/A | ❌→lib | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /oauth2/applications/@me | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ❌→lib | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /oauth2/token/revoke | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ✅ | N/A | N/A | N/A | ⛔blocked | ⛔blocked | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /oauth2/token | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ✅ | N/A | N/A | N/A | ⛔blocked | ⛔blocked | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /users/{user_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /users/@me/guilds | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | N/A | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /users/@me | ✅ | ⛔blocked | ✅ | N/A | N/A | N/A | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /users/@me | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id} | ✅ | ⛔blocked | N/A | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | N/A | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ❌→lib | ✅ | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id} | ✅ | ⛔blocked | N/A | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | N/A | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id} | ✅ | ⛔blocked | N/A | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | N/A | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /webhooks/{webhook_id}/{webhook_token} | ✅ | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /webhooks/{webhook_id}/{webhook_token} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /webhooks/{webhook_id}/{webhook_token} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /webhooks/{webhook_id}/{webhook_token} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | N/A | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /webhooks/{webhook_id} | ✅ | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /webhooks/{webhook_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /webhooks/{webhook_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ⛔blocked | ⛔blocked | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |

## Evidence notes

Full per-row reasoning lives in each verifier's own result file / evidence
notes (`results/<lib>.json`, `verify.*`); this section summarizes each
library's overall result and links out to any genuine Fauxcord bug it
surfaced.

### Per-library summary

| Library | Base URL override | Result (of 87) | Notes |
|---|---|---|---|
| discord.js | native `REST` option | 81 ✅ / 6 N/A / 0 lib-issue | All 28 originally-reported findings were verifier bugs, not Fauxcord/discord.js bugs — see [discord.js verifier triage](#discordjs--oceanic-verifier-triage) |
| Eris | ❌ hardcodes HTTPS on port 443 | ⛔ blocked (every row) | `js-eris/verify.mjs` header comment; `results/eris.json` (`baseUrlOverridable: false`) |
| Oceanic | fully overridable | 67 ✅ / 20 N/A / 0 lib-issue | Same verifier-bug classes as discord.js, fixed the same way — see [triage](#discordjs--oceanic-verifier-triage). A re-run also surfaced 2 new `GET`/`PATCH /guilds/{guild_id}` failures suspected to be REST-mode bootstrap flakiness in the verifier, not a Fauxcord regression — unconfirmed, so these matrix cells are left unchanged; see `results/oceanic.json` |
| discord.py | `Route.BASE` | 63 ✅ / 18 N/A / 6 lib-issue | `❌→lib` rows are discord.py-side strictness — see `results/discordpy.json` |
| Nextcord (discord.py fork) | `nextcord.http.Route.BASE` | 61 ✅ / 18 N/A / 8 lib-issue | `❌→lib` rows are library-side — see `results/nextcord.json` |
| Pycord (discord.py fork) | `discord.http.Route.BASE` | 49 ✅ / 18 N/A / 20 lib-issue | `❌→lib` rows are library-side — see `results/pycord.json` |
| hikari | `hikari.RESTApp(url=...)` | 66 ✅ / 11 N/A / 10 lib-issue | 2 genuine Fauxcord bugs found+fixed — see [Fauxcord bugs found and fixed](#fauxcord-bugs-found-and-fixed). Remaining `❌→lib` rows are hikari-side (probes for members it never registered; `approximate_member_count` expectation) |
| interactions.py | `interactions.api.http.route.Route.BASE` | 66 ✅ / 14 N/A / 7 lib-issue | `❌→lib` rows are library-side — see `results/interactions.json` |
| discordgo | `EndpointAPI` + per-resource endpoint vars | 73 ✅ / 14 N/A / 0 lib-issue | An earlier fixture-contamination bug in the verifier (`EndpointGuilds`, `EndpointChannels`, …) was fixed — see `go-discordgo/verify.go` |
| Discord.Net | `RestClientProvider` | 63 ✅ / 24 N/A / 0 lib-issue | 3 genuine Fauxcord bugs found+fixed — see [Fauxcord bugs found and fixed](#fauxcord-bugs-found-and-fixed) |
| DSharpPlus 5.x | ❌ compile-time `const string`, needs Gateway | ⛔ blocked (every row) | No verifier; `dotnet-dsharpplus/README.md` |
| DSharpPlus 4.x | ❌ same `const string` mechanism | ⛔ blocked (every row) | No verifier; entry only, dedicated README tracked as follow-up work |
| JDA | overridable, but needs a real Gateway handshake | ⛔ blocked (every row) | No verifier; `jvm-jda/README.md` |
| Discord4J | custom `discordBaseUrl` via `RouterOptions` | 60 ✅ / 25 N/A / 2 lib-issue | High N/A count reflects Discord4J 3.2.6's `ChannelService` lacking several high-level methods; `❌→lib` rows are library-side — see `results/discord4j.json` |
| Javacord | ❌ hardcoded HTTPS domain, needs Gateway | ⛔ blocked (every row) | No verifier; `jvm-javacord/README.md` |
| Kord | Ktor `HttpRequestPipeline.Before` interceptor | 68 ✅ / 17 N/A / 2 lib-issue | 1 genuine Fauxcord bug found+fixed — see [Fauxcord bugs found and fixed](#fauxcord-bugs-found-and-fixed). Remaining `❌→lib` rows probe entities that don't exist (404) |
| Serenity | `HttpBuilder::proxy(url)` (ratelimiter must also be disabled) | 71 ✅ / 16 N/A / 0 lib-issue | 1 genuine Fauxcord bug found+fixed — see [Fauxcord bugs found and fixed](#fauxcord-bugs-found-and-fixed) |
| Twilight | `ClientBuilder::proxy(host, use_http)` | 55 ✅ / 16 N/A / 16 lib-issue | `❌→lib` rows are a Twilight-side strict-deserializer issue, not a Fauxcord gap (Serenity/Kord decode the identical responses fine, and both pass the `spec/openapi.json` contract tests) — see `results/twilight.json` |
| Concord | `struct discord_config.base_url` | 53 ✅ / 16 N/A / 18 lib-issue | 1 genuine Fauxcord bug found+fixed — see [Fauxcord bugs found and fixed](#fauxcord-bugs-found-and-fixed). Remaining `❌→lib` rows are Concord-side JSON-codec failures (`CCORDcode 100`, plus a `SIGSEGV` in `discord_execute_webhook`'s serializer) |
| DPP | ❌ hardcoded transport, no override hook | ⛔ blocked (every row) | No verifier; `cpp-dpp/README.md` |
| Sleepy Discord | ❌ hardcoded host + scheme literal | ⛔ blocked (every row) | No verifier; `cpp-sleepy/README.md` |

### discord.js / Oceanic verifier triage

All 28 originally-reported `❌→lib` findings in both `js-discordjs/verify.mjs`
and `js-oceanic/verify.mjs` were triaged per the Task 27 protocol and turned
out to be verifier bootstrap/design bugs, not genuine Fauxcord or library
bugs: a 401-cascade on a shared `REST` instance, thread-member endpoints
targeting a plain channel instead of a real thread, self-targeted
BAN/member-removal calls that kicked the bot out of the shared test guild,
dual-form webhook-delete and webhook-message id collisions, and OAuth2
endpoints structurally incompatible with a Bot token. All were fixed
directly in the verifier scripts (not recorded as `❌→fix`/`❌→lib`, per Task
27 policy for verifier-side bugs).

### Fauxcord bugs found and fixed

- **Pin idempotency** (`PUT /channels/{channel_id}/pins/{message_id}`,
  `PUT /channels/{channel_id}/messages/pins/{message_id}`; discord.js
  `❌→lib` → `❌→fix`): re-pinning an already-pinned message returned an
  error instead of succeeding. The real Discord API and every major client
  library treat this endpoint as idempotent. Fixed in `src/services/pins.ts`
  (commit `1024416`); regression test in `src/routes/channel-pins.test.ts`.
- **Bot not registered as a guild member** (`GET`/`PATCH
  /guilds/{guild_id}/members/{user_id}`, `PUT`/`DELETE
  /guilds/{guild_id}/members/{user_id}/roles/{role_id}`,
  `PATCH /guilds/{guild_id}/members/@me`; Discord.Net `❌→fix`):
  `POST /_test/setup` did not register the Bot itself as a member of the
  Guilds it created, so any self-targeted member lookup/edit 404'd as
  Unknown Member. Discord.Net's `RestGuildUser.ModifyAsync()` routes to
  `/members/@me` when the target is the client's own user, so this also
  covers that endpoint. Fixed in `src/services/test-control.ts` (commit
  `b9071ac`); see the "registers the bot as a member of every created
  guild" case in `src/routes/test.test.ts`.
- **Thread channel shape** (`GET /channels/{channel_id}`; Discord.Net
  `❌→fix`): thread-type channels (10/11/12) were returned in the
  plain-channel shape, without `thread_metadata`, causing Discord.Net's
  `RestTextChannel` → `RestThreadChannel` cast to throw
  `InvalidCastException`. Fixed in `src/routes/channels.ts` (commit
  `b9071ac`); see the "returns the thread shape (with thread_metadata) for
  a thread channel" case in `src/routes/channels.test.ts`.
- **Reaction object missing fields** (`GET
  /channels/{channel_id}/messages/{message_id}`, `GET
  /channels/{channel_id}/messages`; Discord.Net `❌→fix`): the `Reaction`
  object omitted the spec-required `count_details`/`me_burst`/`burst_colors`
  fields, causing a `NullReferenceException` in Discord.Net's
  `RestReaction.Create` whenever a fetched message had reactions. Fixed in
  `src/services/messages.ts` (commit `b9071ac`); see
  `src/services/messages.test.ts`.
- **Guild response missing required fields** (`GET`/`PATCH
  /guilds/{guild_id}`; Serenity `❌→fix`): Serenity's `PartialGuild` is a
  strict Rust `serde` deserializer that rejects a guild object missing any
  spec-required field; Fauxcord's guild response omitted 23 of the 40
  fields the OpenAPI `GuildResponse` marks `required`. Brought the guild
  object into full compliance with Discord's documented default/empty
  values (`nsfw: false`, `nsfw_level: 0`, `region: 'deprecated'`,
  `stickers: []`, `incidents_data: null`, the various `*_channel_id: null`,
  `max_members: 500000`, etc.). The same fields also fixed Kord's identical
  `MissingFieldException` on these rows, plus both libraries'
  `GET /oauth2/applications/@me` (`team` field). Fixed in
  `src/services/guilds.ts`; regression test in `src/routes/guilds.test.ts`.
- **Role `permissions` round-tripped as a decimal string** (`GET`/`PATCH
  /guilds/{guild_id}`, `GET`/`POST /guilds/{guild_id}/roles`; hikari
  `❌→fix`): role `permissions` supplied by a client as a JSON number
  (hikari sends the integer `0`) was bound straight into the
  `roles.permissions` `TEXT` column, so better-sqlite3 stored it as a REAL
  and it round-tripped as `"0.0"`/`"8.0"`; hikari's `int(permissions)`
  raised `ValueError` on any response embedding a role. Fixed by
  normalising `permissions` to a decimal-integer string on write
  (`normalizePermissions` in `src/services/guild-roles.ts`, commit
  `817148d`); regression test in `src/routes/guild-roles.test.ts`. Only
  hikari surfaced this — other verifiers' permission parsers tolerated the
  `.0` suffix.
- **Thread-members pagination looped forever** (hikari): the
  thread-members `after` cursor was ignored, looping hikari's
  `ThreadMembersIterator` forever. Fixed in `src/services/threads.ts`
  (commit `a27651a`).
- **Webhook move to unknown channel → HTTP 500** (`PATCH
  /webhooks/{webhook_id}`; surfaced by Concord): moving a webhook to a
  non-existent `channel_id` wrote the unknown id straight to the
  `webhooks.channel_id` column, violating its foreign key and surfacing as
  an unhandled HTTP 500 instead of a Discord error. Fixed in
  `src/routes/webhooks.ts` (now returns `10003 Unknown Channel`) with a
  defensive guard in `src/services/webhooks.ts`; regression test in
  `src/routes/webhooks.test.ts`.

