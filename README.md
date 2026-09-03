# Resident — WebMCP Challenge

Resident is an agent-native record crate: the agent searches and
curates inside the same interface as the human, while its state becomes
visible, audible and interruptible.

Live demo: <https://demo.sephmartin.com/>

## Why this is WebMCP-native

Traditional browser agents act behind the page and leave the user guessing
what happened. Resident exposes narrow page tools through
`document.modelContext.registerTool(...)` and maps every operation to a visible
page state: `AGENT MODE`, `THINKING`, `DIGGING`, `LISTENING`, `RETURNING` or
`HUMAN MODE`.

The human and agent can search the catalog, rank releases using conservative
metadata-only Song DNA, focus and inspect records, control preview playback,
move through releases, add or remove items from the reversible local crate and
prepare checkout together. Human pointer, keyboard and touch input can take
control immediately. The purchase boundary stays explicit: the demo checkout
is a no-payment simulator, and the final audio download is intentionally not
available.

The commit history in this repository is a history-preserving extraction of
the Resident/WebMCP paths from the development branch. The WebMCP work began
on August 26, 2026. The extraction intentionally leaves the private,
full artist-site repository, operational data and unrelated site surfaces out
of this challenge repository.

## Run the source slice locally

The repository is a static source package. It contains the page integration,
WebMCP adapter, catalog fallback, CSS and Three.js runtime needed to inspect
the interaction. The live beta supplies the current catalog API and the
copyright-bound artwork/audio previews at runtime.

```sh
python3 -m http.server 4173
```

Then open <http://127.0.0.1:4173/?demo_checkout=1> in a WebMCP-capable browser.
For judging, use the live beta URL above in ChatGPT's in-app browser or in
Chrome with WebMCP enabled.

## WebMCP tools

The current adapter registers tools for:

- session start/end and human handoff;
- collection stats, catalog sorting, browsing, search and descriptor digging;
- record focus and inspection;
- player state, play, pause, stop, previous/next track and release, seek,
  mute and volume;
- orb visual mode and site theme;
- reversible My Crate management;
- human-reviewed checkout, demo checkout completion and the copyright-safe
  demo download boundary.

The implementation deliberately does not expose microphone capture, payment
credentials, server-side order mutation or an original audio-file download.

Audio has a separate browser gate: a WebMCP/agent call is not a trusted user
gesture. Until the user clicks, taps or presses a key on the page,
`play_track` may return `PLAYBACK_BLOCKED` with `requires_user_gesture: true`,
`user_message` and `next_step`. Agents must relay that instruction and retry
after the interaction; they must verify `get_player_state.is_playing === true`
before saying that audio started.

## Verification

```sh
npm run check:syntax
npm run check:live
```

`check:live` is read-only. It verifies the live beta's WebMCP marker, adapter,
agent HUD, orb controls, checkout/demo boundary and the absence of the removed
mobile sound control.

## Challenge documentation

- [`docs/webmcp-tools.md`](docs/webmcp-tools.md) — complete 29-tool reference,
  parameters and the checkout/download boundary.
- [`docs/webmcp-changelog.md`](docs/webmcp-changelog.md) — readable timeline
  of the challenge-period implementation, backed by the Git history.
- [`docs/agent-recap.md`](docs/agent-recap.md) — compact context and browser
  audio policy for another agent or reviewer.
- [`docs/demo-script.md`](docs/demo-script.md) — the 90–120 second demo arc
  derived from the storyboard and pitch.
- [`docs/existing-project.md`](docs/existing-project.md) — distinction between
  the pre-existing site and the WebMCP work added during the challenge period.
- [`LICENSE-SCOPE.md`](LICENSE-SCOPE.md) — exact open-source and reserved
  material boundary.

## License and asset boundary

The standalone WebMCP modules are released under the Mozilla Public License
2.0. The artist identity, site design, release artwork, audio, commercial
catalog, operational data and third-party material are not granted under that
license. See [`LICENSE-SCOPE.md`](LICENSE-SCOPE.md) before reusing anything.
