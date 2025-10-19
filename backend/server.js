// server.js (CommonJS - Updated)
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sharp = require("sharp");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { createReadStream } = require("fs");
const os = require("os");

const app = express();

/* -------------------- CORS (Render/Vercel & Local Friendly) -------------------- */
const ORIGINS_ENV =
  process.env.CLIENT_ORIGIN ||
  process.env.CLIENT_ORIGINS ||
  "http://localhost:5173,https://stegnography-seven.vercel.app";

const ALLOWED_ORIGINS = ORIGINS_ENV.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const isLocal = (origin) =>
  origin && /^http:\/\/localhost:\d+$/i.test(origin);

app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server, curl, native fetch
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin) || isLocal(origin)) return callback(null, true);
      return callback(new Error(`Not allowed by CORS: ${origin}`), false);
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

// Preflight
app.options("*", cors());

/* -------------------- Parsing limits -------------------- */
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

/* -------------------- Health checks -------------------- */
app.get("/", (_req, res) => {
  res.json({
    message: "StegaVault Backend is running!",
    status: "OK",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

/* -------------------- Multer -------------------- */
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024, files: 2, fields: 10 },
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype.startsWith("image/") ||
      file.mimetype === "audio/wav" ||
      file.mimetype === "audio/x-wav" ||
      // some browsers send generic audio/wave
      file.mimetype === "audio/wave";
    if (ok) cb(null, true);
    else cb(new Error(`Invalid file type: ${file.mimetype}. Only images and WAV audio are allowed.`), false);
  },
});

/* -------------------- Helpers -------------------- */
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
};
const bitsNeeded = (nBytes) => nBytes * 8;
const readU32BE = (buf) => buf.readUInt32BE(0);

const safeFilename = (s, fallback = "file") =>
  (s || fallback).replace(/[^\w.\-]+/g, "_").slice(0, 100) || fallback;

function packPayload({ secretText, secretFile }) {
  const items = [];
  if (secretText && String(secretText).trim()) {
    const data = Buffer.from(String(secretText), "utf8");
    items.push({ t: "text", name: "message.txt", mime: "text/plain", len: data.length, data });
  }
  if (secretFile) {
    const data = Buffer.from(secretFile.buffer);
    items.push({
      t: "file",
      name: secretFile.originalname || "secret",
      mime: secretFile.mimetype || "application/octet-stream",
      len: data.length,
      data,
    });
  }
  if (items.length === 0) throw new Error("No secret data provided");
  const meta = { v: 1, items: items.map(({ t, name, mime, len }) => ({ t, name, mime, len })) };
  const metaBuf = Buffer.from(JSON.stringify(meta), "utf8");
  const dataConcat = Buffer.concat(items.map((x) => x.data));
  const MAGIC = Buffer.from("STEGv1"); // 6 bytes
  return Buffer.concat([MAGIC, u32(metaBuf.length), metaBuf, dataConcat]);
}

async function encryptIfNeeded(buf, password) {
  if (!password) return buf;
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  const HEAD = Buffer.from("ENCv1"); // 5 bytes
  return Buffer.concat([HEAD, salt, iv, tag, u32(enc.length), enc]);
}

/* -------------------- Image LSB (RGBA raw, re-encode as PNG) -------------------- */
function embedLSB_RGBA(rgbabuf, width, height, payload) {
  const capacityBits = width * height * 3; // RGB channels
  const needBits = bitsNeeded(payload.length);
  if (needBits > capacityBits) {
    return {
      error: `Not enough capacity. Need ${Math.ceil(needBits / 8 / 1024)}KB, have ${Math.ceil(
        capacityBits / 8 / 1024
      )}KB.`,
    };
  }
  let bitIdx = 0;
  for (let i = 0; i < payload.length; i++) {
    for (let b = 7; b >= 0; b--) {
      const bit = (payload[i] >> b) & 1;
      const pixelIndex = Math.floor(bitIdx / 3);
      const channel = bitIdx % 3; // 0:R 1:G 2:B
      const base = pixelIndex * 4; // RGBA stride
      const chOffset = base + channel;
      rgbabuf[chOffset] = (rgbabuf[chOffset] & 0xfe) | bit;
      bitIdx++;
    }
  }
  return { ok: true, usedBits: needBits };
}

