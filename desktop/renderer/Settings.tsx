import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { DesktopSettings } from "../shared";
import "./settings.css";

export default function Settings({ onClose, requireKey = false }: { onClose: () => void; requireKey?: boolean }) {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [model, setModel] = useState(""); const [baseURL, setBaseURL] = useState(""); const [shortcut, setShortcut] = useState(""); const [key, setKey] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState(""); const [checking, setChecking] = useState(false);
  const connectionRevision = useRef(0);
  const connectionChanged = () => { connectionRevision.current++; setConnection(""); };
  useEffect(() => {
    let mounted = true; let revision = 0;
    window.metaforDesktop.getSettings().then((value) => { if (mounted) { if (!revision) setSettings(value); setModel(value.model); setBaseURL(value.baseURL); setShortcut(value.shortcut); } }).catch((e) => { if (mounted) setError(e.message); });
    const changed = (event: Event) => {
      const current = ++revision; connectionChanged();
      const value = (event as CustomEvent<DesktopSettings>).detail;
      if (value) setSettings(value);
      else void window.metaforDesktop.getSettings().then((next) => { if (mounted && current === revision) setSettings(next); }).catch((e) => { if (mounted) setError(e.message); });
    };
    window.addEventListener("metafor-settings-changed", changed);
    return () => { mounted = false; window.removeEventListener("metafor-settings-changed", changed); };
  }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (busy || checking || !settings || settings.credentialLoading) return;
    if (!settings.configured && !settings.hasSavedKey && !settings.warnings?.credential && !key.trim()) { setError("Enter your API key to connect Metafor."); return; }
    setBusy(true); setError(""); connectionChanged();
    try { const value = await window.metaforDesktop.saveSettings({ model, baseURL, shortcut, ...(key.trim() ? { apiKey: key } : {}) }); setSettings(value); setModel(value.model); setBaseURL(value.baseURL); setShortcut(value.shortcut); setKey(""); window.dispatchEvent(new window.CustomEvent("metafor-settings-changed", { detail: value })); if (value.configured && !value.credentialLoading && !value.warnings?.preferences && !value.warnings?.credential) setConnection("Settings saved on this Mac. Provider access has not been checked."); }
    catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "Settings could not be saved."); }
    finally { setBusy(false); }
  };
  const checkConnection = async () => {
    if (!settings?.configured || checking || busy) return;
    const revision = ++connectionRevision.current;
    setChecking(true); setConnection(""); setError("");
    try {
      const catalog = await window.metaforDesktop.listModels();
      if (revision !== connectionRevision.current) return;
      setConnection(catalog.choices.some((choice) => choice.model === settings.model)
        ? "Connection verified: API key accepted and selected model available."
        : "API key accepted. The selected model is not in the supported model list; check Model in Settings.");
    } catch (failure) { if (revision === connectionRevision.current) setError(failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "The connection could not be checked. Try again."); }
    finally { setChecking(false); }
  };
  const unsavedConnection = !!key.trim() || model !== settings?.model || baseURL !== settings?.baseURL;
  return <div className="desktop-settings-shade" onClick={onClose}><section role="dialog" aria-modal="true" aria-label="Metafor settings" className="desktop-settings" onClick={(event) => event.stopPropagation()}>
    <header><h1>{requireKey ? "Connect Metafor" : "Settings"}</h1><button aria-label="Close settings" onClick={onClose}>×</button></header>
    <p>{requireKey ? "Add your own API key to ask questions. " : "Connect your model. "}Your API key stays encrypted on this Mac.</p>
    {settings?.credentialLoading && <p role="status" className="settings-note">Waiting for macOS Keychain… You can remove the saved key to cancel.</p>}
    {settings?.warnings?.preferences && <p role="alert" className="settings-error">{settings.warnings.preferences}</p>}
    {settings?.warnings?.credential && <p role="alert" className="settings-error">{settings.warnings.credential}</p>}
    <form onSubmit={save}>
      <label>API key<input autoFocus required={requireKey} type="password" autoComplete="off" value={key} disabled={checking} onChange={(e) => { setKey(e.target.value); connectionChanged(); }} placeholder={(settings?.hasSavedKey || settings?.configured) ? "Key saved · leave empty to keep it" : "Enter your API key"} /></label>
      <label>Model<input required value={model} disabled={checking} onChange={(e) => { setModel(e.target.value); connectionChanged(); }} placeholder="muse-spark-1.3" /></label>
      <label>API base URL<input required value={baseURL} disabled={checking} onChange={(e) => { setBaseURL(e.target.value); connectionChanged(); }} placeholder="https://api.meta.ai/v1" /></label>
      <label>Help shortcut<input required value={shortcut} onChange={(e) => setShortcut(e.target.value)} /></label>
      {settings?.shortcutRegistered === false && <p role="alert" className="settings-error">Help shortcut {settings.shortcut} is unavailable. Choose another combination and save. You can still open Help from the File menu.</p>}
      <p className="settings-note">Default: ⌥M (Option + M). Global shortcut conflicts are reported; an app may still use the same shortcut locally. Choose another combination if needed.</p>
      {settings && <p className="settings-note">Screen Recording: {settings.screenPermission}. Help reads one screen snapshot when opened and refreshes it when you ask. Annotations use their original snapshot. Selecting an area is optional; nothing records continuously.</p>}
      <p className="settings-note">Bring web chats with File → Import Conversation. Export them as .ingx from your browser first.</p>
      {settings?.configured && <div className="settings-connection">
        <p className="settings-note" role="status">{checking ? "Checking provider access…" : connection || (unsavedConnection ? "Save these changes before checking the connection." : "API key saved on this Mac. Provider access has not been checked here.")}</p>
        {settings.baseURL === "https://api.meta.ai/v1" ? <button type="button" disabled={busy || checking || unsavedConnection || settings.credentialLoading} onClick={() => void checkConnection()}>Check connection</button> : <p className="settings-note">Custom provider access is checked when you ask a question.</p>}
      </div>}
      {error && <p role="alert" className="settings-error">{error}</p>}
      <footer><button type="button" onClick={onClose}>{requireKey ? "Browse saved chats" : "Done"}</button>{(settings?.hasSavedKey || settings?.configured || settings?.warnings?.credential) && <button type="button" disabled={busy || checking} onClick={() => { setBusy(true); setError(""); connectionChanged(); window.metaforDesktop.removeKey().then((value) => { setSettings(value); window.dispatchEvent(new window.CustomEvent("metafor-settings-changed", { detail: value })); }).catch((e) => setError(e.message)).finally(() => setBusy(false)); }}>Remove key</button>}<button type="submit" disabled={busy || checking || !settings || settings.credentialLoading}>{busy ? "Saving…" : "Save settings"}</button></footer>
    </form>
  </section></div>;
}
