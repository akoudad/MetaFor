# MetaFor website

A minimal showcase for the MetaFor Mac app, with its black, starry identity.

- **MetaFor Chat:** explore connected topics and ask beside a passage.
- **MetaFor Help:** ask about the current screen; Option + M is explained in its feature details.
- A scroll-linked orb splits into Chat and Help paths, follows their expandable details, and reunites at the embedded demo video. Scrolling up reverses the paths. Reduced-motion mode shows static paths.
- LinkedIn, GitHub, and email links sit in the header. A floating download button appears after the hero download button scrolls out of view and stays clear of the demo video.

The page contains an actual app screenshot and the YouTube demo (`hBM_tifGJJk`). It does not call a model or capture a visitor's screen.

[Website](https://metafor.pages.dev) · [Download for Mac](https://metafor.pages.dev/download)

The app requires Apple silicon, macOS 26+, internet access, and your own model API key. Help needs Screen Recording permission. The current build is not notarized.

## Preview

```sh
python3 -m http.server 4173 --directory website
```

Run this from the repository root, then open `http://localhost:4173`. Publish `website/` directly; no build step, backend, keys, or runtime dependencies are needed.

The primary site uses Cloudflare Pages project `metafor`, with a direct upload of
the static files, including `_redirects`. `/download` and `/download/` redirect
to the current installer without opening a GitHub page. The installer remains
hosted on GitHub Releases; update `_redirects` when publishing a new version.
The local Python server does not apply these Cloudflare redirect rules.

The previous Sites address remains available and links to the
new address. Its existing source checkout is `metafor-showcase/`.

## Checks

Verify feature details, responsive layouts, scroll progress in both directions, reduced motion, the floating download button, video embed, and download links. Header links, feature details, and downloads support keyboard use.
