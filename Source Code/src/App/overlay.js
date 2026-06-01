const OVERLAY_CACHE_KEY = "vrcneph.overlay.snapshot.v1";
const OVERLAY_SETTINGS_CACHE_KEY = "vrcneph.overlay.settings.v1";
const OVERLAY_TAB_TIP_SEEN_KEY = "vrcneph.overlay.tabTipSeen.v1";
const LOCAL_WORLD_GROUPS_KEY = "vrcneph.worldGroups";
const DEFAULT_WORLD_GROUP_KEY = "local_world_favorites";
const SYNCED_GROUP_AVATAR_LIMIT = 50;

function loadOverlayJson(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key) || "") || fallback; } catch { return fallback; }
}

function saveOverlayJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
}

function loadOverlayFlag(key) {
  try { return localStorage.getItem(key) === "true"; } catch { return false; }
}

function saveOverlayFlag(key) {
  try { localStorage.setItem(key, "true"); } catch { }
}

function loadLocalWorldGroups() {
  const groups = loadOverlayJson(LOCAL_WORLD_GROUPS_KEY, []);
  return Array.isArray(groups) ? groups : [];
}

function saveLocalWorldGroups(groups) {
  saveOverlayJson(LOCAL_WORLD_GROUPS_KEY, groups);
}

const state = {
  panel: "avatars",
  groupIndex: { avatars: 0, worlds: 0, friends: 0 },
  selectedAvatarId: "",
  selectedWorldId: "",
  selectedFriendId: "",
  filters: { avatars: "", worlds: "", friends: "", recent: "" },
  groupDropdownOpen: false,
  data: {
    settings: loadOverlayJson(OVERLAY_SETTINGS_CACHE_KEY, {}),
    avatarGroups: [],
    worldGroups: [],
    friendGroups: [],
    worlds: [],
    friends: [],
    current: null,
    recent: [],
    session: null
  },
  pending: new Map()
};

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const classToken = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";

function handleNativeMessage(message) {
  const response = JSON.parse(message);
  if (response.event) {
    if (response.event === "overlayRefresh") {
      state.data = response.data || state.data;
      render();
    }
    return;
  }
  const pending = state.pending.get(response.id);
  if (!pending) return;
  state.pending.delete(response.id);
  clearTimeout(pending.timeout);
  response.ok ? pending.resolve(response.data) : pending.reject(new Error(response.error));
}
if (window.external && typeof window.external.receiveMessage === "function") window.external.receiveMessage(handleNativeMessage);
else if (window.external) window.external.receiveMessage = handleNativeMessage;

function api(command, payload = {}, timeoutMs = 120000) {
  if (!window.external || typeof window.external.sendMessage !== "function") return Promise.reject(new Error("Overlay bridge is not available."));
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { state.pending.delete(id); reject(new Error(`${command} timed out.`)); }, timeoutMs);
    state.pending.set(id, { resolve, reject, timeout });
  });
  window.external.sendMessage(JSON.stringify({ id, command, payload }));
  return promise;
}

