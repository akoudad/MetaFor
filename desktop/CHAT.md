# Chat integration

The desktop renderer bundles the existing React and Three.js conversation view. It does not load a hosted website. The web checkout is unchanged.

- A narrow fetch adapter routes `/api/status` and `/api/answer` to the main process. Model keys stay outside the renderer. Cancelling a question also cancels native provider work.
- Chat keeps the existing `.ingx` schema, local history, topic graph, reading positions, and annotation drafts. Browser conversations can be moved through **Open .ingx**; browser profiles are not read automatically.
- Native file imports receive a fresh conversation ID before reaching Chat, including files exported from Help. This preserves the imported graph without attaching a crop by a coincidentally matching ID. Only internal **Continue in Chat** preserves the Help identity and source link.
- **Continue in Chat** converts a Help exchange into a validated `.ingx` snapshot. Its conversation ID remains the Help session ID, linking it to the original captured source in the private desktop store.
- User messages retain their visual annotation IDs, labels, kinds, and normalized coordinates as a bounded text section. Follow-ups can refer to those original marks; screenshot bytes remain outside `.ingx`.
- The current Chat is saved before a Help exchange opens. Reopening the same Help exchange adds unseen messages and preserves branches, drafts, and reading positions already created in Chat. Changed messages cause a visible error instead of overwriting saved work.
- **Shared source** opens the original image, application/window name, and capture time beside Chat. A selector shows the annotations from each exchange. The source is a snapshot, not a continuing screen share.
- The collapsed source control states that follow-ups send the saved crop. Source state refreshes when Chat regains focus, becomes visible, or receives a Help update. A deleted source disappears and the chat explicitly continues with text only. Visual marks use the source image's aspect ratio, including arrows with signed offsets.
- Plain `.ingx` exports contain the transcript and source metadata, not screenshot bytes. The original image remains in the desktop Help store.

`desktop/tests/chat-transfer.test.ts` covers provenance, valid exports, repeat imports, branch/draft preservation, and changed-message rejection. `desktop/tests/chat-fetch.test.ts` covers API isolation, cancellation, and error propagation. `desktop/tests/chat-ui.test.tsx` verifies draft preservation, waiting for an active answer before opening Help, malformed-import recovery, and model-status refresh. The existing UI tests continue to exercise scrolling, branching, and text annotations.

`desktop/tests/shared-source-ui.test.tsx` covers deleted/unreadable source recovery, preserving an open panel during refresh, crop-reuse disclosure, annotation geometry, and stale lookups after a conversation switch.
