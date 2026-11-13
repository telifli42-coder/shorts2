const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || 3000;
const YTDLP_BIN = process.env.YTDLP_PATH || "yt-dlp";
const PUBLIC_DIR = path.join(__dirname, "public");
const SERVER_VERSION = "routing-fix-v2"; // deploy'un güncel olduğunu doğrulamak için

// ---------------------------------------------------------------------------
// index.html konumu: önce public/index.html, yoksa kök dizindeki index.html
// ---------------------------------------------------------------------------
function findIndexHtml() {
  const candidates = [
    path.join(PUBLIC_DIR, "index.html"),
    path.join(__dirname, "index.html"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const INDEX_HTML_PATH = findIndexHtml();
console.log(
  INDEX_HTML_PATH
    ? `index.html bulundu: ${INDEX_HTML_PATH}`
    : "UYARI: index.html bulunamadı (public/index.html bekleniyordu)."
);

// ---------------------------------------------------------------------------
// Statik dosyalar (CSS, JS, görseller). "/" isteğini aşağıdaki rota yönetir.
// ---------------------------------------------------------------------------
app.use(express.static(PUBLIC_DIR, { index: false }));

// ---------------------------------------------------------------------------
// Çerez dosyası: repodaki cookies.txt -> geçici klasöre kopyalanır
// ---------------------------------------------------------------------------
const REPO_COOKIES_PATH = path.join(__dirname, "cookies.txt");
let cookiesTmpDir = null;
let cookiesPath = null;

function prepareCookies() {
  if (!fs.existsSync(REPO_COOKIES_PATH)) {
    console.warn("UYARI: Repoda cookies.txt bulunamadı, çerezsiz devam ediliyor.");
    return null;
  }

  let content = fs.readFileSync(REPO_COOKIES_PATH, "utf8");
  content = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() + "\n";

  if (!/^# (Netscape )?HTTP Cookie File/.test(content)) {
    content = "# Netscape HTTP Cookie File\n" + content;
  }

  cookiesTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp_"));
  const dest = path.join(cookiesTmpDir, "cookies.txt");
  fs.writeFileSync(dest, content, { encoding: "utf8", mode: 0o600 });

  console.log(`Çerez dosyası hazır (${content.split("\n").length - 1} satır).`);
  return dest;
}

function cleanupCookies() {
  if (cookiesTmpDir) {
    try {
      fs.rmSync(cookiesTmpDir, { recursive: true, force: true });
    } catch (_) {}
    cookiesTmpDir = null;
    cookiesPath = null;
  }
}

cookiesPath = prepareCookies();

process.on("exit", cleanupCookies);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------
function isValidYoutubeUrl(value) {
  try {
    const u = new URL(value);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    const host = u.hostname.replace(/^www\.|^m\./, "");
    return ["youtube.com", "youtu.be", "music.youtube.com"].includes(host);
  } catch {
    return false;
  }
}

function baseArgs() {
  const args = ["--no-playlist", "--no-warnings"];
  if (cookiesPath) args.push("--cookies", cookiesPath);
  return args;
}

async function runYtdlp(extraArgs) {
  const args = [...baseArgs(), ...extraArgs];
  try {
    const { stdout } = await execFileAsync(YTDLP_BIN, args, {
      maxBuffer: 100 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
    });
    return stdout;
  } catch (err) {
    const msg = (err.stderr || err.message || "").toString().trim();
    throw new Error(msg || "yt-dlp bilinmeyen bir hata verdi.");
  }
}

// ---------------------------------------------------------------------------
// Sayfa rotaları
// ---------------------------------------------------------------------------

// Ana sayfa: HTML arayüzü (JSON DEĞİL)
app.get("/", (req, res) => {
  if (!INDEX_HTML_PATH) {
    return res
      .status(404)
      .send("index.html bulunamadı. Dosyanın public/index.html yolunda olduğundan emin ol.");
  }
  res.sendFile(INDEX_HTML_PATH);
});

// ---------------------------------------------------------------------------
// API rotaları
// ---------------------------------------------------------------------------

// Durum testi: GET /api/status
app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    cookies: Boolean(cookiesPath),
    indexHtml: Boolean(INDEX_HTML_PATH),
    version: SERVER_VERSION,
  });
});

// Video bilgisi: GET /api/info?url=...
app.get("/api/info", async (req, res) => {
  const url = req.query.url;
  if (!url || !isValidYoutubeUrl(url)) {
    return res.status(400).json({ error: "Geçerli bir YouTube URL'si gerekli." });
  }

  try {
    const out = await runYtdlp(["-J", "--", url]);
    const info = JSON.parse(out);
    res.json({
      id: info.id,
      title: info.title,
      uploader: info.uploader,
      duration: info.duration,
      thumbnail: info.thumbnail,
      view_count: info.view_count,
      upload_date: info.upload_date,
      description: info.description,
    });
  } catch (err) {
    console.error("yt-dlp hatası:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// İndirme (stream): GET /api/download?url=...
app.get("/api/download", (req, res) => {
  const url = req.query.url;
  if (!url || !isValidYoutubeUrl(url)) {
    return res.status(400).json({ error: "Geçerli bir YouTube URL'si gerekli." });
  }

  const args = [...baseArgs(), "-f", "best[ext=mp4]/best", "-o", "-", "--", url];

  const child = spawn(YTDLP_BIN, args);
  let stderrBuf = "";
  let headersSent = false;

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", 'attachment; filename="video.mp4"');

  child.stdout.once("data", () => {
    headersSent = true;
  });
  child.stdout.pipe(res);

  child.stderr.on("data", (d) => {
    stderrBuf += d.toString();
  });

  child.on("close", (code) => {
    if (code !== 0) {
      console.error("yt-dlp hatası:", stderrBuf.trim());
      if (!headersSent && !res.headersSent) {
        res.removeHeader("Content-Disposition");
        res.status(500).json({ error: stderrBuf.trim() || "İndirme başarısız." });
      } else {
        res.end();
      }
    }
  });

  req.on("close", () => child.kill("SIGKILL"));
});

// Tanımsız /api/* istekleri için JSON 404
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Bulunamadı." });
});

app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor (${SERVER_VERSION}).`);
});