/* -------------------- WAV parsing & safe audio LSB -------------------- */
function parseWavHeader(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Audio cover must be WAV (RIFF/WAVE).");
  }
  let offset = 12; // after RIFF size + WAVE
  let fmt = null;
  let dataOffset = -1;
  let dataLength = -1;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buf.length) break;
    if (id === "fmt ") {
      const audioFormat = buf.readUInt16LE(start + 0);
      const numChannels = buf.readUInt16LE(start + 2);
      const sampleRate = buf.readUInt32LE(start + 4);
      const byteRate = buf.readUInt32LE(start + 8);
      const blockAlign = buf.readUInt16LE(start + 12);
      const bitsPerSample = buf.readUInt16LE(start + 14);
      fmt = { audioFormat, numChannels, sampleRate, byteRate, blockAlign, bitsPerSample };
    } else if (id === "data") {
      dataOffset = start;
      dataLength = size;
    }
    offset = end + (size % 2); // pad byte on odd sizes
  }
  if (!fmt) throw new Error("Invalid WAV: missing fmt chunk.");
  if (fmt.audioFormat !== 1) throw new Error("WAV must be PCM (uncompressed).");
  if (![8, 16].includes(fmt.bitsPerSample)) {
    throw new Error(`Unsupported WAV bit depth: ${fmt.bitsPerSample}. Use 8 or 16-bit PCM.`);
  }
  if (dataOffset < 0 || dataLength <= 0) throw new Error("Invalid WAV: missing data chunk.");
  return { dataOffset, dataLength, fmt };
}

function embedLSB_WavPCM(buf, payload, dataOffset, dataLength, bitsPerSample) {
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor(dataLength / bytesPerSample);
  const capacityBits = numSamples; // one bit per sample (LSB of least-significant byte)
  const needBits = bitsNeeded(payload.length);
  if (needBits > capacityBits) {
    return {
      error: `Not enough WAV capacity. Need ${Math.ceil(needBits / 8 / 1024)}KB, have ~${Math.ceil(
        capacityBits / 8 / 1024
      )}KB (1 bit/sample).`,
    };
  }
  let bitIdx = 0;
  for (let i = 0; i < payload.length; i++) {
    for (let b = 7; b >= 0; b--) {
      const bit = (payload[i] >> b) & 1;
      const sampleIndex = bitIdx; // 1 bit per sample
      const lsbByte = dataOffset + sampleIndex * bytesPerSample; // little-endian, first byte is least significant
      buf[lsbByte] = (buf[lsbByte] & 0xfe) | bit;
      bitIdx++;
    }
  }
  return { ok: true, usedBits: needBits };
}

/* -------------------- Simplified Audio Processing (No ffmpeg dependency) -------------------- */
function processAudioSimple(inputBuf) {
  // Only WAV (PCM) supported in this version
  const header = parseWavHeader(inputBuf); // throws with clear message if invalid
  return inputBuf;
}

