# Conversation reader

The **Conversation** panel stays visible above **Conversation map**, at the same
narrow width. It provides a classic, independently scrollable view of saved
questions and answers using full message sections. One request split across
several topics shows its question once and then every answer part. Separate
annotation questions keep their selected text.

Click an answer section, or its ↗ button, to reveal that section in the graph.
Selecting text and opening links do not navigate. The panel stays open and keeps
its scroll position while you explore the graph. New answers follow the bottom
only if you were already there; otherwise your reading position stays unchanged.

The reader retains observed turn order while the conversation is open. Existing
files have no global turn timestamps, so reopening reconstructs order from each
topic's message sequence, request IDs, source passages, and saved context. An
ambiguous order between independent older branches stays deterministic; exact
historical order cannot always be recovered. No stored messages are rewritten.

The graph and navigation controls reserve the composer's measured height,
including model choice, notices, and annotation drafts. An open model menu sits
above graph controls and the reader; its contents scroll in short windows.
Topic detail thresholds also adapt to viewport height, so jumping to an answer
in a short window opens its full reader instead of leaving a summary card.
