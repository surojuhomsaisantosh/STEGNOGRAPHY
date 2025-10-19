// src/pages/Analyze.jsx
import { useCallback, useMemo, useState, useEffect } from "react";

/* ===================== Helpers ===================== */
const MAGIC_SIGNATURES = [
  { name: "PNG", sig: [0x89, 0x50, 0x4E, 0x47] },
  { name: "JPEG", sig: [0xFF, 0xD8, 0xFF] },
  { name: "WAV", sig: [0x52, 0x49, 0x46, 0x46] }, // RIFF
  { name: "OGG", sig: [0x4F, 0x67, 0x67, 0x53] },
  { name: "FLAC", sig: [0x66, 0x4C, 0x61, 0x43] },
  { name: "MP3/ID3", sig: [0x49, 0x44, 0x33] },
  { name: "ZIP", sig: [0x50, 0x4B, 0x03, 0x04] },
  { name: "PDF", sig: [0x25, 0x50, 0x44, 0x46] },
  { name: "GIF", sig: [0x47, 0x49, 0x46, 0x38] },
];

function arrayEq(a, b, start = 0) {
  for (let i = 0; i < b.length; i++) if (a[start + i] !== b[i]) return false;
  return true;
}

function scanForSignatures(bytes, limitHits = 6) {
  const hits = [];
  for (let i = 0; i < bytes.length; i++) {
    for (const m of MAGIC_SIGNATURES) {
      if (i + m.sig.length <= bytes.length && arrayEq(bytes, m.sig, i)) {
        hits.push({ type: m.name, offset: i });
        if (hits.length >= limitHits) return hits;
      }
    }
  }
  return hits;
}

/* ===================== Image Analysis ===================== */

function analyzeLSBDistribution(imageData) {
  const { data } = imageData;
  const channelLSB = { r: 0, g: 0, b: 0, count: 0 };
  for (let i = 0; i < data.length; i += 4) {
    channelLSB.r += data[i] & 1;
    channelLSB.g += (data[i + 1] ?? 0) & 1;
    channelLSB.b += (data[i + 2] ?? 0) & 1;
    channelLSB.count++;
  }
  const ratios = {
    r: channelLSB.r / channelLSB.count,
    g: channelLSB.g / channelLSB.count,
    b: channelLSB.b / channelLSB.count,
  };
  const avgRatio = (ratios.r + ratios.g + ratios.b) / 3;
  const deviation = Math.abs(avgRatio - 0.5);
  return Math.max(0, 1 - deviation * 3);
}

function analyzeLSBCorrelation(imageData) {
  const { data } = imageData;
  let sameLSB = 0, total = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i] & 1;
    const g = (data[i + 1] ?? 0) & 1;
    const b = (data[i + 2] ?? 0) & 1;
    if (r === g && g === b) sameLSB++;
    total++;
  }
  if (!total) return 0;
  const ratio = sameLSB / total; // natural ~0.25-0.35
  return Math.max(0, (ratio - 0.25) * 4);
}

function detectStructuralPatterns(imageData) {
  const { data, width, height } = imageData;
  let structuredBlocks = 0, totalBlocks = 0;
  for (let y = 0; y <= height - 8; y += 16) {
    for (let x = 0; x <= width - 8; x += 16) {
      let ones = 0, bits = 0;
      for (let dy = 0; dy < 8; dy++) {
        for (let dx = 0; dx < 8; dx++) {
          const idx = ((y + dy) * width + (x + dx)) * 4;
          ones += (data[idx] & 1) + (data[idx + 1] & 1) + (data[idx + 2] & 1);
          bits += 3;
        }
      }
      const ratio = ones / bits;
      if (Math.abs(ratio - 0.5) < 0.08) structuredBlocks++; // tighter window
      totalBlocks++;
    }
  }
  return totalBlocks > 0 ? structuredBlocks / totalBlocks : 0;
}

