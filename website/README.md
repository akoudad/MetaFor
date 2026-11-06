# MetaFor website

A small, interactive showcase for the MetaFor Mac app.

- **MetaFor Chat:** explore an answer, follow connected topics, and return without losing your place.
- **MetaFor Help:** press **Option + M** to ask about your current screen and see guidance where it matters.

The page includes expandable feature branches, a scripted conversation preview, an illustrated Help preview, an actual app screenshot, and a navigation map. The demo film has a labelled placeholder. These previews do not call a model or capture a visitor's screen.

[Website](https://getmetafor.akoudad-karim-contac.chatgpt.site) · [Download for Mac](https://github.com/akoudad/MetaFor/releases/download/v0.4.8/Metafor-0.4.8-arm64.dmg)

The app requires Apple silicon, macOS 26+, internet access, and a model API key. Help needs Screen Recording permission. The current build is not notarized. Its first-launch guide introduces Chat, Help, and the shortcut.

## Preview

```sh
python3 -m http.server 4173 --directory website
```

Run this from the repository root, then open `http://localhost:4173`. Publish `website/` directly; no build step, backend, keys, or runtime dependencies are needed.

## Checks

Verify feature expansion, topic navigation and return, Help preview tabs and dismissal, page-map links, direct download URLs, and narrow-screen layout. All controls support keyboard use. Reduced-motion preferences disable decorative movement.
