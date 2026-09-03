# WebMCP tool reference

This is the current page-level WebMCP contract for the WebMCP challenge
build. The adapter registers 29 narrow tools from `crate/webmcp.js`.

The tools operate through the existing crate facade and update the visible
page. They do not provide payment credentials, server-side order mutation or
an original audio-file download.

## Session and catalog

| Tool | Inputs | What it does |
| --- | --- | --- |
| `start_curator_session` | `intent?` | Starts or resumes the visible Agent Mode session. It does not purchase anything. |
| `get_collection_stats` | none | Returns metadata-backed collection counts and the available Song DNA dimensions. |
| `sort_catalog` | `sort`: `latest` \| `popular` \| `oldest`; `focus?`: `none` \| `first` \| `last` | Changes the visible catalog order and can focus one edge of the result. |
| `browse_catalog` | `direction`: `next` \| `previous`; `steps?` (1–12); `start_record_id?` | Moves through releases in the visible Shop crate. |
| `search_catalog` | `query?`; `selection?`: `match` \| `random`; `navigation?`: `auto` \| `direct` \| `digging`; `max_results?`; `max_steps?` | Searches by title, artist or release category. `selection=random` chooses a bounded random result and uses the digging animation. |
| `dig_by_descriptor` | `descriptor`; `max_results?`; `exclude_ids?` | Ranks releases using conservative metadata-only Song DNA signals. It does not claim audio analysis. |
| `focus_records` | `record_ids`; `label?` | Brings selected records into focus without recolouring the artwork. |
| `inspect_record` | `record_id` | Opens the existing detail panel and returns release metadata and Song DNA provenance. |

## Player and transport

| Tool | Inputs | What it does |
| --- | --- | --- |
| `get_player_state` | none | Reads the current release, track, play state, position, duration, availability, volume and site-audio state. |
| `play_track` | `track_id?`; `record_id?` | Loads and plays a preview. The agent call is not a trusted user gesture; if the browser has not been unlocked by a click, tap or key press, the tool returns `PLAYBACK_BLOCKED` and actionable recovery fields. |
| `pause_track` | none | Pauses the current preview and preserves its position. |
| `stop_track` | none | Stops the current preview while preserving its position. |
| `previous_track` | none | Plays the previous track in the current release. |
| `next_track` | none | Plays the next track in the current release. |
| `previous_release` | none | Opens the previous release in the Shop crate. |
| `next_release` | none | Opens the next release in the Shop crate. |
| `seek_track` | `position_seconds` (0–86400) | Seeks the current preview to an absolute position. |
| `set_audio_mute` | `muted`: boolean | Mutes or unmutes site audio, including preview playback and Agent Mode cues. |
| `set_player_volume` | `volume`: number from 0 to 1 | Sets preview volume through the agent contract. It does not toggle the separate site mute state. |

### Browser audio policy (important for agents)

The browser's autoplay policy is a separate gate from WebMCP discovery. An
agent/WebMCP call does **not** count as a trusted user gesture. Until the user
has clicked, tapped or pressed a key on the page, `play_track` may be unable
to start the preview audio.

When that happens, the tool returns `ok: false` with
`error.code: "PLAYBACK_BLOCKED"`, `requires_user_gesture: true`, plus
`user_message` and `next_step`. The agent must relay those fields, ask the
user to interact with the visible page or player, and retry `play_track`.
It must not claim that audio started from the tool call alone; use
`get_player_state` and wait for `is_playing: true` as the authoritative
readback. This applies equally when the request comes from an agent.

## Visual controls

| Tool | Inputs | What it does |
| --- | --- | --- |
| `set_orb_visual` | `mode`: `cover` \| `disco_ball` | Switches the Agent orb between the release-cover bubble and disco-ball visual. |
| `set_theme` | `theme`: `light` \| `dark` \| `system` | Changes and persists the website theme. This is the site theme, not the browser or agent UI theme. |

## My Crate

| Tool | Inputs | What it does |
| --- | --- | --- |
| `manage_crate` | `record_id`; `action`: `add` \| `remove` | Adds or removes a release from the reversible local My Crate. |
| `add_to_crate` | `record_id?` | Adds a release. When omitted after a selection or inspection, the current release context is used. |
| `return_to_main_crate` | none | Returns to the main Shop crate, closes the detail drawer and preserves the preview player. |

## Checkout and demo boundary

| Tool | Inputs | What it does |
| --- | --- | --- |
| `prepare_checkout` | none | Shows My Crate and returns a summary for human review. It does not open checkout or purchase. |
| `start_checkout` | none | Activates checkout. In the challenge simulator it opens the review surface and waits for confirmation; outside it, the final payment step remains human-controlled. |
| `complete_purchase` | `confirmed`: boolean | Completes the no-payment demo purchase only after explicit user confirmation such as “buy now”, “buy it”, “confirm purchase”, “complete purchase” or contextual “do it”. It records a simulated order and shows Purchase Complete. |
| `download_release` | `record_id?` | Reaches the final `DEMO COMPLETE` boundary after purchase. In the demo it deliberately delivers no original audio file. |
| `end_curator_session` | none | Returns the page to Human Mode without changing My Crate. |

`complete_purchase` and `download_release` are intentionally separate. A
purchase confirmation must not be treated as the end of the demo; the demo
boundary is the subsequent explicit download/finish action.

## Diagnostic export is not a WebMCP command

The visible `Download Log` control (`#site-diagnostics-download`) exports a
local browser diagnostic log containing tool calls, visible state and errors.
It is a QA/evidence utility, not an audio download and not one of the 29
WebMCP tools. The original music remains unavailable at the demo boundary.

## Canonical demo sequence

For a complete agent-assisted run, the intended order is:

1. `start_curator_session`
2. `search_catalog` or `dig_by_descriptor`
3. `inspect_record` and `play_track`
4. `add_to_crate`
5. `prepare_checkout` or `start_checkout`
6. `complete_purchase` with `confirmed: true` only after explicit confirmation
7. `download_release` only when the user explicitly asks to finish/download

The contract smoke test documents the same separation and validates it against
a controlled page shim. It does not replace a runtime test in a WebMCP-capable
browser.
