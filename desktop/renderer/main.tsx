import React, { Component, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Chat from "./Chat";
import Help from "./Help";
import Selection from "./Selection";
import Guidance from "./Guidance";
import Settings from "./Settings";
import "../shared";

const surface = new URLSearchParams(location.search).get("surface");
document.documentElement.dataset.desktopSurface = surface ?? "chat";

class AppError extends Component<{ children: React.ReactNode }, { message: string }> {
  state = { message: "" };
  static getDerivedStateFromError(error: Error) { return { message: error.message }; }
  render() { return this.state.message ? <main style={{ padding: 50, fontFamily: "system-ui" }}><h1>Metafor could not display this view.</h1><p>Your saved conversations are still on this Mac.</p><p>{this.state.message}</p><button onClick={() => location.reload()}>Reopen view</button></main> : this.props.children; }
}

function App() {
  const [settings, setSettings] = useState(false);
  useEffect(() => window.metaforDesktop.onOpenSettings(() => setSettings(true)), []);
  useEffect(() => window.metaforDesktop.onSettingsChanged?.((value) => window.dispatchEvent(new window.CustomEvent("metafor-settings-changed", { detail: value }))), []);
  return <AppError>{surface === "guidance" ? <Guidance /> : surface === "selection" ? <Selection /> : surface === "help" ? <Help /> : <><Chat />{settings && <Settings onClose={() => setSettings(false)} />}</>}</AppError>;
}

createRoot(document.getElementById("root")!).render(<App />);
