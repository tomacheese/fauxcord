# Coverage Matrix

Rows = endpoints (see `common/endpoints.json`). Columns = libraries (see spec §3).
Cells: `✅` high-level OK · `N/A` no high-level API (evidence) · `❌→fix` Fauxcord bug fixed (link) · `❌→lib` library-side issue (evidence) · `⛔blocked` cannot target Fauxcord (evidence) · `-` not yet run.

Acceptance: no `-` cells remain; every `N/A`/`⛔blocked` has an evidence note below the table; every endpoint row has ≥1 `✅` (or `❌→fix`).

| Endpoint | discord.js | Eris | Oceanic | discord.py | Nextcord | Pycord | hikari | interactions.py | discordgo | Discord.Net | DSharpPlus5 | JDA | Discord4J | Javacord | Kord | Serenity | Twilight | Concord | DPP | Sleepy | DSharpPlus4 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET /channels/{channel_id}/invites | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| POST /channels/{channel_id}/invites | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /channels/{channel_id}/messages/{message_id}/reactions | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| POST /channels/{channel_id}/messages/{message_id}/threads | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /channels/{channel_id}/messages/{message_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /channels/{channel_id}/messages/{message_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PATCH /channels/{channel_id}/messages/{message_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| POST /channels/{channel_id}/messages/bulk-delete | ✅ | ⛔blocked | N/A | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /channels/{channel_id}/messages/pins/{message_id} | ✅ | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PUT /channels/{channel_id}/messages/pins/{message_id} | ✅ | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /channels/{channel_id}/messages/pins | ✅ | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /channels/{channel_id}/messages | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| POST /channels/{channel_id}/messages | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /channels/{channel_id}/permissions/{overwrite_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PUT /channels/{channel_id}/permissions/{overwrite_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /channels/{channel_id}/pins/{message_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PUT /channels/{channel_id}/pins/{message_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /channels/{channel_id}/pins | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /channels/{channel_id}/thread-members/{user_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /channels/{channel_id}/thread-members/{user_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PUT /channels/{channel_id}/thread-members/{user_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /channels/{channel_id}/thread-members/@me | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PUT /channels/{channel_id}/thread-members/@me | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /channels/{channel_id}/thread-members | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /channels/{channel_id}/threads/archived/private | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /channels/{channel_id}/threads/archived/public | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /channels/{channel_id}/threads/search | ✅ | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| POST /channels/{channel_id}/threads | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| POST /channels/{channel_id}/typing | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /channels/{channel_id}/users/@me/threads/archived/private | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /channels/{channel_id}/webhooks | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| POST /channels/{channel_id}/webhooks | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /channels/{channel_id} | N/A | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /channels/{channel_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PATCH /channels/{channel_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /gateway/bot | ✅ | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /gateway | ✅ | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /guilds/{guild_id}/bans/{user_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /guilds/{guild_id}/bans/{user_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PUT /guilds/{guild_id}/bans/{user_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /guilds/{guild_id}/bans | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /guilds/{guild_id}/channels | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| POST /guilds/{guild_id}/channels | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /guilds/{guild_id}/emojis/{emoji_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /guilds/{guild_id}/emojis/{emoji_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PATCH /guilds/{guild_id}/emojis/{emoji_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /guilds/{guild_id}/emojis | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| POST /guilds/{guild_id}/emojis | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /guilds/{guild_id}/members/{user_id} | N/A | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /guilds/{guild_id}/members/{user_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PATCH /guilds/{guild_id}/members/{user_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /guilds/{guild_id}/members | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /guilds/{guild_id}/roles/{role_id} | ✅ | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PATCH /guilds/{guild_id}/roles/{role_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /guilds/{guild_id}/roles | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| POST /guilds/{guild_id}/roles | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /guilds/{guild_id}/webhooks | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /guilds/{guild_id} | N/A | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /guilds/{guild_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PATCH /guilds/{guild_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /invites/{code} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /invites/{code} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /oauth2/@me | N/A | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /oauth2/applications/@me | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| POST /oauth2/token/revoke | N/A | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| POST /oauth2/token | N/A | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /users/{user_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /users/@me/guilds | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /users/@me | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PATCH /users/@me | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id} | ✅ | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id} | ✅ | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id} | ✅ | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /webhooks/{webhook_id}/{webhook_token} | ✅ | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /webhooks/{webhook_id}/{webhook_token} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PATCH /webhooks/{webhook_id}/{webhook_token} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| POST /webhooks/{webhook_id}/{webhook_token} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| DELETE /webhooks/{webhook_id} | ✅ | ⛔blocked | N/A | - | - | - | - | - | - | N/A | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| GET /webhooks/{webhook_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |
| PATCH /webhooks/{webhook_id} | ✅ | ⛔blocked | ✅ | - | - | - | - | - | - | ✅ | - | ⛔blocked | - | - | - | - | - | - | ⛔blocked | - | ⛔blocked |

## Evidence notes

- Eris (all rows `⛔blocked`): Eris hardcodes HTTPS on port 443 with no scheme/port override; see `js-eris/verify.mjs` header comment. Result file: `results/eris.json` (`baseUrlOverridable: false`).
- JDA (all rows `⛔blocked`, no verifier built): `JDABuilder.build()` requires a real Gateway WebSocket handshake before any `RestAction` becomes usable, and JDA has no supported REST-only build mode; Fauxcord implements no Gateway/WebSocket server. See `jvm-jda/README.md` for full evidence.
- DPP (all rows `⛔blocked`, no verifier built): `dpp::cluster`'s REST transport hardcodes destination host + TLS with no override hook. See `cpp-dpp/README.md` for full evidence.
- DSharpPlus 4.x (all rows `⛔blocked`, no verifier built): the REST base URL is a compile-time `const string` (`DSharpPlus.Net.Utilities` / `Endpoints.BASE_URI`), so a client cannot be pointed at Fauxcord.
- Oceanic: base URL is fully overridable; a handful of endpoints are `N/A` (no high-level wrapper) — see per-row evidence notes in `js-oceanic/verify.mjs`. Result: 67/86 pass, 19 n-a, 0 lib-issue.
- Discord.Net: base URL overridable via `RestClientProvider`; `N/A` rows have no corresponding high-level method — see evidence notes in `dotnet-discordnet/Program.cs`. Result: 62/86 pass, 24 n-a, 0 lib-issue.
- discord.py, Nextcord, Pycord, hikari, Serenity, interactions.py, Discord4J, Kord, Twilight, Concord: verifier code is scaffolded and ready (`Dockerfile` + verify script present under `compat/<dir>/`), but the run has not yet been executed in this environment; rows remain `-` pending a Docker run (see `compat/README.md` "Known run limitations").
- DSharpPlus5, Javacord, Sleepy: not scaffolded — evidence-only technical blockers (`⛔blocked`, no runnable verifier); see `dotnet-dsharpplus/README.md`, `jvm-javacord/README.md`, and `cpp-sleepy/README.md` respectively.
- discordgo: excluded from this snapshot pending transcription. The harness's fixture-contamination bug (`EndpointGuilds`, `EndpointChannels`, etc. — see `go-discordgo/verify.go`) has since been fixed, and a fresh `results/discordgo.json` now shows 73/86 pass, 13 n-a, 0 lib-issue. Rows are left `-` here until the final matrix update transcribes this result.
- discord.js: all 28 originally-reported `❌→lib` findings were triaged per the Task 27 protocol and turned out to be verifier bootstrap/design bugs (401-cascade on a shared `REST` instance, thread-member endpoints targeting a plain channel instead of a real thread, self-targeted BAN/member-removal calls that kicked the bot out of the shared test guild, dual-form webhook-delete and webhook-message id collisions, and OAuth2 endpoints that are structurally incompatible with a Bot token) — none were genuine Fauxcord or discord.js bugs. All were fixed directly in `js-discordjs/verify.mjs` (not recorded as `❌→fix`/`❌→lib`, per Task 27 policy for verifier-side bugs). Result: 80/86 pass, 6 n-a, 0 lib-issue.
- Oceanic: the same triage found the identical three bug classes (thread-members-vs-real-thread, self-targeted BAN, OAuth2-vs-Bot-token) already present in `js-oceanic/verify.mjs`; fixed the same way. Result: 67/86 pass, 19 n-a, 0 lib-issue.
- `PUT /channels/{channel_id}/pins/{message_id}` and `PUT /channels/{channel_id}/messages/pins/{message_id}` (discord.js `❌→lib` finding, since resolved as `❌→fix`): re-pinning an already-pinned message returned an error instead of succeeding. `spec/openapi.json` does not document this case, but the real Discord API and every major client library (including discord.js) treat the pin endpoint as idempotent. Fixed in `src/services/pins.ts` (commit `1024416`); see `src/routes/channel-pins.test.ts` for the regression test.

