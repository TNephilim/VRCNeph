const DEFAULT_SETTINGS = { gridSize: 10, databaseGridSize: 10, themeColor: "#303735", backgroundOpacity: 20, schemaVersion: 5 };
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
  avatarDatabaseMode: "search",
  avatarDatabaseRandomPages: [],
  pasUpdatePromptShown: false,
  pasUpdateBusy: false,
  syncedAvatarEdit: { groupId: "", avatarIds: [], backupPath: "", applying: false },
  pendingDatabaseAvatar: null,
  pendingMoveAvatarId: "",
  pendingAvatarGroupAction: "",
  pendingAvatarSort: null,
  avatarDialogGroupId: null,
  avatarDialogSource: "",
  dragSort: null,
  dragPoint: null,
  dragScrollFrame: null,
  positionEdit: null,
  vrchatSyncTimer: null,
  vrchatSyncBusy: false,
  vrchatSyncLoggedIn: false,
  settingsSaveTimer: null,
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
  "avatarNameInput",
  "authorNameInput",
  "authorIdInput",
  "thumbnailInput",
  "imageInput",
  "releaseStatusInput",
  "versionInput",
  "platformsInput",
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
      schemaVersion: DEFAULT_SETTINGS.schemaVersion
    };
  } catch { state.settings = { ...DEFAULT_SETTINGS }; }
  applySettings();
}
async function loadBackground() {
  try {
    const bg = await api("backgroundGet");
    document.documentElement.style.setProperty("--custom-bg-image", bg?.dataUrl ? `url("${bg.dataUrl}")` : "none");
  } catch { document.documentElement.style.setProperty("--custom-bg-image", "none"); }
}
async function saveSettings() { try { state.settings = await api("settingsSave", state.settings); applySettings(); } catch (e) { toast(e.message); } }
function queueSaveSettings() { clearTimeout(state.settingsSaveTimer); state.settingsSaveTimer = setTimeout(saveSettings, 220); }