/* -------------------- Extraction Helpers -------------------- */
async function extractData(reader, password) {
  const first5 = reader.readBytes(5);
  let containerBuf;

  if (first5.equals(Buffer.from("ENCv1"))) {
    const headerRest = reader.readBytes(48);
    const encLen = readU32BE(headerRest.slice(44, 48));
    const enc = reader.readBytes(encLen);
    const combined = Buffer.concat([first5, headerRest, enc]);

    // Decrypt
    const ENC = Buffer.from("ENCv1");
    if (!combined.slice(0, 5).equals(ENC)) throw new Error("Invalid encrypted payload header.");
    let off = 5;
    const salt = combined.slice(off, off + 16); off += 16;
    const iv = combined.slice(off, off + 12);   off += 12;
    const tag = combined.slice(off, off + 16);  off += 16;
    const len = readU32BE(combined.slice(off, off + 4)); off += 4;
    const enc2 = combined.slice(off, off + len);

    if (!password) throw new Error("Password required to decrypt payload.");
    const key = crypto.scryptSync(password, salt, 32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc2), decipher.final()]);
    containerBuf = dec;
  } else {
    const sixth = reader.readBytes(1);
    const magic = Buffer.concat([first5, sixth]);
    if (!magic.equals(Buffer.from("STEGv1"))) throw new Error("No valid payload found in the file.");
    const metaLenBuf = reader.readBytes(4);
    const metaLen = readU32BE(metaLenBuf);
    const metaBuf = reader.readBytes(metaLen);
    let meta;
    try {
      meta = JSON.parse(metaBuf.toString("utf8"));
    } catch {
      throw new Error("Corrupted container metadata.");
    }
    const dataTotal = (meta.items || []).reduce((s, it) => s + (it.len || 0), 0);
    const dataBuf = reader.readBytes(dataTotal);
    containerBuf = Buffer.concat([magic, metaLenBuf, metaBuf, dataBuf]);
  }

  return containerBuf;
}

function parseContainer(containerBuf) {
  const MAGIC = Buffer.from("STEGv1");
  if (!containerBuf.slice(0, 6).equals(MAGIC)) throw new Error("No payload found (magic mismatch).");
  let off = 6;
  const metaLen = readU32BE(containerBuf.slice(off, off + 4)); off += 4;
  const metaBuf = containerBuf.slice(off, off + metaLen); off += metaLen;
  let meta;
  try {
    meta = JSON.parse(metaBuf.toString("utf8"));
  } catch {
    throw new Error("Corrupted container metadata.");
  }
  const items = [];
  for (const m of meta.items || []) {
    const data = containerBuf.slice(off, off + m.len);
    off += m.len;
    if (m.t === "text" || m.mime === "text/plain") {
      items.push({ type: "text", name: m.name, mime: m.mime, text: data.toString("utf8") });
    } else {
      items.push({ type: "file", name: m.name, mime: m.mime, base64: data.toString("base64") });
    }
  }
  return items;
}

/* -------------------- Routes (added aliases to dodge blockers) -------------------- */

