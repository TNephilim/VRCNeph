(() => {
  function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function firstRecord(...values) {
    return values.map(record).find((value) => Object.keys(value).length) || {};
  }

  function text(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" || typeof value === "boolean") return String(value);
    }
    return "";
  }

  function normalizedStatus(status = "") {
    return String(status || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, "");
  }

  function normalizedPresence(value = "") {
    const textValue = String(value || "").trim().toLowerCase();
    return textValue === "online" || textValue === "active" || textValue === "offline" ? textValue : "";
  }

  function worldIdFromLocation(value = "") {
    const location = String(value || "").trim();
    if (!location.toLowerCase().startsWith("wrld_")) return "";
    const colon = location.indexOf(":");
    return colon > 0 ? location.slice(0, colon) : location;
  }

  function instanceIdFromLocation(value = "", worldId = "") {
    const location = String(value || "").trim();
    if (!location) return "";
    const prefix = worldId || worldIdFromLocation(location);
    if (!prefix || !location.toLowerCase().startsWith(`${prefix.toLowerCase()}:`)) return "";
    return location.slice(prefix.length + 1);
  }

  function normalizeFriendPresence(friend = {}, eventType = "") {
    const event = String(eventType || "").trim().toLowerCase();
    if (event === "friend-offline") return "offline";
    if (event === "friend-online" || event === "friend-location") return "online";
    if (event === "friend-active") return "active";
    const item = record(friend);
    const location = String(item.location || "").trim().toLowerCase();
    const worldId = String(item.worldId || "").trim();
    const stateValue = String(item.state || "").trim().toLowerCase();
    const presence = String(item.presence || "").trim().toLowerCase();
    const platform = String(item.platform || item.lastPlatform || "").trim().toLowerCase();
    const hasVisibleLocation = Boolean(worldId) || location.startsWith("wrld_");
    const hasPrivateOnlineLocation = location === "private" || location === "hidden";
    if (presence === "offline") return "offline";
    if (stateValue === "online" || presence === "online") return "online";
    if (hasVisibleLocation) return "online";
    if (item.isOnline && hasPrivateOnlineLocation) return "online";
    if (presence === "active") return "active";
    if (stateValue === "active") return "active";
    if (platform && platform !== "web" && location !== "offline") return "online";
    if (platform === "web") return "active";
    if (item.isOnline || stateValue === "active") return "active";
    if (location === "offline") return "offline";
    return "offline";
  }

  function friendPresenceRank(friend) {
    const presence = normalizeFriendPresence(friend);
    if (presence === "online") return 0;
    if (presence === "active") return 1;
    return 9;
  }

  function sortFriends(friends = []) {
    return [...(friends || [])].sort((a, b) => {
      const presenceDelta = friendPresenceRank(a) - friendPresenceRank(b);
      if (presenceDelta) return presenceDelta;
      return String(a?.displayName || a?.id || "").localeCompare(String(b?.displayName || b?.id || ""), undefined, { sensitivity: "base" });
    });
  }

  function userStatusClass(status, presence = "") {
    if (presence === "offline") return "offline";
    const value = normalizedStatus(status);
    if (value === "joinme") return "joinme";
    if (value === "askme") return "askme";
    if (value === "busy" || value === "donotdisturb" || value === "dnd") return "busy";
    if (value === "active" || value === "online") return "active";
    return presence === "online" ? "active" : presence || "offline";
  }

  function presenceLabel(presence = "") {
    return presence === "online" ? "Online" : presence === "active" ? "Active" : "Offline";
  }

  function userStatusLabel(status, presence = "") {
    if (presence === "offline") return "Offline";
    const value = normalizedStatus(status);
    if (value === "joinme") return "Join Me";
    if (value === "askme") return "Ask Me";
    if (value === "busy" || value === "donotdisturb" || value === "dnd") return "Do Not Disturb";
    if (value === "active") return presence === "online" ? "Online" : "Active";
    if (value === "online") return "Online";
    const raw = String(status || "").trim();
    if (raw) return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
    return presenceLabel(presence);
  }

  function userStatusDotClass(status, presence = "", limited = false) {
    const statusClass = userStatusClass(status, presence);
    const activeLimited = presence === "active" || (limited && presence !== "online" && statusClass !== "offline");
    return `presence-dot ${statusClass}${activeLimited ? " limited" : ""}`;
  }

  function friendStatusLimited(friend = {}, presence = normalizeFriendPresence(friend)) {
    if (presence === "offline" || presence === "online") return false;
    const location = String(friend.location || "").toLowerCase();
    const worldId = String(friend.worldId || "").trim();
    return !worldId || location === "private" || location === "hidden" || location === "offline";
  }

  function friendLocationLabel(friend = {}) {
    const location = String(friend.location || "").trim();
    const presence = normalizeFriendPresence(friend);
    if (!location || location.toLowerCase() === "offline") return presence === "offline" ? "Offline" : presenceLabel(presence);
    if (location.toLowerCase() === "private" || location.toLowerCase() === "hidden") return "Private world";
    if (location.toLowerCase().startsWith("wrld_")) return "In a joinable world";
    return location;
  }

  function pipelineUserObject(content = {}) {
    const item = record(content);
    return firstRecord(item.user, item.friend, item.sender, item.player, item.targetUser, item);
  }

  function pipelineWorldObject(content = {}, user = {}) {
    const item = record(content);
    const person = record(user);
    return firstRecord(item.world, item.locationWorld, person.world, person.currentWorld);
  }

  function friendEventPatch(type, content = {}, existing = {}) {
    const event = String(type || "").trim().toLowerCase();
    const item = record(content);
    const user = pipelineUserObject(item);
    const world = pipelineWorldObject(item, user);
    const directLocation = text(item.location, user.location, item.instanceLocation, user.instanceLocation);
    const location = event === "friend-offline" || event === "friend-active" ? "offline" : directLocation || existing.location || "";
    const stateValue = event === "friend-online" || event === "friend-location"
      ? "online"
      : event === "friend-active"
        ? "active"
        : event === "friend-offline"
          ? "offline"
          : text(user.state, item.state, existing.state);
    const presenceSource = event === "friend-offline"
      ? "pipeline-offline"
      : event === "friend-online" || event === "friend-location"
        ? "pipeline-online"
        : directLocation && directLocation.toLowerCase().startsWith("wrld_")
          ? "pipeline-online"
          : existing.presenceSource || "pipeline";
    const presence = normalizeFriendPresence({ ...existing, ...user, location, state: stateValue, presenceSource }, event);
    const worldId = worldIdFromLocation(location) || text(item.worldId, user.worldId, world.id) || (event === "friend-active" ? "" : existing.worldId || "");
    const id = text(item.userId, item.senderUserId, item.id, user.id, user.userId, existing.id);
    const tags = Array.isArray(user.tags) ? user.tags.join(", ") : text(user.tags, item.tags, existing.tags);
    return {
      ...existing,
      ...user,
      id,
      displayName: text(user.displayName, user.username, item.displayName, item.senderUsername, item.senderName, existing.displayName),
      status: text(user.status, item.status, existing.status),
      statusDescription: text(user.statusDescription, item.statusDescription, existing.statusDescription),
      location,
      worldId,
      instanceId: text(user.instanceId, item.instanceId, instanceIdFromLocation(location, worldId), existing.instanceId),
      state: stateValue,
      presence,
      isOnline: presence !== "offline",
      presenceSource,
      imageUrl: text(user.currentAvatarThumbnailImageUrl, user.profilePicOverrideThumbnail, user.userIcon, user.profileImageUrl, existing.imageUrl),
      currentAvatarId: text(user.currentAvatarId, user.currentAvatar?.id, existing.currentAvatarId),
      currentAvatarName: text(user.currentAvatarName, user.currentAvatar?.name, existing.currentAvatarName),
      currentAvatarImageUrl: text(user.currentAvatarImageUrl, user.currentAvatar?.imageUrl, existing.currentAvatarImageUrl),
      currentAvatarThumbnailImageUrl: text(user.currentAvatarThumbnailImageUrl, user.currentAvatar?.thumbnailImageUrl, user.currentAvatarImageUrl, existing.currentAvatarThumbnailImageUrl),
      lastPlatform: text(user.platform, user.lastPlatform, item.platform, item.lastPlatform, existing.lastPlatform),
      tags
    };
  }

  window.VRCNephShared = Object.freeze({
    friendEventPatch,
    friendLocationLabel,
    friendPresenceRank,
    friendStatusLimited,
    instanceIdFromLocation,
    normalizeFriendPresence,
    normalizedPresence,
    normalizedStatus,
    pipelineRecord: record,
    pipelineText: text,
    pipelineUserObject,
    pipelineWorldObject,
    presenceLabel,
    sortFriends,
    userStatusClass,
    userStatusDotClass,
    userStatusLabel,
    worldIdFromLocation
  });
})();
