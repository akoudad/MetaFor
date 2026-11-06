import { useEffect, useRef, useState } from "react";
import "./onboarding.css";

export default function Onboarding({ onClose, requiresKey = false }: { onClose: (settings?: boolean) => void; requiresKey?: boolean }) {
  const panel = useRef<HTMLElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const previous = document.activeElement; start.current?.focus(); return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  const finish = async (settings = false) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await window.metaforDesktop.completeOnboarding(); onClose(settings); }
    catch { setError("Quick start could not be saved. Try again, or close it for now."); }
    finally { setBusy(false); }
  };
  return <div className="desktop-onboarding-shade"><section ref={panel} className="desktop-onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" tabIndex={-1} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); void finish(); }
    if (event.key !== "Tab") return;
    const buttons = panel.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
    if (!buttons?.length) { event.preventDefault(); return; }
    const first = buttons[0]; const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}>
    <p className="onboarding-eyebrow">A quick start</p>
    <h1 id="onboarding-title">Welcome to Metafor</h1>
    <p className="onboarding-intro">Two ways to explore what’s on your mind.</p>
    <div className="onboarding-features">
      <section>
        <svg className="onboarding-symbol" viewBox="0 0 100 42" fill="none" aria-hidden="true"><path d="M15 21H49M49 21L82 8M49 21L82 34" stroke="currentColor" /><circle cx="15" cy="21" r="5" /><circle cx="49" cy="21" r="5" /><circle cx="82" cy="8" r="4" /><circle cx="82" cy="34" r="4" /></svg>
        <h2>Metafor Chat</h2>
        <p>Conversations you can explore.</p>
        <ol><li>Ask a question to start.</li><li>Open connected topics to go deeper.</li><li>Select a passage for a focused follow-up.</li></ol>
      </section>
      <section>
        <div className="onboarding-shortcut" aria-label="Option plus M">⌥ M</div>
        <h2>Metafor Help</h2>
        <p>A little help with what’s on screen.</p>
        <ol><li>Press <strong>Option + M</strong> over any app.</li><li>Ask about your screen in the compact bar.</li><li>Press it again to hide Help.</li></ol>
      </section>
    </div>
    <p className="onboarding-setup"><strong>Your own API key is required</strong> to ask questions in Chat or Help. Add it in Settings (<span>⌘,</span>). Help asks for Screen Recording permission when first used; screen questions share a snapshot with your chosen model.</p>
    {error && <p className="onboarding-error" role="alert">{error}</p>}
    <footer>{error && <button disabled={busy} onClick={() => onClose(requiresKey)}>{requiresKey ? "Continue to setup" : "Close for now"}</button>}{!requiresKey && <button disabled={busy} onClick={() => void finish(true)}>Open settings</button>}<button ref={start} className="onboarding-start" disabled={busy} onClick={() => void finish(requiresKey)}>{busy ? "Saving…" : requiresKey ? "Add API key" : "Get started"}</button></footer>
    <p className="onboarding-reopen">Find this guide again in Metafor → Quick start.</p>
  </section></div>;
}
