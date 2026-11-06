# MetaFor continuation — 2026-11-06

Recovered without resetting files or replacing the existing implementation.

- Main started at `f58beaa`; native worktree `feat/macos-app` at `7d06ca2`
  (published release `v0.4.9`). Both tracked worktrees were clean.
- Existing publishing checkout: `metafor-showcase/`, source `afe8729`, Sites
  project `appgprj_6aecfeb9da308191b03f67d433a17079`, public version 4.
- Existing untracked publishing checkout and `metafor.mp4` are preserved.

## Checklist

- [x] Packaged fresh profiles are empty; created/imported chats and drafts persist.
- [x] API setup allows saved-chat browsing, reports saved versus checked keys,
  and gives clear missing/rejected-key guidance.
- [x] Website social links and concise feature copy are complete.
- [x] Scroll-linked branching, reversal, expanded details, and reduced motion pass.
- [x] Floating download stays accessible and clears video controls.
- [x] Concise README includes architecture, demo, installation, API setup, and tests.
  Website, direct Mac download, and demo links appear immediately below the title.
- [x] [metafor.pages.dev](https://metafor.pages.dev/) is live; README and GitHub
  About use it. Its download button delivers the verified final installer.

Native release `v0.4.10` is published from `61a5a31334b5d7b42526b22fb5e16e901cb65e3f`.
Previous release `v0.4.9` remains available. Installer SHA-256:
`26129433858f7fef7e4c03df82fb210bac45a5682b64d92070eb6009c6196db4`.

## Checks

- Main: 232 tests, TypeScript, and Next.js production build passed.
- Website: 320–1440 px browser checks passed for overflow, JavaScript errors,
  expanded-detail path geometry, reverse scrolling, and reduced motion.
- Native Safari showed current site after refreshing a stale open tab.
- Native: 219 desktop tests, 248 conversation tests, TypeScript, Next.js and
  desktop builds, strict signatures, and DMG integrity passed. macOS 26+ is
  confirmed by both bundled helpers.
- Packaged executable/frameworks and unchanged production ASAR were checked
  through a temporary bootstrap with isolated profiles. Keychain and provider
  replies were synthetic; no live provider or physical screen-capture claim.
- Public desktop/mobile checks passed at the new address. An actual hero-button
  click downloaded the 121,219,926-byte installer with the exact release hash.
  Its read-only mount passed signature/integrity/version checks; ASAR, executable,
  and helpers match the isolated-profile-tested package byte for byte.
- Local reports: `artifacts/website-continuation-qa/results.json`,
  `artifacts/download-verification/live-verification.json`, and
  `artifacts/download-verification/mounted-installer-verification.json`.

The app remains an Apple silicon/macOS 26+ preview with an ad-hoc signature;
it is not Developer ID signed or notarized. No task blocker remains.

## Address investigation

`metafor.vercel.app`, `metafor.netlify.app`, and `metafor.surge.sh` already serve
other sites. Before creation, `metafor.pages.dev` had no DNS record and
`metafor.web.app` returned 404; neither result alone proved availability.

Cloudflare accepted project `metafor` with hostname `metafor.pages.dev` after
the user signed in. The tested static files were uploaded through
[Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).
Cloudflare confirmed deployment, and an unauthenticated browser received HTTP 200.
The primary site's static files match the tested website source.

The [old address](https://getmetafor.akoudad-karim-contac.chatgpt.site/) remains
live with the current installer and a footer link to the new address. Its Sites
version 6 uses source `8115b0ce4df3076adcdc7858b610d962b639eee7`; deployment
`appgdep_6aed67e9ada481918a868d5294510c1c` succeeded. Version 5 was saved but
never deployed. Previous site versions and release `v0.4.9` remain for rollback.

## Follow-ups

- The primary website and README use [the short download URL](https://metafor.pages.dev/download).
  Cloudflare `_redirects` sends `/download` and `/download/` directly to the
  current GitHub-hosted installer with HTTP 302; no GitHub page is opened.
  An actual short-link download matched the release checksum above.
- Progressive creation of branches and sections is awaiting the user's visual
  behavior confirmation. The existing scroll animation has not been changed.
