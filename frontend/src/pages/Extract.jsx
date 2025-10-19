import { useState, useRef } from "react";

export default function Extract() {
  const [stegoFile, setStegoFile] = useState(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const fileInputRef = useRef(null);
  const previewUrlsRef = useRef(new Set()); // Track preview URLs to revoke later

  function onFileChange(e) {
    const f = e.target.files?.[0] || null;
    setStegoFile(f);
    setResults([]);
    // Clean up any existing preview URLs
    cleanupPreviewUrls();
  }

  function cleanupPreviewUrls() {
    previewUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    previewUrlsRef.current.clear();
  }

  async function readErrorMessage(res) {
    const raw = await res.text().catch(() => "");
    if (!raw) return `Extract failed with status: ${res.status}`;
    try {
      const data = JSON.parse(raw);
      return data?.error || data?.message || raw;
    } catch {
      return raw;
    }
  }

  async function handleExtract() {
    if (!stegoFile) {
      alert("Choose a stego file (PNG image or WAV audio).");
      return;
    }
    setBusy(true);
    setResults([]);
    cleanupPreviewUrls(); // Clean up old previews
    try {
      const fd = new FormData();
      fd.append("stego", stegoFile);
      if (password) fd.append("password", password);

      const base = import.meta.env.VITE_API_URL || "http://localhost:4000";
      const res = await fetch(`${base}/api/extract`, {
        method: "POST",
        body: fd,
        signal: AbortSignal.timeout(120000),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        throw new Error(msg);
      }

      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Extract failed");
      setResults(data.items || []);
    } catch (e) {
      alert(e.message || "Extract failed");
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setStegoFile(null);
    setPassword("");
    setResults([]);
    cleanupPreviewUrls();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Fixed base64 to Blob conversion
  function base64ToBlob(base64, mimeType = 'application/octet-stream') {
    try {
      // Remove data URL prefix if present
      const base64Data = base64.replace(/^data:[^;]+;base64,/, '');
      
      // Decode base64
      const byteCharacters = atob(base64Data);
      const byteArrays = [];
      
      for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
          byteNumbers[i] = slice.charCodeAt(i);
        }
        
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
      }
      
      return new Blob(byteArrays, { type: mimeType });
    } catch (error) {
      console.error('Error converting base64 to Blob:', error);
      throw new Error('Failed to convert file data');
    }
  }

  function sizeFromBase64(b64) {
    if (!b64) return 0;
    // Remove data URL prefix if present
    const cleanBase64 = b64.replace(/^data:[^;]+;base64,/, '');
    const len = cleanBase64.length;
    const padding = (cleanBase64.endsWith("==") ? 2 : cleanBase64.endsWith("=") ? 1 : 0);
    return Math.floor((len * 3) / 4) - padding;
  }

  function prettyBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(2)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(2)} MB`;
  }

  function createPreviewUrl(item) {
    try {
      let blob;
      if (item.type === "text") {
        blob = new Blob([item.text], { type: item.mime || "text/plain" });
      } else {
        blob = base64ToBlob(item.base64, item.mime || "application/octet-stream");
      }
      const url = URL.createObjectURL(blob);
      previewUrlsRef.current.add(url);
      return url;
    } catch (error) {
      console.error('Error creating preview URL:', error);
      return null;
    }
  }

  function downloadItem(item) {
    try {
      let blob;
      let filename = item.name || (item.type === "text" ? "message.txt" : "secret.bin");
      
      if (item.type === "text") {
        blob = new Blob([item.text], { type: item.mime || "text/plain" });
      } else {
        blob = base64ToBlob(item.base64, item.mime || "application/octet-stream");
        
        // Ensure proper file extension
        if (item.mime) {
          const ext = item.mime.split('/')[1];
          if (ext && !filename.includes('.')) {
            filename = `${filename}.${ext}`;
          }
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
      alert(`Download failed: ${error.message}`);
    }
  }

  async function downloadAll() {
    if (results.length === 0) return;
    
    if (results.length === 1) {
      downloadItem(results[0]);
      return;
    }
    
    // Download each item individually
    for (const item of results) {
      downloadItem(item);
      // Small delay between downloads to avoid browser issues
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  const fileMeta = stegoFile 
    ? ` (${stegoFile.type || "unknown"}, ${(stegoFile.size / (1024 * 1024)).toFixed(2)} MB)`
    : "";

  return (
    <section className="grid gap-4">


      <div>
        <label className="text-sm font-medium">Stego File (PNG or WAV-PCM):</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,audio/wav"
          onChange={onFileChange}
          className="mt-1 block w-full"
          disabled={busy}
        />
        {stegoFile && (
          <p className="text-xs text-gray-500 mt-1">
            Selected: {stegoFile.name}{fileMeta}
          </p>
        )}
      </div>

      <div>
        <label className="text-sm font-medium">Password (if encrypted):</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password if you set one during embedding"
          className="mt-1 w-full max-w-sm"
          disabled={busy}
        />
      </div>

      <div className="flex gap-2">
        <button className="primary disabled:opacity-60" onClick={handleExtract} disabled={busy}>
          {busy ? "Extracting…" : "Extract"}
        </button>
        <button className="secondary" onClick={handleReset} disabled={busy}>
          Reset
        </button>
        {results.length > 0 && (
          <button className="secondary" onClick={downloadAll} disabled={busy}>
            Download All
          </button>
        )}
      </div>

      {results.length > 0 && (
        <div className="mt-4 space-y-3">
          <h3 className="text-sm text-gray-700">Recovered items:</h3>
          {results.map((item, idx) => {
            const isText = item.type === "text";
            const size = isText
              ? new Blob([item.text]).size
              : sizeFromBase64(item.base64);
            const sizeLabel = prettyBytes(size);

            const canPreviewImg = !isText && item.mime?.startsWith("image/");
            const canPreviewAudio = !isText && item.mime?.startsWith("audio/");
            
            const previewUrl = (canPreviewImg || canPreviewAudio) ? createPreviewUrl(item) : null;

            return (
              <div key={idx} className="rounded-md border border-gray-200 p-3 bg-white">
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-sm">
                        {item.name || (isText ? "message.txt" : "secret.bin")}
                      </div>
                      <div className="text-xs text-gray-500">
                        {item.type} • {item.mime || "application/octet-stream"} • {sizeLabel}
                      </div>
                    </div>
                    <button 
                      className="primary text-sm px-3 py-1"
                      onClick={() => downloadItem(item)}
                    >
                      Download
                    </button>
                  </div>

                  {isText && (
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-gray-800 bg-gray-50 p-2 rounded border">
                      {item.text}
                    </pre>
                  )}

                  {!isText && canPreviewImg && previewUrl && (
                    <div className="mt-2">
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="max-h-60 max-w-full rounded border object-contain"
                      />
                    </div>
                  )}

                  {!isText && canPreviewAudio && previewUrl && (
                    <div className="mt-2">
                      <audio
                        controls
                        src={previewUrl}
                        className="w-full"
                      >
                        Your browser does not support the audio element.
                      </audio>
                    </div>
                  )}

                  {previewUrl && (
                    <div className="flex justify-end">
                      <a
                        href={previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-800 underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Open in new tab
                      </a>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}