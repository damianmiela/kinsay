// Kinsay's own updates (2026-11-15, Damian): the app asks the website for /download/version.json at
// its start and every 6 hours; a higher build is downloaded in the background, checked (its SHA-256,
// and the signature of the build and the hash with the update key, made only on Damian's PC), and
// put in place of the running exe (Windows lets a running exe be renamed: the old one moves aside as
// .old and goes at the next start). The next start is the new version; nothing stops meanwhile.
using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace TranslateApp
{
    static class Updater
    {
        static string Exe => Application.ExecutablePath;

        /// The last update's leftovers (the old exe, a half-written new one): gone at the start.
        public static void Tidy()
        {
            foreach (var f in new[] { Exe + ".old", Exe + ".new" })
            {
                try { if (File.Exists(f)) File.Delete(f); }
                catch (Exception) { /* (still in use: the next start) */ }
            }
        }

        /// True once a newer, signed build is in place (the next start runs it). Throws on a network
        /// or disk problem (the caller notes it and tries again later).
        public static async Task<bool> TryUpdate(string origin)
        {
            using (var http = new HttpClient { Timeout = TimeSpan.FromMinutes(3) })
            {
                http.DefaultRequestHeaders.CacheControl = new CacheControlHeaderValue { NoCache = true };
                var json = await http.GetStringAsync(origin + "/download/version.json");
                var build = Regex.Match(json, "\"build\"\\s*:\\s*(\\d{12})\\b").Groups[1].Value;
                var sha = Regex.Match(json, "\"sha256\"\\s*:\\s*\"([0-9a-f]{64})\"").Groups[1].Value;
                var sig = Regex.Match(json, "\"sig\"\\s*:\\s*\"([A-Za-z0-9+/=]+)\"").Groups[1].Value;
                if (build == "" || sha == "" || sig == "" || long.Parse(build) <= BuildInfo.Build) return false;
                // (the signature first: nothing is downloaded on an unsigned promise)
                using (var rsa = new RSACryptoServiceProvider { PersistKeyInCsp = false })
                {
                    rsa.FromXmlString(UpdateKey.Public);
                    if (!rsa.VerifyData(Encoding.UTF8.GetBytes(build + "\n" + sha), "SHA256", Convert.FromBase64String(sig)))
                        return false;
                }
                var bytes = await http.GetByteArrayAsync(origin + "/download/Kinsay.exe");
                string hash;
                using (var h = SHA256.Create()) hash = BitConverter.ToString(h.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                if (hash != sha) return false;
                var fresh = Exe + ".new";
                File.WriteAllBytes(fresh, bytes);
                if (File.Exists(Exe + ".old")) File.Delete(Exe + ".old");
                File.Move(Exe, Exe + ".old");
                try { File.Move(fresh, Exe); }
                catch (Exception)
                {
                    File.Move(Exe + ".old", Exe); // (the running one back: never left without an app)
                    throw;
                }
                return true;
            }
        }
    }
}
