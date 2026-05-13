# VRCNeph

VRCNeph is a desktop app for managing VRChat avatar favorites outside the in-game favorite limit.

## What It Does

- Saves unlimited local avatar favorites.
- Organizes avatars into custom groups.
- Syncs VRChat favorite groups into the local library.
- Saves your currently worn avatar into a local group.
- Stores notes and metadata for each avatar.
- Searches avatars by name, ID, author, description, tags, and notes.
- Searches local and remote avatar databases from one tab.
- Imports and exports your local library as JSON.
- Checks GitHub releases for app updates.

## Download

Download the latest `VRCNeph.exe` from the GitHub releases page:

```text
https://github.com/TNephilim/VRCNeph/releases/latest
```

The app is built as a standalone Windows executable. Keep it wherever you want to run it from.

## Basic Use

1. Open `VRCNeph.exe`.
2. Add avatars by avatar ID, by pasting metadata, or by filling fields manually.
3. Create groups to organize favorites.
4. Use the database tab to search cached avatar sources.
5. Export your library when you want a backup or a copy for another machine.

## VRChat Login And Sync

Signing in is optional. Without login, local favorites and database search still work.

Login is used for:

- Fetching private or account-limited avatar details.
- Syncing VRChat favorite groups.
- Saving your current avatar.
- Equipping avatars through VRChat.

The app stores VRChat session cookies locally after login. It does not store your password.

## Database Search

The database tab can search:

- VRCX avatar cache, with remote fallback when no local VRCX database exists.
- AVTRZIP.
- Prismic PAS.

For VRCX search, VRCNeph first looks for `VRCX.sqlite3` in common VRCX locations and in:

```text
Documents\VRCNeph\database
```

VRCX does not need to be running. If no local VRCX database exists, VRCNeph uses a remote VRCX-compatible avatar database instead.

## Local Data

VRCNeph stores user data under:

```text
Documents\VRCNeph
```

Important folders and files:

- `groups\library.json` stores the main local avatar library.
- `export\` stores exported JSON backups.
- `database\` can hold local database files.
- `groups\vrchat-session.json` stores the saved VRChat session.

Deleting the app executable does not delete your library.

## Build From Source

Requirements:

- Windows
- .NET 8 SDK

Build:

```powershell
dotnet build VRCNeph.csproj
```

The build produces a standalone executable:

```powershell
.\VRCNeph.exe
```

UI files are embedded into the executable during build, so the app does not need a loose app folder beside it.

## Updates

VRCNeph can check GitHub releases from inside the app. When an update is available, it downloads the latest release executable and restarts itself.

Manual updates also work by downloading the newest `VRCNeph.exe` from releases and replacing the old file.

## Notes

VRCNeph is a local-first companion tool. It does not modify VRChat, bypass VRChat permissions, or make private avatars public.