// ---- Encode (alias for /api/embed) ----
const handleEmbed = async (req, res, next) => {
  try {
    const cover = req.files?.cover?.[0];
    const secretFile = req.files?.secretFile?.[0];
    const { secretText = "", password = "" } = req.body || {};

    if (!cover) return res.status(400).json({ error: "Cover file is required" });
    if (!secretText && !secretFile) {
      return res.status(400).json({ error: "At least one secret is required (text or file)" });
    }

    const packed = packPayload({ secretText, secretFile });
    const payload = await encryptIfNeeded(packed, password || "");

    // ------ IMAGE cover ------
    if (cover.mimetype.startsWith("image/")) {
      const { data, info } = await sharp(cover.buffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const buf = Buffer.from(data);
      const r = embedLSB_RGBA(buf, info.width, info.height, payload);
      if (r.error) return res.status(400).json({ error: r.error });

      const stego = await sharp(buf, {
        raw: { width: info.width, height: info.height, channels: 4 },
      })
        .png()
        .toBuffer();

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Disposition", 'attachment; filename="stego.png"');
      return res.send(stego);
    }

    // ------ AUDIO cover ------
    if (cover.mimetype.startsWith("audio/")) {
      let wavBuf;
      try {
        wavBuf = processAudioSimple(cover.buffer);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }

      const { dataOffset, dataLength, fmt } = parseWavHeader(wavBuf);
      const r = embedLSB_WavPCM(wavBuf, payload, dataOffset, dataLength, fmt.bitsPerSample);
      if (r.error) return res.status(400).json({ error: r.error });

      const baseName = safeFilename((cover.originalname || "audio").replace(/\.[^.]+$/, ""));
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Content-Disposition", `attachment; filename="${baseName}_stego.wav"`);
      return res.send(wavBuf);
    }

    return res
      .status(400)
      .json({ error: `Unsupported cover file type: ${cover.mimetype}. Use images (PNG/JPEG) or WAV audio.` });
  } catch (e) {
    console.error("Embed error:", e);
    next(e);
  }
};

app.post(
  "/api/encode",
  upload.fields([{ name: "cover", maxCount: 1 }, { name: "secretFile", maxCount: 1 }]),
  handleEmbed
);
app.post(
  "/api/embed",
  upload.fields([{ name: "cover", maxCount: 1 }, { name: "secretFile", maxCount: 1 }]),
  handleEmbed
);

// ---- Decode (alias for /api/extract) ----
const handleExtract = async (req, res, next) => {
  try {
    const stego = req.files?.stego?.[0];
    const { password = "" } = req.body || {};
    if (!stego) return res.status(400).json({ error: "Stego file is required" });

    // Image extraction
    if (stego.mimetype.startsWith("image/")) {
      const { data, info } = await sharp(stego.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

      const reader = new (function () {
        this.buf = data;
        this.bitIdx = 0;
        this.capacityBits = info.width * info.height * 3;

        this.readBytes = function (n) {
          const out = Buffer.alloc(n);
          for (let i = 0; i < n; i++) {
            let byte = 0;
            for (let b = 7; b >= 0; b--) {
              if (this.bitIdx >= this.capacityBits) throw new Error("Out of capacity while reading.");
              const pixelIndex = Math.floor(this.bitIdx / 3);
              const channel = this.bitIdx % 3;
              const base = pixelIndex * 4;
              const bit = this.buf[base + channel] & 1;
              byte |= bit << b;
              this.bitIdx++;
            }
            out[i] = byte;
          }
          return out;
        };
      })();

      const containerBuf = await extractData(reader, password);
      const items = parseContainer(containerBuf);
      return res.json({ ok: true, items });
    }

    // Audio extraction
    if (stego.mimetype.startsWith("audio/")) {
      const wav = Buffer.from(stego.buffer);
      const { dataOffset, dataLength, fmt } = parseWavHeader(wav);
      const bytesPerSample = fmt.bitsPerSample / 8;
      const numSamples = Math.floor(dataLength / bytesPerSample);
      let bitIdx = 0;

      const reader = {
        readBytes(n) {
          const out = Buffer.alloc(n);
          for (let i = 0; i < n; i++) {
            let byte = 0;
            for (let b = 7; b >= 0; b--) {
              if (bitIdx >= numSamples) throw new Error("Out of audio capacity while reading.");
              const lsbByteIndex = dataOffset + bitIdx * bytesPerSample;
              const bit = wav[lsbByteIndex] & 1;
              byte |= bit << b;
              bitIdx++;
            }
            out[i] = byte;
          }
          return out;
        },
      };

      const containerBuf = await extractData(reader, password);
      const items = parseContainer(containerBuf);
      return res.json({ ok: true, items });
    }

    return res.status(400).json({ error: "Unsupported stego file type" });
  } catch (e) {
    console.error("Extract error:", e);
    next(e);
  }
};

app.post("/api/decode", upload.fields([{ name: "stego", maxCount: 1 }]), handleExtract);
app.post("/api/extract", upload.fields([{ name: "stego", maxCount: 1 }]), handleExtract);

/* -------------------- Error Handlers -------------------- */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const map = {
      LIMIT_FILE_SIZE: "File too large. Maximum size is 100MB.",
      LIMIT_UNEXPECTED_FILE: "Too many files uploaded.",
    };
    const msg = map[err.code] || `Upload error: ${err.message}`;
    return res.status(400).json({ error: msg });
  }
  return next(err);
});

app.use((err, req, res, next) => {
  const msg = err?.message || "Unexpected server error.";
  console.error("[ERROR]", msg);
  if (!res.headersSent) {
    // If it's a CORS error we produced above, make it 403
    const status = /Not allowed by CORS/i.test(msg) ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

/* -------------------- Start Server -------------------- */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 StegaVault Backend running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
  console.log(`🌐 CORS Allowed: ${ALLOWED_ORIGINS.join(", ")}`);
});
