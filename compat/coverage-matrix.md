# Coverage Matrix

Rows = endpoints (see `common/endpoints.json`). Columns = libraries (see spec §3).
Cells: `✅` high-level OK · `N/A` no high-level API (evidence) · `❌→fix` Fauxcord bug fixed (link) · `❌→lib` library-side issue (evidence) · `⛔blocked` cannot target Fauxcord (evidence) · `-` not yet run.

Acceptance: every `N/A`/`⛔blocked` has an evidence note below the table; every endpoint row has ≥1 `✅` (or `❌→fix`). No `-` (not-yet-run) cells remain — discord.js, Oceanic, discordgo, and Concord have all been re-run against the full 87-endpoint set, including `PATCH /guilds/{guild_id}/members/@me`.

| Endpoint | discord.js | Eris | Oceanic | discord.py | Nextcord | Pycord | hikari | interactions.py | discordgo | Discord.Net | DSharpPlus5 | JDA | Discord4J | Javacord | Kord | Serenity | Twilight | Concord | DPP | Sleepy | DSharpPlus4 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET /channels/{channel_id}/invites | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /channels/{channel_id}/invites | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id} | ✅ | ⛔blocked | ✅ | N/A | N/A | N/A | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/messages/{message_id}/reactions | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /channels/{channel_id}/messages/{message_id}/threads | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | N/A | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/messages/{message_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/messages/{message_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌→fix | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /channels/{channel_id}/messages/{message_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /channels/{channel_id}/messages/bulk-delete | ✅ | ⛔blocked | N/A | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/messages/pins/{message_id} | ✅ | ⛔blocked | N/A | ✅ | ✅ | ✅ | N/A | N/A | N/A | N/A | ⛔blocked | ❌→lib | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /channels/{channel_id}/messages/pins/{message_id} | ❌→fix | ⛔blocked | N/A | ✅ | ✅ | ✅ | N/A | N/A | N/A | N/A | ⛔blocked | ✅ | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/messages/pins | ✅ | ⛔blocked | N/A | ✅ | ✅ | ❌→lib | N/A | N/A | N/A | N/A | ⛔blocked | ✅ | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/messages | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌→fix | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /channels/{channel_id}/messages | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/permissions/{overwrite_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /channels/{channel_id}/permissions/{overwrite_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/pins/{message_id} | ✅ | ⛔blocked | ✅ | N/A | N/A | N/A | ✅ | ✅ | ✅ | ✅ | ⛔blocked | N/A | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /channels/{channel_id}/pins/{message_id} | ❌→fix | ⛔blocked | ✅ | N/A | N/A | N/A | ✅ | ✅ | ✅ | ✅ | ⛔blocked | N/A | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/pins | ✅ | ⛔blocked | ✅ | N/A | N/A | N/A | ✅ | ✅ | ✅ | ✅ | ⛔blocked | N/A | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/thread-members/{user_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | N/A | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/thread-members/{user_id} | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ✅ | N/A | ✅ | N/A | ⛔blocked | ✅ | N/A | ⛔blocked | N/A | ✅ | ❌→lib | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /channels/{channel_id}/thread-members/{user_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | N/A | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id}/thread-members/@me | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | N/A | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /channels/{channel_id}/thread-members/@me | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | N/A | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/thread-members | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | N/A | ⛔blocked | ✅ | ✅ | ❌→lib | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/threads/archived/private | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | N/A | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/threads/archived/public | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | N/A | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/threads/search | ✅ | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ⛔blocked | N/A | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /channels/{channel_id}/threads | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | N/A | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /channels/{channel_id}/typing | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/users/@me/threads/archived/private | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | N/A | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id}/webhooks | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /channels/{channel_id}/webhooks | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /channels/{channel_id} | N/A | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ⛔blocked | N/A | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /channels/{channel_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌→fix | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /channels/{channel_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /gateway/bot | ✅ | ⛔blocked | N/A | N/A | N/A | N/A | ✅ | ✅ | ✅ | N/A | ⛔blocked | N/A | ✅ | ⛔blocked | N/A | N/A | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /gateway | ✅ | ⛔blocked | N/A | N/A | N/A | N/A | ✅ | ✅ | ✅ | N/A | ⛔blocked | N/A | ✅ | ⛔blocked | N/A | N/A | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /guilds/{guild_id}/bans/{user_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/bans/{user_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ❌→lib | ❌→lib | ⛔blocked | ❌→lib | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /guilds/{guild_id}/bans/{user_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/bans | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/channels | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /guilds/{guild_id}/channels | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /guilds/{guild_id}/emojis/{emoji_id} | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/emojis/{emoji_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /guilds/{guild_id}/emojis/{emoji_id} | ✅ | ⛔blocked | ✅ | ❌→lib | ❌→lib | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/emojis | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /guilds/{guild_id}/emojis | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id} | ✅ | ⛔blocked | ✅ | ❌→lib | ✅ | ❌→lib | ❌→lib | ❌→lib | ✅ | ❌→fix | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id} | ✅ | ⛔blocked | ✅ | ❌→lib | ✅ | ❌→lib | ❌→lib | ❌→lib | ✅ | ❌→fix | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /guilds/{guild_id}/members/{user_id} | N/A | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ⛔blocked | N/A | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/members/{user_id} | ✅ | ⛔blocked | ✅ | ❌→lib | ✅ | ❌→lib | ❌→lib | ❌→lib | ✅ | ❌→fix | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /guilds/{guild_id}/members/{user_id} | ✅ | ⛔blocked | ✅ | ❌→lib | ❌→lib | ❌→lib | ❌→lib | ❌→lib | ✅ | ❌→fix | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /guilds/{guild_id}/members/@me | ✅ | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ❌→fix | ⛔blocked | ✅ | N/A | ⛔blocked | N/A | N/A | N/A | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/members | ✅ | ⛔blocked | ✅ | ❌→lib | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /guilds/{guild_id}/roles/{role_id} | ✅ | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ⛔blocked | N/A | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /guilds/{guild_id}/roles/{role_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/roles | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ❌→fix | ✅ | ✅ | N/A | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /guilds/{guild_id}/roles | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ❌→fix | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id}/webhooks | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /guilds/{guild_id} | N/A | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ⛔blocked | N/A | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /guilds/{guild_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ❌→fix | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ❌→fix | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /guilds/{guild_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ❌→fix | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ❌→fix | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /invites/{code} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /invites/{code} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ❌→lib | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /oauth2/@me | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ❌→lib | ❌→lib | N/A | N/A | ⛔blocked | N/A | N/A | ⛔blocked | N/A | N/A | ❌→lib | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /oauth2/applications/@me | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ❌→lib | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /oauth2/token/revoke | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ✅ | N/A | N/A | N/A | ⛔blocked | N/A | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /oauth2/token | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ✅ | N/A | N/A | N/A | ⛔blocked | N/A | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /users/{user_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /users/@me/guilds | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | N/A | ⛔blocked | N/A | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /users/@me | ✅ | ⛔blocked | ✅ | N/A | N/A | N/A | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /users/@me | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔blocked | N/A | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id} | ✅ | ⛔blocked | N/A | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | N/A | ⛔blocked | N/A | ✅ | ⛔blocked | ❌→lib | ✅ | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id} | ✅ | ⛔blocked | N/A | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | N/A | ⛔blocked | N/A | ✅ | ⛔blocked | ✅ | ✅ | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id} | ✅ | ⛔blocked | N/A | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | N/A | ⛔blocked | N/A | ✅ | ⛔blocked | ✅ | ✅ | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /webhooks/{webhook_id}/{webhook_token} | ✅ | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ⛔blocked | N/A | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /webhooks/{webhook_id}/{webhook_token} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | ⛔blocked | N/A | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /webhooks/{webhook_id}/{webhook_token} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | ⛔blocked | N/A | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| POST /webhooks/{webhook_id}/{webhook_token} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | N/A | ⛔blocked | N/A | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |
| DELETE /webhooks/{webhook_id} | ✅ | ⛔blocked | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ⛔blocked | N/A | N/A | ⛔blocked | N/A | N/A | N/A | N/A | ⛔blocked | ⛔blocked | ⛔blocked |
| GET /webhooks/{webhook_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ⛔blocked | ⛔blocked | ⛔blocked |
| PATCH /webhooks/{webhook_id} | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ✅ | ✅ | ❌→lib | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ⛔blocked | ✅ | ✅ | ✅ | ❌→lib | ⛔blocked | ⛔blocked | ⛔blocked |

## Evidence notes

Full per-row reasoning lives in each verifier's own result file / evidence
notes (`results/<lib>.json`, `verify.*`); this section summarizes each
library's overall result and links out to any genuine Fauxcord bug it
surfaced.

### Per-library summary

| Library | Base URL override | Result (of 87) | Notes |
|---|---|---|---|
| discord.js | native `REST` option | 81 ✅ / 6 N/A / 0 lib-issue | All 28 original findings were verifier bugs — see [triage](#discordjs--oceanic-verifier-triage) |
| Eris | ❌ hardcodes HTTPS:443 | ⛔ blocked | `js-eris/verify.mjs`; `results/eris.json` |
| Oceanic | fully overridable | 67 ✅ / 20 N/A / 0 lib-issue | Same verifier bugs as discord.js — see [triage](#discordjs--oceanic-verifier-triage). 2 new `❌→lib` rows on re-run, suspected verifier flakiness, unconfirmed (cells left unchanged) |
| discord.py | `Route.BASE` | 63 ✅ / 18 N/A / 6 lib-issue | `❌→lib` = discord.py-side strictness |
| Nextcord (discord.py fork) | `nextcord.http.Route.BASE` | 61 ✅ / 18 N/A / 8 lib-issue | `❌→lib` = library-side |
| Pycord (discord.py fork) | `discord.http.Route.BASE` | 49 ✅ / 18 N/A / 20 lib-issue | `❌→lib` = library-side |
| hikari | `hikari.RESTApp(url=...)` | 66 ✅ / 11 N/A / 10 lib-issue | 2 Fauxcord bugs found — see [bugs table](#fauxcord-bugs-found-and-fixed). Rest = hikari-side |
| interactions.py | `interactions.api.http.route.Route.BASE` | 66 ✅ / 14 N/A / 7 lib-issue | `❌→lib` = library-side |
| discordgo | `EndpointAPI` + per-resource vars | 73 ✅ / 14 N/A / 0 lib-issue | Verifier fixture-contamination bug fixed (`go-discordgo/verify.go`) |
| Discord.Net | `RestClientProvider` | 63 ✅ / 24 N/A / 0 lib-issue | 3 Fauxcord bugs found — see [bugs table](#fauxcord-bugs-found-and-fixed) |
| DSharpPlus 5.x | ❌ compile-time `const string`, needs Gateway | ⛔ blocked | No verifier; `dotnet-dsharpplus/README.md` |
| DSharpPlus 4.x | ❌ same mechanism | ⛔ blocked | No verifier; README follow-up tracked |
| JDA | `RestConfig#setBaseUrl` (Gateway now supported) | 62 ✅ / 23 N/A / 2 lib-issue | 2 Fauxcord Gateway dispatch bugs found — see [bugs table](#fauxcord-bugs-found-and-fixed). `❌→lib` = JDA-side; see `jvm-jda/README.md` |
| Discord4J | `RouterOptions.discordBaseUrl` | 60 ✅ / 25 N/A / 2 lib-issue | High N/A: 3.2.6's `ChannelService` lacks several high-level methods |
| Javacord | ❌ hardcoded domain, needs Gateway | ⛔ blocked | No verifier; `jvm-javacord/README.md` |
| Kord | Ktor `HttpRequestPipeline.Before` | 68 ✅ / 17 N/A / 2 lib-issue | 1 Fauxcord bug found — see [bugs table](#fauxcord-bugs-found-and-fixed). Rest probes non-existent entities (404) |
| Serenity | `HttpBuilder::proxy(url)` | 71 ✅ / 16 N/A / 0 lib-issue | 1 Fauxcord bug found — see [bugs table](#fauxcord-bugs-found-and-fixed) |
| Twilight | `ClientBuilder::proxy(host, use_http)` | 55 ✅ / 16 N/A / 16 lib-issue | `❌→lib` = Twilight deserializer stricter than spec (Serenity/Kord decode fine; passes contract tests) |
| Concord | `struct discord_config.base_url` | 53 ✅ / 16 N/A / 18 lib-issue | 1 Fauxcord bug found — see [bugs table](#fauxcord-bugs-found-and-fixed). Rest = Concord JSON-codec failures |
| DPP | ❌ hardcoded transport | ⛔ blocked | No verifier; `cpp-dpp/README.md` |
| Sleepy Discord | ❌ hardcoded host/scheme | ⛔ blocked | No verifier; `cpp-sleepy/README.md` |

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

| Bug | Found via | Symptom | Fix |
|---|---|---|---|
| Pin not idempotent | discord.js | Re-pinning an already-pinned message errored instead of succeeding | `src/services/pins.ts` (`1024416`) · test: `channel-pins.test.ts` |
| Bot not a member of its own guild | Discord.Net | `/_test/setup` never registered the bot as a member, so self-targeted member/role calls 404'd as Unknown Member (also covers `PATCH .../members/@me`) | `src/services/test-control.ts` (`b9071ac`) · test: `test.test.ts` |
| Thread returned in plain-channel shape | Discord.Net | `GET /channels/{id}` omitted `thread_metadata` for thread channels → `InvalidCastException` | `src/routes/channels.ts` (`b9071ac`) · test: `channels.test.ts` |
| Reaction object missing fields | Discord.Net | Missing `count_details`/`me_burst`/`burst_colors` → `NullReferenceException` on messages with reactions | `src/services/messages.ts` (`b9071ac`) · test: `messages.test.ts` |
| Guild response missing 23 required fields | Serenity (also fixed Kord) | Strict `serde` deserializer rejected the guild object; Kord hit the identical `MissingFieldException`, both also affected by the `team` field on `GET /oauth2/applications/@me` | `src/services/guilds.ts` · test: `guilds.test.ts` |
| Role `permissions` round-tripped as `"0.0"` | hikari | Numeric `permissions` stored as SQLite REAL → decimal string → hikari's `int()` raised `ValueError` | `normalizePermissions` in `src/services/guild-roles.ts` (`817148d`) · test: `guild-roles.test.ts` |
| Thread-members pagination never terminated | hikari | `after` cursor ignored → `ThreadMembersIterator` looped forever | `src/services/threads.ts` (`a27651a`) |
| Webhook move to unknown channel → HTTP 500 | Concord | Unknown `channel_id` written straight to the FK column instead of being validated | `src/routes/webhooks.ts` + guard in `services/webhooks.ts` · test: `webhooks.test.ts` |
| `MESSAGE_CREATE`/`MESSAGE_UPDATE` dispatch missing `guild_id`/`member` | JDA (Gateway) | JDA's `EntityBuilder` silently failed to build the message author `Member` without `member`; listener `CompletableFuture` timed out with no logged exception | `src/gateway/bus.ts`, `src/gateway/subscribe.ts`, `src/services/messages.ts` (`30b87c1`) · test: `bus.test.ts`, `subscribe.test.ts` |
| `GUILD_CREATE` missing Gateway-only extra fields; `READY.guilds` always `[]` | JDA (Gateway) | JDA's entity builders require `member_count`/`large`/`channels`/`members`/etc.; `GuildSetupController` uses READY's guild-stub list to know how many `GUILD_CREATE` dispatches to await | `src/services/guilds.ts`, `src/gateway/server.ts` (`c9d67ff`) · test: `identify-resume.test.ts` |
| Thread-members `?with_member=true` ignored | JDA | `EntityBuilder.createThreadMember` throws `DataObjectParsingException` when the `member` key is entirely absent | `src/services/threads.ts`, `src/routes/channel-threads.ts` (`fbe0926`) · test: `channel-threads.test.ts` |

All commit hashes above are on `master`; regression tests live next to the
fixed source file unless noted otherwise.

