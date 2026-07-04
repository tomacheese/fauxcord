// discordgo compatibility verifier.
//
// discordgo overrides its REST base URL via the package-level
// discordgo.EndpointAPI variable (see docs/libraries.md: it must be set
// *before* the Session is created, and must include a trailing slash, per
// the pattern `discordgo.EndpointAPI = "http://fauxcord:3000/api/v10/"`).
//
// discordgo is an object-model library like discord.js/Oceanic (not a thin
// REST client), so each endpoint is mapped to its concrete high-level
// *Session method. Endpoints with no wrapper (e.g. the new-format
// `/messages/pins` API — discordgo's pin helpers only target the legacy
// `/pins` API — or endpoints with no client-side coverage at all, such as
// OAuth2 token exchange) are recorded as "n-a" with an evidence note.
//
// Destructive calls that would break later rows sharing the same resource
// (deleting the shared guild/channel/role/webhook that other rows still
// need) are also skipped and recorded as "n-a" with a "not exercised: ..."
// note, matching the pattern used by the JS verifiers.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/bwmarrin/discordgo"
)

// endpoint is one canonical (method, path) pair from common/endpoints.json.
type endpoint struct {
	Method string `json:"method"`
	Path   string `json:"path"`
}

// result is one row of the output report for a single canonical endpoint.
type result struct {
	Endpoint string `json:"endpoint"`
	Status   string `json:"status"`
	Note     string `json:"note"`
}

// report is the final JSON document written to /results/discordgo.json.
type report struct {
	Library            string   `json:"library"`
	Version            string   `json:"version"`
	BaseUrlOverridable bool     `json:"baseUrlOverridable"`
	Results            []result `json:"results"`
}

// setupChannel mirrors one channel entry in common/setup.json.
type setupChannel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type int    `json:"type"`
}

// setupGuild mirrors one guild entry in common/setup.json.
type setupGuild struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Channels []setupChannel `json:"channels"`
}

// setupPayload mirrors the shape of common/setup.json.
type setupPayload struct {
	Token string `json:"token"`
	User  struct {
		ID       string `json:"id"`
		Username string `json:"username"`
	} `json:"user"`
	Guilds []setupGuild `json:"guilds"`
}

// callEntry maps one endpoint to either an executable probe (fn) or a
// n-a note explaining why no probe is attempted.
type callEntry struct {
	fn   func() error
	note string
}

// waitHealthy polls the SUT health endpoint until it responds 200 OK.
func waitHealthy(origin string) error {
	client := &http.Client{Timeout: 5 * time.Second}
	for i := 0; i < 60; i++ {
		resp, err := client.Get(origin + "/_mock/health")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(1 * time.Second)
	}
	return fmt.Errorf("fauxcord did not become healthy")
}

// doSetup POSTs the shared setup payload. 200/201 (created) and 409
// (already set up by a prior run against a reused Fauxcord container) both
// count as success. It retries with backoff on network errors or
// unexpected statuses: a transient host I/O hiccup here previously caused
// the setup POST to fail silently in another verifier (see
// js-oceanic/verify.mjs's doSetup docstring for the incident), which left
// the guild/channel fixtures missing while the rest of the run proceeded
// anyway and produced a wave of bogus "Unknown Guild"/"Unknown Channel"
// results with no real signal. It panics if setup never succeeds so a
// genuine failure is loud instead of corrupting every downstream result.
func doSetup(origin string, raw []byte) {
	const maxAttempts = 5
	var lastErr error
	var lastStatus int
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		resp, err := http.Post(origin+"/_test/setup", "application/json", bytes.NewReader(raw))
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode < 400 || resp.StatusCode == http.StatusConflict {
				return
			}
			lastStatus = resp.StatusCode
		} else {
			lastErr = err
		}
		if attempt < maxAttempts {
			time.Sleep(time.Duration(attempt) * time.Second)
		}
	}
	panic(fmt.Sprintf(
		"doSetup: failed to POST /_test/setup after %d attempts (lastStatus=%d, lastErr=%v)",
		maxAttempts, lastStatus, lastErr,
	))
}

// strPtr returns a pointer to the given string, for the pointer-typed
// partial-update fields used throughout discordgo's *Params structs.
func strPtr(s string) *string { return &s }