function send(command, payload = {}) {
  if (!window.external || typeof window.external.sendMessage !== "function") return;
  const id = `fire-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.external.sendMessage(JSON.stringify({ id, command, payload }));
}

function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function mixRgb(a, b, amount) {
  return {
    r: Math.round(a.r + (b.r - a.r) * amount),
    g: Math.round(a.g + (b.g - a.g) * amount),
    b: Math.round(a.b + (b.b - a.b) * amount)
  };
}

function rgba(rgb, alpha) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function panelGroupKey(panel = state.panel) {
  if (panel === "worlds") return "worldGroups";
  if (panel === "friends") return "friendGroups";
  return "avatarGroups";
}

function panelItemKey(panel = state.panel) {
  if (panel === "worlds") return "worlds";
  if (panel === "friends") return "friends";
  return "avatars";
}

function activeGroups(panel = state.panel) {
  if (!["avatars", "worlds", "friends"].includes(panel)) return [];
  return state.data[panelGroupKey(panel)] || [];
}

function activeGroup(panel = state.panel) {
  const groups = activeGroups(panel);
  if (!groups.length) return null;
  state.groupIndex[panel] = Math.max(0, Math.min(state.groupIndex[panel] || 0, groups.length - 1));
  return groups[state.groupIndex[panel]];
}

function setPanel(panel) {
  state.panel = panel;
  state.groupDropdownOpen = false;
  document.querySelectorAll(".overlay-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.panel === panel));
  render();
}

function normalizedPanel(panel = "") {
  return panel === "session" ? "current" : panel;
}

function setBusy(button, busyText = "...") {
  if (!button) return () => {};
  const previousText = button.textContent;
  const previousDisabled = button.disabled;
  button.textContent = busyText;
  button.disabled = true;
  return (text = previousText) => {
    button.textContent = text;
    button.disabled = previousDisabled;
  };
}

function isSyncedGroupId(groupId = "") {
  return String(groupId || "").toLowerCase().startsWith("vrc_");
}

function isManagedAvatarGroup(groupId = "") {
  return ["recent_avatars", "deleted_avatars", "uploaded_avatars", "updated_avatars"].includes(String(groupId || "").toLowerCase());
}

function avatarIdEquals(a = "", b = "") {
  return Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase());
}

function canSaveToAvatarGroup(group) {
  return Boolean(group?.id && !isManagedAvatarGroup(group.id) && group.canAccess !== false);
}

function avatarGroupHasAvatar(group, avatarId = "") {
  const id = String(avatarId || "").toLowerCase();
  return Boolean(id && (
    (group?.avatarIds || []).some((value) => avatarIdEquals(value, id)) ||
    (group?.avatars || []).some((avatar) => avatarIdEquals(avatar.id, id))
  ));
}

function avatarSaveTargetStatus(group, avatarId = "") {
  if (!group?.id) return { ok: false, reason: "Choose a valid group." };
  if (isManagedAvatarGroup(group.id)) return { ok: false, reason: "Managed automatically." };
  if (group.canAccess === false) return { ok: false, reason: "VRC+ required." };
  if (avatarGroupHasAvatar(group, avatarId)) return { ok: false, reason: "Already in this group." };
  if (isSyncedGroupId(group.id) && Number(group.count ?? group.avatars?.length ?? 0) >= SYNCED_GROUP_AVATAR_LIMIT) return { ok: false, reason: `Synced groups can only contain ${SYNCED_GROUP_AVATAR_LIMIT} avatars.` };
  return { ok: true, reason: "" };
}

function itemMatchesFilter(item, keys, panel = state.panel) {
  const query = String(state.filters[panel] || "").trim().toLowerCase();
  if (!query) return true;
  return keys.some((key) => String(item?.[key] || "").toLowerCase().includes(query));
}

function copyText(text) {
  const value = String(text || "");
  if (!value) return Promise.resolve(false);
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value).then(() => true).catch(() => false);
  return Promise.resolve(false);
}

function detailRow(label, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `<dt>${escapeHtml(label)}</dt><dd title="${escapeHtml(text)}">${escapeHtml(text)}</dd>`;
}

function rowDetail(rowsHtml, actionsHtml = "") {
  return `<div class="row-detail">${rowsHtml ? `<dl>${rowsHtml}</dl>` : ""}${actionsHtml ? `<div class="detail-actions">${actionsHtml}</div>` : ""}</div>`;
}

function currentInstanceId() {
  return state.data.current?.location?.instanceId || "";
}

function chip(value, extra = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  return `<span class="chip ${escapeHtml(classToken(extra || text))}">${escapeHtml(text)}</span>`;
}

function platformChips(platforms) {
  const value = String(platforms || "").toLowerCase();
  const chips = [];
  if (value.includes("standalonewindows") || value.includes("pc") || value.includes("windows")) chips.push(chip("PC", "pc"));
  if (value.includes("android") || value.includes("quest")) chips.push(chip("Quest", "quest"));
  return chips.join("") || chip("PC", "pc");
}

function imageHtml(item, label) {
  const url = item?.imageUrl || item?.fullImageUrl || "";
  if (!url) return `<div class="thumb placeholder">${escapeHtml((label || "?").slice(0, 1).toUpperCase())}</div>`;
  return `<div class="thumb"><img src="${escapeHtml(url)}" alt="" onerror="this.parentElement.className='thumb placeholder';this.parentElement.textContent='${escapeHtml((label || "?").slice(0, 1).toUpperCase())}'"></div>`;
}

function avatarRow(avatar, index) {
  const title = avatar.name || avatar.id || "Unknown avatar";
  const selected = state.selectedAvatarId ? avatar.id === state.selectedAvatarId : index === 0;
  const status = avatar.releaseStatus || "Public";
  const detail = selected ? rowDetail(
    `${detailRow("Avatar ID", avatar.id)}${detailRow("Author", avatar.authorName)}${detailRow("Status", status)}${detailRow("Platforms", avatar.platforms)}`,
    `<button type="button" data-copy-text="${escapeHtml(avatar.id || "")}">Copy ID</button>
     <button type="button" data-equip-avatar="${escapeHtml(avatar.id || "")}">Equip</button>
     <button class="danger" type="button" data-unfavorite-avatar="${escapeHtml(avatar.id || "")}" data-local-avatar="${escapeHtml(avatar.localId || "")}">Unfavorite</button>`
  ) : "";
  return `<article class="overlay-row ${selected ? "selected expanded" : ""}" data-avatar-id="${escapeHtml(avatar.id || "")}" data-avatar-local-id="${escapeHtml(avatar.localId || "")}">
    ${imageHtml(avatar, title)}
    <div class="row-main">
      <div class="row-title">${escapeHtml(title)}</div>
      <div class="row-subtitle">${escapeHtml(avatar.authorName || "Unknown author")}</div>
      <div class="chips">${platformChips(avatar.platforms)}${chip(status, status)}${chip("Ready", "ready")}</div>
    </div>
    <div class="row-actions">
      <button class="row-action" type="button" data-equip-avatar="${escapeHtml(avatar.id || "")}">Equip</button>
      <button class="row-action danger" type="button" data-unfavorite-avatar="${escapeHtml(avatar.id || "")}" data-local-avatar="${escapeHtml(avatar.localId || "")}">Unfav</button>
    </div>
    ${detail}
  </article>`;
}

function worldRow(world) {
  const title = world.name || world.id || "Unknown world";
  const occupancy = Number(world.capacity) > 0 ? `${Number(world.occupants) || 0}/${Number(world.capacity)}` : `${Number(world.occupants) || 0} online`;
  const tags = String(world.favoriteTags || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 1);
  const selected = state.selectedWorldId === world.id;
  const detail = selected ? rowDetail(
    `${detailRow("World ID", world.id)}${detailRow("Author", world.authorName)}${detailRow("Description", world.description)}${detailRow("Visits", world.visits)}${detailRow("Favorites", world.favorites)}`,
    `<button type="button" data-open-world="${escapeHtml(world.id || "")}">Open</button>
     <button type="button" data-save-world="${escapeHtml(world.id || "")}">Save</button>
     <button type="button" data-copy-text="${escapeHtml(world.id || "")}">Copy ID</button>`
  ) : "";
  return `<article class="overlay-row ${selected ? "selected expanded" : ""}" data-world-id="${escapeHtml(world.id || "")}">
    ${imageHtml(world, title)}
    <div class="row-main">
      <div class="row-title">${escapeHtml(title)}</div>
      <div class="row-subtitle">${escapeHtml(world.authorName ? `by ${world.authorName}` : "Favorite world")}</div>
      <div class="chips">${chip(occupancy, "location")}${chip(world.releaseStatus || "public", world.releaseStatus || "public")}${tags.map((tag) => chip(tag.replace(/^worlds/i, ""), "ready")).join("")}</div>
    </div>
    <button class="row-action" type="button" data-open-world="${escapeHtml(world.id || "")}">Open</button>
    ${detail}
  </article>`;
}

function currentCard(kind, item, fallbackTitle, fallbackSubtitle, chipsHtml = "") {
  const title = item?.name || fallbackTitle;
  const subtitle = item?.authorName ? `by ${item.authorName}` : fallbackSubtitle;
  const id = item?.id || "";
  const actions = kind === "avatar"
    ? `<div class="detail-actions"><button type="button" data-save-current-avatar>Save</button>${id ? `<button type="button" data-equip-avatar="${escapeHtml(id)}">Equip</button><button type="button" data-copy-text="${escapeHtml(id)}">Copy ID</button>` : ""}</div>`
    : `<div class="detail-actions"><button type="button" data-save-current-world>Save</button>${id ? `<button type="button" data-open-world="${escapeHtml(id)}">Open</button><button type="button" data-copy-text="${escapeHtml(id)}">Copy ID</button>` : ""}</div>`;
  return `<article class="current-card ${escapeHtml(kind)}">
    ${imageHtml(item || {}, title)}
    <div class="current-card-body">
      <div class="current-card-title">${escapeHtml(title)}</div>
      <div class="current-card-subtitle">${escapeHtml(subtitle)}</div>
      <div class="chips">${chipsHtml}</div>
      ${actions}
    </div>
  </article>`;
}

function friendImage(friend) {
  const presence = friendPresence(friend);
  return `<div class="friend-thumb">${imageHtml({ imageUrl: friend.imageUrl || friend.currentAvatarThumbnailImageUrl }, friend.displayName)}<span class="${escapeHtml(userStatusDotClass(friend.status, presence, friendStatusLimited(friend, presence)))}" aria-hidden="true"></span></div>`;
}

function friendLocation(friend) {
  const location = String(friend.location || "").trim();
  if (!location || location === "offline") return "Offline";
  if (location === "private" || location === "hidden") return "Private world";
  if (location.startsWith("wrld_")) return "In a joinable world";
  return location;
}

function friendPresence(friend) {
  const location = String(friend.location || "").trim().toLowerCase();
  const worldId = String(friend.worldId || "").trim();
  const stateValue = String(friend.state || "").trim().toLowerCase();
  const presence = String(friend.presence || "").trim().toLowerCase();
  const platform = String(friend.platform || friend.lastPlatform || "").trim().toLowerCase();
  const hasVisibleLocation = Boolean(worldId) || location.startsWith("wrld_");
  const hasPrivateOnlineLocation = location === "private" || location === "hidden";
  if (presence === "offline") return "offline";
  if (stateValue === "online" || presence === "online") return "online";
  if (hasVisibleLocation) return "online";
  if (friend.isOnline && hasPrivateOnlineLocation) return "online";
  if (presence === "active") return "active";
  if (stateValue === "active") return "active";
  if (platform && platform !== "web" && location !== "offline") return "online";
  if (platform === "web") return "active";
  if (friend.isOnline || stateValue === "active") return "active";
  if (location === "offline") return "offline";
  return "offline";
}

function normalizedVrchatStatus(status = "") {
  const value = String(status || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, "");
  if (value === "joinme") return "joinme";
  if (value === "askme") return "askme";
  if (value === "busy" || value === "donotdisturb" || value === "dnd") return "busy";
  if (value === "online") return "online";
  if (value === "active") return "active";
  if (value === "offline") return "offline";
  return value;
}

function userStatusClass(status, presence = "") {
  if (presence === "offline") return "offline";
  const value = normalizedVrchatStatus(status);
  if (value === "joinme") return "joinme";
  if (value === "askme") return "askme";
  if (value === "busy") return "busy";
  if (value === "active" || value === "online") return "active";
  return presence === "online" ? "active" : presence || "offline";
}

function userStatusLabel(status, presence = "") {
  if (presence === "offline") return "Offline";
  const value = normalizedVrchatStatus(status);
  if (value === "joinme") return "Join Me";
  if (value === "askme") return "Ask Me";
  if (value === "busy") return "Do Not Disturb";
  if (value === "active") return presence === "online" ? "Online" : "Active";
  const raw = String(status || "").trim();
  if (raw) return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return presence === "online" ? "Online" : presence === "active" ? "Active" : "Offline";
}

function userStatusDotClass(status, presence = "", limited = false) {
  const statusClass = userStatusClass(status, presence);
  const activeLimited = presence === "active" || (limited && presence !== "online" && statusClass !== "offline");
  return `presence-dot ${statusClass}${activeLimited ? " limited" : ""}`;
}

function friendStatusLimited(friend, presence = friendPresence(friend)) {
  if (presence === "offline" || presence === "online") return false;
  const location = String(friend?.location || "").toLowerCase();
  const worldId = String(friend?.worldId || "").trim();
  return !worldId || location === "private" || location === "hidden" || location === "offline";
}

function friendPresenceRank(friend) {
  const presence = friendPresence(friend);
  if (presence === "joinme") return 0;
  if (presence === "online") return 1;
  if (presence === "active") return 2;
  if (presence === "askme") return 3;
  if (presence === "busy") return 4;
  return 9;
}

function trustRankClass(friend) {
  const tags = String(friend.tags || "").toLowerCase().split(",").map((tag) => tag.trim()).filter(Boolean);
  if (tags.some((tag) => tag.includes("system_trust_troll"))) return "nuisance";
  if (tags.some((tag) => tag.includes("system_trust_legend") || tag.includes("system_trust_veteran"))) return "trusted";
  if (tags.some((tag) => tag.includes("system_trust_trusted"))) return "known";
  if (tags.some((tag) => tag.includes("system_trust_known"))) return "user";
  if (tags.some((tag) => tag.includes("system_trust_intermediate") || tag.includes("system_trust_basic"))) return "new";
  return "visitor";
}

function sortFriends(friends) {
  return [...friends].sort((a, b) => {
    const presenceDelta = friendPresenceRank(a) - friendPresenceRank(b);
    if (presenceDelta) return presenceDelta;
    return String(a.displayName || a.id || "").localeCompare(String(b.displayName || b.id || ""), undefined, { sensitivity: "base" });
  });
}

function friendsSectionHtml(label, friends) {
  if (!friends.length) return "";
  return `<section class="friend-section"><h3>${escapeHtml(label)}</h3>${friends.map(friendRow).join("")}</section>`;
}

function friendsGroupedHtml(friends) {
  const online = friends.filter((friend) => friendPresence(friend) === "online" || friendPresence(friend) === "joinme" || friendPresence(friend) === "askme" || friendPresence(friend) === "busy");
  const active = friends.filter((friend) => friendPresence(friend) === "active");
  const offline = friends.filter((friend) => friendPresence(friend) === "offline");
  return [
    friendsSectionHtml("Online", online),
    friendsSectionHtml("Active", active),
    friendsSectionHtml("Offline", offline)
  ].join("");
}

function friendRow(friend) {
  const title = friend.displayName || friend.id || "Unknown friend";
  const presence = friendPresence(friend);
  const platform = friend.lastPlatform || "";
  const statusClass = userStatusClass(friend.status, presence);
  const statusLabel = userStatusLabel(friend.status, presence);
  const selected = state.selectedFriendId === friend.id;
  const detail = selected ? rowDetail(
    `${detailRow("Status", [friend.status, friend.statusDescription].filter(Boolean).join(" - "))}${detailRow("Location", friendLocation(friend))}${detailRow("World ID", friend.worldId)}${detailRow("Current Avatar", friend.currentAvatarName)}${detailRow("User ID", friend.id)}`,
    `<button type="button" data-friend-action="invite" data-friend-id="${escapeHtml(friend.id || "")}">Invite</button>
     <button type="button" data-friend-action="request" data-friend-id="${escapeHtml(friend.id || "")}">Request</button>
     <button type="button" data-friend-action="message" data-friend-id="${escapeHtml(friend.id || "")}">Message</button>
     <button type="button" data-copy-text="${escapeHtml(friend.id || "")}">Copy ID</button>`
  ) : "";
  return `<article class="overlay-row friend-row ${selected ? "selected expanded" : ""}" data-friend-id="${escapeHtml(friend.id || "")}">
    ${friendImage(friend)}
    <div class="row-main">
      <div class="row-title friend-name-rank ${escapeHtml(trustRankClass(friend))}">${escapeHtml(title)}</div>
      <div class="row-subtitle">${escapeHtml(friend.statusDescription || friendLocation(friend))}</div>
      <div class="chips">${chip(statusLabel, statusClass)}${platform ? chip(platform, platform) : ""}${friend.location && friend.location.startsWith("wrld_") ? chip("Joinable", "joinable") : ""}</div>
    </div>
    ${detail}
  </article>`;
}

function placeholderRow(title, subtitle, chipsHtml, initial = "") {
  return `<article class="overlay-row">
    <div class="thumb placeholder">${escapeHtml(initial || title.slice(0, 1))}</div>
    <div class="row-main">
      <div class="row-title">${escapeHtml(title)}</div>
      <div class="row-subtitle">${escapeHtml(subtitle)}</div>
      <div class="chips">${chipsHtml}</div>
    </div>
    <button class="row-action" type="button" disabled>Open</button>
  </article>`;
}

function renderGroupDropdown() {
  const dropdown = $("groupDropdown");
  const groups = activeGroups();
  const itemKey = panelItemKey();
  dropdown.hidden = !["avatars", "worlds", "friends"].includes(state.panel) || !state.groupDropdownOpen || groups.length <= 1;
  if (dropdown.hidden) {
    dropdown.innerHTML = "";
    return;
  }
  dropdown.innerHTML = groups.map((group, index) => `<button class="${index === (state.groupIndex[state.panel] || 0) ? "active" : ""}" type="button" data-group-index="${index}">
    <strong>${escapeHtml(group.name || "Unnamed group")}</strong>
    <span>${Number(group.count ?? (group[itemKey] || []).length)} ${itemKey}</span>
  </button>`).join("");
}

function renderAvatars() {
  $("panelHead").classList.remove("full");
  const group = activeGroup();
  $("prevGroupBtn").hidden = false;
  $("nextGroupBtn").hidden = false;
  $("groupSelectBtn").disabled = false;
  if (!group) {
    $("panelTitle").textContent = "Avatars";
    $("panelCount").textContent = "No groups";
    renderGroupDropdown();
    $("content").innerHTML = emptyHtml("No avatar groups", "Sync or create avatar groups in VRCNeph, then refresh this overlay.");
    return;
  }
  const avatars = group.avatars || [];
  const visibleAvatars = avatars.filter((avatar) => itemMatchesFilter(avatar, ["name", "authorName", "id"], "avatars"));
  $("panelTitle").textContent = group.name || "Avatars";
  $("panelCount").textContent = `${visibleAvatars.length}/${Number(group.count ?? avatars.length)} avatars`;
  $("prevGroupBtn").disabled = (state.groupIndex.avatars || 0) <= 0;
  $("nextGroupBtn").disabled = (state.groupIndex.avatars || 0) >= (state.data.avatarGroups || []).length - 1;
  renderGroupDropdown();
  $("content").innerHTML = visibleAvatars.length
    ? visibleAvatars.map(avatarRow).join("")
    : emptyHtml("No avatars in this group", "Pick another group or add avatars in the main app.");
}

function renderWorlds() {
  $("panelHead").classList.remove("full");
  const group = activeGroup("worlds");
  $("prevGroupBtn").hidden = false;
  $("nextGroupBtn").hidden = false;
  $("groupSelectBtn").disabled = false;
  const worlds = group?.worlds || [];
  const visibleWorlds = worlds.filter((world) => itemMatchesFilter(world, ["name", "authorName", "description", "id"], "worlds"));
  $("panelTitle").textContent = group?.name || "Favorite Worlds";
  $("panelCount").textContent = `${visibleWorlds.length}/${Number(group?.count ?? worlds.length)} worlds`;
  $("prevGroupBtn").disabled = (state.groupIndex.worlds || 0) <= 0;
  $("nextGroupBtn").disabled = (state.groupIndex.worlds || 0) >= (state.data.worldGroups || []).length - 1;
  renderGroupDropdown();
  $("content").innerHTML = visibleWorlds.length
    ? visibleWorlds.map(worldRow).join("")
    : emptyHtml("No favorite worlds loaded", "Refresh the overlay after logging in, or favorite worlds in VRChat first.");
}

function renderFriends() {
  $("panelHead").classList.remove("full");
  const group = activeGroup("friends");
  $("prevGroupBtn").hidden = false;
  $("nextGroupBtn").hidden = false;
  $("groupSelectBtn").disabled = false;
  const friends = sortFriends((group?.friends || []).filter((friend) => itemMatchesFilter(friend, ["displayName", "statusDescription", "status", "location", "currentAvatarName", "id"], "friends")));
  $("panelTitle").textContent = group?.name || "Friends";
  $("panelCount").textContent = `${friends.length}/${Number(group?.count ?? group?.friends?.length ?? friends.length)} friends`;
  $("prevGroupBtn").disabled = (state.groupIndex.friends || 0) <= 0;
  $("nextGroupBtn").disabled = (state.groupIndex.friends || 0) >= (state.data.friendGroups || []).length - 1;
  renderGroupDropdown();
  $("content").innerHTML = friends.length
    ? friendsGroupedHtml(friends)
    : emptyHtml("No friends loaded", "Refresh the overlay after logging in, or check the main app connection.");
}

function renderCurrent() {
  state.groupDropdownOpen = false;
  $("panelHead").classList.add("full");
  $("prevGroupBtn").hidden = true;
  $("nextGroupBtn").hidden = true;
  $("groupSelectBtn").disabled = true;
  $("panelTitle").textContent = "Current";
  $("panelCount").textContent = "Avatar and world";
  renderGroupDropdown();
  const current = state.data.current || {};
  const avatar = current.avatar || null;
  const world = current.world || null;
  const location = current.location || state.data.session || {};
  const avatarCard = avatar
    ? currentCard("avatar", avatar, "Current avatar", avatar.authorName || "Avatar", `${platformChips(avatar.platforms)}${chip(avatar.releaseStatus || "public", avatar.releaseStatus || "public")}`)
    : emptyHtml("No current avatar", "Log in to VRChat or equip an avatar first.");
  const worldFallback = {
    id: location.worldId || "",
    name: location.room || location.worldId || "Current world",
    imageUrl: ""
  };
  const worldItem = world || (location.found ? worldFallback : null);
  const worldCard = worldItem
    ? currentCard("world", worldItem, "Current world", worldItem.authorName ? `by ${worldItem.authorName}` : (location.location || "Current session"), `${chip(location.worldId || worldItem.id || "VRChat", "location")}${worldItem.capacity ? chip(`${Number(worldItem.occupants) || 0}/${Number(worldItem.capacity)}`, "public") : ""}`)
    : emptyHtml("No current world", location.message || "Open VRChat and join a world first.");
  $("content").innerHTML = `${avatarCard}${worldCard}`;
}

function renderRecent() {
  state.groupDropdownOpen = false;
  $("panelHead").classList.add("full");
  $("prevGroupBtn").hidden = true;
  $("nextGroupBtn").hidden = true;
  $("groupSelectBtn").disabled = true;
  $("panelTitle").textContent = "Recent";
  $("panelCount").textContent = "History";
  renderGroupDropdown();
  const items = state.data.recent || [];
  const visibleItems = items.filter((item) => itemMatchesFilter(item, ["title", "subtitle", "id"], "recent"));
  $("content").innerHTML = visibleItems.length
    ? visibleItems.map((item) => `<article class="overlay-row">${imageHtml(item, item.title)}<div class="row-main"><div class="row-title">${escapeHtml(item.title)}</div><div class="row-subtitle">${escapeHtml(item.subtitle)}</div><div class="chips">${chip("Avatar", "pc")}${chip("Recent", "ready")}</div></div><button class="row-action" type="button" disabled>Open</button></article>`).join("")
    : emptyHtml("No recent items yet", "Recent avatars, worlds, and players will appear here as the overlay integration grows.");
}

function emptyHtml(title, message) {
  return `<section class="empty-panel"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></section>`;
}

function render() {
  applySnapshotSettings();
  const searchable = ["avatars", "worlds", "friends", "recent"].includes(state.panel);
  $("overlayActions").hidden = !searchable && !["avatars", "worlds"].includes(state.panel);
  $("overlaySearchInput").hidden = !searchable;
  $("overlaySearchInput").value = state.filters[state.panel] || "";
  $("overlaySearchInput").placeholder = state.panel === "friends" ? "Search friends" : state.panel === "worlds" ? "Search worlds" : state.panel === "recent" ? "Search recent" : "Search avatars";
  $("saveCurrentAvatarOverlayBtn").hidden = state.panel !== "avatars";
  $("saveCurrentWorldOverlayBtn").hidden = state.panel !== "worlds";
  if (state.panel === "avatars") renderAvatars();
  else if (state.panel === "worlds") renderWorlds();
  else if (state.panel === "friends") renderFriends();
  else if (state.panel === "current") renderCurrent();
  else renderRecent();
}

async function refresh() {
  try {
    state.data = await api("overlaySnapshot");
    saveOverlayJson(OVERLAY_CACHE_KEY, state.data);
    if (state.data?.settings) saveOverlayJson(OVERLAY_SETTINGS_CACHE_KEY, state.data.settings);
    render();
  } catch (error) {
    $("content").innerHTML = emptyHtml("Overlay failed to load", error.message);
  }
}

async function refreshSettingsFast() {
  try {
    const settings = await api("settingsGet", {}, 10000);
    state.data = { ...state.data, settings };
    saveOverlayJson(OVERLAY_SETTINGS_CACHE_KEY, settings);
    render();
  } catch { }
}

function hydrateCachedSnapshot() {
  const cached = loadOverlayJson(OVERLAY_CACHE_KEY, null);
  if (!cached || typeof cached !== "object") return;
  state.data = {
    ...state.data,
    ...cached,
    settings: {
      ...(state.data.settings || {}),
      ...(cached.settings || {})
    }
  };
}

function applySnapshotSettings() {
  const settings = state.data.settings || {};
  const opacity = Math.min(100, Math.max(45, Number(settings.overlayOpacity) || 86)) / 100;
  const scale = Math.min(135, Math.max(80, Number(settings.overlayScale) || 100)) / 100;
  const theme = hexToRgb(settings.themeColor) || hexToRgb("#303735");
  const panel = hexToRgb(settings.panelColorSynced === false ? settings.panelColor : settings.themeColor) || theme;
  const appBase = { r: 18, g: 22, b: 20 };
  const appPanel = mixRgb(appBase, panel, 0.16);
  const appPanel2 = mixRgb(appBase, panel, 0.28);
  const line = mixRgb(appBase, panel, 0.48);
  const muted = mixRgb({ r: 255, g: 255, b: 255 }, panel, 0.34);
  document.documentElement.style.setProperty("--overlay-opacity", String(opacity));
  document.documentElement.style.setProperty("--overlay-scale", String(scale));
  document.documentElement.style.setProperty("--overlay-accent", settings.themeColor || "#303735");
  document.documentElement.style.setProperty("--overlay-bg", rgba(appPanel, opacity));
  document.documentElement.style.setProperty("--overlay-bg-strong", rgba(appPanel2, opacity));
  document.documentElement.style.setProperty("--overlay-bg-soft", rgba(appPanel, opacity * 0.72));
  document.documentElement.style.setProperty("--overlay-line", rgba(line, 0.82));
  document.documentElement.style.setProperty("--overlay-line-strong", rgba(theme, 0.72));
  document.documentElement.style.setProperty("--overlay-muted", rgba(muted, 1));
  document.documentElement.style.setProperty("--overlay-accent-soft", rgba(theme, opacity * 0.32));
  document.documentElement.style.setProperty("--overlay-accent-glow", rgba(theme, opacity * 0.18));
  if (!applySnapshotSettings.didChooseDefault && settings.overlayDefaultPanel) {
    applySnapshotSettings.didChooseDefault = true;
    const panel = normalizedPanel(settings.overlayDefaultPanel);
    state.panel = ["avatars", "worlds", "friends", "current", "recent"].includes(panel) ? panel : "avatars";
    document.querySelectorAll(".overlay-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.panel === state.panel));
  }
}

function installWindowControls() {
  const dragHandle = $("dragHandle");
  const resizeHandle = $("resizeHandle");
  let drag = null;
  let resize = null;
  let lastMove = 0;

  dragHandle.addEventListener("pointerdown", (event) => {
    drag = { x: event.screenX, y: event.screenY };
    dragHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  dragHandle.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const now = performance.now();
    if (now - lastMove < 16) return;
    const dx = Math.round(event.screenX - drag.x);
    const dy = Math.round(event.screenY - drag.y);
    if (dx || dy) {
      send("overlayMoveWindow", { dx, dy });
      drag = { x: event.screenX, y: event.screenY };
      lastMove = now;
    }
  });
  dragHandle.addEventListener("pointerup", () => { drag = null; });
  dragHandle.addEventListener("pointercancel", () => { drag = null; });

  resizeHandle.addEventListener("pointerdown", (event) => {
    resize = { x: event.screenX, y: event.screenY, width: window.innerWidth, height: window.innerHeight };
    resizeHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  resizeHandle.addEventListener("pointermove", (event) => {
    if (!resize) return;
    const now = performance.now();
    if (now - lastMove < 16) return;
    const width = Math.round(resize.width + event.screenX - resize.x);
    const height = Math.round(resize.height + event.screenY - resize.y);
    send("overlayResizeWindow", { width, height });
    lastMove = now;
  });
  resizeHandle.addEventListener("pointerup", () => { resize = null; });
  resizeHandle.addEventListener("pointercancel", () => { resize = null; });
}

function confirmOverlay({ title = "Confirm", message = "", confirmLabel = "Confirm", danger = true } = {}) {
  const dialog = $("confirmDialog");
  $("confirmTitle").textContent = title;
  $("confirmMessage").textContent = message;
  $("confirmOkBtn").textContent = confirmLabel;
  $("confirmOkBtn").classList.toggle("danger", danger);
  return new Promise((resolve) => {
    const cleanup = (value) => {
      $("confirmOkBtn").removeEventListener("click", onOk);
      $("confirmCancelBtn").removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onCancel);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    $("confirmOkBtn").addEventListener("click", onOk, { once: true });
    $("confirmCancelBtn").addEventListener("click", onCancel, { once: true });
    dialog.addEventListener("cancel", onCancel, { once: true });
    dialog.addEventListener("close", onCancel, { once: true });
    dialog.showModal();
  });
}

function chooseOverlay({ title = "Choose", message = "", label = "Option", options = [], confirmLabel = "OK" } = {}) {
  if (!options.length) return Promise.resolve(null);
  const dialog = $("choiceDialog");
  $("choiceTitle").textContent = title;
  $("choiceMessage").textContent = message;
  $("choiceLabel").textContent = label;
  $("choiceOkBtn").textContent = confirmLabel;
  $("choiceInput").innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}" ${option.disabled ? "disabled" : ""}>${escapeHtml(option.label)}</option>`).join("");
  const firstEnabled = options.find((option) => !option.disabled);
  $("choiceInput").value = firstEnabled?.value || "";
  $("choiceOkBtn").disabled = !firstEnabled;
  return new Promise((resolve) => {
    const cleanup = (value) => {
      $("choiceOkBtn").removeEventListener("click", onOk);
      $("choiceCancelBtn").removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onCancel);
      $("choiceOkBtn").disabled = false;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onOk = () => cleanup($("choiceInput").value || null);
    const onCancel = () => cleanup(null);
    $("choiceOkBtn").addEventListener("click", onOk, { once: true });
    $("choiceCancelBtn").addEventListener("click", onCancel, { once: true });
    dialog.addEventListener("cancel", onCancel, { once: true });
    dialog.addEventListener("close", onCancel, { once: true });
    dialog.showModal();
  });
}

