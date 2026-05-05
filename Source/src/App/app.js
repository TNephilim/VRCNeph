const DEFAULT_SETTINGS = { gridSize: 10, databaseGridSize: 10, themeColor: "#303735", backgroundOpacity: 20, panelOpacity: 35, schemaVersion: 6 };
const AVATAR_PAGE_SIZE = 50;
const SYNCED_GROUP_AVATAR_LIMIT = 50;
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
  avatarRouletteRunning: false,
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
  positionEdit: null,
  vrchatStartupSyncDone: false,
  vrchatSyncBusy: false,
  vrchatSyncLoggedIn: false,
  vrchatAvatarFavoriteGroupLimit: 1,
  settingsLogFilter: "all",
  settingsSaveTimer: null,
  settingsDraft: null,
  pendingBackupRestore: null,
  activePage: "favorites",
  lastLoggedCurrentAvatarId: "",
  currentAvatarSummary: { id: "", name: "" },
  vrchat: { isLoggedIn: false, requiresTwoFactor: false, twoFactorMethods: [], user: null },
  settings: { ...DEFAULT_SETTINGS },
  pending: new Map()
};
const $ = (id) => document.getElementById(id);
const BASE_DEVICE_PIXEL_RATIO = window.devicePixelRatio || 1;
let updatePromptShown = false;
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
  render();
}
async function loadSession() {
  state.vrchat = await api("vrchatSession");
  renderAccount();
  await refreshCurrentAvatarSummarySilent();
  await logCurrentAvatarSilent();
}
async function logoutVrChat() {
  state.syncedAvatarEdit = { groupId: "", avatarIds: [], backupPath: "", applying: false };
  updateVrChatBackgroundSyncTimer(false);
  state.vrchat = await api("vrchatLogout");
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
      gridSize: Number.isFinite(saved.gridSize) ? Math.min(10, Math.max(5, Number(saved.gridSize))) : DEFAULT_SETTINGS.gridSize,
      databaseGridSize: Number.isFinite(saved.databaseGridSize) ? Math.min(10, Math.max(5, Number(saved.databaseGridSize))) : Number.isFinite(saved.gridSize) ? Math.min(10, Math.max(5, Number(saved.gridSize))) : DEFAULT_SETTINGS.databaseGridSize,
      themeColor: /^#[0-9a-f]{6}$/i.test(saved.themeColor || "") ? saved.themeColor : DEFAULT_SETTINGS.themeColor,
      backgroundOpacity: Number.isFinite(saved.backgroundOpacity) ? Math.min(100, Math.max(0, Number(saved.backgroundOpacity))) : DEFAULT_SETTINGS.backgroundOpacity,
      panelOpacity: Number.isFinite(saved.panelOpacity) ? Math.min(100, Math.max(0, Number(saved.panelOpacity))) : DEFAULT_SETTINGS.panelOpacity,
      schemaVersion: DEFAULT_SETTINGS.schemaVersion
    };
  } catch { state.settings = { ...DEFAULT_SETTINGS }; }
  applySettings();
}
async function loadBackground() {
  try {
    const bg = await api("backgroundGet");
    renderBackground(bg);
  } catch { renderBackground(null); }
}
async function saveSettings() { try { state.settings = await api("settingsSave", state.settings); applySettings(); } catch (e) { toast(e.message); } }
function queueSaveSettings() { clearTimeout(state.settingsSaveTimer); state.settingsSaveTimer = setTimeout(saveSettings, 220); }