func main() {
	base := os.Getenv("FAUXCORD_BASE")
	if base == "" {
		base = "http://fauxcord:3000/api/v10/"
	}
	if !strings.HasSuffix(base, "/") {
		base += "/"
	}
	origin := strings.TrimSuffix(strings.TrimSuffix(base, "/"), "/api/v10")

	if err := waitHealthy(origin); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}

	setupRaw, err := os.ReadFile("common/setup.json")
	if err != nil {
		fmt.Println("failed to read common/setup.json:", err)
		os.Exit(1)
	}
	doSetup(origin, setupRaw)

	var setup setupPayload
	if err := json.Unmarshal(setupRaw, &setup); err != nil {
		fmt.Println("failed to parse common/setup.json:", err)
		os.Exit(1)
	}

	endpointsRaw, err := os.ReadFile("common/endpoints.json")
	if err != nil {
		fmt.Println("failed to read common/endpoints.json:", err)
		os.Exit(1)
	}
	var endpoints []endpoint
	if err := json.Unmarshal(endpointsRaw, &endpoints); err != nil {
		fmt.Println("failed to parse common/endpoints.json:", err)
		os.Exit(1)
	}

	BOT := setup.User.ID
	GUILD := setup.Guilds[0].ID
	CH := setup.Guilds[0].Channels[0].ID
	// discordgo does its own encoding of the emoji path segment internally,
	// so the raw unicode character is passed here (same as the JS verifiers).
	const EMOJI = "👍"
	const pngDataURI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"

	// discordgo.EndpointAPI must be overridden *before* the Session is
	// created (see docs/libraries.md), including the trailing slash.
	discordgo.EndpointAPI = base

	sess, err := discordgo.New(setup.Token)
	if err != nil {
		fmt.Println("failed to create discordgo session:", err)
		os.Exit(1)
	}

	// Bootstrap resources referenced by later calls, mirroring the JS
	// verifiers. Fall back to placeholder ids when bootstrap itself fails,
	// so the endpoint calls below still exercise the wire format.
	MSG := "400000000000000001"
	BULK1 := "400000000000000002"
	BULK2 := "400000000000000003"
	THREAD := CH
	ROLE := GUILD
	WEBHOOK_ID := "500000000000000001"
	WEBHOOK_TOKEN := "compat-token-xyz"
	WEBHOOK_MSG := ""
	CODE := "compat"
	EMOJI_ID := "600000000000000001"

	if msg, err := sess.ChannelMessageSend(CH, "compat"); err == nil {
		MSG = msg.ID
	}
	if msg, err := sess.ChannelMessageSend(CH, "compat-bulk-1"); err == nil {
		BULK1 = msg.ID
	}
	if msg, err := sess.ChannelMessageSend(CH, "compat-bulk-2"); err == nil {
		BULK2 = msg.ID
	}
	if th, err := sess.MessageThreadStartComplex(CH, MSG, &discordgo.ThreadStart{
		Name:                "compat-thread",
		AutoArchiveDuration: 60,
	}); err == nil {
		THREAD = th.ID
	}
	if role, err := sess.GuildRoleCreate(GUILD, &discordgo.RoleParams{Name: "compat-role"}); err == nil {
		ROLE = role.ID
	}
	// otherwise fall back: the @everyone role id == the guild id in fauxcord
	if wh, err := sess.WebhookCreate(CH, "compat-wh", ""); err == nil {
		WEBHOOK_ID = wh.ID
		WEBHOOK_TOKEN = wh.Token
	}
	if inv, err := sess.ChannelInviteCreate(CH, discordgo.Invite{}); err == nil {
		CODE = inv.Code
	}
	if emoji, err := sess.GuildEmojiCreate(GUILD, &discordgo.EmojiParams{
		Name:  "compat",
		Image: pngDataURI,
	}); err == nil {
		EMOJI_ID = emoji.ID
	}
	// Best-effort: reaction endpoints still exercise the wire format on failure.
	_ = sess.MessageReactionAdd(CH, MSG, EMOJI)
	// Capture a webhook-authored message id for the webhook-message endpoints.
	if msg, err := sess.WebhookExecute(WEBHOOK_ID, WEBHOOK_TOKEN, true, &discordgo.WebhookParams{
		Content: "compat-webhook-msg",
	}); err == nil {
		WEBHOOK_MSG = msg.ID
	}

	calls := map[string]callEntry{
		"GET /channels/{channel_id}/invites": {fn: func() error {
			_, err := sess.ChannelInvites(CH)
			return err
		}},
		"POST /channels/{channel_id}/invites": {fn: func() error {
			_, err := sess.ChannelInviteCreate(CH, discordgo.Invite{})
			return err
		}},
		"DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/{user_id}": {fn: func() error {
			return sess.MessageReactionRemove(CH, MSG, EMOJI, BOT)
		}},
		"DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me": {fn: func() error {
			return sess.MessageReactionRemove(CH, MSG, EMOJI, "@me")
		}},
		"PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me": {fn: func() error {
			return sess.MessageReactionAdd(CH, MSG, EMOJI)
		}},
		"GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}": {fn: func() error {
			_, err := sess.MessageReactions(CH, MSG, EMOJI, 100, "", "")
			return err
		}},
		"DELETE /channels/{channel_id}/messages/{message_id}/reactions": {fn: func() error {
			return sess.MessageReactionsRemoveAll(CH, MSG)
		}},
		"POST /channels/{channel_id}/messages/{message_id}/threads": {fn: func() error {
			_, err := sess.MessageThreadStartComplex(CH, MSG, &discordgo.ThreadStart{
				Name:                "compat-thread2",
				AutoArchiveDuration: 60,
			})
			return err
		}},
		"DELETE /channels/{channel_id}/messages/{message_id}": {fn: func() error {
			return sess.ChannelMessageDelete(CH, MSG)
		}},
		"GET /channels/{channel_id}/messages/{message_id}": {fn: func() error {
			_, err := sess.ChannelMessage(CH, MSG)
			return err
		}},
		"PATCH /channels/{channel_id}/messages/{message_id}": {fn: func() error {
			_, err := sess.ChannelMessageEdit(CH, MSG, "compat-edit")
			return err
		}},
		"POST /channels/{channel_id}/messages/bulk-delete": {fn: func() error {
			return sess.ChannelMessagesBulkDelete(CH, []string{BULK1, BULK2})
		}},
		"DELETE /channels/{channel_id}/messages/pins/{message_id}": {
			note: "discordgo's pin wrappers (ChannelMessagePin/Unpin) target the legacy /channels/{id}/pins endpoint, not the new /messages/pins API",
		},
		"PUT /channels/{channel_id}/messages/pins/{message_id}": {
			note: "discordgo's pin wrappers (ChannelMessagePin/Unpin) target the legacy /channels/{id}/pins endpoint, not the new /messages/pins API",
		},
		"GET /channels/{channel_id}/messages/pins": {
			note: "discordgo's ChannelMessagesPinned targets the legacy /channels/{id}/pins endpoint, not the new /messages/pins API",
		},
		"GET /channels/{channel_id}/messages": {fn: func() error {
			_, err := sess.ChannelMessages(CH, 50, "", "", "")
			return err
		}},
		"POST /channels/{channel_id}/messages": {fn: func() error {
			_, err := sess.ChannelMessageSend(CH, "compat")
			return err
		}},
		"DELETE /channels/{channel_id}/permissions/{overwrite_id}": {fn: func() error {
			return sess.ChannelPermissionDelete(CH, BOT)
		}},
		"PUT /channels/{channel_id}/permissions/{overwrite_id}": {fn: func() error {
			return sess.ChannelPermissionSet(CH, BOT, discordgo.PermissionOverwriteTypeMember, 0, 0)
		}},
		"DELETE /channels/{channel_id}/pins/{message_id}": {fn: func() error {
			return sess.ChannelMessageUnpin(CH, MSG)
		}},
		"PUT /channels/{channel_id}/pins/{message_id}": {fn: func() error {
			return sess.ChannelMessagePin(CH, MSG)
		}},
		"GET /channels/{channel_id}/pins": {fn: func() error {
			_, err := sess.ChannelMessagesPinned(CH)
			return err
		}},
		"DELETE /channels/{channel_id}/thread-members/{user_id}": {fn: func() error {
			return sess.ThreadMemberRemove(THREAD, BOT)
		}},
		"GET /channels/{channel_id}/thread-members/{user_id}": {fn: func() error {
			_, err := sess.ThreadMember(THREAD, BOT, false)
			return err
		}},
		"PUT /channels/{channel_id}/thread-members/{user_id}": {fn: func() error {
			return sess.ThreadMemberAdd(THREAD, BOT)
		}},
		"DELETE /channels/{channel_id}/thread-members/@me": {fn: func() error {
			return sess.ThreadLeave(THREAD)
		}},
		"PUT /channels/{channel_id}/thread-members/@me": {fn: func() error {
			return sess.ThreadJoin(THREAD)
		}},
		"GET /channels/{channel_id}/thread-members": {fn: func() error {
			_, err := sess.ThreadMembers(THREAD, 100, false, "")
			return err
		}},
		"GET /channels/{channel_id}/threads/archived/private": {fn: func() error {
			_, err := sess.ThreadsPrivateArchived(CH, nil, 50)
			return err
		}},
		"GET /channels/{channel_id}/threads/archived/public": {fn: func() error {
			_, err := sess.ThreadsArchived(CH, nil, 50)
			return err
		}},
		"GET /channels/{channel_id}/threads/search": {
			note: "no high-level wrapper for the thread search endpoint",
		},
		"POST /channels/{channel_id}/threads": {fn: func() error {
			_, err := sess.ThreadStart(CH, "compat-thread3", discordgo.ChannelTypeGuildPublicThread, 60)
			return err
		}},
		"POST /channels/{channel_id}/typing": {fn: func() error {
			return sess.ChannelTyping(CH)
		}},
		"GET /channels/{channel_id}/users/@me/threads/archived/private": {fn: func() error {
			_, err := sess.ThreadsPrivateJoinedArchived(CH, nil, 50)
			return err
		}},
		"GET /channels/{channel_id}/webhooks": {fn: func() error {
			_, err := sess.ChannelWebhooks(CH)
			return err
		}},
		"POST /channels/{channel_id}/webhooks": {fn: func() error {
			_, err := sess.WebhookCreate(CH, "compat-wh2", "")
			return err
		}},
		"DELETE /channels/{channel_id}": {
			note: "not exercised: would delete the shared test channel other rows depend on",
		},
		"GET /channels/{channel_id}": {fn: func() error {
			_, err := sess.Channel(CH)
			return err
		}},
		"PATCH /channels/{channel_id}": {fn: func() error {
			_, err := sess.ChannelEdit(CH, &discordgo.ChannelEdit{Name: "general"})
			return err
		}},
		"GET /gateway/bot": {fn: func() error {
			_, err := sess.GatewayBot()
			return err
		}},
		"GET /gateway": {fn: func() error {
			_, err := sess.Gateway()
			return err
		}},
		"DELETE /guilds/{guild_id}/bans/{user_id}": {fn: func() error {
			return sess.GuildBanDelete(GUILD, BOT)
		}},
		"GET /guilds/{guild_id}/bans/{user_id}": {fn: func() error {
			_, err := sess.GuildBan(GUILD, BOT)
			return err
		}},
		"PUT /guilds/{guild_id}/bans/{user_id}": {fn: func() error {
			return sess.GuildBanCreateWithReason(GUILD, BOT, "compat", 0)
		}},
		"GET /guilds/{guild_id}/bans": {fn: func() error {
			_, err := sess.GuildBans(GUILD, 100, "", "")
			return err
		}},
		"GET /guilds/{guild_id}/channels": {fn: func() error {
			_, err := sess.GuildChannels(GUILD)
			return err
		}},
		"POST /guilds/{guild_id}/channels": {fn: func() error {
			_, err := sess.GuildChannelCreate(GUILD, "compat-channel", discordgo.ChannelTypeGuildText)
			return err
		}},
		"DELETE /guilds/{guild_id}/emojis/{emoji_id}": {fn: func() error {
			return sess.GuildEmojiDelete(GUILD, EMOJI_ID)
		}},
		"GET /guilds/{guild_id}/emojis/{emoji_id}": {fn: func() error {
			_, err := sess.GuildEmoji(GUILD, EMOJI_ID)
			return err
		}},
		"PATCH /guilds/{guild_id}/emojis/{emoji_id}": {fn: func() error {
			_, err := sess.GuildEmojiEdit(GUILD, EMOJI_ID, &discordgo.EmojiParams{Name: "compat2"})
			return err
		}},
		"GET /guilds/{guild_id}/emojis": {fn: func() error {
			_, err := sess.GuildEmojis(GUILD)
			return err
		}},
		"POST /guilds/{guild_id}/emojis": {fn: func() error {
			_, err := sess.GuildEmojiCreate(GUILD, &discordgo.EmojiParams{Name: "compat3", Image: pngDataURI})
			return err
		}},
		"DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}": {fn: func() error {
			return sess.GuildMemberRoleRemove(GUILD, BOT, ROLE)
		}},
		"PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}": {fn: func() error {
			return sess.GuildMemberRoleAdd(GUILD, BOT, ROLE)
		}},
		"DELETE /guilds/{guild_id}/members/{user_id}": {
			note: "not exercised: would remove the bot itself from the shared test guild",
		},
		"GET /guilds/{guild_id}/members/{user_id}": {fn: func() error {
			_, err := sess.GuildMember(GUILD, BOT)
			return err
		}},
		"PATCH /guilds/{guild_id}/members/{user_id}": {fn: func() error {
			_, err := sess.GuildMemberEdit(GUILD, BOT, &discordgo.GuildMemberParams{Nick: strPtr("compat")})
			return err
		}},
		"GET /guilds/{guild_id}/members": {fn: func() error {
			_, err := sess.GuildMembers(GUILD, "", 100)
			return err
		}},
		"DELETE /guilds/{guild_id}/roles/{role_id}": {
			note: "not exercised: would remove the role other rows (member-role add/remove) still need",
		},
		"PATCH /guilds/{guild_id}/roles/{role_id}": {fn: func() error {
			_, err := sess.GuildRoleEdit(GUILD, ROLE, &discordgo.RoleParams{Name: "compat-role-renamed"})
			return err
		}},
		"GET /guilds/{guild_id}/roles": {fn: func() error {
			_, err := sess.GuildRoles(GUILD)
			return err
		}},
		"POST /guilds/{guild_id}/roles": {fn: func() error {
			_, err := sess.GuildRoleCreate(GUILD, &discordgo.RoleParams{Name: "compat-role2"})
			return err
		}},
		"GET /guilds/{guild_id}/webhooks": {fn: func() error {
			_, err := sess.GuildWebhooks(GUILD)
			return err
		}},
		"DELETE /guilds/{guild_id}": {
			note: "not exercised: would delete the shared test guild other rows depend on",
		},
		"GET /guilds/{guild_id}": {fn: func() error {
			_, err := sess.Guild(GUILD)
			return err
		}},
		"PATCH /guilds/{guild_id}": {fn: func() error {
			_, err := sess.GuildEdit(GUILD, &discordgo.GuildParams{Name: "Compat Guild"})
			return err
		}},
		"DELETE /invites/{code}": {fn: func() error {
			_, err := sess.InviteDelete(CODE)
			return err
		}},
		"GET /invites/{code}": {fn: func() error {
			_, err := sess.Invite(CODE)
			return err
		}},
		"GET /oauth2/@me": {
			note: "no high-level wrapper for the current-authorization-info endpoint",
		},
		"GET /oauth2/applications/@me": {fn: func() error {
			_, err := sess.Application("@me")
			return err
		}},
		"POST /oauth2/token/revoke": {
			note: "discordgo has no OAuth2 token-exchange wrappers (out of scope for a bot-focused library)",
		},
		"POST /oauth2/token": {
			note: "discordgo has no OAuth2 token-exchange wrappers (out of scope for a bot-focused library)",
		},
		"GET /users/{user_id}": {fn: func() error {
			_, err := sess.User(BOT)
			return err
		}},
		"GET /users/@me/guilds": {fn: func() error {
			_, err := sess.UserGuilds(100, "", "", false)
			return err
		}},
		"GET /users/@me": {fn: func() error {
			_, err := sess.User("@me")
			return err
		}},
		"PATCH /users/@me": {fn: func() error {
			_, err := sess.UserUpdate("CompatBot", "")
			return err
		}},
		"DELETE /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}": webhookMsgCall(WEBHOOK_MSG, func() error {
			return sess.WebhookMessageDelete(WEBHOOK_ID, WEBHOOK_TOKEN, WEBHOOK_MSG)
		}),
		"GET /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}": webhookMsgCall(WEBHOOK_MSG, func() error {
			_, err := sess.WebhookMessage(WEBHOOK_ID, WEBHOOK_TOKEN, WEBHOOK_MSG)
			return err
		}),
		"PATCH /webhooks/{webhook_id}/{webhook_token}/messages/{message_id}": webhookMsgCall(WEBHOOK_MSG, func() error {
			_, err := sess.WebhookMessageEdit(WEBHOOK_ID, WEBHOOK_TOKEN, WEBHOOK_MSG, &discordgo.WebhookEdit{
				Content: strPtr("compat-edit"),
			})
			return err
		}),
		"DELETE /webhooks/{webhook_id}/{webhook_token}": {
			note: "not exercised: would delete the shared webhook other rows still need",
		},
		"GET /webhooks/{webhook_id}/{webhook_token}": {fn: func() error {
			_, err := sess.WebhookWithToken(WEBHOOK_ID, WEBHOOK_TOKEN)
			return err
		}},
		"PATCH /webhooks/{webhook_id}/{webhook_token}": {fn: func() error {
			_, err := sess.WebhookEditWithToken(WEBHOOK_ID, WEBHOOK_TOKEN, "compat-renamed", "")
			return err
		}},
		"POST /webhooks/{webhook_id}/{webhook_token}": {fn: func() error {
			_, err := sess.WebhookExecute(WEBHOOK_ID, WEBHOOK_TOKEN, false, &discordgo.WebhookParams{Content: "compat"})
			return err
		}},
		"DELETE /webhooks/{webhook_id}": {
			note: "not exercised: would delete the shared webhook other rows still need",
		},
		"GET /webhooks/{webhook_id}": {fn: func() error {
			_, err := sess.Webhook(WEBHOOK_ID)
			return err
		}},
		"PATCH /webhooks/{webhook_id}": {fn: func() error {
			_, err := sess.WebhookEdit(WEBHOOK_ID, "compat-renamed2", "", "")
			return err
		}},
	}

	// The canonical endpoint order runs some DELETE/GET calls before the
	// PUT/POST that creates the resource they act on (e.g. ban DELETE/GET
	// before the PUT that creates the ban). Running all non-DELETEs first,
	// then DELETEs last, avoids false "Unknown X" errors from resource-
	// lifecycle ordering rather than real Fauxcord/library bugs (same fix
	// as the JS verifiers).
	ordered := make([]endpoint, len(endpoints))
	copy(ordered, endpoints)
	sort.SliceStable(ordered, func(i, j int) bool {
		iDelete := ordered[i].Method == "DELETE"
		jDelete := ordered[j].Method == "DELETE"
		return !iDelete && jDelete
	})

	results := make([]result, 0, len(ordered))
	for _, ep := range ordered {
		key := ep.Method + " " + ep.Path
		entry, ok := calls[key]
		if !ok || entry.fn == nil {
			note := entry.note
			if note == "" {
				note = "no high-level discordgo method found for this endpoint"
			}
			results = append(results, result{Endpoint: key, Status: "n-a", Note: note})
			continue
		}
		if err := entry.fn(); err != nil {
			msg := err.Error()
			if len(msg) > 300 {
				msg = msg[:300]
			}
			results = append(results, result{Endpoint: key, Status: "lib-issue", Note: msg})
			continue
		}
		results = append(results, result{Endpoint: key, Status: "pass", Note: ""})
	}

	out := report{
		Library:            "discordgo",
		Version:            "v0.29.0",
		BaseUrlOverridable: true,
		Results:            results,
	}
	outRaw, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Println("failed to marshal report:", err)
		os.Exit(1)
	}
	if err := os.WriteFile("/results/discordgo.json", outRaw, 0o644); err != nil {
		fmt.Println("failed to write /results/discordgo.json:", err)
		os.Exit(1)
	}

	passCount := 0
	for _, r := range results {
		if r.Status == "pass" {
			passCount++
		}
	}
	fmt.Printf("discordgo done: %d/%d pass\n", passCount, len(results))
}

// webhookMsgCall wraps a webhook-message probe so it is skipped (recorded as
// n-a) when no webhook-authored message id was captured during bootstrap.
func webhookMsgCall(webhookMsg string, fn func() error) callEntry {
	if webhookMsg == "" {
		return callEntry{note: "not exercised: no message id captured for a webhook-authored message in this run"}
	}
	return callEntry{fn: fn}
}
