const OVERLAY_CACHE_KEY = "vrcneph.overlay.snapshot.v1";
const OVERLAY_SETTINGS_CACHE_KEY = "vrcneph.overlay.settings.v1";
const OVERLAY_TAB_TIP_SEEN_KEY = "vrcneph.overlay.tabTipSeen.v1";
const OVERLAY_DETACHED_PANELS_KEY = "vrcneph.overlay.detachedPanels.v1";
const OVERLAY_DETAIL_POSITIONS_KEY = "vrcneph.overlay.detailPositions.v1";
const LOCAL_WORLD_GROUPS_KEY = "vrcneph.worldGroups";
const DEFAULT_WORLD_GROUP_KEY = "local_world_favorites";
const SYNCED_GROUP_AVATAR_LIMIT = 50;
const OVERLAY_PANELS = ["avatars", "friends"];
const PANEL_LABELS = { avatars: "Avatars", friends: "Friends" };
const PANEL_SORT_OPTIONS = {
  avatars: [
    { value: "updatedDesc", label: "Recently updated" },
    { value: "manual", label: "Custom order" },
    { value: "createdDesc", label: "Recently added" },
    { value: "nameAsc", label: "Name A-Z" },
    { value: "authorAsc", label: "Author A-Z" }
  ],
  worlds: [
    { value: "updatedDesc", label: "Recently updated" },
    { value: "nameAsc", label: "Name A-Z" },
    { value: "authorAsc", label: "Author A-Z" },
    { value: "occupantsDesc", label: "Most active" },
    { value: "favoritesDesc", label: "Most favorites" }
  ],
  friends: [
    { value: "presence", label: "Status" },
    { value: "nameAsc", label: "Name A-Z" },
    { value: "platformAsc", label: "Platform" }
  ]
};

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
  try { window.dispatchEvent(new StorageEvent("storage", { key: LOCAL_WORLD_GROUPS_KEY, newValue: JSON.stringify(groups || []) })); } catch { }
}

const state = {
  panel: "avatars",
  groupIndex: { avatars: 0, worlds: 0, friends: 0 },
  selectedAvatarId: "",
  selectedWorldId: "",
  selectedFriendId: "",
  filters: { avatars: "", worlds: "", friends: "" },
  sort: { avatars: "updatedDesc", worlds: "updatedDesc", friends: "presence" },
  detachedPanels: loadOverlayJson(OVERLAY_DETACHED_PANELS_KEY, {}),
  detailPositions: loadOverlayJson(OVERLAY_DETAIL_POSITIONS_KEY, {}),
  detailPanels: {
    avatar: { open: false, item: null, loading: false, error: "", token: 0 },
    world: { open: false, item: null, loading: false, error: "", token: 0 },
    user: { open: false, item: null, loading: false, error: "", token: 0 }
  },
  roulette: { avatars: 0, intervals: { avatars: 60000 }, running: { avatars: false } },
  groupDropdownOpen: false,
  data: {
    settings: loadOverlayJson(OVERLAY_SETTINGS_CACHE_KEY, {}),
    avatarGroups: [],
    worldGroups: [],
    friendGroups: [],
    worlds: [],
    friends: [],
    current: null,
    session: null
  },
  pending: new Map()
};

let removedDetachedPanels = false;
let overlayHostMode = "";
let overlayHostToken = "";
for (const panel of Object.keys(state.detachedPanels || {})) {
  if (OVERLAY_PANELS.includes(panel)) continue;
  delete state.detachedPanels[panel];
  removedDetachedPanels = true;
}
if (removedDetachedPanels) saveOverlayJson(OVERLAY_DETACHED_PANELS_KEY, state.detachedPanels);

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const classToken = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";

