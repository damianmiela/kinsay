// Kinsay's desktop app (2026-11-12, from the wedding app's small subtitles app): a Windows shell round
// the subtitles window's page (`/window`). It adds only what a browser can't: a window that stays on top
// of any call app, and this computer's sound (Windows' audio loopback) handed to the page as
// `window.liveShell`. Signing in happens in the person's own browser (the page's part; Google allows no
// sign-in inside an app's window): the app opens the app's own https links there.
// Locked down: only the app's own address in the window, only the microphone allowed, the bridge only on
// the app's own /window page, every message from the page checked to come from it.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wave;

namespace TranslateApp
{
    static class Program
    {
        public const string Title = "Kinsay subtitles";

        [STAThread]
        static void Main()
        {
            // (the libraries live inside this one file: loaded from there before anything uses them)
            AppDomain.CurrentDomain.AssemblyResolve += (s, e) => Embedded(new System.Reflection.AssemblyName(e.Name).Name + ".dll");
            Run();
        }

        static System.Reflection.Assembly Embedded(string file)
        {
            using (var res = typeof(Program).Assembly.GetManifestResourceStream(file))
            {
                if (res == null) return null;
                var bytes = new byte[res.Length];
                int read = 0;
                while (read < bytes.Length) read += res.Read(bytes, read, bytes.Length - read);
                return System.Reflection.Assembly.Load(bytes);
            }
        }

        /// WebView2's native loader can't load from memory: unpacked once into the app's folder (by its
        /// size: a new version of the app with a new loader writes it again).
        public static string LoaderFolder()
        {
            using (var res = typeof(Program).Assembly.GetManifestResourceStream("native.WebView2Loader.dll"))
            {
                if (res == null) return null; // (built with the loader next to the exe)
                var dir = Path.Combine(Folder, "bin", res.Length.ToString(CultureInfo.InvariantCulture));
                var file = Path.Combine(dir, "WebView2Loader.dll");
                if (!File.Exists(file) || new FileInfo(file).Length != res.Length)
                {
                    Directory.CreateDirectory(dir);
                    var tmp = file + ".tmp";
                    using (var f = File.Create(tmp)) res.CopyTo(f);
                    if (File.Exists(file)) File.Delete(file);
                    File.Move(tmp, file);
                }
                return dir;
            }
        }

        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        static void Run()
        {
            // (one window: a second start brings the first one forward)
            using (var one = new Mutex(true, "Translate-subtitles-one-window", out bool first))
            {
                if (!first)
                {
                    var other = FindWindow(null, Title);
                    if (other != IntPtr.Zero)
                    {
                        ShowWindow(other, 9); // SW_RESTORE
                        SetForegroundWindow(other);
                    }
                    return;
                }
                // (anything unexpected: a plain message and a note for us, never .NET's crash dialog)
                Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
                Application.ThreadException += (s, e) => Failed(e.Exception);
                AppDomain.CurrentDomain.UnhandledException += (s, e) => Failed(e.ExceptionObject as Exception);
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Updater.Tidy();
                Application.Run(new SubtitlesForm(PageAddress()));
            }
            // (Restart after an update: the new exe, once this one has let go of the one-window lock)
            if (RestartAfter)
            {
                try { Process.Start(Application.ExecutablePath); }
                catch (Exception) { /* (the person starts it) */ }
            }
        }

        public static bool RestartAfter;

        public static readonly string Folder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Translate");

        /// A problem worth a line in errors.txt, never a message (an update that didn't come).
        public static void Note(Exception e)
        {
            try
            {
                Directory.CreateDirectory(Folder);
                File.AppendAllText(Path.Combine(Folder, "errors.txt"), DateTime.Now.ToString("s") + " " + e.Message + "\r\n");
            }
            catch (Exception) { /* (not noted) */ }
        }

