# VRCNeph Planned Features

Planning reference only. This list was reviewed against the current source on 2026-09-05. Items left here are unresolved, unverified, or still need user/in-game testing; items with clear source implementations were removed.

## Friends, Invites, and Presence

- Investigate friend invites, including lobby-instance invites and the possibility that activity status affects delivery.
- Show a travelling friend's destination world while it is loading, where the data is available.

## Worlds

- Fix world invites reporting an invalid location for known, correctly displayed worlds. Compare the invite flow with VRCX when investigating.

## Overlay

- Ensure the overlay appears over VRChat only, not over the VRCNeph app.
- Investigate why the Overlay tab can appear empty.
- Add an optional compact avatar-grid view for overlay lists: thumbnails only, two columns, toggled from the list header, and not the default view.

## Avatars and Favorites

- Consider thousands separators for large result/count displays, including database search totals.

## Syncing and Reliability Checks

- Investigate whether closing VRChat after launching it from VRCNeph consistently produces an error.
- Measure sync speed after unfavoriting in VRChat.
- Test one-avatar unfavorite/refavorite sync in both VRChat and VRCNeph.
- Test sync behavior while using edit mode.
- Test mass refavoriting from both VRChat and VRCNeph.
- Verify whether moving a synced avatar into a local group unfavorites it in VRChat.

## Notes for Future Planning

- Keep implementation, investigation, and user verification separate for every item.
- When an item is ready to pursue, route it to the relevant feature-focused task (Overlay, Friends, Worlds, Avatars/Favorites, Syncing, Activity, or Settings) rather than treating this file as evidence of current behavior.
