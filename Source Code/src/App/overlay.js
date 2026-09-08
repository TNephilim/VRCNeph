const OVERLAY_CACHE_KEY = "vrcneph.overlay.snapshot.v1";
const OVERLAY_SETTINGS_CACHE_KEY = "vrcneph.overlay.settings.v1";
const OVERLAY_TAB_TIP_SEEN_KEY = "vrcneph.overlay.tabTipSeen.v1";
const OVERLAY_DETAIL_POSITIONS_KEY = "vrcneph.overlay.detailPositions.v1";
const SYNCED_GROUP_AVATAR_LIMIT = 50;
const OVERLAY_PANELS = ["avatars", "friends"];
const PANEL_SORT_OPTIONS = {
  avatars: [
    { value: "updatedDesc", label: "Recently updated" },
    { value: "manual", label: "Custom order" },
    { value: "createdDesc", label: "Recently added" },
    { value: "nameAsc", label: "Name A-Z" },
    { value: "authorAsc", label: "Author A-Z" }
  ],
};
const appStateStore = { ready: false, values: new Map(), pending: new Map(), promise: null };
let equipNoticeFadeTimer = null;
let equipNoticeImageToken = 0;
let equipNoticeImageLoadCancel = null;

function loadOverlayJson(key, fallback = null) {
  if (appStateStore.values.has(key)) return appStateStore.values.get(key);
  try { return JSON.parse(localStorage.getItem(key) || "") || fallback; } catch { return fallback; }
}

function saveOverlayJson(key, value) {
  appStateStore.values.set(key, value);
  if (!appStateStore.ready) {
    appStateStore.pending.set(key, value);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
    return;
  }
  void api("appStateSave", { key, value }, 30000).catch(() => {});
  try { localStorage.removeItem(key); } catch { }
}

function loadOverlayFlag(key) {
  const value = loadOverlayJson(key, false);
  return value === true || value === "true";
}

function saveOverlayFlag(key) {
  saveOverlayJson(key, true);
}

const state = {
  panel: "avatars",
  groupIndex: { avatars: 0, friends: 0 },
  selectedAvatarId: "",
  selectedFriendId: "",
  filters: { avatars: "", friends: "" },
  sort: { avatars: "updatedDesc", friends: "presence" },
  detailPositions: loadOverlayJson(OVERLAY_DETAIL_POSITIONS_KEY, {}),
  detailPanels: {
    avatar: { open: false, item: null, loading: false, error: "", token: 0 },
    user: { open: false, item: null, loading: false, error: "", token: 0 }
  },
  roulette: { avatars: 0, intervals: { avatars: 60000 }, running: { avatars: false } },
  groupDropdownOpen: false,
  data: {
    settings: loadOverlayJson(OVERLAY_SETTINGS_CACHE_KEY, {}),
    avatarGroups: [],
    friendGroups: [],
    friends: [],
    session: null
  },
  pending: new Map(),
  friendPresenceOverrides: new Map(),
  pendingFriendPresenceById: new Map(),
  pipelineStatus: {}
};

let overlayHostMode = "";
let overlayHostToken = "";
let overlayFriendRefreshTimer = null;

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const classToken = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";