function textOverlay({ title = "Message", message = "", confirmLabel = "Send", value = "" } = {}) {
  const dialog = $("textDialog");
  $("textTitle").textContent = title;
  $("textMessage").textContent = message;
  $("textOkBtn").textContent = confirmLabel;
  $("textInput").value = value;
  return new Promise((resolve) => {
    const cleanup = (result) => {
      $("textOkBtn").removeEventListener("click", onOk);
      $("textCancelBtn").removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onCancel);
      if (dialog.open) dialog.close();
      resolve(result);
    };
    const onOk = () => cleanup($("textInput").value.trim());
    const onCancel = () => cleanup("");
    $("textOkBtn").addEventListener("click", onOk, { once: true });
    $("textCancelBtn").addEventListener("click", onCancel, { once: true });
    dialog.addEventListener("cancel", onCancel, { once: true });
    dialog.addEventListener("close", onCancel, { once: true });
    dialog.showModal();
    $("textInput").focus();
  });
}

function saveTargetGroups(avatarId = "") {
  return (state.data.avatarGroups || []).filter(canSaveToAvatarGroup).map((group) => {
    const status = avatarSaveTargetStatus(group, avatarId);
    return { ...group, status };
  });
}

function ensureDefaultLocalWorldGroup(localGroups) {
  let defaultLocal = localGroups.find((group) => group.key === DEFAULT_WORLD_GROUP_KEY);
  if (!defaultLocal) {
    defaultLocal = { key: DEFAULT_WORLD_GROUP_KEY, label: "Favorites", description: "Default local world favorites.", worlds: [] };
    localGroups.unshift(defaultLocal);
    saveLocalWorldGroups(localGroups);
  }
  return defaultLocal;
}