/* Extra: image bit-plane scan (plane 0–3) + signature sniff */
function extractImageBitPlaneBytes(imageData, plane = 0) {
  const { data } = imageData;
  const bits = [];
  for (let i = 0; i < data.length; i += 4) {
    bits.push((data[i] >> plane) & 1);
    bits.push(((data[i + 1] ?? 0) >> plane) & 1);
    bits.push(((data[i + 2] ?? 0) >> plane) & 1);
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b];
    bytes[i] = v;
  }
  return bytes;
}

/* ===================== Audio Decode & Analysis ===================== */

function parseWavHeader(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const text = (o, n) => String.fromCharCode(...u8.subarray(o, o + n));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") return null;

  let pos = 12;
  let fmt = null;
  let data = null;

  while (pos + 8 <= u8.length) {
    const id = text(pos, 4);
    const size = dv.getUint32(pos + 4, true);
    const next = pos + 8 + size;

    if (id === "fmt ") {
      const audioFormat = dv.getUint16(pos + 8, true);
      const numChannels = dv.getUint16(pos + 10, true);
      const sampleRate = dv.getUint32(pos + 12, true);
      const bitsPerSample = dv.getUint16(pos + 22, true);
      fmt = { audioFormat, numChannels, sampleRate, bitsPerSample };
    } else if (id === "data") {
      data = { offset: pos + 8, length: size };
    }
    pos = next + (next % 2); // word-align
  }

  if (!fmt || !data) return null;
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) return null; // PCM16 only
  const samples = new Int16Array(
    u8.buffer,
    u8.byteOffset + data.offset,
    data.length / 2
  );
  return { ...fmt, dataOffset: data.offset, dataLength: data.length, samples };
}

function extractAudioBitPlane(samples, plane = 0) {
  const bits = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) bits[i] = (samples[i] >> plane) & 1;
  return bits;
}

function packBitsToBytes(bits, msbFirst = true, stride = 1, start = 0) {
  const N = Math.floor((bits.length - start) / stride);
  const out = new Uint8Array(Math.floor(N / 8));
  let bi = 0;
  for (let i = start; i + 7 * stride < bits.length; i += 8 * stride) {
    let v = 0;
    if (msbFirst) {
      for (let b = 0; b < 8; b++) v = (v << 1) | bits[i + b * stride];
    } else {
      for (let b = 7; b >= 0; b--) v = (v << 1) | bits[i + b * stride];
    }
    out[bi++] = v;
    if (bi >= out.length) break;
  }
  return out;
}

/* Stats */
function mean(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}
function chiSquare01(bits) {
  let ones = 0;
  for (let i = 0; i < bits.length; i++) ones += bits[i];
  const zeros = bits.length - ones;
  const E = bits.length / 2;
  const chi = ((zeros - E) ** 2) / E + ((ones - E) ** 2) / E;
  return 1 - Math.exp(-chi / 50);
}
function slidingEntropy(bits, win = 4096, step = 1024) {
  const ent = [];
  for (let i = 0; i + win <= bits.length; i += step) {
    let ones = 0;
    for (let j = 0; j < win; j++) ones += bits[i + j];
    const p = ones / win;
    const e =
      p === 0 || p === 1 ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
    ent.push(e);
  }
  if (!ent.length) return { avg: 0, std: 0 };
  const avg = mean(ent);
  const sd = Math.sqrt(mean(ent.map((x) => (x - avg) ** 2)));
  return { avg, std: sd };
}
function autocorr(bits, maxLag = 512) {
  const n = bits.length;
  if (n < maxLag * 2) return 0;
  const s = new Int8Array(n);
  for (let i = 0; i < n; i++) s[i] = bits[i] ? 1 : -1;
  let best = 0;
  for (let lag = 2; lag <= maxLag; lag *= 2) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += s[i] * s[i + lag];
    const norm = acc / (n - lag);
    best = Math.max(best, (norm + 1) / 2);
  }
  return best;
}
function samplePairScore(bits) {
  if (bits.length < 2) return 0;
  const c = [0, 0, 0, 0]; // 00,01,10,11
  for (let i = 0; i < bits.length - 1; i++) {
    const idx = (bits[i] << 1) | bits[i + 1];
    c[idx]++;
  }
  const total = c.reduce((a, b) => a + b, 0);
  const p = c.map((x) => x / total);
  // natural signals often have 01!=10; heavy LSB embedding pushes towards uniform
  const uniformity =
    1 -
    Math.sqrt(
      ((p[0] - 0.25) ** 2 +
        (p[1] - 0.25) ** 2 +
        (p[2] - 0.25) ** 2 +
        (p[3] - 0.25) ** 2) /
        4
    );
  return Math.max(0, uniformity);
}