function handleNativeMessage(message) {
  const response = JSON.parse(message);
  if (response.event) {
    if (response.event === "overlayRefresh") {
      applyOverlaySnapshot(response.data);
    }
    if (response.event === "vrchatPipeline") {
      applyOverlayPipelineEvent(response.data);
    }
    if (response.event === "vrchatPipelineStatus") {
      state.pipelineStatus = response.data || {};
    }
    if (response.event === "overlaySettingsPreview") {
      state.data = { ...state.data, settings: { ...(state.data?.settings || {}), ...(response.data || {}) } };
      applySnapshotSettings();
    }
    if (response.event === "overlayEquipNotice") {
      void showEquipNotice(response.data, overlayHostToken);
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
  state.data = applyOverlayPresenceOverrides(snapshot || state.data);
  saveOverlayJson(OVERLAY_CACHE_KEY, state.data);
  if (state.data?.settings) saveOverlayJson(OVERLAY_SETTINGS_CACHE_KEY, state.data.settings);
  render();
}

function applyOverlayPresenceOverrides(snapshot) {
  const data = { ...(snapshot || {}) };
  const overrides = state.friendPresenceOverrides;
  if (!overrides?.size) return data;
  const applyGroup = (group) => {
    const friends = [...(group?.friends || [])];
    const next = [];
    for (const friend of friends) {
      const id = String(friend?.id || friend?.userId || "").toLowerCase();
      const override = id ? overrides.get(id) : null;
      if (override?.deleted) continue;
      next.push(override?.patch ? { ...friend, ...override.patch } : friend);
    }
    for (const [id, override] of overrides) {
      if (!override?.patch || override.deleted || String(group?.id || "").toLowerCase() !== "all") continue;
      if (!next.some((friend) => String(friend?.id || friend?.userId || "").toLowerCase() === id)) next.push(override.patch);
    }
    return { ...group, friends: next };
  };
  data.friendGroups = (data.friendGroups || []).map(applyGroup);
  data.friends = (data.friends || []).filter((friend) => {
    const id = String(friend?.id || friend?.userId || "").toLowerCase();
    return !overrides.get(id)?.deleted;
  }).map((friend) => {
    const id = String(friend?.id || friend?.userId || "").toLowerCase();
    return overrides.get(id)?.patch ? { ...friend, ...overrides.get(id).patch } : friend;
  });
  for (const [id, override] of overrides) {
    if (override?.patch && !override.deleted && !data.friends.some((friend) => String(friend?.id || friend?.userId || "").toLowerCase() === id)) data.friends.push(override.patch);
  }
  return data;
}

function scheduleOverlayFriendRefresh() {
  if (overlayHostMode !== "panel") return;
  clearTimeout(overlayFriendRefreshTimer);
  overlayFriendRefreshTimer = setTimeout(() => {
    overlayFriendRefreshTimer = null;
    void refresh();
  }, 1200);
}

function cancelOverlayPendingFriendPresence(userId) {
  const id = String(userId || "").toLowerCase();
  const pending = state.pendingFriendPresenceById.get(id);
  if (!pending) return;
  clearTimeout(pending.timer);
  state.pendingFriendPresenceById.delete(id);
}

function queueOverlayPendingFriendPresence(userId, event, nextPresence, currentPresence) {
  const id = String(userId || "").toLowerCase();
  const content = window.VRCNephShared.pipelineRecord(event?.content || {});
  if (!id || content.__pendingApplied || currentPresence !== "online" || !["offline", "active"].includes(nextPresence)) return false;
  if (state.pendingFriendPresenceById.has(id)) return true;
  const timer = setTimeout(() => {
    state.pendingFriendPresenceById.delete(id);
    const current = findOverlayFriend(id) || {};
    if (friendPresence(current) === "online") applyOverlayPipelineEvent({ ...event, content: { ...content, __pendingApplied: true } });
  }, 3 * 60 * 1000);
  state.pendingFriendPresenceById.set(id, { timer, startedAt: Date.now(), type: event?.type || "" });
  return true;
}

function applyOverlayPipelineEvent(event = {}) {
  const type = String(event?.type || "").trim().toLowerCase();
  if (!type.startsWith("friend-")) return;
  const content = window.VRCNephShared.pipelineRecord(event?.content || {});
  const user = window.VRCNephShared.pipelineUserObject(content);
  const userId = String(window.VRCNephShared.pipelineText(content.userId, content.senderUserId, content.id, user.id, user.userId) || "").trim();
  if (!userId) return;
  const current = findOverlayFriend(userId) || { id: userId };
  if (type === "friend-delete") {
    cancelOverlayPendingFriendPresence(userId);
    state.friendPresenceOverrides.set(userId.toLowerCase(), { deleted: true });
    state.data.friendGroups = (state.data.friendGroups || []).map((group) => ({
      ...group,
      friends: (group.friends || []).filter((friend) => String(friend.id || friend.userId || "").toLowerCase() !== userId.toLowerCase())
    }));
    state.data.friends = (state.data.friends || []).filter((friend) => String(friend.id || friend.userId || "").toLowerCase() !== userId.toLowerCase());
    render();
    scheduleOverlayFriendRefresh();
    return;
  }

  const patch = window.VRCNephShared.friendEventPatch(type, content, current);
  const nextPresence = String(patch.presence || "").toLowerCase();
  const currentPresence = friendPresence(current);
  if (nextPresence === "online") cancelOverlayPendingFriendPresence(userId);
  if (queueOverlayPendingFriendPresence(userId, event, nextPresence, currentPresence)) return;
  state.friendPresenceOverrides.set(userId.toLowerCase(), { patch });
  let found = false;
  state.data.friendGroups = (state.data.friendGroups || []).map((group) => {
    const friends = [...(group.friends || [])];
    const index = friends.findIndex((friend) => String(friend.id || friend.userId || "").toLowerCase() === userId.toLowerCase());
    if (index >= 0) {
      friends[index] = { ...friends[index], ...patch };
      found = true;
    } else if (type === "friend-add" && String(group.id || "").toLowerCase() === "all") {
      friends.push(patch);
      found = true;
    }
    return { ...group, friends };
  });
  state.data.friends = (state.data.friends || []).map((friend) => String(friend.id || friend.userId || "").toLowerCase() === userId.toLowerCase() ? { ...friend, ...patch } : friend);
  if (!state.data.friends.some((friend) => String(friend.id || friend.userId || "").toLowerCase() === userId.toLowerCase()) && type === "friend-add") state.data.friends.unshift(patch);
  if (found || type === "friend-add") render();
  scheduleOverlayFriendRefresh();
}

function cancelEquipNoticeImageLoad() {
  if (typeof equipNoticeImageLoadCancel === "function") equipNoticeImageLoadCancel();
  equipNoticeImageLoadCancel = null;
}

function resetEquipNoticeImage() {
  const current = $("equipNoticeImage");
  if (!current) return;
  const placeholder = document.createElement("img");
  placeholder.id = "equipNoticeImage";
  placeholder.alt = "";
  placeholder.hidden = true;
  current.replaceWith(placeholder);
}

function equipNoticeImageSource(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(?:https?|data|blob|file):/i.test(raw)) return raw;
  if (/^[A-Za-z]:[\\/]/.test(raw)) return `file:///${encodeURI(raw.replace(/\\/g, "/"))}`;
  if (/^\\\\/.test(raw)) return `file:${encodeURI(raw.replace(/\\/g, "/"))}`;
  return raw;
}

function preloadEquipNoticeImage(urls, renderToken) {
  const candidates = [...new Set((urls || []).map(equipNoticeImageSource).filter(Boolean))];
  if (!candidates.length) return Promise.resolve(null);

  return new Promise((resolve) => {
    let currentImage = null;
    let candidateIndex = 0;
    let settled = false;
    let cancel = () => {};

    const cleanup = () => {
      if (currentImage) {
        currentImage.onload = null;
        currentImage.onerror = null;
      }
      if (equipNoticeImageLoadCancel === cancel) equipNoticeImageLoadCancel = null;
    };
    const finish = (image) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(image);
    };
    cancel = () => finish(null);
    equipNoticeImageLoadCancel = cancel;

    const loadNext = () => {
      if (settled) return;
      if (renderToken !== equipNoticeImageToken) {
        finish(null);
        return;
      }
      const url = candidates[candidateIndex++];
      if (!url) {
        finish(null);
        return;
      }

      const image = new Image();
      currentImage = image;
      image.decoding = "async";
      image.onload = async () => {
        try {
          if (typeof image.decode === "function") await image.decode();
        } catch { }
        if (renderToken !== equipNoticeImageToken) {
          finish(null);
          return;
        }
        finish(image);
      };
      image.onerror = loadNext;
      image.src = url;
    };

    loadNext();
  });
}