function handleNativeMessage(message) {
  const response = JSON.parse(message);
  if (response.event) {
    if (response.event === "overlayRefresh") {
      applyOverlaySnapshot(response.data);
    }
    if (response.event === "overlayEquipNotice") {
      showEquipNotice(response.data);
    }
    if (response.event === "overlayHostState") {
      applyOverlayHostState(response.data);
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

function applyOverlaySnapshot(snapshot) {
  state.data = snapshot || state.data;
  saveOverlayJson(OVERLAY_CACHE_KEY, state.data);
  if (state.data?.settings) saveOverlayJson(OVERLAY_SETTINGS_CACHE_KEY, state.data.settings);
  render();
}

function showEquipNotice(notice = {}) {
  state.data.settings = { ...(state.data.settings || {}), themeColor: notice.themeColor || "", panelColor: notice.panelColor || "", panelColorSynced: false, overlayOpacity: notice.panelOpacity || 85, overlayScale: 100 };
  applySnapshotSettings();
  $("equipNoticeName").textContent = String(notice.name || "Avatar equipped").trim() || "Avatar equipped";
  const author = String(notice.authorName || "").trim();
  $("equipNoticeAuthor").textContent = author ? `by ${author}` : "Author unavailable";
  const image = $("equipNoticeImage");
  const fallback = $("equipNoticeFallback");
  const imageUrl = String(notice.thumbnailImageUrl || "").trim();
  if (imageUrl) { image.src = imageUrl; image.hidden = false; fallback.hidden = true; }
  const badges = [];
  const release = String(notice.releaseStatus || "").trim();
  const releaseBadge = equipNoticeReleaseBadge(release);
  if (releaseBadge) badges.push(releaseBadge);
  badges.push(...equipNoticePlatformBadges(notice.platforms));
  $("equipNoticeBadges").replaceChildren(...badges.slice(0, 3).map(({ label, className }) => { const badge = document.createElement("span"); badge.className = `overlay-equip-notice-badge ${className}`; badge.textContent = label; return badge; }));
  const noticeElement = $("equipNotice");
  noticeElement.hidden = true;
  void noticeElement.offsetWidth;
  noticeElement.hidden = false;
  document.body.classList.add("equip-notice-mode");
}

function equipNoticeReleaseBadge(status) {
  const value = String(status || "").trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === "deleted" || lower === "unavailable") return { label: "Deleted", className: "deleted" };
  if (lower === "private" || lower === "hidden") return { label: "Private", className: "private" };
  return { label: lower === "public" ? "Public" : value, className: lower === "public" ? "public" : "private" };
}

function equipNoticePlatformBadges(value) {
  const badges = [];
  for (const item of String(value || "").split(/[,;|\n]/).map((entry) => entry.trim()).filter(Boolean)) {
    const lower = item.toLowerCase();
    const label = lower.includes("standalonewindows") || /\b(windows|pc)\b/.test(lower) ? "PC" : lower.includes("android") || lower.includes("quest") ? "Android" : lower.includes("ios") ? "iOS" : "";
    if (!label || badges.some((badge) => badge.label === label)) continue;
    badges.push({ label, className: label === "PC" ? "platform-pc" : label === "Android" ? "platform-android" : "platform-ios" });
  }
  return badges;
}

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

function applyOverlayHostState(host = {}) {
    const mode = String(host?.mode || "hidden").toLowerCase();
    const token = String(host?.token || "");
    if (mode === "notice" && (overlayHostMode !== "notice" || overlayHostToken !== token)) {
      showEquipNotice(host?.notice || {});
    } else if (mode !== "notice" && overlayHostMode === "notice") {
      $("equipNotice").hidden = true;
      document.body.classList.remove("equip-notice-mode");
    }
    overlayHostMode = mode;
    overlayHostToken = token;
}
async function refreshOverlayHostMode() {
  try {
    applyOverlayHostState(await api("overlayHostState", {}, 3000));
  } catch { }
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
  if (panel === "worlds") return overlayWorldGroups();
  return state.data[panelGroupKey(panel)] || [];
}

function overlayWorldGroups() {
  const synced = state.data.worldGroups || [];
  const localGroups = loadLocalWorldGroups();
  ensureDefaultLocalWorldGroup(localGroups);
  const locals = localGroups.map((group) => ({
    id: group.key,
    name: group.label || "World Group",
    description: group.description || "",
    count: Number(group.worlds?.length || 0),
    type: "local",
    worlds: group.worlds || []
  }));
  return [...synced, ...locals];
}

function activeGroup(panel = state.panel) {
  const groups = activeGroups(panel);
  if (!groups.length) return null;
  state.groupIndex[panel] = Math.max(0, Math.min(state.groupIndex[panel] || 0, groups.length - 1));
  return groups[state.groupIndex[panel]];
}

function stepGroupIndex(panel, delta) {
  const groups = activeGroups(panel);
  if (!groups.length) return;
  const current = Math.max(0, Math.min(Number(state.groupIndex[panel] || 0), groups.length - 1));
  state.groupIndex[panel] = (current + Number(delta || 0) + groups.length) % groups.length;
}

function groupDisplayLimit(group) {
  return Number(group?.count ?? group?.avatars?.length ?? group?.worlds?.length ?? group?.friends?.length ?? 0);
}

function groupShowsLimit(group) {
  return Number(group?.limit || 0) > 0 && (group?.synced === true || !Array.isArray(group?.avatars));
}

function groupCountLabel(group, visibleCount, itemLabel) {
  const count = Number(visibleCount || 0);
  if (groupShowsLimit(group)) return `${count}/${Number(group.limit)} ${itemLabel}`;
  return `${count} ${itemLabel}`;
}

function setPanel(panel) {
  state.panel = OVERLAY_PANELS.includes(panel) ? panel : "avatars";
  state.groupDropdownOpen = false;
  document.querySelectorAll(".overlay-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.panel === state.panel));
  render();
}

function normalizedPanel(panel = "") {
  return OVERLAY_PANELS.includes(panel) ? panel : "avatars";
}

function menuOptionsHtml(options, selectedValue, dataName) {
  return options.map((option) => `<button type="button" data-${dataName}="${escapeHtml(option.value)}" aria-checked="${option.value === selectedValue ? "true" : "false"}">${escapeHtml(option.label)}</button>`).join("");
}

function panelSortLabel(panel = state.panel) {
  return (PANEL_SORT_OPTIONS[panel] || []).find((item) => item.value === state.sort[panel])?.label || "Sort";
}

function panelControlsHtml(panel = state.panel, expanded = false) {
  const options = PANEL_SORT_OPTIONS[panel];
  if (!options) return "";
  const editIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"></path><path d="m14 6 4 4"></path></svg>`;
  const trashIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9h8l-.7 11H8.7L8 9Z"></path><path d="M6 7h12"></path><path d="M10 5h4"></path></svg>`;
  const groupActions = ["avatars", "worlds"].includes(panel)
    ? `<button class="icon-action add" type="button" data-group-add="${escapeHtml(panel)}" title="Add group" aria-label="Add group"></button><button class="icon-action svg-icon" type="button" data-group-edit="${escapeHtml(panel)}" title="Edit group" aria-label="Edit group" ${currentGroupEditable(panel) ? "" : "disabled"}>${editIcon}</button><button class="icon-action danger svg-icon" type="button" data-group-delete="${escapeHtml(panel)}" title="Delete group" aria-label="Delete group" ${currentGroupDeleteable(panel) ? "" : "disabled"}>${trashIcon}</button>`
    : "";
  const actions = panel === "avatars"
    ? `${groupActions}<button type="button" data-random-avatar>Random</button><button type="button" data-avatar-roulette>${state.roulette.running.avatars ? "Running" : "Roulette"}</button>`
    : panel === "worlds"
      ? `${groupActions}<button type="button" data-random-world>Random</button>`
      : "";
  return `<div class="overlay-database-controls panel-sort-controls ${actions ? `panel-sort-controls-${panel}` : ""}">
    <div class="overlay-select-control">
      <button type="button" data-database-menu-toggle="panel-sort">${escapeHtml(panelSortLabel(panel))}</button>
      <div class="overlay-select-menu" data-database-menu="panel-sort" hidden>${menuOptionsHtml(options, state.sort[panel], "panel-sort")}</div>
    </div>
    ${actions}
  </div>`;
}

function dateSortValue(item, ...keys) {
  for (const key of keys) {
    const value = Date.parse(item?.[key] || "");
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function sortedPanelItems(panel, items = []) {
  const sorted = [...(items || [])];
  const sort = state.sort[panel] || "";
  if (panel === "avatars") {
    if (sort === "manual") return sorted;
    if (sort === "nameAsc") return sorted.sort((a, b) => String(a?.name || a?.id || "").localeCompare(String(b?.name || b?.id || ""), undefined, { sensitivity: "base" }));
    if (sort === "authorAsc") return sorted.sort((a, b) => String(a?.authorName || "").localeCompare(String(b?.authorName || ""), undefined, { sensitivity: "base" }) || String(a?.name || a?.id || "").localeCompare(String(b?.name || b?.id || ""), undefined, { sensitivity: "base" }));
    if (sort === "createdDesc") return sorted.sort((a, b) => dateSortValue(b, "createdAt", "updatedAt") - dateSortValue(a, "createdAt", "updatedAt"));
    return sorted.sort((a, b) => dateSortValue(b, "updatedAt", "createdAt") - dateSortValue(a, "updatedAt", "createdAt"));
  }
  if (panel === "worlds") {
    if (sort === "nameAsc") return sorted.sort((a, b) => String(a?.name || a?.id || "").localeCompare(String(b?.name || b?.id || ""), undefined, { sensitivity: "base" }));
    if (sort === "authorAsc") return sorted.sort((a, b) => String(a?.authorName || "").localeCompare(String(b?.authorName || ""), undefined, { sensitivity: "base" }) || String(a?.name || a?.id || "").localeCompare(String(b?.name || b?.id || ""), undefined, { sensitivity: "base" }));
    if (sort === "occupantsDesc") return sorted.sort((a, b) => Number(b?.occupants || 0) - Number(a?.occupants || 0) || String(a?.name || "").localeCompare(String(b?.name || "")));
    if (sort === "favoritesDesc") return sorted.sort((a, b) => Number(b?.favorites || 0) - Number(a?.favorites || 0) || String(a?.name || "").localeCompare(String(b?.name || "")));
    return sorted.sort((a, b) => dateSortValue(b, "updatedAt", "createdAt") - dateSortValue(a, "updatedAt", "createdAt"));
  }
  if (panel === "friends") {
    if (sort === "nameAsc") return sorted.sort((a, b) => String(a?.displayName || a?.id || "").localeCompare(String(b?.displayName || b?.id || ""), undefined, { sensitivity: "base" }));
    if (sort === "platformAsc") return sorted.sort((a, b) => String(a?.lastPlatform || "").localeCompare(String(b?.lastPlatform || ""), undefined, { sensitivity: "base" }) || String(a?.displayName || a?.id || "").localeCompare(String(b?.displayName || b?.id || ""), undefined, { sensitivity: "base" }));
    return sortFriends(sorted);
  }
  return sorted;
}

function hideDatabaseMenus(root = document) {
  root.querySelectorAll("[data-database-menu]").forEach((menu) => { menu.hidden = true; });
}

function toggleDatabaseMenu(button) {
  const wrap = button.closest(".overlay-database-controls");
  if (!wrap) return;
  const menu = wrap.querySelector(`[data-database-menu="${button.dataset.databaseMenuToggle}"]`);
  if (!menu) return;
  const shouldOpen = menu.hidden;
  hideDatabaseMenus(wrap);
  menu.hidden = !shouldOpen;
}

function saveDetachedPanels() {
  saveOverlayJson(OVERLAY_DETACHED_PANELS_KEY, state.detachedPanels);
}

function isDetached(panel = state.panel) {
  return Boolean(state.detachedPanels?.[panel]);
}

function defaultDetachedPanel(panel) {
  const index = Object.keys(state.detachedPanels || {}).length;
  return { x: 28 + (index * 18), y: 86 + (index * 18), width: 340, height: 460 };
}

function detachPanel(panel = state.panel) {
  if (!PANEL_LABELS[panel]) return;
  state.detachedPanels[panel] = state.detachedPanels[panel] || defaultDetachedPanel(panel);
  saveDetachedPanels();
  render();
}

function dockPanel(panel = state.panel) {
  delete state.detachedPanels[panel];
  saveDetachedPanels();
  render();
}

function saveDetailPositions() {
  saveOverlayJson(OVERLAY_DETAIL_POSITIONS_KEY, state.detailPositions);
}

function detailPosition(kind) {
  const defaults = {
    avatar: { x: 18, y: 70 },
    world: { x: 44, y: 92 },
    user: { x: 70, y: 114 }
  };
  return state.detailPositions[kind] || defaults[kind] || { x: 24, y: 80 };
}

function closeDetailPanel(kind) {
  if (!state.detailPanels[kind]) return;
  state.detailPanels[kind].open = false;
  state.detailPanels[kind].loading = false;
  state.detailPanels[kind].error = "";
  render();
}

function detailPanelMatches(kind, id = "") {
  const panel = state.detailPanels[kind];
  const item = panel?.item || {};
  return Boolean(panel?.open && id && String(item.id || item.avatarId || "").toLowerCase() === String(id).toLowerCase());
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

function isEditableAvatarGroup(group) {
  return Boolean(group?.id && !isSyncedGroupId(group.id) && !isManagedAvatarGroup(group.id));
}

function isEditableWorldGroup(group) {
  return Boolean(group?.id && String(group.id).startsWith("local_world_"));
}

function currentGroupEditable(panel = state.panel) {
  const group = activeGroup(panel);
  if (panel === "avatars") return isEditableAvatarGroup(group);
  if (panel === "worlds") return isEditableWorldGroup(group);
  return false;
}

function currentGroupDeleteable(panel = state.panel) {
  const group = activeGroup(panel);
  if (panel === "worlds" && group?.id === DEFAULT_WORLD_GROUP_KEY) return false;
  return currentGroupEditable(panel);
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
  const limit = Number(group.limit || 0) || SYNCED_GROUP_AVATAR_LIMIT;
  if (isSyncedGroupId(group.id) && Number(group.count ?? group.avatars?.length ?? 0) >= limit) return { ok: false, reason: `Synced groups can only contain ${limit} avatars.` };
  return { ok: true, reason: "" };
}

function favoriteAvatarEntry(avatarId = "") {
  const id = String(avatarId || "").toLowerCase();
  if (!id) return null;
  for (const group of state.data.avatarGroups || []) {
    if (!group?.id || isManagedAvatarGroup(group.id)) continue;
    const avatar = (group.avatars || []).find((item) => avatarIdEquals(item.id || item.avatarId, id));
    if (avatar) return { group, avatar };
  }
  return null;
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

function starIconHtml() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"></path></svg>`;
}

function favoriteStarButton({ active = false, action = "", id = "", extraAttrs = "", title = "" } = {}) {
  const label = title || (active ? "Unfavorite" : "Favorite");
  return `<button class="row-action favorite-star ${active ? "active" : ""}" type="button" ${action}="${escapeHtml(id)}" ${extraAttrs} title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${starIconHtml()}</button>`;
}

function detailFavoriteStarButton({ active = false, action = "", id = "", title = "" } = {}) {
  const label = title || (active ? "Unfavorite" : "Favorite");
  return `<button class="favorite-star ${active ? "active" : ""}" type="button" ${action}="${escapeHtml(id)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${starIconHtml()}</button>`;
}

function currentInstanceId() {
  const location = state.data.current?.location || {};
  if (location.location && String(location.location).startsWith("wrld_")) return location.location;
  if (location.worldId && location.instanceId) return `${location.worldId}:${location.instanceId}`;
  return location.instanceId || "";
}

function randomFrom(items = []) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function avatarRandomId(avatar) {
  return String(avatar?.avatarId || avatar?.id || "").trim().toLowerCase();
}

function excludedRandomAvatarIds() {
  const excluded = new Set();
  for (const group of state.data.avatarGroups || []) {
    const groupId = String(group?.id || "").toLowerCase();
    if (groupId !== "recent_avatars" && groupId !== "deleted_avatars") continue;
    for (const avatar of group.avatars || []) {
      const id = avatarRandomId(avatar);
      if (id) excluded.add(id);
    }
  }
  return excluded;
}

function dedupeRandomAvatars(avatars = []) {
  const seen = new Set();
  return (avatars || []).filter((avatar) => {
    const keys = avatarDuplicateKeys(avatar);
    if (!keys.length || keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}

function normalizeDuplicateText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeDuplicateImageUrl(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("?")[0]
    .replace(/\/+$/, "");
}

function avatarDuplicateKeys(avatar) {
  const keys = [];
  const id = avatarRandomId(avatar);
  if (id) keys.push(`id:${id}`);
  const name = normalizeDuplicateText(avatar?.name || avatar?.avatarName);
  const author = normalizeDuplicateText(avatar?.authorName);
  const image = normalizeDuplicateImageUrl(avatar?.thumbnailImageUrl || avatar?.imageUrl || avatar?.fullImageUrl);
  if (name && image) {
    keys.push(`visual:${name}|${author}|${image}`);
    keys.push(`visual-name:${name}|${image}`);
  }
  return keys;
}

function randomFavoriteAvatar() {
  const excluded = excludedRandomAvatarIds();
  const blockedGroups = new Set(["recent_avatars", "deleted_avatars", "updated_avatars", "uploaded_avatars"]);
  return randomFrom(dedupeRandomAvatars((state.data.avatarGroups || []).flatMap((group) => {
    const groupId = String(group?.id || "").toLowerCase();
    if (blockedGroups.has(groupId)) return [];
    return (group.avatars || []).filter((avatar) => !excluded.has(avatarRandomId(avatar)));
  })));
}

async function waitForOverlayAvatarEquipped(id, kind = "") {
  const target = avatarRandomId({ avatarId: id });
  const started = Date.now();
  while (Date.now() - started < 90000) {
    if (kind && !state.roulette.running[kind]) throw new Error("Avatar roulette stopped.");
    const avatar = await api("vrchatCurrentAvatar", {}, 30000).catch(() => null);
    const current = avatarRandomId(avatar || {});
    if (current && current === target) {
      await delay(2000);
      return true;
    }
    await delay(2500);
  }
  throw new Error("VRChat did not confirm the avatar equip within 90 seconds.");
}

async function equipAvatarIdFromOverlay(id, button = null, restoreLabel = "Equip", options = {}) {
  if (!id) return false;
  const restore = button ? setBusy(button, "...") : null;
  try {
    await api("overlayEquipAvatar", { id }, 120000);
    if (options.waitForConfirm) await waitForOverlayAvatarEquipped(id, options.rouletteKind || "");
    if (restore) {
      restore("Sent");
      setTimeout(() => { if (button.isConnected) button.textContent = restoreLabel; }, 900);
    }
    return true;
  } catch (error) {
    if (button) {
      button.title = error.message;
      restore?.(restoreLabel);
      await confirmOverlay({ title: restoreLabel, message: error.message, confirmLabel: "OK", danger: false });
    } else {
      await confirmOverlay({ title: "Equip Avatar", message: error.message, confirmLabel: "OK", danger: false });
    }
    return false;
  }
}

async function randomAvatarFromOverlay(button, options = {}) {
  const avatar = randomFavoriteAvatar();
  const id = avatar?.avatarId || avatar?.id || "";
  if (!id) {
    await confirmOverlay({ title: "Random Avatar", message: "No favorite avatar is available to equip.", confirmLabel: "OK", danger: false });
    return false;
  }
  return equipAvatarIdFromOverlay(id, button, "Random", options);
}

function stopRoulette(kind) {
  clearTimeout(state.roulette[kind]);
  state.roulette[kind] = 0;
  state.roulette.running[kind] = false;
  render();
}

function rouletteIntervalMs() {
  const minutes = Math.max(0, Math.floor(Number($("rouletteMinutesInput").value)) || 0);
  const seconds = Math.max(0, Math.min(59, Math.floor(Number($("rouletteSecondsInput").value)) || 0));
  $("rouletteMinutesInput").value = String(minutes);
  $("rouletteSecondsInput").value = String(seconds);
  return Math.max(5000, (minutes * 60000) + (seconds * 1000) || 60000);
}

async function openRouletteDialog(kind) {
  $("rouletteTitle").textContent = "Avatar Roulette";
  $("rouletteMessage").textContent = "Equip random favorite avatars on a timer.";
  const interval = state.roulette.intervals[kind] || 60000;
  $("rouletteMinutesInput").value = String(Math.floor(interval / 60000));
  $("rouletteSecondsInput").value = String(Math.floor((interval % 60000) / 1000));
  $("rouletteStopBtn").disabled = !state.roulette.running[kind];
  $("rouletteStartBtn").textContent = state.roulette.running[kind] ? "Restart" : "Start";
  const dialog = $("rouletteDialog");
  return new Promise((resolve) => {
    const cleanup = (value) => {
      $("rouletteStartBtn").removeEventListener("click", onStart);
      $("rouletteStopBtn").removeEventListener("click", onStop);
      $("rouletteCancelBtn").removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onCancel);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onStart = () => cleanup("start");
    const onStop = () => cleanup("stop");
    const onCancel = () => cleanup("");
    $("rouletteStartBtn").addEventListener("click", onStart, { once: true });
    $("rouletteStopBtn").addEventListener("click", onStop, { once: true });
    $("rouletteCancelBtn").addEventListener("click", onCancel, { once: true });
    dialog.addEventListener("cancel", onCancel, { once: true });
    dialog.addEventListener("close", onCancel, { once: true });
    dialog.showModal();
  });
}

async function rouletteTick(kind) {
  if (!state.roulette.running[kind]) return;
  const ok = await randomAvatarFromOverlay(null, { waitForConfirm: true, rouletteKind: kind });
  if (!ok || !state.roulette.running[kind]) {
    stopRoulette(kind);
    return;
  }
  state.roulette[kind] = setTimeout(() => { void rouletteTick(kind); }, state.roulette.intervals[kind]);
  render();
}

async function toggleAvatarRoulette(button) {
  const choice = await openRouletteDialog("avatars");
  if (choice === "stop") return stopRoulette("avatars");
  if (choice !== "start") return;
  stopRoulette("avatars");
  state.roulette.intervals.avatars = rouletteIntervalMs();
  state.roulette.running.avatars = true;
  const ok = await randomAvatarFromOverlay(button, { waitForConfirm: true, rouletteKind: "avatars" });
  if (!ok) return stopRoulette("avatars");
  state.roulette.avatars = setTimeout(() => { void rouletteTick("avatars"); }, state.roulette.intervals.avatars);
  render();
}

async function randomWorldFromOverlay(button) {
  const restore = setBusy(button, "...");
  try {
    const result = await api("vrchatWorldSearch", { sort: "random", order: "descending", limit: 50, offset: 0 }, 45000);
    const world = randomFrom(Array.isArray(result?.worlds) ? result.worlds : []);
    if (!world?.id && !world?.worldId) throw new Error("No random world was returned.");
    restore("Found");
    await openWorldDetail(world);
    setTimeout(() => { if (button.isConnected) button.textContent = "Random"; }, 900);
  } catch (error) {
    button.title = error.message;
    restore("Random");
  }
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
  const selected = detailPanelMatches("avatar", avatar.id);
  const status = avatar.releaseStatus || "Public";
  const ownGroupId = avatar.groupId || (state.panel === "avatars" ? activeGroup("avatars")?.id : "") || "";
  const favoriteEntry = ownGroupId && !isManagedAvatarGroup(ownGroupId)
    ? { group: (state.data.avatarGroups || []).find((group) => group.id === ownGroupId) || { id: ownGroupId }, avatar }
    : favoriteAvatarEntry(avatar.id);
  const favoriteLocalId = favoriteEntry?.avatar?.localId || favoriteEntry?.avatar?.id || "";
  const favoriteGroupId = favoriteEntry?.group?.id || "";
  const favoriteAction = favoriteEntry
    ? favoriteStarButton({ active: true, action: "data-unfavorite-avatar", id: avatar.id || "", extraAttrs: `data-local-avatar="${escapeHtml(favoriteLocalId)}" data-avatar-group="${escapeHtml(favoriteGroupId)}"`, title: "Unfavorite avatar" })
    : favoriteStarButton({ active: false, action: "data-save-avatar", id: avatar.id || "", title: "Favorite avatar" });
  return `<article class="overlay-row ${selected ? "selected" : ""}" data-avatar-id="${escapeHtml(avatar.id || "")}" data-avatar-local-id="${escapeHtml(avatar.localId || "")}">
    ${imageHtml(avatar, title)}
    <div class="row-main">
      <div class="row-title">${escapeHtml(title)}</div>
      <div class="row-subtitle">${escapeHtml(avatar.authorName || "Unknown author")}</div>
      <div class="chips">${platformChips(avatar.platforms)}${chip(status, status)}</div>
    </div>
    <div class="row-actions">
      <button class="row-action" type="button" data-equip-avatar="${escapeHtml(avatar.id || "")}">Equip</button>
      ${favoriteAction}
    </div>
  </article>`;
}

function worldRow(world) {
  const title = world.name || world.id || "Unknown world";
  const occupancy = Number(world.capacity) > 0 ? `${Number(world.occupants) || 0}/${Number(world.capacity)}` : `${Number(world.occupants) || 0} online`;
  const tags = String(world.favoriteTags || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 1);
  const selected = detailPanelMatches("world", world.id);
  const favoriteEntry = favoriteWorldEntry(world.id || world.worldId || "");
  const favoriteAction = favoriteEntry
    ? favoriteStarButton({ active: true, action: "data-unfavorite-world", id: world.id || "", title: "Unfavorite world" })
    : favoriteStarButton({ active: false, action: "data-save-world", id: world.id || "", title: "Favorite world" });
  return `<article class="overlay-row ${selected ? "selected" : ""}" data-world-id="${escapeHtml(world.id || "")}">
    ${imageHtml(world, title)}
    <div class="row-main">
      <div class="row-title">${escapeHtml(title)}</div>
      <div class="row-subtitle">${escapeHtml(world.authorName ? `by ${world.authorName}` : "Favorite world")}</div>
      <div class="chips">${chip(occupancy, "location")}${chip(world.releaseStatus || "public", world.releaseStatus || "public")}${tags.map((tag) => chip(tag.replace(/^worlds/i, ""), "ready")).join("")}</div>
    </div>
    <div class="row-actions">
      <button class="row-action" type="button" data-open-world="${escapeHtml(world.id || "")}">Join</button>
      ${favoriteAction}
    </div>
  </article>`;
}

function currentCard(kind, item, fallbackTitle, fallbackSubtitle, chipsHtml = "") {
  const title = item?.name || fallbackTitle;
  const subtitle = item?.authorName ? `by ${item.authorName}` : fallbackSubtitle;
  const id = item?.id || "";
  const actions = kind === "avatar"
    ? `<div class="detail-actions"><button type="button" data-save-current-avatar>Save</button>${id ? `<button type="button" data-equip-avatar="${escapeHtml(id)}">Equip</button><button type="button" data-copy-text="${escapeHtml(id)}">Copy ID</button>` : ""}</div>`
    : `<div class="detail-actions"><button type="button" data-save-current-world>Save</button>${id ? `<button type="button" data-copy-text="${escapeHtml(id)}">Copy ID</button>` : ""}</div>`;
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
  const selected = detailPanelMatches("user", friend.id);
  return `<article class="overlay-row friend-row ${selected ? "selected" : ""}" data-friend-id="${escapeHtml(friend.id || "")}">
    ${friendImage(friend)}
    <div class="row-main">
      <div class="row-title friend-name-rank ${escapeHtml(trustRankClass(friend))}">${escapeHtml(title)}</div>
      <div class="row-subtitle">${escapeHtml(friend.statusDescription || friendLocation(friend))}</div>
      <div class="chips">${chip(statusLabel, statusClass)}${platform ? chip(platform, platform) : ""}${friend.location && friend.location.startsWith("wrld_") ? chip("Joinable", "joinable") : ""}</div>
    </div>
    <div class="row-actions friend-actions">
      <button class="row-action" type="button" data-friend-action="invite" data-friend-id="${escapeHtml(friend.id || "")}">Invite</button>
      <button class="row-action" type="button" data-friend-action="request" data-friend-id="${escapeHtml(friend.id || "")}">Request</button>
    </div>
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
  dropdown.classList.toggle("tall", state.panel === "avatars" || state.panel === "worlds");
  const groups = activeGroups();
  const itemKey = panelItemKey();
  dropdown.hidden = !["avatars", "worlds", "friends"].includes(state.panel) || !state.groupDropdownOpen || groups.length <= 1;
  if (dropdown.hidden) {
    dropdown.innerHTML = "";
    return;
  }
  dropdown.innerHTML = groups.map((group, index) => `<button class="${index === (state.groupIndex[state.panel] || 0) ? "active" : ""}" type="button" data-group-index="${index}">
    <strong>${escapeHtml(group.name || "Unnamed group")}</strong>
    <span>${escapeHtml(groupCountLabel(group, Number(group.count ?? (group[itemKey] || []).length), itemKey))}</span>
  </button>`).join("");
}

function withPanel(panel, callback) {
  const previous = state.panel;
  state.panel = panel;
  try { return callback(); } finally { state.panel = previous; }
}

function panelView(panel, { detached = false } = {}) {
  if (panel === "avatars") {
    const group = activeGroup("avatars");
    if (!group) return {
      title: "Avatars",
      count: "No groups",
      hasGroups: false,
      content: emptyHtml("No avatar groups", "Sync or create avatar groups in VRCNeph, then refresh this overlay.")
    };
    const avatars = group.avatars || [];
    const visibleAvatars = sortedPanelItems("avatars", avatars.filter((avatar) => itemMatchesFilter(avatar, ["name", "authorName", "id"], "avatars")));
    return {
      title: group.name || "Avatars",
      count: groupCountLabel(group, visibleAvatars.length, "avatars"),
      hasGroups: true,
      canPrev: (state.data.avatarGroups || []).length > 1,
      canNext: (state.data.avatarGroups || []).length > 1,
      tools: panelControlsHtml("avatars", detached),
      content: visibleAvatars.length ? withPanel("avatars", () => visibleAvatars.map(avatarRow).join("")) : emptyHtml("No avatars in this group", "Pick another group or add avatars in the main app.")
    };
  }
  if (panel === "worlds") {
    const group = activeGroup("worlds");
    const worlds = group?.worlds || [];
    const visibleWorlds = sortedPanelItems("worlds", worlds.filter((world) => itemMatchesFilter(world, ["name", "authorName", "description", "id"], "worlds")));
    return {
      title: group?.name || "Favorite Worlds",
      count: groupCountLabel(group, visibleWorlds.length, "worlds"),
      hasGroups: true,
      canPrev: (state.data.worldGroups || []).length > 1,
      canNext: (state.data.worldGroups || []).length > 1,
      tools: panelControlsHtml("worlds", detached),
      content: visibleWorlds.length ? withPanel("worlds", () => visibleWorlds.map(worldRow).join("")) : emptyHtml("No favorite worlds loaded", "Refresh the overlay after logging in, or favorite worlds in VRChat first.")
    };
  }
  if (panel === "friends") {
    const group = activeGroup("friends");
    const friends = sortedPanelItems("friends", (group?.friends || []).filter((friend) => itemMatchesFilter(friend, ["displayName", "statusDescription", "status", "location", "currentAvatarName", "id"], "friends")));
    return {
      title: group?.name || "Friends",
      count: groupCountLabel(group, friends.length, "friends"),
      hasGroups: true,
      canPrev: (state.data.friendGroups || []).length > 1,
      canNext: (state.data.friendGroups || []).length > 1,
      tools: panelControlsHtml("friends", detached),
      content: friends.length ? friendsGroupedHtml(friends) : emptyHtml("No friends loaded", "Refresh the overlay after logging in, or check the main app connection.")
    };
  }
  return {
    title: "Unavailable",
    count: "",
    hasGroups: false,
    content: emptyHtml("Panel unavailable", "Choose Avatars, Worlds, or Friends.")
  };
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
  const visibleAvatars = sortedPanelItems("avatars", avatars.filter((avatar) => itemMatchesFilter(avatar, ["name", "authorName", "id"], "avatars")));
  $("panelTitle").textContent = group.name || "Avatars";
  $("panelCount").textContent = groupCountLabel(group, visibleAvatars.length, "avatars");
  $("prevGroupBtn").disabled = (state.data.avatarGroups || []).length <= 1;
  $("nextGroupBtn").disabled = (state.data.avatarGroups || []).length <= 1;
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
  const visibleWorlds = sortedPanelItems("worlds", worlds.filter((world) => itemMatchesFilter(world, ["name", "authorName", "description", "id"], "worlds")));
  $("panelTitle").textContent = group?.name || "Favorite Worlds";
  $("panelCount").textContent = groupCountLabel(group, visibleWorlds.length, "worlds");
  $("prevGroupBtn").disabled = (state.data.worldGroups || []).length <= 1;
  $("nextGroupBtn").disabled = (state.data.worldGroups || []).length <= 1;
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
  const friends = sortedPanelItems("friends", (group?.friends || []).filter((friend) => itemMatchesFilter(friend, ["displayName", "statusDescription", "status", "location", "currentAvatarName", "id"], "friends")));
  $("panelTitle").textContent = group?.name || "Friends";
  $("panelCount").textContent = groupCountLabel(group, friends.length, "friends");
  $("prevGroupBtn").disabled = (state.data.friendGroups || []).length <= 1;
  $("nextGroupBtn").disabled = (state.data.friendGroups || []).length <= 1;
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

function emptyHtml(title, message) {
  return `<section class="empty-panel"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></section>`;
}

function applyMainPanelView() {
  const split = isDetached(state.panel);
  const hasGroupHeader = ["avatars", "worlds", "friends"].includes(state.panel);
  $("panelHead").classList.toggle("full", split || !hasGroupHeader);
  $("prevGroupBtn").hidden = split || !["avatars", "worlds", "friends"].includes(state.panel);
  $("nextGroupBtn").hidden = split || !["avatars", "worlds", "friends"].includes(state.panel);
  $("groupSelectBtn").disabled = split || !hasGroupHeader;
  $("splitPanelBtn").textContent = split ? "Dock" : "Split";
  $("splitPanelBtn").title = split ? "Dock this panel back into the main overlay" : "Split this tab into its own overlay panel";

  if (split) {
    $("panelTitle").textContent = PANEL_LABELS[state.panel] || "Panel";
    $("panelCount").textContent = "Split panel";
    $("content").innerHTML = emptyHtml("Panel is split out", "Use the detached panel, or dock it back here.");
    $("groupDropdown").hidden = true;
    $("groupDropdown").innerHTML = "";
    return;
  }

  const view = panelView(state.panel);
  $("panelHead").classList.toggle("full", Boolean(view.full) || !view.hasGroups);
  $("prevGroupBtn").hidden = !view.hasGroups;
  $("nextGroupBtn").hidden = !view.hasGroups;
  $("prevGroupBtn").disabled = !view.canPrev;
  $("nextGroupBtn").disabled = !view.canNext;
  $("groupSelectBtn").disabled = !view.hasGroups;
  $("panelTitle").textContent = view.title;
  $("panelCount").textContent = view.count;
  if (view.hasGroups) renderGroupDropdown();
  else {
    $("groupDropdown").hidden = true;
    $("groupDropdown").innerHTML = "";
  }
  $("content").innerHTML = view.content;
}

function detachedPanelHtml(panel, bounds) {
  const view = panelView(panel, { detached: true });
  const group = view.hasGroups ? activeGroup(panel) : null;
  const groupTools = view.hasGroups ? `<button class="nav-button" type="button" data-detached-group-step="-1" ${view.canPrev ? "" : "disabled"}>&lt;</button>
    <button class="group-button" type="button" disabled><span>${escapeHtml(group?.name || view.title)}</span><small>${escapeHtml(view.count)}</small></button>
    <button class="nav-button" type="button" data-detached-group-step="1" ${view.canNext ? "" : "disabled"}>&gt;</button>` : "";
  const searchable = OVERLAY_PANELS.includes(panel);
  const placeholder = panel === "friends" ? "Search friends" : panel === "worlds" ? "Search worlds" : "Search avatars";
  const search = searchable ? `<input class="detached-search" data-detached-search="${escapeHtml(panel)}" type="search" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(state.filters[panel] || "")}">` : "";
  return `<article class="detached-panel ${escapeHtml(panel)}" data-detached-panel="${escapeHtml(panel)}" style="left:${Number(bounds.x) || 20}px;top:${Number(bounds.y) || 70}px;width:${Number(bounds.width) || 340}px;height:${Number(bounds.height) || 460}px">
    <header class="detached-panel-titlebar" data-detached-drag="${escapeHtml(panel)}">
      <div class="detached-panel-title"><strong>${escapeHtml(view.title)}</strong><span>${escapeHtml(view.count)}</span></div>
      <button type="button" data-focus-panel="${escapeHtml(panel)}">Focus</button>
      <button type="button" data-dock-panel="${escapeHtml(panel)}">Dock</button>
    </header>
    <section class="detached-panel-tools">
      ${groupTools}
      ${view.tools || ""}
      ${search}
    </section>
    <section class="overlay-list" aria-live="polite">${view.content}</section>
    <span class="detached-resize-handle" data-detached-resize="${escapeHtml(panel)}"></span>
  </article>`;
}

function renderDetachedPanels() {
  const panels = Object.entries(state.detachedPanels || {}).filter(([panel]) => PANEL_LABELS[panel]);
  $("detachedPanels").innerHTML = panels.map(([panel, bounds]) => {
    if (!bounds || typeof bounds !== "object") state.detachedPanels[panel] = defaultDetachedPanel(panel);
    return detachedPanelHtml(panel, state.detachedPanels[panel]);
  }).join("");
}

function detailImageHtml(item, label) {
  const url = item?.thumbnailImageUrl || item?.imageUrl || item?.fullImageUrl || item?.profilePicOverrideThumbnail || item?.profilePicOverride || item?.profileImageUrl || item?.currentAvatarThumbnailImageUrl || "";
  if (!url) return `<div class="detail-hero-image placeholder">${escapeHtml((label || "?").slice(0, 1).toUpperCase())}</div>`;
  return `<div class="detail-hero-image"><img src="${escapeHtml(url)}" alt="" onerror="this.parentElement.className='detail-hero-image placeholder';this.parentElement.textContent='${escapeHtml((label || "?").slice(0, 1).toUpperCase())}'"></div>`;
}

function detailActionsHtml(actions) {
  return `<div class="detail-popup-actions">${actions.filter(Boolean).join("")}</div>`;
}

function detailSectionHtml(title, body) {
  if (!body) return "";
  return `<section class="detail-section"><h3>${escapeHtml(title)}</h3>${body}</section>`;
}

function detailDescriptionHtml(text, fallback = "No description available.") {
  const value = String(text || "").trim();
  return `<p>${escapeHtml(value || fallback)}</p>`;
}

function normalizeAvatarDetail(item = {}) {
  return {
    ...item,
    id: item.avatarId || item.id || "",
    imageUrl: item.thumbnailImageUrl || item.imageUrl || item.fullImageUrl || "",
    fullImageUrl: item.imageUrl || item.fullImageUrl || item.thumbnailImageUrl || ""
  };
}

function normalizeWorldDetail(item = {}) {
  return { ...item, id: item.id || item.worldId || "" };
}

function normalizeUserDetail(item = {}) {
  return { ...item, id: item.id || item.userId || "" };
}

function findOverlayWorld(worldId = "") {
  const id = String(worldId || "").toLowerCase();
  if (!id) return null;
  const sources = [
    ...(overlayWorldGroups().flatMap((group) => group.worlds || [])),
    ...(state.data.worlds || []),
    state.data.current?.world || null
  ].filter(Boolean);
  return sources.find((world) => String(world.id || world.worldId || "").toLowerCase() === id) || null;
}

function favoriteWorldEntry(worldId = "") {
  const id = String(worldId || "").toLowerCase();
  if (!id) return null;
  for (const group of overlayWorldGroups()) {
    const world = (group.worlds || []).find((item) => String(item.id || item.worldId || "").toLowerCase() === id);
    if (world) return { group, world };
  }
  return null;
}

function findOverlayFriend(userId = "") {
  const id = String(userId || "").toLowerCase();
  if (!id) return null;
  const sources = [
    ...((state.data.friendGroups || []).flatMap((group) => group.friends || [])),
    ...(state.data.friends || [])
  ].filter(Boolean);
  return sources.find((friend) => String(friend.id || friend.userId || "").toLowerCase() === id) || null;
}

async function openAvatarDetail(avatar) {
  const id = avatar?.id || avatar?.avatarId || "";
  if (!id) return;
  const panel = state.detailPanels.avatar;
  panel.open = true;
  panel.item = normalizeAvatarDetail({ ...(findOverlayAvatar(id) || {}), ...avatar, id });
  panel.loading = true;
  panel.error = "";
  panel.token++;
  const token = panel.token;
  state.selectedAvatarId = id;
  render();
  try {
    const detail = await api("vrchatAvatarDetail", { id }, 45000);
    if (token !== panel.token) return;
    panel.item = normalizeAvatarDetail({ ...panel.item, ...detail });
    panel.error = "";
  } catch (error) {
    if (token !== panel.token) return;
    panel.error = error.message || "Avatar detail failed.";
  } finally {
    if (token === panel.token) {
      panel.loading = false;
      render();
    }
  }
}

async function openWorldDetail(world) {
  const id = world?.id || world?.worldId || "";
  if (!id) return;
  const panel = state.detailPanels.world;
  panel.open = true;
  panel.item = normalizeWorldDetail({ ...(findOverlayWorld(id) || {}), ...world, id });
  panel.loading = true;
  panel.error = "";
  panel.token++;
  const token = panel.token;
  state.selectedWorldId = id;
  render();
  try {
    const detail = await api("vrchatWorldDetail", { id }, 45000);
    if (token !== panel.token) return;
    panel.item = normalizeWorldDetail({ ...panel.item, ...detail });
    panel.error = "";
  } catch (error) {
    if (token !== panel.token) return;
    panel.error = error.message || "World detail failed.";
  } finally {
    if (token === panel.token) {
      panel.loading = false;
      render();
    }
  }
}

async function openUserDetail(friend) {
  const id = friend?.id || friend?.userId || "";
  if (!id) return;
  const panel = state.detailPanels.user;
  panel.open = true;
  panel.item = normalizeUserDetail({ ...(findOverlayFriend(id) || {}), ...friend, id });
  panel.loading = true;
  panel.error = "";
  panel.token++;
  const token = panel.token;
  state.selectedFriendId = id;
  render();
  try {
    const detail = await api("vrchatFriendDetail", { id }, 45000);
    if (token !== panel.token) return;
    panel.item = normalizeUserDetail({ ...panel.item, ...detail });
    panel.error = "";
  } catch (error) {
    if (token !== panel.token) return;
    panel.error = error.message || "User detail failed.";
  } finally {
    if (token === panel.token) {
      panel.loading = false;
      render();
    }
  }
}

function avatarDetailBody(panel) {
  const avatar = normalizeAvatarDetail(panel.item || {});
  const title = avatar.name || avatar.id || "Avatar";
  const favoriteEntry = favoriteAvatarEntry(avatar.id || avatar.avatarId || "");
  const favoriteLocalId = favoriteEntry?.avatar?.localId || favoriteEntry?.avatar?.id || "";
  const favoriteGroupId = favoriteEntry?.group?.id || "";
  const favoriteAction = favoriteEntry
    ? `<button class="favorite-star active" type="button" data-unfavorite-avatar="${escapeHtml(avatar.id || "")}" data-local-avatar="${escapeHtml(favoriteLocalId)}" data-avatar-group="${escapeHtml(favoriteGroupId)}" title="Unfavorite avatar" aria-label="Unfavorite avatar">${starIconHtml()}</button>`
    : detailFavoriteStarButton({ active: false, action: "data-save-avatar", id: avatar.id || "", title: "Favorite avatar" });
  return `<div class="detail-hero">
    ${detailImageHtml(avatar, title)}
    <div class="detail-hero-main">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(avatar.authorName || "Unknown author")}</span>
      <div class="chips">${platformChips(avatar.platforms)}${chip(avatar.releaseStatus || "public", avatar.releaseStatus || "public")}</div>
    </div>
  </div>
  ${detailActionsHtml([
    avatar.id ? `<button type="button" data-equip-avatar="${escapeHtml(avatar.id)}">Equip</button>` : "",
    avatar.id ? favoriteAction : "",
    avatar.id ? `<button type="button" data-copy-text="${escapeHtml(avatar.id)}">Copy ID</button>` : ""
  ])}
  ${panel.loading ? `<div class="detail-status">Loading avatar details...</div>` : ""}
  ${panel.error ? `<div class="detail-status danger">${escapeHtml(panel.error)}</div>` : ""}
  ${detailSectionHtml("Details", `<dl>${detailRow("Avatar ID", avatar.id)}${detailRow("Author ID", avatar.authorId)}${detailRow("Version", avatar.version)}${detailRow("Source", avatar.source)}${detailRow("Updated", avatar.remoteUpdatedAt)}${detailRow("Created", avatar.remoteCreatedAt)}</dl>`)}
  ${detailSectionHtml("Description", detailDescriptionHtml(avatar.description))}
  ${avatar.tags ? detailSectionHtml("Tags", `<p>${escapeHtml(avatar.tags)}</p>`) : ""}`;
}

function worldDetailBody(panel) {
  const world = normalizeWorldDetail(panel.item || {});
  const title = world.name || world.id || "World";
  const occupancy = Number(world.capacity) > 0 ? `${Number(world.occupants) || 0}/${Number(world.capacity)}` : `${Number(world.occupants) || 0} online`;
  const favoriteEntry = favoriteWorldEntry(world.id || world.worldId || "");
  const favoriteAction = favoriteEntry
    ? detailFavoriteStarButton({ active: true, action: "data-unfavorite-world", id: world.id || "", title: "Unfavorite world" })
    : detailFavoriteStarButton({ active: false, action: "data-save-world", id: world.id || "", title: "Favorite world" });
  return `<div class="detail-hero">
    ${detailImageHtml(world, title)}
    <div class="detail-hero-main">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(world.authorName ? `by ${world.authorName}` : "VRChat world")}</span>
      <div class="chips">${chip(occupancy, "location")}${chip(world.releaseStatus || "public", world.releaseStatus || "public")}</div>
    </div>
  </div>
  ${detailActionsHtml([
    world.id ? `<button type="button" data-open-world="${escapeHtml(world.id)}">Join</button>` : "",
    world.id ? favoriteAction : "",
    world.id ? `<button type="button" data-copy-text="${escapeHtml(world.id)}">Copy ID</button>` : ""
  ])}
  ${panel.loading ? `<div class="detail-status">Loading world details...</div>` : ""}
  ${panel.error ? `<div class="detail-status danger">${escapeHtml(panel.error)}</div>` : ""}
  ${detailSectionHtml("Details", `<dl>${detailRow("World ID", world.id)}${detailRow("Author", world.authorName || world.authorId)}${detailRow("Visits", world.visits)}${detailRow("Favorites", world.favorites)}${detailRow("Public", world.publicOccupants)}${detailRow("Private", world.privateOccupants)}${detailRow("Updated", world.updatedAt)}${detailRow("Created", world.createdAt)}</dl>`)}
  ${detailSectionHtml("Description", detailDescriptionHtml(world.description))}
  ${world.instances?.length ? detailSectionHtml("Instances", `<div class="detail-instance-list">${world.instances.slice(0, 8).map((instance) => `<span><strong>${escapeHtml(instance.region || instance.id || "Instance")}</strong>${escapeHtml([instance.type, instance.occupants ? `${instance.occupants} users` : "", instance.groupName].filter(Boolean).join(" - "))}</span>`).join("")}</div>`) : ""}`;
}

function userDetailBody(panel) {
  const user = normalizeUserDetail(panel.item || {});
  const title = user.displayName || user.id || "User";
  const presence = friendPresence(user);
  const statusLabel = userStatusLabel(user.status, presence);
  const avatarId = user.currentAvatarId || "";
  return `<div class="detail-hero">
    ${detailImageHtml(user, title)}
    <div class="detail-hero-main">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(user.statusDescription || friendLocation(user))}</span>
      <div class="chips">${chip(statusLabel, userStatusClass(user.status, presence))}${user.lastPlatform ? chip(user.lastPlatform, user.lastPlatform) : ""}</div>
    </div>
  </div>
  ${detailActionsHtml([
    user.id ? `<button type="button" data-friend-action="invite" data-friend-id="${escapeHtml(user.id)}">Invite</button>` : "",
    user.id ? `<button type="button" data-friend-action="request" data-friend-id="${escapeHtml(user.id)}">Request</button>` : "",
    user.id ? `<button type="button" data-friend-action="message" data-friend-id="${escapeHtml(user.id)}">Message</button>` : "",
    user.id ? `<button type="button" data-copy-text="${escapeHtml(user.id)}">Copy ID</button>` : ""
  ])}
  ${panel.loading ? `<div class="detail-status">Loading user details...</div>` : ""}
  ${panel.error ? `<div class="detail-status danger">${escapeHtml(panel.error)}</div>` : ""}
  ${detailSectionHtml("Details", `<dl>${detailRow("User ID", user.id)}${detailRow("Status", [user.status, user.statusDescription].filter(Boolean).join(" - "))}${detailRow("Location", friendLocation(user))}${detailRow("World ID", user.worldId)}${detailRow("Last platform", user.lastPlatform)}${detailRow("Joined", user.dateJoined)}${detailRow("Last login", user.lastLogin)}</dl>`)}
  ${detailSectionHtml("Current Avatar", `<dl>${detailRow("Name", user.currentAvatarName)}${detailRow("Avatar ID", avatarId)}${detailRow("Avatar Cloning", user.allowAvatarCopying)}</dl>${avatarId ? detailActionsHtml([`<button type="button" data-avatar-detail-open="${escapeHtml(avatarId)}" data-avatar-name="${escapeHtml(user.currentAvatarName || avatarId)}">Open Avatar</button>`]) : ""}`)}
  ${detailSectionHtml("Bio", detailDescriptionHtml(user.bio, "No bio available."))}
  ${user.representedGroupName || user.representedGroupId ? detailSectionHtml("Represented Group", `<p>${escapeHtml([user.representedGroupName || user.representedGroupId, user.representedGroupShortCode ? `#${user.representedGroupShortCode}` : "", user.representedGroupMemberCount ? `${user.representedGroupMemberCount} members` : ""].filter(Boolean).join(" - "))}</p>`) : ""}`;
}

function detailPanelHtml(kind, panel) {
  const position = detailPosition(kind);
  const titles = { avatar: "Avatar Details", world: "World Details", user: "User Details" };
  const item = panel.item || {};
  const subtitle = kind === "user" ? item.displayName || item.id : item.name || item.id || item.avatarId || "";
  const body = kind === "avatar" ? avatarDetailBody(panel) : kind === "world" ? worldDetailBody(panel) : userDetailBody(panel);
  return `<article class="detail-popup ${escapeHtml(kind)}" data-detail-panel="${escapeHtml(kind)}" style="left:${Number(position.x) || 20}px;top:${Number(position.y) || 70}px">
    <header class="detail-popup-titlebar" data-detail-drag="${escapeHtml(kind)}">
      <div><strong>${escapeHtml(titles[kind] || "Details")}</strong><span>${escapeHtml(subtitle)}</span></div>
      <button type="button" data-detail-close="${escapeHtml(kind)}" title="Close">x</button>
    </header>
    <section class="detail-popup-body">${body}</section>
  </article>`;
}

function renderDetailPanels() {
  $("detailPanels").innerHTML = Object.entries(state.detailPanels)
    .filter(([, panel]) => panel.open)
    .map(([kind, panel]) => detailPanelHtml(kind, panel))
    .join("");
}

function render() {
  applySnapshotSettings();
  const searchable = OVERLAY_PANELS.includes(state.panel);
  const panelControls = isDetached(state.panel) ? "" : panelControlsHtml(state.panel, false);
  $("overlayActions").hidden = !searchable && !["avatars", "worlds"].includes(state.panel);
  $("overlaySearchInput").hidden = !searchable;
  $("overlaySearchInput").value = state.filters[state.panel] || "";
  $("overlaySearchInput").placeholder = state.panel === "friends" ? "Search friends" : state.panel === "worlds" ? "Search worlds" : "Search avatars";
  $("overlayDatabaseControls").hidden = !panelControls;
  $("overlayDatabaseControls").innerHTML = panelControls;
  $("saveCurrentAvatarOverlayBtn").hidden = state.panel !== "avatars";
  $("saveCurrentWorldOverlayBtn").hidden = state.panel !== "worlds";
  applyMainPanelView();
  renderDetachedPanels();
  renderDetailPanels();
}

async function refresh() {
  try {
    applyOverlaySnapshot(await api("overlaySnapshot"));
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
  const opacity = Math.min(100, Math.max(45, Number(settings.overlayOpacity) || 85)) / 100;
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
    state.panel = normalizedPanel(panel);
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

function groupOverlay({ title = "Group", message = "", name = "", description = "", confirmLabel = "Save" } = {}) {
  const dialog = $("groupDialog");
  $("groupTitle").textContent = title;
  $("groupMessage").textContent = message;
  $("groupNameInput").value = name || "";
  $("groupDescriptionInput").value = description || "";
  $("groupOkBtn").textContent = confirmLabel;
  return new Promise((resolve) => {
    const cleanup = (result) => {
      $("groupOkBtn").removeEventListener("click", onOk);
      $("groupCancelBtn").removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onCancel);
      if (dialog.open) dialog.close();
      resolve(result);
    };
    const onOk = () => cleanup({
      name: $("groupNameInput").value.trim(),
      description: $("groupDescriptionInput").value.trim()
    });
    const onCancel = () => cleanup(null);
    $("groupOkBtn").addEventListener("click", onOk, { once: true });
    $("groupCancelBtn").addEventListener("click", onCancel, { once: true });
    dialog.addEventListener("cancel", onCancel, { once: true });
    dialog.addEventListener("close", onCancel, { once: true });
    dialog.showModal();
    $("groupNameInput").focus();
    $("groupNameInput").select();
  });
}

function uniqueLocalWorldGroupLabel(name, excludeKey = "") {
  const base = String(name || "New World Group").trim() || "New World Group";
  const used = new Set(loadLocalWorldGroups()
    .filter((group) => group.key !== excludeKey)
    .map((group) => String(group.label || "").trim().toLowerCase())
    .filter(Boolean));
  if (!used.has(base.toLowerCase())) return base;
  for (let index = 2; index < 1000; index++) {
    const candidate = `${base} ${index}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now().toString(36)}`;
}

function selectGroupById(panel, groupId) {
  const groups = activeGroups(panel);
  const index = groups.findIndex((group) => String(group.id || "").toLowerCase() === String(groupId || "").toLowerCase());
  if (index >= 0) state.groupIndex[panel] = index;
}

async function addGroupFromOverlay(panel = state.panel) {
  const result = await groupOverlay({
    title: panel === "worlds" ? "New World Group" : "New Avatar Group",
    message: panel === "worlds" ? "Create a local world group for the overlay and main app." : "Create a local avatar group in VRCNeph.",
    confirmLabel: "Create"
  });
  if (!result) return;
  if (!result.name) {
    await confirmOverlay({ title: "Group", message: "Group name is required.", confirmLabel: "OK", danger: false });
    return;
  }
  try {
    if (panel === "avatars") {
      await api("createGroup", { name: result.name, icon: "", description: result.description }, 45000);
      await refresh();
      const created = [...(state.data.avatarGroups || [])].reverse().find((group) => isEditableAvatarGroup(group) && String(group.name || "").toLowerCase() === result.name.toLowerCase());
      if (created) selectGroupById("avatars", created.id);
      render();
    } else if (panel === "worlds") {
      const groups = loadLocalWorldGroups();
      ensureDefaultLocalWorldGroup(groups);
      const key = `local_world_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
      groups.push({ key, label: uniqueLocalWorldGroupLabel(result.name), description: result.description, worlds: [] });
      saveLocalWorldGroups(groups);
      selectGroupById("worlds", key);
      render();
    }
  } catch (error) {
    await confirmOverlay({ title: "Group", message: error.message, confirmLabel: "OK", danger: false });
  }
}

async function editGroupFromOverlay(panel = state.panel) {
  const group = activeGroup(panel);
  if (!currentGroupEditable(panel)) return;
  const result = await groupOverlay({
    title: panel === "worlds" ? "Edit World Group" : "Edit Avatar Group",
    message: panel === "worlds" ? "Rename or describe this local world group." : "Rename or describe this local avatar group.",
    name: group.name || "",
    description: group.description || "",
    confirmLabel: "Save"
  });
  if (!result) return;
  if (!result.name) {
    await confirmOverlay({ title: "Group", message: "Group name is required.", confirmLabel: "OK", danger: false });
    return;
  }
  try {
    if (panel === "avatars") {
      await api("updateGroup", { id: group.id, name: result.name, icon: group.icon || "", description: result.description }, 45000);
      await refresh();
      selectGroupById("avatars", group.id);
      render();
    } else if (panel === "worlds") {
      const groups = loadLocalWorldGroups();
      ensureDefaultLocalWorldGroup(groups);
      const local = groups.find((item) => item.key === group.id);
      if (!local) throw new Error("World group not found.");
      local.label = group.id === DEFAULT_WORLD_GROUP_KEY ? "Favorites" : uniqueLocalWorldGroupLabel(result.name, group.id);
      local.description = result.description;
      saveLocalWorldGroups(groups);
      selectGroupById("worlds", group.id);
      render();
    }
  } catch (error) {
    await confirmOverlay({ title: "Group", message: error.message, confirmLabel: "OK", danger: false });
  }
}

async function deleteGroupFromOverlay(panel = state.panel) {
  const group = activeGroup(panel);
  if (!currentGroupEditable(panel)) return;
  if (panel === "worlds" && group.id === DEFAULT_WORLD_GROUP_KEY) {
    await confirmOverlay({ title: "Delete Group", message: "The default world Favorites group cannot be deleted.", confirmLabel: "OK", danger: false });
    return;
  }
  const confirmed = await confirmOverlay({
    title: "Delete Group",
    message: `Delete "${group.name || "this group"}"? Items in this group will be removed from the group.`,
    confirmLabel: "Delete",
    danger: true
  });
  if (!confirmed) return;
  try {
    if (panel === "avatars") {
      await api("deleteGroup", { id: group.id }, 45000);
      await refresh();
    } else if (panel === "worlds") {
      const groups = loadLocalWorldGroups().filter((item) => item.key !== group.id);
      ensureDefaultLocalWorldGroup(groups);
      saveLocalWorldGroups(groups);
      state.groupIndex.worlds = 0;
      render();
    }
  } catch (error) {
    await confirmOverlay({ title: "Delete Group", message: error.message, confirmLabel: "OK", danger: false });
  }
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
  const limit = Number(group.limit || 0) || SYNCED_GROUP_AVATAR_LIMIT;
  if (group.type === "synced" && Number(group.count ?? group.worlds?.length ?? 0) >= limit) return { ok: false, reason: `Synced groups can only contain ${limit} worlds.` };
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
      limit: Number(group.limit || 0),
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

async function unfavoriteWorldFromOverlay(button) {
  const worldId = button?.dataset?.unfavoriteWorld || "";
  if (!worldId) return;
  const entry = favoriteWorldEntry(worldId);
  const label = entry?.world?.name || findOverlayWorld(worldId)?.name || worldId;
  const confirmed = await confirmOverlay({
    title: "Unfavorite World",
    message: `Remove "${label}" from favorites?`,
    confirmLabel: "Unfav",
    danger: true
  });
  if (!confirmed) return;
  const restore = setBusy(button, "...");
  try {
    if (entry?.group?.type === "local" || String(entry?.group?.id || "").startsWith("local_world_")) {
      const groups = loadLocalWorldGroups();
      const local = groups.find((group) => group.key === entry.group.id);
      if (local) {
        local.worlds = (local.worlds || []).filter((world) => String(world.id || world.worldId || "").toLowerCase() !== String(worldId).toLowerCase());
        saveLocalWorldGroups(groups);
      }
    } else {
      await api("vrchatFavoriteWorldRemove", { id: worldId }, 45000);
    }
    await refresh();
    restore(button?.classList?.contains("favorite-star") ? undefined : "Unfav");
  } catch (error) {
    restore(button?.classList?.contains("favorite-star") ? undefined : "Unfav");
    await confirmOverlay({ title: "Unfavorite World", message: error.message, confirmLabel: "OK", danger: false });
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

function findOverlayAvatar(avatarId = "") {
  const id = String(avatarId || "").toLowerCase();
  if (!id) return null;
  const sources = [
    ...((state.data.avatarGroups || []).flatMap((group) => group.avatars || [])),
    state.data.current?.avatar || null
  ].filter(Boolean);
  return sources.find((avatar) => String(avatar.id || avatar.avatarId || "").toLowerCase() === id) || null;
}

async function saveAvatarByIdFromOverlay(button) {
  const avatarId = button.dataset.saveAvatar || "";
  if (!avatarId) return;
  const iconButton = button.classList.contains("favorite-star");
  const normalLabel = iconButton ? undefined : button.textContent || "Fav";
  const avatar = findOverlayAvatar(avatarId) || { id: avatarId, name: avatarId };
  const title = avatar.name || avatar.title || avatarId;
  const groups = saveTargetGroups(avatarId);
  if (!groups.length) {
    await confirmOverlay({ title: "No Groups", message: "Create or sync an avatar group first.", confirmLabel: "OK", danger: false });
    return;
  }
  const choice = await chooseOverlay({
    title: "Favorite Avatar",
    message: `Choose a group for "${title}".`,
    label: "Group",
    confirmLabel: "Favorite",
    options: groups.map((group) => ({
      value: group.id,
      disabled: !group.status.ok,
      label: `${group.name || "Avatar Group"} (${Number(group.count || 0)} avatars)${group.status.ok ? "" : ` - ${group.status.reason}`}`
    }))
  });
  if (!choice) return;
  const group = groups.find((item) => item.id === choice);
  const status = avatarSaveTargetStatus(group, avatarId);
  if (!status.ok) {
    await confirmOverlay({ title: "Favorite Avatar", message: status.reason, confirmLabel: "OK", danger: false });
    return;
  }
  const restore = setBusy(button, "...");
  try {
    await api("saveAvatar", {
      id: "",
      groupId: group.id,
      avatarId,
      name: avatar.name || avatar.title || "",
      authorName: avatar.authorName || avatar.subtitle || "",
      imageUrl: avatar.fullImageUrl || avatar.imageUrl || "",
      thumbnailImageUrl: avatar.imageUrl || "",
      releaseStatus: avatar.releaseStatus || "",
      platforms: avatar.platforms || "",
      source: avatar.source || "vrchat"
    }, 45000);
    if (isSyncedGroupId(group.id)) await api("vrchatFavoriteAdd", { avatarId, groupId: group.id }, 60000);
    await refresh();
    restore(iconButton ? undefined : "Saved");
    if (!iconButton) setTimeout(() => { if (button.isConnected) button.textContent = normalLabel; }, 900);
  } catch (error) {
    await confirmOverlay({ title: "Favorite Avatar", message: error.message, confirmLabel: "OK", danger: false });
    restore(normalLabel);
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
  const groupId = button.dataset.avatarGroup || activeGroup("avatars")?.id || "";
  const group = (state.data.avatarGroups || []).find((item) => item.id === groupId) || activeGroup("avatars");
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
    await confirmOverlay({ title: "Unfavorite Avatar", message: error.message, confirmLabel: "OK", danger: false });
  } finally {
    restore(button.classList.contains("favorite-star") ? undefined : "Unfav");
  }
}

async function openWorldFromOverlay(button) {
  const worldId = button.dataset.openWorld || "";
  if (!worldId) return;
  const choice = await chooseOverlay({
    title: "Join World",
    message: "Create an instance, invite yourself, or also invite friends from your current lobby.",
    label: "Instance type",
    confirmLabel: "Create Invite",
    options: [
      { value: "private|false", label: "Invite" },
      { value: "invite-plus|false", label: "Invite+" },
      { value: "friends|false", label: "Friends" },
      { value: "hidden|false", label: "Friends+" },
      { value: "public|false", label: "Public" },
      { value: "private|true", label: "Invite + invite current lobby" },
      { value: "invite-plus|true", label: "Invite+ + invite current lobby" },
      { value: "friends|true", label: "Friends + invite current lobby" },
      { value: "hidden|true", label: "Friends+ + invite current lobby" },
      { value: "public|true", label: "Public + invite current lobby" }
    ]
  });
  if (!choice) return;
  const [type, inviteCurrentLobby] = String(choice).split("|");
  const restore = setBusy(button, "...");
  try {
    await api("vrchatCreateWorldInstance", { worldId, type, region: "use", inviteCurrentInstanceFriends: inviteCurrentLobby === "true" }, inviteCurrentLobby === "true" ? 90000 : 60000);
    restore("Sent");
    setTimeout(() => { if (button.isConnected) button.textContent = "Join"; }, 900);
  } catch (error) {
    button.title = error.message;
    restore("Join");
  }
}

async function runFriendAction(button) {
  const userId = button.dataset.friendId || "";
  const action = button.dataset.friendAction || "";
  if (!userId || !action) return;
  let restoreBusy = null;
  const restoreLabel = action === "request" ? "Request" : action === "message" ? "Message" : "Invite";
  try {
    if (action === "invite") {
      const choice = await chooseOverlay({
        title: "Invite Friend",
        message: "Send the default invite or write a short invite message.",
        label: "Invite type",
        options: [
          { value: "default", label: "Default invite" },
          { value: "message", label: "With message" }
        ]
      });
      if (!choice) return;
      const instanceId = currentInstanceId();
      if (!instanceId) throw new Error("No current instance is available to invite from.");
      const restore = setBusy(button, "...");
      restoreBusy = restore;
      if (choice === "message") {
        const message = await textOverlay({ title: "Invite Message", message: "Send a VRChat invite with a custom message.", confirmLabel: "Send" });
        if (!message) {
          restore("Invite");
          return;
        }
        await api("vrchatSendChatMessage", { userId, message, mode: "invite" }, 45000);
      } else {
        await api("vrchatInviteUser", { userId, instanceId, messageSlot: 0 }, 45000);
      }
      restore("Sent");
      setTimeout(() => { if (button.isConnected) button.textContent = "Invite"; }, 900);
      return;
    }
    if (action === "request") {
      const choice = await chooseOverlay({
        title: "Request Invite",
        message: "Send the default request or write a short request message.",
        label: "Request type",
        options: [
          { value: "default", label: "Default request" },
          { value: "message", label: "With message" }
        ]
      });
      if (!choice) return;
      const restore = setBusy(button, "...");
      restoreBusy = restore;
      if (choice === "message") {
        const message = await textOverlay({ title: "Request Message", message: "Send a VRChat request invite with a custom message.", confirmLabel: "Send" });
        if (!message) {
          restore("Request");
          return;
        }
        await api("vrchatSendChatMessage", { userId, message, mode: "request" }, 45000);
      } else {
        await api("vrchatRequestInvite", { id: userId, messageSlot: 0 }, 45000);
      }
      restore("Sent");
      setTimeout(() => { if (button.isConnected) button.textContent = "Request"; }, 900);
      return;
    }
    if (action === "message") {
      const restore = setBusy(button, "...");
      restoreBusy = restore;
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
    restoreBusy?.(restoreLabel);
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

document.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  event.preventDefault();
  event.stopPropagation();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}, true);

document.addEventListener("click", (event) => {
  const menuToggle = event.target.closest("[data-database-menu-toggle]");
  if (menuToggle) {
    event.stopPropagation();
    toggleDatabaseMenu(menuToggle);
    return;
  }
  const panelSort = event.target.closest("[data-panel-sort]");
  if (panelSort) {
    const panel = panelSort.closest("[data-detached-panel]")?.dataset.detachedPanel || state.panel;
    if (PANEL_SORT_OPTIONS[panel]) state.sort[panel] = panelSort.dataset.panelSort || PANEL_SORT_OPTIONS[panel][0].value;
    hideDatabaseMenus();
    render();
    return;
  }
  const dock = event.target.closest("[data-dock-panel]");
  if (dock) {
    dockPanel(dock.dataset.dockPanel || state.panel);
    return;
  }
  const focus = event.target.closest("[data-focus-panel]");
  if (focus) {
    setPanel(focus.dataset.focusPanel || state.panel);
    return;
  }
  if (!event.target.closest(".overlay-select-control")) hideDatabaseMenus();
});

document.addEventListener("wheel", (event) => {
  if (event.target.closest("#groupSelectBtn, #groupDropdown")) {
    if (!["avatars", "worlds", "friends"].includes(state.panel)) return;
    event.preventDefault();
    event.stopPropagation();
    state.groupDropdownOpen = false;
    stepGroupIndex(state.panel, event.deltaY > 0 ? 1 : -1);
    render();
    return;
  }
  const toggle = event.target.closest("[data-database-menu-toggle]");
  if (!toggle) return;
  const menu = toggle.dataset.databaseMenuToggle || "";
  const direction = event.deltaY > 0 ? 1 : -1;
  const cycle = (options, current, setValue) => {
    if (!options?.length) return;
    const index = Math.max(0, options.findIndex((option) => option.value === current));
    setValue(options[(index + direction + options.length) % options.length].value);
    event.preventDefault();
    event.stopPropagation();
    hideDatabaseMenus();
    render();
  };
  if (menu === "panel-sort") {
    const panel = toggle.closest("[data-detached-panel]")?.dataset.detachedPanel || state.panel;
    cycle(PANEL_SORT_OPTIONS[panel] || [], state.sort[panel], (value) => { state.sort[panel] = value; });
    return;
  }
}, { passive: false });

document.querySelectorAll(".overlay-tabs button").forEach((button) => button.addEventListener("click", () => setPanel(button.dataset.panel)));
$("splitPanelBtn").addEventListener("click", () => {
  if (isDetached(state.panel)) dockPanel(state.panel);
  else detachPanel(state.panel);
});
$("prevGroupBtn").addEventListener("click", () => { state.groupDropdownOpen = false; stepGroupIndex(state.panel, -1); render(); });
$("nextGroupBtn").addEventListener("click", () => { state.groupDropdownOpen = false; stepGroupIndex(state.panel, 1); render(); });
$("groupSelectBtn").addEventListener("click", () => {
  if (!OVERLAY_PANELS.includes(state.panel)) return;
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
$("overlaySearchInput").addEventListener("pointerdown", () => {
  send("overlayBeginTextInput");
  setTimeout(() => $("overlaySearchInput").focus(), 50);
});
$("overlaySearchInput").addEventListener("focus", () => send("overlayBeginTextInput"));
$("overlaySearchInput").addEventListener("blur", () => send("overlayEndTextInput"));
$("overlaySearchInput").addEventListener("keydown", (event) => {
  if (event.key === "Escape" || event.key === "Enter") {
    event.preventDefault();
    $("overlaySearchInput").blur();
  }
});
window.addEventListener("storage", (event) => {
  if (event.key !== LOCAL_WORLD_GROUPS_KEY) return;
  if (state.panel === "worlds") state.groupIndex.worlds = Math.min(state.groupIndex.worlds || 0, Math.max(0, activeGroups("worlds").length - 1));
  render();
});
$("detachedPanels").addEventListener("input", (event) => {
  const input = event.target.closest("[data-detached-search]");
  if (!input) return;
  const panel = input.dataset.detachedSearch || "";
  if (!Object.prototype.hasOwnProperty.call(state.filters, panel)) return;
  state.filters[panel] = input.value;
  render();
});
$("detachedPanels").addEventListener("focusin", (event) => {
  if (event.target.closest("[data-detached-search]")) send("overlayBeginTextInput");
});
$("detachedPanels").addEventListener("focusout", (event) => {
  if (event.target.closest("[data-detached-search]")) send("overlayEndTextInput");
});
$("detachedPanels").addEventListener("keydown", (event) => {
  const input = event.target.closest("[data-detached-search]");
  if (!input) return;
  if (event.key === "Escape" || event.key === "Enter") {
    event.preventDefault();
    input.blur();
  }
});
$("detachedPanels").addEventListener("click", (event) => {
  const step = event.target.closest("[data-detached-group-step]");
  if (!step) return;
  const panel = step.closest("[data-detached-panel]")?.dataset.detachedPanel || "";
  if (!["avatars", "worlds", "friends"].includes(panel)) return;
  stepGroupIndex(panel, Number(step.dataset.detachedGroupStep) || 0);
  render();
});
$("detachedPanels").addEventListener("pointerdown", (event) => {
  const resize = event.target.closest("[data-detached-resize]");
  const drag = event.target.closest("[data-detached-drag]");
  const panel = resize?.dataset.detachedResize || drag?.dataset.detachedDrag || "";
  if (!panel || !state.detachedPanels[panel]) return;
  if (event.target.closest("button, input, .overlay-select-menu")) return;
  event.preventDefault();
  const startX = event.clientX;
  const startY = event.clientY;
  const start = { ...state.detachedPanels[panel] };
  const shell = document.querySelector(".overlay-shell").getBoundingClientRect();
  const move = (moveEvent) => {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (resize) {
      state.detachedPanels[panel].width = Math.max(260, Math.min(shell.width - 16, start.width + dx));
      state.detachedPanels[panel].height = Math.max(300, Math.min(shell.height - 16, start.height + dy));
    } else {
      const width = Number(start.width) || 340;
      const height = Number(start.height) || 460;
      state.detachedPanels[panel].x = Math.max(4, Math.min(shell.width - width - 4, start.x + dx));
      state.detachedPanels[panel].y = Math.max(4, Math.min(shell.height - height - 4, start.y + dy));
    }
    const el = document.querySelector(`[data-detached-panel="${panel}"]`);
    if (el) {
      el.style.left = `${state.detachedPanels[panel].x}px`;
      el.style.top = `${state.detachedPanels[panel].y}px`;
      el.style.width = `${state.detachedPanels[panel].width}px`;
      el.style.height = `${state.detachedPanels[panel].height}px`;
    }
  };
  const up = () => {
    saveDetachedPanels();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
});
$("detailPanels").addEventListener("click", (event) => {
  const close = event.target.closest("[data-detail-close]");
  if (close) {
    event.stopPropagation();
    closeDetailPanel(close.dataset.detailClose || "");
    return;
  }
  const avatarOpen = event.target.closest("[data-avatar-detail-open]");
  if (avatarOpen) {
    event.stopPropagation();
    void openAvatarDetail({ id: avatarOpen.dataset.avatarDetailOpen || "", name: avatarOpen.dataset.avatarName || "" });
  }
});
$("detailPanels").addEventListener("pointerdown", (event) => {
  const drag = event.target.closest("[data-detail-drag]");
  const kind = drag?.dataset.detailDrag || "";
  if (!kind || !state.detailPanels[kind]?.open) return;
  if (event.target.closest("button, input, textarea, select")) return;
  event.preventDefault();
  const startX = event.clientX;
  const startY = event.clientY;
  const start = detailPosition(kind);
  const shell = document.querySelector(".overlay-shell").getBoundingClientRect();
  const move = (moveEvent) => {
    const el = document.querySelector(`[data-detail-panel="${kind}"]`);
    const width = el?.offsetWidth || 390;
    const height = el?.offsetHeight || 470;
    state.detailPositions[kind] = {
      x: Math.max(4, Math.min(shell.width - width - 4, start.x + moveEvent.clientX - startX)),
      y: Math.max(4, Math.min(shell.height - height - 4, start.y + moveEvent.clientY - startY))
    };
    if (el) {
      el.style.left = `${state.detailPositions[kind].x}px`;
      el.style.top = `${state.detailPositions[kind].y}px`;
    }
  };
  const up = () => {
    saveDetailPositions();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
});
async function handleOverlayContentClick(event) {
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
    const detailWorld = state.detailPanels.world?.item?.id === worldId ? state.detailPanels.world.item : null;
    const world = findOverlayWorld(worldId) || detailWorld || state.data.current?.world || null;
    await saveWorldById(worldId, world, saveWorld);
    return;
  }
  const unfavoriteWorld = event.target.closest("[data-unfavorite-world]");
  if (unfavoriteWorld) {
    event.stopPropagation();
    await unfavoriteWorldFromOverlay(unfavoriteWorld);
    return;
  }
  const friendAction = event.target.closest("[data-friend-action]");
  if (friendAction) {
    event.stopPropagation();
    await runFriendAction(friendAction);
    return;
  }
  const groupAdd = event.target.closest("[data-group-add]");
  if (groupAdd) {
    event.stopPropagation();
    await addGroupFromOverlay(groupAdd.dataset.groupAdd || state.panel);
    return;
  }
  const groupEdit = event.target.closest("[data-group-edit]");
  if (groupEdit) {
    event.stopPropagation();
    await editGroupFromOverlay(groupEdit.dataset.groupEdit || state.panel);
    return;
  }
  const groupDelete = event.target.closest("[data-group-delete]");
  if (groupDelete) {
    event.stopPropagation();
    await deleteGroupFromOverlay(groupDelete.dataset.groupDelete || state.panel);
    return;
  }
  const randomAvatar = event.target.closest("[data-random-avatar]");
  if (randomAvatar) {
    event.stopPropagation();
    await randomAvatarFromOverlay(randomAvatar);
    return;
  }
  const avatarRoulette = event.target.closest("[data-avatar-roulette]");
  if (avatarRoulette) {
    event.stopPropagation();
    await toggleAvatarRoulette(avatarRoulette);
    return;
  }
  const randomWorld = event.target.closest("[data-random-world]");
  if (randomWorld) {
    event.stopPropagation();
    await randomWorldFromOverlay(randomWorld);
    return;
  }
  const saveAvatar = event.target.closest("[data-save-avatar]");
  if (saveAvatar) {
    event.stopPropagation();
    await saveAvatarByIdFromOverlay(saveAvatar);
    return;
  }
  const equip = event.target.closest("[data-equip-avatar]");
  if (equip) {
    event.stopPropagation();
    const id = equip.dataset.equipAvatar || "";
    if (!id) return;
    await equipAvatarIdFromOverlay(id, equip, "Equip");
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
    const id = worldRowEl.dataset.worldId || "";
    await openWorldDetail(findOverlayWorld(id) || { id });
    return;
  }
  const friendRowEl = event.target.closest("[data-friend-id]");
  if (friendRowEl) {
    const id = friendRowEl.dataset.friendId || "";
    await openUserDetail(findOverlayFriend(id) || { id });
    return;
  }
  const row = event.target.closest("[data-avatar-id]");
  if (row) {
    const id = row.dataset.avatarId || "";
    await openAvatarDetail(findOverlayAvatar(id) || { id });
    return;
  }
}
$("content").addEventListener("click", handleOverlayContentClick);
$("overlayActions").addEventListener("click", handleOverlayContentClick);
$("detachedPanels").addEventListener("click", handleOverlayContentClick);
$("detailPanels").addEventListener("click", handleOverlayContentClick);
$("saveCurrentAvatarOverlayBtn").addEventListener("click", openSaveCurrentAvatarDialog);
$("saveCurrentWorldOverlayBtn").addEventListener("click", saveCurrentWorldFromOverlay);

installWindowControls();
hydrateCachedSnapshot();
render();
showFirstOpenTip();
refreshSettingsFast();
refresh();
void refreshOverlayHostMode();
setInterval(() => { void refreshOverlayHostMode(); }, 180);
