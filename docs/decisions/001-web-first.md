# Web first, shared interface for desktop

2026-11-04 · Recommendation for the hackathon build

Finish the browser experience before adding a Mac shell. The current problems
are conversation navigation, layout, and context handling; packaging the same
interface as a desktop app would retain those problems and add a release target.
A web link also lets judges try the product without installing it.

Keep the conversation model, `.ingx` validation, and interface independent of
desktop features. After the web interaction is verified, evaluate a Mac app that
shares those parts and adds native file handling, window behavior, and storage.
The web app should keep the same core interaction, not become a separate rewrite.

Tauri can reuse a web frontend and the system WebView, but its frontend hosting
expects static assets. Our `/api/answer` route would need a hosted backend or a
separate local service; the server cannot simply be included in a static export.
See [Tauri's frontend requirements](https://v2.tauri.app/start/frontend/).
Electron offers a Node.js main process and web renderer, with different packaging
tradeoffs; see its [process model](https://www.electronjs.org/docs/latest/tutorial/process-model).

No desktop framework is selected or added by this decision. The next desktop
decision should follow a measured prototype using the same real conversation,
including memory use, startup, text selection, scrolling, and file recovery.
