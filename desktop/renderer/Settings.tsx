import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { DesktopSettings } from "../shared";
import "./settings.css";

export default function Settings({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [model, setModel] = useState(""); const [baseURL, setBaseURL] = useState(""); const [shortcut, setShortcut] = useState(""); const [key, setKey] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true; let revision = 0;
    window.metaforDesktop.getSettings().then((value) => { if (mounted) { if (!revision) setSettings(value); setModel(value.model); setBaseURL(value.baseURL); setShortcut(value.shortcut); } }).catch((e) => { if (mounted) setError(e.message); });
    const changed = (event: Event) => {
      const current = ++revision;
      const value = (event as CustomEvent<DesktopSettings>).detail;
      if (value) setSettings(value);
      else void window.metaforDesktop.getSettings().then((next) => { if (mounted && current === revision) setSettings(next); }).catch((e) => { if (mounted) setError(e.message); });
    };
    window.addEventListener("metafor-settings-changed", changed);
    return () => { mounted = false; window.removeEventListener("metafor-settings-changed", changed); };
  }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (busy || !settings || settings.credentialLoading) return; setBusy(true); setError("");
    try { const value = await window.metaforDesktop.saveSettings({ model, baseURL, shortcut, ...(key.trim() ? { apiKey: key } : {}) }); setSettings(value); setKey(""); window.dispatchEvent(new window.CustomEvent("metafor-settings-changed", { detail: value })); if (!value.credentialLoading && !value.warnings?.preferences && !value.warnings?.credential) onClose(); }
    catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "Settings could not be saved."); }
    finally { setBusy(false); }
  };
  return <div className="desktop-settings-shade" onClick={onClose}><section role="dialog" aria-modal="true" aria-label="Metafor settings" className="desktop-settings" onClick={(event) => event.stopPropagation()}>
    <header><h1>Settings</h1><button aria-label="Close settings" onClick={onClose}>×</button></header>
    <p>Connect your model. Your API key stays encrypted on this Mac.</p>
    {settings?.credentialLoading && <p role="status" className="settings-note">Waiting for macOS Keychain… You can remove the saved key to cancel.</p>}
    {settings?.warnings?.preferences && <p role="alert" className="settings-error">{settings.warnings.preferences}</p>}
    {settings?.warnings?.credential && <p role="alert" className="settings-error">{settings.warnings.credential}</p>}
    <form onSubmit={save}>
      <label>API key<input autoFocus type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={(settings?.hasSavedKey || settings?.configured) ? "Key saved · leave empty to keep it" : "Enter your API key"} /></label>
      <label>Model<input required value={model} onChange={(e) => setModel(e.target.value)} placeholder="muse-spark-1.3" /></label>
      <label>API base URL<input required value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://api.meta.ai/v1" /></label>
      <label>Help shortcut<input required value={shortcut} onChange={(e) => setShortcut(e.target.value)} /></label>
      <p className="settings-note">Default: ⌃⌥⌘M. Global shortcut conflicts are reported; an app may still use the same shortcut locally. Choose another combination if needed.</p>
      {settings && <p className="settings-note">Screen Recording: {settings.screenPermission}. macOS asks when you first choose a screen region. Each capture is a still image; only the crop you approve is sent.</p>}
      <p className="settings-note">Bring web chats with File → Import Conversation. Export them as .ingx from your browser first.</p>
      {error && <p role="alert" className="settings-error">{error}</p>}
      <footer>{(settings?.hasSavedKey || settings?.configured || settings?.warnings?.credential) && <button type="button" disabled={busy} onClick={() => { setBusy(true); setError(""); window.metaforDesktop.removeKey().then((value) => { setSettings(value); window.dispatchEvent(new window.CustomEvent("metafor-settings-changed", { detail: value })); }).catch((e) => setError(e.message)).finally(() => setBusy(false)); }}>Remove key</button>}<button type="submit" disabled={busy || !settings || settings.credentialLoading}>{busy ? "Saving…" : "Save settings"}</button></footer>
    </form>
  </section></div>;
}
