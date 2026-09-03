# WebMCP Contract Smoke Test

## Purpose

The WebMCP contract test (`scripts/check_webmcp_contract.mjs`) is an automated, reproducible local test harness that validates the tool registration schema, parameter contracts, annotations, and UI state synchronization for the Resident WebMCP adapter (`crate/webmcp.js`).

## Architecture & Scope

```
+-------------------------------------------------------------+
|                      Node.js Runner                         |
|  - Spawns local static HTTP server (MIME, mock catalog)     |
|  - Spawns Chromium in headless mode via CDP                 |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                   Headless Chromium (CDP)                   |
|                                                             |
|  [ Preload Shim: document.modelContext.registerTool() ]     |
|                              |                              |
|                              v                              |
|  [ WebMCP Adapter: crate/webmcp.js & crate/crate.js ]       |
|  - Registers 29 tools & annotations                         |
|  - Dispatches DOM events & updates dataset state            |
+-------------------------------------------------------------+
```

### Important Boundary Clarification

> **Controlled Shim vs. Native Agent Runtime:**
> This test harness validates the WebMCP contract and DOM side-effects against a **controlled `document.modelContext` shim** injected into the browser page. It tests registration and execution correctness on the browser page surface, **not** a native host agent runtime (such as Chrome's internal Gemini Nano prompt API or external multi-agent orchestrators).

**Audio policy is a separate browser boundary.** A WebMCP call is not a
trusted user gesture. In a real browser, `play_track` can therefore return
`PLAYBACK_BLOCKED` with `requires_user_gesture: true`, `user_message` and
`next_step` until the user clicks, taps or presses a key on the page. The
agent must relay that recovery instruction and must not claim playback until
`get_player_state` reports `is_playing: true`. The controlled contract test
checks the descriptor and tool wiring; it does not manufacture a real user
activation or prove audible playback.

## What is Tested

1. **Tool Registration Contract (29 Tools):**
   - Preloads a mock `document.modelContext` before page script initialization.
   - Asserts registration of all 29 WebMCP tools (`start_curator_session`, `search_catalog`, `inspect_record`, `manage_crate`, `complete_purchase`, `download_release`, `end_curator_session`, etc.).
   - Asserts presence of `name`, `title`, `description`, `inputSchema`, and `annotations` (`readOnlyHint`, `untrustedContentHint`).

2. **Bounded Representative Workflow:**
   - **Session Start (`start_curator_session`):** Confirms transition from Human Mode to Agent Mode (`dataset.agentMode === 'active'`) and HUD visibility.
   - **Catalog Search & Random (`search_catalog`):** Tests both keyword query and `selection: "random"`, verifying song drawer display.
   - **Inspection & 3D Focus (`inspect_record`, `focus_records`):** Validates Song DNA metadata extraction and visual focus.
   - **Playback Transport (`get_player_state`, `play_track`, `pause_track`):** Verifies preview playback controls without audio playback crash.
   - **Crate Mutation (`add_to_crate`):** Verifies cart addition and UI counter update.
   - **Checkout Boundary (`prepare_checkout`, `start_checkout`, `complete_purchase`):**
     - Verifies human confirmation requirement.
     - Opens demo checkout simulator (`demo_checkout=1`).
     - Verifies refusal of unconfirmed purchase (`confirmed: false`) and the
       descriptor's explicit confirmation phrases (`buy now`, `buy it`,
       `confirm purchase`, `complete purchase`, contextual `do it`).
     - Verifies completion of confirmed purchase (`confirmed: true`) generating simulated order ID (`ORDER-...`).
   - **Demo Download Boundary (`download_release`):**
     - Reaches the `DEMO COMPLETE` modal boundary (`demo_complete: true`, `audio_download_available: false`).
     - Guarantees zero download of original audio files and zero payment gateway calls.
   - **Session End (`end_curator_session`):**
     - Soft return to Human Mode (`dataset.agentMode === 'human'`).
     - Restores Human Mode label and status.

## Running the Test

### Prerequisites

- Node.js >= 18 (built-in `WebSocket` and `fetch` available).
- Google Chrome or Chromium installed locally (or specify `CHROME_BIN=/path/to/chrome`).

### Commands

Run the contract smoke test:
```bash
npm run check:webmcp:contract
```

Run syntax check across all scripts and crate modules:
```bash
npm run check:syntax
```
