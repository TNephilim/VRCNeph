# VRCNeph Handoff

Project path:
`C:\Users\Stren\Documents\Codex Projects\VRCNeph`

Search instruction:
Use `C:\Tools\ripgrep\rg.exe` for searches.

## Current State

There are uncommitted local changes. Do not revert unrelated work.

Known modified files at handoff time:
- `Source Code/src/App/app.js`
- `Source Code/src/App/index.html`
- `Source Code/src/App/overlay.css`
- `Source Code/src/App/overlay.html`
- `Source Code/src/App/overlay.js`
- `Source Code/src/App/styles.css`
- `Source Code/src/Program.cs`
- `VRCNeph.exe`

Root `VRCNeph.exe` was rebuilt/refreshed after the latest local changes.

Last known root exe SHA256:
`95126B3941C86C8F4CC2D62BDA4EAA4E92FD454E899BA9010DF8980343CEC492`

## Recent Completed Changes To Test

- Database random/roulette avoids unavailable, private, deleted, hidden, or invalid avatars.
- Roulette starts its countdown only after VRChat confirms the avatar is equipped.
- New default keybind: Ctrl+Alt+R for database random equip.
- Database Filters has "Hide older avatars" (a metadata/date-based heuristic using Aug 6, 2020 as the cutoff).

## Earlier Changes Since The Last GitHub Update

- In-game overlay expanded with split panels, avatar/world/user details, a fuller database tab, and recent worlds.
- Overlay dropdowns, buttons, resize/drag handles, default opacity, and panel sizing were polished.
- Overlay can add/edit/delete local avatar and world groups, and supports friend favorite groups.
- Avatar/world favorite actions are star buttons; main app avatar stars also handle group selection, moving, and unfavoriting.
- Overlay can open when VRChat is not running.
- Main app friend favorite groups were restored/added.
- Database search gained more filters and sorting controls in the app and overlay.

## Important Notes

- `Hide older avatars` is a heuristic, not true SDK/avatar-descriptor inspection. It checks newest known date fields and some metadata text.
- As of 2026-08-11, both configured Prismic PAS endpoints return HTTP 404. The local PAS file was last refreshed on 2026-06-05. The user plans to join Prismic's world later so the current database source can be identified.
- When the Prismic source is repaired, show a visible error only when its update check/download fails. Do not warn merely because the local cache is old or because no update is available; creators can take breaks.
- AVTRZIP and the remote VRCX-compatible endpoint were reachable on 2026-08-11. They are live search sources, not local databases that VRCNeph periodically downloads.
- Windows notifications were discussed but intentionally not implemented.
- Broader speed/performance cleanup was discussed but not implemented.
- GitHub upload/release update has not been done for these changes.
- The user prefers short, non-duplicated test lists. Avoid splitting one feature into multiple redundant bullets.

## Discuss Next (Not Implemented)

- Do a measured responsiveness pass for slow/janky interactions: menus, dialogs, image previews, and long lists. Start by identifying the actual slow paths before adding caching or larger architectural changes.
- Create shared themed UI components/styles for dropdowns, popups/dialogs, sliders/number inputs, and scrollbars. New controls should use those shared components instead of native browser controls or copied one-off markup.
- Work through the UI consistency pass in this order: dropdowns, dialogs/popups, sliders/number inputs, then scrollbars.
- The user is interested in general visual/UX cleanup, but wants focused improvements that preserve existing panel sizes, layouts, and familiar workflows.
- Windows notifications were only discussed and should not be implemented unless the user explicitly asks again.

## Last Verification Performed

- `node --check Source Code/src/App/app.js`
- `node --check Source Code/src/App/overlay.js`
- `git diff --check`
- `dotnet build "Source Code/VRCNeph.csproj" -c Release`

## Suggested Next Steps

1. Have the user test the recent changes in the main app and overlay.
2. If testing passes, commit and push to `main` only if the user asks.
3. If the user asks to update GitHub, remember that pushing source/root exe to `main` is separate from updating the GitHub Release asset.