        public static void Failed(Exception e)
        {
            try
            {
                Directory.CreateDirectory(Folder);
                File.AppendAllText(Path.Combine(Folder, "errors.txt"), DateTime.Now.ToString("s") + " " + e + "\r\n");
            }
            catch (Exception) { /* (not noted) */ }
            MessageBox.Show("Something went wrong: " + (e?.Message ?? "unknown") + "\r\n\r\nClose the app and start it again.",
                Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }

        /// The page: TRANSLATE_PAGE (a local test server), else config.json next to the app, else
        /// kinsay.dendigital.de.
        static Uri PageAddress()
        {
            var env = Environment.GetEnvironmentVariable("TRANSLATE_PAGE");
            if (!string.IsNullOrEmpty(env)) return new Uri(env);
            try
            {
                var json = File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "config.json"));
                var m = Regex.Match(json, "\"page\"\\s*:\\s*\"([^\"]+)\"");
                if (m.Success) return new Uri(m.Groups[1].Value);
            }
            catch (Exception) { /* (none) */ }
            return new Uri("https://kinsay.dendigital.de/window");
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    }

    sealed class SubtitlesForm : Form
    {
        // (in the page's own pixels; Windows' pixels are these times the screen's scale)
        // (never smaller than its content: the strip's buttons, the start panel; in CSS pixels)
        const int MinW = 520, MinH = 260;
        readonly Uri page;
        readonly string origin;
        readonly WebView2 web = new WebView2();
        readonly System.Windows.Forms.Timer lockTimer = new System.Windows.Forms.Timer { Interval = 150 };
        bool locked, through;
        Loopback sound;
        /// Both sides of a call: the microphone, the call taken out of it by Windows (EchoMic).
        EchoMic voice;