function worldGroupHasWorld(group, worldId = "") {
  const id = String(worldId || "").toLowerCase();
  return Boolean(id && (group?.worlds || []).some((world) => String(world.id || "").toLowerCase() === id));
}

function worldSaveTargetStatus(group, worldId = "") {
  if (!group) return { ok: false, reason: "Choose a valid world group." };
  if (group.type === "synced" && group.canAccess === false) return { ok: false, reason: "VRC+ required." };
  if (worldGroupHasWorld(group, worldId)) return { ok: false, reason: "Already in this group." };
  if (group.type === "synced" && Number(group.count ?? group.worlds?.length ?? 0) >= SYNCED_GROUP_AVATAR_LIMIT) return { ok: false, reason: `Synced groups can only contain ${SYNCED_GROUP_AVATAR_LIMIT} worlds.` };
  return { ok: true, reason: "" };
}

function saveTargetWorldGroups(worldId = "") {
  const syncedGroups = (state.data.worldGroups || [])
    .filter((group) => group?.id && group.id !== "all" && group.canAccess !== false)
    .map((group) => ({
      type: "synced",
      key: group.id,
      tag: group.id,
      label: group.name || group.id,
      count: Number(group.count ?? group.worlds?.length ?? 0),
      canAccess: group.canAccess !== false,
      worlds: group.worlds || []
    }));
  const localGroups = loadLocalWorldGroups();
  ensureDefaultLocalWorldGroup(localGroups);
  const localTargets = localGroups.map((group) => ({
    type: "local",
    key: group.key,
    label: group.label || "Favorites",
    count: Number(group.worlds?.length || 0),
    worlds: group.worlds || []
  }));
  return [...syncedGroups, ...localTargets].map((group) => ({ ...group, status: worldSaveTargetStatus(group, worldId) }));
}

