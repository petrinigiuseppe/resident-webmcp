# Resident — WebMCP development changelog

Resident grew out of an existing 3D digital record-crate experience. This
timeline records the WebMCP implementation work that began on August 26,
2026. The Git history is the authoritative record of individual changes; this
file is the readable map for a reviewer.

## August 26 — foundation and visible presence

- Prepared the beta iteration path and made the demo crate assets cache-safe.
- Added the page-level WebMCP curator foundation, model-context compatibility
  fallback and the open-source license boundary.
- Added the visible Agent Mode state machine, HUD, debug surface, orb
  presence, human-priority handoff and responsive behavior.
- Added the first agent behavior audio layer, touch/keyboard interaction and
  guarded browser audio activation.
- Stabilized the 3D crate frame, layering, checkout boundary and empty-crate
  behavior.

## August 27–28 — catalog intelligence and playback

- Refined agent controls, browsing focus and release context in the preview
  player.
- Added metadata-first Song DNA Lite and explicit provenance for unavailable
  audio analysis fields.
- Added player transport, preview audio state and low-latency WebMCP
  diagnostics.

## August 29–30 — catalog control and checkout entry

- Added theme control, keyboard transport, structured diagnostics and direct
  record context.
- Added release classification, latest/popular/oldest sorting and bounded
  descriptor digging with responsive player behavior.
- Added agent-triggered checkout entry while keeping payment and order
  mutation outside the WebMCP surface.

## August 31–September 1 — demo checkout boundary

- Added the theme-aware checkout overlay and on-site no-payment simulator.
- Connected checkout state to WebMCP, including saved demo profile, crate
  lines and human review before purchase completion.
- Added the explicit copyright-safe download boundary and the final demo
  completion surface.

## September 2 — recording and interaction hardening

- Exposed an explicit contextual `add_to_crate` tool and restored selected
  release inference.
- Calibrated preview volume for recording and restored theme, stop, release
  navigation and descriptor-ranking behavior.
- Separated checkout review from the explicit purchase confirmation boundary.

## September 3 — Resident/m77 stabilization

- Clarified the confirmation routing and browser audio-activation contract.
- Added the purchase-completion modal auto-close while preserving the later
  explicit `download_release` demo boundary.
- Localized confirmation examples without weakening the `confirmed: true`
  purchase gate.

## Public repository boundary

The public challenge repository contains the Resident/WebMCP source slice,
tests and technical documentation. The Devpost working packet is not part of
the product repository; `docs/demo-script.md` remains as the concise,
reproducible demo path. Private site operations, credentials, original audio
delivery and commercial catalog data remain outside this repository.
