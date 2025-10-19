// server.js (ESM, Node 18+)
import express from "express";
import cors from "cors";
import multer from "multer";
import sharp from "sharp";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";

// --- ffmpeg for auto-conversion ---
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
// On some platforms ffmpeg-static can be null; guard it.
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

const app = express();

/* -------------------- CORS (Render/Vercel friendly) -------------------- */
/**
 * Allow one or more origins via env:
 *  - CLIENT_ORIGIN="https://stegnography-seven.vercel.app"
 *  - or CLIENT_ORIGINS="https://foo.com,https://bar.com"
 */
const ORIGINS_ENV =
  process.env.CLIENT_ORIGIN ||
  process.env.CLIENT_ORIGINS ||
  "http://localhost:5173,https://stegnography-seven.vercel.app";

const ALLOWED_ORIGINS = ORIGINS_ENV.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Allow non-browser requests (e.g., curl, Render health checks)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`Not allowed by CORS: ${origin}`));
    },
  })
);
// Preflight
app.options("*", cors());

/* -------------------- Parsing limits -------------------- */
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

/* -------------------- Health checks -------------------- */
app.get("/", (_req, res) => {
  res.type("text/plain").send("OK");
});

/* -------------------- Multer -------------------- */
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024, files: 2, fields: 10 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Only images and audio are allowed.`), false);
    }
  },
});

/* -------------------- helpers -------------------- */
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
};
const bitsNeeded = (nBytes) => nBytes * 8;
const readU32BE = (buf) => buf.readUInt32BE(0);

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
      rgbabuf[chOffset] = (rgbabuf[chOffset] & 0xFE) | bit;
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
      buf[lsbByte] = (buf[lsbByte] & 0xFE) | bit;
      bitIdx++;
    }
  }
  return { ok: true, usedBits: needBits };
}

/* -------------------- ffmpeg: any audio -> 16-bit PCM WAV -------------------- */
async function transcodeToPcmWav(inputBuf) {
  const inPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.in`);
  const outPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.wav`);
  await fs.writeFile(inPath, inputBuf);
  await new Promise((resolve, reject) => {
    ffmpeg(createReadStream(inPath))
      .outputOptions(["-c:a pcm_s16le", "-ar 44100", "-ac 2"])
      .on("error", reject)
      .on("end", resolve)
      .save(outPath);
  });
  const outBuf = await fs.readFile(outPath);
  // cleanup (best-effort)
  fs.unlink(inPath).catch(() => {});
  fs.unlink(outPath).catch(() => {});
  return outBuf;
}

/* -------------------- routes -------------------- */
app.post(
  "/api/embed",
  upload.fields([
    { name: "cover", maxCount: 1 },
    { name: "secretFile", maxCount: 1 },
  ]),
  async (req, res, next) => {
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

      // ------ AUDIO cover (any audio) -> auto-convert to PCM WAV -> embed safely ------
      if (cover.mimetype.startsWith("audio/")) {
        let wavBuf = Buffer.from(cover.buffer);

        // Quick check if it's already a proper WAV PCM 8/16
        let looksWav = wavBuf.toString("ascii", 0, 4) === "RIFF" && wavBuf.toString("ascii", 8, 12) === "WAVE";
        let isPcm8or16 = false;
        if (looksWav) {
          try {
            const { fmt } = parseWavHeader(wavBuf);
            isPcm8or16 = fmt.audioFormat === 1 && (fmt.bitsPerSample === 8 || fmt.bitsPerSample === 16);
          } catch {
            isPcm8or16 = false;
          }
        }
        if (!looksWav || !isPcm8or16) {
          // 🔄 Auto-normalize anything to 16-bit PCM WAV
          wavBuf = await transcodeToPcmWav(cover.buffer);
          looksWav = true;
        }

        const { dataOffset, dataLength, fmt } = parseWavHeader(wavBuf);
        const r = embedLSB_WavPCM(wavBuf, payload, dataOffset, dataLength, fmt.bitsPerSample);
        if (r.error) return res.status(400).json({ error: r.error });

        const baseName = (cover.originalname || "audio").replace(/\.[^.]+$/, "");
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Content-Disposition", `attachment; filename="${baseName}_stego.wav"`);
        return res.send(wavBuf);
      }

      return res
        .status(400)
        .json({ error: `Unsupported cover file type: ${cover.mimetype}. Use images (PNG/JPEG) or audio.` });
    } catch (e) {
      console.error("Embed error:", e);
      next(e);
    }
  }
);

app.post(
  "/api/extract",
  upload.fields([{ name: "stego", maxCount: 1 }]),
  async (req, res, next) => {
    try {
      const stego = req.files?.stego?.[0];
      const { password = "" } = req.body || {};
      if (!stego) return res.status(400).json({ error: "Stego file is required" });

      // pick reader by type
      let reader;
      if (stego.mimetype.startsWith("image/")) {
        const { data, info } = await sharp(stego.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        reader = new (class {
          constructor(rgbabuf, width, height) {
            this.buf = rgbabuf;
            this.bitIdx = 0;
            this.capacityBits = width * height * 3;
          }
          readBytes(n) {
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
          }
        })(data, info.width, info.height);
      } else if (stego.mimetype.startsWith("audio/")) {
        // Only WAV (PCM) extraction is supported; if user uploads MP3 here, reject.
        const wav = Buffer.from(stego.buffer);
        const { dataOffset, dataLength, fmt } = parseWavHeader(wav);
        const bytesPerSample = fmt.bitsPerSample / 8;
        const numSamples = Math.floor(dataLength / bytesPerSample);
        let bitIdx = 0;
        reader = {
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
      } else {
        return res.status(400).json({ error: "Unsupported stego file type" });
      }

      // Read container
      const first5 = reader.readBytes(5);
      let containerBuf;
      if (first5.equals(Buffer.from("ENCv1"))) {
        const headerRest = reader.readBytes(48);
        const encLen = readU32BE(headerRest.slice(44, 48));
        const enc = reader.readBytes(encLen);
        const combined = Buffer.concat([first5, headerRest, enc]);

        // decryptIfNeededMaybe (inline to keep file self-contained)
        const ENC = Buffer.from("ENCv1");
        if (!combined.slice(0, 5).equals(ENC)) throw new Error("Invalid encrypted payload header.");
        let off = 5;
        const salt = combined.slice(off, off + 16);
        off += 16;
        const iv = combined.slice(off, off + 12);
        off += 12;
        const tag = combined.slice(off, off + 16);
        off += 16;
        const len = readU32BE(combined.slice(off, off + 4));
        off += 4;
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
        const meta = JSON.parse(metaBuf.toString("utf8"));
        const dataTotal = (meta.items || []).reduce((s, it) => s + (it.len || 0), 0);
        const dataBuf = reader.readBytes(dataTotal);
        containerBuf = Buffer.concat([magic, metaLenBuf, metaBuf, dataBuf]);
      }

      // parseContainer (inline)
      const MAGIC = Buffer.from("STEGv1");
      if (!containerBuf.slice(0, 6).equals(MAGIC)) throw new Error("No payload found (magic mismatch).");
      let off = 6;
      const metaLen = readU32BE(containerBuf.slice(off, off + 4));
      off += 4;
      const metaBuf = containerBuf.slice(off, off + metaLen);
      off += metaLen;
      const meta = JSON.parse(metaBuf.toString("utf8"));
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
      return res.json({ ok: true, items });
    } catch (e) {
      console.error("Extract error:", e);
      next(e);
    }
  }
);

/* -------------------- error handlers (after routes) -------------------- */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Maximum size is 100MB." });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  next(err);
});

app.use((err, req, res, _next) => {
  const msg = err?.message || "Unexpected server error.";
  console.error("[ERROR]", msg);
  if (!res.headersSent) res.status(500).json({ error: msg });
});

/* -------------------- boot -------------------- */
const PORT = process.env.PORT || 4000;
// Express binds to all interfaces by default; good for Render.
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
