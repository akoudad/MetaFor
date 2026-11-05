import type { Message } from "../src/lib/model";
import { parseSnapshot, serializeSnapshot } from "../src/lib/storage";
import type { Snapshot } from "../src/lib/storage";
import type { HelpSession } from "./shared";
import { validateMarks } from "./help-model";

/** The same ID connects Chat to the private, locally stored Help source. */
export function snapshotFromHelp(session: HelpSession): Snapshot {
  const firstQuestion = session.messages.find((message) => message.role === "user")?.id;
  const messages: Message[] = session.messages.map((message) => {
    const id = `help-message-${message.id}`;
    const source = session.source;
    const sections = [{ id: `${id}-text`, title: "", body: message.text }];
    if (message.marks?.length) {
      const marks = validateMarks(message.marks);
      sections.push({
        id: `${id}-marks`, title: "Visual annotations",
        body: `These marks belong to this ${message.role === "user" ? "question" : "answer"} and the original shared image. Coordinates are normalized from 0 to 1, with the origin at the top left. Arrow width and height are signed offsets from the start to the tip.\n\n`
          + marks.map((mark, index) => `${index + 1}. ${JSON.stringify(mark)}`).join("\n"),
      });
    }
    if (message.id === firstQuestion && source) {
      sections.unshift({
        id: `${id}-source`, title: "Shared screen selection",
        body: `Application: ${source.appName}\n\nWindow: ${source.title}\n\nCaptured: ${source.capturedAt}\n\nSource ID: ${source.id}`,
      });
    }
    return { id, role: message.role, sections };
  });
  const snapshot: Snapshot = {
    format: "ingx", version: 1, savedAt: session.updatedAt,
    conversation: {
      id: session.id, title: session.title, kind: "live", rootId: "root", connections: [],
      explorations: {
        root: {
          id: "root", title: session.title,
          summary: session.messages.find((message) => message.role === "assistant")?.text.slice(0, 500) ?? "A conversation about a shared screen selection.",
          parentId: null, source: null, messages, position: [0, 0, 0],
        },
      },
    },
    view: {
      activeId: "root", view: { x: 0, y: 0, z: 900 }, overview: false,
      started: messages.length > 0, places: {}, history: [], positions: {},
    },
  };
  // Use the web importer as the authority; desktop transfers stay valid .ingx.
  return parseSnapshot(serializeSnapshot(snapshot));
}

/** Reopening Help must not overwrite work already continued in spatial Chat. */
export function mergeHelpSnapshot(existing: Snapshot | null, incoming: Snapshot): Snapshot {
  parseSnapshot(serializeSnapshot(incoming));
  if (!existing) return structuredClone(incoming);
  parseSnapshot(serializeSnapshot(existing));
  if (existing.conversation.id !== incoming.conversation.id) throw new Error("These conversations have different sources.");
  const rootId = existing.conversation.rootId;
  if (rootId !== incoming.conversation.rootId) throw new Error("The saved Help conversation has a different root.");
  const merged = structuredClone(existing);
  const known = new Map(Object.values(merged.conversation.explorations).flatMap((topic) => topic.messages.map((message) => [message.id, message] as const)));
  for (const message of incoming.conversation.explorations[rootId].messages) {
    const previous = known.get(message.id);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(message)) {
        // Older desktop imports did not retain visual marks. Enrich only an
        // otherwise identical message; never replace edited source text.
        const annotationId = `${message.id}-marks`;
        const annotations = message.sections.find((section) => section.id === annotationId && section.title === "Visual annotations");
        const withoutAnnotations = { ...message, sections: message.sections.filter((section) => section.id !== annotationId) };
        if (!annotations || JSON.stringify(previous) !== JSON.stringify(withoutAnnotations)) throw new Error("A Help message changed since it was saved. The existing chat has been kept.");
        previous.sections.push(structuredClone(annotations));
      }
      continue;
    }
    merged.conversation.explorations[rootId].messages.push(structuredClone(message));
  }
  merged.view.started ||= incoming.view.started;
  merged.savedAt = new Date(Math.max(Date.parse(existing.savedAt), Date.parse(incoming.savedAt))).toISOString();
  return parseSnapshot(serializeSnapshot(merged));
}
