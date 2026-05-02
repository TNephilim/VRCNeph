# VRCNeph

VRCNeph is a desktop app for managing unlimited local VRChat avatar favorites, groups, avatar notes, syncing, and local avatar database search.

## Features

- Unlimited local avatar favorites stored outside VRChat's in-game favorite caps.
- User-created groups with add, edit, and delete support.
- Thumbnail and full image URLs.
- Avatar metadata fields for ID, name, description, author, release status, version, platforms, tags, source URL, notes, and raw JSON.
- Search and sorting inside the active group.
- JSON import and export.
- VRChat login with saved session cookies and 2FA support.
- Sync VRChat avatar favorite groups into the local unlimited library.
- Save your currently worn VRChat avatar into the active local group.
- Best-effort avatar lookup from `https://api.vrchat.cloud/api/1/avatars/{avatarId}`.
- Database search reads the local VRCX SQLite database directly; VRCX does not need to be running.

Private avatars or endpoints that require a logged-in VRChat session may not be returned until you sign in. The app stores VRChat session cookies under `Documents\VRCNeph\groups\vrchat-session.json`; it does not store your password.

## Run

```powershell
dotnet run
```

The project is configured as a Windows GUI app, so opening `VRCNeph.exe` does not spawn a console window. Building the project also publishes a root-level executable:

```powershell
dotnet build
.\VRCNeph.exe
```

The UI files live under `src\App` and are embedded into the executable during build, so the root `VRCNeph.exe` does not need a loose `app` folder beside it.

## Data

The local library is stored at:

```text
Documents\VRCNeph\groups\library.json
```

The app also keeps split `Documents\VRCNeph\avatars.json` and `Documents\VRCNeph\categories.json` files for the avatar/category data. Exports are written under `Documents\VRCNeph\export`.

VRCX database search uses the first available `VRCX.sqlite3` from `Documents\VRCNeph\database`, VRCX's configured database location, or `%AppData%\VRCX`.

## Reference

This project follows the same broad local-first idea as VRCX's unrestricted local favorites and avatar metadata tooling, while staying standalone and not modifying VRChat.
