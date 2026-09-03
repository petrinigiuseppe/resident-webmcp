# License scope

This is a mixed-work repository. The root `LICENSE` is not a blanket license
for every file, asset, database, page, or business operation in this project.

## Covered WebMCP software

The Mozilla Public License 2.0 applies to the original WebMCP challenge
software authored for the Resident WebMCP beta, including:

- `crate/webmcp.js`
- `crate/song-dna.js`
- `crate/agent-state.js`
- `crate/webmcp-debug.js`
- `scripts/check_webmcp_contract.mjs`

The SPDX notices in those files identify the covered source form. Modifications
to covered files must preserve the MPL notices and the source-availability
conditions of the MPL. The public repository is the source location for the
covered modules.

The WebMCP adapter is embedded into pre-existing site files for the hosted
challenge demo. Those mixed integration files are not relicensed in their
entirety by this notice; the pre-existing portions remain reserved unless a
file carries an explicit MPL notice.

## Excluded material

Unless a file has its own explicit license notice, all other repository
material remains reserved to its existing owner or governed by its existing
third-party terms. This includes, in particular:

- the Seph Martin name, identity, logos, trade dress, domains, trademarks and
  other brand elements;
- photographs, artwork, record covers, audio, video, release text, editorial
  text and catalog material;
- `data/`, shop/order/payment logic, customer or sales information, and any
  operational or financial records;
- `press/`, `press-kit/`, `journal/`, `releases/` and other public-site content;
- credentials, environment files, deployment bindings and private
  infrastructure details;
- third-party code, libraries, data and media, including items identified in
  `THIRD_PARTY_NOTICES.md`.

No license is granted to the excluded material, and public visibility of this
repository must not be interpreted as permission to reuse it. The WebMCP
challenge demo may reference excluded site material at runtime, but that does
not change its licensing status.

## Challenge context

The covered WebMCP layer was created as an extension of the existing beta site
for the 2026 OpenAI WebMCP Challenge. This is a factual project note only. It
does not grant rights in OpenAI, Devpost, WebMCP, or their names, marks, logos
or materials, and it does not imply sponsorship, endorsement or affiliation.

The existing site predates the challenge work. The dated WebMCP commits and
the challenge documentation distinguish the pre-existing site from the new
WebMCP extension, as required for an existing-project submission.

## Review status

This document records the intended repository boundary for the hackathon. It
is not legal advice or a substitute for review by qualified counsel, especially
before submission if third-party assets, shared files or commercial code are
to be distributed under a different scope.