async function saveWorldById(worldId, world = null, button = null) {
  const restore = setBusy(button, "Saving...");
  try {
    if (!worldId) throw new Error("World not found.");
    const worldItem = world || { id: worldId, name: worldId };
    const options = saveTargetWorldGroups(worldId);
    const targetChoice = await chooseOverlay({
      title: "Save World",
      message: `Choose a group for "${worldItem.name || worldId}".`,
      label: "Group",
      confirmLabel: "Save",
      options: options.map((group, index) => ({
        value: String(index),
        disabled: !group.status.ok,
        label: `${group.label || "World Group"} (${Number(group.count || 0)} worlds)${group.status.ok ? "" : ` - ${group.status.reason}`}`
      }))
    });
    if (targetChoice === null) {
      restore(button?.id === "saveCurrentWorldOverlayBtn" ? "Save Current World" : "Save");
      return;
    }
    const target = options[Number(targetChoice)];
    if (!target) throw new Error("No world groups are available.");
    if (!target.status.ok) throw new Error(target.status.reason);
    if (target.type === "synced") {
      await api("vrchatFavoriteWorldAdd", { id: worldId, tag: target.tag }, 45000);
    } else {
      const localGroups = loadLocalWorldGroups();
      const defaultLocal = ensureDefaultLocalWorldGroup(localGroups);
      const local = localGroups.find((group) => group.key === target.key) || defaultLocal;
      local.worlds = local.worlds || [];
      if (local.worlds.some((item) => String(item.id || "").toLowerCase() === String(worldId).toLowerCase())) throw new Error("This world is already in that group.");
      local.worlds.push(worldItem);
      saveLocalWorldGroups(localGroups);
    }
    await refresh();
    restore(button ? "Saved" : undefined);
    if (button) setTimeout(() => { if (button.isConnected) button.textContent = button.id === "saveCurrentWorldOverlayBtn" ? "Save Current World" : "Save"; }, 900);
  } catch (error) {
    await confirmOverlay({ title: "Save World", message: error.message, confirmLabel: "OK", danger: false });
    restore(button?.id === "saveCurrentWorldOverlayBtn" ? "Save Current World" : "Save");
  }
}

