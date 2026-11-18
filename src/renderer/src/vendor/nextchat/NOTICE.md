# NextChat UI source attribution

Upstream: https://github.com/ChatGPTNextWeb/NextChat

Pinned commit: 1d3dc331512929a4b1d3e82354e72acce33b5c7a (2026-10-20)

License: MIT; the upstream license is included as LICENSE in this directory.

Unmodified upstream sources: components/*.module.scss, styles/*.scss and icons/*.svg.
These files supply the actual layout, color tokens, dimensions and artwork.
The current XingShu application icon is a separate SVG, not the NextChat icon.

Adaptations in ../../NextChat.tsx and ../../App.tsx replace Next.js navigation,
the upstream account and cloud stores, and API clients with the existing local
Electron IPC and project stores. The application name and UI labels are localized.
App.css contains only host integration and local form layout, not a replacement theme.
Studio.css adds Tongzhou's optional message presentation and local visual theme.
The current AgentAvatar.tsx uses the separately attributed CC BY-NC 4.0 community character crops; see ../chibi-pets/. These are not NextChat artwork or official model-provider logos.

No NextChat cloud, analytics, remote prompt catalog, or server-side API code is imported.
Tongzhou is an independent adaptation and is not an official NextChat release.