        public SubtitlesForm(Uri page)
        {
            this.page = page;
            origin = page.GetLeftPart(UriPartial.Authority);
            Text = Program.Title;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            FormBorderStyle = FormBorderStyle.None;
            TopMost = true;
            ShowInTaskbar = true;
            // (other on-top windows, a call's or full-screen video, climb above it: it climbs back,
            // when it loses the focus and every 2 s, never taking the focus itself)
            Deactivate += (s, e) => KeepOnTop();
            onTopTimer.Tick += (s, e) => KeepOnTop();
            onTopTimer.Start();
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.FromArgb(12, 21, 25);
            Opacity = 0.92;
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Color.FromArgb(12, 21, 25);
            Controls.Add(web);
            lockTimer.Tick += (s, e) => LetClicksThrough(!OverLockBadge());
            Load += async (s, e) =>
            {
                // (the screen the mouse is on decides the scale; the window's own after that: audit 36)
                dpi = MonitorDpi(Cursor.Position);
                var opening = OpeningBounds();
                FitMinimum(Screen.FromPoint(Cursor.Position).WorkingArea);
                Bounds = opening;
                dpi = (int)GetDpiForWindow(Handle);
                FitMinimum(Screen.FromControl(this).WorkingArea);
                try { await Start(); }
                catch (WebView2RuntimeNotFoundException)
                {
                    if (MessageBox.Show(this, "This app needs Microsoft Edge WebView2, a free part of Windows that is missing here.\r\n\r\nOpen Microsoft's download page?",
                        Program.Title, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                        OpenInBrowser("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
                    Close();
                }
                catch (Exception ex)
                {
                    Program.Failed(ex);
                    Close();
                }
            };
            FormClosing += (s, e) =>
            {
                StopSound();
                StopMic();
            };
        }

        /// Locked: clicks go through (kept in the window's style, so WinForms never drops it).
        protected override CreateParams CreateParams
        {
            get
            {
                var p = base.CreateParams;
                if (through) p.ExStyle |= 0x20; // WS_EX_TRANSPARENT
                return p;
            }
        }

        /// The window's scale (dots per inch), followed across screens (WM_DPICHANGED).
        int dpi = 96;
        int Px(double cssPx) => (int)Math.Round(cssPx * dpi / 96.0);

        /// Never smaller than the content, never bigger than the screen it is on.
        void FitMinimum(Rectangle area) =>
            MinimumSize = new Size(Math.Min(Px(MinW), area.Width), Math.Min(Px(MinH), area.Height));

        static int MonitorDpi(Point p)
        {
            try
            {
                if (GetDpiForMonitor(MonitorFromPoint(p, 2), 0, out uint x, out _) == 0) return (int)x;
            }
            catch (EntryPointNotFoundException) { }
            return 96;
        }

        /// Moved to a screen with another scale: Windows' suggested size, the minimum scaled with it.
        protected override void WndProc(ref Message m)
        {
            base.WndProc(ref m);
            if (m.Msg != 0x02E0) return; // WM_DPICHANGED
            dpi = (int)((long)m.WParam & 0xFFFF);
            var r = Marshal.PtrToStructure<RECT>(m.LParam);
            var suggested = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
            FitMinimum(Screen.FromRectangle(suggested).WorkingArea);
            Bounds = suggested;
        }

        [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
        [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(Point p, uint flags);
        [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint x, out uint y);

        async System.Threading.Tasks.Task Start()
        {
            // (Windows 11: rounded corners like the page's)
            int round = 2;
            DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int));
            Directory.CreateDirectory(Program.Folder);
            // (a test against a local server: TRANSLATE_DEBUG_PORT opens the page to the test scripts)
            bool test = Environment.GetEnvironmentVariable("TRANSLATE_PAGE") != null;
            var port = Environment.GetEnvironmentVariable("TRANSLATE_DEBUG_PORT");
            var options = new CoreWebView2EnvironmentOptions(
                test && int.TryParse(port, out int n) ? "--remote-debugging-port=" + n : null);
            var loader = Program.LoaderFolder();
            if (loader != null) CoreWebView2Environment.SetLoaderDllFolderPath(loader);
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.Folder, "web"), options);
            await web.EnsureCoreWebView2Async(env);
            var core = web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = test;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            // (no F5, Ctrl+P, Ctrl+F: the window is the subtitles, nothing else)
            core.Settings.AreBrowserAcceleratorKeysEnabled = test;
            // (the page's `app-region: drag` areas move the window, as in Electron)
            core.Settings.IsNonClientRegionSupportEnabled = true;
            // (the server names the signed-in device "Desktop app" by this)
            core.Settings.UserAgent += " TranslateDesktop/0.1";
            await core.AddScriptToExecuteOnDocumentCreatedAsync(Bridge.Replace("ORIGIN", Js(origin)));
            // only the microphone, only for the app's own page
            core.PermissionRequested += (s, e) =>
            {
                e.State = Ours(e.Uri) && e.PermissionKind == CoreWebView2PermissionKind.Microphone
                    ? CoreWebView2PermissionState.Allow
                    : CoreWebView2PermissionState.Deny;
                e.Handled = true;
            };
            // never another address in this window; the app's own links open in the browser
            core.NavigationStarting += (s, e) =>
            {
                if (!Ours(e.Uri)) e.Cancel = true;
                // (a reload or another page: the old page's sound is no one's any more)
                else StopSound();
            };
            core.NewWindowRequested += (s, e) =>
            {
                e.Handled = true;
                if (Ours(e.Uri) && e.Uri.StartsWith("https://")) OpenInBrowser(e.Uri);
            };
            core.DownloadStarting += (s, e) => e.Cancel = true;
            // the page can't be loaded: say so (a window of nothing would only confuse)
            core.NavigationCompleted += (s, e) =>
            {
                if (e.IsSuccess || e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
                var answer = MessageBox.Show(this,
                    "Can't open the page at " + page.Host + ". Check the internet, or try again in a minute.",
                    Program.Title, MessageBoxButtons.RetryCancel, MessageBoxIcon.Warning);
                if (answer == DialogResult.Retry) core.Navigate(page.AbsoluteUri);
                else Close();
            };
            core.WebMessageReceived += (s, e) =>
            {
                // (only from the page the bridge is on, like the bridge itself)
                if (!Ours(e.Source) || new Uri(e.Source).AbsolutePath != "/window") return;
                string m;
                try { m = e.TryGetWebMessageAsString(); } catch (Exception) { return; }
                Asked(m ?? "");
            };
            core.Navigate(page.AbsoluteUri);
            if (!test) _ = UpdateLoop();
        }

        bool Ours(string uri)
        {
            try { return new Uri(uri).GetLeftPart(UriPartial.Authority) == origin; }
            catch (Exception) { return false; }
        }

        bool updated;

        /// Updates: at the start, then every 6 hours, until one is in place (never in a test).
        async System.Threading.Tasks.Task UpdateLoop()
        {
            // (a folder it can't write to: never downloads in vain every 6 hours, audit 37)
            if (!Updater.CanWrite()) return;
            for (;;)
            {
                try
                {
                    if (await Updater.TryUpdate(origin))
                    {
                        updated = true;
                        web.CoreWebView2?.PostWebMessageAsString("update:ready");
                        return;
                    }
                }
                catch (Exception e) { Program.Note(new Exception("update: " + e.Message, e)); }
                await System.Threading.Tasks.Task.Delay(TimeSpan.FromHours(6));
            }
        }

        void OpenInBrowser(string uri)
        {
            try { Process.Start(uri); }
            catch (Exception) { /* (no browser: nothing to open it in) */ }
        }

        /// What the page asks (the bridge's messages: "kind:value").
        void Asked(string m)
        {
            int colon = m.IndexOf(':');
            string kind = colon < 0 ? m : m.Substring(0, colon), arg = colon < 0 ? "" : m.Substring(colon + 1);
            switch (kind)
            {
                case "opacity":
                    if (double.TryParse(arg, NumberStyles.Float, CultureInfo.InvariantCulture, out double o) && !double.IsNaN(o))
                        Opacity = Math.Min(1, Math.Max(0.35, o));
                    break;
                case "click":
                    locked = arg == "1";
                    lockTimer.Enabled = locked;
                    LetClicksThrough(locked && !OverLockBadge());
                    break;
                case "resize":
                    var p = arg.Split(',');
                    if (p.Length == 3 && int.TryParse(p[0], out int dx) && int.TryParse(p[1], out int dy))
                        ResizeBy(Px(dx), Px(dy), p[2] == "left");
                    break;
                case "resized":
                    break;
                case "sound":
                    if (arg == "on") StartSound();
                    else StopSound();
                    break;
                case "mic":
                    if (arg == "on") StartMic();
                    else StopMic();
                    break;
                case "close":
                    Close();
                    break;
                case "update":
                    // (the page asks once it loads: a reload never loses the news)
                    if (updated) web.CoreWebView2?.PostWebMessageAsString("update:ready");
                    break;
                case "restart":
                    if (!updated) break;
                    Program.RestartAfter = true;
                    Close();
                    break;
            }
        }

        void Post(string text)
        {
            if (IsHandleCreated && !IsDisposed)
                BeginInvoke(new Action(() => web.CoreWebView2?.PostWebMessageAsString(text)));
        }

        /// The computer's sound, from whatever Windows plays on now: a new default output (a headset
        /// plugged in) or a device gone starts it again on the new one; if none can be had the page is
        /// told ("sound:error" at the start, "sound:ended" later) and shows its own problem.
        void StartSound()
        {
            StopSound();
            sound = Loopback.Open(chunk => Post("sound:" + Convert.ToBase64String(chunk)), Restart);
            web.CoreWebView2?.PostWebMessageAsString(sound != null ? "sound:ok" : "sound:error");
        }

        void Restart(Loopback from)
        {
            if (!IsHandleCreated || IsDisposed) return;
            BeginInvoke(new Action(() =>
            {
                if (sound != from) return; // (stopped or started again meanwhile)
                from.Dispose();
                sound = Loopback.Open(chunk => Post("sound:" + Convert.ToBase64String(chunk)), Restart);
                if (sound == null) web.CoreWebView2?.PostWebMessageAsString("sound:ended");
            }));
        }

        void StopSound()
        {
            sound?.Dispose();
            sound = null;
        }

        /// The microphone without the call's sound: "mic:ok" or "mic:error" (the page then uses the
        /// browser's own microphone), "mic:ended" if it stops later.
        void StartMic()
        {
            StopMic();
            voice = EchoMic.Open(chunk => Post("mic:" + Convert.ToBase64String(chunk)), MicLost);
            web.CoreWebView2?.PostWebMessageAsString(voice != null ? "mic:ok" : "mic:error");
        }

        void MicLost(EchoMic from)
        {
            if (!IsHandleCreated || IsDisposed) return;
            BeginInvoke(new Action(() =>
            {
                if (voice != from) return;
                StopMic();
                web.CoreWebView2?.PostWebMessageAsString("mic:ended");
            }));
        }

        void StopMic()
        {
            voice?.Dispose();
            voice = null;
        }

        void ResizeBy(int dx, int dy, bool left)
        {
            var b = Bounds;
            var area = Screen.FromControl(this).WorkingArea;
            int w = Math.Max(MinimumSize.Width, b.Width + (left ? -dx : dx));
            int h = Math.Max(MinimumSize.Height, b.Height + dy);
            // (never past the screen's edges: audit 36)
            w = Math.Min(w, left ? b.Right - area.Left : area.Right - b.X);
            h = Math.Min(h, area.Bottom - b.Y);
            Bounds = new Rectangle(left ? b.Right - w : b.X, b.Y, w, h);
        }

        /// Locked: clicks go through to the window below, except over the lock badge (top right).
        bool OverLockBadge()
        {
            var c = Cursor.Position;
            return c.X >= Right - Px(150) && c.X <= Right && c.Y >= Top && c.Y <= Top + Px(44);
        }

        void LetClicksThrough(bool on)
        {
            if (on == through) return;
            through = on;
            UpdateStyles();
        }

        /**
         * Every opening (Damian, 2026-11-14): 90 % of the screen's width, about 340 px high, centred
         * at the bottom with a margin, on the screen the mouse is on; from there it is moved and
         * sized. Never smaller than its content, never bigger than the screen.
         */
        Rectangle OpeningBounds()
        {
            var area = Screen.FromPoint(Cursor.Position).WorkingArea;
            int w = Math.Min(area.Width, Math.Max(Px(MinW), (int)(area.Width * 0.9)));
            int h = Math.Min(area.Height, Math.Max(Px(MinH), Px(340)));
            return new Rectangle(area.X + (area.Width - w) / 2, Math.Max(area.Y, area.Bottom - h - Px(24)), w, h);
        }

        static string Js(string s) => "'" + s.Replace("\\", "\\\\").Replace("'", "\\'") + "'";

        /// The page's `window.liveShell` (only on the app's own /window page), plus the sound:
        /// `startSound(take, ended)` answers once Windows' capture runs (or refuses).
        const string Bridge = @"(() => {
  if (location.origin !== ORIGIN || location.pathname !== '/window' || !window.chrome || !chrome.webview) return;
  const post = (m) => chrome.webview.postMessage(m);
  // (two kinds of sound: this computer's, and the microphone without the call)
  const kinds = { sound: { take: null, ended: null, asked: null }, mic: { take: null, ended: null, asked: null } };
  chrome.webview.addEventListener('message', (e) => {
    const m = e.data;
    if (typeof m !== 'string') return;
    const kind = m.startsWith('mic:') ? 'mic' : m.startsWith('sound:') ? 'sound' : null;
    const k = kind ? kinds[kind] : null;
    const what = kind ? m.slice(kind.length + 1) : '';
    if (k && (what === 'ok' || what === 'error')) {
      const a = k.asked;
      k.asked = null;
      if (a) what === 'ok' ? a.ok() : a.no(new Error('no sound device'));
      return;
    }
    if (m === 'update:ready') {
      updated = true;
      if (onUpdated) onUpdated();
      return;
    }
    if (k && what === 'ended') {
      const end = k.ended;
      k.take = k.ended = null;
      if (end) end();
      return;
    }
    if (!k || !k.take) return;
    const take = k.take;
    const bin = atob(what);
    const f = new Float32Array(bin.length >> 1);
    for (let i = 0; i < f.length; i++) {
      let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      if (v >= 32768) v -= 65536;
      f[i] = v / 32768;
    }
    take(f);
  });
  let updated = false, onUpdated = null;
  post('update');
  window.liveShell = Object.freeze({
    onUpdated: (fn) => { onUpdated = fn; if (updated) fn(); },
    restart: () => post('restart'),
    setOpacity: (v) => post('opacity:' + Number(v)),
    setClickThrough: (on) => post('click:' + (on ? 1 : 0)),
    resizeBy: (dx, dy, edge) => post('resize:' + Math.round(dx) + ',' + Math.round(dy) + ',' + (edge === 'left' ? 'left' : 'right')),
    resized: () => post('resized'),
    close: () => post('close'),
    startSound: (t, e) => new Promise((ok, no) => {
      Object.assign(kinds.sound, { take: t, ended: e || null, asked: { ok, no } });
      post('sound:on');
    }),
    stopSound: () => { kinds.sound.take = kinds.sound.ended = null; post('sound:off'); },
    startMic: (t, e) => new Promise((ok, no) => {
      Object.assign(kinds.mic, { take: t, ended: e || null, asked: { ok, no } });
      post('mic:on');
    }),
    stopMic: () => { kinds.mic.take = kinds.mic.ended = null; post('mic:off'); },
  });
})();";

        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);