async function showEquipNotice(notice = {}, hostToken = "") {
  const noticeElement = $("equipNotice");
  if (!noticeElement) return;

  const renderToken = ++equipNoticeImageToken;
  cancelEquipNoticeImageLoad();
  if (equipNoticeFadeTimer) {
    clearTimeout(equipNoticeFadeTimer);
    equipNoticeFadeTimer = null;
  }

  // Keep the complete previous notice hidden while the next avatar's image is
  // decoded. The visible card is committed only after its data belongs to the
  // same notice, so text and imagery can never come from different avatars.
  noticeElement.classList.remove("is-fading-out");
  noticeElement.hidden = true;
  document.body.classList.add("equip-notice-mode");
  resetEquipNoticeImage();

  state.data.settings = { ...(state.data.settings || {}), themeColor: notice.themeColor || "", panelColor: notice.panelColor || "", panelColorSynced: false, overlayOpacity: notice.panelOpacity || 85, overlayScale: 100 };
  applySnapshotSettings();

  const name = String(notice.name || "Avatar equipped").trim() || "Avatar equipped";
  const author = String(notice.authorName || "").trim();
  const image = await preloadEquipNoticeImage([notice.imageOverridePath, notice.thumbnailImageUrl, notice.imageUrl], renderToken);
  if (renderToken !== equipNoticeImageToken) return;
  if (hostToken && overlayHostToken && hostToken !== overlayHostToken) return;

  const fallback = $("equipNoticeFallback");
  $("equipNoticeName").textContent = name;
  $("equipNoticeAuthor").textContent = author ? `by ${author}` : "Author unavailable";

  const badges = [];
  const release = String(notice.releaseStatus || "").trim();
  const releaseBadge = equipNoticeReleaseBadge(release);
  if (releaseBadge) badges.push(releaseBadge);
  badges.push(...equipNoticePlatformBadges(notice.platforms));
  $("equipNoticeBadges").replaceChildren(...badges.slice(0, 3).map(({ label, className }) => { const badge = document.createElement("span"); badge.className = `overlay-equip-notice-badge ${className}`; badge.textContent = label; return badge; }));

  if (image) {
    image.id = "equipNoticeImage";
    image.alt = "";
    image.hidden = false;
    $("equipNoticeImage").replaceWith(image);
    fallback.hidden = true;
  } else {
    resetEquipNoticeImage();
    fallback.hidden = false;
  }

  noticeElement.hidden = false;
  const readyToken = hostToken || overlayHostToken;
  requestAnimationFrame(() => {
    if (renderToken !== equipNoticeImageToken || noticeElement.hidden) return;
    send("overlayNoticeReady", { token: readyToken });
  });
  equipNoticeFadeTimer = setTimeout(() => {
    if (renderToken === equipNoticeImageToken && !noticeElement.hidden) noticeElement.classList.add("is-fading-out");
  }, 4720);
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

async function hydrateOverlayAppState() {
  if (appStateStore.promise) return appStateStore.promise;
  appStateStore.promise = (async () => {
    let persisted = {};
    try { persisted = await api("appStateLoad", {}, 30000) || {}; } catch { }
    const local = {};
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith("vrcneph.")) continue;
      try { local[key] = JSON.parse(localStorage.getItem(key) || ""); } catch { }
    }
    const merged = { ...local, ...(persisted || {}) };
    for (const [key, value] of appStateStore.pending.entries()) merged[key] = value;
    appStateStore.values = new Map(Object.entries(merged));
    appStateStore.ready = true;
    const writes = [];
    for (const [key, value] of Object.entries(merged)) {
      if (!Object.prototype.hasOwnProperty.call(persisted || {}, key) || appStateStore.pending.has(key)) writes.push(api("appStateSave", { key, value }, 30000).catch(() => {}));
      try { localStorage.removeItem(key); } catch { }
    }
    await Promise.all(writes);
    state.detailPositions = loadOverlayJson(OVERLAY_DETAIL_POSITIONS_KEY, {});
    state.data.settings = loadOverlayJson(OVERLAY_SETTINGS_CACHE_KEY, state.data.settings || {});
    hydrateCachedSnapshot();
    render();
  })();
  return appStateStore.promise;
}