async function saveCurrentWorldFromOverlay() {
  const button = $("saveCurrentWorldOverlayBtn");
  try {
    const restore = setBusy(button, "Loading...");
    const current = await api("vrchatCurrentLocation", {}, 45000);
    restore("Save Current World");
    const worldId = current.worldId || current.world?.id || "";
    if (!worldId) throw new Error("You are not in a saveable world.");
    await saveWorldById(worldId, current.world || { id: worldId, name: worldId }, button);
  } catch (error) {
    await confirmOverlay({ title: "Save Current World", message: error.message, confirmLabel: "OK", danger: false });
    button.textContent = "Save Current World";
    button.disabled = false;
  }
}

async function openSaveCurrentAvatarDialog() {
  const button = $("saveCurrentAvatarOverlayBtn");
  const restore = setBusy(button, "Loading...");
  let avatar = null;
  try {
    avatar = await api("vrchatCurrentAvatar", {}, 45000);
  } catch (error) {
    restore();
    await confirmOverlay({ title: "Current Avatar", message: error.message, confirmLabel: "OK", danger: false });
    return;
  }
  restore();
  const avatarId = avatar?.avatarId || avatar?.id || "";
  const groups = saveTargetGroups(avatarId);
  if (!groups.length) {
    await confirmOverlay({ title: "No Groups", message: "Create or sync an avatar group first.", confirmLabel: "OK", danger: false });
    return;
  }
  $("saveCurrentMessage").textContent = `Choose a group for "${avatar?.name || avatarId || "your current avatar"}".`;
  $("saveCurrentGroupInput").innerHTML = groups.map((group) => `<option value="${escapeHtml(group.id)}" ${group.status.ok ? "" : "disabled"}>${escapeHtml(group.name || "Unnamed group")} (${Number(group.count || 0)} avatars)${group.status.ok ? "" : ` - ${escapeHtml(group.status.reason)}`}</option>`).join("");
  const firstValid = groups.find((group) => group.status.ok);
  $("saveCurrentGroupInput").value = firstValid?.id || "";
  $("saveCurrentConfirmBtn").disabled = !firstValid;
  const dialog = $("saveCurrentDialog");
  dialog.showModal();
  const save = async () => {
    const groupId = $("saveCurrentGroupInput").value;
    if (!groupId || !avatarId) return;
    const group = groups.find((item) => item.id === groupId);
    const status = avatarSaveTargetStatus(group, avatarId);
    if (!status.ok) {
      $("saveCurrentMessage").textContent = status.reason;
      return;
    }
    const restoreSave = setBusy($("saveCurrentConfirmBtn"), "Saving...");
    try {
      await api("vrchatSaveCurrentAvatar", { groupId }, 45000);
      if (isSyncedGroupId(groupId)) await api("vrchatFavoriteAdd", { avatarId, groupId }, 60000);
      dialog.close();
      await refresh();
    } catch (error) {
      $("saveCurrentMessage").textContent = error.message;
    } finally {
      restoreSave();
    }
  };
  const cancel = () => dialog.close();
  $("saveCurrentConfirmBtn").onclick = save;
  $("saveCurrentCancelBtn").onclick = cancel;
}

