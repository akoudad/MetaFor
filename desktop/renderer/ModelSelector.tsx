import { useEffect, useRef, useState } from "react";
import { selectedModelChoice } from "../model-choices";
import type { DesktopSettings, ModelCatalog, ModelChoice } from "../shared";
import "./model-selector.css";

export default function ModelSelector({ disabled = false, onOpenChange }: { disabled?: boolean; onOpenChange?: (open: boolean) => void }) {
  const bridge = window.metaforDesktop;
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const onOpen = useRef(onOpenChange); onOpen.current = onOpenChange;
  const revision = useRef(0);
  useEffect(() => {
    let alive = true;
    const update = (value: DesktopSettings) => { if (alive) { setSettings(value); setCatalog(null); setOpen(false); revision.current++; } };
    const initial = revision.current;
    void bridge.getSettings().then((value) => { if (initial === revision.current) update(value); }).catch(() => { if (alive) setError("Model settings are unavailable. Try again."); });
    const unsubscribe = bridge.onSettingsChanged?.(update);
    return () => { alive = false; revision.current++; unsubscribe?.(); };
  }, [bridge]);
  useEffect(() => { onOpen.current?.(open); return () => { if (open) onOpen.current?.(false); }; }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  async function load() {
    const current = revision.current;
    setLoading(true); setError("");
    try {
      const value = await bridge.listModels();
      if (current === revision.current) setCatalog(value);
    } catch (failure) { if (current === revision.current) setError(failure instanceof Error ? failure.message : "Models could not be loaded. Try again."); }
    finally { setLoading(false); }
  }
  async function choose(choice: ModelChoice) {
    setSaving(true); setError("");
    try {
      const value = await bridge.selectModel(choice.id);
      setSettings(value); setOpen(false); trigger.current?.focus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Your model choice could not be saved. Try again."); }
    finally { setSaving(false); }
  }
  const selected = settings ? selectedModelChoice(settings.model, settings.reasoningEffort ?? "medium") : undefined;
  const label = settings ? `${selected?.name ?? settings.model} · ${selected?.mode ?? settings.reasoningEffort ?? "Custom"}` : "Choose model";
  return <div className="model-selector" ref={root} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      const options = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
      if (!options.length) return;
      event.preventDefault();
      const index = options.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : index < 0 ? (event.key === "ArrowDown" ? 0 : options.length - 1) : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[next].focus();
    }
  }}>
    <button ref={trigger} className="model-selector-trigger" type="button" aria-label={`Choose model: ${label}`} aria-haspopup="listbox" aria-expanded={open} disabled={disabled || saving || settings?.credentialLoading} title={disabled ? "Finish or stop the answer to change models" : "Choose the model for Chat and Help"} onClick={() => {
      const next = !open; setOpen(next); if (next) void load();
    }}>{saving ? "Switching model…" : label}<span aria-hidden="true">⌄</span></button>
    {open && <div className="model-selector-popover">
      <div className="model-selector-heading"><span>Model for Chat & Help</span><button type="button" aria-label="Close model chooser" onClick={() => { setOpen(false); trigger.current?.focus(); }}>×</button></div>
      {loading && <p role="status">Checking available models…</p>}
      {!loading && catalog && <div role="listbox" aria-label="Available models">{catalog.choices.map((choice) => <button key={choice.id} type="button" role="option" aria-selected={selected?.id === choice.id} disabled={saving} onClick={() => void choose(choice)}>
        <span className="model-option-name">{choice.name}<span>{choice.mode}{selected?.id === choice.id ? " ✓" : ""}</span></span>
        <span className="model-option-description">{choice.description}</span>
      </button>)}</div>}
      {catalog?.message && !loading && <p>{catalog.message}</p>}
      {error && <p className="model-selector-error" role="alert">{error}<button type="button" disabled={saving || loading} onClick={() => void load()}>Retry</button></p>}
      <div className="model-selector-footer"><span>Fast / Balanced adjust Spark's reasoning.</span><button type="button" onClick={() => { void bridge.openSettings().then(() => setOpen(false)).catch(() => setError("Settings could not be opened.")); }}>Settings</button></div>
    </div>}
  </div>;
}
