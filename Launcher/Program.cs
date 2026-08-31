using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Win32;

namespace VRCNeph.Launcher;

internal static class Program
{
    private const string Owner = "TNephilim";
    private const string Repository = "VRCNeph";
    private const string PackageName = "VRCNeph-app.zip";
    private const string ReleaseManifestName = "VRCNeph-release.json";
    private const string AppExeName = "VRCNeph.App.exe";
    private const string DotnetInstallerUrl = "https://aka.ms/dotnet/8.0/windowsdesktop-runtime-win-x64.exe";
    private const string WebViewInstallerUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
    private const string WebViewClientKey = @"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    private const string WebViewUserKey = @"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    private static readonly HttpClient Http = CreateHttp();

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

            var localPackage = ReadOption(args, "--package");
            if (!string.IsNullOrWhiteSpace(localPackage))
            {
                var package = Path.GetFullPath(localPackage);
                if (!File.Exists(package)) throw new FileNotFoundException("VRCNeph's app package could not be found.", package);
                var packageVersion = await ReadPackageVersionAsync(package);
                if (!AppPackageIsCurrent(appDirectory, packageVersion)) InstallAppPackage(package, appDirectory, packageVersion);
            }
            else
            {
                await EnsureLatestAppPackageAsync(root, appDirectory);
            }

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

    private static HttpClient CreateHttp()
    {
        var client = new HttpClient();
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("VRCNeph-Launcher", "1.0"));
        return client;
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

    private static async Task EnsureLatestAppPackageAsync(string root, string appDirectory)
    {
        try
        {
            using var response = await Http.GetAsync($"https://api.github.com/repos/{Owner}/{Repository}/releases/latest");
            response.EnsureSuccessStatusCode();
            using var release = JsonDocument.Parse(await response.Content.ReadAsStreamAsync());
            var version = NormalizeVersion(release.RootElement.GetProperty("tag_name").GetString() ?? "");
            var assets = release.RootElement.GetProperty("assets").EnumerateArray().ToArray();
            var packageUrl = assets
                .Where(asset => string.Equals(asset.GetProperty("name").GetString(), PackageName, StringComparison.OrdinalIgnoreCase))
                .Select(asset => asset.GetProperty("browser_download_url").GetString())
                .FirstOrDefault(url => !string.IsNullOrWhiteSpace(url));
            var manifestUrl = assets
                .Where(asset => string.Equals(asset.GetProperty("name").GetString(), ReleaseManifestName, StringComparison.OrdinalIgnoreCase))
                .Select(asset => asset.GetProperty("browser_download_url").GetString())
                .FirstOrDefault(url => !string.IsNullOrWhiteSpace(url));
            if (string.IsNullOrWhiteSpace(version) || string.IsNullOrWhiteSpace(packageUrl) || string.IsNullOrWhiteSpace(manifestUrl)) throw new InvalidOperationException("The latest VRCNeph release does not include a valid app package and verification manifest.");
            if (AppPackageIsCurrent(appDirectory, version)) return;

            var manifest = JsonDocument.Parse(await Http.GetStringAsync(manifestUrl));
            var manifestVersion = manifest.RootElement.GetProperty("version").GetString() ?? "";
            var manifestPackage = manifest.RootElement.GetProperty("package").GetString() ?? "";
            var expectedHash = manifest.RootElement.GetProperty("sha256").GetString() ?? "";
            if (!string.Equals(manifestVersion, version, StringComparison.Ordinal) || !string.Equals(manifestPackage, PackageName, StringComparison.Ordinal) || expectedHash.Length != 64)
            {
                throw new InvalidOperationException("The VRCNeph release manifest does not match its GitHub release.");
            }

            var cacheDirectory = Path.Combine(root, "Package Cache");
            Directory.CreateDirectory(cacheDirectory);
            var destination = Path.Combine(cacheDirectory, PackageName);
            var temporary = destination + ".download";
            await using (var source = await Http.GetStreamAsync(packageUrl))
            await using (var target = File.Create(temporary))
            {
                await source.CopyToAsync(target);
            }
            await using (var packageStream = File.OpenRead(temporary))
            {
                var actualHash = Convert.ToHexString(await SHA256.HashDataAsync(packageStream));
                if (!actualHash.Equals(expectedHash, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("The VRCNeph app package did not match its release hash.");
            }
            File.Move(temporary, destination, true);
            var packageVersion = await ReadPackageVersionAsync(destination);
            if (!string.Equals(packageVersion, version, StringComparison.Ordinal)) throw new InvalidOperationException("The downloaded VRCNeph app package version does not match its GitHub release.");
            InstallAppPackage(destination, appDirectory, packageVersion);
        }
        catch when (File.Exists(Path.Combine(appDirectory, AppExeName)))
        {
            // A previously installed package remains usable when GitHub is temporarily unavailable.
        }
    }

    private static async Task<string> ReadPackageVersionAsync(string packagePath)
    {
        await using var package = File.OpenRead(packagePath);
        using var archive = new ZipArchive(package, ZipArchiveMode.Read);
        var marker = archive.GetEntry(".vrcneph-package-version") ?? throw new InvalidOperationException("The VRCNeph app package is missing its version marker.");
        await using var stream = marker.Open();
        using var reader = new StreamReader(stream);
        var version = (await reader.ReadToEndAsync()).Trim();
        if (string.IsNullOrWhiteSpace(version)) throw new InvalidOperationException("The VRCNeph app package has an empty version marker.");
        return version;
    }

    private static bool AppPackageIsCurrent(string appDirectory, string packageVersion)
    {
        var marker = Path.Combine(appDirectory, ".vrcneph-package-version");
        return File.Exists(Path.Combine(appDirectory, AppExeName))
            && File.Exists(marker)
            && string.Equals(File.ReadAllText(marker).Trim(), packageVersion, StringComparison.Ordinal);
    }

    private static void InstallAppPackage(string packagePath, string appDirectory, string packageVersion)
    {
        var staging = appDirectory + ".new";
        var previous = appDirectory + ".previous";
        TryDeleteDirectory(staging);
        Directory.CreateDirectory(staging);
        ZipFile.ExtractToDirectory(packagePath, staging, true);
        File.WriteAllText(Path.Combine(staging, ".vrcneph-package-version"), packageVersion);
        if (!File.Exists(Path.Combine(staging, AppExeName))) throw new InvalidOperationException("The VRCNeph app package does not contain VRCNeph.App.exe.");

        TryDeleteDirectory(previous);
        if (Directory.Exists(appDirectory)) Directory.Move(appDirectory, previous);
        Directory.Move(staging, appDirectory);
        TryDeleteDirectory(previous);
    }

    private static string? ReadOption(IEnumerable<string> args, string option)
    {
        var values = args.ToArray();
        for (var index = 0; index < values.Length - 1; index++)
        {
            if (values[index].Equals(option, StringComparison.OrdinalIgnoreCase)) return values[index + 1];
        }
        return null;
    }

    private static string JoinLaunchArguments(IEnumerable<string> args)
    {
        var retained = new List<string>();
        using var enumerator = args.GetEnumerator();
        while (enumerator.MoveNext())
        {
            if (enumerator.Current.Equals("--package", StringComparison.OrdinalIgnoreCase))
            {
                enumerator.MoveNext();
                continue;
            }
            retained.Add(enumerator.Current);
        }
        return string.Join(" ", retained.Select(Quote));
    }
    private static string NormalizeVersion(string value) => value.Trim().TrimStart('v', 'V');
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