function render() { renderPageTabs(); renderGroups(); renderToolbar(); renderAvatars(); renderAvatarDatabaseResults(); renderAccount(); }
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
  if (!isSyncedGroup(groupId) && !isPinnedSystemGroup(groupId) && icon) {
    return icon.startsWith("data:image/")
      ? `<span class="custom-group-icon image" title="Group icon"><img src="${escapeAttr(icon)}" alt=""></span>`
      : `<span class="custom-group-icon" title="Group icon">${escapeHtml(icon)}</span>`;
  }
  if (isUpdatedGroup(groupId)) return `<span class="updated-icon" title="Updated avatars" aria-hidden="true"></span>`;
  if (isUploadedGroup(groupId)) return `<span class="uploaded-icon" title="Uploaded avatars" aria-hidden="true"></span>`;
  if (isSyncedGroup(groupId)) return `<span class="sync-icon" title="Synced from VRChat">&#8635;</span>`;
  if (isRecentGroup(groupId)) return `<span class="recent-icon" title="Recent avatars" aria-hidden="true"></span>`;
  if (isDeletedGroup(groupId)) return `<span class="trash-icon" title="Deleted avatars" aria-hidden="true"></span>`;
  return "";
}
function setGroupIconPreview(icon = "") {
  const preview = $("groupIconPreview");
  const value = String(icon || "").trim();
  preview.hidden = !value;
  $("removeGroupIconBtn").disabled = !value;
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
  $("favoritesTabBtn").classList.toggle("active", state.activePage === "favorites");
  $("databaseTabBtn").classList.toggle("active", state.activePage === "database");
}
function showPage(page) {
  const pageChanged = page !== state.activePage;
  if (pageChanged) exitSyncedAvatarEditMode("Edit mode turned off.");
  if (page !== state.activePage && !$("avatarDetailsPanel").hidden) closeAvatarDetails();
  state.activePage = page;
  renderPageTabs();
  if (pageChanged) renderToolbar();
  requestAnimationFrame(applyGridSize);
  if (page === "database") $("avatarDatabaseSearchInput").focus();
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
  const card = $("currentAvatarCard");
  if (loggedIn && user?.currentAvatarId) {
    card.hidden = false;
    $("currentAvatarImage").src = user.currentAvatarThumbnailImageUrl || user.currentAvatarImageUrl || "";
    $("currentAvatarImage").hidden = !$("currentAvatarImage").src;
    $("currentAvatarName").textContent = state.currentAvatarSummary.id === user.currentAvatarId && state.currentAvatarSummary.name ? state.currentAvatarSummary.name : user.currentAvatarId;
    $("currentAvatarId").textContent = "";
  } else {
    card.hidden = true;
    $("currentAvatarImage").src = "";
    state.currentAvatarSummary = { id: "", name: "" };
    $("currentAvatarName").textContent = "Unknown avatar";
    $("currentAvatarId").textContent = "";
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
  list.innerHTML = "";
  $("groupFilterSelect").value = state.groupFilter;
  updateSortButton("groupFilterSelect", "groupFilterMenuBtn");
  const allGroups = orderedGroups();
  const groups = filteredGroups();
  ensureActiveGroupExists();
  if (!groups.length) {
    list.innerHTML = `<div class="group-empty">No ${state.groupFilter === "synced" ? "synced" : "local"} groups</div>`;
    return;
  }
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
      render();
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
        { label: "Edit Group", disabled: pinned || synced, action: () => openGroupDialog(group) },
        { label: "Change Group Icon", disabled: pinned || synced, action: () => changeGroupIcon(group) },
        { label: "Remove Group Icon", disabled: pinned || synced || !String(group.icon || "").trim(), action: () => removeGroupIcon(group) },
        { label: "Copy Group", disabled: pinned, action: () => openCopyGroupDialog(group) },
        { label: "Delete Group", className: "danger", disabled: pinned || synced, action: () => deleteGroup(group) }
      ];
      showContextMenu(event.clientX, event.clientY, actions);
    });
    list.appendChild(item);
  }
}
function renderToolbar() {
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
  $("editGroupBtn").hidden = systemGroup || synced;
  $("copyGroupBtn").hidden = systemGroup;
  $("deleteGroupBtn").hidden = systemGroup || synced;
  $("addAvatarBtn").hidden = systemGroup;
  $("editGroupBtn").disabled = synced;
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
  normalizeAvatarSortForActiveGroup();
  updateSortButton();
  updateSortButton("databaseSortSelect", "databaseSortMenuBtn");
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
    card.innerHTML = `<button type="button"><div class="thumb">${image ? `<img src="${escapeAttr(image)}" alt="">` : "<span>No thumbnail</span>"}</div><div class="avatar-info"><div class="avatar-name">${escapeHtml(avatar.name)}</div><div class="meta-line">${escapeHtml(avatar.authorName || "Unknown author")}</div><div class="badges">${release ? `<span class="badge ${release.className}">${escapeHtml(release.label)}</span>` : ""}${platformBadgeLabels(avatar.platforms).map((p) => `<span class="badge ${p.className}">${escapeHtml(p.label)}</span>`).join("")}</div></div></button><div class="avatar-card-footer"><button class="avatar-position" type="button" title="${reorderTitle}" ${canReorderCurrentGroup ? "" : "disabled"}>#${listPosition(orderedAvatars, avatar.id)}</button><button class="avatar-card-equip primary" type="button" title="Equip avatar">Equip</button></div>`;
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
  if (group && (isPinnedSystemGroup(group.id) || isSyncedGroup(group.id))) return;
  state.editingGroupId = group?.id ?? null;
  $("groupDialogTitle").textContent = group ? "Edit Group" : "Add Group";
  $("groupNameInput").value = group?.name ?? "";
  $("groupIconInput").value = group?.icon ?? "";
  $("groupIconWrap").hidden = !group || isPinnedSystemGroup(group.id) || isSyncedGroup(group.id);
  setGroupIconPreview(group?.icon ?? "");
  $("groupDescriptionInput").value = group?.description ?? "";
  $("groupDialog").showModal();
}
async function pickGroupIcon() {
  const result = await api("pickGroupIcon");
  return result?.canceled ? "" : String(result?.icon || "");
}
async function changeGroupIcon(group = null) {
  const target = group || (state.editingGroupId ? state.library.groups.find((item) => item.id === state.editingGroupId) : null);
  if (!target || isPinnedSystemGroup(target.id) || isSyncedGroup(target.id)) return;
  try {
    const icon = await pickGroupIcon();
    if (!icon) return;
    if ($("groupDialog").open && state.editingGroupId === target.id) {
      $("groupIconInput").value = icon;
      setGroupIconPreview(icon);
      return;
    }
    state.library = await api("updateGroup", { id: target.id, name: target.name, description: target.description || "", icon });
    render();
  } catch (e) { toast(e.message); }
}
async function removeGroupIcon(group = null) {
  const target = group || (state.editingGroupId ? state.library.groups.find((item) => item.id === state.editingGroupId) : null);
  if (!target || isPinnedSystemGroup(target.id) || isSyncedGroup(target.id)) return;
  try {
    if ($("groupDialog").open && state.editingGroupId === target.id) {
      $("groupIconInput").value = "";
      setGroupIconPreview("");
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
  $("avatarIdInput").value = avatar.avatarId ?? "";
  $("avatarNameInput").value = avatar.name ?? "";
  $("authorNameInput").value = avatar.authorName ?? "";
  $("authorIdInput").value = avatar.authorId ?? "";
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
}
function mergeAvatarDetailMetadata(details) {
  if (!details || $("avatarIdInput").value.trim() !== String(details.avatarId || details.id || "").trim()) return;
  state.avatarDialogHistory = { ...(state.avatarDialogHistory || {}), ...details };
  state.avatarDialogSource = details.source || state.avatarDialogSource;
  if (!isPlaceholderAvatarName(details.name)) $("avatarNameInput").value = details.name;
  if (details.authorName) $("authorNameInput").value = details.authorName;
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
  $("avatarDetailBadges").innerHTML = `${release ? `<span class="badge ${release.className}">${escapeHtml(release.label)}</span>` : ""}${$("versionInput").value ? `<span class="badge">v${escapeHtml($("versionInput").value)}</span>` : ""}${databasePlatformBadgeLabels($("platformsInput").value).map((p) => `<span class="badge ${p.className}">${escapeHtml(p.label)}</span>`).join("")}`;
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
  if (provider === "all") return "Search AVTRZIP, Prismic PAS, and VRCX DB.";
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
      ? "Enter a search, then press Search or Enter to search every database."
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
  state.avatarDatabaseLoading = true;
  renderAvatarDatabaseResults();
  $("avatarDatabaseStatus").textContent = page > 0
    ? `Loading ${providerLabel} page ${page + 1}...`
    : state.avatarDatabaseProvider === "all"
      ? "Searching all databases..."
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
    state.avatarDatabaseCounting = page === 0 && state.avatarDatabaseResults.length > 0 && state.avatarDatabaseTotal == null;
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
function openAvatarRouletteDialog() {
  $("avatarRouletteStatus").textContent = state.avatarRouletteRunning ? "Avatar roulette is running." : "Equip a random favorite avatar on a timer.";
  $("stopAvatarRouletteBtn").disabled = !state.avatarRouletteRunning;
  $("startAvatarRouletteBtn").textContent = state.avatarRouletteRunning ? "Restart" : "Start";
  $("avatarRouletteDialog").showModal();
}
function avatarRouletteIntervalMs() {
  const value = Math.max(5, Math.floor(Number($("avatarRouletteIntervalInput").value)) || 60);
  $("avatarRouletteIntervalInput").value = String(value);
  return value * ($("avatarRouletteUnitInput").value === "minutes" ? 60000 : 1000);
}
function stopAvatarRoulette({ notify = true } = {}) {
  if (state.avatarRouletteTimer) clearInterval(state.avatarRouletteTimer);
  state.avatarRouletteTimer = null;
  state.avatarRouletteRunning = false;
  if ($("avatarRouletteDialog").open) {
    $("avatarRouletteStatus").textContent = "Avatar roulette stopped.";
    $("stopAvatarRouletteBtn").disabled = true;
    $("startAvatarRouletteBtn").textContent = "Start";
  }
  if (notify) toast("Avatar roulette stopped.");
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
  try {
    const avatar = randomFavoriteAvatar();
    if (!avatar) throw new Error("No favorite avatars available for roulette.");
    await equipAvatar(avatar.avatarId || avatar.id, avatar);
    $("avatarDatabaseStatus").textContent = `Roulette equipped: ${avatar.name || avatar.avatarId || avatar.id}.`;
    if ($("avatarRouletteDialog").open) $("avatarRouletteStatus").textContent = `Last equipped: ${avatar.name || avatar.avatarId || avatar.id}.`;
  } catch (e) {
    stopAvatarRoulette({ notify: false });
    const message = e?.message || String(e || "Avatar roulette stopped.");
    toast(message);
    if ($("avatarRouletteDialog").open) $("avatarRouletteStatus").textContent = message;
  }
}
function startAvatarRoulette() {
  stopAvatarRoulette({ notify: false });
  const interval = avatarRouletteIntervalMs();
  state.avatarRouletteRunning = true;
  state.avatarRouletteTimer = setInterval(runAvatarRouletteTick, interval);
  $("avatarRouletteStatus").textContent = "Avatar roulette started.";
  $("stopAvatarRouletteBtn").disabled = false;
  $("startAvatarRouletteBtn").textContent = "Restart";
  $("avatarRouletteDialog").close();
  toast("Avatar roulette started.");
  void runAvatarRouletteTick();
}
function updateAvatarDatabaseStatus() {
  const count = state.avatarDatabaseResults.length;
  const providerLabel = avatarDatabaseProviderLabel(state.avatarDatabaseProvider);
  if (!count) { $("avatarDatabaseStatus").textContent = `No ${providerLabel} avatars found.`; return; }
  if (state.avatarDatabaseTotal == null) {
    if (state.avatarDatabaseProvider === "all") {
      $("avatarDatabaseStatus").textContent = state.avatarDatabaseCounting
        ? "Counting total all databases avatars..."
        : `${state.avatarDatabasePage * 50 + count} all databases avatars shown.`;
      return;
    }
    const estimate = state.avatarDatabaseHasMore ? `${Math.max((state.avatarDatabasePage + 2) * 50, count)}+` : String(state.avatarDatabasePage * 50 + count);
    $("avatarDatabaseStatus").textContent = `${estimate} total ${providerLabel} avatars found.`;
    return;
  }
  $("avatarDatabaseStatus").textContent = `${state.avatarDatabaseTotal} total ${providerLabel} avatars found.`;
}
async function countAvatarDatabaseTotal(query, token, payload) {
  try {
    const result = await api("avatarDatabaseCount", payload ?? databaseSearchPayload(query, 0));
    if (token !== state.avatarDatabaseSearchToken || state.avatarDatabaseQuery !== query) return;
    state.avatarDatabaseTotal = Number(result.total) || state.avatarDatabaseResults.length;
    state.avatarDatabaseCounting = false;
    updateAvatarDatabaseStatus();
    renderAvatarDatabaseResults();
  } catch (e) {
    if (token === state.avatarDatabaseSearchToken && state.avatarDatabaseQuery === query) {
      state.avatarDatabaseCounting = false;
      updateAvatarDatabaseStatus();
    }
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
function queueAvatarDatabaseSearch({ clearAuthorId = true } = {}) {
  if (clearAuthorId) state.avatarDatabaseAuthorId = "";
  clearTimeout(state.avatarDatabaseSearchTimer);
  state.avatarDatabaseSearchTimer = setTimeout(() => runAvatarDatabaseSearch(0), 900);
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
    card.innerHTML = `<button type="button"><div class="thumb">${image ? `<img src="${escapeAttr(image)}" alt="">` : "<span>No thumbnail</span>"}</div><div class="avatar-info"><div class="avatar-name">${escapeHtml(avatar.name || avatar.avatarId)}</div><div class="meta-line">${escapeHtml(avatar.authorName || "Unknown author")}</div><div class="badges">${release ? `<span class="badge ${release.className}">${escapeHtml(release.label)}</span>` : ""}${databasePlatformBadgeLabels(avatar.platforms).map((p) => `<span class="badge ${p.className}">${escapeHtml(p.label)}</span>`).join("")}${sourceBadges}</div></div></button><div class="avatar-card-footer"><button class="avatar-card-save primary" type="button" title="Save avatar">Save</button><button class="avatar-card-equip primary" type="button" title="Equip avatar">Equip</button></div>`;
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
  return Math.max(1, state.avatarDatabasePage + (state.avatarDatabaseHasMore ? 2 : 1));
}
function updateDatabaseJumpSlider() {
  const maxPage = databaseMaxPage();
  const page = Math.min(maxPage, Math.max(1, Math.floor(Number($("databaseJumpPageInput").value)) || 1));
  $("databaseJumpPageInput").value = String(page);
  $("databaseJumpPageNumber").value = $("databaseJumpPageInput").value;
  $("databaseJumpPageNumber").max = String(maxPage);
  $("databaseJumpPageMax").textContent = String(maxPage);
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
function hideContextMenu() { $("contextMenu").hidden = true; hideSortMenu(); hideSortMenu("databaseSortMenu", "databaseSortMenuBtn"); hideSortMenu("groupFilterMenu", "groupFilterMenuBtn"); hideSortMenu("avatarDatabaseProviderMenu", "avatarDatabaseProviderMenuBtn"); hideSortMenu("settingsLogFilterMenu", "settingsLogFilterMenuBtn"); hideDatabaseFieldMenu(); }
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
function renderSortMenu(selectId = "sortSelect", menuId = "sortMenu", buttonId = "sortMenuBtn", onChange = resetAvatarPageAndRender) {
  const select = $(selectId);
  const menu = $(menuId);
  if (selectId === "sortSelect") normalizeAvatarSortForActiveGroup();
  menu.innerHTML = visibleSortOptions(selectId).map((o) => `<button type="button" data-value="${escapeAttr(o.value)}" aria-checked="${o.selected}">${escapeHtml(o.textContent)}</button>`).join("");
  menu.querySelectorAll("button").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); select.value = b.dataset.value; hideSortMenu(menuId, buttonId); updateSortButton(selectId, buttonId); onChange(); }));
}
function updateSortButton(selectId = "sortSelect", buttonId = "sortMenuBtn") { const s = $(selectId); $(buttonId).textContent = s.options[s.selectedIndex]?.textContent ?? "Sort"; }
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
  hideDatabaseFieldMenu();
  updateSortButton(selectId, buttonId);
  onChange();
}
function hideSortMenu(menuId = "sortMenu", buttonId = "sortMenuBtn") {
  $(menuId).hidden = true;
  $(buttonId).setAttribute("aria-expanded", "false");
  $(buttonId).closest(".sort-control")?.classList.remove("open");
}
function toggleSortMenu(event, selectId = "sortSelect", menuId = "sortMenu", buttonId = "sortMenuBtn", onChange = resetAvatarPageAndRender) {
  event.stopPropagation();
  if (!$(menuId).hidden) return hideSortMenu(menuId, buttonId);
  renderSortMenu(selectId, menuId, buttonId, onChange);
  document.querySelectorAll(".sort-control.open").forEach((el) => el.classList.remove("open"));
  $(menuId).hidden = false;
  $(buttonId).setAttribute("aria-expanded", "true");
  $(buttonId).closest(".sort-control")?.classList.add("open");
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
function setAvatarDragPreview(event, element) {
  if (!event.dataTransfer || !element) return;
  const rect = element.getBoundingClientRect();
  const preview = element.cloneNode(true);
  preview.classList.add("drag-preview");
  preview.style.width = `${rect.width}px`;
  preview.style.height = `${rect.height}px`;
  preview.style.position = "fixed";
  preview.style.left = "-10000px";
  preview.style.top = "-10000px";
  preview.style.pointerEvents = "none";
  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(preview, rect.width / 2, rect.height + 16);
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
  try {
    $("activeGroupDescription").textContent = "Starting synced order save...";
    const result = await api("applySyncedAvatarOrder", { groupId: group.id, avatarIds: savedOrder }, 1800000);
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
async function moveAvatarRelativeToTarget(id, targetAvatar, placement, copy = false) {
  return moveAvatarsRelativeToTarget([id], targetAvatar, placement, copy);
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
async function moveOrCopyAvatarToGroup(id, groupId) {
  return moveOrCopyAvatarsToGroup([id], groupId);
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
  return new Promise((resolve) => {
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
  });
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
  await api("vrchatFavoriteAdd", { avatarId, groupId });
}
async function pushSyncedAvatarRemove(avatarId, groupId) {
  if (!isSyncedGroup(groupId) || !state.vrchat?.isLoggedIn || !avatarId) return;
  await api("vrchatFavoriteRemove", { avatarId, groupId });
}
function syncedAvatarRemovalPayload(avatar) {
  if (!avatar || !isSyncedGroup(avatar.groupId)) return null;
  const avatarId = avatar.avatarId || avatar.id;
  return avatarId ? { avatarId, groupId: avatar.groupId, name: avatar.name || avatarId } : null;
}
function removeSyncedAvatarsInBackground(removals) {
  const queue = removals.filter(Boolean);
  if (!queue.length) return;
  void (async () => {
    let failed = 0;
    for (const removal of queue) {
      try {
        await pushSyncedAvatarRemove(removal.avatarId, removal.groupId);
      } catch {
        failed++;
      }
    }
    if (failed) toast(failed === 1 ? "VRChat unfavorite failed. Sync may add it back." : `${failed} VRChat unfavorites failed. Sync may add them back.`);
  })();
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
    state.currentAvatarSummary = { id: currentAvatarId, name: avatar?.name || currentAvatarId };
    renderAccount();
  } catch {
    state.currentAvatarSummary = { id: currentAvatarId, name: currentAvatarId };
    renderAccount();
  }
}
async function syncVrChatFavoritesSilent() {
  if (!state.vrchat?.isLoggedIn || state.vrchatSyncBusy || state.syncedAvatarEdit.groupId) return;
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
    state.vrchat = await api("vrchatSession");
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
function updateVrChatSyncTimer() {
  if (!state.vrchat?.isLoggedIn) {
    state.vrchatStartupSyncDone = false;
    updateVrChatBackgroundSyncTimer(false);
    return;
  }
  updateVrChatBackgroundSyncTimer(true);
  if (state.vrchatStartupSyncDone) return;
  state.vrchatStartupSyncDone = true;
  syncVrChatFavoritesSilent();
}
function updateVrChatBackgroundSyncTimer(enabled = Boolean(state.vrchat?.isLoggedIn)) {
  if (state.vrchatBackgroundSyncTimer) {
    clearInterval(state.vrchatBackgroundSyncTimer);
    state.vrchatBackgroundSyncTimer = null;
  }
  if (!enabled) return;
  state.vrchatBackgroundSyncTimer = setInterval(() => {
    if (!state.vrchat?.isLoggedIn || state.activePage !== "favorites") return;
    syncVrChatFavoritesSilent();
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
    state.vrchat = await api("vrchatSession");
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
  confirmAction({
    title: "Updated Avatars",
    message,
    confirmLabel: "OK",
    confirmClass: "primary",
    hideCancel: true
  });
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
  try {
    state.vrchatSyncBusy = true;
    renderToolbar();
    const result = await api("clearGroupAvatars", { id: group.id }, 1800000);
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
  $("customizationDialog").showModal();
  setSettingsTab("customization");
}
function setSettingsTab(tab) {
  const tabs = ["customization", "logs", "backups"];
  for (const name of tabs) {
    $(`settings${name[0].toUpperCase()}${name.slice(1)}Tab`).classList.toggle("active", name === tab);
    $(`settings${name[0].toUpperCase()}${name.slice(1)}Panel`).hidden = name !== tab;
  }
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
    const result = await api("backupList");
    const files = result.files || [];
    list.innerHTML = files.length
      ? files.map((file) => `<div class="settings-list-item"><div><strong>${escapeHtml(file.displayName || file.name)}</strong><span>${escapeHtml(file.reason || "Backup")} - ${escapeHtml(new Date(file.lastModified).toLocaleString())}</span></div><small>${escapeHtml(formatFileSize(file.size))}</small><button type="button" class="restore-action" data-backup-path="${escapeAttr(file.path)}" data-backup-name="${escapeAttr(file.displayName || file.name)}">Restore</button></div>`).join("")
      : `<div class="settings-empty"><h4>No backups</h4><p>Backups will appear here after group edits, synced order saves, or cleanup moves.</p></div>`;
    list.querySelectorAll("[data-backup-path]").forEach((button) => button.addEventListener("click", () => openBackupRestoreDialog(button.dataset.backupPath, button.dataset.backupName)));
  } catch (e) {
    list.innerHTML = `<div class="settings-empty"><h4>Could not load backups</h4><p>${escapeHtml(e.message)}</p></div>`;
  }
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
async function openBackgroundFolder() {
  try {
    const result = await api("backgroundFolder");
    await api("openFolder", { path: result.path });
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
    state.settings = { ...state.settingsDraft.original };
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
    const result = await api("vrchatSelectAvatar", { id });
    if (result?.groups && result?.avatars) {
      state.library = result;
      renderGroups();
      if (isRecentGroup(state.activeGroupId)) renderAvatars();
    }
    state.lastLoggedCurrentAvatarId = id;
    const avatar = avatarMeta || state.library.avatars.find((x) => (x.avatarId || x.id) === id);
    state.currentAvatarSummary = { id, name: avatar?.name || id };
    if (state.vrchat?.user) {
      state.vrchat.user.currentAvatarId = id;
      state.vrchat.user.currentAvatarImageUrl = avatar?.imageUrl || state.vrchat.user.currentAvatarImageUrl || "";
      state.vrchat.user.currentAvatarThumbnailImageUrl = avatar?.thumbnailImageUrl || avatar?.imageUrl || state.vrchat.user.currentAvatarThumbnailImageUrl || "";
    }
    renderAccount();
    toast("Avatar equip requested.");
  } catch (e) { toast(e.message); }
}
function confirmAction({ title, message, confirmLabel = "Delete", confirmClass = "danger", hideCancel = false }) {
  return new Promise((resolve) => {
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
  });
}

function applySettings() { applyGridSize(); applyThemeColor(state.settings.themeColor); applyBackgroundOpacity(); applyPanelOpacity(); }
function applyGridSize() {
  const columns = Math.min(10, Math.max(5, Number(state.activePage === "database" ? state.settings.databaseGridSize : state.settings.gridSize) || DEFAULT_SETTINGS.gridSize));
  const activeGrid = state.activePage === "database" ? $("avatarDatabaseResults") : $("avatarGrid");
  const fallbackGrid = $("avatarGrid")?.clientWidth ? $("avatarGrid") : $("avatarDatabaseResults");
  const gridWidth = Math.max(360, ((activeGrid?.clientWidth || fallbackGrid?.clientWidth || 0) - 48));
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
function renderBackground(bg) {
  const layer = $("backgroundLayer");
  if (!layer) return;
  layer.replaceChildren();
  if (!bg?.dataUrl) return;
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
}
function applyThemeColor(hex) {
  const rgb = hexToRgb(hex) ?? hexToRgb(DEFAULT_SETTINGS.themeColor);
  const panel = mix({ r: 18, g: 22, b: 20 }, rgb, .16);
  const panel2 = mix({ r: 18, g: 22, b: 20 }, rgb, .28);
  document.documentElement.style.setProperty("--accent", rgbToHex(rgb));
  document.documentElement.style.setProperty("--accent-rgb", `${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}`);
  document.documentElement.style.setProperty("--accent-ink", luminance(rgb) > .55 ? "#08110c" : "#f6fff8");
  document.documentElement.style.setProperty("--bg", rgbToHex(mix({ r: 0, g: 0, b: 0 }, rgb, .13)));
  document.documentElement.style.setProperty("--panel", rgbToHex(panel));
  document.documentElement.style.setProperty("--panel-2", rgbToHex(panel2));
  document.documentElement.style.setProperty("--panel-rgb", `${Math.round(panel.r)}, ${Math.round(panel.g)}, ${Math.round(panel.b)}`);
  document.documentElement.style.setProperty("--panel-2-rgb", `${Math.round(panel2.r)}, ${Math.round(panel2.g)}, ${Math.round(panel2.b)}`);
  document.documentElement.style.setProperty("--line", rgbToHex(mix({ r: 18, g: 22, b: 20 }, rgb, .48)));
  document.documentElement.style.setProperty("--muted", rgbToHex(mix({ r: 255, g: 255, b: 255 }, rgb, .34)));
  $("themeColorInput").value = rgbToHex(rgb);
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
});
$("addGroupBtn").addEventListener("click", () => openGroupDialog());
$("groupFilterMenuBtn").addEventListener("click", (event) => toggleSortMenu(event, "groupFilterSelect", "groupFilterMenu", "groupFilterMenuBtn", () => { state.groupFilter = $("groupFilterSelect").value; render(); }));
$("groupFilterMenuBtn").addEventListener("wheel", (event) => cycleSortOption(event, "groupFilterSelect", "groupFilterMenuBtn", () => { state.groupFilter = $("groupFilterSelect").value; render(); }), { passive: false });
$("editGroupBtn").addEventListener("click", () => openGroupDialog(activeGroup()));
$("copyGroupBtn").addEventListener("click", () => openCopyGroupDialog(activeGroup()));
$("deleteGroupBtn").addEventListener("click", () => deleteGroup(activeGroup()));
$("unfavoriteAllBtn").addEventListener("click", unfavoriteAllInActiveGroup);
$("checkDeletedFavoritesBtn").addEventListener("click", checkDeletedFavoritesManual);
$("addAvatarBtn").addEventListener("click", () => openAvatarDialog());
$("favoritesTabBtn").addEventListener("click", () => showPage("favorites"));
$("databaseTabBtn").addEventListener("click", () => showPage("database"));
$("searchInput").addEventListener("input", resetAvatarPageAndRender);
$("sortMenuBtn").addEventListener("click", toggleSortMenu);
$("sortMenuBtn").addEventListener("wheel", (event) => cycleSortOption(event), { passive: false });
$("databaseSortMenuBtn").addEventListener("click", (event) => toggleSortMenu(event, "databaseSortSelect", "databaseSortMenu", "databaseSortMenuBtn", () => { state.avatarDatabasePage = 0; renderAvatarDatabaseResults(); }));
$("databaseSortMenuBtn").addEventListener("wheel", (event) => cycleSortOption(event, "databaseSortSelect", "databaseSortMenuBtn", () => { state.avatarDatabasePage = 0; renderAvatarDatabaseResults(); }), { passive: false });
$("databaseFieldMenuBtn").addEventListener("click", toggleDatabaseFieldMenu);
$("databaseFieldMenu").addEventListener("click", (event) => event.stopPropagation());
$("settingsLogFilterMenuBtn").addEventListener("click", (event) => toggleSortMenu(event, "settingsLogFilterSelect", "settingsLogFilterMenu", "settingsLogFilterMenuBtn", () => { state.settingsLogFilter = $("settingsLogFilterSelect").value; loadSettingsLogs(); }));
$("settingsLogFilterMenuBtn").addEventListener("wheel", (event) => cycleSortOption(event, "settingsLogFilterSelect", "settingsLogFilterMenuBtn", () => { state.settingsLogFilter = $("settingsLogFilterSelect").value; loadSettingsLogs(); }), { passive: false });
document.addEventListener("click", hideContextMenu);
document.addEventListener("dragover", autoScrollDrag);
document.addEventListener("wheel", wheelScrollDuringDrag, { passive: false, capture: true });
document.addEventListener("wheel", trackZoomWheel, { passive: true, capture: true });
document.addEventListener("keydown", (event) => {
  if (keyScrollDuringDrag(event)) return;
  if (event.key === "Escape") hideContextMenu();
  if (event.key !== "Tab" || document.querySelector("dialog[open]")) return;
  event.preventDefault();
  showPage(state.activePage === "favorites" ? "database" : "favorites");
});
$("avatarGrid").addEventListener("dragover", handleAvatarGridDragOver);
$("avatarGrid").addEventListener("drop", handleAvatarGridDrop);
$("avatarGrid").addEventListener("contextmenu", showAvatarGridContextMenu);
$("avatarGrid").addEventListener("click", handleAvatarGridClick);
$("groupList").addEventListener("dragover", handleGroupListDragOver);
$("groupList").addEventListener("drop", handleGroupListDrop);
$("gridSizeInput").addEventListener("input", () => { state.settings.gridSize = Number($("gridSizeInput").value); applyGridSize(); queueSaveSettings(); });
$("databaseGridSizeInput").addEventListener("input", () => { state.settings.databaseGridSize = Number($("databaseGridSizeInput").value); applyGridSize(); queueSaveSettings(); });
window.addEventListener("resize", applyGridSize);
$("customizationBtn").addEventListener("click", openSettingsDialog);
$("settingsCustomizationTab").addEventListener("click", () => setSettingsTab("customization"));
$("settingsLogsTab").addEventListener("click", () => setSettingsTab("logs"));
$("settingsBackupsTab").addEventListener("click", () => setSettingsTab("backups"));
$("customizationDialog").addEventListener("close", () => {
  if (state.settingsDraft && !state.settingsDraft.applied) {
    state.settings = { ...state.settingsDraft.original };
    applySettings();
  }
  state.settingsDraft = null;
});
$("syncedAvatarEditToggle").addEventListener("change", async (event) => { await setSyncedAvatarEditMode(event.target.checked); });
$("applySyncedAvatarOrderBtn").addEventListener("click", applySyncedAvatarEdit);
$("cancelSyncedAvatarOrderBtn").addEventListener("click", cancelSyncedAvatarEdit);
$("openGameBtn").addEventListener("click", async () => {
  if (!await confirmAction({ title: "Open Game", message: "Open VRChat in desktop mode?", confirmLabel: "Open", confirmClass: "primary" })) return;
  try { await api("openGame"); } catch (e) { toast(e.message); }
});
$("themeColorInput").addEventListener("input", () => { state.settings.themeColor = $("themeColorInput").value; applyThemeColor(state.settings.themeColor); });
$("backgroundOpacityInput").addEventListener("input", () => { state.settings.backgroundOpacity = Number($("backgroundOpacityInput").value); applyBackgroundOpacity(); });
$("backgroundOpacityNumber").addEventListener("input", syncBackgroundOpacityFromNumber);
$("backgroundOpacityPrevBtn").addEventListener("click", () => stepBackgroundOpacity(-1));
$("backgroundOpacityNextBtn").addEventListener("click", () => stepBackgroundOpacity(1));
$("panelOpacityInput").addEventListener("input", () => { state.settings.panelOpacity = Number($("panelOpacityInput").value); applyPanelOpacity(); });
$("panelOpacityNumber").addEventListener("input", syncPanelOpacityFromNumber);
$("panelOpacityPrevBtn").addEventListener("click", () => stepPanelOpacity(-1));
$("panelOpacityNextBtn").addEventListener("click", () => stepPanelOpacity(1));
$("checkUpdateBtn").addEventListener("click", () => checkForUpdates());
$("resetThemeBtn").addEventListener("click", () => { state.settings.themeColor = DEFAULT_SETTINGS.themeColor; state.settings.backgroundOpacity = DEFAULT_SETTINGS.backgroundOpacity; state.settings.panelOpacity = DEFAULT_SETTINGS.panelOpacity; applySettings(); });
$("cancelSettingsBtn").addEventListener("click", cancelSettingsDialog);
$("applySettingsBtn").addEventListener("click", applySettingsDialog);
$("restoreBackupNewBtn").addEventListener("click", () => restoreBackup("new"));
$("restoreBackupReplaceBtn").addEventListener("click", () => restoreBackup("replace"));
$("refreshLogsBtn").addEventListener("click", loadSettingsLogs);
$("copyLogsBtn").addEventListener("click", copySettingsLogs);
$("openLogsFolderBtn").addEventListener("click", openLogsFolder);
$("clearLogsBtn").addEventListener("click", clearSettingsLogs);
$("openBackupsFolderBtn").addEventListener("click", openBackupsFolder);
$("openBackgroundFolderBtn").addEventListener("click", openBackgroundFolder);
$("changeGroupIconBtn").addEventListener("click", () => changeGroupIcon());
$("removeGroupIconBtn").addEventListener("click", () => removeGroupIcon());
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
$("avatarDatabaseProviderSelect").addEventListener("change", () => {
  state.avatarDatabaseProvider = avatarDatabaseProvider();
  resetAvatarDatabaseResults();
  maybeShowVrcxDatabaseNotice();
});
["databaseSearchAvatarToggle", "databaseSearchAuthorToggle", "databaseSearchDescriptionToggle", "databaseSearchTagsToggle", "databasePlatformPcToggle", "databasePlatformAndroidToggle", "databasePlatformIosToggle"].forEach((id) => $(id).addEventListener("change", () => { state.avatarDatabaseAuthorId = ""; updateDatabaseFieldMenuButton(); }));
$("randomAvatarDatabaseBtn").addEventListener("click", runRandomAvatarDatabasePage);
$("equipRandomAvatarBtn").addEventListener("click", () => equipRandomDatabaseAvatar().catch(() => {}));
$("avatarRouletteBtn").addEventListener("click", openAvatarRouletteDialog);
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
  if (!Number.isFinite(requested) || requested < 1 || requested > maxPage) { toast(`Enter a page from 1 to ${maxPage}.`); return; }
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
  } catch (e) { $("loginStatus").textContent = e.message; }
}
async function runInlineTwoFactor() {
  try {
    state.vrchat = await api("vrchatTwoFactor", { code: $("inlineTwoFactorCodeInput").value, method: $("inlineTwoFactorMethodInput").value });
    showInlineTwoFactor(false);
    renderAccount();
    await refreshCurrentAvatarSummarySilent();
    await logCurrentAvatarSilent();
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
    if (!canManuallyAddToGroup(state.activeGroupId)) { toast("Recent and Deleted groups are managed automatically."); return; }
    const avatar = await api("vrchatCurrentAvatar", { groupId: state.activeGroupId });
    if (!syncedGroupHasCapacity(state.activeGroupId, avatar.avatarId || avatar.id)) return;
    await pushSyncedAvatarAdd(avatar.avatarId || avatar.id, state.activeGroupId);
    state.library = await api("saveAvatar", { ...avatar, groupId: state.activeGroupId, source: "vrchat" });
    render();
  } catch (e) { toast(e.message); }
});
$("currentAvatarCard").addEventListener("click", async () => { try { openAvatarDialog({ ...(await api("vrchatCurrentAvatar", { groupId: state.activeGroupId })), groupId: state.activeGroupId }); } catch (e) { toast(e.message); } });
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
Promise.all([loadLibrary(), loadSettings(), loadBackground()])
  .then(loadSession)
  .then(() => {
    requestAnimationFrame(applyGridSize);
    setTimeout(checkPasDatabaseUpdate, 1200);
    setTimeout(() => checkForUpdates({ automatic: true }), 2500);
  })
  .catch((e) => toast(e.message));
