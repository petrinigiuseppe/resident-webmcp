# Resident — agent handoff recap (m77)

This is the compact context note for another agent reviewing or testing the
WebMCP challenge build.

## Identity and surfaces

- Project name: **Resident**.
- Challenge demo: <https://demo.sephmartin.com/>
- Existing artist site: <https://sephmartin.com/>
- Public source: <https://github.com/petrinigiuseppe/resident-webmcp>
- Demo video: <https://www.youtube.com/watch?v=Obi3oVdIKSI> (unlisted).
- Runtime marker: `20260831-webmcp-m77`.

## History provenance

This repository preserves the relevant Resident/WebMCP development history
from August 26, 2026 through m77. It is a path-filtered extraction from the
development branch: dates and commit messages are retained, while the private
full artist-site repository and unrelated operational surfaces are excluded.

## Checkout confirmation contract

The checkout is a no-payment simulator. `start_checkout` opens the visible
review and never completes the purchase. After that review is open, the host
agent must call `complete_purchase({ confirmed: true })` only after an
explicit reply to the checkout prompt. Supported examples are English
`buy now`, `buy it`, `confirm purchase`, `complete purchase` and `do it`, or
Italian `confermo`, `confermo l'acquisto`, `compra ora`, `procedi` and
contextual `vai`. A general `buy` or `compra` request before review is not
confirmation, and the boolean gate remains mandatory.

Purchase completion and the later `download_release` boundary are separate.
The simulator records no payment, never contacts Lemon and never delivers
the original audio. The final boundary shows `DEMO COMPLETE` and remains
copyright-safe.

## Diagnostic export

The footer control is labelled `DOWNLOAD LOG`. It still exports JSON because
the diagnostic log is a structured JSON artifact; the filename now includes
`diagnostic-log`. It is a local QA/evidence utility, not a WebMCP tool and not
an audio download.

## Audio policy — do not skip this

Browser autoplay policy is independent of WebMCP. An agent call is **not** a
trusted user gesture. If the user has not clicked, tapped or pressed a key on
the page, `play_track` may return `PLAYBACK_BLOCKED` with actionable recovery
fields. The agent must relay those fields and verify `get_player_state` before
claiming playback.

## Verification

- `npm run check:syntax` checks the public JavaScript source and test scripts.
- `npm run check:webmcp:contract` checks the controlled local WebMCP flow,
  including the confirmation gate and copyright-safe download boundary.
- `npm run check:live` checks the deployed demo surface and m77 marker.
- The controlled checks do not prove that a native host will discover the
  page or map every natural-language confirmation identically.