async function unfavoriteAvatarFromOverlay(button) {
  const group = activeGroup("avatars");
  const avatarId = button.dataset.unfavoriteAvatar || "";
  const localId = button.dataset.localAvatar || "";
  if (!avatarId || !localId || !group?.id) return;
  const ok = await confirmOverlay({
    title: "Unfavorite Avatar",
    message: "Remove this avatar from this favorite group?",
    confirmLabel: "Unfavorite",
    danger: true
  });
  if (!ok) return;
  const restore = setBusy(button, "...");
  try {
    if (isSyncedGroupId(group.id)) await api("vrchatFavoriteRemove", { avatarId, groupId: group.id }, 60000);
    await api("deleteAvatar", { id: localId }, 45000);
    state.selectedAvatarId = "";
    await refresh();
  } catch (error) {
    button.title = error.message;
  } finally {
    restore("Unfav");
  }
}

async function openWorldFromOverlay(button) {
  const worldId = button.dataset.openWorld || "";
  if (!worldId) return;
  const type = await chooseOverlay({
    title: "Open World",
    message: "Create an instance and send yourself an invite.",
    label: "Instance type",
    confirmLabel: "Open",
    options: [
      { value: "private", label: "Invite" },
      { value: "invite-plus", label: "Invite+" },
      { value: "friends", label: "Friends" },
      { value: "hidden", label: "Friends+" },
      { value: "public", label: "Public" }
    ]
  });
  if (!type) return;
  const restore = setBusy(button, "...");
  try {
    await api("vrchatCreateWorldInstance", { worldId, type, region: "use", inviteCurrentInstanceFriends: false }, 60000);
    restore("Sent");
    setTimeout(() => { if (button.isConnected) button.textContent = "Open"; }, 900);
  } catch (error) {
    button.title = error.message;
    restore("Open");
  }
}