function render() { renderPageTabs(); renderGroups(); renderToolbar(); renderAvatars(); renderAvatarDatabaseResults(); renderAccount(); }
function activeGroup() { return state.library.groups.find((g) => g.id === state.activeGroupId) ?? state.library.groups[0]; }
function groupAvatars(groupId) { return state.library.avatars.filter((a) => a.groupId === groupId); }
function isSyncedGroup(groupId) { return String(groupId || "").toLowerCase().startsWith("vrc_"); }
function isDeletedGroup(groupId) { return String(groupId || "").toLowerCase() === "deleted_avatars"; }
function isRecentGroup(groupId) { return String(groupId || "").toLowerCase() === "recent_avatars"; }
function isPinnedSystemGroup(groupId) { return isRecentGroup(groupId) || isDeletedGroup(groupId); }
function isDefaultReorderLockedGroup(groupId) { return isSyncedGroup(groupId) || isPinnedSystemGroup(groupId); }
function isGroupReorderLocked(group) {
  if (!group) return false;
  if (isDefaultReorderLockedGroup(group.id)) return true;
  if (typeof group.reorderLocked === "boolean") return group.reorderLocked;
  return isDefaultReorderLockedGroup(group.id);
}
function isDefaultLocalGroup(group) { return String(group?.description || "").toLowerCase() === "default local avatar favorites." || String(group?.name || "").toLowerCase() === "favorites"; }
function isCustomLocalGroup(group) { return group && !isSyncedGroup(group.id) && !isPinnedSystemGroup(group.id) && !isDefaultLocalGroup(group); }
function isSyncedAvatarEditActive(groupId = state.activeGroupId) { return Boolean(groupId && state.syncedAvatarEdit.groupId === groupId); }
function canEditSyncedAvatarOrder(group = activeGroup()) { return Boolean(group && isSyncedGroup(group.id) && !isPinnedSystemGroup(group.id)); }
function canReorderAvatarsInGroup(groupId = state.activeGroupId) { return !isSyncedGroup(groupId) || isSyncedAvatarEditActive(groupId); }
function isSyncedAvatarEditDrag() { return state.dragSort?.type === "avatar" && isSyncedAvatarEditActive(state.dragSort.groupId); }
function exitSyncedAvatarEditMode(message = "") {
  if (!state.syncedAvatarEdit.groupId || state.syncedAvatarEdit.applying) return false;
  state.syncedAvatarEdit = { groupId: "", avatarIds: [], backupPath: "", applying: false };
  clearDragSortIndicators();
  if (message) toast(message);
  return true;
}
function groupMatchesFilter(group) {
  if (state.groupFilter === "synced") return isSyncedGroup(group.id) || isRecentGroup(group.id) || isDeletedGroup(group.id);
  if (state.groupFilter === "local") return isDefaultLocalGroup(group) || isCustomLocalGroup(group);
  return true;
}
function filteredGroups() { return orderedGroups().filter(groupMatchesFilter); }
function ensureActiveGroupExists() {
  if (state.library.groups.some((group) => group.id === state.activeGroupId)) return;
  state.activeGroupId = orderedGroups()[0]?.id ?? null;
  state.avatarPage = 0;
}
function groupIconHtml(groupId) {
  if (isSyncedGroup(groupId)) return `<span class="sync-icon" title="Synced from VRChat">&#8635;</span>`;
  if (isRecentGroup(groupId)) return `<span class="recent-icon" title="Recent avatars" aria-hidden="true"></span>`;
  if (isDeletedGroup(groupId)) return `<span class="trash-icon" title="Deleted avatars" aria-hidden="true"></span>`;
  return "";
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
    item.innerHTML = `<button class="group-position" type="button" title="${reorderTitle}" ${canReorder ? "" : "disabled"}>#${listPosition(allGroups, group.id)}</button><button class="group-select" type="button"><span class="group-title">${escapeHtml(group.name)}</span><span class="group-count">${groupAvatars(group.id).length}</span></button>`;
    item.querySelector(".group-title").innerHTML = `${groupIconHtml(group.id)}${escapeHtml(group.name)}`;
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
      if (state.dragSort?.type !== "group" && state.dragSort?.type !== "avatar") return;
      event.preventDefault();
      event.stopPropagation();
      startDragAutoScroll(event);
      if (state.dragSort?.type === "avatar") {
        if (isSyncedAvatarEditDrag()) return;
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
      if (state.dragSort?.type !== "group" && state.dragSort?.type !== "avatar") return;
      event.preventDefault();
      event.stopPropagation();
      if (state.dragSort?.type === "avatar") {
        if (isSyncedAvatarEditDrag()) return;
        const draggedId = state.dragSort.id;
        clearDragSortIndicators();
        state.dragSort = null;
        await moveOrCopyAvatarToGroup(draggedId, group.id);
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
      state.activeGroupId = group.id;
      state.avatarPage = 0;
      render();
    });
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const actions = [
        { label: "Edit Group", disabled: pinned || synced, action: () => openGroupDialog(group) },
        { label: "Copy Group", disabled: pinned, action: () => copyGroup(group) },
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
  $("editGroupBtn").disabled = pinned || synced;
  $("copyGroupBtn").disabled = pinned;
  $("deleteGroupBtn").disabled = pinned || synced || state.library.groups.length <= 1;
  updateSortButton();
  updateSortButton("databaseSortSelect", "databaseSortMenuBtn");
}
function renderAvatars() {
  const active = activeGroup();
  const canReorderCurrentGroup = canReorderAvatarsInGroup(active?.id);
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
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
  const usePages = true;
  state.avatarFilteredCount = avatars.length;
  if (usePages) state.avatarPage = Math.min(avatarMaxPage() - 1, Math.max(0, state.avatarPage));
  else state.avatarPage = 0;
  const visibleAvatars = avatars.slice(state.avatarPage * AVATAR_PAGE_SIZE, (state.avatarPage + 1) * AVATAR_PAGE_SIZE);
  $("emptyState").hidden = avatars.length !== 0;
  renderAvatarPagination(usePages);
  const grid = $("avatarGrid");
  grid.innerHTML = "";
  for (const avatar of visibleAvatars) {
    const card = document.createElement("article");
    card.className = `avatar-card ${canReorderCurrentGroup ? "avatar-reorder-enabled" : "avatar-reorder-locked"} ${syncedEditActive ? "synced-edit-card" : ""}`;
    card.dataset.avatarId = avatar.id;
    card.draggable = canReorderCurrentGroup || syncedReorderBlocked;
    const image = avatar.thumbnailImageUrl || avatar.imageUrl;
    const releaseClass = String(avatar.releaseStatus ?? "").toLowerCase() === "public" ? "public" : "private";
    const reorderTitle = canReorderCurrentGroup ? "Drag to reorder" : "Enable edit mode to reorder synced avatars";
    card.innerHTML = `<button type="button"><div class="thumb">${image ? `<img src="${escapeAttr(image)}" alt="">` : "<span>No thumbnail</span>"}</div><div class="avatar-info"><div class="avatar-name">${escapeHtml(avatar.name)}</div><div class="meta-line">${escapeHtml(avatar.authorName || "Unknown author")}</div><div class="meta-line">${escapeHtml(avatar.avatarId || avatar.id)}</div><div class="badges">${avatar.releaseStatus ? `<span class="badge ${releaseClass}">${escapeHtml(avatar.releaseStatus)}</span>` : ""}${platformBadgeLabels(avatar.platforms).map((p) => `<span class="badge ${p.className}">${escapeHtml(p.label)}</span>`).join("")}</div></div></button><div class="avatar-card-footer"><button class="avatar-position" type="button" title="${reorderTitle}" ${canReorderCurrentGroup ? "" : "disabled"}>#${listPosition(orderedAvatars, avatar.id)}</button><button class="avatar-card-equip primary" type="button" title="Equip avatar">Equip</button></div>`;
    card.querySelector("button").addEventListener("click", () => openAvatarDialog(avatar));
    if (canReorderCurrentGroup) card.querySelector(".avatar-position").addEventListener("click", () => openPositionDialog("avatar", avatar));
    card.querySelector(".avatar-card-equip").addEventListener("click", (event) => { event.stopPropagation(); equipAvatar(avatar.avatarId || avatar.id); });
    const startAvatarDrag = (event) => {
      if (event.target.closest(".avatar-card-equip, .avatar-position")) {
        event.preventDefault();
        return;
      }
      const rect = card.getBoundingClientRect();
      state.dragSort = { type: "avatar", id: avatar.id, groupId: avatar.groupId, dragWidth: rect.width, dragHeight: rect.height, blockedSynced: syncedReorderBlocked };
      if (!syncedReorderBlocked) {
        $("sortSelect").value = "manual";
        updateSortButton();
      }
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", avatar.id);
      setEmptyDragPreview(event);
      createFloatingAvatarDragPreview(card.querySelector(".thumb"), event);
      card.classList.add("dragging");
      startDragAutoScroll(event);
    };
    if (canReorderCurrentGroup || syncedReorderBlocked) {
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
  const canPlacePending = Boolean(pending && pending.id !== avatar.id && pending.groupId === avatar.groupId && canReorderCurrentGroup);
  const actions = [
    ...(canPlacePending ? [
      { label: "Move Before", action: () => placeContextSortedAvatar(avatar, "before") },
      { label: "Move After", action: () => placeContextSortedAvatar(avatar, "after") },
      { label: "Swap Places", action: () => placeContextSortedAvatar(avatar, "swap") },
      { label: "Sort Avatar", className: "separated", disabled: !canReorderCurrentGroup, action: () => startAvatarContextSort(avatar) }
    ] : [
      { label: "Sort Avatar", disabled: !canReorderCurrentGroup, action: () => startAvatarContextSort(avatar) }
    ]),
    { label: "Move to Group", action: () => openAvatarGroupActionDialog(avatar, "move") },
    { label: "Copy to Group", action: () => openAvatarGroupActionDialog(avatar, "copy") },
    { label: "Equip Avatar", action: () => equipAvatar(avatar.avatarId || avatar.id) },
    { label: "Delete Avatar", className: "danger", action: () => deleteAvatarById(avatar.id, avatar.name) }
  ];
  showContextMenu(event.clientX, event.clientY, actions);
}
function startAvatarContextSort(avatar) {
  state.pendingAvatarSort = { id: avatar.id, groupId: avatar.groupId, name: avatar.name || avatar.avatarId || avatar.id };
  toast(`Choose another avatar to place "${state.pendingAvatarSort.name}".`);
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
async function placeContextSortedAvatar(targetAvatar, placement) {
  const pending = state.pendingAvatarSort;
  state.pendingAvatarSort = null;
  if (!pending || pending.id === targetAvatar.id || pending.groupId !== targetAvatar.groupId) return;
  await placeDroppedItem({ type: "avatar", id: pending.id, targetId: targetAvatar.id, groupId: targetAvatar.groupId }, placement);
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
    const label = lower.includes("standalonewindows") || lower === "windows" || lower === "pc" ? "PC" : lower.includes("android") || lower.includes("quest") ? "Quest" : lower.includes("ios") ? "iOS" : item.split("/")[0].trim();
    if (label && !labels.some((x) => x.label.toLowerCase() === label.toLowerCase())) labels.push({ label, className: label.toLowerCase() === "pc" ? "platform-pc" : label.toLowerCase() === "quest" ? "platform-quest" : label.toLowerCase() === "ios" ? "platform-ios" : "platform" });
  }
  return labels;
}

function openGroupDialog(group = null) {
  if (group && (isPinnedSystemGroup(group.id) || isSyncedGroup(group.id))) return;
  state.editingGroupId = group?.id ?? null;
  $("groupDialogTitle").textContent = group ? "Edit Group" : "Add Group";
  $("groupNameInput").value = group?.name ?? "";
  $("groupDescriptionInput").value = group?.description ?? "";
  $("groupDialog").showModal();
}
function fillSelectWithGroups(select, selectedId) { select.innerHTML = state.library.groups.map((g) => `<option value="${escapeAttr(g.id)}" ${g.id === selectedId ? "selected" : ""}>${escapeHtml(g.name)}</option>`).join(""); }
function openAvatarGroupActionDialog(avatar, action) {
  state.pendingMoveAvatarId = avatar.id;
  state.pendingAvatarGroupAction = action;
  $("saveAvatarGroupDialog").querySelector("h3").textContent = action === "copy" ? "Copy Avatar" : "Move Avatar";
  $("confirmSaveAvatarGroupBtn").textContent = action === "copy" ? "Copy Avatar" : "Move Avatar";
  $("saveAvatarGroupName").textContent = `Choose a group for "${avatar.name || avatar.avatarId || "this avatar"}".`;
  fillSelectWithGroups($("saveAvatarGroupInput"), avatar.groupId ?? state.activeGroupId);
  $("saveAvatarGroupDialog").showModal();
}
function resetAvatarGroupDialogMode() {
  state.pendingMoveAvatarId = "";
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
  $("deleteAvatarBtn").hidden = !isExisting;
  $("avatarDetailsPanel").hidden = false;
  document.body.classList.add("details-open");
  requestAnimationFrame(applyGridSize);
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
}
function setAvatarForm(avatar) {
  state.avatarDialogSource = avatar.source ?? "";
  $("avatarIdInput").value = avatar.avatarId ?? "";
  $("avatarNameInput").value = avatar.name ?? "";
  $("authorNameInput").value = avatar.authorName ?? "";
  $("authorIdInput").value = avatar.authorId ?? "";
  $("thumbnailInput").value = avatar.thumbnailImageUrl ?? "";
  $("imageInput").value = avatar.imageUrl ?? "";
  $("releaseStatusInput").value = avatar.releaseStatus ?? "";
  $("versionInput").value = avatar.version ?? "";
  $("platformsInput").value = avatar.platforms ?? "";
  $("tagsInput").value = avatar.tags ?? "";
  $("sourceUrlInput").value = avatar.sourceUrl ?? "";
  $("descriptionInput").value = avatar.description ?? "";
  $("notesInput").value = avatar.notes ?? "";
  $("rawJsonInput").value = avatar.rawJson ?? "";
  updateAvatarAuthorAction();
  updateAvatarPreview();
  updateAvatarDetailBadges();
}
function readAvatarForm(groupId = state.avatarDialogGroupId ?? state.activeGroupId) {
  return { id: state.editingAvatarId ?? "", groupId, avatarId: $("avatarIdInput").value, name: $("avatarNameInput").value, authorName: $("authorNameInput").value, authorId: $("authorIdInput").value, thumbnailImageUrl: $("thumbnailInput").value, imageUrl: $("imageInput").value, releaseStatus: $("releaseStatusInput").value, version: $("versionInput").value, platforms: $("platformsInput").value, tags: $("tagsInput").value, sourceUrl: $("sourceUrlInput").value, description: $("descriptionInput").value, notes: $("notesInput").value, rawJson: $("rawJsonInput").value };
}
function updateAvatarPreview() {
  const image = $("thumbnailInput").value.trim() || $("imageInput").value.trim();
  $("avatarDetailThumbnail").src = image;
  $("avatarDetailThumbnail").hidden = !image;
  $("avatarDetailThumbnailEmpty").hidden = Boolean(image);
  $("avatarDetailThumbnailButton").disabled = !image;
}
function updateAvatarDetailBadges() {
  const release = $("releaseStatusInput").value.trim();
  const releaseClass = release.toLowerCase() === "public" ? "public" : "private";
  $("avatarDetailBadges").innerHTML = `${release ? `<span class="badge ${releaseClass}">${escapeHtml(release)}</span>` : ""}${$("versionInput").value ? `<span class="badge">v${escapeHtml($("versionInput").value)}</span>` : ""}${platformBadgeLabels($("platformsInput").value).map((p) => `<span class="badge ${p.className}">${escapeHtml(p.label)}</span>`).join("")}${avatarSourceBadgeHtml(state.avatarDialogSource)}${splitBadgeValues($("tagsInput").value).slice(0, 10).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}`;
}

function avatarSourceLabels(source) {
  const labels = [];
  for (const part of String(source || "").split(/[,+|;]/).map((x) => x.trim()).filter(Boolean)) {
    const label = part === "vrchat" ? "VRChat" : part === "avatar-database" ? "VRCX DB" : part === "avtrzip" ? "AVTRZIP" : part === "pas" ? "Prismic PAS" : part === "vrchat-recent" ? "Recent" : "";
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
  if (provider === "all") return "Search VRCX DB, AVTRZIP, and Prismic PAS.";
  return provider === "avtrzip" ? "Search the remote AVTRZIP avatar database." : provider === "pas" ? "Search the Prismic AvatarSearch PAS database." : "Search the local VRCX avatar database.";
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
    : "Start typing at least three characters to search cached VRCX avatars.";
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
  return {
    searchAvatar: $("databaseSearchAvatarToggle").checked,
    searchAuthor: $("databaseSearchAuthorToggle").checked,
    searchDescription: $("databaseSearchDescriptionToggle").checked,
    searchTags: $("databaseSearchTagsToggle").checked
  };
}

function hasDatabaseSearchField(fields = databaseSearchFieldPayload()) {
  return fields.searchAvatar || fields.searchAuthor || fields.searchDescription || fields.searchTags;
}

function setDatabaseSearchFields({ avatar = true, author = true, description = true, tags = true }) {
  $("databaseSearchAvatarToggle").checked = avatar;
  $("databaseSearchAuthorToggle").checked = author;
  $("databaseSearchDescriptionToggle").checked = description;
  $("databaseSearchTagsToggle").checked = tags;
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
  if (query.length < 3 && !directAuthorSearch) {
    state.avatarDatabaseResults = [];
    state.avatarDatabasePage = 0;
    state.avatarDatabaseHasMore = false;
    state.avatarDatabaseQuery = "";
    state.avatarDatabaseAuthorId = "";
    state.avatarDatabaseTotal = null;
    state.avatarDatabaseCounting = false;
    state.avatarDatabaseMode = "search";
    state.avatarDatabaseRandomPages = [];
    renderAvatarDatabaseResults();
    $("avatarDatabaseStatus").textContent = query ? "Enter at least 3 characters." : avatarDatabaseProviderDescription();
    return;
  }
  if (!hasDatabaseSearchField(fields)) {
    state.avatarDatabaseResults = [];
    state.avatarDatabasePage = 0;
    state.avatarDatabaseHasMore = false;
    state.avatarDatabaseQuery = query;
    state.avatarDatabaseTotal = null;
    state.avatarDatabaseCounting = false;
    state.avatarDatabaseMode = "search";
    state.avatarDatabaseRandomPages = [];
    renderAvatarDatabaseResults();
    $("avatarDatabaseStatus").textContent = "Enable at least one search field.";
    return;
  }
  $("databasePrevPageBtn").disabled = true;
  $("databaseNextPageBtn").disabled = true;
  $("avatarDatabaseStatus").textContent = page > 0 ? `Loading ${providerLabel} page ${page + 1}...` : `Searching ${providerLabel}...`;
  try {
    const result = await api("avatarDatabaseSearch", databaseSearchPayload(query, page));
    if (token !== state.avatarDatabaseSearchToken) return;
    state.avatarDatabaseResults = result.results || [];
    state.avatarDatabasePage = Math.max(0, (result.page || page + 1) - 1);
    state.avatarDatabaseHasMore = Boolean(result.hasMore);
    state.avatarDatabaseQuery = query;
    state.avatarDatabaseMode = "search";
    state.avatarDatabaseRandomPages = [];
    state.avatarDatabaseTotal = page === 0 ? null : state.avatarDatabaseTotal;
    state.avatarDatabaseCounting = page === 0 && state.avatarDatabaseResults.length > 0;
    renderAvatarDatabaseResults();
    updateAvatarDatabaseStatus();
    if (page === 0 && state.avatarDatabaseResults.length) countAvatarDatabaseTotal(query, token, databaseSearchPayload(query, 0));
  } catch (e) { handleAvatarDatabaseError(e, token); }
  finally { }
}
async function runRandomAvatarDatabasePage() {
  const token = ++state.avatarDatabaseSearchToken;
  state.avatarDatabaseProvider = avatarDatabaseProvider();
  const providerLabel = avatarDatabaseProviderLabel();
  $("databasePrevPageBtn").disabled = true;
  $("databaseNextPageBtn").disabled = true;
  $("avatarDatabaseStatus").textContent = `Loading random ${providerLabel} avatars...`;
  try {
    const result = await api("avatarDatabaseRandom", { provider: avatarDatabaseProvider(), query: "", limit: 50, page: 1 });
    if (token !== state.avatarDatabaseSearchToken) return;
    const page = result.results || [];
    state.avatarDatabaseMode = "random";
    state.avatarDatabaseRandomPages.push(page);
    state.avatarDatabaseResults = state.avatarDatabaseRandomPages.flat();
    state.avatarDatabasePage = state.avatarDatabaseRandomPages.length - 1;
    state.avatarDatabaseHasMore = false;
    state.avatarDatabaseQuery = "";
    state.avatarDatabaseTotal = state.avatarDatabaseResults.length;
    state.avatarDatabaseCounting = false;
    renderAvatarDatabaseResults();
    $("avatarDatabaseStatus").textContent = `${state.avatarDatabaseTotal} random ${providerLabel} avatars loaded.`;
  } catch (e) {
    handleAvatarDatabaseError(e, token);
  }
}
function updateAvatarDatabaseStatus() {
  const count = state.avatarDatabaseResults.length;
  const providerLabel = avatarDatabaseProviderLabel(state.avatarDatabaseProvider);
  if (!count) { $("avatarDatabaseStatus").textContent = `No ${providerLabel} avatars found.`; return; }
  if (state.avatarDatabaseTotal == null) {
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
  const results = [...currentAvatarDatabasePageResults()];
  if (sort === "updatedDesc") return results.sort((a, b) => new Date(b.remoteUpdatedAt || b.updatedAt || 0) - new Date(a.remoteUpdatedAt || a.updatedAt || 0));
  if (sort === "createdDesc") return results.sort((a, b) => new Date(b.remoteCreatedAt || b.createdAt || 0) - new Date(a.remoteCreatedAt || a.createdAt || 0));
  if (sort === "nameAsc") return results.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  if (sort === "authorAsc") return results.sort((a, b) => (a.authorName || "").localeCompare(b.authorName || ""));
  return results;
}
function renderAvatarDatabaseResults() {
  const allResults = sortedAvatarDatabaseResults();
  const results = allResults;
  const grid = $("avatarDatabaseResults");
  grid.innerHTML = "";
  $("avatarDatabaseEmptyState").hidden = allResults.length !== 0;
  const databaseMax = databaseMaxPage("database");
  const hasMultipleDatabasePages = state.avatarDatabasePage > 0 || state.avatarDatabaseHasMore || databaseMax > 1;
  $("avatarDatabasePagination").hidden = !hasMultipleDatabasePages;
  $("databasePrevPageBtn").disabled = state.avatarDatabasePage <= 0;
  $("databaseNextPageBtn").disabled = state.avatarDatabaseMode === "random" ? state.avatarDatabasePage >= state.avatarDatabaseRandomPages.length - 1 : !state.avatarDatabaseHasMore;
  const totalText = state.avatarDatabaseTotal == null ? "" : ` of ${Math.max(1, Math.ceil(state.avatarDatabaseTotal / 50))}`;
  $("databasePageStatus").textContent = allResults.length ? `Page ${state.avatarDatabasePage + 1}${totalText}` : "";
  for (const avatar of results) {
    const image = avatar.thumbnailImageUrl || avatar.imageUrl;
    const releaseClass = String(avatar.releaseStatus ?? "").toLowerCase() === "public" ? "public" : "private";
    const card = document.createElement("article");
    card.className = "avatar-card";
    card.dataset.avatarId = avatar.avatarId || avatar.id;
    card.innerHTML = `<button type="button"><div class="thumb">${image ? `<img src="${escapeAttr(image)}" alt="">` : "<span>No thumbnail</span>"}</div><div class="avatar-info"><div class="avatar-name">${escapeHtml(avatar.name || avatar.avatarId)}</div><div class="meta-line">${escapeHtml(avatar.authorName || "Unknown author")}</div><div class="meta-line">${escapeHtml(avatar.avatarId || avatar.id)}</div><div class="badges">${avatar.releaseStatus ? `<span class="badge ${releaseClass}">${escapeHtml(avatar.releaseStatus)}</span>` : ""}${platformBadgeLabels(avatar.platforms).map((p) => `<span class="badge ${p.className}">${escapeHtml(p.label)}</span>`).join("")}${avatarSourceBadgeHtml(avatar.source)}</div></div></button>`;
    card.querySelector("button").addEventListener("click", () => openAvatarDialog({ ...avatar, groupId: state.activeGroupId }));
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, [
        { label: "Equip Avatar", action: () => equipAvatar(avatar.avatarId || avatar.id) },
        { label: "Add to Group", action: () => openAddDatabaseAvatarDialog(avatar) }
      ]);
    });
    grid.appendChild(card);
  }
}
function openAddDatabaseAvatarDialog(avatar) {
  state.pendingDatabaseAvatar = avatar;
  $("addDatabaseAvatarName").textContent = `Choose a group for "${avatar.name || avatar.avatarId}".`;
  fillSelectWithGroups($("databaseAvatarGroupInput"), state.activeGroupId);
  $("addDatabaseAvatarDialog").showModal();
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
  menu.innerHTML = actions.map((a, i) => `<button type="button" data-index="${i}" class="${escapeAttr(a.className || "")}" ${a.disabled ? "disabled" : ""}>${escapeHtml(a.label)}</button>`).join("");
  menu.onclick = (event) => event.stopPropagation();
  menu.hidden = false;
  menu.style.left = `${Math.min(x, window.innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    const action = actions[Number(b.dataset.index)];
    if (!action || action.disabled) return;
    hideContextMenu();
    action.action();
  }));
}
function hideContextMenu() { $("contextMenu").hidden = true; hideSortMenu(); hideSortMenu("databaseSortMenu", "databaseSortMenuBtn"); hideSortMenu("groupFilterMenu", "groupFilterMenuBtn"); }
function renderSortMenu(selectId = "sortSelect", menuId = "sortMenu", buttonId = "sortMenuBtn", onChange = resetAvatarPageAndRender) {
  const select = $(selectId);
  const menu = $(menuId);
  menu.innerHTML = [...select.options].map((o) => `<button type="button" data-value="${escapeAttr(o.value)}" aria-checked="${o.selected}">${escapeHtml(o.textContent)}</button>`).join("");
  menu.querySelectorAll("button").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); select.value = b.dataset.value; hideSortMenu(menuId, buttonId); updateSortButton(selectId, buttonId); onChange(); }));
}
function updateSortButton(selectId = "sortSelect", buttonId = "sortMenuBtn") { const s = $(selectId); $(buttonId).textContent = s.options[s.selectedIndex]?.textContent ?? "Sort"; }
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
function scrollDragContainers(point) {
  if (!state.dragSort) return false;
  const containers = state.dragSort.type === "group" ? [$("groupList")] : isSyncedAvatarEditDrag() ? [$("avatarGrid")] : [$("avatarGrid"), $("groupList")];
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
  const containers = state.dragSort.type === "group" ? [$("groupList")] : isSyncedAvatarEditDrag() ? [$("avatarGrid")] : [$("avatarGrid"), $("groupList")];
  const target = containers.find((container) => {
    const rect = container.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  });
  if (!target) return;
  target.scrollTop += event.deltaY;
  event.preventDefault();
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
    const backup = await api("backupGroup", { id: group.id });
    $("searchInput").value = "";
    state.avatarPage = 0;
    state.syncedAvatarEdit = {
      groupId: group.id,
      avatarIds: orderedGroupAvatars(group.id).map((avatar) => avatar.id),
      backupPath: backup?.path || "",
      applying: false
    };
    $("sortSelect").value = "manual";
    updateSortButton();
    render();
    toast(state.syncedAvatarEdit.backupPath ? `Backup saved to ${state.syncedAvatarEdit.backupPath}` : "Backup saved.");
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
  render();
}
async function applySyncedAvatarEdit() {
  const group = state.library.groups.find((x) => x.id === state.syncedAvatarEdit.groupId);
  if (!group || !isSyncedAvatarEditActive(group.id)) return;
  const savedOrder = currentSyncedEditAvatarOrder();
  const confirmed = await confirmAction({
    title: "Save Synced Order",
    message: `This will back up "${group.name}", clear every VRChat favorite in that group, then refavorite them in reverse save order so VRChat displays the saved left-to-right, row-by-row order. VRCNeph will wait for VRChat rate limits, so this can take some time before the order shows in game.`,
    confirmLabel: "Save",
    confirmClass: "primary"
  });
  if (!confirmed) return;
  state.syncedAvatarEdit.applying = true;
  renderToolbar();
  try {
    $("activeGroupDescription").textContent = "Saving synced order to VRChat. This can take a while...";
    const result = await api("applySyncedAvatarOrder", { groupId: group.id, avatarIds: savedOrder }, 1800000);
    state.library = result.library;
    state.syncedAvatarEdit = { groupId: "", avatarIds: [], backupPath: "", applying: false };
    render();
    toast(`Saved ${result.added || 0} avatars to ${group.name}. Backup: ${result.backupPath || "created"}`);
  } catch (e) {
    state.syncedAvatarEdit.applying = false;
    renderToolbar();
    toast(e.message);
  }
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
function showDropPlacementMenu(drop) {
  if (!drop?.id || !drop?.targetId || drop.id === drop.targetId) {
    clearDragSortIndicators();
    return;
  }
  showContextMenu(drop.x, drop.y, [
    { label: "Move Before", action: () => placeDroppedItem(drop, "before") },
    { label: "Move After", action: () => placeDroppedItem(drop, "after") },
    { label: "Swap Places", action: () => placeDroppedItem(drop, "swap") }
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
async function moveAvatarToGroup(id, groupId, { confirm = true } = {}) {
  const avatar = state.library.avatars.find((x) => x.id === id);
  const group = state.library.groups.find((x) => x.id === groupId);
  if (!avatar || !group || avatar.groupId === groupId) return;
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
  } catch (e) { toast(e.message); }
}
async function moveOrCopyAvatarToGroup(id, groupId) {
  const avatar = state.library.avatars.find((x) => x.id === id);
  const group = state.library.groups.find((x) => x.id === groupId);
  if (!avatar || !group || avatar.groupId === groupId) return;
  if (avatarAlreadyInGroup(avatar, groupId, id)) return showAvatarAlreadyInGroup(avatar, group);
  const choice = await chooseMoveOrCopyAvatar(avatar, group);
  if (choice === "copy") await copyAvatarToGroup(id, groupId);
  else if (choice === "move") await moveAvatarToGroup(id, groupId, { confirm: false });
}
async function copyAvatarToGroup(id, groupId) {
  const avatar = state.library.avatars.find((x) => x.id === id);
  const group = state.library.groups.find((x) => x.id === groupId);
  if (!avatar || !group || avatar.groupId === groupId) return;
  if (avatarAlreadyInGroup(avatar, groupId, id)) return showAvatarAlreadyInGroup(avatar, group);
  if (!syncedGroupHasCapacity(groupId, avatar.avatarId || avatar.id)) return;
  try {
    await pushSyncedAvatarAdd(avatar.avatarId || avatar.id, groupId);
    state.library = await api("copyAvatar", { avatarId: id, groupId });
    state.activeGroupId = groupId;
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
function chooseMoveOrCopyAvatar(avatar, group) {
  return new Promise((resolve) => {
    $("confirmDialogTitle").textContent = "Move or Copy Avatar";
    $("confirmDeleteMessage").textContent = `Move or copy "${avatar.name || avatar.avatarId}" to "${group.name}"?`;
    $("runConfirmBtn").textContent = "Move";
    $("runConfirmBtn").className = "primary";
    $("cancelConfirmBtn").hidden = false;
    $("cancelConfirmBtn").textContent = "Cancel";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "primary";
    copyBtn.textContent = "Copy";
    $("runConfirmBtn").before(copyBtn);
    let settled = false;
    const done = (value) => { if (settled) return; settled = true; $("confirmDeleteDialog").close(); cleanup(); resolve(value); };
    const cleanup = () => { $("runConfirmBtn").onclick = null; $("cancelConfirmBtn").onclick = null; $("cancelConfirmBtn").textContent = "Cancel"; copyBtn.remove(); $("confirmDeleteDialog").removeEventListener("close", closeAsCancel); };
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
  if (notify) toast(`Synced VRChat groups are limited to ${SYNCED_GROUP_AVATAR_LIMIT} avatars.`);
  return false;
}
async function pushSyncedAvatarAdd(avatarId, groupId) {
  if (!isSyncedGroup(groupId) || !state.vrchat?.isLoggedIn || !avatarId) return;
  if (!syncedGroupHasCapacity(groupId, avatarId, "", false)) throw new Error(`Synced VRChat groups are limited to ${SYNCED_GROUP_AVATAR_LIMIT} avatars.`);
  await api("vrchatFavoriteAdd", { avatarId, groupId });
}
async function pushSyncedAvatarRemove(avatarId, groupId) {
  if (!isSyncedGroup(groupId) || !state.vrchat?.isLoggedIn || !avatarId) return;
  await api("vrchatFavoriteRemove", { avatarId, groupId });
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
    state.vrchat = await api("vrchatSession");
    await refreshCurrentAvatarSummarySilent();
    await logCurrentAvatarSilent();
    if (!state.library.groups.some((group) => group.id === previousActiveId)) {
      state.activeGroupId = state.library.groups[0]?.id ?? null;
    } else {
      state.activeGroupId = previousActiveId;
    }
    render();
  } catch {
  } finally {
    state.vrchatSyncBusy = false;
  }
}
function updateVrChatSyncTimer() {
  clearInterval(state.vrchatSyncTimer);
  state.vrchatSyncTimer = null;
  if (!state.vrchat?.isLoggedIn) return;
  syncVrChatFavoritesSilent();
  state.vrchatSyncTimer = setInterval(syncVrChatFavoritesSilent, 15000);
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
  queueSaveSettings();
}
function syncBackgroundOpacityFromNumber() {
  state.settings.backgroundOpacity = Number($("backgroundOpacityNumber").value);
  applyBackgroundOpacity();
  queueSaveSettings();
}
async function copyGroup(group) { if (!group) return; try { state.library = await api("copyGroup", { id: group.id }); state.activeGroupId = state.library.groups.at(-1)?.id ?? state.activeGroupId; render(); toast("Group copied."); } catch (e) { toast(e.message); } }
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
    if (avatar) await pushSyncedAvatarRemove(avatar.avatarId || avatar.id, avatar.groupId);
    state.library = await api("deleteAvatar", { id });
    render();
  } catch (e) { toast(e.message); }
}
async function equipAvatar(id) {
  try {
    const result = await api("vrchatSelectAvatar", { id });
    if (result?.groups && result?.avatars) {
      state.library = result;
      renderGroups();
      if (isRecentGroup(state.activeGroupId)) renderAvatars();
    }
    state.lastLoggedCurrentAvatarId = id;
    const avatar = state.library.avatars.find((x) => (x.avatarId || x.id) === id);
    state.currentAvatarSummary = { id, name: avatar?.name || id };
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

function applySettings() { applyGridSize(); applyThemeColor(state.settings.themeColor); applyBackgroundOpacity(); }
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
function applyThemeColor(hex) {
  const rgb = hexToRgb(hex) ?? hexToRgb(DEFAULT_SETTINGS.themeColor);
  document.documentElement.style.setProperty("--accent", rgbToHex(rgb));
  document.documentElement.style.setProperty("--accent-ink", luminance(rgb) > .55 ? "#08110c" : "#f6fff8");
  document.documentElement.style.setProperty("--bg", rgbToHex(mix({ r: 0, g: 0, b: 0 }, rgb, .13)));
  document.documentElement.style.setProperty("--panel", rgbToHex(mix({ r: 18, g: 22, b: 20 }, rgb, .16)));
  document.documentElement.style.setProperty("--panel-2", rgbToHex(mix({ r: 18, g: 22, b: 20 }, rgb, .28)));
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
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
});
$("addGroupBtn").addEventListener("click", () => openGroupDialog());
$("groupFilterMenuBtn").addEventListener("click", (event) => toggleSortMenu(event, "groupFilterSelect", "groupFilterMenu", "groupFilterMenuBtn", () => { state.groupFilter = $("groupFilterSelect").value; render(); }));
$("editGroupBtn").addEventListener("click", () => openGroupDialog(activeGroup()));
$("copyGroupBtn").addEventListener("click", () => copyGroup(activeGroup()));
$("deleteGroupBtn").addEventListener("click", () => deleteGroup(activeGroup()));
$("addAvatarBtn").addEventListener("click", () => openAvatarDialog());
$("favoritesTabBtn").addEventListener("click", () => showPage("favorites"));
$("databaseTabBtn").addEventListener("click", () => showPage("database"));
$("searchInput").addEventListener("input", resetAvatarPageAndRender);
$("sortMenuBtn").addEventListener("click", toggleSortMenu);
$("databaseSortMenuBtn").addEventListener("click", (event) => toggleSortMenu(event, "databaseSortSelect", "databaseSortMenu", "databaseSortMenuBtn", () => { state.avatarDatabasePage = 0; renderAvatarDatabaseResults(); }));
document.addEventListener("click", hideContextMenu);
document.addEventListener("dragover", autoScrollDrag);
document.addEventListener("wheel", wheelScrollDuringDrag, { passive: false, capture: true });
document.addEventListener("wheel", trackZoomWheel, { passive: true, capture: true });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideContextMenu();
  if (event.key !== "Tab" || document.querySelector("dialog[open]")) return;
  event.preventDefault();
  showPage(state.activePage === "favorites" ? "database" : "favorites");
});
$("avatarGrid").addEventListener("dragover", handleAvatarGridDragOver);
$("avatarGrid").addEventListener("drop", handleAvatarGridDrop);
$("groupList").addEventListener("dragover", handleGroupListDragOver);
$("groupList").addEventListener("drop", handleGroupListDrop);
$("gridSizeInput").addEventListener("input", () => { state.settings.gridSize = Number($("gridSizeInput").value); applyGridSize(); queueSaveSettings(); });
$("databaseGridSizeInput").addEventListener("input", () => { state.settings.databaseGridSize = Number($("databaseGridSizeInput").value); applyGridSize(); queueSaveSettings(); });
window.addEventListener("resize", applyGridSize);
$("customizationBtn").addEventListener("click", () => $("customizationDialog").showModal());
$("syncedAvatarEditToggle").addEventListener("change", async (event) => { await setSyncedAvatarEditMode(event.target.checked); });
$("applySyncedAvatarOrderBtn").addEventListener("click", applySyncedAvatarEdit);
$("cancelSyncedAvatarOrderBtn").addEventListener("click", cancelSyncedAvatarEdit);
$("openGameBtn").addEventListener("click", async () => {
  if (!await confirmAction({ title: "Open Game", message: "Open VRChat in desktop mode?", confirmLabel: "Open", confirmClass: "primary" })) return;
  try { await api("openGame"); } catch (e) { toast(e.message); }
});
$("themeColorInput").addEventListener("input", () => { state.settings.themeColor = $("themeColorInput").value; applyThemeColor(state.settings.themeColor); queueSaveSettings(); });
$("backgroundOpacityInput").addEventListener("input", () => { state.settings.backgroundOpacity = Number($("backgroundOpacityInput").value); applyBackgroundOpacity(); queueSaveSettings(); });
$("backgroundOpacityNumber").addEventListener("input", syncBackgroundOpacityFromNumber);
$("backgroundOpacityPrevBtn").addEventListener("click", () => stepBackgroundOpacity(-1));
$("backgroundOpacityNextBtn").addEventListener("click", () => stepBackgroundOpacity(1));
$("checkUpdateBtn").addEventListener("click", () => checkForUpdates());
$("resetThemeBtn").addEventListener("click", () => { state.settings.themeColor = DEFAULT_SETTINGS.themeColor; state.settings.backgroundOpacity = DEFAULT_SETTINGS.backgroundOpacity; applySettings(); saveSettings(); });
["thumbnailInput", "imageInput"].forEach((id) => $(id).addEventListener("input", updateAvatarPreview));
["releaseStatusInput", "versionInput", "platformsInput", "tagsInput"].forEach((id) => $(id).addEventListener("input", updateAvatarDetailBadges));
$("avatarDetailThumbnailButton").addEventListener("click", () => { const image = $("imageInput").value.trim() || $("thumbnailInput").value.trim(); if (!image) return; $("imagePreviewFull").src = image; $("imagePreviewDialog").showModal(); });
$("avatarDetailAuthorBtn").addEventListener("click", showAvatarAuthorSearchOptions);
["avatarNameInput", "avatarIdInput", "authorNameInput", "authorIdInput"].forEach((id) => $(id).addEventListener("input", updateAvatarAuthorAction));
$("copyAvatarIdBtn").addEventListener("click", async () => {
  const avatarId = $("avatarIdInput").value.trim();
  if (!avatarId) { toast("No avatar ID to copy."); return; }
  try {
    if (await copyTextToClipboard(avatarId)) toast("Avatar ID copied.");
    else toast("Could not copy avatar ID.");
  } catch (e) { toast(e.message); }
});
$("fetchAvatarBtn").addEventListener("click", async (event) => { event.preventDefault(); try { setAvatarForm({ ...(await api("fetchAvatar", { id: $("avatarIdInput").value })), groupId: state.avatarDialogGroupId }); } catch (e) { toast(e.message); } });
$("saveAvatarBtn").addEventListener("click", (event) => { event.preventDefault(); resetAvatarGroupDialogMode(); $("saveAvatarGroupName").textContent = `Choose a group for "${$("avatarNameInput").value.trim() || $("avatarIdInput").value.trim() || "this avatar"}".`; fillSelectWithGroups($("saveAvatarGroupInput"), state.avatarDialogGroupId ?? state.activeGroupId); $("saveAvatarGroupDialog").showModal(); });
$("deleteAvatarBtn").addEventListener("click", async (event) => { event.preventDefault(); await deleteAvatarById(state.editingAvatarId, $("avatarNameInput").value); closeAvatarDetails(); });
$("equipAvatarBtn").addEventListener("click", async () => equipAvatar($("avatarIdInput").value));
$("closeAvatarDetailsBtn").addEventListener("click", closeAvatarDetails);
$("confirmSaveAvatarGroupBtn").addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    const groupId = $("saveAvatarGroupInput").value;
    if (state.pendingMoveAvatarId) {
      const avatarId = state.pendingMoveAvatarId;
      const action = state.pendingAvatarGroupAction || "move";
      resetAvatarGroupDialogMode();
      $("saveAvatarGroupDialog").close();
      if (action === "copy") await copyAvatarToGroup(avatarId, groupId);
      else await moveAvatarToGroup(avatarId, groupId);
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
  } catch (e) { toast(e.message); }
});
$("saveGroupBtn").addEventListener("click", async (event) => { event.preventDefault(); try { state.library = await api(state.editingGroupId ? "updateGroup" : "createGroup", { id: state.editingGroupId ?? "", name: $("groupNameInput").value, description: $("groupDescriptionInput").value }); $("groupDialog").close(); render(); } catch (e) { toast(e.message); } });
$("avatarDatabaseSearchInput").addEventListener("input", () => { state.avatarDatabaseAuthorId = ""; });
$("avatarDatabaseSearchInput").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); runAvatarDatabaseSearch(0); } });
$("searchAvatarDatabaseBtn").addEventListener("click", () => runAvatarDatabaseSearch(0));
$("clearAvatarDatabaseBtn").addEventListener("click", clearAvatarDatabaseSearch);
$("avatarDatabaseProviderMenuBtn").addEventListener("click", (event) => toggleSortMenu(event, "avatarDatabaseProviderSelect", "avatarDatabaseProviderMenu", "avatarDatabaseProviderMenuBtn", () => {
  state.avatarDatabaseProvider = avatarDatabaseProvider();
  resetAvatarDatabaseResults();
}));
$("avatarDatabaseProviderSelect").addEventListener("change", () => {
  state.avatarDatabaseProvider = avatarDatabaseProvider();
  resetAvatarDatabaseResults();
});
["databaseSearchAvatarToggle", "databaseSearchAuthorToggle", "databaseSearchDescriptionToggle", "databaseSearchTagsToggle"].forEach((id) => $(id).addEventListener("change", () => { state.avatarDatabaseAuthorId = ""; }));
$("randomAvatarDatabaseBtn").addEventListener("click", runRandomAvatarDatabasePage);
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
    if (!syncedGroupHasCapacity(groupId, avatar.avatarId || avatar.id)) return;
    await pushSyncedAvatarAdd(avatar.avatarId || avatar.id, groupId);
    state.library = await api("saveAvatar", { ...avatar, id: "", groupId, source: avatar.source || (avatarDatabaseProvider() === "avtrzip" ? "avtrzip" : "avatar-database") });
    state.activeGroupId = groupId;
    state.avatarPage = 0;
    $("addDatabaseAvatarDialog").close();
    render();
    toast(`Added "${avatar.name || avatar.avatarId}".`);
  } catch (e) { toast(e.message); }
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
$("inlineLoginPanel").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); runInlineLogin(); } });
$("inlineTwoFactorPanel").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); runInlineTwoFactor(); } });
$("accountStatus").addEventListener("click", (event) => {
  if (!state.vrchat?.isLoggedIn) return;
  event.stopPropagation();
  showContextMenu(event.clientX, event.clientY, [{ label: "Logout", className: "danger", action: async () => { if (await confirmAction({ title: "Logout", message: "Log out of VRChat?", confirmLabel: "Logout", confirmClass: "danger" })) await logoutVrChat(); } }]);
});
$("logoutBtn").addEventListener("click", async () => { if (await confirmAction({ title: "Logout", message: "Log out of VRChat?", confirmLabel: "Logout", confirmClass: "danger" })) await logoutVrChat(); });
$("saveCurrentAvatarBtn").addEventListener("click", async () => {
  try {
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
Promise.all([loadLibrary(), loadSettings(), loadBackground()])
  .then(loadSession)
  .then(() => {
    requestAnimationFrame(applyGridSize);
    setTimeout(checkPasDatabaseUpdate, 1200);
    setTimeout(() => checkForUpdates({ automatic: true }), 2500);
  })
  .catch((e) => toast(e.message));
