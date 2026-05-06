using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Net.Http.Headers;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
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
    public static readonly string BackgroundDirectory = Path.Combine(RootDirectory, "Custom Background");
    public static readonly string GroupBackgroundDirectory = Path.Combine(BackgroundDirectory, "Groups");
    public static readonly string DatabaseDirectory = Path.Combine(RootDirectory, "Database");
    public static readonly string LogsDirectory = Path.Combine(RootDirectory, "Logs");
    public static readonly string AvatarsJsonPath = Path.Combine(RootDirectory, "avatars.json");
    public static readonly string CategoriesJsonPath = Path.Combine(RootDirectory, "categories.json");
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
        NormalizeFolderName("Custom Background");
        NormalizeFolderName("Database");
        NormalizeFolderName("Logs");
        Directory.CreateDirectory(GroupsDirectory);
        Directory.CreateDirectory(ExportDirectory);
        Directory.CreateDirectory(BackupsDirectory);
        Directory.CreateDirectory(BackgroundDirectory);
        Directory.CreateDirectory(GroupBackgroundDirectory);
        Directory.CreateDirectory(DatabaseDirectory);
        Directory.CreateDirectory(LogsDirectory);
        MigrateOldBackups();

        EnsureJsonFile(AvatarsJsonPath, "[]");
        EnsureJsonFile(CategoriesJsonPath, "[]");
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
    private static readonly VrChatClient VrChat = new();
    private static readonly BackgroundStore Background = new();
    private static readonly AvatarDatabaseClient AvatarDatabase = new();
    private static readonly AppUpdateClient Updater = new(UpdateRepositoryOwner, UpdateRepositoryName);
    private static readonly AppLogStore Logs = new();
    private static readonly object SyncedOrderProgressGate = new();
    private static SyncedAvatarOrderProgress SyncedOrderProgress = new("", "idle", "", 0, 0);

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

        var window = new PhotinoWindow
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
        .Load(appPath);

        window.WaitForClose();
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
                "backupGroup" => Store.BackupGroup(GetPayload<IdInput>(request).Id),
                "applySyncedAvatarOrder" => await Store.ApplySyncedGroupAvatarOrderAsync(GetPayload<SyncedAvatarOrderInput>(request), VrChat, UpdateSyncedOrderProgress),
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
                "vrchatLogout" => LogoutAndResetSyncedGroups(),
                "vrchatSyncFavorites" => await Store.SyncVrChatFavoritesAsync(VrChat),
                "vrchatSaveCurrentAvatar" => Store.SaveCurrentAvatar(await VrChat.CurrentAvatarAsync(), GetPayload<CurrentAvatarInput>(request).GroupId),
                "vrchatCurrentAvatar" => await VrChat.CurrentAvatarAsync(),
                "vrchatSelectAvatar" => await SelectAndLogAvatarAsync(GetPayload<IdInput>(request).Id),
                "vrchatLogCurrentAvatar" => Store.SaveRecentAvatar(await VrChat.CurrentAvatarAsync()),
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
                "avatarDatabaseVrcxStatus" => AvatarDatabase.GetVrcxStatus(),
                "avatarDatabasePasUpdateStatus" => await AvatarDatabase.GetPasUpdateStatusAsync(),
                "avatarDatabasePasUpdate" => await AvatarDatabase.UpdatePasDatabaseAsync(),
                "appVersion" => AppUpdateClient.CurrentVersionInfo(UpdateRepositoryOwner, UpdateRepositoryName),
                "updateCheck" => await Updater.CheckAsync(),
                "updateInstall" => await Updater.InstallAsync(),
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
            case "importLibrary": Logs.Info("Import", "Library import completed."); break;
            case "exportLibrary": Logs.Info("Export", "Library export completed."); break;
            case "exportGroup": Logs.Info("Export", "Group export completed."); break;
            case "vrchatLogin":
                Logs.Info("VRChat", result is VrChatSessionState session && session.RequiresTwoFactor ? "VRChat login requires two-factor verification." : "VRChat login completed.");
                break;
            case "vrchatTwoFactor": Logs.Info("VRChat", "VRChat two-factor verification completed."); break;
            case "vrchatLogout": Logs.Info("VRChat", "VRChat logout completed."); break;
            case "vrchatSyncFavorites":
                if (result is VrChatSyncResult sync) Logs.Info("VRChat", $"Favorites synced. Groups: {sync.GroupsSynced}. Avatars: {sync.AvatarsSynced}. Updated: {sync.UpdatedAvatars}. Uploaded: {sync.UploadedAvatars}. Moved to deleted: {sync.MovedToDeleted}.");
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
    }

    private static VrChatSessionState LogoutAndResetSyncedGroups()
    {
        var session = VrChat.Logout();
        Store.ResetSyncedGroupsToDefaults();
        return session;
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
        Directory.CreateDirectory(AppPaths.BackupsDirectory);
        var files = Directory.EnumerateFiles(AppPaths.BackupsDirectory, "*", SearchOption.TopDirectoryOnly)
            .Select(path => new FileInfo(path))
            .OrderByDescending(file => file.LastWriteTimeUtc)
            .Select(file => new BackupFileInfo(file.Name, BackupDisplayName(file.FullName), file.FullName, file.Length, file.LastWriteTime, BackupReason(file.Name)))
            .ToList();
        return new BackupListResult(AppPaths.BackupsDirectory, files);
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
internal sealed record BackupFileInfo(string Name, string DisplayName, string Path, long Size, DateTime LastModified, string Reason);
internal sealed record BackupListResult(string Folder, List<BackupFileInfo> Files);

internal sealed class AvatarStore
{
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
    private readonly string _libraryPath;
    private readonly string _avatarsJsonPath = AppPaths.AvatarsJsonPath;
    private readonly string _categoriesJsonPath = AppPaths.CategoriesJsonPath;
    private readonly object _gate = new();

    public AvatarStore()
    {
        AppPaths.EnsureInitialized();
        Directory.CreateDirectory(_dataDirectory);
        Directory.CreateDirectory(_exportDirectory);
        _libraryPath = Path.Combine(_dataDirectory, "library.json");
        if (!File.Exists(_libraryPath))
        {
            Save(CreateDefaultLibrary());
        }
        else
        {
            Save(Load());
        }
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
            if (IsSyncedGroupId(target.Id) || IsPinnedSystemGroupId(target.Id)) throw new InvalidOperationException("Choose a local group.");
            if (source.Id.Equals(target.Id, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Choose a different target group.");

            var now = DateTimeOffset.UtcNow;
            var copied = 0;
            foreach (var avatar in lib.Avatars.Where(x => x.GroupId == source.Id).OrderBy(x => x.Order).ThenBy(x => x.CreatedAt).ToList())
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
            if ((avatar is null || !avatar.GroupId.Equals(input.GroupId, StringComparison.OrdinalIgnoreCase)) && IsPinnedSystemGroupId(input.GroupId))
            {
                throw new InvalidOperationException("Recent and Deleted groups are managed automatically.");
            }
            EnsureSyncedGroupCapacity(lib, input.GroupId, input.Id, input.AvatarId);
            if (avatar is null)
            {
                avatar = new AvatarFavorite { Id = NewId("local"), CreatedAt = now, Order = NextAvatarOrder(lib, input.GroupId), Source = input.Source?.Trim() ?? "" };
                lib.Avatars.Add(avatar);
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
            avatar.GroupId = input.GroupId;
            avatar.Order = NextAvatarOrder(lib, input.GroupId);
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
            lib.Avatars.Add(CloneAvatar(avatar, input.GroupId, now, NextAvatarOrder(lib, input.GroupId)));
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

        var remoteResult = await client.RecompileFavoriteAvatarGroupAsync(input.GroupId, avatarIds, progress);

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
            var previousSynced = lib.Avatars
                .Where(x => x.GroupId.StartsWith("vrc_", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(x.AvatarId))
                .GroupBy(x => x.AvatarId, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(x => x.Key, x => x.OrderByDescending(a => a.UpdatedAt).First(), StringComparer.OrdinalIgnoreCase);
            var previousSyncedByLocation = lib.Avatars
                .Where(x => x.GroupId.StartsWith("vrc_", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(x.AvatarId))
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
                var order = 0;
                foreach (var item in syncedAvatars.Where(x => x.Previous is null))
                {
                    lib.Avatars.Add(CreateSyncedFavorite(item.Avatar, item.Previous, groupId, now, order++));
                }
                foreach (var item in syncedAvatars.Where(x => x.Previous is not null).OrderBy(x => x.Previous!.Order).ThenBy(x => x.Previous!.CreatedAt))
                {
                    lib.Avatars.Add(CreateSyncedFavorite(item.Avatar, item.Previous, groupId, now, order++));
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
            return new VrChatSyncResult(lib, imported.Groups.Count, imported.Avatars.Count, movedToDeleted.Count, movedToDeleted.Select(x => x.Name).ToList(), movedToDeleted, storedAvatarRefresh.ChangedAvatars.Count, storedAvatarRefresh.ChangedAvatars.Select(x => string.IsNullOrWhiteSpace(x.Name) ? x.AvatarId : x.Name).Where(x => !string.IsNullOrWhiteSpace(x)).ToList(), uploadedAvatars.Count, imported.Groups.Count);
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
                    lock (unavailable) unavailable.Add(candidate);
                    return;
                }

                lock (updated) updated.Add(live);
                if (AvatarMetadataChanged(candidate, live))
                {
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
        if (HasChanged(stored.RemoteUpdatedAt, live.RemoteUpdatedAt)) return true;
        return HasChanged(stored.Name, live.Name)
            || HasChanged(stored.Description, live.Description)
            || HasChanged(stored.AuthorId, live.AuthorId)
            || HasChanged(stored.AuthorName, live.AuthorName)
            || HasChanged(stored.ImageUrl, live.ImageUrl)
            || HasChanged(stored.ThumbnailImageUrl, live.ThumbnailImageUrl)
            || HasChanged(stored.ReleaseStatus, live.ReleaseStatus)
            || HasChanged(stored.Version, live.Version)
            || HasChanged(stored.Platforms, live.Platforms)
            || HasChanged(stored.Tags, live.Tags);
    }
    private static bool HasVrChatMetadataBaseline(AvatarInput stored)
    {
        var source = stored.Source?.Trim() ?? "";
        return source.Contains("vrchat", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(stored.RemoteUpdatedAt);
    }
    private static bool HasChanged(string? oldValue, string? newValue)
    {
        var next = newValue?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(next)) return false;
        return !string.Equals(oldValue?.Trim() ?? "", next, StringComparison.Ordinal);
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
        Directory.CreateDirectory(_backupDirectory);
        var timestamp = DateTimeOffset.Now.ToString("yyyyMMdd-HHmmss");
        var fileName = $"{timestamp}-{SafeFileNameOrDefault(group.Name, "Group")}-{reason}.json";
        var path = UniqueBackupPath(_backupDirectory, fileName);
        File.WriteAllText(path, JsonSerializer.Serialize(GroupSummary(group, lib.Avatars.Where(x => x.GroupId == group.Id).OrderBy(x => x.Order)), ProgramJson.Options));
        BackgroundStore.CopyGroupBackgroundToBackup(group.Id, group.Name, path);
        return new ExportResult(path);
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
    private static readonly AppSettings DefaultSettings = new(10, 10, "#303735", 20, 35, "#303735", true, "", 6);
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
        return new AppSettings(grid, databaseGrid, color, opacity, panelOpacity, panelColor, panelSynced, s.BackgroundEffect ?? "", 6);
    }
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

internal sealed class VrChatClient
{
    private const int DefaultAvatarFavoriteGroupLimit = 1;
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
        return ReadAvatar(doc.RootElement);
    }
    public async Task<AvatarInput> CurrentAvatarAsync()
    {
        var user = await GetCurrentUserAsync();
        if (string.IsNullOrWhiteSpace(user.CurrentAvatarId)) throw new InvalidOperationException("No current avatar is available.");
        return await FetchAvatarAsync(user.CurrentAvatarId);
    }
    public async Task<List<AvatarInput>> GetUploadedAvatarsAsync()
    {
        var avatars = new List<AvatarInput>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var offset = 0;
        const int pageSize = 100;
        while (true)
        {
            using var response = await _client.GetAsync($"avatars?user=me&n={pageSize}&offset={offset}&sort=updated&order=descending");
            var json = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"VRChat uploaded avatars returned {(int)response.StatusCode}.");
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
        return avatars;
    }
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
        var groups = await GetFavoriteAvatarGroupsAsync();
        var avatars = new List<VrChatGroupedAvatar>();
        var deletedAvatars = new List<VrChatGroupedAvatar>();
        foreach (var group in groups)
        {
            var favoriteRefs = await GetFavoriteAvatarRefsAsync(group.Tag);
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
                        deletedAvatars.Add(new VrChatGroupedAvatar(group.Tag, avatar));
                    }
                    else
                    {
                        if (!string.IsNullOrWhiteSpace(avatar.AvatarId))
                        {
                            detailedAvatarIds.Add(avatar.AvatarId);
                        }
                        avatars.Add(new VrChatGroupedAvatar(group.Tag, avatar));
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
                    avatars.Add(new VrChatGroupedAvatar(group.Tag, checkedAvatar));
                    continue;
                }

                deletedAvatars.Add(new VrChatGroupedAvatar(group.Tag, checkedAvatar ?? new AvatarInput
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
        }
        return new VrChatFavoriteImport(groups, avatars, deletedAvatars);
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
    private async Task<List<VrChatRemoteGroup>> GetFavoriteAvatarGroupsAsync()
    {
        var currentUser = await GetCurrentUserAsync();
        var groupLimit = await GetAvatarFavoriteGroupLimitAsync();
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

        return groups.Values.OrderBy(x => x.SortOrder).ThenBy(x => x.DisplayName, StringComparer.OrdinalIgnoreCase).ToList();
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
    private async Task<int> GetAvatarFavoriteGroupLimitAsync()
    {
        try
        {
            using var response = await _client.GetAsync("auth/user/favoritelimits");
            if (!response.IsSuccessStatusCode) return DefaultAvatarFavoriteGroupLimit;
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            if (doc.RootElement.TryGetProperty("maxFavoriteGroups", out var maxGroups) &&
                maxGroups.TryGetProperty("avatar", out var avatarGroups) &&
                avatarGroups.ValueKind == JsonValueKind.Number &&
                avatarGroups.TryGetInt32(out var limit))
            {
                return Math.Clamp(limit, 1, 24);
            }
        }
        catch
        {
        }
        return DefaultAvatarFavoriteGroupLimit;
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
    private static VrChatUserSummary ReadUser(JsonElement root) => new(ReadString(root, "id") ?? "", ReadString(root, "displayName") ?? "", ReadString(root, "currentAvatar") ?? "", ReadString(root, "currentAvatarImageUrl") ?? "", ReadString(root, "currentAvatarThumbnailImageUrl") ?? "");
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
        $"all-count\n{input.Query?.Trim() ?? ""}\n{input.AuthorId?.Trim() ?? ""}\n{input.SearchAvatar}\n{input.SearchAuthor}\n{input.SearchDescription}\n{input.SearchTags}\n{input.PlatformFilters}";

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
        var reversedQuery = ReverseText(query);
        if (input.SearchAvatar)
        {
            if (query.Length > 0 && database.AvatarNames[index].Contains(reversedQuery, StringComparison.OrdinalIgnoreCase)) textMatches = true;
            if (query.Length > 0 && LooksLikeAvatarIdQuery(query) && DecodePasAvatarId(database, index).Contains(query, StringComparison.OrdinalIgnoreCase)) textMatches = true;
        }

        if (input.SearchAuthor)
        {
            var authorIndex = database.AuthorIds[index];
            if (query.Length > 0 && authorIndex < (uint)database.AuthorNames.Length && database.AuthorNames[(int)authorIndex].Contains(reversedQuery, StringComparison.OrdinalIgnoreCase)) textMatches = true;
        }

        if (query.Length > 0 && input.SearchTags && PasTags(database).Contains(query, StringComparison.OrdinalIgnoreCase)) textMatches = true;
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
        return $"pas\n{path}\n{stamp}\n{input.Query?.Trim() ?? ""}\n{input.AuthorId?.Trim() ?? ""}\n{input.SearchAvatar}\n{input.SearchAuthor}\n{input.SearchDescription}\n{input.SearchTags}\n{input.PlatformFilters}\n{page}\n{limit}";
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
        $"avtrzip\n{input.Query?.Trim() ?? ""}\n{input.AuthorId?.Trim() ?? ""}\n{input.SearchAvatar}\n{input.SearchAuthor}\n{input.SearchDescription}\n{input.SearchTags}\n{input.PlatformFilters}\n{page}\n{limit}";
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
        $"vrcx-remote\n{VrcxRemoteDatabaseUrl}\n{input.Query?.Trim() ?? ""}\n{input.AuthorId?.Trim() ?? ""}\n{input.SearchAvatar}\n{input.SearchAuthor}\n{input.SearchDescription}\n{input.SearchTags}\n{input.PlatformFilters}\n{page}\n{limit}";

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
        if (!string.IsNullOrWhiteSpace(query) && input.SearchAvatar) textFields.Add("(a.name LIKE @like ESCAPE '\\' OR a.id LIKE @like ESCAPE '\\')");
        if (!string.IsNullOrWhiteSpace(query) && input.SearchAuthor) textFields.Add("(a.author_name LIKE @like ESCAPE '\\' OR a.author_id LIKE @like ESCAPE '\\')");
        if (!string.IsNullOrWhiteSpace(query) && input.SearchDescription) textFields.Add("a.description LIKE @like ESCAPE '\\'");
        if (!string.IsNullOrWhiteSpace(query) && input.SearchTags)
        {
            textFields.Add("""
                (EXISTS (SELECT 1 FROM avatar_tags t WHERE t.avatar_id = a.id AND t.tag LIKE @like ESCAPE '\')
                 OR EXISTS (SELECT 1 FROM avatar_memos m WHERE m.avatar_id = a.id AND m.memo LIKE @like ESCAPE '\'))
                """);
        }
        if (textFields.Count > 0)
        {
            command.Parameters.AddWithValue("@like", $"%{EscapeLike(query)}%");
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
        if (input.SearchAvatar && TextMatches(query, avatar.Name, avatar.AvatarId, avatar.Id)) textMatches = true;
        if (input.SearchAuthor && TextMatches(query, avatar.AuthorName, avatar.AuthorId)) textMatches = true;
        if (input.SearchDescription && TextMatches(query, avatar.Description)) textMatches = true;
        if (input.SearchTags && TextMatches(query, avatar.Tags, avatar.Notes)) textMatches = true;
        if (!textMatches) return false;
        return MatchesPlatformFilters(MergeTagText(avatar.Platforms, avatar.Tags), input);
    }

    private static bool TextMatches(string query, params string?[] values) =>
        values.Any(value => !string.IsNullOrWhiteSpace(value) && value.Contains(query, StringComparison.OrdinalIgnoreCase));

    private static bool MatchesPlatformFilters(string value, AvatarSearchInput input)
    {
        var filters = OptionFilterValues(input.PlatformFilters);
        if (filters.Count == 0) return true;
        return filters.SelectMany(PlatformFilterAliases).Any(filter => TextMatches(filter, value));
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
        $"{Path.GetFullPath(databasePath)}\n{File.GetLastWriteTimeUtc(databasePath).Ticks}\n{input.Query?.Trim() ?? ""}\n{input.AuthorId?.Trim() ?? ""}\n{input.SearchAvatar}\n{input.SearchAuthor}\n{input.SearchDescription}\n{input.SearchTags}\n{input.PlatformFilters}\n{page}\n{limit}";

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
internal sealed class LibraryData { public List<AvatarGroup> Groups { get; set; } = []; public List<AvatarFavorite> Avatars { get; set; } = []; }
internal sealed class AvatarGroup { public string Id { get; set; } = ""; public string Name { get; set; } = ""; public string Description { get; set; } = ""; public string Icon { get; set; } = ""; public string BackgroundFolder { get; set; } = ""; public string BackgroundEffect { get; set; } = "global"; public int Order { get; set; } public bool? ReorderLocked { get; set; } public DateTimeOffset CreatedAt { get; set; } public DateTimeOffset UpdatedAt { get; set; } }
internal sealed class AvatarFavorite : AvatarInput { public int Order { get; set; } = -1; public DateTimeOffset CreatedAt { get; set; } public DateTimeOffset UpdatedAt { get; set; } }
internal sealed class GroupInput { public string Id { get; set; } = ""; public string Name { get; set; } = ""; public string Description { get; set; } = ""; public string Icon { get; set; } = ""; public string BackgroundFolder { get; set; } = ""; public string? BackgroundEffect { get; set; } }
internal sealed class GroupLockInput { public string Id { get; set; } = ""; public bool ReorderLocked { get; set; } = true; }
internal sealed class CopyGroupToExistingInput { public string Id { get; set; } = ""; public string TargetGroupId { get; set; } = ""; }
internal class AvatarInput { public string Id { get; set; } = ""; public string GroupId { get; set; } = ""; public string AvatarId { get; set; } = ""; public string Name { get; set; } = ""; public string Description { get; set; } = ""; public string AuthorId { get; set; } = ""; public string AuthorName { get; set; } = ""; public string ImageUrl { get; set; } = ""; public string ThumbnailImageUrl { get; set; } = ""; public string ReleaseStatus { get; set; } = ""; public string Version { get; set; } = ""; public string Platforms { get; set; } = ""; public string Tags { get; set; } = ""; public string SourceUrl { get; set; } = ""; public string Notes { get; set; } = ""; public string RawJson { get; set; } = ""; public string Source { get; set; } = ""; public string RemoteCreatedAt { get; set; } = ""; public string RemoteUpdatedAt { get; set; } = ""; public string RemoteFavoriteId { get; set; } = ""; }
internal sealed class IdInput { public string Id { get; set; } = ""; public string Path { get; set; } = ""; }
internal sealed class BackupRestoreInput { public string Path { get; set; } = ""; public string Mode { get; set; } = ""; }
internal sealed class MoveAvatarInput { public string AvatarId { get; set; } = ""; public string GroupId { get; set; } = ""; }
internal sealed class ReorderInput { public string Id { get; set; } = ""; public string GroupId { get; set; } = ""; public int Position { get; set; } = 1; }
internal sealed record SyncedAvatarOrderInput(string GroupId, List<string> AvatarIds);
internal sealed record SyncedAvatarOrderProgress(string GroupId, string Stage, string Message, int Completed, int Total);
internal sealed record SyncedAvatarOrderApplyResult(LibraryData Library, int Removed, int Added, string Tag, string BackupPath);
internal sealed record CleanLibraryExport(List<GroupFileSummary> Groups);
internal sealed record GroupFileSummary(string Id, string Name, string Description, string Icon, string BackgroundFolder = "", string BackgroundEffect = "global", List<AvatarInput>? Avatars = null);
internal sealed record BackgroundInput(string GroupId = "");
internal sealed record BackgroundImportResult(int Imported, int Skipped, string Folder);
internal sealed record BackgroundResult(string DataUrl, string Folder, string MediaType = "", string MimeType = "", string FileName = "", string Source = "global");
internal sealed record AppLogEntry(DateTimeOffset Timestamp, string Level, string Area, string Message, string Detail = "");
internal sealed record AppLogList(string Folder, List<AppLogEntry> Entries);
internal sealed record ExportResult(string Path);
internal sealed record GroupClearResult(LibraryData Library, int Removed, string BackupPath);
internal sealed record AppSettings(int GridSize = 10, int DatabaseGridSize = 10, string ThemeColor = "#303735", int BackgroundOpacity = 20, int PanelOpacity = 35, string PanelColor = "#303735", bool PanelColorSynced = true, string BackgroundEffect = "", int SchemaVersion = 6);
internal sealed record AvatarSearchInput(string Query, int Limit = 50, int Page = 1, string AuthorId = "", bool SearchAvatar = true, bool SearchAuthor = true, bool SearchDescription = true, bool SearchTags = true, string PlatformFilters = "", string Provider = "vrcx");
internal sealed record AvatarDatabaseSearchResult(List<AvatarInput> Results, int Page, bool HasMore, DateTimeOffset CachedAt, int Total = 0);
internal sealed record AvatarDatabaseCountResult(string Query, int Total, DateTimeOffset CachedAt);
internal sealed record AvatarDatabaseCountProgress(int Discovered, bool Counting, bool Finished);
internal sealed record VrcxDatabaseStatus(bool HasLocalDatabase, string Path, string DatabaseDirectory);
internal sealed record PasUpdateStatus(bool HasLocalFile, bool HasUpdate, string LocalFileDate, string RemoteFileDate, long LocalBytes, long RemoteBytes, string Url, string Message);
internal sealed record AvtrZipSearchPage(AvatarDatabaseSearchResult Result, int TotalCount, int TotalPages, int NextCode, int RandomCode, int InputPageCode);
internal sealed record PasDatabaseData(string Path, string PlatformLabel, string FileDate, int AvatarCount, int AuthorCount, int FileAvatarCount, int FileAuthorCount, byte[] DynamicBytes, byte[] AvatarIds, uint[] AuthorIds, string[] AvatarNames, string[] AuthorNames);
internal sealed record PasDatabaseInfo(string Location, string FileDate, long ContentLength, DateTimeOffset? LastModifiedUtc, string ETag, int AvatarCount, int AuthorCount, int FileAvatarCount, int FileAuthorCount, bool HeaderVerified);
internal sealed record LoginInput(string Username, string Password);
internal sealed record TwoFactorInput(string Code, string Method);
internal sealed record CurrentAvatarInput(string GroupId);
internal sealed record VrChatFavoriteChangeInput(string AvatarId, string GroupId);
internal sealed record VrChatSessionState(bool IsLoggedIn, bool RequiresTwoFactor, string[] TwoFactorMethods, VrChatUserSummary? User);
internal sealed record VrChatUserSummary(string Id, string DisplayName, string CurrentAvatarId, string CurrentAvatarImageUrl, string CurrentAvatarThumbnailImageUrl);
internal sealed record VrChatRemoteGroup(string Tag, string DisplayName, int SortOrder);
internal sealed record VrChatGroupedAvatar(string GroupTag, AvatarInput Avatar);
internal sealed record VrChatFavoriteRef(string AvatarId, string RemoteFavoriteId);
internal sealed record VrChatFavoriteRecompileResult(string Tag, int Removed, int Added);
internal sealed record VrChatFavoriteImport(List<VrChatRemoteGroup> Groups, List<VrChatGroupedAvatar> Avatars, List<VrChatGroupedAvatar> DeletedAvatars);
internal sealed record DeletedAvatarMoveSummary(string Name, string Status);
internal sealed record VrChatSyncResult(LibraryData Library, int GroupsSynced, int AvatarsSynced, int MovedToDeleted, List<string> DeletedAvatarNames, List<DeletedAvatarMoveSummary> DeletedAvatarResults, int UpdatedAvatars, List<string> UpdatedAvatarNames, int UploadedAvatars, int FavoriteGroupLimit);
internal sealed record PersistedCookieSession(List<PersistedCookie> Cookies);
internal sealed record PersistedCookie(string Name, string Value);
