import { useEffect, useState } from "react";
import Settings from "./Settings";
import Onboarding from "./Onboarding";

export default function ChatOverlays() {
  const [view, setView] = useState<"onboarding" | "settings" | null>(null);
  useEffect(() => {
    let mounted = true; let opened = false;
    const settings = window.metaforDesktop.onOpenSettings(() => { opened = true; setView("settings"); });
    const onboarding = window.metaforDesktop.onOpenOnboarding(() => { opened = true; setView("onboarding"); });
    void window.metaforDesktop.onboardingComplete().then((complete) => { if (mounted && !opened && !complete) setView("onboarding"); }).catch(() => { if (mounted && !opened) setView("onboarding"); });
    return () => { mounted = false; settings(); onboarding(); };
  }, []);
  return view === "settings" ? <Settings onClose={() => setView(null)} />
    : view === "onboarding" ? <Onboarding onClose={(settings) => setView(settings ? "settings" : null)} /> : null;
}
