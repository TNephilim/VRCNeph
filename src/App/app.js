const DEFAULT_SETTINGS = { gridSize: 10, databaseGridSize: 10, themeColor: "#303735", panelColor: "#303735", panelColorSynced: true, backgroundOpacity: 20, panelOpacity: 35, backgroundEffect: "", hideLockedGroups: false, hideFullGroups: false, schemaVersion: 7 };
const AVATAR_PAGE_SIZE = 50;
const SYNCED_GROUP_AVATAR_LIMIT = 50;
const FRIEND_DETAIL_CACHE_KEY = "vrcneph.friendDetailCache";
const FRIEND_DETAIL_CACHE_LIMIT = 250;
const FRIEND_DETAIL_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FRIEND_DETAIL_REFRESH_MS = 5 * 60 * 1000;
const BACKGROUND_EFFECT_OPTIONS = [
  ["", "None"], ["aurora", "Aurora"], ["aurorasnow", "Aurora 2"], ["blizzard", "Blizzard"], ["embers", "Embers"], ["fog", "Fog"], ["pulse", "Gradient pulse"], ["lowpoly", "Low-poly"], ["matrix", "Matrix rain"], ["nebula", "Nebula"], ["particles", "Particles"], ["flow", "Perlin flow"], ["rain", "Rain"], ["snow", "Snowfall"], ["stars", "Starfield"], ["thunderstorm", "Thunderstorm"], ["noise", "White noise"], ["noise2", "White noise 2"]
];
const state = {
  library: { groups: [], avatars: [] },
  activeGroupId: null,
  groupFilter: "all",
  avatarPage: 0,
  avatarFilteredCount: 0,
  pageJumpTarget: "database",
  editingGroupId: null,
  editingAvatarId: null,
  avatarDatabaseSearchTimer: null,
  avatarDatabaseSearchToken: 0,
  avatarDatabaseResults: [],
  avatarDatabasePage: 0,
  avatarDatabaseHasMore: false,
  avatarDatabaseQuery: "",
  avatarDatabaseAuthorId: "",
  avatarDatabaseProvider: "all",
  avatarDatabaseTotal: null,
  avatarDatabaseProgressTotal: 0,
  avatarDatabaseCountKey: "",
  avatarDatabaseCounting: false,
  avatarDatabaseLoading: false,
  avatarDatabaseSearched: false,
  avatarDatabaseMode: "search",
  avatarDatabaseRandomPages: [],
  pasUpdatePromptShown: false,
  pasUpdateBusy: false,
  syncedAvatarEdit: { groupId: "", avatarIds: [], backupPath: "", applying: false },
  pendingDatabaseAvatar: null,
  pendingDatabaseDragAvatar: null,
  avatarRouletteTimer: null,
  avatarRouletteCountdownTimer: null,
  avatarRouletteRunning: false,
  avatarRouletteEquipping: false,
  avatarRouletteRunId: 0,
  avatarRouletteMode: 'favorites',
  avatarRoulettePendingMode: 'favorites',
  appHistory: [],
  appHistoryIndex: -1,
  applyingAppHistory: false,
  lastSideMouseNavAt: 0,
  syncQueue: [],
  syncQueueRunning: false,
  syncQueueStatus: { state: "idle", message: "" },
  pendingMoveAvatarId: "",
  pendingMoveAvatarIds: [],
  pendingAvatarGroupAction: "",
  pendingAvatarSort: null,
  selectedAvatarIds: new Set(),
  selectionAnchorAvatarId: "",
  pendingCopyGroupId: "",
  avatarDialogGroupId: null,
  avatarDialogSource: "",
  avatarDialogHistory: null,
  dragSort: null,
  dragPoint: null,
  dragScrollFrame: null,
  vrchatBackgroundSyncTimer: null,
  vrchatAvatarPollTimer: null,
  vrchatFavoriteLiveSyncTimer: null,
  vrchatFavoriteLiveSyncDebounce: null,
  vrchatLastFavoriteLiveSyncAt: 0,
  vrchatLastForegroundSyncAt: 0,
  socialLastFocusRefreshAt: 0,
  vrchatLogAvatarPollTimer: null,
  positionEdit: null,
  vrchatStartupSyncDone: false,
  vrchatSyncBusy: false,
  vrchatSyncLoggedIn: false,
  vrchatPipeline: { connected: false, state: "Stopped", eventsReceived: 0, lastEventType: "" },
  vrchatAvatarFavoriteGroupLimit: 1,
  settingsLogFilter: "all",
  settingsSaveTimer: null,
  settingsDraft: null,
  pendingBackupRestore: null,
  pendingBackgroundGroupId: "",
  backgroundCache: new Map(),
  pendingGroupIconId: "",
  activePage: "favorites",
  lastLoggedCurrentAvatarId: "",
  lastLogAvatarId: "",
  currentAvatarSummary: { id: "", name: "" },
  worldLocalGroups: [],
  worldRecentWorlds: [],
  worldDeletedWorlds: [],
  worldUpdatedWorlds: [],
  vrchat: { isLoggedIn: false, requiresTwoFactor: false, twoFactorMethods: [], user: null },
  social: { loaded: false, friendsLoaded: false, worldsLoaded: false, busy: false, friends: [], favoriteFriends: [], worlds: [], worldSections: [], favoriteWorlds: [], favoriteWorldGroups: [], selectedWorldGroup: "", location: null, selectedType: "", selectedItem: null, selectToken: 0, friendTab: "info", sidebarTab: "friends" },
  worldInstanceFilter: { enabled: false, minPlayers: 1, hideLocked: false, hideFull: false },
  notifications: { loaded: false, busy: false, items: [], filter: "all" },
  playerActivityLog: { loaded: false, busy: false, items: [], page: 0, pageSize: 50 },
  playerNameHistory: {},
  playerEncounterHistory: {},
  friendPresenceById: {},
  activityFilter: "players",
  socialActivity: [],
  messageHistory: [],
  messageHydratingUsers: new Set(),
  selectedMessageUserId: "",
  inlineMessageUserId: "",
  inlineMessageUserIds: [],
  collapsedMessageUserIds: new Set(),
  messagePopupItem: null,
  dismissedMessagePopupId: "",
  friendNotes: {},
  friendDetailCache: new Map(),
  friendDetailLoadTimer: null,
  friendDetailCacheSaveTimer: null,
  avatarAuthorCache: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  pending: new Map()
};
const $ = (id) => document.getElementById(id);
const INLINE_MESSAGE_RESIZE_MIN = { width: 360, height: 360, margin: 12 };
const BASE_DEVICE_PIXEL_RATIO = window.devicePixelRatio || 1;
let updatePromptShown = false;
let confirmDialogQueue = Promise.resolve();
const startupSummary = { items: [], pasStatus: null, shown: false };
const AVATAR_DETAIL_FIELD_IDS = [
  "avatarIdInput",
  "thumbnailInput",
  "imageInput",
  "tagsInput",
  "sourceUrlInput",
  "descriptionInput",
  "notesInput",
  "rawJsonInput"
];

function handleNativeMessage(message) {
  const response = JSON.parse(message);
  if (response.event) {
    handleAppEvent(response.event, response.data);
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
  if (!window.external || typeof window.external.sendMessage !== "function") return Promise.reject(new Error("Photino message bridge is not available."));
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { state.pending.delete(id); reject(new Error(`${command} timed out waiting for the app host.`)); }, timeoutMs);
    state.pending.set(id, { resolve, reject, timeout });
  });
  window.external.sendMessage(JSON.stringify({ id, command, payload }));
  return promise;
}
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("visible"), 3600);
}
async function copyTextToClipboard(text) {
  const value = String(text ?? "");
  if (!value) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-10000px";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  return copied;
}
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const escapeAttr = (value) => escapeHtml(value).replace(/`/g, "&#096;");

async function loadLibrary() {
  state.library = await api("list");
  if (!state.activeGroupId || !state.library.groups.some((g) => g.id === state.activeGroupId)) state.activeGroupId = state.library.groups[0]?.id ?? null;
  setDefaultAvatarSortForActiveGroup();
}
async function loadSession() {
  const previousLoggedIn = Boolean(state.vrchat?.isLoggedIn);
  const session = await api("vrchatSession");
  if (!session?.isLoggedIn && previousLoggedIn) {
    toast("VRChat session check failed. Keeping the current login state.");
    return;
  }
  state.vrchat = session;
  renderAccount();
  await refreshCurrentAvatarSummarySilent();
  await logCurrentAvatarSilent();
  if (state.vrchat?.isLoggedIn) {
    void startVrchatPipeline();
    void loadNotifications();
  }
}
async function refreshVrchatSessionSafe() {
  const session = await api("vrchatSession");
  if (!session?.isLoggedIn && state.vrchat?.isLoggedIn) return false;
  state.vrchat = session;
  return true;
}
async function logoutVrChat() {
  state.syncedAvatarEdit = { groupId: "", avatarIds: [], backupPath: "", applying: false };
  updateVrChatBackgroundSyncTimer(false);
  state.vrchat = await api("vrchatLogout");
  state.vrchatPipeline = { connected: false, state: "Stopped", eventsReceived: 0, lastEventType: "" };
  state.library = await api("list");
  state.activeGroupId = state.library.groups[0]?.id ?? null;
  state.avatarPage = 0;
  render();
}
async function checkForUpdates({ automatic = false } = {}) {
  if (automatic && updatePromptShown) return;
  try {
    const info = await api("updateCheck", {}, 45000);
    if (!info.updateAvailable) {
      if (!automatic) toast(info.notes || `VRCNeph is up to date (${info.currentVersion}).`);
      return;
    }

    updatePromptShown = true;
    const label = info.latestVersion ? `Update to ${info.latestVersion}` : "Install Update";
    if (!await confirmAction({
      title: "Update Available",
      message: `VRCNeph ${info.latestVersion} is available. Install it now? The app will restart.`,
      confirmLabel: label,
      confirmClass: "primary"
    })) return;
    const result = await api("updateInstall", {}, 120000);
    toast(result.message || "Updating VRCNeph.");
  } catch (e) {
    if (!automatic) toast(e.message);
  }
}
async function loadSettings() {
  try {
    const saved = await api("settingsGet");
    state.settings = {
      gridSize: Number.isFinite(saved.gridSize) ? Math.min(10, Math.max(3, Number(saved.gridSize))) : DEFAULT_SETTINGS.gridSize,
      databaseGridSize: Number.isFinite(saved.databaseGridSize) ? Math.min(10, Math.max(3, Number(saved.databaseGridSize))) : Number.isFinite(saved.gridSize) ? Math.min(10, Math.max(3, Number(saved.gridSize))) : DEFAULT_SETTINGS.databaseGridSize,
      themeColor: /^#[0-9a-f]{6}$/i.test(saved.themeColor || "") ? saved.themeColor : DEFAULT_SETTINGS.themeColor,
      panelColor: /^#[0-9a-f]{6}$/i.test(saved.panelColor || "") ? saved.panelColor : /^#[0-9a-f]{6}$/i.test(saved.themeColor || "") ? saved.themeColor : DEFAULT_SETTINGS.panelColor,
      panelColorSynced: saved.panelColorSynced !== false,
      backgroundOpacity: Number.isFinite(saved.backgroundOpacity) ? Math.min(100, Math.max(0, Number(saved.backgroundOpacity))) : DEFAULT_SETTINGS.backgroundOpacity,
      panelOpacity: Number.isFinite(saved.panelOpacity) ? Math.min(100, Math.max(0, Number(saved.panelOpacity))) : DEFAULT_SETTINGS.panelOpacity,
      backgroundEffect: String(saved.backgroundEffect || ""),
      hideLockedGroups: false,
      hideFullGroups: false,
      schemaVersion: DEFAULT_SETTINGS.schemaVersion
    };
  } catch { state.settings = { ...DEFAULT_SETTINGS }; }
  applySettings();
}
async function loadBackground() {
  try {
    const groupId = state.activePage === "favorites" ? state.activeGroupId || "" : "";
    const group = groupId ? state.library.groups.find((item) => item.id === groupId) : null;
    const requestGroupId = group?.backgroundFolder ? groupId : "";
    const requestKey = requestGroupId ? `group:${requestGroupId}` : "global";
    if (state.backgroundCache.has(requestKey)) {
      renderBackground(state.backgroundCache.get(requestKey));
      return;
    }
    const bg = await api("backgroundGet", { groupId: requestGroupId });
    const cacheKey = bg?.source === "group" && requestGroupId ? `group:${requestGroupId}` : "global";
    state.backgroundCache.set(cacheKey, bg);
    renderBackground(bg);
  } catch { renderBackground(null); }
}
async function startVrchatPipeline() {
  try {
    state.vrchatPipeline = await api("vrchatPipelineStart", {}, 45000);
    updatePipelineStatusText();
  } catch (e) {
    state.vrchatPipeline = { connected: false, state: e.message, eventsReceived: 0, lastEventType: "" };
    updatePipelineStatusText();
  }
}
function updatePipelineStatusText() {
  if (!state.vrchat?.isLoggedIn) return;
  const suffix = state.vrchatPipeline?.connected ? " Live sync connected." : state.vrchatPipeline?.state ? ` Live sync: ${state.vrchatPipeline.state}.` : "";
  if (state.activePage === "friends" && state.social.friendsLoaded) setSocialHeaderStatus("friends", `${state.social.friends.length} friends loaded.${suffix}`);
}
function handleAppEvent(name, data) {
  if (name === "vrchatPipeline") handleVrchatPipelineEvent(data);
  if (name === "vrchatPipelineStatus") handleVrchatPipelineStatus(data);
}
function invalidateBackgroundCache(groupId = "") {
  if (groupId) state.backgroundCache.delete(`group:${groupId}`);
  else state.backgroundCache.delete("global");
}
function groupBackgroundEffectValue(group) {
  return Object.prototype.hasOwnProperty.call(group || {}, "backgroundEffect") ? String(group.backgroundEffect ?? "global") : "global";
}
function activeBackgroundEffect() {
  if (state.activePage !== "favorites") return state.settings.backgroundEffect;
  const group = activeGroup();
  const value = groupBackgroundEffectValue(group);
  return value === "global" ? state.settings.backgroundEffect : value;
}
function applyActiveBackgroundEffect() {
  if (!_bgMediaActive) startBgEffect(activeBackgroundEffect());
}
function backgroundDialogPreviewEffect(value) {
  return value === "global" ? state.settings.backgroundEffect : value;
}
async function saveSettings() { try { state.settings = await api("settingsSave", state.settings); applySettings(); } catch (e) { toast(e.message); } }
function queueSaveSettings() { clearTimeout(state.settingsSaveTimer); state.settingsSaveTimer = setTimeout(saveSettings, 220); }

function render() { renderPageTabs(); renderGroups(); renderToolbar(); renderAvatars(); renderAvatarDatabaseResults(); renderAccount(); renderNotificationsPage(); renderMessagesPage(); renderInlineMessagePanel(); renderMessagePopup(); }
function renderFavoritesView() {
  renderPageTabs();
  renderGroups();
  renderToolbar();
  renderAvatars();
  renderAccount();
  requestAnimationFrame(applyGridSize);
}
function loadLocalJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "") || fallback; } catch { return fallback; }
}
function saveLocalJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
}
function loadFriendDetailCache() {
  const saved = loadLocalJson(FRIEND_DETAIL_CACHE_KEY, []);
  const items = Array.isArray(saved) ? saved : Object.values(saved || {});
  const now = Date.now();
  const cache = new Map();
  for (const item of items) {
    const key = friendDetailCacheKey(item?.id);
    const cachedAt = Number(item?.cachedAt || 0);
    if (!key || !cachedAt || now - cachedAt > FRIEND_DETAIL_CACHE_MAX_AGE_MS) continue;
    cache.set(key, sanitizeFriendDetailForCache(item));
  }
  return cache;
}
state.friendNotes = loadLocalJson("vrcneph.friendNotes", {});
state.friendDetailCache = loadFriendDetailCache();
state.socialActivity = loadLocalJson("vrcneph.socialActivity", []);
state.messageHistory = loadLocalJson("vrcneph.messageHistory", []);
state.playerActivityLog.items = loadLocalJson("vrcneph.playerActivityLog", []);
state.playerActivityLog.loaded = state.playerActivityLog.items.length > 0;
state.playerNameHistory = loadLocalJson("vrcneph.playerNameHistory", {});
recordPlayerNamesFromActivity(state.playerActivityLog.items, { persist: false });
state.worldInstanceFilter = { enabled: false, minPlayers: 1, hideLocked: false, hideFull: false, ...loadLocalJson("vrcneph.worldInstanceFilter", {}) };
async function loadMessageHistory() {
  const localHistory = loadLocalJson("vrcneph.messageHistory", []);
  const local = Array.isArray(localHistory) ? localHistory : [];
  let persisted = [];
  try { persisted = await api("messageHistoryLoad", {}, 30000); } catch { persisted = []; }
  state.messageHistory = dedupeNotifications([...(persisted || []).map(normalizeNotification), ...local.map(normalizeNotification)]).slice(0, 2000);
  persistMessageHistory();
  renderMessagesPage();
  if (state.activePage === "messages" || state.activePage === "notifications") renderSocialSidebar();
  renderPageTabs();
}
function persistMessageHistory() {
  saveLocalJson("vrcneph.messageHistory", state.messageHistory);
  api("messageHistorySave", { items: state.messageHistory }, 30000).catch(() => {});
}
function activeGroup() { return state.library.groups.find((g) => g.id === state.activeGroupId) ?? state.library.groups[0]; }
function groupAvatars(groupId) { return state.library.avatars.filter((a) => a.groupId === groupId); }
function isSyncedGroup(groupId) { return String(groupId || "").toLowerCase().startsWith("vrc_"); }
function isDeletedGroup(groupId) { return String(groupId || "").toLowerCase() === "deleted_avatars"; }
function isRecentGroup(groupId) { return String(groupId || "").toLowerCase() === "recent_avatars"; }
function isUploadedGroup(groupId) { return String(groupId || "").toLowerCase() === "uploaded_avatars"; }
function isUpdatedGroup(groupId) { return String(groupId || "").toLowerCase() === "updated_avatars"; }
function isVrcPlusGroup(groupId) {
  const match = /^vrc_avatars(\d+)$/i.exec(String(groupId || ""));
  return Boolean(match && Number(match[1]) > 1);
}
function hasVrcPlusFavoriteGroups() { return Number(state.vrchatAvatarFavoriteGroupLimit || 1) > 1; }
function canAccessSyncedGroup(groupId) { return !isVrcPlusGroup(groupId) || hasVrcPlusFavoriteGroups(); }
function shouldHideVrcPlusGroup(group) {
  if (!isVrcPlusGroup(group?.id)) return false;
  return !canAccessSyncedGroup(group.id) || groupAvatars(group.id).length === 0;
}
function isPinnedSystemGroup(groupId) { return isRecentGroup(groupId) || isDeletedGroup(groupId) || isUploadedGroup(groupId) || isUpdatedGroup(groupId); }
function isDefaultReorderLockedGroup(groupId) { return isSyncedGroup(groupId) || isPinnedSystemGroup(groupId); }
function canManuallyAddToGroup(groupId) { return !isPinnedSystemGroup(groupId); }
function canCopyGroupIntoGroup(groupId) { return !isSyncedGroup(groupId) && !isPinnedSystemGroup(groupId); }
function isGroupReorderLocked(group) {
  if (!group) return false;
  if (isDefaultReorderLockedGroup(group.id)) return true;
  if (typeof group.reorderLocked === "boolean") return group.reorderLocked;
  return isDefaultReorderLockedGroup(group.id);
}
function isDefaultLocalGroup(group) { return String(group?.description || "").toLowerCase() === "default local avatar favorites." || String(group?.name || "").toLowerCase() === "favorites"; }
function isCustomLocalGroup(group) { return group && !isSyncedGroup(group.id) && !isPinnedSystemGroup(group.id) && !isDefaultLocalGroup(group); }
function isSyncedAvatarEditActive(groupId = state.activeGroupId) { return Boolean(groupId && state.syncedAvatarEdit.groupId === groupId); }
function canEditSyncedAvatarOrder(group = activeGroup()) { return Boolean(group && isSyncedGroup(group.id) && !isPinnedSystemGroup(group.id) && canAccessSyncedGroup(group.id)); }
function canReorderAvatarsInGroup(groupId = state.activeGroupId) { return !isPinnedSystemGroup(groupId) && (!isSyncedGroup(groupId) || isSyncedAvatarEditActive(groupId)); }
function isSyncedAvatarEditDrag() { return state.dragSort?.type === "avatar" && isSyncedAvatarEditActive(state.dragSort.groupId); }
function exitSyncedAvatarEditMode(message = "") {
  if (!state.syncedAvatarEdit.groupId || state.syncedAvatarEdit.applying) return false;
  state.syncedAvatarEdit = { groupId: "", avatarIds: [], backupPath: "", applying: false };
  clearDragSortIndicators();
  if (message) toast(message);
  return true;
}
function groupMatchesFilter(group) {
  if (shouldHideVrcPlusGroup(group)) return false;
  if (isSyncedGroup(group.id) && !canAccessSyncedGroup(group.id)) return false;
  if (state.groupFilter === "synced") return isSyncedGroup(group.id) || isUploadedGroup(group.id) || isUpdatedGroup(group.id) || isRecentGroup(group.id) || isDeletedGroup(group.id);
  if (state.groupFilter === "local") return isDefaultLocalGroup(group) || isCustomLocalGroup(group);
  return true;
}
function filteredGroups() { return orderedGroups().filter(groupMatchesFilter); }
function ensureActiveGroupExists() {
  if (orderedGroups().some((group) => group.id === state.activeGroupId && groupMatchesFilter(group))) return;
  state.activeGroupId = orderedGroups().find(groupMatchesFilter)?.id ?? null;
  state.avatarPage = 0;
}
function groupIconHtml(group) {
  const groupId = typeof group === "string" ? group : group?.id;
  const icon = String(group?.icon || "").trim();
  if (icon) {
    return icon.startsWith("data:image/")
      ? `<span class="custom-group-icon image" title="Group icon"><img src="${escapeAttr(icon)}" alt=""></span>`
      : `<span class="custom-group-icon" title="Group icon">${escapeHtml(icon)}</span>`;
  }
  if (isUpdatedGroup(groupId)) return updatedIconHtml("Updated avatars");
  if (isUploadedGroup(groupId)) return uploadedIconHtml("Uploaded avatars");
  if (isSyncedGroup(groupId)) return syncIconHtml("Synced from VRChat");
  if (isRecentGroup(groupId)) return recentIconHtml("Recent avatars");
  if (isDeletedGroup(groupId)) return trashIconHtml("Deleted avatars");
  return "";
}
function setGroupIconPreview(icon = "") {
  const preview = $("groupIconPreview");
  const value = String(icon || "").trim();
  preview.hidden = !value;
  preview.innerHTML = value.startsWith("data:image/")
    ? `<img src="${escapeAttr(value)}" alt="">`
    : escapeHtml(value);
}
function orderedGroups() { return [...state.library.groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))); }
function reorderableGroups() { return orderedGroups().filter((group) => !isGroupReorderLocked(group)); }
function orderedGroupAvatars(groupId = state.activeGroupId) {
  const avatars = groupAvatars(groupId);
  if (isSyncedAvatarEditActive(groupId)) {
    const byId = new Map(avatars.map((avatar) => [avatar.id, avatar]));
    const ordered = state.syncedAvatarEdit.avatarIds.map((id) => byId.get(id)).filter(Boolean);
    const missing = avatars
      .filter((avatar) => !state.syncedAvatarEdit.avatarIds.includes(avatar.id))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
    return [...ordered, ...missing];
  }
  return avatars.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
}
function avatarUpdatedSortTime(avatar) {
  const value = avatar?.remoteUpdatedAt || avatar?.updatedAt || avatar?.remoteCreatedAt || avatar?.createdAt || "";
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}
function listPosition(items, id) { return Math.max(1, items.findIndex((x) => x.id === id) + 1); }
function movePositionFromDrop(items, draggedId, targetId, after) {
  const currentIndex = items.findIndex((x) => x.id === draggedId);
  const targetIndex = items.findIndex((x) => x.id === targetId);
  if (currentIndex < 0 || targetIndex < 0 || draggedId === targetId) return null;
  let insertIndex = targetIndex + (after ? 1 : 0);
  if (currentIndex < insertIndex) insertIndex--;
  return Math.max(1, insertIndex + 1);
}
function renderPageTabs() {
  $("favoritesPage").hidden = state.activePage !== "favorites";
  $("databasePage").hidden = state.activePage !== "database";
  $("friendsPage").hidden = state.activePage !== "friends";
  $("worldsPage").hidden = state.activePage !== "worlds";
  $("messagesPage").hidden = state.activePage !== "messages";
  $("notificationsPage").hidden = state.activePage !== "notifications";
  document.body.classList.toggle("social-shell-active", state.activePage === "friends" || state.activePage === "worlds" || state.activePage === "messages" || state.activePage === "notifications");
  $("favoritesTabBtn").classList.toggle("active", state.activePage === "favorites");
  $("databaseTabBtn").classList.toggle("active", state.activePage === "database");
  $("friendsTabBtn").classList.toggle("active", state.activePage === "friends");
  $("worldsTabBtn").classList.toggle("active", state.activePage === "worlds");
  $("messagesTabBtn").classList.toggle("active", state.activePage === "messages");
  $("notificationsTabBtn").classList.toggle("active", state.activePage === "notifications");
  updateTabBadge("messagesTabBadge", unreadMessageCount());
  updateTabBadge("notificationsTabBadge", unreadImportantNotificationCount());
}
function isNotificationPopoverOpen() {
  return !$("notificationPopover")?.hidden;
}
function hideNotificationPopover() {
  const popover = $("notificationPopover");
  if (!popover) return;
  popover.hidden = true;
  $("notificationBellBtn")?.setAttribute("aria-expanded", "false");
}
function toggleNotificationPopover(event) {
  event.stopPropagation();
  const popover = $("notificationPopover");
  if (!popover) return;
  const opening = popover.hidden;
  hideSortMenu("notificationFilterMenu", "notificationFilterMenuBtn");
  popover.hidden = !opening;
  $("notificationBellBtn").setAttribute("aria-expanded", opening ? "true" : "false");
  if (!opening) return;
  if (!state.notifications.loaded) void loadNotifications();
  markImportantNotificationsSeen();
  renderNotificationsPage();
}
function updateTabBadge(id, count) {
  const badge = $(id);
  if (!badge) return;
  badge.hidden = count <= 0;
  badge.textContent = count > 99 ? "99+" : String(count);
}
function unreadMessageCount() {
  return (state.messageHistory || []).filter((item) => item.direction !== "outgoing" && !item.seen && !isLocalConversationMessage(item)).length;
}
function unreadImportantNotificationCount() {
  return (state.notifications.items || []).filter((item) => !item.seen && isImportantNotification(item)).length;
}
function isImportantNotification(item) {
  const bucket = notificationBucket(item);
  return bucket === "invite" || bucket === "request" || isFriendRequestNotification(item);
}
function isLocalConversationMessage(item) {
  return String(item?.type || "").toLowerCase() === "localconversation";
}
function markMessagesSeen() {
  let changed = false;
  state.messageHistory = (state.messageHistory || []).map((item) => {
    if (item.seen || item.direction === "outgoing" || isLocalConversationMessage(item)) return item;
    changed = true;
    return { ...item, seen: true };
  });
  if (changed) persistMessageHistory();
  renderPageTabs();
}
function markImportantNotificationsSeen() {
  let changed = false;
  state.notifications.items = (state.notifications.items || []).map((item) => {
    if (item.seen || !isImportantNotification(item)) return item;
    changed = true;
    return { ...item, seen: true };
  });
  if (changed) renderNotificationsPage();
  renderPageTabs();
}
function setUiHidden(hidden) {
  document.body.classList.toggle("ui-hidden", hidden);
  $("hideUiBtn").setAttribute("aria-pressed", hidden ? "true" : "false");
  $("hideUiBtn").setAttribute("aria-label", hidden ? "Show UI" : "Hide UI");
  $("hideUiBtn").title = hidden ? "Show UI" : "Hide UI";
}
function showPage(page, { userInitiated = false } = {}) {
  const pageChanged = page !== state.activePage;
  const previousPage = state.activePage;
  if (pageChanged) exitSyncedAvatarEditMode("Edit mode turned off.");
  if (page !== state.activePage && !$("avatarDetailsPanel").hidden) closeAvatarDetails();
  if (page !== state.activePage && page !== "notifications" && !$("notificationDetailsPanel").hidden) closeNotificationDetails();
  state.activePage = page;
  renderPageTabs();
  renderGroups();
  if (pageChanged) renderToolbar();
  if (pageChanged) void loadBackground();
  requestAnimationFrame(applyGridSize);
  if (page === "database") $("avatarDatabaseSearchInput").focus();
  if (page === "friends") {
    if (!state.social.friendsLoaded) void loadVrchatSocial();
    if (pageChanged && state.vrchat?.isLoggedIn) {
      state.social.selectedType = "profile";
      state.social.selectedItem = { ...state.vrchat.user, groups: [], currentAvatar: state.currentAvatarSummary };
      renderVrchatSocial();
      void openMyProfile({ ensurePage: false });
    }
  }
  if (page === "worlds") {
    if (!state.social.worldsLoaded) void openHomeWorld();
    else {
      renderVrchatSocial();
      if (pageChanged) void openHomeWorld();
    }
    $("worldSearchInput").focus();
  }
  if (page === "notifications") {
    if (!state.playerActivityLog.busy) void loadPlayerActivityLog();
    renderNotificationsPage();
  }
  if (page === "messages") {
    state.messagePopupItem = null;
    if (!state.notifications.loaded) void loadNotifications();
    markMessagesSeen();
    renderMessagesPage();
  }
  renderInlineMessagePanel();
  renderMessagePopup();
  pushAppHistory();
}

function appHistorySnapshot() {
  return {
    page: state.activePage,
    groupId: state.activeGroupId || "",
    socialType: state.social.selectedType || "",
    socialId: state.social.selectedItem?.id || "",
    worldGroup: state.social.selectedWorldGroup || ""
  };
}
function sameAppHistory(a, b) {
  return a && b && a.page === b.page && a.groupId === b.groupId && a.socialType === b.socialType && a.socialId === b.socialId && a.worldGroup === b.worldGroup;
}
function pushAppHistory() {
  if (state.applyingAppHistory) return;
  const snapshot = appHistorySnapshot();
  if (sameAppHistory(state.appHistory[state.appHistoryIndex], snapshot)) return;
  state.appHistory = state.appHistory.slice(0, state.appHistoryIndex + 1);
  state.appHistory.push(snapshot);
  state.appHistoryIndex = state.appHistory.length - 1;
}
function applyAppHistory(snapshot) {
  if (!snapshot) return;
  state.applyingAppHistory = true;
  if (snapshot.page === "favorites" && snapshot.groupId && state.library.groups.some((group) => group.id === snapshot.groupId)) state.activeGroupId = snapshot.groupId;
  state.activePage = snapshot.page || "favorites";
  state.social.selectedWorldGroup = snapshot.worldGroup || "";
  if (snapshot.page === "friends" && snapshot.socialType === "friend" && snapshot.socialId) void selectSocialFriend(snapshot.socialId);
  else if (snapshot.page === "worlds" && snapshot.socialType === "world" && snapshot.socialId) void selectSocialWorld(snapshot.socialId);
  else if (snapshot.page === "friends" && snapshot.socialType === "profile") void openMyProfile({ ensurePage: false });
  else {
    state.social.selectedType = snapshot.socialType || "";
    state.social.selectedItem = null;
  }
  render();
  if (snapshot.page === "friends" || snapshot.page === "worlds") renderVrchatSocial();
  requestAnimationFrame(applyGridSize);
  setTimeout(() => { state.applyingAppHistory = false; }, 900);
}
function stepAppHistory(direction) {
  const next = state.appHistoryIndex + direction;
  if (next < 0 || next >= state.appHistory.length) return;
  state.appHistoryIndex = next;
  applyAppHistory(state.appHistory[next]);
  requestAnimationFrame(applyGridSize);
}

function renderAccount() {
  const user = state.vrchat?.user;
  const loggedIn = Boolean(state.vrchat?.isLoggedIn);
  $("accountStatus").textContent = loggedIn && user ? user.displayName : state.vrchat?.requiresTwoFactor ? "Two-factor code required" : "Not signed in";
  $("loginBtn").hidden = loggedIn;
  $("logoutBtn").hidden = true;
  $("accountStatus").classList.toggle("logged-in", loggedIn);
  if (state.vrchatSyncLoggedIn !== loggedIn) {
    state.vrchatSyncLoggedIn = loggedIn;
    updateVrChatSyncTimer();
  }
  $("saveCurrentAvatarBtn").hidden = !loggedIn;
  $("saveCurrentAvatarBtn").textContent = state.activePage === "worlds" ? "Save Current World" : "Save Current Avatar";
  const card = $("currentAvatarCard");
  if (loggedIn && user?.currentAvatarId) {
    card.hidden = false;
    const thumb = state.currentAvatarSummary.thumbnailImageUrl || user.currentAvatarThumbnailImageUrl || state.currentAvatarSummary.imageUrl || user.currentAvatarImageUrl || "";
    $("currentAvatarImage").src = thumb;
    $("currentAvatarImage").hidden = !thumb;
    $("currentAvatarName").textContent = state.currentAvatarSummary.id === user.currentAvatarId && state.currentAvatarSummary.name ? state.currentAvatarSummary.name : user.currentAvatarId;
    const presence = normalizeFriendPresence(user);
    const status = [userStatusLabel(user.status, presence), user.statusDescription].filter(Boolean).join(" - ");
    const location = currentLocationLabel(state.social?.location);
    $("currentAvatarId").innerHTML = `<span class="profile-status-line">${userStatusDotHtml(user.status, presence, friendStatusLimited(user, presence))}<span>${escapeHtml(status || "Status unknown")}</span></span>${location ? `<span class="profile-location-line">${escapeHtml(location)}</span>` : ""}`;
  } else {
    card.hidden = true;
    $("currentAvatarImage").src = "";
    state.currentAvatarSummary = { id: "", name: "" };
    $("currentAvatarName").textContent = "Unknown avatar";
    $("currentAvatarId").innerHTML = "";
  }
}
function showInlineLogin(show) { $("inlineLoginPanel").hidden = !show; if (show) $("inlineLoginUsernameInput").focus(); }
function showInlineTwoFactor(show) {
  $("inlineTwoFactorPanel").hidden = !show;
  if (!show) return;
  $("inlineTwoFactorMethodInput").innerHTML = (state.vrchat.twoFactorMethods || ["totp"]).map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join("");
  updateSortButton("inlineTwoFactorMethodInput", "inlineTwoFactorMethodBtn");
  $("inlineTwoFactorCodeInput").focus();
}

function renderGroups() {
  const list = $("groupList");
  if (state.activePage === "friends" || state.activePage === "worlds" || state.activePage === "messages" || state.activePage === "notifications") {
    renderSocialSidebar();
    return;
  }
  document.querySelector(".groups-header h2").textContent = "Groups";
  document.querySelector(".groups-header-actions").hidden = false;
  $("addGroupBtn").hidden = false;
  document.querySelector(".group-filter-sort").hidden = false;
  $("importBtn").hidden = false;
  $("exportBtn").hidden = false;
  $("groupFilterSelect").value = state.groupFilter;
  updateSortButton("groupFilterSelect", "groupFilterMenuBtn");
  updateGroupVisibilityButtons();
  ensureActiveGroupExists();
  const allGroups = orderedGroups();
  const groups = filteredGroups();
  if (!state.library.groups.length && list.querySelector(".group-item")) return;
  if (!groups.length) {
    list.innerHTML = `<div class="group-empty">No ${state.groupFilter === "synced" ? "synced" : "local"} groups</div>`;
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    const pinned = isPinnedSystemGroup(group.id);
    const synced = isSyncedGroup(group.id);
    const reorderLocked = isGroupReorderLocked(group);
    const canReorder = !reorderLocked && state.groupFilter === "all";
    const item = document.createElement("div");
    item.className = `group-item ${group.id === state.activeGroupId ? "active" : ""} ${pinned ? "pinned" : ""} ${synced ? "synced" : ""} ${reorderLocked ? "locked" : ""}`;
    item.dataset.groupId = group.id;
    item.dataset.canReorder = canReorder ? "true" : "false";
    item.draggable = canReorder;
    const reorderTitle = canReorder ? "Drag to reorder" : reorderLocked ? "Pinned group" : "Group order is managed in All view";
    const count = groupAvatars(group.id).length;
    const countLabel = isSyncedGroup(group.id) ? `${count}/${SYNCED_GROUP_AVATAR_LIMIT}` : String(count);
    item.innerHTML = `<button class="group-position" type="button" title="${reorderTitle}" ${canReorder ? "" : "disabled"}>#${listPosition(allGroups, group.id)}</button><button class="group-select" type="button"><span class="group-title">${escapeHtml(group.name)}</span><span class="group-count">${escapeHtml(countLabel)}</span></button>`;
    item.querySelector(".group-title").innerHTML = `${groupIconHtml(group)}${escapeHtml(group.name)}`;
    if (canReorder) {
      item.addEventListener("dragstart", (event) => {
        const rect = item.getBoundingClientRect();
        state.dragSort = { type: "group", id: group.id, dragWidth: rect.width, dragHeight: rect.height };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", group.id);
        setEmptyDragPreview(event);
        item.classList.add("dragging");
        startDragAutoScroll(event);
      });
      item.addEventListener("dragend", () => { state.dragSort = null; clearDragSortIndicators(); });
    }
    item.addEventListener("dragover", (event) => {
      if (state.dragSort?.type !== "group" && state.dragSort?.type !== "avatar" && state.dragSort?.type !== "database-avatar") return;
      event.preventDefault();
      event.stopPropagation();
      startDragAutoScroll(event);
      if (state.dragSort?.type === "avatar" || state.dragSort?.type === "database-avatar") {
        if (isSyncedAvatarEditDrag()) return;
        if (!canManuallyAddToGroup(group.id)) {
          clearDropIndicators({ clearPlaceholder: true });
          return;
        }
        clearDropIndicators({ clearPlaceholder: true });
        item.classList.add("drop-target");
        return;
      }
      if (!canReorder) {
        clearDropIndicators({ clearPlaceholder: true });
        return;
      }
      updateGroupDropTarget(event);
    });
    item.addEventListener("drop", async (event) => {
      if (state.dragSort?.type !== "group" && state.dragSort?.type !== "avatar" && state.dragSort?.type !== "database-avatar") return;
      event.preventDefault();
      event.stopPropagation();
      if (state.dragSort?.type === "database-avatar") {
        const avatar = state.dragSort.avatar || state.pendingDatabaseDragAvatar;
        clearDragSortIndicators();
        state.dragSort = null;
        state.pendingDatabaseDragAvatar = null;
        await saveDatabaseAvatarToGroup(avatar, group.id, { focusTarget: false, confirm: true });
        return;
      }
      if (state.dragSort?.type === "avatar") {
        if (isSyncedAvatarEditDrag()) return;
        if (!canManuallyAddToGroup(group.id)) {
          state.dragSort = null;
          clearDragSortIndicators();
          toast("Recent and Deleted groups are managed automatically.");
          return;
        }
        const draggedIds = state.dragSort.ids?.length ? [...state.dragSort.ids] : [state.dragSort.id];
        clearDragSortIndicators();
        state.dragSort = null;
        await moveOrCopyAvatarsToGroup(draggedIds, group.id, { focusTarget: false });
        return;
      }
      if (state.dragSort?.id === group.id) {
        state.dragSort = null;
        clearDragSortIndicators();
        return;
      }
      if (!canReorder) {
        state.dragSort = null;
        clearDragSortIndicators();
        return;
      }
      updateGroupDropTarget(event);
      await commitDraggedGroupDrop();
    });
    if (canReorder) item.querySelector(".group-position").addEventListener("click", () => openPositionDialog("group", group));
    item.querySelector(".group-select").addEventListener("click", () => {
      const groupChanged = state.activeGroupId !== group.id;
      if (groupChanged) exitSyncedAvatarEditMode("Edit mode turned off.");
      if (groupChanged) clearAvatarSelection();
      state.activeGroupId = group.id;
      if (groupChanged) setDefaultAvatarSortForActiveGroup();
      state.avatarPage = 0;
      if (state.activePage !== "favorites") showPage("favorites");
      renderFavoritesView();
      if (groupChanged && state.activePage === "favorites") void loadBackground();
      pushAppHistory();
    });
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const pending = state.pendingAvatarSort;
      const pendingMulti = (pending?.ids?.length || 0) > 1;
      const canPlacePending = Boolean(pending && (pending.groupId === group.id ? canReorderAvatarsInGroup(group.id) : !isSyncedGroup(group.id) && canManuallyAddToGroup(group.id) && !isPinnedSystemGroup(pending.groupId)));
      const canCopyPending = Boolean(pending && pending.groupId !== group.id && !isSyncedGroup(group.id) && canManuallyAddToGroup(group.id));
      const actions = [
        ...(canPlacePending ? [{ label: pendingMulti ? "Place All Here" : "Place Here", action: () => placePendingAvatarInGroup(group.id, false, { focusTarget: false }) }] : []),
        ...(canCopyPending ? [{ label: pendingMulti ? "Copy All Here" : "Copy Here", action: () => placePendingAvatarInGroup(group.id, true, { focusTarget: false }) }] : []),
        ...(canPlacePending || canCopyPending ? [{ label: "Cancel Sorting", action: cancelAvatarContextSort }] : []),
        { label: "Edit Group", action: () => openGroupDialog(group) },
        { label: "Edit Background", action: () => openBackgroundDialog(group.id) },
        { label: "Edit Group Icon", action: () => openGroupIconDialog(group) },
        { label: "Copy Group", disabled: pinned, action: () => openCopyGroupDialog(group) },
        { label: "Delete Group", className: "danger", disabled: pinned || synced, action: () => deleteGroup(group) }
      ];
      showContextMenu(event.clientX, event.clientY, actions);
    });
    fragment.appendChild(item);
  }
  list.replaceChildren(fragment);
}
function renderToolbar() {
  if (state.activePage === "friends" || state.activePage === "worlds") {
    renderAccount();
    renderWorldDiscoveryFilter();
    return;
  }
  const group = activeGroup();
  const pinned = isPinnedSystemGroup(group?.id);
  const synced = isSyncedGroup(group?.id);
  const systemGroup = isPinnedSystemGroup(group?.id);
  const managedReadOnlyGroup = isUploadedGroup(group?.id) || isUpdatedGroup(group?.id);
  const syncedEditVisible = canEditSyncedAvatarOrder(group);
  const syncedEditActive = isSyncedAvatarEditActive(group?.id);
  $("activeGroupName").textContent = group?.name ?? "Favorites";
  $("activeGroupDescription").textContent = group?.description ?? "";
  $("syncedAvatarEditToggleWrap").hidden = !syncedEditVisible;
  $("syncedAvatarEditToggle").checked = syncedEditActive;
  $("syncedAvatarEditToggle").disabled = state.syncedAvatarEdit.applying;
  $("applySyncedAvatarOrderBtn").hidden = !syncedEditActive;
  $("cancelSyncedAvatarOrderBtn").hidden = !syncedEditActive;
  $("applySyncedAvatarOrderBtn").disabled = state.syncedAvatarEdit.applying;
  $("cancelSyncedAvatarOrderBtn").disabled = state.syncedAvatarEdit.applying;
  $("sortMenuBtn").disabled = syncedEditActive;
  $("editGroupBtn").hidden = false;
  $("copyGroupBtn").hidden = systemGroup;
  $("deleteGroupBtn").hidden = systemGroup || synced;
  $("addAvatarBtn").hidden = systemGroup;
  $("favRouletteBtn").hidden = isRecentGroup(group?.id) || isDeletedGroup(group?.id);
  $("editGroupBtn").disabled = false;
  $("copyGroupBtn").disabled = false;
  $("deleteGroupBtn").disabled = synced || state.library.groups.length <= 1;
  $("unfavoriteAllBtn").hidden = !group || managedReadOnlyGroup;
  $("unfavoriteAllBtn").textContent = isRecentGroup(group?.id) ? "Clear Recents" : isDeletedGroup(group?.id) ? "Clear Deleted" : "Unfavorite All";
  $("unfavoriteAllBtn").disabled = state.vrchatSyncBusy || state.syncedAvatarEdit.applying || !groupAvatars(group?.id).length || (synced && !state.vrchat?.isLoggedIn);
  $("checkDeletedFavoritesBtn").hidden = !isDeletedGroup(group?.id);
  $("checkDeletedFavoritesBtn").textContent = state.vrchatSyncBusy && isDeletedGroup(group?.id) ? "Checking..." : "Check for Deleted/Private";
  $("checkDeletedFavoritesBtn").disabled = !state.vrchat?.isLoggedIn || state.vrchatSyncBusy;
  $("addAvatarBtn").disabled = false;
  $("saveCurrentAvatarBtn").disabled = pinned;
  updateRouletteButtons();
  normalizeAvatarSortForActiveGroup();
  updateSortButton();
  updateSortButton("databaseSortSelect", "databaseSortMenuBtn");
  renderWorldDiscoveryFilter();
}
function updateGroupVisibilityButtons() {
  state.settings.hideLockedGroups = false;
  state.settings.hideFullGroups = false;
}
function setGroupVisibilityFilter(kind, enabled) {
  state.settings.hideLockedGroups = false;
  state.settings.hideFullGroups = false;
  updateGroupVisibilityButtons();
  ensureActiveGroupExists();
  render();
  queueSaveSettings();
}
function renderWorldDiscoveryFilter() {
  const wrap = $("worldDiscoveryFilterWrap");
  if (!wrap) return;
  const visible = state.activePage === "worlds" && !state.social.selectedWorldGroup && !$("worldSearchInput").value.trim();
  wrap.hidden = !visible;
  if (visible) updateSortButton("worldDiscoveryFilterSelect", "worldDiscoveryFilterMenuBtn");
}
function activeGroupAllowsManualSort() {
  const group = activeGroup();
  return Boolean(group && !isSyncedGroup(group.id) && !isPinnedSystemGroup(group.id));
}
function defaultAvatarSortForGroup(group = activeGroup()) {
  return group && !isSyncedGroup(group.id) && !isPinnedSystemGroup(group.id) ? "manual" : "createdDesc";
}
function setDefaultAvatarSortForActiveGroup() {
  if (isSyncedAvatarEditActive(activeGroup()?.id)) $("sortSelect").value = "manual";
  else $("sortSelect").value = defaultAvatarSortForGroup();
  updateSortButton();
}
function normalizeAvatarSortForActiveGroup() {
  if ($("sortSelect").value === "manual" && !activeGroupAllowsManualSort() && !isSyncedAvatarEditActive(activeGroup()?.id)) {
    $("sortSelect").value = defaultAvatarSortForGroup();
  }
}
function visibleSortOptions(selectId = "sortSelect") {
  const options = [...$(selectId).options];
  if (selectId !== "sortSelect" || activeGroupAllowsManualSort() || isSyncedAvatarEditActive(activeGroup()?.id)) return options;
  return options.filter((option) => option.value !== "manual");
}
function renderAvatars() {
  const active = activeGroup();
  const canReorderCurrentGroup = canReorderAvatarsInGroup(active?.id);
  const canDragAvatarsToGroup = isPinnedSystemGroup(active?.id);
  const syncedEditActive = isSyncedAvatarEditActive(active?.id);
  const syncedReorderBlocked = Boolean(isSyncedGroup(active?.id) && !syncedEditActive);
  if (syncedEditActive && $("sortSelect").value !== "manual") $("sortSelect").value = "manual";
  const query = $("searchInput").value.trim().toLowerCase();
  const sort = $("sortSelect").value;
  const orderedAvatars = orderedGroupAvatars(state.activeGroupId);
  let avatars = orderedAvatars;
  if (query) avatars = avatars.filter((a) => [a.name, a.avatarId, a.authorName, a.authorId, a.description, a.platforms, a.tags, a.notes, a.source].some((v) => String(v ?? "").toLowerCase().includes(query)));
  avatars = syncedEditActive && sort === "manual"
    ? [...avatars]
    : [...avatars].sort((a, b) => {
      if (sort === "manual") return (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
      if (sort === "nameAsc") return (a.name || "").localeCompare(b.name || "");
      if (sort === "authorAsc") return (a.authorName || "").localeCompare(b.authorName || "");
      if (sort === "createdDesc") return new Date(b.createdAt) - new Date(a.createdAt);
      return avatarUpdatedSortTime(b) - avatarUpdatedSortTime(a);
    });
  const usePages = true;
  state.avatarFilteredCount = avatars.length;
  if (usePages) state.avatarPage = Math.min(avatarMaxPage() - 1, Math.max(0, state.avatarPage));
  else state.avatarPage = 0;
  const visibleAvatars = avatars.slice(state.avatarPage * AVATAR_PAGE_SIZE, (state.avatarPage + 1) * AVATAR_PAGE_SIZE);
  pruneAvatarSelection(orderedAvatars);
  $("emptyState").hidden = avatars.length !== 0;
  renderAvatarPagination(usePages);
  const grid = $("avatarGrid");
  grid.innerHTML = "";
  for (const avatar of visibleAvatars) {
    const card = document.createElement("article");
    card.className = `avatar-card ${canReorderCurrentGroup ? "avatar-reorder-enabled" : "avatar-reorder-locked"} ${syncedEditActive ? "synced-edit-card" : ""}`;
    card.classList.toggle("selected", state.selectedAvatarIds.has(avatar.id));
    card.dataset.avatarId = avatar.id;
    card.draggable = canReorderCurrentGroup || syncedReorderBlocked || canDragAvatarsToGroup;
    const image = avatar.thumbnailImageUrl || avatar.imageUrl;
    const reorderTitle = canReorderCurrentGroup ? "Drag to reorder" : canDragAvatarsToGroup ? "Drag to copy to another group" : "Enable edit mode to reorder synced avatars";
    const release = releaseStatusBadge(avatar.releaseStatus);
    card.innerHTML = `<button type="button"><div class="thumb">${image ? `<img src="${escapeAttr(image)}" alt="">` : "<span>No thumbnail</span>"}</div><div class="avatar-info"><div class="avatar-name">${escapeHtml(avatar.name)}</div><div class="meta-line">${escapeHtml(displayAvatarAuthorName(avatar) || "Author unavailable")}</div><div class="badges">${release ? `<span class="badge ${release.className}">${escapeHtml(release.label)}</span>` : ""}${platformBadgeLabels(avatar.platforms).map((p) => `<span class="badge ${p.className}">${escapeHtml(p.label)}</span>`).join("")}</div></div></button><div class="avatar-card-footer"><button class="avatar-position" type="button" title="${reorderTitle}" ${canReorderCurrentGroup ? "" : "disabled"}>#${listPosition(orderedAvatars, avatar.id)}</button><button class="avatar-card-equip primary" type="button" title="Equip avatar">Equip</button></div>`;
    card.querySelector("button").addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        event.preventDefault();
        handleAvatarSelectionClick(event, avatar, visibleAvatars);
        return;
      }
      if (state.selectedAvatarIds.size) {
        state.selectedAvatarIds.clear();
        state.selectionAnchorAvatarId = "";
        renderAvatars();
      }
      openAvatarDialog(avatar);
    });
    if (canReorderCurrentGroup) card.querySelector(".avatar-position").addEventListener("click", () => openPositionDialog("avatar", avatar));
    card.querySelector(".avatar-card-equip").addEventListener("click", (event) => { event.stopPropagation(); equipAvatar(avatar.avatarId || avatar.id); });
    const startAvatarDrag = (event) => {
      if (event.target.closest(".avatar-card-equip, .avatar-position")) {
        event.preventDefault();
        return;
      }
      const rect = card.getBoundingClientRect();
      const selectedIds = selectedAvatarIdsForAvatar(avatar);
      state.dragSort = { type: "avatar", id: avatar.id, ids: selectedIds, groupId: avatar.groupId, dragWidth: rect.width, dragHeight: rect.height, blockedSynced: syncedReorderBlocked, copyOnly: canDragAvatarsToGroup };
      if (!syncedReorderBlocked && !canDragAvatarsToGroup) {
        $("sortSelect").value = "manual";
        updateSortButton();
      }
      event.dataTransfer.effectAllowed = canDragAvatarsToGroup ? "copy" : "move";
      event.dataTransfer.setData("text/plain", avatar.id);
      setEmptyDragPreview(event);
      createFloatingAvatarDragPreview(card.querySelector(".thumb"), event);
      card.classList.add("dragging");
      for (const selectedId of selectedIds) {
        if (selectedId !== avatar.id) grid.querySelector(`[data-avatar-id="${CSS.escape(selectedId)}"]`)?.classList.add("dragging");
      }
      startDragAutoScroll(event);
    };
    if (canReorderCurrentGroup || syncedReorderBlocked || canDragAvatarsToGroup) {
      card.addEventListener("dragstart", startAvatarDrag);
      card.addEventListener("dragend", () => { state.dragSort = null; clearDragSortIndicators(); });
    }
    card.addEventListener("dragover", (event) => {
      if (state.dragSort?.type !== "avatar") return;
      event.preventDefault();
      event.stopPropagation();
      startDragAutoScroll(event);
      updateAvatarDropTarget(event);
    });
    card.addEventListener("drop", async (event) => {
      if (state.dragSort?.type !== "avatar") return;
      event.preventDefault();
      event.stopPropagation();
      if (state.dragSort?.id === avatar.id) {
        state.dragSort = null;
        clearDragSortIndicators();
        return;
      }
      if (state.dragSort?.copyOnly) {
        state.dragSort = null;
        clearDragSortIndicators();
        showSystemGroupSortBlocked(state.activeGroupId);
        return;
      }
      updateAvatarDropTarget(event);
      if (state.dragSort?.blockedSynced) {
        state.dragSort = null;
        clearDragSortIndicators();
        showSyncedEditModeRequired();
        return;
      }
      await commitDraggedAvatarDrop();
    });
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showAvatarContextMenu(event, avatar, canReorderCurrentGroup);
    });
    grid.appendChild(card);
  }
}
function showAvatarContextMenu(event, avatar, canReorderCurrentGroup) {
  const pending = state.pendingAvatarSort;
  const systemSourceGroup = isPinnedSystemGroup(avatar.groupId);
  const readOnlySourceGroup = isUploadedGroup(avatar.groupId) || isUpdatedGroup(avatar.groupId);
  const selectedIds = selectedAvatarIdsForAvatar(avatar);
  const multiSelected = selectedIds.length > 1 && state.selectedAvatarIds.has(avatar.id);
  const pendingIds = pending?.ids?.length ? pending.ids : pending?.id ? [pending.id] : [];
  const pendingMulti = pendingIds.length > 1;
  const pendingSameGroup = Boolean(pending && pending.groupId === avatar.groupId);
  const canPlacePending = Boolean(pending && !pendingIds.includes(avatar.id) && canReorderCurrentGroup && (pendingSameGroup || (!isSyncedGroup(avatar.groupId) && !isPinnedSystemGroup(pending.groupId) && canManuallyAddToGroup(avatar.groupId))));
  const sortAction = () => startAvatarContextSort(avatar);
  const sortLabel = multiSelected ? "Sort All Avatars" : "Sort Avatar";
  const moveLabel = multiSelected ? "Move All to Group" : "Move to Group";
  const copyLabel = multiSelected ? "Copy All to Group" : "Copy to Group";
  const actions = [
    ...(canPlacePending ? [
      { label: pendingMulti ? "Move All Before" : "Move Before", action: () => placeContextSortedAvatar(avatar, "before") },
      { label: pendingMulti ? "Move All After" : "Move After", action: () => placeContextSortedAvatar(avatar, "after") },
      ...(!pendingSameGroup ? [
        { label: pendingMulti ? "Copy All Before" : "Copy Before", action: () => placeContextSortedAvatar(avatar, "copy-before") },
        { label: pendingMulti ? "Copy All After" : "Copy After", action: () => placeContextSortedAvatar(avatar, "copy-after") }
      ] : []),
      ...(pendingSameGroup && !pendingMulti ? [{ label: "Swap Places", action: () => placeContextSortedAvatar(avatar, "swap") }] : []),
      { label: "Cancel Sorting", action: cancelAvatarContextSort },
      { label: sortLabel, className: "separated", disabled: !canReorderCurrentGroup, action: sortAction }
    ] : [
      { label: sortLabel, disabled: !canReorderCurrentGroup, action: sortAction }
    ]),
    { label: moveLabel, disabled: systemSourceGroup, action: () => openAvatarGroupActionDialog(avatar, "move") },
    { label: copyLabel, action: () => openAvatarGroupActionDialog(avatar, "copy") },
    ...(multiSelected ? [{ label: "Cancel Selection", action: () => { clearAvatarSelection(); renderAvatars(); } }] : []),
    { label: multiSelected ? "Delete All" : "Delete Avatar", className: "danger", disabled: readOnlySourceGroup, action: () => multiSelected ? deleteSelectedAvatars(selectedIds) : deleteAvatarById(avatar.id, avatar.name) }
  ];
  showContextMenu(event.clientX, event.clientY, actions);
}
function pruneAvatarSelection(avatars) {
  if (!state.selectedAvatarIds.size) return;
  const valid = new Set(avatars.map((avatar) => avatar.id));
  for (const id of [...state.selectedAvatarIds]) if (!valid.has(id)) state.selectedAvatarIds.delete(id);
  if (state.selectionAnchorAvatarId && !valid.has(state.selectionAnchorAvatarId)) state.selectionAnchorAvatarId = "";
}
function handleAvatarSelectionClick(event, avatar, visibleAvatars) {
  if (event.shiftKey && state.selectionAnchorAvatarId) {
    const ids = visibleAvatars.map((item) => item.id);
    const start = ids.indexOf(state.selectionAnchorAvatarId);
    const end = ids.indexOf(avatar.id);
    if (start >= 0 && end >= 0) {
      state.selectedAvatarIds.clear();
      for (const id of ids.slice(Math.min(start, end), Math.max(start, end) + 1)) state.selectedAvatarIds.add(id);
      renderAvatars();
      return;
    }
  }
  if (state.selectedAvatarIds.has(avatar.id)) state.selectedAvatarIds.delete(avatar.id);
  else state.selectedAvatarIds.add(avatar.id);
  state.selectionAnchorAvatarId = avatar.id;
  renderAvatars();
}
function selectedAvatarIdsForAvatar(avatar) {
  if (!state.selectedAvatarIds.has(avatar.id)) return [avatar.id];
  const sameGroup = groupAvatars(avatar.groupId).map((item) => item.id);
  const selected = sameGroup.filter((id) => state.selectedAvatarIds.has(id));
  return selected.length ? selected : [avatar.id];
}
function clearAvatarSelection() {
  state.selectedAvatarIds.clear();
  state.selectionAnchorAvatarId = "";
}
function startAvatarContextSort(avatar) {
  const ids = selectedAvatarIdsForAvatar(avatar);
  const multi = ids.length > 1 && state.selectedAvatarIds.has(avatar.id);
  state.pendingAvatarSort = { id: avatar.id, ids, groupId: avatar.groupId, name: multi ? `${ids.length} selected avatars` : avatar.name || avatar.avatarId || avatar.id };
  toast(`Choose another avatar to place "${state.pendingAvatarSort.name}".`);
}
function cancelAvatarContextSort() {
  state.pendingAvatarSort = null;
  hideContextMenu();
}
function showAvatarGridContextMenu(event) {
  if (event.target.closest(".avatar-card")) return;
  const pending = state.pendingAvatarSort;
  const group = activeGroup();
  if (!pending || !group) return;
  const sameGroup = pending.groupId === group.id;
  const canPlace = sameGroup
    ? canReorderAvatarsInGroup(group.id)
    : !isSyncedGroup(group.id) && canManuallyAddToGroup(group.id) && !isPinnedSystemGroup(pending.groupId);
  const canCopy = !sameGroup && !isSyncedGroup(group.id) && canManuallyAddToGroup(group.id);
  if (!canPlace && !canCopy) return;
  const pendingMulti = (pending.ids?.length || 0) > 1;
  event.preventDefault();
  const actions = [
    ...(canPlace ? [{ label: pendingMulti ? "Place All Here" : "Place Here", action: () => placePendingAvatarInGroup(group.id, false) }] : []),
    ...(canCopy ? [{ label: pendingMulti ? "Copy All Here" : "Copy Here", action: () => placePendingAvatarInGroup(group.id, true) }] : []),
    { label: "Cancel Sorting", action: cancelAvatarContextSort }
  ];
  showContextMenu(event.clientX, event.clientY, actions);
}
function handleAvatarGridClick(event) {
  if (event.target.closest(".avatar-card") || event.target.closest(".context-menu")) return;
  if (!state.selectedAvatarIds.size) return;
  clearAvatarSelection();
  renderAvatars();
}
function showSystemGroupSortBlocked(groupId) {
  const name = isRecentGroup(groupId) ? "Recent" : isDeletedGroup(groupId) ? "Deleted" : "this";
  confirmAction({
    title: "Sorting Disabled",
    message: `You can't sort avatars in ${name} group.`,
    confirmLabel: "OK",
    confirmClass: "primary",
    hideCancel: true
  });
}
function showSyncedEditModeRequired() {
  if (showSyncedEditModeRequired.open) return;
  showSyncedEditModeRequired.open = true;
  confirmAction({
    title: "Edit Mode Required",
    message: "Enter edit mode before moving synced avatars.",
    confirmLabel: "OK",
    confirmClass: "primary",
    hideCancel: true
  }).finally(() => { showSyncedEditModeRequired.open = false; });
}
function showVrcPlusRequired() {
  if (showVrcPlusRequired.open) return;
  showVrcPlusRequired.open = true;
  confirmAction({
    title: "VRC+ Required",
    message: "You need VRC+ to edit these avatar favorite groups.",
    confirmLabel: "OK",
    confirmClass: "primary",
    hideCancel: true
  }).finally(() => { showVrcPlusRequired.open = false; });
}
async function placeContextSortedAvatar(targetAvatar, placement) {
  const pending = state.pendingAvatarSort;
  state.pendingAvatarSort = null;
  if (!pending || pending.id === targetAvatar.id) return;
  const pendingIds = pending.ids?.length ? pending.ids : [pending.id];
  if (pending.groupId !== targetAvatar.groupId) {
    if (placement === "swap") return;
    await moveAvatarsRelativeToTarget(pendingIds, targetAvatar, placement.replace("copy-", ""), placement.startsWith("copy-"));
    return;
  }
  if (pendingIds.length > 1) {
    if (placement === "swap") return;
    await reorderAvatarsRelativeToTarget(pendingIds, targetAvatar.id, targetAvatar.groupId, placement);
    return;
  }
  await placeDroppedItem({ type: "avatar", id: pending.id, targetId: targetAvatar.id, groupId: targetAvatar.groupId }, placement);
}
async function placePendingAvatarInGroup(groupId, copy, options = {}) {
  const pending = state.pendingAvatarSort;
  state.pendingAvatarSort = null;
  if (!pending?.id) return;
  const ids = pending.ids?.length ? pending.ids : [pending.id];
  if (ids.length > 1) {
    if (copy) await copyAvatarsToGroup(ids, groupId, options);
    else await moveAvatarsToGroup(ids, groupId, { confirm: false, ...options });
    return;
  }
  await placeAvatarInGroupEnd(pending.id, groupId, copy, options);
}
function avatarMaxPage() { return Math.max(1, Math.ceil((state.avatarFilteredCount || 0) / AVATAR_PAGE_SIZE)); }
function renderAvatarPagination(usePages = true) {
  const footer = $("avatarPagination");
  const hasResults = state.avatarFilteredCount > 0;
  const maxPage = avatarMaxPage();
  const show = usePages && hasResults && maxPage > 1;
  footer.hidden = !show;
  if (!show) {
    $("avatarPageStatus").textContent = "";
    return;
  }
  $("avatarPrevPageBtn").disabled = state.avatarPage <= 0;
  $("avatarNextPageBtn").disabled = state.avatarPage >= maxPage - 1;
  $("avatarPageStatus").textContent = `Page ${state.avatarPage + 1} of ${maxPage}`;
}
function goAvatarPage(page) {
  const maxPage = avatarMaxPage();
  const nextPage = Math.min(maxPage - 1, Math.max(0, page));
  if (nextPage !== state.avatarPage) exitSyncedAvatarEditMode("Edit mode turned off.");
  state.avatarPage = nextPage;
  renderAvatars();
  renderToolbar();
  $("avatarGrid").scrollTop = 0;
}
function resetAvatarPageAndRender() { state.avatarPage = 0; renderAvatars(); }
function splitBadgeValues(value) { return String(value ?? "").split(/[,;\n]/).map((v) => v.trim()).filter(Boolean); }
function platformBadgeLabels(value) {
  const labels = [];
  for (const item of splitBadgeValues(value)) {
    const lower = item.split("/")[0].trim().toLowerCase();
    const label = lower.includes("standalonewindows") || lower === "windows" || lower === "pc" ? "PC" : lower.includes("android") || lower.includes("qu" + "est") ? "Android" : lower.includes("ios") ? "iOS" : item.split("/")[0].trim();
    if (label && !labels.some((x) => x.label.toLowerCase() === label.toLowerCase())) labels.push({ label, className: label.toLowerCase() === "pc" ? "platform-pc" : label.toLowerCase() === "android" ? "platform-android" : label.toLowerCase() === "ios" ? "platform-ios" : "platform" });
  }
  return labels;
}
function databasePlatformBadgeLabels(value) {
  const labels = [];
  for (const item of splitBadgeValues(value)) {
    const lower = item.toLowerCase();
    const label = lower.includes("standalonewindows") || /\b(windows|pc)\b/.test(lower) ? "PC" : lower.includes("android") || lower.includes("qu" + "est") ? "Android" : lower.includes("ios") ? "iOS" : "";
    if (label && !labels.some((x) => x.label.toLowerCase() === label.toLowerCase())) labels.push({ label, className: label.toLowerCase() === "pc" ? "platform-pc" : label.toLowerCase() === "android" ? "platform-android" : "platform-ios" });
  }
  return labels;
}
function releaseStatusBadge(status) {
  const value = String(status || "").trim();
  const lower = value.toLowerCase();
  if (!value) return null;
  if (lower === "deleted" || lower === "unavailable") return { label: "Deleted", className: "deleted" };
  if (lower === "private" || lower === "hidden") return { label: "Private", className: "private" };
  return { label: lower === "public" ? "Public" : value, className: lower === "public" ? "public" : "private" };
}
function isPlaceholderAvatarName(name) {
  const value = String(name || "").trim();
  return !value || /^\?+$/.test(value);
}

function openGroupDialog(group = null) {
  state.editingGroupId = group?.id ?? null;
  const readonly = Boolean(group && (isPinnedSystemGroup(group.id) || isSyncedGroup(group.id)));
  $("groupDialogTitle").textContent = group ? "Edit Group" : "Add Group";
  $("groupNameInput").value = group?.name ?? "";
  $("groupNameInput").readOnly = readonly;
  $("groupIconInput").value = group?.icon ?? "";
  $("groupIconWrap").hidden = !group;
  $("editGroupBackgroundBtn").hidden = !group;
  setGroupIconPreview(group?.icon ?? "");
  $("groupDescriptionInput").value = group?.description ?? "";
  $("groupDescriptionInput").readOnly = readonly;
  $("saveGroupBtn").hidden = readonly;
  $("groupDialog").showModal();
}
async function pickGroupIcon() {
  const result = await api("pickGroupIcon");
  return result?.canceled ? "" : String(result?.icon || "");
}
function openGroupIconMenu(x, y, group = null) {
  const target = group || (state.editingGroupId ? state.library.groups.find((item) => item.id === state.editingGroupId) : null);
  if (!target) return;
  const draftIcon = $("groupDialog").open && state.editingGroupId === target.id ? $("groupIconInput").value : target.icon || "";
  showContextMenu(x, y, [
    { label: "Change Icon", action: () => changeGroupIcon(target) },
    { label: "Remove Icon", disabled: !String(draftIcon || "").trim(), action: () => removeGroupIcon(target) }
  ]);
}
function openGroupIconDialog(group = null) {
  const target = group || (state.editingGroupId ? state.library.groups.find((item) => item.id === state.editingGroupId) : null);
  if (!target) return;
  state.pendingGroupIconId = target.id;
  const draftIcon = $("groupDialog").open && state.editingGroupId === target.id ? $("groupIconInput").value : target.icon || "";
  $("removeGroupIconActionBtn").disabled = !String(draftIcon || "").trim();
  $("groupIconActionDialog").showModal();
}
async function changeGroupIcon(group = null) {
  const target = group || (state.editingGroupId ? state.library.groups.find((item) => item.id === state.editingGroupId) : null);
  if (!target) return;
  try {
    const icon = await pickGroupIcon();
    if (!icon) return;
    if ($("groupDialog").open && state.editingGroupId === target.id) {
      $("groupIconInput").value = icon;
      setGroupIconPreview(icon);
      if (isPinnedSystemGroup(target.id) || isSyncedGroup(target.id)) {
        state.library = await api("updateGroup", { id: target.id, name: target.name, description: target.description || "", icon });
        render();
      }
      return;
    }
    state.library = await api("updateGroup", { id: target.id, name: target.name, description: target.description || "", icon });
    render();
  } catch (e) { toast(e.message); }
}
async function removeGroupIcon(group = null) {
  const target = group || (state.editingGroupId ? state.library.groups.find((item) => item.id === state.editingGroupId) : null);
  if (!target) return;
  try {
    if ($("groupDialog").open && state.editingGroupId === target.id) {
      $("groupIconInput").value = "";
      setGroupIconPreview("");
      if (isPinnedSystemGroup(target.id) || isSyncedGroup(target.id)) {
        state.library = await api("updateGroup", { id: target.id, name: target.name, description: target.description || "", icon: "" });
        render();
      }
      return;
    }
    state.library = await api("updateGroup", { id: target.id, name: target.name, description: target.description || "", icon: "" });
    render();
  } catch (e) { toast(e.message); }
}
function fillSelectWithGroups(select, selectedId, { includeGroup = canManuallyAddToGroup } = {}) {
  const groups = state.library.groups.filter((group) => includeGroup(group.id));
  select.innerHTML = groups.map((g) => `<option value="${escapeAttr(g.id)}" ${g.id === selectedId ? "selected" : ""}>${escapeHtml(g.name)}</option>`).join("");
  if (selectedId && groups.some((group) => group.id === selectedId)) select.value = selectedId;
  else if (groups.length) select.value = groups[0].id;
}
function fillCopyGroupTargets(sourceGroupId = "") {
  fillSelectWithGroups($("copyGroupTargetInput"), state.activeGroupId, { includeGroup: (groupId) => groupId !== sourceGroupId && canCopyGroupIntoGroup(groupId) });
}
function openAvatarGroupActionDialog(avatar, action) {
  const ids = selectedAvatarIdsForAvatar(avatar);
  state.pendingMoveAvatarId = avatar.id;
  state.pendingMoveAvatarIds = ids;
  state.pendingAvatarGroupAction = action;
  const plural = ids.length > 1;
  $("saveAvatarGroupDialog").querySelector("h3").textContent = action === "copy" ? (plural ? "Copy Avatars" : "Copy Avatar") : (plural ? "Move Avatars" : "Move Avatar");
  $("confirmSaveAvatarGroupBtn").textContent = action === "copy" ? (plural ? "Copy Avatars" : "Copy Avatar") : (plural ? "Move Avatars" : "Move Avatar");
  $("saveAvatarGroupName").textContent = plural ? `Choose a group for ${ids.length} selected avatars.` : `Choose a group for "${avatar.name || avatar.avatarId || "this avatar"}".`;
  fillSelectWithGroups($("saveAvatarGroupInput"), avatar.groupId ?? state.activeGroupId);
  $("saveAvatarGroupDialog").showModal();
}
function resetAvatarGroupDialogMode() {
  state.pendingMoveAvatarId = "";
  state.pendingMoveAvatarIds = [];
  state.pendingAvatarGroupAction = "";
  $("saveAvatarGroupDialog").querySelector("h3").textContent = "Save Avatar";
  $("confirmSaveAvatarGroupBtn").textContent = "Save Avatar";
}
function openAvatarDialog(avatar = null) {
  const isExisting = Boolean(avatar?.id);
  const isAdd = !avatar;
  state.editingAvatarId = isExisting ? avatar.id : null;
  state.avatarDialogGroupId = avatar?.groupId ?? state.activeGroupId;
  $("avatarDialogTitle").textContent = avatar ? (isExisting ? "Avatar Details" : "Avatar Details") : "Add Avatar";
  setAvatarForm(avatar ?? {});
  applyAvatarDetailReadOnlyMode(isAdd ? "add" : "view");
  $("deleteAvatarBtn").hidden = !isExisting || isUpdatedGroup(avatar?.groupId) || isUploadedGroup(avatar?.groupId);
  $("avatarDetailsPanel").hidden = false;
  document.body.classList.add("details-open");
  requestAnimationFrame(applyGridSize);
  if (avatar?.avatarId) hydrateAvatarDetailsFromVrChat(avatar.avatarId);
}
function closeAvatarDetails() { $("avatarDetailsPanel").hidden = true; document.body.classList.remove("details-open"); requestAnimationFrame(applyGridSize); }
function applyAvatarDetailReadOnlyMode(mode) {
  const editable = new Set(mode === "add" ? ["avatarIdInput", "notesInput"] : ["notesInput"]);
  for (const id of AVATAR_DETAIL_FIELD_IDS) {
    const field = $(id);
    field.readOnly = !editable.has(id);
    field.classList.toggle("readonly-field", field.readOnly);
  }
  $("fetchAvatarBtn").disabled = mode !== "add";
  $("fetchAvatarBtn").hidden = mode !== "add";
  $("copyAvatarIdBtn").hidden = mode === "add";
}
function setAvatarForm(avatar) {
  state.avatarDialogSource = avatar.source ?? "";
  state.avatarDialogHistory = avatar ?? {};
  const avatarId = avatarPublicId(avatar);
  $("avatarIdInput").value = avatarId;
  $("avatarNameInput").value = avatar.name ?? "";
  const authorName = cleanAvatarAuthorName(avatar.authorName);
  $("authorNameInput").value = authorName;
  $("authorIdInput").value = avatar.authorId || (avatarAuthorLooksLikeId(avatar.authorName) ? avatar.authorName : "");
  $("thumbnailInput").value = avatar.thumbnailImageUrl ?? "";
  $("imageInput").value = avatar.imageUrl ?? "";
  $("releaseStatusInput").value = avatar.releaseStatus ?? "";
  $("versionInput").value = avatar.version ?? "";
  $("platformsInput").value = avatar.platforms ?? "";
  updateAvatarDetailUpdated(avatar);
  $("tagsInput").value = avatar.tags ?? "";
  $("sourceUrlInput").value = avatar.sourceUrl ?? "";
  $("descriptionInput").value = avatar.description ?? "";
  $("notesInput").value = avatar.notes ?? "";
  $("rawJsonInput").value = avatar.rawJson ?? "";
  updateAvatarAuthorAction();
  updateAvatarPreview();
  updateAvatarDetailBadges();
  maybeResolveAvatarDetailAuthor({ ...avatar, avatarId });
}
function mergeAvatarDetailMetadata(details) {
  if (!details || $("avatarIdInput").value.trim() !== avatarPublicId(details)) return;
  state.avatarDialogHistory = { ...(state.avatarDialogHistory || {}), ...details };
  state.avatarDialogSource = details.source || state.avatarDialogSource;
  if (!isPlaceholderAvatarName(details.name)) $("avatarNameInput").value = details.name;
  const authorName = cleanAvatarAuthorName(details.authorName);
  if (authorName) $("authorNameInput").value = authorName;
  if (details.authorId) $("authorIdInput").value = details.authorId;
  if (details.releaseStatus) $("releaseStatusInput").value = details.releaseStatus;
  if (details.version) $("versionInput").value = details.version;
  if (details.platforms) $("platformsInput").value = details.platforms;
  if (details.thumbnailImageUrl && !$("thumbnailInput").value.trim()) $("thumbnailInput").value = details.thumbnailImageUrl;
  if (details.imageUrl && !$("imageInput").value.trim()) $("imageInput").value = details.imageUrl;
  if (details.sourceUrl && !$("sourceUrlInput").value.trim()) $("sourceUrlInput").value = details.sourceUrl;
  if (details.description && !$("descriptionInput").value.trim()) $("descriptionInput").value = details.description;
  if (details.rawJson && !$("rawJsonInput").value.trim()) $("rawJsonInput").value = details.rawJson;
  updateAvatarAuthorAction();
  updateAvatarPreview();
  updateAvatarDetailBadges();
  updateAvatarDetailUpdated(state.avatarDialogHistory);
}
function avatarPublicId(avatar = {}) {
  const avatarId = String(avatar.avatarId || "").trim();
  if (avatarIdLooksValid(avatarId)) return avatarId;
  const id = String(avatar.id || "").trim();
  return avatarIdLooksValid(id) ? id : "";
}
function avatarAuthorLooksLikeId(value) {
  return /^usr_[0-9a-f-]+$/i.test(String(value || "").trim());
}
function cleanAvatarAuthorName(value) {
  const text = String(value || "").trim();
  return avatarAuthorLooksLikeId(text) ? "" : text;
}
function avatarAuthorNeedsResolution(avatar = {}) {
  const authorName = String(avatar.authorName || "").trim();
  const authorId = String(avatar.authorId || "").trim();
  return !cleanAvatarAuthorName(authorName) || (authorId && authorName.toLowerCase() === authorId.toLowerCase());
}
function mergeBetterAvatarDetails(base = {}, incoming = {}) {
  if (!incoming) return base;
  const merged = { ...base };
  for (const key of ["avatarId", "id", "name", "thumbnailImageUrl", "imageUrl", "releaseStatus", "version", "platforms", "tags", "sourceUrl", "description", "rawJson", "remoteCreatedAt", "remoteUpdatedAt", "source"]) {
    if (!merged[key] && incoming[key]) merged[key] = incoming[key];
  }
  const incomingPublicId = avatarPublicId(incoming);
  if (incomingPublicId) merged.avatarId = incomingPublicId;
  if (incoming.authorId && !merged.authorId) merged.authorId = incoming.authorId;
  const authorName = cleanAvatarAuthorName(incoming.authorName);
  if (authorName) {
    merged.authorName = authorName;
    cacheAvatarAuthorName(merged, authorName);
  }
  return merged;
}
async function resolveAvatarAuthorFromDatabase(avatar = {}) {
  const imageUrl = avatar.thumbnailImageUrl || avatar.imageUrl || "";
  const avatarId = avatarPublicId(avatar);
  if ((!avatarAuthorNeedsResolution(avatar) && avatarId) || (!imageUrl && !avatarId && !avatar.name)) return avatar;
  try {
    const resolved = await api("avatarDatabaseResolveImage", {
      avatarId,
      imageUrl,
      name: avatar.name || "",
      userId: avatar.authorId || "",
      displayName: ""
    }, 45000);
    return resolved ? mergeBetterAvatarDetails(avatar, resolved) : avatar;
  } catch {
    return avatar;
  }
}
async function maybeResolveAvatarDetailAuthor(avatar = {}) {
  const expectedId = avatarPublicId(avatar) || String($("avatarIdInput").value || "").trim();
  const needsAuthor = avatarAuthorNeedsResolution({ authorName: $("authorNameInput").value, authorId: $("authorIdInput").value });
  const needsAvatarId = !avatarIdLooksValid($("avatarIdInput").value);
  if (!needsAuthor && !needsAvatarId) return;
  const resolved = await resolveAvatarAuthorFromDatabase({
    ...avatar,
    avatarId: expectedId,
    thumbnailImageUrl: $("thumbnailInput").value,
    imageUrl: $("imageInput").value,
    authorName: $("authorNameInput").value,
    authorId: $("authorIdInput").value
  });
  if ($("avatarDetailsPanel").hidden) return;
  if (expectedId && String($("avatarIdInput").value || "").trim() && String($("avatarIdInput").value || "").trim() !== expectedId) return;
  const resolvedAvatarId = avatarPublicId(resolved);
  if (resolvedAvatarId && needsAvatarId) {
    $("avatarIdInput").value = resolvedAvatarId;
    state.avatarDialogHistory = { ...(state.avatarDialogHistory || {}), avatarId: resolvedAvatarId };
  }
  const authorName = cleanAvatarAuthorName(resolved.authorName);
  if (authorName) {
    $("authorNameInput").value = authorName;
    state.avatarDialogHistory = { ...(state.avatarDialogHistory || {}), authorName, authorId: resolved.authorId || $("authorIdInput").value };
  }
  if (resolved.authorId && !$("authorIdInput").value.trim()) $("authorIdInput").value = resolved.authorId;
  updateAvatarAuthorAction();
}
async function hydrateAvatarDetailsFromVrChat(avatarId) {
  const expected = String(avatarId || "").trim();
  if (!expected) return;
  try {
    const details = await api("fetchAvatar", { id: expected }, 45000);
    if ($("avatarDetailsPanel").hidden || String($("avatarIdInput").value || "").trim() !== expected) return;
    mergeAvatarDetailMetadata(details);
  } catch {
  }
}
function readAvatarForm(groupId = state.avatarDialogGroupId ?? state.activeGroupId) {
  return { id: state.editingAvatarId ?? "", groupId, avatarId: $("avatarIdInput").value, name: $("avatarNameInput").value, authorName: $("authorNameInput").value, authorId: $("authorIdInput").value, thumbnailImageUrl: $("thumbnailInput").value, imageUrl: $("imageInput").value, releaseStatus: $("releaseStatusInput").value, version: $("versionInput").value, platforms: $("platformsInput").value, tags: $("tagsInput").value, sourceUrl: $("sourceUrlInput").value, description: $("descriptionInput").value, notes: $("notesInput").value, rawJson: $("rawJsonInput").value, source: state.avatarDialogHistory?.source || state.avatarDialogSource || "", remoteCreatedAt: state.avatarDialogHistory?.remoteCreatedAt || "", remoteUpdatedAt: state.avatarDialogHistory?.remoteUpdatedAt || "", remoteFavoriteId: state.avatarDialogHistory?.remoteFavoriteId || "" };
}
function updateAvatarPreview() {
  const image = $("thumbnailInput").value.trim() || $("imageInput").value.trim();
  $("avatarDetailThumbnail").src = image;
  $("avatarDetailThumbnail").hidden = !image;
  $("avatarDetailThumbnailEmpty").hidden = Boolean(image);
  $("avatarDetailThumbnailButton").disabled = !image;
}
function updateAvatarDetailBadges() {
  const release = releaseStatusBadge($("releaseStatusInput").value);
  const platforms = databasePlatformBadgeLabels($("platformsInput").value).map((p) => `<span class="badge ${p.className}">${escapeHtml(p.label)}</span>`).join("");
  const version = $("versionInput").value ? `<span class="badge">v${escapeHtml($("versionInput").value)}</span>` : "";
  $("avatarDetailBadges").innerHTML = `${release ? `<span class="badge ${release.className}">${escapeHtml(release.label)}</span>` : ""}${platforms}${version}`;
}

function formatAvatarUpdatedAt(avatar) {
  const value = avatar?.remoteUpdatedAt || "";
  if (!value) return "Avatar update unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `Avatar updated: ${String(value)}`;
  return `Avatar updated: ${date.toLocaleString()}`;
}
function updateAvatarDetailUpdated(avatar) {
  const button = $("avatarDetailUpdated");
  const label = formatAvatarUpdatedAt(avatar);
  button.textContent = label || "No update history";
  button.disabled = avatarUpdateHistoryRows(avatar).length === 0;
}
function avatarUpdateHistoryRows(avatar = state.avatarDialogHistory) {
  const rows = [
    ["Local created", avatar?.createdAt],
    ["Local updated", avatar?.updatedAt],
    ["Avatar created", avatar?.remoteCreatedAt],
    ["Avatar updated", avatar?.remoteUpdatedAt]
  ];
  return rows
    .map(([label, value]) => ({ label, value: formatHistoryTimestamp(value) }))
    .filter((row) => row.value);
}
function formatHistoryTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}
function showAvatarUpdateHistory() {
  const rows = avatarUpdateHistoryRows();
  $("avatarUpdateHistoryList").innerHTML = rows.length
    ? rows.map((row) => `<div><strong>${escapeHtml(row.label)}</strong><span>${escapeHtml(row.value)}</span></div>`).join("")
    : `<p class="dialog-note">No update history is available for this avatar.</p>`;
  $("avatarUpdateHistoryDialog").showModal();
}

function avatarSourceLabels(source) {
  const labels = [];
  for (const part of String(source || "").split(/[,+|;]/).map((x) => x.trim()).filter(Boolean)) {
    const label = part === "vrchat" ? "VRChat" : part === "avatar-database" ? "VRCX" : part === "avtrzip" ? "AVTRZIP" : part === "pas" ? "Prismic" : part === "vrchat-recent" ? "Recent" : "";
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}
function avatarSourceBadgeHtml(source) {
  return avatarSourceLabels(source).map((label) => `<span class="badge source">${escapeHtml(label)}</span>`).join("");
}

function updateAvatarAuthorAction() {
  const avatarName = $("avatarNameInput").value.trim();
  const authorName = $("authorNameInput").value.trim();
  const authorId = $("authorIdInput").value.trim();
  const button = $("avatarDetailAuthorBtn");
  $("avatarDetailName").textContent = avatarName || $("avatarIdInput").value.trim() || "Unnamed avatar";
  button.hidden = !authorName && !authorId;
  button.textContent = authorName || authorId;
  button.title = authorId ? `Author ID: ${authorId}` : "Search by avatar author";
}

function showAvatarAuthorSearchOptions(event) {
  event.preventDefault();
  event.stopPropagation();
  const authorName = $("authorNameInput").value.trim();
  const authorId = $("authorIdInput").value.trim();
  if (!authorName && !authorId) return;
  const rect = event.currentTarget.getBoundingClientRect();
  showContextMenu(rect.left, rect.bottom + 6, [
    { label: "Search Database by Author", action: () => searchDatabaseByAuthor(authorName || authorId, authorId) }
  ]);
}

function clearAvatarDatabaseSearch() {
  clearTimeout(state.avatarDatabaseSearchTimer);
  state.avatarDatabaseSearchToken++;
  state.avatarDatabaseResults = [];
  state.avatarDatabasePage = 0;
  state.avatarDatabaseHasMore = false;
  state.avatarDatabaseQuery = "";
  state.avatarDatabaseAuthorId = "";
  state.avatarDatabaseTotal = null;
  state.avatarDatabaseProgressTotal = 0;
  state.avatarDatabaseCountKey = "";
  state.avatarDatabaseCounting = false;
  state.avatarDatabaseLoading = false;
  state.avatarDatabaseSearched = false;
  state.avatarDatabaseMode = "search";
  state.avatarDatabaseRandomPages = [];
  $("avatarDatabaseSearchInput").value = "";
  renderAvatarDatabaseResults();
  updateAvatarDatabaseCopy();
  $("avatarDatabaseSearchInput").focus();
}

function avatarDatabaseProvider() {
  return $("avatarDatabaseProviderSelect")?.value || state.avatarDatabaseProvider || "all";
}
function avatarDatabaseProviderLabel(provider = avatarDatabaseProvider()) {
  if (provider === "all") return "all databases";
  return provider === "avtrzip" ? "AVTRZIP" : provider === "pas" ? "Prismic PAS" : "VRCX DB";
}
function avatarDatabaseProviderDescription(provider = avatarDatabaseProvider()) {
  if (provider === "all") return "Search all databases. Broad search terms take longer; single databases are quicker.";
  return provider === "avtrzip" ? "Search the remote AVTRZIP avatar database." : provider === "pas" ? "Search the Prismic AvatarSearch PAS database." : "Search the remote VRCX-compatible avatar database.";
}
function updateAvatarDatabaseCopy() {
  const provider = avatarDatabaseProvider();
  state.avatarDatabaseProvider = provider;
  if ($("avatarDatabaseProviderMenuBtn")) updateSortButton("avatarDatabaseProviderSelect", "avatarDatabaseProviderMenuBtn");
  $("avatarDatabaseSearchInput").placeholder = provider === "all" ? "Search all databases" : provider === "avtrzip" ? "Search AVTRZIP avatars" : provider === "pas" ? "Search Prismic PAS avatars" : "Search VRCX avatars";
  $("avatarDatabaseStatus").textContent = avatarDatabaseProviderDescription(provider);
  $("avatarDatabaseEmptyState").querySelector("p").textContent = provider === "avtrzip"
    ? "Start typing at least three characters to search AVTRZIP avatars."
    : provider === "pas"
      ? "Enter a search, then press Search or Enter to search Prismic PAS."
    : provider === "all"
      ? "All-database searches take longer. Pick one database for quicker results."
    : "Start typing at least three characters to search VRCX-compatible avatars.";
}
async function maybeShowVrcxDatabaseNotice() {
  if (avatarDatabaseProvider() !== "vrcx") return;
  try {
    const status = await api("avatarDatabaseVrcxStatus");
    if (status?.hasLocalDatabase) return;
    await confirmAction({
      title: "Local VRCX Database Not Found",
      message: "No local VRCX database was found. VRCNeph will still use remote VRCX search, so VRCX is not required for database search. VRCX is only needed if you want it to build or update its own local cache outside VRCNeph.",
      confirmLabel: "OK",
      confirmClass: "primary",
      hideCancel: true
    });
  } catch (e) {
    toast(e.message);
  }
}
function resetAvatarDatabaseResults() {
  clearTimeout(state.avatarDatabaseSearchTimer);
  state.avatarDatabaseSearchToken++;
  state.avatarDatabaseResults = [];
  state.avatarDatabasePage = 0;
  state.avatarDatabaseHasMore = false;
  state.avatarDatabaseQuery = "";
  state.avatarDatabaseTotal = null;
  state.avatarDatabaseProgressTotal = 0;
  state.avatarDatabaseCountKey = "";
  state.avatarDatabaseCounting = false;
  state.avatarDatabaseLoading = false;
  state.avatarDatabaseSearched = false;
  state.avatarDatabaseMode = "search";
  state.avatarDatabaseRandomPages = [];
  renderAvatarDatabaseResults();
  updateAvatarDatabaseCopy();
}

async function checkPasDatabaseUpdate() {
  if (state.pasUpdatePromptShown || state.pasUpdateBusy) return;
  state.pasUpdateBusy = true;
  try {
    const status = await api("avatarDatabasePasUpdateStatus");
    if (!status?.hasUpdate) return;
    state.pasUpdatePromptShown = true;
    if (startupSummary && !startupSummary.shown) {
      startupSummary.pasStatus = status;
      const updateDetail = status.message || `Prismic PAS has an update (${status.localFileDate || "local cache"} -> ${status.remoteFileDate || "remote database"}).`;
      addStartupSummaryItem("Prismic PAS Update", status.hasLocalFile ? updateDetail : "Prismic PAS is not cached in Documents yet.");
      scheduleStartupSummary();
      return;
    }
    const updateDetail = status.message || `Prismic PAS has an update (${status.localFileDate || "local cache"} -> ${status.remoteFileDate || "remote database"}).`;
    const message = status.hasLocalFile
      ? `${updateDetail} Update now?`
      : "Prismic PAS is not cached in Documents yet. Download it now?";
    const shouldUpdate = await confirmAction({
      title: "Update Prismic PAS",
      message,
      confirmLabel: "Update",
      confirmClass: "primary"
    });
    if (!shouldUpdate) return;
    $("avatarDatabaseStatus").textContent = "Updating Prismic PAS database...";
    await api("avatarDatabasePasUpdate");
    resetAvatarDatabaseResults();
    toast("Prismic PAS database updated.");
  } catch (e) {
    console.warn(e);
  } finally {
    state.pasUpdateBusy = false;
  }
}

function databaseSearchFieldPayload() {
  const platformFilters = [
    $("databasePlatformPcToggle").checked ? "pc" : "",
    $("databasePlatformAndroidToggle").checked ? "android" : "",
    $("databasePlatformIosToggle").checked ? "ios" : ""
  ].filter(Boolean).join(",");
  return {
    searchAvatar: $("databaseSearchAvatarToggle").checked,
    searchAuthor: $("databaseSearchAuthorToggle").checked,
    searchDescription: $("databaseSearchDescriptionToggle").checked,
    searchTags: $("databaseSearchTagsToggle").checked,
    platformFilters
  };
}

function hasDatabaseSearchField(fields = databaseSearchFieldPayload()) {
  return fields.searchAvatar || fields.searchAuthor || fields.searchDescription || fields.searchTags || fields.platformFilters;
}

function setDatabaseSearchFields({ avatar = true, author = true, description = true, tags = true, platforms = [] }) {
  $("databaseSearchAvatarToggle").checked = avatar;
  $("databaseSearchAuthorToggle").checked = author;
  $("databaseSearchDescriptionToggle").checked = description;
  $("databaseSearchTagsToggle").checked = tags;
  const platformSet = new Set(platforms);
  $("databasePlatformPcToggle").checked = platformSet.has("pc");
  $("databasePlatformAndroidToggle").checked = platformSet.has("android");
  $("databasePlatformIosToggle").checked = platformSet.has("ios");
}

function databaseSearchPayload(query, page = 0) {
  return {
    provider: avatarDatabaseProvider(),
    query,
    limit: 50,
    page: page + 1,
    authorId: state.avatarDatabaseAuthorId,
    ...databaseSearchFieldPayload()
  };
}

function searchDatabaseByAuthor(authorName, authorId = "") {
  const query = String(authorName || authorId || "").trim();
  if (!query) return;
  hideContextMenu();
  closeAvatarDetails();
  state.avatarDatabaseAuthorId = String(authorId || "").trim();
  setDatabaseSearchFields({ avatar: false, author: true, description: false, tags: false });
  $("avatarDatabaseSearchInput").value = query;
  showPage("database");
  runAvatarDatabaseSearch(0);
}

async function runAvatarDatabaseSearch(page = 0) {
  const token = ++state.avatarDatabaseSearchToken;
  state.avatarDatabaseProvider = avatarDatabaseProvider();
  const providerLabel = avatarDatabaseProviderLabel();
  const query = $("avatarDatabaseSearchInput").value.trim();
  const fields = databaseSearchFieldPayload();
  const directAuthorSearch = Boolean(state.avatarDatabaseAuthorId && fields.searchAuthor && !fields.searchAvatar && !fields.searchDescription && !fields.searchTags);
  const hasOptionFilters = Boolean(fields.platformFilters);
  if (query.length > 0 && query.length < 3 && !directAuthorSearch && !hasOptionFilters) {
    state.avatarDatabaseResults = [];
    state.avatarDatabasePage = 0;
    state.avatarDatabaseHasMore = false;
    state.avatarDatabaseQuery = "";
    state.avatarDatabaseAuthorId = "";
    state.avatarDatabaseTotal = null;
    state.avatarDatabaseProgressTotal = 0;
    state.avatarDatabaseCountKey = "";
    state.avatarDatabaseCounting = false;
    state.avatarDatabaseLoading = false;
    state.avatarDatabaseSearched = false;
    state.avatarDatabaseMode = "search";
    state.avatarDatabaseRandomPages = [];
    renderAvatarDatabaseResults();
    $("avatarDatabaseStatus").textContent = "Enter at least 3 characters.";
    return;
  }
  if (!query && !hasOptionFilters && !directAuthorSearch) {
    state.avatarDatabaseResults = [];
    state.avatarDatabasePage = 0;
    state.avatarDatabaseHasMore = false;
    state.avatarDatabaseQuery = "";
    state.avatarDatabaseAuthorId = "";
    state.avatarDatabaseTotal = null;
    state.avatarDatabaseProgressTotal = 0;
    state.avatarDatabaseCountKey = "";
    state.avatarDatabaseCounting = false;
    state.avatarDatabaseLoading = false;
    state.avatarDatabaseSearched = false;
    state.avatarDatabaseMode = "search";
    state.avatarDatabaseRandomPages = [];
    renderAvatarDatabaseResults();
    $("avatarDatabaseStatus").textContent = avatarDatabaseProviderDescription();
    return;
  }
  if (!hasDatabaseSearchField(fields)) {
    state.avatarDatabaseResults = [];
    state.avatarDatabasePage = 0;
    state.avatarDatabaseHasMore = false;
    state.avatarDatabaseQuery = query;
    state.avatarDatabaseTotal = null;
    state.avatarDatabaseProgressTotal = 0;
    state.avatarDatabaseCountKey = "";
    state.avatarDatabaseCounting = false;
    state.avatarDatabaseLoading = false;
    state.avatarDatabaseSearched = false;
    state.avatarDatabaseMode = "search";
    state.avatarDatabaseRandomPages = [];
    renderAvatarDatabaseResults();
    $("avatarDatabaseStatus").textContent = "Enable at least one search field.";
    return;
  }
  $("databasePrevPageBtn").disabled = true;
  $("databaseNextPageBtn").disabled = true;
  if (page === 0) {
    state.avatarDatabaseProgressTotal = 0;
    state.avatarDatabaseCountKey = "";
  }
  state.avatarDatabaseLoading = true;
  renderAvatarDatabaseResults();
  $("avatarDatabaseStatus").textContent = page > 0
    ? `Loading ${providerLabel} page ${page + 1}...`
    : state.avatarDatabaseProvider === "all"
      ? "Searching all databases. This will take longer; single database searches are quicker."
      : `Searching ${providerLabel}...`;
  await new Promise((resolve) => setTimeout(resolve, state.avatarDatabaseProvider === "all" ? 50 : 0));
  try {
    const result = await api("avatarDatabaseSearch", databaseSearchPayload(query, page));
    if (token !== state.avatarDatabaseSearchToken) return;
    state.avatarDatabaseResults = result.results || [];
    state.avatarDatabasePage = Math.max(0, (result.page || page + 1) - 1);
    state.avatarDatabaseHasMore = Boolean(result.hasMore);
    state.avatarDatabaseQuery = query;
    state.avatarDatabaseMode = "search";
    state.avatarDatabaseRandomPages = [];
    state.avatarDatabaseTotal = Number(result.total) > 0 ? Number(result.total) : page === 0 ? null : state.avatarDatabaseTotal;
    state.avatarDatabaseCounting = state.avatarDatabaseResults.length > 0
      && state.avatarDatabaseTotal == null
      && state.avatarDatabaseProvider === "all"
      && (page === 0 || Boolean(state.avatarDatabaseCountKey));
    state.avatarDatabaseLoading = false;
    state.avatarDatabaseSearched = true;
    renderAvatarDatabaseResults();
    updateAvatarDatabaseStatus();
    if (page === 0 && state.avatarDatabaseResults.length && state.avatarDatabaseTotal == null && avatarDatabaseProvider() !== "vrcx") countAvatarDatabaseTotal(query, token, databaseSearchPayload(query, 0));
  } catch (e) { handleAvatarDatabaseError(e, token); }
  finally { }
}
async function runRandomAvatarDatabasePage() {
  const token = ++state.avatarDatabaseSearchToken;
  state.avatarDatabaseProvider = avatarDatabaseProvider();
  const providerLabel = avatarDatabaseProviderLabel();
  $("databasePrevPageBtn").disabled = true;
  $("databaseNextPageBtn").disabled = true;
  state.avatarDatabaseLoading = true;
  renderAvatarDatabaseResults();
  $("avatarDatabaseStatus").textContent = `Loading random ${providerLabel} avatars...`;
  try {
    let page = [];
    for (let attempt = 0; page.length < 50 && attempt < 5; attempt++) {
      const result = await api("avatarDatabaseRandom", { provider: avatarDatabaseProvider(), query: "", limit: 50, page: 1 }, 120000);
      if (token !== state.avatarDatabaseSearchToken) return;
      page = dedupeAvatarDatabaseResults([...page, ...(result.results || [])]).slice(0, 50);
    }
    state.avatarDatabaseMode = "random";
    state.avatarDatabaseRandomPages.push(page);
    state.avatarDatabaseResults = state.avatarDatabaseRandomPages.flat();
    state.avatarDatabasePage = state.avatarDatabaseRandomPages.length - 1;
    state.avatarDatabaseHasMore = false;
    state.avatarDatabaseQuery = "";
    state.avatarDatabaseTotal = state.avatarDatabaseResults.length;
    state.avatarDatabaseCounting = false;
    state.avatarDatabaseLoading = false;
    state.avatarDatabaseSearched = true;
    renderAvatarDatabaseResults();
    $("avatarDatabaseStatus").textContent = `${state.avatarDatabaseTotal} random ${providerLabel} avatars loaded.`;
  } catch (e) {
    handleAvatarDatabaseError(e, token);
  }
}
async function fetchRandomDatabaseAvatar() {
  const provider = avatarDatabaseProvider();
  const result = await api("avatarDatabaseRandom", { provider, query: "", limit: 50, page: 1 }, 120000);
  const results = dedupeAvatarDatabaseResults(result.results || []).filter((avatar) => String(avatar.avatarId || avatar.id || "").trim());
  if (!results.length) throw new Error(`No random ${avatarDatabaseProviderLabel(provider)} avatars found.`);
  return results[Math.floor(Math.random() * results.length)];
}
async function equipRandomDatabaseAvatar({ quiet = false } = {}) {
  if (!quiet) {
    $("equipRandomAvatarBtn").disabled = true;
    $("avatarDatabaseStatus").textContent = "Picking a random avatar to equip...";
  }
  try {
    const avatar = await fetchRandomDatabaseAvatar();
    await equipAvatar(avatar.avatarId || avatar.id, avatar);
    if (!quiet) $("avatarDatabaseStatus").textContent = `Equipped random avatar: ${avatar.name || avatar.avatarId || avatar.id}.`;
    return avatar;
  } catch (e) {
    if (!quiet) {
      const message = e?.message || String(e || "Random equip failed.");
      $("avatarDatabaseStatus").textContent = message;
      toast(message);
    }
    throw e;
  } finally {
    if (!quiet) $("equipRandomAvatarBtn").disabled = false;
  }
}
function openAvatarRouletteDialog(mode = 'favorites') {
  state.avatarRoulettePendingMode = mode;
  const label = mode === 'database' ? 'random database' : 'random favorite';
  const runningLabel = state.avatarRouletteMode === 'database' ? 'Database roulette' : 'Favorite roulette';
  $("avatarRouletteStatus").textContent = state.avatarRouletteRunning
    ? `${runningLabel} is running. Press Restart to switch to ${label} avatars.`
    : `Equip a ${label} avatar on a timer.`;
  $("stopAvatarRouletteBtn").disabled = !state.avatarRouletteRunning;
  $("startAvatarRouletteBtn").textContent = state.avatarRouletteRunning ? "Restart" : "Start";
  $("avatarRouletteDialog").showModal();
}
function avatarRouletteIntervalMs() {
  const minutes = Math.max(0, Math.floor(Number($("avatarRouletteMinutesInput").value)) || 0);
  const seconds = Math.max(0, Math.min(59, Math.floor(Number($("avatarRouletteSecondsInput").value)) || 0));
  $("avatarRouletteMinutesInput").value = String(minutes);
  $("avatarRouletteSecondsInput").value = String(seconds);
  const total = (minutes * 60000) + (seconds * 1000);
  return Math.max(5000, total || 60000);
}
function stopAvatarRoulette({ notify = true } = {}) {
  state.avatarRouletteRunId++;
  if (state.avatarRouletteTimer) clearTimeout(state.avatarRouletteTimer);
  state.avatarRouletteTimer = null;
  clearRouletteCountdown();
  state.avatarRouletteRunning = false;
  state.avatarRouletteEquipping = false;
  $("rouletteCountdownDb").hidden = true;
  $("rouletteCountdownFav").hidden = true;
  if ($("avatarRouletteDialog").open) {
    $("avatarRouletteStatus").textContent = "Avatar roulette stopped.";
    $("stopAvatarRouletteBtn").disabled = true;
    $("startAvatarRouletteBtn").textContent = "Start";
  }
  updateRouletteButtons();
  if (notify) toast("Avatar roulette stopped.");
}
function updateRouletteButtons() {
  const databaseRunning = state.avatarRouletteRunning && state.avatarRouletteMode === 'database';
  const favoritesRunning = state.avatarRouletteRunning && state.avatarRouletteMode === 'favorites';
  $("avatarRouletteBtn").classList.toggle("roulette-running", databaseRunning);
  $("avatarRouletteBtn").setAttribute("aria-pressed", databaseRunning ? "true" : "false");
  $("favRouletteBtn").classList.toggle("roulette-running", favoritesRunning);
  $("favRouletteBtn").setAttribute("aria-pressed", favoritesRunning ? "true" : "false");
}
function randomFavoriteAvatar() {
  const blockedGroups = new Set(["recent_avatars", "deleted_avatars", "updated_avatars", "uploaded_avatars"]);
  const seen = new Set();
  const avatars = state.library.avatars.filter((avatar) => {
    const avatarId = String(avatar.avatarId || avatar.id || "").trim();
    const groupId = String(avatar.groupId || "").toLowerCase();
    if (!avatarId || blockedGroups.has(groupId)) return false;
    const key = avatarId.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return avatars.length ? avatars[Math.floor(Math.random() * avatars.length)] : null;
}
async function runAvatarRouletteTick() {
  if (!state.avatarRouletteRunning || state.avatarRouletteEquipping) return;
  const runId = state.avatarRouletteRunId;
  state.avatarRouletteEquipping = true;
  clearRouletteCountdown();
  try {
    let avatar;
    if (state.avatarRouletteMode === 'database') {
      avatar = await fetchRandomDatabaseAvatar();
    } else {
      avatar = randomFavoriteAvatar();
    }
    if (!avatar) throw new Error("No avatars available for roulette.");
    const avatarId = avatar.avatarId || avatar.id;
    setRouletteProgressText(`Equipping ${avatar.name || avatarId}. Waiting for VRChat to confirm...`);
    const confirmedAvatar = await equipAvatarForRoulette(avatarId, avatar, runId);
    if (!state.avatarRouletteRunning || runId !== state.avatarRouletteRunId) return;
    const label = state.avatarRouletteMode === 'database' ? 'Database roulette' : 'Roulette';
    if (state.avatarRouletteMode === 'database') {
      $("avatarDatabaseStatus").textContent = `${label} equipped: ${confirmedAvatar.name || avatar.name || avatarId}.`;
    } else {
      $("activeGroupDescription").textContent = `${label} equipped: ${confirmedAvatar.name || avatar.name || avatarId}.`;
    }
    if ($("avatarRouletteDialog").open) $("avatarRouletteStatus").textContent = `Last equipped: ${confirmedAvatar.name || avatar.name || avatarId}. Next timer starts now.`;
    scheduleNextRouletteTick();
  } catch (e) {
    if (runId === state.avatarRouletteRunId) stopAvatarRoulette({ notify: false });
    const message = e?.message || String(e || "Avatar roulette stopped.");
    toast(message);
    if ($("avatarRouletteDialog").open) $("avatarRouletteStatus").textContent = message;
  } finally {
    if (runId === state.avatarRouletteRunId) state.avatarRouletteEquipping = false;
  }
}
async function equipAvatarForRoulette(id, avatarMeta = null, runId = state.avatarRouletteRunId) {
  const avatarId = String(id || "").trim();
  if (!avatarId) throw new Error("Roulette picked an avatar without an ID.");
  await waitForSyncQueueIdle(60000, () => setRouletteProgressText("Waiting for queued VRChat actions to finish before roulette equips..."));
  if (!state.avatarRouletteRunning || runId !== state.avatarRouletteRunId) throw new Error("Avatar roulette stopped.");
  const result = await api("vrchatSelectAvatar", { id: avatarId }, 45000);
  if (result?.groups && result?.avatars) {
    state.library = result;
    renderGroups();
    if (isRecentGroup(state.activeGroupId)) renderAvatars();
  }
  return await waitForAvatarEquipped(avatarId, avatarMeta, runId);
}
async function waitForSyncQueueIdle(timeoutMs = 60000, onWait = null) {
  const start = Date.now();
  while (state.syncQueueRunning || state.syncQueue.length) {
    if (typeof onWait === "function") onWait();
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for queued VRChat actions before roulette equip.");
    await delay(500);
  }
}
async function waitForAvatarEquipped(id, fallbackAvatar = null, runId = state.avatarRouletteRunId) {
  const target = normalizeAvatarIdForCompare(id);
  const label = fallbackAvatar?.name || id;
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < 90000) {
    if (!state.avatarRouletteRunning || runId !== state.avatarRouletteRunId) throw new Error("Avatar roulette stopped.");
    try {
      const avatar = await api("vrchatCurrentAvatar", {}, 30000);
      const currentId = normalizeAvatarIdForCompare(avatarPublicId(avatar) || avatar?.avatarId || avatar?.id);
      if (currentId && currentId === target) {
        applyConfirmedCurrentAvatar(id, avatar, fallbackAvatar);
        return avatar || fallbackAvatar || { avatarId: id, name: label };
      }
      setRouletteProgressText(`Waiting for VRChat to report ${label} as equipped...`);
    } catch (e) {
      lastError = e?.message || String(e || "");
      setRouletteProgressText(`Waiting for VRChat to confirm ${label}...`);
    }
    await delay(2500);
  }
  throw new Error(`VRChat did not report ${label} as equipped within 90 seconds.${lastError ? ` Last check: ${lastError}` : ""}`);
}
function applyConfirmedCurrentAvatar(id, avatar = null, fallbackAvatar = null) {
  const avatarId = String(id || avatarPublicId(avatar) || fallbackAvatar?.avatarId || fallbackAvatar?.id || "").trim();
  const name = avatar?.name || fallbackAvatar?.name || avatarId;
  const imageUrl = avatar?.imageUrl || fallbackAvatar?.imageUrl || "";
  const thumbnailImageUrl = avatar?.thumbnailImageUrl || avatar?.imageUrl || fallbackAvatar?.thumbnailImageUrl || fallbackAvatar?.imageUrl || "";
  state.currentAvatarSummary = { id: avatarId, name, imageUrl, thumbnailImageUrl };
  state.lastLoggedCurrentAvatarId = avatarId;
  if (state.vrchat?.user) {
    state.vrchat.user.currentAvatarId = avatarId;
    if (imageUrl) state.vrchat.user.currentAvatarImageUrl = imageUrl;
    if (thumbnailImageUrl) state.vrchat.user.currentAvatarThumbnailImageUrl = thumbnailImageUrl;
  }
  renderAccount();
}
function normalizeAvatarIdForCompare(id = "") {
  return String(id || "").trim().toLowerCase();
}
function scheduleNextRouletteTick() {
  if (!state.avatarRouletteRunning) return;
  const interval = avatarRouletteIntervalMs();
  if (state.avatarRouletteTimer) clearTimeout(state.avatarRouletteTimer);
  state.avatarRouletteTimer = setTimeout(() => {
    state.avatarRouletteTimer = null;
    void runAvatarRouletteTick();
  }, interval);
  resetRouletteCountdown(interval);
}
function resetRouletteCountdown(interval = avatarRouletteIntervalMs()) {
  const seconds = Math.round(interval / 1000);
  updateRouletteCountdownText(seconds);
  clearRouletteCountdown();
  state.avatarRouletteCountdownTimer = setInterval(() => {
    const el = countdownRouletteElement();
    if (!el || el.hidden) return;
    const text = el.textContent || "";
    const match = text.match(/(\d+)/);
    if (!match) return;
    const next = Math.max(0, parseInt(match[1], 10) - 1);
    updateRouletteCountdownText(next);
  }, 1000);
}
function clearRouletteCountdown() {
  if (state.avatarRouletteCountdownTimer) clearInterval(state.avatarRouletteCountdownTimer);
  state.avatarRouletteCountdownTimer = null;
}
function setRouletteProgressText(message) {
  if ($("avatarRouletteDialog").open) $("avatarRouletteStatus").textContent = message;
  if (state.avatarRouletteMode === 'database') $("avatarDatabaseStatus").textContent = message;
  else $("activeGroupDescription").textContent = message;
}

function countdownRouletteElement() {
  if (state.avatarRouletteMode === 'database') return $("rouletteCountdownDb");
  return $("rouletteCountdownFav");
}

function updateRouletteCountdownText(seconds) {
  const el = countdownRouletteElement();
  if (!el) return;
  if (seconds > 0) {
    el.textContent = `Next: ${seconds}s`;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

function startAvatarRoulette() {
  const nextMode = state.avatarRoulettePendingMode || state.avatarRouletteMode;
  stopAvatarRoulette({ notify: false });
  state.avatarRouletteMode = nextMode;
  state.avatarRouletteRunId++;
  const interval = avatarRouletteIntervalMs();
  if (interval < 30000) {
    toast("Warning: Fast intervals may not sync properly since VRChat takes time to process equips.");
  }
  state.avatarRouletteRunning = true;
  state.avatarRouletteEquipping = false;
  $("avatarRouletteStatus").textContent = "Avatar roulette started. Equipping the first avatar before starting the timer.";
  $("stopAvatarRouletteBtn").disabled = false;
  $("startAvatarRouletteBtn").textContent = "Restart";
  $("avatarRouletteDialog").close();
  updateRouletteButtons();
  toast("Avatar roulette started.");
  const label = state.avatarRouletteMode === 'database' ? 'Database roulette' : 'Roulette';
  if (state.avatarRouletteMode === 'database') {
    $("avatarDatabaseStatus").textContent = `${label} started. Equipping first avatar...`;
  } else {
    $("activeGroupDescription").textContent = `${label} started. Equipping first avatar...`;
  }
  void runAvatarRouletteTick();
}
function updateAvatarDatabaseStatus() {
  const count = state.avatarDatabaseResults.length;
  const providerLabel = avatarDatabaseProviderLabel(state.avatarDatabaseProvider);
  if (!count) { $("avatarDatabaseStatus").textContent = `No ${providerLabel} avatars found.`; return; }
  if (state.avatarDatabaseTotal == null) {
    if (state.avatarDatabaseProvider === "all") {
      const discovered = Math.max(state.avatarDatabaseProgressTotal || 0, state.avatarDatabasePage * 50 + count);
      state.avatarDatabaseProgressTotal = Math.max(state.avatarDatabaseProgressTotal || 0, discovered);
      const rounded = Math.max(50, Math.floor(discovered / 50) * 50);
      $("avatarDatabaseStatus").textContent = state.avatarDatabaseCounting || state.avatarDatabaseCountKey
        ? `${rounded}+ unique avatars found. Still counting total...`
        : `${state.avatarDatabasePage * 50 + count} all databases avatars shown.`;
      refreshDatabaseJumpIfOpen();
      return;
    }
    const estimate = state.avatarDatabaseHasMore ? `${Math.max((state.avatarDatabasePage + 2) * 50, count)}+` : String(state.avatarDatabasePage * 50 + count);
    $("avatarDatabaseStatus").textContent = `${estimate} total ${providerLabel} avatars found.`;
    return;
  }
  $("avatarDatabaseStatus").textContent = `${state.avatarDatabaseTotal} total ${providerLabel} avatars found.`;
}
async function countAvatarDatabaseTotal(query, token, payload) {
  const countPayload = payload ?? databaseSearchPayload(query, 0);
  const countKey = JSON.stringify(countPayload);
  state.avatarDatabaseCountKey = countKey;
  let progressTimer = null;
  const pollProgress = async () => {
    if (state.avatarDatabaseCountKey !== countKey || state.avatarDatabaseQuery !== query || avatarDatabaseProvider() !== "all") return;
    try {
      const progress = await api("avatarDatabaseCountProgress", countPayload, 30000);
      if (state.avatarDatabaseCountKey !== countKey || state.avatarDatabaseQuery !== query || avatarDatabaseProvider() !== "all") return;
      const discovered = Number(progress.discovered) || 0;
      if (discovered > state.avatarDatabaseProgressTotal) {
        state.avatarDatabaseProgressTotal = discovered;
        updateAvatarDatabaseStatus();
      }
    } catch {
    }
  };
  if (avatarDatabaseProvider() === "all") {
    state.avatarDatabaseProgressTotal = Math.max(state.avatarDatabaseProgressTotal || 0, state.avatarDatabaseResults.length);
    progressTimer = setInterval(pollProgress, 900);
    void pollProgress();
  }
  try {
    const result = await api("avatarDatabaseCount", countPayload);
    if (state.avatarDatabaseCountKey !== countKey || state.avatarDatabaseQuery !== query) return;
    state.avatarDatabaseTotal = Number(result.total) || state.avatarDatabaseResults.length;
    state.avatarDatabaseProgressTotal = state.avatarDatabaseTotal;
    state.avatarDatabaseCounting = false;
    updateAvatarDatabaseStatus();
    renderAvatarDatabaseResults();
  } catch (e) {
    if (state.avatarDatabaseCountKey === countKey && state.avatarDatabaseQuery === query) {
      state.avatarDatabaseCounting = false;
      updateAvatarDatabaseStatus();
    }
  } finally {
    if (progressTimer) clearInterval(progressTimer);
  }
}
function handleAvatarDatabaseError(error, token) {
  if (token !== state.avatarDatabaseSearchToken) return;
  state.avatarDatabaseLoading = false;
  state.avatarDatabaseSearched = true;
  const message = error?.message || String(error || "Database search failed.");
  $("avatarDatabaseStatus").textContent = message;
  toast(message);
  const captchaUrl = avtrZipCaptchaUrl(message);
  if (captchaUrl) openAvtrZipCaptcha(captchaUrl);
}
function avtrZipCaptchaUrl(message) {
  const match = String(message || "").match(/https:\/\/g\.avtr\.zip\/[^\s"'<>]+/i);
  return match ? match[0] : "";
}
function openAvtrZipCaptcha(url) {
  $("captchaFrame").src = url;
  $("captchaDialog").showModal();
}
function currentAvatarDatabasePageResults() {
  if (state.avatarDatabaseMode !== "random") return state.avatarDatabaseResults;
  return state.avatarDatabaseRandomPages[state.avatarDatabasePage] || [];
}
function sortedAvatarDatabaseResults() {
  const sort = $("databaseSortSelect").value;
  const results = dedupeAvatarDatabaseResults(currentAvatarDatabasePageResults());
  if (sort === "updatedDesc") return results.sort((a, b) => new Date(b.remoteUpdatedAt || b.updatedAt || 0) - new Date(a.remoteUpdatedAt || a.updatedAt || 0));
  if (sort === "createdDesc") return results.sort((a, b) => new Date(b.remoteCreatedAt || b.createdAt || 0) - new Date(a.remoteCreatedAt || a.createdAt || 0));
  if (sort === "nameAsc") return results.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  if (sort === "authorAsc") return results.sort((a, b) => (a.authorName || "").localeCompare(b.authorName || ""));
  return results;
}
function dedupeAvatarDatabaseResults(results) {
  const merged = [];
  const byDuplicateKey = new Map();
  for (const avatar of results || []) {
    const keys = avatarDuplicateKeys(avatar);
    const existing = keys.map((key) => byDuplicateKey.get(key)).find(Boolean);
    if (!existing) {
      for (const key of keys) byDuplicateKey.set(key, avatar);
      merged.push(avatar);
      continue;
    }
    existing.source = mergeTextList(existing.source, avatar.source, /[,+|;]/);
    existing.platforms = mergeTextList(existing.platforms, avatar.platforms, /,/);
    existing.tags = mergeTextList(existing.tags, avatar.tags, /,/);
    for (const field of ["name", "authorName", "authorId", "description", "releaseStatus", "version", "sourceUrl", "rawJson", "remoteCreatedAt", "remoteUpdatedAt"]) {
      if (!String(existing[field] || "").trim() && String(avatar[field] || "").trim()) existing[field] = avatar[field];
    }
    if (!String(existing.imageUrl || "").trim() && String(avatar.imageUrl || "").trim()) existing.imageUrl = avatar.imageUrl;
    if (!String(existing.thumbnailImageUrl || "").trim()) existing.thumbnailImageUrl = avatar.thumbnailImageUrl || avatar.imageUrl || "";
  }
  return merged;
}
function avatarDuplicateKeys(avatar) {
  const keys = [];
  const id = String(avatar?.avatarId || avatar?.id || "").trim().toLowerCase();
  if (id) keys.push(`id:${id}`);
  const name = normalizeDuplicateText(avatar?.name);
  const image = normalizeDuplicateImageUrl(avatar?.thumbnailImageUrl || avatar?.imageUrl);
  if (name && image) {
    const author = normalizeDuplicateText(avatar?.authorName);
    keys.push(`visual:${name}|${author}|${image}`, `visual-name:${name}|${image}`);
  }
  const authorName = normalizeDuplicateText(avatar?.authorName);
  if (name && authorName) keys.push(`name-author:${name}|${authorName}`);
  return keys;
}
function normalizeDuplicateText(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").trim().toLowerCase();
}
function normalizeDuplicateImageUrl(value) {
  return String(value || "").trim().split("?")[0].replace(/\/+$/, "").toLowerCase();
}
function mergeTextList(a, b, splitter) {
  return [...new Set([...(String(a || "").split(splitter)), ...(String(b || "").split(splitter))].map((x) => x.trim()).filter(Boolean))].join(", ");
}
function renderAvatarDatabaseResults() {
  const allResults = sortedAvatarDatabaseResults();
  const results = allResults;
  const grid = $("avatarDatabaseResults");
  grid.innerHTML = "";
  $("avatarDatabaseEmptyState").hidden = state.avatarDatabaseLoading || !state.avatarDatabaseSearched || allResults.length !== 0;
  const databaseMax = databaseMaxPage("database");
  const hasMultipleDatabasePages = state.avatarDatabasePage > 0 || state.avatarDatabaseHasMore || databaseMax > 1;
  $("avatarDatabasePagination").hidden = !hasMultipleDatabasePages;
  $("databasePrevPageBtn").disabled = state.avatarDatabasePage <= 0;
  $("databaseNextPageBtn").disabled = state.avatarDatabaseMode === "random" ? state.avatarDatabasePage >= state.avatarDatabaseRandomPages.length - 1 : !state.avatarDatabaseHasMore;
  const totalText = state.avatarDatabaseTotal == null ? "" : ` of ${Math.max(1, Math.ceil(state.avatarDatabaseTotal / 50))}`;
  $("databasePageStatus").textContent = allResults.length ? `Page ${state.avatarDatabasePage + 1}${totalText}` : "";
  for (const avatar of results) {
    const image = avatar.thumbnailImageUrl || avatar.imageUrl;
    const release = releaseStatusBadge(avatar.releaseStatus);
    const sourceBadges = avatarSourceBadgeHtml(avatar.source);
    const card = document.createElement("article");
    card.className = "avatar-card database-avatar-card";
    card.dataset.avatarId = avatar.avatarId || avatar.id;
    card.draggable = true;
    card.innerHTML = `<button type="button"><div class="thumb">${image ? `<img src="${escapeAttr(image)}" alt="">` : "<span>No thumbnail</span>"}</div><div class="avatar-info"><div class="avatar-name">${escapeHtml(avatar.name || avatar.avatarId)}</div><div class="meta-line">${escapeHtml(displayAvatarAuthorName(avatar) || "Author unavailable")}</div><div class="badges">${release ? `<span class="badge ${release.className}">${escapeHtml(release.label)}</span>` : ""}${databasePlatformBadgeLabels(avatar.platforms).map((p) => `<span class="badge ${p.className}">${escapeHtml(p.label)}</span>`).join("")}${sourceBadges}</div></div></button><div class="avatar-card-footer"><button class="avatar-card-save primary" type="button" title="Save avatar">Save</button><button class="avatar-card-equip primary" type="button" title="Equip avatar">Equip</button></div>`;
    card.querySelector("button").addEventListener("click", () => openAvatarDialog({ ...avatar, groupId: state.activeGroupId }));
    card.querySelector(".avatar-card-save").addEventListener("click", (event) => { event.stopPropagation(); openAddDatabaseAvatarDialog(avatar); });
    card.querySelector(".avatar-card-equip").addEventListener("click", (event) => { event.stopPropagation(); equipAvatar(avatar.avatarId || avatar.id); });
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, [
        { label: "Add to Group", action: () => openAddDatabaseAvatarDialog(avatar) }
      ]);
    });
    card.addEventListener("dragstart", (event) => {
      if (event.target.closest(".avatar-card-save, .avatar-card-equip")) {
        event.preventDefault();
        return;
      }
      const rect = card.getBoundingClientRect();
      state.pendingDatabaseDragAvatar = avatar;
      state.dragSort = { type: "database-avatar", id: avatar.avatarId || avatar.id, avatar, dragWidth: rect.width, dragHeight: rect.height };
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/plain", avatar.avatarId || avatar.id || "");
      setEmptyDragPreview(event);
      createFloatingAvatarDragPreview(card.querySelector(".thumb"), event);
      card.classList.add("dragging");
      startDragAutoScroll(event);
    });
    card.addEventListener("dragend", () => {
      state.dragSort = null;
      state.pendingDatabaseDragAvatar = null;
      clearDragSortIndicators();
    });
    grid.appendChild(card);
  }
}
function openAddDatabaseAvatarDialog(avatar) {
  state.pendingDatabaseAvatar = avatar;
  $("addDatabaseAvatarName").textContent = `Choose a group for "${avatar.name || avatar.avatarId}".`;
  fillSelectWithGroups($("databaseAvatarGroupInput"), state.activeGroupId);
  $("confirmAddDatabaseAvatarBtn").disabled = !$("databaseAvatarGroupInput").value;
  $("addDatabaseAvatarDialog").showModal();
}
async function saveDatabaseAvatarToGroup(avatar, groupId, { focusTarget = false, confirm = false } = {}) {
  const group = state.library.groups.find((x) => x.id === groupId);
  if (!avatar || !group) return;
  if (!canManuallyAddToGroup(groupId)) { toast("Recent and Deleted groups are managed automatically."); return; }
  if (avatarAlreadyInGroup(avatar, groupId)) return showAvatarAlreadyInGroup(avatar, group);
  if (!syncedGroupHasCapacity(groupId, avatar.avatarId || avatar.id)) return;
  if (confirm && !await confirmAction({ title: "Save Avatar", message: `Save "${avatar.name || avatar.avatarId || "this avatar"}" to "${group.name}"?`, confirmLabel: "Save", confirmClass: "primary" })) return;
  try {
    await pushSyncedAvatarAdd(avatar.avatarId || avatar.id, groupId);
    state.library = await api("saveAvatar", { ...avatar, id: "", groupId, source: avatar.source || (avatarDatabaseProvider() === "avtrzip" ? "avtrzip" : "avatar-database") });
    if (focusTarget) {
      state.activeGroupId = groupId;
      state.avatarPage = 0;
    }
    render();
    toast(`Added "${avatar.name || avatar.avatarId}".`);
  } catch (e) { handleAvatarAddError(e); }
}
function openDatabaseJumpDialog() {
  if (!state.avatarDatabaseResults.length) return;
  state.pageJumpTarget = "database";
  const maxPage = String(databaseMaxPage());
  $("databaseJumpPageInput").value = String(state.avatarDatabasePage + 1);
  $("databaseJumpPageInput").max = maxPage;
  $("databaseJumpPageNumber").max = maxPage;
  $("databaseJumpPageNumber").value = String(state.avatarDatabasePage + 1);
  updateDatabaseJumpSlider();
  $("databaseJumpDialog").showModal();
  $("databaseJumpPageNumber").focus();
}
function openAvatarJumpDialog() {
  if (state.avatarFilteredCount <= 0 || avatarMaxPage() <= 1) return;
  state.pageJumpTarget = "avatars";
  const maxPage = String(avatarMaxPage());
  $("databaseJumpPageInput").value = String(state.avatarPage + 1);
  $("databaseJumpPageInput").max = maxPage;
  $("databaseJumpPageNumber").max = maxPage;
  $("databaseJumpPageNumber").value = String(state.avatarPage + 1);
  updateDatabaseJumpSlider();
  $("databaseJumpDialog").showModal();
  $("databaseJumpPageNumber").focus();
}
function databaseMaxPage(target = state.pageJumpTarget) {
  if (target === "avatars") return avatarMaxPage();
  if (state.avatarDatabaseMode === "random") return Math.max(1, state.avatarDatabaseRandomPages.length);
  if (state.avatarDatabaseTotal != null) return Math.max(1, Math.ceil(state.avatarDatabaseTotal / 50));
  const progressPages = state.avatarDatabaseProvider === "all"
    ? Math.floor(Math.max(0, Number(state.avatarDatabaseProgressTotal) || 0) / 50)
    : 0;
  return Math.max(1, progressPages, state.avatarDatabasePage + (state.avatarDatabaseHasMore ? 2 : 1));
}
function refreshDatabaseJumpIfOpen() {
  if ($("databaseJumpDialog")?.open && state.pageJumpTarget === "database") updateDatabaseJumpSlider();
}
function updateDatabaseJumpSlider() {
  const maxPage = databaseMaxPage();
  const page = Math.min(maxPage, Math.max(1, Math.floor(Number($("databaseJumpPageInput").value)) || 1));
  $("databaseJumpPageInput").value = String(page);
  $("databaseJumpPageNumber").value = $("databaseJumpPageInput").value;
  $("databaseJumpPageNumber").max = String(maxPage);
  $("databaseJumpPageMax").textContent = state.pageJumpTarget === "database" && state.avatarDatabaseTotal == null && state.avatarDatabaseCounting ? `${maxPage}+` : String(maxPage);
  $("databaseJumpPrevBtn").disabled = page <= 1;
  $("databaseJumpNextBtn").disabled = page >= maxPage;
}
function stepDatabaseJump(delta) {
  const input = $("databaseJumpPageInput");
  const maxPage = databaseMaxPage();
  input.value = String(Math.min(maxPage, Math.max(1, (Math.floor(Number(input.value)) || 1) + delta)));
  updateDatabaseJumpSlider();
}
function syncDatabaseJumpFromNumber() {
  $("databaseJumpPageInput").value = $("databaseJumpPageNumber").value;
  updateDatabaseJumpSlider();
}

function showContextMenu(x, y, actions) {
  const menu = $("contextMenu");
  const openDialog = document.querySelector("dialog[open]");
  if (openDialog && menu.parentElement !== openDialog) openDialog.append(menu);
  else if (!openDialog && menu.parentElement !== document.body) document.body.append(menu);
  menu.style.width = "";
  const menuActions = actions.some((action) => /^cancel\b/i.test(action.label || ""))
    ? actions
    : [...actions, { label: "Cancel", action: hideContextMenu }];
  menu.innerHTML = menuActions.map((a, i) => `<button type="button" data-index="${i}" class="${escapeAttr(a.className || "")}" ${a.disabled ? "disabled" : ""}>${escapeHtml(a.label)}</button>`).join("");
  menu.onclick = (event) => event.stopPropagation();
  menu.hidden = false;
  menu.style.width = `${Math.ceil(Math.min(menu.scrollWidth, Math.min(260, window.innerWidth - 16)))}px`;
  menu.style.left = `${Math.min(x, window.innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    const action = menuActions[Number(b.dataset.index)];
    if (!action || action.disabled) return;
    hideContextMenu();
    action.action();
  }));
}
function hideContextMenu() {
  const menu = $("contextMenu");
  menu.hidden = true;
  document.querySelectorAll(".chat-actions-menu").forEach((item) => { item.hidden = true; });
  if (menu.parentElement !== document.body) document.body.append(menu);
  hideSortMenu();
  hideSortMenu("databaseSortMenu", "databaseSortMenuBtn");
  hideSortMenu("groupFilterMenu", "groupFilterMenuBtn");
  hideSortMenu("avatarDatabaseProviderMenu", "avatarDatabaseProviderMenuBtn");
  hideSortMenu("settingsLogFilterMenu", "settingsLogFilterMenuBtn");
  hideSortMenu("worldDiscoveryFilterMenu", "worldDiscoveryFilterMenuBtn");
  hideSortMenu("notificationFilterMenu", "notificationFilterMenuBtn");
  hideSortMenu("bgEffectMenu", "bgEffectMenuBtn");
  hideSortMenu("backgroundEffectMenu", "backgroundEffectMenuBtn");
  hideSortMenu("inviteMessageSlotMenu", "inviteMessageSlotBtn");
  hideDatabaseFieldMenu();
}
function hideDatabaseFieldMenu() {
  $("databaseFieldMenu").hidden = true;
  $("databaseFieldMenuBtn").setAttribute("aria-expanded", "false");
  $("databaseFieldMenuBtn").closest(".database-field-dropdown")?.classList.remove("open");
}
function updateDatabaseFieldMenuButton() {
  const ids = ["databaseSearchAvatarToggle", "databaseSearchAuthorToggle", "databaseSearchDescriptionToggle", "databaseSearchTagsToggle", "databasePlatformPcToggle", "databasePlatformAndroidToggle", "databasePlatformIosToggle"];
  const checked = ids.filter((id) => $(id).checked).length;
  $("databaseFieldMenuBtn").textContent = checked ? `Search By (${checked})` : "Search By";
}
function toggleDatabaseFieldMenu(event) {
  event.stopPropagation();
  const menu = $("databaseFieldMenu");
  if (!menu.hidden) return hideDatabaseFieldMenu();
  hideContextMenu();
  menu.hidden = false;
  $("databaseFieldMenuBtn").setAttribute("aria-expanded", "true");
  $("databaseFieldMenuBtn").closest(".database-field-dropdown")?.classList.add("open");
}
function dropdownLabelHtml(label) {
  return `<span class="app-dropdown-label">${escapeHtml(label || "")}</span>`;
}
function setDropdownButtonText(buttonId, label, fallback = "Sort") {
  const button = $(buttonId);
  if (!button) return;
  const text = label || fallback;
  button.innerHTML = dropdownLabelHtml(text);
  button.title = text;
}
function renderSortMenu(selectId = "sortSelect", menuId = "sortMenu", buttonId = "sortMenuBtn", onChange = resetAvatarPageAndRender) {
  const select = $(selectId);
  const menu = $(menuId);
  if (selectId === "sortSelect") normalizeAvatarSortForActiveGroup();
  menu.innerHTML = visibleSortOptions(selectId).map((o) => {
    const label = o.textContent || "";
    return `<button type="button" data-value="${escapeAttr(o.value)}" title="${escapeAttr(label)}" aria-checked="${o.selected}">${dropdownLabelHtml(label)}</button>`;
  }).join("");
  menu.querySelectorAll("button").forEach((b) => {
    if (menuId === "backgroundEffectMenu") {
      b.addEventListener("mouseenter", () => {
        startBgEffect(backgroundDialogPreviewEffect(b.dataset.value || ""));
      });
    }
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      select.value = b.dataset.value;
      if (menuId === "backgroundEffectMenu") menu.dataset.committed = "true";
      hideSortMenu(menuId, buttonId);
      updateSortButton(selectId, buttonId);
      onChange();
    });
  });
}
function updateSortButton(selectId = "sortSelect", buttonId = "sortMenuBtn") {
  const s = $(selectId);
  if (!s || !$(buttonId)) return;
  const label = s.options[s.selectedIndex]?.textContent ?? "Sort";
  setDropdownButtonText(buttonId, label);
}
function cycleSortOption(event, selectId = "sortSelect", buttonId = "sortMenuBtn", onChange = resetAvatarPageAndRender) {
  const select = $(selectId);
  if (!select || select.disabled || $(buttonId)?.disabled || select.options.length < 2) return;
  event.preventDefault();
  event.stopPropagation();
  const direction = event.deltaY > 0 ? 1 : -1;
  if (selectId === "sortSelect") normalizeAvatarSortForActiveGroup();
  const options = visibleSortOptions(selectId);
  const currentIndex = Math.max(0, options.findIndex((option) => option.value === select.value));
  select.value = options[(currentIndex + direction + options.length) % options.length].value;
  hideSortMenu();
  hideSortMenu("databaseSortMenu", "databaseSortMenuBtn");
  hideSortMenu("groupFilterMenu", "groupFilterMenuBtn");
  hideSortMenu("avatarDatabaseProviderMenu", "avatarDatabaseProviderMenuBtn");
  hideSortMenu("settingsLogFilterMenu", "settingsLogFilterMenuBtn");
  hideSortMenu("worldDiscoveryFilterMenu", "worldDiscoveryFilterMenuBtn");
  hideSortMenu("notificationFilterMenu", "notificationFilterMenuBtn");
  hideSortMenu("bgEffectMenu", "bgEffectMenuBtn");
  hideSortMenu("backgroundEffectMenu", "backgroundEffectMenuBtn");
  hideDatabaseFieldMenu();
  updateSortButton(selectId, buttonId);
  onChange();
}
function hideSortMenu(menuId = "sortMenu", buttonId = "sortMenuBtn") {
  const menu = $(menuId);
  const button = $(buttonId);
  if (!menu || !button) return;
  const wasOpen = !menu.hidden;
  menu.hidden = true;
  menu.style.position = "";
  menu.style.left = "";
  menu.style.top = "";
  menu.style.width = "";
  menu.style.maxHeight = "";
  button.setAttribute("aria-expanded", "false");
  button.closest(".sort-control")?.classList.remove("open");
  if (menuId === "backgroundEffectMenu") {
    document.body.classList.remove("background-effect-preview");
    if (wasOpen && menu.dataset.committed !== "true") applyActiveBackgroundEffect();
    delete menu.dataset.committed;
  }
  renderSyncQueueStatus();
}
function renderSyncQueueStatus() {
  const el = $("syncQueueStatus");
  if (!el) return;
  const pending = state.syncQueue.length + (state.syncQueueRunning ? 1 : 0);
  const status = state.syncQueueStatus || { state: "idle", message: "" };
  el.className = `sync-queue-status ${status.state || "idle"}`;
  el.hidden = !state.vrchat?.isLoggedIn && !pending && status.state !== "failed";
  if (status.state === "failed") {
    el.textContent = status.message || "Sync action failed.";
  } else if (state.syncQueueRunning || state.syncQueue.length) {
    el.textContent = `${status.message || "Syncing VRChat changes..."}${state.syncQueue.length ? ` ${state.syncQueue.length} pending.` : ""}`;
  } else {
    el.textContent = "VRChat sync idle.";
  }
}
function renderSocialSidebar() {
  if (state.activePage !== "friends" && state.activePage !== "worlds" && state.activePage !== "messages" && state.activePage !== "notifications") return;
  const list = $("groupList");
  const title = document.querySelector(".groups-header h2");
  document.querySelector(".groups-header-actions").hidden = state.activePage !== "worlds";
  $("addGroupBtn").hidden = state.activePage !== "worlds";
  document.querySelector(".group-filter-sort").hidden = true;
  $("importBtn").hidden = true;
  $("exportBtn").hidden = true;
  if (!state.vrchat?.isLoggedIn) {
    title.textContent = state.activePage === "worlds" ? "Worlds" : state.activePage === "messages" ? "Messages" : state.activePage === "notifications" ? "Activity" : "Friends";
    list.innerHTML = `<div class="group-empty">Log in to VRChat.</div>`;
    return;
  }
  if (state.activePage === "notifications") {
    title.textContent = "Activity";
    list.innerHTML = activityFilterSidebarHtml();
    list.querySelectorAll("[data-activity-filter]").forEach((button) => button.addEventListener("click", () => {
      state.activityFilter = button.dataset.activityFilter || "players";
      state.playerActivityLog.page = 0;
      renderSocialSidebar();
      renderNotificationsPage();
    }));
    return;
  }
  if (state.activePage === "messages") {
    title.textContent = "Messages";
    list.innerHTML = messageConversations().slice(0, 24).map(messageSidebarConversationHtml).join("") || `<div class="group-empty">No messages yet.</div>`;
    list.querySelectorAll("[data-message-user]").forEach((button) => button.addEventListener("click", () => { state.selectedMessageUserId = button.dataset.messageUser || ""; renderMessagesPage(); renderSocialSidebar(); }));
    return;
  }
  if (state.activePage === "friends") {
    title.textContent = "Friends";
    list.innerHTML = state.social.friends.length || state.social.favoriteFriends.length ? friendsSidebarHtml(state.social.friends, state.social.favoriteFriends) : `<div class="group-empty">No friends loaded.</div>`;
    list.querySelectorAll("[data-social-sidebar-tab]").forEach((button) => button.addEventListener("click", () => {
      state.social.sidebarTab = button.dataset.socialSidebarTab || "friends";
      renderSocialSidebar();
    }));
    list.querySelectorAll("[data-friend-id]").forEach((button) => button.addEventListener("click", () => selectSocialFriend(button.dataset.friendId, { clickedPresence: button.dataset.presence })));
    return;
  }
  title.textContent = "Worlds";
  list.innerHTML = favoriteWorldGroupSidebarHtml();
  list.querySelectorAll("[data-world-group]").forEach((button) => button.addEventListener("click", () => selectFavoriteWorldGroup(button.dataset.worldGroup)));
  list.querySelectorAll("[data-world-group]").forEach((button) => button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const group = worldSidebarGroupsModel().find((item) => item.key === button.dataset.worldGroup);
    if (!group || group.type !== "local") return;
    showContextMenu(event.clientX, event.clientY, [
      { label: "Edit Group", action: () => editLocalWorldGroup(group.key) },
      { label: "Move Up", action: () => reorderLocalWorldGroup(group.key, -1) },
      { label: "Move Down", action: () => reorderLocalWorldGroup(group.key, 1) },
      { label: "Delete Group", className: "danger", action: () => deleteLocalWorldGroup(group.key) }
    ]);
  }));
}
function toggleSortMenu(event, selectId = "sortSelect", menuId = "sortMenu", buttonId = "sortMenuBtn", onChange = resetAvatarPageAndRender) {
  event.stopPropagation();
  if (!$(menuId).hidden) return hideSortMenu(menuId, buttonId);
  renderSortMenu(selectId, menuId, buttonId, onChange);
  document.querySelectorAll(".sort-control.open").forEach((el) => el.classList.remove("open"));
  $(menuId).hidden = false;
  $(buttonId).setAttribute("aria-expanded", "true");
  $(buttonId).closest(".sort-control")?.classList.add("open");
  if (menuId === "backgroundEffectMenu") {
    delete $(menuId).dataset.committed;
    document.body.classList.add("background-effect-preview");
  }
}

function clearDropIndicators({ clearPlaceholder = false } = {}) {
  document.querySelectorAll(".drop-before, .drop-after, .drop-target").forEach((x) => x.classList.remove("drop-before", "drop-after", "drop-target"));
  if (state.dragSort) state.dragSort.dropIndicatorKey = null;
  if (clearPlaceholder) clearDropPlaceholder();
}
function clearDragSortIndicators() {
  document.querySelectorAll(".dragging, .drop-before, .drop-after, .drop-target").forEach((x) => x.classList.remove("dragging", "drop-before", "drop-after", "drop-target"));
  clearDropPlaceholder();
  clearFloatingDragPreview();
  stopDragAutoScroll();
}
function clearDropPlaceholder() { document.querySelectorAll(".drop-placeholder").forEach((x) => x.remove()); }
function clearFloatingDragPreview() { document.querySelectorAll(".floating-drag-preview").forEach((x) => x.remove()); }
function setEmptyDragPreview(event) {
  if (!event.dataTransfer) return;
  const preview = document.createElement("div");
  preview.style.width = "1px";
  preview.style.height = "1px";
  preview.style.opacity = "0";
  preview.style.position = "fixed";
  preview.style.left = "-10000px";
  preview.style.top = "-10000px";
  preview.style.pointerEvents = "none";
  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(preview, 0, 0);
  requestAnimationFrame(() => preview.remove());
}
function createFloatingAvatarDragPreview(element, point) {
  if (!element) return;
  clearFloatingDragPreview();
  const rect = element.getBoundingClientRect();
  const preview = element.cloneNode(true);
  preview.classList.add("floating-drag-preview");
  preview.style.width = `${rect.width}px`;
  preview.style.height = `${rect.height}px`;
  document.body.appendChild(preview);
  updateFloatingDragPreview(point);
}
function updateFloatingDragPreview(point) {
  const preview = document.querySelector(".floating-drag-preview");
  if (!preview || !point) return;
  preview.style.left = `${point.clientX}px`;
  preview.style.top = `${point.clientY}px`;
}
function pointerTarget(selector, point) {
  for (const element of document.elementsFromPoint(point.clientX, point.clientY)) {
    const target = element.closest?.(selector);
    if (target && !target.classList.contains("dragging")) return target;
  }
  return null;
}
function dragAfterCard(event, card) {
  const rect = card.getBoundingClientRect();
  const rowBandTop = rect.top + rect.height * 0.28;
  const rowBandBottom = rect.bottom - rect.height * 0.28;
  if (event.clientY < rowBandTop) return false;
  if (event.clientY > rowBandBottom) return true;
  return event.clientX > rect.left + rect.width / 2;
}
function avatarDropSlot(point, cards) {
  if (!cards.length) return { target: null, after: true };
  const target = pointerTarget(".avatar-card", point);
  return { target, after: target ? dragAfterCard(point, target) : true };
}
function groupDropSlot(point, items) {
  if (!items.length) return { target: null, after: true };
  const target = pointerTarget('.group-item[data-can-reorder="true"]', point);
  if (!target) return { target: null, after: true };
  const rect = target.getBoundingClientRect();
  return { target, after: point.clientY > rect.top + rect.height / 2 };
}
function trailingSlotRect(container, previous, type) {
  const rect = previous.getBoundingClientRect();
  const style = getComputedStyle(container);
  const columnGap = parseFloat(style.columnGap || style.gap) || 0;
  const rowGap = parseFloat(style.rowGap || style.gap) || 0;
  const containerRect = container.getBoundingClientRect();
  if (type === "group") return { left: rect.left, top: rect.bottom + rowGap, width: rect.width, height: rect.height };
  const nextLeft = rect.right + columnGap;
  if (nextLeft + rect.width <= containerRect.right) return { left: nextLeft, top: rect.top, width: rect.width, height: rect.height };
  return { left: containerRect.left, top: rect.bottom + rowGap, width: rect.width, height: rect.height };
}
function dropSlotRect(container, items, target, after, type) {
  if (!target) {
    const rect = container.getBoundingClientRect();
    const style = getComputedStyle(container);
    return {
      left: rect.left + (parseFloat(style.paddingLeft) || 0),
      top: rect.top + (parseFloat(style.paddingTop) || 0),
      width: state.dragSort?.dragWidth || rect.width,
      height: state.dragSort?.dragHeight || (type === "group" ? 42 : 120)
    };
  }
  if (!after) return target.getBoundingClientRect();
  const next = items[items.indexOf(target) + 1];
  return next ? next.getBoundingClientRect() : trailingSlotRect(container, target, type);
}
function applyDropIndicator(type, target, after, rect) {
  const id = target?.dataset?.[type === "avatar" ? "avatarId" : "groupId"] ?? "";
  const key = `${type}:${id}`;
  if (state.dragSort?.dropIndicatorKey !== key) {
    clearDropIndicators();
    if (target) target.classList.add("drop-target");
    if (state.dragSort) state.dragSort.dropIndicatorKey = key;
  }
}
function updateAvatarDropTarget(event) {
  if (state.dragSort?.type !== "avatar") return null;
  const grid = $("avatarGrid");
  const cards = [...grid.querySelectorAll(".avatar-card:not(.dragging)")];
  if (!cards.length) {
    const rect = dropSlotRect(grid, cards, null, true, "avatar");
    applyDropIndicator("avatar", null, true, rect);
    state.dragSort.dropTargetId = "";
    state.dragSort.dropAfter = true;
    state.dragSort.dropPosition = state.avatarPage * AVATAR_PAGE_SIZE + 1;
    return null;
  }
  const slot = avatarDropSlot(event, cards);
  const best = slot.target;
  if (!best) {
    clearDropIndicators({ clearPlaceholder: true });
    state.dragSort.dropTargetId = "";
    state.dragSort.dropAfter = true;
    state.dragSort.dropPosition = null;
    return null;
  }
  const after = slot.after;
  const rect = dropSlotRect(grid, cards, best, after, "avatar");
  applyDropIndicator("avatar", best, after, rect);
  state.dragSort.dropTargetId = best.dataset.avatarId;
  state.dragSort.dropAfter = after;
  state.dragSort.dropPosition = null;
  return best;
}
function updateGroupDropTarget(event) {
  if (state.dragSort?.type !== "group") return null;
  const list = $("groupList");
  const items = [...list.querySelectorAll('.group-item[data-can-reorder="true"]:not(.dragging)')];
  if (!items.length) return null;
  const slot = groupDropSlot(event, items);
  const best = slot.target;
  if (!best) {
    clearDropIndicators({ clearPlaceholder: true });
    state.dragSort.dropTargetId = "";
    state.dragSort.dropAfter = true;
    state.dragSort.dropPosition = null;
    return null;
  }
  const after = slot.after;
  const rect = dropSlotRect(list, items, best, after, "group");
  applyDropIndicator("group", best, after, rect);
  state.dragSort.dropTargetId = best.dataset.groupId;
  state.dragSort.dropAfter = after;
  state.dragSort.dropPosition = null;
  return best;
}
function startDragAutoScroll(event) {
  if (!state.dragSort) return;
  state.dragPoint = { clientX: event.clientX, clientY: event.clientY };
  updateFloatingDragPreview(state.dragPoint);
  if (!state.dragScrollFrame) state.dragScrollFrame = requestAnimationFrame(runDragAutoScroll);
}
function stopDragAutoScroll() {
  if (state.dragScrollFrame) cancelAnimationFrame(state.dragScrollFrame);
  state.dragScrollFrame = null;
  state.dragPoint = null;
}
function runDragAutoScroll() {
  state.dragScrollFrame = null;
  if (!state.dragSort || !state.dragPoint) return;
  const scrolled = scrollDragContainers(state.dragPoint);
  if (scrolled && state.dragSort?.type === "avatar" && pointInside($("avatarGrid"), state.dragPoint)) updateAvatarDropTarget(state.dragPoint);
  if (scrolled && state.dragSort?.type === "group" && pointInside($("groupList"), state.dragPoint)) updateGroupDropTarget(state.dragPoint);
  if (state.dragSort) state.dragScrollFrame = requestAnimationFrame(runDragAutoScroll);
}
function dragScrollContainers() {
  if (!state.dragSort) return [];
  if (state.dragSort.type === "group") return [$("groupList")];
  if (state.dragSort.type === "database-avatar") return [$("avatarDatabaseResults"), $("groupList")];
  return isSyncedAvatarEditDrag() ? [$("avatarGrid")] : [$("avatarGrid"), $("groupList")];
}
function scrollDragContainers(point) {
  if (!state.dragSort) return false;
  const containers = dragScrollContainers();
  let scrolled = false;
  for (const container of containers) {
    const rect = container.getBoundingClientRect();
    if (point.clientX < rect.left || point.clientX > rect.right || point.clientY < rect.top || point.clientY > rect.bottom) continue;
    const edge = 70;
    const maxSpeed = 16;
    let delta = 0;
    if (point.clientY < rect.top + edge) delta = -Math.ceil(((rect.top + edge - point.clientY) / edge) * maxSpeed);
    else if (point.clientY > rect.bottom - edge) delta = Math.ceil(((point.clientY - (rect.bottom - edge)) / edge) * maxSpeed);
    if (delta) {
      const before = container.scrollTop;
      container.scrollTop += delta;
      scrolled = scrolled || container.scrollTop !== before;
    }
  }
  return scrolled;
}
function autoScrollDrag(event) {
  startDragAutoScroll(event);
}
function wheelScrollDuringDrag(event) {
  if (!state.dragSort) return;
  const containers = dragScrollContainers();
  const target = containers.find((container) => {
    const rect = container.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  });
  if (!target) return;
  target.scrollTop += event.deltaY;
  event.preventDefault();
}
function keyScrollDuringDrag(event) {
  if (!state.dragSort || !["ArrowUp", "ArrowDown"].includes(event.key)) return false;
  const containers = dragScrollContainers();
  const point = state.dragPoint;
  const target = point ? containers.find((container) => pointInside(container, point)) : containers[0];
  if (!target) return false;
  const before = target.scrollTop;
  target.scrollTop += event.key === "ArrowDown" ? 96 : -96;
  if (target.scrollTop === before) return false;
  if (point) {
    if (state.dragSort.type === "avatar" && target === $("avatarGrid")) updateAvatarDropTarget(point);
    if (state.dragSort.type === "group" && target === $("groupList")) updateGroupDropTarget(point);
  }
  event.preventDefault();
  event.stopPropagation();
  return true;
}
function showZoomIndicator() {
  clearTimeout(showZoomIndicator.readTimer);
  showZoomIndicator.readTimer = setTimeout(() => {
    const scale = Math.max(25, Math.round(((window.devicePixelRatio || BASE_DEVICE_PIXEL_RATIO) / BASE_DEVICE_PIXEL_RATIO) * 100));
    const indicator = $("zoomIndicator");
    indicator.textContent = `${scale}%`;
    indicator.hidden = false;
    indicator.classList.add("visible");
    clearTimeout(showZoomIndicator.hideTimer);
    showZoomIndicator.hideTimer = setTimeout(() => {
      indicator.classList.remove("visible");
      indicator.hidden = true;
    }, 1200);
  }, 80);
}
function trackZoomWheel(event) {
  if (!event.ctrlKey) return;
  showZoomIndicator();
}
function pointInside(element, point) {
  if (!element || !point) return false;
  const rect = element.getBoundingClientRect();
  return point.clientX >= rect.left && point.clientX <= rect.right && point.clientY >= rect.top && point.clientY <= rect.bottom;
}
function handleGroupListDragOver(event) {
  if (state.dragSort?.type !== "group" || event.target.closest(".group-item")) return;
  event.preventDefault();
  startDragAutoScroll(event);
  updateGroupDropTarget(event);
}
async function handleGroupListDrop(event) {
  if (state.dragSort?.type !== "group" || event.target.closest(".group-item")) return;
  event.preventDefault();
  updateGroupDropTarget(event);
  await commitDraggedGroupDrop();
}
function handleAvatarGridDragOver(event) {
  if (state.dragSort?.type !== "avatar") return;
  event.preventDefault();
  startDragAutoScroll(event);
  updateAvatarDropTarget(event);
}
async function handleAvatarGridDrop(event) {
  if (state.dragSort?.type !== "avatar") return;
  event.preventDefault();
  event.stopPropagation();
  updateAvatarDropTarget(event);
  await commitDraggedAvatarDrop();
}
async function commitDraggedGroupDrop() {
  const drag = state.dragSort;
  if (drag?.type !== "group") return;
  const targetId = drag.dropTargetId;
  const groups = reorderableGroups();
  const draggedId = drag.id;
  const drop = targetId ? { type: "group", id: draggedId, targetId, x: state.dragPoint?.clientX ?? window.innerWidth / 2, y: state.dragPoint?.clientY ?? window.innerHeight / 2 } : null;
  const position = drag.dropPosition || (!targetId ? groups.length : null);
  state.dragSort = null;
  clearDragSortIndicators();
  if (drop) {
    showDropPlacementMenu(drop);
    return;
  }
  if (position) await reorderGroup(draggedId, position);
}
async function commitDraggedAvatarDrop() {
  const drag = state.dragSort;
  if (drag?.type !== "avatar") return;
  if ((drag.ids?.length || 0) > 1) {
    state.dragSort = null;
    clearDragSortIndicators();
    toast("Multiple selected avatars can be dragged to another group.");
    return;
  }
  if (drag.copyOnly) {
    state.dragSort = null;
    clearDragSortIndicators();
    return;
  }
  const targetId = drag.dropTargetId;
  const groupId = drag.groupId || state.activeGroupId;
  const draggedId = drag.id;
  const drop = targetId ? { type: "avatar", id: draggedId, targetId, groupId, x: state.dragPoint?.clientX ?? window.innerWidth / 2, y: state.dragPoint?.clientY ?? window.innerHeight / 2 } : null;
  const position = drag.dropPosition || (!targetId ? orderedGroupAvatars(groupId).length : null);
  state.dragSort = null;
  clearDragSortIndicators();
  if (drop) {
    showDropPlacementMenu(drop);
    return;
  }
  if (position) await reorderAvatar(draggedId, groupId, position);
}
async function reorderGroup(id, position) {
  try {
    state.library = await api("reorderGroup", { id, position });
    state.activeGroupId = id;
    render();
  } catch (e) { toast(e.message); }
}
async function setGroupReorderLock(id, reorderLocked) {
  try {
    state.library = await api("setGroupReorderLock", { id, reorderLocked });
    render();
  } catch (e) { toast(e.message); }
}
async function setSyncedAvatarEditMode(enabled) {
  const group = activeGroup();
  if (group && isVrcPlusGroup(group.id) && !hasVrcPlusFavoriteGroups()) {
    showVrcPlusRequired();
    renderToolbar();
    return;
  }
  if (!group || !canEditSyncedAvatarOrder(group)) return;
  if (!enabled) {
    await cancelSyncedAvatarEdit();
    return;
  }
  if (state.syncedAvatarEdit.groupId && state.syncedAvatarEdit.groupId !== group.id) {
    const oldGroup = state.library.groups.find((x) => x.id === state.syncedAvatarEdit.groupId);
    if (!await confirmAction({ title: "Discard Edit Mode", message: `Discard unapplied sorting changes for "${oldGroup?.name || "the other group"}"?`, confirmLabel: "Discard", confirmClass: "danger" })) {
      renderToolbar();
      return;
    }
    state.syncedAvatarEdit = { groupId: "", avatarIds: [], backupPath: "", applying: false };
  }
  if (isSyncedAvatarEditActive(group.id)) return;
  try {
    $("searchInput").value = "";
    state.avatarPage = 0;
    state.syncedAvatarEdit = {
      groupId: group.id,
      avatarIds: orderedGroupAvatars(group.id).map((avatar) => avatar.id),
      backupPath: "",
      applying: false
    };
    $("sortSelect").value = "manual";
    updateSortButton();
    render();
  } catch (e) {
    state.syncedAvatarEdit = { groupId: "", avatarIds: [], backupPath: "", applying: false };
    renderToolbar();
    toast(e.message);
  }
}
async function cancelSyncedAvatarEdit() {
  if (!state.syncedAvatarEdit.groupId) return;
  if (!await confirmAction({ title: "Cancel Edit Mode", message: "Discard unapplied synced avatar sorting changes?", confirmLabel: "Discard", confirmClass: "danger" })) {
    renderToolbar();
    return;
  }
  state.syncedAvatarEdit = { groupId: "", avatarIds: [], backupPath: "", applying: false };
  clearDragSortIndicators();
  setDefaultAvatarSortForActiveGroup();
  render();
}
async function applySyncedAvatarEdit() {
  const group = state.library.groups.find((x) => x.id === state.syncedAvatarEdit.groupId);
  if (!group || !isSyncedAvatarEditActive(group.id)) return;
  const savedOrder = currentSyncedEditAvatarOrder();
  const confirmed = await confirmAction({
    title: "Save Synced Order",
    message: `This saves the new order to "${group.name}". It can take a bit to appear in game.`,
    confirmLabel: "Save",
    confirmClass: "primary"
  });
  if (!confirmed) return;
  state.syncedAvatarEdit.applying = true;
  renderToolbar();
  const stopProgress = startSyncedAvatarApplyProgress(group.id);
  const syncAction = createSyncAction("synced-order", `Save order for ${group.name}`, { groupId: group.id, avatarIds: savedOrder });
  try {
    $("activeGroupDescription").textContent = "Starting synced order save...";
    const result = await runRecordedSyncAction(
      syncAction,
      () => api("applySyncedAvatarOrder", { groupId: group.id, avatarIds: savedOrder }, 1800000)
    );
    state.library = result.library;
    state.syncedAvatarEdit = { groupId: "", avatarIds: [], backupPath: "", applying: false };
    setDefaultAvatarSortForActiveGroup();
    stopProgress();
    render();
    toast(`Saved ${result.added || 0} avatars to ${group.name}. Backup: ${result.backupPath || "created"}`);
  } catch (e) {
    stopProgress();
    state.syncedAvatarEdit.applying = false;
    renderToolbar();
    toast(e.message);
  }
}
function startSyncedAvatarApplyProgress(groupId) {
  let stopped = false;
  const renderProgress = (progress) => {
    if (stopped || !progress || progress.groupId !== groupId) return;
    const total = Number(progress.total) || 0;
    const completed = Math.min(total, Math.max(0, Number(progress.completed) || 0));
    const count = total > 0 ? ` ${completed}/${total}` : "";
    $("activeGroupDescription").textContent = `${progress.message || "Saving synced order..."}${count}`;
  };
  const poll = async () => {
    try { renderProgress(await api("syncedAvatarOrderProgress", {}, 45000)); }
    catch { }
  };
  poll();
  const timer = setInterval(poll, 900);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
function currentSyncedEditAvatarOrder() {
  const cards = [...$("avatarGrid").querySelectorAll(".avatar-card")]
    .map((card) => card.dataset.avatarId)
    .filter(Boolean);
  if (cards.length === state.syncedAvatarEdit.avatarIds.length) {
    state.syncedAvatarEdit.avatarIds = cards;
  }
  return [...state.syncedAvatarEdit.avatarIds];
}
function reorderDraftAvatar(id, groupId, position) {
  if (!isSyncedAvatarEditActive(groupId)) return false;
  const order = [...state.syncedAvatarEdit.avatarIds];
  const currentIndex = order.indexOf(id);
  if (currentIndex < 0) return false;
  order.splice(currentIndex, 1);
  order.splice(Math.min(order.length, Math.max(0, position - 1)), 0, id);
  state.syncedAvatarEdit.avatarIds = order;
  $("sortSelect").value = "manual";
  updateSortButton();
  renderAvatars();
  renderToolbar();
  return true;
}
async function reorderAvatar(id, groupId, position) {
  if (reorderDraftAvatar(id, groupId, position)) return;
  if (isSyncedGroup(groupId)) {
    toast("Enable edit mode before reordering synced avatars.");
    return;
  }
  try {
    $("sortSelect").value = "manual";
    updateSortButton();
    state.library = await api("reorderAvatar", { id, groupId, position });
    renderAvatars();
  } catch (e) { toast(e.message); }
}
async function reorderAvatarsRelativeToTarget(ids, targetId, groupId, placement) {
  const ordered = orderedGroupAvatars(groupId);
  const movingSet = new Set(ids);
  if (movingSet.has(targetId)) return;
  const moving = ordered.filter((avatar) => movingSet.has(avatar.id)).map((avatar) => avatar.id);
  const remaining = ordered.filter((avatar) => !movingSet.has(avatar.id)).map((avatar) => avatar.id);
  const targetIndex = remaining.indexOf(targetId);
  if (!moving.length || targetIndex < 0) return;
  const insertIndex = targetIndex + (placement === "after" ? 1 : 0);
  if (isSyncedAvatarEditActive(groupId)) {
    const next = [...remaining];
    next.splice(insertIndex, 0, ...moving);
    state.syncedAvatarEdit.avatarIds = next;
    $("sortSelect").value = "manual";
    updateSortButton();
    renderAvatars();
    renderToolbar();
    return;
  }
  try {
    $("sortSelect").value = "manual";
    updateSortButton();
    for (let i = 0; i < moving.length; i++) {
      state.library = await api("reorderAvatar", { id: moving[i], groupId, position: insertIndex + i + 1 });
    }
    renderAvatars();
  } catch (e) { toast(e.message); }
}
function showDropPlacementMenu(drop) {
  if (!drop?.id || !drop?.targetId || drop.id === drop.targetId) {
    clearDragSortIndicators();
    return;
  }
  showContextMenu(drop.x, drop.y, [
    { label: "Move Before", action: () => placeDroppedItem(drop, "before") },
    { label: "Move After", action: () => placeDroppedItem(drop, "after") },
    { label: "Swap Places", action: () => placeDroppedItem(drop, "swap") },
    { label: "Cancel", className: "separated", action: hideContextMenu }
  ]);
}
async function placeDroppedItem(drop, placement) {
  if (drop.type === "group") {
    const groups = reorderableGroups();
    if (placement === "swap") return swapGroupPositions(drop.id, drop.targetId);
    const position = movePositionFromDrop(groups, drop.id, drop.targetId, placement === "after");
    if (position) await reorderGroup(drop.id, position);
    return;
  }
  if (drop.type === "avatar") {
    const avatars = orderedGroupAvatars(drop.groupId);
    if (placement === "swap") return swapAvatarPositions(drop.id, drop.targetId, drop.groupId);
    const position = movePositionFromDrop(avatars, drop.id, drop.targetId, placement === "after");
    if (position) await reorderAvatar(drop.id, drop.groupId, position);
  }
}
async function swapGroupPositions(id, targetId) {
  const groups = reorderableGroups();
  const draggedPosition = listPosition(groups, id);
  const targetPosition = listPosition(groups, targetId);
  if (draggedPosition <= 0 || targetPosition <= 0 || id === targetId) return;
  try {
    state.library = await api("reorderGroup", { id, position: targetPosition });
    state.library = await api("reorderGroup", { id: targetId, position: draggedPosition });
    state.activeGroupId = id;
    render();
  } catch (e) { toast(e.message); }
}
async function swapAvatarPositions(id, targetId, groupId) {
  const avatars = orderedGroupAvatars(groupId);
  const draggedPosition = listPosition(avatars, id);
  const targetPosition = listPosition(avatars, targetId);
  if (draggedPosition <= 0 || targetPosition <= 0 || id === targetId) return;
  if (isSyncedAvatarEditActive(groupId)) {
    const order = [...state.syncedAvatarEdit.avatarIds];
    const draggedIndex = order.indexOf(id);
    const targetIndex = order.indexOf(targetId);
    if (draggedIndex < 0 || targetIndex < 0) return;
    [order[draggedIndex], order[targetIndex]] = [order[targetIndex], order[draggedIndex]];
    state.syncedAvatarEdit.avatarIds = order;
    renderAvatars();
    renderToolbar();
    return;
  }
  try {
    $("sortSelect").value = "manual";
    updateSortButton();
    state.library = await api("reorderAvatar", { id, groupId, position: targetPosition });
    state.library = await api("reorderAvatar", { id: targetId, groupId, position: draggedPosition });
    renderAvatars();
  } catch (e) { toast(e.message); }
}
async function moveAvatarToGroup(id, groupId, { confirm = true, focusTarget = true } = {}) {
  const avatar = state.library.avatars.find((x) => x.id === id);
  const group = state.library.groups.find((x) => x.id === groupId);
  if (!avatar || !group || avatar.groupId === groupId) return;
  if (isPinnedSystemGroup(avatar.groupId)) { toast("Recent and Deleted avatars can only be copied to another group."); return; }
  if (!canManuallyAddToGroup(groupId)) { toast("Recent and Deleted groups are managed automatically."); return; }
  if (avatarAlreadyInGroup(avatar, groupId, id)) return showAvatarAlreadyInGroup(avatar, group);
  if (!syncedGroupHasCapacity(groupId, avatar.avatarId || avatar.id, id)) return;
  if (confirm && !await confirmAction({ title: "Move Avatar", message: `Move "${avatar.name || avatar.avatarId}" to "${group.name}"?`, confirmLabel: "Move", confirmClass: "primary" })) return;
  const oldGroupId = avatar.groupId;
  try {
    await pushSyncedAvatarMove(avatar.avatarId || avatar.id, oldGroupId, groupId);
    state.library = await api("moveAvatar", { avatarId: id, groupId });
    state.activeGroupId = groupId;
    state.avatarPage = 0;
    $("sortSelect").value = "manual";
    updateSortButton();
    render();
    toast("Avatar moved.");
  } catch (e) { handleAvatarAddError(e); }
}
async function moveAvatarsRelativeToTarget(ids, targetAvatar, placement, copy = false) {
  const sourceAvatars = ids.map((id) => state.library.avatars.find((x) => x.id === id)).filter(Boolean);
  if (sourceAvatars.length > 1) return moveOrCopyAvatarsRelativeToTarget(sourceAvatars, targetAvatar, placement, copy);
  const id = ids[0];
  const sourceAvatar = state.library.avatars.find((x) => x.id === id);
  const targetGroupId = targetAvatar?.groupId;
  const targetGroup = state.library.groups.find((x) => x.id === targetGroupId);
  if (!sourceAvatar || !targetAvatar || !targetGroup || sourceAvatar.groupId === targetGroupId) return;
  if (!copy && isPinnedSystemGroup(sourceAvatar.groupId)) { toast("Recent and Deleted avatars can only be copied to another group."); return; }
  if (!canManuallyAddToGroup(targetGroupId)) { toast("Recent and Deleted groups are managed automatically."); return; }
  if (isSyncedGroup(targetGroupId)) { toast("Move before, move after, copy before, and copy after are only available for local groups."); return; }
  if (avatarAlreadyInGroup(sourceAvatar, targetGroupId, id)) return showAvatarAlreadyInGroup(sourceAvatar, targetGroup);
  const targetPosition = listPosition(orderedGroupAvatars(targetGroupId), targetAvatar.id);
  if (targetPosition <= 0) return;
  try {
    if (copy) {
      state.library = await api("copyAvatar", { avatarId: id, groupId: targetGroupId });
    } else {
      await pushSyncedAvatarMove(sourceAvatar.avatarId || sourceAvatar.id, sourceAvatar.groupId, targetGroupId);
      state.library = await api("moveAvatar", { avatarId: id, groupId: targetGroupId });
    }
    const placedAvatar = state.library.avatars
      .filter((candidate) => candidate.groupId === targetGroupId && (copy ? candidate.id !== id && (candidate.avatarId || candidate.id) === (sourceAvatar.avatarId || sourceAvatar.id) : candidate.id === id))
      .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))[0];
    if (!placedAvatar) return;
    const position = placement === "after" ? targetPosition + 1 : targetPosition;
    state.library = await api("reorderAvatar", { id: placedAvatar.id, groupId: targetGroupId, position });
    state.activeGroupId = targetGroupId;
    state.avatarPage = Math.floor((Math.max(1, position) - 1) / AVATAR_PAGE_SIZE);
    $("sortSelect").value = "manual";
    updateSortButton();
    render();
    toast(copy ? "Avatar copied." : "Avatar moved.");
  } catch (e) { handleAvatarAddError(e); }
}
async function moveOrCopyAvatarsRelativeToTarget(sourceAvatars, targetAvatar, placement, copy = false) {
  const targetGroupId = targetAvatar?.groupId;
  const targetGroup = state.library.groups.find((x) => x.id === targetGroupId);
  if (!sourceAvatars.length || !targetAvatar || !targetGroup) return;
  if (!copy && sourceAvatars.some((avatar) => isPinnedSystemGroup(avatar.groupId))) { toast("Recent and Deleted avatars can only be copied to another group."); return; }
  if (!canManuallyAddToGroup(targetGroupId)) { toast("Recent and Deleted groups are managed automatically."); return; }
  if (isSyncedGroup(targetGroupId)) { toast("Move before, move after, copy before, and copy after are only available for local groups."); return; }
  const movable = sourceAvatars.filter((avatar) => avatar.groupId !== targetGroupId && !avatarAlreadyInGroup(avatar, targetGroupId, avatar.id));
  if (!movable.length) { showAvatarAlreadyInGroup(sourceAvatars[0], targetGroup); return; }
  const targetPosition = listPosition(orderedGroupAvatars(targetGroupId), targetAvatar.id);
  if (targetPosition <= 0) return;
  const placedIds = [];
  try {
    for (const avatar of movable) {
      if (copy) {
        const beforeIds = new Set(state.library.avatars.map((item) => item.id));
        state.library = await api("copyAvatar", { avatarId: avatar.id, groupId: targetGroupId });
        const copied = state.library.avatars.find((item) => !beforeIds.has(item.id) && item.groupId === targetGroupId);
        if (copied) placedIds.push(copied.id);
      } else {
        await pushSyncedAvatarMove(avatar.avatarId || avatar.id, avatar.groupId, targetGroupId);
        state.library = await api("moveAvatar", { avatarId: avatar.id, groupId: targetGroupId });
        placedIds.push(avatar.id);
      }
    }
    const insertPosition = placement === "after" ? targetPosition + 1 : targetPosition;
    for (let i = 0; i < placedIds.length; i++) {
      state.library = await api("reorderAvatar", { id: placedIds[i], groupId: targetGroupId, position: insertPosition + i });
    }
    state.activeGroupId = targetGroupId;
    state.avatarPage = Math.floor((Math.max(1, insertPosition) - 1) / AVATAR_PAGE_SIZE);
    clearAvatarSelection();
    $("sortSelect").value = "manual";
    updateSortButton();
    render();
    toast(copy ? `${placedIds.length} avatars copied.` : `${placedIds.length} avatars moved.`);
  } catch (e) { handleAvatarAddError(e); }
}
async function placeAvatarInGroupEnd(id, groupId, copy = false, { focusTarget = true } = {}) {
  const sourceAvatar = state.library.avatars.find((x) => x.id === id);
  const targetGroup = state.library.groups.find((x) => x.id === groupId);
  if (!sourceAvatar || !targetGroup) return;
  if (!copy && sourceAvatar.groupId === groupId) {
    const position = orderedGroupAvatars(groupId).length;
    if (position > 0) await reorderAvatar(id, groupId, position);
    return;
  }
  if (!copy && isPinnedSystemGroup(sourceAvatar.groupId)) { toast("Recent and Deleted avatars can only be copied to another group."); return; }
  if (!canManuallyAddToGroup(groupId)) { toast("Recent and Deleted groups are managed automatically."); return; }
  if (isSyncedGroup(groupId)) { toast("Place here and copy here are only available for local groups."); return; }
  if (sourceAvatar.groupId !== groupId && avatarAlreadyInGroup(sourceAvatar, groupId, id)) return showAvatarAlreadyInGroup(sourceAvatar, targetGroup);
  try {
    if (copy) {
      state.library = await api("copyAvatar", { avatarId: id, groupId });
    } else {
      await pushSyncedAvatarMove(sourceAvatar.avatarId || sourceAvatar.id, sourceAvatar.groupId, groupId);
      state.library = await api("moveAvatar", { avatarId: id, groupId });
    }
    if (focusTarget) state.activeGroupId = groupId;
    state.avatarPage = Math.max(0, Math.floor((orderedGroupAvatars(groupId).length - 1) / AVATAR_PAGE_SIZE));
    $("sortSelect").value = "manual";
    updateSortButton();
    render();
    toast(copy ? "Avatar copied." : "Avatar moved.");
  } catch (e) { handleAvatarAddError(e); }
}
async function moveAvatarsToGroup(ids, groupId, { confirm = true, focusTarget = true } = {}) {
  const avatars = ids.map((id) => state.library.avatars.find((x) => x.id === id)).filter(Boolean).filter((avatar) => avatar.groupId !== groupId);
  const group = state.library.groups.find((x) => x.id === groupId);
  if (!avatars.length || !group) return;
  if (avatars.some((avatar) => isPinnedSystemGroup(avatar.groupId))) { toast("Recent and Deleted avatars can only be copied to another group."); return; }
  if (!canManuallyAddToGroup(groupId)) { toast("Recent and Deleted groups are managed automatically."); return; }
  const movable = avatars.filter((avatar) => !avatarAlreadyInGroup(avatar, groupId, avatar.id));
  if (!movable.length) { showAvatarAlreadyInGroup(avatars[0], group); return; }
  if (!syncedGroupHasCapacityForAvatars(groupId, movable.map((avatar) => avatar.avatarId || avatar.id))) return;
  if (confirm && !await confirmAction({ title: "Move Avatars", message: `Move ${movable.length} selected avatars to "${group.name}"?`, confirmLabel: "Move", confirmClass: "primary" })) return;
  let moved = 0;
  for (const avatar of movable) {
    try {
      await pushSyncedAvatarMove(avatar.avatarId || avatar.id, avatar.groupId, groupId);
      state.library = await api("moveAvatar", { avatarId: avatar.id, groupId });
      moved++;
    } catch (e) { handleAvatarAddError(e); break; }
  }
  if (focusTarget) {
    state.activeGroupId = groupId;
    state.avatarPage = 0;
  }
  clearAvatarSelection();
  $("sortSelect").value = "manual";
  updateSortButton();
  render();
  if (moved) toast(`${moved} avatars moved.`);
}
async function moveOrCopyAvatarsToGroup(ids, groupId, { focusTarget = true } = {}) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length <= 1) return moveOrCopySingleAvatarToGroup(uniqueIds[0], groupId, { focusTarget });
  const avatars = uniqueIds.map((id) => state.library.avatars.find((x) => x.id === id)).filter(Boolean);
  const group = state.library.groups.find((x) => x.id === groupId);
  if (!avatars.length || !group) return;
  if (!canManuallyAddToGroup(groupId)) { toast("Recent and Deleted groups are managed automatically."); return; }
  const copyOnly = avatars.some((avatar) => isPinnedSystemGroup(avatar.groupId));
  const movable = avatars.filter((avatar) => avatar.groupId !== groupId && !avatarAlreadyInGroup(avatar, groupId, avatar.id));
  if (!movable.length) { showAvatarAlreadyInGroup(avatars[0], group); return; }
  if (!syncedGroupHasCapacityForAvatars(groupId, movable.map((avatar) => avatar.avatarId || avatar.id))) return;
  const choice = await chooseMoveOrCopyAvatar({ name: `${movable.length} selected avatars` }, group, { copyOnly });
  if (choice === "copy") await copyAvatarsToGroup(movable.map((avatar) => avatar.id), groupId, { focusTarget });
  else if (choice === "move") await moveAvatarsToGroup(movable.map((avatar) => avatar.id), groupId, { confirm: false, focusTarget });
}
async function moveOrCopySingleAvatarToGroup(id, groupId, { focusTarget = true } = {}) {
  const avatar = state.library.avatars.find((x) => x.id === id);
  const group = state.library.groups.find((x) => x.id === groupId);
  if (!avatar || !group || avatar.groupId === groupId) return;
  if (!canManuallyAddToGroup(groupId)) { toast("Recent and Deleted groups are managed automatically."); return; }
  if (avatarAlreadyInGroup(avatar, groupId, id)) return showAvatarAlreadyInGroup(avatar, group);
  if (!syncedGroupHasCapacity(groupId, avatar.avatarId || avatar.id)) return;
  const choice = await chooseMoveOrCopyAvatar(avatar, group, { copyOnly: isPinnedSystemGroup(avatar.groupId) });
  if (choice === "copy") await copyAvatarToGroup(id, groupId, { focusTarget });
  else if (choice === "move") await moveAvatarToGroup(id, groupId, { confirm: false, focusTarget });
}
async function copyAvatarToGroup(id, groupId, { focusTarget = true } = {}) {
  const avatar = state.library.avatars.find((x) => x.id === id);
  const group = state.library.groups.find((x) => x.id === groupId);
  if (!avatar || !group || avatar.groupId === groupId) return;
  if (!canManuallyAddToGroup(groupId)) { toast("Recent and Deleted groups are managed automatically."); return; }
  if (avatarAlreadyInGroup(avatar, groupId, id)) return showAvatarAlreadyInGroup(avatar, group);
  if (!syncedGroupHasCapacity(groupId, avatar.avatarId || avatar.id)) return;
  try {
    await pushSyncedAvatarAdd(avatar.avatarId || avatar.id, groupId);
    state.library = await api("copyAvatar", { avatarId: id, groupId });
    if (focusTarget) state.activeGroupId = groupId;
    state.avatarPage = 0;
    $("sortSelect").value = "manual";
    updateSortButton();
    render();
    toast("Avatar copied.");
  } catch (e) { toast(e.message); }
}
function avatarAlreadyInGroup(avatar, groupId, excludeId = "") {
  const ids = avatarIdentityValues(avatar);
  if (!ids.size) return false;
  return state.library.avatars.some((item) =>
    item.id !== excludeId &&
    item.groupId === groupId &&
    [...avatarIdentityValues(item)].some((id) => ids.has(id))
  );
}
function avatarIdentityValues(avatar) {
  return new Set([avatar?.avatarId, avatar?.id]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean));
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function syncRetryDelay(error, attempt) {
  const text = String(error?.message || error || "").toLowerCase();
  if (text.includes("rate") || text.includes("429")) return 30000;
  return [2000, 6000, 15000][Math.min(attempt, 2)];
}
function syncActionPayload(item, status, error = "") {
  return {
    id: item.id,
    kind: item.kind,
    label: item.label,
    status,
    attempt: item.attempt || 0,
    error,
    payload: JSON.stringify(item.payload || {})
  };
}
function recordSyncAction(item, status, error = "") {
  api("syncActionRecord", syncActionPayload(item, status, error), 10000).catch(() => {});
}
function createSyncAction(kind, label, payload = {}, attempt = 1) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind,
    label,
    payload,
    attempt
  };
}
function enqueueVrChatAction({ kind, label, run, retries = 3, payload = {} }) {
  const item = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind,
    label,
    run,
    retries,
    payload,
    attempt: 0
  };
  state.syncQueue.push(item);
  recordSyncAction(item, "queued");
  state.syncQueueStatus = { state: "waiting", message: `Queued: ${label}` };
  renderSyncQueueStatus();
  void processVrChatSyncQueue();
  return item.id;
}
async function processVrChatSyncQueue() {
  if (state.syncQueueRunning) return;
  state.syncQueueRunning = true;
  renderSyncQueueStatus();
  try {
    while (state.syncQueue.length) {
      const item = state.syncQueue.shift();
      let done = false;
      while (!done) {
        item.attempt++;
        state.syncQueueStatus = { state: "running", message: item.attempt > 1 ? `Retrying: ${item.label}` : `Syncing: ${item.label}` };
        renderSyncQueueStatus();
        recordSyncAction(item, item.attempt > 1 ? "retrying" : "running");
        try {
          const result = await item.run();
          recordSyncAction(item, "completed");
          done = true;
          if (result?.groups && result?.avatars) {
            state.library = result;
            renderGroups();
            if (isRecentGroup(state.activeGroupId)) renderAvatars();
          }
        } catch (error) {
          if (item.attempt >= item.retries) {
            const message = `${item.label} failed: ${error.message || error}`;
            state.syncQueueStatus = { state: "failed", message };
            recordSyncAction(item, "failed", error.message || String(error));
            showSyncFailureDialog(item, error);
            done = true;
          } else {
            const wait = syncRetryDelay(error, item.attempt - 1);
            state.syncQueueStatus = { state: "waiting", message: `Waiting to retry: ${item.label}` };
            recordSyncAction(item, "waiting", error.message || String(error));
            renderSyncQueueStatus();
            await delay(wait);
          }
        }
      }
    }
    if (state.syncQueueStatus.state !== "failed") state.syncQueueStatus = { state: "idle", message: "" };
  } finally {
    state.syncQueueRunning = false;
    renderSyncQueueStatus();
  }
}
function showSyncFailureDialog(item, error) {
  const reason = error?.message || String(error || "Unknown error");
  confirmAction({
    title: "Sync Action Failed",
    message: `${item.label}\n\nReason: ${reason}\n\nThe action was saved in Settings > Sync where it can be dismissed.`,
    confirmLabel: "OK",
    confirmClass: "primary",
    hideCancel: true
  });
}
async function runRecordedSyncAction(item, run, timeoutMessage = "") {
  recordSyncAction(item, "running");
  try {
    const result = await run();
    recordSyncAction(item, "completed");
    return result;
  } catch (error) {
    recordSyncAction(item, "failed", error.message || String(error));
    if (timeoutMessage) toast(timeoutMessage);
    showSyncFailureDialog(item, error);
    throw error;
  }
}
function showAvatarAlreadyInGroup(avatar, group) {
  return confirmAction({
    title: "Avatar Already in Group",
    message: `"${avatar.name || avatar.avatarId || "This avatar"}" is already in "${group.name}".`,
    confirmLabel: "OK",
    confirmClass: "primary",
    hideCancel: true
  });
}
function chooseMoveOrCopyAvatar(avatar, group, { copyOnly = false } = {}) {
  return queueConfirmDialog(() => new Promise((resolve) => {
    const moveDisabled = isPinnedSystemGroup(avatar.groupId);
    $("confirmDialogTitle").textContent = copyOnly ? "Copy Avatar" : "Move or Copy Avatar";
    $("confirmDeleteMessage").textContent = moveDisabled
      ? `Recent and Deleted avatars can only be copied. Copy "${avatar.name || avatar.avatarId}" to "${group.name}"?`
      : `Move or copy "${avatar.name || avatar.avatarId}" to "${group.name}"?`;
    $("runConfirmBtn").textContent = "Move";
    $("runConfirmBtn").className = "primary";
    $("runConfirmBtn").hidden = copyOnly;
    $("runConfirmBtn").disabled = moveDisabled;
    $("cancelConfirmBtn").hidden = false;
    $("cancelConfirmBtn").textContent = "Cancel";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "primary";
    copyBtn.textContent = "Copy";
    $("runConfirmBtn").after(copyBtn);
    let settled = false;
    const done = (value) => { if (settled) return; settled = true; $("confirmDeleteDialog").close(); cleanup(); resolve(value); };
    const cleanup = () => { $("runConfirmBtn").onclick = null; $("runConfirmBtn").hidden = false; $("runConfirmBtn").disabled = false; $("cancelConfirmBtn").onclick = null; $("cancelConfirmBtn").textContent = "Cancel"; copyBtn.remove(); $("confirmDeleteDialog").removeEventListener("close", closeAsCancel); };
    const closeAsCancel = () => done("");
    $("runConfirmBtn").onclick = () => done("move");
    $("cancelConfirmBtn").onclick = () => done("");
    copyBtn.onclick = () => done("copy");
    $("confirmDeleteDialog").addEventListener("close", closeAsCancel);
    $("confirmDeleteDialog").showModal();
  }));
}
function syncedGroupHasCapacity(groupId, avatarId = "", existingLocalId = "", notify = true) {
  if (!isSyncedGroup(groupId)) return true;
  const avatars = groupAvatars(groupId);
  if (existingLocalId && avatars.some((avatar) => avatar.id === existingLocalId)) return true;
  const normalizedAvatarId = String(avatarId || "").toLowerCase();
  if (normalizedAvatarId && avatars.some((avatar) => String(avatar.avatarId || avatar.id || "").toLowerCase() === normalizedAvatarId)) return true;
  if (avatars.length < SYNCED_GROUP_AVATAR_LIMIT) return true;
  if (notify) showSyncedGroupFullPopup();
  return false;
}
function syncedGroupHasCapacityForAvatars(groupId, avatarIds = [], existingLocalIds = [], notify = true) {
  if (!isSyncedGroup(groupId)) return true;
  const avatars = groupAvatars(groupId);
  const existingIds = new Set(existingLocalIds.filter(Boolean));
  const current = new Set(avatars.map((avatar) => String(avatar.avatarId || avatar.id || "").toLowerCase()));
  let needed = 0;
  for (const avatarId of avatarIds) {
    const normalized = String(avatarId || "").toLowerCase();
    if (!normalized || current.has(normalized)) continue;
    needed++;
    current.add(normalized);
  }
  const existingSelectedInGroup = avatars.filter((avatar) => existingIds.has(avatar.id)).length;
  if (avatars.length - existingSelectedInGroup + needed <= SYNCED_GROUP_AVATAR_LIMIT) return true;
  if (notify) showSyncedGroupFullPopup();
  return false;
}
function showSyncedGroupFullPopup() {
  if (showSyncedGroupFullPopup.open) return;
  showSyncedGroupFullPopup.open = true;
  confirmAction({
    title: "List Full",
    message: `Synced VRChat groups can only contain ${SYNCED_GROUP_AVATAR_LIMIT} avatars.`,
    confirmLabel: "OK",
    confirmClass: "primary",
    hideCancel: true
  }).finally(() => { showSyncedGroupFullPopup.open = false; });
}
function handleAvatarAddError(error) {
  const message = String(error?.message || error || "");
  if (/synced vrchat (favorite )?groups can only contain/i.test(message)) {
    showSyncedGroupFullPopup();
    return;
  }
  toast(message);
}
async function pushSyncedAvatarAdd(avatarId, groupId) {
  if (!isSyncedGroup(groupId) || !state.vrchat?.isLoggedIn || !avatarId) return;
  if (!syncedGroupHasCapacity(groupId, avatarId, "", true)) throw new Error(`Synced VRChat groups can only contain ${SYNCED_GROUP_AVATAR_LIMIT} avatars.`);
  const group = state.library.groups.find((item) => item.id === groupId);
  enqueueVrChatAction({
    kind: "favorite-add",
    label: `Favorite ${avatarId} to ${group?.name || groupId}`,
    payload: { avatarId, groupId },
    run: () => api("vrchatFavoriteAdd", { avatarId, groupId })
  });
}
async function pushSyncedAvatarRemove(avatarId, groupId) {
  if (!isSyncedGroup(groupId) || !state.vrchat?.isLoggedIn || !avatarId) return;
  const group = state.library.groups.find((item) => item.id === groupId);
  enqueueVrChatAction({
    kind: "favorite-remove",
    label: `Unfavorite ${avatarId} from ${group?.name || groupId}`,
    payload: { avatarId, groupId },
    run: () => api("vrchatFavoriteRemove", { avatarId, groupId })
  });
}
function syncedAvatarRemovalPayload(avatar) {
  if (!avatar || !isSyncedGroup(avatar.groupId)) return null;
  const avatarId = avatar.avatarId || avatar.id;
  return avatarId ? { avatarId, groupId: avatar.groupId, name: avatar.name || avatarId } : null;
}
function removeSyncedAvatarsInBackground(removals) {
  const queue = removals.filter(Boolean);
  if (!queue.length) return;
  for (const removal of queue) void pushSyncedAvatarRemove(removal.avatarId, removal.groupId);
}
async function pushSyncedAvatarMove(avatarId, oldGroupId, newGroupId) {
  if (isSyncedGroup(newGroupId)) await pushSyncedAvatarAdd(avatarId, newGroupId);
  if (isSyncedGroup(oldGroupId)) await pushSyncedAvatarRemove(avatarId, oldGroupId);
}
async function logCurrentAvatarSilent() {
  const currentAvatarId = state.vrchat?.user?.currentAvatarId || "";
  if (!state.vrchat?.isLoggedIn || !currentAvatarId || currentAvatarId === state.lastLoggedCurrentAvatarId) return;
  try {
    state.library = await api("vrchatLogCurrentAvatar");
    state.lastLoggedCurrentAvatarId = currentAvatarId;
    renderGroups();
    if (isRecentGroup(state.activeGroupId)) renderAvatars();
  } catch {
  }
}
async function refreshCurrentAvatarSummarySilent() {
  const currentAvatarId = state.vrchat?.user?.currentAvatarId || "";
  if (!state.vrchat?.isLoggedIn || !currentAvatarId || state.currentAvatarSummary.id === currentAvatarId) return;
  try {
    const avatar = await api("vrchatCurrentAvatar", { groupId: state.activeGroupId });
    state.currentAvatarSummary = { id: currentAvatarId, name: avatar?.name || currentAvatarId, imageUrl: avatar?.imageUrl || '', thumbnailImageUrl: avatar?.thumbnailImageUrl || avatar?.imageUrl || '' };
    if (state.vrchat.user) {
      if (avatar?.imageUrl) state.vrchat.user.currentAvatarImageUrl = avatar.imageUrl;
      if (avatar?.thumbnailImageUrl || avatar?.imageUrl) state.vrchat.user.currentAvatarThumbnailImageUrl = avatar.thumbnailImageUrl || avatar.imageUrl;
      state.vrchat.user.currentAvatarId = currentAvatarId;
    }
    renderAccount();
  } catch {
    state.currentAvatarSummary = { id: currentAvatarId, name: currentAvatarId, imageUrl: '', thumbnailImageUrl: '' };
    renderAccount();
  }
}
async function syncVrChatFavoritesSilent() {
  if (!state.vrchat?.isLoggedIn || state.vrchatSyncBusy || state.syncedAvatarEdit.groupId || state.syncQueueRunning || state.syncQueue.length) return;
  state.vrchatSyncBusy = true;
  try {
    const previousActiveId = state.activeGroupId;
    const result = await api("vrchatSyncFavorites");
    state.library = result.library;
    state.vrchatAvatarFavoriteGroupLimit = Number(result.favoriteGroupLimit || result.groupsSynced || 1);
    if (result.movedToDeleted > 0) {
      showDeletedScanResult(result, { showEmpty: false });
    }
    if (result.updatedAvatars > 0) {
      showUpdatedAvatarsResult(result);
    }
    if (result.conflictCount > 0) {
      showSyncConflictResult(result);
    }
    await refreshVrchatSessionSafe();
    await refreshCurrentAvatarSummarySilent();
    await logCurrentAvatarSilent();
    const desiredActiveId = state.activeGroupId === previousActiveId ? previousActiveId : state.activeGroupId;
    if (!state.library.groups.some((group) => group.id === desiredActiveId)) {
      state.activeGroupId = state.library.groups[0]?.id ?? null;
    } else {
      state.activeGroupId = desiredActiveId;
    }
    render();
  } catch {
  } finally {
    state.vrchatSyncBusy = false;
  }
}
function requestLiveFavoriteSync(reason = "timer", { delay = 2500, minInterval = 30000 } = {}) {
  if (!state.vrchat?.isLoggedIn || state.syncedAvatarEdit.groupId || state.syncQueueRunning || state.syncQueue.length) return;
  if (document.hidden && reason !== "startup") return;
  if ((reason === "focus" || reason === "visible") && state.vrchatPipeline?.connected) return;
  clearTimeout(state.vrchatFavoriteLiveSyncDebounce);
  state.vrchatFavoriteLiveSyncDebounce = setTimeout(() => {
    const now = Date.now();
    if (state.vrchatSyncBusy || now - state.vrchatLastFavoriteLiveSyncAt < minInterval) return;
    state.vrchatLastFavoriteLiveSyncAt = now;
    syncVrChatFavoritesSilent();
  }, delay);
}
function requestForegroundRefresh() {
  if (!state.vrchat?.isLoggedIn || document.hidden) return;
  const now = Date.now();
  if (now - state.vrchatLastForegroundSyncAt < 120000) return;
  state.vrchatLastForegroundSyncAt = now;
  requestLiveFavoriteSync("focus", { delay: 600, minInterval: 120000 });
  if ((state.activePage === "friends" || state.activePage === "worlds") && now - state.socialLastFocusRefreshAt > 120000) {
    state.socialLastFocusRefreshAt = now;
    if (state.activePage === "friends") void loadVrchatSocial();
    if (state.activePage === "worlds") void loadVrchatSocial({ worldsOnly: true });
  }
}
function updateVrChatSyncTimer() {
  if (!state.vrchat?.isLoggedIn) {
    state.vrchatStartupSyncDone = false;
    updateVrChatBackgroundSyncTimer(false);
    return;
  }
  updateVrChatBackgroundSyncTimer(true);
  if (state.vrchatStartupSyncDone) return;
  state.vrchatStartupSyncDone = true;
  requestLiveFavoriteSync("startup", { delay: 250, minInterval: 0 });
}
function updateVrChatBackgroundSyncTimer(enabled = Boolean(state.vrchat?.isLoggedIn)) {
  if (state.vrchatBackgroundSyncTimer) {
    clearInterval(state.vrchatBackgroundSyncTimer);
    state.vrchatBackgroundSyncTimer = null;
  }
  if (state.vrchatAvatarPollTimer) {
    clearInterval(state.vrchatAvatarPollTimer);
    state.vrchatAvatarPollTimer = null;
  }
  if (state.vrchatFavoriteLiveSyncTimer) {
    clearInterval(state.vrchatFavoriteLiveSyncTimer);
    state.vrchatFavoriteLiveSyncTimer = null;
  }
  clearTimeout(state.vrchatFavoriteLiveSyncDebounce);
  state.vrchatFavoriteLiveSyncDebounce = null;
  if (state.vrchatLogAvatarPollTimer) {
    clearInterval(state.vrchatLogAvatarPollTimer);
    state.vrchatLogAvatarPollTimer = null;
  }
  if (!enabled) return;
  const pollLogAvatar = () => {
    const displayName = state.vrchat?.user?.displayName || "";
    if (!displayName) return;
    api("vrchatLatestLogAvatar", { id: displayName }, 10000).then(async (result) => {
      const id = result?.found ? String(result.avatarId || "") : "";
      if (!id || id === state.lastLogAvatarId) return;
      state.lastLogAvatarId = id;
      const avatar = await api("fetchAvatar", { id }, 30000).catch(() => ({ avatarId: id, name: result.avatarName || id }));
      state.currentAvatarSummary = { id, name: avatar?.name || result.avatarName || id, imageUrl: avatar?.imageUrl || '', thumbnailImageUrl: avatar?.thumbnailImageUrl || avatar?.imageUrl || '' };
      if (state.vrchat?.user) {
        state.vrchat.user.currentAvatarId = id;
        if (avatar?.imageUrl) state.vrchat.user.currentAvatarImageUrl = avatar.imageUrl;
        if (avatar?.thumbnailImageUrl || avatar?.imageUrl) state.vrchat.user.currentAvatarThumbnailImageUrl = avatar.thumbnailImageUrl || avatar.imageUrl;
      }
      renderAccount();
      requestLiveFavoriteSync("log-avatar-change", { delay: 1500, minInterval: 20000 });
      if (id !== state.lastLoggedCurrentAvatarId) {
        state.library = await api("vrchatLogAvatar", { id }, 30000);
        state.lastLoggedCurrentAvatarId = id;
        if (isRecentGroup(state.activeGroupId)) renderAvatars();
        renderGroups();
      }
      requestLiveFavoriteSync("log-avatar-saved", { delay: 1200, minInterval: 20000 });
    }).catch(() => {});
  };
  const pollCurrentAvatar = () => {
    if (!state.vrchat?.isLoggedIn) return;
    api("vrchatCurrentAvatar", {}, 30000).then((avatar) => {
      const id = avatar?.avatarId || avatar?.id || "";
      if (!id || id === state.currentAvatarSummary.id) return;
      state.currentAvatarSummary = { id, name: avatar?.name || id, imageUrl: avatar?.imageUrl || '', thumbnailImageUrl: avatar?.thumbnailImageUrl || avatar?.imageUrl || '' };
      if (state.vrchat.user) {
        state.vrchat.user.currentAvatarId = id;
        if (avatar?.imageUrl) state.vrchat.user.currentAvatarImageUrl = avatar.imageUrl;
        if (avatar?.thumbnailImageUrl || avatar?.imageUrl) state.vrchat.user.currentAvatarThumbnailImageUrl = avatar.thumbnailImageUrl || avatar.imageUrl;
      }
      renderAccount();
      requestLiveFavoriteSync("current-avatar-change", { delay: 1500, minInterval: 20000 });
    }).catch(() => {});
  };
  const liveSyncFavorites = () => {
    if (!state.vrchat?.isLoggedIn || document.hidden) return;
    requestLiveFavoriteSync("visible-interval", { delay: 500, minInterval: 45000 });
  };
  pollLogAvatar();
  state.vrchatLogAvatarPollTimer = setInterval(pollLogAvatar, 8 * 1000);
  state.vrchatAvatarPollTimer = setInterval(pollCurrentAvatar, 45 * 1000);
  state.vrchatFavoriteLiveSyncTimer = setInterval(liveSyncFavorites, 60 * 1000);
  state.vrchatBackgroundSyncTimer = setInterval(() => {
    if (!state.vrchat?.isLoggedIn) return;
    requestLiveFavoriteSync("safety", { delay: 500, minInterval: 60000 });
  }, 10 * 60 * 1000);
}
function openPositionDialog(type, item) {
  if (type === "group" && isGroupReorderLocked(item)) return;
  if (type === "avatar" && !canReorderAvatarsInGroup(item.groupId || state.activeGroupId)) return;
  const items = type === "group" ? reorderableGroups() : orderedGroupAvatars(item.groupId || state.activeGroupId);
  state.positionEdit = { type, id: item.id, groupId: item.groupId || state.activeGroupId };
  $("positionDialogTitle").textContent = type === "group" ? "Move Group" : "Move Avatar";
  $("positionDialogName").textContent = `${item.name || item.avatarId || item.id} is currently #${listPosition(items, item.id)} of ${items.length}.`;
  $("positionInput").max = String(items.length);
  $("positionNumber").max = String(items.length);
  $("positionInput").value = String(listPosition(items, item.id));
  $("positionNumber").value = $("positionInput").value;
  updatePositionSlider();
  $("positionDialog").showModal();
  $("positionNumber").focus();
}
function updatePositionSlider() {
  const input = $("positionInput");
  const max = Number(input.max) || 1;
  const position = Math.min(max, Math.max(1, Math.floor(Number(input.value)) || 1));
  input.value = String(position);
  $("positionNumber").value = String(position);
  $("positionNumber").max = String(max);
  $("positionMax").textContent = String(max);
  $("positionPrevBtn").disabled = position <= 1;
  $("positionNextBtn").disabled = position >= max;
}
function stepPosition(delta) {
  $("positionInput").value = String((Math.floor(Number($("positionInput").value)) || 1) + delta);
  updatePositionSlider();
}
function syncPositionFromNumber() {
  $("positionInput").value = $("positionNumber").value;
  updatePositionSlider();
}
function stepBackgroundOpacity(delta) {
  state.settings.backgroundOpacity = Math.min(100, Math.max(0, Number(state.settings.backgroundOpacity) + delta));
  applyBackgroundOpacity();
}
async function checkDeletedFavoritesManual() {
  if (!state.vrchat?.isLoggedIn) { toast("Log in to VRChat first."); return; }
  if (state.vrchatSyncBusy) return;
  state.vrchatSyncBusy = true;
  const selectedGroupId = state.activeGroupId;
  $("checkDeletedFavoritesBtn").textContent = "Checking...";
  $("checkDeletedFavoritesBtn").disabled = true;
  toast("Checking VRChat favorites for deleted or private avatars...");
  try {
    const result = await api("vrchatSyncFavorites");
    state.library = result.library;
    state.vrchatAvatarFavoriteGroupLimit = Number(result.favoriteGroupLimit || result.groupsSynced || 1);
    await refreshVrchatSessionSafe();
    if (state.library.groups.some((group) => group.id === "deleted_avatars")) state.activeGroupId = "deleted_avatars";
    else if (state.library.groups.some((group) => group.id === selectedGroupId)) state.activeGroupId = selectedGroupId;
    else state.activeGroupId = state.library.groups[0]?.id ?? null;
    state.vrchatSyncBusy = false;
    render();
    showDeletedScanResult(result, { showEmpty: true });
  } catch (e) {
    toast(e.message);
    state.vrchatSyncBusy = false;
    renderToolbar();
  } finally {
    renderToolbar();
  }
}
function showDeletedScanResult(result, { showEmpty = true } = {}) {
  const entries = (result.deletedAvatarResults || []).filter((entry) => entry?.name);
  if (!entries.length) {
    if (!showEmpty) return;
    confirmAction({
      title: "Check Complete",
      message: "No deleted or privated avatars were found.",
      confirmLabel: "OK",
      confirmClass: "primary",
      hideCancel: true
    });
    return;
  }

  const privateNames = entries.filter((entry) => String(entry.status || "").toLowerCase() === "private").map((entry) => entry.name);
  const deletedNames = entries.filter((entry) => String(entry.status || "").toLowerCase() !== "private").map((entry) => entry.name);
  const lines = [];
  if (privateNames.length) lines.push(`Private: ${privateNames.join(", ")}`);
  if (deletedNames.length) lines.push(`Deleted: ${deletedNames.join(", ")}`);
  if (!startupSummary.shown && !showEmpty) {
    addStartupSummaryItem("Moved to Deleted Avatars", lines.join("\n"));
    scheduleStartupSummary();
    return;
  }
  confirmAction({
    title: "Moved to Deleted Avatars",
    message: lines.join("\n"),
    confirmLabel: "OK",
    confirmClass: "primary",
    hideCancel: true
  });
}
function showUpdatedAvatarsResult(result) {
  const names = (result.updatedAvatarNames || []).filter(Boolean);
  const visible = names.slice(0, 12);
  const extra = Math.max(0, names.length - visible.length);
  const message = visible.length
    ? `Updated: ${visible.join(", ")}${extra ? `, and ${extra} more` : ""}`
    : `${result.updatedAvatars || "Some"} avatars were updated.`;
  if (!startupSummary.shown) {
    addStartupSummaryItem("Updated Avatars", message);
    scheduleStartupSummary();
    return;
  }
  confirmAction({
    title: "Updated Avatars",
    message,
    confirmLabel: "OK",
    confirmClass: "primary",
    hideCancel: true
  });
}
function showSyncConflictResult(result) {
  const summaries = (result.conflictSummaries || []).filter(Boolean);
  const visible = summaries.slice(0, 8);
  const extra = Math.max(0, Number(result.conflictCount || 0) - visible.length);
  const message = visible.length
    ? `${visible.join("\n")}${extra ? `\n...and ${extra} more` : ""}`
    : `${result.conflictCount} synced favorite differences were detected.`;
  if (!startupSummary.shown) {
    addStartupSummaryItem("Sync Conflicts Detected", message);
    scheduleStartupSummary();
    return;
  }
  confirmAction({
    title: "Sync Conflicts Detected",
    message,
    confirmLabel: "OK",
    confirmClass: "primary",
    hideCancel: true
  });
}
function addStartupSummaryItem(title, message) {
  if (!title || !message) return;
  if (startupSummary.items.some((item) => item.title === title && item.message === message)) return;
  startupSummary.items.push({ title, message });
}
function scheduleStartupSummary() {
  clearTimeout(scheduleStartupSummary.timer);
  scheduleStartupSummary.timer = setTimeout(showStartupSummary, 450);
}
function showStartupSummary() {
  if (startupSummary.shown || !startupSummary.items.length) return;
  startupSummary.shown = true;
  $("startupSummaryList").innerHTML = startupSummary.items.map((item) => `<div class="startup-summary-item"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.message)}</span></div>`).join("");
  const actionBtn = $("startupSummaryActionBtn");
  actionBtn.hidden = !startupSummary.pasStatus;
  actionBtn.onclick = async () => {
    const status = startupSummary.pasStatus;
    if (!status) return;
    actionBtn.disabled = true;
    actionBtn.textContent = "Updating...";
    try {
      $("avatarDatabaseStatus").textContent = "Updating Prismic PAS database...";
      await api("avatarDatabasePasUpdate");
      resetAvatarDatabaseResults();
      startupSummary.pasStatus = null;
      actionBtn.hidden = true;
      toast("Prismic PAS database updated.");
    } catch (e) {
      toast(e.message);
    } finally {
      actionBtn.disabled = false;
      actionBtn.textContent = "Update";
    }
  };
  $("startupSummaryDialog").showModal();
}
async function unfavoriteAllInActiveGroup() {
  const group = activeGroup();
  if (!group) return;
  const count = groupAvatars(group.id).length;
  if (!count) { toast("No avatars in this group."); return; }
  if (isSyncedGroup(group.id) && !state.vrchat?.isLoggedIn) { toast("Log in to VRChat first."); return; }
  const synced = isSyncedGroup(group.id);
  const recent = isRecentGroup(group.id);
  const deleted = isDeletedGroup(group.id);
  const label = recent ? "Clear Recents" : deleted ? "Clear Deleted" : "Unfavorite All";
  const message = synced
    ? `Remove all ${count} avatars from "${group.name}" in your VRChat favorites? A local backup will be created first.`
    : recent
      ? `Clear all ${count} avatars from Recent Avatars locally? A backup will be created first.`
    : deleted
      ? `Clear all ${count} avatars from Deleted Avatars locally? A backup will be created first.`
    : `Remove all ${count} avatars from "${group.name}" locally? A backup will be created first.`;
  if (!await confirmAction({ title: label, message, confirmLabel: label, confirmClass: "danger" })) return;
  const syncAction = createSyncAction("clear-group", label, { groupId: group.id });
  try {
    state.vrchatSyncBusy = true;
    renderToolbar();
    const result = await runRecordedSyncAction(
      syncAction,
      () => api("clearGroupAvatars", { id: group.id }, 1800000)
    );
    state.library = result.library;
    state.syncedAvatarEdit = { groupId: "", avatarIds: [], backupPath: "", applying: false };
    state.activeGroupId = state.library.groups.some((item) => item.id === group.id) ? group.id : state.library.groups[0]?.id ?? null;
    render();
    toast(`${label} removed ${result.removed || count} avatars from "${group.name}".`);
  } catch (e) {
    toast(e.message);
  } finally {
    state.vrchatSyncBusy = false;
    renderToolbar();
  }
}
function syncBackgroundOpacityFromNumber() {
  state.settings.backgroundOpacity = Number($("backgroundOpacityNumber").value);
  applyBackgroundOpacity();
}
function stepPanelOpacity(delta) {
  state.settings.panelOpacity = Math.min(100, Math.max(0, Number(state.settings.panelOpacity) + delta));
  applyPanelOpacity();
}
function syncPanelOpacityFromNumber() {
  state.settings.panelOpacity = Number($("panelOpacityNumber").value);
  applyPanelOpacity();
}
function openSettingsDialog() {
  state.settingsDraft = { original: { ...state.settings }, applied: false };
  $("bgEffectSelect").value = state.settings.backgroundEffect;
  updateSortButton("bgEffectSelect", "bgEffectMenuBtn");
  $("customizationDialog").showModal();
  setSettingsTab("customization");
}
const SETTINGS_LIVE_PREVIEW_RESTORE_MS = 3000;
let settingsLivePreviewTimer = null;
function beginSettingsLivePreview() {
  clearTimeout(settingsLivePreviewTimer);
  document.body.classList.add("settings-live-preview");
}
function endSettingsLivePreview(delay = SETTINGS_LIVE_PREVIEW_RESTORE_MS) {
  clearTimeout(settingsLivePreviewTimer);
  settingsLivePreviewTimer = setTimeout(() => document.body.classList.remove("settings-live-preview"), delay);
}
function pulseSettingsLivePreview(delay = SETTINGS_LIVE_PREVIEW_RESTORE_MS) {
  beginSettingsLivePreview();
  endSettingsLivePreview(delay);
}
function bindSettingsLivePreviewControl(id) {
  const control = $(id);
  if (!control) return;
  control.addEventListener("focus", beginSettingsLivePreview);
  control.addEventListener("blur", () => endSettingsLivePreview());
  control.addEventListener("pointerdown", beginSettingsLivePreview);
  control.addEventListener("pointerup", () => endSettingsLivePreview());
  control.addEventListener("pointercancel", () => endSettingsLivePreview());
  control.addEventListener("input", () => pulseSettingsLivePreview());
  control.addEventListener("change", () => endSettingsLivePreview());
}
function setSettingsTab(tab) {
  const tabs = ["customization", "sync", "diagnostics", "history", "logs", "backups"];
  for (const name of tabs) {
    $(`settings${name[0].toUpperCase()}${name.slice(1)}Tab`).classList.toggle("active", name === tab);
    $(`settings${name[0].toUpperCase()}${name.slice(1)}Panel`).hidden = name !== tab;
  }
  if (tab === "sync") loadSyncCenter();
  if (tab === "diagnostics") loadDiagnostics();
  if (tab === "history") loadMetadataHistory();
  if (tab === "backups") loadSettingsBackups();
  if (tab === "logs") loadSettingsLogs();
}
function formatFileSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
async function loadSettingsBackups() {
  const list = $("settingsBackupsList");
  list.innerHTML = `<div class="settings-empty"><h4>Loading backups</h4></div>`;
  try {
    const [accountResult, result] = await Promise.all([api("accountBackupList"), api("backupList")]);
    const accountFiles = (accountResult.files || []).map((file) => ({ ...file, backupKind: "account", retention: accountResult.retention }));
    const groupFiles = (result.files || []).map((file) => ({ ...file, backupKind: "group" }));
    const files = [...accountFiles, ...groupFiles].sort((a, b) => new Date(b.lastModified || b.createdAt || 0).getTime() - new Date(a.lastModified || a.createdAt || 0).getTime());
    list.innerHTML = files.length
      ? files.map(settingsBackupItemHtml).join("")
      : `<div class="settings-empty"><h4>No backups</h4><p>Account avatar backups are created after VRChat syncs. Group backups appear after group edits, synced order saves, or cleanup moves.</p></div>`;
    list.querySelectorAll("[data-backup-path]").forEach((button) => button.addEventListener("click", () => openBackupRestoreDialog(button.dataset.backupPath, button.dataset.backupName)));
  } catch (e) {
    list.innerHTML = `<div class="settings-empty"><h4>Could not load backups</h4><p>${escapeHtml(e.message)}</p></div>`;
  }
}
function settingsBackupItemHtml(file) {
  if (file.backupKind === "account") {
    return `<div class="settings-list-item"><div><strong>Account Avatars Backup</strong><span>${escapeHtml(accountBackupSummary(file, file.retention))}</span></div><small>${escapeHtml(formatFileSize(file.size))}</small></div>`;
  }
  return `<div class="settings-list-item"><div><strong>${escapeHtml(file.displayName || file.name)}</strong><span>${escapeHtml(file.reason || "Group backup")} - ${escapeHtml(new Date(file.lastModified).toLocaleString())}</span></div><small>${escapeHtml(formatFileSize(file.size))}</small><button type="button" class="restore-action" data-backup-path="${escapeAttr(file.path)}" data-backup-name="${escapeAttr(file.displayName || file.name)}">Restore</button></div>`;
}
function accountBackupSummary(file, retention = 5) {
  const created = file.createdAt || file.lastModified;
  const reason = file.reason ? `${file.reason} - ` : "";
  const groups = `${Number(file.groupCount || 0)} group${Number(file.groupCount || 0) === 1 ? "" : "s"}`;
  const avatars = `${Number(file.avatarCount || 0)} avatar${Number(file.avatarCount || 0) === 1 ? "" : "s"}`;
  return `${reason}${groups}, ${avatars} - ${new Date(created).toLocaleString()} - keeps latest ${Number(retention || 5)}`;
}
async function loadSettingsLogs() {
  const list = $("settingsLogsList");
  list.innerHTML = `<div class="settings-empty"><h4>Loading logs</h4></div>`;
  try {
    $("settingsLogFilterSelect").value = state.settingsLogFilter || "all";
    updateSortButton("settingsLogFilterSelect", "settingsLogFilterMenuBtn");
    const result = await api("logsList");
    const entries = filterSettingsLogEntries(result.entries || []);
    list.innerHTML = entries.length
      ? entries.map(logEntryHtml).join("")
      : settingsLogEmptyHtml(result.entries || []);
  } catch (e) {
    list.innerHTML = `<div class="settings-empty"><h4>Could not load logs</h4><p>${escapeHtml(e.message)}</p></div>`;
  }
}
function syncHealthHtml(info) {
  const hasSync = Boolean(info?.lastSyncAt);
  const time = hasSync ? new Date(info.lastSyncAt).toLocaleString() : "Never";
  const status = hasSync ? (info.lastSyncSucceeded ? "OK" : "Failed") : "No sync yet";
  const detail = info?.lastSyncError || info?.lastSyncSummary || "VRChat sync history will appear after the next sync.";
  return `<div class="sync-health-main"><strong>Sync status</strong><span class="${info?.lastSyncSucceeded ? "ok" : hasSync ? "bad" : ""}">${escapeHtml(status)}</span></div><div class="sync-health-grid"><span>Last sync</span><strong>${escapeHtml(time)}</strong><span>Queued actions</span><strong>${Number(info?.pendingActions || 0)} pending / ${Number(info?.failedActions || 0)} failed</strong><span>Conflicts</span><strong>${Number(info?.openConflicts || 0)} open</strong><span>Metadata changes</span><strong>${Number(info?.metadataChangesLast24Hours || 0)} today / ${Number(info?.metadataChangesTotal || 0)} total</strong></div><p>${escapeHtml(detail)}</p>`;
}
async function loadSyncCenter() {
  const health = $("syncCenterHealth");
  const conflicts = $("syncCenterConflicts");
  const actions = $("syncCenterActions");
  health.innerHTML = `<div class="sync-health-main"><strong>Sync status</strong><span>Loading...</span></div>`;
  conflicts.innerHTML = `<div class="settings-empty"><h4>Loading conflicts</h4></div>`;
  actions.innerHTML = `<div class="settings-empty"><h4>Loading sync actions</h4></div>`;
  try {
    const [syncHealth, actionResult, conflictResult] = await Promise.all([api("syncHealth"), api("syncActionsList"), api("syncConflictsList")]);
    health.innerHTML = syncHealthHtml(syncHealth);
    const conflictRows = conflictResult.conflicts || [];
    conflicts.innerHTML = conflictRows.length
      ? syncConflictSectionHtml(conflictRows)
      : `<div class="settings-empty compact"><h4>No sync conflicts</h4><p>Changes made outside VRCNeph will appear here after sync.</p></div>`;
    const rows = actionResult.actions || [];
    actions.innerHTML = rows.length
      ? rows.map(syncActionHtml).join("")
      : `<div class="settings-empty"><h4>No sync actions yet</h4><p>Favorite, unfavorite, and equip actions will appear here.</p></div>`;
    actions.querySelectorAll("[data-sync-dismiss]").forEach((button) => button.addEventListener("click", () => dismissSyncAction(button.dataset.syncDismiss)));
    actions.querySelectorAll("[data-sync-retry]").forEach((button) => button.addEventListener("click", () => retrySyncAction(button.dataset.syncRetry)));
    conflicts.querySelectorAll("[data-conflict-accept]").forEach((button) => button.addEventListener("click", () => acceptSyncConflict(button.dataset.conflictAccept)));
    conflicts.querySelectorAll("[data-conflicts-accept-all]").forEach((button) => button.addEventListener("click", acceptAllOpenSyncConflicts));
  } catch (e) {
    health.innerHTML = "";
    actions.innerHTML = `<div class="settings-empty"><h4>Could not load Sync Center</h4><p>${escapeHtml(e.message)}</p></div>`;
  }
}
async function dismissSyncAction(id) {
  try {
    await api("syncActionDismiss", { id });
    await loadSyncCenter();
  } catch (e) { toast(e.message); }
}
async function retrySyncAction(id) {
  const result = await api("syncActionsList");
  const action = (result.actions || []).find((item) => item.id === id);
  if (!action) { toast("Sync action was not found."); return; }
  const payload = parseJsonSafe(action.payload) || {};
  const avatarId = payload.avatarId || payload.id;
  const groupId = payload.groupId;
  const kind = String(action.kind || "").toLowerCase();
  if (["favorite-add", "favorite-remove"].includes(kind) && (!avatarId || !groupId)) {
    toast("That action does not have enough saved data to replay.");
    return;
  }
  if (kind === "equip-avatar" && !avatarId) {
    toast("That action does not have enough saved data to replay.");
    return;
  }
  if (kind === "synced-order" && (!groupId || !Array.isArray(payload.avatarIds))) {
    toast("That synced order action does not have enough saved data to replay.");
    return;
  }
  if (kind === "clear-group" && !groupId) {
    toast("That action does not have enough saved data to replay.");
    return;
  }
  await dismissSyncAction(id);
  if (kind === "favorite-add") {
    enqueueVrChatAction({ kind: "favorite-add", label: action.label || `Favorite ${avatarId}`, payload: { avatarId, groupId }, run: () => api("vrchatFavoriteAdd", { avatarId, groupId }) });
  } else if (kind === "favorite-remove") {
    enqueueVrChatAction({ kind: "favorite-remove", label: action.label || `Unfavorite ${avatarId}`, payload: { avatarId, groupId }, run: () => api("vrchatFavoriteRemove", { avatarId, groupId }) });
  } else if (kind === "equip-avatar") {
    enqueueVrChatAction({ kind: "equip-avatar", label: action.label || `Equip ${avatarId}`, payload: { avatarId }, run: () => api("vrchatSelectAvatar", { id: avatarId }) });
  } else if (kind === "synced-order") {
    const item = createSyncAction("synced-order", action.label || "Save synced order", { groupId, avatarIds: payload.avatarIds });
    void runRecordedSyncAction(item, async () => {
      const result = await api("applySyncedAvatarOrder", { groupId, avatarIds: payload.avatarIds }, 1800000);
      state.library = result.library;
      render();
      return result;
    });
  } else if (kind === "clear-group") {
    const item = createSyncAction("clear-group", action.label || "Clear group", { groupId });
    void runRecordedSyncAction(item, async () => {
      const result = await api("clearGroupAvatars", { id: groupId }, 1800000);
      state.library = result.library;
      render();
      return result;
    });
  } else {
    toast("That action type cannot be replayed yet.");
    return;
  }
  await loadSyncCenter();
  toast("Sync action queued again.");
}
function syncConflictSectionHtml(rows) {
  const open = rows.filter((item) => !item.resolved);
  const resolved = rows.filter((item) => item.resolved);
  const controls = open.length
    ? `<div class="sync-conflict-toolbar"><div><strong>${open.length} open conflict${open.length === 1 ? "" : "s"}</strong><span>These are differences detected from VRChat. Mark them synced after review.</span></div><div><button type="button" data-conflicts-accept-all>Mark All Synced</button></div></div>`
    : "";
  const openHtml = open.length ? `<div class="settings-section-label">Open Conflicts</div>${open.map(syncConflictHtml).join("")}` : "";
  const resolvedHtml = resolved.length ? `<div class="settings-section-label">Resolved Conflicts</div>${resolved.map(syncConflictHtml).join("")}` : "";
  return `${controls}${openHtml}${resolvedHtml}`;
}
function syncActionHtml(action) {
  const time = action.timestamp ? new Date(action.timestamp).toLocaleString() : "";
  const status = String(action.status || "unknown");
  const detail = action.error ? `<p class="log-detail">${escapeHtml(action.error)}</p>` : "";
  const failed = status.toLowerCase() === "failed";
  const actions = failed ? `<div class="sync-action-buttons"><button type="button" data-sync-retry="${escapeAttr(action.id)}">Retry</button><button type="button" data-sync-dismiss="${escapeAttr(action.id)}">Dismiss</button></div>` : "";
  return `<div class="log-entry sync-action ${escapeAttr(status.toLowerCase())}"><time>${escapeHtml(time)}</time><span class="log-level">${escapeHtml(status)}</span><div class="log-body"><div class="log-title"><strong>${escapeHtml(action.kind || "sync")}</strong><span>${escapeHtml(action.label || "")}</span></div>${detail}${actions}</div></div>`;
}
function syncConflictHtml(conflict) {
  const time = conflict.detectedAt ? new Date(conflict.detectedAt).toLocaleString() : "";
  const label = syncConflictTitle(conflict);
  const description = syncConflictDescription(conflict);
  const resolved = Boolean(conflict.resolved);
  const buttons = resolved
    ? `<span class="sync-resolved-label">Resolved</span>`
    : `<div class="sync-action-buttons"><button type="button" data-conflict-accept="${escapeAttr(conflict.id)}">Mark Synced</button></div>`;
  return `<div class="sync-conflict-item ${resolved ? "resolved" : ""}" data-conflict-row="${escapeAttr(conflict.id)}" data-conflict-kind="${escapeAttr(conflict.kind || "")}" data-conflict-avatar="${escapeAttr(conflict.avatarId || "")}" data-conflict-group="${escapeAttr(conflict.groupId || "")}"><div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(description)}</span><small>${escapeHtml(conflict.groupName || conflict.groupId || "")} - ${escapeHtml(time)}</small></div>${buttons}</div>`;
}
function syncConflictTitle(conflict) {
  const name = conflict.avatarName || conflict.avatarId || conflict.groupName || "VRChat favorites";
  const kind = String(conflict.kind || "").toLowerCase();
  if (kind === "remote_added") return `${name} was added in VRChat`;
  if (kind === "remote_removed") return `${name} was removed in VRChat`;
  if (kind === "remote_order_changed") return `${conflict.groupName || "A synced group"} was reordered in VRChat`;
  return conflict.detail || name;
}
function syncConflictDescription(conflict) {
  const kind = String(conflict.kind || "").toLowerCase();
  if (kind === "remote_added") return "This will stay in VRCNeph after sync.";
  if (kind === "remote_removed") return "This will stay removed from VRCNeph after sync.";
  if (kind === "remote_order_changed") return "The VRChat order is being kept.";
  return conflict.detail || "Review this synced favorites difference.";
}
async function acceptSyncConflict(id) {
  try {
    await api("syncConflictResolve", { id });
    await loadSyncCenter();
  } catch (e) { toast(e.message); }
}
async function acceptAllOpenSyncConflicts() {
  const ids = [...document.querySelectorAll(".sync-conflict-item:not(.resolved)")].map((row) => Number(row.dataset.conflictRow)).filter(Boolean);
  if (!ids.length) return;
  if (!await confirmAction({ title: "Mark Synced", message: `Mark ${ids.length} open sync conflict${ids.length === 1 ? "" : "s"} as reviewed? This will not change VRChat favorites.`, confirmLabel: "Mark Synced", confirmClass: "primary" })) return;
  try {
    await api("syncConflictsResolve", { ids });
    await loadSyncCenter();
  } catch (e) { toast(e.message); }
}
function parseJsonSafe(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}
async function loadDiagnostics() {
  const list = $("diagnosticsList");
  list.innerHTML = `<div class="settings-empty"><h4>Checking diagnostics</h4></div>`;
  try {
    const result = await api("diagnosticsGet", {}, 45000);
    const items = result.items || [];
    list.innerHTML = items.length
      ? items.map((item) => `<div class="diagnostic-item ${escapeAttr(String(item.level || "info").toLowerCase())}"><div><strong>${escapeHtml(item.name || "")}</strong><span>${escapeHtml(item.detail || "")}</span></div><small>${escapeHtml(item.status || "")}</small></div>`).join("")
      : `<div class="settings-empty"><h4>No diagnostics</h4></div>`;
  } catch (e) {
    list.innerHTML = `<div class="settings-empty"><h4>Could not load diagnostics</h4><p>${escapeHtml(e.message)}</p></div>`;
  }
}
async function loadMetadataHistory() {
  const list = $("metadataHistoryList");
  list.innerHTML = `<div class="settings-empty"><h4>Loading metadata history</h4></div>`;
  try {
    const result = await api("metadataHistoryList");
    const items = result.items || [];
    list.innerHTML = items.length
      ? items.map(metadataHistoryHtml).join("")
      : `<div class="settings-empty"><h4>No metadata history yet</h4><p>Avatar metadata changes and deleted/private detections will appear after sync detects them.</p></div>`;
  } catch (e) {
    list.innerHTML = `<div class="settings-empty"><h4>Could not load history</h4><p>${escapeHtml(e.message)}</p></div>`;
  }
}
function setSocialHeaderStatus(kind, message) {
  const id = kind === "worlds" ? "worldSocialStatus" : "vrchatSocialStatus";
  const element = $(id);
  if (element) element.textContent = message;
}
async function loadVrchatSocial({ worldsOnly = false } = {}) {
  if (!state.vrchat?.isLoggedIn) {
    clearTimeout(state.friendDetailLoadTimer);
    state.friendDetailLoadTimer = null;
    state.social = { ...state.social, loaded: false, friendsLoaded: false, worldsLoaded: false, busy: false, friends: [], favoriteFriends: [], worlds: [], worldSections: [], favoriteWorlds: [], favoriteWorldGroups: [], selectedWorldGroup: "", location: null, selectedType: "", selectedItem: null, friendTab: "info" };
    setSocialHeaderStatus("friends", "Log in to load VRChat friends.");
    setSocialHeaderStatus("worlds", "Log in to search VRChat worlds.");
    renderVrchatSocial();
    return;
  }
  state.social.busy = true;
  if (worldsOnly) {
    setSocialHeaderStatus("worlds", "Searching worlds...");
  } else {
    setSocialHeaderStatus("friends", "Loading VRChat friends...");
    setSocialHeaderStatus("worlds", "Loading VRChat worlds...");
  }
  renderVrchatSocial();
  try {
    if (worldsOnly) {
      const query = $("worldSearchInput").value.trim();
      const [worldResult, sections, favorites, favoriteGroups] = await Promise.all([
        api("vrchatWorldSearch", { query, limit: 50, offset: 0 }, 45000),
        query ? Promise.resolve([]) : loadWorldDiscoverySections(),
        api("vrchatFavoriteWorlds", { limit: 100, offset: 0 }, 45000).catch(() => ({ worlds: [] })),
        api("vrchatFavoriteWorldGroups", { limit: 100, offset: 0 }, 45000).catch(() => ({ groups: [] }))
      ]);
      state.social.worlds = worldResult.worlds || [];
      state.social.worldSections = sections || [];
      state.social.favoriteWorlds = favorites.worlds || state.social.favoriteWorlds || [];
      state.social.favoriteWorldGroups = favoriteGroups.groups || state.social.favoriteWorldGroups || [];
      state.social.worldsLoaded = true;
      state.social.loaded = state.social.friendsLoaded || state.social.worldsLoaded;
      setSocialHeaderStatus("worlds", query ? (state.social.worlds.length ? `${state.social.worlds.length} world search results.` : "No world search results.") : `${state.social.worldSections.length || 0} world sections loaded.`);
    } else {
      const [location, friends, favoriteFriends] = await Promise.all([
        api("vrchatCurrentLocation", {}, 45000),
        api("vrchatFriendsList", { limit: 100, offset: 0 }, 45000),
        api("vrchatFavoriteFriends", { limit: 100, offset: 0 }, 45000).catch(() => ({ friends: [] }))
      ]);
      const listedFriends = friends.friends || [];
      rememberFriendPresences(listedFriends, "friend-list");
      state.social.location = location;
      state.social.favoriteFriends = (favoriteFriends.friends || []).map((friend) => applyFriendPresenceAuthority(friend));
      state.social.friends = mergeFriendLists(listedFriends, state.social.favoriteFriends);
      rememberFriendPresences(state.social.friends, "friend-list");
      recordPlayerNamesFromUsers(state.social.friends, "Friends");
      state.social.friendsLoaded = true;
      state.social.loaded = true;
      setSocialHeaderStatus("friends", `${state.social.friends.length} friends loaded.`);
      updatePipelineStatusText();
    }
  } catch (e) {
    setSocialHeaderStatus(worldsOnly ? "worlds" : "friends", e.message);
  } finally {
    state.social.busy = false;
    renderAccount();
    renderVrchatSocial();
  }
}
function handleVrchatPipelineEvent(event) {
  const type = String(event?.type || "").trim();
  const content = event?.content || {};
  state.vrchatPipeline = {
    connected: true,
    state: "Connected",
    eventsReceived: Number(state.vrchatPipeline?.eventsReceived || 0) + 1,
    lastEventType: type
  };
  if (!type) return;
  if (type.startsWith("friend-")) applyPipelineFriendEvent(type, content);
  else if (type === "user-update") applyPipelineUserUpdate(content);
  else if (type.startsWith("notification")) applyPipelineNotificationEvent(type, content);
  updatePipelineStatusText();
}
function handleVrchatPipelineStatus(status = {}) {
  state.vrchatPipeline = {
    connected: Boolean(status.connected),
    state: status.state || "Unknown",
    eventsReceived: Number(status.eventsReceived || state.vrchatPipeline?.eventsReceived || 0),
    lastEventType: status.lastEventType || state.vrchatPipeline?.lastEventType || ""
  };
  updatePipelineStatusText();
}
function applyPipelineFriendEvent(type, content = {}) {
  const user = content.user || content;
  const userId = content.userId || content.id || user.id || "";
  if (!userId) return;
  const existing = findListedFriendById(userId) || {};
  const patch = pipelineFriendPatch(type, user, content, existing);
  rememberFriendPresence(patch, type === "friend-offline" ? "pipeline-offline" : "pipeline");
  recordPlayerName(userId, patch.displayName || user.displayName || content.displayName || existing.displayName || "", new Date().toISOString(), "Pipeline");
  upsertSocialFriend(userId, patch);
  addSocialActivity({
    type,
    title: friendEventTitle(type, patch),
    detail: friendEventDetail(type, patch),
    userId,
    worldId: patch.worldId || "",
    source: "Pipeline"
  });
  if (state.social.selectedType === "friend" && state.social.selectedItem?.id === userId) {
    state.social.selectedItem = applyFriendPresenceAuthority({ ...state.social.selectedItem, ...patch });
  }
  if (state.activePage === "friends") renderVrchatSocial();
}
function pipelineFriendPatch(type, user = {}, content = {}, existing = {}) {
  const directLocation = content.location || user.location || "";
  const location = type === "friend-offline" ? "offline" : directLocation || (type === "friend-active" || type === "friend-online" ? "" : existing.location || "");
  const stateValue = user.state || existing.state || "";
  const presenceSource = type === "friend-offline"
    ? "pipeline-offline"
    : type === "friend-online" || (type === "friend-location" && directLocation)
      ? "pipeline-online"
      : directLocation && directLocation.startsWith?.("wrld_")
        ? "pipeline-online"
        : existing.presenceSource || "";
  const presence = normalizeFriendPresence({ ...existing, ...user, location, state: stateValue, presenceSource }, type);
  const online = presence !== "offline";
  const worldId = worldIdFromLocation(location) || (directLocation ? user.worldId || "" : "") || (type === "friend-active" ? "" : existing.worldId || "");
  return {
    ...user,
    id: user.id || content.userId || existing.id || "",
    displayName: user.displayName || content.displayName || existing.displayName || "",
    status: user.status || existing.status || "",
    statusDescription: user.statusDescription || existing.statusDescription || "",
    location,
    worldId,
    imageUrl: user.currentAvatarThumbnailImageUrl || user.profilePicOverrideThumbnail || user.userIcon || user.profileImageUrl || existing.imageUrl || "",
    profileImageUrl: user.profileImageUrl || existing.profileImageUrl || "",
    profilePicOverride: user.profilePicOverride || existing.profilePicOverride || "",
    profilePicOverrideThumbnail: user.profilePicOverrideThumbnail || existing.profilePicOverrideThumbnail || "",
    userIcon: user.userIcon || existing.userIcon || "",
    isOnline: online,
    presence,
    presenceSource,
    state: stateValue,
    currentAvatarId: user.currentAvatarId || existing.currentAvatarId || "",
    currentAvatarName: user.currentAvatarName || existing.currentAvatarName || "",
    currentAvatarImageUrl: user.currentAvatarImageUrl || existing.currentAvatarImageUrl || "",
    currentAvatarThumbnailImageUrl: user.currentAvatarThumbnailImageUrl || existing.currentAvatarThumbnailImageUrl || "",
    tags: Array.isArray(user.tags) ? user.tags.join(", ") : user.tags || existing.tags || "",
    rawJson: Object.keys(user || {}).length ? JSON.stringify(user, null, 2) : existing.rawJson || ""
  };
}
function upsertSocialFriend(userId, patch) {
  const normalizedPatch = applyFriendPresenceAuthority({ id: userId, ...patch });
  const index = state.social.friends.findIndex((friend) => friend.id === userId);
  if (index >= 0) state.social.friends[index] = { ...state.social.friends[index], ...normalizedPatch };
  else state.social.friends.unshift(normalizedPatch);
}
function worldIdFromLocation(location = "") {
  const text = String(location || "");
  if (!text.startsWith("wrld_")) return "";
  const colon = text.indexOf(":");
  return colon > 0 ? text.slice(0, colon) : text;
}
function applyPipelineUserUpdate(content = {}) {
  if (!state.vrchat?.user) return;
  const user = content.user || content;
  if (user.id && user.id !== state.vrchat.user.id) return;
  state.vrchat.user = { ...state.vrchat.user, ...user };
  renderAccount();
}
function applyPipelineNotificationEvent(type, content = {}) {
  const title = content.title || content.type || type;
  const sender = content.senderUsername || content.senderName || content.sender?.displayName || "";
  const message = notificationMessageText(content);
  const item = normalizeNotification({ ...content, type, title, senderUsername: sender, message, seen: isNotificationPopoverOpen() && isImportantNotification({ type, id: content.id || content.notificationId || "", seen: false }) });
  recordPlayerName(item.senderUserId, item.senderUsername, item.createdAt, "Notification");
  state.notifications.items = dedupeNotifications([item, ...state.notifications.items]);
  state.notifications.loaded = true;
  addMessageNotification(item, { popup: true });
  addSocialActivity({ type, title: notificationTitle(item), detail: notificationDetail(item), userId: item.senderUserId || "", source: "Pipeline" });
  renderNotificationsPage();
  renderMessagesPage();
  renderPageTabs();
  toast([sender, message || title].filter(Boolean).join(": "));
}
function addSocialActivity(entry) {
  const item = {
    id: entry.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    type: entry.type || "activity",
    title: entry.title || "Activity",
    detail: entry.detail || "",
    userId: entry.userId || "",
    worldId: entry.worldId || "",
    source: entry.source || ""
  };
  state.socialActivity = [item, ...state.socialActivity].slice(0, 240);
  saveLocalJson("vrcneph.socialActivity", state.socialActivity);
  renderNotificationsPage();
  if (state.activePage === "notifications") renderSocialSidebar();
}
function friendEventTitle(type, friend) {
  const name = friend.displayName || friend.id || "Friend";
  if (type === "friend-online") return `${name} came online`;
  if (type === "friend-offline") return `${name} went offline`;
  if (type === "friend-active") return `${name} is active`;
  if (type === "friend-location") return `${name} changed worlds`;
  return `${name}: ${type}`;
}
function friendEventDetail(type, friend) {
  if (type === "friend-offline") return "Offline";
  return [friend.statusDescription, friend.worldId || friend.location, friend.state].filter(Boolean).join(" - ");
}
function normalizeNotification(item = {}) {
  const id = item.id || item.notificationId || item.messageId || `${item.type || "notification"}-${item.createdAt || item.created_at || Date.now()}-${item.senderUserId || item.senderUsername || ""}`;
  return {
    id,
    type: item.type || item.notificationType || "",
    title: item.title || "",
    senderUserId: item.senderUserId || item.senderId || item.userId || item.sender?.id || "",
    senderUsername: item.senderUsername || item.senderName || item.sender?.displayName || item.displayName || "",
    senderImageUrl: normalizeVrchatImageUrl(item.senderImageUrl || item.imageUrl || item.sender?.profilePicOverrideThumbnail || item.sender?.profilePicOverride || item.sender?.userIcon || item.sender?.profileImageUrl || item.sender?.currentAvatarThumbnailImageUrl || item.sender?.currentAvatarImageUrl || ""),
    message: notificationMessageText(item),
    createdAt: item.createdAt || item.created_at || item.created_at_ms || new Date().toISOString(),
    seen: Boolean(item.seen || item.isSeen),
    direction: item.direction || "",
    rawJson: item.rawJson || JSON.stringify(item, null, 2)
  };
}
function notificationMessageText(item = {}) {
  const candidates = [item.message, item.details, item.inviteMessage, item.requestMessage, item.responseMessage, item.data, item.content];
  for (const value of candidates) {
    const text = notificationValueText(value);
    if (text) return text;
  }
  return "";
}
function notificationValueText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(notificationValueText).filter(Boolean).join(" ").trim();
  if (typeof value === "object") {
    for (const key of ["message", "text", "body", "content", "details", "inviteMessage", "requestMessage", "responseMessage"]) {
      const text = notificationValueText(value[key]);
      if (text) return text;
    }
  }
  return "";
}
function addMessageNotification(item, { popup = false } = {}) {
  const normalized = normalizeNotification(item);
  if (!normalized.senderUserId && !normalized.senderUsername) return;
  recordPlayerName(normalized.senderUserId, normalized.senderUsername, normalized.createdAt, "Messages");
  if (state.activePage === "messages" && normalized.direction !== "outgoing") normalized.seen = true;
  state.messageHistory = dedupeNotifications([normalized, ...(state.messageHistory || [])]).slice(0, 2000);
  persistMessageHistory();
  if (popup && state.activePage !== "messages" && state.dismissedMessagePopupId !== normalized.id) {
    state.messagePopupItem = normalized;
    renderMessagePopup();
  }
  renderPageTabs();
}
function ensureMessageConversationForUser(userId, displayName = "") {
  const id = String(userId || "").trim();
  if (!id) return null;
  const exists = (state.messageHistory || []).some((item) => item.senderUserId === id || item.senderUsername === displayName);
  if (!exists) {
    const friend = findSocialFriend(id, displayName) || {};
    addMessageNotification({
      id: `local-message-${id}`,
      type: "localConversation",
      senderUserId: id,
      senderUsername: displayName || friend.displayName || id,
      message: "No VRChat messages from this user yet. Use Invite or Request Invite to send a VRChat message.",
      createdAt: new Date().toISOString(),
      seen: true
    });
  }
  state.selectedMessageUserId = id;
  return id;
}
function dedupeNotifications(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = String(item.id || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
async function loadNotifications() {
  if (!state.vrchat?.isLoggedIn) {
    state.notifications = { ...state.notifications, loaded: false, busy: false, items: [] };
    renderNotificationsPage();
    return;
  }
  state.notifications.busy = true;
  renderNotificationsPage();
  try {
    const result = await api("vrchatNotifications", { limit: 100, offset: 0 }, 45000);
    state.notifications.items = dedupeNotifications((result.notifications || []).map(normalizeNotification));
    if (isNotificationPopoverOpen()) {
      state.notifications.items = state.notifications.items.map((item) => isImportantNotification(item) ? { ...item, seen: true } : item);
    }
    state.notifications.items.forEach((item) => addMessageNotification(item));
    state.notifications.loaded = true;
    $("notificationStatus").textContent = `${state.notifications.items.length} notifications loaded.`;
  } catch (e) {
    $("notificationStatus").textContent = e.message;
  } finally {
    state.notifications.busy = false;
    renderNotificationsPage();
    renderMessagesPage();
    renderPageTabs();
  }
}
async function loadPlayerActivityLog() {
  if (!state.vrchat?.isLoggedIn) return;
  state.playerActivityLog.busy = true;
  renderNotificationsPage();
  try {
    const result = await api("vrchatPlayerActivityLog", { limit: 1000 }, 45000);
    state.playerActivityLog.items = mergePlayerActivityLogs(result.items || [], state.playerActivityLog.items || []);
    persistPlayerActivityLog();
    state.playerActivityLog.page = Math.min(state.playerActivityLog.page || 0, Math.max(0, Math.ceil(state.playerActivityLog.items.length / state.playerActivityLog.pageSize) - 1));
    state.playerActivityLog.loaded = true;
    if (state.activePage === "notifications") renderSocialSidebar();
  } catch (e) {
    toast(e.message);
  } finally {
    state.playerActivityLog.busy = false;
    renderNotificationsPage();
  }
}
function playerActivityKey(item) {
  return [item.timestamp, item.action, item.userId || item.displayName, item.location, item.worldName].map((value) => String(value || "").trim().toLowerCase()).join("|");
}
function mergePlayerActivityLogs(...lists) {
  const seen = new Set();
  const merged = [];
  for (const item of lists.flat()) {
    if (!item) continue;
    recordPlayerName(item.userId, item.displayName, item.timestamp, "VRChat log", { persist: false });
    const key = playerActivityKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  persistPlayerNameHistory();
  return merged.sort((a, b) => new Date(String(b.timestamp || "").replace(/^(\d{4})\.(\d{2})\.(\d{2})\s+/, "$1-$2-$3T")).getTime() - new Date(String(a.timestamp || "").replace(/^(\d{4})\.(\d{2})\.(\d{2})\s+/, "$1-$2-$3T")).getTime());
}
function persistPlayerActivityLog() {
  saveLocalJson("vrcneph.playerActivityLog", state.playerActivityLog.items || []);
}
function persistPlayerNameHistory() {
  saveLocalJson("vrcneph.playerNameHistory", state.playerNameHistory || {});
}
function recordPlayerName(userId, displayName, timestamp = "", source = "Local", { persist = true } = {}) {
  const id = String(userId || "").trim();
  const name = String(displayName || "").trim();
  if (!id || !name || /^usr_[0-9a-f-]+$/i.test(name)) return false;
  const when = String(timestamp || new Date().toISOString());
  const key = name.toLowerCase();
  const history = Array.isArray(state.playerNameHistory?.[id]) ? [...state.playerNameHistory[id]] : [];
  const existingIndex = history.findIndex((item) => String(item.name || "").trim().toLowerCase() === key);
  if (existingIndex >= 0) {
    const current = history[existingIndex];
    history[existingIndex] = {
      ...current,
      name,
      firstSeen: earlierTimestamp(current.firstSeen, when),
      lastSeen: laterTimestamp(current.lastSeen, when),
      count: Number(current.count || 0) + 1,
      source: source || current.source || "Local"
    };
  } else {
    history.push({ name, firstSeen: when, lastSeen: when, count: 1, source: source || "Local" });
  }
  state.playerNameHistory = { ...(state.playerNameHistory || {}), [id]: history.sort((a, b) => timestampMs(b.lastSeen) - timestampMs(a.lastSeen)).slice(0, 20) };
  if (persist) persistPlayerNameHistory();
  return true;
}
function recordPlayerNamesFromActivity(items = [], { persist = true } = {}) {
  let changed = false;
  for (const item of items || []) changed = recordPlayerName(item?.userId, item?.displayName, item?.timestamp, "VRChat log", { persist: false }) || changed;
  if (changed && persist) persistPlayerNameHistory();
}
function recordPlayerNamesFromUsers(users = [], source = "VRChat") {
  let changed = false;
  for (const user of users || []) changed = recordPlayerName(user?.id, user?.displayName, new Date().toISOString(), source, { persist: false }) || changed;
  if (changed) persistPlayerNameHistory();
}
function playerNameHistoryItems(userId, currentName = "") {
  const id = String(userId || "").trim();
  const byName = new Map();
  const addName = (name, firstSeen, lastSeen, source = "Local", count = 1) => {
    const text = String(name || "").trim();
    if (!text || /^usr_[0-9a-f-]+$/i.test(text)) return;
    const key = text.toLowerCase();
    const existing = byName.get(key);
    byName.set(key, existing ? {
      name: text,
      firstSeen: earlierTimestamp(existing.firstSeen, firstSeen),
      lastSeen: laterTimestamp(existing.lastSeen, lastSeen),
      count: Number(existing.count || 0) + Number(count || 1),
      source: existing.source || source || "Local"
    } : { name: text, firstSeen, lastSeen, count: Number(count || 1), source: source || "Local" });
  };
  for (const item of Array.isArray(state.playerNameHistory?.[id]) ? state.playerNameHistory[id] : []) addName(item.name, item.firstSeen, item.lastSeen, item.source, item.count);
  for (const item of state.playerActivityLog.items || []) {
    const sameId = id && String(item.userId || "") === id;
    const sameName = !id && currentName && String(item.displayName || "").trim().toLowerCase() === String(currentName).trim().toLowerCase();
    if (sameId || sameName) addName(item.displayName, item.timestamp, item.timestamp, "VRChat log", 1);
  }
  if (currentName) addName(currentName, new Date().toISOString(), new Date().toISOString(), "Current", 1);
  return Array.from(byName.values()).sort((a, b) => timestampMs(b.lastSeen) - timestampMs(a.lastSeen));
}
function playerNameHistoryHtml(friend, { limit = 6 } = {}) {
  const names = playerNameHistoryItems(friend?.id, friend?.displayName).slice(0, limit);
  if (!names.length) return `<p class="friend-info-empty">No previous names recorded yet.</p>`;
  const attrs = `data-player-name-history="${escapeAttr(friend?.id || "")}" data-player-name="${escapeAttr(friend?.displayName || "")}"`;
  return `<div class="encounter-list name-history-list">${names.map((item, index) => `<button type="button" class="encounter-item name-history-item" ${attrs}><strong>${escapeHtml(item.name)}${index === 0 ? ` <em>current/latest</em>` : ""}</strong><span>${escapeHtml([nameChangedLabel(item, index), item.count > 1 ? `${item.count} sightings` : ""].filter(Boolean).join(" - "))}</span><small>${escapeHtml([`Last seen ${formatDateTime(item.lastSeen)}`, item.source].filter(Boolean).join(" - "))}</small></button>`).join("")}</div>`;
}
function playerEncounterItems(userId, displayName = "", remoteItems = []) {
  const id = String(userId || "").trim();
  const name = String(displayName || "").trim().toLowerCase();
  const seen = new Set();
  const merged = [];
  const add = (item, source = "Local VRChat logs") => {
    if (!item) return;
    const key = [item.timestamp, item.action, item.userId || id || item.displayName, item.location, item.worldName].map((value) => String(value || "").trim().toLowerCase()).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ ...item, source: item.source || source });
  };
  for (const item of remoteItems || []) add(item, "VRChat logs");
  for (const item of state.playerActivityLog.items || []) {
    const sameId = id && String(item.userId || "") === id;
    const sameName = name && String(item.displayName || "").trim().toLowerCase() === name;
    if (sameId || sameName) add(item, "Saved player log");
  }
  return merged.sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp));
}
function playerMetHistoryHtml(friend, { limit = 8 } = {}) {
  const items = playerEncounterItems(friend?.id, friend?.displayName, friend?.encounters || []);
  if (friend?.id && items.length) state.playerEncounterHistory[friend.id] = items;
  if (!items.length) return `<p class="friend-info-empty">No shared world history found in local VRChat logs.</p>`;
  const total = items.length;
  return `<div class="encounter-list">${items.slice(0, limit).map((item) => {
    const world = item.worldName || worldIdFromLocation(item.location) || "Unknown world";
    const detail = [item.action, item.location].filter(Boolean).join(" - ");
    return `<button type="button" class="encounter-item" data-player-met-history="${escapeAttr(friend?.id || "")}" data-player-name="${escapeAttr(friend?.displayName || "")}"><strong>${escapeHtml(world)}</strong><span>${escapeHtml(formatDateTime(item.timestamp))}</span><small>${escapeHtml(detail)}</small></button>`;
  }).join("")}${total > limit ? `<button type="button" class="friend-info-empty history-more-button" data-player-met-history="${escapeAttr(friend?.id || "")}" data-player-name="${escapeAttr(friend?.displayName || "")}">${escapeHtml(total - limit)} older entries hidden here. Click to show all.</button>` : ""}</div>`;
}
function nameChangedLabel(item, index = 0) {
  if (index === 0) return "Current/latest name";
  return item.firstSeen ? `Changed or first seen ${formatDateTime(item.firstSeen)}` : "Previously seen name";
}
function openPlayerNameHistoryDialog(userId, displayName = "") {
  const id = String(userId || "").trim();
  const names = playerNameHistoryItems(id, displayName);
  $("playerHistoryTitle").textContent = `${displayName || names[0]?.name || id || "Player"} - Username History`;
  $("playerHistoryContent").innerHTML = names.length
    ? `<div class="player-history-list">${names.map((item, index) => `<article class="player-history-row"><div><strong>${escapeHtml(item.name)}${index === 0 ? ` <em>current/latest</em>` : ""}</strong><span>${escapeHtml(nameChangedLabel(item, index))}</span><small>${escapeHtml([item.firstSeen ? `First seen ${formatDateTime(item.firstSeen)}` : "", item.lastSeen ? `Last seen ${formatDateTime(item.lastSeen)}` : "", item.count > 1 ? `${item.count} sightings` : "", item.source].filter(Boolean).join(" - "))}</small></div></article>`).join("")}</div>`
    : `<div class="settings-empty compact"><h4>No username history</h4><p>This app has not logged another name for this user yet.</p></div>`;
  $("playerHistoryDialog").showModal();
}
function openPlayerMetHistoryDialog(userId, displayName = "", remoteItems = null) {
  const id = String(userId || "").trim();
  const selected = state.social.selectedItem?.id === id ? state.social.selectedItem : null;
  const items = playerEncounterItems(id, displayName, remoteItems || selected?.encounters || state.playerEncounterHistory[id] || []);
  $("playerHistoryTitle").textContent = `${displayName || selected?.displayName || id || "Player"} - Met History`;
  $("playerHistoryContent").innerHTML = items.length
    ? `<div class="player-history-list">${items.map((item) => playerMetHistoryRowHtml(item)).join("")}</div>`
    : `<div class="settings-empty compact"><h4>No met history</h4><p>No local VRChat log entries were found for this player.</p></div>`;
  bindPlayerHistoryDialogEvents();
  $("playerHistoryDialog").showModal();
}
function playerMetHistoryRowHtml(item = {}) {
  const world = item.worldName || worldIdFromLocation(item.location) || "Unknown world";
  const worldId = item.worldId || worldIdFromLocation(item.location) || "";
  const detail = [item.action, item.location].filter(Boolean).join(" - ");
  return `<article class="player-history-row met-history-row"><div><strong>${escapeHtml(world)}</strong><span>${escapeHtml(formatDateTime(item.timestamp))}</span><small>${escapeHtml(detail || item.source || "")}</small></div>${worldId ? `<button type="button" data-history-world-id="${escapeAttr(worldId)}">World Details</button>` : ""}</article>`;
}
function bindPlayerHistoryDialogEvents() {
  $("playerHistoryContent").querySelectorAll("[data-history-world-id]").forEach((button) => button.addEventListener("click", () => {
    const worldId = button.dataset.historyWorldId || "";
    $("playerHistoryDialog").close();
    void openPlayerLogWorld(worldId);
  }));
}
function bindPlayerHistoryTriggers(container = document) {
  container.querySelectorAll("[data-player-name-history]").forEach((button) => button.addEventListener("click", () => openPlayerNameHistoryDialog(button.dataset.playerNameHistory || "", button.dataset.playerName || "")));
  container.querySelectorAll("[data-player-met-history]").forEach((button) => button.addEventListener("click", () => openPlayerMetHistoryDialog(button.dataset.playerMetHistory || "", button.dataset.playerName || "")));
}
function localPlayerProfileFromLogs(userId, displayName = "") {
  const id = String(userId || "").trim();
  const name = String(displayName || "").trim();
  const encounters = playerEncounterItems(id, name);
  const latest = encounters[0] || {};
  return {
    id,
    displayName: name || latest.displayName || id,
    isFriend: false,
    isOnline: false,
    presence: "offline",
    presenceSource: "local-log",
    location: "offline",
    lastLogin: latest.timestamp || "",
    encounters,
    rawJson: JSON.stringify({ id, displayName: name || latest.displayName || "", source: "Local VRChat logs", encounters: encounters.slice(0, 100) }, null, 2)
  };
}
function timestampMs(value) {
  const time = new Date(String(value || "").replace(/^(\d{4})\.(\d{2})\.(\d{2})\s+/, "$1-$2-$3T")).getTime();
  return Number.isFinite(time) ? time : 0;
}
function earlierTimestamp(left, right) {
  if (!left) return right || "";
  if (!right) return left || "";
  return timestampMs(left) <= timestampMs(right) ? left : right;
}
function laterTimestamp(left, right) {
  if (!left) return right || "";
  if (!right) return left || "";
  return timestampMs(left) >= timestampMs(right) ? left : right;
}
async function clearPlayerActivityLog() {
  if (!await confirmAction({ title: "Clear Player Logs", message: "Clear saved join and leave logs?", confirmLabel: "Clear", confirmClass: "danger" })) return;
  state.playerActivityLog.items = [];
  state.playerActivityLog.loaded = true;
  state.playerActivityLog.page = 0;
  persistPlayerActivityLog();
  renderSocialSidebar();
  renderNotificationsPage();
}
function renderNotificationsPage() {
  const list = $("notificationsList");
  const activity = $("activityList");
  const status = $("notificationStatus");
  if (!list || !activity || !status) return;
  if ($("notificationFilterSelect")) {
    $("notificationFilterSelect").value = state.notifications.filter || "all";
    updateSortButton("notificationFilterSelect", "notificationFilterMenuBtn");
  }
  if (!state.vrchat?.isLoggedIn) {
    status.textContent = "Log in to load VRChat notifications.";
    list.innerHTML = `<div class="settings-empty"><h4>Log in to VRChat</h4><p>Notifications need VRChat login.</p></div>`;
    $("activityPanelTitle").textContent = selectedActivityTitle();
    activity.innerHTML = selectedActivityHtml();
    return;
  }
  if (!state.playerActivityLog.loaded && !state.playerActivityLog.busy) void loadPlayerActivityLog();
  const filtered = filteredNotifications();
  status.textContent = state.notifications.busy
    ? "Loading notifications..."
    : `${filtered.length} notification${filtered.length === 1 ? "" : "s"}.${state.vrchatPipeline?.connected ? " Live sync connected." : ""}`;
  list.innerHTML = state.notifications.busy && !state.notifications.loaded
    ? `<div class="settings-empty"><h4>Loading notifications</h4></div>`
    : filtered.length
      ? filtered.map(notificationHtml).join("")
      : `<div class="settings-empty"><h4>No notifications</h4><p>Refresh to check VRChat notifications.</p></div>`;
  $("activityPanelTitle").textContent = selectedActivityTitle();
  activity.innerHTML = selectedActivityHtml();
  activity.querySelectorAll("[data-player-log-user]").forEach((button) => button.addEventListener("click", () => openPlayerLogUser(button.dataset.playerLogUser, button.dataset.playerLogName)));
  activity.querySelectorAll("[data-player-log-world]").forEach((button) => button.addEventListener("click", () => openPlayerLogWorld(button.dataset.playerLogWorld)));
  activity.querySelectorAll("[data-activity-user]").forEach((button) => button.addEventListener("click", () => openPlayerLogUser(button.dataset.activityUser, button.dataset.activityUserName)));
  activity.querySelectorAll("[data-activity-world]").forEach((button) => button.addEventListener("click", () => openPlayerLogWorld(button.dataset.activityWorld)));
  activity.querySelectorAll("[data-player-log-page]").forEach((button) => button.addEventListener("click", () => {
    const next = Number(button.dataset.playerLogPage);
    if (!Number.isFinite(next)) return;
    state.playerActivityLog.page = next;
    renderNotificationsPage();
  }));
}
function filteredNotifications() {
  const filter = state.notifications.filter || "all";
  if (filter === "all") return state.notifications.items || [];
  return (state.notifications.items || []).filter((item) => notificationBucket(item) === filter);
}
function notificationBucket(item) {
  const type = String(item.type || "").toLowerCase();
  if (type.includes("invite")) return type.includes("request") ? "request" : "invite";
  if (type.includes("friend")) return "friend";
  if (type.includes("group")) return "group";
  return "system";
}
function notificationTitle(item) {
  const type = String(item.type || "Notification").replace(/[_-]+/g, " ");
  return item.title || type.replace(/\b\w/g, (c) => c.toUpperCase());
}
function notificationDetail(item) {
  return [item.senderUsername, item.message].filter(Boolean).join(": ");
}
function notificationHtml(item) {
  const bucket = notificationBucket(item);
  const senderAttrs = item.senderUserId || item.senderUsername
    ? ` role="button" tabindex="0" data-notification-id="${escapeAttr(item.id)}" data-notification-type="${escapeAttr(item.type)}" data-notification-sender-id="${escapeAttr(item.senderUserId)}" data-notification-sender-name="${escapeAttr(item.senderUsername)}"`
    : "";
  return `<article class="notification-item ${escapeAttr(bucket)} ${item.seen ? "seen" : "unseen"}"${senderAttrs}>
    <div><strong>${escapeHtml(notificationTitle(item))}</strong><p>${escapeHtml(notificationDetail(item) || "No message.")}</p></div>
    <time>${escapeHtml(formatDateTime(item.createdAt))}</time>
  </article>`;
}
function activityFilters() {
  const socialItems = state.socialActivity || [];
  const messageItems = state.messageHistory || [];
  return [
    { id: "players", label: "Player Join/Leave", count: (state.playerActivityLog.items || []).length },
    { id: "worlds", label: "Worlds Viewed", count: socialItems.filter((item) => activityItemBucket(item) === "worlds").length },
    { id: "users", label: "Users Viewed", count: socialItems.filter((item) => activityItemBucket(item) === "users").length },
    { id: "messages", label: "Messages / Invites", count: messageItems.length },
    { id: "sync", label: "Sync Events", count: socialItems.filter((item) => activityItemBucket(item) === "sync").length },
    { id: "all", label: "All Local Activity", count: socialItems.length }
  ];
}
function activityFilterSidebarHtml() {
  const active = state.activityFilter || "players";
  return activityFilters().map((item, index) => `<div class="group-item activity-filter-item ${item.id === active ? "active" : ""}" data-activity-filter="${escapeAttr(item.id)}"><button class="group-position" type="button" disabled>#${index + 1}</button><button class="group-select" type="button"><span class="group-title">${escapeHtml(item.label)}</span><span class="group-count">${escapeHtml(item.count)}</span></button></div>`).join("");
}
function activityItemBucket(item = {}) {
  const type = String(item.type || "").toLowerCase();
  const source = String(item.source || "").toLowerCase();
  if (type.includes("world") || source.includes("world")) return "worlds";
  if (type.includes("friend") || type.includes("user") || type.includes("notification-open")) return "users";
  if (type.includes("sync") || source.includes("sync") || source.includes("pipeline")) return "sync";
  if (type.includes("message") || type.includes("invite") || type.includes("notification")) return "messages";
  return "all";
}
function activityListHtml(filter = "all") {
  const items = filter === "all" ? state.socialActivity || [] : (state.socialActivity || []).filter((item) => activityItemBucket(item) === filter);
  if (!items.length) return `<div class="settings-empty"><h4>No activity yet</h4><p>Matching local activity will appear here.</p></div>`;
  return items.map((item) => `<article class="activity-item">
    <div>${activityTitleHtml(item)}<p>${escapeHtml(item.detail || item.source || "")}</p>${activityLinksHtml(item)}</div>
    <time>${escapeHtml(formatDateTime(item.timestamp))}</time>
  </article>`).join("");
}
function messageActivityHtml() {
  const items = state.messageHistory || [];
  if (!items.length) return `<div class="settings-empty"><h4>No message activity</h4><p>Invite and request messages will appear here.</p></div>`;
  const userIdForMessage = (item) => item.direction === "outgoing" ? item.recipientUserId : item.senderUserId;
  const userNameForMessage = (item) => item.direction === "outgoing" ? item.recipientUsername : item.senderUsername;
  return items.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).map((item) => `<article class="activity-item ${escapeAttr(notificationBucket(item))}">
    <div>${userIdForMessage(item) ? `<button type="button" data-activity-user="${escapeAttr(userIdForMessage(item))}" data-activity-user-name="${escapeAttr(userNameForMessage(item) || "")}">${escapeHtml(userNameForMessage(item) || userIdForMessage(item))}</button>` : `<strong>${escapeHtml(userNameForMessage(item) || "VRChat")}</strong>`}<p>${escapeHtml(messageConversationPreview(item) || notificationDetail(item) || "No message text.")}</p></div>
    <time>${escapeHtml(formatDateTime(item.createdAt))}</time>
  </article>`).join("");
}
function activityTitleHtml(item = {}) {
  const title = item.title || "Activity";
  if (item.userId) return `<button type="button" data-activity-user="${escapeAttr(item.userId)}" data-activity-user-name="${escapeAttr(title)}">${escapeHtml(title)}</button>`;
  if (item.worldId) return `<button type="button" data-activity-world="${escapeAttr(item.worldId)}">${escapeHtml(title)}</button>`;
  return `<strong>${escapeHtml(title)}</strong>`;
}
function activityLinksHtml(item = {}) {
  const links = [];
  if (item.userId && item.worldId) links.push(`<button type="button" data-activity-world="${escapeAttr(item.worldId)}">Open World</button>`);
  if (!links.length) return "";
  return `<div class="activity-links">${links.join("")}</div>`;
}
function selectedActivityHtml() {
  const filter = state.activityFilter || "players";
  if (filter === "players") return playerActivityLogHtml();
  if (filter === "messages") return messageActivityHtml();
  return activityListHtml(filter);
}
function selectedActivityTitle() {
  return activityFilters().find((item) => item.id === (state.activityFilter || "players"))?.label || "Activity";
}
function playerActivityLogHtml() {
  if (state.playerActivityLog.busy && !state.playerActivityLog.loaded) return `<div class="settings-empty"><h4>Loading player logs</h4></div>`;
  const items = state.playerActivityLog.items || [];
  if (!items.length) return `<div class="settings-empty"><h4>No player logs found</h4><p>Join and leave history is read from local VRChat output logs.</p></div>`;
  const pageSize = state.playerActivityLog.pageSize || 50;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(0, state.playerActivityLog.page || 0), totalPages - 1);
  state.playerActivityLog.page = page;
  const pageItems = items.slice(page * pageSize, page * pageSize + pageSize);
  const start = page * pageSize + 1;
  const end = Math.min(items.length, start + pageItems.length - 1);
  return `<div class="player-log-table">
    <div class="player-log-head"><span>Date</span><span>Type</span><span>User</span><span>Detail</span></div>
    <div class="player-log-body">${pageItems.map(playerActivityLogRowHtml).join("")}</div>
    <div class="player-log-pager">
      <span>${start}-${end} of ${items.length}</span>
      <button type="button" data-player-log-page="${page - 1}" ${page <= 0 ? "disabled" : ""}>Previous</button>
      <strong>Page ${page + 1} / ${totalPages}</strong>
      <button type="button" data-player-log-page="${page + 1}" ${page >= totalPages - 1 ? "disabled" : ""}>Next</button>
    </div>
  </div>`;
}
function playerActivityLogRowHtml(item) {
  const user = item.userId
    ? `<button type="button" data-player-log-user="${escapeAttr(item.userId)}" data-player-log-name="${escapeAttr(item.displayName || "")}">${escapeHtml(item.displayName || item.userId)}</button>`
    : `<span>${escapeHtml(item.displayName || "Unknown")}</span>`;
  const typeClass = String(item.action || "").toLowerCase().includes("left") ? "left" : "joined";
  const detail = [item.worldName, item.location].filter(Boolean).join(" - ");
  const detailHtml = item.worldId
    ? `<button type="button" class="player-log-world" data-player-log-world="${escapeAttr(item.worldId)}" title="${escapeAttr(detail)}">${escapeHtml(detail || item.worldId)}</button>`
    : `<small title="${escapeAttr(detail)}">${escapeHtml(detail || item.logFile || "")}</small>`;
  return `<div class="player-log-row">
    <time>${escapeHtml(formatShortLogDate(item.timestamp))}</time>
    <span class="player-log-type ${typeClass}">${escapeHtml(item.action || "")}</span>
    ${user}
    ${detailHtml}
  </div>`;
}
function formatShortLogDate(value) {
  const normalized = String(value || "").replace(/^(\d{4})\.(\d{2})\.(\d{2})\s+/, "$1-$2-$3T");
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return String(value || "");
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
async function openPlayerLogUser(userId, displayName = "") {
  const id = String(userId || "").trim();
  if (!id) return;
  openNotificationDetailsLoading(displayName || id);
  const friend = await loadSocialFriendDetails(id);
  openNotificationFriendDetails(friend || localPlayerProfileFromLogs(id, displayName), null);
}
async function openPlayerLogWorld(worldId) {
  const id = String(worldId || "").trim();
  if (!id) return;
  openNotificationDetailsLoading("World Details");
  $("notificationDetailsContent").innerHTML = `<div class="settings-empty"><h4>Loading world details</h4></div>`;
  try {
    const [world, history] = await Promise.all([
      api("vrchatWorldDetail", { id }, 45000),
      api("vrchatWorldVisitHistory", { worldId: id }, 30000).catch(() => ({ items: [] }))
    ]);
    openNotificationWorldDetails({ ...world, visitHistory: history.items || [] });
  } catch (e) {
    $("notificationDetailsContent").innerHTML = `<div class="settings-empty"><h4>Could not load world</h4><p>${escapeHtml(e.message)}</p></div>`;
  }
}
function openNotificationWorldDetails(world) {
  $("notificationDetailsPanel").hidden = false;
  $("notificationDetailsTitle").textContent = world?.name || "World Details";
  $("notificationDetailsContent").classList.remove("friend-detail-host");
  $("notificationDetailsContent").innerHTML = worldDetailsHtml(world || {});
  bindWorldDetailsPanelEvents($("notificationDetailsContent"), world);
}
function messageConversations() {
  const byUser = new Map();
  for (const item of state.messageHistory || []) {
    const userId = item.senderUserId || item.senderUsername || "system";
    if (!byUser.has(userId)) {
      const friend = findSocialFriend(userId, item.senderUsername);
      byUser.set(userId, {
        userId,
        name: item.senderUsername || friend?.displayName || userId,
        imageUrl: messageConversationImage({ imageUrl: item.senderImageUrl || item.imageUrl || "" }, friend || {}),
        presence: friendPresence(friend || {}),
        friend,
        items: []
      });
    }
    byUser.get(userId).items.push(item);
  }
  return [...byUser.values()].map((conversation) => ({
    ...conversation,
    items: conversation.items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    last: conversation.items[conversation.items.length - 1]
  })).sort((a, b) => new Date(b.last?.createdAt || 0).getTime() - new Date(a.last?.createdAt || 0).getTime());
}
function messageSidebarConversationHtml(conversation) {
  const selected = conversation.userId === state.selectedMessageUserId;
  const friend = conversation.friend || findSocialFriend(conversation.userId, conversation.name) || {};
  const presence = friendPresence(friend) || conversation.presence || "offline";
  const image = messageConversationImage(conversation, friend);
  const rankClass = trustClassName(trustRankLabel(splitCsv(friend.tags).map((tag) => tag.toLowerCase()))) || "visitor";
  const statusLine = friend.statusDescription || messageConversationPreview(conversation.last) || "";
  const rawLocation = String(friend.location || "").toLowerCase();
  const location = presence !== "offline" ? (rawLocation === "offline" ? presenceLabel(presence) : (friend.worldId || friend.location || presenceLabel(presence))) : "Offline";
  const count = Number(conversation.items?.length || 0);
  return `<button type="button" class="social-card friend-card message-sidebar-card presence-${escapeAttr(presence)} ${selected ? "selected" : ""}" data-message-user="${escapeAttr(conversation.userId)}">
    <span class="message-sidebar-avatar">${image ? `<img src="${escapeAttr(image)}" alt="">` : ""}${userStatusDotHtml(friend.status, presence, friendStatusLimited(friend, presence))}</span>
    <div>
      <strong class="friend-card-title">${userStatusDotHtml(friend.status, presence, friendStatusLimited(friend, presence))}<span class="friend-name-rank ${escapeAttr(rankClass)}">${escapeHtml(conversation.name || conversation.userId)}</span>${count > 1 ? `<em>${count}</em>` : ""}</strong>
      ${statusLine ? `<span>${escapeHtml(statusLine)}</span>` : ""}
      <small>${escapeHtml(location)}</small>
    </div>
  </button>`;
}
function findSocialFriend(userId, name = "") {
  const id = String(userId || "").toLowerCase();
  const lowerName = String(name || "").toLowerCase();
  const matches = (friend) => friend && (String(friend.id || "").toLowerCase() === id || (lowerName && String(friend.displayName || "").toLowerCase() === lowerName));
  const selected = matches(state.social.selectedItem) ? state.social.selectedItem : null;
  const listed = (state.social.friends || []).find(matches) || (state.social.favoriteFriends || []).find(matches) || null;
  const cached = id ? getCachedFriendDetail(id) : null;
  const cachedByName = !cached && lowerName ? [...state.friendDetailCache.values()].find(matches) || null : null;
  const current = selected || listed || null;
  const detail = cached || cachedByName || null;
  return applyFriendPresenceAuthority(current && detail ? mergeFriendCurrentWithCache(current, detail) : current || detail || null);
}
function findListedFriendById(id = "") {
  const key = String(id || "").trim().toLowerCase();
  if (!key) return null;
  const friend = (state.social.friends || []).find((friend) => String(friend.id || "").toLowerCase() === key)
    || (state.social.favoriteFriends || []).find((friend) => String(friend.id || "").toLowerCase() === key)
    || null;
  return applyFriendPresenceAuthority(friend);
}
function messageConversationImage(conversation = {}, friend = {}) {
  return normalizeVrchatImageUrl(conversation.imageUrl
    || friendProfileImage(friend)
    || friend?.imageUrl
    || friend?.currentAvatarThumbnailImageUrl
    || friend?.currentAvatarImageUrl
    || "");
}
async function hydrateMessageConversationUser(userId, fallbackName = "") {
  const id = String(userId || "").trim();
  if (!state.vrchat?.isLoggedIn || !id.startsWith("usr_") || state.messageHydratingUsers.has(id)) return;
  state.messageHydratingUsers.add(id);
  try {
    const detail = await api("vrchatFriendDetail", { id }, 45000);
    if (!detail) return;
    const existing = findSocialFriend(id, fallbackName) || {};
    upsertSocialFriend(id, {
      ...existing,
      ...detail,
      id,
      displayName: detail.displayName || existing.displayName || fallbackName || id,
      imageUrl: messageConversationImage({}, { ...existing, ...detail })
    });
    renderMessagesPage();
    renderSocialSidebar();
  } catch {
    // Missing profile images should not interrupt the message thread.
  } finally {
    state.messageHydratingUsers.delete(id);
  }
}
function renderMessagesPage() {
  const thread = $("messageThread");
  const header = $("messageThreadHeader");
  const status = $("messagesStatus");
  if (!thread || !header || !status) return;
  const conversations = messageConversations();
  if (!state.selectedMessageUserId && conversations[0]) state.selectedMessageUserId = conversations[0].userId;
  status.textContent = conversations.length ? `${conversations.length} conversation${conversations.length === 1 ? "" : "s"} from VRChat notifications.` : "No VRChat notification messages yet.";
  const selected = conversations.find((conversation) => conversation.userId === state.selectedMessageUserId) || conversations[0] || null;
  if (!selected) {
    header.innerHTML = `<h3>Select a conversation</h3>`;
    thread.innerHTML = `<div class="settings-empty"><h4>No conversation selected</h4></div>`;
    return;
  }
  renderMessageConversationInto(selected, header, thread);
}
function renderInlineMessagePanel() {
  const oldPanel = $("inlineMessagePanel");
  if (oldPanel) oldPanel.hidden = true;
  renderMessagePopupDock();
}
function openInlineMessagePanel(userId, displayName = "", options = {}) {
  const id = ensureMessageConversationForUser(userId, displayName);
  if (!id) return;
  state.inlineMessageUserId = id;
  state.inlineMessageUserIds = [id, ...(state.inlineMessageUserIds || []).filter((value) => value !== id)].slice(0, 4);
  state.collapsedMessageUserIds.delete(id);
  if (!options.skipRender) {
    renderInlineMessagePanel();
    renderSocialSidebar();
    renderPageTabs();
  }
}
function closeInlineMessagePanel(userId = "") {
  const id = String(userId || state.inlineMessageUserId || "").trim();
  if (id) {
    state.inlineMessageUserIds = (state.inlineMessageUserIds || []).filter((value) => value !== id);
    state.collapsedMessageUserIds.delete(id);
    if (state.inlineMessageUserId === id) state.inlineMessageUserId = state.inlineMessageUserIds[0] || "";
  } else {
    state.inlineMessageUserIds = [];
    state.collapsedMessageUserIds.clear();
    state.inlineMessageUserId = "";
  }
  $("inlineMessagePanel").hidden = true;
  $("inlineMessageHeader").innerHTML = `<h3>Messages</h3><button id="closeInlineMessageBtn" type="button" class="icon-button">x</button>`;
  $("inlineMessageContent").innerHTML = "";
  $("closeInlineMessageBtn").addEventListener("click", () => closeInlineMessagePanel());
  renderMessagePopupDock();
}
function toggleInlineMessageCollapsed(userId) {
  const id = String(userId || "").trim();
  if (!id) return;
  if (state.collapsedMessageUserIds.has(id)) state.collapsedMessageUserIds.delete(id);
  else state.collapsedMessageUserIds.add(id);
  renderMessagePopupDock();
}
function resetInlineMessagePanelSize() {
  const panel = $("inlineMessagePanel");
  if (!panel) return;
  panel.style.left = "";
  panel.style.top = "";
  panel.style.right = "";
  panel.style.bottom = "";
  panel.style.width = "";
  panel.style.height = "";
}
function setupInlineMessageResize() {
  const panel = $("inlineMessagePanel");
  if (!panel) return;
  panel.querySelectorAll("[data-inline-message-resize]").forEach((handle) => handle.addEventListener("pointerdown", startInlineMessageResize));
}
function startInlineMessageResize(event) {
  if (event.button !== 0) return;
  const panel = $("inlineMessagePanel");
  const direction = event.currentTarget?.dataset.inlineMessageResize || "";
  if (!panel || !direction) return;
  event.preventDefault();
  event.stopPropagation();
  const startRect = panel.getBoundingClientRect();
  const start = { x: event.clientX, y: event.clientY, left: startRect.left, top: startRect.top, right: startRect.right, bottom: startRect.bottom };
  panel.style.left = `${startRect.left}px`;
  panel.style.top = `${startRect.top}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  panel.style.width = `${startRect.width}px`;
  panel.style.height = `${startRect.height}px`;
  panel.classList.add("resizing");
  event.currentTarget.setPointerCapture?.(event.pointerId);
  const resize = (moveEvent) => {
    const dx = moveEvent.clientX - start.x;
    const dy = moveEvent.clientY - start.y;
    const margin = INLINE_MESSAGE_RESIZE_MIN.margin;
    let left = direction.includes("w") ? start.left + dx : start.left;
    let right = direction.includes("e") ? start.right + dx : start.right;
    let top = direction.includes("n") ? start.top + dy : start.top;
    let bottom = direction.includes("s") ? start.bottom + dy : start.bottom;
    left = Math.max(margin, Math.min(left, window.innerWidth - margin - INLINE_MESSAGE_RESIZE_MIN.width));
    right = Math.min(window.innerWidth - margin, Math.max(right, margin + INLINE_MESSAGE_RESIZE_MIN.width));
    top = Math.max(margin, Math.min(top, window.innerHeight - margin - INLINE_MESSAGE_RESIZE_MIN.height));
    bottom = Math.min(window.innerHeight - margin, Math.max(bottom, margin + INLINE_MESSAGE_RESIZE_MIN.height));
    if (right - left < INLINE_MESSAGE_RESIZE_MIN.width) {
      if (direction.includes("w")) left = right - INLINE_MESSAGE_RESIZE_MIN.width;
      else right = left + INLINE_MESSAGE_RESIZE_MIN.width;
    }
    if (bottom - top < INLINE_MESSAGE_RESIZE_MIN.height) {
      if (direction.includes("n")) top = bottom - INLINE_MESSAGE_RESIZE_MIN.height;
      else bottom = top + INLINE_MESSAGE_RESIZE_MIN.height;
    }
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.width = `${Math.round(right - left)}px`;
    panel.style.height = `${Math.round(bottom - top)}px`;
  };
  const stop = () => {
    panel.classList.remove("resizing");
    window.removeEventListener("pointermove", resize);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };
  window.addEventListener("pointermove", resize);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}
function renderMessageConversationInto(selected, header, thread) {
  if (!selected || !header || !thread) return;
  if (!selected.imageUrl) void hydrateMessageConversationUser(selected.userId, selected.name);
  header.innerHTML = messageThreadHeaderHtml(selected);
  thread.innerHTML = `<div class="message-bubbles">${selected.items.map((item) => messageBubbleHtml(item, selected)).join("")}</div>${messageComposerHtml(selected)}`;
  header.querySelectorAll("[data-social-action]").forEach((button) => button.addEventListener("click", handleSocialAction));
  thread.querySelectorAll("[data-social-action]").forEach((button) => button.addEventListener("click", handleSocialAction));
  const composer = thread.querySelector("#messageComposerForm");
  if (composer) composer.addEventListener("submit", sendMessageComposer);
  const composerInput = thread.querySelector("#messageComposerInput");
  if (composerInput) composerInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    composer?.requestSubmit();
  });
  if (composerInput) composerInput.addEventListener("input", updateMessageComposerCount);
  updateMessageComposerCount(thread);
}
function renderPopupMessageConversationInto(selected, header, thread) {
  if (!selected || !header || !thread) return;
  if (!selected.imageUrl) void hydrateMessageConversationUser(selected.userId, selected.name);
  header.innerHTML = messageThreadHeaderHtml(selected);
  header.insertAdjacentHTML("beforeend", `<div class="chat-actions-wrap"><button type="button" class="icon-button chat-actions-btn" data-chat-actions="${escapeAttr(selected.userId)}" title="Chat actions">...</button><div class="chat-actions-menu" hidden><button type="button" data-social-action="invite" data-user-id="${escapeAttr(selected.userId)}">Invite</button><button type="button" data-social-action="requestInvite" data-user-id="${escapeAttr(selected.userId)}">Request Invite</button></div></div><button type="button" class="icon-button chat-collapse-btn" data-chat-collapse="${escapeAttr(selected.userId)}" title="Collapse">_</button><button type="button" class="icon-button" data-chat-close="${escapeAttr(selected.userId)}" title="Close">x</button>`);
  thread.innerHTML = `<div class="message-bubbles">${selected.items.map((item) => messageBubbleHtml(item, selected)).join("")}</div>${messageComposerHtml(selected)}`;
  header.querySelectorAll("[data-social-action]").forEach((button) => button.addEventListener("click", handleSocialAction));
  header.querySelectorAll("[data-chat-actions]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = button.nextElementSibling;
    if (!menu) return;
    const opening = menu.hidden;
    document.querySelectorAll(".chat-actions-menu").forEach((item) => { item.hidden = true; });
    menu.hidden = !opening;
  }));
  thread.querySelectorAll("[data-social-action]").forEach((button) => button.addEventListener("click", handleSocialAction));
  const composer = thread.querySelector("#messageComposerForm");
  if (composer) composer.addEventListener("submit", sendMessageComposer);
  const composerInput = thread.querySelector("#messageComposerInput");
  if (composerInput) composerInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    composer?.requestSubmit();
  });
  if (composerInput) composerInput.addEventListener("input", updateMessageComposerCount);
  updateMessageComposerCount(thread);
}
function renderMessagePopupDock() {
  const dock = $("messagePopupDock");
  if (!dock) return;
  const ids = state.activePage === "messages" ? [] : (state.inlineMessageUserIds || []);
  const conversations = messageConversations();
  const panels = ids.map((id) => conversations.find((item) => item.userId === id)).filter(Boolean);
  dock.hidden = panels.length === 0;
  dock.innerHTML = "";
  for (const conversation of panels) {
    const collapsed = state.collapsedMessageUserIds.has(conversation.userId);
    const panel = document.createElement("section");
    panel.className = `chat-popup-panel ${collapsed ? "collapsed" : ""}`;
    panel.dataset.chatUser = conversation.userId;
    panel.innerHTML = `<header class="chat-popup-header"></header><div class="chat-popup-content message-thread" ${collapsed ? "hidden" : ""}></div>`;
    const header = panel.querySelector(".chat-popup-header");
    const content = panel.querySelector(".chat-popup-content");
    if (collapsed) {
      header.innerHTML = chatPopupCollapsedHeaderHtml(conversation);
    } else {
      renderPopupMessageConversationInto(conversation, header, content);
    }
    dock.appendChild(panel);
  }
  dock.querySelectorAll("[data-chat-collapse]").forEach((button) => button.addEventListener("click", () => toggleInlineMessageCollapsed(button.dataset.chatCollapse)));
  dock.querySelectorAll("[data-chat-close]").forEach((button) => button.addEventListener("click", () => closeInlineMessagePanel(button.dataset.chatClose)));
  dock.querySelectorAll("[data-chat-expand]").forEach((button) => button.addEventListener("click", () => toggleInlineMessageCollapsed(button.dataset.chatExpand)));
}
function chatPopupCollapsedHeaderHtml(conversation) {
  const friend = conversation.friend || findSocialFriend(conversation.userId, conversation.name) || {};
  const image = messageConversationImage(conversation, friend);
  const presence = friendPresence(friend) || conversation.presence || "offline";
  return `<button type="button" class="chat-collapsed-main" data-chat-expand="${escapeAttr(conversation.userId)}"><span class="message-avatar">${image ? `<img src="${escapeAttr(image)}" alt="">` : ""}${presenceDotHtml(presence)}</span><span><strong>${escapeHtml(conversation.name || conversation.userId)}</strong><small>${escapeHtml(messageConversationPreview(conversation.last) || presenceLabel(presence))}</small></span></button><button type="button" class="icon-button" data-chat-close="${escapeAttr(conversation.userId)}" title="Close">x</button>`;
}
function messageConversationHtml(conversation) {
  const active = conversation.userId === state.selectedMessageUserId;
  const detail = messageConversationPreview(conversation.last) || notificationTitle(conversation.last);
  const friend = conversation.friend || findSocialFriend(conversation.userId, conversation.name) || {};
  const image = messageConversationImage(conversation, friend);
  return `<button type="button" class="message-conversation ${active ? "active" : ""}" data-message-user="${escapeAttr(conversation.userId)}">
    <span class="message-avatar">${image ? `<img src="${escapeAttr(image)}" alt="">` : ""}${presenceDotHtml(conversation.presence)}</span>
    <span><strong>${escapeHtml(conversation.name)}</strong><small>${escapeHtml(detail || "Notification")}</small></span>
    <time>${escapeHtml(formatDateTime(conversation.last?.createdAt))}</time>
  </button>`;
}
function messageThreadHeaderHtml(conversation) {
  const friend = conversation.friend || findSocialFriend(conversation.userId, conversation.name) || {};
  const presence = friendPresence(friend) || conversation.presence || "offline";
  const statusText = friend.statusDescription || presenceLabel(presence);
  const image = messageConversationImage(conversation, friend);
  return `<div class="message-thread-heading">
    <span class="message-avatar large">${image ? `<img src="${escapeAttr(image)}" alt="">` : ""}${userStatusDotHtml(friend.status, presence, friendStatusLimited(friend, presence))}</span>
    <div><h3>${userStatusDotHtml(friend.status, presence, friendStatusLimited(friend, presence))}${escapeHtml(conversation.name)}${friend.status ? `<small class="message-header-status ${escapeAttr(userStatusClass(friend.status, presence))}">${escapeHtml(userStatusLabel(friend.status, presence))}</small>` : ""}</h3><span>${escapeHtml(statusText)}</span></div>
    <button type="button" data-social-action="invite" data-user-id="${escapeAttr(conversation.userId)}">Invite</button>
    <button type="button" data-social-action="requestInvite" data-user-id="${escapeAttr(conversation.userId)}">Request Invite</button>
  </div>`;
}
function messageBubbleHtml(item, conversation) {
  const actions = messageActionsHtml(item, conversation);
  const outgoing = item.direction === "outgoing";
  const text = String(item.message || "").trim() || notificationDetail(item) || "No message text.";
  const label = messageBubbleLabel(item, outgoing);
  return `<article class="message-bubble ${outgoing ? "outgoing" : "incoming"} ${escapeAttr(notificationBucket(item))}">
    <p>${escapeHtml(text)}</p>
    ${actions}
    <footer><span>${escapeHtml(label)}</span><time>${escapeHtml(formatDateTime(item.createdAt))}</time></footer>
  </article>`;
}
function messageBubbleLabel(item, outgoing = false) {
  const type = String(item.type || "").toLowerCase();
  if (outgoing) return type.includes("request") ? "Request invite sent" : "Invite sent";
  if (isFriendRequestNotification(item)) return "Friend request";
  if (type.includes("request")) return "Request invite";
  if (type.includes("invite")) return "Invite";
  return notificationTitle(item);
}
function messageConversationPreview(item) {
  if (!item) return "";
  const text = String(item.message || "").trim();
  if (item.direction === "outgoing") return text ? `You: ${text}` : messageBubbleLabel(item, true);
  return notificationDetail(item);
}
function messageComposerHtml(conversation) {
  return `<form id="messageComposerForm" class="message-composer" data-message-user="${escapeAttr(conversation.userId)}" data-message-name="${escapeAttr(conversation.name)}">
    <div class="message-composer-field">
      <textarea id="messageComposerInput" maxlength="64" rows="2" placeholder="Type an invite/request message..."></textarea>
    </div>
    <div class="message-composer-actions">
      <span id="messageComposerCount">0/64</span>
      <button id="sendMessageBtn" type="submit" class="primary">Send</button>
    </div>
  </form>`;
}
function updateMessageComposerCount(root = document) {
  const input = root.querySelector ? root.querySelector("#messageComposerInput") : $("messageComposerInput");
  const counter = root.querySelector ? root.querySelector("#messageComposerCount") : $("messageComposerCount");
  if (!input || !counter) return;
  counter.textContent = `${String(input.value || "").length}/64`;
}
async function sendMessageComposer(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const root = form.closest(".message-thread") || document;
  const input = root.querySelector("#messageComposerInput");
  const button = root.querySelector("#sendMessageBtn");
  const userId = form.dataset.messageUser || "";
  const name = form.dataset.messageName || userId;
  const message = String(input?.value || "").trim();
  if (!userId || !message) return;
  if (button) button.disabled = true;
  try {
    const result = await api("vrchatSendChatMessage", { userId, message, mode: "request" }, 45000);
    addMessageNotification({
      id: `local-outgoing-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: result?.mode === "request" ? "sentRequestInvite" : "sentInvite",
      senderUserId: userId,
      senderUsername: name,
      message: result?.message || message,
      createdAt: new Date().toISOString(),
      seen: true,
      direction: "outgoing"
    });
    state.selectedMessageUserId = userId;
    if (state.inlineMessageUserId === userId) state.inlineMessageUserId = userId;
    if (input) input.value = "";
    renderMessagesPage();
    renderInlineMessagePanel();
    toast(result?.mode === "request" ? "Request invite message sent." : "Invite message sent.");
  } catch (e) {
    toast(e.message);
  } finally {
    if (button) button.disabled = false;
  }
}
async function clearMessageHistory() {
  const userId = state.selectedMessageUserId;
  const conversation = messageConversations().find((item) => item.userId === userId);
  if (!conversation) { toast("Select a conversation first."); return; }
  if (!await confirmAction({ title: "Clear Messages", message: `Clear saved messages with ${conversation.name || userId}?`, confirmLabel: "Clear", confirmClass: "danger" })) return;
  state.messageHistory = (state.messageHistory || []).filter((item) => (item.senderUserId || item.senderUsername || "system") !== userId);
  state.messagePopupItem = null;
  saveLocalJson("vrcneph.messageHistory", state.messageHistory);
  persistMessageHistory();
  if ((state.inlineMessageUserIds || []).includes(userId)) closeInlineMessagePanel(userId);
  if (state.selectedMessageUserId === userId) state.selectedMessageUserId = "";
  renderMessagesPage();
  renderSocialSidebar();
  renderMessagePopup();
  toast("Conversation cleared.");
}
function messageActionsHtml(item, conversation) {
  if (item.direction === "outgoing") return "";
  const userId = item.senderUserId || conversation.userId || "";
  if (isFriendRequestNotification(item)) {
    return `<div class="message-actions"><button type="button" class="primary" data-social-action="acceptFriendRequest" data-notification-id="${escapeAttr(item.id)}" data-user-id="${escapeAttr(userId)}">Accept</button><button type="button" class="danger" data-social-action="declineNotification" data-notification-id="${escapeAttr(item.id)}" data-user-id="${escapeAttr(userId)}">Decline</button></div>`;
  }
  const bucket = notificationBucket(item);
  if (bucket === "invite") return `<div class="message-actions"><button type="button" data-social-action="requestInvite" data-user-id="${escapeAttr(userId)}">Reply</button></div>`;
  if (bucket === "request") return `<div class="message-actions"><button type="button" data-social-action="invite" data-user-id="${escapeAttr(userId)}">Invite</button></div>`;
  return "";
}
function formatDateTime(value) {
  const normalized = String(value || "").replace(/^(\d{4})\.(\d{2})\.(\d{2})\s+/, "$1-$2-$3T");
  const time = new Date(normalized).getTime();
  if (!Number.isFinite(time)) return String(value || "");
  return new Date(time).toLocaleString();
}
function relativeTime(value) {
  const normalized = String(value || "").replace(/^(\d{4})\.(\d{2})\.(\d{2})\s+/, "$1-$2-$3T");
  const time = new Date(normalized).getTime();
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
async function openNotificationSender(element) {
  const notificationId = element.dataset.notificationId || "";
  const notification = state.notifications.items.find((item) => item.id === notificationId) || null;
  const userId = element.dataset.notificationSenderId || "";
  const displayName = element.dataset.notificationSenderName || "";
  if (!userId && !displayName) return;
  addSocialActivity({ type: "notification-open", title: `Opened notification sender: ${displayName || userId}`, detail: userId, userId, source: "Notifications" });
  openNotificationDetailsLoading(displayName || userId);
  if (userId) {
    const friend = await loadSocialFriendDetails(userId);
    openNotificationFriendDetails(friend || localPlayerProfileFromLogs(userId, displayName), notification);
    return;
  }
  toast("This notification did not include a VRChat user ID.");
}
function openNotificationDetailsLoading(title) {
  $("notificationDetailsPanel").hidden = false;
  $("notificationDetailsTitle").textContent = title || "Notification Details";
  $("notificationDetailsContent").classList.remove("friend-detail-host");
  $("notificationDetailsContent").innerHTML = `<div class="settings-empty"><h4>Loading user details</h4></div>`;
}
function openNotificationFriendDetails(friend, notification = null, { resetTab = true } = {}) {
  if (resetTab) state.social.friendTab = "info";
  $("notificationDetailsPanel").hidden = false;
  $("notificationDetailsTitle").textContent = friend.displayName || "User Details";
  $("notificationDetailsContent").classList.add("friend-detail-host");
  $("notificationDetailsContent").innerHTML = notificationFriendDetailsHtml(friend, notification);
  $("notificationDetailsContent").querySelectorAll("[data-social-action]").forEach((button) => button.addEventListener("click", handleSocialAction));
  $("notificationDetailsContent").querySelectorAll("[data-friend-tab]").forEach((button) => button.addEventListener("click", () => {
    state.social.friendTab = button.dataset.friendTab || "info";
    openNotificationFriendDetails(friend, notification, { resetTab: false });
  }));
  $("notificationDetailsContent").querySelectorAll("[data-avatar-detail-id], [data-avatar-detail-kind]").forEach((button) => button.addEventListener("click", () => openSocialAvatarDetails(button.dataset.avatarDetailId, button.dataset.avatarDetailKind)));
  $("notificationDetailsContent").querySelectorAll("[data-world-id]").forEach((button) => button.addEventListener("click", () => selectSocialWorld(button.dataset.worldId)));
  $("notificationDetailsContent").querySelectorAll("[data-friend-note]").forEach((field) => field.addEventListener("change", () => saveFriendNote(field.dataset.friendNote || "", field.value)));
  bindPlayerHistoryTriggers($("notificationDetailsContent"));
}
function renderMessagePopup() {
  const popup = $("messagePopup");
  if (!popup) return;
  const item = state.messagePopupItem;
  if (!item || state.activePage === "messages" || (state.inlineMessageUserIds || []).length) {
    popup.hidden = true;
    return;
  }
  const friend = findSocialFriend(item.senderUserId, item.senderUsername) || {};
  const image = messageConversationImage({ imageUrl: item.senderImageUrl || item.imageUrl || "" }, friend);
  const presence = friendPresence(friend);
  $("messagePopupOpenBtn").innerHTML = `<span class="message-avatar">${image ? `<img src="${escapeAttr(image)}" alt="">` : ""}${presenceDotHtml(presence)}</span><span><strong>${escapeHtml(item.senderUsername || friend.displayName || item.senderUserId || "VRChat")}</strong><small>${escapeHtml(notificationDetail(item) || notificationTitle(item))}</small></span>`;
  popup.hidden = false;
}
function openMessagePopupConversation() {
  const item = state.messagePopupItem;
  if (!item) return;
  const userId = item.senderUserId || item.senderUsername || "";
  state.selectedMessageUserId = userId;
  state.messagePopupItem = null;
  openInlineMessagePanel(userId, item.senderUsername || userId);
  renderMessagePopup();
}
function dismissMessagePopup() {
  if (state.messagePopupItem?.id) state.dismissedMessagePopupId = state.messagePopupItem.id;
  state.messagePopupItem = null;
  renderMessagePopup();
}
function notificationFriendDetailsHtml(friend, notification) {
  const html = friendDetailsHtml(friend);
  if (!isFriendRequestNotification(notification)) return html;
  const buttons = `<button type="button" data-social-action="acceptFriendRequest" data-notification-id="${escapeAttr(notification.id)}" data-user-id="${escapeAttr(friend.id)}" class="primary">Accept Request</button><button type="button" data-social-action="declineNotification" data-notification-id="${escapeAttr(notification.id)}" data-user-id="${escapeAttr(friend.id)}" class="danger">Decline Request</button>`;
  return html.replace('<div class="social-detail-actions">', `<div class="social-detail-actions">${buttons}`);
}
function isFriendRequestNotification(notification) {
  const type = String(notification?.type || "").toLowerCase();
  const id = String(notification?.id || "").toLowerCase();
  return Boolean(type === "friendrequest" || type === "friend-request" || id.startsWith("frq_"));
}
function closeNotificationDetails() {
  $("notificationDetailsPanel").hidden = true;
  $("notificationDetailsContent").classList.remove("friend-detail-host");
  $("notificationDetailsContent").innerHTML = "";
}
function renderVrchatSocial() {
  renderWorldDiscoveryFilter();
  const friends = $("friendsList");
  const worlds = $("worldResults");
  const details = $("socialDetailsPanel");
  const worldDetails = $("worldDetailsPanel");
  if (!state.vrchat?.isLoggedIn) {
    const html = `<div class="settings-empty"><h4>Log in to VRChat</h4><p>Friends, worlds, and location need VRChat login.</p></div>`;
    details.classList.remove("friend-detail-host");
    friends.innerHTML = html;
    worlds.innerHTML = html;
    details.innerHTML = html;
    worldDetails.innerHTML = html;
    return;
  }
  if (state.social.busy && !state.social.loaded) {
    details.classList.remove("friend-detail-host");
    friends.innerHTML = worlds.innerHTML = details.innerHTML = worldDetails.innerHTML = `<div class="settings-empty"><h4>Loading VRChat data</h4></div>`;
    return;
  }
  friends.innerHTML = state.social.friends.length
    ? friendsSectionHtml(state.social.friends)
    : `<div class="settings-empty"><h4>No friends found</h4><p>Refresh to load your VRChat friends.</p></div>`;
  const hasWorldSearch = Boolean($("worldSearchInput").value.trim());
  const selectedWorldGroup = worldSidebarGroupsModel().find((group) => group.key === state.social.selectedWorldGroup);
  worlds.innerHTML = selectedWorldGroup
    ? favoriteWorldGroupContentsHtml(selectedWorldGroup)
    : hasWorldSearch && state.social.worlds.length
    ? searchWorldsSectionHtml(state.social.worlds, state.social.favoriteWorlds)
    : worldDiscoverySectionsHtml(state.social.worldSections, state.social.favoriteWorlds) || (state.social.worlds.length ? searchWorldsSectionHtml(state.social.worlds, state.social.favoriteWorlds) : `<div class="settings-empty"><h4>No worlds found</h4><p>Search for a world or refresh popular worlds.</p></div>`);
  const showingFriendDetail = state.social.selectedType === "friend" || state.social.selectedType === "profile";
  details.classList.toggle("friend-detail-host", showingFriendDetail);
  details.innerHTML = state.social.selectedType === "friend" ? socialDetailsHtml() : `<div class="settings-empty"><h4>Select a friend</h4><p>Click a friend to view status, groups, location, and actions.</p></div>`;
  if (state.social.selectedType === "profile") details.innerHTML = socialDetailsHtml();
  worldDetails.innerHTML = state.social.selectedType === "world" ? socialDetailsHtml() : `<div class="settings-empty"><h4>Select a world</h4><p>Click a world to view details and join options.</p></div>`;
  details.querySelectorAll("[data-social-action]").forEach((button) => button.addEventListener("click", handleSocialAction));
  bindWorldDetailsPanelEvents(worldDetails, state.social.selectedType === "world" ? state.social.selectedItem : null);
  details.querySelectorAll("[data-world-id]").forEach((button) => button.addEventListener("click", () => selectSocialWorld(button.dataset.worldId)));
  details.querySelectorAll("[data-friend-id]").forEach((button) => button.addEventListener("click", () => selectSocialFriend(button.dataset.friendId, { clickedPresence: button.dataset.presence })));
  details.querySelectorAll("[data-avatar-detail-id], [data-avatar-detail-kind]").forEach((button) => button.addEventListener("click", () => openSocialAvatarDetails(button.dataset.avatarDetailId, button.dataset.avatarDetailKind)));
  bindPlayerHistoryTriggers(details);
  bindImageFallbacks(details);
  hydrateInlineAvatarAuthors(details);
  details.querySelectorAll("[data-friend-tab]").forEach((button) => button.addEventListener("click", () => {
    state.social.friendTab = button.dataset.friendTab || "info";
    renderVrchatSocial();
    void loadSelectedFriendTabData(state.social.friendTab);
  }));
  void loadSelectedFriendTabData(state.social.friendTab);
  details.querySelectorAll("[data-friend-note]").forEach((field) => field.addEventListener("change", () => saveFriendNote(field.dataset.friendNote || "", field.value)));
  if (state.activePage === "friends" || state.activePage === "worlds") renderGroups();
}
function bindImageFallbacks(container = document) {
  container.querySelectorAll("img[data-image-fallbacks]").forEach((img) => {
    if (img.dataset.fallbackBound) return;
    img.dataset.fallbackBound = "1";
    img.addEventListener("error", () => {
      let fallbacks = [];
      try { fallbacks = JSON.parse(img.dataset.imageFallbacks || "[]"); } catch { fallbacks = []; }
      const current = img.currentSrc || img.src || "";
      const next = fallbacks.find((url) => url && url !== current && url !== img.src);
      if (next) {
        img.dataset.imageFallbacks = JSON.stringify(fallbacks.filter((url) => url !== next));
        img.src = next;
        return;
      }
      img.hidden = true;
    });
  });
}
function bindWorldDetailsPanelEvents(container, world) {
  container.querySelectorAll("[data-social-action]").forEach((button) => button.addEventListener("click", handleSocialAction));
  container.querySelectorAll("button[data-world-instance-filter]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const key = button.dataset.worldInstanceFilter;
      if (key === "enabled") state.worldInstanceFilter.enabled = !state.worldInstanceFilter.enabled;
      if (key === "hideLocked") state.worldInstanceFilter.hideLocked = !state.worldInstanceFilter.hideLocked;
      if (key === "hideFull") state.worldInstanceFilter.hideFull = !state.worldInstanceFilter.hideFull;
      saveLocalJson("vrcneph.worldInstanceFilter", state.worldInstanceFilter);
      renderWorldInstancesSection(container, world);
    });
  });
  container.querySelectorAll("input[data-world-instance-filter='minPlayers']").forEach((input) => {
    const update = () => {
      state.worldInstanceFilter.minPlayers = Math.max(0, Number(input.value.replace(/[^\d]/g, "")) || 0);
      saveLocalJson("vrcneph.worldInstanceFilter", state.worldInstanceFilter);
    };
    input.addEventListener("input", update);
    input.addEventListener("change", () => {
      update();
      renderWorldInstancesSection(container, world);
    });
  });
}
function renderWorldInstancesSection(container, world) {
  if (!container || !world) return;
  const section = container.querySelector(".world-instances-section");
  if (!section) return;
  const filter = state.worldInstanceFilter || {};
  section.querySelectorAll("button[data-world-instance-filter]").forEach((button) => {
    const key = button.dataset.worldInstanceFilter;
    const active = key === "enabled" ? Boolean(filter.enabled) : key === "hideLocked" ? Boolean(filter.hideLocked) : key === "hideFull" ? Boolean(filter.hideFull) : false;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const minPlayersInput = section.querySelector("input[data-world-instance-filter='minPlayers']");
  if (minPlayersInput && document.activeElement !== minPlayersInput) minPlayersInput.value = String(Math.max(0, Number(filter.minPlayers) || 0));
  const results = section.querySelector(".world-instance-results");
  if (results) results.innerHTML = worldInstanceListHtml(world, Array.isArray(world.instances) ? world.instances : []);
}
function saveFriendNote(userId, value) {
  if (!userId) return;
  state.friendNotes[userId] = String(value || "").trim();
  if (!state.friendNotes[userId]) delete state.friendNotes[userId];
  saveLocalJson("vrcneph.friendNotes", state.friendNotes);
  addSocialActivity({ type: "friend-note", title: "Friend note saved", detail: userId, userId, source: "Local" });
}
function friendsSectionHtml(items) {
  items = (items || []).map((friend) => applyFriendPresenceAuthority(friend));
  const online = items.filter((friend) => friendPresence(friend) === "online");
  const active = items.filter((friend) => friendPresence(friend) === "active");
  const offline = items.filter((friend) => friendPresence(friend) === "offline");
  return `${online.length ? `<div class="social-list-section"><h4>Online</h4>${online.map(friendHtml).join("")}</div>` : ""}${active.length ? `<div class="social-list-section"><h4>Active</h4>${active.map(friendHtml).join("")}</div>` : ""}${offline.length ? `<div class="social-list-section"><h4>Offline</h4>${offline.map(friendHtml).join("")}</div>` : ""}`;
}
function friendsSidebarHtml(friends = [], favoriteFriends = []) {
  const tab = state.social.sidebarTab === "favorites" ? "favorites" : "friends";
  const tabs = `<div class="social-sidebar-tabs">
    <button class="${tab === "friends" ? "active" : ""}" data-social-sidebar-tab="friends" type="button">Friends</button>
    <button class="${tab === "favorites" ? "active" : ""}" data-social-sidebar-tab="favorites" type="button">Favorites</button>
  </div>`;
  if (tab === "favorites") {
    const favoritesHtml = favoriteFriendsSectionHtml(favoriteFriends);
    return `${tabs}${favoritesHtml || `<div class="group-empty">No favorite friends loaded.</div>`}`;
  }
  return `${tabs}${friends?.length ? friendsSectionHtml(friends) : `<div class="group-empty">No friends loaded.</div>`}`;
}
function favoriteFriendsSectionHtml(favorites = []) {
  if (!favorites.length) return "";
  const grouped = new Map();
  for (const friend of favorites) {
    const tags = splitCsv(friend.favoriteTags);
    const groups = tags.length ? tags : ["Favorite Friends"];
    for (const tag of groups) {
      const label = favoriteGroupLabel(tag, "Favorite Friends");
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label).push(friend);
    }
  }
  return [...grouped.entries()].map(([label, friends]) => `<div class="social-list-section favorite-social-group"><h4>${escapeHtml(label)}</h4>${friends.map(friendHtml).join("")}</div>`).join("");
}
function worldDiscoveryDefinitions() {
  return [
    { key: "popular", title: "Most Popular", payload: { sort: "popularity", order: "descending" } },
    { key: "trending", title: "Trending", payload: { sort: "heat", order: "descending" } },
    { key: "active", title: "Active Worlds", payload: { mode: "active", sort: "heat", order: "descending" } },
    { key: "updated", title: "Recently Updated", payload: { sort: "updated", order: "descending" } },
    { key: "published", title: "Recently Published", payload: { sort: "publicationDate", order: "descending" } },
    { key: "labs", title: "Community Labs", payload: { sort: "labsPublicationDate", order: "descending", releaseStatus: "all" } },
    { key: "random", title: "Random", payload: { sort: "random", order: "descending" } }
  ];
}
async function loadWorldDiscoverySections() {
  const definitions = worldDiscoveryDefinitions();
  const results = await Promise.all(definitions.map(async (section) => {
    try {
      const result = await api("vrchatWorldSearch", { ...section.payload, limit: 12, offset: 0 }, 45000);
      return { ...section, worlds: result.worlds || [] };
    } catch {
      return { ...section, worlds: [] };
    }
  }));
  return results.filter((section) => section.worlds.length);
}
function worldsSectionHtml(favorites, searchResults) {
  const favoriteIds = new Set((favorites || []).map((world) => String(world.id || "").toLowerCase()).filter(Boolean));
  const searchOnly = (searchResults || []).filter((world) => !favoriteIds.has(String(world.id || "").toLowerCase()));
  return `${favorites?.length ? `<div class="social-list-section"><h4>Favorite Worlds</h4>${favorites.map((world) => worldHtml(world, true)).join("")}</div>` : ""}${searchOnly.length ? `<div class="social-list-section"><h4>Search Results</h4>${searchOnly.map(worldHtml).join("")}</div>` : ""}`;
}
function searchWorldsSectionHtml(searchResults, favorites = []) {
  const favoriteIds = new Set((favorites || []).map((world) => String(world.id || "").toLowerCase()).filter(Boolean));
  return `<div class="social-list-section"><h4>Search Results</h4>${(searchResults || []).map((world) => worldHtml(world, favoriteIds.has(String(world.id || "").toLowerCase()))).join("")}</div>`;
}
function worldDiscoverySectionsHtml(sections = [], favorites = []) {
  if (!sections.length) return "";
  const filter = $("worldDiscoveryFilterSelect")?.value || "all";
  const visibleSections = filter === "all" ? sections : sections.filter((section) => section.key === filter);
  if (!visibleSections.length) return `<div class="settings-empty"><h4>No worlds loaded</h4><p>This section did not return any worlds.</p></div>`;
  const favoriteIds = new Set((favorites || []).map((world) => String(world.id || "").toLowerCase()).filter(Boolean));
  return visibleSections.map((section) => `<div class="social-list-section world-discovery-section"><h4>${escapeHtml(section.title)}</h4><div class="world-section-row">${(section.worlds || []).map((world) => worldHtml(world, favoriteIds.has(String(world.id || "").toLowerCase()))).join("")}</div></div>`).join("");
}
function favoriteWorldGroupsModel(favorites = [], favoriteGroups = []) {
  const grouped = new Map();
  const groupOrder = [];
  const groupLabels = new Map();
  for (let index = 1; index <= 4; index++) {
    const key = `worlds${index}`;
    groupOrder.push(key);
    groupLabels.set(key, `Worlds ${index}`);
    grouped.set(key, []);
  }
  for (const group of favoriteGroups || []) {
    const name = String(group.name || "").trim();
    if (!name) continue;
    groupOrder.push(name);
    groupLabels.set(name.toLowerCase(), group.displayName || favoriteGroupLabel(name, "Favorite Worlds"));
    grouped.set(name, []);
  }
  for (const world of favorites) {
    const tags = splitCsv(world.favoriteTags);
    const groups = tags.length ? tags : ["Favorite Worlds"];
    for (const tag of groups) {
      if (!grouped.has(tag)) {
        grouped.set(tag, []);
        groupOrder.push(tag);
      }
      grouped.get(tag).push(world);
    }
  }
  const orderedKeys = [...new Set([...groupOrder, ...grouped.keys()])];
  return orderedKeys.map((key) => ({
    key,
    label: groupLabels.get(String(key).toLowerCase()) || favoriteGroupLabel(key, "Favorite Worlds"),
    worlds: grouped.get(key) || [],
    type: "synced"
  }));
}
function loadWorldLocalGroups() {
  try {
    const data = JSON.parse(localStorage.getItem("vrcneph.worldGroups") || "[]");
    state.worldLocalGroups = Array.isArray(data) ? data : [];
  } catch {
    state.worldLocalGroups = [];
  }
}
function saveWorldLocalGroups() {
  localStorage.setItem("vrcneph.worldGroups", JSON.stringify(state.worldLocalGroups || []));
}
function uniqueWorldGroupName(name, excludeKey = "") {
  const base = (name || "New World Group").trim() || "New World Group";
  const used = new Set((state.worldLocalGroups || []).filter((group) => group.key !== excludeKey).map((group) => String(group.label || "").toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let index = 2;
  while (used.has(`${base} ${index}`.toLowerCase())) index++;
  return `${base} ${index}`;
}
function addLocalWorldGroup() {
  const name = window.prompt("New world group name", "New World Group");
  if (name === null) return;
  const label = uniqueWorldGroupName(name);
  state.worldLocalGroups.push({ key: `local_world_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`, label, worlds: [] });
  saveWorldLocalGroups();
  renderSocialSidebar();
}
function editLocalWorldGroup(key) {
  const group = state.worldLocalGroups.find((item) => item.key === key);
  if (!group) return;
  const name = window.prompt("World group name", group.label || "World Group");
  if (name === null) return;
  group.label = uniqueWorldGroupName(name, key);
  saveWorldLocalGroups();
  renderVrchatSocial();
}
function reorderLocalWorldGroup(key, direction) {
  const groups = state.worldLocalGroups || [];
  const index = groups.findIndex((item) => item.key === key);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= groups.length) return;
  [groups[index], groups[next]] = [groups[next], groups[index]];
  saveWorldLocalGroups();
  renderSocialSidebar();
}
async function deleteLocalWorldGroup(key) {
  const group = state.worldLocalGroups.find((item) => item.key === key);
  if (!group) return;
  if (!await confirmAction({ title: "Delete World Group", message: `Delete "${group.label}"?`, confirmLabel: "Delete", confirmClass: "danger" })) return;
  state.worldLocalGroups = state.worldLocalGroups.filter((item) => item.key !== key);
  if (state.social.selectedWorldGroup === key) state.social.selectedWorldGroup = "";
  saveWorldLocalGroups();
  renderVrchatSocial();
}
function worldSidebarGroupsModel() {
  const synced = favoriteWorldGroupsModel(state.social.favoriteWorlds, state.social.favoriteWorldGroups);
  const locals = (state.worldLocalGroups || []).map((group) => ({ ...group, worlds: group.worlds || [], type: "local" }));
  const updated = state.worldUpdatedWorlds?.length ? [{ key: "updated_worlds", label: "Updated Worlds", worlds: state.worldUpdatedWorlds, type: "updated" }] : [];
  const recent = [{ key: "recent_worlds", label: "Recent Worlds", worlds: state.worldRecentWorlds || [], type: "recent" }];
  const deleted = [{ key: "deleted_worlds", label: "Deleted Worlds", worlds: state.worldDeletedWorlds || [], type: "deleted" }];
  return [...synced, ...updated, ...locals, ...recent, ...deleted];
}
function favoriteWorldGroupSidebarHtml() {
  const groups = worldSidebarGroupsModel();
  const discover = `<button type="button" class="world-group-item ${state.social.selectedWorldGroup ? "" : "active"}" data-world-group=""><span>Discover Worlds</span><small>All</small></button>`;
  return `${discover}${groups.map((group) => `<button type="button" class="world-group-item ${state.social.selectedWorldGroup === group.key ? "active" : ""} ${escapeAttr(group.type)}" data-world-group="${escapeAttr(group.key)}"><span>${worldGroupIconHtml(group)}${escapeHtml(group.label)}</span><small>${group.worlds.length}</small></button>`).join("")}`;
}
function worldGroupIconHtml(group) {
  if (group.type === "synced") return syncIconHtml("Synced from VRChat");
  if (group.type === "updated") return updatedIconHtml("Updated worlds");
  if (group.type === "recent") return recentIconHtml("Recent worlds");
  if (group.type === "deleted") return trashIconHtml("Deleted worlds");
  return "";
}
function syncIconHtml(title = "Synced") {
  return `<span class="sync-icon" title="${escapeAttr(title)}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 0-15.5-6.2L3 8"></path><path d="M3 3v5h5"></path><path d="M3 12a9 9 0 0 0 15.5 6.2L21 16"></path><path d="M16 16h5v5"></path></svg></span>`;
}
function trashIconHtml(title = "Deleted") {
  return `<span class="trash-icon" title="${escapeAttr(title)}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 15h10l1-15"></path><path d="M10 10v7"></path><path d="M14 10v7"></path></svg></span>`;
}
function recentIconHtml(title = "Recent") {
  return `<span class="recent-icon" title="${escapeAttr(title)}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path><path d="M12 7v5l3 2"></path></svg></span>`;
}
function updatedIconHtml(title = "Updated") {
  return `<span class="updated-icon" title="${escapeAttr(title)}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v6"></path><path d="M9 6l3-3 3 3"></path><path d="M5 12a7 7 0 1 0 14 0"></path></svg></span>`;
}
function uploadedIconHtml(title = "Uploaded") {
  return `<span class="uploaded-icon" title="${escapeAttr(title)}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 16V4"></path><path d="M7 9l5-5 5 5"></path><path d="M5 20h14"></path></svg></span>`;
}
function favoriteWorldGroupContentsHtml(group) {
  const worlds = group?.worlds || [];
  return `<div class="social-list-section favorite-world-group-results"><h4>${escapeHtml(group?.label || "Favorite Worlds")}</h4>${worlds.length ? `<div class="world-section-row">${worlds.map((world) => worldHtml(world, true)).join("")}</div>` : `<div class="settings-empty"><h4>No worlds in this group</h4><p>This favorite world group is empty.</p></div>`}</div>`;
}
function favoriteWorldsSectionHtml(favorites = [], favoriteGroups = []) {
  const groups = favoriteWorldGroupsModel(favorites, favoriteGroups);
  return groups.map(favoriteWorldGroupContentsHtml).join("");
}
function favoriteGroupLabel(tag = "", fallback = "Favorites") {
  return String(tag || fallback)
    .replace(/^worlds?(\d+)$/i, `Worlds $1`)
    .replace(/^friends?\d*$/i, fallback)
    .replace(/^favorite_?/i, "")
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || fallback;
}
function mergeFriendLists(primary = [], favorites = []) {
  const byId = new Map();
  for (const friend of [...favorites, ...primary]) {
    const id = String(friend?.id || "").toLowerCase();
    if (!id) continue;
    const existing = byId.get(id) || {};
    const merged = { ...existing, ...friend, favoriteTags: friend.favoriteTags || existing.favoriteTags || "" };
    byId.set(id, merged);
  }
  return [...byId.values()].map((friend) => applyFriendPresenceAuthority(friend));
}
function mergeWorldLists(a = [], b = []) {
  const seen = new Set();
  const merged = [];
  for (const world of [...a, ...b]) {
    const id = String(world?.id || "").toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(world);
  }
  return merged;
}
function allLoadedWorlds() {
  const sectionWorlds = (state.social.worldSections || []).flatMap((section) => section.worlds || []);
  return mergeWorldLists(mergeWorldLists(state.social.favoriteWorlds, state.social.worlds), sectionWorlds);
}
function currentLocationHtml(location) {
  if (!location) return `<div class="settings-empty"><h4>No location loaded</h4><p>Refresh to check your current VRChat location.</p></div>`;
  const world = location.world;
  const title = world?.name || location.worldId || location.location || "Private or offline";
  const detail = world ? `${world.authorName || "Unknown author"} - ${Number(world.occupants || 0)} users` : (location.location || "No public world details available.");
  return `<button type="button" class="social-card" ${world?.id ? `data-world-id="${escapeAttr(world.id)}"` : ""}>${world?.imageUrl ? `<img src="${escapeAttr(world.imageUrl)}" alt="">` : ""}<div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span><small>${escapeHtml(location.instanceId || location.location || "")}</small></div></button>`;
}
function currentLocationLabel(location) {
  if (!location) return "";
  return location.world?.name || location.worldId || location.location || "";
}
function profileLocationHtml(location) {
  const label = currentLocationLabel(location);
  if (!label) return `<div class="profile-location-card"><span>Current Location</span><strong>Unknown</strong></div>`;
  const detail = location.world?.authorName || location.instanceId || location.location || "";
  return `<button type="button" class="profile-location-card" ${location.world?.id ? `data-world-id="${escapeAttr(location.world.id)}"` : ""}><span>Current Location</span><strong>${escapeHtml(label)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</button>`;
}
function presenceDotHtml(presence) {
  return `<span class="presence-dot ${escapeAttr(presence)}" aria-hidden="true"></span>`;
}
function presenceBadgeHtml(presence, label = presenceLabel(presence)) {
  return `<span class="presence-badge ${escapeAttr(presence)}">${presenceDotHtml(presence)}${escapeHtml(label)}</span>`;
}
function userStatusClass(status, presence = "") {
  if (presence === "offline") return "offline";
  const value = String(status || "").toLowerCase().replace(/\s+/g, "");
  if (value === "joinme") return "joinme";
  if (value === "askme") return "askme";
  if (value === "busy" || value === "donotdisturb") return "busy";
  if (value === "active" || value === "online") return "active";
  return presence === "online" ? "active" : presence || "offline";
}
function userStatusLabel(status, presence = "") {
  if (presence === "offline") return "Offline";
  const value = String(status || "").trim();
  if (value) return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return presenceLabel(presence);
}
function userStatusDotHtml(status, presence = "", limited = false) {
  const statusClass = userStatusClass(status, presence);
  const limitedClass = (limited || presence === "active") && statusClass !== "offline" ? " limited" : "";
  return `<span class="presence-dot ${escapeAttr(statusClass)}${limitedClass}" aria-hidden="true"></span>`;
}
function userStatusBadgeHtml(status, presence = "", limited = false) {
  const statusClass = userStatusClass(status, presence);
  return `<span class="presence-badge ${escapeAttr(statusClass)}">${userStatusDotHtml(status, presence, limited)}${escapeHtml(userStatusLabel(status, presence))}</span>`;
}
function friendStatusLimited(friend, presence = friendPresence(friend)) {
  if (presence === "offline") return false;
  const location = String(friend?.location || "").toLowerCase();
  const worldId = String(friend?.worldId || "").trim();
  return !worldId || location === "private" || location === "hidden" || location === "offline";
}
function friendHtml(friend) {
  friend = applyFriendPresenceAuthority(friend);
  const presence = friendPresence(friend);
  const available = presence !== "offline";
  const rawLocation = String(friend.location || "").toLowerCase();
  const location = available ? (rawLocation === "offline" ? presenceLabel(presence) : (friend.worldId || friend.location || presenceLabel(presence))) : "Offline";
  const image = friendProfileImage(friend) || friend.imageUrl || "";
  const rankClass = trustClassName(trustRankLabel(splitCsv(friend.tags).map((tag) => tag.toLowerCase()))) || "visitor";
  const statusLine = available && friend.statusDescription ? `<span>${escapeHtml(friend.statusDescription)}</span>` : "";
  const selected = state.social.selectedType === "friend" && state.social.selectedItem?.id === friend.id;
  return `<button type="button" class="social-card friend-card ${escapeAttr(presence)} ${selected ? "selected" : ""}" data-friend-id="${escapeAttr(friend.id)}" data-presence="${escapeAttr(presence)}">${image ? `<img src="${escapeAttr(image)}" alt="">` : ""}<div><strong class="friend-card-title">${userStatusDotHtml(friend.status, presence, friendStatusLimited(friend, presence))}<span class="friend-name-rank ${escapeAttr(rankClass)}">${escapeHtml(friend.displayName || friend.id)}</span></strong>${statusLine}<small>${escapeHtml(location)}</small></div></button>`;
}
function friendProfileImage(friend) {
  return friendProfileImageCandidates(friend)[0] || "";
}
function friendProfileImageCandidates(friend = {}) {
  return uniqueStrings([
    friend?.profilePicOverrideThumbnail,
    friend?.profilePicOverride,
    friend?.userIcon,
    friend?.profilePicture,
    friend?.profileImageUrl,
    rawFriendProfileImage(friend)
  ].map(normalizeVrchatImageUrl).filter(Boolean));
}
function rawFriendProfileImage(friend = {}) {
  const raw = String(friend?.rawJson || "").trim();
  if (!raw) return "";
  try {
    const data = JSON.parse(raw);
    return findFirstDeepString(data, [
      "profilePicOverrideThumbnail",
      "profilePicOverride",
      "userIcon",
      "profilePicture",
      "profileImageUrl",
      "iconUrl",
      "imageUrl"
    ], { skipKeys: new Set(["currentAvatar", "currentAvatarImageUrl", "currentAvatarThumbnailImageUrl"]) });
  } catch {
    const match = raw.match(/"(profilePicOverrideThumbnail|profilePicOverride|userIcon|profilePicture|profileImageUrl)"\s*:\s*"([^"]+)"/i);
    return match?.[2] || "";
  }
}
function findFirstDeepString(value, keys = [], { skipKeys = new Set(), depth = 0 } = {}) {
  if (!value || typeof value !== "object" || depth > 4) return "";
  for (const key of keys) {
    const found = value[key];
    if (typeof found === "string" && found.trim()) return found;
  }
  for (const [key, child] of Object.entries(value)) {
    if (skipKeys.has(key)) continue;
    if (typeof child === "string") continue;
    const found = findFirstDeepString(child, keys, { skipKeys, depth: depth + 1 });
    if (found) return found;
  }
  return "";
}
function friendHeaderImage(friend = {}) {
  const profileCandidates = friendProfileImageCandidates(friend);
  const profileImage = profileCandidates[0] || "";
  const avatar = friend.currentAvatar || {};
  const avatarImage = avatar.thumbnailImageUrl || avatar.imageUrl || friend.currentAvatarThumbnailImageUrl || friend.currentAvatarImageUrl || friend.imageUrl || "";
  const candidates = uniqueStrings([...profileCandidates, normalizeVrchatImageUrl(avatarImage)].filter(Boolean));
  return { image: candidates[0] || "", candidates, hasProfileImage: Boolean(profileImage) };
}
function normalizeVrchatImageUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text) || text.startsWith("data:")) return text;
  const file = text.match(/file_[0-9a-f-]+/i);
  if (!file) return text;
  const version = text.match(/file_[0-9a-f-]+\/(\d+)/i)?.[1] || "1";
  return `https://api.vrchat.cloud/api/1/image/${file[0]}/${version}/256`;
}
function uniqueStrings(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
}
function friendPresence(friend) {
  return normalizeFriendPresence(friend);
}
function normalizePresenceValue(value = "") {
  const text = String(value || "").trim().toLowerCase();
  return text === "online" || text === "active" || text === "offline" ? text : "";
}
function friendDetailCacheKey(id = "") {
  return String(id || "").trim().toLowerCase();
}
function getCachedFriendDetail(id = "") {
  const item = state.friendDetailCache.get(friendDetailCacheKey(id)) || null;
  if (!item) return null;
  if (Date.now() - Number(item.cachedAt || 0) > FRIEND_DETAIL_CACHE_MAX_AGE_MS) {
    state.friendDetailCache.delete(friendDetailCacheKey(id));
    persistFriendDetailCacheSoon();
    return null;
  }
  return item;
}
function cacheFriendDetail(friend = {}) {
  const key = friendDetailCacheKey(friend.id);
  if (!key) return;
  state.friendDetailCache.set(key, sanitizeFriendDetailForCache({ ...friend, cachedAt: Date.now() }));
  persistFriendDetailCacheSoon();
}
function rememberFriendPresence(friend = {}, source = "") {
  const id = friendDetailCacheKey(friend?.id);
  if (!id) return;
  const presence = friendPresence(friend);
  const authoritativeOffline = currentOfflineIsAuthoritative(friend) || source === "pipeline-offline";
  if (presence === "offline" && !authoritativeOffline) return;
  const existing = state.friendPresenceById[id] || null;
  if (presence === "offline" && existing?.presence !== "offline" && !authoritativeOffline) return;
  state.friendPresenceById[id] = {
    presence,
    isOnline: presence !== "offline",
    location: presence === "offline" ? "offline" : String(friend.location || ""),
    worldId: presence === "offline" ? "" : String(friend.worldId || ""),
    state: String(friend.state || ""),
    status: String(friend.status || ""),
    statusDescription: String(friend.statusDescription || ""),
    presenceSource: source || friend.presenceSource || "",
    updatedAt: Date.now()
  };
}
function rememberFriendPresences(friends = [], source = "") {
  for (const friend of friends || []) rememberFriendPresence(friend, source || friend?.presenceSource || "");
}
function applyFriendPresenceAuthority(friend = null) {
  if (!friend?.id) return friend;
  const key = friendDetailCacheKey(friend.id);
  const authority = state.friendPresenceById[key];
  if (!authority) return friend;
  const detailHasWorld = Boolean(friend.worldId) || String(friend.location || "").trim().toLowerCase().startsWith("wrld_");
  if (authority.presence === "offline") {
    return {
      ...friend,
      presence: "offline",
      isOnline: false,
      location: "offline",
      worldId: "",
      presenceSource: authority.presenceSource || friend.presenceSource || ""
    };
  }
  return {
    ...friend,
    presence: authority.presence,
    isOnline: true,
    location: detailHasWorld ? friend.location : authority.location || friend.location || "",
    worldId: detailHasWorld ? friend.worldId : authority.worldId || friend.worldId || "",
    state: friend.state || authority.state || "",
    status: friend.status || authority.status || "",
    statusDescription: friend.statusDescription || authority.statusDescription || "",
    presenceSource: authority.presenceSource || friend.presenceSource || ""
  };
}
function sanitizeFriendDetailForCache(friend = {}) {
  const copy = { ...friend, cachedAt: Number(friend.cachedAt || Date.now()) };
  delete copy.rawJson;
  delete copy.uploadedAvatars;
  delete copy.uploadedAvatarsLoading;
  delete copy.uploadedAvatarsError;
  delete copy.uploadedWorlds;
  delete copy.uploadedWorldsLoading;
  delete copy.uploadedWorldsError;
  delete copy.mutualFriends;
  delete copy.mutualFriendsLoading;
  delete copy.mutualFriendsError;
  if (copy.currentAvatar && typeof copy.currentAvatar === "object") {
    copy.currentAvatar = { ...copy.currentAvatar };
    delete copy.currentAvatar.rawJson;
  }
  return copy;
}
function persistFriendDetailCacheSoon() {
  clearTimeout(state.friendDetailCacheSaveTimer);
  state.friendDetailCacheSaveTimer = setTimeout(persistFriendDetailCache, 350);
}
function persistFriendDetailCache() {
  const items = [...state.friendDetailCache.values()]
    .sort((a, b) => Number(b.cachedAt || 0) - Number(a.cachedAt || 0))
    .slice(0, FRIEND_DETAIL_CACHE_LIMIT)
    .map(sanitizeFriendDetailForCache);
  state.friendDetailCache = new Map(items.map((item) => [friendDetailCacheKey(item.id), item]));
  saveLocalJson(FRIEND_DETAIL_CACHE_KEY, items);
}
function mergeFriendCurrentWithCache(currentFriend = null, cachedFriend = null) {
  const merged = { ...(currentFriend || {}), ...(cachedFriend || {}) };
  if (!currentFriend) return merged;
  for (const key of ["displayName", "status", "statusDescription", "presence", "presenceSource", "location", "worldId", "isOnline", "imageUrl", "profileImageUrl", "profilePicOverride", "profilePicOverrideThumbnail", "userIcon", "tags", "favoriteTags"]) {
    if (currentFriend[key] !== undefined && currentFriend[key] !== null && currentFriend[key] !== "") merged[key] = currentFriend[key];
  }
  const currentPresence = friendPresence(currentFriend);
  const cachedPresence = friendPresence(cachedFriend || {});
  if (currentPresence !== "offline" || currentOfflineIsAuthoritative(currentFriend) || cachedPresence === "offline") {
    merged.presence = currentPresence;
    merged.isOnline = currentPresence !== "offline";
    if (currentPresence === "offline") {
      merged.location = "offline";
      merged.worldId = "";
    }
  }
  return applyFriendPresenceAuthority(merged);
}
function currentOfflineIsAuthoritative(friend = {}) {
  if (friendPresence(friend) !== "offline") return false;
  const source = String(friend?.presenceSource || "").toLowerCase();
  return source === "friend-list-offline" || source === "pipeline-offline";
}
function firstNonOfflinePresence(...values) {
  for (const value of values) {
    const presence = normalizePresenceValue(value);
    if (presence && presence !== "offline") return presence;
  }
  return "";
}
function friendWithPresence(friend = {}, presenceValue = "") {
  const presence = normalizePresenceValue(presenceValue) || friendPresence(friend);
  return {
    ...friend,
    presence,
    isOnline: presence !== "offline",
    location: presence === "offline" ? "offline" : (String(friend.location || "").toLowerCase() === "offline" ? "" : friend.location || ""),
    worldId: presence === "offline" ? "" : friend.worldId || ""
  };
}
function normalizeFriendPresence(friend = {}, eventType = "") {
  const event = String(eventType || "").toLowerCase();
  if (event === "friend-offline") return "offline";
  const location = String(friend?.location || "").trim().toLowerCase();
  const worldId = String(friend?.worldId || "").trim();
  const stateValue = String(friend?.state || "").trim().toLowerCase();
  const presence = String(friend?.presence || "").trim().toLowerCase();
  const hasVisibleLocation = Boolean(worldId) || location.startsWith("wrld_");
  if (presence === "offline") return "offline";
  if (stateValue === "online" || presence === "online") return "online";
  if (presence === "active") return "active";
  if (hasVisibleLocation) return "active";
  if (event === "friend-online") return "active";
  if (friend?.isOnline || stateValue === "active") return "active";
  if (location === "offline") return "offline";
  return "offline";
}
function presenceLabel(presence) {
  return presence === "online" ? "Online" : presence === "active" ? "Active" : "Offline";
}
function worldHtml(world, favorite = false) {
  return `<button type="button" class="social-card world-card ${favorite ? "favorite" : ""}" data-world-id="${escapeAttr(world.id || "")}">${world.imageUrl ? `<img src="${escapeAttr(world.imageUrl)}" alt="">` : ""}<div><strong>${escapeHtml(world.name || world.id)}</strong><span>${escapeHtml(world.authorName || (favorite ? "Favorite world" : "Unknown author"))}</span><small>${favorite ? "Favorite - " : ""}${Number(world.occupants || 0)} users - ${Number(world.favorites || 0)} favorites</small></div></button>`;
}
function avatarIdLooksValid(id) {
  return /^avtr_[0-9a-f-]+$/i.test(String(id || "").trim());
}
function imageMatchKey(url) {
  const text = String(url || "").toLowerCase();
  const file = text.match(/file_[0-9a-f-]+/i);
  if (file) return file[0].toLowerCase();
  return text.split("?")[0].replace(/\/(thumbnail|file)\/?$/i, "");
}
function findKnownAvatarForFriend(detail = {}, existing = {}) {
  const keys = [
    detail.currentAvatarThumbnailImageUrl,
    detail.currentAvatarImageUrl,
    existing.currentAvatarThumbnailImageUrl,
    existing.currentAvatarImageUrl
  ].map(imageMatchKey).filter(Boolean);
  if (!keys.length) return null;
  return state.library.avatars.find((avatar) => {
    const avatarKeys = [avatar.thumbnailImageUrl, avatar.imageUrl].map(imageMatchKey).filter(Boolean);
    return avatarKeys.some((key) => keys.includes(key));
  }) || null;
}
async function resolveKnownAvatarForFriend(detail = {}, existing = {}) {
  const local = findKnownAvatarForFriend(detail, existing);
  if (local) return local;
  const imageUrl = detail.currentAvatarThumbnailImageUrl || detail.currentAvatarImageUrl || existing.currentAvatarThumbnailImageUrl || existing.currentAvatarImageUrl || "";
  if (!imageUrl) return null;
  try {
    const resolved = await api("avatarDatabaseResolveImage", {
      imageUrl,
      name: detail.currentAvatarName || existing.currentAvatarName || "",
      userId: detail.id || existing.id || "",
      displayName: detail.displayName || existing.displayName || ""
    }, 45000);
    return resolved && (resolved.avatarId || resolved.id || resolved.imageUrl || resolved.thumbnailImageUrl) ? resolved : null;
  } catch {
    return null;
  }
}
async function loadSocialFriendDetails(id, options = {}) {
  if (!id) return;
  const token = options.token || ++state.social.selectToken;
  try {
    const [detail, groups] = await Promise.all([
      api("vrchatFriendDetail", { id }, 45000),
      api("vrchatFriendGroups", { id }, 45000).catch(() => ({ groups: [] }))
    ]);
    if (token !== state.social.selectToken) return;
    const clickedPresence = normalizePresenceValue(options.clickedPresence);
    const existingBase = findListedFriendById(id) || {};
    const existing = clickedPresence ? { ...existingBase, presence: clickedPresence, isOnline: clickedPresence !== "offline" } : existingBase;
    const rawAvatarId = detail.currentAvatarId || detail.currentAvatar || existing.currentAvatarId || "";
    const liveCurrentAvatar = await api("vrchatUserCurrentAvatar", { id }, 45000).catch(() => null);
    const resolvedKnownAvatar = await resolveKnownAvatarForFriend(detail, existing);
    const knownAvatar = avatarAuthorNeedsResolution(liveCurrentAvatar || {}) ? mergeBetterAvatarDetails(liveCurrentAvatar || {}, resolvedKnownAvatar || {}) : (liveCurrentAvatar || resolvedKnownAvatar);
    if (token !== state.social.selectToken) return;
    const currentAvatarId = avatarPublicId(knownAvatar) || (avatarIdLooksValid(rawAvatarId) ? rawAvatarId : "");
    let currentAvatar = avatarAuthorNeedsResolution(knownAvatar || {}) && currentAvatarId
      ? mergeBetterAvatarDetails(knownAvatar || {}, await api("fetchAvatar", { id: currentAvatarId }, 45000).catch(() => null) || {})
      : (knownAvatar || (currentAvatarId ? await api("fetchAvatar", { id: currentAvatarId }, 45000).catch(() => null) : null));
    currentAvatar = await resolveAvatarAuthorFromDatabase({
      ...(currentAvatar || {}),
      name: currentAvatar?.name || detail.currentAvatarName || existing.currentAvatarName || "",
      thumbnailImageUrl: currentAvatar?.thumbnailImageUrl || detail.currentAvatarThumbnailImageUrl || existing.currentAvatarThumbnailImageUrl || "",
      imageUrl: currentAvatar?.imageUrl || detail.currentAvatarImageUrl || existing.currentAvatarImageUrl || "",
      authorId: currentAvatar?.authorId || "",
      authorName: currentAvatar?.authorName || ""
    });
    const resolvedCurrentAvatarId = avatarPublicId(currentAvatar) || currentAvatarId;
    if (token !== state.social.selectToken) return;
    const previousSelected = state.social.selectedType === "friend" && state.social.selectedItem?.id === id ? state.social.selectedItem : {};
    const latestListed = findListedFriendById(id) || existingBase;
    const latestListedPresence = friendPresence(latestListed);
    const existingPresence = friendPresence(existing);
    const detailLocation = String(detail.location || "").trim().toLowerCase();
    const detailHasWorld = Boolean(detail.worldId) || detailLocation.startsWith("wrld_");
    const detailPresence = normalizeFriendPresence(detail);
    const authoritativeOffline = !detailHasWorld && (clickedPresence === "offline" || currentOfflineIsAuthoritative(latestListed));
    const preservedOnlinePresence = firstNonOfflinePresence(clickedPresence, latestListedPresence, existingPresence, friendPresence(previousSelected));
    const nextPresence = authoritativeOffline
      ? "offline"
      : detailHasWorld
        ? normalizeFriendPresence({ ...detail, presenceSource: "detail-location" })
        : preservedOnlinePresence
          ? preservedOnlinePresence
          : detailPresence;
    let selectedFriend = {
      ...previousSelected,
      ...detail,
      isOnline: nextPresence !== "offline",
      presence: nextPresence,
      presenceSource: detailHasWorld ? "detail-location" : latestListed.presenceSource || existing.presenceSource || detail.presenceSource || "",
      location: nextPresence === "offline" ? "offline" : detailHasWorld ? detail.location : latestListed.location || existing.location || detail.location || "",
      worldId: nextPresence === "offline" ? "" : detailHasWorld ? (detail.worldId || worldIdFromLocation(detail.location)) : latestListed.worldId || existing.worldId || detail.worldId || "",
      currentAvatarId: resolvedCurrentAvatarId,
      currentAvatar,
      currentAvatarName: currentAvatar?.name || detail.currentAvatarName || (avatarIdLooksValid(rawAvatarId) ? "" : rawAvatarId) || knownAvatar?.name || "",
      currentAvatarImageUrl: currentAvatar?.imageUrl || knownAvatar?.imageUrl || detail.currentAvatarImageUrl || existing.currentAvatarImageUrl || "",
      currentAvatarThumbnailImageUrl: currentAvatar?.thumbnailImageUrl || currentAvatar?.imageUrl || knownAvatar?.thumbnailImageUrl || knownAvatar?.imageUrl || detail.currentAvatarThumbnailImageUrl || existing.currentAvatarThumbnailImageUrl || "",
      groups: groups.groups || [],
      encounters: (await api("vrchatEncounterHistory", { userId: id, displayName: detail.displayName || existing.displayName || "" }, 30000).catch(() => ({ items: [] }))).items || []
    };
    selectedFriend = applyFriendPresenceAuthority(selectedFriend);
    rememberFriendPresence(selectedFriend, selectedFriend.presenceSource || "detail-merged");
    recordPlayerName(id, selectedFriend.displayName || existing.displayName || "", new Date().toISOString(), "VRChat user");
    cacheFriendDetail(selectedFriend);
    state.social.friends = state.social.friends.map((friend) => String(friend.id || "").toLowerCase() === String(id || "").toLowerCase() ? { ...friend, ...selectedFriend } : friend);
    state.social.favoriteFriends = state.social.favoriteFriends.map((friend) => String(friend.id || "").toLowerCase() === String(id || "").toLowerCase() ? { ...friend, ...selectedFriend } : friend);
    return selectedFriend;
  } catch (e) {
    toast(e.message);
    return null;
  }
}
async function loadSelectedFriendTabData(tab = state.social.friendTab || "info") {
  const selected = state.social.selectedItem;
  const type = state.social.selectedType;
  if (!selected || (type !== "friend" && type !== "profile")) return;
  const id = type === "profile" ? "me" : selected.id;
  if (!id) return;
  const key = tab === "mutual" ? "mutualFriends" : tab === "avatars" ? "uploadedAvatars" : tab === "worlds" ? "uploadedWorlds" : "";
  if (!key || selected[key] || selected[`${key}Loading`]) return;
  const token = state.social.selectToken;
  state.social.selectedItem = { ...selected, [`${key}Loading`]: true, [`${key}Error`]: "" };
  renderVrchatSocial();
  try {
    const result = tab === "mutual"
      ? await api("vrchatMutualFriends", { id }, 45000)
      : tab === "avatars"
        ? await api("vrchatUserUploadedAvatars", { id }, 45000)
        : await api("vrchatUserWorlds", { id }, 45000);
    if (type !== state.social.selectedType || (type === "friend" && state.social.selectedItem?.id !== selected.id) || token !== state.social.selectToken) return;
    const rawValue = tab === "mutual" ? result.friends || [] : tab === "avatars" ? result.avatars || [] : result.worlds || [];
    const value = tab === "avatars" && type === "friend"
      ? rawValue.filter((avatar) => friendOwnsAvatar(selected, avatar))
      : tab === "worlds" && type === "friend"
        ? rawValue.filter((world) => friendOwnsWorld(selected, world))
        : rawValue;
    state.social.selectedItem = { ...state.social.selectedItem, [key]: value, [`${key}Loading`]: false, [`${key}Error`]: "" };
    if (type === "friend") {
      state.social.friends = state.social.friends.map((friend) => friend.id === selected.id ? { ...friend, [key]: value, [`${key}Loading`]: false, [`${key}Error`]: "" } : friend);
    }
  } catch (e) {
    if (type !== state.social.selectedType || (type === "friend" && state.social.selectedItem?.id !== selected.id) || token !== state.social.selectToken) return;
    state.social.selectedItem = { ...state.social.selectedItem, [`${key}Loading`]: false, [`${key}Error`]: e.message || "Could not load this tab." };
  }
  renderVrchatSocial();
}
function friendOwnsAvatar(friend, avatar) {
  const friendId = String(friend?.id || "").toLowerCase();
  const friendName = String(friend?.displayName || "").trim().toLowerCase();
  const authorId = String(avatar?.authorId || "").toLowerCase();
  const authorName = String(avatar?.authorName || "").trim().toLowerCase();
  return Boolean((friendId && authorId === friendId) || (friendName && authorName && authorName === friendName));
}
function friendOwnsWorld(friend, world) {
  const friendName = String(friend?.displayName || "").trim().toLowerCase();
  const authorName = String(world?.authorName || "").trim().toLowerCase();
  return Boolean(friendName && authorName && authorName === friendName);
}
async function selectSocialFriend(id, options = {}) {
  if (!id) return;
  const token = ++state.social.selectToken;
  const currentFriend = findListedFriendById(id);
  const clickedPresence = normalizePresenceValue(options.clickedPresence);
  const cachedFriend = getCachedFriendDetail(id);
  if (clickedPresence && currentFriend) rememberFriendPresence(friendWithPresence(currentFriend, clickedPresence), "click");
  const selectedPresence = clickedPresence || friendPresence(mergeFriendCurrentWithCache(currentFriend, cachedFriend));
  const selectedBase = mergeFriendCurrentWithCache(currentFriend, cachedFriend);
  state.social.friendTab = "info";
  state.social.selectedType = "friend";
  state.social.selectedItem = Object.keys(selectedBase).length ? friendWithPresence(selectedBase, selectedPresence) : null;
  renderVrchatSocial();
  pushAppHistory();
  queueSocialFriendDetailsLoad(id, { clickedPresence: selectedPresence, token });
}
function queueSocialFriendDetailsLoad(id, options = {}) {
  clearTimeout(state.friendDetailLoadTimer);
  const cached = getCachedFriendDetail(id);
  if (cached && Date.now() - Number(cached.cachedAt || 0) < FRIEND_DETAIL_REFRESH_MS && friendHeaderImage(cached).hasProfileImage) return;
  state.friendDetailLoadTimer = setTimeout(async () => {
    const previousHeaderImage = friendHeaderImage(state.social.selectedItem || {}).image;
    const selectedFriend = await loadSocialFriendDetails(id, options);
    if (!selectedFriend || state.social.selectedType !== "friend" || state.social.selectedItem?.id !== id || options.token !== state.social.selectToken) return;
    state.social.selectedItem = selectedFriend;
    const nextHeaderImage = friendHeaderImage(selectedFriend).image;
    if (shouldRenderFriendDetailRefresh(state.social.friendTab) || previousHeaderImage !== nextHeaderImage) renderVrchatSocial();
  }, 275);
}
function shouldRenderFriendDetailRefresh(tab = state.social.friendTab || "info") {
  return tab !== "info";
}
async function selectSocialWorld(id) {
  if (!id) return;
  const token = ++state.social.selectToken;
  state.social.selectedType = "world";
  state.social.selectedItem = allLoadedWorlds().find((item) => item.id === id) || state.social.location?.world || null;
  renderVrchatSocial();
  try {
    const [world, history] = await Promise.all([
      api("vrchatWorldDetail", { id }, 45000),
      api("vrchatWorldVisitHistory", { worldId: id }, 30000).catch(() => ({ items: [] }))
    ]);
    state.social.selectedItem = { ...world, visitHistory: history.items || [] };
    if (token !== state.social.selectToken) return;
    state.social.selectedType = "world";
    rememberRecentWorld(state.social.selectedItem);
    addSocialActivity({ type: "world-view", title: `Viewed world: ${state.social.selectedItem.name || id}`, detail: state.social.selectedItem.authorName || id, worldId: id, source: "Worlds" });
    renderVrchatSocial();
    pushAppHistory();
  } catch (e) {
    toast(e.message);
  }
}
function rememberRecentWorld(world) {
  if (!world?.id) return;
  state.worldRecentWorlds = [world, ...(state.worldRecentWorlds || []).filter((item) => item.id !== world.id)].slice(0, 50);
}
function selectFavoriteWorldGroup(key) {
  state.social.selectedWorldGroup = key || "";
  $("worldSearchInput").value = "";
  renderWorldDiscoveryFilter();
  renderVrchatSocial();
  pushAppHistory();
}
async function openHomeWorld() {
  if (!state.vrchat?.isLoggedIn || state.social.selectedType === "world") return;
  if (!state.social.worldsLoaded) await loadVrchatSocial({ worldsOnly: true });
  const homeWorldId = state.vrchat.user?.homeWorldId || "";
  if (homeWorldId) {
    await selectSocialWorld(homeWorldId);
    return;
  }
  state.social.selectedType = "";
  state.social.selectedItem = null;
  renderVrchatSocial();
  setSocialHeaderStatus("worlds", "Home world was not exposed by VRChat.");
}
function socialDetailsHtml() {
  const item = state.social.selectedItem;
  if (!item) return `<div class="settings-empty"><h4>Select a friend or world</h4><p>Click an item to view details.</p></div>`;
  if (state.social.selectedType === "profile") return myProfileDetailsHtml(item);
  return state.social.selectedType === "friend" ? friendDetailsHtml(item) : worldDetailsHtml(item);
}
async function openSocialAvatarDetails(avatarId, kind = "") {
  const id = String(avatarId || "").trim();
  const selectedAvatar = state.social.selectedItem?.currentAvatar;
  if (!id && kind === "current") {
    const selected = state.social.selectedItem || {};
    const selectedAvatarId = avatarPublicId(selectedAvatar);
    const liveCurrentAvatar = selected.id ? await api("vrchatUserCurrentAvatar", { id: selected.id }, 45000).catch(() => null) : null;
    const knownAvatar = await resolveKnownAvatarForFriend(selected, selected);
    const resolved = selectedAvatarId
      ? (avatarAuthorNeedsResolution(selectedAvatar || {}) ? mergeBetterAvatarDetails(selectedAvatar, knownAvatar || {}) : selectedAvatar)
      : (avatarAuthorNeedsResolution(liveCurrentAvatar || {}) ? mergeBetterAvatarDetails(liveCurrentAvatar || {}, knownAvatar || {}) : (liveCurrentAvatar || knownAvatar));
    if (resolved && (resolved.avatarId || resolved.id)) {
      const enriched = await resolveAvatarAuthorFromDatabase(resolved);
      openAvatarDialog({ ...enriched, avatarId: avatarPublicId(enriched), id: enriched.id || avatarPublicId(enriched), groupId: state.activeGroupId });
      return;
    }
    const fallback = resolved || {
      avatarId: selected.currentAvatarId || "",
      name: selected.currentAvatarName || "Current Avatar",
      imageUrl: selected.currentAvatarImageUrl || selected.currentAvatarThumbnailImageUrl || "",
      thumbnailImageUrl: selected.currentAvatarThumbnailImageUrl || selected.currentAvatarImageUrl || "",
      description: "VRChat did not expose this avatar's ID, so full metadata could not be fetched.",
      sourceUrl: selected.currentAvatarImageUrl || selected.currentAvatarThumbnailImageUrl || "",
      rawJson: selected.rawJson || "",
      source: "vrchat"
    };
    openAvatarDialog({ ...fallback, groupId: state.activeGroupId });
    return;
  }
  if (!id) return;
  if (selectedAvatar && avatarPublicId(selectedAvatar) === id) {
    const resolved = await resolveAvatarAuthorFromDatabase(selectedAvatar);
    openAvatarDialog({ ...resolved, avatarId: avatarPublicId(resolved), id: resolved.id || avatarPublicId(resolved), groupId: state.activeGroupId });
    return;
  }
  try {
    const avatar = await api("fetchAvatar", { id }, 45000);
    openAvatarDialog({ ...avatar, groupId: state.activeGroupId });
  } catch (e) {
    toast(e.message);
  }
}
async function openMyProfile({ ensurePage = true } = {}) {
  if (!state.vrchat?.isLoggedIn || !state.vrchat.user) return;
  if (ensurePage && state.activePage !== "friends") {
    showPage("friends");
    return;
  }
  if (!state.social.friendsLoaded) await loadVrchatSocial();
  const user = state.vrchat.user;
  state.social.friendTab = "info";
  state.social.selectedType = "profile";
  state.social.selectedItem = { ...user, groups: [], currentAvatar: state.currentAvatarSummary };
  renderVrchatSocial();
  try {
    const [groups, avatar] = await Promise.all([
      api("vrchatFriendGroups", { id: user.id }, 45000).catch(() => ({ groups: [] })),
      api("vrchatCurrentAvatar", { groupId: state.activeGroupId }, 45000).catch(() => null)
    ]);
    state.social.selectedType = "profile";
    state.social.selectedItem = {
      ...state.vrchat.user,
      groups: groups.groups || [],
      currentAvatar: avatar || state.currentAvatarSummary || null
    };
    renderVrchatSocial();
  } catch (e) {
    toast(e.message);
  }
}
function myProfileDetailsHtml(profile) {
  const avatar = profile.currentAvatar || {};
  const groups = Array.isArray(profile.groups) ? profile.groups : [];
  const location = currentLocationLabel(state.social.location) || profile.worldId || profile.location || "Private location";
  const statusText = [profile.status, profile.statusDescription].filter(Boolean).join(" - ") || "Unknown";
  const image = avatar.thumbnailImageUrl || avatar.imageUrl || profile.currentAvatarThumbnailImageUrl || profile.currentAvatarImageUrl || "";
  const tagChips = friendTagsHtml(profile);
  const hero = `<div class="friend-profile-header">
    <div class="friend-profile-avatar">${image ? `<img src="${escapeAttr(image)}" alt="">` : ""}</div>
    <div class="friend-profile-main">
      <div class="friend-profile-title"><h4>${escapeHtml(profile.displayName || profile.id)}</h4>${presenceBadgeHtml("online", "My Profile")}</div>
      ${tagChips}
      ${profile.statusDescription ? `<p class="friend-status-line">${escapeHtml(profile.statusDescription)}</p>` : ""}
    </div>
    <div class="profile-location-compact">${profileLocationHtml(state.social.location)}</div>
  </div>`;
  const tabs = profileDetailTabsHtml();
  const profileAvatarId = avatarPublicId(avatar) || (avatarIdLooksValid(profile.currentAvatarId) ? profile.currentAvatarId : "");
  const profileAvatarName = avatar.name || profile.currentAvatarId || "Current Avatar";
  const avatarSection = `<section class="social-detail-section"><h5>Current Avatar</h5>${friendAvatarInfoButton(profileAvatarName, profileAvatarId, image)}<dl>${detailRow("Author", displayAvatarAuthorName(avatar))}${detailRow("Status", avatar.releaseStatus)}${detailRow("Platforms", avatar.platforms)}</dl></section>`;
  const overview = `<section class="social-detail-section"><h5>Overview</h5><dl>${detailRow("Status", statusText)}${detailRow("Location", location)}${detailRow("User ID", profile.id)}${detailRow("Joined", profile.dateJoined)}${detailRow("Last login", profile.lastLogin)}</dl></section>`;
  const groupSection = `<section class="social-detail-section group-scroll-section"><h5>Groups</h5>${groups.length ? `<div class="social-group-list scroll-contained">${groups.map(socialGroupHtml).join("")}</div>` : `<p class="social-muted">No public groups found.</p>`}</section>`;
  const worldsSection = profileWorldsTabHtml(profile);
  const favoriteWorldsSection = profileFavoriteWorldsTabHtml();
  const avatarTab = profileAvatarsTabHtml(profile);
  const activity = `<section class="social-detail-section"><h5>Activity</h5><div class="friend-metric-grid"><span><strong>${escapeHtml(profile.lastLogin || "-")}</strong>Last Seen</span><span><strong>${escapeHtml(profile.dateJoined || "-")}</strong>Date Joined</span><span><strong>${escapeHtml(statusText || "-")}</strong>Status</span><span><strong>${escapeHtml(profile.developerType || "-")}</strong>Developer Type</span></div></section>`;
  const more = `<section class="social-detail-section"><h5>More</h5><dl>${detailRow("Developer type", profile.developerType)}${detailRow("Tags", profile.tags)}</dl></section>`;
  const tab = state.social.friendTab || "info";
  const tabContent = tab === "groups"
    ? groupSection
    : tab === "worlds"
      ? worldsSection
      : tab === "favoriteWorlds"
        ? favoriteWorldsSection
        : tab === "avatars"
          ? avatarTab
          : tab === "activity"
            ? activity
            : tab === "json"
              ? (profile.rawJson ? `<details class="friend-json-tab" open><summary>Raw JSON</summary><pre>${escapeHtml(profile.rawJson)}</pre></details>` : emptyFriendTab("JSON", "No raw JSON is available for your profile."))
              : `${overview}${avatarSection}${groupSection}${more}`;
  const tabLayoutClass = tab === "groups" ? " group-tab-active" : tab === "info" ? " info-tab-active" : "";
  return `<div class="social-detail friend-detail${tabLayoutClass}">${hero}${tabs}<div class="friend-tab-content${tabLayoutClass}">${tabContent}</div></div>`;
}
function friendDetailsHtml(friend) {
  friend = applyFriendPresenceAuthority(friend);
  const presence = friendPresence(friend);
  const available = presence !== "offline";
  const location = available ? (friend.worldId || friend.location || "Private location") : "Offline";
  const currentInstance = state.social.location?.location || "";
  const groups = Array.isArray(friend.groups) ? friend.groups : [];
  const liveAvatar = friend.currentAvatar || {};
  const avatarId = avatarPublicId(liveAvatar) || (avatarIdLooksValid(friend.currentAvatarId) ? friend.currentAvatarId : "");
  const avatarImage = liveAvatar.thumbnailImageUrl || liveAvatar.imageUrl || friend.currentAvatarThumbnailImageUrl || friend.currentAvatarImageUrl || friend.imageUrl || "";
  const header = friendHeaderImage(friend);
  const avatarName = liveAvatar.name || friend.currentAvatarName || (avatarId ? avatarId : avatarImage ? "Current Avatar" : "Unknown Avatar");
  const representedGroup = friend.representedGroupName || friend.representedGroupId
    ? `<section class="social-detail-section represented-group-section"><h5>Represented Group</h5><div class="social-group-item">${friend.representedGroupImageUrl ? `<img src="${escapeAttr(friend.representedGroupImageUrl)}" alt="">` : ""}<div><strong>${escapeHtml(friend.representedGroupName || friend.representedGroupId)}</strong><span>${escapeHtml([friend.representedGroupShortCode ? `#${friend.representedGroupShortCode}` : "", friend.representedGroupMemberCount ? `${friend.representedGroupMemberCount} members` : ""].filter(Boolean).join(" - "))}</span></div></div></section>`
    : "";
  const bioLinks = splitCsv(friend.bioLinks);
  const tagChips = friendTagsHtml(friend);
  const isFriend = friend.isFriend !== false;
  const isBlocked = friend.isBlocked === true;
  const actionButtons = [
    `<button type="button" data-social-action="messageUser" data-user-id="${escapeAttr(friend.id)}">Message</button>`,
    `<button type="button" data-social-action="invite" data-user-id="${escapeAttr(friend.id)}">Invite</button>`,
    `<button type="button" data-social-action="requestInvite" data-user-id="${escapeAttr(friend.id)}">Request Invite</button>`,
    !isFriend && !isBlocked ? `<button type="button" data-social-action="friend" data-user-id="${escapeAttr(friend.id)}">Friend</button>` : "",
    isFriend ? `<button type="button" data-social-action="unfriend" data-user-id="${escapeAttr(friend.id)}" class="danger">Unfriend</button>` : "",
    !isBlocked ? `<button type="button" data-social-action="block" data-user-id="${escapeAttr(friend.id)}" class="danger">Block</button>` : "",
    isBlocked ? `<button type="button" data-social-action="unblock" data-user-id="${escapeAttr(friend.id)}">Unblock</button>` : ""
  ].filter(Boolean).join("");
  const actions = `<div class="social-detail-actions">${actionButtons}</div>`;
  const headerImageAttrs = header.image
    ? `src="${escapeAttr(header.image)}" data-image-fallbacks="${escapeAttr(JSON.stringify(header.candidates || []))}" title="${escapeAttr(header.image)}"`
    : "";
  const hero = `<div class="friend-profile-header">
    <div class="friend-profile-avatar ${header.hasProfileImage ? "profile-picture" : ""}">${header.image ? `<img ${headerImageAttrs} alt="">` : ""}</div>
    <div class="friend-profile-main">
      <div class="friend-profile-title"><h4>${escapeHtml(friend.displayName || friend.id)}</h4>${userStatusBadgeHtml(friend.status, presence, friendStatusLimited(friend, presence))}</div>
      ${tagChips}
      ${friend.statusDescription ? `<p class="friend-status-line">${escapeHtml(friend.statusDescription)}</p>` : ""}
    </div>
  </div>`;
  const tabs = friendDetailTabsHtml();
  const overviewStatus = presence === "offline" ? "Offline" : [friend.status, friend.statusDescription].filter(Boolean).join(" - ") || presenceLabel(presence);
  const overview = `<section class="social-detail-section friend-info-section"><h5>${escapeHtml(presenceLabel(presence))}</h5><dl>${detailRow("Status", overviewStatus)}${detailRow("Location", location)}${detailRow("World ID", friend.worldId)}${detailRow("State", presence === "offline" ? "offline" : friend.state)}${detailRow("Last platform", friend.lastPlatform)}${detailRow("User ID", friend.id)}</dl></section>`;
  const avatarBlock = `<section class="social-detail-section"><h5>Avatar Info</h5><dl>${detailRow("Name", avatarName)}${detailRow("Avatar ID", avatarId)}${detailRow("Author", displayAvatarAuthorName(liveAvatar))}${detailRow("Status", liveAvatar.releaseStatus)}${detailRow("Platforms", liveAvatar.platforms)}${detailRow("Avatar Cloning", readableBool(friend.allowAvatarCopying))}</dl></section>`;
  const bioBlock = `<section class="social-detail-section"><h5>Bio</h5>${friend.bio ? `<p class="friend-bio">${escapeHtml(friend.bio)}</p>` : `<p class="social-muted">No bio available.</p>`}${bioLinks.length ? `<div class="friend-link-list">${bioLinks.map((link) => `<span>${escapeHtml(link)}</span>`).join("")}</div>` : ""}</section>`;
  const groupsBlock = `<section class="social-detail-section group-scroll-section"><h5>Groups</h5>${groups.length ? `<div class="social-group-list scroll-contained">${groups.map(socialGroupHtml).join("")}</div>` : `<p class="social-muted">No public groups found.</p>`}</section>`;
  const activity = `<section class="social-detail-section"><h5>Activity</h5><div class="friend-metric-grid"><span><strong>${escapeHtml(friend.lastLogin || "-")}</strong>Last Seen</span><span><strong>${escapeHtml(friend.dateJoined || "-")}</strong>Date Joined</span><span><strong>${escapeHtml(readableBool(friend.allowAvatarCopying) || "-")}</strong>Avatar Cloning</span><span><strong>${escapeHtml(friend.ageVerificationStatus || "-")}</strong>Age Verification</span></div></section>`;
  const more = `<section class="social-detail-section"><h5>More</h5><dl>${detailRow("Pronouns", friend.pronouns)}${detailRow("Developer type", friend.developerType)}${detailRow("Tags", friend.tags)}</dl></section>`;
  const tabContent = friendTabContentHtml(friend, {
    overview,
    avatarBlock,
    representedGroup,
    bioBlock,
    groupsBlock,
    activity,
    more,
    location,
    avatarName,
    avatarId,
    avatarImage,
    liveAvatar,
    groups
  });
  const activeTab = state.social.friendTab || "info";
  const tabLayoutClass = activeTab === "groups" ? " group-tab-active" : activeTab === "info" ? " info-tab-active" : activeTab === "mutual" ? " mutual-tab-active" : "";
  return `<div class="social-detail friend-detail${tabLayoutClass}">${hero}${actions}${tabs}<div class="friend-tab-content${tabLayoutClass}">${tabContent}</div></div>`;
}
function friendDetailTabsHtml() {
  const active = state.social.friendTab || "info";
  const tabs = [
    ["info", "Info"],
    ["mutual", "Mutual Friends"],
    ["groups", "Groups"],
    ["worlds", "Worlds"],
    ["favoriteWorlds", "Favorite Worlds"],
    ["avatars", "Avatars"],
    ["activity", "Activity"],
    ["json", "JSON"]
  ];
  return `<div class="social-detail-tabs">${tabs.map(([id, label]) => `<button type="button" data-friend-tab="${escapeAttr(id)}" class="${active === id ? "active" : ""}">${escapeHtml(label)}</button>`).join("")}</div>`;
}
function profileDetailTabsHtml() {
  const active = state.social.friendTab || "info";
  const tabs = [
    ["info", "Info"],
    ["groups", "Groups"],
    ["worlds", "Worlds"],
    ["favoriteWorlds", "Favorite Worlds"],
    ["avatars", "Avatars"],
    ["activity", "Activity"],
    ["json", "JSON"]
  ];
  return `<div class="social-detail-tabs">${tabs.map(([id, label]) => `<button type="button" data-friend-tab="${escapeAttr(id)}" class="${active === id ? "active" : ""}">${escapeHtml(label)}</button>`).join("")}</div>`;
}
function friendTabContentHtml(friend, parts) {
  const tab = state.social.friendTab || "info";
  if (tab === "mutual") return friendMutualTabHtml(friend);
  if (tab === "groups") return parts.groupsBlock;
  if (tab === "worlds") return friendWorldsTabHtml(friend, parts.location);
  if (tab === "favoriteWorlds") return emptyFriendTab("Favorite Worlds", "Favorite world lists are not public through the current VRChat response.");
  if (tab === "avatars") return friendAvatarsTabHtml(friend);
  if (tab === "activity") return friendActivityTabHtml(friend, parts);
  if (tab === "json") return friend.rawJson ? `<details class="friend-json-tab" open><summary>Raw JSON</summary><pre>${escapeHtml(friend.rawJson)}</pre></details>` : emptyFriendTab("JSON", "No raw JSON is available for this friend.");
  return friendInfoTabHtml(friend, parts);
}
function friendInfoTabHtml(friend, parts) {
  const currentPresence = friendPresence(friend);
  const status = currentPresence === "offline" ? "Offline" : [friend.status, friend.statusDescription].filter(Boolean).join(" - ") || presenceLabel(currentPresence);
  const represented = friend.representedGroupName || friend.representedGroupId
    ? `<div class="friend-info-represented">${friend.representedGroupImageUrl ? `<img src="${escapeAttr(friend.representedGroupImageUrl)}" alt="">` : ""}<div><strong>${escapeHtml(friend.representedGroupName || friend.representedGroupId)}</strong><span>${escapeHtml([friend.representedGroupShortCode ? `#${friend.representedGroupShortCode}` : "", friend.representedGroupMemberCount ? `${friend.representedGroupMemberCount} members` : ""].filter(Boolean).join(" - "))}</span></div></div>`
    : `<span class="friend-info-empty">-</span>`;
  const bioLinks = splitCsv(friend.bioLinks);
  const note = state.friendNotes[friend.id] || "";
  const nameHistory = playerNameHistoryHtml(friend, { limit: 4 });
  const encounters = playerMetHistoryHtml(friend, { limit: 5 });
  const joinCount = playerEncounterItems(friend.id, friend.displayName, friend.encounters || []).filter((item) => String(item.action || "").toLowerCase().includes("join")).length;
  return `<div class="friend-info-vrcx">
    <h4>${escapeHtml(presenceLabel(currentPresence))}</h4>
    <div class="friend-info-divider"></div>
    <div class="friend-info-stack">
      <section><h5>Note</h5><textarea class="friend-note-input" data-friend-note="${escapeAttr(friend.id)}" placeholder="Click to add a note">${escapeHtml(note)}</textarea></section>
      <section><h5>Memo</h5><p class="friend-info-empty">-</p></section>
      <section><h5>Avatar Info</h5>${friendAvatarInfoButton(parts.avatarName, parts.avatarId, parts.avatarImage, displayAvatarAuthorName(parts.liveAvatar), parts.liveAvatar)}</section>
      <section><h5>Represented Group</h5>${represented}</section>
      <section><h5>Username History</h5>${nameHistory}</section>
      <section><h5>Met History</h5>${encounters}</section>
      <section class="friend-info-bio"><h5>Bio</h5>${friend.bio ? `<p>${escapeHtml(friend.bio)}</p>` : `<p class="friend-info-empty">No bio available.</p>`}${bioLinks.length ? `<div class="friend-link-list">${bioLinks.map((link) => `<span>${escapeHtml(link)}</span>`).join("")}</div>` : ""}</section>
    </div>
    <div class="friend-info-metrics">
      ${friendInfoMetric("Status", status)}
      ${friendInfoMetric("Location", parts.location)}
      ${friendInfoMetric("Last Seen", friend.lastLogin || "-")}
      ${friendInfoMetric("Join Count", joinCount || "-")}
      ${friendInfoMetric("Time Together", "-")}
      ${friendInfoMetric("Date Joined", friend.dateJoined || "-")}
      ${friendInfoMetric("Friended", "-")}
      ${friendInfoMetric("Avatar Cloning", readableBool(friend.allowAvatarCopying) || "-")}
      ${friendInfoMetric("Platform", platformLabel(friend.lastPlatform) || "-")}
      ${friendInfoMetric("User ID", friend.id)}
    </div>
  </div>`;
}
function friendActivityTabHtml(friend, parts) {
  const metItems = playerEncounterItems(friend.id, friend.displayName, friend.encounters || []);
  const latestMet = metItems[0]?.timestamp || "";
  const joinCount = metItems.filter((item) => String(item.action || "").toLowerCase().includes("join")).length;
  const metSummary = `<section class="social-detail-section"><h5>Local History Summary</h5><div class="friend-metric-grid"><span><strong>${escapeHtml(joinCount || "-")}</strong>Join Count</span><span><strong>${escapeHtml(metItems.length || "-")}</strong>Logged Events</span><span><strong>${escapeHtml(latestMet ? formatDateTime(latestMet) : "-")}</strong>Last Met</span><span><strong>${escapeHtml(playerNameHistoryItems(friend.id, friend.displayName).length || "-")}</strong>Recorded Names</span></div></section>`;
  return `${parts.activity}${metSummary}<section class="social-detail-section"><h5>Username History</h5>${playerNameHistoryHtml(friend, { limit: 20 })}</section><section class="social-detail-section"><h5>Player Met History</h5>${playerMetHistoryHtml(friend, { limit: 40 })}</section>`;
}
function friendMutualTabHtml(friend) {
  if (friend.mutualFriendsLoading) return loadingFriendTab("Mutual Friends");
  if (friend.mutualFriendsError) return emptyFriendTab("Mutual Friends", friend.mutualFriendsError);
  if (!Object.prototype.hasOwnProperty.call(friend, "mutualFriends")) return loadingFriendTab("Mutual Friends");
  const mutual = Array.isArray(friend.mutualFriends) ? friend.mutualFriends : [];
  if (!mutual.length) return emptyFriendTab("Mutual Friends", "No mutual friends were returned by VRChat.");
  return `<section class="social-detail-section mutual-friends-section"><h5>Mutual Friends</h5><div class="social-list embedded-list">${mutual.map(friendHtml).join("")}</div></section>`;
}
function friendEncountersHtml(items) {
  if (!items?.length) return `<p class="friend-info-empty">No shared world history found in local VRChat logs.</p>`;
  return `<div class="encounter-list">${items.slice(0, 5).map((item) => {
    const world = item.worldName || worldIdFromLocation(item.location) || "Unknown world";
    const detail = [item.action, item.location].filter(Boolean).join(" - ");
    return `<div class="encounter-item"><strong>${escapeHtml(world)}</strong><span>${escapeHtml(formatDateTime(item.timestamp))}</span><small>${escapeHtml(detail)}</small></div>`;
  }).join("")}</div>`;
}
function friendInfoMetric(label, value) {
  return `<span><strong>${escapeHtml(label)}</strong>${escapeHtml(value || "-")}</span>`;
}
function friendAvatarInfoButton(name, avatarId, image = "", subtitle = "", avatar = {}) {
  const title = name || avatarId || "Unknown Avatar";
  const detailAttrs = avatarId ? `data-avatar-detail-id="${escapeAttr(avatarId)}"` : `data-avatar-detail-kind="current"`;
  const author = subtitle || findKnownAvatarAuthorName({ ...avatar, name, avatarId, thumbnailImageUrl: image, imageUrl: image });
  const hydrateAttrs = author ? "" : ` data-avatar-author-hydrate="1" data-avatar-name="${escapeAttr(name || "")}" data-avatar-image="${escapeAttr(image || "")}" data-avatar-id="${escapeAttr(avatarId || "")}"`;
  return `<button type="button" class="friend-avatar-inline" ${detailAttrs}${hydrateAttrs}>${image ? `<img src="${escapeAttr(image)}" alt="">` : ""}<span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(author || "Loading author...")}</small></span></button>`;
}
function friendWorldsTabHtml(friend) {
  if (friend.uploadedWorldsLoading) return loadingFriendTab("Worlds");
  if (friend.uploadedWorldsError) return emptyFriendTab("Worlds", friend.uploadedWorldsError);
  if (!Object.prototype.hasOwnProperty.call(friend, "uploadedWorlds")) return loadingFriendTab("Worlds");
  const worlds = Array.isArray(friend.uploadedWorlds) ? friend.uploadedWorlds : [];
  if (!worlds.length) return emptyFriendTab("Worlds", "No uploaded worlds were returned by VRChat.");
  return `<section class="social-detail-section"><h5>Uploaded Worlds</h5><div class="social-list embedded-list">${worlds.map(worldHtml).join("")}</div></section>`;
}
function friendAvatarsTabHtml(friend) {
  if (friend.uploadedAvatarsLoading) return loadingFriendTab("Avatars");
  if (friend.uploadedAvatarsError) return emptyFriendTab("Avatars", friend.uploadedAvatarsError);
  if (!Object.prototype.hasOwnProperty.call(friend, "uploadedAvatars")) return loadingFriendTab("Avatars");
  const avatars = Array.isArray(friend.uploadedAvatars) ? friend.uploadedAvatars : [];
  if (!avatars.length) return emptyFriendTab("Avatars", "No uploaded avatars were returned by VRChat.");
  return `<section class="social-detail-section"><h5>Uploaded Avatars</h5><div class="uploaded-avatar-list">${avatars.map(uploadedAvatarHtml).join("")}</div></section>`;
}
function profileWorldsTabHtml(profile) {
  if (profile.uploadedWorldsLoading) return loadingFriendTab("Worlds");
  if (profile.uploadedWorldsError) return emptyFriendTab("Worlds", profile.uploadedWorldsError);
  if (!Object.prototype.hasOwnProperty.call(profile, "uploadedWorlds")) return loadingFriendTab("Worlds");
  const worlds = Array.isArray(profile.uploadedWorlds) ? profile.uploadedWorlds : [];
  if (!worlds.length) return emptyFriendTab("Worlds", "No uploaded worlds were returned by VRChat.");
  return `<section class="social-detail-section"><h5>Uploaded Worlds</h5><div class="social-list embedded-list">${worlds.map(worldHtml).join("")}</div></section>`;
}
function profileFavoriteWorldsTabHtml() {
  const worlds = state.social.favoriteWorlds || [];
  if (!worlds.length) return emptyFriendTab("Favorite Worlds", "No favorite worlds are loaded.");
  return `<section class="social-detail-section"><h5>Favorite Worlds</h5><div class="social-list embedded-list">${favoriteWorldsSectionHtml(worlds, state.social.favoriteWorldGroups)}</div></section>`;
}
function profileAvatarsTabHtml(profile) {
  return friendAvatarsTabHtml(profile);
}
function uploadedAvatarHtml(avatar) {
  const id = avatarPublicId(avatar) || avatar.avatarId || avatar.id || "";
  const image = avatar.thumbnailImageUrl || avatar.imageUrl || "";
  return `<button type="button" class="friend-avatar-preview" ${id ? `data-avatar-detail-id="${escapeAttr(id)}"` : ""}>${image ? `<img src="${escapeAttr(image)}" alt="">` : ""}<div><strong>${escapeHtml(avatar.name || id || "Unknown Avatar")}</strong><span>${escapeHtml([displayAvatarAuthorName(avatar), avatar.releaseStatus, avatar.platforms].filter(Boolean).join(" - ") || id || "Avatar ID unavailable")}</span></div></button>`;
}
function loadingFriendTab(title) {
  return `<section class="social-detail-section"><h5>${escapeHtml(title)}</h5><div class="settings-empty compact"><h4>Loading...</h4></div></section>`;
}
function emptyFriendTab(title, message) {
  return `<section class="social-detail-section"><h5>${escapeHtml(title)}</h5><p class="social-muted">${escapeHtml(message)}</p></section>`;
}
function worldDetailsHtml(world) {
  const instances = Array.isArray(world.instances) ? world.instances : [];
  const firstInstance = instances.find((item) => item?.location) || null;
  const launchLocation = state.social.location?.worldId === world.id ? state.social.location.location : (firstInstance?.location || "");
  const favorite = isFavoriteWorld(world.id);
  const actions = `<div class="social-detail-actions"><button type="button" data-social-action="joinWorld" data-world-id="${escapeAttr(world.id)}" data-location="${escapeAttr(launchLocation)}" class="primary" ${launchLocation ? "" : "disabled"}>Join World</button><button type="button" data-social-action="favoriteWorld" data-world-id="${escapeAttr(world.id)}" ${favorite ? "hidden" : ""}>Favorite</button><button type="button" data-social-action="unfavoriteWorld" data-world-id="${escapeAttr(world.id)}" class="danger" ${favorite ? "" : "hidden"}>Unfavorite</button></div>`;
  const hero = `<div class="social-world-hero">${world.imageUrl ? `<img class="social-detail-image" src="${escapeAttr(world.imageUrl)}" alt="">` : ""}<div class="social-detail-heading"><h4>${escapeHtml(world.name || world.id)}</h4><span>${escapeHtml(world.releaseStatus || "World")}</span><p>${escapeHtml(world.description || "")}</p></div></div>`;
  const stats = `<div class="social-stat-grid"><span><strong>${Number(world.occupants || 0)}</strong>Users</span><span><strong>${Number(world.capacity || 0)}</strong>Capacity</span><span><strong>${Number(world.visits || 0)}</strong>Visits</span><span><strong>${Number(world.favorites || 0)}</strong>Favorites</span></div>`;
  const overview = `<section class="social-detail-section"><h5>Overview</h5><dl>${detailRow("Author", world.authorName)}${detailRow("World ID", world.id)}${detailRow("Status", world.releaseStatus)}${detailRow("Occupants", `${Number(world.occupants || 0)} total, ${Number(world.publicOccupants || 0)} public, ${Number(world.privateOccupants || 0)} private`)}${detailRow("Updated", world.updatedAt)}${detailRow("Created", world.createdAt)}</dl></section>`;
  return `<div class="social-detail world-detail">${hero}${actions}${stats}${worldInstancesHtml(world, instances)}${overview}${world.rawJson ? `<details><summary>Raw JSON</summary><pre>${escapeHtml(world.rawJson)}</pre></details>` : ""}</div>`;
}
function worldInstancesHtml(world, instances = []) {
  const filter = state.worldInstanceFilter || { enabled: false, minPlayers: 1, hideLocked: false, hideFull: false };
  const minPlayers = Math.max(0, Number(filter.minPlayers) || 0);
  const controls = `<div class="world-instance-controls"><button type="button" class="world-instance-toggle ${filter.hideLocked ? "active" : ""}" aria-pressed="${filter.hideLocked ? "true" : "false"}" data-world-instance-filter="hideLocked"><span>Hide locked</span><span class="toggle-slider" aria-hidden="true"></span></button><button type="button" class="world-instance-toggle ${filter.hideFull ? "active" : ""}" aria-pressed="${filter.hideFull ? "true" : "false"}" data-world-instance-filter="hideFull"><span>Hide full</span><span class="toggle-slider" aria-hidden="true"></span></button><button type="button" class="world-instance-toggle ${filter.enabled ? "active" : ""}" aria-pressed="${filter.enabled ? "true" : "false"}" data-world-instance-filter="enabled"><span>Hide under</span><span class="toggle-slider" aria-hidden="true"></span></button><input type="text" inputmode="numeric" pattern="[0-9]*" value="${escapeAttr(minPlayers)}" data-world-instance-filter="minPlayers"><span>players</span></div>`;
  return `<section class="social-detail-section world-instances-section"><div class="section-title-row"><h5>Servers / Instances</h5>${controls}</div><div class="world-instance-results">${worldInstanceListHtml(world, instances)}</div></section>`;
}
function worldInstanceListHtml(world, instances = []) {
  const filter = state.worldInstanceFilter || { enabled: false, minPlayers: 1, hideLocked: false, hideFull: false };
  const minPlayers = Math.max(0, Number(filter.minPlayers) || 0);
  const visible = instances.filter((item) => {
    if (filter.enabled && Number(item.occupants || 0) < minPlayers) return false;
    if (filter.hideLocked && item.isLocked) return false;
    if (filter.hideFull && Number(item.occupants || 0) >= Number(world.capacity || 0) && Number(world.capacity || 0) > 0) return false;
    return true;
  });
  return visible.length
    ? `<div class="world-instance-list">${visible.map((instance) => worldInstanceHtml(world, instance)).join("")}</div>`
    : `<div class="settings-empty compact"><h4>No visible instances</h4><p>${instances.length ? "Adjust the instance filters to show more servers." : "VRChat did not expose public instances for this world."}</p></div>`;
}
function worldInstanceHtml(world, instance) {
  const location = instance.location || `${world.id}:${instance.id}`;
  const current = String(state.social.location?.location || "").toLowerCase() === String(location || "").toLowerCase();
  const visit = latestWorldVisitForInstance(world, instance);
  const groupLabel = instance.groupName || instance.groupId || "";
  const tags = [
    instance.type || "Public",
    instance.region,
    instance.isLocked ? lockIconHtml() : "",
    instance.isAgeRestricted ? "18+" : ""
  ].filter(Boolean);
  const timer = current ? "You are here now" : visit ? `${visit.action || "Seen"} ${relativeTime(visit.timestamp) || formatDateTime(visit.timestamp)}` : "Last visit unknown";
  const count = `${Number(instance.occupants || 0)}/${Number(world.capacity || 0) || "?"}`;
  return `<div class="world-instance-row ${current ? "current" : ""}">
    <div><strong>${escapeHtml(instance.type || "Instance")} ${escapeHtml(instance.region || "")}</strong><span>${escapeHtml(groupLabel ? `Group: ${groupLabel}` : instance.id || "")}</span><small>${escapeHtml(timer)}</small></div>
    <div class="world-instance-tags">${tags.map((tag) => String(tag).startsWith("<") ? tag : `<em>${escapeHtml(tag)}</em>`).join("")}</div>
    <strong class="world-instance-count">${escapeHtml(count)}</strong>
    <button type="button" class="primary" data-social-action="joinWorld" data-world-id="${escapeAttr(world.id)}" data-location="${escapeAttr(location)}">Join</button>
  </div>`;
}
function lockIconHtml() {
  return `<em class="lock-tag" title="Locked" aria-label="Locked"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2"></path><rect x="5" y="10" width="14" height="10" rx="2"></rect></svg></em>`;
}
function latestWorldVisitForInstance(world, instance) {
  const visits = Array.isArray(world.visitHistory) ? world.visitHistory : [];
  const instanceId = String(instance?.id || "").toLowerCase();
  const location = String(instance?.location || "").toLowerCase();
  return visits.find((item) => {
    const visitLocation = String(item.location || "").toLowerCase();
    return (location && visitLocation === location) || (instanceId && visitLocation.includes(instanceId));
  }) || null;
}
function socialGroupHtml(group) {
  const label = [group.name, group.shortCode ? `#${group.shortCode}` : ""].filter(Boolean).join(" ");
  return `<div class="social-group-item">${group.imageUrl ? `<img src="${escapeAttr(group.imageUrl)}" alt="">` : ""}<div><strong>${escapeHtml(label || group.id)}</strong><span>${escapeHtml(group.description || "")}</span></div></div>`;
}
function isFavoriteWorld(worldId) {
  const id = String(worldId || "").toLowerCase();
  return Boolean(id && state.social.favoriteWorlds.some((world) => String(world.id || "").toLowerCase() === id));
}
function detailRow(label, value) {
  const text = value === 0 ? "0" : String(value || "").trim();
  if (!text) return "";
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(text)}</dd>`;
}
function splitCsv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}
function readableBool(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (text === "true") return "Allowed";
  if (text === "false") return "Not allowed";
  return value;
}
function friendTagsHtml(friend) {
  const tags = [];
  const rawTags = splitCsv(friend.tags).map((tag) => tag.toLowerCase());
  const trust = trustRankLabel(rawTags);
  const age = ageStatusLabel(friend.ageVerificationStatus);
  const platform = platformLabel(friend.lastPlatform);
  if (trust) tags.push({ label: trust, className: `trust ${trustClassName(trust)}` });
  if (age) tags.push({ label: age, className: "age" });
  if (rawTags.some((tag) => tag.includes("system_supporter") || tag.includes("supporter"))) tags.push({ label: "VRC+", className: "vrc-plus" });
  if (platform) tags.push({ label: platform, className: `platform ${platform.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` });
  if (friend.developerType && friend.developerType !== "none") tags.push({ label: friend.developerType, className: "developer" });
  return tags.length ? `<div class="friend-chip-row">${tags.map((tag) => `<span class="${escapeAttr(tag.className)}">${escapeHtml(tag.label)}</span>`).join("")}</div>` : "";
}
function trustRankLabel(tags) {
  if (tags.some((tag) => tag.includes("system_trust_legend") || tag.includes("system_trust_veteran"))) return "Trusted User";
  if (tags.some((tag) => tag.includes("system_trust_trusted"))) return "Trusted User";
  if (tags.some((tag) => tag.includes("system_trust_known"))) return "Known User";
  if (tags.some((tag) => tag.includes("system_trust_basic"))) return "User";
  if (tags.some((tag) => tag.includes("system_trust_intermediate"))) return "New User";
  if (tags.some((tag) => tag.includes("system_trust_troll"))) return "Nuisance";
  return "";
}
function trustClassName(label) {
  const value = String(label || "").toLowerCase();
  if (value.includes("trusted")) return "trusted";
  if (value.includes("known")) return "known";
  if (value === "user") return "user";
  if (value.includes("new")) return "new";
  if (value.includes("nuisance")) return "nuisance";
  return "";
}
function displayAvatarAuthorName(avatar = {}) {
  const authorName = String(avatar.authorName || "").trim();
  const authorId = String(avatar.authorId || "").trim();
  if (!authorName || /^usr_[0-9a-f-]+$/i.test(authorName) || (authorId && authorName.toLowerCase() === authorId.toLowerCase())) return "";
  return authorName;
}
function findKnownAvatarAuthorName(avatar = {}) {
  const direct = displayAvatarAuthorName(avatar);
  if (direct) return direct;
  const cached = cachedAvatarAuthorName(avatar);
  if (cached) return cached;
  const avatarId = avatarPublicId(avatar);
  const imageKey = imageMatchKey(avatar.thumbnailImageUrl || avatar.imageUrl || "");
  const name = String(avatar.name || "").trim().toLowerCase();
  const sources = [
    ...(state.library?.avatars || []),
    ...(state.avatarDatabaseResults || []),
    state.social?.selectedItem?.currentAvatar,
    state.currentAvatarSummary
  ].filter(Boolean);
  const match = sources.find((item) => {
    if (avatarId && avatarPublicId(item) === avatarId) return true;
    if (imageKey) {
      const itemKey = imageMatchKey(item.thumbnailImageUrl || item.imageUrl || "");
      if (itemKey && itemKey === imageKey) return true;
    }
    return Boolean(name && String(item.name || "").trim().toLowerCase() === name && displayAvatarAuthorName(item));
  });
  const author = match ? displayAvatarAuthorName(match) : "";
  if (author) cacheAvatarAuthorName(avatar, author);
  return author;
}
function avatarAuthorCacheKeys(avatar = {}) {
  const keys = [];
  const avatarId = avatarPublicId(avatar);
  const imageKey = imageMatchKey(avatar.thumbnailImageUrl || avatar.imageUrl || "");
  const name = String(avatar.name || "").trim().toLowerCase();
  if (avatarId) keys.push(`id:${avatarId.toLowerCase()}`);
  if (imageKey) keys.push(`image:${imageKey}`);
  if (name) keys.push(`name:${name}`);
  return keys;
}
function cachedAvatarAuthorName(avatar = {}) {
  for (const key of avatarAuthorCacheKeys(avatar)) {
    const value = state.avatarAuthorCache?.get(key);
    if (value) return value;
  }
  return "";
}
function cacheAvatarAuthorName(avatar = {}, authorName = "") {
  const author = cleanAvatarAuthorName(authorName);
  if (!author) return;
  for (const key of avatarAuthorCacheKeys(avatar)) state.avatarAuthorCache.set(key, author);
}
async function hydrateInlineAvatarAuthors(root = document) {
  const buttons = [...root.querySelectorAll("[data-avatar-author-hydrate='1']")];
  for (const button of buttons) {
    const small = button.querySelector("small");
    const known = findKnownAvatarAuthorName({
      avatarId: button.dataset.avatarId || "",
      name: button.dataset.avatarName || "",
      thumbnailImageUrl: button.dataset.avatarImage || "",
      imageUrl: button.dataset.avatarImage || ""
    });
    if (known) {
      small.textContent = known;
      button.removeAttribute("data-avatar-author-hydrate");
      continue;
    }
    resolveAvatarAuthorFromDatabase({
      avatarId: button.dataset.avatarId || "",
      name: button.dataset.avatarName || "",
      thumbnailImageUrl: button.dataset.avatarImage || "",
      imageUrl: button.dataset.avatarImage || ""
    }).then((resolved) => {
      const author = findKnownAvatarAuthorName(resolved) || displayAvatarAuthorName(resolved);
      if (!author || !button.isConnected) return;
      cacheAvatarAuthorName(resolved, author);
      const text = button.querySelector("small");
      if (text) text.textContent = author;
      button.removeAttribute("data-avatar-author-hydrate");
    }).catch(() => {});
  }
}
function ageStatusLabel(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "hidden" || text === "unknown") return "";
  if (text.includes("18") || text.includes("verified")) return "18+";
  return value;
}
function platformLabel(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (text.includes("android") || text.includes("quest")) return "Android";
  if (text.includes("ios")) return "iOS";
  if (text.includes("standalonewindows") || text === "pc" || text.includes("windows")) return "PC";
  return value;
}
async function handleSocialAction(event) {
  const button = event.currentTarget;
  const action = button.dataset.socialAction;
  const userId = button.dataset.userId || "";
  const worldId = button.dataset.worldId || "";
  const notificationId = button.dataset.notificationId || "";
  try {
    if (action === "joinWorld") {
      await api("vrchatOpenWorld", { worldId, location: button.dataset.location || "" });
      toast("Invite sent to yourself. Accept it in VRChat to join.");
      return;
    }
    if (action === "favoriteWorld") {
      const choice = await chooseFavoriteWorldGroup(worldId);
      if (!choice) return;
      await api("vrchatFavoriteWorldAdd", { id: worldId, tag: choice.tag }, 45000);
      await refreshFavoriteWorlds();
      toast("World favorited.");
      return;
    }
    if (action === "unfavoriteWorld") {
      if (!await confirmAction({ title: "Unfavorite World", message: "Remove this world from your VRChat favorites?", confirmLabel: "Unfavorite", confirmClass: "danger" })) return;
      await api("vrchatFavoriteWorldRemove", { id: worldId }, 45000);
      await refreshFavoriteWorlds();
      toast("World unfavorited.");
      return;
    }
    if (action === "invite") {
      const choice = await chooseInviteMessageSlot({ title: "Send Invite", message: "Send an invite using one of your VRChat invite messages?", confirmLabel: "Send Invite", messageType: "message" });
      if (!choice) return;
      await api("vrchatInviteUser", { userId, instanceId: currentInstanceIdForInvite(), messageSlot: choice.messageSlot }, 45000);
      toast("Invite sent.");
      return;
    }
    if (action === "requestInvite") {
      const choice = await chooseInviteMessageSlot({ title: "Request Invite", message: "Request an invite using one of your VRChat request messages?", confirmLabel: "Request Invite", messageType: "request" });
      if (!choice) return;
      await api("vrchatRequestInvite", { id: userId, messageSlot: choice.messageSlot }, 45000);
      toast("Invite requested.");
      return;
    }
    if (action === "messageUser") {
      const friend = state.social.selectedItem?.id === userId ? state.social.selectedItem : findSocialFriend(userId);
      openInlineMessagePanel(userId, friend?.displayName || "");
      return;
    }
    if (action === "acceptFriendRequest") {
      if (!await confirmAction({ title: "Accept Friend Request", message: "Accept this VRChat friend request?", confirmLabel: "Accept", confirmClass: "primary" })) return;
      await api("vrchatAcceptFriendRequest", { id: notificationId }, 45000);
      state.notifications.items = state.notifications.items.filter((item) => item.id !== notificationId);
      addSocialActivity({ type: "friend-request-accepted", title: "Friend request accepted", detail: userId, userId, source: "Notifications" });
      toast("Friend request accepted.");
      await loadVrchatSocial();
      if (userId) {
        const friend = await loadSocialFriendDetails(userId);
        if (friend) openNotificationFriendDetails(friend, null);
      }
      renderNotificationsPage();
      renderMessagesPage();
      return;
    }
    if (action === "declineNotification") {
      if (!await confirmAction({ title: "Decline Friend Request", message: "Decline this VRChat friend request?", confirmLabel: "Decline", confirmClass: "danger" })) return;
      await api("vrchatDeclineNotification", { id: notificationId }, 45000);
      state.notifications.items = state.notifications.items.filter((item) => item.id !== notificationId);
      addSocialActivity({ type: "friend-request-declined", title: "Friend request declined", detail: userId, userId, source: "Notifications" });
      toast("Friend request declined.");
      renderNotificationsPage();
      renderMessagesPage();
      closeNotificationDetails();
      return;
    }
    if (action === "friend") {
      if (!await confirmAction({ title: "Friend Request", message: "Send this user a VRChat friend request?", confirmLabel: "Send Request", confirmClass: "primary" })) return;
      await api("vrchatFriendRequest", { id: userId }, 45000);
      toast("Friend request sent.");
      await refreshSocialUserAfterAction(userId);
      return;
    }
    if (action === "unfriend") {
      if (!await confirmAction({ title: "Unfriend", message: "Remove this user from your VRChat friends?", confirmLabel: "Unfriend", confirmClass: "danger" })) return;
      await api("vrchatUnfriend", { id: userId }, 45000);
      toast("User unfriended.");
      await refreshSocialUserAfterAction(userId, { reloadList: true });
      return;
    }
    if (action === "block") {
      if (!await confirmAction({ title: "Block User", message: "Block this user on VRChat?", confirmLabel: "Block", confirmClass: "danger" })) return;
      await api("vrchatBlockUser", { id: userId, type: "block" }, 45000);
      toast("User blocked.");
      await refreshSocialUserAfterAction(userId, { reloadList: true });
      return;
    }
    if (action === "unblock") {
      if (!await confirmAction({ title: "Unblock User", message: "Unblock this user on VRChat?", confirmLabel: "Unblock", confirmClass: "primary" })) return;
      await api("vrchatUnblockUser", { id: userId, type: "block" }, 45000);
      toast("User unblocked.");
      await refreshSocialUserAfterAction(userId, { reloadList: true });
    }
  } catch (e) {
    toast(e.message);
  }
}
async function favoriteWorldWithPicker(worldId, label = "this world") {
  const choice = await chooseFavoriteWorldGroup(worldId, label);
  if (!choice) return false;
  await api("vrchatFavoriteWorldAdd", { id: worldId, tag: choice.tag }, 45000);
  await refreshFavoriteWorlds();
  return true;
}
function chooseFavoriteWorldGroup(worldId, label = "") {
  return new Promise((resolve) => {
    const groups = state.social.favoriteWorldGroups || [];
    if (!groups.length) {
      resolve({ tag: "worlds1" });
      return;
    }
    const dialog = $("favoriteWorldDialog");
    const select = $("favoriteWorldGroupInput");
    select.innerHTML = groups.map((group) => `<option value="${escapeAttr(group.name || group.id)}">${escapeHtml(group.displayName || favoriteGroupLabel(group.name, "Favorite Worlds"))}</option>`).join("");
    $("favoriteWorldText").textContent = `Choose where to favorite ${label || "this world"}.`;
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      cleanup();
      resolve(value);
    };
    const cleanup = () => {
      $("confirmFavoriteWorldBtn").onclick = null;
      $("cancelFavoriteWorldBtn").onclick = null;
      dialog.removeEventListener("close", closeAsCancel);
    };
    const closeAsCancel = () => done(null);
    $("confirmFavoriteWorldBtn").onclick = () => done({ tag: select.value || "worlds1" });
    $("cancelFavoriteWorldBtn").onclick = () => done(null);
    dialog.addEventListener("close", closeAsCancel);
    dialog.showModal();
  });
}
async function refreshSocialUserAfterAction(userId, { reloadList = false } = {}) {
  if (reloadList) {
    await loadVrchatSocial();
  }
  if (userId && state.social.selectedType === "friend") {
    await selectSocialFriend(userId);
  }
}
async function refreshFavoriteWorlds() {
  const [favorites, groups] = await Promise.all([
    api("vrchatFavoriteWorlds", { limit: 100, offset: 0 }, 45000).catch(() => ({ worlds: [] })),
    api("vrchatFavoriteWorldGroups", { limit: 100, offset: 0 }, 45000).catch(() => ({ groups: [] }))
  ]);
  state.social.favoriteWorlds = favorites.worlds || [];
  state.social.favoriteWorldGroups = groups.groups || [];
  renderVrchatSocial();
}
function currentInstanceIdForInvite() {
  const location = state.social.location?.location || "";
  const colon = location.indexOf(":");
  return colon >= 0 ? location.slice(colon + 1) : "";
}
function chooseInviteMessageSlot({ title, message, confirmLabel, messageType = "message" }) {
  return new Promise((resolve) => {
    const dialog = $("inviteMessageDialog");
    const select = $("inviteMessageSlotInput");
    const menu = $("inviteMessageSlotMenu");
    const menuBtn = $("inviteMessageSlotBtn");
    const edit = $("inviteMessageEditInput");
    const count = $("inviteMessageEditCount");
    let messages = [];
    let selectedSlot = 0;
    $("inviteMessageTitle").textContent = title;
    $("inviteMessageText").textContent = message;
    $("confirmInviteMessageBtn").textContent = confirmLabel;
    select.innerHTML = `<option value="0">Loading messages...</option>`;
    select.value = "0";
    menu.innerHTML = "";
    menu.hidden = true;
    setDropdownButtonText("inviteMessageSlotBtn", "Loading messages...");
    menuBtn.setAttribute("aria-expanded", "false");
    edit.value = "";
    count.textContent = "0/64";
    $("saveInviteMessageBtn").disabled = true;
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      cleanup();
      resolve(value);
    };
    const cleanup = () => {
      $("confirmInviteMessageBtn").onclick = null;
      $("cancelInviteMessageBtn").onclick = null;
      $("saveInviteMessageBtn").onclick = null;
      menuBtn.onclick = null;
      select.onchange = null;
      edit.oninput = null;
      dialog.removeEventListener("close", closeAsCancel);
    };
    const closeAsCancel = () => done(null);
    const updateCount = () => { count.textContent = `${String(edit.value || "").length}/64`; };
    const selectSlot = (slot) => {
      selectedSlot = Number(slot) || 0;
      select.value = String(selectedSlot);
      const selected = messages.find((item) => Number(item.slot) === selectedSlot) || messages[0] || {};
      edit.value = String(selected.message || "");
      $("saveInviteMessageBtn").disabled = selected.canBeUpdated === false || Number(selected.remainingCooldownMinutes || 0) > 0;
      updateCount();
      updateSortButton("inviteMessageSlotInput", "inviteMessageSlotBtn");
      renderInviteMessageMenu();
    };
    const renderInviteMessageMenu = () => {
      select.innerHTML = messages.map((item) => {
        const slot = Number(item.slot) || 0;
        const text = String(item.message || "").trim() || (slot === 0 ? "Default message" : `Message ${slot}`);
        const cooldown = Number(item.remainingCooldownMinutes || 0);
        const suffix = item.canBeUpdated === false || cooldown > 0 ? ` (${cooldown > 0 ? `${cooldown}m cooldown` : "locked"})` : "";
        return `<option value="${slot}">#${slot}: ${escapeHtml(text)}${escapeHtml(suffix)}</option>`;
      }).join("");
      select.value = String(selectedSlot);
      renderSortMenu("inviteMessageSlotInput", "inviteMessageSlotMenu", "inviteMessageSlotBtn", () => selectSlot(select.value));
      updateSortButton("inviteMessageSlotInput", "inviteMessageSlotBtn");
    };
    $("confirmInviteMessageBtn").onclick = () => done({ messageSlot: Number(selectedSlot) || 0 });
    $("cancelInviteMessageBtn").onclick = () => done(null);
    menuBtn.onclick = (event) => toggleSortMenu(event, "inviteMessageSlotInput", "inviteMessageSlotMenu", "inviteMessageSlotBtn", () => selectSlot(select.value));
    select.onchange = () => selectSlot(select.value);
    $("saveInviteMessageBtn").onclick = async () => {
      const selected = messages.find((item) => Number(item.slot) === selectedSlot);
      if (!selected) return;
      if (selected.canBeUpdated === false || Number(selected.remainingCooldownMinutes || 0) > 0) {
        toast("That VRChat message slot is on cooldown.");
        return;
      }
      try {
        $("saveInviteMessageBtn").disabled = true;
        await api("vrchatUpdateInviteMessage", { type: messageType, slot: selectedSlot, message: edit.value }, 45000);
        messages = messages.map((item) => Number(item.slot) === selectedSlot ? { ...item, message: edit.value } : item);
        renderInviteMessageMenu();
        toast("VRChat message updated.");
      } catch (e) {
        toast(e.message);
      } finally {
        const current = messages.find((item) => Number(item.slot) === selectedSlot);
        $("saveInviteMessageBtn").disabled = current?.canBeUpdated === false || Number(current?.remainingCooldownMinutes || 0) > 0;
      }
    };
    edit.oninput = updateCount;
    dialog.addEventListener("close", closeAsCancel);
    dialog.showModal();
    api("vrchatInviteMessages", { type: messageType }, 45000)
      .then((result) => {
        messages = Array.isArray(result?.messages) && result.messages.length
          ? result.messages
          : Array.from({ length: 12 }, (_, slot) => ({ slot, message: slot === 0 ? "Default message" : `Message ${slot}`, canBeUpdated: true, remainingCooldownMinutes: 0 }));
        selectSlot(Number(messages[0]?.slot) || 0);
      })
      .catch(() => {
        messages = Array.from({ length: 12 }, (_, slot) => ({ slot, message: slot === 0 ? "Default message" : `Message ${slot}`, canBeUpdated: true, remainingCooldownMinutes: 0 }));
        selectSlot(0);
      });
  });
}
function metadataHistoryHtml(item) {
  const time = item.changedAt ? new Date(item.changedAt).toLocaleString() : "";
  const name = item.newName || item.oldName || item.avatarId;
  const updated = item.oldRemoteUpdatedAt || item.newRemoteUpdatedAt
    ? `<span>Updated: ${escapeHtml(item.oldRemoteUpdatedAt || "unknown")} -> ${escapeHtml(item.newRemoteUpdatedAt || "unknown")}</span>`
    : "";
  const status = item.oldStatus || item.newStatus
    ? `<span>Status: ${escapeHtml(item.oldStatus || "unknown")} -> ${escapeHtml(item.newStatus || "unknown")}</span>`
    : "";
  return `<div class="metadata-history-item"><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(item.avatarId || "")}</small></div><div><span>${escapeHtml(item.changeType || "metadata")}</span><span>${escapeHtml(time)}</span>${updated}${status}</div></div>`;
}
function filterSettingsLogEntries(entries) {
  const filter = state.settingsLogFilter || "all";
  if (filter === "all") return entries;
  const [kind, value = ""] = filter.split(":");
  if (kind === "area") return entries.filter((entry) => String(entry.area || "App").toLowerCase() === value.toLowerCase());
  if (kind === "level") return entries.filter((entry) => String(entry.level || "Info").toLowerCase() === value.toLowerCase());
  return entries;
}
function settingsLogEmptyHtml(allEntries) {
  if (!allEntries.length) return `<div class="settings-empty"><h4>No logs yet</h4><p>Useful app events, sync results, backups, updates, and errors will appear here.</p></div>`;
  const label = $("settingsLogFilterSelect").options[$("settingsLogFilterSelect").selectedIndex]?.textContent || "selected";
  return `<div class="settings-empty"><h4>No ${escapeHtml(label.toLowerCase())}</h4><p>No matching log entries were found for this filter.</p></div>`;
}
function logEntryHtml(entry) {
  const level = String(entry.level || "Info");
  const levelClass = level.toLowerCase();
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "";
  return `<div class="log-entry ${escapeAttr(levelClass)}"><time>${escapeHtml(time)}</time><span class="log-level">${escapeHtml(level)}</span><div class="log-body"><div class="log-title"><strong>${escapeHtml(entry.area || "App")}</strong><span>${escapeHtml(entry.message || "")}</span></div>${entry.detail ? `<p class="log-detail">${escapeHtml(entry.detail)}</p>` : ""}</div></div>`;
}
async function copySettingsLogs() {
  try {
    const result = await api("logsList");
    const text = filterSettingsLogEntries(result.entries || []).map((entry) => {
      const time = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "";
      return `[${time}] ${entry.level || "Info"} ${entry.area || "App"}: ${entry.message || ""}${entry.detail ? ` - ${entry.detail}` : ""}`;
    }).join("\n");
    if (!text) { toast("No logs to copy."); return; }
    if (await copyTextToClipboard(text)) toast("Logs copied.");
    else toast("Could not copy logs.");
  } catch (e) { handleAvatarAddError(e); }
}
async function copyAvatarsToGroup(ids, groupId, { focusTarget = true } = {}) {
  const avatars = ids.map((id) => state.library.avatars.find((x) => x.id === id)).filter(Boolean);
  const candidates = avatars.filter((avatar) => avatar.groupId !== groupId && !avatarAlreadyInGroup(avatar, groupId, avatar.id));
  if (!syncedGroupHasCapacityForAvatars(groupId, candidates.map((avatar) => avatar.avatarId || avatar.id))) return;
  let copied = 0;
  for (const avatar of candidates) {
    try {
      await pushSyncedAvatarAdd(avatar.avatarId || avatar.id, groupId);
      state.library = await api("copyAvatar", { avatarId: avatar.id, groupId });
      copied++;
    } catch (e) { handleAvatarAddError(e); break; }
  }
  if (focusTarget) state.activeGroupId = groupId;
  clearAvatarSelection();
  render();
  if (copied) toast(`${copied} avatars copied.`);
}
async function clearSettingsLogs() {
  if (!await confirmAction({ title: "Clear Logs", message: "Clear all app logs?", confirmLabel: "Clear", confirmClass: "danger" })) return;
  try {
    await api("logsClear");
    await loadSettingsLogs();
    toast("Logs cleared.");
  } catch (e) { handleAvatarAddError(e); }
}
async function openLogsFolder() {
  try {
    const result = await api("logsFolder");
    await api("openFolder", { path: result.path });
  } catch (e) {
    toast(e.message);
  }
}
function openBackupRestoreDialog(path, name) {
  state.pendingBackupRestore = { path, name };
  $("backupRestoreMessage").textContent = `Restore "${name}" as a new group, or replace the original group from that backup.`;
  $("backupRestoreDialog").showModal();
}
async function restoreBackup(mode) {
  const backup = state.pendingBackupRestore;
  if (!backup?.path) return;
  try {
    state.library = await api("backupRestore", { path: backup.path, mode });
    $("backupRestoreDialog").close();
    $("customizationDialog").close();
    state.pendingBackupRestore = null;
    ensureActiveGroupExists();
    render();
    toast(mode === "replace" ? "Backup restored over original group." : "Backup restored as a new group.");
  } catch (e) {
    toast(e.message);
  }
}
async function openBackupsFolder() {
  try {
    const result = await api("backupList");
    await api("openFolder", { path: result.folder });
  } catch (e) {
    toast(e.message);
  }
}
async function createAccountBackup() {
  if (!await confirmAction({
    title: "Create Account Avatars Backup",
    message: "Create a clean backup of your synced, uploaded, recent, and deleted VRChat avatar records?",
    confirmLabel: "Create",
    confirmClass: "primary"
  })) return;
  try {
    const result = await api("accountBackupCreate");
    await loadSettingsBackups();
    toast(`Account avatars backup saved. ${Number(result.avatarCount || 0)} avatars protected.`);
  } catch (e) {
    toast(e.message);
  }
}
async function openAccountBackupsFolder() {
  try {
    const result = await api("accountBackupFolder");
    await api("openFolder", { path: result.path });
  } catch (e) {
    toast(e.message);
  }
}
async function openBackgroundFolder() {
  try {
    const result = await api("backgroundFolder", { groupId: "" });
    await api("openFolder", { path: result.path });
  } catch (e) {
    toast(e.message);
  }
}
function backgroundTargetPayload(groupId = "") {
  return { groupId: groupId || "" };
}
function openBackgroundMenu(x, y, groupId = "") {
  const isGroup = Boolean(groupId);
  showContextMenu(x, y, [
    { label: "Import Backgrounds", action: () => importBackgrounds(groupId) },
    { label: "Open Background Folder", action: () => openBackgroundFolderForTarget(groupId) },
    { label: "Clear Backgrounds", className: "danger", action: () => clearBackgrounds(groupId) }
  ]);
}
function openGlobalBackgroundMenu(event) {
  event?.stopPropagation();
  const rect = $("openBackgroundFolderBtn").getBoundingClientRect();
  openBackgroundMenu(rect.left, rect.bottom + 6, "");
}
function configureBackgroundEffectDialog(groupId = "") {
  const select = $("backgroundEffectSelect");
  const group = groupId ? state.library.groups.find((item) => item.id === groupId) : null;
  const options = group ? [["global", "Use Global"], ...BACKGROUND_EFFECT_OPTIONS] : BACKGROUND_EFFECT_OPTIONS;
  select.innerHTML = options.map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`).join("");
  select.value = group ? groupBackgroundEffectValue(group) : state.settings.backgroundEffect;
  if (![...select.options].some((option) => option.value === select.value)) select.value = group ? "global" : "";
  updateSortButton("backgroundEffectSelect", "backgroundEffectMenuBtn");
}
function openBackgroundDialog(groupId = "") {
  state.pendingBackgroundGroupId = groupId || "";
  const group = groupId ? state.library.groups.find((item) => item.id === groupId) : null;
  $("backgroundActionTitle").textContent = group ? `Edit ${group.name} Background` : "Edit Global Background";
  configureBackgroundEffectDialog(groupId);
  $("backgroundActionDialog").showModal();
}
async function applyBackgroundDialogEffect() {
  const groupId = state.pendingBackgroundGroupId || "";
  const value = $("backgroundEffectSelect").value;
  try {
    if (groupId) {
      const group = state.library.groups.find((item) => item.id === groupId);
      if (!group) return;
      state.library = await api("updateGroup", { id: group.id, name: group.name, description: group.description || "", icon: group.icon || "", backgroundEffect: value });
      render();
      await loadBackground();
    } else {
      state.settings.backgroundEffect = value;
      $("bgEffectSelect").value = value;
      if (state.settingsDraft?.original) state.settingsDraft.original.backgroundEffect = value;
      queueSaveSettings();
      applyActiveBackgroundEffect();
    }
  } catch (e) { toast(e.message); }
}
async function importBackgrounds(groupId = "") {
  try {
    const result = await api("backgroundImport", backgroundTargetPayload(groupId), 300000);
    invalidateBackgroundCache(groupId);
    if (groupId) state.library = await api("list");
    await loadBackground();
    render();
    const imported = Number(result.imported) || 0;
    const skipped = Number(result.skipped) || 0;
    toast(skipped ? `Imported ${imported} backgrounds. Skipped ${skipped} unsupported files.` : imported ? `Imported ${imported} backgrounds.` : "No backgrounds imported.");
  } catch (e) {
    toast(e.message);
  }
}
async function openBackgroundFolderForTarget(groupId = "") {
  try {
    const result = await api("backgroundFolder", backgroundTargetPayload(groupId));
    await api("openFolder", { path: result.path });
  } catch (e) {
    toast(e.message);
  }
}
async function clearBackgrounds(groupId = "") {
  const label = groupId ? state.library.groups.find((group) => group.id === groupId)?.name || "this group" : "global backgrounds";
  const message = groupId ? `Remove all backgrounds for "${label}"?` : "Remove all global backgrounds? This does not remove group backgrounds.";
  if (!await confirmAction({ title: "Clear Backgrounds", message, confirmLabel: "Clear", confirmClass: "danger" })) return;
  try {
    const result = await api("backgroundClear", backgroundTargetPayload(groupId));
    invalidateBackgroundCache(groupId);
    if (groupId) state.library = await api("list");
    await loadBackground();
    render();
    toast(`Cleared ${Number(result.imported) || 0} backgrounds.`);
  } catch (e) {
    toast(e.message);
  }
}
async function applySettingsDialog() {
  state.settingsDraft = { ...(state.settingsDraft || {}), applied: true };
  await saveSettings();
  $("customizationDialog").close();
}
function cancelSettingsDialog() {
  if (state.settingsDraft?.original) {
    const backgroundEffect = state.settings.backgroundEffect;
    state.settings = { ...state.settingsDraft.original };
    state.settings.backgroundEffect = backgroundEffect;
    applySettings();
  }
  state.settingsDraft = null;
  $("customizationDialog").close();
}
function openCopyGroupDialog(group) {
  if (!group || isPinnedSystemGroup(group.id)) return;
  state.pendingCopyGroupId = group.id;
  $("copyGroupMessage").textContent = `Copy "${group.name}" as a new group, or copy its avatars into an existing local group.`;
  fillCopyGroupTargets(group.id);
  const hasTarget = Boolean($("copyGroupTargetInput").value);
  $("copyGroupTargetWrap").hidden = !hasTarget;
  $("copyGroupToExistingBtn").disabled = !hasTarget;
  $("copyGroupDialog").showModal();
}
async function copyGroup(group) {
  if (!group) return;
  try {
    state.library = await api("copyGroup", { id: group.id });
    const copied = state.library.groups.filter((item) => !isPinnedSystemGroup(item.id) && !isSyncedGroup(item.id)).at(-1);
    state.activeGroupId = copied?.id ?? state.activeGroupId;
    $("copyGroupDialog").close();
    render();
    toast("Group copied.");
  } catch (e) { handleAvatarAddError(e); }
}
async function copyGroupToExisting() {
  const source = state.library.groups.find((group) => group.id === state.pendingCopyGroupId);
  const targetId = $("copyGroupTargetInput").value;
  if (!source || !targetId) return;
  try {
    state.library = await api("copyGroupToExisting", { id: source.id, targetGroupId: targetId });
    state.activeGroupId = targetId;
    $("copyGroupDialog").close();
    render();
    toast("Avatars copied to group.");
  } catch (e) { toast(e.message); }
}
async function deleteGroup(group) {
  if (!group || !await confirmAction({ title: "Delete Group", message: `Are you sure you want to delete "${group.name}"?` })) return;
  const previousActiveId = state.activeGroupId;
  try {
    state.library = await api("deleteGroup", { id: group.id });
    state.activeGroupId = group.id === previousActiveId
      ? state.library.groups[0]?.id ?? null
      : previousActiveId;
    render();
    if (group.id === previousActiveId && state.activePage === "favorites") await loadBackground();
  } catch (e) { toast(e.message); }
}
async function deleteAvatarById(id, name) {
  const avatar = state.library.avatars.find((x) => x.id === id);
  if (!await confirmAction({ title: "Delete Avatar", message: `Are you sure you want to delete "${name || id}"?` })) return;
  try {
    const syncedRemoval = syncedAvatarRemovalPayload(avatar);
    state.library = await api("deleteAvatar", { id });
    render();
    removeSyncedAvatarsInBackground([syncedRemoval]);
  } catch (e) { toast(e.message); }
}
async function deleteSelectedAvatars(ids) {
  const avatars = ids.map((id) => state.library.avatars.find((x) => x.id === id)).filter(Boolean);
  if (!avatars.length) return;
  if (!await confirmAction({ title: "Delete Selected Avatars", message: `Delete ${avatars.length} selected avatars?`, confirmLabel: "Delete", confirmClass: "danger" })) return;
  try {
    const syncedRemovals = avatars.map(syncedAvatarRemovalPayload);
    for (const avatar of avatars) {
      state.library = await api("deleteAvatar", { id: avatar.id });
    }
    clearAvatarSelection();
    render();
    removeSyncedAvatarsInBackground(syncedRemovals);
  } catch (e) { toast(e.message); }
}
async function equipAvatar(id, avatarMeta = null) {
  try {
    state.lastLoggedCurrentAvatarId = id;
    const avatar = avatarMeta || state.library.avatars.find((x) => (x.avatarId || x.id) === id);
    state.currentAvatarSummary = { id, name: avatar?.name || id, imageUrl: avatar?.imageUrl || '', thumbnailImageUrl: avatar?.thumbnailImageUrl || avatar?.imageUrl || '' };
    if (state.vrchat?.user) {
      state.vrchat.user.currentAvatarId = id;
      state.vrchat.user.currentAvatarImageUrl = avatar?.imageUrl || state.vrchat.user.currentAvatarImageUrl || "";
      state.vrchat.user.currentAvatarThumbnailImageUrl = avatar?.thumbnailImageUrl || avatar?.imageUrl || state.vrchat.user.currentAvatarThumbnailImageUrl || "";
    }
    renderAccount();
    enqueueVrChatAction({
      kind: "equip-avatar",
      label: `Equip ${avatar?.name || id}`,
      payload: { avatarId: id },
      run: () => api("vrchatSelectAvatar", { id })
    });
    toast("Avatar equip queued.");
  } catch (e) { toast(e.message); }
}
function confirmAction({ title, message, confirmLabel = "Delete", confirmClass = "danger", hideCancel = false }) {
  return queueConfirmDialog(() => new Promise((resolve) => {
    $("confirmDialogTitle").textContent = title;
    $("confirmDeleteMessage").textContent = message;
    $("runConfirmBtn").textContent = confirmLabel;
    $("runConfirmBtn").className = confirmClass;
    $("cancelConfirmBtn").hidden = hideCancel;
    let settled = false;
    const done = (value) => { if (settled) return; settled = true; $("confirmDeleteDialog").close(); cleanup(); resolve(value); };
    const cleanup = () => { $("runConfirmBtn").onclick = null; $("cancelConfirmBtn").onclick = null; $("cancelConfirmBtn").hidden = false; $("confirmDeleteDialog").removeEventListener("close", closeAsCancel); };
    const closeAsCancel = () => done(false);
    $("runConfirmBtn").onclick = () => done(true);
    $("cancelConfirmBtn").onclick = () => done(false);
    $("confirmDeleteDialog").addEventListener("close", closeAsCancel);
    $("confirmDeleteDialog").showModal();
  }));
}
function queueConfirmDialog(openDialog) {
  const run = () => openDialog().catch((error) => {
    console.warn(error);
    return false;
  });
  const queued = confirmDialogQueue.then(run, run);
  confirmDialogQueue = queued.catch(() => {});
  return queued;
}

function applySettings() { applyGridSize(); applyColors(); applyBackgroundOpacity(); applyPanelOpacity(); applyActiveBackgroundEffect(); }
function applyGridSize() {
  const columns = Math.min(10, Math.max(3, Number(state.activePage === "database" ? state.settings.databaseGridSize : state.settings.gridSize) || DEFAULT_SETTINGS.gridSize));
  const activeGrid = state.activePage === "database" ? $("avatarDatabaseResults") : $("avatarGrid");
  const fallbackGrid = $("avatarGrid")?.clientWidth ? $("avatarGrid") : $("avatarDatabaseResults");
  const activeWidth = activeGrid && activeGrid.offsetParent !== null ? activeGrid.clientWidth : 0;
  const fallbackWidth = fallbackGrid && fallbackGrid.offsetParent !== null ? fallbackGrid.clientWidth : 0;
  const workspaceWidth = $(".workspace-page:not([hidden])")?.clientWidth || 0;
  const gridWidth = Math.max(360, ((activeWidth || fallbackWidth || workspaceWidth || window.innerWidth || 0) - 48));
  const gap = columns >= 8 ? 12 : 16;
  const size = Math.max(96, Math.floor((gridWidth - (columns - 1) * gap) / columns));
  if (state.activePage === "database") state.settings.databaseGridSize = columns;
  else state.settings.gridSize = columns;
  document.documentElement.style.setProperty("--avatar-columns", String(columns));
  document.documentElement.style.setProperty("--avatar-grid-gap", `${gap}px`);
  document.documentElement.style.setProperty("--avatar-card-size", `${size}px`);
  $("gridSizeInput").value = String(state.settings.gridSize);
  $("gridSizeValue").textContent = String(state.settings.gridSize);
  $("databaseGridSizeInput").value = String(state.settings.databaseGridSize);
  $("databaseGridSizeValue").textContent = String(state.settings.databaseGridSize);
}
function applyBackgroundOpacity() {
  const value = Math.min(100, Math.max(0, Number(state.settings.backgroundOpacity) || 0));
  state.settings.backgroundOpacity = value;
  document.documentElement.style.setProperty("--bg-obscure-opacity", String(value / 100));
  $("backgroundOpacityInput").value = String(value);
  $("backgroundOpacityNumber").value = String(value);
  $("backgroundOpacityPrevBtn").disabled = value <= 0;
  $("backgroundOpacityNextBtn").disabled = value >= 100;
}
function applyPanelOpacity() {
  const value = Math.min(100, Math.max(0, Number(state.settings.panelOpacity) || 0));
  state.settings.panelOpacity = value;
  document.documentElement.style.setProperty("--panel-opacity", String(value / 100));
  $("panelOpacityInput").value = String(value);
  $("panelOpacityNumber").value = String(value);
  $("panelOpacityPrevBtn").disabled = value <= 0;
  $("panelOpacityNextBtn").disabled = value >= 100;
}
let _bgCanvas = null, _bgFrame = null, _bgActive = "", _bgMediaActive = false;
function renderBackground(bg) {
  const layer = $("backgroundLayer");
  if (!layer) return;
  layer.replaceChildren();
  if (bg?.dataUrl) {
    _bgMediaActive = true;
    stopBgEffect();
    const isVideo = String(bg.mediaType || "").toLowerCase() === "video";
    const media = document.createElement(isVideo ? "video" : "img");
    if (isVideo) {
      media.autoplay = true;
      media.loop = true;
      media.muted = true;
      media.playsInline = true;
    } else {
      media.alt = "";
    }
    media.src = bg.dataUrl;
    layer.append(media);
  } else {
    _bgMediaActive = false;
    if (_bgCanvas) layer.append(_bgCanvas);
    startBgEffect(activeBackgroundEffect());
  }
}
function startBgEffect(effect) {
  stopBgEffect();
  if (!effect || _bgMediaActive) return;
  if (!_bgCanvas) {
    _bgCanvas = document.createElement("canvas");
    _bgCanvas.id = "bgEffectCanvas";
    _bgCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;";
  }
  const layer = $("backgroundLayer");
  if (layer && _bgCanvas.parentElement !== layer) {
    layer.append(_bgCanvas);
  }
  _bgCanvas.width = window.innerWidth;
  _bgCanvas.height = window.innerHeight;
  _bgCanvas.hidden = false;
  _bgActive = effect;
  const ctx = _bgCanvas.getContext("2d");
  let frame = 0;
  function draw() {
    if (_bgActive !== effect) return;
    frame++;
    _bgDraw(ctx, effect, frame, _bgCanvas.width, _bgCanvas.height);
    _bgFrame = requestAnimationFrame(draw);
  }
  draw();
}
function stopBgEffect() {
  if (_bgFrame) cancelAnimationFrame(_bgFrame);
  _bgFrame = null; _bgActive = "";
  if (_bgCanvas) _bgCanvas.hidden = true;
}
function _bgDraw(ctx, effect, frame, w, h) {
  switch (effect) {
    case "noise": return _bgNoise(ctx, w, h);
    case "noise2": return _bgNoise2(ctx, w, h);
    case "particles": return _bgParticles(ctx, w, h);
    case "aurora": return _bgAurora(ctx, frame, w, h);
    case "aurorasnow": return _bgAuroraSnow(ctx, frame, w, h);
    case "stars": return _bgStars(ctx, w, h);
    case "flow": return _bgFlow(ctx, frame, w, h);
    case "matrix": return _bgMatrix(ctx, w, h);
    case "snow": return _bgSnow(ctx, w, h);
    case "blizzard": return _bgBlizzard(ctx, frame, w, h);
    case "fog": return _bgFog(ctx, frame, w, h);
    case "embers": return _bgEmbers(ctx, w, h);
    case "nebula": return _bgNebula(ctx, frame, w, h);
    case "pulse": return _bgPulse(ctx, frame, w, h);
    case "waves": return _bgWaves(ctx, frame, w, h);
    case "lowpoly": return _bgLowpoly(ctx, frame, w, h);
    case "rain": return _bgRain(ctx, w, h);
    case "thunderstorm": return _bgThunderstorm(ctx, frame, w, h);
  }
}
let _bgState = {};
function _bgNoise(ctx, w, h) {
  const d = ctx.createImageData(w, h), px = d.data;
  for (let i = 0; i < px.length; i += 4) { const v = Math.random() * 200 + 30; px[i]=v; px[i+1]=v; px[i+2]=v; px[i+3]=255; }
  ctx.putImageData(d, 0, 0);
}
function _bgNoise2(ctx, w, h) {
  const d = ctx.createImageData(w, h), px = d.data;
  for (let i = 0; i < px.length; i += 4) { const v = Math.random() * 40 + 2; px[i]=v; px[i+1]=v; px[i+2]=v; px[i+3]=255; }
  ctx.putImageData(d, 0, 0);
}
function _bgParticles(ctx, w, h) {
  if (!_bgState.particles || _bgState.pw !== w || _bgState.ph !== h) {
    _bgState.particles = []; _bgState.pw = w; _bgState.ph = h;
    for (let i = 0; i < 50; i++) _bgState.particles.push({ x: Math.random()*w, y: Math.random()*h, r: Math.random()*2.5+1, s: Math.random()*0.35+0.12, o: Math.random()*0.3+0.04 });
  }
  ctx.clearRect(0, 0, w, h);
  for (const p of _bgState.particles) {
    p.y -= p.s; if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fillStyle = `rgba(200,215,230,${p.o})`; ctx.fill();
  }
}
function _bgAurora(ctx, frame, w, h) {
  ctx.clearRect(0, 0, w, h);
  const t = frame * 0.01;
  for (let band = 0; band < 4; band++) {
    const baseY = h * (0.2 + band * 0.12);
    const hue = 155 + band * 50;
    for (let x = 0; x < w; x += 4) {
      const y = baseY + Math.sin(x * 0.005 + t * 0.8 + band) * 45 + Math.sin(x * 0.012 + t * 0.5 + band * 2) * 30;
      const thickness = 80 + Math.sin(x * 0.003 + t + band) * 24;
      const alpha = 0.16 + Math.sin(x * 0.007 + t * 0.6) * 0.06;
      const g = ctx.createLinearGradient(x, y - thickness, x, y + thickness);
      g.addColorStop(0, `hsla(${hue}, 70%, 35%, 0)`);
      g.addColorStop(0.2, `hsla(${hue+20}, 65%, 40%, ${alpha})`);
      g.addColorStop(0.5, `hsla(${hue}, 80%, 50%, ${alpha*1.3})`);
      g.addColorStop(0.8, `hsla(${hue-10}, 65%, 35%, ${alpha*0.6})`);
      g.addColorStop(1, `hsla(${hue-20}, 50%, 25%, 0)`);
      ctx.fillStyle = g; ctx.fillRect(x, y - thickness, 4, thickness * 2);
    }
  }
}
function _bgAuroraSnow(ctx, frame, w, h) {
  _bgAurora(ctx, frame, w, h);
  if (!_bgState.snow || _bgState.snw !== w || _bgState.snh !== h) {
    _bgState.snow = []; _bgState.snw = w; _bgState.snh = h;
    for (let i = 0; i < 120; i++) _bgState.snow.push({ x: Math.random()*w, y: Math.random()*h, r: Math.random()*2.5+0.5, s: Math.random()*1.5+0.5, wb: Math.random()*0.5 });
  }
  for (const s of _bgState.snow) {
    s.y += s.s; s.x += Math.sin(s.y * 0.005) * s.wb;
    if (s.y > h + 5) { s.y = -5; s.x = Math.random() * w; }
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28);
    ctx.fillStyle = "rgba(230,240,250,0.45)"; ctx.fill();
  }
}
function _bgStars(ctx, w, h) {
  if (!_bgState.stars || _bgState.sw !== w || _bgState.sh !== h) {
    _bgState.stars = []; _bgState.sw = w; _bgState.sh = h;
    const palette = [
      [180, 200, 255], [200, 220, 255], [220, 235, 255],
      [255, 245, 235], [255, 235, 220], [255, 220, 195],
      [255, 200, 180], [255, 180, 160], [255, 230, 200],
      [210, 220, 255], [235, 225, 255], [255, 255, 250],
    ];
    for (let l = 0; l < 3; l++) {
      const count = [180, 120, 60][l];
      for (let i = 0; i < count; i++) {
        _bgState.stars.push({
          x: Math.random()*w, y: Math.random()*h,
          r: [0.4,0.6,0.9][l] + Math.random()*0.3,
          s: [0.01,0.015,0.02][l] + Math.random()*0.01,
          o: 0.3 + Math.random()*0.55,
          tw: Math.random()*6.28,
          ts: 0.01 + Math.random()*0.03,
          c: palette[Math.floor(Math.random() * palette.length)],
        });
      }
    }
  }
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  for (const s of _bgState.stars) {
    s.y -= s.s; if (s.y < -5) { s.y = h + 5; s.x = Math.random() * w; }
    const twinkle = 0.7 + Math.sin(s.y * 0.03 + s.tw) * 0.3;
    const o = Math.min(1, s.o * twinkle);
    const [cr, cg, cb] = s.c;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${o})`; ctx.fill();
    if (s.r > 0.6) {
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r*2.5);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${o*0.3})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(s.x-s.r*2.5, s.y-s.r*2.5, s.r*5, s.r*5);
    }
  }
}
function _bgNebula(ctx, frame, w, h) {
  ctx.clearRect(0, 0, w, h);
  const t = frame * 0.003;
  // deep space base — subtle dark glow across the whole canvas
  const bg = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.max(w,h)*0.7);
  bg.addColorStop(0, "rgba(0,0,0,0.25)");
  bg.addColorStop(0.5, "rgba(0,0,0,0.14)");
  bg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  // primary cloud masses — large majestic blobs
  const clouds = [
    { cx: 0.35, cy: 0.4, r: 0.55, h: 275, s: 80, l: 38, a: 0.15 },
    { cx: 0.65, cy: 0.55, r: 0.5, h: 320, s: 75, l: 34, a: 0.13 },
    { cx: 0.5, cy: 0.35, r: 0.6, h: 255, s: 78, l: 40, a: 0.12 },
    { cx: 0.3, cy: 0.6, r: 0.45, h: 290, s: 70, l: 32, a: 0.12 },
    { cx: 0.7, cy: 0.3, r: 0.5, h: 310, s: 75, l: 36, a: 0.11 },
    { cx: 0.2, cy: 0.25, r: 0.35, h: 195, s: 70, l: 38, a: 0.10 },
    { cx: 0.8, cy: 0.7, r: 0.4, h: 340, s: 80, l: 34, a: 0.12 },
    { cx: 0.55, cy: 0.65, r: 0.38, h: 170, s: 65, l: 36, a: 0.09 },
    { cx: 0.45, cy: 0.2, r: 0.42, h: 15, s: 85, l: 45, a: 0.09 },
    { cx: 0.6, cy: 0.45, r: 0.48, h: 220, s: 75, l: 38, a: 0.10 },
    { cx: 0.25, cy: 0.5, r: 0.4, h: 350, s: 70, l: 35, a: 0.11 },
  ];
  for (const c of clouds) {
    const cx = w*c.cx + Math.sin(t*0.25 + c.h*0.01)*w*0.06;
    const cy = h*c.cy + Math.cos(t*0.2 + c.h*0.01)*h*0.06;
    const r = Math.max(w,h)*c.r + Math.sin(t*0.4 + c.h)*20;
    const g = ctx.createRadialGradient(cx, cy, r*0.05, cx, cy, r);
    g.addColorStop(0, `hsla(${c.h},${c.s}%,${c.l}%,${c.a})`);
    g.addColorStop(0.15, `hsla(${c.h+10},${c.s}%,${c.l+5}%,${c.a*0.85})`);
    g.addColorStop(0.4, `hsla(${c.h-5},${c.s-5}%,${c.l-3}%,${c.a*0.5})`);
    g.addColorStop(0.7, `hsla(${c.h-15},${c.s}%,${c.l-8}%,${c.a*0.18})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  // wispy filaments — smaller, elongated trails wrapping around clouds
  for (let i = 0; i < 12; i++) {
    const wx = w*(0.1 + i*0.07) + Math.sin(t*0.15 + i)*w*0.08;
    const wy = h*0.45 + Math.cos(t*0.18 + i*0.7)*h*0.35;
    const wr = 60 + Math.sin(i*1.5 + t)*30;
    const wh = [270, 310, 195, 340, 230, 170, 285, 15, 220, 330, 200, 260][i % 12];
    const wisp = ctx.createRadialGradient(wx, wy, 0, wx, wy, wr);
    wisp.addColorStop(0, `hsla(${wh},65%,45%,0.12)`);
    wisp.addColorStop(0.4, `hsla(${wh},55%,35%,0.06)`);
    wisp.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = wisp; ctx.fillRect(0, 0, w, h);
  }
  // bright core areas — dense glowing spots
  const cores = [
    [0.38, 0.42, 0.15, 300, 75, 48, 0.14],
    [0.62, 0.52, 0.13, 270, 80, 44, 0.11],
    [0.5, 0.38, 0.12, 210, 65, 42, 0.10],
    [0.75, 0.65, 0.11, 340, 70, 44, 0.10],
    [0.22, 0.28, 0.1, 180, 60, 40, 0.09],
  ];
  for (const [cx, cy, rs, h, s, l, a] of cores) {
    const px = w*cx + Math.sin(t*0.3)*w*0.03;
    const py = h*cy + Math.cos(t*0.25)*h*0.03;
    const pr = Math.max(w,h)*rs;
    const coreG = ctx.createRadialGradient(px, py, 0, px, py, pr);
    coreG.addColorStop(0, `hsla(${h},${s}%,${l}%,${a})`);
    coreG.addColorStop(0.3, `hsla(${h+10},${s}%,${l-3}%,${a*0.5})`);
    coreG.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = coreG; ctx.fillRect(0, 0, w, h);
  }
  // embedded stars — tiny scattered dots with twinkle
  if (!_bgState.nestars || _bgState.nsw !== w || _bgState.nsh !== h) {
    _bgState.nestars = []; _bgState.nsw = w; _bgState.nsh = h;
    for (let i = 0; i < 300; i++) {
      const r = Math.random();
      _bgState.nestars.push({
        x: Math.random()*w, y: Math.random()*h,
        r: Math.random()*1.1+0.2, o: Math.random()*0.6+0.15,
        tw: Math.random()*6.28, ts: 0.005+Math.random()*0.02,
        c: r<0.08 ? [255,180,220] : r<0.16 ? [180,220,255] : r<0.24 ? [255,220,170] : r<0.3 ? [220,200,255] : [240,240,255],
      });
    }
  }
  for (const s of _bgState.nestars) {
    const o = s.o * (0.55 + Math.sin(s.tw + frame*s.ts) * 0.45);
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28);
    ctx.fillStyle = `rgba(${s.c[0]},${s.c[1]},${s.c[2]},${o})`; ctx.fill();
  }
}
function _bgFlow(ctx, frame, w, h) {
  ctx.clearRect(0, 0, w, h);
  const t = frame * 0.018;
  for (let i = 0; i < 8; i++) {
    const cx = w/2 + Math.sin(t*0.7 + i) * w * 0.22;
    const cy = h/2 + Math.cos(t*0.55 + i) * h * 0.22;
    const r = 90 + Math.sin(t + i * 1.3) * 35;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, "rgba(145,185,225,0.12)"); g.addColorStop(1, "rgba(145,185,225,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
}
function _bgMatrix(ctx, w, h) {
  if (!_bgState.matrix || _bgState.mw !== w || _bgState.mh !== h) {
    _bgState.matrix = []; _bgState.mw = w; _bgState.mh = h;
    const cols = Math.floor(w / 22);
    for (let i = 0; i < cols; i++) _bgState.matrix.push({ x: i*22+Math.random()*10, y: Math.random()*h, s: Math.random()*1.2+0.4 });
  }
  ctx.fillStyle = "rgba(4,10,6,0.07)"; ctx.fillRect(0, 0, w, h);
  ctx.font = "10px monospace";
  for (const d of _bgState.matrix) {
    const ch = String.fromCharCode(0x30A0 + Math.random() * 96);
    ctx.fillStyle = "rgba(100,220,120,0.3)"; ctx.fillText(ch, d.x, d.y);
    ctx.fillStyle = "rgba(160,230,180,0.45)"; ctx.fillText(ch, d.x, d.y - 11);
    d.y += d.s; if (d.y > h + 20) { d.y = -20; d.x = Math.floor(Math.random()*(w/22))*22+Math.random()*10; }
  }
}
function _bgSnow(ctx, w, h) {
  if (!_bgState.snow || _bgState.snw !== w || _bgState.snh !== h) {
    _bgState.snow = []; _bgState.snw = w; _bgState.snh = h;
    for (let i = 0; i < 120; i++) _bgState.snow.push({ x: Math.random()*w, y: Math.random()*h, r: Math.random()*2.5+0.5, s: Math.random()*1.5+0.5, wb: Math.random()*0.5 });
  }
  ctx.clearRect(0, 0, w, h);
  for (const s of _bgState.snow) {
    s.y += s.s; s.x += Math.sin(s.y * 0.005) * s.wb;
    if (s.y > h + 5) { s.y = -5; s.x = Math.random() * w; }
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28);
    ctx.fillStyle = "rgba(230,240,250,0.45)"; ctx.fill();
  }
}
function _bgBlizzard(ctx, frame, w, h) {
  if (!_bgState.blizzard || _bgState.blzw !== w || _bgState.blzh !== h) {
    _bgState.blizzard = { snow: [], fog: [] };
    _bgState.blzw = w; _bgState.blzh = h;
    for (let i = 0; i < 700; i++) {
      _bgState.blizzard.snow.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 3.5 + 0.8,
        s: Math.random() * 5 + 2,
        wb: (Math.random() - 0.5) * 7,
        o: Math.random() * 0.35 + 0.25
      });
    }
    for (let i = 0; i < 45; i++) {
      _bgState.blizzard.fog.push({
        x: Math.random() * w,
        y: h * 0.4 + Math.random() * h * 0.6,
        r: h * 0.25 + Math.random() * h * 0.3,
        s: Math.random() * 0.3 + 0.15,
        wd: (Math.random() - 0.5) * 4,
        o: Math.random() * 0.06 + 0.05,
        ph: Math.random() * 6.28
      });
    }
  }
  ctx.clearRect(0, 0, w, h);
  // dark overcast sky
  const overcast = ctx.createLinearGradient(0, 0, 0, h * 0.6);
  overcast.addColorStop(0, "rgba(12, 15, 18, 0.4)");
  overcast.addColorStop(0.3, "rgba(18, 22, 26, 0.25)");
  overcast.addColorStop(0.7, "rgba(28, 32, 36, 0.08)");
  overcast.addColorStop(1, "rgba(35, 38, 42, 0)");
  ctx.fillStyle = overcast; ctx.fillRect(0, 0, w, h);
  // fog layer
  const t = frame * 0.002;
  for (const f of _bgState.blizzard.fog) {
    f.x += f.wd + Math.sin(t + f.ph) * 0.3;
    f.y += f.s * 0.15;
    if (f.x < -f.r) f.x = w + f.r;
    if (f.x > w + f.r) f.x = -f.r;
    if (f.y > h + f.r) { f.y = h * 0.4 + Math.random() * h * 0.1; f.x = Math.random() * w; }
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
    g.addColorStop(0, `rgba(200, 210, 220, ${f.o})`);
    g.addColorStop(0.3, `rgba(180, 190, 205, ${f.o * 0.5})`);
    g.addColorStop(0.6, `rgba(140, 150, 165, ${f.o * 0.15})`);
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
  }
  // blowing snow
  for (const s of _bgState.blizzard.snow) {
    s.y += s.s;
    s.x += s.wb;
    if (s.y > h + 10) { s.y = -10; s.x = Math.random() * w; }
    if (s.x < -40) s.x = w + 40;
    if (s.x > w + 40) s.x = -40;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28);
    ctx.fillStyle = `rgba(230, 240, 250, ${s.o})`;
    ctx.fill();
  }
}
function _bgFog(ctx, frame, w, h) {
  if (!_bgState.fog || _bgState.fgw !== w || _bgState.fgh !== h) {
    _bgState.fog = []; _bgState.fgw = w; _bgState.fgh = h;
    for (let i = 0; i < 40; i++) {
      _bgState.fog.push({
        x: Math.random() * w,
        y: h * 0.4 + Math.random() * h * 0.6,
        r: h * 0.12 + Math.random() * h * 0.3,
        s: Math.random() * 0.15 + 0.05,
        o: Math.random() * 0.03 + 0.01,
        ph: Math.random() * 6.28
      });
    }
  }
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(0, 0, 0, 0)";
  ctx.fillRect(0, 0, w, h);
  for (const f of _bgState.fog) {
    f.x += f.s * Math.sin(frame * 0.003 + f.ph) * 0.5;
    f.y += f.s * 0.05;
    if (f.x < -f.r) f.x = w + f.r;
    if (f.x > w + f.r) f.x = -f.r;
    if (f.y > h + f.r) { f.y = h * 0.4 + Math.random() * h * 0.1; f.x = Math.random() * w; }
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
    g.addColorStop(0, `rgba(200, 210, 225, ${f.o})`);
    g.addColorStop(0.4, `rgba(190, 200, 215, ${f.o * 0.6})`);
    g.addColorStop(0.75, `rgba(180, 190, 205, ${f.o * 0.2})`);
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
  }
}
function _bgEmbers(ctx, w, h) {
  if (!_bgState.embers || _bgState.ew !== w || _bgState.eh !== h) {
    _bgState.embers = []; _bgState.smoke = []; _bgState.ew = w; _bgState.eh = h;
    for (let i = 0; i < 60; i++) {
      _bgState.embers.push({
        x: w * 0.1 + Math.random() * w * 0.8,
        y: h * 0.9 + Math.random() * h * 0.1,
        r: Math.random() * 1.2 + 0.4,
        s: Math.random() * 2.5 + 1.5,
        wb: (Math.random() - 0.5) * 1.6,
        o: 0.5 + Math.random() * 0.5,
        life: Math.random(),
        pulse: Math.random() * 6.28
      });
    }
    for (let i = 0; i < 40; i++) {
      _bgState.smoke.push({
        x: w * 0.15 + Math.random() * w * 0.7,
        y: h * 0.92 + Math.random() * h * 0.08,
        r: Math.random() * 15 + 8,
        s: Math.random() * 0.15 + 0.04,
        wb: (Math.random() - 0.5) * 0.3,
        o: Math.random() * 0.06 + 0.015
      });
    }
  }
  ctx.clearRect(0, 0, w, h);

  const glow = ctx.createLinearGradient(0, h, 0, 0);
  glow.addColorStop(0, "rgba(200, 100, 30, 0.10)");
  glow.addColorStop(0.2, "rgba(160, 70, 20, 0.07)");
  glow.addColorStop(0.45, "rgba(90, 35, 10, 0.04)");
  glow.addColorStop(0.7, "rgba(35, 14, 5, 0.02)");
  glow.addColorStop(0.85, "rgba(10, 4, 2, 0.008)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  for (const s of _bgState.smoke) {
    s.y -= s.s;
    s.x += s.wb * 0.3 + (Math.random() - 0.5) * 0.1;
    if (s.y < -80) {
      s.y = h * 0.92 + Math.random() * h * 0.08;
      s.x = w * 0.15 + Math.random() * w * 0.7;
    }
    const sr = s.r * (1 + (h - s.y) / h * 1.5);
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, sr);
    g.addColorStop(0, `rgba(25, 20, 18, ${s.o})`);
    g.addColorStop(0.5, `rgba(15, 12, 10, ${s.o * 0.4})`);
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(s.x - sr, s.y - sr, sr * 2, sr * 2);
  }

  for (const e of _bgState.embers) {
    e.life += 0.0015;
    if (e.life > 1) {
      e.life = 0;
      e.y = h * 0.9 + Math.random() * h * 0.1;
      e.x = w * 0.1 + Math.random() * w * 0.8;
      e.o = 0.5 + Math.random() * 0.5;
    }
    e.y -= e.s;
    e.x += e.wb * 0.35;
    if (e.y < -20) {
      e.y = h * 0.9 + Math.random() * h * 0.1;
      e.x = w * 0.1 + Math.random() * w * 0.8;
      e.life = 0;
      e.o = 0.5 + Math.random() * 0.5;
    }
    const t = 1 - Math.min(1, ((h - e.y) / h) * 0.55);
    const flicker = 0.6 + Math.sin(e.life * 20 + e.pulse) * 0.4;
    const r = Math.round(255 * t + 200 * (1 - t));
    const g = Math.round(180 * t + 80 * (1 - t));
    const b = Math.round(60 * t + 20 * (1 - t));
    const glowSize = e.r * 2.5 * (0.5 + t * 0.5);
    const alpha = e.o * flicker * Math.max(0.15, t);

    const gd = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, glowSize);
    gd.addColorStop(0, `rgba(${r},${g},${b},${alpha * 0.9})`);
    gd.addColorStop(0.3, `rgba(${Math.round(r*0.7)},${Math.round(g*0.4)},${Math.round(b*0.2)},${alpha * 0.35})`);
    gd.addColorStop(0.6, `rgba(${Math.round(r*0.3)},${Math.round(g*0.15)},${Math.round(b*0.05)},${alpha * 0.08})`);
    gd.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gd;
    ctx.fillRect(e.x - glowSize, e.y - glowSize, glowSize * 2, glowSize * 2);

    const core = Math.max(1, e.r * 0.8);
    ctx.beginPath();
    ctx.arc(e.x, e.y, core, 0, 6.28);
    ctx.fillStyle = `rgba(${Math.min(255, r + 40)},${Math.min(255, g + 30)},${b},${alpha * 0.7})`;
    ctx.fill();
  }
}
function _bgPulse(ctx, frame, w, h) {
  ctx.clearRect(0, 0, w, h);
  const a = 0.1 + Math.sin(frame * 0.02) * 0.06;
  const g = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.max(w,h)*0.5);
  g.addColorStop(0, `rgba(160, 190, 230, ${a * 1.5})`);
  g.addColorStop(0.4, `rgba(120, 150, 200, ${a * 0.8})`);
  g.addColorStop(0.7, `rgba(80, 110, 160, ${a * 0.3})`);
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
function _bgWaves(ctx, frame, w, h) {
  ctx.clearRect(0, 0, w, h);
  const t = frame * 0.015;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y = h*0.72 + Math.sin(x*0.004 + t + i*0.9) * 22 + Math.sin(x*0.012 - t*0.6 + i) * 12;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = `rgba(100,150,210,${0.06 - i*0.01})`; ctx.fill();
  }
}
function _bgLowpoly(ctx, frame, w, h) {
  ctx.clearRect(0, 0, w, h);
  const t = frame * 0.004;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    pts.push({ x: w/2 + Math.cos(t + i*1.05) * w*0.32, y: h/2 + Math.sin(t*0.8 + i*1.05) * h*0.32 });
  }
  for (let a = 0; a < pts.length; a++) {
    for (let b = a+1; b < pts.length; b++) {
      for (let c = b+1; c < pts.length; c++) {
        ctx.beginPath(); ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y); ctx.lineTo(pts[c].x, pts[c].y); ctx.closePath();
        ctx.fillStyle = "rgba(120,150,190,0.04)"; ctx.strokeStyle = "rgba(120,150,190,0.06)";
        ctx.lineWidth = 0.5; ctx.fill(); ctx.stroke();
      }
    }
  }
}
function _bgRain(ctx, w, h) {
  if (!_bgState.rain || _bgState.rnw !== w || _bgState.rnh !== h) {
    _bgState.rain = []; _bgState.rnw = w; _bgState.rnh = h;
    for (let i = 0; i < 200; i++) {
      _bgState.rain.push({
        x: Math.random() * w, y: -Math.random() * h,
        l: Math.random() * 20 + 10,
        s: Math.random() * 4 + 3,
        dr: (Math.random() - 0.5) * 0.3,
        w: Math.random() * 0.4 + 0.4,
        o: Math.random() * 0.15 + 0.08
      });
    }
  }
  ctx.clearRect(0, 0, w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "rgba(14, 17, 20, 0.12)");
  sky.addColorStop(0.5, "rgba(20, 24, 27, 0.04)");
  sky.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  for (const r of _bgState.rain) {
    r.y += r.s;
    r.x -= 0.3 - r.dr;
    if (r.y > h + r.l) { r.y = -r.l; r.x = Math.random() * w; }
    ctx.globalAlpha = r.o;
    ctx.strokeStyle = "rgba(160, 185, 215, 1)";
    ctx.lineWidth = r.w;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x - 0.35 + r.dr * 0.3, r.y + r.l);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function _bgThunderstorm(ctx, frame, w, h) {
  if (!_bgState.ts || _bgState.tsw !== w || _bgState.tsh !== h) {
    _bgState.ts = { rain: [] }; _bgState.tsw = w; _bgState.tsh = h;
    for (let i = 0; i < 400; i++) _bgState.ts.rain.push({ x: Math.random()*w, y: Math.random()*h, l: Math.random()*15+10, s: Math.random()*7+8 });
    _bgState.ts.flashTimer = 0; _bgState.ts.flashAlpha = 0; _bgState.ts.bolts = [];
  }
  const ts = _bgState.ts;
  ctx.clearRect(0, 0, w, h);
  // storm atmosphere — layered overcast, rolling mist, wind streaks
  const t = frame * 0.0015;
  // dark overcast ceiling — thick cloud cover across top third
  const overcast = ctx.createLinearGradient(0, 0, 0, h*0.45);
  overcast.addColorStop(0, "rgba(8,10,13,0.35)");
  overcast.addColorStop(0.3, "rgba(12,15,18,0.2)");
  overcast.addColorStop(0.7, "rgba(18,22,25,0.06)");
  overcast.addColorStop(1, "rgba(20,24,26,0)");
    ctx.fillStyle = overcast; ctx.fillRect(0, 0, w, h);
  // rolling fog banks — many overlapping soft layers
  if (!_bgState.tsFog || _bgState.tsFgw !== w || _bgState.tsFgh !== h) {
    _bgState.tsFog = []; _bgState.tsFgw = w; _bgState.tsFgh = h;
    for (let i = 0; i < 55; i++) {
      _bgState.tsFog.push({
        x: Math.random() * w,
        y: h * 0.5 + Math.random() * h * 0.5,
        r: h * 0.15 + Math.random() * h * 0.25,
        s: Math.random() * 0.12 + 0.04,
        o: Math.random() * 0.05 + 0.05,
        ph: Math.random() * 6.28
      });
    }
  }
  // heavy fog base layer at the bottom
  const fogBase = ctx.createLinearGradient(0, h * 0.7, 0, h);
  fogBase.addColorStop(0, "rgba(0, 0, 0, 0)");
  fogBase.addColorStop(0.3, "rgba(140, 155, 170, 0.015)");
  fogBase.addColorStop(0.7, "rgba(190, 200, 215, 0.05)");
  fogBase.addColorStop(1, "rgba(200, 210, 225, 0.08)");
  ctx.fillStyle = fogBase; ctx.fillRect(0, 0, w, h);
  for (const f of _bgState.tsFog) {
    f.x += f.s * Math.sin(t * 1.5 + f.ph) * 0.5;
    f.y += f.s * 0.03;
    if (f.x < -f.r) f.x = w + f.r;
    if (f.x > w + f.r) f.x = -f.r;
    if (f.y > h + f.r) { f.y = h * 0.5 + Math.random() * h * 0.1; f.x = Math.random() * w; }
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
    g.addColorStop(0, `rgba(200, 210, 225, ${f.o})`);
    g.addColorStop(0.3, `rgba(150, 165, 180, ${f.o * 0.55})`);
    g.addColorStop(0.6, `rgba(90, 100, 115, ${f.o * 0.15})`);
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
  }
  // rain
  ctx.strokeStyle = "rgba(150,175,210,0.4)"; ctx.lineWidth = 1.0;
  for (const r of ts.rain) {
    ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x - 0.5, r.y + r.l);
    ctx.stroke();
    r.y += r.s; r.x -= 0.6;
    if (r.y > h + 15) { r.y = -15; r.x = Math.random() * w; }
  }
  // lightning
  if (ts.flashTimer <= 0) {
    if (Math.random() < 0.004) {
      ts.flashTimer = 5 + Math.floor(Math.random()*7);
      ts.flashAlpha = 1;
      ts.bolts = [];
      const sx = w*(0.2 + Math.random()*0.6), ex = sx + (Math.random()-0.5)*w*0.25;
      const main = [sx, 0, ex, h*(0.45 + Math.random()*0.35)];
      const pts = _genBolt(main[0], main[1], main[2], main[3], 6);
      ts.bolts.push(pts);
      // branches
      const n = 1 + Math.floor(Math.random()*3);
      for (let b = 0; b < n; b++) {
        const bi = 2 + Math.floor(Math.random()*(pts.length/2 - 1));
        const br = Math.random()*0.4 + 0.25;
        ts.bolts.push(_genBolt(pts[bi].x, pts[bi].y, pts[bi].x + (Math.random()-0.5)*w*0.2, pts[bi].y + h*0.08 + Math.random()*h*0.12, 4));
      }
    }
  } else {
    ts.flashTimer--;
    ts.flashAlpha *= 0.6;
    if (ts.flashAlpha > 0.015) {
      for (const pts of ts.bolts) {
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = `rgba(140,170,240,${ts.flashAlpha*0.4})`; ctx.lineWidth = 8; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = `rgba(200,225,255,${ts.flashAlpha*0.7})`; ctx.lineWidth = 3; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = `rgba(250,250,255,${ts.flashAlpha})`; ctx.lineWidth = 1; ctx.stroke();
      }
      if (ts.bolts.length > 0 && ts.bolts[0].length > 0) {
        const bx = ts.bolts[0][0].x, by = h*0.12;
        const fg = ctx.createRadialGradient(bx, by, 0, bx, by, w*0.55);
        fg.addColorStop(0, `rgba(210,220,250,${ts.flashAlpha*0.16})`);
        fg.addColorStop(0.5, `rgba(180,195,240,${ts.flashAlpha*0.05})`);
        fg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = fg; ctx.fillRect(0, 0, w, h);
      }
    } else {
      ts.bolts = [];
    }
  }
}
function _genBolt(x1, y1, x2, y2, depth) {
  if (depth <= 0) return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  const mx = (x1 + x2)/2 + (Math.random()-0.5)*Math.abs(x2-x1)*0.35;
  const my = (y1 + y2)/2 + (Math.random()-0.5)*Math.abs(y2-y1)*0.35;
  const left = _genBolt(x1, y1, mx, my, depth-1);
  const right = _genBolt(mx, my, x2, y2, depth-1);
  left.pop();
  return [...left, ...right];
}
function applyColors() {
  const accentHex = state.settings.themeColor;
  const panelHex = state.settings.panelColorSynced ? accentHex : state.settings.panelColor;
  const accentRgb = hexToRgb(accentHex) ?? hexToRgb(DEFAULT_SETTINGS.themeColor);
  const panelRgb = hexToRgb(panelHex) ?? accentRgb;
  document.documentElement.style.setProperty("--accent", rgbToHex(accentRgb));
  document.documentElement.style.setProperty("--accent-rgb", `${Math.round(accentRgb.r)}, ${Math.round(accentRgb.g)}, ${Math.round(accentRgb.b)}`);
  document.documentElement.style.setProperty("--accent-ink", luminance(accentRgb) > .55 ? "#08110c" : "#f6fff8");
  document.documentElement.style.setProperty("--bg", rgbToHex(mix({ r: 0, g: 0, b: 0 }, accentRgb, .13)));
  const panel = mix({ r: 18, g: 22, b: 20 }, panelRgb, .16);
  const panel2 = mix({ r: 18, g: 22, b: 20 }, panelRgb, .28);
  document.documentElement.style.setProperty("--panel", rgbToHex(panel));
  document.documentElement.style.setProperty("--panel-2", rgbToHex(panel2));
  document.documentElement.style.setProperty("--panel-rgb", `${Math.round(panel.r)}, ${Math.round(panel.g)}, ${Math.round(panel.b)}`);
  document.documentElement.style.setProperty("--panel-2-rgb", `${Math.round(panel2.r)}, ${Math.round(panel2.g)}, ${Math.round(panel2.b)}`);
  document.documentElement.style.setProperty("--line", rgbToHex(mix({ r: 18, g: 22, b: 20 }, panelRgb, .48)));
  document.documentElement.style.setProperty("--muted", rgbToHex(mix({ r: 255, g: 255, b: 255 }, panelRgb, .34)));
  $("themeColorInput").value = rgbToHex(accentRgb);
  $("panelColorInput").value = rgbToHex(panelRgb);
  $("panelColorInput").disabled = state.settings.panelColorSynced;
  $("panelColorOverlay").hidden = !state.settings.panelColorSynced;
  $("panelColorSyncToggle").checked = state.settings.panelColorSynced;
}
function hexToRgb(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return null; const v = parseInt(m[1], 16); return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 }; }
function rgbToHex({ r, g, b }) { return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`; }
function mix(a, b, amount) { return { r: a.r + (b.r - a.r) * amount, g: a.g + (b.g - a.g) * amount, b: a.b + (b.b - a.b) * amount }; }
function luminance({ r, g, b }) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }

document.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", () => $(btn.dataset.close).close()));
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("pointerdown", (event) => { dialog.dataset.backdropPointerDown = event.target === dialog ? "true" : "false"; });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && dialog.dataset.backdropPointerDown === "true") dialog.close();
    dialog.dataset.backdropPointerDown = "false";
  });
  dialog.addEventListener("close", () => {
    if (dialog.id === "backgroundActionDialog") {
      hideSortMenu("backgroundEffectMenu", "backgroundEffectMenuBtn");
      document.body.classList.remove("background-effect-preview");
    }
  });
});
$("addGroupBtn").addEventListener("click", () => state.activePage === "worlds" ? addLocalWorldGroup() : openGroupDialog());
$("groupFilterMenuBtn").addEventListener("click", (event) => toggleSortMenu(event, "groupFilterSelect", "groupFilterMenu", "groupFilterMenuBtn", () => { state.groupFilter = $("groupFilterSelect").value; render(); }));
$("groupFilterMenuBtn").addEventListener("wheel", (event) => cycleSortOption(event, "groupFilterSelect", "groupFilterMenuBtn", () => { state.groupFilter = $("groupFilterSelect").value; render(); }), { passive: false });
$("editGroupBtn").addEventListener("click", () => openGroupDialog(activeGroup()));
$("copyGroupBtn").addEventListener("click", () => openCopyGroupDialog(activeGroup()));
$("deleteGroupBtn").addEventListener("click", () => deleteGroup(activeGroup()));
$("unfavoriteAllBtn").addEventListener("click", unfavoriteAllInActiveGroup);
$("checkDeletedFavoritesBtn").addEventListener("click", checkDeletedFavoritesManual);
$("addAvatarBtn").addEventListener("click", () => openAvatarDialog());
$("favoritesTabBtn").addEventListener("click", () => showPage("favorites", { userInitiated: true }));
$("databaseTabBtn").addEventListener("click", () => showPage("database", { userInitiated: true }));
$("friendsTabBtn").addEventListener("click", () => showPage("friends", { userInitiated: true }));
$("worldsTabBtn").addEventListener("click", () => showPage("worlds", { userInitiated: true }));
$("messagesTabBtn").addEventListener("click", () => showPage("messages", { userInitiated: true }));
$("notificationsTabBtn").addEventListener("click", () => showPage("notifications", { userInitiated: true }));
$("notificationBellBtn").addEventListener("click", toggleNotificationPopover);
$("notificationPopover").addEventListener("click", (event) => {
  event.stopPropagation();
  if (!event.target.closest(".notification-filter-control")) {
    hideSortMenu("notificationFilterMenu", "notificationFilterMenuBtn");
  }
});
$("hideUiBtn").addEventListener("click", () => setUiHidden(!$("hideUiBtn").matches('[aria-pressed="true"]')));
$("searchInput").addEventListener("input", resetAvatarPageAndRender);
$("sortMenuBtn").addEventListener("click", toggleSortMenu);
$("sortMenuBtn").addEventListener("wheel", (event) => cycleSortOption(event), { passive: false });
$("databaseSortMenuBtn").addEventListener("click", (event) => toggleSortMenu(event, "databaseSortSelect", "databaseSortMenu", "databaseSortMenuBtn", () => { state.avatarDatabasePage = 0; renderAvatarDatabaseResults(); }));
$("databaseSortMenuBtn").addEventListener("wheel", (event) => cycleSortOption(event, "databaseSortSelect", "databaseSortMenuBtn", () => { state.avatarDatabasePage = 0; renderAvatarDatabaseResults(); }), { passive: false });
$("worldDiscoveryFilterMenuBtn").addEventListener("click", (event) => toggleSortMenu(event, "worldDiscoveryFilterSelect", "worldDiscoveryFilterMenu", "worldDiscoveryFilterMenuBtn", renderVrchatSocial));
$("worldDiscoveryFilterMenuBtn").addEventListener("wheel", (event) => cycleSortOption(event, "worldDiscoveryFilterSelect", "worldDiscoveryFilterMenuBtn", renderVrchatSocial), { passive: false });
$("notificationFilterMenuBtn").addEventListener("click", (event) => toggleSortMenu(event, "notificationFilterSelect", "notificationFilterMenu", "notificationFilterMenuBtn", () => { state.notifications.filter = $("notificationFilterSelect").value; renderNotificationsPage(); }));
$("notificationFilterMenuBtn").addEventListener("wheel", (event) => cycleSortOption(event, "notificationFilterSelect", "notificationFilterMenuBtn", () => { state.notifications.filter = $("notificationFilterSelect").value; renderNotificationsPage(); }), { passive: false });
$("refreshNotificationsBtn").addEventListener("click", loadNotifications);
$("refreshPlayerActivityBtn").addEventListener("click", loadPlayerActivityLog);
$("clearPlayerActivityBtn").addEventListener("click", clearPlayerActivityLog);
$("refreshMessagesBtn").addEventListener("click", loadNotifications);
$("clearMessagesBtn").addEventListener("click", clearMessageHistory);
$("closeInlineMessageBtn").addEventListener("click", closeInlineMessagePanel);
setupInlineMessageResize();
$("messagePopupOpenBtn").addEventListener("click", openMessagePopupConversation);
$("messagePopupCloseBtn").addEventListener("click", dismissMessagePopup);
$("closeNotificationDetailsBtn").addEventListener("click", closeNotificationDetails);
$("notificationsList").addEventListener("click", (event) => {
  const item = event.target.closest("[data-notification-sender-id], [data-notification-sender-name]");
  if (item) {
    hideNotificationPopover();
    void openNotificationSender(item);
  }
});
$("notificationsList").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const item = event.target.closest("[data-notification-sender-id], [data-notification-sender-name]");
  if (!item) return;
  event.preventDefault();
  hideNotificationPopover();
  void openNotificationSender(item);
});
$("databaseFieldMenuBtn").addEventListener("click", toggleDatabaseFieldMenu);
$("databaseFieldMenu").addEventListener("click", (event) => event.stopPropagation());
$("settingsLogFilterMenuBtn").addEventListener("click", (event) => toggleSortMenu(event, "settingsLogFilterSelect", "settingsLogFilterMenu", "settingsLogFilterMenuBtn", () => { state.settingsLogFilter = $("settingsLogFilterSelect").value; loadSettingsLogs(); }));
$("settingsLogFilterMenuBtn").addEventListener("wheel", (event) => cycleSortOption(event, "settingsLogFilterSelect", "settingsLogFilterMenuBtn", () => { state.settingsLogFilter = $("settingsLogFilterSelect").value; loadSettingsLogs(); }), { passive: false });
document.addEventListener("click", hideContextMenu);
document.addEventListener("click", hideNotificationPopover);
document.addEventListener("dragover", autoScrollDrag);
document.addEventListener("wheel", wheelScrollDuringDrag, { passive: false, capture: true });
document.addEventListener("wheel", trackZoomWheel, { passive: true, capture: true });
document.addEventListener("keydown", (event) => {
  if (keyScrollDuringDrag(event)) return;
  if (event.key === "Escape") hideContextMenu();
  if (event.key !== "Tab" || document.querySelector("dialog[open]")) return;
  event.preventDefault();
    const pages = ["favorites", "database", "worlds", "friends", "messages", "notifications"];
  showPage(pages[(pages.indexOf(state.activePage) + 1) % pages.length] || "favorites", { userInitiated: true });
});
window.addEventListener("focus", () => {
  requestForegroundRefresh();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) requestForegroundRefresh();
});
document.addEventListener("auxclick", (event) => {
  if (event.button !== 3 && event.button !== 4) return;
  event.preventDefault();
  event.stopPropagation();
  const now = Date.now();
  if (now - state.lastSideMouseNavAt < 160) return;
  state.lastSideMouseNavAt = now;
  stepAppHistory(event.button === 3 ? -1 : 1);
}, true);
document.addEventListener("mouseup", (event) => {
  if (event.button !== 3 && event.button !== 4) return;
  event.preventDefault();
  event.stopPropagation();
  const now = Date.now();
  if (now - state.lastSideMouseNavAt < 160) return;
  state.lastSideMouseNavAt = now;
  stepAppHistory(event.button === 3 ? -1 : 1);
}, true);
$("avatarGrid").addEventListener("dragover", handleAvatarGridDragOver);
$("avatarGrid").addEventListener("drop", handleAvatarGridDrop);
$("avatarGrid").addEventListener("contextmenu", showAvatarGridContextMenu);
$("avatarGrid").addEventListener("click", handleAvatarGridClick);
$("groupList").addEventListener("dragover", handleGroupListDragOver);
$("groupList").addEventListener("drop", handleGroupListDrop);
$("gridSizeInput").addEventListener("input", () => { state.settings.gridSize = Number($("gridSizeInput").value); applyGridSize(); queueSaveSettings(); });
$("databaseGridSizeInput").addEventListener("input", () => { state.settings.databaseGridSize = Number($("databaseGridSizeInput").value); applyGridSize(); queueSaveSettings(); });
window.addEventListener("resize", applyGridSize);
window.addEventListener("resize", () => { if (_bgCanvas && _bgActive) { _bgCanvas.width = window.innerWidth; _bgCanvas.height = window.innerHeight; _bgState = {}; } });
$("customizationBtn").addEventListener("click", openSettingsDialog);
$("settingsCustomizationTab").addEventListener("click", () => setSettingsTab("customization"));
$("settingsSyncTab").addEventListener("click", () => setSettingsTab("sync"));
$("settingsDiagnosticsTab").addEventListener("click", () => setSettingsTab("diagnostics"));
$("settingsHistoryTab").addEventListener("click", () => setSettingsTab("history"));
$("settingsLogsTab").addEventListener("click", () => setSettingsTab("logs"));
$("settingsBackupsTab").addEventListener("click", () => setSettingsTab("backups"));
$("customizationDialog").addEventListener("close", () => {
  if (state.settingsDraft && !state.settingsDraft.applied) {
    const backgroundEffect = state.settings.backgroundEffect;
    state.settings = { ...state.settingsDraft.original };
    state.settings.backgroundEffect = backgroundEffect;
    applySettings();
  }
  clearTimeout(settingsLivePreviewTimer);
  document.body.classList.remove("settings-live-preview");
  state.settingsDraft = null;
});
$("syncedAvatarEditToggle").addEventListener("change", async (event) => { await setSyncedAvatarEditMode(event.target.checked); });
$("applySyncedAvatarOrderBtn").addEventListener("click", applySyncedAvatarEdit);
$("cancelSyncedAvatarOrderBtn").addEventListener("click", cancelSyncedAvatarEdit);
$("openGameBtn").addEventListener("click", async () => {
  if (!await confirmAction({ title: "Open Game", message: "Open VRChat in desktop mode?", confirmLabel: "Open", confirmClass: "primary" })) return;
  try { await api("openGame"); } catch (e) { toast(e.message); }
});
$("themeColorInput").addEventListener("input", () => { state.settings.themeColor = $("themeColorInput").value; if (state.settings.panelColorSynced) state.settings.panelColor = state.settings.themeColor; applyColors(); });
$("panelColorInput").addEventListener("input", () => { if (state.settings.panelColorSynced) return; state.settings.panelColor = $("panelColorInput").value; applyColors(); });
$("panelColorOverlay").addEventListener("click", () => confirmAction({
  title: "Panel Color Locked",
  message: "Turn off Sync colors to unlock the panel color picker.",
  confirmLabel: "OK",
  confirmClass: "primary",
  hideCancel: true
}));
$("panelColorSyncToggle").addEventListener("change", () => { state.settings.panelColorSynced = $("panelColorSyncToggle").checked; if (state.settings.panelColorSynced) state.settings.panelColor = state.settings.themeColor; applyColors(); });
$("backgroundOpacityInput").addEventListener("input", () => { state.settings.backgroundOpacity = Number($("backgroundOpacityInput").value); applyBackgroundOpacity(); });
$("backgroundOpacityNumber").addEventListener("input", syncBackgroundOpacityFromNumber);
$("backgroundOpacityPrevBtn").addEventListener("click", () => stepBackgroundOpacity(-1));
$("backgroundOpacityNextBtn").addEventListener("click", () => stepBackgroundOpacity(1));
$("panelOpacityInput").addEventListener("input", () => { state.settings.panelOpacity = Number($("panelOpacityInput").value); applyPanelOpacity(); });
$("panelOpacityNumber").addEventListener("input", syncPanelOpacityFromNumber);
$("panelOpacityPrevBtn").addEventListener("click", () => stepPanelOpacity(-1));
$("panelOpacityNextBtn").addEventListener("click", () => stepPanelOpacity(1));
[
  "themeColorInput",
  "panelColorInput",
  "backgroundOpacityInput",
  "backgroundOpacityNumber",
  "backgroundOpacityPrevBtn",
  "backgroundOpacityNextBtn",
  "panelOpacityInput",
  "panelOpacityNumber",
  "panelOpacityPrevBtn",
  "panelOpacityNextBtn"
].forEach(bindSettingsLivePreviewControl);
$("checkUpdateBtn").addEventListener("click", () => checkForUpdates());
$("resetThemeBtn").addEventListener("click", () => { state.settings.themeColor = DEFAULT_SETTINGS.themeColor; state.settings.panelColor = DEFAULT_SETTINGS.panelColor; state.settings.panelColorSynced = DEFAULT_SETTINGS.panelColorSynced; state.settings.backgroundOpacity = DEFAULT_SETTINGS.backgroundOpacity; state.settings.panelOpacity = DEFAULT_SETTINGS.panelOpacity; applySettings(); });
$("cancelSettingsBtn").addEventListener("click", cancelSettingsDialog);
$("applySettingsBtn").addEventListener("click", applySettingsDialog);
$("restoreBackupNewBtn").addEventListener("click", () => restoreBackup("new"));
$("restoreBackupReplaceBtn").addEventListener("click", () => restoreBackup("replace"));
$("refreshLogsBtn").addEventListener("click", loadSettingsLogs);
$("refreshSyncCenterBtn").addEventListener("click", loadSyncCenter);
$("refreshDiagnosticsBtn").addEventListener("click", loadDiagnostics);
$("refreshMetadataHistoryBtn").addEventListener("click", loadMetadataHistory);
$("refreshVrchatSocialBtn").addEventListener("click", () => loadVrchatSocial());
$("worldSearchBtn").addEventListener("click", () => { state.social.selectedWorldGroup = ""; loadVrchatSocial({ worldsOnly: true }); });
$("worldSearchInput").addEventListener("keydown", (event) => { if (event.key === "Enter") { state.social.selectedWorldGroup = ""; loadVrchatSocial({ worldsOnly: true }); } });
$("clearWorldSearchBtn").addEventListener("click", () => {
  $("worldSearchInput").value = "";
  state.social.selectedWorldGroup = "";
  state.social.worlds = [];
  renderVrchatSocial();
  setSocialHeaderStatus("worlds", state.social.favoriteWorlds.length ? `${state.social.favoriteWorlds.length} favorite worlds loaded.` : "Search and inspect VRChat worlds.");
});
$("randomWorldBtn").addEventListener("click", async () => {
  try {
    state.social.selectedWorldGroup = "";
    $("worldSearchInput").value = "";
    setSocialHeaderStatus("worlds", "Finding a random world...");
    const result = await api("vrchatWorldSearch", { sort: "random", order: "descending", limit: 50, offset: 0 }, 45000);
    const worlds = result.worlds || [];
    const world = worlds[Math.floor(Math.random() * worlds.length)];
    if (!world?.id) { toast("No random world was returned."); return; }
    state.social.worlds = [world];
    state.social.worldSections = [];
    renderVrchatSocial();
    await selectSocialWorld(world.id);
  } catch (e) {
    toast(e.message);
  }
});
$("friendsList").addEventListener("click", (event) => {
  const card = event.target.closest("[data-friend-id]");
  if (card) selectSocialFriend(card.dataset.friendId, { clickedPresence: card.dataset.presence });
});
$("worldResults").addEventListener("click", (event) => {
  const card = event.target.closest("[data-world-id]");
  if (card) selectSocialWorld(card.dataset.worldId);
});
$("copyLogsBtn").addEventListener("click", copySettingsLogs);
$("openLogsFolderBtn").addEventListener("click", openLogsFolder);
$("clearLogsBtn").addEventListener("click", clearSettingsLogs);
$("createAccountBackupBtn").addEventListener("click", createAccountBackup);
$("openAccountBackupsFolderBtn").addEventListener("click", openAccountBackupsFolder);
$("openBackupsFolderBtn").addEventListener("click", openBackupsFolder);
$("openBackgroundFolderBtn").addEventListener("click", () => openBackgroundDialog(""));
$("importBackgroundsBtn").addEventListener("click", () => { $("backgroundActionDialog").close(); importBackgrounds(state.pendingBackgroundGroupId); });
$("openBackgroundFolderActionBtn").addEventListener("click", () => { $("backgroundActionDialog").close(); openBackgroundFolderForTarget(state.pendingBackgroundGroupId); });
$("clearBackgroundsBtn").addEventListener("click", () => { $("backgroundActionDialog").close(); clearBackgrounds(state.pendingBackgroundGroupId); });
$("backgroundEffectMenuBtn").addEventListener("click", (event) => toggleSortMenu(event, "backgroundEffectSelect", "backgroundEffectMenu", "backgroundEffectMenuBtn", () => { void applyBackgroundDialogEffect(); }));
$("backgroundEffectMenuBtn").addEventListener("wheel", (event) => cycleSortOption(event, "backgroundEffectSelect", "backgroundEffectMenuBtn", () => { void applyBackgroundDialogEffect(); }), { passive: false });
$("changeGroupIconActionBtn").addEventListener("click", () => {
  const target = state.library.groups.find((item) => item.id === state.pendingGroupIconId);
  $("groupIconActionDialog").close();
  changeGroupIcon(target);
});
$("removeGroupIconActionBtn").addEventListener("click", () => {
  const target = state.library.groups.find((item) => item.id === state.pendingGroupIconId);
  $("groupIconActionDialog").close();
  removeGroupIcon(target);
});
$("editGroupIconBtn").addEventListener("click", (event) => {
  event.stopPropagation();
  openGroupIconDialog();
});
$("editGroupBackgroundBtn").addEventListener("click", (event) => {
  event.stopPropagation();
  const target = state.editingGroupId ? state.library.groups.find((item) => item.id === state.editingGroupId) : null;
  if (!target) return;
  openBackgroundDialog(target.id);
});
["thumbnailInput", "imageInput"].forEach((id) => $(id).addEventListener("input", updateAvatarPreview));
["tagsInput"].forEach((id) => $(id).addEventListener("input", updateAvatarDetailBadges));
$("avatarDetailThumbnailButton").addEventListener("click", () => { const image = $("imageInput").value.trim() || $("thumbnailInput").value.trim(); if (!image) return; $("imagePreviewFull").src = image; $("imagePreviewDialog").showModal(); });
$("avatarDetailAuthorBtn").addEventListener("click", showAvatarAuthorSearchOptions);
$("avatarDetailUpdated").addEventListener("click", showAvatarUpdateHistory);
["avatarNameInput", "avatarIdInput", "authorNameInput", "authorIdInput"].forEach((id) => $(id).addEventListener("input", updateAvatarAuthorAction));
$("copyAvatarIdBtn").addEventListener("click", async () => {
  const avatarId = $("avatarIdInput").value.trim();
  if (!avatarId) { toast("No avatar ID to copy."); return; }
  try {
    if (await copyTextToClipboard(avatarId)) toast("Avatar ID copied.");
    else toast("Could not copy avatar ID.");
  } catch (e) { handleAvatarAddError(e); }
});
$("fetchAvatarBtn").addEventListener("click", async (event) => { event.preventDefault(); try { setAvatarForm({ ...(await api("fetchAvatar", { id: $("avatarIdInput").value })), groupId: state.avatarDialogGroupId }); } catch (e) { toast(e.message); } });
$("saveAvatarBtn").addEventListener("click", (event) => { event.preventDefault(); resetAvatarGroupDialogMode(); $("saveAvatarGroupName").textContent = `Choose a group for "${$("avatarNameInput").value.trim() || $("avatarIdInput").value.trim() || "this avatar"}".`; fillSelectWithGroups($("saveAvatarGroupInput"), state.avatarDialogGroupId ?? state.activeGroupId); $("confirmSaveAvatarGroupBtn").disabled = !$("saveAvatarGroupInput").value; $("saveAvatarGroupDialog").showModal(); });
$("deleteAvatarBtn").addEventListener("click", async (event) => { event.preventDefault(); await deleteAvatarById(state.editingAvatarId, $("avatarNameInput").value); closeAvatarDetails(); });
$("equipAvatarBtn").addEventListener("click", async () => equipAvatar($("avatarIdInput").value));
$("closeAvatarDetailsBtn").addEventListener("click", closeAvatarDetails);
$("confirmSaveAvatarGroupBtn").addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    const groupId = $("saveAvatarGroupInput").value;
    if (!groupId) { toast("Choose a group."); return; }
    if (!canManuallyAddToGroup(groupId)) { toast("Recent and Deleted groups are managed automatically."); return; }
    if (state.pendingMoveAvatarId) {
      const avatarIds = state.pendingMoveAvatarIds?.length ? [...state.pendingMoveAvatarIds] : [state.pendingMoveAvatarId];
      const action = state.pendingAvatarGroupAction || "move";
      resetAvatarGroupDialogMode();
      $("saveAvatarGroupDialog").close();
      if (action === "copy") await copyAvatarsToGroup(avatarIds, groupId);
      else await moveAvatarsToGroup(avatarIds, groupId);
      return;
    }
    const avatarId = $("avatarIdInput").value.trim();
    const oldAvatar = state.editingAvatarId ? state.library.avatars.find((x) => x.id === state.editingAvatarId) : null;
    if (oldAvatar?.groupId !== groupId && !syncedGroupHasCapacity(groupId, avatarId || oldAvatar?.avatarId, oldAvatar?.id)) return;
    if (oldAvatar?.groupId !== groupId) await pushSyncedAvatarMove(avatarId || oldAvatar?.avatarId, oldAvatar?.groupId, groupId);
    else await pushSyncedAvatarAdd(avatarId || oldAvatar?.avatarId, groupId);
    state.avatarDialogGroupId = groupId;
    state.library = await api("saveAvatar", readAvatarForm(groupId));
    state.activeGroupId = groupId || state.activeGroupId;
    state.avatarPage = 0;
    $("saveAvatarGroupDialog").close();
    closeAvatarDetails();
    render();
  } catch (e) { handleAvatarAddError(e); }
});
$("saveGroupBtn").addEventListener("click", async (event) => { event.preventDefault(); try { state.library = await api(state.editingGroupId ? "updateGroup" : "createGroup", { id: state.editingGroupId ?? "", name: $("groupNameInput").value, icon: $("groupIconInput").value, description: $("groupDescriptionInput").value }); $("groupDialog").close(); render(); } catch (e) { toast(e.message); } });
$("copyGroupFullBtn").addEventListener("click", () => copyGroup(state.library.groups.find((group) => group.id === state.pendingCopyGroupId)));
$("copyGroupToExistingBtn").addEventListener("click", copyGroupToExisting);
$("avatarDatabaseSearchInput").addEventListener("input", () => { state.avatarDatabaseAuthorId = ""; });
$("avatarDatabaseSearchInput").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); runAvatarDatabaseSearch(0); } });
$("searchAvatarDatabaseBtn").addEventListener("click", () => runAvatarDatabaseSearch(0));
$("clearAvatarDatabaseBtn").addEventListener("click", clearAvatarDatabaseSearch);
$("avatarDatabaseProviderMenuBtn").addEventListener("click", (event) => toggleSortMenu(event, "avatarDatabaseProviderSelect", "avatarDatabaseProviderMenu", "avatarDatabaseProviderMenuBtn", () => {
  state.avatarDatabaseProvider = avatarDatabaseProvider();
  resetAvatarDatabaseResults();
  maybeShowVrcxDatabaseNotice();
}));
$("avatarDatabaseProviderMenuBtn").addEventListener("wheel", (event) => cycleSortOption(event, "avatarDatabaseProviderSelect", "avatarDatabaseProviderMenuBtn", () => {
  state.avatarDatabaseProvider = avatarDatabaseProvider();
  resetAvatarDatabaseResults();
  maybeShowVrcxDatabaseNotice();
}), { passive: false });
$("avatarDatabaseProviderSelect").addEventListener("change", () => {
  state.avatarDatabaseProvider = avatarDatabaseProvider();
  resetAvatarDatabaseResults();
  maybeShowVrcxDatabaseNotice();
});
["databaseSearchAvatarToggle", "databaseSearchAuthorToggle", "databaseSearchDescriptionToggle", "databaseSearchTagsToggle", "databasePlatformPcToggle", "databasePlatformAndroidToggle", "databasePlatformIosToggle"].forEach((id) => $(id).addEventListener("change", () => { state.avatarDatabaseAuthorId = ""; updateDatabaseFieldMenuButton(); }));
$("randomAvatarDatabaseBtn").addEventListener("click", runRandomAvatarDatabasePage);
$("equipRandomAvatarBtn").addEventListener("click", () => equipRandomDatabaseAvatar().catch(() => {}));
$("avatarRouletteBtn").addEventListener("click", () => openAvatarRouletteDialog('database'));
$("favRouletteBtn").addEventListener("click", () => openAvatarRouletteDialog('favorites'));
$("startAvatarRouletteBtn").addEventListener("click", startAvatarRoulette);
$("stopAvatarRouletteBtn").addEventListener("click", () => stopAvatarRoulette());
$("closeCaptchaDialogBtn").addEventListener("click", () => $("captchaDialog").close());
$("captchaDoneBtn").addEventListener("click", () => $("captchaDialog").close());
$("databasePrevPageBtn").addEventListener("click", async () => {
  if (state.avatarDatabaseMode === "random") { state.avatarDatabasePage = Math.max(0, state.avatarDatabasePage - 1); renderAvatarDatabaseResults(); }
  else await runAvatarDatabaseSearch(Math.max(0, state.avatarDatabasePage - 1));
  $("avatarDatabaseResults").scrollTop = 0;
});
$("databaseNextPageBtn").addEventListener("click", async () => {
  if (state.avatarDatabaseMode === "random") { state.avatarDatabasePage = Math.min(state.avatarDatabaseRandomPages.length - 1, state.avatarDatabasePage + 1); renderAvatarDatabaseResults(); }
  else await runAvatarDatabaseSearch(state.avatarDatabasePage + 1);
  $("avatarDatabaseResults").scrollTop = 0;
});
$("databasePageStatus").addEventListener("click", openDatabaseJumpDialog);
$("avatarPrevPageBtn").addEventListener("click", () => goAvatarPage(state.avatarPage - 1));
$("avatarNextPageBtn").addEventListener("click", () => goAvatarPage(state.avatarPage + 1));
$("avatarPageStatus").addEventListener("click", openAvatarJumpDialog);
$("databaseJumpPageInput").addEventListener("input", updateDatabaseJumpSlider);
$("databaseJumpPageNumber").addEventListener("input", syncDatabaseJumpFromNumber);
$("databaseJumpPrevBtn").addEventListener("click", () => stepDatabaseJump(-1));
$("databaseJumpNextBtn").addEventListener("click", () => stepDatabaseJump(1));
$("positionInput").addEventListener("input", updatePositionSlider);
$("positionNumber").addEventListener("input", syncPositionFromNumber);
$("positionPrevBtn").addEventListener("click", () => stepPosition(-1));
$("positionNextBtn").addEventListener("click", () => stepPosition(1));
$("confirmDatabaseJumpBtn").addEventListener("click", async (event) => {
  event.preventDefault();
  const requested = Math.floor(Number($("databaseJumpPageInput").value));
  const maxPage = databaseMaxPage();
  if (!Number.isFinite(requested) || requested < 1 || requested > maxPage) {
    toast(state.pageJumpTarget === "database" && state.avatarDatabaseTotal == null && state.avatarDatabaseCounting
      ? `Pages up to ${maxPage} are available while the total is still counting.`
      : `Enter a page from 1 to ${maxPage}.`);
    return;
  }
  $("databaseJumpDialog").close();
  if (state.pageJumpTarget === "avatars") {
    goAvatarPage(requested - 1);
  } else {
    if (state.avatarDatabaseMode === "random") { state.avatarDatabasePage = requested - 1; renderAvatarDatabaseResults(); }
    else await runAvatarDatabaseSearch(requested - 1);
    $("avatarDatabaseResults").scrollTop = 0;
  }
});
$("confirmPositionBtn").addEventListener("click", async (event) => {
  event.preventDefault();
  const edit = state.positionEdit;
  if (!edit) return;
  const max = Number($("positionInput").max) || 1;
  const position = Math.min(max, Math.max(1, Math.floor(Number($("positionInput").value)) || 1));
  $("positionDialog").close();
  if (edit.type === "group") await reorderGroup(edit.id, position);
  else await reorderAvatar(edit.id, edit.groupId, position);
});
$("confirmAddDatabaseAvatarBtn").addEventListener("click", async (event) => {
  event.preventDefault();
  const avatar = state.pendingDatabaseAvatar;
  if (!avatar) return;
  try {
    const groupId = $("databaseAvatarGroupInput").value;
    if (!groupId) { toast("Choose a group."); return; }
    if (!canManuallyAddToGroup(groupId)) { toast("Recent and Deleted groups are managed automatically."); return; }
    if (!syncedGroupHasCapacity(groupId, avatar.avatarId || avatar.id)) return;
    await pushSyncedAvatarAdd(avatar.avatarId || avatar.id, groupId);
    state.library = await api("saveAvatar", { ...avatar, id: "", groupId, source: avatar.source || (avatarDatabaseProvider() === "avtrzip" ? "avtrzip" : "avatar-database") });
    state.activeGroupId = groupId;
    state.avatarPage = 0;
    $("addDatabaseAvatarDialog").close();
    render();
    toast(`Added "${avatar.name || avatar.avatarId}".`);
  } catch (e) { handleAvatarAddError(e); }
});
$("loginBtn").addEventListener("click", () => showInlineLogin(true));
$("cancelInlineLoginBtn").addEventListener("click", () => showInlineLogin(false));
async function runInlineLogin() {
  try {
    state.vrchat = await api("vrchatLogin", { username: $("inlineLoginUsernameInput").value, password: $("inlineLoginPasswordInput").value });
    showInlineLogin(false);
    showInlineTwoFactor(state.vrchat.requiresTwoFactor);
    renderAccount();
    await refreshCurrentAvatarSummarySilent();
    await logCurrentAvatarSilent();
    if (state.vrchat?.isLoggedIn) {
      void startVrchatPipeline();
      void loadNotifications();
    }
  } catch (e) { $("loginStatus").textContent = e.message; }
}
async function runInlineTwoFactor() {
  try {
    state.vrchat = await api("vrchatTwoFactor", { code: $("inlineTwoFactorCodeInput").value, method: $("inlineTwoFactorMethodInput").value });
    showInlineTwoFactor(false);
    renderAccount();
    await refreshCurrentAvatarSummarySilent();
    await logCurrentAvatarSilent();
    if (state.vrchat?.isLoggedIn) {
      void startVrchatPipeline();
      void loadNotifications();
    }
  } catch (e) { $("twoFactorStatus").textContent = e.message; }
}
$("runInlineLoginBtn").addEventListener("click", runInlineLogin);
$("cancelInlineTwoFactorBtn").addEventListener("click", () => showInlineTwoFactor(false));
$("runInlineTwoFactorBtn").addEventListener("click", runInlineTwoFactor);
$("inlineLoginUsernameInput").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  $("inlineLoginPasswordInput").focus();
});
$("inlineLoginPasswordInput").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  runInlineLogin();
});
$("inlineTwoFactorPanel").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); runInlineTwoFactor(); } });
$("inlineTwoFactorMethodBtn").addEventListener("click", (event) => toggleSortMenu(event, "inlineTwoFactorMethodInput", "inlineTwoFactorMethodMenu", "inlineTwoFactorMethodBtn", () => {}));
$("accountStatus").addEventListener("click", (event) => {
  if (!state.vrchat?.isLoggedIn) return;
  event.stopPropagation();
  showContextMenu(event.clientX, event.clientY, [{ label: "Logout", className: "danger", action: async () => { if (await confirmAction({ title: "Logout", message: "Log out of VRChat?", confirmLabel: "Logout", confirmClass: "danger" })) await logoutVrChat(); } }]);
});
$("logoutBtn").addEventListener("click", async () => { if (await confirmAction({ title: "Logout", message: "Log out of VRChat?", confirmLabel: "Logout", confirmClass: "danger" })) await logoutVrChat(); });
$("saveCurrentAvatarBtn").addEventListener("click", async () => {
  try {
    if (state.activePage === "worlds") {
      const location = await api("vrchatCurrentLocation", {}, 45000);
      const worldId = location.worldId || location.world?.id || "";
      if (!worldId) { toast("You are not in a saveable world."); return; }
      const saved = await favoriteWorldWithPicker(worldId, location.world?.name || "your current world");
      if (!saved) return;
      toast("Current world saved.");
      return;
    }
    if (!canManuallyAddToGroup(state.activeGroupId)) { toast("Recent and Deleted groups are managed automatically."); return; }
    const avatar = await api("vrchatCurrentAvatar", { groupId: state.activeGroupId });
    if (!syncedGroupHasCapacity(state.activeGroupId, avatar.avatarId || avatar.id)) return;
    await pushSyncedAvatarAdd(avatar.avatarId || avatar.id, state.activeGroupId);
    state.library = await api("saveAvatar", { ...avatar, groupId: state.activeGroupId, source: "vrchat" });
    render();
  } catch (e) { toast(e.message); }
});
$("currentAvatarCard").addEventListener("click", () => { void openMyProfile(); });
$("importBtn").addEventListener("click", () => { $("importJsonInput").value = ""; $("importDialog").showModal(); });
$("runImportBtn").addEventListener("click", async (event) => { event.preventDefault(); await importJsonText($("importJsonInput").value); });
["groupList", "importDropZone"].forEach((id) => {
  const el = $(id);
  el.addEventListener("dragover", (event) => {
    if (!dragHasJsonFile(event)) return;
    event.preventDefault();
    el.classList.add("drag-over");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
  el.addEventListener("drop", handleJsonDrop);
});
$("exportBtn").addEventListener("click", (event) => { event.stopPropagation(); showContextMenu(event.clientX, event.clientY, [{ label: "Export All Groups", action: () => runExport("all") }, { label: `Export "${activeGroup()?.name ?? "Current Group"}"`, action: () => runExport("current") }]); });
async function runExport(scope) { try { const result = scope === "current" ? await api("exportGroup", { id: state.activeGroupId }) : await api("exportLibrary"); toast(`Exported to ${result.path}`); if (await confirmAction({ title: "Open Export Folder", message: "Export complete. Open the export folder?", confirmLabel: "Open", confirmClass: "primary" })) await api("openFolder", { path: result.path }); } catch (e) { toast(e.message); } }
async function importJsonText(text) {
  try {
    state.library = await api("importLibrary", JSON.parse(text));
    state.activeGroupId = state.library.groups.at(-1)?.id ?? state.activeGroupId;
    $("importDialog").close();
    render();
    toast("Imported as a new group.");
  } catch (e) { toast(e.message); }
}
function handleJsonDrop(event) {
  if (state.dragSort) return;
  event.preventDefault();
  document.querySelectorAll(".drag-over").forEach((x) => x.classList.remove("drag-over"));
  const file = [...event.dataTransfer.files].find((x) => x.name.toLowerCase().endsWith(".json"));
  if (!file) { toast("Drop a JSON file."); return; }
  const reader = new FileReader();
  reader.onload = () => {
    $("importJsonInput").value = String(reader.result ?? "");
    if (!$("importDialog").open) $("importDialog").showModal();
    toast("JSON loaded. Select Import to add it.");
  };
  reader.readAsText(file);
}
function dragHasJsonFile(event) {
  const items = [...(event.dataTransfer?.items || [])];
  if (!items.length) return false;
  return items.some((item) => item.kind === "file" && (!item.type || item.type === "application/json" || item.type === "text/json" || item.type === "text/plain"));
}

updateAvatarDatabaseCopy();
updateDatabaseFieldMenuButton();
loadWorldLocalGroups();
Promise.all([loadLibrary(), loadSettings(), loadMessageHistory()])
  .then(() => {
    state.activePage = "favorites";
    renderFavoritesView();
    pushAppHistory();
    requestAnimationFrame(applyGridSize);
    void loadBackground();
    void loadSession();
    setTimeout(checkPasDatabaseUpdate, 1200);
    setTimeout(() => checkForUpdates({ automatic: true }), 2500);
  })
  .catch((e) => toast(e.message));
