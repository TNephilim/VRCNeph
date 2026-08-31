# VRCNeph

Windows desktop app for VRChat favorites, avatar and world search, friends, messages, activity, and an in-game overlay.

## Download

Download the current Windows EXE from the [latest GitHub release](https://github.com/TNephilim/VRCNeph/releases/latest). The one portable EXE installs missing shared runtimes when needed, then keeps VRCNeph's app files under `Documents\VRCNeph\App`.

## Build and release

Run `scripts\Build-VRCNeph.ps1` to rebuild the root `VRCNeph.exe` used by existing shortcuts. The app package is embedded inside that EXE.

- `VRCNeph.exe` — portable launcher.

Run `scripts\Publish-GitHubRelease.ps1` after the source commit is pushed to create or update the matching GitHub Release. It uploads only `VRCNeph.exe`.

## Source code

The app source, build project, and detailed source README are in [Source Code](./Source%20Code/).