/* ===================== Accurate Image Functions ===================== */

// Fallback-safe decode + optional downscale to protect UI
async function decodeImageToImageData(file) {
  // try createImageBitmap first
  let bmp = null;
  try {
    if (typeof createImageBitmap === "function") {
      bmp = await createImageBitmap(file);
      try {
        const { imageData } = bitmapToImageData(bmp);
        if (bmp.close) bmp.close();
        return imageData;
      } catch (e) {
        if (bmp && bmp.close) bmp.close();
        throw e;
      }
    }
  } catch (e) {
    // fall through to HTMLImageElement path
  }
  // fallback path using <img> and FileReader
  return await decodeViaHTMLImage(file);
}

function bitmapToImageData(bmp) {
  // downscale if huge (cap ~2MP)
  const MAX_PIXELS = 2_000_000; // ~2MP keeps analysis fast & avoids freezes
  let w = bmp.width, h = bmp.height;
  const pixels = w * h;
  if (pixels > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / pixels);
    w = Math.max(1, Math.floor(w * scale));
    h = Math.max(1, Math.floor(h * scale));
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  return { imageData: ctx.getImageData(0, 0, w, h), width: w, height: h };
}

function decodeViaHTMLImage(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Failed to read image file."));
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          // downscale if huge
          const MAX_PIXELS = 2_000_000;
          let w = img.width, h = img.height;
          const pixels = w * h;
          if (pixels > MAX_PIXELS) {
            const scale = Math.sqrt(MAX_PIXELS / pixels);
            w = Math.max(1, Math.floor(w * scale));
            h = Math.max(1, Math.floor(h * scale));
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, w, h);
          resolve(ctx.getImageData(0, 0, w, h));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error("Unsupported or corrupted image."));
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/* ===================== Accurate Audio Decoding ===================== */

async function decodeAudioToBuffer(file) {
  const u8 = new Uint8Array(await file.arrayBuffer());
  const wav = parseWavHeader(u8);
  if (wav) return { kind: "wav", ...wav, raw: u8 };
  return { kind: "raw", raw: u8 };
}

/* ===================== Detectors & Aggregation ===================== */

function tryHeaderRecoveryFromBits(bits) {
  const attempts = [];
  const strides = [1, 2, 3, 4];
  const orders = [true, false];
  for (const stride of strides) {
    for (const msbFirst of orders) {
      attempts.push({ stride, msbFirst, bytes: packBitsToBytes(bits, msbFirst, stride, 0) });
      attempts.push({ stride, msbFirst, bytes: packBitsToBytes(bits, msbFirst, stride, 1) });
      attempts.push({ stride, msbFirst, bytes: packBitsToBytes(bits, msbFirst, stride, 2) });
    }
  }
  let allHits = [];
  for (const a of attempts) {
    const hits = scanForSignatures(a.bytes);
    if (hits.length) {
      allHits.push({ stride: a.stride, msbFirst: a.msbFirst, hits });
    }
  }
  return allHits;
}