        readonly System.Windows.Forms.Timer onTopTimer = new System.Windows.Forms.Timer { Interval = 2000 };

        void KeepOnTop()
        {
            // HWND_TOPMOST; SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER
            if (IsHandleCreated && Visible) SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 | 0x0200);
        }
    }

    /// What this computer plays (Windows' audio loopback of the default output), as 16 kHz 16-bit mono
    /// chunks of 100 ms. When nothing plays, Windows sends nothing: the page fills the gap with silence.
    /// It watches the default output: a new one (a headset plugged in) or the device gone calls `lost`.
    sealed class Loopback : IDisposable, IMMNotificationClient
    {
        const int Rate = 16000, Chunk = 1600;
        static readonly Guid FloatFormat = new Guid("00000003-0000-0010-8000-00aa00389b71");
        readonly WasapiLoopbackCapture capture;
        readonly MMDeviceEnumerator devices = new MMDeviceEnumerator();
        readonly Action<byte[]> send;
        readonly Action<Loopback> lost;
        readonly short[] output = new short[Chunk];
        int filled;
        double acc, count, until;
        bool gone;

        public static Loopback Open(Action<byte[]> send, Action<Loopback> lost)
        {
            try { return new Loopback(send, lost); }
            catch (Exception) { return null; }
        }

        Loopback(Action<byte[]> send, Action<Loopback> lost)
        {
            this.send = send;
            this.lost = lost;
            capture = new WasapiLoopbackCapture();
            try
            {
                capture.DataAvailable += (s, e) => Take(e.Buffer, e.BytesRecorded);
                capture.RecordingStopped += (s, e) => Lost();
                devices.RegisterEndpointNotificationCallback(this);
                capture.StartRecording();
            }
            catch (Exception)
            {
                Dispose();
                throw;
            }
        }

        void Lost()
        {
            if (gone) return;
            gone = true;
            lost(this);
        }

        void Take(byte[] buffer, int bytes)
        {
            var f = capture.WaveFormat;
            int channels = f.Channels, bits = f.BitsPerSample, size = bits / 8, frame = channels * size;
            bool floats = f.Encoding == WaveFormatEncoding.IeeeFloat
                || (f is WaveFormatExtensible x && x.SubFormat == FloatFormat);
            // to 16 kHz: every output sample the average of the input samples it covers (no folding of
            // the high sounds into the voices)
            double step = (double)f.SampleRate / Rate;
            if (until == 0) until = step;
            for (int at = 0; at + frame <= bytes; at += frame)
            {
                double sum = 0;
                for (int c = 0; c < channels; c++) sum += Sample(buffer, at + c * size, bits, floats);
                acc += sum / channels;
                count++;
                if (count < until) continue;
                output[filled++] = (short)Math.Max(-32768, Math.Min(32767, Math.Round(acc / count * 32767)));
                until -= count;
                until += step;
                acc = count = 0;
                if (filled < Chunk) continue;
                var chunk = new byte[Chunk * 2];
                Buffer.BlockCopy(output, 0, chunk, 0, chunk.Length);
                filled = 0;
                send(chunk);
            }
        }

        static double Sample(byte[] b, int o, int bits, bool floats)
        {
            if (floats) return bits == 64 ? BitConverter.ToDouble(b, o) : BitConverter.ToSingle(b, o);
            switch (bits)
            {
                case 16: return BitConverter.ToInt16(b, o) / 32768.0;
                case 24: return ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) << 8 >> 8) / 8388608.0;
                case 32: return BitConverter.ToInt32(b, o) / 2147483648.0;
                case 8: return (b[o] - 128) / 128.0;
                default: return 0;
            }
        }

        // the default output changed or our device went: start again on what plays now
        public void OnDefaultDeviceChanged(DataFlow flow, Role role, string id)
        {
            if (flow == DataFlow.Render && role == Role.Console) Lost();
        }
        public void OnDeviceStateChanged(string id, DeviceState state) { }
        public void OnDeviceAdded(string id) { }
        public void OnDeviceRemoved(string id) { }
        public void OnPropertyValueChanged(string id, PropertyKey key) { }

        public void Dispose()
        {
            gone = true;
            try { devices.UnregisterEndpointNotificationCallback(this); } catch (Exception) { /* (not registered) */ }
            try { capture.StopRecording(); } catch (Exception) { /* (stopped) */ }
            capture.Dispose();
            devices.Dispose();
        }
    }
}
