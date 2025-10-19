// src/App.jsx
import { useMemo, useState } from "react";
import Embed from "./pages/Embed.jsx";
import Extract from "./pages/Extract.jsx";
import Analyze from "./pages/Analyze.jsx";
import logo from "./assets/logo.png"; // change to "./assests/logo.png" if your folder is misspelled

const tabs = [
  { key: "Embed", label: "Embed" },
  { key: "Extract", label: "Extract" },
  { key: "Analyze", label: "Analyze" },
];

export default function App() {
  const [active, setActive] = useState("Embed");

  // Freeze particle positions/delays/durations across re-renders
  const particles = useMemo(() => {
    return Array.from({ length: 20 }).map(() => ({
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      delay: `${Math.random() * 5}s`,
      duration: `${3 + Math.random() * 4}s`,
    }));
  }, []);

  return (
    <div className="h-screen w-screen bg-black text-white font-sans relative overflow-hidden">
      {/* Animated Background Elements (behind everything) */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        {/* Moving light beam 1 */}
        <div className="absolute top-1/4 w-96 h-1 bg-gradient-to-r from-cyan-500/0 via-cyan-500/50 to-cyan-500/0 animate-sweep-1 blur-sm" />
        {/* Moving light beam 2 */}
        <div className="absolute top-1/2 w-80 h-0.5 bg-gradient-to-r from-purple-500/0 via-purple-500/40 to-purple-500/0 animate-sweep-2 blur" />
        {/* Moving light beam 3 */}
        <div className="absolute top-3/4 w-64 h-0.5 bg-gradient-to-r from-blue-500/0 via-blue-500/30 to-blue-500/0 animate-sweep-3 blur" />

        {/* Pulsing glow dots */}
        <div className="absolute top-1/3 left-1/4 w-2 h-2 bg-cyan-400 rounded-full animate-pulse-glow-1 blur-sm" />
        <div className="absolute top-2/3 left-3/4 w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse-glow-2 blur-sm" />
        <div className="absolute top-1/2 left-1/2 w-1 h-1 bg-blue-400 rounded-full animate-pulse-glow-3 blur" />

        {/* Floating particles (stable via useMemo) */}
        <div className="absolute inset-0">
          {particles.map((p, i) => (
            <div
              key={i}
              className="absolute w-0.5 h-0.5 bg-white/30 rounded-full animate-float"
              style={{
                left: p.left,
                top: p.top,
                animationDelay: p.delay,
                animationDuration: p.duration,
              }}
            />
          ))}
        </div>
      </div>

      {/* Top Navigation Bar (title only; logo lives in sidebar now) */}
      <header className="relative z-20 h-16 border-b border-white/10 bg-white/5 backdrop-blur-md">
        <div className="h-full max-w-6xl mx-auto px-4 relative flex items-center justify-center">
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-300 to-white bg-clip-text text-transparent">
            STEGNOGRAPHY
          </h1>
        </div>
      </header>

      {/* MAIN LAYOUT: Sidebar + content below the header */}
      <div className="relative z-10 grid h-[calc(100vh-4rem)]" style={{ gridTemplateColumns: "1fr" }}>
        {/* Single grid that becomes 2 cols at sm */}
        <style>{`
          @media (min-width: 640px) {
            .app-grid-2col {
              display: grid !important;
              grid-template-columns: 240px minmax(0, 1fr) !important;
            }
          }
        `}</style>

        <div className="contents app-grid-2col">
          {/* Sidebar */}
          <aside className="min-h-0 h-full overflow-hidden border-b sm:border-b-0 sm:border-r border-white/10 bg-white/5 backdrop-blur-md">
            <div className="flex h-full flex-col">
              {/* Brand with logo beside text */}
              <div className="px-4 pt-6 pb-4 border-b border-white/10">
                <div className="flex items-center justify-center sm:justify-start gap-3">
                  <img
                    src={logo}
                    alt="Stega Vault Logo"
                    className="h-8 w-8 sm:h-9 sm:w-9 object-contain select-none"
                    draggable="false"
                  />
                  <div className="text-center sm:text-left">
                    <p className="text-sm font-medium text-white/90">STEGA VAULT</p>
                    <p className="text-[10px] text-gray-400">Where Secrets Stay Hidden</p>
                  </div>
                </div>
              </div>

              {/* Navigation + Panels */}
              <nav className="py-4">
                {/* Tab buttons */}
                <div className="flex flex-col gap-1 px-2">
                  {tabs.map(({ key, label }) => {
                    const isActive = active === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setActive(key)}
                        className={
                          "w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-all duration-300 " +
                          (isActive
                            ? "bg-white text-black shadow-lg shadow-cyan-500/25"
                            : "border border-white/20 text-white/90 hover:bg-white/10 hover:shadow-lg hover:shadow-purple-500/20")
                        }
                        aria-pressed={isActive}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* File Size & Formats: visible only on Embed */}
                {active === "Embed" && (
                  <div className="mt-6 mx-3 p-4 rounded-lg border border-white/15 bg-white/5 shadow-inner">
                    <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">
                      File Size &amp; Formats
                    </h3>
                    <ul className="space-y-2 text-xs text-gray-300">
                      <li className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-cyan-400 shrink-0" />
                        <span><span className="text-white/95 font-medium">Max size:</span> 100MB per file</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-cyan-400 shrink-0" />
                        <span><span className="text-white/95 font-medium">Images:</span> Use PNG for best quality</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-cyan-400 shrink-0" />
                        <span><span className="text-white/95 font-medium">Audio cover/secret:</span> Use WAV (PCM) only</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-cyan-400 shrink-0" />
                        <span><span className="text-white/95 font-medium">Note:</span> MP3/AAC covers are not supported for embedding</span>
                      </li>
                    </ul>
                  </div>
                )}

                {/* Accepted Stego Files: visible only on Extract */}
                {active === "Extract" && (
                  <div className="mt-6 mx-3 p-4 rounded-lg border border-white/15 bg-white/5 shadow-inner">
                    <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">
                      Accepted Stego Files
                    </h3>
                    <ul className="space-y-2 text-xs text-gray-300">
                      <li className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-purple-400 shrink-0" />
                        <span><span className="text-white/95 font-medium">Image stego:</span> .png produced by the Embed tool</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-purple-400 shrink-0" />
                        <span><span className="text-white/95 font-medium">Audio stego:</span> .wav (PCM 8/16-bit) produced by the Embed tool</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-purple-400 shrink-0" />
                        <span>If you encrypted during embed, enter the same password to extract</span>
                      </li>
                    </ul>
                  </div>
                )}

                {/* Analyze Note: visible only on Analyze */}
                {active === "Analyze" && (
                  <div className="mt-6 mx-3 p-4 rounded-lg border border-yellow-400/30 bg-yellow-400/10 shadow-inner">
                    <div className="flex items-start gap-2">
                      <div className="text-lg leading-none select-none" aria-hidden>⚠️</div>
                      <div>
                        <h3 className="text-xs font-semibold text-yellow-200 uppercase tracking-wider mb-2">
                          Advanced Statistical Analysis
                        </h3>
                        <p className="text-xs text-yellow-100/90">
                          Runs χ², entropy, SPA & autocorr checks to estimate hidden data.
                          Results are probabilistic and may vary by format.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Supported Combinations (stays below whichever panel is shown) */}
                <div className="mt-6 px-3 py-3 border-t border-white/10">
                  <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">
                    Supported Combinations
                  </h3>
                  <div className="space-y-2 text-xs text-gray-400">
                    <div className="flex items-start gap-1">
                      <span className="text-cyan-400 mt-0.5">•</span>
                      <div>
                        <span className="font-medium text-white/90">Image Cover</span>
                        <span className="text-gray-500"> + </span>
                        <span className="text-cyan-300">Text/Image</span>
                      </div>
                    </div>
                    <div className="flex items-start gap-1">
                      <span className="text-purple-400 mt-0.5">•</span>
                      <div>
                        <span className="font-medium text-white/90">Audio Cover</span>
                        <span className="text-gray-500"> + </span>
                        <span className="text-purple-300">Text/Image/Audio</span>
                      </div>
                    </div>
                  </div>
                </div>
              </nav>
            </div>
          </aside>

          {/* Content Area */}
          <main className="min-h-0 min-w-0 h-full overflow-y-auto relative">
            <div className="absolute inset-0 overflow-y-auto">
              <div className="mx-auto max-w-4xl p-6 min-h-full">
                <div className="rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur-lg shadow-2xl shadow-cyan-500/10">
                  {active === "Embed" && <Embed />}
                  {active === "Extract" && <Extract />}
                  {active === "Analyze" && <Analyze />}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Global Scrollbar Styling */}
      <style>{`
        /* Reset html and body to ensure proper scrolling */
        html, body, #root {
          height: 100%;
          margin: 0;
          padding: 0;
          overflow: hidden;
        }

        /* Custom scrollbar styling */
        ::-webkit-scrollbar {
          width: 12px;
        }
        
        ::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
          margin: 4px;
        }
        
        ::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.3);
          border-radius: 6px;
          border: 2px solid rgba(255, 255, 255, 0.1);
        }
        
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.4);
        }
        
        /* Firefox scrollbar */
        * {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.3) rgba(255, 255, 255, 0.05);
        }

        /* Ensure main content area is always scrollable */
        main {
          overflow-y: scroll !important;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: thin;
        }

        /* Force Webkit browsers to show scrollbar */
        main::-webkit-scrollbar {
          display: block;
          width: 12px;
        }
        
        main::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.3);
          border-radius: 6px;
        }

        main::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
        }

        @keyframes sweep-1 {
          0% { transform: translateX(-100vw) rotate(15deg); }
          100% { transform: translateX(100vw) rotate(15deg); }
        }
        @keyframes sweep-2 {
          0% { transform: translateX(100vw) rotate(-10deg); }
          100% { transform: translateX(-100vw) rotate(-10deg); }
        }
        @keyframes sweep-3 {
          0% { transform: translateX(-100vw) rotate(5deg); }
          100% { transform: translateX(100vw) rotate(5deg); }
        }
        @keyframes pulse-glow-1 {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.5); }
        }
        @keyframes pulse-glow-2 {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.8); }
        }
        @keyframes pulse-glow-3 {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(2); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px) translateX(0px); }
          25% { transform: translateY(-10px) translateX(5px); }
          50% { transform: translateY(5px) translateX(-5px); }
          75% { transform: translateY(-5px) translateX(-3px); }
        }
        .animate-sweep-1 { animation: sweep-1 8s linear infinite; }
        .animate-sweep-2 { animation: sweep-2 12s linear infinite; }
        .animate-sweep-3 { animation: sweep-3 10s linear infinite; }
        .animate-pulse-glow-1 { animation: pulse-glow-1 4s ease-in-out infinite; }
        .animate-pulse-glow-2 { animation: pulse-glow-2 3.5s ease-in-out infinite; }
        .animate-pulse-glow-3 { animation: pulse-glow-3 5s ease-in-out infinite; }
        .animate-float { animation: float 6s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