function analyzeImageForSteganography(imageData, fileType) {
  const lsbDistribution = analyzeLSBDistribution(imageData);
  const lsbCorrelation = analyzeLSBCorrelation(imageData);
  const structuralPatterns = detectStructuralPatterns(imageData);

  let headerHits = [];
  for (let plane = 0; plane <= 3; plane++) {
    const bytes = extractImageBitPlaneBytes(imageData, plane);
    const localHits = scanForSignatures(bytes, 3).map((h) => ({ ...h, plane }));
    headerHits = headerHits.concat(localHits);
  }

  let confidence = 0;
  confidence += lsbDistribution * 0.4;
  confidence += lsbCorrelation * 0.3;
  confidence += structuralPatterns * 0.3;

  const strongs = [lsbDistribution, lsbCorrelation, structuralPatterns].filter((x) => x > 0.35).length;
  if (strongs >= 2) confidence = Math.min(1, confidence * 1.2);
  if (headerHits.length) confidence = Math.min(1, confidence + 0.25);
  if (fileType === "image/jpeg") confidence *= 0.75;

  const probability = Math.min(95, Math.round(confidence * 100));
  const guess = headerHits.length ? `Possible embedded ${[...new Set(headerHits.map(h => h.type))].join(", ")}` : null;

  return {
    probability,
    interpretation: getInterpretation(probability),
    type: "image",
    scores: { lsbDistribution, lsbCorrelation, structuralPatterns },
    headerHits,
    guess,
  };
}

function analyzeAudioForSteganography(audioDecoded, fileType) {
  let confidence = 0;
  let scores = { plane0: {}, plane1: {}, plane2: {}, plane3: {} };
  let headerHits = [];
  const isPcm16 = audioDecoded.kind === "wav";

  if (isPcm16) {
    const { samples, numChannels } = audioDecoded;
    for (let p = 0; p <= 3; p++) {
      const bits = extractAudioBitPlane(samples, p, numChannels);
      const chi = chiSquare01(bits);
      const { avg: entAvg, std: entStd } = slidingEntropy(bits);
      const ac = autocorr(bits);
      const spa = samplePairScore(bits);

      const planeScore =
        0.35 * chi +
        0.30 * Math.min(1, entAvg) +
        0.20 * spa +
        0.15 * Math.max(0, ac - 0.55);

      scores[`plane${p}`] = { chi, entAvg, entStd, ac, spa, planeScore };
      confidence += (p === 0 ? 0.45 : 0.1833) * planeScore; // weight p0 highest

      const hits = tryHeaderRecoveryFromBits(bits);
      if (hits.length) {
        headerHits.push(
          ...hits.map((h) => ({
            plane: p,
            stride: h.stride,
            msbFirst: h.msbFirst,
            hits: h.hits,
          }))
        );
      }
    }
  } else {
    const hits = scanForSignatures(audioDecoded.raw);
    if (hits.length) headerHits.push({ plane: "raw", stride: 1, msbFirst: true, hits });
    confidence += Math.min(0.3, hits.length * 0.1);
  }

  if (fileType.includes("mp3") || fileType.includes("aac") || fileType.includes("mpeg")) confidence *= 0.6;
  if (fileType.includes("ogg")) confidence *= 0.75;

  const flatHits = headerHits.flatMap((h) => h.hits);
  if (flatHits.length) confidence = Math.min(1, confidence + 0.25);

  const probability = Math.min(95, Math.round(confidence * 100));
  const types = [...new Set(flatHits.map((h) => h.type))];
  const guess = types.length ? `Possible embedded ${types.join(", ")}` : null;

  return {
    probability,
    interpretation: getInterpretation(probability),
    type: "audio",
    scores,
    headerHits,
    guess,
  };
}

function getInterpretation(probability) {
  if (probability >= 80) return "High confidence — strong evidence of hidden data";
  if (probability >= 60) return "Moderate confidence — likely hidden data";
  if (probability >= 40) return "Low confidence — some indicators present";
  if (probability >= 20) return "Very low confidence — weak signals";
  return "No significant evidence";
}

/* ===================== React Component ===================== */