async function runFriendAction(button) {
  const userId = button.dataset.friendId || "";
  const action = button.dataset.friendAction || "";
  if (!userId || !action) return;
  const restore = setBusy(button, "...");
  try {
    if (action === "invite") {
      const instanceId = currentInstanceId();
      if (!instanceId) throw new Error("No current instance is available to invite from.");
      await api("vrchatInviteUser", { userId, instanceId, messageSlot: 0 }, 45000);
      restore("Sent");
      setTimeout(() => { if (button.isConnected) button.textContent = "Invite"; }, 900);
      return;
    }
    if (action === "request") {
      await api("vrchatRequestInvite", { id: userId, messageSlot: 0 }, 45000);
      restore("Sent");
      setTimeout(() => { if (button.isConnected) button.textContent = "Request"; }, 900);
      return;
    }
    if (action === "message") {
      restore("Message");
      const message = await textOverlay({ title: "Message Friend", message: "Send a VRChat invite/request message.", confirmLabel: "Send" });
      if (!message) return;
      const sent = setBusy(button, "...");
      await api("vrchatSendChatMessage", { userId, message, mode: "auto" }, 45000);
      sent("Sent");
      setTimeout(() => { if (button.isConnected) button.textContent = "Message"; }, 900);
      return;
    }
  } catch (error) {
    await confirmOverlay({ title: "Friend Action", message: error.message, confirmLabel: "OK", danger: false });
    restore(action === "request" ? "Request" : action === "message" ? "Message" : "Invite");
    return;
  }
  setTimeout(() => { if (button.isConnected) button.textContent = action === "request" ? "Request" : action === "message" ? "Message" : "Invite"; }, 900);
}

function showFirstOpenTip() {
  if (loadOverlayFlag(OVERLAY_TAB_TIP_SEEN_KEY)) return;
  saveOverlayFlag(OVERLAY_TAB_TIP_SEEN_KEY);
  setTimeout(() => {
    confirmOverlay({
      title: "Overlay Tip",
      message: "Hold Tab in VRChat desktop mode to free your mouse. That lets you click, drag, resize, and use overlay controls without opening the VRChat menu.",
      confirmLabel: "Got it",
      danger: false
    });
  }, 250);
}

document.querySelectorAll(".overlay-tabs button").forEach((button) => button.addEventListener("click", () => setPanel(button.dataset.panel)));
$("prevGroupBtn").addEventListener("click", () => { state.groupDropdownOpen = false; state.groupIndex[state.panel] = (state.groupIndex[state.panel] || 0) - 1; render(); });
$("nextGroupBtn").addEventListener("click", () => { state.groupDropdownOpen = false; state.groupIndex[state.panel] = (state.groupIndex[state.panel] || 0) + 1; render(); });
$("groupSelectBtn").addEventListener("click", () => {
  if (!["avatars", "worlds", "friends"].includes(state.panel)) return;
  state.groupDropdownOpen = !state.groupDropdownOpen;
  render();
});
$("groupDropdown").addEventListener("click", (event) => {
  const button = event.target.closest("[data-group-index]");
  if (!button) return;
  state.groupIndex[state.panel] = Number(button.dataset.groupIndex) || 0;
  state.groupDropdownOpen = false;
  render();
});
$("overlaySearchInput").addEventListener("input", () => {
  if (!Object.prototype.hasOwnProperty.call(state.filters, state.panel)) return;
  state.filters[state.panel] = $("overlaySearchInput").value;
  render();
});
$("content").addEventListener("click", async (event) => {
  const copy = event.target.closest("[data-copy-text]");
  if (copy) {
    event.stopPropagation();
    await copyText(copy.dataset.copyText || "");
    const restore = setBusy(copy, "Copied");
    setTimeout(() => restore(), 700);
    return;
  }
  const saveCurrentAvatar = event.target.closest("[data-save-current-avatar]");
  if (saveCurrentAvatar) {
    event.stopPropagation();
    await openSaveCurrentAvatarDialog();
    return;
  }
  const saveCurrentWorld = event.target.closest("[data-save-current-world]");
  if (saveCurrentWorld) {
    event.stopPropagation();
    await saveCurrentWorldFromOverlay();
    return;
  }
  const saveWorld = event.target.closest("[data-save-world]");
  if (saveWorld) {
    event.stopPropagation();
    const worldId = saveWorld.dataset.saveWorld || "";
    const world = (state.data.worlds || []).find((item) => item.id === worldId) || state.data.current?.world || null;
    await saveWorldById(worldId, world, saveWorld);
    return;
  }
  const friendAction = event.target.closest("[data-friend-action]");
  if (friendAction) {
    event.stopPropagation();
    await runFriendAction(friendAction);
    return;
  }
  const equip = event.target.closest("[data-equip-avatar]");
  if (equip) {
    event.stopPropagation();
    const id = equip.dataset.equipAvatar || "";
    if (!id) return;
    const restore = setBusy(equip, "...");
    try {
      await api("overlayEquipAvatar", { id }, 120000);
      restore("Sent");
      setTimeout(() => { if (equip.isConnected) equip.textContent = "Equip"; }, 900);
    } catch (error) {
      equip.title = error.message;
      restore("Equip");
    }
    return;
  }
  const unfavorite = event.target.closest("[data-unfavorite-avatar]");
  if (unfavorite) {
    event.stopPropagation();
    await unfavoriteAvatarFromOverlay(unfavorite);
    return;
  }
  const openWorld = event.target.closest("[data-open-world]");
  if (openWorld) {
    event.stopPropagation();
    await openWorldFromOverlay(openWorld);
    return;
  }
  const worldRowEl = event.target.closest("[data-world-id]");
  if (worldRowEl) {
    state.selectedWorldId = state.selectedWorldId === worldRowEl.dataset.worldId ? "" : worldRowEl.dataset.worldId || "";
    render();
    return;
  }
  const friendRowEl = event.target.closest("[data-friend-id]");
  if (friendRowEl) {
    state.selectedFriendId = state.selectedFriendId === friendRowEl.dataset.friendId ? "" : friendRowEl.dataset.friendId || "";
    render();
    return;
  }
  const row = event.target.closest("[data-avatar-id]");
  if (row) {
    state.selectedAvatarId = state.selectedAvatarId === row.dataset.avatarId ? "" : row.dataset.avatarId || "";
    render();
    return;
  }
});
$("saveCurrentAvatarOverlayBtn").addEventListener("click", openSaveCurrentAvatarDialog);
$("saveCurrentWorldOverlayBtn").addEventListener("click", saveCurrentWorldFromOverlay);

installWindowControls();
hydrateCachedSnapshot();
render();
showFirstOpenTip();
refreshSettingsFast();
refresh();