function applyOverlayHostState(host = {}) {
    const mode = String(host?.mode || "hidden").toLowerCase();
    const token = String(host?.token || "");
    const previousMode = overlayHostMode;
    const previousToken = overlayHostToken;
    overlayHostMode = mode;
    overlayHostToken = token;
    if (mode === "panel" && previousMode !== "panel") void refresh();
    if (mode === "notice" && (previousMode !== "notice" || previousToken !== token)) {
      void showEquipNotice(host?.notice || {}, token);
    } else if (mode !== "notice") {
      ++equipNoticeImageToken;
      cancelEquipNoticeImageLoad();
      if (equipNoticeFadeTimer) {
        clearTimeout(equipNoticeFadeTimer);
        equipNoticeFadeTimer = null;
      }
      $("equipNotice").hidden = true;
      document.body.classList.remove("equip-notice-mode");
    }
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
  if (panel === "friends") return "friendGroups";
  return "avatarGroups";
}

function panelItemKey(panel = state.panel) {
  if (panel === "friends") return "friends";
  return "avatars";
}

function activeGroups(panel = state.panel) {
  if (!["avatars", "friends"].includes(panel)) return [];
  return state.data[panelGroupKey(panel)] || [];
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

function panelControlsHtml(panel = state.panel) {
  const options = PANEL_SORT_OPTIONS[panel];
  if (!options) return "";
  const actions = panel === "avatars"
    ? `<button type="button" data-random-avatar>Random</button><button type="button" data-avatar-roulette>${state.roulette.running.avatars ? "Running" : "Roulette"}</button>`
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
  if (panel === "friends") {
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

function saveDetailPositions() {
  saveOverlayJson(OVERLAY_DETAIL_POSITIONS_KEY, state.detailPositions);
}

function detailPosition(kind) {
  const defaults = {
    avatar: { x: 18, y: 70 },
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
  const id = String(groupId || "").toLowerCase();
  return id.startsWith("vrc_") || id === "uploaded_avatars";
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
  const location = state.data.session || {};
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

async function equipAvatarIdFromOverlay(id, button = null, restoreLabel = "Equip", options = {}) {
  if (!id) return false;
  const restore = button ? setBusy(button, "...") : null;
  try {
    const avatarMeta = findOverlayAvatar(id) || state.detailPanels.avatar?.item || { id, name: id };
    await api("overlayBridgeRequest", {
      command: "equip-avatar",
      payload: { avatarId: id, avatarMeta, awaitCompletion: options.waitForConfirm === true }
    }, options.waitForConfirm ? 600000 : 30000);
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

function friendImage(friend) {
  const presence = friendPresence(friend);
  return `<div class="friend-thumb">${imageHtml({ imageUrl: friend.imageUrl || friend.currentAvatarThumbnailImageUrl }, friend.displayName)}<span class="${escapeHtml(userStatusDotClass(friend.status, presence, friendStatusLimited(friend, presence)))}" aria-hidden="true"></span></div>`;
}

function friendLocation(friend) {
  return window.VRCNephShared.friendLocationLabel(friend);
}

function friendJoinLocation(friend = {}) {
  const location = String(friend.location || "").trim();
  return /^wrld_[^:]+:.+/i.test(location) ? location : "";
}

function friendPresence(friend) {
  return window.VRCNephShared.normalizeFriendPresence(friend);
}

function normalizedVrchatStatus(status = "") {
  return window.VRCNephShared.normalizedStatus(status);
}

function userStatusClass(status, presence = "") {
  return window.VRCNephShared.userStatusClass(status, presence);
}

function userStatusLabel(status, presence = "") {
  return window.VRCNephShared.userStatusLabel(status, presence);
}

function userStatusDotClass(status, presence = "", limited = false) {
  return window.VRCNephShared.userStatusDotClass(status, presence, limited);
}

function friendStatusLimited(friend, presence = friendPresence(friend)) {
  return window.VRCNephShared.friendStatusLimited(friend, presence);
}

function friendPresenceRank(friend) {
  return window.VRCNephShared.friendPresenceRank(friend);
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
  return window.VRCNephShared.sortFriends(friends);
}

function friendsSectionHtml(label, friends) {
  if (!friends.length) return "";
  return `<section class="friend-section"><h3>${escapeHtml(label)}</h3>${friends.map(friendRow).join("")}</section>`;
}

function friendsGroupedHtml(friends) {
  const online = friends.filter((friend) => friendPresence(friend) === "online");
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
  const statusClass = userStatusClass(friend.status, presence);
  const statusLabel = userStatusLabel(friend.status, presence);
  const selected = detailPanelMatches("user", friend.id);
  const joinLocation = friendJoinLocation(friend);
  const actions = [
    `<button class="row-action" type="button" data-friend-action="join" data-friend-id="${escapeHtml(friend.id || "")}" ${joinLocation ? "" : "disabled"}>Join</button>`,
    `<button class="row-action" type="button" data-friend-action="invite" data-friend-id="${escapeHtml(friend.id || "")}">Invite</button>`,
    `<button class="row-action" type="button" data-friend-action="message" data-friend-id="${escapeHtml(friend.id || "")}">Message</button>`
  ].filter(Boolean).join("");
  return `<article class="overlay-row friend-row ${selected ? "selected" : ""}" data-friend-id="${escapeHtml(friend.id || "")}">
    ${friendImage(friend)}
    <div class="row-main">
      <div class="row-title friend-name-rank ${escapeHtml(trustRankClass(friend))}">${escapeHtml(title)}</div>
      <div class="row-subtitle">${escapeHtml(friend.statusDescription || friendLocation(friend))}</div>
      <div class="chips">${chip(statusLabel, statusClass)}</div>
    </div>
    <div class="row-actions friend-actions">${actions}</div>
  </article>`;
}

function renderGroupDropdown() {
  const dropdown = $("groupDropdown");
  dropdown.classList.toggle("tall", state.panel === "avatars");
  const groups = activeGroups();
  const itemKey = panelItemKey();
  dropdown.hidden = !OVERLAY_PANELS.includes(state.panel) || !state.groupDropdownOpen || groups.length <= 1;
  if (dropdown.hidden) {
    dropdown.innerHTML = "";
    return;
  }
  dropdown.innerHTML = groups.map((group, index) => `<button class="${index === (state.groupIndex[state.panel] || 0) ? "active" : ""}" type="button" data-group-index="${index}">
    <strong>${escapeHtml(group.name || "Unnamed group")}</strong>
    <span>${escapeHtml(groupCountLabel(group, Number(group.count ?? (group[itemKey] || []).length), itemKey))}</span>
  </button>`).join("");
}

function panelView(panel) {
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
      tools: panelControlsHtml("avatars"),
      content: visibleAvatars.length ? visibleAvatars.map(avatarRow).join("") : emptyHtml("No avatars in this group", "Pick another group or add avatars in the main app.")
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
      tools: panelControlsHtml("friends"),
      content: friends.length ? friendsGroupedHtml(friends) : emptyHtml("No friends loaded", "Refresh the overlay after logging in, or check the main app connection.")
    };
  }
  return {
    title: "Unavailable",
    count: "",
    hasGroups: false,
    content: emptyHtml("Panel unavailable", "Choose Avatars or Friends.")
  };
}

function emptyHtml(title, message) {
  return `<section class="empty-panel"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></section>`;
}

function applyMainPanelView() {
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

function normalizeUserDetail(item = {}) {
  return { ...item, id: item.id || item.userId || "" };
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

function userDetailBody(panel) {
  const user = normalizeUserDetail(panel.item || {});
  const title = user.displayName || user.id || "User";
  const presence = friendPresence(user);
  const statusLabel = userStatusLabel(user.status, presence);
  const avatarId = user.currentAvatarId || "";
  const isFriend = user.isFriend === true;
  const isBlocked = user.isBlocked === true;
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
    user.id && !isFriend && !isBlocked ? `<button type="button" data-friend-action="friend" data-friend-id="${escapeHtml(user.id)}">Friend</button>` : "",
    user.id && isFriend ? `<button type="button" class="danger" data-friend-action="unfriend" data-friend-id="${escapeHtml(user.id)}">Unfriend</button>` : "",
    user.id && isBlocked ? `<button type="button" data-friend-action="unblock" data-friend-id="${escapeHtml(user.id)}">Unblock</button>` : user.id ? `<button type="button" class="danger" data-friend-action="block" data-friend-id="${escapeHtml(user.id)}">Block</button>` : "",
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
  const titles = { avatar: "Avatar Details", user: "User Details" };
  const item = panel.item || {};
  const subtitle = kind === "user" ? item.displayName || item.id : item.name || item.id || item.avatarId || "";
  const body = kind === "avatar" ? avatarDetailBody(panel) : userDetailBody(panel);
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
  const panelControls = panelControlsHtml(state.panel);
  $("overlayActions").hidden = !searchable;
  $("overlayActions").classList.toggle("no-controls", !panelControls);
  $("overlaySearchInput").hidden = !searchable;
  $("overlaySearchInput").value = state.filters[state.panel] || "";
  $("overlaySearchInput").placeholder = state.panel === "friends" ? "Search friends" : "Search avatars";
  $("overlayDatabaseControls").hidden = !panelControls;
  $("overlayDatabaseControls").innerHTML = panelControls;
  applyMainPanelView();
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
  const { worldGroups: _worldGroups, worlds: _worlds, current: _current, ...supported } = cached;
  state.data = {
    ...state.data,
    ...supported,
    settings: {
      ...(state.data.settings || {}),
      ...(cached.settings || {})
    }
  };
}

function applySnapshotSettings() {
  const settings = state.data.settings || {};
  const opacity = Math.min(100, Math.max(45, Number(settings.overlayOpacity) || 85)) / 100;
  const scale = 1;
  const theme = hexToRgb(settings.themeColor) || hexToRgb("#303735");
  const panel = hexToRgb(settings.panelColorSynced === false ? settings.panelColor : settings.themeColor) || theme;
  const appBase = { r: 18, g: 22, b: 20 };
  const appPanel = mixRgb(appBase, panel, 0.16);
  const appPanel2 = mixRgb(appBase, panel, 0.28);
  const line = mixRgb(appBase, panel, 0.48);
  document.documentElement.style.setProperty("--overlay-opacity", String(opacity));
  document.documentElement.style.setProperty("--overlay-scale", String(scale));
  document.documentElement.style.setProperty("--overlay-accent", settings.themeColor || "#303735");
  document.documentElement.style.setProperty("--overlay-bg", rgba(appPanel, opacity));
  document.documentElement.style.setProperty("--overlay-bg-strong", rgba(appPanel2, opacity));
  document.documentElement.style.setProperty("--overlay-bg-soft", rgba(appPanel, opacity * 0.72));
  document.documentElement.style.setProperty("--overlay-line", rgba(line, 0.82));
  document.documentElement.style.setProperty("--overlay-line-strong", rgba(theme, 0.72));
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
  const resizeZones = [...document.querySelectorAll(".resize-zone")];
  let drag = null;
  let resize = null;
  let lastMotionAt = 0;
  const motionInterval = 12;
  const canSendMotion = () => {
    const now = performance.now();
    if (now - lastMotionAt < motionInterval) return false;
    lastMotionAt = now;
    return true;
  };
  const finishDrag = (event) => {
    if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
    const dx = Math.round(event.screenX - drag.x);
    const dy = Math.round(event.screenY - drag.y);
    if ((dx || dy) && canSendMotion()) send("overlayMoveWindow", { dx, dy });
    drag = null;
  };
  const finishResize = (event) => {
    if (!resize || (event.pointerId != null && event.pointerId !== resize.pointerId)) return;
    const dx = Math.round(event.screenX - resize.x);
    const dy = Math.round(event.screenY - resize.y);
    if ((dx || dy) && canSendMotion()) send("overlayResizeWindow", { edges: resize.edges, dx, dy });
    resize = null;
  };
  const finishPointer = (event) => {
    finishDrag(event);
    finishResize(event);
  };

  dragHandle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    resize = null;
    drag = { pointerId: event.pointerId, x: event.screenX, y: event.screenY };
    lastMotionAt = 0;
    try { dragHandle.setPointerCapture(event.pointerId); } catch { }
    event.preventDefault();
    event.stopPropagation();
  });

  resizeZones.forEach((zone) => {
    zone.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      drag = null;
      resize = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, edges: zone.dataset.resizeEdge || "se" };
      lastMotionAt = 0;
      try { zone.setPointerCapture(event.pointerId); } catch { }
      event.preventDefault();
      event.stopPropagation();
    });
  });

  // Keep the gesture alive at the document level. Native window resizing can
  // move the edge element under the pointer, which otherwise loses its local
  // pointer stream and leaves the next drag in a stale state.
  document.addEventListener("pointermove", (event) => {
    if (drag && event.pointerId === drag.pointerId) {
      if (!canSendMotion()) return;
      const dx = Math.round(event.screenX - drag.x);
      const dy = Math.round(event.screenY - drag.y);
      if (!(dx || dy)) return;
      drag = { ...drag, x: event.screenX, y: event.screenY };
      send("overlayMoveWindow", { dx, dy });
      event.preventDefault();
      return;
    }
    if (resize && event.pointerId === resize.pointerId) {
      if (!canSendMotion()) return;
      const dx = Math.round(event.screenX - resize.x);
      const dy = Math.round(event.screenY - resize.y);
      if (!(dx || dy)) return;
      resize = { ...resize, x: event.screenX, y: event.screenY };
      send("overlayResizeWindow", { edges: resize.edges, dx, dy });
      event.preventDefault();
    }
  }, true);
  window.addEventListener("pointerup", finishPointer);
  window.addEventListener("pointercancel", finishPointer);
  window.addEventListener("blur", () => { drag = null; resize = null; });
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

function findOverlayAvatar(avatarId = "") {
  const id = String(avatarId || "").toLowerCase();
  if (!id) return null;
  const sources = [
    ...((state.data.avatarGroups || []).flatMap((group) => group.avatars || []))
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
    await api("overlayBridgeRequest", {
      command: "favorite-add",
      payload: { groupId: group.id, avatarId, avatar }
    }, 60000);
    await refresh();
    restore(iconButton ? undefined : "Saved");
    if (!iconButton) setTimeout(() => { if (button.isConnected) button.textContent = normalLabel; }, 900);
  } catch (error) {
    await confirmOverlay({ title: "Favorite Avatar", message: error.message, confirmLabel: "OK", danger: false });
    restore(normalLabel);
  }
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
    await api("overlayBridgeRequest", {
      command: "favorite-remove",
      payload: { avatarId, groupId: group.id, localId }
    }, 60000);
    state.selectedAvatarId = "";
    await refresh();
  } catch (error) {
    button.title = error.message;
    await confirmOverlay({ title: "Unfavorite Avatar", message: error.message, confirmLabel: "OK", danger: false });
  } finally {
    restore(button.classList.contains("favorite-star") ? undefined : "Unfav");
  }
}

async function chooseOverlayInviteMessageSlot(type = "message") {
  const result = await api("vrchatInviteMessages", { type }, 45000);
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  if (!messages.length) return { messageSlot: 0 };
  const choice = await chooseOverlay({
    title: type === "request" ? "Request Invite" : "Send Invite",
    message: type === "request" ? "Choose a saved VRChat request message." : "Choose a saved VRChat invite message.",
    label: "Message slot",
    confirmLabel: type === "request" ? "Request Invite" : "Send Invite",
    options: messages.map((item) => {
      const slot = Number(item.slot) || 0;
      const text = String(item.message || "").trim() || (slot === 0 ? "Default message" : `Message ${slot}`);
      const cooldown = Number(item.remainingCooldownMinutes) || 0;
      const locked = item.canBeUpdated === false || cooldown > 0;
      return { value: String(slot), disabled: false, label: `#${slot}: ${text}${locked ? " (saved)" : ""}` };
    })
  });
  return choice === null ? null : { messageSlot: Number(choice) || 0 };
}

async function refreshFriendAfterOverlayAction(userId) {
  await refresh();
  if (state.detailPanels.user.open && state.selectedFriendId === userId) {
    await openUserDetail(findOverlayFriend(userId) || { id: userId });
  }
}

async function runFriendAction(button) {
  const userId = button.dataset.friendId || "";
  const action = button.dataset.friendAction || "";
  if (!userId || !action) return;
  const labels = { join: "Join", invite: "Invite", request: "Request", message: "Message", friend: "Friend", unfriend: "Unfriend", block: "Block", unblock: "Unblock" };
  const restoreLabel = labels[action] || "Action";
  const restore = setBusy(button, "...");
  try {
    if (action === "join") {
      const friend = findOverlayFriend(userId) || {};
      const location = friendJoinLocation(friend);
      if (!location) throw new Error("This friend is not in a joinable instance.");
      await api("vrchatOpenWorld", { worldId: friend.worldId || "", location }, 60000);
    } else if (action === "invite") {
      const choice = await chooseOverlayInviteMessageSlot("message");
      if (!choice) { restore(restoreLabel); return; }
      await api("vrchatInviteUser", { userId, instanceId: currentInstanceId(), messageSlot: choice.messageSlot }, 45000);
    } else if (action === "request") {
      const choice = await chooseOverlayInviteMessageSlot("request");
      if (!choice) { restore(restoreLabel); return; }
      await api("vrchatRequestInvite", { id: userId, messageSlot: choice.messageSlot }, 45000);
    } else if (action === "message") {
      const message = await textOverlay({ title: "Message Friend", message: "Send a VRChat invite/request message.", confirmLabel: "Send" });
      if (!message) { restore(restoreLabel); return; }
      await api("vrchatSendChatMessage", { userId, message, mode: "auto" }, 45000);
    } else if (action === "friend") {
      if (!await confirmOverlay({ title: "Friend Request", message: "Send this user a VRChat friend request?", confirmLabel: "Send Request", danger: false })) { restore(restoreLabel); return; }
      await api("vrchatFriendRequest", { id: userId }, 45000);
    } else if (action === "unfriend") {
      if (!await confirmOverlay({ title: "Unfriend", message: "Remove this user from your VRChat friends?", confirmLabel: "Unfriend", danger: true })) { restore(restoreLabel); return; }
      await api("vrchatUnfriend", { id: userId }, 45000);
    } else if (action === "block") {
      if (!await confirmOverlay({ title: "Block User", message: "Block this user on VRChat?", confirmLabel: "Block", danger: true })) { restore(restoreLabel); return; }
      await api("vrchatBlockUser", { id: userId, type: "block" }, 45000);
    } else if (action === "unblock") {
      if (!await confirmOverlay({ title: "Unblock User", message: "Unblock this user on VRChat?", confirmLabel: "Unblock", danger: false })) { restore(restoreLabel); return; }
      await api("vrchatUnblockUser", { id: userId, type: "block" }, 45000);
    } else {
      return;
    }
    restore(action === "friend" ? "Sent" : "Sent");
    await refreshFriendAfterOverlayAction(userId);
    setTimeout(() => { if (button.isConnected) button.textContent = restoreLabel; }, 900);
  } catch (error) {
    restore(restoreLabel);
    await confirmOverlay({ title: "Friend Action", message: error.message, confirmLabel: "OK", danger: false });
  }
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
  if (event.key === "Escape" && state.groupDropdownOpen) {
    state.groupDropdownOpen = false;
    render();
    return;
  }
  if (event.key !== "Tab") return;
  event.preventDefault();
  event.stopPropagation();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}, true);

document.addEventListener("pointerdown", (event) => {
  if (!state.groupDropdownOpen) return;
  const target = event.target;
  if (target?.closest?.("#groupSelectBtn, #groupDropdown")) return;
  state.groupDropdownOpen = false;
  render();
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
    const panel = state.panel;
    if (PANEL_SORT_OPTIONS[panel]) state.sort[panel] = panelSort.dataset.panelSort || PANEL_SORT_OPTIONS[panel][0].value;
    hideDatabaseMenus();
    render();
    return;
  }
  if (!event.target.closest(".overlay-select-control")) hideDatabaseMenus();
  if (!event.target.closest("#groupSelectBtn, #groupDropdown") && state.groupDropdownOpen) {
    state.groupDropdownOpen = false;
    render();
  }
});