export default function Analyze() {
  const [file, setFile] = useState(null);
  const [fileURL, setFileURL] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  // include common browser variants + allow unknown/blank MIME
  const accept = useMemo(
    () => [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/bmp",
      "image/x-windows-bmp",
      "audio/wav",
      "audio/x-wav",
      "audio/mpeg",
      "audio/mp3",
      "audio/aac",
      "audio/flac",
      "audio/ogg",
      "" // some browsers give empty type for certain files
    ],
    []
  );

  // derive extension helper for preview logic
  const fileExt = useMemo(
    () => (file?.name ? (file.name.split(".").pop() || "").toLowerCase() : ""),
    [file]
  );

  useEffect(() => {
    return () => {
      if (fileURL) URL.revokeObjectURL(fileURL);
    };
  }, [fileURL]);

  const onPickFile = useCallback(
    async (f) => {
      setError("");
      setResult(null);
      setShowDetails(false);
      if (!f) return;

      // Some files have empty MIME; fall back to extension check.
      const mime = f.type || "";
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      const isImageByExt = ["png", "jpg", "jpeg", "webp", "bmp"].includes(ext);
      const isAudioByExt = ["wav", "mp3", "aac", "flac", "ogg"].includes(ext);

      if (!accept.includes(mime) && !(isImageByExt || isAudioByExt)) {
        setError(
          "Unsupported file. Use images (PNG/JPEG/WebP/BMP) or audio (WAV/MP3/AAC/FLAC/OGG)."
        );
        return;
      }

      setBusy(true);
      setFile(f);
      if (fileURL) URL.revokeObjectURL(fileURL);
      setFileURL(URL.createObjectURL(f));

      try {
        // Yield to paint spinner before heavy work
        await new Promise((r) => setTimeout(r, 0));

        let analysis;
        if (mime.startsWith("image/") || isImageByExt) {
          const imageData = await decodeImageToImageData(f);
          analysis = analyzeImageForSteganography(imageData, mime || `image/${ext || "unknown"}`);
          setResult({
            probability: analysis.probability,
            interpretation: analysis.interpretation,
            type: "image",
            dimensions: `${imageData.width}×${imageData.height}px`,
            notes: getImageNotes(mime || `image/${ext || "unknown"}`, analysis),
            scores: analysis.scores,
            guess: analysis.guess,
            headerHits: analysis.headerHits,
            mime: mime || `image/${ext || "unknown"}`,
          });
        } else if (mime.startsWith("audio/") || isAudioByExt) {
          const audioDecoded = await decodeAudioToBuffer(f);
          analysis = analyzeAudioForSteganography(audioDecoded, mime || `audio/${ext || "unknown"}`);
          const duration =
            audioDecoded.kind === "wav"
              ? `${(
                  audioDecoded.samples.length /
                  (audioDecoded.sampleRate * audioDecoded.numChannels)
                ).toFixed(2)}s`
              : "unknown";
          setResult({
            probability: analysis.probability,
            interpretation: analysis.interpretation,
            type: "audio",
            duration,
            notes: getAudioNotes(mime || `audio/${ext || "unknown"}`, analysis, audioDecoded.kind),
            scores: analysis.scores,
            guess: analysis.guess,
            headerHits: analysis.headerHits,
            mime: mime || `audio/${ext || "unknown"}`,
          });
        }
      } catch (e) {
        console.error("Analysis error:", e);
        setError(
          e?.message?.includes("Unsupported or corrupted")
            ? "Unsupported or corrupted image."
            : "Failed to analyze the file. It might be too large or not fully supported."
        );
      } finally {
        setBusy(false);
      }
    },
    [accept, fileURL]
  );

  function getImageNotes(fileType, analysis) {
    const notes = [];
    const { probability, scores, headerHits, guess } = analysis;

    if (fileType === "image/jpeg") notes.push("JPEG compression affects LSB patterns — reduced accuracy");
    if (guess) notes.push(guess);

    if (probability > 70) {
      if (scores.lsbDistribution > 0.6) notes.push("Strong LSB distribution patterns");
      if (scores.lsbCorrelation > 0.5) notes.push("High inter-channel LSB correlation");
      if (scores.structuralPatterns > 0.5) notes.push("Structured block patterns");
    } else if (probability < 25) {
      notes.push("LSB patterns appear natural/unstructured");
    } else {
      notes.push("Mixed signals — not conclusive");
    }

    if (headerHits?.length) {
      notes.push(`Header hints found in bit-planes: ${[...new Set(headerHits.map(h => h.plane))].join(", ")}`);
    }

    return notes;
  }

  function getAudioNotes(fileType, analysis, kind) {
    const notes = [];
    const { probability, scores, headerHits, guess } = analysis;

    if (fileType.includes("mp3") || fileType.includes("aac"))
      notes.push("Compressed audio (MP3/AAC) — LSB detection is limited");
    if (guess) notes.push(guess);

    if (probability > 65) {
      if (scores.plane0?.chi > 0.6) notes.push("Plane 0 near-uniform χ²");
      if (scores.plane0?.entAvg > 0.85) notes.push("High LSB entropy");
      if (scores.plane0?.spa > 0.6) notes.push("Sample-pair uniformity");
      if (scores.plane0?.ac > 0.6) notes.push("Autocorrelation periodicity detected");
    } else if (probability < 20) {
      notes.push("LSB patterns look natural");
    } else {
      notes.push("Weak or partial signals");
    }

    if (kind === "wav" && probability < 40) notes.push("WAV PCM provides the most reliable analysis");

    if (headerHits?.length) {
      const planes = [...new Set(headerHits.map((h) => h.plane))].join(", ");
      notes.push(`Header hints found (planes: ${planes})`);
    }

    return notes;
  }

  // robust preview booleans: use MIME or extension
  const isImage =
    !!file &&
    (file.type?.startsWith("image/") ||
      ["png", "jpg", "jpeg", "webp", "bmp"].includes(fileExt));

  const isAudio =
    !!file &&
    (file.type?.startsWith("audio/") ||
      ["wav", "mp3", "aac", "flac", "ogg"].includes(fileExt));

  return (
    <section className="space-y-5">
      <h2 className="text-xl font-semibold">Steganography Analysis</h2>

      <p className="text-white/80">Upload an image or audio file to analyze for hidden payload signals.</p>

      <div className="flex items-center gap-3">
        <label className="cursor-pointer inline-flex items-center gap-2 rounded-md border border-white/30 px-4 py-2 hover:bg-white/10 transition-colors">
          <input type="file" className="hidden" accept={accept.join(",")} onChange={(e) => onPickFile(e.target.files?.[0])} />
          <span>Choose File</span>
        </label>
        {file && (
          <span className="text-xs text-white/60 truncate max-w-[60%]">
            {file.name} ({Math.round(file.size / 1024)} KB)
          </span>
        )}
      </div>

      {fileURL && (
        <div className="flex items-center gap-4 p-4 bg-white/5 rounded-lg">
          {isImage && <img src={fileURL} alt="preview" className="w-24 h-24 object-cover rounded-lg border border-white/20" />}
          {isAudio && (
            <div className="w-24 h-24 flex items-center justify-center bg-blue-500/20 rounded-lg border border-blue-500/30">
              <div className="text-2xl">🎵</div>
            </div>
          )}

          {result && (
            <div className="flex-1 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-white/70">Detection Confidence</span>
                <span
                  className={`font-bold text-lg ${
                    result.probability >= 70
                      ? "text-red-400"
                      : result.probability >= 50
                      ? "text-orange-400"
                      : result.probability >= 30
                      ? "text-yellow-400"
                      : "text-green-400"
                  }`}
                >
                  {result.probability}%
                </span>
              </div>

              <div className="w-full h-4 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-1000 ${
                    result.probability >= 70
                      ? "bg-red-500"
                      : result.probability >= 50
                      ? "bg-orange-500"
                      : result.probability >= 30
                      ? "bg-yellow-500"
                      : "bg-green-500"
                  }`}
                  style={{ width: `${result.probability}%` }}
                />
              </div>

              <div className="text-sm text-white/60">{result.interpretation}</div>
              {result.guess && <div className="text-xs text-cyan-300/90">Hint: {result.guess}</div>}
            </div>
          )}
        </div>
      )}

      {busy && <div className="text-sm text-white/80 animate-pulse">Analyzing {isAudio ? "audio" : "image"}…</div>}
      {error && <div className="text-sm text-red-300 bg-red-500/10 p-3 rounded-lg">{error}</div>}

      {result && !busy && !error && (
        <div className="space-y-4">
          <div className="space-y-3 p-4 bg-white/5 rounded-lg">
            <div className="text-sm text-white/50">
              {result.type === "image" ? "Image" : "Audio"}: {result.dimensions || result.duration} • {result.mime}
            </div>

            {result.notes && result.notes.length > 0 && (
              <div className="text-xs text-white/40 space-y-1">
                {result.notes.map((note, index) => (
                  <div key={index}>• {note}</div>
                ))}
              </div>
            )}

            {/* Robust Header Hints render (works for image & audio shapes) */}
            {Array.isArray(result.headerHits) && result.headerHits.length > 0 && (
              <div className="text-xs text-white/70 space-y-1">
                <div className="font-medium text-white/80">Header Hints</div>
                <ul className="ml-4 list-disc space-y-1">
                  {result.headerHits
                    .flatMap((h, i) =>
                      Array.isArray(h.hits) && h.hits.length
                        ? h.hits.map((hit, j) => ({
                            key: `${i}-${j}`,
                            type: hit.type,
                            offset: hit.offset,
                            plane: h.plane,
                            stride: h.stride,
                            msbFirst: h.msbFirst,
                          }))
                        : [
                            {
                              key: `${i}-0`,
                              type: h.type,
                              offset: h.offset,
                              plane: h.plane,
                              stride: h.stride,
                              msbFirst: h.msbFirst,
                            },
                          ]
                    )
                    .map((h) => (
                      <li key={h.key}>
                        {h.type} — offset {h.offset}
                        {typeof h.plane === "number" ? ` • plane ${h.plane}` : ""}
                        {typeof h.stride !== "undefined" && h.stride !== null ? ` • stride ${h.stride}` : ""}
                        {typeof h.msbFirst === "boolean" ? ` • ${h.msbFirst ? "MSB" : "LSB"}-first` : ""}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>

          {/* Technical Details */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-2 text-blue-300 hover:text-blue-200 transition-colors text-sm font-medium"
            >
              <span>{showDetails ? "▼" : "▶"} Analysis Details</span>
            </button>

            {showDetails && (
              <div className="mt-3 space-y-3 text-sm text-blue-200/80">
                <div>
                  <p className="font-medium mb-1">Detectors Used</p>
                  <ul className="space-y-1 ml-4">
                    <li>• χ² on LSB/bit-planes (global)</li>
                    <li>• Sliding-window entropy (local randomness)</li>
                    <li>• Sample Pair Analysis (uniformity proxy)</li>
                    <li>• Autocorrelation (periodicity/echo/phase cues)</li>
                    <li>• Bit-plane sweep (0–3) with header sniffing</li>
                  </ul>
                </div>

                {result.type === "audio" && result.scores && (
                  <div>
                    <p className="font-medium mb-1">Audio bit-plane scores</p>
                    <div className="text-xs ml-4 space-y-1">
                      {Object.entries(result.scores).map(([plane, s]) => (
                        <div key={plane}>
                          {plane}:{" "}
                          {"planeScore" in s
                            ? `χ² ${(s.chi * 100).toFixed(1)}% • H(avg) ${(s.entAvg * 100).toFixed(
                                1
                              )}% • SPA ${(s.spa * 100).toFixed(1)}% • AC ${(s.ac * 100).toFixed(1)}% • score ${(s.planeScore * 100).toFixed(1)}%`
                            : "-"}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {result.type === "image" && result.scores && (
                  <div>
                    <p className="font-medium mb-1">Image scores</p>
                    <div className="text-xs ml-4 space-y-1">
                      {Object.entries(result.scores).map(([k, v]) => (
                        <div key={k}>
                          {k}: {(v * 100).toFixed(1)}%
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="font-medium mb-1">Accuracy Notes</p>
                  <ul className="space-y-1 ml-4">
                    <li>• PNG/WAV (lossless) yield best results</li>
                    <li>• JPEG/MP3 compress away LSB cues</li>
                    <li>• Desync/stride & bit-order tried for header recovery</li>
                    <li>• Small or encrypted payloads can evade detection</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
