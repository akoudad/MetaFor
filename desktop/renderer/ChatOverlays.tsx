import { useEffect, useRef, useState } from "react";
import Settings from "./Settings";
import Onboarding from "./Onboarding";
import type { DesktopSettings } from "../shared";

export default function ChatOverlays() {
  const [view, setView] = useState<"onboarding" | "settings" | null>(null);
  const [requiresKey, setRequiresKey] = useState(false);
  const keyRequired = useRef(false);
  useEffect(() => {
    let mounted = true; let opened = false; let initialized = false;
    let latest: DesktopSettings | undefined;
    const needsKey = (value: DesktopSettings) => !value.configured && !value.hasSavedKey && !value.credentialLoading && !value.warnings?.credential;
    const changed = (event: Event) => {
      const value = (event as CustomEvent<DesktopSettings>).detail;
      if (!value) return;
      latest = value; keyRequired.current = needsKey(value); setRequiresKey(keyRequired.current);
      if (initialized && needsKey(value)) setView((current) => current ?? "settings");
    };
    window.addEventListener("metafor-settings-changed", changed);
    const settings = window.metaforDesktop.onOpenSettings(() => { opened = true; setView("settings"); });
    const onboarding = window.metaforDesktop.onOpenOnboarding(() => { opened = true; setView("onboarding"); });
    void Promise.all([window.metaforDesktop.onboardingComplete().catch(() => false), window.metaforDesktop.getSettings()]).then(([complete, value]) => {
      if (!mounted) return;
      initialized = true;
      const required = needsKey(latest ?? value); keyRequired.current = required; setRequiresKey(required);
      if (!opened) setView(!complete ? "onboarding" : required ? "settings" : null);
    }).catch(() => { if (mounted && !opened) setView("settings"); });
    return () => { mounted = false; settings(); onboarding(); window.removeEventListener("metafor-settings-changed", changed); };
  }, []);
  return view === "settings" ? <Settings requireKey={requiresKey} onClose={() => setView(keyRequired.current ? "settings" : null)} />
    : view === "onboarding" ? <Onboarding requiresKey={requiresKey} onClose={(settings) => setView(settings || keyRequired.current ? "settings" : null)} /> : null;
}
