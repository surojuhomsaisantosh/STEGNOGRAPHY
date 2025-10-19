import { useState, useRef } from "react";

export default function Embed() {
  const [coverFile, setCoverFile] = useState(null);
  const [secretFile, setSecretFile] = useState(null);
  const [secretText, setSecretText] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const coverInputRef = useRef(null);
  const secretInputRef = useRef(null);

  const FILE_SIZE_LIMITS = {
    maxSize: 100 * 1024 * 1024, // 100MB
    maxSizeReadable: "100MB",
    imageRecommendation: "Use PNG for best quality",
    audioRecommendation: "Use WAV (PCM) only"
  };

  function onCoverChange(e) {
    const f = e.target.files?.[0];
    if (f && f.size > FILE_SIZE_LIMITS.maxSize) {
      alert(
        `File too large! Maximum size is ${FILE_SIZE_LIMITS.maxSizeReadable}. Your file: ${(
          f.size / (1024 * 1024)
        ).toFixed(2)}MB`
      );
      e.target.value = "";
      setCoverFile(null);
      return;
    }
    setCoverFile(f || null);
    if (!f) return;

    const isLossyImage = /jpe?g/i.test(f.type);
    if (isLossyImage) {
      setNote("Lossy image cover detected. Output will be PNG.");
    } else if (f.type.startsWith("audio/")) {
      if (!/wav/i.test(f.type)) {
        setNote("Audio cover must be WAV (PCM). MP3/AAC will be rejected.");
      } else {
        setNote("WAV (PCM) detected. Good for audio stego.");
      }
    } else {
      setNote("");
    }
  }

  function onSecretChange(e) {
    const f = e.target.files?.[0];
    if (f && f.size > FILE_SIZE_LIMITS.maxSize) {
      alert(
        `File too large! Maximum size is ${FILE_SIZE_LIMITS.maxSizeReadable}. Your file: ${(
          f.size / (1024 * 1024)
        ).toFixed(2)}MB`
      );
      e.target.value = "";
      setSecretFile(null);
      return;
    }
    // Enforce WAV if an audio secret is chosen
    if (f && f.type.startsWith("audio/") && !/wav/i.test(f.type)) {
      alert("Audio secret must be WAV (PCM). MP3/AAC are not supported.");
      e.target.value = "";
      setSecretFile(null);
      return;
    }
    setSecretFile(f || null);
  }

  async function readErrorMessage(res) {
    const raw = await res.text().catch(() => "");
    if (!raw) return `Embed failed with status: ${res.status}`;
    try {
      const data = JSON.parse(raw);
      return data?.error || data?.message || raw || `Embed failed with status: ${res.status}`;
    } catch {
      return raw;
    }
  }

  async function handleEmbed() {
    if (!coverFile) {
      alert("Please select a cover file.");
      return;
    }
    if (!secretText && !secretFile) {
      alert("Add at least one secret (text, image, or audio).");
      return;
    }
    if (coverFile.size > FILE_SIZE_LIMITS.maxSize) {
      alert(`Cover file is too large! Maximum size is ${FILE_SIZE_LIMITS.maxSizeReadable}.`);
      return;
    }
    if (secretFile && secretFile.size > FILE_SIZE_LIMITS.maxSize) {
      alert(`Secret file is too large! Maximum size is ${FILE_SIZE_LIMITS.maxSizeReadable}.`);
      return;
    }

    setBusy(true);
    try {
      const fd = new FormData();
      if (coverFile) fd.append("cover", coverFile);
      if (secretFile) fd.append("secretFile", secretFile);
      if (secretText) fd.append("secretText", secretText);
      if (password) fd.append("password", password);

      const base = import.meta.env.VITE_API_URL || "http://localhost:4000";
      const res = await fetch(`${base}/api/embed`, {
        method: "POST",
        body: fd,
        signal: AbortSignal.timeout(120000)
      });

      if (!res.ok) {
        const message = await readErrorMessage(res);
        throw new Error(message);
      }

      const blob = await res.blob();
      const disp = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/.exec(disp);

      let filename = match?.[1];
      if (!filename) {
        if (blob.type.includes("wav")) filename = "stego.wav";
        else if (blob.type.includes("png")) filename = "stego.png";
        else filename = "stego_file";
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      alert(`Success! Stego file downloaded as ${filename}`);
    } catch (e) {
      if (e.name === "AbortError") {
        alert("Request timed out. Please try again with smaller files.");
      } else {
        alert(`Error: ${e.message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setCoverFile(null);
    setSecretFile(null);
    setSecretText("");
    setPassword("");
    setNote("");
    if (coverInputRef.current) coverInputRef.current.value = "";
    if (secretInputRef.current) secretInputRef.current.value = "";
  }

  const coverSize = coverFile ? ` (${(coverFile.size / (1024 * 1024)).toFixed(2)}MB)` : "";
  const secretSize = secretFile ? ` (${(secretFile.size / (1024 * 1024)).toFixed(2)}MB)` : "";

  return (
    <section className="grid gap-4">


      <div>
        <label className="text-sm font-medium">Cover (PNG/JPEG/WAV-PCM):</label>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/png,image/jpeg,audio/wav"
          onChange={onCoverChange}
          className="mt-1 block w-full"
          disabled={busy}
        />
        {coverFile && <p className="text-xs text-gray-400 mt-1">Selected: {coverFile.name}{coverSize}</p>}
        {note && <p className="text-xs text-gray-500 mt-1">{note}</p>}
      </div>

      <div>
        <label className="text-sm font-medium">Secret File (Image/Audio) — optional:</label>
        <input
          ref={secretInputRef}
          type="file"
          accept="image/png,image/jpeg,audio/wav"
          onChange={onSecretChange}
          className="mt-1 block w-full"
          disabled={busy}
        />
        {secretFile && <p className="text-xs text-gray-400 mt-1">Selected: {secretFile.name}{secretSize}</p>}
      </div>

      <div>
        <label className="text-sm font-medium">Secret Text — (Optional): </label>
        <textarea
          rows={4}
          value={secretText}
          onChange={(e) => setSecretText(e.target.value)}
          placeholder="Type a hidden message..."
          className="mt-1 block w-full"
          disabled={busy}
        />
        {secretText && <p className="text-xs text-gray-400 mt-1">Text size: {new Blob([secretText]).size} bytes</p>}
      </div>

      <div>
        <label className="text-sm font-medium">Password — (Optional): </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password to encrypt payload"
          className="mt-1 w-full max-w-sm"
          disabled={busy}
        />
      </div>

      <div className="flex gap-2">
        <button className="primary disabled:opacity-60" onClick={handleEmbed} disabled={busy}>
          {busy ? "Embedding…" : "Embed"}
        </button>
        <button className="secondary" onClick={handleReset} disabled={busy}>
          Reset
        </button>
      </div>


    </section>
  );
}
