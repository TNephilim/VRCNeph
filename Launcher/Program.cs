using System.Diagnostics;
using System.IO.Compression;
using Microsoft.Win32;

namespace VRCNeph.Launcher;

internal static class Program
{
    private const string EmbeddedPackageName = "VRCNephAssets.zip";
    private const string AppExeName = "VRCNeph.App.exe";
    private const string DotnetInstallerUrl = "https://aka.ms/dotnet/8.0/windowsdesktop-runtime-win-x64.exe";
    private const string WebViewInstallerUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
    private const string WebViewClientKey = @"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    private const string WebViewUserKey = @"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    private static readonly HttpClient Http = new();

    [STAThread]
    private static async Task<int> Main(string[] args)
    {
        try
        {
            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "VRCNeph");
            var appDirectory = Path.Combine(root, "App");
            Directory.CreateDirectory(root);

            if (!HasDesktopRuntime())
            {
                await InstallPrerequisiteAsync(root, DotnetInstallerUrl, "VRCNeph-dotnet-runtime.exe", "/install /quiet /norestart");
                if (!HasDesktopRuntime()) throw new InvalidOperationException(".NET 8 Desktop Runtime was not available after its installer completed.");
            }
            if (!HasWebView2Runtime())
            {
                await InstallPrerequisiteAsync(root, WebViewInstallerUrl, "VRCNeph-webview2-runtime.exe", "/silent /install");
                if (!HasWebView2Runtime()) throw new InvalidOperationException("Microsoft Edge WebView2 Runtime was not available after its installer completed.");
            }

            EnsureEmbeddedAppPackage(appDirectory);

            CleanupLegacyTempCache();

            var appExe = Path.Combine(appDirectory, AppExeName);
            if (!File.Exists(appExe)) throw new FileNotFoundException("VRCNeph's installed app executable is missing.", appExe);

            var launcher = Environment.ProcessPath ?? throw new InvalidOperationException("Could not determine the VRCNeph launcher path.");
            var process = Process.Start(new ProcessStartInfo(appExe, JoinLaunchArguments(args))
            {
                WorkingDirectory = appDirectory,
                UseShellExecute = false,
                CreateNoWindow = false,
                WindowStyle = ProcessWindowStyle.Normal,
                Environment = { ["VRCNEPH_LAUNCHER_PATH"] = launcher }
            });
            if (process is null) throw new InvalidOperationException("VRCNeph could not start its installed app files.");
            return 0;
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
            return 1;
        }
    }

    private static bool HasDesktopRuntime()
    {
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var runtimeRoot = Path.Combine(programFiles, "dotnet", "shared", "Microsoft.WindowsDesktop.App");
        return Directory.Exists(runtimeRoot) && Directory.EnumerateDirectories(runtimeRoot, "8.*").Any();
    }

    private static bool HasWebView2Runtime() => HasRegistryVersion(Registry.LocalMachine, WebViewClientKey) || HasRegistryVersion(Registry.CurrentUser, WebViewUserKey);

    private static bool HasRegistryVersion(RegistryKey hive, string keyPath)
    {
        using var key = hive.OpenSubKey(keyPath, false);
        var version = key?.GetValue("pv") as string;
        return !string.IsNullOrWhiteSpace(version) && !version.Equals("0.0.0.0", StringComparison.Ordinal);
    }

    private static async Task InstallPrerequisiteAsync(string root, string url, string fileName, string arguments)
    {
        var installer = Path.Combine(root, fileName);
        try
        {
            await using (var source = await Http.GetStreamAsync(url))
            await using (var target = File.Create(installer))
            {
                await source.CopyToAsync(target);
            }

            using var process = Process.Start(new ProcessStartInfo(installer, arguments)
            {
                UseShellExecute = true,
                Verb = "runas"
            }) ?? throw new InvalidOperationException("Could not start the prerequisite installer.");
            await process.WaitForExitAsync();
            if (process.ExitCode is not 0 and not 3010) throw new InvalidOperationException($"The prerequisite installer returned exit code {process.ExitCode}.");
        }
        finally
        {
            TryDeleteFile(installer);
        }
    }

    private static void EnsureEmbeddedAppPackage(string appDirectory)
    {
        var packageVersion = ReadEmbeddedPackageVersion();
        if (AppPackageIsCurrent(appDirectory, packageVersion)) return;

        // The installed app owns files beneath appDirectory. It must be allowed to
        // close before this launcher swaps the folder for a newer embedded package.
        CloseInstalledAppForPackageReplacement(appDirectory);
        InstallEmbeddedAppPackage(appDirectory, packageVersion);
    }

    private static void CloseInstalledAppForPackageReplacement(string appDirectory)
    {
        var installedAppPath = Path.GetFullPath(Path.Combine(appDirectory, AppExeName));
        var processName = Path.GetFileNameWithoutExtension(AppExeName);
        var installedInstances = Process.GetProcessesByName(processName)
            .Where(process => IsProcessRunningFromPath(process, installedAppPath))
            .ToList();

        try
        {
            foreach (var process in installedInstances)
            {
                if (!process.CloseMainWindow())
                {
                    throw new InvalidOperationException("VRCNeph is running but could not be asked to close for the update. Close VRCNeph, then open it again.");
                }
            }

            var deadline = DateTimeOffset.UtcNow.AddSeconds(10);
            while (installedInstances.Any(process => IsStillRunning(process)) && DateTimeOffset.UtcNow < deadline)
            {
                Thread.Sleep(100);
            }

            if (installedInstances.Any(IsStillRunning))
            {
                throw new InvalidOperationException("VRCNeph is still closing. Wait a moment, then open VRCNeph again.");
            }
        }
        finally
        {
            foreach (var process in installedInstances) process.Dispose();
        }
    }

    private static bool IsProcessRunningFromPath(Process process, string expectedPath)
    {
        try
        {
            return !process.HasExited
                && string.Equals(Path.GetFullPath(process.MainModule?.FileName ?? ""), expectedPath, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            // Access can fail for a process that is already exiting. It cannot be
            // safely identified as this installed app, so leave it untouched.
            return false;
        }
    }

    private static bool IsStillRunning(Process process)
    {
        try { return !process.HasExited; }
        catch { return false; }
    }

    private static string ReadEmbeddedPackageVersion()
    {
        using var package = OpenEmbeddedPackage();
        using var archive = new ZipArchive(package, ZipArchiveMode.Read);
        var marker = archive.GetEntry(".vrcneph-package-version") ?? throw new InvalidOperationException("The VRCNeph app package is missing its version marker.");
        using var stream = marker.Open();
        using var reader = new StreamReader(stream);
        var version = reader.ReadToEnd().Trim();
        if (string.IsNullOrWhiteSpace(version)) throw new InvalidOperationException("The VRCNeph app package has an empty version marker.");
        return version;
    }

    private static Stream OpenEmbeddedPackage() => typeof(Program).Assembly.GetManifestResourceStream(EmbeddedPackageName)
        ?? throw new InvalidOperationException("The VRCNeph app package is missing from this EXE.");

    private static bool AppPackageIsCurrent(string appDirectory, string packageVersion)
    {
        var marker = Path.Combine(appDirectory, ".vrcneph-package-version");
        return File.Exists(Path.Combine(appDirectory, AppExeName))
            && File.Exists(marker)
            && string.Equals(File.ReadAllText(marker).Trim(), packageVersion, StringComparison.Ordinal);
    }

    private static void InstallEmbeddedAppPackage(string appDirectory, string packageVersion)
    {
        var staging = appDirectory + ".new";
        var previous = appDirectory + ".previous";
        TryDeleteDirectory(staging);
        Directory.CreateDirectory(staging);
        using (var package = OpenEmbeddedPackage())
        using (var archive = new ZipArchive(package, ZipArchiveMode.Read))
        {
            archive.ExtractToDirectory(staging, true);
        }
        File.WriteAllText(Path.Combine(staging, ".vrcneph-package-version"), packageVersion);
        if (!File.Exists(Path.Combine(staging, AppExeName))) throw new InvalidOperationException("The VRCNeph app package does not contain VRCNeph.App.exe.");

        TryDeleteDirectory(previous);
        if (Directory.Exists(appDirectory)) Directory.Move(appDirectory, previous);
        Directory.Move(staging, appDirectory);
        TryDeleteDirectory(previous);
    }

    private static string JoinLaunchArguments(IEnumerable<string> args) => string.Join(" ", args.Select(Quote));
    private static string Quote(string value) => value.Contains(' ') || value.Contains('"') ? $"\"{value.Replace("\"", "\\\"")}\"" : value;

    private static void TryDeleteDirectory(string path)
    {
        try { if (Directory.Exists(path)) Directory.Delete(path, true); } catch { }
    }

    private static void TryDeleteFile(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    private static void CleanupLegacyTempCache()
    {
        // Old self-contained VRCNeph builds used these exact folders. Never delete them
        // while another VRCNeph process could still depend on the extracted native DLLs.
        var otherVrcNephIsRunning = Process.GetProcessesByName("VRCNeph")
            .Any(process =>
            {
                try { return process.Id != Environment.ProcessId && !process.HasExited; }
                catch { return true; }
                finally { process.Dispose(); }
            });
        if (otherVrcNephIsRunning) return;

        var temp = Path.GetTempPath();
        TryDeleteDirectory(Path.Combine(temp, "VRCNeph-app"));
        TryDeleteDirectory(Path.Combine(temp, ".net", "VRCNeph"));
    }

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern int MessageBox(nint owner, string text, string caption, uint type);
    private static void ShowError(string text) => MessageBox(0, text, "VRCNeph", 0x10);
}
