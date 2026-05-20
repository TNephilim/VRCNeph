using System.Diagnostics;
using System.Drawing;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using Microsoft.Data.Sqlite;
using Photino.NET;
using OpenFileDialog = System.Windows.Forms.OpenFileDialog;
using DialogResult = System.Windows.Forms.DialogResult;

namespace VRCNeph;

internal static class AppPaths
{
    public static readonly string RootDirectory = Path.Combine(DocumentsDirectory(), "VRCNeph");
    public static readonly string GroupsDirectory = Path.Combine(RootDirectory, "Groups");
    public static readonly string ExportDirectory = Path.Combine(RootDirectory, "Export");
    public static readonly string BackupsDirectory = Path.Combine(RootDirectory, "Backups");
    public static readonly string AccountBackupsDirectory = Path.Combine(RootDirectory, "Account Avatars Backups");
    public static readonly string BackgroundDirectory = Path.Combine(RootDirectory, "Custom Background");
    public static readonly string GroupBackgroundDirectory = Path.Combine(BackgroundDirectory, "Groups");
    public static readonly string DatabaseDirectory = Path.Combine(RootDirectory, "Database");
    public static readonly string LogsDirectory = Path.Combine(RootDirectory, "Logs");
    public static readonly string InternalDatabasePath = Path.Combine(RootDirectory, "VRCNeph.sqlite3");
    public static readonly string AvatarsJsonPath = Path.Combine(RootDirectory, "avatars.json");
    public static readonly string CategoriesJsonPath = Path.Combine(RootDirectory, "categories.json");
    public static readonly string MessageHistoryPath = Path.Combine(RootDirectory, "messages.json");
    public static readonly string SettingsPath = Path.Combine(GroupsDirectory, "settings.json");
    public static readonly string SessionPath = Path.Combine(GroupsDirectory, "vrchat-session.json");

    private static bool _initialized;

    static AppPaths() => EnsureInitialized();

    public static void EnsureInitialized()
    {
        if (_initialized) return;
        _initialized = true;

        Directory.CreateDirectory(RootDirectory);
        NormalizeFolderName("Groups");
        NormalizeFolderName("Export");
        NormalizeFolderName("Backups");
        MigrateOldAccountBackups();
        NormalizeFolderName("Account Avatars Backups");
        NormalizeFolderName("Custom Background");
        NormalizeFolderName("Database");
        NormalizeFolderName("Logs");
        Directory.CreateDirectory(GroupsDirectory);
        Directory.CreateDirectory(ExportDirectory);
        Directory.CreateDirectory(BackupsDirectory);
        Directory.CreateDirectory(AccountBackupsDirectory);
        Directory.CreateDirectory(BackgroundDirectory);
        Directory.CreateDirectory(GroupBackgroundDirectory);
        Directory.CreateDirectory(DatabaseDirectory);
        Directory.CreateDirectory(LogsDirectory);
        MigrateOldBackups();

        EnsureJsonFile(AvatarsJsonPath, "[]");
        EnsureJsonFile(CategoriesJsonPath, "[]");
        EnsureJsonFile(MessageHistoryPath, "[]");
    }

    private static string DocumentsDirectory()
    {
        var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        if (!string.IsNullOrWhiteSpace(documents)) return documents;
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Documents");
    }

    private static void EnsureJsonFile(string path, string contents)
    {
        if (File.Exists(path)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, contents);
    }

    private static void MigrateOldBackups()
    {
        var oldBackupDirectory = Path.Combine(GroupsDirectory, "deleted groups backup");
        if (!Directory.Exists(oldBackupDirectory)) return;
        foreach (var file in Directory.EnumerateFiles(oldBackupDirectory))
        {
            var target = Path.Combine(BackupsDirectory, Path.GetFileName(file));
            if (File.Exists(target))
            {
                target = Path.Combine(BackupsDirectory, $"{Path.GetFileNameWithoutExtension(file)}-{DateTimeOffset.Now:yyyyMMddHHmmssfff}{Path.GetExtension(file)}");
            }
            File.Move(file, target);
        }

        if (!Directory.EnumerateFileSystemEntries(oldBackupDirectory).Any()) Directory.Delete(oldBackupDirectory);
    }
    private static void MigrateOldAccountBackups()
    {
        var oldDirectory = Path.Combine(RootDirectory, "Account Backups");
        if (!Directory.Exists(oldDirectory)) return;
        var newDirectory = AccountBackupsDirectory;
        Directory.CreateDirectory(newDirectory);
        foreach (var file in Directory.EnumerateFiles(oldDirectory))
        {
            var target = Path.Combine(newDirectory, Path.GetFileName(file));
            if (File.Exists(target))
            {
                target = Path.Combine(newDirectory, $"{Path.GetFileNameWithoutExtension(file)}-{DateTimeOffset.Now:yyyyMMddHHmmssfff}{Path.GetExtension(file)}");
            }
            File.Move(file, target);
        }
        if (!Directory.EnumerateFileSystemEntries(oldDirectory).Any()) Directory.Delete(oldDirectory);
    }

    private static void NormalizeFolderName(string desiredName)
    {
        var existingPath = Directory.EnumerateDirectories(RootDirectory)
            .FirstOrDefault(path => string.Equals(Path.GetFileName(path), desiredName, StringComparison.OrdinalIgnoreCase));
        if (existingPath is null) return;
        if (string.Equals(Path.GetFileName(existingPath), desiredName, StringComparison.Ordinal)) return;

        var desiredPath = Path.Combine(RootDirectory, desiredName);
        var tempPath = Path.Combine(RootDirectory, $".rename-{Guid.NewGuid():N}");
        Directory.Move(existingPath, tempPath);
        Directory.Move(tempPath, desiredPath);
    }
}

internal static class Program
{
    private const string AppUserModelId = "VRCNeph.Desktop";
    private const string UpdateRepositoryOwner = "TNephilim";
    private const string UpdateRepositoryName = "VRCNeph";
    private static readonly AvatarStore Store = new();
    private static readonly AppSettingsStore Settings = new();
    private static readonly MessageHistoryStore MessageHistory = new();
    private static readonly VrChatClient VrChat = new();
    private static readonly BackgroundStore Background = new();
    private static readonly AvatarDatabaseClient AvatarDatabase = new();
    private static readonly AppUpdateClient Updater = new(UpdateRepositoryOwner, UpdateRepositoryName);
    private static readonly AppLogStore Logs = new();
    private static readonly AppDataStore AppData = AppDataStore.Shared;
    private static readonly object SyncedOrderProgressGate = new();
    private static SyncedAvatarOrderProgress SyncedOrderProgress = new("", "idle", "", 0, 0);
    private static VrChatPipelineClient? Pipeline;
    private static PhotinoWindow? AppWindow;
    private static volatile bool AppCloseConfirmed;
    private static volatile bool SyncedOrderCloseBlocked;

    [STAThread]
    private static void Main()
    {
        TrySetAppUserModelId();
        if (!VrChat.HasSavedSession)
        {
            Store.ResetSyncedGroupsToDefaults();
        }

        var appPath = Path.Combine(AppContext.BaseDirectory, "src", "App", "index.html");
        if (!File.Exists(appPath))
        {
            appPath = ExtractAppFiles();
        }

        PhotinoWindow? window = null;
        window = new PhotinoWindow
        {
            Title = "VRCNeph",
            UseOsDefaultSize = false,
            Size = new Size(1500, 920),
            Centered = true,
            Resizable = true,
            Maximized = true
        }
        .RegisterWebMessageReceivedHandler((sender, message) =>
        {
            if (sender is not PhotinoWindow photino)
            {
                return;
            }

            _ = Task.Run(async () =>
            {
                var response = await HandleMessageAsync(message);
                photino.SendWebMessage(JsonSerializer.Serialize(response, ProgramJson.Options));
            });
        })
        .RegisterWindowClosingHandler((sender, _) =>
        {
            var syncedOrderProgress = GetSyncedOrderProgress();
            var syncedOrderApplying = SyncedOrderCloseBlocked || IsSyncedOrderApplying(syncedOrderProgress);
            if (AppCloseConfirmed && !syncedOrderApplying) return false;
            if (sender is PhotinoWindow photino)
            {
                photino.SendWebMessage(JsonSerializer.Serialize(AppEvent.Push("appCloseRequested", new
                {
                    syncedOrderApplying,
                    syncedOrderMessage = syncedOrderProgress.Message
                }), ProgramJson.Options));
            }
            return true;
        })
        .Load(appPath);
        AppWindow = window;
        Pipeline = new VrChatPipelineClient(VrChat, async evt =>
        {
            try
            {
                Logs.Info("Pipeline", $"Live event received: {evt.Type}");
                window.SendWebMessage(JsonSerializer.Serialize(AppEvent.Push("vrchatPipeline", evt), ProgramJson.Options));
                await Task.CompletedTask;
            }
            catch
            {
            }
        }, async status =>
        {
            try
            {
                if (status.Connected) Logs.Info("Pipeline", "Live sync connected.");
                else if (status.State.Equals("Connecting", StringComparison.OrdinalIgnoreCase)) Logs.Info("Pipeline", status.State);
                else if (!status.State.Equals("Stopped", StringComparison.OrdinalIgnoreCase)) Logs.Warn("Pipeline", status.State);
                window.SendWebMessage(JsonSerializer.Serialize(AppEvent.Push("vrchatPipelineStatus", status), ProgramJson.Options));
                await Task.CompletedTask;
            }
            catch
            {
            }
        });

        window.WaitForClose();
        Pipeline.Stop();
    }

    private static void TrySetAppUserModelId()
    {
        if (!OperatingSystem.IsWindows()) return;
        try { SetCurrentProcessExplicitAppUserModelID(AppUserModelId); }
        catch { }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appID);

    private static void UpdateSyncedOrderProgress(SyncedAvatarOrderProgress progress)
    {
        lock (SyncedOrderProgressGate) SyncedOrderProgress = progress;
    }

    private static SyncedAvatarOrderProgress GetSyncedOrderProgress()
    {
        lock (SyncedOrderProgressGate) return SyncedOrderProgress;
    }

    private static bool IsSyncedOrderApplying(SyncedAvatarOrderProgress progress)
    {
        return !string.IsNullOrWhiteSpace(progress.GroupId)
            && !progress.Stage.Equals("idle", StringComparison.OrdinalIgnoreCase)
            && !progress.Stage.Equals("complete", StringComparison.OrdinalIgnoreCase)
            && !progress.Stage.Equals("failed", StringComparison.OrdinalIgnoreCase);
    }

    private static string ExtractAppFiles()
    {
        var target = Path.Combine(Path.GetTempPath(), "VRCNeph-app");
        Directory.CreateDirectory(target);
        foreach (var name in Assembly.GetExecutingAssembly().GetManifestResourceNames().Where(x => x.Contains(".src.App.")))
        {
            var shortName = name[(name.LastIndexOf(".src.App.", StringComparison.Ordinal) + 9)..];
            var path = Path.Combine(target, shortName);
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
            if (stream is null) continue;
            using var file = File.Create(path);
            stream.CopyTo(file);
        }
        return Path.Combine(target, "index.html");
    }

    private static async Task<ApiResponse> HandleMessageAsync(string message)
    {
        ApiRequest? request = null;
        try
        {
            request = JsonSerializer.Deserialize<ApiRequest>(message, ProgramJson.Options);
            if (request is null) return ApiResponse.Failure(null, "Invalid request.");
            var result = request.Command switch
            {
                "list" => Store.GetLibrary(),
                "logsList" => Logs.List(),
                "logsClear" => Logs.Clear(),
                "logsFolder" => new { path = AppPaths.LogsDirectory },
                "syncHealth" => AppData.GetSyncHealth(),
                "syncActionsList" => AppData.ListSyncActions(),
                "syncConflictsList" => AppData.ListSyncConflicts(),
                "syncActionRecord" => AppData.RecordSyncAction(GetPayload<SyncActionRecordInput>(request)),
                "syncActionDismiss" => AppData.DismissSyncAction(GetPayload<IdInput>(request).Id),
                "syncConflictResolve" => AppData.ResolveSyncConflict(GetPayload<IdInput>(request).Id),
                "syncConflictsResolve" => AppData.ResolveSyncConflicts(GetPayload<IdsInput>(request).Ids),
                "metadataHistoryList" => AppData.ListMetadataHistory(),
                "messageHistoryLoad" => MessageHistory.Load(),
                "messageHistorySave" => MessageHistory.Save(GetPayload<MessageHistorySaveInput>(request).Items),
                "messageHistoryClear" => MessageHistory.Clear(),
                "diagnosticsGet" => await Diagnostics.GetAsync(VrChat, AvatarDatabase, Updater),
                "createGroup" => Store.CreateGroup(GetPayload<GroupInput>(request)),
                "updateGroup" => Store.UpdateGroup(GetPayload<GroupInput>(request)),
                "deleteGroup" => Store.DeleteGroup(GetPayload<IdInput>(request).Id),
                "copyGroup" => Store.CopyGroup(GetPayload<IdInput>(request).Id),
                "copyGroupToExisting" => Store.CopyGroupToExisting(GetPayload<CopyGroupToExistingInput>(request)),
                "setGroupReorderLock" => Store.SetGroupReorderLock(GetPayload<GroupLockInput>(request)),
                "reorderGroup" => Store.ReorderGroup(GetPayload<ReorderInput>(request)),
                "saveAvatar" => Store.SaveAvatar(GetPayload<AvatarInput>(request)),
                "deleteAvatar" => Store.DeleteAvatar(GetPayload<IdInput>(request).Id),
                "moveAvatar" => Store.MoveAvatar(GetPayload<MoveAvatarInput>(request)),
                "copyAvatar" => Store.CopyAvatar(GetPayload<MoveAvatarInput>(request)),
                "reorderAvatar" => Store.ReorderAvatar(GetPayload<ReorderInput>(request)),
                "reorderAvatars" => Store.ReorderAvatars(GetPayload<AvatarOrderInput>(request)),
                "backupGroup" => Store.BackupGroup(GetPayload<IdInput>(request).Id),
                "accountBackupCreate" => Store.CreateAccountBackup("manual"),
                "accountBackupList" => Store.ListAccountBackups(),
                "accountBackupFolder" => new { path = AppPaths.AccountBackupsDirectory },
                "applySyncedAvatarOrder" => await ApplySyncedAvatarOrderWithCloseBlock(GetPayload<SyncedAvatarOrderInput>(request)),
                "syncedAvatarOrderProgress" => GetSyncedOrderProgress(),
                "clearGroupAvatars" => await Store.ClearGroupAvatarsAsync(GetPayload<IdInput>(request).Id, VrChat),
                "importLibrary" => Store.Import(request.Payload),
                "exportLibrary" => Store.ExportToFile(),
                "exportGroup" => Store.ExportGroup(GetPayload<IdInput>(request).Id),
                "openFolder" => OpenFolder(GetPayload<IdInput>(request).Path),
                "openGame" => OpenGame(),
                "pickGroupIcon" => PickGroupIcon(),
                "fetchAvatar" => await VrChat.FetchAvatarAsync(GetPayload<IdInput>(request).Id),
                "vrchatSession" => await VrChat.GetSessionAsync(),
                "vrchatLogin" => await VrChat.LoginAsync(GetPayload<LoginInput>(request)),
                "vrchatTwoFactor" => await VrChat.TwoFactorAsync(GetPayload<TwoFactorInput>(request)),
                "vrchatUpdateCurrentUser" => await VrChat.UpdateCurrentUserAsync(GetPayload<VrChatProfileUpdateInput>(request)),
                "vrchatLogout" => LogoutAndResetSyncedGroups(),
                "vrchatPipelineStart" => Pipeline is null ? VrChatPipelineStatus.Unavailable : await Pipeline.StartAsync(),
                "vrchatPipelineStop" => PipelineStop(),
                "vrchatPipelineStatus" => Pipeline?.Status() ?? VrChatPipelineStatus.Unavailable,
                "vrchatSyncFavorites" => await Store.SyncVrChatFavoritesAsync(VrChat),
                "vrchatSaveCurrentAvatar" => Store.SaveCurrentAvatar(await VrChat.CurrentAvatarAsync(), GetPayload<CurrentAvatarInput>(request).GroupId),
                "vrchatCurrentAvatar" => await VrChat.CurrentAvatarAsync(),
                "vrchatSelectAvatar" => await SelectAndLogAvatarAsync(GetPayload<IdInput>(request).Id),
                "vrchatLogAvatar" => Store.SaveRecentAvatar(await VrChat.FetchAvatarAsync(GetPayload<IdInput>(request).Id)),
                "vrchatLatestLogAvatar" => VrChatLogWatcher.LatestAvatarForUser(GetPayload<IdInput>(request).Id),
                "vrchatLogCurrentAvatar" => Store.SaveRecentAvatar(await VrChat.CurrentAvatarAsync()),
                "vrchatFriendsList" => await VrChat.GetFriendsAsync(GetPayload<PageInput>(request)),
                "vrchatFriendDetail" => await VrChat.GetFriendAsync(GetPayload<IdInput>(request).Id),
                "vrchatFavoriteFriends" => await VrChat.GetFavoriteFriendsAsync(GetPayload<PageInput>(request)),
                "vrchatUserCurrentAvatar" => await VrChat.GetUserCurrentAvatarAsync(GetPayload<IdInput>(request).Id),
                "vrchatFriendGroups" => await VrChat.GetUserGroupsAsync(GetPayload<IdInput>(request).Id),
                "vrchatGroupDetail" => await VrChat.GetGroupDetailAsync(GetPayload<IdInput>(request).Id),
                "vrchatGroupMembers" => await VrChat.GetGroupMembersAsync(GetPayload<IdInput>(request).Id),
                "vrchatUserUploadedAvatars" => await VrChat.GetUserUploadedAvatarsAsync(GetPayload<IdInput>(request).Id),
                "vrchatUserWorlds" => await VrChat.GetUserWorldsAsync(GetPayload<IdInput>(request).Id),
                "vrchatMutualFriends" => await VrChat.GetMutualFriendsAsync(GetPayload<IdInput>(request).Id),
                "vrchatEncounterHistory" => VrChatLogWatcher.EncounterHistory(GetPayload<EncounterHistoryInput>(request)),
                "vrchatPlayerActivityLog" => VrChatLogWatcher.PlayerActivityLog(GetPayload<PlayerActivityLogInput>(request)),
                "vrchatFriendRequest" => await VrChat.SendFriendRequestAsync(GetPayload<IdInput>(request).Id),
                "vrchatUnfriend" => await VrChat.UnfriendAsync(GetPayload<IdInput>(request).Id),
                "vrchatBlockUser" => await VrChat.ModerateUserAsync(GetPayload<UserModerationInput>(request).Id, "block"),
                "vrchatUnblockUser" => await VrChat.UnmoderateUserAsync(GetPayload<UserModerationInput>(request).Id, "block"),
                "vrchatInviteMessages" => await VrChat.GetInviteMessagesAsync(GetPayload<InviteMessageInput>(request).Type),
                "vrchatUpdateInviteMessage" => await VrChat.UpdateInviteMessageAsync(GetPayload<InviteMessageUpdateInput>(request)),
                "vrchatInviteUser" => await VrChat.InviteUserAsync(GetPayload<InviteUserInput>(request)),
                "vrchatRequestInvite" => await VrChat.RequestInviteAsync(GetPayload<RequestInviteInput>(request)),
                "vrchatSendChatMessage" => await VrChat.SendChatMessageAsync(GetPayload<ChatMessageInput>(request)),
                "vrchatNotifications" => await VrChat.GetNotificationsAsync(GetPayload<PageInput>(request)),
                "vrchatAcceptFriendRequest" => await VrChat.AcceptFriendRequestAsync(GetPayload<IdInput>(request).Id),
                "vrchatDeclineNotification" => await VrChat.DeleteNotificationAsync(GetPayload<IdInput>(request).Id),
                "vrchatWorldSearch" => await VrChat.SearchWorldsAsync(GetPayload<WorldSearchInput>(request)),
                "vrchatFavoriteWorlds" => await VrChat.GetFavoriteWorldsAsync(GetPayload<PageInput>(request)),
                "vrchatFavoriteWorldGroups" => await VrChat.GetFavoriteWorldGroupsAsync(GetPayload<PageInput>(request)),
                "vrchatFavoriteWorldAdd" => await VrChat.AddFavoriteWorldAsync(GetPayload<WorldFavoriteInput>(request)),
                "vrchatFavoriteWorldRemove" => await VrChat.RemoveFavoriteWorldAsync(GetPayload<IdInput>(request).Id),
                "vrchatWorldDetail" => await VrChat.GetWorldDetailAsync(GetPayload<IdInput>(request).Id),
                "vrchatWorldVisitHistory" => VrChatLogWatcher.WorldVisitHistory(GetPayload<WorldVisitHistoryInput>(request)),
                "vrchatLatestLogLocation" => VrChatLogWatcher.LatestWorldLocation(),
                "vrchatOpenWorld" => await VrChat.OpenWorldAsync(GetPayload<WorldLaunchInput>(request)),
                "vrchatCurrentLocation" => await VrChat.GetCurrentLocationAsync(),
                "vrchatFavoriteAdd" => await VrChat.AddFavoriteAvatarAsync(GetPayload<VrChatFavoriteChangeInput>(request)),
                "vrchatFavoriteRemove" => await VrChat.RemoveFavoriteAvatarAsync(GetPayload<VrChatFavoriteChangeInput>(request)),
                "settingsGet" => Settings.Get(),
                "settingsSave" => Settings.Save(GetPayload<AppSettings>(request)),
                "backgroundGet" => Background.GetBackground(GetPayload<BackgroundInput>(request).GroupId, Store.GroupName(GetPayload<BackgroundInput>(request).GroupId)),
                "backgroundFolder" => BackgroundFolder(GetPayload<BackgroundInput>(request)),
                "backgroundImport" => ImportBackgrounds(GetPayload<BackgroundInput>(request)),
                "backgroundClear" => ClearBackgrounds(GetPayload<BackgroundInput>(request)),
                "backupList" => ListBackups(),
                "backupRestore" => Store.RestoreBackup(GetPayload<BackupRestoreInput>(request)),
                "avatarDatabaseSearch" => await AvatarDatabase.SearchAsync(GetPayload<AvatarSearchInput>(request), VrChat),
                "avatarDatabaseCount" => await AvatarDatabase.CountAsync(GetPayload<AvatarSearchInput>(request)),
                "avatarDatabaseCountProgress" => AvatarDatabase.CountProgress(GetPayload<AvatarSearchInput>(request)),
                "avatarDatabaseRandom" => await AvatarDatabase.RandomAsync(GetPayload<AvatarSearchInput>(request), VrChat),
                "avatarDatabaseResolveImage" => await AvatarDatabase.ResolveByImageAsync(GetPayload<AvatarImageResolveInput>(request), VrChat),
                "avatarDatabaseVrcxStatus" => AvatarDatabase.GetVrcxStatus(),
                "avatarDatabasePasUpdateStatus" => await AvatarDatabase.GetPasUpdateStatusAsync(),
                "avatarDatabasePasUpdate" => await AvatarDatabase.UpdatePasDatabaseAsync(),
                "appVersion" => AppUpdateClient.CurrentVersionInfo(UpdateRepositoryOwner, UpdateRepositoryName),
                "updateCheck" => await Updater.CheckAsync(),
                "updateInstall" => await Updater.InstallAsync(),
                "appCloseConfirmed" => CloseApp(),
                _ => throw new InvalidOperationException($"Unknown command '{request.Command}'.")
            };
            LogCommandSuccess(request.Command, result);
            return ApiResponse.Success(request.Id, result);
        }
        catch (Exception ex)
        {
            if (request is not null) LogCommandFailure(request.Command, ex);
            return ApiResponse.Failure(request?.Id, ex.Message);
        }
    }

    private static void LogCommandSuccess(string command, object? result)
    {
        switch (command)
        {
            case "deleteGroup": Logs.Warn("Groups", "Group deleted."); break;
            case "deleteAvatar": Logs.Warn("Avatars", "Avatar deleted."); break;
            case "clearGroupAvatars":
                if (result is GroupClearResult clear) Logs.Warn("Avatars", $"Cleared {clear.Removed} avatars from group.");
                else Logs.Warn("Avatars", "Cleared group avatars.");
                break;
            case "backupRestore": Logs.Warn("Backups", "Backup restored."); break;
            case "accountBackupCreate": Logs.Info("Backups", "Account backup created."); break;
            case "importLibrary": Logs.Info("Import", "Library import completed."); break;
            case "exportLibrary": Logs.Info("Export", "Library export completed."); break;
            case "exportGroup": Logs.Info("Export", "Group export completed."); break;
            case "vrchatLogin":
                Logs.Info("VRChat", result is VrChatSessionState session && session.RequiresTwoFactor ? "VRChat login requires two-factor verification." : "VRChat login completed.");
                break;
            case "vrchatTwoFactor": Logs.Info("VRChat", "VRChat two-factor verification completed."); break;
            case "vrchatLogout": Logs.Info("VRChat", "VRChat logout completed."); break;
            case "vrchatSendChatMessage": Logs.Info("VRChat", "Message sent through invite system."); break;
            case "vrchatNotifications": Logs.Info("VRChat", "Notifications refreshed."); break;
            case "vrchatAcceptFriendRequest": Logs.Info("VRChat", "Friend request accepted."); break;
            case "vrchatDeclineNotification": Logs.Info("VRChat", "Notification declined."); break;
            case "vrchatSyncFavorites":
                if (result is VrChatSyncResult sync)
                {
                    AppData.RecordSyncResult(sync, true, "");
                    Logs.Info("VRChat", $"Favorites synced. Groups: {sync.GroupsSynced}. Avatars: {sync.AvatarsSynced}. Updated: {sync.UpdatedAvatars}. Uploaded: {sync.UploadedAvatars}. Moved to deleted: {sync.MovedToDeleted}.");
                }
                else Logs.Info("VRChat", "Favorites synced.");
                break;
            case "avatarDatabasePasUpdate": Logs.Info("Database", "Prismic PAS database updated."); break;
            case "updateInstall": Logs.Warn("Updater", "Update install started."); break;
        }
    }

    private static void LogCommandFailure(string command, Exception ex)
    {
        if (command is "logsList" or "logsFolder") return;
        var area = command.StartsWith("vrchat", StringComparison.OrdinalIgnoreCase) ? "VRChat"
            : command.StartsWith("avatarDatabase", StringComparison.OrdinalIgnoreCase) ? "Database"
            : command.Contains("Group", StringComparison.OrdinalIgnoreCase) ? "Groups"
            : command.Contains("Avatar", StringComparison.OrdinalIgnoreCase) ? "Avatars"
            : "App";
        Logs.Error(area, $"{command} failed.", ex.Message);
        if (command.Equals("vrchatSyncFavorites", StringComparison.OrdinalIgnoreCase))
        {
            AppData.RecordSyncFailure(ex.Message);
        }
    }

    private static VrChatSessionState LogoutAndResetSyncedGroups()
    {
        Pipeline?.Stop();
        var session = VrChat.Logout();
        Store.ResetSyncedGroupsToDefaults();
        return session;
    }

    private static VrChatPipelineStatus PipelineStop()
    {
        Pipeline?.Stop();
        return Pipeline?.Status() ?? VrChatPipelineStatus.Stopped;
    }

    private static async Task<SyncedAvatarOrderApplyResult> ApplySyncedAvatarOrderWithCloseBlock(SyncedAvatarOrderInput input)
    {
        AppCloseConfirmed = false;
        SyncedOrderCloseBlocked = true;
        UpdateSyncedOrderProgress(new SyncedAvatarOrderProgress(input.GroupId, "starting", "Starting synced order save...", 0, input.AvatarIds?.Count ?? 0));
        try
        {
            return await Store.ApplySyncedGroupAvatarOrderAsync(input, VrChat, UpdateSyncedOrderProgress);
        }
        finally
        {
            SyncedOrderCloseBlocked = false;
        }
    }

    private static object CloseApp()
    {
        AppCloseConfirmed = true;
        AppWindow?.Close();
        return new { closing = true };
    }

    private static object OpenFolder(string path)
    {
        var folder = File.Exists(path) ? Path.GetDirectoryName(path)! : path;
        if (Directory.Exists(folder))
        {
            Process.Start(new ProcessStartInfo("explorer.exe", folder) { UseShellExecute = true });
        }
        return new { path = folder };
    }

    private static object OpenGame()
    {
        Process.Start(new ProcessStartInfo("steam://run/438100//--no-vr") { UseShellExecute = true });
        return new { ok = true };
    }

    private static object BackgroundFolder(BackgroundInput input)
    {
        if (!string.IsNullOrWhiteSpace(input.GroupId)) Store.EnsureGroupExists(input.GroupId);
        return new { path = Background.Folder(input.GroupId, Store.GroupName(input.GroupId)) };
    }

    private static object ImportBackgrounds(BackgroundInput input)
    {
        if (!string.IsNullOrWhiteSpace(input.GroupId)) Store.EnsureGroupExists(input.GroupId);
        var result = Background.Import(input.GroupId, Store.GroupName(input.GroupId));
        if (!string.IsNullOrWhiteSpace(input.GroupId))
        {
            Store.SetGroupBackgroundFolder(input.GroupId, BackgroundStore.HasGroupBackground(input.GroupId, Store.GroupName(input.GroupId)));
        }
        return result;
    }

    private static object ClearBackgrounds(BackgroundInput input)
    {
        if (!string.IsNullOrWhiteSpace(input.GroupId)) Store.EnsureGroupExists(input.GroupId);
        var result = Background.Clear(input.GroupId, Store.GroupName(input.GroupId));
        if (!string.IsNullOrWhiteSpace(input.GroupId)) Store.SetGroupBackgroundFolder(input.GroupId, false);
        return result;
    }

    private static object PickGroupIcon()
    {
        string icon = "";
        Exception? error = null;
        var thread = new Thread(() =>
        {
            try
            {
                using var dialog = new OpenFileDialog
                {
                    Title = "Choose Group Icon",
                    Filter = "Image files|*.png;*.jpg;*.jpeg;*.gif;*.bmp|All files|*.*",
                    Multiselect = false,
                    CheckFileExists = true
                };
                if (dialog.ShowDialog() == DialogResult.OK && !string.IsNullOrWhiteSpace(dialog.FileName))
                {
                    icon = BuildGroupIconDataUrl(dialog.FileName);
                }
            }
            catch (Exception ex)
            {
                error = ex;
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();

        if (error is not null) throw error;
        if (string.IsNullOrWhiteSpace(icon))
        {
            return new { canceled = true, icon = "" };
        }

        return new { canceled = false, icon };
    }
    private static string BuildGroupIconDataUrl(string path)
    {
        using var source = Image.FromFile(path);
        using var canvas = new Bitmap(64, 64);
        canvas.SetResolution(96, 96);
        using (var graphics = Graphics.FromImage(canvas))
        {
            graphics.Clear(Color.Transparent);
            graphics.CompositingQuality = CompositingQuality.HighQuality;
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.SmoothingMode = SmoothingMode.HighQuality;
            var scale = Math.Min(64f / source.Width, 64f / source.Height);
            var width = Math.Max(1, (int)Math.Round(source.Width * scale));
            var height = Math.Max(1, (int)Math.Round(source.Height * scale));
            var x = (64 - width) / 2;
            var y = (64 - height) / 2;
            graphics.DrawImage(source, x, y, width, height);
        }

        using var stream = new MemoryStream();
        canvas.Save(stream, ImageFormat.Png);
        return $"data:image/png;base64,{Convert.ToBase64String(stream.ToArray())}";
    }

    private static object ListBackups()
    {
        return Store.ListGroupBackups();
    }

    private static string BackupDisplayName(string path)
    {
        try
        {
            var summary = JsonSerializer.Deserialize<GroupFileSummary>(File.ReadAllText(path), ProgramJson.Options);
            if (!string.IsNullOrWhiteSpace(summary?.Name)) return summary.Name.Trim();
        }
        catch
        {
        }
        return Path.GetFileNameWithoutExtension(path);
    }

    private static string BackupReason(string fileName)
    {
        var name = Path.GetFileNameWithoutExtension(fileName);
        if (name.EndsWith("-pre-save", StringComparison.OrdinalIgnoreCase)) return "Edit mode";
        if (name.EndsWith("-pre-replace", StringComparison.OrdinalIgnoreCase)) return "Replace synced group";
        if (name.EndsWith("-edit", StringComparison.OrdinalIgnoreCase)) return "Edit mode";
        if (name.EndsWith("-unfavorited", StringComparison.OrdinalIgnoreCase)) return "Unfavorite All";
        if (name.EndsWith("-deleted", StringComparison.OrdinalIgnoreCase)) return "Deleted group";
        return "Cleanup backup";
    }

    private static async Task<LibraryData> SelectAndLogAvatarAsync(string id)
    {
        await VrChat.SelectAvatarAsync(id);
        try
        {
            return Store.SaveRecentAvatar(await VrChat.FetchAvatarAsync(id));
        }
        catch
        {
            return Store.SaveRecentAvatar(new AvatarInput
            {
                AvatarId = id,
                Name = id,
                SourceUrl = $"https://vrchat.com/home/avatar/{id}",
                Source = "vrchat-recent"
            });
        }
    }

    private static T GetPayload<T>(ApiRequest request) =>
        request.Payload.Deserialize<T>(ProgramJson.Options) ?? throw new InvalidOperationException("Could not parse request payload.");
}

internal sealed class AppUpdateClient(string owner, string repository)
{
    private static readonly HttpClient Client = new();
    private readonly string _owner = owner;
    private readonly string _repository = repository;

    public static AppVersionInfo CurrentVersionInfo(string owner, string repository) =>
        new(CurrentVersion, $"https://github.com/{owner}/{repository}/releases/latest");

    public async Task<AppUpdateInfo> CheckAsync()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"https://api.github.com/repos/{_owner}/{_repository}/releases/latest");
        request.Headers.UserAgent.ParseAdd("VRCNeph-Updater");
        using var response = await Client.SendAsync(request);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return await CheckRawRepositoryAsync();
        }
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"GitHub update check returned {(int)response.StatusCode}.");

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        var tag = ReadString(root, "tag_name") ?? "";
        var latestVersion = NormalizeVersion(tag);
        var releaseUrl = ReadString(root, "html_url") ?? $"https://github.com/{_owner}/{_repository}/releases/latest";
        var assetUrl = FindExeAssetUrl(root);
        var hasUpdate = IsNewer(latestVersion, CurrentVersion);
        var notes = hasUpdate && string.IsNullOrWhiteSpace(assetUrl) ? "Latest release has no VRCNeph.exe asset." : "";
        return new AppUpdateInfo(hasUpdate, CurrentVersion, latestVersion, releaseUrl, assetUrl, notes);
    }

    private async Task<AppUpdateInfo> CheckRawRepositoryAsync()
    {
        var projectUrl = $"https://raw.githubusercontent.com/{_owner}/{_repository}/main/Source/VRCNeph.csproj";
        using var request = new HttpRequestMessage(HttpMethod.Get, projectUrl);
        request.Headers.UserAgent.ParseAdd("VRCNeph-Updater");
        using var response = await Client.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            return new AppUpdateInfo(false, CurrentVersion, "", $"https://github.com/{_owner}/{_repository}", "", $"No public update source was found for {_owner}/{_repository}.");
        }

        var project = await response.Content.ReadAsStringAsync();
        var match = System.Text.RegularExpressions.Regex.Match(project, @"<Version>(?<version>[^<]+)</Version>", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var latestVersion = match.Success ? NormalizeVersion(match.Groups["version"].Value) : "";
        var assetUrl = $"https://raw.githubusercontent.com/{_owner}/{_repository}/main/VRCNeph.exe";
        var hasUpdate = IsNewer(latestVersion, CurrentVersion);
        return new AppUpdateInfo(hasUpdate, CurrentVersion, latestVersion, $"https://github.com/{_owner}/{_repository}", assetUrl, "");
    }

    public async Task<AppUpdateInstallResult> InstallAsync()
    {
        var info = await CheckAsync();
        if (!info.UpdateAvailable) return new AppUpdateInstallResult(false, "No update is available.");
        if (string.IsNullOrWhiteSpace(info.AssetUrl)) throw new InvalidOperationException("Latest release does not include VRCNeph.exe.");

        var tempExe = Path.Combine(Path.GetTempPath(), $"VRCNeph-update-{Guid.NewGuid():N}.exe");
        using (var request = new HttpRequestMessage(HttpMethod.Get, info.AssetUrl))
        {
            request.Headers.UserAgent.ParseAdd("VRCNeph-Updater");
            using var response = await Client.SendAsync(request);
            response.EnsureSuccessStatusCode();
            await using var source = await response.Content.ReadAsStreamAsync();
            await using var target = File.Create(tempExe);
            await source.CopyToAsync(target);
        }

        var currentExe = Process.GetCurrentProcess().MainModule?.FileName ?? Path.Combine(AppContext.BaseDirectory, "VRCNeph.exe");
        var scriptPath = Path.Combine(Path.GetTempPath(), $"VRCNeph-update-{Guid.NewGuid():N}.ps1");
        var script = $$"""
            $ErrorActionPreference = 'Stop'
            $pidToWait = {{Environment.ProcessId}}
            $newExe = {{PowerShellString(tempExe)}}
            $targetExe = {{PowerShellString(currentExe)}}
            Wait-Process -Id $pidToWait -ErrorAction SilentlyContinue
            Copy-Item -LiteralPath $newExe -Destination $targetExe -Force
            Remove-Item -LiteralPath $newExe -Force -ErrorAction SilentlyContinue
            Start-Process -FilePath $targetExe -WorkingDirectory (Split-Path -Parent $targetExe)
            Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
            """;
        await File.WriteAllTextAsync(scriptPath, script);
        Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -ExecutionPolicy Bypass -File {PowerShellArgument(scriptPath)}")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        });

        _ = Task.Run(async () =>
        {
            await Task.Delay(400);
            Environment.Exit(0);
        });
        return new AppUpdateInstallResult(true, $"Updating to {info.LatestVersion}. VRCNeph will restart.");
    }

    private static string CurrentVersion =>
        Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ??
        Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ??
        "0.0.0";

    private static string NormalizeVersion(string version) => version.Trim().TrimStart('v', 'V');

    private static bool IsNewer(string latest, string current)
    {
        if (!Version.TryParse(NormalizeVersion(latest), out var latestVersion)) return false;
        if (!Version.TryParse(NormalizeVersion(current), out var currentVersion)) return false;
        return latestVersion > currentVersion;
    }

    private static string FindExeAssetUrl(JsonElement release)
    {
        if (!release.TryGetProperty("assets", out var assets) || assets.ValueKind != JsonValueKind.Array) return "";
        foreach (var asset in assets.EnumerateArray())
        {
            var name = ReadString(asset, "name") ?? "";
            if (!name.Equals("VRCNeph.exe", StringComparison.OrdinalIgnoreCase)) continue;
            return ReadString(asset, "browser_download_url") ?? "";
        }
        return "";
    }

    private static string? ReadString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static string PowerShellString(string value) => $"'{value.Replace("'", "''")}'";
    private static string PowerShellArgument(string value) => $"\"{value.Replace("\"", "\\\"")}\"";
}

internal sealed record AppVersionInfo(string CurrentVersion, string ReleaseUrl);
internal sealed record AppUpdateInfo(bool UpdateAvailable, string CurrentVersion, string LatestVersion, string ReleaseUrl, string AssetUrl, string Notes);
internal sealed record AppUpdateInstallResult(bool Restarting, string Message);
internal sealed record BackupFileInfo(string Name, string DisplayName, string Path, long Size, DateTime LastModified, string Reason, string GroupId, string BackupType);
internal sealed record BackupListResult(string Folder, List<BackupFileInfo> Files);
internal sealed record AccountBackupFileInfo(string Name, string Path, long Size, DateTime LastModified, DateTimeOffset CreatedAt, string Reason, int GroupCount, int AvatarCount);
internal sealed record AccountBackupListResult(string Folder, int Retention, List<AccountBackupFileInfo> Files);
internal sealed record AccountBackupResult(string Path, DateTimeOffset CreatedAt, int GroupCount, int AvatarCount, string Reason, int Retention);
internal sealed record GroupBackupFile(string Path, string Name, string GroupId, string DisplayName, string Reason, string BackupType, DateTime LastWriteTimeUtc, long Size);

internal sealed class AvatarStore
{
    private readonly AppDataStore _appData = AppDataStore.Shared;
    private const int AccountBackupRetention = 5;
    private const int SyncedGroupBackupRetention = 5;
    private const int LocalGroupBackupRetention = 5;
    private const int SystemGroupBackupRetention = 5;
    private const int BackupMaxAgeDays = 60;
    private const string SyncedBackupFolderName = "Synced Groups";
    private const string LocalBackupFolderName = "Local Groups";
    private const string DeletedBackupFolderName = "Deleted Groups";
    private const string SystemBackupFolderName = "System Groups";
    private const int DefaultSyncedGroupCount = 1;
    private const int SyncedGroupAvatarLimit = 50;
    private const string RecentAvatarGroupId = "recent_avatars";
    private const string RecentAvatarGroupName = "Recent Avatars";
    private const string DeletedAvatarGroupId = "deleted_avatars";
    private const string DeletedAvatarGroupName = "Deleted Avatars";
    private const string UploadedAvatarGroupId = "uploaded_avatars";
    private const string UploadedAvatarGroupName = "Uploaded Avatars";
    private const string UpdatedAvatarGroupId = "updated_avatars";
    private const string UpdatedAvatarGroupName = "Updated Avatars";
    private readonly string _dataDirectory = AppPaths.GroupsDirectory;
    private readonly string _exportDirectory = AppPaths.ExportDirectory;
    private readonly string _backupDirectory = AppPaths.BackupsDirectory;
    private readonly string _accountBackupDirectory = AppPaths.AccountBackupsDirectory;
    private readonly string _libraryPath;
    private readonly string _avatarsJsonPath = AppPaths.AvatarsJsonPath;
    private readonly string _categoriesJsonPath = AppPaths.CategoriesJsonPath;
    private readonly object _gate = new();

    public AvatarStore()
    {
        AppPaths.EnsureInitialized();
        Directory.CreateDirectory(_dataDirectory);
        Directory.CreateDirectory(_exportDirectory);
        Directory.CreateDirectory(_backupDirectory);
        Directory.CreateDirectory(_accountBackupDirectory);
        _libraryPath = Path.Combine(_dataDirectory, "library.json");
        if (!File.Exists(_libraryPath))
        {
            Save(CreateDefaultLibrary());
        }
        else
        {
            Save(Load());
        }
        MigrateGroupBackupsToTypeFolders();
        PruneGroupBackups();
        PruneAccountBackups();
    }

    public LibraryData GetLibrary() { lock (_gate) return Load(); }
    public string GroupName(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) return "";
        lock (_gate) return Load().Groups.FirstOrDefault(x => x.Id.Equals(id, StringComparison.OrdinalIgnoreCase))?.Name ?? "";
    }
    public LibraryData ResetSyncedGroupsToDefaults()
    {
        lock (_gate)
        {
            var lib = Load();
            ResetSyncedGroupsToDefaults(lib, DateTimeOffset.UtcNow);
            Save(lib);
            return lib;
        }
    }
    public LibraryData CreateGroup(GroupInput input)
    {
        lock (_gate)
        {
            var lib = Load();
            var now = DateTimeOffset.UtcNow;
            var groupId = NewId("grp");
            var groupName = CleanRequired(input.Name, "Group name");
            lib.Groups.Add(new AvatarGroup { Id = groupId, Name = groupName, Description = input.Description?.Trim() ?? "", Icon = CleanGroupIcon(input.Icon), BackgroundFolder = NormalizeGroupBackgroundFolder(groupId, groupName, input.BackgroundFolder), BackgroundEffect = CleanBackgroundEffect(input.BackgroundEffect), Order = NextGroupOrder(lib), CreatedAt = now, UpdatedAt = now });
            Save(lib);
            return lib;
        }
    }
    public LibraryData UpdateGroup(GroupInput input)
    {
        lock (_gate)
        {
            var lib = Load();
            var group = lib.Groups.FirstOrDefault(x => x.Id == input.Id) ?? throw new InvalidOperationException("Group not found.");
            var locked = IsPinnedSystemGroupId(group.Id) || IsSyncedGroupId(group.Id);
            var cleanName = CleanRequired(input.Name, "Group name");
            var cleanDescription = input.Description?.Trim() ?? "";
            if (locked && (!group.Name.Equals(cleanName, StringComparison.Ordinal) || !(group.Description ?? "").Equals(cleanDescription, StringComparison.Ordinal)))
            {
                throw new InvalidOperationException(IsSyncedGroupId(group.Id) ? "Rename synced VRChat groups in VRChat." : "That system group cannot be renamed.");
            }
            var originalName = group.Name;
            if (!locked)
            {
                group.Name = cleanName;
                group.Description = cleanDescription;
            }
            group.Icon = CleanGroupIcon(input.Icon);
            group.BackgroundEffect = CleanBackgroundEffect(input.BackgroundEffect ?? group.BackgroundEffect);
            if (!string.IsNullOrWhiteSpace(input.BackgroundFolder)) group.BackgroundFolder = NormalizeGroupBackgroundFolder(group.Id, group.Name, input.BackgroundFolder);
            if (!locked && !originalName.Equals(group.Name, StringComparison.Ordinal) && BackgroundStore.HasGroupBackground(group.Id, originalName))
            {
                BackgroundStore.MoveGroupBackground(group.Id, originalName, group.Name);
                group.BackgroundFolder = RelativeGroupBackgroundFolder(group.Id, group.Name);
            }
            group.UpdatedAt = DateTimeOffset.UtcNow;
            Save(lib);
            return lib;
        }
    }
    public void EnsureGroupExists(string id)
    {
        lock (_gate)
        {
            var lib = Load();
            _ = lib.Groups.FirstOrDefault(x => x.Id.Equals(id, StringComparison.OrdinalIgnoreCase)) ?? throw new InvalidOperationException("Group not found.");
        }
    }
    public LibraryData SetGroupBackgroundFolder(string id, bool hasBackground)
    {
        lock (_gate)
        {
            var lib = Load();
            var group = lib.Groups.FirstOrDefault(x => x.Id.Equals(id, StringComparison.OrdinalIgnoreCase)) ?? throw new InvalidOperationException("Group not found.");
            group.BackgroundFolder = hasBackground ? RelativeGroupBackgroundFolder(group.Id, group.Name) : "";
            group.UpdatedAt = DateTimeOffset.UtcNow;
            Save(lib);
            return lib;
        }
    }
    public LibraryData DeleteGroup(string id)
    {
        lock (_gate)
        {
            var lib = Load();
            if (lib.Groups.Count <= 1) throw new InvalidOperationException("Keep at least one group.");
            if (IsPinnedSystemGroupId(id)) throw new InvalidOperationException("That system group cannot be deleted.");
            if (IsSyncedGroupId(id)) throw new InvalidOperationException("Synced VRChat groups cannot be deleted.");
            var group = lib.Groups.FirstOrDefault(x => x.Id == id) ?? throw new InvalidOperationException("Group not found.");
            if (lib.Avatars.Any(x => x.GroupId == id) || BackgroundStore.HasGroupBackground(id, group.Name)) WriteGroupBackup(lib, group, "deleted");
            var removedGroupIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { group.Id };
            lib.Groups.RemoveAll(x => x.Id == id);
            lib.Avatars.RemoveAll(x => x.GroupId == id);
            NormalizeOrders(lib);
            Save(lib, removedGroupIds);
            BackgroundStore.DeleteGroupBackground(id, group.Name);
            return lib;
        }
    }
    public LibraryData CopyGroup(string id)
    {
        lock (_gate)
        {
            var lib = Load();
            var source = lib.Groups.FirstOrDefault(x => x.Id == id) ?? throw new InvalidOperationException("Group not found.");
            if (IsPinnedSystemGroupId(source.Id)) throw new InvalidOperationException("That system group cannot be copied.");
            var now = DateTimeOffset.UtcNow;
            var groupId = NewId("grp");
            var group = new AvatarGroup { Id = groupId, Name = UniqueGroupName(lib, $"{source.Name} Copy"), Description = source.Description, Icon = source.Icon, BackgroundFolder = "", BackgroundEffect = CleanBackgroundEffect(source.BackgroundEffect), Order = NextGroupOrder(lib), CreatedAt = now, UpdatedAt = now };
            group.BackgroundFolder = BackgroundStore.CopyGroupBackground(source.Id, groupId, source.Name, group.Name) ? RelativeGroupBackgroundFolder(group.Id, group.Name) : "";
            lib.Groups.Add(group);
            var order = 0;
            foreach (var avatar in lib.Avatars.Where(x => x.GroupId == source.Id).OrderBy(x => x.Order).ToList())
            {
                lib.Avatars.Add(CloneAvatar(avatar, groupId, now, order++));
            }
            Save(lib);
            return lib;
        }
    }
    public LibraryData CopyGroupToExisting(CopyGroupToExistingInput input)
    {
        lock (_gate)
        {
            var lib = Load();
            var source = lib.Groups.FirstOrDefault(x => x.Id == input.Id) ?? throw new InvalidOperationException("Source group not found.");
            var target = lib.Groups.FirstOrDefault(x => x.Id == input.TargetGroupId) ?? throw new InvalidOperationException("Target group not found.");
            if (IsPinnedSystemGroupId(source.Id)) throw new InvalidOperationException("That system group cannot be copied.");
            if (source.Id.Equals(target.Id, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Choose a different target group.");
            var replaceSynced = input.Replace && IsSyncedGroupId(target.Id) && !IsPinnedSystemGroupId(target.Id);
            if (!replaceSynced && (IsSyncedGroupId(target.Id) || IsPinnedSystemGroupId(target.Id))) throw new InvalidOperationException("Choose a local group.");

            var now = DateTimeOffset.UtcNow;
            var sourceAvatars = lib.Avatars
                .Where(x => x.GroupId.Equals(source.Id, StringComparison.OrdinalIgnoreCase))
                .OrderBy(x => x.Order)
                .ThenBy(x => x.CreatedAt)
                .ToList();
            if (replaceSynced)
            {
                var uniqueAvatarIds = sourceAvatars
                    .Select(x => x.AvatarId)
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Count();
                if (uniqueAvatarIds > SyncedGroupAvatarLimit) throw new InvalidOperationException($"Synced VRChat favorite groups can only contain {SyncedGroupAvatarLimit} avatars.");
                WriteGroupBackup(lib, target, "pre-replace");
                lib.Avatars.RemoveAll(x => x.GroupId.Equals(target.Id, StringComparison.OrdinalIgnoreCase));
                var replaceOrder = 0;
                foreach (var avatar in sourceAvatars)
                {
                    lib.Avatars.Add(CloneAvatar(avatar, target.Id, now, replaceOrder++));
                }
                target.UpdatedAt = now;
                Save(lib);
                return lib;
            }

            var copied = 0;
            foreach (var avatar in sourceAvatars)
            {
                if (AvatarExistsInGroup(lib, target.Id, avatar.AvatarId, avatar.Id)) continue;
                lib.Avatars.Add(CloneAvatar(avatar, target.Id, now, NextAvatarOrder(lib, target.Id)));
                copied++;
            }
            if (copied == 0) throw new InvalidOperationException("All avatars from that group are already in the target group.");
            Save(lib);
            return lib;
        }
    }
    public LibraryData SetGroupReorderLock(GroupLockInput input)
    {
        lock (_gate)
        {
            var lib = Load();
            _ = lib.Groups.FirstOrDefault(x => x.Id == input.Id) ?? throw new InvalidOperationException("Group not found.");
            throw new InvalidOperationException("Only local groups can be reordered. VRChat and system groups stay pinned.");
        }
    }
    public LibraryData ReorderGroup(ReorderInput input)
    {
        lock (_gate)
        {
            var lib = Load();
            var groups = lib.Groups.OrderBy(x => x.Order).ThenBy(x => x.CreatedAt).ToList();
            var group = groups.FirstOrDefault(x => x.Id == input.Id) ?? throw new InvalidOperationException("Group not found.");
            if (IsGroupReorderLocked(group)) throw new InvalidOperationException("Unlock that group before moving it.");
            var movableGroups = groups.Where(x => !IsGroupReorderLocked(x)).ToList();
            var movableSlotOrders = movableGroups.Select(x => x.Order).ToList();
            movableGroups.Remove(group);
            movableGroups.Insert(Math.Clamp(input.Position - 1, 0, movableGroups.Count), group);
            var now = DateTimeOffset.UtcNow;
            for (var i = 0; i < movableGroups.Count; i++)
            {
                movableGroups[i].Order = movableSlotOrders[i];
                movableGroups[i].UpdatedAt = now;
            }
            Save(lib);
            return lib;
        }
    }
    public LibraryData SaveAvatar(AvatarInput input)
    {
        lock (_gate)
        {
            var lib = Load();
            if (lib.Groups.All(x => x.Id != input.GroupId)) throw new InvalidOperationException("Choose a valid group.");
            var now = DateTimeOffset.UtcNow;
            var avatar = !string.IsNullOrWhiteSpace(input.Id) ? lib.Avatars.FirstOrDefault(x => x.Id == input.Id) : null;
            var cleanAvatarId = input.AvatarId?.Trim() ?? "";
            if (avatar is null && !string.IsNullOrWhiteSpace(cleanAvatarId))
            {
                avatar = lib.Avatars.FirstOrDefault(x =>
                    x.GroupId.Equals(input.GroupId, StringComparison.OrdinalIgnoreCase) &&
                    x.AvatarId.Equals(cleanAvatarId, StringComparison.OrdinalIgnoreCase));
                if (avatar is not null) PlaceAvatarAtTop(lib, avatar, input.GroupId);
            }
            var oldGroupId = avatar?.GroupId ?? "";
            if ((avatar is null || !avatar.GroupId.Equals(input.GroupId, StringComparison.OrdinalIgnoreCase)) && IsPinnedSystemGroupId(input.GroupId))
            {
                throw new InvalidOperationException("Recent and Deleted groups are managed automatically.");
            }
            if (avatar is not null && AvatarExistsInGroup(lib, input.GroupId, cleanAvatarId, avatar.Id))
            {
                throw new InvalidOperationException("That avatar is already in the group.");
            }
            EnsureSyncedGroupCapacity(lib, input.GroupId, avatar?.Id ?? input.Id, cleanAvatarId);
            if (avatar is null)
            {
                avatar = new AvatarFavorite { Id = NewId("local"), CreatedAt = now, Order = 0, Source = input.Source?.Trim() ?? "" };
                lib.Avatars.Add(avatar);
                PlaceAvatarAtTop(lib, avatar, input.GroupId);
            }
            else if (!oldGroupId.Equals(input.GroupId, StringComparison.OrdinalIgnoreCase))
            {
                PlaceAvatarAtTop(lib, avatar, input.GroupId);
            }
            FillAvatar(avatar, input, now);
            Save(lib);
            return lib;
        }
    }
    public LibraryData DeleteAvatar(string id)
    {
        lock (_gate)
        {
            var lib = Load();
            lib.Avatars.RemoveAll(x => x.Id == id);
            Save(lib);
            return lib;
        }
    }
    public LibraryData ReorderAvatar(ReorderInput input)
    {
        lock (_gate)
        {
            var lib = Load();
            var avatar = lib.Avatars.FirstOrDefault(x => x.Id == input.Id) ?? throw new InvalidOperationException("Avatar not found.");
            var groupId = string.IsNullOrWhiteSpace(input.GroupId) ? avatar.GroupId : input.GroupId;
            var avatars = lib.Avatars.Where(x => x.GroupId == groupId).OrderBy(x => x.Order).ThenBy(x => x.CreatedAt).ToList();
            if (!avatars.Remove(avatar)) throw new InvalidOperationException("Avatar is not in that group.");
            avatars.Insert(Math.Clamp(input.Position - 1, 0, avatars.Count), avatar);
            var now = DateTimeOffset.UtcNow;
            for (var i = 0; i < avatars.Count; i++)
            {
                avatars[i].Order = i;
                avatars[i].UpdatedAt = now;
            }
            Save(lib);
            return lib;
        }
    }
    public LibraryData ReorderAvatars(AvatarOrderInput input)
    {
        lock (_gate)
        {
            var lib = Load();
            if (string.IsNullOrWhiteSpace(input.GroupId)) throw new InvalidOperationException("Group not found.");
            var group = lib.Groups.FirstOrDefault(x => x.Id.Equals(input.GroupId, StringComparison.OrdinalIgnoreCase)) ?? throw new InvalidOperationException("Group not found.");
            if (IsSyncedGroupId(group.Id)) throw new InvalidOperationException("Use synced edit mode to reorder synced groups.");
            var current = lib.Avatars
                .Where(x => x.GroupId.Equals(group.Id, StringComparison.OrdinalIgnoreCase))
                .OrderBy(x => x.Order)
                .ThenBy(x => x.CreatedAt)
                .ToList();
            var byId = current.ToDictionary(x => x.Id, StringComparer.OrdinalIgnoreCase);
            var orderedIds = (input.AvatarIds ?? [])
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (orderedIds.Count != current.Count || orderedIds.Any(id => !byId.ContainsKey(id)))
            {
                throw new InvalidOperationException("Avatar order did not match the current group.");
            }

            var now = DateTimeOffset.UtcNow;
            for (var i = 0; i < orderedIds.Count; i++)
            {
                var avatar = byId[orderedIds[i]];
                avatar.Order = i;
                avatar.UpdatedAt = now;
            }
            Save(lib);
            return lib;
        }
    }
    public LibraryData MoveAvatar(MoveAvatarInput input)
    {
        lock (_gate)
        {
            var lib = Load();
            var avatar = lib.Avatars.FirstOrDefault(x => x.Id == input.AvatarId) ?? throw new InvalidOperationException("Avatar not found.");
            if (lib.Groups.All(x => x.Id != input.GroupId)) throw new InvalidOperationException("Choose a valid group.");
            if (IsPinnedSystemGroupId(input.GroupId)) throw new InvalidOperationException("Recent and Deleted groups are managed automatically.");
            if (AvatarExistsInGroup(lib, input.GroupId, avatar.AvatarId, avatar.Id)) throw new InvalidOperationException("That avatar is already in the group.");
            EnsureSyncedGroupCapacity(lib, input.GroupId, avatar.Id, avatar.AvatarId);
            PlaceAvatarAtTop(lib, avatar, input.GroupId);
            avatar.UpdatedAt = DateTimeOffset.UtcNow;
            Save(lib);
            return lib;
        }
    }
    public LibraryData CopyAvatar(MoveAvatarInput input)
    {
        lock (_gate)
        {
            var lib = Load();
            var avatar = lib.Avatars.FirstOrDefault(x => x.Id == input.AvatarId) ?? throw new InvalidOperationException("Avatar not found.");
            if (lib.Groups.All(x => x.Id != input.GroupId)) throw new InvalidOperationException("Choose a valid group.");
            if (IsPinnedSystemGroupId(input.GroupId)) throw new InvalidOperationException("Recent and Deleted groups are managed automatically.");
            if (AvatarExistsInGroup(lib, input.GroupId, avatar.AvatarId, avatar.Id)) throw new InvalidOperationException("That avatar is already in the group.");
            EnsureSyncedGroupCapacity(lib, input.GroupId, "", avatar.AvatarId);
            var now = DateTimeOffset.UtcNow;
            ShiftAvatarOrdersDown(lib, input.GroupId);
            lib.Avatars.Add(CloneAvatar(avatar, input.GroupId, now, 0));
            Save(lib);
            return lib;
        }
    }
    public ExportResult BackupGroup(string id)
    {
        lock (_gate)
        {
            var lib = Load();
            var group = lib.Groups.FirstOrDefault(x => x.Id == id) ?? throw new InvalidOperationException("Group not found.");
            return WriteGroupBackup(lib, group, "edit");
        }
    }
    public AccountBackupResult CreateAccountBackup(string reason = "manual")
    {
        lock (_gate)
        {
            var result = WriteAccountBackup(Load(), reason);
            PruneAccountBackups();
            return result;
        }
    }
    public AccountBackupListResult ListAccountBackups()
    {
        Directory.CreateDirectory(_accountBackupDirectory);
        PruneAccountBackups();
        var files = AccountBackupFiles()
            .Select(AccountBackupFileInfo)
            .OrderByDescending(x => x.LastModified)
            .ToList();
        return new AccountBackupListResult(_accountBackupDirectory, AccountBackupRetention, files);
    }
    public BackupListResult ListGroupBackups()
    {
        Directory.CreateDirectory(_backupDirectory);
        MigrateGroupBackupsToTypeFolders();
        PruneGroupBackups();
        var files = GroupBackupFiles()
            .OrderByDescending(file => file.LastWriteTimeUtc)
            .ThenByDescending(file => file.Name, StringComparer.OrdinalIgnoreCase)
            .Select(file => new BackupFileInfo(file.Name, file.DisplayName, file.Path, file.Size, file.LastWriteTimeUtc.ToLocalTime(), GroupBackupReasonDisplay(file.Name), file.GroupId, file.BackupType))
            .ToList();
        return new BackupListResult(_backupDirectory, files);
    }
    public LibraryData RestoreBackup(BackupRestoreInput input)
    {
        lock (_gate)
        {
            var backupPath = ResolveBackupPath(input.Path);
            var summary = JsonSerializer.Deserialize<GroupFileSummary>(File.ReadAllText(backupPath), ProgramJson.Options)
                ?? throw new InvalidOperationException("Backup file is not a valid group backup.");
            if (string.IsNullOrWhiteSpace(summary.Name)) throw new InvalidOperationException("Backup file is missing a group name.");

            var lib = Load();
            var now = DateTimeOffset.UtcNow;
            var replace = input.Mode.Equals("replace", StringComparison.OrdinalIgnoreCase);
            var groupId = replace && !string.IsNullOrWhiteSpace(summary.Id) ? summary.Id : NewId("grp");
            var group = lib.Groups.FirstOrDefault(x => x.Id.Equals(groupId, StringComparison.OrdinalIgnoreCase));

            if (replace)
            {
                if (group is null)
                {
                    group = new AvatarGroup { Id = groupId, CreatedAt = now, Order = NextGroupOrder(lib) };
                    lib.Groups.Add(group);
                }
                lib.Avatars.RemoveAll(x => x.GroupId.Equals(groupId, StringComparison.OrdinalIgnoreCase));
                group.Name = summary.Name.Trim();
            }
            else
            {
                group = new AvatarGroup { Id = groupId, CreatedAt = now, Order = NextGroupOrder(lib) };
                group.Name = UniqueGroupName(lib, summary.Name);
                lib.Groups.Add(group);
            }

            group.Description = summary.Description ?? "";
            group.Icon = CleanGroupIcon(summary.Icon);
            group.BackgroundEffect = CleanBackgroundEffect(summary.BackgroundEffect);
            group.BackgroundFolder = "";
            group.ReorderLocked = IsDefaultReorderLockedGroupId(group.Id) ? true : group.ReorderLocked;
            group.UpdatedAt = now;

            var order = 0;
            foreach (var avatar in summary.Avatars ?? [])
            {
                avatar.GroupId = group.Id;
                lib.Avatars.Add(CloneAvatar(avatar, group.Id, now, order++));
            }

            if (BackgroundStore.RestoreGroupBackground(backupPath, group.Id, group.Name))
            {
                group.BackgroundFolder = RelativeGroupBackgroundFolder(group.Id, group.Name);
            }
            else if (replace)
            {
                BackgroundStore.DeleteGroupBackground(group.Id, group.Name);
            }

            NormalizeOrders(lib);
            Save(lib);
            return lib;
        }
    }
    public async Task<SyncedAvatarOrderApplyResult> ApplySyncedGroupAvatarOrderAsync(SyncedAvatarOrderInput input, VrChatClient client, Action<SyncedAvatarOrderProgress>? progress = null)
    {
        List<string> avatarIds;
        string backupPath;
        lock (_gate)
        {
            var lib = Load();
            var group = lib.Groups.FirstOrDefault(x => x.Id.Equals(input.GroupId, StringComparison.OrdinalIgnoreCase)) ?? throw new InvalidOperationException("Group not found.");
            if (!IsSyncedGroupId(group.Id)) throw new InvalidOperationException("Only synced VRChat groups can be applied to VRChat.");
            avatarIds = OrderedSyncedAvatarIds(lib, group.Id, input.AvatarIds ?? []);
            progress?.Invoke(new SyncedAvatarOrderProgress(group.Id, "backup", "Creating backup...", 0, avatarIds.Count));
            backupPath = WriteGroupBackup(lib, group, "pre-save").Path;
        }

        VrChatFavoriteRecompileResult remoteResult;
        try
        {
            remoteResult = await client.RecompileFavoriteAvatarGroupAsync(input.GroupId, avatarIds, progress);
        }
        catch
        {
            progress?.Invoke(new SyncedAvatarOrderProgress(input.GroupId, "failed", "Refavoriting failed.", 0, avatarIds.Count));
            throw;
        }

        lock (_gate)
        {
            var lib = Load();
            var group = lib.Groups.FirstOrDefault(x => x.Id.Equals(input.GroupId, StringComparison.OrdinalIgnoreCase)) ?? throw new InvalidOperationException("Group not found.");
            var orderByLocalId = (input.AvatarIds ?? []).Select((id, index) => new { id, index })
                .GroupBy(x => x.id, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(x => x.Key, x => x.First().index, StringComparer.OrdinalIgnoreCase);
            var now = DateTimeOffset.UtcNow;
            foreach (var avatar in lib.Avatars.Where(x => x.GroupId.Equals(group.Id, StringComparison.OrdinalIgnoreCase)))
            {
                if (orderByLocalId.TryGetValue(avatar.Id, out var order))
                {
                    avatar.Order = order;
                    avatar.UpdatedAt = now;
                }
            }
            Save(lib);
            progress?.Invoke(new SyncedAvatarOrderProgress(group.Id, "complete", "Refavoriting finished.", remoteResult.Added, remoteResult.Added));
            return new SyncedAvatarOrderApplyResult(lib, remoteResult.Removed, remoteResult.Added, remoteResult.Tag, backupPath);
        }
    }
    public async Task<GroupClearResult> ClearGroupAvatarsAsync(string groupId, VrChatClient client)
    {
        var synced = IsSyncedGroupId(groupId);
        string backupPath;
        int localCount;
        lock (_gate)
        {
            var lib = Load();
            var group = lib.Groups.FirstOrDefault(x => x.Id.Equals(groupId, StringComparison.OrdinalIgnoreCase)) ?? throw new InvalidOperationException("Group not found.");
            localCount = lib.Avatars.Count(x => x.GroupId.Equals(group.Id, StringComparison.OrdinalIgnoreCase));
            if (localCount == 0) return new GroupClearResult(lib, 0, "");
            backupPath = WriteGroupBackup(lib, group, "unfavorited").Path;
        }

        VrChatFavoriteRecompileResult? remoteResult = null;
        if (synced)
        {
            remoteResult = await client.RecompileFavoriteAvatarGroupAsync(groupId, []);
        }

        lock (_gate)
        {
            var lib = Load();
            var group = lib.Groups.FirstOrDefault(x => x.Id.Equals(groupId, StringComparison.OrdinalIgnoreCase)) ?? throw new InvalidOperationException("Group not found.");
            var removed = lib.Avatars.RemoveAll(x => x.GroupId.Equals(group.Id, StringComparison.OrdinalIgnoreCase));
            group.UpdatedAt = DateTimeOffset.UtcNow;
            Save(lib);
            return new GroupClearResult(lib, synced ? remoteResult?.Removed ?? removed : removed, backupPath);
        }
    }
    public LibraryData Import(JsonElement payload)
    {
        lock (_gate)
        {
            var imported = ReadImport(payload);
            if (imported.Groups.Count == 0) throw new InvalidOperationException("Import JSON does not contain any groups.");
            var lib = Load();
            var now = DateTimeOffset.UtcNow;
            var groupMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var incoming in imported.Groups.OrderBy(x => x.Order).ThenBy(x => x.CreatedAt))
            {
                var newId = NewId("grp");
                var group = new AvatarGroup { Id = newId, Name = UniqueGroupName(lib, incoming.Name), Description = incoming.Description ?? "", Icon = CleanGroupIcon(incoming.Icon), BackgroundFolder = "", BackgroundEffect = CleanBackgroundEffect(incoming.BackgroundEffect), Order = NextGroupOrder(lib), CreatedAt = now, UpdatedAt = now };
                if (BackgroundStore.CopyImportedGroupBackground(incoming.BackgroundFolder, newId, group.Name)) group.BackgroundFolder = RelativeGroupBackgroundFolder(newId, group.Name);
                lib.Groups.Add(group);
                if (!string.IsNullOrWhiteSpace(incoming.Id)) groupMap[incoming.Id] = newId;
            }

            foreach (var avatar in imported.Avatars.OrderBy(x => x.Order).ThenBy(x => x.CreatedAt))
            {
                var targetGroupId = !string.IsNullOrWhiteSpace(avatar.GroupId) && groupMap.TryGetValue(avatar.GroupId, out var mapped)
                    ? mapped
                    : imported.Groups.Count == 1
                        ? groupMap.Values.First()
                        : "";
                if (string.IsNullOrWhiteSpace(targetGroupId))
                {
                    continue;
                }
                lib.Avatars.Add(CloneAvatar(avatar, targetGroupId, now, NextAvatarOrder(lib, targetGroupId)));
            }
            Save(lib);
            return lib;
        }
    }
    public ExportResult ExportToFile()
    {
        lock (_gate)
        {
            Directory.CreateDirectory(_exportDirectory);
            var path = Path.Combine(_exportDirectory, $"vrcneph-export-{DateTimeOffset.Now:yyyyMMdd-HHmmss}.json");
            File.WriteAllText(path, JsonSerializer.Serialize(CleanExport(Load()), ProgramJson.Options));
            return new ExportResult(path);
        }
    }
    public ExportResult ExportGroup(string id)
    {
        lock (_gate)
        {
            var lib = Load();
            var group = lib.Groups.FirstOrDefault(x => x.Id == id) ?? throw new InvalidOperationException("Group not found.");
            var summary = GroupSummary(group, lib.Avatars.Where(x => x.GroupId == id).OrderBy(x => x.Order));
            Directory.CreateDirectory(_exportDirectory);
            var path = UniqueBackupPath(_exportDirectory, $"{SafeFileNameOrDefault(group.Name, "Group")}.json");
            File.WriteAllText(path, JsonSerializer.Serialize(summary, ProgramJson.Options));
            return new ExportResult(path);
        }
    }
    public async Task<VrChatSyncResult> SyncVrChatFavoritesAsync(VrChatClient client)
    {
        var imported = await client.GetFavoriteAvatarsAsync();
        var uploadedAvatars = await TryGetUploadedAvatarsAsync(client);
        var storedAvatarRefresh = await RefreshStoredFavoriteAvatarsAsync(client);
        lock (_gate)
        {
            var lib = Load();
            var previousSyncedRows = lib.Avatars
                .Where(x => x.GroupId.StartsWith("vrc_", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(x.AvatarId))
                .ToList();
            var previousSynced = previousSyncedRows
                .Where(x => x.GroupId.StartsWith("vrc_", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(x.AvatarId))
                .GroupBy(x => x.AvatarId, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(x => x.Key, x => x.OrderByDescending(a => a.UpdatedAt).First(), StringComparer.OrdinalIgnoreCase);
            var previousSyncedByLocation = previousSyncedRows
                .GroupBy(x => SyncedAvatarKey(x.GroupId, x.AvatarId), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(x => x.Key, x => x.OrderBy(a => a.Order).ThenBy(a => a.CreatedAt).First(), StringComparer.OrdinalIgnoreCase);
            var previousSyncedGroups = lib.Groups
                .Where(x => x.Id.StartsWith("vrc_", StringComparison.OrdinalIgnoreCase))
                .ToDictionary(x => x.Id, StringComparer.OrdinalIgnoreCase);
            var previousDeleted = lib.Avatars
                .Where(x => x.GroupId.Equals(DeletedAvatarGroupId, StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(x.AvatarId))
                .GroupBy(x => x.AvatarId, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(x => x.Key, x => x.OrderByDescending(a => a.UpdatedAt).First(), StringComparer.OrdinalIgnoreCase);
            var activeAvatarIds = imported.Avatars
                .Select(x => x.Avatar.AvatarId)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            lib.Groups.RemoveAll(x => x.Id.StartsWith("vrc_", StringComparison.OrdinalIgnoreCase));
            lib.Avatars.RemoveAll(x => x.GroupId.StartsWith("vrc_", StringComparison.OrdinalIgnoreCase));
            lib.Groups.RemoveAll(x => x.Id.Equals(UpdatedAvatarGroupId, StringComparison.OrdinalIgnoreCase));
            lib.Avatars.RemoveAll(x => x.GroupId.Equals(UpdatedAvatarGroupId, StringComparison.OrdinalIgnoreCase));
            lib.Groups.RemoveAll(x => x.Id.Equals(UploadedAvatarGroupId, StringComparison.OrdinalIgnoreCase));
            lib.Avatars.RemoveAll(x => x.GroupId.Equals(UploadedAvatarGroupId, StringComparison.OrdinalIgnoreCase));
            var now = DateTimeOffset.UtcNow;
            var newSyncedGroupOrder = lib.Groups.Count == 0 ? 0 : lib.Groups.Min(x => x.Order) - imported.Groups.Count;
            var newSyncedGroupIndex = 0;
            foreach (var group in imported.Groups.OrderBy(x => x.SortOrder))
            {
                var groupId = $"vrc_{group.Tag}";
                var avatars = imported.Avatars.Where(x => x.GroupTag == group.Tag).Select(x => x.Avatar).Take(SyncedGroupAvatarLimit).ToList();
                previousSyncedGroups.TryGetValue(groupId, out var previousGroup);
                lib.Groups.Add(new AvatarGroup
                {
                    Id = groupId,
                    Name = group.DisplayName,
                    Description = $"Synced from VRChat favorite group {group.Tag}. {avatars.Count} avatars. Last synced {DateTimeOffset.Now:g}.",
                    Order = previousGroup?.Order ?? newSyncedGroupOrder + newSyncedGroupIndex++,
                    ReorderLocked = previousGroup?.ReorderLocked ?? true,
                    CreatedAt = previousGroup?.CreatedAt ?? now,
                    UpdatedAt = now
                });

                var syncedAvatars = avatars
                    .Where(x => !string.IsNullOrWhiteSpace(x.AvatarId))
                    .Select(avatar =>
                    {
                        previousSyncedByLocation.TryGetValue(SyncedAvatarKey(groupId, avatar.AvatarId), out var previous);
                        return new SyncedAvatarSyncItem(avatar, previous);
                    })
                    .ToList();
                for (var order = 0; order < syncedAvatars.Count; order++)
                {
                    var item = syncedAvatars[order];
                    lib.Avatars.Add(CreateSyncedFavorite(item.Avatar, item.Previous, groupId, now, order));
                }
            }
            ApplyStoredAvatarDetailRefreshes(lib, storedAvatarRefresh.UpdatedAvatars, now);
            var movedToDeleted = ArchiveDeletedVrChatAvatars(lib, imported.DeletedAvatars, previousSynced, previousDeleted, activeAvatarIds, now);
            movedToDeleted.AddRange(ArchiveUnavailableStoredFavoriteAvatars(lib, storedAvatarRefresh.UnavailableAvatars, previousDeleted, now));
            AddUploadedAvatarGroup(lib, uploadedAvatars, now);
            NormalizeOrders(lib);
            Save(lib, new HashSet<string>(StringComparer.OrdinalIgnoreCase) { UploadedAvatarGroupId, UpdatedAvatarGroupId });
            AddUpdatedAvatarGroup(lib, storedAvatarRefresh.ChangedAvatars, now);
            NormalizeOrders(lib);
            _ = WriteAccountBackup(lib, "sync");
            PruneAccountBackups();
            return new VrChatSyncResult(lib, imported.Groups.Count, imported.Avatars.Count, movedToDeleted.Count, movedToDeleted.Select(x => x.Name).ToList(), movedToDeleted, storedAvatarRefresh.ChangedAvatars.Count, storedAvatarRefresh.ChangedAvatars.Select(x => string.IsNullOrWhiteSpace(x.Name) ? x.AvatarId : x.Name).Where(x => !string.IsNullOrWhiteSpace(x)).ToList(), uploadedAvatars.Count, imported.FavoriteGroupLimit, 0, []);
        }
    }
    private async Task<StoredAvatarRefreshResult> RefreshStoredFavoriteAvatarsAsync(VrChatClient client)
    {
        List<AvatarInput> candidates;
        lock (_gate)
        {
            var lib = Load();
            candidates = lib.Avatars
                .Where(x => !string.IsNullOrWhiteSpace(x.AvatarId)
                    && !x.GroupId.Equals(DeletedAvatarGroupId, StringComparison.OrdinalIgnoreCase)
                    && !x.GroupId.Equals(RecentAvatarGroupId, StringComparison.OrdinalIgnoreCase)
                    && !x.GroupId.Equals(UploadedAvatarGroupId, StringComparison.OrdinalIgnoreCase)
                    && !x.GroupId.Equals(UpdatedAvatarGroupId, StringComparison.OrdinalIgnoreCase))
                .GroupBy(x => x.AvatarId, StringComparer.OrdinalIgnoreCase)
                .Select(x => AvatarInputFromFavorite(x.OrderByDescending(a => a.UpdatedAt).First()))
                .ToList();
        }

        if (candidates.Count == 0) return new StoredAvatarRefreshResult([], [], []);

        var updated = new List<AvatarInput>();
        var changed = new List<AvatarInput>();
        var unavailable = new List<AvatarInput>();
        using var gate = new SemaphoreSlim(8, 8);
        var tasks = candidates.Select(async candidate =>
        {
            await gate.WaitAsync();
            try
            {
                var live = await client.FetchAvatarAsync(candidate.AvatarId);
                if (IsStoredUnavailableReleaseStatus(live.ReleaseStatus))
                {
                    MergeUnavailableStoredDetails(candidate, live);
                    _appData.RecordAvatarMetadataChange(candidate, live, "unavailable");
                    lock (unavailable) unavailable.Add(candidate);
                    return;
                }

                lock (updated) updated.Add(live);
                if (AvatarMetadataChanged(candidate, live))
                {
                    _appData.RecordAvatarMetadataChange(candidate, live, "metadata_changed");
                    lock (changed) changed.Add(live);
                }
            }
            catch
            {
            }
            finally
            {
                gate.Release();
            }
        });
        await Task.WhenAll(tasks);
        var uniqueChanged = changed
            .Where(x => !string.IsNullOrWhiteSpace(x.AvatarId))
            .GroupBy(x => x.AvatarId, StringComparer.OrdinalIgnoreCase)
            .Select(x => x.First())
            .ToList();
        return new StoredAvatarRefreshResult(updated, unavailable, uniqueChanged);
    }
    private static async Task<List<AvatarInput>> TryGetUploadedAvatarsAsync(VrChatClient client)
    {
        try
        {
            return await client.GetUploadedAvatarsAsync();
        }
        catch
        {
            return [];
        }
    }
    private sealed record StoredAvatarRefreshResult(List<AvatarInput> UpdatedAvatars, List<AvatarInput> UnavailableAvatars, List<AvatarInput> ChangedAvatars);
    private static AvatarInput AvatarInputFromFavorite(AvatarFavorite favorite) => new()
    {
        Id = favorite.Id,
        GroupId = favorite.GroupId,
        AvatarId = favorite.AvatarId,
        Name = favorite.Name,
        Description = favorite.Description,
        AuthorId = favorite.AuthorId,
        AuthorName = favorite.AuthorName,
        ImageUrl = favorite.ImageUrl,
        ThumbnailImageUrl = favorite.ThumbnailImageUrl,
        ReleaseStatus = favorite.ReleaseStatus,
        Version = favorite.Version,
        Platforms = favorite.Platforms,
        Tags = favorite.Tags,
        SourceUrl = favorite.SourceUrl,
        Notes = favorite.Notes,
        RawJson = favorite.RawJson,
        Source = favorite.Source,
        RemoteCreatedAt = favorite.RemoteCreatedAt,
        RemoteUpdatedAt = favorite.RemoteUpdatedAt,
        RemoteFavoriteId = favorite.RemoteFavoriteId
    };
    private static void MergeUnavailableStoredDetails(AvatarInput stored, AvatarInput live)
    {
        stored.ReleaseStatus = ArchivedReleaseStatus(live.ReleaseStatus);
        if (!string.IsNullOrWhiteSpace(live.RawJson)) stored.RawJson = live.RawJson;
        if (!string.IsNullOrWhiteSpace(live.Source)) stored.Source = live.Source;
        if (!string.IsNullOrWhiteSpace(live.SourceUrl)) stored.SourceUrl = live.SourceUrl;
    }
    private static void ApplyStoredAvatarDetailRefreshes(LibraryData lib, List<AvatarInput> updates, DateTimeOffset now)
    {
        if (updates.Count == 0) return;
        var byAvatarId = updates
            .Where(x => !string.IsNullOrWhiteSpace(x.AvatarId) && !IsStoredUnavailableReleaseStatus(x.ReleaseStatus))
            .GroupBy(x => x.AvatarId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(x => x.Key, x => x.First(), StringComparer.OrdinalIgnoreCase);
        if (byAvatarId.Count == 0) return;

        foreach (var avatar in lib.Avatars)
        {
            if (string.IsNullOrWhiteSpace(avatar.AvatarId)
                || avatar.GroupId.Equals(DeletedAvatarGroupId, StringComparison.OrdinalIgnoreCase)
                || avatar.GroupId.Equals(RecentAvatarGroupId, StringComparison.OrdinalIgnoreCase)
                || !byAvatarId.TryGetValue(avatar.AvatarId, out var live))
            {
                continue;
            }

            RefreshAvatarMetadata(avatar, live, now);
        }
    }
    private static void AddUploadedAvatarGroup(LibraryData lib, List<AvatarInput> uploadedAvatars, DateTimeOffset now)
    {
        if (uploadedAvatars.Count == 0) return;
        lib.Groups.Add(new AvatarGroup
        {
            Id = UploadedAvatarGroupId,
            Name = UploadedAvatarGroupName,
            Description = $"Uploaded avatars from your VRChat account. {uploadedAvatars.Count} avatars. Last synced {DateTimeOffset.Now:g}.",
            Order = 0,
            ReorderLocked = true,
            CreatedAt = now,
            UpdatedAt = now
        });

        var order = 0;
        foreach (var avatar in uploadedAvatars
            .Where(x => !string.IsNullOrWhiteSpace(x.AvatarId))
            .GroupBy(x => x.AvatarId, StringComparer.OrdinalIgnoreCase)
            .Select(x => x.First()))
        {
            avatar.Source = "vrchat-uploaded";
            var favorite = CloneAvatar(avatar, UploadedAvatarGroupId, now, order++);
            favorite.Id = $"{UploadedAvatarGroupId}_{favorite.AvatarId}";
            lib.Avatars.Add(favorite);
        }
    }
    private static void AddUpdatedAvatarGroup(LibraryData lib, List<AvatarInput> changedAvatars, DateTimeOffset now)
    {
        if (changedAvatars.Count == 0) return;
        lib.Groups.Add(new AvatarGroup
        {
            Id = UpdatedAvatarGroupId,
            Name = UpdatedAvatarGroupName,
            Description = "Avatars whose VRChat metadata changed during this sync. This temporary group clears on restart.",
            Order = 0,
            ReorderLocked = true,
            CreatedAt = now,
            UpdatedAt = now
        });

        var order = 0;
        foreach (var avatar in changedAvatars
            .Where(x => !string.IsNullOrWhiteSpace(x.AvatarId))
            .GroupBy(x => x.AvatarId, StringComparer.OrdinalIgnoreCase)
            .Select(x => x.First()))
        {
            avatar.Source = "vrchat-updated";
            var favorite = CloneAvatar(avatar, UpdatedAvatarGroupId, now, order++);
            favorite.Id = $"{UpdatedAvatarGroupId}_{favorite.AvatarId}";
            lib.Avatars.Add(favorite);
        }
    }
    private static void RefreshAvatarMetadata(AvatarFavorite avatar, AvatarInput live, DateTimeOffset now)
    {
        if (!string.IsNullOrWhiteSpace(live.Name)) avatar.Name = live.Name.Trim();
        avatar.Description = live.Description?.Trim() ?? avatar.Description;
        avatar.AuthorId = live.AuthorId?.Trim() ?? avatar.AuthorId;
        avatar.AuthorName = live.AuthorName?.Trim() ?? avatar.AuthorName;
        avatar.ImageUrl = live.ImageUrl?.Trim() ?? avatar.ImageUrl;
        avatar.ThumbnailImageUrl = live.ThumbnailImageUrl?.Trim() ?? avatar.ThumbnailImageUrl;
        avatar.ReleaseStatus = live.ReleaseStatus?.Trim() ?? avatar.ReleaseStatus;
        avatar.Version = live.Version?.Trim() ?? avatar.Version;
        avatar.Platforms = live.Platforms?.Trim() ?? avatar.Platforms;
        avatar.Tags = live.Tags?.Trim() ?? avatar.Tags;
        avatar.SourceUrl = live.SourceUrl?.Trim() ?? avatar.SourceUrl;
        avatar.RawJson = live.RawJson?.Trim() ?? avatar.RawJson;
        if (!string.IsNullOrWhiteSpace(live.Source)) avatar.Source = live.Source.Trim();
        if (!string.IsNullOrWhiteSpace(live.RemoteCreatedAt)) avatar.RemoteCreatedAt = live.RemoteCreatedAt.Trim();
        if (!string.IsNullOrWhiteSpace(live.RemoteUpdatedAt)) avatar.RemoteUpdatedAt = live.RemoteUpdatedAt.Trim();
        avatar.UpdatedAt = now;
    }
    private static bool AvatarMetadataChanged(AvatarInput stored, AvatarInput live)
    {
        if (IsStoredUnavailableReleaseStatus(live.ReleaseStatus)) return false;
        if (!HasVrChatMetadataBaseline(stored)) return false;
        return RemoteUpdatedAtMovedForward(stored.RemoteUpdatedAt, live.RemoteUpdatedAt);
    }
    private static bool HasVrChatMetadataBaseline(AvatarInput stored)
    {
        var source = stored.Source?.Trim() ?? "";
        return source.Contains("vrchat", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(stored.RemoteUpdatedAt);
    }
    private static bool RemoteUpdatedAtMovedForward(string? oldValue, string? newValue)
    {
        var oldText = oldValue?.Trim() ?? "";
        var newText = newValue?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(oldText) || string.IsNullOrWhiteSpace(newText)) return false;
        if (!DateTimeOffset.TryParse(oldText, out var oldDate) || !DateTimeOffset.TryParse(newText, out var newDate)) return false;
        return newDate > oldDate;
    }
    private static bool IsStoredUnavailableReleaseStatus(string? status)
    {
        var value = status?.Trim() ?? "";
        return value.Equals("hidden", StringComparison.OrdinalIgnoreCase)
            || value.Equals("private", StringComparison.OrdinalIgnoreCase)
            || value.Equals("deleted", StringComparison.OrdinalIgnoreCase)
            || value.Equals("unavailable", StringComparison.OrdinalIgnoreCase);
    }
    private static List<DeletedAvatarMoveSummary> ArchiveUnavailableStoredFavoriteAvatars(
        LibraryData lib,
        List<AvatarInput> unavailableAvatars,
        Dictionary<string, AvatarFavorite> previousDeleted,
        DateTimeOffset now)
    {
        var moved = new List<DeletedAvatarMoveSummary>();
        if (unavailableAvatars.Count == 0) return moved;

        var group = EnsureDeletedAvatarGroup(lib, now);
        var archivedIds = lib.Avatars
            .Where(x => x.GroupId.Equals(DeletedAvatarGroupId, StringComparison.OrdinalIgnoreCase))
            .Select(x => x.AvatarId)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var incoming in unavailableAvatars)
        {
            var avatarId = incoming.AvatarId?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(avatarId)) continue;

            var previous = lib.Avatars
                .Where(x => x.AvatarId.Equals(avatarId, StringComparison.OrdinalIgnoreCase)
                    && !x.GroupId.Equals(DeletedAvatarGroupId, StringComparison.OrdinalIgnoreCase)
                    && !x.GroupId.Equals(RecentAvatarGroupId, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(x => x.UpdatedAt)
                .FirstOrDefault();
            lib.Avatars.RemoveAll(x => x.AvatarId.Equals(avatarId, StringComparison.OrdinalIgnoreCase)
                && !x.GroupId.Equals(DeletedAvatarGroupId, StringComparison.OrdinalIgnoreCase)
                && !x.GroupId.Equals(RecentAvatarGroupId, StringComparison.OrdinalIgnoreCase));

            if (archivedIds.Contains(avatarId)) continue;
            previousDeleted.TryGetValue(avatarId, out var oldDeleted);
            var archive = CreateDeletedArchiveAvatar(incoming, previous ?? oldDeleted, group.Id, now, NextAvatarOrder(lib, group.Id));
            lib.Avatars.Add(archive);
            archivedIds.Add(avatarId);
            moved.Add(new DeletedAvatarMoveSummary(archive.Name, archive.ReleaseStatus));
        }
        return moved;
    }
    private sealed record SyncedAvatarSyncItem(AvatarInput Avatar, AvatarFavorite? Previous);
    private static AvatarFavorite CreateSyncedFavorite(AvatarInput incoming, AvatarFavorite? previous, string groupId, DateTimeOffset now, int order)
    {
        incoming.GroupId = groupId;
        incoming.Source = "vrchat";
        var favorite = CloneAvatar(incoming, groupId, now, order);
        favorite.Id = $"{groupId}_{favorite.AvatarId}";
        favorite.CreatedAt = previous?.CreatedAt ?? now;
        favorite.UpdatedAt = now;
        if (!string.IsNullOrWhiteSpace(previous?.Notes) && string.IsNullOrWhiteSpace(favorite.Notes)) favorite.Notes = previous.Notes;
        return favorite;
    }
    private static string SyncedAvatarKey(string groupId, string avatarId) => $"{groupId}\n{avatarId}";
    public LibraryData SaveCurrentAvatar(AvatarInput avatar, string groupId)
    {
        avatar.GroupId = groupId;
        avatar.Source = "vrchat";
        return SaveAvatar(avatar);
    }
    public LibraryData SaveRecentAvatar(AvatarInput avatar)
    {
        lock (_gate)
        {
            var lib = Load();
            var now = DateTimeOffset.UtcNow;
            var group = EnsureRecentAvatarGroup(lib, now);
            avatar.GroupId = group.Id;
            avatar.Source = "vrchat-recent";
            if (string.IsNullOrWhiteSpace(avatar.AvatarId)) avatar.AvatarId = avatar.Id;
            if (string.IsNullOrWhiteSpace(avatar.Name)) avatar.Name = string.IsNullOrWhiteSpace(avatar.AvatarId) ? "Unknown avatar" : avatar.AvatarId;

            var existing = !string.IsNullOrWhiteSpace(avatar.AvatarId)
                ? lib.Avatars.FirstOrDefault(x => x.GroupId.Equals(group.Id, StringComparison.OrdinalIgnoreCase) && x.AvatarId.Equals(avatar.AvatarId, StringComparison.OrdinalIgnoreCase))
                : null;
            if (existing is null)
            {
                existing = new AvatarFavorite { Id = NewId("recent"), GroupId = group.Id, CreatedAt = now, Order = 0 };
                lib.Avatars.Add(existing);
            }

            FillAvatar(existing, avatar, now);
            NormalizeRecentAvatarOrder(lib);
            Save(lib);
            return lib;
        }
    }

    private LibraryData Load()
    {
        var lib = JsonSerializer.Deserialize<LibraryData>(File.ReadAllText(_libraryPath), ProgramJson.Options) ?? new LibraryData();
        lib.Groups ??= [];
        lib.Avatars ??= [];
        lib.Groups.RemoveAll(x => x.Id.Equals(UpdatedAvatarGroupId, StringComparison.OrdinalIgnoreCase));
        lib.Avatars.RemoveAll(x => x.GroupId.Equals(UpdatedAvatarGroupId, StringComparison.OrdinalIgnoreCase));
        EnsureDefaultGroups(lib, DateTimeOffset.UtcNow);
        NormalizeOrders(lib);
        return lib;
    }
    private void Save(LibraryData lib, HashSet<string>? removedGroupIds = null)
    {
        Directory.CreateDirectory(_dataDirectory);
        Directory.CreateDirectory(_exportDirectory);
        Directory.CreateDirectory(_backupDirectory);
        EnsureDefaultGroups(lib, DateTimeOffset.UtcNow);
        DeduplicateAvatarFavorites(lib);
        NormalizeOrders(lib);
        File.WriteAllText(_libraryPath, JsonSerializer.Serialize(lib, ProgramJson.Options));
        SaveSplitFiles(lib);
        SaveGroupFiles(lib, removedGroupIds ?? []);
    }
    private void SaveSplitFiles(LibraryData lib)
    {
        Directory.CreateDirectory(AppPaths.RootDirectory);
        File.WriteAllText(_categoriesJsonPath, JsonSerializer.Serialize(lib.Groups.OrderBy(x => x.Order).ToList(), ProgramJson.Options));
        File.WriteAllText(_avatarsJsonPath, JsonSerializer.Serialize(lib.Avatars.OrderBy(x => x.GroupId).ThenBy(x => x.Order).ToList(), ProgramJson.Options));
    }
    private void SaveGroupFiles(LibraryData lib, HashSet<string> removedGroupIds)
    {
        var currentFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var groupFileNames = GroupFileNames(lib.Groups);
        Directory.CreateDirectory(GroupFileDirectory(false));
        Directory.CreateDirectory(GroupFileDirectory(true));
        foreach (var group in lib.Groups)
        {
            var path = Path.Combine(GroupFileDirectory(IsSyncedOrSystemGroupFile(group.Id)), groupFileNames[group.Id]);
            currentFiles.Add(Path.GetFullPath(path));
            File.WriteAllText(path, JsonSerializer.Serialize(GroupSummary(group, lib.Avatars.Where(x => x.GroupId == group.Id).OrderBy(x => x.Order)), ProgramJson.Options));
        }
        ArchiveStaleGroupFiles(currentFiles, lib.Groups.Select(x => x.Id).ToHashSet(StringComparer.OrdinalIgnoreCase), removedGroupIds);
    }
    private void ArchiveStaleGroupFiles(HashSet<string> currentFiles, HashSet<string> currentGroupIds, HashSet<string> removedGroupIds)
    {
        var reservedFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            Path.GetFileName(_libraryPath),
            "settings.json",
            "vrchat-session.json"
        };
        Directory.CreateDirectory(_backupDirectory);
        foreach (var file in GroupFileCleanupDirectories().SelectMany(path => Directory.Exists(path) ? Directory.EnumerateFiles(path, "*.json", SearchOption.TopDirectoryOnly) : []))
        {
            var fileName = Path.GetFileName(file);
            if (reservedFiles.Contains(fileName) || currentFiles.Contains(Path.GetFullPath(file)))
            {
                continue;
            }

            if (IsLegacyGroupFileForCurrentGroup(fileName, currentGroupIds))
            {
                File.Delete(file);
                continue;
            }

            if (IsGroupFileForCurrentGroup(file, currentGroupIds))
            {
                File.Delete(file);
                continue;
            }

            if (IsGroupFileForRemovedGroup(file, removedGroupIds))
            {
                File.Delete(file);
                continue;
            }

            if (!GroupFileHasAvatars(file))
            {
                File.Delete(file);
                continue;
            }

            var target = UniqueBackupPath(_backupDirectory, fileName);
            File.Move(file, target);
        }
    }
    private string GroupFileDirectory(bool synced) => Path.Combine(_dataDirectory, synced ? "synced" : "local");
    private IEnumerable<string> GroupFileCleanupDirectories()
    {
        yield return _dataDirectory;
        yield return GroupFileDirectory(false);
        yield return GroupFileDirectory(true);
    }
    private static bool IsSyncedOrSystemGroupFile(string groupId) => IsSyncedGroupId(groupId) || IsPinnedSystemGroupId(groupId);
    private ExportResult WriteGroupBackup(LibraryData lib, AvatarGroup group, string reason)
    {
        var backupDirectory = GroupBackupDirectory(group.Id, reason);
        Directory.CreateDirectory(backupDirectory);
        var timestamp = DateTimeOffset.Now.ToString("yyyyMMdd-HHmmss");
        var fileName = $"{timestamp}-{SafeFileNameOrDefault(group.Name, "Group")}-{reason}.json";
        var path = UniqueBackupPath(backupDirectory, fileName);
        File.WriteAllText(path, JsonSerializer.Serialize(GroupSummary(group, lib.Avatars.Where(x => x.GroupId == group.Id).OrderBy(x => x.Order)), ProgramJson.Options));
        BackgroundStore.CopyGroupBackgroundToBackup(group.Id, group.Name, path);
        PruneGroupBackups();
        return new ExportResult(path);
    }
    private AccountBackupResult WriteAccountBackup(LibraryData lib, string reason)
    {
        Directory.CreateDirectory(_accountBackupDirectory);
        var cleanReason = string.IsNullOrWhiteSpace(reason) ? "manual" : SafeFileNameOrDefault(reason, "manual").ToLowerInvariant();
        var payload = CleanAccountBackup(lib, cleanReason);
        var timestamp = DateTimeOffset.Now.ToString("yyyyMMdd-HHmmss");
        var path = UniqueBackupPath(_accountBackupDirectory, $"account-avatars-backup-{timestamp}-{cleanReason}.json");
        File.WriteAllText(path, JsonSerializer.Serialize(payload, ProgramJson.Options));
        return new AccountBackupResult(path, payload.CreatedAt, payload.GroupCount, payload.AvatarCount, payload.Reason, AccountBackupRetention);
    }
    private void PruneAccountBackups()
    {
        Directory.CreateDirectory(_accountBackupDirectory);
        var cutoff = DateTime.UtcNow.AddDays(-BackupMaxAgeDays);
        foreach (var oldFile in AccountBackupFiles().Select(path => new FileInfo(path)).Where(file => file.LastWriteTimeUtc < cutoff))
        {
            try { oldFile.Delete(); }
            catch { }
        }

        var files = AccountBackupFiles()
            .Select(path => new FileInfo(path))
            .OrderByDescending(x => x.LastWriteTimeUtc)
            .ThenByDescending(x => x.Name, StringComparer.OrdinalIgnoreCase)
            .Skip(AccountBackupRetention);
        foreach (var file in files)
        {
            try { file.Delete(); }
            catch { }
        }
    }
    private IEnumerable<string> AccountBackupFiles()
    {
        Directory.CreateDirectory(_accountBackupDirectory);
        foreach (var path in Directory.EnumerateFiles(_accountBackupDirectory, "account-avatars-backup-*.json", SearchOption.TopDirectoryOnly)) yield return path;
        foreach (var path in Directory.EnumerateFiles(_accountBackupDirectory, "account-backup-*.json", SearchOption.TopDirectoryOnly)) yield return path;
    }
    public void PruneGroupBackups()
    {
        MigrateGroupBackupsToTypeFolders();
        var cutoff = DateTime.UtcNow.AddDays(-BackupMaxAgeDays);
        foreach (var file in GroupBackupFiles().Where(file => file.LastWriteTimeUtc < cutoff))
        {
            DeleteBackupFile(file.Path);
        }

        var files = GroupBackupFiles().ToList();
        DeleteOlderBackups(files
            .Where(file => IsSyncedGroupId(file.GroupId))
            .OrderByDescending(file => file.LastWriteTimeUtc)
            .ThenByDescending(file => file.Name, StringComparer.OrdinalIgnoreCase)
            .Skip(SyncedGroupBackupRetention));

        foreach (var group in files
            .Where(file => IsLimitedSystemBackupGroupId(file.GroupId))
            .GroupBy(file => file.GroupId, StringComparer.OrdinalIgnoreCase))
        {
            DeleteOlderBackups(group
                .OrderByDescending(file => file.LastWriteTimeUtc)
                .ThenByDescending(file => file.Name, StringComparer.OrdinalIgnoreCase)
                .Skip(SystemGroupBackupRetention));
        }

        DeleteOlderBackups(files
            .Where(file => !IsSyncedGroupId(file.GroupId)
                && !IsLimitedSystemBackupGroupId(file.GroupId)
                && file.Reason.Equals("deleted", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(file => file.LastWriteTimeUtc)
            .ThenByDescending(file => file.Name, StringComparer.OrdinalIgnoreCase)
            .Skip(LocalGroupBackupRetention));

        foreach (var group in files
            .Where(file => !IsSyncedGroupId(file.GroupId)
                && !IsLimitedSystemBackupGroupId(file.GroupId)
                && !file.Reason.Equals("deleted", StringComparison.OrdinalIgnoreCase))
            .GroupBy(file => file.GroupId, StringComparer.OrdinalIgnoreCase))
        {
            DeleteOlderBackups(group
                .OrderByDescending(file => file.LastWriteTimeUtc)
                .ThenByDescending(file => file.Name, StringComparer.OrdinalIgnoreCase)
                .Skip(LocalGroupBackupRetention));
        }
    }
    private static void DeleteOlderBackups(IEnumerable<GroupBackupFile> files)
    {
        foreach (var file in files) DeleteBackupFile(file.Path);
    }
    private void MigrateGroupBackupsToTypeFolders()
    {
        Directory.CreateDirectory(_backupDirectory);
        foreach (var path in Directory.EnumerateFiles(_backupDirectory, "*.json", SearchOption.TopDirectoryOnly).ToList())
        {
            var summary = TryReadGroupBackupSummary(path);
            if (summary is null || string.IsNullOrWhiteSpace(summary.Id)) continue;
            var reason = BackupReasonFromName(Path.GetFileName(path));
            if (string.IsNullOrWhiteSpace(reason)) continue;

            var targetDirectory = GroupBackupDirectory(summary.Id, reason);
            var targetPath = UniqueBackupPath(targetDirectory, Path.GetFileName(path));
            if (Path.GetFullPath(path).Equals(Path.GetFullPath(targetPath), StringComparison.OrdinalIgnoreCase)) continue;
            try
            {
                Directory.CreateDirectory(targetDirectory);
                File.Move(path, targetPath);
                MoveBackupBackgroundFolder(path, targetPath);
            }
            catch { }
        }
    }
    private static void DeleteBackupFile(string path)
    {
        try { File.Delete(path); }
        catch { }

        var backgroundFolder = BackupBackgroundFolderPath(path);
        try
        {
            if (Directory.Exists(backgroundFolder)) Directory.Delete(backgroundFolder, true);
        }
        catch { }
    }
    private static void MoveBackupBackgroundFolder(string oldBackupPath, string newBackupPath)
    {
        var oldBackgroundFolder = BackupBackgroundFolderPath(oldBackupPath);
        if (!Directory.Exists(oldBackgroundFolder)) return;
        var newBackgroundFolder = BackupBackgroundFolderPath(newBackupPath);
        try
        {
            if (Directory.Exists(newBackgroundFolder)) Directory.Delete(newBackgroundFolder, true);
            Directory.CreateDirectory(Path.GetDirectoryName(newBackgroundFolder)!);
            Directory.Move(oldBackgroundFolder, newBackgroundFolder);
        }
        catch { }
    }
    private static string BackupBackgroundFolderPath(string backupPath) => Path.Combine(
        Path.GetDirectoryName(backupPath) ?? "",
        $"{Path.GetFileNameWithoutExtension(backupPath)}.background");
    private IEnumerable<GroupBackupFile> GroupBackupFiles()
    {
        Directory.CreateDirectory(_backupDirectory);
        foreach (var path in Directory.EnumerateFiles(_backupDirectory, "*.json", SearchOption.AllDirectories))
        {
            var summary = TryReadGroupBackupSummary(path);
            if (summary is null || string.IsNullOrWhiteSpace(summary.Id)) continue;

            var reason = BackupReasonFromName(Path.GetFileName(path));
            if (string.IsNullOrWhiteSpace(reason)) continue;

            FileInfo file;
            try { file = new FileInfo(path); }
            catch { continue; }
            yield return new GroupBackupFile(file.FullName, file.Name, summary.Id, string.IsNullOrWhiteSpace(summary.Name) ? Path.GetFileNameWithoutExtension(path) : summary.Name.Trim(), reason, GroupBackupType(summary.Id, reason), file.LastWriteTimeUtc, file.Length);
        }
    }
    private static AccountBackupFileInfo AccountBackupFileInfo(string path)
    {
        var file = new FileInfo(path);
        var groupCount = 0;
        var avatarCount = 0;
        var reason = "Account backup";
        DateTimeOffset createdAt = file.LastWriteTime;
        try
        {
            var summary = JsonSerializer.Deserialize<AccountBackupExport>(File.ReadAllText(path), ProgramJson.Options);
            if (summary is not null)
            {
                groupCount = summary.GroupCount;
                avatarCount = summary.AvatarCount;
                reason = string.IsNullOrWhiteSpace(summary.Reason) ? reason : summary.Reason;
                createdAt = summary.CreatedAt;
            }
        }
        catch { }
        return new AccountBackupFileInfo(file.Name, file.FullName, file.Length, file.LastWriteTime, createdAt, reason, groupCount, avatarCount);
    }
    private static GroupFileSummary? TryReadGroupBackupSummary(string path)
    {
        try { return JsonSerializer.Deserialize<GroupFileSummary>(File.ReadAllText(path), ProgramJson.Options); }
        catch { return null; }
    }
    private static string BackupReasonFromName(string fileName)
    {
        var name = Path.GetFileNameWithoutExtension(fileName);
        foreach (var reason in new[] { "pre-replace", "pre-save", "unfavorited", "deleted", "edit" })
        {
            if (name.EndsWith($"-{reason}", StringComparison.OrdinalIgnoreCase)) return reason;
        }
        var dash = name.LastIndexOf('-');
        return dash >= 0 && dash + 1 < name.Length ? name[(dash + 1)..] : "";
    }
    private string GroupBackupDirectory(string groupId, string reason) => Path.Combine(_backupDirectory, GroupBackupType(groupId, reason));
    private static string GroupBackupType(string groupId, string reason)
    {
        if (IsSyncedGroupId(groupId)) return SyncedBackupFolderName;
        if (IsLimitedSystemBackupGroupId(groupId)) return SystemBackupFolderName;
        if (reason.Equals("deleted", StringComparison.OrdinalIgnoreCase)) return DeletedBackupFolderName;
        return LocalBackupFolderName;
    }
    private static string GroupBackupReasonDisplay(string fileName)
    {
        var reason = BackupReasonFromName(fileName);
        return reason.ToLowerInvariant() switch
        {
            "pre-save" => "Edit mode",
            "pre-replace" => "Replace synced group",
            "edit" => "Edit mode",
            "unfavorited" => "Unfavorite All",
            "deleted" => "Deleted group",
            _ => "Cleanup backup"
        };
    }
    private static List<string> OrderedSyncedAvatarIds(LibraryData lib, string groupId, IReadOnlyCollection<string> orderedLocalIds)
    {
        var avatars = lib.Avatars
            .Where(x => x.GroupId.Equals(groupId, StringComparison.OrdinalIgnoreCase))
            .OrderBy(x => x.Order)
            .ThenBy(x => x.CreatedAt)
            .ToList();
        if (avatars.Count == 0) return [];

        var uniqueIds = orderedLocalIds
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (uniqueIds.Count != avatars.Count) throw new InvalidOperationException("The synced group order changed. Sync again, then reopen edit mode.");

        var byLocalId = avatars.ToDictionary(x => x.Id, StringComparer.OrdinalIgnoreCase);
        var ordered = new List<string>();
        foreach (var id in uniqueIds)
        {
            if (!byLocalId.TryGetValue(id, out var avatar)) throw new InvalidOperationException("The synced group order has an unknown avatar. Sync again, then reopen edit mode.");
            var avatarId = avatar.AvatarId?.Trim() ?? "";
            if (string.IsNullOrWhiteSpace(avatarId)) throw new InvalidOperationException($"Avatar '{avatar.Name}' is missing a VRChat avatar ID.");
            ordered.Add(avatarId);
        }

        return ordered;
    }
    private static bool GroupFileHasAvatars(string path)
    {
        try
        {
            var summary = JsonSerializer.Deserialize<GroupFileSummary>(File.ReadAllText(path), ProgramJson.Options);
            return summary?.Avatars?.Count > 0;
        }
        catch
        {
            return true;
        }
    }
    private static CleanLibraryExport CleanExport(LibraryData lib) => new(lib.Groups.OrderBy(x => x.Order).Select(g => GroupSummary(g, lib.Avatars.Where(a => a.GroupId == g.Id).OrderBy(a => a.Order))).ToList());
    private static AccountBackupExport CleanAccountBackup(LibraryData lib, string reason)
    {
        var syncedGroupIds = lib.Groups
            .Where(group => group.Id.StartsWith("vrc_", StringComparison.OrdinalIgnoreCase))
            .Select(x => x.Id)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var groups = lib.Groups
            .Where(x => syncedGroupIds.Contains(x.Id))
            .OrderBy(x => x.Order)
            .Select(g => GroupSummary(g, lib.Avatars.Where(a => a.GroupId == g.Id).OrderBy(a => a.Order)))
            .ToList();
        var avatarCount = groups.Sum(x => x.Avatars?.Count ?? 0);
        return new AccountBackupExport(DateTimeOffset.UtcNow, reason, AccountBackupRetention, groups.Count, avatarCount, groups);
    }
    private static GroupFileSummary GroupSummary(AvatarGroup group, IEnumerable<AvatarFavorite> avatars) => new(group.Id, group.Name, group.Description, group.Icon, group.BackgroundFolder, group.BackgroundEffect, avatars.Select(ExportAvatar).ToList());
    private static AvatarInput ExportAvatar(AvatarFavorite avatar) => new()
    {
        Id = avatar.AvatarId,
        GroupId = avatar.GroupId,
        AvatarId = avatar.AvatarId,
        Name = avatar.Name,
        Description = avatar.Description,
        AuthorId = avatar.AuthorId,
        AuthorName = avatar.AuthorName,
        ImageUrl = avatar.ImageUrl,
        ThumbnailImageUrl = avatar.ThumbnailImageUrl,
        ReleaseStatus = avatar.ReleaseStatus,
        Version = avatar.Version,
        Platforms = avatar.Platforms,
        Tags = avatar.Tags,
        SourceUrl = avatar.SourceUrl,
        Notes = avatar.Notes,
        RawJson = avatar.RawJson,
        Source = avatar.Source,
        RemoteCreatedAt = avatar.RemoteCreatedAt,
        RemoteUpdatedAt = avatar.RemoteUpdatedAt,
        RemoteFavoriteId = avatar.RemoteFavoriteId
    };
    private static LibraryData ReadImport(JsonElement payload)
    {
        var imported = new LibraryData();
        if (payload.ValueKind == JsonValueKind.Array)
        {
            foreach (var groupElement in payload.EnumerateArray()) ReadImportedGroup(groupElement, imported);
            return imported;
        }
        if (payload.ValueKind != JsonValueKind.Object) return imported;
        if (payload.TryGetProperty("name", out _) && payload.TryGetProperty("avatars", out var groupAvatarsElement) && groupAvatarsElement.ValueKind == JsonValueKind.Array)
        {
            ReadImportedGroup(payload, imported);
            return imported;
        }
        if (payload.TryGetProperty("groups", out var groupsElement) && groupsElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var groupElement in groupsElement.EnumerateArray()) ReadImportedGroup(groupElement, imported);
        }
        if (payload.TryGetProperty("avatars", out var avatarsElement) && avatarsElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var avatarElement in avatarsElement.EnumerateArray()) imported.Avatars.Add(ReadImportedAvatar(avatarElement, ""));
        }
        if (imported.Groups.Count == 0 && payload.TryGetProperty("name", out _))
        {
            ReadImportedGroup(payload, imported);
        }
        return imported;
    }
    private static void ReadImportedGroup(JsonElement element, LibraryData imported)
    {
        var group = element.Deserialize<AvatarGroup>(ProgramJson.Options) ?? new AvatarGroup();
        group.Id = string.IsNullOrWhiteSpace(group.Id) ? NewId("import") : group.Id;
        group.Name = string.IsNullOrWhiteSpace(group.Name) ? "Imported Group" : group.Name;
        imported.Groups.Add(group);
        if (!element.TryGetProperty("avatars", out var avatarsElement) || avatarsElement.ValueKind != JsonValueKind.Array) return;
        foreach (var avatarElement in avatarsElement.EnumerateArray())
        {
            imported.Avatars.Add(ReadImportedAvatar(avatarElement, group.Id));
        }
    }
    private static AvatarFavorite ReadImportedAvatar(JsonElement element, string fallbackGroupId)
    {
        var input = element.Deserialize<AvatarInput>(ProgramJson.Options) ?? new AvatarInput();
        if (string.IsNullOrWhiteSpace(input.AvatarId)) input.AvatarId = input.Id;
        if (string.IsNullOrWhiteSpace(input.Name)) input.Name = input.AvatarId;
        if (string.IsNullOrWhiteSpace(input.GroupId)) input.GroupId = fallbackGroupId;
        return new AvatarFavorite
        {
            Id = string.IsNullOrWhiteSpace(input.Id) ? input.AvatarId : input.Id,
            GroupId = input.GroupId,
            AvatarId = input.AvatarId,
            Name = input.Name,
            Description = input.Description,
            AuthorId = input.AuthorId,
            AuthorName = input.AuthorName,
            ImageUrl = input.ImageUrl,
            ThumbnailImageUrl = input.ThumbnailImageUrl,
            ReleaseStatus = input.ReleaseStatus,
            Version = input.Version,
            Platforms = input.Platforms,
            Tags = input.Tags,
            SourceUrl = input.SourceUrl,
            Notes = input.Notes,
            RawJson = input.RawJson,
            Source = input.Source,
            RemoteCreatedAt = input.RemoteCreatedAt,
            RemoteUpdatedAt = input.RemoteUpdatedAt,
            RemoteFavoriteId = input.RemoteFavoriteId
        };
    }
    private static void FillAvatar(AvatarFavorite a, AvatarInput input, DateTimeOffset now)
    {
        a.GroupId = input.GroupId;
        a.AvatarId = input.AvatarId?.Trim() ?? "";
        a.Name = CleanRequired(input.Name, "Avatar name");
        a.Description = input.Description?.Trim() ?? "";
        a.AuthorId = input.AuthorId?.Trim() ?? "";
        a.AuthorName = input.AuthorName?.Trim() ?? "";
        a.ImageUrl = input.ImageUrl?.Trim() ?? "";
        a.ThumbnailImageUrl = input.ThumbnailImageUrl?.Trim() ?? "";
        a.ReleaseStatus = input.ReleaseStatus?.Trim() ?? "";
        a.Version = input.Version?.Trim() ?? "";
        a.Platforms = input.Platforms?.Trim() ?? "";
        a.Tags = input.Tags?.Trim() ?? "";
        a.SourceUrl = input.SourceUrl?.Trim() ?? "";
        a.Notes = input.Notes?.Trim() ?? "";
        a.RawJson = input.RawJson?.Trim() ?? "";
        if (!string.IsNullOrWhiteSpace(input.Source)) a.Source = input.Source.Trim();
        a.RemoteCreatedAt = input.RemoteCreatedAt?.Trim() ?? a.RemoteCreatedAt;
        a.RemoteUpdatedAt = input.RemoteUpdatedAt?.Trim() ?? a.RemoteUpdatedAt;
        a.RemoteFavoriteId = input.RemoteFavoriteId?.Trim() ?? a.RemoteFavoriteId;
        a.UpdatedAt = now;
    }
    private static AvatarFavorite CloneAvatar(AvatarFavorite avatar, string groupId, DateTimeOffset now, int order) => new()
    {
        Id = NewId("local"), GroupId = groupId, AvatarId = avatar.AvatarId, Name = avatar.Name, Description = avatar.Description, AuthorId = avatar.AuthorId,
        AuthorName = avatar.AuthorName, ImageUrl = avatar.ImageUrl, ThumbnailImageUrl = avatar.ThumbnailImageUrl, ReleaseStatus = avatar.ReleaseStatus,
        Version = avatar.Version, Platforms = avatar.Platforms, Tags = avatar.Tags, SourceUrl = avatar.SourceUrl, Notes = avatar.Notes, RawJson = avatar.RawJson,
        Source = avatar.Source, RemoteCreatedAt = avatar.RemoteCreatedAt, RemoteUpdatedAt = avatar.RemoteUpdatedAt, RemoteFavoriteId = avatar.RemoteFavoriteId, Order = order, CreatedAt = now, UpdatedAt = now
    };
    private static AvatarFavorite CloneAvatar(AvatarInput avatar, string groupId, DateTimeOffset now, int order) => new()
    {
        Id = NewId("local"), GroupId = groupId, AvatarId = avatar.AvatarId, Name = avatar.Name, Description = avatar.Description, AuthorId = avatar.AuthorId,
        AuthorName = avatar.AuthorName, ImageUrl = avatar.ImageUrl, ThumbnailImageUrl = avatar.ThumbnailImageUrl, ReleaseStatus = avatar.ReleaseStatus,
        Version = avatar.Version, Platforms = avatar.Platforms, Tags = avatar.Tags, SourceUrl = avatar.SourceUrl, Notes = avatar.Notes, RawJson = avatar.RawJson,
        Source = avatar.Source, RemoteCreatedAt = avatar.RemoteCreatedAt, RemoteUpdatedAt = avatar.RemoteUpdatedAt, RemoteFavoriteId = avatar.RemoteFavoriteId, Order = order, CreatedAt = now, UpdatedAt = now
    };
    private static List<DeletedAvatarMoveSummary> ArchiveDeletedVrChatAvatars(
        LibraryData lib,
        List<VrChatGroupedAvatar> deletedAvatars,
        Dictionary<string, AvatarFavorite> previousSynced,
        Dictionary<string, AvatarFavorite> previousDeleted,
        HashSet<string> activeAvatarIds,
        DateTimeOffset now)
    {
        var moved = new List<DeletedAvatarMoveSummary>();
        if (deletedAvatars.Count == 0 && lib.Avatars.All(x => !x.GroupId.Equals(DeletedAvatarGroupId, StringComparison.OrdinalIgnoreCase)))
        {
            return moved;
        }

        var group = EnsureDeletedAvatarGroup(lib, now);
        lib.Avatars.RemoveAll(x => x.GroupId.Equals(DeletedAvatarGroupId, StringComparison.OrdinalIgnoreCase) && activeAvatarIds.Contains(x.AvatarId));
        var archivedIds = lib.Avatars
            .Where(x => x.GroupId.Equals(DeletedAvatarGroupId, StringComparison.OrdinalIgnoreCase))
            .Select(x => x.AvatarId)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var deleted in deletedAvatars)
        {
            var incoming = deleted.Avatar;
            var avatarId = incoming.AvatarId?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(avatarId) || activeAvatarIds.Contains(avatarId) || archivedIds.Contains(avatarId))
            {
                continue;
            }

            previousSynced.TryGetValue(avatarId, out var oldSynced);
            previousDeleted.TryGetValue(avatarId, out var oldDeleted);
            var archive = CreateDeletedArchiveAvatar(incoming, oldSynced ?? oldDeleted, group.Id, now, NextAvatarOrder(lib, group.Id));
            lib.Avatars.Add(archive);
            archivedIds.Add(avatarId);
            moved.Add(new DeletedAvatarMoveSummary(archive.Name, archive.ReleaseStatus));
        }
        return moved;
    }
    private static AvatarGroup EnsureDeletedAvatarGroup(LibraryData lib, DateTimeOffset now)
    {
        var group = lib.Groups.FirstOrDefault(x => x.Id.Equals(DeletedAvatarGroupId, StringComparison.OrdinalIgnoreCase));
        if (group is null)
        {
            group = new AvatarGroup
            {
                Id = DeletedAvatarGroupId,
                Name = DeletedAvatarGroupName,
                Description = "Archived VRChat favorites whose avatar details are no longer returned by VRChat.",
                Order = NextGroupOrder(lib),
                ReorderLocked = true,
                CreatedAt = now
            };
            lib.Groups.Add(group);
        }

        group.Name = DeletedAvatarGroupName;
        group.ReorderLocked ??= true;
        group.UpdatedAt = now;
        return group;
    }
    private static AvatarFavorite CreateDeletedArchiveAvatar(AvatarInput incoming, AvatarFavorite? previous, string groupId, DateTimeOffset now, int order)
    {
        var source = previous is null ? CloneAvatar(incoming, groupId, now, order) : CloneAvatar(previous, groupId, now, order);
        source.Id = $"{groupId}_{source.AvatarId}";
        source.GroupId = groupId;
        source.Name = string.IsNullOrWhiteSpace(source.Name) ? $"Deleted avatar {source.AvatarId}" : source.Name;
        source.ReleaseStatus = ArchivedReleaseStatus(incoming.ReleaseStatus);
        source.Source = "vrchat-deleted";
        source.RemoteFavoriteId = string.IsNullOrWhiteSpace(incoming.RemoteFavoriteId) ? source.RemoteFavoriteId : incoming.RemoteFavoriteId;
        source.Notes = AppendArchiveNote(source.Notes);
        source.UpdatedAt = now;
        return source;
    }
    private static string AppendArchiveNote(string? notes)
    {
        const string note = "Archived because VRChat still has the favorite record, but the avatar details are no longer available.";
        if (!string.IsNullOrWhiteSpace(notes) && notes.Contains(note, StringComparison.OrdinalIgnoreCase))
        {
            return notes;
        }

        return string.IsNullOrWhiteSpace(notes) ? note : $"{notes.Trim()}\n{note}";
    }
    private static string ArchivedReleaseStatus(string? status)
    {
        var value = status?.Trim() ?? "";
        return value.Equals("private", StringComparison.OrdinalIgnoreCase) || value.Equals("hidden", StringComparison.OrdinalIgnoreCase) ? "private" : "deleted";
    }
    private static LibraryData CreateDefaultLibrary()
    {
        var now = DateTimeOffset.UtcNow;
        var lib = new LibraryData
        {
            Groups = [],
            Avatars = []
        };
        EnsureDefaultGroups(lib, now);
        return lib;
    }
    private static void EnsureDefaultGroups(LibraryData lib, DateTimeOffset now)
    {
        EnsureDefaultSyncedGroups(lib, now);
        if (!lib.Groups.Any(x => !IsSyncedGroupId(x.Id) && !IsPinnedSystemGroupId(x.Id)))
        {
            lib.Groups.Add(CreateDefaultFavoritesGroup(now, NextGroupOrder(lib)));
        }
        EnsureRecentAvatarGroup(lib, now);
        EnsureDeletedAvatarGroup(lib, now);
        EnsureDefaultReorderLocks(lib);
    }
    private static void ResetSyncedGroupsToDefaults(LibraryData lib, DateTimeOffset now)
    {
        lib.Avatars.RemoveAll(x => IsSyncedGroupId(x.GroupId)
            || x.GroupId.Equals(UploadedAvatarGroupId, StringComparison.OrdinalIgnoreCase)
            || x.GroupId.Equals(UpdatedAvatarGroupId, StringComparison.OrdinalIgnoreCase));
        lib.Groups.RemoveAll(x => IsSyncedGroupId(x.Id)
            || x.Id.Equals(UploadedAvatarGroupId, StringComparison.OrdinalIgnoreCase)
            || x.Id.Equals(UpdatedAvatarGroupId, StringComparison.OrdinalIgnoreCase));
        EnsureDefaultSyncedGroups(lib, now);
    }
    private static void EnsureDefaultSyncedGroups(LibraryData lib, DateTimeOffset now)
    {
        var missing = Enumerable.Range(1, DefaultSyncedGroupCount)
            .Where(index => !lib.Groups.Any(x => x.Id.Equals(DefaultSyncedGroupId(index), StringComparison.OrdinalIgnoreCase)))
            .ToList();
        var startOrder = lib.Groups.Count == 0 ? 0 : lib.Groups.Min(x => x.Order) - missing.Count;
        for (var i = 0; i < missing.Count; i++)
        {
            lib.Groups.Add(CreateDefaultSyncedGroup(missing[i], now, startOrder + i));
        }
    }
    private static AvatarGroup CreateDefaultSyncedGroup(int index, DateTimeOffset now, int order) => new()
    {
        Id = DefaultSyncedGroupId(index),
        Name = DefaultSyncedGroupName(index),
        Description = "Default empty VRChat favorite group. Log in and sync to load your avatars.",
        Order = order,
        ReorderLocked = true,
        CreatedAt = now,
        UpdatedAt = now
    };
    private static string DefaultSyncedGroupId(int index) => $"vrc_avatars{index}";
    private static string DefaultSyncedGroupName(int index) => index <= 1 ? "Favorite Avatars" : $"VRC+ Avatars {index - 1}";
    private static AvatarGroup CreateDefaultFavoritesGroup(DateTimeOffset now, int order) => new()
    {
        Id = NewId("grp"),
        Name = "Favorites",
        Description = "Default local avatar favorites.",
        Order = order,
        CreatedAt = now,
        UpdatedAt = now
    };
    private static AvatarGroup EnsureRecentAvatarGroup(LibraryData lib, DateTimeOffset now)
    {
        var group = lib.Groups.FirstOrDefault(x => x.Id.Equals(RecentAvatarGroupId, StringComparison.OrdinalIgnoreCase));
        if (group is null)
        {
            group = new AvatarGroup
            {
                Id = RecentAvatarGroupId,
                Name = RecentAvatarGroupName,
                Description = "Avatars equipped through this app or detected as your current avatar.",
                Order = NextGroupOrder(lib),
                ReorderLocked = true,
                CreatedAt = now
            };
            lib.Groups.Add(group);
        }

        group.Name = RecentAvatarGroupName;
        group.ReorderLocked ??= true;
        group.UpdatedAt = now;
        return group;
    }
    private static void NormalizeRecentAvatarOrder(LibraryData lib)
    {
        var order = 0;
        foreach (var avatar in lib.Avatars
            .Where(x => x.GroupId.Equals(RecentAvatarGroupId, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(x => x.UpdatedAt)
            .ThenByDescending(x => x.CreatedAt))
        {
            avatar.Order = order++;
        }
    }
    private static void DeduplicateAvatarFavorites(LibraryData lib)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        lib.Avatars = lib.Avatars
            .OrderBy(x => x.GroupId, StringComparer.OrdinalIgnoreCase)
            .ThenBy(x => x.Order)
            .ThenBy(x => x.CreatedAt)
            .Where(avatar =>
            {
                var avatarId = avatar.AvatarId?.Trim() ?? "";
                if (string.IsNullOrWhiteSpace(avatarId)) return true;
                return seen.Add($"{avatar.GroupId.Trim()}::{avatarId}");
            })
            .ToList();
    }
    private static void EnsureSyncedGroupCapacity(LibraryData lib, string groupId, string? existingId, string? avatarId)
    {
        if (!IsSyncedGroupId(groupId))
        {
            return;
        }

        var avatars = lib.Avatars.Where(x => x.GroupId.Equals(groupId, StringComparison.OrdinalIgnoreCase)).ToList();
        if (!string.IsNullOrWhiteSpace(existingId) && avatars.Any(x => x.Id.Equals(existingId, StringComparison.OrdinalIgnoreCase)))
        {
            return;
        }

        if (avatars.Count >= SyncedGroupAvatarLimit)
        {
            throw new InvalidOperationException($"Synced VRChat favorite groups can only contain {SyncedGroupAvatarLimit} avatars.");
        }
    }
    private static bool IsSyncedGroupId(string groupId) => groupId.StartsWith("vrc_", StringComparison.OrdinalIgnoreCase);
    private static bool IsLimitedSystemBackupGroupId(string groupId) =>
        groupId.Equals(RecentAvatarGroupId, StringComparison.OrdinalIgnoreCase) ||
        groupId.Equals(DeletedAvatarGroupId, StringComparison.OrdinalIgnoreCase);
    private static bool IsPinnedSystemGroupId(string groupId) =>
        groupId.Equals(RecentAvatarGroupId, StringComparison.OrdinalIgnoreCase) ||
        groupId.Equals(DeletedAvatarGroupId, StringComparison.OrdinalIgnoreCase) ||
        groupId.Equals(UploadedAvatarGroupId, StringComparison.OrdinalIgnoreCase) ||
        groupId.Equals(UpdatedAvatarGroupId, StringComparison.OrdinalIgnoreCase);
    private static bool IsDefaultReorderLockedGroupId(string groupId) => IsSyncedGroupId(groupId) || IsPinnedSystemGroupId(groupId);
    private static bool IsGroupReorderLocked(AvatarGroup group) => IsDefaultReorderLockedGroupId(group.Id);
    private static void EnsureDefaultReorderLocks(LibraryData lib)
    {
        foreach (var group in lib.Groups.Where(x => IsDefaultReorderLockedGroupId(x.Id)))
        {
            group.ReorderLocked = true;
        }
    }
    private static void NormalizeOrders(LibraryData lib)
    {
        var order = 0;
        lib.Groups = lib.Groups
            .OrderBy(GroupBucket)
            .ThenBy(GroupBucketOrder)
            .ThenBy(x => x.Order)
            .ThenBy(x => x.CreatedAt)
            .ToList();
        foreach (var group in lib.Groups) group.Order = order++;
        foreach (var set in lib.Avatars.GroupBy(x => x.GroupId))
        {
            order = 0;
            foreach (var avatar in set.OrderBy(x => x.Order).ThenBy(x => x.CreatedAt)) avatar.Order = order++;
        }
    }
    private static void OrderSyncedGroupsFirst(LibraryData lib)
    {
        var order = 0;
        foreach (var group in lib.Groups
            .OrderBy(GroupBucket)
            .ThenBy(x => x.Order)
            .ThenBy(x => x.CreatedAt))
        {
            group.Order = order++;
        }
    }
    private static int GroupBucket(AvatarGroup group)
    {
        if (IsSyncedGroupId(group.Id)) return 0;
        if (group.Id.Equals(UploadedAvatarGroupId, StringComparison.OrdinalIgnoreCase)) return 1;
        if (group.Id.Equals(UpdatedAvatarGroupId, StringComparison.OrdinalIgnoreCase)) return 2;
        if (group.Id.Equals(RecentAvatarGroupId, StringComparison.OrdinalIgnoreCase)) return 4;
        if (group.Id.Equals(DeletedAvatarGroupId, StringComparison.OrdinalIgnoreCase)) return 5;
        return 3;
    }
    private static int GroupBucketOrder(AvatarGroup group)
    {
        var match = System.Text.RegularExpressions.Regex.Match(group.Id, @"^vrc_avatars(?<index>\d+)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return match.Success && int.TryParse(match.Groups["index"].Value, out var index) ? index : 0;
    }
    private static bool IsDefaultLocalGroup(AvatarGroup group) =>
        group.Description.Equals("Default local avatar favorites.", StringComparison.OrdinalIgnoreCase) ||
        group.Name.Equals("Favorites", StringComparison.OrdinalIgnoreCase);
    private static int NextGroupOrder(LibraryData lib) => lib.Groups.Count == 0 ? 0 : lib.Groups.Max(x => x.Order) + 1;
    private static int NextAvatarOrder(LibraryData lib, string groupId) => lib.Avatars.Where(x => x.GroupId == groupId).DefaultIfEmpty().Max(x => x?.Order ?? -1) + 1;
    private static void ShiftAvatarOrdersDown(LibraryData lib, string groupId, string excludeId = "")
    {
        foreach (var avatar in lib.Avatars.Where(x => x.GroupId.Equals(groupId, StringComparison.OrdinalIgnoreCase) && !x.Id.Equals(excludeId, StringComparison.OrdinalIgnoreCase)))
        {
            avatar.Order++;
        }
    }
    private static void PlaceAvatarAtTop(LibraryData lib, AvatarFavorite avatar, string groupId)
    {
        ShiftAvatarOrdersDown(lib, groupId, avatar.Id);
        avatar.GroupId = groupId;
        avatar.Order = 0;
    }
    private static bool AvatarExistsInGroup(LibraryData lib, string groupId, string? avatarId, string? excludeId = null)
    {
        var ids = new[] { avatarId, excludeId }
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x!.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (ids.Count == 0) return false;
        return lib.Avatars.Any(x =>
            !x.Id.Equals(excludeId ?? "", StringComparison.OrdinalIgnoreCase) &&
            x.GroupId.Equals(groupId, StringComparison.OrdinalIgnoreCase) &&
            (ids.Contains(x.AvatarId ?? "") || ids.Contains(x.Id)));
    }
    private static string UniqueGroupName(LibraryData lib, string? baseName)
    {
        var clean = string.IsNullOrWhiteSpace(baseName) ? "Imported Group" : baseName.Trim();
        var names = lib.Groups.Select(x => x.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!names.Contains(clean)) return clean;
        for (var i = 2; ; i++) if (!names.Contains($"{clean} {i}")) return $"{clean} {i}";
    }
    private static string CleanRequired(string? value, string label) => string.IsNullOrWhiteSpace(value) ? throw new InvalidOperationException($"{label} is required.") : value.Trim();
    private static string CleanGroupIcon(string? value)
    {
        var icon = value?.Trim() ?? "";
        if (icon.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase)) return icon.Length <= 40000 ? icon : "";
        return icon.Length <= 32 ? icon : icon[..32];
    }
    private static string CleanBackgroundEffect(string? value)
    {
        var effect = value?.Trim().ToLowerInvariant() ?? "global";
        return effect is "" or "global" or "aurora" or "aurorasnow" or "blizzard" or "embers" or "fog" or "pulse" or "lowpoly" or "matrix" or "nebula" or "particles" or "flow" or "rain" or "snow" or "stars" or "thunderstorm" or "noise" or "noise2" ? effect : "global";
    }
    private static string NormalizeGroupBackgroundFolder(string groupId, string groupName, string? value) =>
        string.IsNullOrWhiteSpace(value) ? "" : RelativeGroupBackgroundFolder(groupId, groupName);
    private static string RelativeGroupBackgroundFolder(string groupId, string groupName) =>
        Path.Combine("Custom Background", "Groups", $"{SafeFileNameOrDefault(groupName, "Group")} - {SafeFileNameOrDefault(groupId, "group")}");
    private static string NewId(string prefix) => $"{prefix}_{Guid.NewGuid():N}";
    private static string SafeFileName(string name) => string.Join("_", name.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries)).Trim();
    private static string SafeFileNameOrDefault(string name, string fallback)
    {
        var safe = SafeFileName(name);
        return string.IsNullOrWhiteSpace(safe) ? fallback : safe;
    }
    private static Dictionary<string, string> GroupFileNames(IEnumerable<AvatarGroup> groups)
    {
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var fileNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var group in groups.OrderBy(x => x.Order).ThenBy(x => x.CreatedAt))
        {
            var baseName = SafeFileNameOrDefault(group.Name, "Group");
            var fileName = $"{baseName}.json";
            for (var i = 2; !used.Add(fileName); i++)
            {
                fileName = $"{baseName} {i}.json";
            }
            fileNames[group.Id] = fileName;
        }
        return fileNames;
    }
    private static bool IsLegacyGroupFileForCurrentGroup(string fileName, HashSet<string> currentGroupIds)
    {
        var name = Path.GetFileNameWithoutExtension(fileName);
        return currentGroupIds.Any(groupId => name.EndsWith($"-{groupId}", StringComparison.OrdinalIgnoreCase));
    }
    private static bool IsGroupFileForCurrentGroup(string path, HashSet<string> currentGroupIds)
    {
        try
        {
            var summary = JsonSerializer.Deserialize<GroupFileSummary>(File.ReadAllText(path), ProgramJson.Options);
            return !string.IsNullOrWhiteSpace(summary?.Id) && currentGroupIds.Contains(summary.Id);
        }
        catch
        {
            return false;
        }
    }
    private static bool IsGroupFileForRemovedGroup(string path, HashSet<string> removedGroupIds)
    {
        if (removedGroupIds.Count == 0) return false;
        try
        {
            var summary = JsonSerializer.Deserialize<GroupFileSummary>(File.ReadAllText(path), ProgramJson.Options);
            return !string.IsNullOrWhiteSpace(summary?.Id) && removedGroupIds.Contains(summary.Id);
        }
        catch
        {
            return false;
        }
    }
    private static string UniqueBackupPath(string backupDirectory, string fileName)
    {
        var target = Path.Combine(backupDirectory, fileName);
        if (!File.Exists(target)) return target;
        var name = Path.GetFileNameWithoutExtension(fileName);
        var extension = Path.GetExtension(fileName);
        return Path.Combine(backupDirectory, $"{name}-{DateTimeOffset.Now:yyyyMMddHHmmssfff}{extension}");
    }
    private static string ResolveBackupPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new InvalidOperationException("Choose a backup file.");
        var root = Path.GetFullPath(AppPaths.BackupsDirectory);
        var fullPath = Path.GetFullPath(path);
        if (!fullPath.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && !fullPath.Equals(root, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Backup file must be inside the Backups folder.");
        }
        if (!File.Exists(fullPath)) throw new InvalidOperationException("Backup file not found.");
        return fullPath;
    }
}

internal sealed class AppSettingsStore
{
    private static readonly AppSettings DefaultSettings = new(10, 10, "#303735", 20, 35, "#303735", true, "", false, false, 7);
    private readonly string _settingsPath = AppPaths.SettingsPath;
    public AppSettings Get()
    {
        if (!File.Exists(_settingsPath)) return Save(DefaultSettings);
        try { return Normalize(JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(_settingsPath), ProgramJson.Options) ?? DefaultSettings); }
        catch { return Save(DefaultSettings); }
    }
    public AppSettings Save(AppSettings settings)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_settingsPath)!);
        var normalized = Normalize(settings);
        File.WriteAllText(_settingsPath, JsonSerializer.Serialize(normalized, ProgramJson.Options));
        return normalized;
    }
    private static AppSettings Normalize(AppSettings s)
    {
        var grid = s.SchemaVersion < 2 && s.GridSize == 4 ? DefaultSettings.GridSize : Math.Clamp(s.GridSize, 3, 10);
        var databaseGrid = s.DatabaseGridSize == 0 ? grid : Math.Clamp(s.DatabaseGridSize, 3, 10);
        var color = string.IsNullOrWhiteSpace(s.ThemeColor) || !System.Text.RegularExpressions.Regex.IsMatch(s.ThemeColor, "^#[0-9a-fA-F]{6}$") ? DefaultSettings.ThemeColor : s.ThemeColor;
        var opacity = s.SchemaVersion < 4 && s.BackgroundOpacity == 18 ? 20 : Math.Clamp(s.BackgroundOpacity, 0, 100);
        var panelOpacity = s.SchemaVersion < 6 && s.PanelOpacity == 0 ? DefaultSettings.PanelOpacity : Math.Clamp(s.PanelOpacity, 0, 100);
        var panelColor = string.IsNullOrWhiteSpace(s.PanelColor) || !System.Text.RegularExpressions.Regex.IsMatch(s.PanelColor, "^#[0-9a-fA-F]{6}$") ? color : s.PanelColor;
        var panelSynced = s.SchemaVersion < 6 || s.PanelColorSynced;
        return new AppSettings(grid, databaseGrid, color, opacity, panelOpacity, panelColor, panelSynced, s.BackgroundEffect ?? "", s.HideLockedGroups, s.HideFullGroups, 7);
    }
}

internal sealed class MessageHistoryStore
{
    private readonly string _path = AppPaths.MessageHistoryPath;
    private readonly object _gate = new();

    public List<PersistedMessageSummary> Load()
    {
        lock (_gate)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            if (!File.Exists(_path)) File.WriteAllText(_path, "[]");
            try
            {
                return JsonSerializer.Deserialize<List<PersistedMessageSummary>>(File.ReadAllText(_path), ProgramJson.Options) ?? [];
            }
            catch
            {
                return Save([]);
            }
        }
    }

    public List<PersistedMessageSummary> Save(List<PersistedMessageSummary> items)
    {
        lock (_gate)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            var normalized = (items ?? [])
                .Where(x => !string.IsNullOrWhiteSpace(x.Id) && (!string.IsNullOrWhiteSpace(x.SenderUserId) || !string.IsNullOrWhiteSpace(x.SenderUsername)))
                .GroupBy(x => x.Id, StringComparer.OrdinalIgnoreCase)
                .Select(x => x.First())
                .OrderByDescending(x => ParseDate(x.CreatedAt))
                .Take(2000)
                .ToList();
            File.WriteAllText(_path, JsonSerializer.Serialize(normalized, ProgramJson.Options));
            return normalized;
        }
    }

    public List<PersistedMessageSummary> Clear() => Save([]);

    private static DateTimeOffset ParseDate(string value) =>
        DateTimeOffset.TryParse(value, out var parsed) ? parsed : DateTimeOffset.MinValue;
}

internal sealed class AppLogStore
{
    private static readonly JsonSerializerOptions LogJsonOptions = new(ProgramJson.Options) { WriteIndented = false };
    private readonly string _directory = AppPaths.LogsDirectory;
    private readonly string _logPath = Path.Combine(AppPaths.LogsDirectory, "vrcneph.log.jsonl");
    private readonly object _gate = new();

    public AppLogList List(int limit = 300)
    {
        lock (_gate)
        {
            Directory.CreateDirectory(_directory);
            if (!File.Exists(_logPath)) return new AppLogList(_directory, []);
            var entries = ReadEntries()
                .OrderByDescending(x => x.Timestamp)
                .Take(Math.Clamp(limit, 1, 1000))
                .ToList();
            return new AppLogList(_directory, entries);
        }
    }

    public AppLogList Clear()
    {
        lock (_gate)
        {
            Directory.CreateDirectory(_directory);
            File.WriteAllText(_logPath, "");
            return new AppLogList(_directory, []);
        }
    }

    public void Info(string area, string message, string detail = "") => Write("Info", area, message, detail);
    public void Warn(string area, string message, string detail = "") => Write("Warning", area, message, detail);
    public void Error(string area, string message, string detail = "") => Write("Error", area, message, detail);

    private void Write(string level, string area, string message, string detail)
    {
        lock (_gate)
        {
            Directory.CreateDirectory(_directory);
            var entry = new AppLogEntry(DateTimeOffset.Now, level, area, message, detail);
            File.AppendAllText(_logPath, JsonSerializer.Serialize(entry, LogJsonOptions) + Environment.NewLine);
            TrimIfNeeded();
        }
    }

    private void TrimIfNeeded()
    {
        var file = new FileInfo(_logPath);
        if (!file.Exists || file.Length < 1024 * 1024) return;
        var lines = File.ReadLines(_logPath).TakeLast(1000).ToList();
        File.WriteAllLines(_logPath, lines);
    }

    private List<AppLogEntry> ReadEntries()
    {
        try
        {
            return ExtractJsonObjects(File.ReadAllText(_logPath))
                .Select(TryRead)
                .Where(x => x is not null)
                .Cast<AppLogEntry>()
                .ToList();
        }
        catch
        {
            return [];
        }
    }

    private static IEnumerable<string> ExtractJsonObjects(string text)
    {
        var depth = 0;
        var start = -1;
        var inString = false;
        var escaped = false;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (inString)
            {
                if (escaped)
                {
                    escaped = false;
                    continue;
                }
                if (c == '\\')
                {
                    escaped = true;
                    continue;
                }
                if (c == '"') inString = false;
                continue;
            }

            if (c == '"')
            {
                inString = true;
                continue;
            }
            if (c == '{')
            {
                if (depth == 0) start = i;
                depth++;
                continue;
            }
            if (c != '}' || depth <= 0) continue;
            depth--;
            if (depth == 0 && start >= 0)
            {
                yield return text[start..(i + 1)];
                start = -1;
            }
        }
    }

    private static AppLogEntry? TryRead(string value)
    {
        try { return JsonSerializer.Deserialize<AppLogEntry>(value, ProgramJson.Options); }
        catch { return null; }
    }
}

internal sealed class AppDataStore
{
    public static readonly AppDataStore Shared = new();
    private readonly string _path = AppPaths.InternalDatabasePath;
    private readonly object _gate = new();
    private bool _initialized;

    public SyncHealthResult GetSyncHealth()
    {
        lock (_gate)
        {
            EnsureInitialized();
            using var connection = OpenConnection();
            var last = ReadLastSync(connection);
            var pendingActions = CountScalar(connection, "SELECT COUNT(*) FROM sync_actions a WHERE a.id = (SELECT MAX(b.id) FROM sync_actions b WHERE b.action_id = a.action_id) AND a.status IN ('queued', 'running', 'retrying', 'waiting')");
            var failedActions = CountScalar(connection, "SELECT COUNT(*) FROM sync_actions a WHERE a.id = (SELECT MAX(b.id) FROM sync_actions b WHERE b.action_id = a.action_id) AND a.status = 'failed'");
            var openConflicts = CountScalar(connection, "SELECT COUNT(*) FROM sync_conflicts WHERE resolved = 0");
            var recentChanges = CountScalar(connection, "SELECT COUNT(*) FROM avatar_metadata_history WHERE changed_at >= $since", ("$since", DateTimeOffset.UtcNow.AddDays(-1).ToString("O")));
            var totalChanges = CountScalar(connection, "SELECT COUNT(*) FROM avatar_metadata_history");
            return new SyncHealthResult(
                _path,
                last?.Timestamp,
                last?.Succeeded ?? false,
                last?.Summary ?? "",
                last?.Error ?? "",
                pendingActions,
                failedActions,
                openConflicts,
                recentChanges,
                totalChanges);
        }
    }

    public void RecordSyncConflicts(IEnumerable<SyncConflictInput> conflicts)
    {
        var rows = conflicts.Where(x => !string.IsNullOrWhiteSpace(x.Kind) && !string.IsNullOrWhiteSpace(x.GroupId)).ToList();
        lock (_gate)
        {
            EnsureInitialized();
            using var connection = OpenConnection();
            foreach (var conflict in rows)
            {
                using var command = connection.CreateCommand();
                command.CommandText = """
                    INSERT INTO sync_conflicts
                        (detected_at, kind, group_id, group_name, avatar_id, avatar_name, detail, resolved)
                    VALUES
                        ($detectedAt, $kind, $groupId, $groupName, $avatarId, $avatarName, $detail, 0)
                    """;
                command.Parameters.AddWithValue("$detectedAt", DateTimeOffset.UtcNow.ToString("O"));
                command.Parameters.AddWithValue("$kind", conflict.Kind);
                command.Parameters.AddWithValue("$groupId", conflict.GroupId);
                command.Parameters.AddWithValue("$groupName", conflict.GroupName ?? "");
                command.Parameters.AddWithValue("$avatarId", conflict.AvatarId ?? "");
                command.Parameters.AddWithValue("$avatarName", conflict.AvatarName ?? "");
                command.Parameters.AddWithValue("$detail", conflict.Detail ?? "");
                command.ExecuteNonQuery();
            }
        }
    }

    public SyncConflictListResult ListSyncConflicts(int limit = 80)
    {
        lock (_gate)
        {
            EnsureInitialized();
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText = """
                SELECT id, detected_at, kind, group_id, group_name, avatar_id, avatar_name, detail, resolved
                FROM sync_conflicts
                ORDER BY id DESC
                LIMIT $limit
                """;
            command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 300));
            using var reader = command.ExecuteReader();
            var conflicts = new List<SyncConflictRecord>();
            while (reader.Read())
            {
                conflicts.Add(new SyncConflictRecord(
                    reader.GetInt64(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetString(4),
                    reader.GetString(5),
                    reader.GetString(6),
                    reader.GetString(7),
                    reader.GetInt32(8) == 1));
            }
            return new SyncConflictListResult(conflicts);
        }
    }

    public object ResolveSyncConflict(string id)
    {
        if (!long.TryParse(id, out var conflictId)) return new { resolved = false };
        return ResolveSyncConflicts([conflictId]);
    }

    public object ResolveSyncConflicts(IEnumerable<long> ids)
    {
        var conflictIds = ids.Where(x => x > 0).Distinct().ToList();
        if (conflictIds.Count == 0) return new { resolved = 0 };
        lock (_gate)
        {
            EnsureInitialized();
            using var connection = OpenConnection();
            using var transaction = connection.BeginTransaction();
            var resolved = 0;
            foreach (var conflictId in conflictIds)
            {
                using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "UPDATE sync_conflicts SET resolved = 1 WHERE id = $id";
                command.Parameters.AddWithValue("$id", conflictId);
                resolved += command.ExecuteNonQuery();
            }
            transaction.Commit();
            return new { resolved };
        }
    }

    public object RecordSyncAction(SyncActionRecordInput input)
    {
        lock (_gate)
        {
            EnsureInitialized();
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO sync_actions
                    (action_id, timestamp, kind, label, status, attempt, error, payload)
                VALUES
                    ($actionId, $timestamp, $kind, $label, $status, $attempt, $error, $payload)
                """;
            command.Parameters.AddWithValue("$actionId", input.Id?.Trim() ?? "");
            command.Parameters.AddWithValue("$timestamp", DateTimeOffset.UtcNow.ToString("O"));
            command.Parameters.AddWithValue("$kind", input.Kind?.Trim() ?? "");
            command.Parameters.AddWithValue("$label", input.Label?.Trim() ?? "");
            command.Parameters.AddWithValue("$status", input.Status?.Trim() ?? "");
            command.Parameters.AddWithValue("$attempt", input.Attempt);
            command.Parameters.AddWithValue("$error", input.Error?.Trim() ?? "");
            command.Parameters.AddWithValue("$payload", input.Payload?.Trim() ?? "");
            command.ExecuteNonQuery();
            return new { ok = true };
        }
    }

    public SyncActionListResult ListSyncActions(int limit = 80)
    {
        lock (_gate)
        {
            EnsureInitialized();
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText = """
                SELECT a.action_id, a.timestamp, a.kind, a.label, a.status, a.attempt, a.error, a.payload
                FROM sync_actions a
                JOIN (
                    SELECT action_id, MAX(id) AS latest_id
                    FROM sync_actions
                    GROUP BY action_id
                ) latest ON latest.latest_id = a.id
                WHERE a.status <> 'dismissed'
                ORDER BY a.id DESC
                LIMIT $limit
                """;
            command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 300));
            using var reader = command.ExecuteReader();
            var actions = new List<SyncActionRecord>();
            while (reader.Read())
            {
                actions.Add(new SyncActionRecord(
                    reader.GetString(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetString(4),
                    reader.GetInt32(5),
                    reader.GetString(6),
                    reader.GetString(7)));
            }
            return new SyncActionListResult(actions);
        }
    }

    public object DismissSyncAction(string actionId)
    {
        if (string.IsNullOrWhiteSpace(actionId)) return new { dismissed = false };
        lock (_gate)
        {
            EnsureInitialized();
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO sync_actions
                    (action_id, timestamp, kind, label, status, attempt, error, payload)
                SELECT action_id, $timestamp, kind, label, 'dismissed', attempt, '', payload
                FROM sync_actions
                WHERE action_id = $actionId
                ORDER BY id DESC
                LIMIT 1
                """;
            command.Parameters.AddWithValue("$timestamp", DateTimeOffset.UtcNow.ToString("O"));
            command.Parameters.AddWithValue("$actionId", actionId.Trim());
            return new { dismissed = command.ExecuteNonQuery() > 0 };
        }
    }

    public MetadataHistoryListResult ListMetadataHistory(int limit = 120)
    {
        lock (_gate)
        {
            EnsureInitialized();
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText = """
                SELECT changed_at, avatar_id, change_type, old_name, new_name, old_author, new_author, old_status, new_status, old_remote_updated_at, new_remote_updated_at
                FROM avatar_metadata_history
                ORDER BY id DESC
                LIMIT $limit
                """;
            command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 500));
            using var reader = command.ExecuteReader();
            var items = new List<MetadataHistoryRecord>();
            while (reader.Read())
            {
                items.Add(new MetadataHistoryRecord(
                    reader.GetString(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetString(4),
                    reader.GetString(5),
                    reader.GetString(6),
                    reader.GetString(7),
                    reader.GetString(8),
                    reader.GetString(9),
                    reader.GetString(10)));
            }
            return new MetadataHistoryListResult(items);
        }
    }


    public void RecordSyncResult(VrChatSyncResult result, bool succeeded, string error)
    {
        lock (_gate)
        {
            EnsureInitialized();
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO sync_runs
                    (timestamp, succeeded, groups_synced, avatars_synced, moved_to_deleted, updated_avatars, uploaded_avatars, summary, error)
                VALUES
                    ($timestamp, $succeeded, $groupsSynced, $avatarsSynced, $movedToDeleted, $updatedAvatars, $uploadedAvatars, $summary, $error)
                """;
            command.Parameters.AddWithValue("$timestamp", DateTimeOffset.UtcNow.ToString("O"));
            command.Parameters.AddWithValue("$succeeded", succeeded ? 1 : 0);
            command.Parameters.AddWithValue("$groupsSynced", result.GroupsSynced);
            command.Parameters.AddWithValue("$avatarsSynced", result.AvatarsSynced);
            command.Parameters.AddWithValue("$movedToDeleted", result.MovedToDeleted);
            command.Parameters.AddWithValue("$updatedAvatars", result.UpdatedAvatars);
            command.Parameters.AddWithValue("$uploadedAvatars", result.UploadedAvatars);
            command.Parameters.AddWithValue("$summary", $"Groups {result.GroupsSynced}, avatars {result.AvatarsSynced}, updated {result.UpdatedAvatars}, uploaded {result.UploadedAvatars}, deleted/private {result.MovedToDeleted}");
            command.Parameters.AddWithValue("$error", error);
            command.ExecuteNonQuery();
        }
    }

    public void RecordSyncFailure(string error)
    {
        lock (_gate)
        {
            EnsureInitialized();
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO sync_runs
                    (timestamp, succeeded, groups_synced, avatars_synced, moved_to_deleted, updated_avatars, uploaded_avatars, summary, error)
                VALUES
                    ($timestamp, 0, 0, 0, 0, 0, 0, $summary, $error)
                """;
            command.Parameters.AddWithValue("$timestamp", DateTimeOffset.UtcNow.ToString("O"));
            command.Parameters.AddWithValue("$summary", "Favorites sync failed.");
            command.Parameters.AddWithValue("$error", error);
            command.ExecuteNonQuery();
        }
    }

    public void RecordAvatarMetadataChange(AvatarInput before, AvatarInput after, string changeType)
    {
        var avatarId = string.IsNullOrWhiteSpace(after.AvatarId) ? before.AvatarId : after.AvatarId;
        if (string.IsNullOrWhiteSpace(avatarId)) return;
        lock (_gate)
        {
            EnsureInitialized();
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO avatar_metadata_history
                    (changed_at, avatar_id, change_type, old_name, new_name, old_author, new_author, old_status, new_status, old_remote_updated_at, new_remote_updated_at)
                VALUES
                    ($changedAt, $avatarId, $changeType, $oldName, $newName, $oldAuthor, $newAuthor, $oldStatus, $newStatus, $oldRemoteUpdatedAt, $newRemoteUpdatedAt)
                """;
            command.Parameters.AddWithValue("$changedAt", DateTimeOffset.UtcNow.ToString("O"));
            command.Parameters.AddWithValue("$avatarId", avatarId);
            command.Parameters.AddWithValue("$changeType", changeType);
            command.Parameters.AddWithValue("$oldName", before.Name ?? "");
            command.Parameters.AddWithValue("$newName", after.Name ?? "");
            command.Parameters.AddWithValue("$oldAuthor", before.AuthorName ?? "");
            command.Parameters.AddWithValue("$newAuthor", after.AuthorName ?? "");
            command.Parameters.AddWithValue("$oldStatus", before.ReleaseStatus ?? "");
            command.Parameters.AddWithValue("$newStatus", after.ReleaseStatus ?? "");
            command.Parameters.AddWithValue("$oldRemoteUpdatedAt", before.RemoteUpdatedAt ?? "");
            command.Parameters.AddWithValue("$newRemoteUpdatedAt", after.RemoteUpdatedAt ?? "");
            command.ExecuteNonQuery();
        }
    }

    private void EnsureInitialized()
    {
        if (_initialized) return;
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS sync_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                succeeded INTEGER NOT NULL,
                groups_synced INTEGER NOT NULL DEFAULT 0,
                avatars_synced INTEGER NOT NULL DEFAULT 0,
                moved_to_deleted INTEGER NOT NULL DEFAULT 0,
                updated_avatars INTEGER NOT NULL DEFAULT 0,
                uploaded_avatars INTEGER NOT NULL DEFAULT 0,
                summary TEXT NOT NULL DEFAULT '',
                error TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS avatar_metadata_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                changed_at TEXT NOT NULL,
                avatar_id TEXT NOT NULL,
                change_type TEXT NOT NULL,
                old_name TEXT NOT NULL DEFAULT '',
                new_name TEXT NOT NULL DEFAULT '',
                old_author TEXT NOT NULL DEFAULT '',
                new_author TEXT NOT NULL DEFAULT '',
                old_status TEXT NOT NULL DEFAULT '',
                new_status TEXT NOT NULL DEFAULT '',
                old_remote_updated_at TEXT NOT NULL DEFAULT '',
                new_remote_updated_at TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS sync_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT '',
                label TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT '',
                attempt INTEGER NOT NULL DEFAULT 0,
                error TEXT NOT NULL DEFAULT '',
                payload TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS sync_conflicts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                detected_at TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT '',
                group_id TEXT NOT NULL DEFAULT '',
                group_name TEXT NOT NULL DEFAULT '',
                avatar_id TEXT NOT NULL DEFAULT '',
                avatar_name TEXT NOT NULL DEFAULT '',
                detail TEXT NOT NULL DEFAULT '',
                resolved INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_sync_runs_timestamp ON sync_runs(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_avatar_metadata_history_avatar ON avatar_metadata_history(avatar_id, changed_at DESC);
            CREATE INDEX IF NOT EXISTS idx_sync_actions_action ON sync_actions(action_id, timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_sync_conflicts_open ON sync_conflicts(resolved, detected_at DESC);
            """;
        command.ExecuteNonQuery();
        TryEnsureColumn("sync_actions", "payload", "TEXT NOT NULL DEFAULT ''");
        _initialized = true;
    }

    private void TryEnsureColumn(string table, string column, string definition)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = $"ALTER TABLE {table} ADD COLUMN {column} {definition}";
        try
        {
            command.ExecuteNonQuery();
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 1 && ex.Message.Contains("duplicate column", StringComparison.OrdinalIgnoreCase))
        {
        }
    }

    private SqliteConnection OpenConnection()
    {
        var connection = new SqliteConnection($"Data Source={_path}");
        connection.Open();
        return connection;
    }

    private static LastSyncRow? ReadLastSync(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT timestamp, succeeded, summary, error FROM sync_runs ORDER BY id DESC LIMIT 1";
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        return new LastSyncRow(
            reader.GetString(0),
            reader.GetInt32(1) == 1,
            reader.GetString(2),
            reader.GetString(3));
    }

    private static int CountScalar(SqliteConnection connection, string sql, params (string Name, object Value)[] parameters)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var parameter in parameters)
        {
            command.Parameters.AddWithValue(parameter.Name, parameter.Value);
        }
        return Convert.ToInt32(command.ExecuteScalar() ?? 0);
    }

    private sealed record LastSyncRow(string Timestamp, bool Succeeded, string Summary, string Error);
}

internal sealed class BackgroundStore
{
    private readonly string _directory = AppPaths.BackgroundDirectory;
    private static readonly string[] BackgroundExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"];
    public BackgroundResult GetBackground(string groupId = "", string groupName = "")
    {
        CleanupEmptyGroupBackgroundFolders();
        var folder = string.IsNullOrWhiteSpace(groupId)
            ? Folder("")
            : ExistingGroupBackgroundPath(groupId, groupName, migrate: true);
        var paths = string.IsNullOrWhiteSpace(folder) ? [] : BackgroundFiles(folder).ToList();
        var source = string.IsNullOrWhiteSpace(groupId) ? "global" : "group";
        if (paths.Count == 0 && !string.IsNullOrWhiteSpace(groupId))
        {
            folder = Folder("");
            paths = BackgroundFiles(folder).ToList();
            source = "global";
        }
        if (paths.Count == 0) return new BackgroundResult("", folder ?? "", "", "", "", source);
        var path = paths[Random.Shared.Next(paths.Count)];
        var ext = Path.GetExtension(path).ToLowerInvariant();
        var mime = GetMimeType(ext);
        var mediaType = IsVideoExtension(ext) ? "video" : "image";
        return new BackgroundResult($"data:{mime};base64,{Convert.ToBase64String(File.ReadAllBytes(path))}", folder ?? "", mediaType, mime, Path.GetFileName(path), source);
    }
    public string Folder(string groupId = "", string groupName = "")
    {
        var folder = string.IsNullOrWhiteSpace(groupId) ? _directory : GroupBackgroundPath(groupId, groupName, migrate: true);
        Directory.CreateDirectory(folder);
        return folder;
    }
    public BackgroundImportResult Import(string groupId = "", string groupName = "")
    {
        var target = Folder(groupId, groupName);
        var selected = PickBackgroundFiles();
        if (selected.Count == 0) return new BackgroundImportResult(0, 0, target);

        var imported = 0;
        var skipped = 0;
        foreach (var source in selected)
        {
            if (!IsBackgroundMedia(source))
            {
                skipped++;
                continue;
            }
            var targetPath = UniqueFilePath(target, Path.GetFileName(source));
            File.Copy(source, targetPath);
            imported++;
        }
        return new BackgroundImportResult(imported, skipped, target);
    }
    public BackgroundImportResult Clear(string groupId = "", string groupName = "")
    {
        var folder = string.IsNullOrWhiteSpace(groupId)
            ? Folder("")
            : ExistingGroupBackgroundPath(groupId, groupName, migrate: false) ?? DesiredGroupBackgroundPath(groupId, groupName);
        var removed = 0;
        foreach (var file in BackgroundFiles(folder).ToList())
        {
            File.Delete(file);
            removed++;
        }
        if (!string.IsNullOrWhiteSpace(groupId) && Directory.Exists(folder) && !Directory.EnumerateFileSystemEntries(folder).Any())
        {
            Directory.Delete(folder);
        }
        return new BackgroundImportResult(removed, 0, folder);
    }
    public static bool HasGroupBackgroundStatic(string groupId, string groupName = "") => GroupBackgroundPaths(groupId, groupName).Any(path => BackgroundFiles(path).Any());
    public static bool HasGroupBackground(string groupId, string groupName = "") => HasGroupBackgroundStatic(groupId, groupName);
    public static bool MoveGroupBackground(string groupId, string oldGroupName, string newGroupName)
    {
        var source = GroupBackgroundPaths(groupId, oldGroupName).FirstOrDefault(path => BackgroundFiles(path).Any()) ?? GroupBackgroundPath(groupId, oldGroupName, migrate: false);
        if (!BackgroundFiles(source).Any()) return false;
        var target = DesiredGroupBackgroundPath(groupId, newGroupName);
        if (source.Equals(target, StringComparison.OrdinalIgnoreCase)) return true;
        Directory.CreateDirectory(AppPaths.GroupBackgroundDirectory);
        if (Directory.Exists(target))
        {
            CopyFiles(source, target, true);
            Directory.Delete(source, true);
        }
        else
        {
            Directory.Move(source, target);
        }
        return true;
    }
    public static void DeleteGroupBackground(string groupId, string groupName = "")
    {
        foreach (var folder in GroupBackgroundPaths(groupId, groupName).Where(Directory.Exists).Distinct(StringComparer.OrdinalIgnoreCase).ToList())
        {
            Directory.Delete(folder, true);
        }
    }
    public static bool CopyGroupBackground(string sourceGroupId, string targetGroupId, string sourceGroupName = "", string targetGroupName = "")
    {
        var source = GroupBackgroundPath(sourceGroupId, sourceGroupName, migrate: false);
        if (!BackgroundFiles(source).Any()) return false;
        CopyDirectory(source, DesiredGroupBackgroundPath(targetGroupId, targetGroupName), true);
        return true;
    }
    public static void CopyGroupBackgroundToBackup(string groupId, string groupName, string backupJsonPath)
    {
        var source = GroupBackgroundPath(groupId, groupName, migrate: false);
        if (!BackgroundFiles(source).Any()) return;
        CopyDirectory(source, BackupBackgroundPath(backupJsonPath), true);
    }
    public static bool RestoreGroupBackground(string backupJsonPath, string targetGroupId, string targetGroupName = "")
    {
        var source = BackupBackgroundPath(backupJsonPath);
        if (!BackgroundFiles(source).Any()) return false;
        CopyDirectory(source, DesiredGroupBackgroundPath(targetGroupId, targetGroupName), true);
        return true;
    }
    public static bool CopyImportedGroupBackground(string relativeFolder, string targetGroupId, string targetGroupName = "")
    {
        if (string.IsNullOrWhiteSpace(relativeFolder)) return false;
        var source = Path.GetFullPath(Path.Combine(AppPaths.RootDirectory, relativeFolder));
        if (!source.StartsWith(Path.GetFullPath(AppPaths.BackgroundDirectory), StringComparison.OrdinalIgnoreCase)) return false;
        if (!BackgroundFiles(source).Any()) return false;
        CopyDirectory(source, DesiredGroupBackgroundPath(targetGroupId, targetGroupName), true);
        return true;
    }
    private static List<string> PickBackgroundFiles()
    {
        List<string> files = [];
        Exception? error = null;
        var thread = new Thread(() =>
        {
            try
            {
                using var dialog = new OpenFileDialog
                {
                    Title = "Import Backgrounds",
                    Filter = "Background media|*.png;*.jpg;*.jpeg;*.webp;*.gif;*.mp4;*.webm;*.mov;*.m4v;*.avi;*.mkv|All files|*.*",
                    Multiselect = true,
                    CheckFileExists = true
                };
                if (dialog.ShowDialog() == DialogResult.OK) files = dialog.FileNames.Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
            }
            catch (Exception ex)
            {
                error = ex;
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        if (error is not null) throw error;
        return files;
    }
    private static IEnumerable<string> BackgroundFiles(string folder) =>
        !string.IsNullOrWhiteSpace(folder) && Directory.Exists(folder) ? Directory.EnumerateFiles(folder).Where(IsBackgroundMedia) : [];
    private static bool IsBackgroundMedia(string path) => BackgroundExtensions.Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase);
    private static bool IsVideoExtension(string ext) => ext is ".mp4" or ".webm" or ".mov" or ".m4v" or ".avi" or ".mkv";
    private static string? ExistingGroupBackgroundPath(string groupId, string groupName = "", bool migrate = false)
    {
        var existing = GroupBackgroundPaths(groupId, groupName).FirstOrDefault(path => BackgroundFiles(path).Any());
        if (existing is null) return null;
        var desired = DesiredGroupBackgroundPath(groupId, groupName);
        if (!migrate || existing.Equals(desired, StringComparison.OrdinalIgnoreCase)) return existing;
        Directory.CreateDirectory(AppPaths.GroupBackgroundDirectory);
        if (Directory.Exists(desired))
        {
            CopyFiles(existing, desired, true);
            if (!Directory.EnumerateFileSystemEntries(existing).Any()) Directory.Delete(existing, true);
        }
        else
        {
            Directory.Move(existing, desired);
        }
        return desired;
    }
    private static string GroupBackgroundPath(string groupId, string groupName = "", bool migrate = false)
    {
        var existingWithMedia = ExistingGroupBackgroundPath(groupId, groupName, migrate);
        if (!string.IsNullOrWhiteSpace(existingWithMedia)) return existingWithMedia;
        var paths = GroupBackgroundPaths(groupId, groupName).ToList();
        var existing = paths.FirstOrDefault(Directory.Exists);
        var desired = DesiredGroupBackgroundPath(groupId, groupName);
        if (migrate && existing is not null && !existing.Equals(desired, StringComparison.OrdinalIgnoreCase))
        {
            Directory.CreateDirectory(AppPaths.GroupBackgroundDirectory);
            if (Directory.Exists(desired))
            {
                CopyFiles(existing, desired, true);
                Directory.Delete(existing, true);
            }
            else
            {
                Directory.Move(existing, desired);
            }
            return desired;
        }
        return existing ?? desired;
    }
    private static IEnumerable<string> GroupBackgroundPaths(string groupId, string groupName = "")
    {
        if (string.IsNullOrWhiteSpace(groupId)) yield break;
        var safeId = SafePathSegment(groupId);
        var desired = DesiredGroupBackgroundPath(groupId, groupName);
        yield return desired;
        yield return Path.Combine(AppPaths.GroupBackgroundDirectory, safeId);
        if (!Directory.Exists(AppPaths.GroupBackgroundDirectory)) yield break;
        foreach (var folder in Directory.EnumerateDirectories(AppPaths.GroupBackgroundDirectory))
        {
            var name = Path.GetFileName(folder);
            if (name.Equals(safeId, StringComparison.OrdinalIgnoreCase) || name.EndsWith($" - {safeId}", StringComparison.OrdinalIgnoreCase))
            {
                yield return folder;
            }
        }
    }
    private static string DesiredGroupBackgroundPath(string groupId, string groupName = "") =>
        Path.Combine(AppPaths.GroupBackgroundDirectory, $"{SafePathSegment(string.IsNullOrWhiteSpace(groupName) ? "Group" : groupName)} - {SafePathSegment(groupId)}");
    private static void CleanupEmptyGroupBackgroundFolders()
    {
        if (!Directory.Exists(AppPaths.GroupBackgroundDirectory)) return;
        foreach (var folder in Directory.EnumerateDirectories(AppPaths.GroupBackgroundDirectory).ToList())
        {
            if (!Directory.Exists(folder)) continue;
            if (!Directory.EnumerateFileSystemEntries(folder).Any()) Directory.Delete(folder, true);
        }
    }
    private static string BackupBackgroundPath(string backupJsonPath) => Path.Combine(Path.GetDirectoryName(backupJsonPath)!, $"{Path.GetFileNameWithoutExtension(backupJsonPath)}.background");
    private static string UniqueFilePath(string folder, string fileName)
    {
        var name = Path.GetFileNameWithoutExtension(fileName);
        var extension = Path.GetExtension(fileName);
        var target = Path.Combine(folder, fileName);
        for (var i = 2; File.Exists(target); i++) target = Path.Combine(folder, $"{name} {i}{extension}");
        return target;
    }
    private static void CopyDirectory(string source, string target, bool overwrite)
    {
        if (Directory.Exists(target)) Directory.Delete(target, true);
        Directory.CreateDirectory(target);
        CopyFiles(source, target, overwrite);
    }
    private static void CopyFiles(string source, string target, bool overwrite)
    {
        Directory.CreateDirectory(target);
        foreach (var file in BackgroundFiles(source))
        {
            File.Copy(file, Path.Combine(target, Path.GetFileName(file)), overwrite);
        }
    }
    private static string SafePathSegment(string value)
    {
        var safe = string.Join("_", value.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries)).Trim();
        return string.IsNullOrWhiteSpace(safe) ? "group" : safe;
    }
    private static string GetMimeType(string ext) => ext switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        ".mp4" or ".m4v" => "video/mp4",
        ".webm" => "video/webm",
        ".mov" => "video/quicktime",
        ".avi" => "video/x-msvideo",
        ".mkv" => "video/x-matroska",
        _ => "image/png"
    };
}

internal static class VrChatLogWatcher
{
    private static readonly string LogDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        "AppData",
        "LocalLow",
        "VRChat",
        "VRChat");
    private static readonly System.Text.RegularExpressions.Regex AvatarIdRegex = new(@"avtr_[0-9a-fA-F-]{36}", System.Text.RegularExpressions.RegexOptions.Compiled);
    private static readonly System.Text.RegularExpressions.Regex JoinedPlayerRegex = new(@"\[Behaviour\]\s+OnPlayerJoined\s+(.+?)\s+\((usr_[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12})\)", System.Text.RegularExpressions.RegexOptions.Compiled);
    private static readonly System.Text.RegularExpressions.Regex LeftPlayerRegex = new(@"\[Behaviour\]\s+OnPlayerLeft\s+(.+?)\s+\((usr_[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12})\)", System.Text.RegularExpressions.RegexOptions.Compiled);

    public static VrChatLogAvatarResult LatestAvatarForUser(string displayName)
    {
        displayName = displayName?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(displayName)) return new VrChatLogAvatarResult(false, "", "", "", "", "No VRChat display name is available.");
        var log = LatestLogPath();
        if (string.IsNullOrWhiteSpace(log)) return new VrChatLogAvatarResult(false, "", "", "", "", "No VRChat log file was found.");
        var lines = ReadTailLines(log, 1800);
        var latestName = "";
        var latestId = "";
        var latestTime = "";
        var waitingForAvatarId = false;
        var remainingSearchLines = 0;
        foreach (var line in lines)
        {
            var switchIndex = line.IndexOf($"[Behaviour] Switching {displayName} to avatar ", StringComparison.OrdinalIgnoreCase);
            if (switchIndex >= 0)
            {
                latestName = line[(switchIndex + $"[Behaviour] Switching {displayName} to avatar ".Length)..].Trim();
                latestTime = line.Length >= 19 ? line[..19] : "";
                latestId = "";
                waitingForAvatarId = true;
                remainingSearchLines = 40;
                continue;
            }

            if (!waitingForAvatarId) continue;
            if (remainingSearchLines-- <= 0)
            {
                waitingForAvatarId = false;
                continue;
            }
            var match = AvatarIdRegex.Match(line);
            if (!match.Success || !line.Contains("Loading Avatar Data:", StringComparison.OrdinalIgnoreCase)) continue;
            latestId = match.Value;
            waitingForAvatarId = false;
        }

        if (string.IsNullOrWhiteSpace(latestId)) return new VrChatLogAvatarResult(false, "", latestName, log, latestTime, "No recent avatar switch was found in the VRChat log.");
        return new VrChatLogAvatarResult(true, latestId, latestName, log, latestTime, "");
    }

    public static DiagnosticItem Diagnostic()
    {
        var log = LatestLogPath();
        if (string.IsNullOrWhiteSpace(log)) return new DiagnosticItem("VRChat Log Watcher", "Not found", "No VRChat output log was found.", "warning");
        return new DiagnosticItem("VRChat Log Watcher", "Active", $"{Path.GetFileName(log)} - {File.GetLastWriteTime(log):g}", "ok");
    }
    public static EncounterHistoryResult EncounterHistory(EncounterHistoryInput input)
    {
        var userId = input.UserId?.Trim() ?? "";
        var displayName = input.DisplayName?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(userId) && string.IsNullOrWhiteSpace(displayName)) return new EncounterHistoryResult([]);
        if (!Directory.Exists(LogDirectory)) return new EncounterHistoryResult([]);
        var files = Directory.EnumerateFiles(LogDirectory, "output_log*.txt", SearchOption.TopDirectoryOnly)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .Take(40)
            .Reverse()
            .ToList();
        var items = new List<EncounterHistoryItem>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in files)
        {
            var room = "";
            var location = "";
            foreach (var line in ReadTailLines(file, 6000))
            {
                var timestamp = line.Length >= 19 ? line[..19] : "";
                var entering = line.IndexOf("[Behaviour] Entering Room:", StringComparison.OrdinalIgnoreCase);
                if (entering >= 0) room = line[(entering + "[Behaviour] Entering Room:".Length)..].Trim();
                var joining = line.IndexOf("[Behaviour] Joining ", StringComparison.OrdinalIgnoreCase);
                if (joining >= 0 && !line.Contains("Joining or Creating Room:", StringComparison.OrdinalIgnoreCase)) location = line[(joining + "[Behaviour] Joining ".Length)..].Trim();

                var match = JoinedPlayerRegex.Match(line);
                var action = "Joined";
                if (!match.Success)
                {
                    match = LeftPlayerRegex.Match(line);
                    action = "Left";
                }
                if (!match.Success) continue;
                var name = match.Groups[1].Value.Trim();
                var id = match.Groups[2].Value.Trim();
                var idMatches = !string.IsNullOrWhiteSpace(userId) && id.Equals(userId, StringComparison.OrdinalIgnoreCase);
                var nameMatches = !string.IsNullOrWhiteSpace(displayName) && name.Equals(displayName, StringComparison.OrdinalIgnoreCase);
                if (!idMatches && !nameMatches) continue;
                var key = $"{timestamp}|{id}|{room}|{location}|{action}";
                if (!seen.Add(key)) continue;
                items.Add(new EncounterHistoryItem(timestamp, action, name, id, room, location, Path.GetFileName(file)));
            }
        }
        return new EncounterHistoryResult(items.OrderByDescending(x => x.Timestamp).Take(25).ToList());
    }
    public static PlayerActivityLogResult PlayerActivityLog(PlayerActivityLogInput input)
    {
        if (!Directory.Exists(LogDirectory)) return new PlayerActivityLogResult([]);
        var limit = Math.Clamp(input.Limit <= 0 ? 250 : input.Limit, 1, 1000);
        var files = Directory.EnumerateFiles(LogDirectory, "output_log*.txt", SearchOption.TopDirectoryOnly)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .Take(60)
            .Reverse()
            .ToList();
        var items = new List<PlayerActivityLogItem>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in files)
        {
            var room = "";
            var location = "";
            foreach (var line in ReadTailLines(file, 9000))
            {
                var timestamp = line.Length >= 19 ? line[..19] : "";
                var entering = line.IndexOf("[Behaviour] Entering Room:", StringComparison.OrdinalIgnoreCase);
                if (entering >= 0) room = line[(entering + "[Behaviour] Entering Room:".Length)..].Trim();
                var joining = line.IndexOf("[Behaviour] Joining ", StringComparison.OrdinalIgnoreCase);
                if (joining >= 0 && !line.Contains("Joining or Creating Room:", StringComparison.OrdinalIgnoreCase)) location = line[(joining + "[Behaviour] Joining ".Length)..].Trim();

                var match = JoinedPlayerRegex.Match(line);
                var action = "Player joined";
                if (!match.Success)
                {
                    match = LeftPlayerRegex.Match(line);
                    action = "Player left";
                }
                if (!match.Success) continue;
                var name = match.Groups[1].Value.Trim();
                var id = match.Groups[2].Value.Trim();
                var key = $"{timestamp}|{action}|{id}|{room}|{location}";
                if (!seen.Add(key)) continue;
                items.Add(new PlayerActivityLogItem(timestamp, action, name, id, room, location, WorldIdFromLocation(location), Path.GetFileName(file)));
            }
        }
        return new PlayerActivityLogResult(items.OrderByDescending(x => x.Timestamp).Take(limit).ToList());
    }
    public static LatestWorldLocationResult LatestWorldLocation()
    {
        if (!IsVrChatRunning()) return new LatestWorldLocationResult(false, "", "", "", "", "VRChat is not running.");
        var log = LatestLogPath();
        if (string.IsNullOrWhiteSpace(log)) return new LatestWorldLocationResult(false, "", "", "", "", "No VRChat log found.");
        var room = "";
        var location = "";
        var timestamp = "";
        foreach (var line in ReadTailLines(log, 2500))
        {
            var lineTime = line.Length >= 19 ? line[..19] : "";
            var entering = line.IndexOf("[Behaviour] Entering Room:", StringComparison.OrdinalIgnoreCase);
            if (entering >= 0)
            {
                room = line[(entering + "[Behaviour] Entering Room:".Length)..].Trim();
                if (!string.IsNullOrWhiteSpace(lineTime)) timestamp = lineTime;
            }
            var joining = line.IndexOf("[Behaviour] Joining ", StringComparison.OrdinalIgnoreCase);
            if (joining >= 0 && !line.Contains("Joining or Creating Room:", StringComparison.OrdinalIgnoreCase))
            {
                location = line[(joining + "[Behaviour] Joining ".Length)..].Trim();
                if (!string.IsNullOrWhiteSpace(lineTime)) timestamp = lineTime;
            }
            if ((line.Contains("OnLeftRoom", StringComparison.OrdinalIgnoreCase) || line.Contains("Left Room", StringComparison.OrdinalIgnoreCase)) && !string.IsNullOrWhiteSpace(lineTime))
            {
                timestamp = lineTime;
            }
        }
        var worldId = WorldIdFromLocation(location);
        var found = !string.IsNullOrWhiteSpace(room) || !string.IsNullOrWhiteSpace(worldId) || !string.IsNullOrWhiteSpace(location);
        return new LatestWorldLocationResult(found, room, location, worldId, timestamp, found ? "" : "No recent world location found in the VRChat log.");
    }
    private static string WorldIdFromLocation(string location)
    {
        var value = location?.Trim() ?? "";
        if (!value.StartsWith("wrld_", StringComparison.OrdinalIgnoreCase)) return "";
        var colon = value.IndexOf(':');
        return colon > 0 ? value[..colon] : value;
    }
    public static bool IsVrChatRunning()
    {
        try { return Process.GetProcessesByName("VRChat").Any(); }
        catch { return false; }
    }
    public static WorldVisitHistoryResult WorldVisitHistory(WorldVisitHistoryInput input)
    {
        var worldId = input.WorldId?.Trim() ?? "";
        var instanceId = input.InstanceId?.Trim() ?? "";
        var targetLocation = input.Location?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(worldId) && targetLocation.StartsWith("wrld_", StringComparison.OrdinalIgnoreCase))
        {
            var colon = targetLocation.IndexOf(':');
            worldId = colon > 0 ? targetLocation[..colon] : targetLocation;
        }
        if (string.IsNullOrWhiteSpace(instanceId) && targetLocation.Contains(':'))
        {
            instanceId = targetLocation[(targetLocation.IndexOf(':') + 1)..];
        }
        if (string.IsNullOrWhiteSpace(worldId) && string.IsNullOrWhiteSpace(instanceId)) return new WorldVisitHistoryResult([]);
        if (!Directory.Exists(LogDirectory)) return new WorldVisitHistoryResult([]);

        var files = Directory.EnumerateFiles(LogDirectory, "output_log*.txt", SearchOption.TopDirectoryOnly)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .Take(50)
            .Reverse()
            .ToList();
        var items = new List<WorldVisitHistoryItem>();
        var currentLocation = "";
        var room = "";
        foreach (var file in files)
        {
            foreach (var line in ReadTailLines(file, 7000))
            {
                var timestamp = line.Length >= 19 ? line[..19] : "";
                var entering = line.IndexOf("[Behaviour] Entering Room:", StringComparison.OrdinalIgnoreCase);
                if (entering >= 0) room = line[(entering + "[Behaviour] Entering Room:".Length)..].Trim();
                var joining = line.IndexOf("[Behaviour] Joining ", StringComparison.OrdinalIgnoreCase);
                if (joining >= 0 && !line.Contains("Joining or Creating Room:", StringComparison.OrdinalIgnoreCase))
                {
                    currentLocation = line[(joining + "[Behaviour] Joining ".Length)..].Trim();
                    if (LocationMatches(currentLocation, worldId, instanceId))
                    {
                        items.Add(new WorldVisitHistoryItem(timestamp, "Joined", room, currentLocation, Path.GetFileName(file)));
                    }
                }
                if ((line.Contains("OnLeftRoom", StringComparison.OrdinalIgnoreCase) || line.Contains("Left Room", StringComparison.OrdinalIgnoreCase)) && LocationMatches(currentLocation, worldId, instanceId))
                {
                    items.Add(new WorldVisitHistoryItem(timestamp, "Left", room, currentLocation, Path.GetFileName(file)));
                }
            }
        }
        return new WorldVisitHistoryResult(items.OrderByDescending(x => x.Timestamp).Take(20).ToList());
    }
    private static bool LocationMatches(string location, string worldId, string instanceId)
    {
        if (string.IsNullOrWhiteSpace(location)) return false;
        if (!string.IsNullOrWhiteSpace(instanceId) && location.Contains(instanceId, StringComparison.OrdinalIgnoreCase)) return true;
        return !string.IsNullOrWhiteSpace(worldId) && location.StartsWith(worldId, StringComparison.OrdinalIgnoreCase);
    }

    private static string LatestLogPath()
    {
        if (!Directory.Exists(LogDirectory)) return "";
        return Directory.EnumerateFiles(LogDirectory, "output_log*.txt", SearchOption.TopDirectoryOnly)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault() ?? "";
    }

    private static List<string> ReadTailLines(string path, int maxLines)
    {
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var start = Math.Max(0, stream.Length - 1024 * 1024);
            stream.Position = start;
            using var reader = new StreamReader(stream, Encoding.UTF8, true);
            if (start > 0) reader.ReadLine();
            var lines = new Queue<string>();
            while (reader.ReadLine() is { } line)
            {
                lines.Enqueue(line);
                while (lines.Count > maxLines) lines.Dequeue();
            }
            return lines.ToList();
        }
        catch
        {
            return [];
        }
    }
}

internal static class Diagnostics
{
    public static async Task<DiagnosticsResult> GetAsync(VrChatClient vrchat, AvatarDatabaseClient database, AppUpdateClient updater)
    {
        var items = new List<DiagnosticItem>();
        var session = await vrchat.GetSessionAsync();
        items.Add(session.IsLoggedIn && session.User is not null
            ? new DiagnosticItem("VRChat Login", "Signed in", session.User.DisplayName, "ok")
            : new DiagnosticItem("VRChat Login", session.RequiresTwoFactor ? "Two-factor required" : "Signed out", "VRChat API features need login.", "warning"));
        items.Add(VrChatLogWatcher.Diagnostic());

        var vrcx = database.GetVrcxStatus();
        items.Add(vrcx.HasLocalDatabase
            ? new DiagnosticItem("VRCX Database", "Found", vrcx.Path, "ok")
            : new DiagnosticItem("VRCX Database", "Missing", "Remote VRCX-compatible search will be used.", "warning"));

        try
        {
            var pas = await database.GetPasUpdateStatusAsync();
            var status = pas.HasUpdate ? "Update available" : pas.HasLocalFile ? "Ready" : "Not cached";
            var level = pas.HasUpdate ? "warning" : pas.HasLocalFile ? "ok" : "warning";
            items.Add(new DiagnosticItem("Prismic PAS", status, pas.Message, level));
        }
        catch (Exception ex)
        {
            items.Add(new DiagnosticItem("Prismic PAS", "Check failed", ex.Message, "error"));
        }

        try
        {
            var update = await updater.CheckAsync();
            items.Add(update.UpdateAvailable
                ? new DiagnosticItem("GitHub Updater", "Update available", $"{update.CurrentVersion} -> {update.LatestVersion}", "warning")
                : new DiagnosticItem("GitHub Updater", "Ready", $"Current version {update.CurrentVersion}", "ok"));
        }
        catch (Exception ex)
        {
            items.Add(new DiagnosticItem("GitHub Updater", "Check failed", ex.Message, "error"));
        }

        items.Add(new DiagnosticItem("AVTRZIP", "On demand", "Checked during database searches.", "info"));
        return new DiagnosticsResult(items);
    }
}

internal sealed class VrChatPipelineClient
{
    private static readonly Uri PipelineUriBase = new("wss://pipeline.vrchat.cloud/");
    private readonly VrChatClient _vrchat;
    private readonly Func<VrChatPipelineEvent, Task> _onEvent;
    private readonly Func<VrChatPipelineStatus, Task> _onStatus;
    private readonly object _gate = new();
    private CancellationTokenSource? _cts;
    private Task? _worker;
    private bool _connected;
    private string _state = "Stopped";
    private int _eventsReceived;
    private string _lastEventType = "";
    private string _lastReceivedAt = "";
    private int _reconnectAttempts;
    private string _lastError = "";

    public VrChatPipelineClient(VrChatClient vrchat, Func<VrChatPipelineEvent, Task> onEvent, Func<VrChatPipelineStatus, Task> onStatus)
    {
        _vrchat = vrchat;
        _onEvent = onEvent;
        _onStatus = onStatus;
    }

    public async Task<VrChatPipelineStatus> StartAsync()
    {
        lock (_gate)
        {
            if (_worker is { IsCompleted: false }) return Status();
            _cts = new CancellationTokenSource();
            _state = "Connecting";
            _worker = Task.Run(() => RunAsync(_cts.Token));
        }
        await Task.Delay(50);
        return Status();
    }

    public void Stop()
    {
        VrChatPipelineStatus status;
        lock (_gate)
        {
            _cts?.Cancel();
            _cts = null;
            _connected = false;
            _state = "Stopped";
            status = CurrentStatusLocked();
        }
        _ = _onStatus(status);
    }

    public VrChatPipelineStatus Status()
    {
        lock (_gate) return CurrentStatusLocked();
    }

    private async Task RunAsync(CancellationToken token)
    {
        var delay = TimeSpan.FromSeconds(2);
        while (!token.IsCancellationRequested)
        {
            try
            {
                await SetStateAsync(false, "Connecting");
                var auth = await _vrchat.GetPipelineTokenAsync();
                var uri = new Uri($"{PipelineUriBase}?auth={auth.Trim()}");
                using var socket = new ClientWebSocket();
                ConfigurePipelineSocket(socket);
                await socket.ConnectAsync(uri, token);
                lock (_gate)
                {
                    _reconnectAttempts = 0;
                    _lastError = "";
                }
                await SetStateAsync(true, "Connected");
                delay = TimeSpan.FromSeconds(2);
                await ReceiveLoopAsync(socket, token);
                if (!token.IsCancellationRequested)
                {
                    lock (_gate)
                    {
                        _connected = false;
                        _reconnectAttempts++;
                        _lastError = "Pipeline closed";
                    }
                    await SetStateAsync(false, "Reconnecting: pipeline closed");
                    try { await Task.Delay(delay, token); } catch { break; }
                    delay = TimeSpan.FromSeconds(Math.Min(60, delay.TotalSeconds * 1.7));
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                lock (_gate)
                {
                    _connected = false;
                    _reconnectAttempts++;
                    _lastError = ex.Message;
                }
                await SetStateAsync(false, $"Reconnecting: {ex.Message}");
                try { await Task.Delay(delay, token); } catch { break; }
                delay = TimeSpan.FromSeconds(Math.Min(60, delay.TotalSeconds * 1.7));
            }
        }
        await SetStateAsync(false, "Stopped");
    }

    private async Task ReceiveLoopAsync(ClientWebSocket socket, CancellationToken token)
    {
        var buffer = new byte[64 * 1024];
        while (socket.State == WebSocketState.Open && !token.IsCancellationRequested)
        {
            using var ms = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, token);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    try { await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", token); } catch { }
                    return;
                }
                ms.Write(buffer, 0, result.Count);
            } while (!result.EndOfMessage);

            var text = Encoding.UTF8.GetString(ms.ToArray());
            var evt = ParseEvent(text);
            if (evt is null) continue;
            lock (_gate)
            {
                _eventsReceived++;
                _lastEventType = evt.Type;
                _lastReceivedAt = evt.ReceivedAt;
            }
            await _onEvent(evt);
        }
    }

    private static void ConfigurePipelineSocket(ClientWebSocket socket)
    {
        TrySetHeader(socket, "Origin", "https://vrchat.com");
        TrySetHeader(socket, "User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) VRCNeph/1.0");
        TrySetHeader(socket, "Pragma", "no-cache");
        TrySetHeader(socket, "Cache-Control", "no-cache");
        TrySetHeader(socket, "Accept-Language", "en-US,en;q=0.9");
        socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
    }

    private static void TrySetHeader(ClientWebSocket socket, string name, string value)
    {
        try { socket.Options.SetRequestHeader(name, value); }
        catch { }
    }

    private static VrChatPipelineEvent? ParseEvent(string text)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
            var type = ReadString(doc.RootElement, "type") ?? "";
            if (string.IsNullOrWhiteSpace(type)) return null;
            JsonElement content;
            if (doc.RootElement.TryGetProperty("content", out var rawContent))
            {
                if (rawContent.ValueKind == JsonValueKind.String)
                {
                    var contentText = rawContent.GetString() ?? "{}";
                    using var contentDoc = JsonDocument.Parse(string.IsNullOrWhiteSpace(contentText) ? "{}" : contentText);
                    content = contentDoc.RootElement.Clone();
                }
                else
                {
                    content = rawContent.Clone();
                }
            }
            else
            {
                content = doc.RootElement.Clone();
            }
            return new VrChatPipelineEvent(type, content, DateTimeOffset.UtcNow.ToString("O"));
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private async Task SetStateAsync(bool connected, string state)
    {
        VrChatPipelineStatus status;
        lock (_gate)
        {
            _connected = connected;
            _state = state;
            status = CurrentStatusLocked();
        }
        await _onStatus(status);
    }

    private VrChatPipelineStatus CurrentStatusLocked() => new(_connected, _state, _eventsReceived, _lastEventType, _lastReceivedAt, _reconnectAttempts, _lastError);

    private static string? ReadString(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

internal sealed class VrChatClient
{
    private const int DefaultAvatarFavoriteGroupLimit = 1;
    private const int DefaultWorldFavoriteGroupLimit = 4;
    private static readonly Uri ApiBase = new("https://api.vrchat.cloud/api/1/");
    private readonly CookieContainer _cookies = new();
    private readonly HttpClient _client;
    private readonly string _sessionPath = AppPaths.SessionPath;
    private readonly VrChatRateLimitGate _favoriteRateLimitGate = new();
    public VrChatClient()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_sessionPath)!);
        LoadCookies();
        _client = new HttpClient(new HttpClientHandler { CookieContainer = _cookies, UseCookies = true, AutomaticDecompression = DecompressionMethods.All }) { BaseAddress = ApiBase, Timeout = TimeSpan.FromSeconds(45) };
        _client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("VRCNeph", "1.0"));
    }
    public bool HasSavedSession => File.Exists(_sessionPath);
    public async Task<string> GetPipelineTokenAsync()
    {
        using var response = await _client.GetAsync("auth");
        var json = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"VRChat pipeline token returned {(int)response.StatusCode}.");
        using var doc = JsonDocument.Parse(json);
        var token = ReadString(doc.RootElement, "token") ?? ReadString(doc.RootElement, "authToken") ?? "";
        if (string.IsNullOrWhiteSpace(token)) throw new InvalidOperationException("VRChat did not return a pipeline token.");
        return token;
    }
    public async Task<VrChatSessionState> GetSessionAsync()
    {
        try { var user = await GetCurrentUserAsync(); return new(true, false, [], user); }
        catch { return new(false, false, [], null); }
    }
    public async Task<VrChatSessionState> LoginAsync(LoginInput input)
    {
        var token = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{input.Username}:{input.Password}"));
        using var request = new HttpRequestMessage(HttpMethod.Get, "auth/user");
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", token);
        using var response = await _client.SendAsync(request);
        var json = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"VRChat login returned {(int)response.StatusCode}.");
        SaveCookies();
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.TryGetProperty("requiresTwoFactorAuth", out var methods) && methods.ValueKind == JsonValueKind.Array) return new(false, true, methods.EnumerateArray().Select(x => x.GetString() ?? "totp").ToArray(), null);
        return new(true, false, [], ReadUser(doc.RootElement));
    }
    public async Task<VrChatSessionState> TwoFactorAsync(TwoFactorInput input)
    {
        var path = input.Method == "emailOtp" ? "auth/twofactorauth/emailotp/verify" : "auth/twofactorauth/totp/verify";
        using var response = await _client.PostAsync(path, new StringContent(JsonSerializer.Serialize(new { code = input.Code }), Encoding.UTF8, "application/json"));
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"VRChat two-factor returned {(int)response.StatusCode}.");
        SaveCookies();
        return await GetSessionAsync();
    }
    public VrChatSessionState Logout()
    {
        foreach (Cookie cookie in _cookies.GetCookies(ApiBase)) cookie.Expired = true;
        if (File.Exists(_sessionPath)) File.Delete(_sessionPath);
        return new(false, false, [], null);
    }
    public async Task<VrChatSessionState> UpdateCurrentUserAsync(VrChatProfileUpdateInput input)
    {
        var current = await GetCurrentUserAsync();
        if (string.IsNullOrWhiteSpace(current.Id)) throw new InvalidOperationException("Not signed in.");
        var status = CleanProfileStatus(input.Status, current.Status);
        var statusDescription = (input.StatusDescription ?? "").Trim();
        var bio = (input.Bio ?? "").Trim();
        var pronouns = (input.Pronouns ?? "").Trim();
        if (pronouns.Length > 32) pronouns = pronouns[..32];
        var bioLinks = (input.BioLinks ?? "").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(10)
            .ToArray();
        var payload = new Dictionary<string, object?>
        {
            ["status"] = status,
            ["statusDescription"] = statusDescription,
            ["bio"] = bio,
            ["pronouns"] = pronouns,
            ["bioLinks"] = bioLinks
        };
        using var response = await _client.PutAsync($"users/{WebUtility.UrlEncode(current.Id)}", new StringContent(JsonSerializer.Serialize(payload, ProgramJson.Options), Encoding.UTF8, "application/json"));
        await ReadActionResponseAsync(response, "Update profile failed.");
        return await GetSessionAsync();
    }
    public async Task<AvatarInput> FetchAvatarAsync(string id)
    {
        id = id.Trim();
        using var response = await _client.GetAsync($"avatars/{WebUtility.UrlEncode(id)}");
        var json = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
        {
            if (response.StatusCode == HttpStatusCode.NotFound || json.Contains("not found", StringComparison.OrdinalIgnoreCase))
            {
                return new AvatarInput
                {
                    AvatarId = id,
                    Name = "",
                    ReleaseStatus = "deleted",
                    SourceUrl = $"https://vrchat.com/home/avatar/{id}",
                    Source = "vrchat-deleted",
                    RawJson = json
                };
            }

            if (response.StatusCode == HttpStatusCode.Forbidden || json.Contains("private", StringComparison.OrdinalIgnoreCase))
            {
                return new AvatarInput
                {
                    AvatarId = id,
                    Name = "",
                    ReleaseStatus = "private",
                    SourceUrl = $"https://vrchat.com/home/avatar/{id}",
                    Source = "vrchat-private",
                    RawJson = json
                };
            }

            throw new InvalidOperationException($"VRChat returned {(int)response.StatusCode}.");
        }
        using var doc = JsonDocument.Parse(json);
        return await EnrichAvatarAuthorAsync(ReadAvatar(doc.RootElement));
    }
    public async Task<AvatarInput> CurrentAvatarAsync()
    {
        var user = await GetCurrentUserAsync();
        if (string.IsNullOrWhiteSpace(user.CurrentAvatarId)) throw new InvalidOperationException("No current avatar is available.");
        return await FetchAvatarAsync(user.CurrentAvatarId);
    }
    public async Task<AvatarInput> GetUserCurrentAvatarAsync(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("User not found.");
        using var response = await _client.GetAsync($"users/{WebUtility.UrlEncode(id.Trim())}/avatar");
        var json = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
        {
            if (response.StatusCode == HttpStatusCode.Forbidden || response.StatusCode == HttpStatusCode.NotFound)
            {
                return new AvatarInput
                {
                    Name = "",
                    Description = response.StatusCode == HttpStatusCode.NotFound
                        ? "VRChat no longer exposes this user's current avatar."
                        : "VRChat did not allow current avatar details to be fetched.",
                    ReleaseStatus = response.StatusCode == HttpStatusCode.NotFound ? "deleted" : "private",
                    Source = "vrchat-unavailable",
                    RawJson = json
                };
            }
            throw new InvalidOperationException($"VRChat user avatar returned {(int)response.StatusCode}.");
        }
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Object) throw new InvalidOperationException("VRChat returned an unexpected user avatar response.");
        return await EnrichAvatarAuthorAsync(ReadAvatar(doc.RootElement));
    }
    private async Task<AvatarInput> EnrichAvatarAuthorAsync(AvatarInput avatar)
    {
        var authorId = avatar.AuthorId?.Trim() ?? "";
        var authorName = avatar.AuthorName?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(authorId) && authorName.StartsWith("usr_", StringComparison.OrdinalIgnoreCase))
        {
            authorId = authorName;
            avatar.AuthorId = authorId;
            avatar.AuthorName = "";
        }
        if (!authorName.Equals(authorId, StringComparison.OrdinalIgnoreCase) && !authorName.StartsWith("usr_", StringComparison.OrdinalIgnoreCase)) return avatar;
        if (string.IsNullOrWhiteSpace(authorId)) return avatar;
        try
        {
            using var response = await _client.GetAsync($"users/{WebUtility.UrlEncode(authorId)}");
            if (!response.IsSuccessStatusCode) return avatar;
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var displayName = ReadString(doc.RootElement, "displayName") ?? "";
            if (!string.IsNullOrWhiteSpace(displayName)) avatar.AuthorName = displayName;
        }
        catch { }
        return avatar;
    }
    public async Task<VrChatCurrentLocationResult> GetCurrentLocationAsync()
    {
        if (!VrChatLogWatcher.IsVrChatRunning()) return new VrChatCurrentLocationResult("", "", "", null);
        var user = await GetCurrentUserAsync();
        var location = user.Location ?? "";
        var worldId = user.WorldId;
        if (string.IsNullOrWhiteSpace(worldId) && location.StartsWith("wrld_", StringComparison.OrdinalIgnoreCase))
        {
            var colon = location.IndexOf(':');
            worldId = colon > 0 ? location[..colon] : location;
        }

        VrChatWorldSummary? world = null;
        if (!string.IsNullOrWhiteSpace(worldId))
        {
            try { world = await GetWorldAsync(worldId); } catch { }
        }

        return new VrChatCurrentLocationResult(location, worldId ?? "", user.InstanceId ?? "", world);
    }
    public async Task<VrChatFriendListResult> GetFriendsAsync(PageInput input)
    {
        var limit = Math.Clamp(input.Limit <= 0 ? 100 : input.Limit, 1, 100);
        var offset = Math.Max(0, input.Offset);
        var friends = new List<VrChatFriendSummary>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var offline in new[] { false, true })
        {
            var localOffset = offset;
            while (true)
            {
                using var response = await _client.GetAsync($"auth/user/friends?n={limit}&offset={localOffset}&offline={offline.ToString().ToLowerInvariant()}");
                var json = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"VRChat friends returned {(int)response.StatusCode}.");
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
                if (doc.RootElement.ValueKind != JsonValueKind.Array) break;
                var count = doc.RootElement.GetArrayLength();
                if (count == 0) break;
                foreach (var item in doc.RootElement.EnumerateArray())
                {
                    var friend = ReadFriend(item, !offline);
                    if (!string.IsNullOrWhiteSpace(friend.Id) && seen.Add(friend.Id)) friends.Add(friend);
                }
                if (count < limit) break;
                localOffset += count;
            }
        }
        friends = friends
            .OrderByDescending(x => !string.IsNullOrWhiteSpace(x.Location) && !x.Location.Equals("offline", StringComparison.OrdinalIgnoreCase))
            .ThenBy(x => x.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();
        return new VrChatFriendListResult(friends, false);
    }
    public async Task<VrChatFriendSummary> GetFriendAsync(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("Friend not found.");
        using var response = await _client.GetAsync($"users/{WebUtility.UrlEncode(id)}");
        var json = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"VRChat user details returned {(int)response.StatusCode}.");
        using var doc = JsonDocument.Parse(json);
        var friend = ReadFriend(doc.RootElement);
        return friend with { RawJson = JsonSerializer.Serialize(doc.RootElement, ProgramJson.Options) };
    }
    public async Task<VrChatFriendListResult> GetFavoriteFriendsAsync(PageInput input)
    {
        var limit = Math.Clamp(input.Limit <= 0 ? 100 : input.Limit, 1, 100);
        var offset = Math.Max(0, input.Offset);
        var friends = new List<VrChatFriendSummary>();
        using var response = await _client.GetAsync($"favorites?type=friend&n={limit}&offset={offset}");
        var json = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"VRChat favorite friends returned {(int)response.StatusCode}.");
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
        if (doc.RootElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                var id = ReadString(item, "favoriteId") ?? "";
                if (!id.StartsWith("usr_", StringComparison.OrdinalIgnoreCase)) continue;
                var tags = ReadStringArray(item, "tags");
                try
                {
                    var friend = await GetFriendAsync(id);
                    friends.Add(friend with { FavoriteTags = tags, IsFriend = true });
                }
                catch
                {
                    friends.Add(new VrChatFriendSummary(id, id, "", "", "", "", "", IsFriend: true, FavoriteTags: tags, RawJson: JsonSerializer.Serialize(item, ProgramJson.Options)));
                }
            }
        }
        return new VrChatFriendListResult(friends, friends.Count == limit);
    }
    public async Task<VrChatUserGroupsResult> GetUserGroupsAsync(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("User not found.");
        using var response = await _client.GetAsync($"users/{WebUtility.UrlEncode(id)}/groups");
        var json = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode) return new VrChatUserGroupsResult([]);
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
        var groups = new List<VrChatUserGroupSummary>();
        if (doc.RootElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                var nested = item.TryGetProperty("group", out var groupElement) && groupElement.ValueKind == JsonValueKind.Object ? groupElement : default;
                var hasNested = nested.ValueKind == JsonValueKind.Object;
                groups.Add(new VrChatUserGroupSummary(
                    ReadString(item, "groupId") ?? (hasNested ? ReadString(nested, "id") ?? ReadString(nested, "groupId") : null) ?? ReadString(item, "id") ?? "",
                    (hasNested ? ReadString(nested, "name") ?? ReadString(nested, "groupName") : null) ?? ReadString(item, "name") ?? ReadString(item, "groupName") ?? "",
                    (hasNested ? ReadFullGroupShortCode(nested) : "") is { Length: > 0 } nestedShortCode ? nestedShortCode : ReadFullGroupShortCode(item),
                    (hasNested ? ReadString(nested, "memberCount") ?? ReadValueString(nested, "memberCount") : null) ?? ReadString(item, "memberCount") ?? ReadValueString(item, "memberCount"),
                    (hasNested ? ReadString(nested, "description") : null) ?? ReadString(item, "description") ?? "",
                    (hasNested ? ReadString(nested, "iconUrl") ?? ReadString(nested, "bannerUrl") : null) ?? ReadString(item, "iconUrl") ?? ReadString(item, "bannerUrl") ?? ""));
            }
        }
        return new VrChatUserGroupsResult(groups.Where(x => !string.IsNullOrWhiteSpace(x.Id) || !string.IsNullOrWhiteSpace(x.Name)).ToList());
    }
    public async Task<VrChatGroupDetail> GetGroupDetailAsync(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("Group not found.");
        id = id.Trim();
        using var response = await _client.GetAsync($"groups/{WebUtility.UrlEncode(id)}");
        var json = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
        {
            var searched = await TryFindGroupDetailByQueryAsync(id);
            if (searched is not null) return searched;
            throw new InvalidOperationException($"VRChat group returned {(int)response.StatusCode}.");
        }
        return ReadGroupDetailJson(json, id);
    }
    private async Task<VrChatGroupDetail?> TryFindGroupDetailByQueryAsync(string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return null;
        using var response = await _client.GetAsync($"groups?query={WebUtility.UrlEncode(query)}&n=20&offset=0");
        var json = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode) return null;
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return null;
        var normalized = query.Trim().TrimStart('#');
        JsonElement? selected = null;
        foreach (var item in doc.RootElement.EnumerateArray())
        {
            var id = ReadString(item, "id") ?? ReadString(item, "groupId") ?? "";
            var shortCode = ReadFullGroupShortCode(item);
            var name = ReadString(item, "name") ?? "";
            if (id.Equals(normalized, StringComparison.OrdinalIgnoreCase) ||
                shortCode.Equals(normalized, StringComparison.OrdinalIgnoreCase) ||
                name.Equals(normalized, StringComparison.OrdinalIgnoreCase))
            {
                selected = item;
                break;
            }
            selected ??= item;
        }
        if (selected is not JsonElement match) return null;
        var matchedId = ReadString(match, "id") ?? ReadString(match, "groupId") ?? "";
        if (matchedId.StartsWith("grp_", StringComparison.OrdinalIgnoreCase))
        {
            using var detailResponse = await _client.GetAsync($"groups/{WebUtility.UrlEncode(matchedId)}");
            var detailJson = await detailResponse.Content.ReadAsStringAsync();
            if (detailResponse.IsSuccessStatusCode) return ReadGroupDetailJson(detailJson, matchedId);
        }
        return ReadGroupDetailElement(match, matchedId);
    }
    private static VrChatGroupDetail ReadGroupDetailJson(string json, string fallbackId)
    {
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json);
        return ReadGroupDetailElement(doc.RootElement, fallbackId, json);
    }
    private static VrChatGroupDetail ReadGroupDetailElement(JsonElement root, string fallbackId, string? rawJson = null)
    {
        return new VrChatGroupDetail(
            ReadString(root, "id") ?? ReadString(root, "groupId") ?? fallbackId,
            ReadString(root, "name") ?? "",
            ReadFullGroupShortCode(root),
            ReadString(root, "memberCount") ?? ReadValueString(root, "memberCount"),
            ReadString(root, "description") ?? "",
            ReadString(root, "iconUrl") ?? "",
            ReadString(root, "bannerUrl") ?? "",
            ReadString(root, "ownerId") ?? "",
            ReadString(root, "ownerDisplayName") ?? ReadString(root, "ownerName") ?? ReadString(root, "authorName") ?? "",
            ReadString(root, "privacy") ?? "",
            ReadString(root, "joinState") ?? "",
            ReadString(root, "created_at") ?? ReadString(root, "createdAt") ?? "",
            rawJson ?? JsonSerializer.Serialize(root, ProgramJson.Options));
    }
    public async Task<VrChatGroupMembersResult> GetGroupMembersAsync(string id)
    {
        id = id.Trim();
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("Group not found.");
        var members = new List<VrChatGroupMemberSummary>();
        var limit = 100;
        var offset = 0;
        while (members.Count < 500)
        {
            using var response = await _client.GetAsync($"groups/{WebUtility.UrlEncode(id)}/members?n={limit}&offset={offset}");
            var json = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
            {
                if (members.Count > 0) break;
                throw new InvalidOperationException($"VRChat group members returned {(int)response.StatusCode}.");
            }
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) break;
            var count = doc.RootElement.GetArrayLength();
            if (count == 0) break;
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                var user = item.TryGetProperty("user", out var userElement) && userElement.ValueKind == JsonValueKind.Object ? userElement : default;
                var hasUser = user.ValueKind == JsonValueKind.Object;
                members.Add(new VrChatGroupMemberSummary(
                    ReadString(item, "userId") ?? (hasUser ? ReadString(user, "id") : null) ?? ReadString(item, "id") ?? "",
                    ReadString(item, "displayName") ?? ReadString(item, "name") ?? (hasUser ? ReadString(user, "displayName") : null) ?? "",
                    ReadString(item, "roleName") ?? ReadStringArray(item, "roleNames") ?? ReadStringArray(item, "roleIds"),
                    ReadString(item, "membershipStatus") ?? ReadString(item, "status") ?? "",
                    ReadString(item, "joinedAt") ?? ReadString(item, "created_at") ?? ReadString(item, "createdAt") ?? "",
                    ReadString(item, "iconUrl") ?? ReadString(item, "imageUrl") ?? (hasUser ? ReadProfileImage(user) : null) ?? "",
                    JsonSerializer.Serialize(item, ProgramJson.Options)));
            }
            if (count < limit) break;
            offset += count;
        }
        return new VrChatGroupMembersResult(members);
    }
    public async Task<AvatarListResult> GetUserUploadedAvatarsAsync(string id)
    {
        id = id.Trim();
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("User not found.");
        var owner = id.Equals("me", StringComparison.OrdinalIgnoreCase) ? "me" : id;
        string[] paths = owner.Equals("me", StringComparison.OrdinalIgnoreCase)
            ? ["avatars?user=me"]
            :
            [
                $"avatars?userId={WebUtility.UrlEncode(owner)}",
                $"avatars?authorId={WebUtility.UrlEncode(owner)}",
                $"avatars?user={WebUtility.UrlEncode(owner)}"
            ];
        return new AvatarListResult(await ReadPagedAvatarsFromFirstWorkingPathAsync(paths, "VRChat user uploaded avatars"));
    }
    public async Task<VrChatWorldSearchResult> GetUserWorldsAsync(string id)
    {
        id = id.Trim();
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("User not found.");
        var owner = id.Equals("me", StringComparison.OrdinalIgnoreCase) ? "me" : id;
        string[] paths = owner.Equals("me", StringComparison.OrdinalIgnoreCase)
            ? ["worlds?user=me", "worlds?userId=me"]
            :
            [
                $"worlds?userId={WebUtility.UrlEncode(owner)}",
                $"worlds?authorId={WebUtility.UrlEncode(owner)}",
                $"worlds?user={WebUtility.UrlEncode(owner)}"
            ];
        return new VrChatWorldSearchResult(await ReadPagedWorldsFromFirstWorkingPathAsync(paths, "VRChat user worlds"), false);
    }
    public async Task<VrChatFriendListResult> GetMutualFriendsAsync(string id)
    {
        id = id.Trim();
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("User not found.");
        var paths = new[]
        {
            $"users/{WebUtility.UrlEncode(id)}/mutuals/friends",
            $"users/{WebUtility.UrlEncode(id)}/friends",
            $"users/{WebUtility.UrlEncode(id)}/friends?mutual=true",
            $"users/{WebUtility.UrlEncode(id)}/mutualFriends"
        };
        return new VrChatFriendListResult(await ReadPagedFriendsFromFirstWorkingPathAsync(paths, "VRChat mutual friends"), false);
    }
    public async Task<object> SendFriendRequestAsync(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("User not found.");
        using var response = await _client.PostAsync($"user/{WebUtility.UrlEncode(id)}/friendRequest", null);
        return await ReadActionResponseAsync(response, "Friend request failed.");
    }
    public async Task<object> UnfriendAsync(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("User not found.");
        using var response = await _client.DeleteAsync($"auth/user/friends/{WebUtility.UrlEncode(id)}");
        return await ReadActionResponseAsync(response, "Unfriend failed.");
    }
    public async Task<object> ModerateUserAsync(string id, string type)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("User not found.");
        var payload = JsonSerializer.Serialize(new { moderated = id, type });
        using var response = await _client.PostAsync("auth/user/playermoderations", new StringContent(payload, Encoding.UTF8, "application/json"));
        return await ReadActionResponseAsync(response, "Moderation failed.");
    }
    public async Task<object> UnmoderateUserAsync(string id, string type)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("User not found.");
        var payload = JsonSerializer.Serialize(new { moderated = id, type });
        using var response = await _client.PutAsync("auth/user/unplayermoderate", new StringContent(payload, Encoding.UTF8, "application/json"));
        return await ReadActionResponseAsync(response, "Unmoderation failed.");
    }
    public async Task<InviteMessageListResult> GetInviteMessagesAsync(string type)
    {
        var user = await GetCurrentUserAsync();
        var messageType = CleanInviteMessageType(type);
        using var response = await _client.GetAsync($"message/{WebUtility.UrlEncode(user.Id)}/{WebUtility.UrlEncode(messageType)}");
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"Invite messages returned {(int)response.StatusCode}.");
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var messages = new List<InviteMessageSummary>();
        if (doc.RootElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                messages.Add(new InviteMessageSummary(
                    ReadInt(item, "slot"),
                    ReadString(item, "message") ?? "",
                    ReadString(item, "messageType") ?? messageType,
                    ReadBool(item, "canBeUpdated"),
                    ReadInt(item, "remainingCooldownMinutes")));
            }
        }
        return new InviteMessageListResult(messages.OrderBy(x => x.Slot).ToList());
    }
    public async Task<object> UpdateInviteMessageAsync(InviteMessageUpdateInput input)
    {
        var user = await GetCurrentUserAsync();
        var messageType = CleanInviteMessageType(input.Type);
        var slot = Math.Clamp(input.Slot, 0, 11);
        var message = (input.Message ?? "").Trim();
        if (message.Length > 64) message = message[..64];
        var payload = JsonSerializer.Serialize(new { message });
        using var response = await _client.PutAsync($"message/{WebUtility.UrlEncode(user.Id)}/{WebUtility.UrlEncode(messageType)}/{slot}", new StringContent(payload, Encoding.UTF8, "application/json"));
        await ReadActionResponseAsync(response, "Update invite message failed.");
        return new { type = messageType, slot, message };
    }
    public async Task<object> InviteUserAsync(InviteUserInput input)
    {
        if (string.IsNullOrWhiteSpace(input.UserId)) throw new InvalidOperationException("User not found.");
        var instanceId = input.InstanceId?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(instanceId))
        {
            var location = (await GetCurrentLocationAsync()).Location;
            var colon = location.IndexOf(':');
            instanceId = colon >= 0 ? location[(colon + 1)..] : "";
        }
        if (string.IsNullOrWhiteSpace(instanceId) || instanceId.Equals("offline", StringComparison.OrdinalIgnoreCase) || instanceId.Equals("private", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("You need to be in a joinable instance to invite someone.");
        }
        var payload = JsonSerializer.Serialize(new { instanceId, messageSlot = input.MessageSlot });
        using var response = await _client.PostAsync($"invite/{WebUtility.UrlEncode(input.UserId)}", new StringContent(payload, Encoding.UTF8, "application/json"));
        return await ReadActionResponseAsync(response, "Invite failed.");
    }
    public async Task<object> RequestInviteAsync(RequestInviteInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Id)) throw new InvalidOperationException("User not found.");
        var payload = JsonSerializer.Serialize(new { requestSlot = input.MessageSlot });
        using var response = await _client.PostAsync($"requestInvite/{WebUtility.UrlEncode(input.Id)}", new StringContent(payload, Encoding.UTF8, "application/json"));
        return await ReadActionResponseAsync(response, "Request invite failed.");
    }
    public async Task<ChatMessageResult> SendChatMessageAsync(ChatMessageInput input)
    {
        var userId = input.UserId?.Trim() ?? "";
        var message = input.Message?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(userId)) throw new InvalidOperationException("User not found.");
        if (string.IsNullOrWhiteSpace(message)) throw new InvalidOperationException("Type a message first.");
        if (message.Length > 64) message = message[..64];

        var mode = (input.Mode ?? "auto").Trim().ToLowerInvariant();
        var canInvite = false;
        var instanceId = "";
        try
        {
            var location = (await GetCurrentLocationAsync()).Location;
            var colon = location.IndexOf(':');
            instanceId = colon >= 0 ? location[(colon + 1)..] : "";
            canInvite = !string.IsNullOrWhiteSpace(instanceId)
                && !instanceId.Equals("offline", StringComparison.OrdinalIgnoreCase)
                && !instanceId.Equals("private", StringComparison.OrdinalIgnoreCase);
        }
        catch { }
        var messageType = mode == "request" || (!canInvite && mode != "invite") ? "request" : "message";
        var slot = await UpdateFirstAvailableInviteMessageAsync(messageType, message);
        if (messageType == "message")
        {
            await InviteUserAsync(new InviteUserInput(userId, instanceId, slot));
            return new ChatMessageResult(userId, message, "invite", slot);
        }
        await RequestInviteAsync(new RequestInviteInput(userId, slot));
        return new ChatMessageResult(userId, message, "request", slot);
    }
    private async Task<int> UpdateFirstAvailableInviteMessageAsync(string messageType, string message)
    {
        var user = await GetCurrentUserAsync();
        var messages = await GetInviteMessagesAsync(messageType);
        var slot = messages.Messages
            .Where(x => x.CanBeUpdated && x.RemainingCooldownMinutes <= 0)
            .OrderByDescending(x => x.Slot)
            .FirstOrDefault();
        if (slot is null) throw new InvalidOperationException("No editable VRChat message slot is ready yet. VRChat puts edited message slots on cooldown.");
        var payload = JsonSerializer.Serialize(new { message });
        using var response = await _client.PutAsync($"message/{WebUtility.UrlEncode(user.Id)}/{WebUtility.UrlEncode(messageType)}/{slot.Slot}", new StringContent(payload, Encoding.UTF8, "application/json"));
        await ReadActionResponseAsync(response, "Update invite message failed.");
        return slot.Slot;
    }
    public async Task<VrChatNotificationListResult> GetNotificationsAsync(PageInput input)
    {
        var limit = Math.Clamp(input.Limit <= 0 ? 100 : input.Limit, 1, 100);
        var offset = Math.Max(0, input.Offset);
        using var response = await _client.GetAsync($"auth/user/notifications?n={limit}&offset={offset}");
        var json = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"VRChat notifications returned {(int)response.StatusCode}.");
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
        var notifications = new List<VrChatNotificationSummary>();
        if (doc.RootElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in doc.RootElement.EnumerateArray()) notifications.Add(ReadNotification(item));
        }
        return new VrChatNotificationListResult(notifications, notifications.Count == limit);
    }
    public async Task<object> AcceptFriendRequestAsync(string notificationId)
    {
        if (string.IsNullOrWhiteSpace(notificationId)) throw new InvalidOperationException("Friend request notification not found.");
        using var response = await _client.PutAsync($"auth/user/notifications/{WebUtility.UrlEncode(notificationId)}/accept", null);
        return await ReadActionResponseAsync(response, "Accept friend request failed.");
    }
    public async Task<object> DeleteNotificationAsync(string notificationId)
    {
        if (string.IsNullOrWhiteSpace(notificationId)) throw new InvalidOperationException("Notification not found.");
        using var response = await _client.PutAsync($"auth/user/notifications/{WebUtility.UrlEncode(notificationId)}/hide", null);
        var json = await response.Content.ReadAsStringAsync();
        if (response.IsSuccessStatusCode) return ParseActionResponse(json);

        using var deleteResponse = await _client.DeleteAsync($"auth/user/notifications/{WebUtility.UrlEncode(notificationId)}");
        var deleteJson = await deleteResponse.Content.ReadAsStringAsync();
        if (deleteResponse.IsSuccessStatusCode || deleteResponse.StatusCode == HttpStatusCode.NotFound) return ParseActionResponse(deleteJson);

        var message = TryReadErrorMessage(deleteJson);
        if (string.IsNullOrWhiteSpace(message)) message = TryReadErrorMessage(json);
        throw new InvalidOperationException(string.IsNullOrWhiteSpace(message) ? $"Decline notification failed. VRChat returned {(int)deleteResponse.StatusCode}." : message);
    }
    private static string CleanInviteMessageType(string? type)
    {
        var value = (type ?? "").Trim();
        return value is "message" or "response" or "request" or "requestResponse" ? value : "message";
    }
    public async Task<VrChatWorldSearchResult> SearchWorldsAsync(WorldSearchInput input)
    {
        var query = (input.Query ?? "").Trim();
        var limit = Math.Clamp(input.Limit <= 0 ? 50 : input.Limit, 1, 100);
        var offset = Math.Max(0, input.Offset);
        var mode = (input.Mode ?? "").Trim().ToLowerInvariant();
        var pathBase = mode switch
        {
            "active" => "worlds/active",
            "recent" => "worlds/recent",
            "favorites" => "worlds/favorites",
            _ => "worlds"
        };
        var sort = string.IsNullOrWhiteSpace(input.Sort) ? "popularity" : input.Sort.Trim();
        var order = string.IsNullOrWhiteSpace(input.Order) ? "descending" : input.Order.Trim();
        var parameters = new List<string>
        {
            "featured=false",
            $"sort={WebUtility.UrlEncode(sort)}",
            $"order={WebUtility.UrlEncode(order)}",
            $"n={limit}",
            $"offset={offset}"
        };
        if (!string.IsNullOrWhiteSpace(query)) parameters.Add($"search={WebUtility.UrlEncode(query)}");
        if (!string.IsNullOrWhiteSpace(input.ReleaseStatus)) parameters.Add($"releaseStatus={WebUtility.UrlEncode(input.ReleaseStatus.Trim())}");
        var path = $"{pathBase}?{string.Join("&", parameters)}";
        using var response = await _client.GetAsync(path);
        var json = await response.Content.ReadAsStringAsync();
        if (response.StatusCode == HttpStatusCode.Forbidden)
        {
            await Task.Delay(650);
            using var retry = await _client.GetAsync(path);
            json = await retry.Content.ReadAsStringAsync();
            if (retry.StatusCode == HttpStatusCode.Forbidden) return new VrChatWorldSearchResult([], false);
            if (!retry.IsSuccessStatusCode) throw new InvalidOperationException($"VRChat worlds returned {(int)retry.StatusCode}.");
        }
        else if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"VRChat worlds returned {(int)response.StatusCode}.");
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
        var worlds = new List<VrChatWorldSummary>();
        if (doc.RootElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                worlds.Add(ReadWorld(item));
            }
        }
        return new VrChatWorldSearchResult(worlds, worlds.Count == limit);
    }
    public async Task<VrChatWorldSearchResult> GetFavoriteWorldsAsync(PageInput input)
    {
        var limit = Math.Clamp(input.Limit <= 0 ? 100 : input.Limit, 1, 100);
        var offset = Math.Max(0, input.Offset);
        var worlds = new List<VrChatWorldSummary>();
        while (true)
        {
            using var response = await _client.GetAsync($"favorites?type=world&n={limit}&offset={offset}");
            var json = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"VRChat favorite worlds returned {(int)response.StatusCode}.");
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) break;
            var count = doc.RootElement.GetArrayLength();
            if (count == 0) break;
            var favorites = doc.RootElement.EnumerateArray()
                .Select(item => new
                {
                    Id = ReadString(item, "favoriteId") ?? "",
                    Tags = ReadStringArray(item, "tags"),
                    RawJson = JsonSerializer.Serialize(item, ProgramJson.Options)
                })
                .Where(item => item.Id.StartsWith("wrld_", StringComparison.OrdinalIgnoreCase))
                .ToList();
            using var gate = new SemaphoreSlim(8);
            var tasks = favorites.Select(async favorite =>
            {
                await gate.WaitAsync();
                try
                {
                    var world = await GetWorldAsync(favorite.Id);
                    return world with { FavoriteTags = favorite.Tags };
                }
                catch
                {
                    return new VrChatWorldSummary(favorite.Id, favorite.Id, "", "", "", 0, 0, "", FavoriteTags: favorite.Tags, RawJson: favorite.RawJson);
                }
                finally
                {
                    gate.Release();
                }
            });
            worlds.AddRange(await Task.WhenAll(tasks));
            if (count < limit) break;
            offset += count;
            if (input.Offset > 0) break;
        }
        return new VrChatWorldSearchResult(worlds, input.Offset > 0 && worlds.Count == limit);
    }
    public async Task<VrChatFavoriteGroupsResult> GetFavoriteWorldGroupsAsync(PageInput input)
    {
        var limit = Math.Clamp(input.Limit <= 0 ? 100 : input.Limit, 1, 100);
        var startOffset = Math.Max(0, input.Offset);
        var currentUser = await GetCurrentUserAsync();
        var groupLimit = HasSupporterTag(currentUser)
            ? await GetFavoriteGroupLimitAsync("world", DefaultWorldFavoriteGroupLimit)
            : DefaultWorldFavoriteGroupLimit;
        var groups = new List<VrChatFavoriteGroupSummary>();
        var offset = startOffset;
        while (true)
        {
            var owner = string.IsNullOrWhiteSpace(currentUser.Id) ? "" : $"&ownerId={WebUtility.UrlEncode(currentUser.Id)}";
            using var response = await _client.GetAsync($"favorite/groups?n={limit}&offset={offset}{owner}");
            var json = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"VRChat favorite groups returned {(int)response.StatusCode}.");
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) break;
            var count = doc.RootElement.GetArrayLength();
            if (count == 0) break;
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                var type = ReadString(item, "type") ?? "";
                var name = ReadString(item, "name") ?? "";
                if (!type.Contains("world", StringComparison.OrdinalIgnoreCase) && !name.StartsWith("worlds", StringComparison.OrdinalIgnoreCase)) continue;
                groups.Add(new VrChatFavoriteGroupSummary(
                    ReadString(item, "id") ?? "",
                    name,
                    ReadString(item, "displayName") ?? ReadString(item, "name") ?? "Favorite Worlds",
                    type,
                    ReadString(item, "visibility") ?? "",
                    JsonSerializer.Serialize(item, ProgramJson.Options)));
            }
            if (count < limit) break;
            offset += count;
            if (input.Offset > 0) break;
        }
        return new VrChatFavoriteGroupsResult(groups, input.Offset > 0 && groups.Count == limit, groupLimit);
    }
    public async Task<object> AddFavoriteWorldAsync(WorldFavoriteInput input)
    {
        var worldId = input.Id?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(worldId)) throw new InvalidOperationException("World not found.");
        var tag = input.Tag?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(tag))
        {
            var group = (await GetFavoriteWorldGroupsAsync(new PageInput(100, 0))).Groups.FirstOrDefault();
            tag = !string.IsNullOrWhiteSpace(group?.Name) ? group.Name : "worlds1";
        }
        var payload = JsonSerializer.Serialize(new { type = "world", favoriteId = worldId, tags = new[] { tag } });
        using var response = await SendFavoriteRequestWithRateLimitRetryAsync(() => new HttpRequestMessage(HttpMethod.Post, "favorites") { Content = new StringContent(payload, Encoding.UTF8, "application/json") });
        if (!response.IsSuccessStatusCode && response.StatusCode != HttpStatusCode.Conflict) throw new InvalidOperationException($"VRChat favorite world returned {(int)response.StatusCode}.");
        return new { worldId, tag };
    }
    public async Task<object> RemoveFavoriteWorldAsync(string worldId)
    {
        if (string.IsNullOrWhiteSpace(worldId)) throw new InvalidOperationException("World not found.");
        using var response = await SendFavoriteRequestWithRateLimitRetryAsync(() => new HttpRequestMessage(HttpMethod.Get, $"favorites?type=world&n=100&offset=0"));
        var json = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"VRChat favorite worlds returned {(int)response.StatusCode}.");
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
        var favoriteId = "";
        if (doc.RootElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if ((ReadString(item, "favoriteId") ?? "").Equals(worldId, StringComparison.OrdinalIgnoreCase))
                {
                    favoriteId = ReadString(item, "id") ?? "";
                    break;
                }
            }
        }
        if (string.IsNullOrWhiteSpace(favoriteId)) return new { skipped = true, worldId };
        using var deleteResponse = await SendFavoriteRequestWithRateLimitRetryAsync(() => new HttpRequestMessage(HttpMethod.Delete, $"favorites/{WebUtility.UrlEncode(favoriteId)}"));
        if (!deleteResponse.IsSuccessStatusCode && deleteResponse.StatusCode != HttpStatusCode.NotFound) throw new InvalidOperationException($"VRChat unfavorite world returned {(int)deleteResponse.StatusCode}.");
        return new { worldId };
    }
    public async Task<VrChatWorldSummary> GetWorldDetailAsync(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("World not found.");
        return await GetWorldAsync(id);
    }
    public async Task<object> OpenWorldAsync(WorldLaunchInput input)
    {
        var target = !string.IsNullOrWhiteSpace(input.Location)
            ? input.Location.Trim()
            : !string.IsNullOrWhiteSpace(input.InstanceId)
                ? $"{input.WorldId.Trim()}:{input.InstanceId.Trim()}"
                : input.WorldId.Trim();
        if (string.IsNullOrWhiteSpace(target)) throw new InvalidOperationException("World instance not found.");

        var instanceId = ParseInstanceId(target, input.WorldId);
        var currentUser = await GetCurrentUserAsync();
        if (string.IsNullOrWhiteSpace(currentUser.Id)) throw new InvalidOperationException("VRChat user not found.");
        if (string.IsNullOrWhiteSpace(instanceId)) throw new InvalidOperationException("Choose a specific instance to join.");

        var payload = JsonSerializer.Serialize(new { instanceId, messageSlot = 0 });
        using var response = await _client.PostAsync($"invite/{WebUtility.UrlEncode(currentUser.Id)}", new StringContent(payload, Encoding.UTF8, "application/json"));
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            var message = TryReadErrorMessage(body);
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(message) ? $"World invite returned {(int)response.StatusCode}." : message);
        }
        return new { ok = true, target, instanceId, method = "self-invite" };
    }
    public async Task<List<AvatarInput>> GetUploadedAvatarsAsync()
    {
        return (await GetUserUploadedAvatarsAsync("me")).Avatars;
    }
    private async Task<List<AvatarInput>> ReadPagedAvatarsFromFirstWorkingPathAsync(IEnumerable<string> pathBases, string label)
    {
        foreach (var pathBase in pathBases)
        {
            var avatars = new List<AvatarInput>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var offset = 0;
            const int pageSize = 100;
            var worked = false;
            while (true)
            {
                var separator = pathBase.Contains('?') ? "&" : "?";
                using var response = await _client.GetAsync($"{pathBase}{separator}n={pageSize}&offset={offset}&sort=updated&order=descending");
                var json = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode)
                {
                    if (!worked && IsEndpointProbeFailure(response.StatusCode)) break;
                    throw new InvalidOperationException($"{label} returned {(int)response.StatusCode}.");
                }
                worked = true;
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
                if (doc.RootElement.ValueKind != JsonValueKind.Array) break;
                var count = doc.RootElement.GetArrayLength();
                if (count == 0) break;
                foreach (var item in doc.RootElement.EnumerateArray())
                {
                    var avatar = ReadAvatar(item);
                    if (!string.IsNullOrWhiteSpace(avatar.AvatarId) && seen.Add(avatar.AvatarId) && !IsUnavailableAvatarStatus(avatar.ReleaseStatus))
                    {
                        avatar.Source = "vrchat-uploaded";
                        avatars.Add(avatar);
                    }
                }
                if (count < pageSize) break;
                offset += count;
            }
            if (worked) return avatars;
        }
        return [];
    }
    private async Task<List<VrChatWorldSummary>> ReadPagedWorldsFromFirstWorkingPathAsync(IEnumerable<string> pathBases, string label)
    {
        foreach (var pathBase in pathBases)
        {
            var worlds = new List<VrChatWorldSummary>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var offset = 0;
            const int pageSize = 100;
            var worked = false;
            while (true)
            {
                var separator = pathBase.Contains('?') ? "&" : "?";
                using var response = await _client.GetAsync($"{pathBase}{separator}n={pageSize}&offset={offset}&sort=updated&order=descending");
                var json = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode)
                {
                    if (!worked && IsEndpointProbeFailure(response.StatusCode)) break;
                    throw new InvalidOperationException($"{label} returned {(int)response.StatusCode}.");
                }
                worked = true;
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
                if (doc.RootElement.ValueKind != JsonValueKind.Array) break;
                var count = doc.RootElement.GetArrayLength();
                if (count == 0) break;
                foreach (var item in doc.RootElement.EnumerateArray())
                {
                    var world = ReadWorld(item);
                    if (!string.IsNullOrWhiteSpace(world.Id) && seen.Add(world.Id)) worlds.Add(world);
                }
                if (count < pageSize) break;
                offset += count;
            }
            if (worked) return worlds;
        }
        return [];
    }
    private async Task<List<VrChatFriendSummary>> ReadPagedFriendsFromFirstWorkingPathAsync(IEnumerable<string> pathBases, string label)
    {
        foreach (var pathBase in pathBases)
        {
            var friends = new List<VrChatFriendSummary>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var offset = 0;
            const int pageSize = 100;
            var worked = false;
            while (true)
            {
                var separator = pathBase.Contains('?') ? "&" : "?";
                using var response = await _client.GetAsync($"{pathBase}{separator}n={pageSize}&offset={offset}");
                var json = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode)
                {
                    if (!worked && IsEndpointProbeFailure(response.StatusCode)) break;
                    throw new InvalidOperationException($"{label} returned {(int)response.StatusCode}.");
                }
                worked = true;
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
                if (doc.RootElement.ValueKind != JsonValueKind.Array) break;
                var count = doc.RootElement.GetArrayLength();
                if (count == 0) break;
                foreach (var item in doc.RootElement.EnumerateArray())
                {
                    var friend = ReadFriend(item);
                    if (!string.IsNullOrWhiteSpace(friend.Id) && seen.Add(friend.Id)) friends.Add(friend);
                }
                if (count < pageSize) break;
                offset += count;
            }
            if (worked) return friends;
        }
        return [];
    }
    private static bool IsEndpointProbeFailure(HttpStatusCode status) =>
        status is HttpStatusCode.BadRequest or HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.NotFound;
    public async Task<object> SelectAvatarAsync(string id)
    {
        using var response = await _client.PutAsync($"avatars/{WebUtility.UrlEncode(id)}/select", null);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            if (response.StatusCode == HttpStatusCode.NotFound || body.Contains("not found", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("That avatar appears to be deleted or unavailable.");
            }

            if (response.StatusCode == HttpStatusCode.Forbidden || body.Contains("private", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("That avatar is private or unavailable.");
            }

            throw new InvalidOperationException("VRChat could not equip that avatar.");
        }
        return new { id };
    }
    public async Task<object> AddFavoriteAvatarAsync(VrChatFavoriteChangeInput input)
    {
        var tag = SyncTagFromGroupId(input.GroupId);
        if (string.IsNullOrWhiteSpace(input.AvatarId) || string.IsNullOrWhiteSpace(tag)) return new { skipped = true };
        var payload = JsonSerializer.Serialize(new { type = "avatar", favoriteId = input.AvatarId, tags = new[] { tag } });
        using var response = await SendFavoriteRequestWithRateLimitRetryAsync(() => new HttpRequestMessage(HttpMethod.Post, "favorites") { Content = new StringContent(payload, Encoding.UTF8, "application/json") });
        if (!response.IsSuccessStatusCode && response.StatusCode != HttpStatusCode.Conflict) throw new InvalidOperationException($"VRChat favorite add returned {(int)response.StatusCode}.");
        _favoriteRateLimitGate.PaceMutation();
        return new { input.AvatarId, tag };
    }
    public async Task<object> RemoveFavoriteAvatarAsync(VrChatFavoriteChangeInput input)
    {
        var tag = SyncTagFromGroupId(input.GroupId);
        if (string.IsNullOrWhiteSpace(input.AvatarId) || string.IsNullOrWhiteSpace(tag)) return new { skipped = true };
        var import = await GetFavoriteAvatarsAsync();
        var favoriteId = import.Avatars.FirstOrDefault(x => x.GroupTag == tag && x.Avatar.AvatarId == input.AvatarId)?.Avatar.RemoteFavoriteId;
        if (string.IsNullOrWhiteSpace(favoriteId)) return new { skipped = true };
        using var response = await SendFavoriteRequestWithRateLimitRetryAsync(() => new HttpRequestMessage(HttpMethod.Delete, $"favorites/{WebUtility.UrlEncode(favoriteId)}"));
        if (!response.IsSuccessStatusCode && response.StatusCode != HttpStatusCode.NotFound) throw new InvalidOperationException($"VRChat favorite remove returned {(int)response.StatusCode}.");
        _favoriteRateLimitGate.PaceMutation();
        return new { input.AvatarId, tag };
    }
    public async Task<VrChatFavoriteRecompileResult> RecompileFavoriteAvatarGroupAsync(string groupId, IReadOnlyList<string> avatarIds, Action<SyncedAvatarOrderProgress>? progress = null)
    {
        var tag = SyncTagFromGroupId(groupId);
        if (string.IsNullOrWhiteSpace(tag)) throw new InvalidOperationException("That is not a synced VRChat favorite group.");
        var uniqueAvatarIds = avatarIds
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var existing = await GetFavoriteAvatarRefsAsync(tag);
        var removeTotal = existing.Count(x => !string.IsNullOrWhiteSpace(x.RemoteFavoriteId));
        progress?.Invoke(new SyncedAvatarOrderProgress(groupId, "unfavorite", "Unfavoriting existing avatars...", 0, removeTotal));
        var removed = 0;
        foreach (var favorite in existing.Where(x => !string.IsNullOrWhiteSpace(x.RemoteFavoriteId)))
        {
            using var response = await SendFavoriteRequestWithRateLimitRetryAsync(() => new HttpRequestMessage(HttpMethod.Delete, $"favorites/{WebUtility.UrlEncode(favorite.RemoteFavoriteId)}"));
            if (!response.IsSuccessStatusCode && response.StatusCode != HttpStatusCode.NotFound) throw new InvalidOperationException($"VRChat favorite clear returned {(int)response.StatusCode}.");
            removed++;
            progress?.Invoke(new SyncedAvatarOrderProgress(groupId, "unfavorite", "Unfavoriting existing avatars...", removed, removeTotal));
            _favoriteRateLimitGate.PaceMutation();
        }

        progress?.Invoke(new SyncedAvatarOrderProgress(groupId, "refavorite", "Unfavoriting finished. Refavoriting avatars...", 0, uniqueAvatarIds.Count));
        var added = 0;
        foreach (var avatarId in uniqueAvatarIds.AsEnumerable().Reverse())
        {
            var payload = JsonSerializer.Serialize(new { type = "avatar", favoriteId = avatarId, tags = new[] { tag } });
            using var response = await SendFavoriteRequestWithRateLimitRetryAsync(() => new HttpRequestMessage(HttpMethod.Post, "favorites") { Content = new StringContent(payload, Encoding.UTF8, "application/json") });
            if (!response.IsSuccessStatusCode && response.StatusCode != HttpStatusCode.Conflict) throw new InvalidOperationException($"VRChat favorite add returned {(int)response.StatusCode}.");
            added++;
            progress?.Invoke(new SyncedAvatarOrderProgress(groupId, "refavorite", "Refavoriting avatars...", added, uniqueAvatarIds.Count));
            _favoriteRateLimitGate.PaceMutation();
        }

        return new VrChatFavoriteRecompileResult(tag, removed, added);
    }
    public async Task<VrChatFavoriteImport> GetFavoriteAvatarsAsync()
    {
        var groupResult = await GetFavoriteAvatarGroupsAsync();
        var groups = groupResult.Groups;
        var avatars = new List<VrChatGroupedAvatar>();
        var deletedAvatars = new List<VrChatGroupedAvatar>();
        foreach (var group in groups)
        {
            var favoriteRefs = await GetFavoriteAvatarRefsAsync(group.Tag);
            var favoriteOrder = favoriteRefs
                .Select((favorite, index) => new { favorite.AvatarId, Index = index })
                .Where(x => !string.IsNullOrWhiteSpace(x.AvatarId))
                .GroupBy(x => x.AvatarId, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(x => x.Key, x => x.First().Index, StringComparer.OrdinalIgnoreCase);
            var groupAvatars = new List<VrChatGroupedAvatar>();
            var groupDeletedAvatars = new List<VrChatGroupedAvatar>();
            var detailedAvatarIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var offset = 0;
            while (true)
            {
                using var response = await _client.GetAsync($"avatars/favorites?n=100&offset={offset}&tag={WebUtility.UrlEncode(group.Tag)}");
                var json = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"VRChat avatar favorites returned {(int)response.StatusCode} for {group.Tag}.");
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
                if (doc.RootElement.ValueKind != JsonValueKind.Array) break;

                var count = doc.RootElement.GetArrayLength();
                if (count == 0) break;

                foreach (var item in doc.RootElement.EnumerateArray())
                {
                    var avatar = ReadAvatar(item);
                    avatar.RemoteFavoriteId = ReadString(item, "favoriteId") ?? "";
                    var releaseStatus = ReadString(item, "releaseStatus") ?? "";
                    if (IsUnavailableAvatarStatus(releaseStatus))
                    {
                        avatar.ReleaseStatus = ArchivedReleaseStatus(releaseStatus);
                        groupDeletedAvatars.Add(new VrChatGroupedAvatar(group.Tag, avatar));
                    }
                    else
                    {
                        if (!string.IsNullOrWhiteSpace(avatar.AvatarId))
                        {
                            detailedAvatarIds.Add(avatar.AvatarId);
                        }
                        groupAvatars.Add(new VrChatGroupedAvatar(group.Tag, avatar));
                    }
                }

                if (count < 100) break;
                offset += count;
            }

            foreach (var favorite in favoriteRefs.Where(x => !detailedAvatarIds.Contains(x.AvatarId)))
            {
                AvatarInput? checkedAvatar = null;
                try
                {
                    checkedAvatar = await FetchAvatarAsync(favorite.AvatarId);
                    checkedAvatar.RemoteFavoriteId = favorite.RemoteFavoriteId;
                }
                catch
                {
                }

                if (checkedAvatar is not null && !IsUnavailableAvatarStatus(checkedAvatar.ReleaseStatus))
                {
                    detailedAvatarIds.Add(checkedAvatar.AvatarId);
                    groupAvatars.Add(new VrChatGroupedAvatar(group.Tag, checkedAvatar));
                    continue;
                }

                groupDeletedAvatars.Add(new VrChatGroupedAvatar(group.Tag, checkedAvatar ?? new AvatarInput
                {
                    AvatarId = favorite.AvatarId,
                    Name = favorite.AvatarId,
                    ReleaseStatus = "deleted",
                    SourceUrl = $"https://vrchat.com/home/avatar/{favorite.AvatarId}",
                    Source = "vrchat-deleted",
                    RemoteFavoriteId = favorite.RemoteFavoriteId,
                    RawJson = JsonSerializer.Serialize(favorite, ProgramJson.Options)
                }));
            }
            avatars.AddRange(groupAvatars
                .Select((item, fallback) => new { item, fallback })
                .OrderBy(x => favoriteOrder.TryGetValue(x.item.Avatar.AvatarId, out var order) ? order : int.MaxValue)
                .ThenBy(x => x.fallback)
                .Select(x => x.item));
            deletedAvatars.AddRange(groupDeletedAvatars
                .Select((item, fallback) => new { item, fallback })
                .OrderBy(x => favoriteOrder.TryGetValue(x.item.Avatar.AvatarId, out var order) ? order : int.MaxValue)
                .ThenBy(x => x.fallback)
                .Select(x => x.item));
        }
        return new VrChatFavoriteImport(groups, avatars, deletedAvatars, groupResult.FavoriteGroupLimit);
    }
    private async Task<List<VrChatFavoriteRef>> GetFavoriteAvatarRefsAsync(string tag)
    {
        var refs = new List<VrChatFavoriteRef>();
        var offset = 0;
        while (true)
        {
            using var response = await SendFavoriteRequestWithRateLimitRetryAsync(() => new HttpRequestMessage(HttpMethod.Get, $"favorites?type=avatar&n=100&offset={offset}&tag={WebUtility.UrlEncode(tag)}"));
            if (!response.IsSuccessStatusCode) break;
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            if (doc.RootElement.ValueKind != JsonValueKind.Array) break;

            var count = doc.RootElement.GetArrayLength();
            if (count == 0) break;

            foreach (var item in doc.RootElement.EnumerateArray())
            {
                var avatarId = ReadString(item, "favoriteId") ?? "";
                if (!avatarId.StartsWith("avtr_", StringComparison.OrdinalIgnoreCase)) continue;
                refs.Add(new VrChatFavoriteRef(avatarId, ReadString(item, "id") ?? ""));
            }

            if (count < 100) break;
            offset += count;
        }

        return refs;
    }
    private async Task<HttpResponseMessage> SendFavoriteRequestWithRateLimitRetryAsync(Func<HttpRequestMessage> createRequest)
    {
        for (var attempt = 0; ; attempt++)
        {
            await _favoriteRateLimitGate.WaitAsync();
            var response = await _client.SendAsync(createRequest());
            _favoriteRateLimitGate.Observe(response.Headers, response.StatusCode, attempt);
            if (response.StatusCode != HttpStatusCode.TooManyRequests || attempt >= 4)
            {
                return response;
            }

            response.Dispose();
        }
    }
    private async Task<(List<VrChatRemoteGroup> Groups, int FavoriteGroupLimit)> GetFavoriteAvatarGroupsAsync()
    {
        var currentUser = await GetCurrentUserAsync();
        var groupLimit = HasSupporterTag(currentUser)
            ? await GetFavoriteGroupLimitAsync("avatar", DefaultAvatarFavoriteGroupLimit)
            : DefaultAvatarFavoriteGroupLimit;
        var groups = Enumerable.Range(1, groupLimit)
            .Select(i => new VrChatRemoteGroup($"avatars{i}", DefaultAvatarGroupName(i), i - 1))
            .ToDictionary(x => x.Tag, StringComparer.OrdinalIgnoreCase);

        var nextCustomOrder = groups.Count;
        var offset = 0;
        while (true)
        {
            var cacheBust = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            using var request = new HttpRequestMessage(HttpMethod.Get, $"favorite/groups?n=100&offset={offset}&ownerId={WebUtility.UrlEncode(currentUser.Id)}&_={cacheBust}");
            request.Headers.CacheControl = new CacheControlHeaderValue { NoCache = true, NoStore = true };
            request.Headers.Pragma.ParseAdd("no-cache");
            using var response = await _client.SendAsync(request);
            if (!response.IsSuccessStatusCode) break;
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            if (doc.RootElement.ValueKind != JsonValueKind.Array) break;

            var count = doc.RootElement.GetArrayLength();
            if (count == 0) break;

            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (!string.Equals(ReadString(item, "type"), "avatar", StringComparison.OrdinalIgnoreCase)) continue;
                var tag = (ReadString(item, "name") ?? ReadString(item, "tag") ?? "").Trim();
                if (string.IsNullOrWhiteSpace(tag)) continue;
                var displayName = (ReadString(item, "displayName") ?? "").Trim();
                if (string.IsNullOrWhiteSpace(displayName)) displayName = DefaultAvatarGroupName(ReadAvatarGroupOrder(tag) + 1);
                var order = ReadAvatarGroupOrder(tag);
                if (order < 0) order = nextCustomOrder++;
                groups[tag] = new VrChatRemoteGroup(tag, displayName, order);
            }

            if (count < 100) break;
            offset += count;
        }

        foreach (var group in groups.Values.ToList())
        {
            var displayName = await GetFavoriteAvatarGroupDisplayNameAsync(group.Tag, currentUser.Id, group.DisplayName);
            groups[group.Tag] = group with { DisplayName = displayName };
        }

        return (groups.Values.OrderBy(x => x.SortOrder).ThenBy(x => x.DisplayName, StringComparer.OrdinalIgnoreCase).ToList(), groupLimit);
    }
    private async Task<string> GetFavoriteAvatarGroupDisplayNameAsync(string tag, string ownerId, string fallback)
    {
        if (string.IsNullOrWhiteSpace(tag) || string.IsNullOrWhiteSpace(ownerId)) return fallback;
        try
        {
            var cacheBust = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            using var request = new HttpRequestMessage(HttpMethod.Get, $"favorite/group/avatar/{WebUtility.UrlEncode(tag)}/{WebUtility.UrlEncode(ownerId)}?_={cacheBust}");
            request.Headers.CacheControl = new CacheControlHeaderValue { NoCache = true, NoStore = true };
            request.Headers.Pragma.ParseAdd("no-cache");
            using var response = await _client.SendAsync(request);
            if (!response.IsSuccessStatusCode) return fallback;
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return fallback;
            var displayName = (ReadString(doc.RootElement, "displayName") ?? "").Trim();
            return string.IsNullOrWhiteSpace(displayName) ? fallback : displayName;
        }
        catch
        {
            return fallback;
        }
    }
    private async Task<int> GetFavoriteGroupLimitAsync(string favoriteType, int defaultLimit)
    {
        try
        {
            using var response = await _client.GetAsync("auth/user/favoritelimits");
            if (!response.IsSuccessStatusCode) return defaultLimit;
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            if (doc.RootElement.TryGetProperty("maxFavoriteGroups", out var maxGroups) &&
                maxGroups.TryGetProperty(favoriteType, out var favoriteGroups) &&
                favoriteGroups.ValueKind == JsonValueKind.Number &&
                favoriteGroups.TryGetInt32(out var limit))
            {
                return Math.Clamp(limit, 1, 24);
            }
        }
        catch
        {
        }
        return defaultLimit;
    }
    private static bool HasSupporterTag(VrChatUserSummary user)
    {
        return (user.Tags ?? "")
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Any(tag => tag.Contains("system_supporter", StringComparison.OrdinalIgnoreCase) || tag.Contains("supporter", StringComparison.OrdinalIgnoreCase));
    }
    private static int ReadAvatarGroupOrder(string tag)
    {
        var match = System.Text.RegularExpressions.Regex.Match(tag, @"^avatars(?<index>\d+)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return match.Success && int.TryParse(match.Groups["index"].Value, out var index) ? Math.Max(0, index - 1) : -1;
    }
    private static string DefaultAvatarGroupName(int index) => index <= 1 ? "Favorite Avatars" : $"VRC+ Avatars {index - 1}";
    private async Task<VrChatUserSummary> GetCurrentUserAsync()
    {
        using var response = await _client.GetAsync("auth/user");
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Not signed in.");
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return ReadUser(doc.RootElement);
    }
    private static string CleanProfileStatus(string? status, string fallback)
    {
        var value = (status ?? "").Trim().ToLowerInvariant().Replace("_", " ").Replace("-", " ");
        return value switch
        {
            "active" => "active",
            "join me" => "join me",
            "joinme" => "join me",
            "ask me" => "ask me",
            "askme" => "ask me",
            "busy" => "busy",
            _ => string.IsNullOrWhiteSpace(fallback) ? "active" : fallback
        };
    }
    private async Task<VrChatWorldSummary> GetWorldAsync(string worldId)
    {
        using var response = await _client.GetAsync($"worlds/{WebUtility.UrlEncode(worldId)}");
        var json = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"VRChat world returned {(int)response.StatusCode}.");
        using var doc = JsonDocument.Parse(json);
        var world = ReadWorld(doc.RootElement);
        return await EnrichWorldInstanceGroupsAsync(world);
    }
    private async Task<VrChatWorldSummary> EnrichWorldInstanceGroupsAsync(VrChatWorldSummary world)
    {
        var instances = world.Instances;
        if (instances is null || instances.Count == 0) return world;
        var groupIds = instances.Select(x => x.GroupId).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.OrdinalIgnoreCase).Take(10).ToList();
        if (groupIds.Count == 0) return world;
        var names = new ConcurrentDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        using var gate = new SemaphoreSlim(3);
        var tasks = groupIds.Select(async id =>
        {
            await gate.WaitAsync();
            try
            {
                var name = await GetGroupNameAsync(id);
                if (!string.IsNullOrWhiteSpace(name)) names[id] = name;
            }
            catch { }
            finally
            {
                gate.Release();
            }
        });
        await Task.WhenAll(tasks);
        if (names.Count == 0) return world;
        return world with
        {
            Instances = instances.Select(instance => !string.IsNullOrWhiteSpace(instance.GroupId) && names.TryGetValue(instance.GroupId, out var name)
                ? instance with { GroupName = name }
                : instance).ToList()
        };
    }
    private async Task<string> GetGroupNameAsync(string groupId)
    {
        using var response = await _client.GetAsync($"groups/{WebUtility.UrlEncode(groupId)}");
        if (!response.IsSuccessStatusCode) return "";
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return ReadString(doc.RootElement, "name") ?? ReadString(doc.RootElement, "shortCode") ?? "";
    }
    private static async Task<object> ReadActionResponseAsync(HttpResponseMessage response, string fallback)
    {
        var json = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
        {
            var message = TryReadErrorMessage(json);
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(message) ? $"{fallback} VRChat returned {(int)response.StatusCode}." : message);
        }
        return ParseActionResponse(json);
    }
    private static object ParseActionResponse(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new { ok = true };
        try
        {
            using var doc = JsonDocument.Parse(json);
            return JsonSerializer.Deserialize<object>(doc.RootElement.GetRawText(), ProgramJson.Options) ?? new { ok = true };
        }
        catch
        {
            return new { ok = true, body = json };
        }
    }
    private static string ParseInstanceId(string target, string worldId)
    {
        var value = target?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(value)) return "";
        var colon = value.IndexOf(':');
        if (colon >= 0 && colon + 1 < value.Length) return value[(colon + 1)..].Trim();
        var trimmedWorld = worldId?.Trim() ?? "";
        if (!string.IsNullOrWhiteSpace(trimmedWorld) && value.StartsWith(trimmedWorld, StringComparison.OrdinalIgnoreCase))
        {
            return value[trimmedWorld.Length..].TrimStart(':');
        }
        return value.StartsWith("wrld_", StringComparison.OrdinalIgnoreCase) ? "" : value;
    }
    private static string TryReadErrorMessage(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return "";
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("error", out var error))
            {
                if (error.ValueKind == JsonValueKind.Object) return ReadString(error, "message")?.Trim('"') ?? "";
                if (error.ValueKind == JsonValueKind.String) return error.GetString() ?? "";
            }
            return ReadString(doc.RootElement, "message")?.Trim('"') ?? "";
        }
        catch
        {
            return "";
        }
    }
    private static VrChatUserSummary ReadUser(JsonElement root) => new(
        ReadString(root, "id") ?? "",
        ReadString(root, "displayName") ?? "",
        ReadString(root, "currentAvatar") ?? "",
        ReadString(root, "currentAvatarImageUrl") ?? "",
        ReadString(root, "currentAvatarThumbnailImageUrl") ?? "",
        ReadString(root, "status") ?? "",
        ReadString(root, "statusDescription") ?? "",
        ReadString(root, "location") ?? "",
        ReadString(root, "worldId") ?? "",
        ReadString(root, "instanceId") ?? "",
        ReadHomeWorldId(root),
        ReadString(root, "bio") ?? "",
        ReadString(root, "date_joined") ?? ReadString(root, "dateJoined") ?? "",
        ReadString(root, "last_login") ?? ReadString(root, "lastLogin") ?? "",
        ReadString(root, "developerType") ?? "",
        ReadStringArray(root, "tags"),
        ReadStringArray(root, "bioLinks"),
        ReadString(root, "pronouns") ?? "",
        ReadString(root, "profileImageUrl") ?? ReadString(root, "profilePicture") ?? "",
        ReadString(root, "userIcon") ?? "",
        ReadString(root, "profilePicOverride") ?? "",
        ReadString(root, "profilePicOverrideThumbnail") ?? "",
        JsonSerializer.Serialize(root, ProgramJson.Options));
    private static VrChatFriendSummary ReadFriend(JsonElement root, bool? endpointOnline = null)
    {
        var location = ReadString(root, "location") ?? "";
        var worldId = ReadString(root, "worldId") ?? "";
        if (string.IsNullOrWhiteSpace(worldId) && location.StartsWith("wrld_", StringComparison.OrdinalIgnoreCase))
        {
            var colon = location.IndexOf(':');
                worldId = colon > 0 ? location[..colon] : location;
        }
        var state = ReadString(root, "state") ?? "";
        var hasJoinableLocation = !string.IsNullOrWhiteSpace(location)
            && location.StartsWith("wrld_", StringComparison.OrdinalIgnoreCase);
        var fieldOnline = state.Equals("online", StringComparison.OrdinalIgnoreCase)
            || (endpointOnline == true && state.Equals("active", StringComparison.OrdinalIgnoreCase))
            || hasJoinableLocation;
        var online = fieldOnline || endpointOnline == true;
        var presence = state.Equals("online", StringComparison.OrdinalIgnoreCase) || (endpointOnline == true && hasJoinableLocation)
            ? "online"
            : (endpointOnline == true && state.Equals("active", StringComparison.OrdinalIgnoreCase)) || hasJoinableLocation || endpointOnline == true
                ? "active"
                : "offline";
        var presenceSource = endpointOnline == true
            ? "friend-list-online"
            : endpointOnline == false
                ? "friend-list-offline"
                : hasJoinableLocation
                    ? "detail-location"
                    : "";
        var representedGroup = root.TryGetProperty("representedGroup", out var groupElement) && groupElement.ValueKind == JsonValueKind.Object ? groupElement : default;
        var hasRepresentedGroup = representedGroup.ValueKind == JsonValueKind.Object;
        var currentAvatarElement = root.TryGetProperty("currentAvatar", out var avatarElement) && avatarElement.ValueKind == JsonValueKind.Object ? avatarElement : default;
        var hasCurrentAvatarObject = currentAvatarElement.ValueKind == JsonValueKind.Object;
        var tags = ReadStringArray(root, "tags");
        return new VrChatFriendSummary(
            ReadString(root, "id") ?? "",
            ReadString(root, "displayName") ?? "",
            ReadString(root, "status") ?? "",
            ReadString(root, "statusDescription") ?? "",
            location,
            worldId,
            ReadString(root, "currentAvatarImageUrl") ?? ReadProfileImage(root) ?? "",
            online,
            presence,
            state,
            ReadString(root, "bio") ?? "",
            ReadString(root, "date_joined") ?? ReadString(root, "dateJoined") ?? "",
            ReadString(root, "last_login") ?? ReadString(root, "lastLogin") ?? "",
            ReadString(root, "developerType") ?? "",
            tags,
            JsonSerializer.Serialize(root, ProgramJson.Options),
            ReadString(root, "profileImageUrl") ?? ReadString(root, "profilePicture") ?? "",
            ReadString(root, "userIcon") ?? "",
            ReadString(root, "profilePicOverride") ?? "",
            ReadString(root, "profilePicOverrideThumbnail") ?? "",
            hasCurrentAvatarObject ? ReadString(currentAvatarElement, "id") ?? "" : ReadString(root, "currentAvatar") ?? ReadString(root, "currentAvatarId") ?? "",
            hasCurrentAvatarObject ? ReadString(currentAvatarElement, "name") ?? "" : ReadString(root, "currentAvatarName") ?? "",
            hasCurrentAvatarObject ? ReadString(currentAvatarElement, "imageUrl") ?? ReadString(root, "currentAvatarImageUrl") ?? "" : ReadString(root, "currentAvatarImageUrl") ?? "",
            hasCurrentAvatarObject ? ReadString(currentAvatarElement, "thumbnailImageUrl") ?? ReadString(currentAvatarElement, "imageUrl") ?? ReadString(root, "currentAvatarThumbnailImageUrl") ?? ReadString(root, "currentAvatarImageUrl") ?? "" : ReadString(root, "currentAvatarThumbnailImageUrl") ?? "",
            ReadValueString(root, "allowAvatarCopying"),
            ReadString(root, "pronouns") ?? "",
            ReadString(root, "ageVerificationStatus") ?? "",
            ReadString(root, "last_platform") ?? ReadString(root, "lastPlatform") ?? "",
            hasRepresentedGroup ? ReadString(representedGroup, "id") ?? "" : ReadString(root, "representedGroupId") ?? "",
            hasRepresentedGroup ? ReadString(representedGroup, "name") ?? "" : "",
            hasRepresentedGroup ? ReadString(representedGroup, "shortCode") ?? "" : "",
            hasRepresentedGroup ? ReadString(representedGroup, "memberCount") ?? ReadValueString(representedGroup, "memberCount") : "",
            hasRepresentedGroup ? ReadString(representedGroup, "iconUrl") ?? ReadString(representedGroup, "bannerUrl") ?? "" : "",
            ReadStringArray(root, "bioLinks"),
            endpointOnline.HasValue || ReadBool(root, "isFriend") || tags.Contains("friend", StringComparison.OrdinalIgnoreCase),
            ReadBool(root, "isBlocked") || ReadBool(root, "blocked") || tags.Contains("blocked", StringComparison.OrdinalIgnoreCase),
            presenceSource);
    }
    private static string ReadHomeWorldId(JsonElement root)
    {
        var location = ReadString(root, "homeLocation")
            ?? ReadString(root, "home_location")
            ?? ReadString(root, "homeWorldId")
            ?? ReadString(root, "homeWorld")
            ?? "";
        if (location.StartsWith("wrld_", StringComparison.OrdinalIgnoreCase))
        {
            var colon = location.IndexOf(':');
            return colon > 0 ? location[..colon] : location;
        }
        return "";
    }
    private static VrChatWorldSummary ReadWorld(JsonElement root)
    {
        var worldId = ReadString(root, "id") ?? "";
        return new VrChatWorldSummary(
        worldId,
        ReadString(root, "name") ?? "",
        ReadString(root, "authorName") ?? "",
        ReadString(root, "description") ?? "",
        ReadString(root, "imageUrl") ?? ReadString(root, "thumbnailImageUrl") ?? "",
        ReadInt(root, "occupants"),
        ReadInt(root, "favorites"),
        ReadString(root, "releaseStatus") ?? "",
        ReadInt(root, "capacity"),
        ReadInt(root, "visits"),
        ReadInt(root, "publicOccupants"),
        ReadInt(root, "privateOccupants"),
        ReadString(root, "created_at") ?? ReadString(root, "createdAt") ?? "",
        ReadString(root, "updated_at") ?? ReadString(root, "updatedAt") ?? "",
        JsonSerializer.Serialize(root, ProgramJson.Options),
        "",
        ReadWorldInstances(root, worldId),
        ReadString(root, "authorId") ?? "");
    }
    private static List<VrChatWorldInstanceSummary> ReadWorldInstances(JsonElement root, string worldId)
    {
        var instances = new List<VrChatWorldInstanceSummary>();
        if (!root.TryGetProperty("instances", out var items) || items.ValueKind != JsonValueKind.Array) return instances;
        foreach (var item in items.EnumerateArray())
        {
            var id = "";
            var occupants = 0;
            if (item.ValueKind == JsonValueKind.Array)
            {
                var parts = item.EnumerateArray().ToList();
                if (parts.Count > 0 && parts[0].ValueKind is JsonValueKind.String or JsonValueKind.Number) id = parts[0].ToString();
                if (parts.Count > 1) occupants = parts[1].ValueKind == JsonValueKind.Number && parts[1].TryGetInt32(out var count) ? count : 0;
            }
            else if (item.ValueKind == JsonValueKind.Object)
            {
                id = ReadString(item, "id") ?? ReadString(item, "instanceId") ?? "";
                occupants = ReadInt(item, "occupants") != 0 ? ReadInt(item, "occupants") : ReadInt(item, "users");
            }
            if (string.IsNullOrWhiteSpace(id)) continue;
            var meta = DescribeWorldInstance(id);
            instances.Add(new VrChatWorldInstanceSummary(id, string.IsNullOrWhiteSpace(worldId) ? id : $"{worldId}:{id}", occupants, meta.Type, meta.Region, meta.IsLocked, meta.IsAgeRestricted, meta.GroupId, ""));
        }
        return instances.OrderByDescending(instance => instance.Occupants).ThenBy(instance => instance.Id, StringComparer.OrdinalIgnoreCase).ToList();
    }
    private static (string Type, string Region, bool IsLocked, bool IsAgeRestricted, string GroupId) DescribeWorldInstance(string id)
    {
        var value = id ?? "";
        var lower = value.ToLowerInvariant();
        var type = lower.Contains("group(") ? "Group"
            : lower.Contains("friends(") ? "Friends"
            : lower.Contains("hidden(") ? "Friends+"
            : lower.Contains("private(") ? "Invite"
            : "Public";
        var region = "";
        var match = System.Text.RegularExpressions.Regex.Match(value, @"~region\((?<region>[^)]+)\)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (match.Success) region = match.Groups["region"].Value.ToUpperInvariant();
        var groupId = "";
        var groupMatch = System.Text.RegularExpressions.Regex.Match(value, @"~group\((?<groupId>grp_[^)]+)\)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (groupMatch.Success) groupId = groupMatch.Groups["groupId"].Value;
        var locked = type != "Public" || lower.Contains("canrequestinvite") || lower.Contains("nonce(");
        var ageRestricted = lower.Contains("age") || lower.Contains("18+");
        return (type, region, locked, ageRestricted, groupId);
    }
    private static VrChatNotificationSummary ReadNotification(JsonElement root) => new(
        ReadString(root, "id") ?? ReadString(root, "notificationId") ?? "",
        ReadString(root, "type") ?? ReadString(root, "notificationType") ?? "",
        ReadString(root, "senderUserId") ?? ReadString(root, "senderId") ?? ReadString(root, "userId") ?? "",
        ReadString(root, "senderUsername") ?? ReadString(root, "senderName") ?? ReadString(root, "displayName") ?? "",
        ReadNotificationMessage(root),
        ReadString(root, "created_at") ?? ReadString(root, "createdAt") ?? "",
        ReadBool(root, "seen") || ReadBool(root, "isSeen"),
        JsonSerializer.Serialize(root, ProgramJson.Options));
    private static string ReadNotificationMessage(JsonElement root)
    {
        foreach (var name in new[] { "message", "details", "inviteMessage", "requestMessage", "responseMessage", "data", "content" })
        {
            if (!root.TryGetProperty(name, out var value)) continue;
            var text = ReadNotificationValue(value);
            if (!string.IsNullOrWhiteSpace(text)) return text;
        }
        return "";
    }
    private static string ReadNotificationValue(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.String) return value.GetString()?.Trim() ?? "";
        if (value.ValueKind == JsonValueKind.Number || value.ValueKind == JsonValueKind.True || value.ValueKind == JsonValueKind.False) return value.ToString();
        if (value.ValueKind == JsonValueKind.Array) return string.Join(" ", value.EnumerateArray().Select(ReadNotificationValue).Where(x => !string.IsNullOrWhiteSpace(x))).Trim();
        if (value.ValueKind != JsonValueKind.Object) return "";
        foreach (var name in new[] { "message", "text", "body", "content", "details", "inviteMessage", "requestMessage", "responseMessage" })
        {
            if (!value.TryGetProperty(name, out var child)) continue;
            var text = ReadNotificationValue(child);
            if (!string.IsNullOrWhiteSpace(text)) return text;
        }
        return "";
    }
    private static bool IsUnavailableAvatarStatus(string? status)
    {
        var value = status?.Trim() ?? "";
        return value.Equals("hidden", StringComparison.OrdinalIgnoreCase)
            || value.Equals("private", StringComparison.OrdinalIgnoreCase)
            || value.Equals("deleted", StringComparison.OrdinalIgnoreCase)
            || value.Equals("unavailable", StringComparison.OrdinalIgnoreCase);
    }
    private static string ArchivedReleaseStatus(string? status)
    {
        var value = status?.Trim() ?? "";
        return value.Equals("private", StringComparison.OrdinalIgnoreCase) || value.Equals("hidden", StringComparison.OrdinalIgnoreCase) ? "private" : "deleted";
    }
    private static AvatarInput ReadAvatar(JsonElement root)
    {
        var id = ReadString(root, "id") ?? "";
        return new AvatarInput
        {
            AvatarId = id, Name = ReadString(root, "name") ?? id, Description = ReadString(root, "description") ?? "", AuthorId = ReadString(root, "authorId") ?? "",
            AuthorName = ReadString(root, "authorName") ?? "", ImageUrl = ReadString(root, "imageUrl") ?? "", ThumbnailImageUrl = ReadString(root, "thumbnailImageUrl") ?? ReadString(root, "imageUrl") ?? "",
            ReleaseStatus = ReadString(root, "releaseStatus") ?? "", Version = root.TryGetProperty("version", out var v) ? v.ToString() : "", Platforms = root.TryGetProperty("unityPackages", out var p) ? SummarizePackages(p) : "",
            Tags = root.TryGetProperty("tags", out var tags) && tags.ValueKind == JsonValueKind.Array ? string.Join(", ", tags.EnumerateArray().Select(x => x.GetString()).Where(x => !string.IsNullOrWhiteSpace(x))) : "",
            SourceUrl = $"https://vrchat.com/home/avatar/{id}", RawJson = JsonSerializer.Serialize(root, ProgramJson.Options), Source = "vrchat",
            RemoteCreatedAt = ReadString(root, "created_at") ?? ReadString(root, "createdAt") ?? "",
            RemoteUpdatedAt = ReadString(root, "updated_at") ?? ReadString(root, "updatedAt") ?? ""
        };
    }
    private static string? ReadString(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static string? ReadProfileImage(JsonElement e) =>
        ReadString(e, "profilePicOverrideThumbnail")
        ?? ReadString(e, "profilePicOverride")
        ?? ReadString(e, "userIcon")
        ?? ReadString(e, "profilePicture")
        ?? ReadString(e, "profileImageUrl");
    private static int ReadInt(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var value) ? value : 0;
    private static bool ReadBool(JsonElement e, string name) => e.TryGetProperty(name, out var v) && (v.ValueKind == JsonValueKind.True || (v.ValueKind == JsonValueKind.String && bool.TryParse(v.GetString(), out var parsed) && parsed));
    private static string ReadValueString(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind is JsonValueKind.String or JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False ? v.ToString() : "";
    private static string ReadStringArray(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array ? string.Join(", ", v.EnumerateArray().Select(x => x.GetString()).Where(x => !string.IsNullOrWhiteSpace(x))) : "";
    private static string ReadFullGroupShortCode(JsonElement e)
    {
        var shortCode = ReadString(e, "shortCode") ?? "";
        var discriminator = ReadString(e, "discriminator") ?? "";
        return !string.IsNullOrWhiteSpace(shortCode) && !string.IsNullOrWhiteSpace(discriminator) && !shortCode.Contains('.', StringComparison.Ordinal)
            ? $"{shortCode}.{discriminator}"
            : shortCode;
    }
    private static string SyncTagFromGroupId(string groupId) => groupId.StartsWith("vrc_", StringComparison.OrdinalIgnoreCase) ? groupId[4..] : "";
    private static string SummarizePackages(JsonElement packages) => packages.ValueKind == JsonValueKind.Array ? string.Join(", ", packages.EnumerateArray().Select(p => $"{ReadString(p, "platform") ?? "unknown"} / Unity {ReadString(p, "unityVersion") ?? ""}".Trim())) : "";
    private void SaveCookies()
    {
        var cookies = _cookies.GetCookies(ApiBase).Cast<Cookie>().Select(c => new PersistedCookie(c.Name, c.Value)).ToList();
        File.WriteAllText(_sessionPath, JsonSerializer.Serialize(new PersistedCookieSession(cookies), ProgramJson.Options));
    }
    private void LoadCookies()
    {
        if (!File.Exists(_sessionPath)) return;
        try
        {
            var session = JsonSerializer.Deserialize<PersistedCookieSession>(File.ReadAllText(_sessionPath), ProgramJson.Options);
            foreach (var cookie in session?.Cookies ?? []) _cookies.Add(ApiBase, new Cookie(cookie.Name, cookie.Value));
        }
        catch { }
    }
}

internal sealed class VrChatRateLimitGate
{
    private readonly object _gate = new();
    private DateTimeOffset _notBefore = DateTimeOffset.MinValue;

    public async Task WaitAsync()
    {
        while (true)
        {
            TimeSpan delay;
            lock (_gate)
            {
                delay = _notBefore - DateTimeOffset.UtcNow;
            }

            if (delay <= TimeSpan.Zero) return;
            await Task.Delay(delay);
        }
    }

    public void Observe(HttpResponseHeaders headers, HttpStatusCode statusCode, int attempt)
    {
        var delay = RateLimitDelay(headers, statusCode, attempt);
        if (delay > TimeSpan.Zero) Schedule(delay);
    }

    public void PaceMutation() => Schedule(TimeSpan.FromMilliseconds(750));

    private void Schedule(TimeSpan delay)
    {
        if (delay <= TimeSpan.Zero) return;
        var target = DateTimeOffset.UtcNow + delay;
        lock (_gate)
        {
            if (target > _notBefore) _notBefore = target;
        }
    }

    private static TimeSpan RateLimitDelay(HttpResponseHeaders headers, HttpStatusCode statusCode, int attempt)
    {
        if (RetryAfterDelay(headers) is { } retryAfter) return PositiveDelay(retryAfter + TimeSpan.FromMilliseconds(250));
        if (ReadIntHeader(headers, "X-RateLimit-Remaining") is { } remaining && remaining <= 1)
        {
            if (ResetDelay(headers) is { } resetDelay) return PositiveDelay(resetDelay + TimeSpan.FromSeconds(1));
            return TimeSpan.FromSeconds(2);
        }

        return statusCode == HttpStatusCode.TooManyRequests
            ? TimeSpan.FromSeconds(Math.Min(60, 8 + attempt * 4))
            : TimeSpan.Zero;
    }

    private static TimeSpan PositiveDelay(TimeSpan delay) => delay <= TimeSpan.Zero ? TimeSpan.FromSeconds(2) : delay;

    private static TimeSpan? RetryAfterDelay(HttpResponseHeaders headers)
    {
        if (headers.RetryAfter?.Delta is { } delta) return delta;
        if (headers.RetryAfter?.Date is { } date) return date - DateTimeOffset.UtcNow;
        return null;
    }

    private static TimeSpan? ResetDelay(HttpResponseHeaders headers)
    {
        var value = ReadHeader(headers, "X-RateLimit-Reset") ?? ReadHeader(headers, "RateLimit-Reset");
        if (string.IsNullOrWhiteSpace(value)) return null;
        value = value.Trim();
        if (long.TryParse(value, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var number))
        {
            if (number > 1_000_000_000_000) return DateTimeOffset.FromUnixTimeMilliseconds(number) - DateTimeOffset.UtcNow;
            if (number > 1_000_000_000) return DateTimeOffset.FromUnixTimeSeconds(number) - DateTimeOffset.UtcNow;
            return TimeSpan.FromSeconds(Math.Max(0, number));
        }

        if (DateTimeOffset.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var resetAt))
        {
            return resetAt - DateTimeOffset.UtcNow;
        }

        return null;
    }

    private static int? ReadIntHeader(HttpResponseHeaders headers, string name)
    {
        var value = ReadHeader(headers, name);
        return int.TryParse(value, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var number) ? number : null;
    }

    private static string? ReadHeader(HttpResponseHeaders headers, string name) =>
        headers.TryGetValues(name, out var values) ? values.FirstOrDefault() : null;
}

internal sealed class AvatarDatabaseClient
{
    private const string VrcxDatabaseFileName = "VRCX.sqlite3";
    private const string VrcxRemoteDatabaseUrl = "https://api.avtrdb.com/v3/avatar/search/vrcx";
    private const int VrcxRemotePageSize = 50;
    private const int VrcxRemoteRandomPageCeiling = 1000;
    private const int DatabaseFullSearchPageLimit = 1000;
    private const string AvtrZipSearchBaseUrl = "https://g.avtr.zip/s/";
    private const string AvtrZipAuthorBaseUrl = "https://g.avtr.zip/sa/";
    private const string AvtrZipActionBaseUrl = "https://g.avtr.zip/a/";
    private const string AvtrZipCaptchaUrl = "https://g.avtr.zip/v2/verify";
    private const string PasDatabaseFileName = "pasavtrdb_pc.bin";
    private const string PasDatabasePrimaryUrl = "https://gist.githubusercontent.com/Mwr247/a80c1f9060fc4fd46a8f00d589c47c5a/raw/pasavtrdb.txt";
    private const string PasDatabaseBackupUrl = "https://prismic.net/vrc/pasavtrdb.txt";
    private static readonly Dictionary<string, AvatarDatabaseSearchResult> Cache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly Dictionary<string, AvatarDatabaseCountResult> CountCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly Dictionary<string, AvatarDatabaseCountProgress> CountProgressCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly object CountProgressGate = new();
    private static readonly Dictionary<string, AvatarInput> VrChatAvatarDetailCache = new(StringComparer.OrdinalIgnoreCase);
    private static PasDatabaseData? PasCache;
    private static readonly SemaphoreSlim QueryGate = new(1, 1);
    private static readonly HttpClient AvtrZipHttp = CreateAvtrZipHttpClient();
    private static readonly HttpClient PasHttp = CreatePasHttpClient();
    private static readonly HttpClient VrcxRemoteHttp = CreateVrcxRemoteHttpClient();

    public async Task<AvatarDatabaseSearchResult> SearchAsync(AvatarSearchInput input, VrChatClient? vrchat = null)
    {
        if (IsAllProvider(input)) return await SearchAllAsync(input, vrchat);
        if (IsAvtrZipProvider(input)) return await SearchAvtrZipAsync(input, vrchat);
        if (IsPasProvider(input)) return await SearchPasAsync(input, vrchat);

        var query = input.Query?.Trim() ?? "";
        if (query.Length > 0 && query.Length < 3 && !IsAuthorIdOnlySearch(input) && !HasOptionFilter(input)) throw new InvalidOperationException("Enter at least 3 characters to search the avatar database.");
        if (!HasSearchField(input)) throw new InvalidOperationException("Enable at least one search field.");
        return await SearchRemoteVrcxAsync(input, vrchat);
    }

    public async Task<AvatarDatabaseCountResult> CountAsync(AvatarSearchInput input, VrChatClient? vrchat = null)
    {
        if (IsAllProvider(input)) return await CountAllAsync(input, vrchat);
        if (IsAvtrZipProvider(input)) return await CountAvtrZipAsync(input, vrchat);
        if (IsPasProvider(input)) return await CountPasAsync(input);

        var query = input.Query?.Trim() ?? "";
        if (query.Length > 0 && query.Length < 3 && !IsAuthorIdOnlySearch(input) && !HasOptionFilter(input)) throw new InvalidOperationException("Enter at least 3 characters to search the avatar database.");
        if (!HasSearchField(input)) throw new InvalidOperationException("Enable at least one search field.");
        return await CountRemoteVrcxAsync(input, vrchat);
    }

    public AvatarDatabaseCountProgress CountProgress(AvatarSearchInput input)
    {
        var key = AllCountProgressKey(input);
        lock (CountProgressGate)
        {
            return CountProgressCache.TryGetValue(key, out var progress)
                ? progress
                : new AvatarDatabaseCountProgress(0, false, false);
        }
    }

    public async Task<AvatarDatabaseSearchResult> RandomAsync(AvatarSearchInput input, VrChatClient? vrchat = null)
    {
        if (IsAllProvider(input)) return await RandomAllAsync(input, vrchat);
        if (IsAvtrZipProvider(input)) return await RandomAvtrZipAsync(input, vrchat);
        if (IsPasProvider(input)) return await RandomPasAsync(input, vrchat);

        var limit = Math.Clamp(input.Limit <= 0 ? 50 : input.Limit, 1, 50);
        return await RandomRemoteVrcxAsync(input with { Query = string.IsNullOrWhiteSpace(input.Query) ? "avatar" : input.Query, Limit = limit }, vrchat);
    }

    public VrcxDatabaseStatus GetVrcxStatus()
    {
        var path = ResolveVrcxDatabasePath();
        return new VrcxDatabaseStatus(!string.IsNullOrWhiteSpace(path), path ?? "", AppPaths.DatabaseDirectory);
    }

    public async Task<AvatarInput?> ResolveByImageAsync(AvatarImageResolveInput input, VrChatClient? vrchat = null)
    {
        var avatarId = input.AvatarId?.Trim() ?? "";
        var imageKey = ImageFileKey(input.ImageUrl);
        var name = input.Name?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(avatarId) && string.IsNullOrWhiteSpace(imageKey) && string.IsNullOrWhiteSpace(name) && string.IsNullOrWhiteSpace(input.UserId) && string.IsNullOrWhiteSpace(input.DisplayName)) return null;

        if (!string.IsNullOrWhiteSpace(avatarId))
        {
            var byId = await ResolveByAvatarIdAsync(avatarId, vrchat);
            if (byId is not null) return byId;
        }

        var local = await ResolveLocalVrcxAvatarByImageAsync(imageKey, input.ImageUrl);
        if (local is not null)
        {
            if (vrchat is not null) await HydrateAvtrZipResultsAsync(new List<AvatarInput> { local }, vrchat);
            return local;
        }

        local = await ResolveLocalVrcxAvatarByFeedAsync(input.UserId, input.DisplayName, imageKey, input.ImageUrl);
        if (local is not null)
        {
            if (vrchat is not null) await HydrateAvtrZipResultsAsync(new List<AvatarInput> { local }, vrchat);
            return local;
        }

        var byAuthor = await ResolveByAuthorIdAndNameAsync(input.UserId, name, avatarId, vrchat);
        if (byAuthor is not null) return byAuthor;

        foreach (var term in ResolveImageSearchTerms(imageKey, name))
        {
            AvatarInput? remote = null;
            try
            {
                remote = await ResolveRemoteVrcxAvatarByImageAsync(term, imageKey, input.ImageUrl);
            }
            catch
            {
            }

            if (remote is not null)
            {
                if (vrchat is not null) await HydrateAvtrZipResultsAsync(new List<AvatarInput> { remote }, vrchat);
                return remote;
            }
        }

        return null;
    }

    private async Task<AvatarInput?> ResolveByAuthorIdAndNameAsync(string userId, string name, string avatarId, VrChatClient? vrchat = null)
    {
        userId = userId.Trim();
        if (!userId.StartsWith("usr_", StringComparison.OrdinalIgnoreCase)) return null;
        var input = new AvatarSearchInput("", Limit: 50, Page: 1, AuthorId: userId, SearchAvatar: false, SearchAuthor: true, SearchDescription: false, SearchTags: false, Provider: "vrcx");
        foreach (var provider in new[] { "vrcx", "avtrzip", "pas" })
        {
            try
            {
                var result = provider switch
                {
                    "avtrzip" => await SearchAvtrZipAsync(input with { Provider = provider }, vrchat),
                    "pas" => await SearchPasAsync(input with { Provider = provider }, vrchat),
                    _ => await SearchRemoteVrcxAsync(input with { Provider = provider }, vrchat)
                };
                var match = result.Results.FirstOrDefault(avatar =>
                    (!string.IsNullOrWhiteSpace(avatarId) && (string.Equals(avatar.AvatarId, avatarId, StringComparison.OrdinalIgnoreCase) || string.Equals(avatar.Id, avatarId, StringComparison.OrdinalIgnoreCase)))
                    || (!string.IsNullOrWhiteSpace(name) && string.Equals(avatar.Name, name, StringComparison.OrdinalIgnoreCase)));
                match ??= result.Results.FirstOrDefault(avatar => !string.IsNullOrWhiteSpace(avatar.AuthorName) && !avatar.AuthorName.StartsWith("usr_", StringComparison.OrdinalIgnoreCase));
                if (match is not null)
                {
                    if (vrchat is not null) await HydrateAvtrZipResultsAsync(new List<AvatarInput> { match }, vrchat);
                    return match;
                }
            }
            catch
            {
            }
        }
        return null;
    }

    private async Task<AvatarInput?> ResolveByAvatarIdAsync(string avatarId, VrChatClient? vrchat = null)
    {
        if (string.IsNullOrWhiteSpace(avatarId)) return null;
        var input = new AvatarSearchInput(avatarId.Trim(), Limit: 5, Page: 1, Provider: "vrcx");
        foreach (var provider in new[] { "vrcx", "avtrzip", "pas" })
        {
            try
            {
                var result = provider switch
                {
                    "avtrzip" => await SearchAvtrZipAsync(input with { Provider = provider }, vrchat),
                    "pas" => await SearchPasAsync(input with { Provider = provider }, vrchat),
                    _ => await SearchRemoteVrcxAsync(input with { Provider = provider }, vrchat)
                };
                var match = result.Results.FirstOrDefault(avatar => string.Equals(avatar.AvatarId, avatarId, StringComparison.OrdinalIgnoreCase) || string.Equals(avatar.Id, avatarId, StringComparison.OrdinalIgnoreCase));
                if (match is not null)
                {
                    if (vrchat is not null) await HydrateAvtrZipResultsAsync(new List<AvatarInput> { match }, vrchat);
                    return match;
                }
            }
            catch
            {
            }
        }
        return null;
    }

    public async Task<PasUpdateStatus> GetPasUpdateStatusAsync()
    {
        var local = TryReadPasDatabaseInfo(PasDatabasePath());
        try
        {
            var remote = await GetRemotePasDatabaseInfoAsync();
            return BuildPasUpdateStatus(local, remote, PasHasRemoteUpdate(local, remote));
        }
        catch (Exception ex)
        {
            if (local is null) throw new InvalidOperationException($"Could not check the Prismic PAS database. {ex.Message}");
            return BuildPasUpdateStatus(local, null, false, $"Could not check for a Prismic PAS update. {ex.Message}");
        }
    }

    public async Task<PasUpdateStatus> UpdatePasDatabaseAsync()
    {
        await QueryGate.WaitAsync();
        try
        {
            Directory.CreateDirectory(AppPaths.DatabaseDirectory);
            await DownloadPasDatabaseAsync(PasDatabasePath());
            PasCache = null;
            ClearAvatarDatabaseSearchCaches();
        }
        finally
        {
            QueryGate.Release();
        }

        return await GetPasUpdateStatusAsync();
    }

    private async Task<AvatarDatabaseSearchResult> SearchAllAsync(AvatarSearchInput input, VrChatClient? vrchat)
    {
        var page = Math.Max(1, input.Page);
        var limit = Math.Clamp(input.Limit <= 0 ? 50 : input.Limit, 1, 50);
        var targetCount = checked(page * limit + 1);
        var errors = new List<string>();
        var unique = new List<AvatarInput>();
        var byDuplicateKey = new Dictionary<string, AvatarInput>(StringComparer.OrdinalIgnoreCase);
        var providerHasMore = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase)
        {
            ["avtrzip"] = true,
            ["pas"] = true,
            ["vrcx"] = true
        };
        var providerErrors = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        for (var providerPage = 1; unique.Count < targetCount && providerHasMore.Values.Any(BooleanIdentity); providerPage++)
        {
            var pageResults = new List<(string Provider, AvatarDatabaseSearchResult Result)>();

            if (providerHasMore["avtrzip"])
            {
                try
                {
                    var result = await SearchAvtrZipAsync(input with { Provider = "avtrzip", Page = providerPage, Limit = limit }, vrchat);
                    pageResults.Add(("avtrzip", result));
                    providerHasMore["avtrzip"] = result.HasMore;
                }
                catch (Exception ex)
                {
                    providerHasMore["avtrzip"] = false;
                    if (providerErrors.Add("avtrzip")) errors.Add($"AVTRZIP: {ex.Message}");
                }
            }

            if (providerHasMore["pas"])
            {
                try
                {
                    var result = await SearchPasAsync(input with { Provider = "pas", Page = providerPage, Limit = limit }, vrchat);
                    pageResults.Add(("pas", result));
                    providerHasMore["pas"] = result.HasMore;
                }
                catch (Exception ex)
                {
                    providerHasMore["pas"] = false;
                    if (providerErrors.Add("pas")) errors.Add($"Prismic PAS: {ex.Message}");
                }
            }

            if (providerHasMore["vrcx"])
            {
                try
                {
                    var result = await SearchRemoteVrcxAsync(input with { Provider = "vrcx", Page = providerPage, Limit = limit }, vrchat);
                    pageResults.Add(("vrcx", result));
                    providerHasMore["vrcx"] = result.HasMore;
                }
                catch (Exception ex)
                {
                    providerHasMore["vrcx"] = false;
                    if (providerErrors.Add("vrcx")) errors.Add($"VRCX DB: {ex.Message}");
                }
            }

            AddDedupedAvatarResults(pageResults.Select(x => x.Result), unique, byDuplicateKey);

            if (pageResults.Count == 0) break;
            if (pageResults.All(x => x.Result.Results.Count == 0 && !x.Result.HasMore)) break;
        }

        var skip = (page - 1) * limit;
        var visiblePage = unique.Skip(skip).Take(limit).ToList();
        var hasMore = unique.Count > skip + limit || providerHasMore.Values.Any(BooleanIdentity);
        if (visiblePage.Count == 0 && errors.Count == 3) throw new InvalidOperationException(string.Join(" | ", errors));
        return new AvatarDatabaseSearchResult(visiblePage, page, hasMore, DateTimeOffset.UtcNow);
    }

    private async Task<AvatarDatabaseCountResult> CountAllAsync(AvatarSearchInput input, VrChatClient? vrchat)
    {
        var errors = new List<string>();
        var unique = new List<AvatarInput>();
        var byDuplicateKey = new Dictionary<string, AvatarInput>(StringComparer.OrdinalIgnoreCase);
        var providerHasMore = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase)
        {
            ["avtrzip"] = true,
            ["pas"] = true,
            ["vrcx"] = true
        };
        var providerErrors = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var limit = Math.Clamp(input.Limit <= 0 ? 50 : input.Limit, 1, 50);
        var progressKey = AllCountProgressKey(input);
        SetCountProgress(progressKey, 0, true, false);

        for (var providerPage = 1; providerHasMore.Values.Any(BooleanIdentity); providerPage++)
        {
            var pageResults = new List<AvatarDatabaseSearchResult>();
            if (providerHasMore["avtrzip"])
            {
                try
                {
                    var result = await SearchAvtrZipAsync(input with { Provider = "avtrzip", Page = providerPage, Limit = limit }, null);
                    pageResults.Add(result);
                    providerHasMore["avtrzip"] = result.HasMore;
                }
                catch (Exception ex)
                {
                    providerHasMore["avtrzip"] = false;
                    if (providerErrors.Add("avtrzip")) errors.Add($"AVTRZIP: {ex.Message}");
                }
            }

            if (providerHasMore["pas"])
            {
                try
                {
                    var result = await SearchPasAsync(input with { Provider = "pas", Page = providerPage, Limit = limit }, null);
                    pageResults.Add(result);
                    providerHasMore["pas"] = result.HasMore;
                }
                catch (Exception ex)
                {
                    providerHasMore["pas"] = false;
                    if (providerErrors.Add("pas")) errors.Add($"Prismic PAS: {ex.Message}");
                }
            }

            if (providerHasMore["vrcx"])
            {
                try
                {
                    var result = await SearchRemoteVrcxAsync(input with { Provider = "vrcx", Page = providerPage, Limit = limit }, null);
                    pageResults.Add(result);
                    providerHasMore["vrcx"] = result.HasMore;
                }
                catch (Exception ex)
                {
                    providerHasMore["vrcx"] = false;
                    if (providerErrors.Add("vrcx")) errors.Add($"VRCX DB: {ex.Message}");
                }
            }

            AddDedupedAvatarResults(pageResults, unique, byDuplicateKey);
            SetCountProgress(progressKey, unique.Count, true, false);
            if (pageResults.Count == 0) break;
            if (pageResults.All(x => x.Results.Count == 0 && !x.HasMore)) break;
        }

        if (unique.Count == 0 && errors.Count == 3)
        {
            SetCountProgress(progressKey, 0, false, true);
            throw new InvalidOperationException(string.Join(" | ", errors));
        }
        SetCountProgress(progressKey, unique.Count, false, true);
        return new AvatarDatabaseCountResult(input.Query?.Trim() ?? "", unique.Count, DateTimeOffset.UtcNow);
    }

    private static void SetCountProgress(string key, int discovered, bool counting, bool finished)
    {
        lock (CountProgressGate)
        {
            CountProgressCache[key] = new AvatarDatabaseCountProgress(Math.Max(0, discovered), counting, finished);
        }
    }

    private static string AllCountProgressKey(AvatarSearchInput input) =>
        $"all-count\n{input.Query?.Trim() ?? ""}\n{input.AuthorId?.Trim() ?? ""}\n{input.SearchAvatar}\n{input.SearchAuthor}\n{input.SearchDescription}\n{input.SearchTags}\n{input.SearchMode}\n{input.PlatformFilters}";

    private async Task<List<AvatarInput>> LoadSearchWindowAsync(AvatarSearchInput input, VrChatClient? vrchat, int maxPages)
    {
        var results = new List<AvatarInput>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var page = 1; page <= Math.Max(1, maxPages); page++)
        {
            var result = await SearchAsync(input with { Page = page }, vrchat);
            var added = 0;
            foreach (var avatar in result.Results)
            {
                var key = string.IsNullOrWhiteSpace(avatar.AvatarId) ? avatar.Id : avatar.AvatarId;
                if (string.IsNullOrWhiteSpace(key) || !seen.Add(key)) continue;
                results.Add(avatar);
                added++;
            }
            if (!result.HasMore) break;
            if (added == 0) break;
        }
        return results;
    }

    private static async Task<List<AvatarInput>> LoadPasSearchWindowAsync(AvatarSearchInput input)
    {
        var query = input.Query?.Trim() ?? "";
        if (query.Length > 0 && query.Length < 3 && !IsAuthorIdOnlySearch(input) && !HasOptionFilter(input)) throw new InvalidOperationException("Enter at least 3 characters to search the Prismic PAS database.");
        if (!HasSearchField(input)) throw new InvalidOperationException("Enable at least one search field.");
        await QueryGate.WaitAsync();
        try
        {
            var database = await LoadPasDatabaseAsync();
            var results = new List<AvatarInput>();
            for (var i = 0; i < database.FileAvatarCount; i++)
            {
                if (PasRecordMatches(database, i, input)) results.Add(ReadPasAvatar(database, i));
            }
            return results;
        }
        finally
        {
            QueryGate.Release();
        }
    }

    private async Task<AvatarDatabaseSearchResult> RandomAllAsync(AvatarSearchInput input, VrChatClient? vrchat)
    {
        var limit = Math.Clamp(input.Limit <= 0 ? 50 : input.Limit, 1, 50);
        var errors = new List<string>();
        var unique = new List<AvatarInput>();
        var byDuplicateKey = new Dictionary<string, AvatarInput>(StringComparer.OrdinalIgnoreCase);
        var providers = await RandomProviderWeightsAsync(input);
        var batchLimit = Math.Clamp(limit / 5, 5, 12);
        var maxAttempts = Math.Max(30, limit * 2);

        for (var attempt = 0; unique.Count < limit && attempt < maxAttempts && providers.Any(x => !x.Disabled); attempt++)
        {
            var provider = PickWeightedRandomProvider(providers);
            if (provider is null) break;

            try
            {
                var before = unique.Count;
                var result = await RandomAsync(input with { Provider = provider.Name, Limit = batchLimit }, vrchat);
                AddDedupedAvatarResults([result], unique, byDuplicateKey);
                var added = unique.Count - before;
                provider.EmptyBatches = added == 0 ? provider.EmptyBatches + 1 : 0;
                if (provider.EmptyBatches >= 5) provider.Disabled = true;
            }
            catch (Exception ex)
            {
                provider.Failures++;
                if (provider.Failures >= 2) provider.Disabled = true;
                if (!provider.ErrorRecorded)
                {
                    errors.Add($"{provider.Label}: {ex.Message}");
                    provider.ErrorRecorded = true;
                }
            }
        }

        Shuffle(unique);
        var results = unique.Take(limit).ToList();
        if (results.Count == 0 && errors.Count >= providers.Count) throw new InvalidOperationException(string.Join(" | ", errors));
        return new AvatarDatabaseSearchResult(results, 1, false, DateTimeOffset.UtcNow);
    }

    private static async Task<List<RandomProviderState>> RandomProviderWeightsAsync(AvatarSearchInput input)
    {
        var pasWeight = 1;
        try
        {
            await QueryGate.WaitAsync();
            try
            {
                pasWeight = Math.Max(1, (await LoadPasDatabaseAsync()).FileAvatarCount);
            }
            finally
            {
                QueryGate.Release();
            }
        }
        catch
        {
            pasWeight = 1;
        }

        return
        [
            new("vrcx", "VRCX DB", VrcxRemoteRandomPageCeiling * VrcxRemotePageSize),
            new("avtrzip", "AVTRZIP", VrcxRemoteRandomPageCeiling * VrcxRemotePageSize),
            new("pas", "Prismic PAS", pasWeight)
        ];
    }

    private static RandomProviderState? PickWeightedRandomProvider(List<RandomProviderState> providers)
    {
        var active = providers.Where(x => !x.Disabled).ToList();
        if (active.Count == 0) return null;
        var total = active.Sum(x => Math.Max(1, x.Weight));
        var roll = Random.Shared.Next(total);
        foreach (var provider in active)
        {
            roll -= Math.Max(1, provider.Weight);
            if (roll < 0) return provider;
        }
        return active[^1];
    }

    private sealed class RandomProviderState(string name, string label, int weight)
    {
        public string Name { get; } = name;
        public string Label { get; } = label;
        public int Weight { get; } = Math.Max(1, weight);
        public int Failures { get; set; }
        public int EmptyBatches { get; set; }
        public bool Disabled { get; set; }
        public bool ErrorRecorded { get; set; }
    }

    private static async Task<AvatarDatabaseSearchResult> SearchPasAsync(AvatarSearchInput input, VrChatClient? vrchat)
    {
        var query = input.Query?.Trim() ?? "";
        if (query.Length > 0 && query.Length < 3 && !IsAuthorIdOnlySearch(input) && !HasOptionFilter(input)) throw new InvalidOperationException("Enter at least 3 characters to search the Prismic PAS database.");
        if (!HasSearchField(input)) throw new InvalidOperationException("Enable at least one search field.");
        var page = Math.Max(1, input.Page);
        var limit = Math.Clamp(input.Limit <= 0 ? 50 : input.Limit, 1, 50);
        var cacheKey = PasCacheKey(input, page, limit);
        if (Cache.TryGetValue(cacheKey, out var cached) && DateTimeOffset.UtcNow - cached.CachedAt < TimeSpan.FromMinutes(10))
        {
            if (vrchat is not null) await HydrateAvtrZipResultsAsync(cached.Results, vrchat);
            return cached with { CachedAt = DateTimeOffset.UtcNow };
        }

        await QueryGate.WaitAsync();
        try
        {
            var database = await LoadPasDatabaseAsync();
            var result = QueryPasDatabase(database, input, page, limit);
            if (vrchat is not null) await HydrateAvtrZipResultsAsync(result.Results, vrchat);
            Cache[cacheKey] = result;
            return result;
        }
        finally
        {
            QueryGate.Release();
        }
    }

    private static async Task<AvatarDatabaseCountResult> CountPasAsync(AvatarSearchInput input)
    {
        var query = input.Query?.Trim() ?? "";
        if (query.Length > 0 && query.Length < 3 && !IsAuthorIdOnlySearch(input) && !HasOptionFilter(input)) throw new InvalidOperationException("Enter at least 3 characters to search the Prismic PAS database.");
        if (!HasSearchField(input)) throw new InvalidOperationException("Enable at least one search field.");
        var countKey = PasCacheKey(input, 1, 50);
        if (CountCache.TryGetValue(countKey, out var cached) && DateTimeOffset.UtcNow - cached.CachedAt < TimeSpan.FromMinutes(10)) return cached;

        await QueryGate.WaitAsync();
        try
        {
            var database = await LoadPasDatabaseAsync();
            var total = CountPasDatabase(database, input);
            var count = new AvatarDatabaseCountResult(query, total, DateTimeOffset.UtcNow);
            CountCache[countKey] = count;
            return count;
        }
        finally
        {
            QueryGate.Release();
        }
    }

    private static async Task<AvatarDatabaseSearchResult> RandomPasAsync(AvatarSearchInput input, VrChatClient? vrchat)
    {
        var limit = Math.Clamp(input.Limit <= 0 ? 50 : input.Limit, 1, 50);
        await QueryGate.WaitAsync();
        try
        {
            var database = await LoadPasDatabaseAsync();
            var used = new HashSet<int>();
            var results = new List<AvatarInput>();
            var maxAttempts = Math.Min(database.FileAvatarCount, limit * 8);
            for (var attempts = 0; results.Count < limit && attempts < maxAttempts; attempts++)
            {
                var index = Random.Shared.Next(database.FileAvatarCount);
                if (!used.Add(index)) continue;
                results.Add(ReadPasAvatar(database, index));
            }

            if (vrchat is not null) await HydrateAvtrZipResultsAsync(results, vrchat);
            return new AvatarDatabaseSearchResult(results, 1, false, DateTimeOffset.UtcNow);
        }
        finally
        {
            QueryGate.Release();
        }
    }

    private static async Task<AvatarDatabaseSearchResult> RandomRemoteVrcxAsync(AvatarSearchInput input, VrChatClient? vrchat)
    {
        var limit = Math.Clamp(input.Limit <= 0 ? 50 : input.Limit, 1, 50);
        var queryInput = input with { Query = string.IsNullOrWhiteSpace(input.Query) ? "avatar" : input.Query, Limit = VrcxRemotePageSize };
        var results = new List<AvatarInput>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var attempts = Math.Clamp((int)Math.Ceiling(limit / 10.0) + 2, 3, 7);

        for (var attempt = 0; results.Count < limit && attempt < attempts; attempt++)
        {
            var page = Random.Shared.Next(1, VrcxRemoteRandomPageCeiling + 1);
            List<AvatarInput> pageResults;
            try
            {
                pageResults = await LoadRemoteVrcxAvatarsAsync(queryInput, page, VrcxRemotePageSize);
            }
            catch
            {
                continue;
            }

            if (pageResults.Count == 0) continue;
            Shuffle(pageResults);
            foreach (var avatar in pageResults.Take(12))
            {
                var key = string.IsNullOrWhiteSpace(avatar.AvatarId) ? avatar.Id : avatar.AvatarId;
                if (string.IsNullOrWhiteSpace(key) || !seen.Add(key)) continue;
                results.Add(avatar);
                if (results.Count >= limit) break;
            }
        }

        if (results.Count < Math.Min(limit, 10))
        {
            for (var page = 1; results.Count < limit && page <= 8; page++)
            {
                List<AvatarInput> pageResults;
                try
                {
                    pageResults = await LoadRemoteVrcxAvatarsAsync(queryInput, page, VrcxRemotePageSize);
                }
                catch
                {
                    continue;
                }
                Shuffle(pageResults);
                foreach (var avatar in pageResults.Take(12))
                {
                    var key = string.IsNullOrWhiteSpace(avatar.AvatarId) ? avatar.Id : avatar.AvatarId;
                    if (string.IsNullOrWhiteSpace(key) || !seen.Add(key)) continue;
                    results.Add(avatar);
                    if (results.Count >= limit) break;
                }
            }
        }

        Shuffle(results);
        if (vrchat is not null) await HydrateAvtrZipResultsAsync(results, vrchat);
        return new AvatarDatabaseSearchResult(results.Take(limit).ToList(), 1, false, DateTimeOffset.UtcNow);
    }

    private static AvatarDatabaseSearchResult QueryPasDatabase(PasDatabaseData database, AvatarSearchInput input, int page, int limit)
    {
        var skip = (page - 1) * limit;
        var seen = 0;
        var results = new List<AvatarInput>();
        for (var i = 0; i < database.FileAvatarCount; i++)
        {
            if (!PasRecordMatches(database, i, input)) continue;
            if (seen++ < skip) continue;
            results.Add(ReadPasAvatar(database, i));
            if (results.Count > limit) break;
        }

        var hasMore = results.Count > limit;
        if (hasMore) results.RemoveAt(results.Count - 1);
        return new AvatarDatabaseSearchResult(results, page, hasMore, DateTimeOffset.UtcNow);
    }

    private static int CountPasDatabase(PasDatabaseData database, AvatarSearchInput input)
    {
        var total = 0;
        for (var i = 0; i < database.FileAvatarCount; i++)
        {
            if (PasRecordMatches(database, i, input)) total++;
        }
        return total;
    }

    private static bool PasRecordMatches(PasDatabaseData database, int index, AvatarSearchInput input)
    {
        if (IsAuthorIdOnlySearch(input)) return false;
        var query = input.Query?.Trim() ?? "";
        var textMatches = query.Length == 0;
        if (input.SearchAvatar)
        {
            if (TextMatches(query, input.SearchMode, ReverseText(database.AvatarNames[index]), DecodePasAvatarId(database, index))) textMatches = true;
        }

        if (input.SearchAuthor)
        {
            var authorIndex = database.AuthorIds[index];
            if (authorIndex < (uint)database.AuthorNames.Length && TextMatches(query, input.SearchMode, ReverseText(database.AuthorNames[(int)authorIndex]))) textMatches = true;
        }

        if (input.SearchTags && TextMatches(query, input.SearchMode, PasTags(database))) textMatches = true;
        if (!textMatches) return false;
        return MatchesPlatformFilters(database.PlatformLabel, input);
    }

    private static AvatarInput ReadPasAvatar(PasDatabaseData database, int index)
    {
        var id = DecodePasAvatarId(database, index);
        var authorIndex = database.AuthorIds[index];
        var authorName = authorIndex < (uint)database.AuthorNames.Length ? ReverseText(database.AuthorNames[(int)authorIndex]) : "";
        var name = index < database.AvatarNames.Length ? ReverseText(database.AvatarNames[index]) : id;
        var raw = new Dictionary<string, object?>
        {
            ["id"] = id,
            ["name"] = name,
            ["authorName"] = authorName,
            ["platform"] = database.PlatformLabel,
            ["pasFileDate"] = database.FileDate,
            ["pasIndex"] = index
        };

        return new AvatarInput
        {
            AvatarId = id,
            Name = string.IsNullOrWhiteSpace(name) ? id : name,
            AuthorName = authorName,
            ReleaseStatus = "public",
            Platforms = database.PlatformLabel,
            Tags = PasTags(database),
            SourceUrl = $"https://vrchat.com/home/avatar/{id}",
            Notes = $"Found in Prismic AvatarSearch PAS database ({database.PlatformLabel}, {database.FileDate}).",
            RawJson = JsonSerializer.Serialize(raw, ProgramJson.Options),
            Source = "pas",
            RemoteUpdatedAt = database.FileDate
        };
    }

    private static PasUpdateStatus BuildPasUpdateStatus(PasDatabaseInfo? local, PasDatabaseInfo? remote, bool hasUpdate, string message = "")
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            if (local is null) message = "Prismic PAS is not cached yet.";
            else if (hasUpdate) message = $"Prismic PAS update available ({PasInfoLabel(local, "local cache")} -> {PasInfoLabel(remote, "remote database")}).";
            else message = "Prismic PAS is up to date.";
        }

        return new PasUpdateStatus(
            local is not null,
            hasUpdate,
            local?.FileDate ?? "",
            remote?.FileDate ?? "",
            local?.ContentLength ?? 0,
            remote?.ContentLength ?? 0,
            remote?.Location ?? PasDatabasePrimaryUrl,
            message);
    }

    private static string PasInfoLabel(PasDatabaseInfo? info, string fallback)
    {
        if (info is null) return fallback;
        if (!string.IsNullOrWhiteSpace(info.FileDate)) return info.FileDate;
        return info.ContentLength > 0 ? $"{info.ContentLength:n0} bytes" : fallback;
    }

    private static bool PasHasRemoteUpdate(PasDatabaseInfo? local, PasDatabaseInfo remote)
    {
        if (local is null) return true;
        if (!string.IsNullOrWhiteSpace(local.FileDate) && !string.IsNullOrWhiteSpace(remote.FileDate))
        {
            var dateComparison = string.Compare(remote.FileDate, local.FileDate, StringComparison.Ordinal);
            if (dateComparison > 0) return true;
            if (dateComparison < 0) return false;
        }

        if (remote.ContentLength > 0 && local.ContentLength > 0 && remote.ContentLength != local.ContentLength) return true;
        if (remote.LastModifiedUtc is { } remoteModified && local.LastModifiedUtc is { } localModified)
        {
            return remoteModified.UtcDateTime > localModified.UtcDateTime.AddMinutes(1);
        }

        return false;
    }

    private static async Task<PasDatabaseInfo> GetRemotePasDatabaseInfoAsync()
    {
        Exception? lastError = null;
        foreach (var url in new[] { PasDatabasePrimaryUrl, PasDatabaseBackupUrl })
        {
            try
            {
                return await GetRemotePasDatabaseInfoAsync(url);
            }
            catch (Exception ex)
            {
                lastError = ex;
            }
        }

        throw new InvalidOperationException(lastError?.Message ?? "No Prismic PAS endpoint responded.");
    }

    private static async Task<PasDatabaseInfo> GetRemotePasDatabaseInfoAsync(string url)
    {
        long metadataLength = 0;
        DateTimeOffset? metadataModified = null;
        var metadataETag = "";

        try
        {
            using var headRequest = new HttpRequestMessage(HttpMethod.Head, url);
            using var headResponse = await PasHttp.SendAsync(headRequest, HttpCompletionOption.ResponseHeadersRead);
            if (headResponse.IsSuccessStatusCode)
            {
                metadataLength = headResponse.Content.Headers.ContentLength ?? 0;
                metadataModified = headResponse.Content.Headers.LastModified;
                metadataETag = headResponse.Headers.ETag?.Tag ?? "";
            }
        }
        catch
        {
            metadataLength = 0;
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Range = new RangeHeaderValue(0, 35);
        using var response = await PasHttp.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"HTTP {(int)response.StatusCode} from {url}");

        var contentLength = response.Content.Headers.ContentLength;
        var totalLength = response.Content.Headers.ContentRange?.Length ?? (response.StatusCode == HttpStatusCode.PartialContent ? 0 : contentLength) ?? metadataLength;
        var modified = response.Content.Headers.LastModified ?? metadataModified;
        var etag = response.Headers.ETag?.Tag ?? metadataETag;
        if (response.StatusCode == HttpStatusCode.PartialContent || (contentLength is > 0 and <= 4096))
        {
            var bytes = await response.Content.ReadAsByteArrayAsync();
            if (bytes.Length >= 36) return ReadPasDatabaseInfo(bytes, url, totalLength > 0 ? totalLength : bytes.Length, modified, etag, true);
        }

        if (totalLength > 0) return new PasDatabaseInfo(url, "", totalLength, modified, etag, 0, 0, 0, 0, false);
        throw new InvalidOperationException($"Could not read the Prismic PAS header from {url}.");
    }

    private static PasDatabaseInfo? TryReadPasDatabaseInfo(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            using var stream = File.OpenRead(path);
            if (stream.Length < 36) return null;
            var header = new byte[36];
            stream.ReadExactly(header);
            return ReadPasDatabaseInfo(header, path, stream.Length, new DateTimeOffset(File.GetLastWriteTimeUtc(path)), "", true);
        }
        catch
        {
            return null;
        }
    }

    private static PasDatabaseInfo ReadPasDatabaseInfo(byte[] bytes, string location, long contentLength, DateTimeOffset? lastModifiedUtc, string etag, bool headerVerified)
    {
        if (bytes.Length < 36 || Encoding.UTF8.GetString(bytes, 0, 3) != "PAS") throw new InvalidOperationException("response was not a PAS database");
        return new PasDatabaseInfo(
            location,
            ReadPasDate(bytes, 11),
            contentLength,
            lastModifiedUtc,
            etag,
            ReadUInt24BigEndian(bytes, 5),
            ReadUInt24BigEndian(bytes, 8),
            ReadUInt24BigEndian(bytes, 13),
            ReadUInt24BigEndian(bytes, 16),
            headerVerified);
    }

    private static void ClearAvatarDatabaseSearchCaches()
    {
        Cache.Clear();
        CountCache.Clear();
    }

    private static async Task<PasDatabaseData> LoadPasDatabaseAsync()
    {
        if (PasCache is not null) return PasCache;
        var path = PasDatabasePath();
        Directory.CreateDirectory(AppPaths.DatabaseDirectory);
        if (!File.Exists(path) || new FileInfo(path).Length == 0)
        {
            await DownloadPasDatabaseAsync(path);
        }

        try
        {
            PasCache = ParsePasDatabase(await File.ReadAllBytesAsync(path), path);
            return PasCache;
        }
        catch
        {
            await DownloadPasDatabaseAsync(path);
            PasCache = ParsePasDatabase(await File.ReadAllBytesAsync(path), path);
            return PasCache;
        }
    }

    private static async Task DownloadPasDatabaseAsync(string path)
    {
        Exception? lastError = null;
        foreach (var url in new[] { PasDatabasePrimaryUrl, PasDatabaseBackupUrl })
        {
            try
            {
                using var response = await PasHttp.GetAsync(url);
                var lastModified = response.Content.Headers.LastModified;
                var bytes = await response.Content.ReadAsByteArrayAsync();
                if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"HTTP {(int)response.StatusCode}");
                if (bytes.Length < 36 || Encoding.UTF8.GetString(bytes, 0, 3) != "PAS") throw new InvalidOperationException("response was not a PAS database");
                var temp = path + ".download";
                await File.WriteAllBytesAsync(temp, bytes);
                File.Move(temp, path, true);
                if (lastModified is not null) File.SetLastWriteTimeUtc(path, lastModified.Value.UtcDateTime);
                return;
            }
            catch (Exception ex)
            {
                lastError = ex;
            }
        }

        throw new InvalidOperationException($"Could not download the Prismic PAS database. Last error: {lastError?.Message ?? "unknown error"}");
    }

    private static PasDatabaseData ParsePasDatabase(byte[] bytes, string path)
    {
        if (bytes.Length < 36 || Encoding.UTF8.GetString(bytes, 0, 3) != "PAS") throw new InvalidOperationException("The Prismic PAS database file is invalid.");
        var version = (bytes[3] >> 5) & 31;
        var platform = bytes[3] & 7;
        var offset = 5;
        var avatarCount = ReadUInt24BigEndian(bytes, offset);
        offset += 3;
        var authorCount = ReadUInt24BigEndian(bytes, offset);
        offset += 3;
        var fileDate = ReadPasDate(bytes, offset);
        offset += 2;
        var fileAvatars = ReadUInt24BigEndian(bytes, offset);
        offset += 3;
        var fileAuthors = ReadUInt24BigEndian(bytes, offset);
        offset += 3;
        var flagSize = bytes[offset++];
        var randomBytes = bytes.Skip(offset).Take(16).ToArray();
        offset += 16;
        var dynamicBytes = BuildPasDynamicBytes(version, flagSize, randomBytes);

        var avatarIdLength = checked(fileAvatars * 16);
        var avatarIds = new byte[avatarIdLength];
        Buffer.BlockCopy(bytes, offset, avatarIds, 0, avatarIdLength);
        offset += avatarIdLength;
        offset += checked(fileAvatars * flagSize);

        var authorIds = new uint[fileAvatars];
        for (var i = 0; i < authorIds.Length; i++)
        {
            authorIds[i] = BitConverter.ToUInt32(bytes, offset + (i * 4));
        }
        offset += checked(fileAvatars * 4);

        var text = Encoding.UTF8.GetString(bytes, offset, bytes.Length - offset);
        var textSections = text.Split('\n', 2);
        if (textSections.Length < 2) throw new InvalidOperationException("The Prismic PAS database text section is invalid.");
        var authorNames = textSections[0].Split('\r');
        var avatarNames = textSections[1].Split('\r');
        if (avatarNames.Length < fileAvatars || authorNames.Length < fileAuthors) throw new InvalidOperationException("The Prismic PAS database row counts do not match the header.");

        return new PasDatabaseData(path, PlatformLabelFromPas(platform), fileDate, avatarCount, authorCount, fileAvatars, fileAuthors, dynamicBytes, avatarIds, authorIds, avatarNames, authorNames);
    }

    private static byte[] BuildPasDynamicBytes(int version, int flagSize, byte[] randomBytes)
    {
        byte[] staticBytes = [208, 29, 107, 36, 251, 69, 122, 14, 67, 204, 171, 246, 106, 38, 183, 224];
        var dynamicBytes = new byte[16];
        for (var i = 0; i < dynamicBytes.Length; i++)
        {
            dynamicBytes[i] = version == 0
                ? (byte)(staticBytes[i] ^ randomBytes[i])
                : (byte)(((byte)(staticBytes[(i + version) % 16] + flagSize)) ^ randomBytes[i]);
        }
        return dynamicBytes;
    }

    private static string DecodePasAvatarId(PasDatabaseData database, int index)
    {
        Span<byte> data = stackalloc byte[16];
        database.AvatarIds.AsSpan(index * 16, 16).CopyTo(data);
        for (var i = data.Length - 1; i >= 0; i--)
        {
            var previousIndex = (i + data.Length - 1) % data.Length;
            data[i] = (byte)(data[i] ^ data[previousIndex] ^ database.DynamicBytes[i]);
        }

        Span<char> reversedHex = stackalloc char[32];
        var p = reversedHex.Length - 1;
        for (var i = 0; i < data.Length; i++)
        {
            reversedHex[p--] = HexChar(data[i] >> 4);
            reversedHex[p--] = HexChar(data[i] & 15);
        }

        var raw = new string(reversedHex);
        return $"avtr_{raw[..8]}-{raw[8..12]}-{raw[12..16]}-{raw[16..20]}-{raw[20..]}";
    }

    private static char HexChar(int value) => (char)(value < 10 ? '0' + value : 'a' + value - 10);
    private static int ReadUInt24BigEndian(byte[] bytes, int offset) => (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
    private static string ReadPasDate(byte[] bytes, int offset)
    {
        var packed = ((bytes[offset] << 8) | bytes[offset + 1]) >> 3;
        return $"20{((packed >> 9) + 16):00}-{((packed >> 5) & 15):00}-{(packed & 31):00}";
    }
    private static string ReverseText(string value)
    {
        var chars = value.ToCharArray();
        Array.Reverse(chars);
        return new string(chars);
    }
    private static string PlatformLabelFromPas(int platform) => platform switch
    {
        2 => "Android",
        4 => "iOS",
        7 => "PC",
        _ => $"PAS {platform}"
    };
    private static string PasTags(PasDatabaseData database) => $"prismic pas, avatarsearch, {database.PlatformLabel}";
    private static bool LooksLikeAvatarIdQuery(string query) => query.StartsWith("avtr", StringComparison.OrdinalIgnoreCase);
    private static string PasDatabasePath() => Path.Combine(AppPaths.DatabaseDirectory, PasDatabaseFileName);
    private static string PasCacheKey(AvatarSearchInput input, int page, int limit)
    {
        var path = PasDatabasePath();
        var stamp = File.Exists(path) ? File.GetLastWriteTimeUtc(path).Ticks : 0;
        return $"pas\n{path}\n{stamp}\n{input.Query?.Trim() ?? ""}\n{input.AuthorId?.Trim() ?? ""}\n{input.SearchAvatar}\n{input.SearchAuthor}\n{input.SearchDescription}\n{input.SearchTags}\n{input.SearchMode}\n{input.PlatformFilters}\n{page}\n{limit}";
    }

    private static List<AvatarInput> MergeAvatarResults(IEnumerable<AvatarInput> results, int limit)
    {
        var merged = new List<AvatarInput>();
        var byAvatarId = new Dictionary<string, AvatarInput>(StringComparer.OrdinalIgnoreCase);
        foreach (var avatar in results)
        {
            var key = avatar.AvatarId;
            if (string.IsNullOrWhiteSpace(key)) key = avatar.Id;
            if (string.IsNullOrWhiteSpace(key)) continue;
            if (byAvatarId.TryGetValue(key, out var existing))
            {
                MergeAvatarResultData(existing, avatar);
                continue;
            }

            if (merged.Count >= limit) continue;
            byAvatarId[key] = avatar;
            merged.Add(avatar);
        }
        return merged;
    }

    private static void Shuffle<T>(IList<T> items)
    {
        for (var i = items.Count - 1; i > 0; i--)
        {
            var j = Random.Shared.Next(i + 1);
            (items[i], items[j]) = (items[j], items[i]);
        }
    }

    private static List<AvatarInput> HideDuplicateAvatarResults(IReadOnlyList<AvatarDatabaseSearchResult> providerPages, int limit, out bool hiddenOverflow)
    {
        var unique = new List<AvatarInput>();
        var byDuplicateKey = new Dictionary<string, AvatarInput>(StringComparer.OrdinalIgnoreCase);
        AddDedupedAvatarResults(providerPages, unique, byDuplicateKey);

        hiddenOverflow = unique.Count > limit;
        return unique.Take(limit).ToList();
    }

    private static void AddDedupedAvatarResults(IEnumerable<AvatarDatabaseSearchResult> providerPages, List<AvatarInput> unique, Dictionary<string, AvatarInput> byDuplicateKey)
    {
        var pages = providerPages.ToList();
        if (pages.Count == 0) return;
        var maxResults = pages.Max(x => x.Results.Count);
        for (var index = 0; index < maxResults; index++)
        {
            foreach (var page in pages)
            {
                if (index >= page.Results.Count) continue;
                var avatar = page.Results[index];
                var keys = AvatarDuplicateKeys(avatar).ToList();
                var existing = keys
                    .Select(key => byDuplicateKey.TryGetValue(key, out var found) ? found : null)
                    .FirstOrDefault(found => found is not null);
                if (existing is not null)
                {
                    AddHiddenDuplicateBadges(existing, avatar);
                    continue;
                }

                foreach (var key in keys) byDuplicateKey.TryAdd(key, avatar);
                unique.Add(avatar);
            }
        }
    }

    private static bool BooleanIdentity(bool value) => value;

    private static IEnumerable<string> AvatarDuplicateKeys(AvatarInput avatar)
    {
        var id = string.IsNullOrWhiteSpace(avatar.AvatarId) ? avatar.Id : avatar.AvatarId;
        if (!string.IsNullOrWhiteSpace(id)) yield return "id:" + id.Trim();

        var name = NormalizeDuplicateText(avatar.Name);
        var image = NormalizeDuplicateImageUrl(string.IsNullOrWhiteSpace(avatar.ThumbnailImageUrl) ? avatar.ImageUrl : avatar.ThumbnailImageUrl);
        if (!string.IsNullOrWhiteSpace(name) && !string.IsNullOrWhiteSpace(image))
        {
            var author = NormalizeDuplicateText(avatar.AuthorName);
            yield return $"visual:{name}|{author}|{image}";
            yield return $"visual-name:{name}|{image}";
        }

        var authorName = NormalizeDuplicateText(avatar.AuthorName);
        if (!string.IsNullOrWhiteSpace(name) && !string.IsNullOrWhiteSpace(authorName))
        {
            yield return $"name-author:{name}|{authorName}";
        }
    }

    private static string NormalizeDuplicateText(string? value) =>
        string.Concat((value ?? "").Where(char.IsLetterOrDigit)).Trim().ToLowerInvariant();

    private static string NormalizeDuplicateImageUrl(string? value)
    {
        var text = (value ?? "").Trim();
        if (string.IsNullOrWhiteSpace(text)) return "";
        var queryIndex = text.IndexOf('?', StringComparison.Ordinal);
        if (queryIndex >= 0) text = text[..queryIndex];
        return text.TrimEnd('/').ToLowerInvariant();
    }

    private static void AddHiddenDuplicateBadges(AvatarInput target, AvatarInput hidden)
    {
        target.Source = MergeSourceTags(target.Source, hidden.Source);
        target.Platforms = MergeTagText(target.Platforms, hidden.Platforms);
        target.Tags = MergeTagText(target.Tags, hidden.Tags);
        if (string.IsNullOrWhiteSpace(target.Name)) target.Name = hidden.Name;
        if (string.IsNullOrWhiteSpace(target.AuthorId)) target.AuthorId = hidden.AuthorId;
        if (string.IsNullOrWhiteSpace(target.AuthorName)) target.AuthorName = hidden.AuthorName;
        if (string.IsNullOrWhiteSpace(target.Description)) target.Description = hidden.Description;
        if (string.IsNullOrWhiteSpace(target.ImageUrl)) target.ImageUrl = hidden.ImageUrl;
        if (string.IsNullOrWhiteSpace(target.ThumbnailImageUrl)) target.ThumbnailImageUrl = string.IsNullOrWhiteSpace(hidden.ThumbnailImageUrl) ? hidden.ImageUrl : hidden.ThumbnailImageUrl;
        target.ReleaseStatus = PreferredReleaseStatus(target.ReleaseStatus, hidden.ReleaseStatus);
        if (string.IsNullOrWhiteSpace(target.Version)) target.Version = hidden.Version;
        if (string.IsNullOrWhiteSpace(target.SourceUrl)) target.SourceUrl = hidden.SourceUrl;
        if (string.IsNullOrWhiteSpace(target.RawJson)) target.RawJson = hidden.RawJson;
    }

    private static void MergeAvatarResultData(AvatarInput target, AvatarInput incoming)
    {
        target.Source = MergeSourceTags(target.Source, incoming.Source);
        if (string.IsNullOrWhiteSpace(target.Id)) target.Id = incoming.Id;
        if (string.IsNullOrWhiteSpace(target.GroupId)) target.GroupId = incoming.GroupId;
        if (string.IsNullOrWhiteSpace(target.Name)) target.Name = incoming.Name;
        if (string.IsNullOrWhiteSpace(target.Description)) target.Description = incoming.Description;
        if (string.IsNullOrWhiteSpace(target.AuthorId)) target.AuthorId = incoming.AuthorId;
        if (string.IsNullOrWhiteSpace(target.AuthorName)) target.AuthorName = incoming.AuthorName;
        if (string.IsNullOrWhiteSpace(target.ImageUrl)) target.ImageUrl = incoming.ImageUrl;
        if (string.IsNullOrWhiteSpace(target.ThumbnailImageUrl)) target.ThumbnailImageUrl = incoming.ThumbnailImageUrl;
        target.ReleaseStatus = PreferredReleaseStatus(target.ReleaseStatus, incoming.ReleaseStatus);
        if (string.IsNullOrWhiteSpace(target.Version)) target.Version = incoming.Version;
        target.Platforms = MergeTagText(target.Platforms, incoming.Platforms);
        target.Tags = MergeTagText(target.Tags, incoming.Tags);
        if (string.IsNullOrWhiteSpace(target.SourceUrl)) target.SourceUrl = incoming.SourceUrl;
        if (string.IsNullOrWhiteSpace(target.Notes)) target.Notes = incoming.Notes;
        if (string.IsNullOrWhiteSpace(target.RawJson)) target.RawJson = incoming.RawJson;
        if (string.IsNullOrWhiteSpace(target.RemoteCreatedAt)) target.RemoteCreatedAt = incoming.RemoteCreatedAt;
        if (string.IsNullOrWhiteSpace(target.RemoteUpdatedAt)) target.RemoteUpdatedAt = incoming.RemoteUpdatedAt;
        if (string.IsNullOrWhiteSpace(target.RemoteFavoriteId)) target.RemoteFavoriteId = incoming.RemoteFavoriteId;
    }

    private static string PreferredReleaseStatus(string? current, string? incoming)
    {
        var currentValue = current?.Trim() ?? "";
        var incomingValue = incoming?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(incomingValue)) return currentValue;
        if (IsUnavailableDatabaseReleaseStatus(incomingValue) && !IsUnavailableDatabaseReleaseStatus(currentValue)) return incomingValue;
        if (string.IsNullOrWhiteSpace(currentValue)) return incomingValue;
        if (currentValue.Equals("public", StringComparison.OrdinalIgnoreCase) && !incomingValue.Equals("public", StringComparison.OrdinalIgnoreCase)) return incomingValue;
        return currentValue;
    }

    private static bool IsUnavailableDatabaseReleaseStatus(string? status)
    {
        var value = status?.Trim() ?? "";
        return value.Equals("hidden", StringComparison.OrdinalIgnoreCase)
            || value.Equals("private", StringComparison.OrdinalIgnoreCase)
            || value.Equals("deleted", StringComparison.OrdinalIgnoreCase)
            || value.Equals("unavailable", StringComparison.OrdinalIgnoreCase);
    }

    private static string MergeSourceTags(params string[] sources) =>
        string.Join(", ", sources
            .SelectMany(x => (x ?? "").Split(new[] { ',', '+', '|', ';' }, StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
            .Distinct(StringComparer.OrdinalIgnoreCase));

    private static string MergeTagText(params string[] tagSets) =>
        string.Join(", ", tagSets
            .SelectMany(x => (x ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
            .Distinct(StringComparer.OrdinalIgnoreCase));

    private static async Task<AvatarDatabaseSearchResult> SearchAvtrZipAsync(AvatarSearchInput input, VrChatClient? vrchat)
    {
        var query = input.Query?.Trim() ?? "";
        if (query.Length > 0 && query.Length < 3 && !IsAuthorNameOnlySearch(input) && !HasOptionFilter(input)) throw new InvalidOperationException("Enter at least 3 characters to search the AVTRZIP database.");
        if (!HasSearchField(input)) throw new InvalidOperationException("Enable at least one search field.");
        var page = Math.Max(1, input.Page);
        var cacheKey = AvtrZipCacheKey(input, page, Math.Clamp(input.Limit <= 0 ? 50 : input.Limit, 1, 50));
        if (Cache.TryGetValue(cacheKey, out var cached) && DateTimeOffset.UtcNow - cached.CachedAt < TimeSpan.FromMinutes(3))
        {
            if (vrchat is not null) await HydrateAvtrZipResultsAsync(cached.Results, vrchat);
            return cached with { CachedAt = DateTimeOffset.UtcNow };
        }

        await QueryGate.WaitAsync();
        try
        {
            var avtrZipPage = IsAuthorNameOnlySearch(input)
                ? await QueryAvtrZipAuthorAvatarsAsync(query, page)
                : await QueryAvtrZipAvatarsAsync(query, page);
            if (vrchat is not null) await HydrateAvtrZipResultsAsync(avtrZipPage.Result.Results, vrchat);
            var result = avtrZipPage.Result with { Results = avtrZipPage.Result.Results.Where(x => AvatarMatchesSearch(x, input)).ToList() };
            Cache[cacheKey] = result;
            return result;
        }
        finally
        {
            QueryGate.Release();
        }
    }

    private static async Task<AvatarDatabaseCountResult> CountAvtrZipAsync(AvatarSearchInput input, VrChatClient? vrchat)
    {
        var query = input.Query?.Trim() ?? "";
        if (query.Length > 0 && query.Length < 3 && !IsAuthorNameOnlySearch(input) && !HasOptionFilter(input)) throw new InvalidOperationException("Enter at least 3 characters to search the AVTRZIP database.");
        if (!HasSearchField(input)) throw new InvalidOperationException("Enable at least one search field.");
        var countKey = AvtrZipCacheKey(input, 1, 50);
        if (CountCache.TryGetValue(countKey, out var cached) && DateTimeOffset.UtcNow - cached.CachedAt < TimeSpan.FromMinutes(3)) return cached;

        await QueryGate.WaitAsync();
        try
        {
            var page = IsAuthorNameOnlySearch(input)
                ? await QueryAvtrZipAuthorAvatarsAsync(query, 1)
                : await QueryAvtrZipAvatarsAsync(query, 1);
            var count = new AvatarDatabaseCountResult(query, page.TotalCount, DateTimeOffset.UtcNow);
            CountCache[countKey] = count;
            return count;
        }
        finally
        {
            QueryGate.Release();
        }
    }

    private static async Task<AvatarDatabaseSearchResult> RandomAvtrZipAsync(AvatarSearchInput input, VrChatClient? vrchat)
    {
        var limit = Math.Clamp(input.Limit <= 0 ? 50 : input.Limit, 1, 50);
        await QueryGate.WaitAsync();
        try
        {
            var firstPage = await LoadAvtrZipSearchPageAsync(AvtrZipSearchUrl(input.Query?.Trim() ?? ""));
            if (firstPage.RandomCode < 0) throw new InvalidOperationException("AVTRZIP did not return a random-page action.");
            var results = new List<AvatarInput>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var randomCode = firstPage.RandomCode;
            var attempts = Math.Max(10, limit / 4 + 6);

            for (var attempt = 0; results.Count < limit && attempt < attempts; attempt++)
            {
                var randomPage = await LoadAvtrZipSearchPageAsync(AvtrZipActionUrl(randomCode));
                if (randomPage.RandomCode >= 0) randomCode = randomPage.RandomCode;
                var pageResults = randomPage.Result.Results;
                Shuffle(pageResults);
                foreach (var avatar in pageResults.Take(5))
                {
                    var key = string.IsNullOrWhiteSpace(avatar.AvatarId) ? avatar.Id : avatar.AvatarId;
                    if (string.IsNullOrWhiteSpace(key) || !seen.Add(key)) continue;
                    results.Add(avatar);
                    if (results.Count >= limit) break;
                }
            }

            if (results.Count < limit)
            {
                Shuffle(firstPage.Result.Results);
                foreach (var avatar in firstPage.Result.Results)
                {
                    var key = string.IsNullOrWhiteSpace(avatar.AvatarId) ? avatar.Id : avatar.AvatarId;
                    if (string.IsNullOrWhiteSpace(key) || !seen.Add(key)) continue;
                    results.Add(avatar);
                    if (results.Count >= limit) break;
                }
            }

            Shuffle(results);
            var finalResults = results.Take(limit).ToList();
            if (vrchat is not null) await HydrateAvtrZipResultsAsync(finalResults, vrchat);
            return new AvatarDatabaseSearchResult(finalResults, 1, false, DateTimeOffset.UtcNow);
        }
        finally
        {
            QueryGate.Release();
        }
    }

    private static async Task<AvtrZipSearchPage> QueryAvtrZipAvatarsAsync(string query, int page)
    {
        var firstPage = await LoadAvtrZipSearchPageAsync(AvtrZipSearchUrl(query));
        if (page <= 1) return firstPage;
        if (firstPage.InputPageCode < 0) throw new InvalidOperationException("AVTRZIP did not return a page-jump action.");
        return await LoadAvtrZipSearchPageAsync(AvtrZipActionUrl(firstPage.InputPageCode, (page - 1).ToString()));
    }

    private static async Task<AvtrZipSearchPage> QueryAvtrZipAuthorAvatarsAsync(string query, int page)
    {
        var authorCode = await LoadAvtrZipAuthorSearchCodeAsync(query);
        if (authorCode < 0)
        {
            return new AvtrZipSearchPage(new AvatarDatabaseSearchResult([], 1, false, DateTimeOffset.UtcNow), 0, 0, -1, -1, -1);
        }

        var firstPage = await LoadAvtrZipSearchPageAsync(AvtrZipActionUrl(authorCode));
        if (page <= 1) return firstPage;
        if (firstPage.InputPageCode < 0) throw new InvalidOperationException("AVTRZIP did not return a page-jump action.");
        return await LoadAvtrZipSearchPageAsync(AvtrZipActionUrl(firstPage.InputPageCode, (page - 1).ToString()));
    }

    private static async Task<int> LoadAvtrZipAuthorSearchCodeAsync(string query)
    {
        var body = await GetAvtrZipStringAsync(AvtrZipAuthorUrl(query));
        using var document = JsonDocument.Parse(body);
        ThrowIfAvtrZipCaptcha(document.RootElement);
        var root = document.RootElement;
        if (!ReadString(root, "type").Equals("AuthorListing", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"AVTRZIP returned {ReadString(root, "type")} instead of author results.");
        }

        if (!root.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Array) return -1;
        JsonElement? fallback = null;
        foreach (var author in results.EnumerateArray())
        {
            fallback ??= author;
            if (ReadString(author, "name").Equals(query, StringComparison.OrdinalIgnoreCase)) return ReadCode(author, "search");
        }

        return fallback.HasValue ? ReadCode(fallback.Value, "search") : -1;
    }

    private static async Task<AvtrZipSearchPage> LoadAvtrZipSearchPageAsync(string url)
    {
        var body = await GetAvtrZipStringAsync(url);
        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;
        ThrowIfAvtrZipCaptcha(root);
        if (!ReadString(root, "type").Equals("SearchAvatars", StringComparison.OrdinalIgnoreCase))
        {
            var type = ReadString(root, "type");
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(type) ? "AVTRZIP returned an unexpected response." : $"AVTRZIP returned {type} instead of avatars.");
        }

        var totalCount = ReadNestedInt(root, "meta", "totalCount");
        var currentPageIndex = ReadNestedInt(root, "pagination", "current");
        var totalPages = ReadNestedInt(root, "pagination", "total");
        var nextCode = ReadNestedCode(root, "pagination", "codes", "next");
        var randomCode = ReadNestedCode(root, "pagination", "codes", "random");
        var inputPageCode = ReadNestedCode(root, "pagination", "codes", "inputPage");
        var page = Math.Max(1, currentPageIndex + 1);
        var hasMore = nextCode >= 0 || (totalPages > 0 && currentPageIndex + 1 < totalPages);
        var results = new List<AvatarInput>();

        if (root.TryGetProperty("results", out var resultElements) && resultElements.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in resultElements.EnumerateArray())
            {
                var avatar = ReadAvtrZipAvatar(item);
                if (!string.IsNullOrWhiteSpace(avatar.AvatarId)) results.Add(avatar);
            }
        }

        return new AvtrZipSearchPage(new AvatarDatabaseSearchResult(results, page, hasMore, DateTimeOffset.UtcNow), totalCount, totalPages, nextCode, randomCode, inputPageCode);
    }

    private static AvatarInput ReadAvtrZipAvatar(JsonElement item)
    {
        var id = ReadString(item, "id");
        var name = ReadString(item, "name");
        var authorName = ReadString(item, "authorName");
        var createdAt = ReadString(item, "createdAt");
        var tags = CombineAvtrZipTags(ReadString(item, "tags"), ReadString(item, "aiTags"));
        var useCount = ReadInt(item, "useCount");
        var imageUrl = FirstString(item, "imageUrl", "thumbnailImageUrl", "image", "thumbnail");

        return new AvatarInput
        {
            AvatarId = id,
            Name = string.IsNullOrWhiteSpace(name) ? id : name,
            AuthorName = authorName,
            ImageUrl = imageUrl,
            ThumbnailImageUrl = imageUrl,
            ReleaseStatus = "public",
            Tags = tags,
            SourceUrl = string.IsNullOrWhiteSpace(id) ? "https://g.avtr.zip/" : $"https://vrchat.com/home/avatar/{id}",
            Notes = useCount > 0 ? $"Found in the AVTRZIP database. Used {useCount} times." : "Found in the AVTRZIP database.",
            RawJson = item.GetRawText(),
            Source = "avtrzip",
            RemoteCreatedAt = createdAt,
            RemoteUpdatedAt = createdAt
        };
    }

    private static async Task HydrateAvtrZipResultsAsync(List<AvatarInput> avatars, VrChatClient vrchat)
    {
        if (avatars.Count == 0) return;
        var session = await vrchat.GetSessionAsync();
        if (!session.IsLoggedIn) return;

        using var gate = new SemaphoreSlim(5, 5);
        var tasks = avatars
            .Where(NeedsVrChatAvatarHydration)
            .Select(async avatar =>
            {
                await gate.WaitAsync();
                try
                {
                    var details = await FetchCachedVrChatAvatarAsync(vrchat, avatar.AvatarId);
                    if (details is not null) MergeVrChatDetailsIntoAvtrZipAvatar(avatar, details);
                }
                catch
                {
                }
                finally
                {
                    gate.Release();
                }
        });
        await Task.WhenAll(tasks);
    }

    private static bool NeedsVrChatAvatarHydration(AvatarInput avatar) =>
        !string.IsNullOrWhiteSpace(avatar.AvatarId)
        && (string.IsNullOrWhiteSpace(avatar.ThumbnailImageUrl)
            || string.IsNullOrWhiteSpace(avatar.ImageUrl)
            || string.IsNullOrWhiteSpace(avatar.AuthorName)
            || string.IsNullOrWhiteSpace(avatar.AuthorId)
            || string.IsNullOrWhiteSpace(avatar.ReleaseStatus)
            || avatar.ReleaseStatus.Trim().Equals("public", StringComparison.OrdinalIgnoreCase));

    private static async Task<AvatarInput?> FetchCachedVrChatAvatarAsync(VrChatClient vrchat, string avatarId)
    {
        lock (VrChatAvatarDetailCache)
        {
            if (VrChatAvatarDetailCache.TryGetValue(avatarId, out var cached)) return cached;
        }

        var details = await vrchat.FetchAvatarAsync(avatarId);
        lock (VrChatAvatarDetailCache) VrChatAvatarDetailCache[avatarId] = details;
        return details;
    }

    private static void MergeVrChatDetailsIntoAvtrZipAvatar(AvatarInput avatar, AvatarInput details)
    {
        if (string.IsNullOrWhiteSpace(avatar.ImageUrl)) avatar.ImageUrl = details.ImageUrl;
        if (string.IsNullOrWhiteSpace(avatar.ThumbnailImageUrl)) avatar.ThumbnailImageUrl = string.IsNullOrWhiteSpace(details.ThumbnailImageUrl) ? details.ImageUrl : details.ThumbnailImageUrl;
        if (string.IsNullOrWhiteSpace(avatar.AuthorId)) avatar.AuthorId = details.AuthorId;
        if (string.IsNullOrWhiteSpace(avatar.Description)) avatar.Description = details.Description;
        if (string.IsNullOrWhiteSpace(avatar.AuthorName)) avatar.AuthorName = details.AuthorName;
        if (string.IsNullOrWhiteSpace(avatar.Name)) avatar.Name = details.Name;
        if (string.IsNullOrWhiteSpace(avatar.Version)) avatar.Version = details.Version;
        if (string.IsNullOrWhiteSpace(avatar.Platforms)) avatar.Platforms = details.Platforms;
        avatar.ReleaseStatus = PreferredReleaseStatus(avatar.ReleaseStatus, details.ReleaseStatus);
        if (string.IsNullOrWhiteSpace(avatar.SourceUrl)) avatar.SourceUrl = details.SourceUrl;
        avatar.Tags = CombineAvtrZipTags(avatar.Tags, details.Tags);
    }

    private static async Task<string> GetAvtrZipStringAsync(string url)
    {
        using var response = await AvtrZipHttp.GetAsync(url);
        var body = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"AVTRZIP request failed ({(int)response.StatusCode}).");
        }

        return body;
    }

    private static void ThrowIfAvtrZipCaptcha(JsonElement root)
    {
        var status = ReadString(root, "status");
        if (status.Equals("Pending", StringComparison.OrdinalIgnoreCase) || root.TryGetProperty("encodedString", out _))
        {
            throw new InvalidOperationException($"AVTRZIP captcha required. Complete verification at {AvtrZipCaptchaUrl}, then try again.");
        }
    }

    private static string AvtrZipSearchUrl(string query) => string.IsNullOrWhiteSpace(query) ? AvtrZipSearchBaseUrl : AvtrZipSearchBaseUrl + Uri.EscapeDataString(query);
    private static string AvtrZipAuthorUrl(string query) => AvtrZipAuthorBaseUrl + Uri.EscapeDataString(query);
    private static string AvtrZipActionUrl(int code, string input = "") => AvtrZipActionBaseUrl + code + "/" + (string.IsNullOrWhiteSpace(input) ? "" : Uri.EscapeDataString(input));
    private static bool IsAllProvider(AvatarSearchInput input) => string.Equals(input.Provider, "all", StringComparison.OrdinalIgnoreCase);
    private static bool IsAvtrZipProvider(AvatarSearchInput input) => string.Equals(input.Provider, "avtrzip", StringComparison.OrdinalIgnoreCase);
    private static bool IsPasProvider(AvatarSearchInput input) => string.Equals(input.Provider, "pas", StringComparison.OrdinalIgnoreCase);
    private static bool IsAuthorNameOnlySearch(AvatarSearchInput input) =>
        input.SearchAuthor && !input.SearchAvatar && !input.SearchDescription && !input.SearchTags && !HasOptionFilter(input) && !string.IsNullOrWhiteSpace(input.Query);
    private static string AvtrZipCacheKey(AvatarSearchInput input, int page, int limit) =>
        $"avtrzip\n{input.Query?.Trim() ?? ""}\n{input.AuthorId?.Trim() ?? ""}\n{input.SearchAvatar}\n{input.SearchAuthor}\n{input.SearchDescription}\n{input.SearchTags}\n{input.SearchMode}\n{input.PlatformFilters}\n{page}\n{limit}";
    private static async Task<AvatarDatabaseSearchResult> SearchRemoteVrcxAsync(AvatarSearchInput input, VrChatClient? vrchat)
    {
        var query = input.Query?.Trim() ?? "";
        if (query.Length > 0 && query.Length < 3 && !IsAuthorIdOnlySearch(input) && !HasOptionFilter(input)) throw new InvalidOperationException("Enter at least 3 characters to search the VRCX-compatible remote database.");
        if (!HasSearchField(input)) throw new InvalidOperationException("Enable at least one search field.");
        var page = Math.Max(1, input.Page);
        var limit = Math.Clamp(input.Limit <= 0 ? 50 : input.Limit, 1, 50);
        var cacheKey = RemoteVrcxCacheKey(input, page, limit) + "\ndirect-page";
        if (Cache.TryGetValue(cacheKey, out var cached) && DateTimeOffset.UtcNow - cached.CachedAt < TimeSpan.FromMinutes(3))
        {
            if (vrchat is not null) await HydrateAvtrZipResultsAsync(cached.Results, vrchat);
            return cached with { CachedAt = DateTimeOffset.UtcNow };
        }

        var results = await LoadRemoteVrcxAvatarsAsync(input, page, VrcxRemotePageSize);
        var hasMore = results.Count >= VrcxRemotePageSize;
        if (vrchat is not null) await HydrateAvtrZipResultsAsync(results, vrchat);
        results = results.Where(x => AvatarMatchesSearch(x, input)).ToList();
        if (results.Count > limit) results.RemoveRange(limit, results.Count - limit);
        var result = new AvatarDatabaseSearchResult(results, page, hasMore, DateTimeOffset.UtcNow);
        Cache[cacheKey] = result;
        return result;
    }

    private static async Task<AvatarDatabaseCountResult> CountRemoteVrcxAsync(AvatarSearchInput input, VrChatClient? vrchat)
    {
        var query = input.Query?.Trim() ?? "";
        if (query.Length > 0 && query.Length < 3 && !IsAuthorIdOnlySearch(input) && !HasOptionFilter(input)) throw new InvalidOperationException("Enter at least 3 characters to search the VRCX-compatible remote database.");
        if (!HasSearchField(input)) throw new InvalidOperationException("Enable at least one search field.");
        var countKey = RemoteVrcxCacheKey(input, 1, DatabaseFullSearchPageLimit * VrcxRemotePageSize) + "\nfull-scan";
        if (CountCache.TryGetValue(countKey, out var cached) && DateTimeOffset.UtcNow - cached.CachedAt < TimeSpan.FromMinutes(3)) return cached;

        var count = new AvatarDatabaseCountResult(query, (await LoadRemoteVrcxAvatarWindowAsync(input, DatabaseFullSearchPageLimit)).Count, DateTimeOffset.UtcNow);
        CountCache[countKey] = count;
        return count;
    }

    private static async Task<List<AvatarInput>> LoadRemoteVrcxAvatarsAsync(AvatarSearchInput input, int page, int limit)
    {
        var url = RemoteVrcxUrl(input, page, Math.Clamp(limit, 1, VrcxRemotePageSize));
        var body = await GetRemoteVrcxStringAsync(url);
        using var document = JsonDocument.Parse(body);
        if (document.RootElement.ValueKind != JsonValueKind.Array) throw new InvalidOperationException("Remote VRCX-compatible database returned an unexpected response.");
        var results = document.RootElement
            .EnumerateArray()
            .Select(ReadRemoteVrcxAvatar)
            .Where(x => !string.IsNullOrWhiteSpace(x.AvatarId))
            .ToList();
        return results;
    }

    private static async Task<string> GetRemoteVrcxStringAsync(string url)
    {
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            using var response = await VrcxRemoteHttp.GetAsync(url);
            var body = await response.Content.ReadAsStringAsync();
            if (response.IsSuccessStatusCode) return body;
            if (response.StatusCode == HttpStatusCode.TooManyRequests && attempt < 3)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(800 * attempt));
                continue;
            }
            throw new InvalidOperationException($"Remote VRCX-compatible database request failed ({(int)response.StatusCode}).");
        }

        throw new InvalidOperationException("Remote VRCX-compatible database request failed.");
    }

    private static async Task<List<AvatarInput>> LoadRemoteVrcxAvatarWindowAsync(AvatarSearchInput input, int maxPages)
    {
        var avatars = new List<AvatarInput>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var page = 1; page <= Math.Max(1, maxPages); page++)
        {
            var results = await LoadRemoteVrcxAvatarsAsync(input, page, VrcxRemotePageSize);
            foreach (var avatar in results)
            {
                if (!AvatarMatchesSearch(avatar, input)) continue;
                var key = string.IsNullOrWhiteSpace(avatar.AvatarId) ? avatar.Id : avatar.AvatarId;
                if (!string.IsNullOrWhiteSpace(key) && seen.Add(key)) avatars.Add(avatar);
            }
            if (results.Count < VrcxRemotePageSize) break;
        }
        return avatars;
    }

    private static AvatarInput ReadRemoteVrcxAvatar(JsonElement item)
    {
        var id = ReadString(item, "id");
        var name = ReadString(item, "name");
        var authorId = ReadString(item, "authorId");
        var authorName = ReadString(item, "authorName");
        var description = ReadString(item, "description");
        var imageUrl = FirstString(item, "imageUrl", "thumbnailImageUrl", "image", "thumbnail");
        var thumbnailImageUrl = FirstString(item, "thumbnailImageUrl", "imageUrl", "thumbnail", "image");
        var createdAt = FirstString(item, "createdAt", "created_at");
        var updatedAt = FirstString(item, "updatedAt", "updated_at");
        var tags = RemoteVrcxTags(item);

        return new AvatarInput
        {
            AvatarId = id,
            Name = string.IsNullOrWhiteSpace(name) ? id : name,
            Description = description,
            AuthorId = authorId,
            AuthorName = authorName,
            ImageUrl = imageUrl,
            ThumbnailImageUrl = string.IsNullOrWhiteSpace(thumbnailImageUrl) ? imageUrl : thumbnailImageUrl,
            ReleaseStatus = string.IsNullOrWhiteSpace(FirstString(item, "releaseStatus", "release_status")) ? "public" : FirstString(item, "releaseStatus", "release_status"),
            Platforms = tags,
            Tags = tags,
            SourceUrl = string.IsNullOrWhiteSpace(id) ? VrcxRemoteDatabaseUrl : $"https://vrchat.com/home/avatar/{id}",
            Notes = "Found in the remote VRCX-compatible avatar database.",
            RawJson = item.GetRawText(),
            Source = "avatar-database",
            RemoteCreatedAt = createdAt,
            RemoteUpdatedAt = string.IsNullOrWhiteSpace(updatedAt) ? createdAt : updatedAt
        };
    }

    private static string RemoteVrcxUrl(AvatarSearchInput input, int page, int limit)
    {
        var parameters = new List<string> { $"n={limit}", $"page={Math.Max(0, page - 1)}" };
        if (IsAuthorIdOnlySearch(input)) parameters.Add($"authorId={Uri.EscapeDataString(input.AuthorId.Trim())}");
        else parameters.Add($"search={Uri.EscapeDataString(string.IsNullOrWhiteSpace(input.Query) ? "avatar" : input.Query.Trim())}");
        return $"{VrcxRemoteDatabaseUrl}?{string.Join("&", parameters)}";
    }

    private static string RemoteVrcxCacheKey(AvatarSearchInput input, int page, int limit) =>
        $"vrcx-remote\n{VrcxRemoteDatabaseUrl}\n{input.Query?.Trim() ?? ""}\n{input.AuthorId?.Trim() ?? ""}\n{input.SearchAvatar}\n{input.SearchAuthor}\n{input.SearchDescription}\n{input.SearchTags}\n{input.SearchMode}\n{input.PlatformFilters}\n{page}\n{limit}";

    private static string RemoteVrcxTags(JsonElement item)
    {
        if (!item.TryGetProperty("performance", out var performance) || performance.ValueKind != JsonValueKind.Object) return "remote vrcx-compatible";
        var tags = new List<string> { "remote vrcx-compatible" };
        foreach (var platform in new[] { ("pc_rating", "PC"), ("android_rating", "Android"), ("ios_rating", "iOS") })
        {
            var rating = ReadString(performance, platform.Item1);
            if (!string.IsNullOrWhiteSpace(rating)) tags.Add($"{platform.Item2}: {rating}");
        }
        if (ReadString(performance, "has_impostor").Equals("true", StringComparison.OrdinalIgnoreCase)) tags.Add("Impostor");
        return string.Join(", ", tags.Distinct(StringComparer.OrdinalIgnoreCase));
    }

    private static HttpClient CreateAvtrZipHttpClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(25) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("VRCNeph/1.0");
        return client;
    }
    private static HttpClient CreatePasHttpClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("VRCNeph/1.0");
        return client;
    }
    private static HttpClient CreateVrcxRemoteHttpClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(25) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/json, text/plain, */*");
        client.DefaultRequestHeaders.Referrer = new Uri("https://vrcx.app/");
        return client;
    }
    private static string CombineAvtrZipTags(string tags, string aiTags) =>
        string.Join(", ", new[] { tags, aiTags }.Where(x => !string.IsNullOrWhiteSpace(x)).SelectMany(x => x.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)).Distinct(StringComparer.OrdinalIgnoreCase));
    private static string FirstString(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            var value = ReadString(element, name);
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        return "";
    }
    private static int ReadNestedCode(JsonElement root, string first, string second, string third)
    {
        if (!root.TryGetProperty(first, out var one) || !one.TryGetProperty(second, out var two)) return -1;
        return ReadInt(two, third, -1);
    }
    private static int ReadNestedInt(JsonElement root, string first, string second)
    {
        if (!root.TryGetProperty(first, out var nested)) return 0;
        return ReadInt(nested, second);
    }
    private static int ReadCode(JsonElement element, string name) => element.TryGetProperty("codes", out var codes) ? ReadInt(codes, name, -1) : -1;
    private static int ReadInt(JsonElement element, string name, int fallback = 0)
    {
        if (!element.TryGetProperty(name, out var value)) return fallback;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number;
        if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out number)) return number;
        return fallback;
    }
    private static string ReadString(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value)) return "";
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? "",
            JsonValueKind.Number => value.ToString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => ""
        };
    }

    private static async Task<AvatarInput?> ResolveLocalVrcxAvatarByImageAsync(string imageKey, string imageUrl)
    {
        var databasePath = ResolveVrcxDatabasePath();
        if (string.IsNullOrWhiteSpace(databasePath) || !File.Exists(databasePath)) return null;
        var terms = ResolveImageLookupTerms(imageKey, imageUrl).ToList();
        if (terms.Count == 0) return null;

        try
        {
            using var connection = OpenReadOnlyConnection(databasePath);
            using var command = connection.CreateCommand();
            var clauses = new List<string>();
            for (var i = 0; i < terms.Count; i++)
            {
                var parameter = $"@image{i}";
                command.Parameters.AddWithValue(parameter, $"%{EscapeLike(terms[i])}%");
                clauses.Add($"a.image_url LIKE {parameter} ESCAPE '\\'");
                clauses.Add($"a.thumbnail_image_url LIKE {parameter} ESCAPE '\\'");
            }

            command.CommandText = $"""
                {SelectAvatarSql}
                WHERE {string.Join(" OR ", clauses)}
                ORDER BY coalesce(a.updated_at, a.created_at, a.added_at, '') DESC
                LIMIT 1
                """;

            using var reader = await command.ExecuteReaderAsync();
            return await reader.ReadAsync() ? ReadDatabaseAvatar(reader) : null;
        }
        catch
        {
            return null;
        }
    }

    private static async Task<AvatarInput?> ResolveLocalVrcxAvatarByFeedAsync(string userId, string displayName, string imageKey, string imageUrl)
    {
        var databasePath = ResolveVrcxDatabasePath();
        if (string.IsNullOrWhiteSpace(databasePath) || !File.Exists(databasePath)) return null;
        try
        {
            using var connection = OpenReadOnlyConnection(databasePath);
            var feedTables = VrcxFeedAvatarTables(connection);
            foreach (var table in feedTables)
            {
                var feed = await ReadLatestVrcxFeedAvatarAsync(connection, table, userId, displayName);
                if (feed is null) continue;

                var currentImage = FirstNonEmpty(feed.CurrentImageUrl, feed.CurrentThumbnailImageUrl, imageUrl);
                var currentKey = FirstNonEmpty(ImageFileKey(currentImage), imageKey);
                var byImage = await ResolveLocalVrcxAvatarByImageAsync(currentKey, currentImage);
                if (byImage is not null) return byImage;

                var byName = await ResolveLocalVrcxAvatarByNameAsync(connection, feed.AvatarName, feed.OwnerId);
                if (byName is not null) return byName;

                if (!string.IsNullOrWhiteSpace(feed.AvatarName) || !string.IsNullOrWhiteSpace(currentImage))
                {
                    return new AvatarInput
                    {
                        AvatarId = "",
                        Name = string.IsNullOrWhiteSpace(feed.AvatarName) ? "Current Avatar" : feed.AvatarName,
                        AuthorId = feed.OwnerId,
                        ImageUrl = currentImage,
                        ThumbnailImageUrl = FirstNonEmpty(feed.CurrentThumbnailImageUrl, currentImage),
                        SourceUrl = currentImage,
                        Description = "VRCX has seen this user's current avatar, but the avatar ID is not available in the local cache yet.",
                        Notes = "Found in the local VRCX avatar feed.",
                        RawJson = JsonSerializer.Serialize(feed, ProgramJson.Options),
                        Source = "vrcx-feed",
                        RemoteUpdatedAt = feed.CreatedAt
                    };
                }
            }
        }
        catch
        {
        }

        return null;
    }

    private static List<string> VrcxFeedAvatarTables(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%\\_feed\\_avatar' ESCAPE '\\' ORDER BY name";
        using var reader = command.ExecuteReader();
        var tables = new List<string>();
        while (reader.Read())
        {
            var name = Convert.ToString(reader["name"]) ?? "";
            if (!string.IsNullOrWhiteSpace(name)) tables.Add(name);
        }
        return tables;
    }

    private static async Task<VrcxFeedAvatarRow?> ReadLatestVrcxFeedAvatarAsync(SqliteConnection connection, string table, string userId, string displayName)
    {
        if (string.IsNullOrWhiteSpace(userId) && string.IsNullOrWhiteSpace(displayName)) return null;
        using var command = connection.CreateCommand();
        var clauses = new List<string>();
        if (!string.IsNullOrWhiteSpace(userId))
        {
            command.Parameters.AddWithValue("@userId", userId.Trim());
            clauses.Add("user_id = @userId");
        }
        if (!string.IsNullOrWhiteSpace(displayName))
        {
            command.Parameters.AddWithValue("@displayName", displayName.Trim());
            clauses.Add("lower(display_name) = lower(@displayName)");
        }
        command.CommandText = $"""
            SELECT created_at, user_id, display_name, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url
            FROM {QuoteSqliteIdentifier(table)}
            WHERE {string.Join(" OR ", clauses)}
            ORDER BY created_at DESC
            LIMIT 1
            """;
        using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;
        return new VrcxFeedAvatarRow(
            ReadColumn(reader, "created_at"),
            ReadColumn(reader, "user_id"),
            ReadColumn(reader, "display_name"),
            ReadColumn(reader, "owner_id"),
            ReadColumn(reader, "avatar_name"),
            ReadColumn(reader, "current_avatar_image_url"),
            ReadColumn(reader, "current_avatar_thumbnail_image_url"));
    }

    private static async Task<AvatarInput?> ResolveLocalVrcxAvatarByNameAsync(SqliteConnection connection, string avatarName, string ownerId)
    {
        if (string.IsNullOrWhiteSpace(avatarName)) return null;
        using var command = connection.CreateCommand();
        command.Parameters.AddWithValue("@name", avatarName.Trim());
        var ownerClause = "";
        if (!string.IsNullOrWhiteSpace(ownerId))
        {
            command.Parameters.AddWithValue("@ownerId", ownerId.Trim());
            ownerClause = "AND lower(coalesce(a.author_id, '')) = lower(@ownerId)";
        }
        command.CommandText = $"""
            {SelectAvatarSql}
            WHERE lower(coalesce(a.name, '')) = lower(@name)
            {ownerClause}
            ORDER BY coalesce(a.updated_at, a.created_at, a.added_at, '') DESC
            LIMIT 1
            """;
        using var reader = await command.ExecuteReaderAsync();
        return await reader.ReadAsync() ? ReadDatabaseAvatar(reader) : null;
    }

    private static async Task<AvatarInput?> ResolveRemoteVrcxAvatarByImageAsync(string term, string imageKey, string imageUrl)
    {
        if (string.IsNullOrWhiteSpace(term) || term.Length < 3) return null;
        var input = new AvatarSearchInput(term, Limit: VrcxRemotePageSize, Page: 1, SearchAvatar: true, SearchAuthor: true, SearchDescription: true, SearchTags: true, Provider: "vrcx");
        for (var page = 1; page <= 5; page++)
        {
            var results = await LoadRemoteVrcxAvatarsAsync(input, page, VrcxRemotePageSize);
            var match = results.FirstOrDefault(avatar => AvatarImageMatches(avatar, imageKey, imageUrl));
            if (match is not null) return match;
            if (results.Count < VrcxRemotePageSize) break;
        }

        return null;
    }

    private static bool AvatarImageMatches(AvatarInput avatar, string imageKey, string imageUrl)
    {
        var terms = ResolveImageLookupTerms(imageKey, imageUrl).ToList();
        if (terms.Count == 0) return false;
        return new[] { avatar.ImageUrl, avatar.ThumbnailImageUrl }
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.ToLowerInvariant())
            .Any(value => terms.Any(term => value.Contains(term, StringComparison.OrdinalIgnoreCase)));
    }

    private static IEnumerable<string> ResolveImageSearchTerms(string imageKey, string name)
    {
        if (!string.IsNullOrWhiteSpace(imageKey)) yield return imageKey;
        if (!string.IsNullOrWhiteSpace(name) && !name.Equals("Current Avatar", StringComparison.OrdinalIgnoreCase)) yield return name;
    }

    private static IEnumerable<string> ResolveImageLookupTerms(string imageKey, string imageUrl)
    {
        if (!string.IsNullOrWhiteSpace(imageKey)) yield return imageKey;
        var normalized = imageUrl?.Trim();
        if (!string.IsNullOrWhiteSpace(normalized)) yield return normalized.Split('?', 2)[0];
    }

    private static string ImageFileKey(string url)
    {
        var match = Regex.Match(url ?? "", @"file_[0-9a-f-]+", RegexOptions.IgnoreCase);
        return match.Success ? match.Value.ToLowerInvariant() : "";
    }

    private static string FirstNonEmpty(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? "";

    private static string QuoteSqliteIdentifier(string value) =>
        "\"" + value.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";

    private static async Task<AvatarDatabaseSearchResult> QuerySearchAsync(string databasePath, AvatarSearchInput input, int page, int limit)
    {
        using var connection = OpenReadOnlyConnection(databasePath);
        using var command = connection.CreateCommand();
        var where = BuildWhereClause(input, command);
        command.CommandText = $"""
            {SelectAvatarSql}
            {where}
            ORDER BY
                CASE
                    WHEN lower(coalesce(a.name, '')) = lower(@query) THEN 0
                    WHEN lower(coalesce(a.name, '')) LIKE lower(@queryPrefix) ESCAPE '\' THEN 1
                    WHEN lower(coalesce(a.author_name, '')) LIKE lower(@queryPrefix) ESCAPE '\' THEN 2
                    ELSE 3
                END,
                coalesce(a.updated_at, a.created_at, a.added_at, '') DESC,
                a.name COLLATE NOCASE ASC
            LIMIT @limit OFFSET @offset
            """;
        var query = input.Query?.Trim() ?? "";
        command.Parameters.AddWithValue("@query", query);
        command.Parameters.AddWithValue("@queryPrefix", $"{EscapeLike(query)}%");
        command.Parameters.AddWithValue("@limit", limit + 1);
        command.Parameters.AddWithValue("@offset", (page - 1) * limit);

        var results = new List<AvatarInput>();
        using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            results.Add(ReadDatabaseAvatar(reader));
        }

        var hasMore = results.Count > limit;
        if (hasMore) results.RemoveAt(results.Count - 1);
        return new AvatarDatabaseSearchResult(results, page, hasMore, DateTimeOffset.UtcNow);
    }

    private const string SelectAvatarSql = """
        SELECT
            a.id,
            a.author_id,
            a.author_name,
            a.created_at,
            a.description,
            a.image_url,
            a.name,
            a.release_status,
            a.thumbnail_image_url,
            a.updated_at,
            a.version,
            coalesce((SELECT group_concat(t.tag, ', ') FROM avatar_tags t WHERE t.avatar_id = a.id), '') AS tags,
            coalesce((SELECT m.memo FROM avatar_memos m WHERE m.avatar_id = a.id), '') AS memo
        FROM cache_avatar a
        """;

    private static string BuildWhereClause(AvatarSearchInput input, SqliteCommand command)
    {
        if (IsAuthorIdOnlySearch(input))
        {
            command.Parameters.AddWithValue("@authorId", input.AuthorId.Trim());
            return "WHERE lower(coalesce(a.author_id, '')) = lower(@authorId)";
        }

        var query = input.Query?.Trim() ?? "";
        var clauses = new List<string>();
        var textFields = new List<string>();
        if (!string.IsNullOrWhiteSpace(query) && input.SearchAvatar) textFields.Add(SearchSqlGroup(["a.name", "a.id"], input, command, "avatar"));
        if (!string.IsNullOrWhiteSpace(query) && input.SearchAuthor) textFields.Add(SearchSqlGroup(["a.author_name", "a.author_id"], input, command, "author"));
        if (!string.IsNullOrWhiteSpace(query) && input.SearchDescription) textFields.Add(SearchSqlGroup(["a.description"], input, command, "description"));
        if (!string.IsNullOrWhiteSpace(query) && input.SearchTags)
        {
            textFields.Add(SearchSqlGroup([
                "coalesce((SELECT group_concat(t.tag, ' ') FROM avatar_tags t WHERE t.avatar_id = a.id), '')",
                "coalesce((SELECT m.memo FROM avatar_memos m WHERE m.avatar_id = a.id), '')"
            ], input, command, "tags"));
        }
        if (textFields.Count > 0)
        {
            clauses.Add($"({string.Join(" OR ", textFields)})");
        }

        var platformFilters = OptionFilterValues(input.PlatformFilters);
        if (platformFilters.Count > 0)
        {
            var platformClauses = new List<string>();
            var platformAliases = platformFilters.SelectMany(PlatformFilterAliases).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            for (var i = 0; i < platformAliases.Count; i++)
            {
                var parameter = $"@platform{i}";
                command.Parameters.AddWithValue(parameter, $"%{EscapeLike(platformAliases[i])}%");
                platformClauses.Add($"EXISTS (SELECT 1 FROM avatar_tags t WHERE t.avatar_id = a.id AND lower(t.tag) LIKE {parameter} ESCAPE '\\')");
            }
            clauses.Add($"({string.Join(" OR ", platformClauses)})");
        }

        return clauses.Count == 0 ? "" : $"WHERE {string.Join(" AND ", clauses)}";
    }

    private static string SearchSqlGroup(string[] fields, AvatarSearchInput input, SqliteCommand command, string prefix)
    {
        var query = input.Query?.Trim() ?? "";
        var mode = NormalizeSearchMode(input.SearchMode);
        if (mode == "allWords")
        {
            var wordClauses = new List<string>();
            var words = SearchWords(query);
            if (words.Count == 0) return "1 = 1";
            for (var i = 0; i < words.Count; i++)
            {
                var parameter = $"@{prefix}Word{i}";
                command.Parameters.AddWithValue(parameter, $"%{EscapeLike(words[i])}%");
                wordClauses.Add($"({string.Join(" OR ", fields.Select(field => $"{field} LIKE {parameter} ESCAPE '\\'"))})");
            }
            return $"({string.Join(" AND ", wordClauses)})";
        }

        var valueParameter = $"@{prefix}Search";
        var escaped = EscapeLike(query);
        command.Parameters.AddWithValue(valueParameter, mode switch
        {
            "exact" => query,
            "startsWith" => $"{escaped}%",
            "endsWith" => $"%{escaped}",
            _ => $"%{escaped}%"
        });
        if (mode == "exact") return $"({string.Join(" OR ", fields.Select(field => $"lower({field}) = lower({valueParameter})"))})";
        return $"({string.Join(" OR ", fields.Select(field => $"{field} LIKE {valueParameter} ESCAPE '\\'"))})";
    }

    private static SqliteConnection OpenReadOnlyConnection(string databasePath)
    {
        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Shared,
            Pooling = false
        };
        var connection = new SqliteConnection(builder.ToString());
        connection.Open();
        ExecuteNonQuery(connection, "PRAGMA query_only = ON");
        ExecuteNonQuery(connection, "PRAGMA busy_timeout = 5000");
        return connection;
    }

    private static void ExecuteNonQuery(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    private static AvatarInput ReadDatabaseAvatar(SqliteDataReader reader)
    {
        var id = ReadColumn(reader, "id");
        var name = ReadColumn(reader, "name");
        var authorId = ReadColumn(reader, "author_id");
        var authorName = ReadColumn(reader, "author_name");
        var description = ReadColumn(reader, "description");
        var imageUrl = ReadColumn(reader, "image_url");
        var thumbnailImageUrl = ReadColumn(reader, "thumbnail_image_url");
        var releaseStatus = ReadColumn(reader, "release_status");
        var version = ReadColumn(reader, "version");
        var createdAt = ReadColumn(reader, "created_at");
        var updatedAt = ReadColumn(reader, "updated_at");
        var tags = ReadColumn(reader, "tags");
        var memo = ReadColumn(reader, "memo");

        var raw = new Dictionary<string, string>
        {
            ["id"] = id,
            ["name"] = name,
            ["description"] = description,
            ["authorId"] = authorId,
            ["authorName"] = authorName,
            ["imageUrl"] = imageUrl,
            ["thumbnailImageUrl"] = thumbnailImageUrl,
            ["releaseStatus"] = releaseStatus,
            ["version"] = version,
            ["tags"] = tags,
            ["memo"] = memo,
            ["createdAt"] = createdAt,
            ["updatedAt"] = updatedAt
        };

        return new AvatarInput
        {
            AvatarId = id,
            Name = string.IsNullOrWhiteSpace(name) ? id : name,
            Description = description,
            AuthorId = authorId,
            AuthorName = authorName,
            ImageUrl = imageUrl,
            ThumbnailImageUrl = string.IsNullOrWhiteSpace(thumbnailImageUrl) ? imageUrl : thumbnailImageUrl,
            ReleaseStatus = string.IsNullOrWhiteSpace(releaseStatus) ? "public" : releaseStatus,
            Version = version,
            Platforms = tags,
            Tags = tags,
            SourceUrl = $"https://vrchat.com/home/avatar/{id}",
            Notes = string.IsNullOrWhiteSpace(memo) ? "Found in the local VRCX database." : memo,
            RawJson = JsonSerializer.Serialize(raw, ProgramJson.Options),
            Source = "avatar-database",
            RemoteCreatedAt = createdAt,
            RemoteUpdatedAt = updatedAt
        };
    }

    private static string ReadColumn(SqliteDataReader reader, string name)
    {
        var value = reader[name];
        return value == DBNull.Value ? "" : Convert.ToString(value) ?? "";
    }

    private static bool AvatarMatchesSearch(AvatarInput avatar, AvatarSearchInput input)
    {
        if (IsAuthorIdOnlySearch(input)) return true;
        var query = input.Query?.Trim() ?? "";
        var textMatches = string.IsNullOrWhiteSpace(query);
        if (input.SearchAvatar && TextMatches(query, input.SearchMode, avatar.Name, avatar.AvatarId, avatar.Id)) textMatches = true;
        if (input.SearchAuthor && TextMatches(query, input.SearchMode, avatar.AuthorName, avatar.AuthorId)) textMatches = true;
        if (input.SearchDescription && TextMatches(query, input.SearchMode, avatar.Description)) textMatches = true;
        if (input.SearchTags && TextMatches(query, input.SearchMode, avatar.Tags, avatar.Notes)) textMatches = true;
        if (!textMatches) return false;
        return MatchesPlatformFilters(MergeTagText(avatar.Platforms, avatar.Tags), input);
    }

    private static bool TextMatches(string query, string mode, params string?[] values)
    {
        var needle = query.Trim();
        if (string.IsNullOrWhiteSpace(needle)) return true;
        var haystacks = values.Select(value => value?.Trim() ?? "").Where(value => !string.IsNullOrWhiteSpace(value)).ToList();
        if (haystacks.Count == 0) return false;
        mode = NormalizeSearchMode(mode);
        if (mode == "allWords")
        {
            var combined = string.Join(" ", haystacks);
            return SearchWords(needle).All(word => combined.Contains(word, StringComparison.OrdinalIgnoreCase));
        }
        return haystacks.Any(value => mode switch
        {
            "exact" => value.Equals(needle, StringComparison.OrdinalIgnoreCase),
            "startsWith" => value.StartsWith(needle, StringComparison.OrdinalIgnoreCase),
            "endsWith" => value.EndsWith(needle, StringComparison.OrdinalIgnoreCase),
            _ => value.Contains(needle, StringComparison.OrdinalIgnoreCase)
        });
    }

    private static string NormalizeSearchMode(string? mode) => (mode ?? "").Trim() switch
    {
        "exact" => "exact",
        "startsWith" => "startsWith",
        "endsWith" => "endsWith",
        "allWords" => "allWords",
        _ => "phrase"
    };

    private static List<string> SearchWords(string query) =>
        query.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(word => word.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

    private static bool MatchesPlatformFilters(string value, AvatarSearchInput input)
    {
        var filters = OptionFilterValues(input.PlatformFilters);
        if (filters.Count == 0) return true;
        return filters.SelectMany(PlatformFilterAliases).Any(filter => TextMatches(filter, "phrase", value));
    }

    private static IEnumerable<string> PlatformFilterAliases(string value)
    {
        yield return value;
        if (value.Equals("android", StringComparison.OrdinalIgnoreCase)) yield return string.Concat("qu", "est");
    }

    private static List<string> OptionFilterValues(string? value) =>
        (value ?? "")
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.ToLowerInvariant())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

    private static bool HasTextSearchField(AvatarSearchInput input) => input.SearchAvatar || input.SearchAuthor || input.SearchDescription || input.SearchTags;
    private static bool HasOptionFilter(AvatarSearchInput input) => OptionFilterValues(input.PlatformFilters).Count > 0;
    private static bool HasSearchField(AvatarSearchInput input) => HasTextSearchField(input) || HasOptionFilter(input);
    private static bool IsAuthorIdOnlySearch(AvatarSearchInput input) =>
        input.SearchAuthor && !input.SearchAvatar && !input.SearchDescription && !input.SearchTags && !HasOptionFilter(input) && !string.IsNullOrWhiteSpace(input.AuthorId);
    private static string SearchCacheKey(AvatarSearchInput input, int page, int limit, string databasePath) =>
        $"{Path.GetFullPath(databasePath)}\n{File.GetLastWriteTimeUtc(databasePath).Ticks}\n{input.Query?.Trim() ?? ""}\n{input.AuthorId?.Trim() ?? ""}\n{input.SearchAvatar}\n{input.SearchAuthor}\n{input.SearchDescription}\n{input.SearchTags}\n{input.SearchMode}\n{input.PlatformFilters}\n{page}\n{limit}";

    private static string EscapeLike(string value) =>
        value.Replace(@"\", @"\\", StringComparison.Ordinal)
            .Replace("%", @"\%", StringComparison.Ordinal)
            .Replace("_", @"\_", StringComparison.Ordinal);

    private static string? ResolveVrcxDatabasePath()
    {
        var candidates = new List<string>();
        AddDatabaseCandidate(candidates, Path.Combine(AppPaths.DatabaseDirectory, VrcxDatabaseFileName));
        foreach (var configured in ReadConfiguredDatabaseLocations())
        {
            AddDatabaseCandidate(candidates, configured);
        }
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        AddDatabaseCandidate(candidates, Path.Combine(appData, "VRCX", VrcxDatabaseFileName));
        AddDatabaseCandidate(candidates, Path.Combine(appData, "VRCX", "VRCX", VrcxDatabaseFileName));
        return candidates.FirstOrDefault(File.Exists);
    }

    private static void AddDatabaseCandidate(List<string> candidates, string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        if (File.Exists(path))
        {
            candidates.Add(path);
            return;
        }
        if (Directory.Exists(path))
        {
            candidates.Add(Path.Combine(path, VrcxDatabaseFileName));
        }
    }

    private static IEnumerable<string> ReadConfiguredDatabaseLocations()
    {
        var configPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "VRCX", "VRCX.json");
        if (!File.Exists(configPath)) yield break;
        string? configured = null;
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(configPath));
            if (document.RootElement.TryGetProperty("VRCX_DatabaseLocation", out var value) && value.ValueKind == JsonValueKind.String)
            {
                configured = value.GetString();
            }
        }
        catch
        {
        }

        if (!string.IsNullOrWhiteSpace(configured)) yield return configured;
    }
}

internal static class ProgramJson
{
    public static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
}

internal sealed record ApiRequest(string Id, string Command, JsonElement Payload);
internal sealed record ApiResponse(string? Id, bool Ok, object? Data, string? Error) { public static ApiResponse Success(string id, object? data) => new(id, true, data, null); public static ApiResponse Failure(string? id, string error) => new(id, false, null, error); }
internal sealed record AppEvent(string Event, object Data) { public static AppEvent Push(string name, object data) => new(name, data); }
internal sealed record VrChatPipelineStatus(bool Connected, string State, int EventsReceived, string LastEventType, string LastReceivedAt, int ReconnectAttempts, string LastError)
{
    public static readonly VrChatPipelineStatus Unavailable = new(false, "Unavailable", 0, "", "", 0, "");
    public static readonly VrChatPipelineStatus Stopped = new(false, "Stopped", 0, "", "", 0, "");
}
internal sealed record VrChatPipelineEvent(string Type, JsonElement Content, string ReceivedAt);
internal sealed class LibraryData { public List<AvatarGroup> Groups { get; set; } = []; public List<AvatarFavorite> Avatars { get; set; } = []; }
internal sealed class AvatarGroup { public string Id { get; set; } = ""; public string Name { get; set; } = ""; public string Description { get; set; } = ""; public string Icon { get; set; } = ""; public string BackgroundFolder { get; set; } = ""; public string BackgroundEffect { get; set; } = "global"; public int Order { get; set; } public bool? ReorderLocked { get; set; } public DateTimeOffset CreatedAt { get; set; } public DateTimeOffset UpdatedAt { get; set; } }
internal sealed class AvatarFavorite : AvatarInput { public int Order { get; set; } = -1; public DateTimeOffset CreatedAt { get; set; } public DateTimeOffset UpdatedAt { get; set; } }
internal sealed class GroupInput { public string Id { get; set; } = ""; public string Name { get; set; } = ""; public string Description { get; set; } = ""; public string Icon { get; set; } = ""; public string BackgroundFolder { get; set; } = ""; public string? BackgroundEffect { get; set; } }
internal sealed class GroupLockInput { public string Id { get; set; } = ""; public bool ReorderLocked { get; set; } = true; }
internal sealed class CopyGroupToExistingInput { public string Id { get; set; } = ""; public string TargetGroupId { get; set; } = ""; public bool Replace { get; set; } }
internal class AvatarInput { public string Id { get; set; } = ""; public string GroupId { get; set; } = ""; public string AvatarId { get; set; } = ""; public string Name { get; set; } = ""; public string Description { get; set; } = ""; public string AuthorId { get; set; } = ""; public string AuthorName { get; set; } = ""; public string ImageUrl { get; set; } = ""; public string ThumbnailImageUrl { get; set; } = ""; public string ReleaseStatus { get; set; } = ""; public string Version { get; set; } = ""; public string Platforms { get; set; } = ""; public string Tags { get; set; } = ""; public string SourceUrl { get; set; } = ""; public string Notes { get; set; } = ""; public string RawJson { get; set; } = ""; public string Source { get; set; } = ""; public string RemoteCreatedAt { get; set; } = ""; public string RemoteUpdatedAt { get; set; } = ""; public string RemoteFavoriteId { get; set; } = ""; }
internal static class AvatarInputExtensions { public static string NameOrId(this AvatarInput avatar) => string.IsNullOrWhiteSpace(avatar.Name) ? avatar.AvatarId : avatar.Name; }
internal sealed class IdInput { public string Id { get; set; } = ""; public string Path { get; set; } = ""; }
internal sealed class IdsInput { public List<long> Ids { get; set; } = []; }
internal sealed class BackupRestoreInput { public string Path { get; set; } = ""; public string Mode { get; set; } = ""; }
internal sealed class MoveAvatarInput { public string AvatarId { get; set; } = ""; public string GroupId { get; set; } = ""; }
internal sealed class ReorderInput { public string Id { get; set; } = ""; public string GroupId { get; set; } = ""; public int Position { get; set; } = 1; }
internal sealed record AvatarOrderInput(string GroupId, List<string> AvatarIds);
internal sealed record SyncedAvatarOrderInput(string GroupId, List<string> AvatarIds);
internal sealed record SyncedAvatarOrderProgress(string GroupId, string Stage, string Message, int Completed, int Total);
internal sealed record SyncedAvatarOrderApplyResult(LibraryData Library, int Removed, int Added, string Tag, string BackupPath);
internal sealed record CleanLibraryExport(List<GroupFileSummary> Groups);
internal sealed record AccountBackupExport(DateTimeOffset CreatedAt, string Reason, int Retention, int GroupCount, int AvatarCount, List<GroupFileSummary> Groups);
internal sealed record GroupFileSummary(string Id, string Name, string Description, string Icon, string BackgroundFolder = "", string BackgroundEffect = "global", List<AvatarInput>? Avatars = null);
internal sealed record BackgroundInput(string GroupId = "");
internal sealed record BackgroundImportResult(int Imported, int Skipped, string Folder);
internal sealed record BackgroundResult(string DataUrl, string Folder, string MediaType = "", string MimeType = "", string FileName = "", string Source = "global");
internal sealed record AppLogEntry(DateTimeOffset Timestamp, string Level, string Area, string Message, string Detail = "");
internal sealed record AppLogList(string Folder, List<AppLogEntry> Entries);
internal sealed record PersistedMessageSummary(string Id = "", string Type = "", string Title = "", string SenderUserId = "", string SenderUsername = "", string Message = "", string CreatedAt = "", bool Seen = false, string Direction = "", string RawJson = "");
internal sealed record MessageHistorySaveInput(List<PersistedMessageSummary> Items);
internal sealed record SyncHealthResult(string DatabasePath, string? LastSyncAt, bool LastSyncSucceeded, string LastSyncSummary, string LastSyncError, int PendingActions, int FailedActions, int OpenConflicts, int MetadataChangesLast24Hours, int MetadataChangesTotal);
internal sealed class SyncActionRecordInput { public string Id { get; set; } = ""; public string Kind { get; set; } = ""; public string Label { get; set; } = ""; public string Status { get; set; } = ""; public int Attempt { get; set; } public string Error { get; set; } = ""; public string Payload { get; set; } = ""; }
internal sealed record SyncActionRecord(string Id, string Timestamp, string Kind, string Label, string Status, int Attempt, string Error, string Payload);
internal sealed record SyncActionListResult(List<SyncActionRecord> Actions);
internal sealed record SyncConflictRecord(long Id, string DetectedAt, string Kind, string GroupId, string GroupName, string AvatarId, string AvatarName, string Detail, bool Resolved);
internal sealed record SyncConflictListResult(List<SyncConflictRecord> Conflicts);
internal sealed record SyncConflictInput(string Kind, string GroupId, string GroupName, string AvatarId, string AvatarName, string Detail);
internal sealed record MetadataHistoryRecord(string ChangedAt, string AvatarId, string ChangeType, string OldName, string NewName, string OldAuthor, string NewAuthor, string OldStatus, string NewStatus, string OldRemoteUpdatedAt, string NewRemoteUpdatedAt);
internal sealed record MetadataHistoryListResult(List<MetadataHistoryRecord> Items);
internal sealed record DiagnosticItem(string Name, string Status, string Detail, string Level = "info");
internal sealed record DiagnosticsResult(List<DiagnosticItem> Items);
internal sealed record ExportResult(string Path);
internal sealed record GroupClearResult(LibraryData Library, int Removed, string BackupPath);
internal sealed record AppSettings(int GridSize = 10, int DatabaseGridSize = 10, string ThemeColor = "#303735", int BackgroundOpacity = 20, int PanelOpacity = 35, string PanelColor = "#303735", bool PanelColorSynced = true, string BackgroundEffect = "", bool HideLockedGroups = false, bool HideFullGroups = false, int SchemaVersion = 7);
internal sealed record AvatarSearchInput(string Query, int Limit = 50, int Page = 1, string AuthorId = "", bool SearchAvatar = true, bool SearchAuthor = true, bool SearchDescription = true, bool SearchTags = true, string PlatformFilters = "", string Provider = "vrcx", string SearchMode = "phrase");
internal sealed record AvatarListResult(List<AvatarInput> Avatars);
internal sealed record AvatarImageResolveInput(string AvatarId = "", string ImageUrl = "", string Name = "", string UserId = "", string DisplayName = "");
internal sealed record AvatarDatabaseSearchResult(List<AvatarInput> Results, int Page, bool HasMore, DateTimeOffset CachedAt, int Total = 0);
internal sealed record AvatarDatabaseCountResult(string Query, int Total, DateTimeOffset CachedAt);
internal sealed record AvatarDatabaseCountProgress(int Discovered, bool Counting, bool Finished);
internal sealed record VrcxDatabaseStatus(bool HasLocalDatabase, string Path, string DatabaseDirectory);
internal sealed record PasUpdateStatus(bool HasLocalFile, bool HasUpdate, string LocalFileDate, string RemoteFileDate, long LocalBytes, long RemoteBytes, string Url, string Message);
internal sealed record AvtrZipSearchPage(AvatarDatabaseSearchResult Result, int TotalCount, int TotalPages, int NextCode, int RandomCode, int InputPageCode);
internal sealed record PasDatabaseData(string Path, string PlatformLabel, string FileDate, int AvatarCount, int AuthorCount, int FileAvatarCount, int FileAuthorCount, byte[] DynamicBytes, byte[] AvatarIds, uint[] AuthorIds, string[] AvatarNames, string[] AuthorNames);
internal sealed record VrcxFeedAvatarRow(string CreatedAt, string UserId, string DisplayName, string OwnerId, string AvatarName, string CurrentImageUrl, string CurrentThumbnailImageUrl);
internal sealed record PasDatabaseInfo(string Location, string FileDate, long ContentLength, DateTimeOffset? LastModifiedUtc, string ETag, int AvatarCount, int AuthorCount, int FileAvatarCount, int FileAuthorCount, bool HeaderVerified);
internal sealed record LoginInput(string Username, string Password);
internal sealed record TwoFactorInput(string Code, string Method);
internal sealed record VrChatProfileUpdateInput(string Status = "", string StatusDescription = "", string Bio = "", string BioLinks = "", string Pronouns = "");
internal sealed record CurrentAvatarInput(string GroupId);
internal sealed record VrChatFavoriteChangeInput(string AvatarId, string GroupId);
internal sealed record WorldFavoriteInput(string Id = "", string Tag = "");
internal sealed record PageInput(int Limit = 100, int Offset = 0);
internal sealed record WorldSearchInput(string Query = "", int Limit = 50, int Offset = 0, string Mode = "", string Sort = "popularity", string Order = "descending", string ReleaseStatus = "");
internal sealed record WorldLaunchInput(string WorldId = "", string InstanceId = "", string Location = "");
internal sealed record WorldVisitHistoryInput(string WorldId = "", string InstanceId = "", string Location = "");
internal sealed record LatestWorldLocationResult(bool Found, string WorldName, string Location, string WorldId, string Timestamp, string Message);
internal sealed record PlayerActivityLogInput(int Limit = 250);
internal sealed record InviteMessageInput(string Type = "message");
internal sealed record InviteMessageUpdateInput(string Type = "message", int Slot = 0, string Message = "");
internal sealed record InviteMessageSummary(int Slot, string Message, string MessageType, bool CanBeUpdated, int RemainingCooldownMinutes);
internal sealed record InviteMessageListResult(List<InviteMessageSummary> Messages);
internal sealed record InviteUserInput(string UserId = "", string InstanceId = "", int MessageSlot = 0);
internal sealed record RequestInviteInput(string Id = "", int MessageSlot = 0);
internal sealed record ChatMessageInput(string UserId = "", string Message = "", string Mode = "auto");
internal sealed record ChatMessageResult(string UserId, string Message, string Mode, int MessageSlot);
internal sealed record UserModerationInput(string Id = "", string Type = "block");
internal sealed record EncounterHistoryInput(string UserId = "", string DisplayName = "");
internal sealed record VrChatSessionState(bool IsLoggedIn, bool RequiresTwoFactor, string[] TwoFactorMethods, VrChatUserSummary? User);
internal sealed record VrChatUserSummary(string Id, string DisplayName, string CurrentAvatarId, string CurrentAvatarImageUrl, string CurrentAvatarThumbnailImageUrl, string Status = "", string StatusDescription = "", string Location = "", string WorldId = "", string InstanceId = "", string HomeWorldId = "", string Bio = "", string DateJoined = "", string LastLogin = "", string DeveloperType = "", string Tags = "", string BioLinks = "", string Pronouns = "", string ProfileImageUrl = "", string UserIcon = "", string ProfilePicOverride = "", string ProfilePicOverrideThumbnail = "", string RawJson = "");
internal sealed record VrChatFriendSummary(string Id, string DisplayName, string Status, string StatusDescription, string Location, string WorldId, string ImageUrl, bool IsOnline = false, string Presence = "offline", string State = "", string Bio = "", string DateJoined = "", string LastLogin = "", string DeveloperType = "", string Tags = "", string RawJson = "", string ProfileImageUrl = "", string UserIcon = "", string ProfilePicOverride = "", string ProfilePicOverrideThumbnail = "", string CurrentAvatarId = "", string CurrentAvatarName = "", string CurrentAvatarImageUrl = "", string CurrentAvatarThumbnailImageUrl = "", string AllowAvatarCopying = "", string Pronouns = "", string AgeVerificationStatus = "", string LastPlatform = "", string RepresentedGroupId = "", string RepresentedGroupName = "", string RepresentedGroupShortCode = "", string RepresentedGroupMemberCount = "", string RepresentedGroupImageUrl = "", string BioLinks = "", bool IsFriend = false, bool IsBlocked = false, string FavoriteTags = "", string PresenceSource = "");
internal sealed record VrChatFriendListResult(List<VrChatFriendSummary> Friends, bool HasMore);
internal sealed record VrChatUserGroupSummary(string Id, string Name, string ShortCode, string MemberCount, string Description, string ImageUrl);
internal sealed record VrChatUserGroupsResult(List<VrChatUserGroupSummary> Groups);
internal sealed record VrChatGroupDetail(string Id, string Name, string ShortCode, string MemberCount, string Description, string IconUrl, string BannerUrl, string OwnerId, string OwnerName, string Privacy, string JoinState, string CreatedAt, string RawJson);
internal sealed record VrChatGroupMemberSummary(string UserId, string DisplayName, string Roles, string Status, string JoinedAt, string ImageUrl, string RawJson);
internal sealed record VrChatGroupMembersResult(List<VrChatGroupMemberSummary> Members);
internal sealed record VrChatWorldSummary(string Id, string Name, string AuthorName, string Description, string ImageUrl, int Occupants, int Favorites, string ReleaseStatus, int Capacity = 0, int Visits = 0, int PublicOccupants = 0, int PrivateOccupants = 0, string CreatedAt = "", string UpdatedAt = "", string RawJson = "", string FavoriteTags = "", List<VrChatWorldInstanceSummary>? Instances = null, string AuthorId = "");
internal sealed record VrChatWorldInstanceSummary(string Id, string Location, int Occupants, string Type, string Region, bool IsLocked, bool IsAgeRestricted, string GroupId = "", string GroupName = "");
internal sealed record VrChatWorldSearchResult(List<VrChatWorldSummary> Worlds, bool HasMore);
internal sealed record VrChatFavoriteGroupSummary(string Id, string Name, string DisplayName, string Type, string Visibility = "", string RawJson = "");
internal sealed record VrChatFavoriteGroupsResult(List<VrChatFavoriteGroupSummary> Groups, bool HasMore, int FavoriteGroupLimit = 4);
internal sealed record VrChatCurrentLocationResult(string Location, string WorldId, string InstanceId, VrChatWorldSummary? World);
internal sealed record VrChatLogAvatarResult(bool Found, string AvatarId, string AvatarName, string LogPath, string Timestamp, string Message);
internal sealed record VrChatNotificationSummary(string Id, string Type, string SenderUserId, string SenderUsername, string Message, string CreatedAt, bool Seen, string RawJson);
internal sealed record VrChatNotificationListResult(List<VrChatNotificationSummary> Notifications, bool HasMore);
internal sealed record EncounterHistoryItem(string Timestamp, string Action, string DisplayName, string UserId, string WorldName, string Location, string LogFile);
internal sealed record EncounterHistoryResult(List<EncounterHistoryItem> Items);
internal sealed record PlayerActivityLogItem(string Timestamp, string Action, string DisplayName, string UserId, string WorldName, string Location, string WorldId, string LogFile);
internal sealed record PlayerActivityLogResult(List<PlayerActivityLogItem> Items);
internal sealed record WorldVisitHistoryItem(string Timestamp, string Action, string WorldName, string Location, string LogFile);
internal sealed record WorldVisitHistoryResult(List<WorldVisitHistoryItem> Items);
internal sealed record VrChatRemoteGroup(string Tag, string DisplayName, int SortOrder);
internal sealed record VrChatGroupedAvatar(string GroupTag, AvatarInput Avatar);
internal sealed record VrChatFavoriteRef(string AvatarId, string RemoteFavoriteId);
internal sealed record VrChatFavoriteRecompileResult(string Tag, int Removed, int Added);
internal sealed record VrChatFavoriteImport(List<VrChatRemoteGroup> Groups, List<VrChatGroupedAvatar> Avatars, List<VrChatGroupedAvatar> DeletedAvatars, int FavoriteGroupLimit);
internal sealed record DeletedAvatarMoveSummary(string Name, string Status);
internal sealed record VrChatSyncResult(LibraryData Library, int GroupsSynced, int AvatarsSynced, int MovedToDeleted, List<string> DeletedAvatarNames, List<DeletedAvatarMoveSummary> DeletedAvatarResults, int UpdatedAvatars, List<string> UpdatedAvatarNames, int UploadedAvatars, int FavoriteGroupLimit, int ConflictCount = 0, List<string>? ConflictSummaries = null);
internal sealed record PersistedCookieSession(List<PersistedCookie> Cookies);
internal sealed record PersistedCookie(string Name, string Value);