document.addEventListener("wheel", (event) => {
  if (event.target.closest("#groupSelectBtn, #groupDropdown")) {
    if (!OVERLAY_PANELS.includes(state.panel)) return;
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
    const panel = state.panel;
    cycle(PANEL_SORT_OPTIONS[panel] || [], state.sort[panel], (value) => { state.sort[panel] = value; });
    return;
  }
}, { passive: false });

document.querySelectorAll(".overlay-tabs button").forEach((button) => button.addEventListener("click", () => setPanel(button.dataset.panel)));
$("prevGroupBtn").addEventListener("click", () => { state.groupDropdownOpen = false; stepGroupIndex(state.panel, -1); render(); });
$("nextGroupBtn").addEventListener("click", () => { state.groupDropdownOpen = false; stepGroupIndex(state.panel, 1); render(); });
$("groupSelectBtn").addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!OVERLAY_PANELS.includes(state.panel)) return;
  state.groupDropdownOpen = !state.groupDropdownOpen;
  render();
});
$("groupDropdown").addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
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
  const friendAction = event.target.closest("[data-friend-action]");
  if (friendAction) {
    event.stopPropagation();
    await runFriendAction(friendAction);
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
$("detailPanels").addEventListener("click", handleOverlayContentClick);

installWindowControls();
  hydrateCachedSnapshot();
  render();
  void hydrateOverlayAppState().then(() => showFirstOpenTip());
refreshSettingsFast();
refresh();
void refreshOverlayHostMode();
setInterval(() => { void refreshOverlayHostMode(); }, 180);
