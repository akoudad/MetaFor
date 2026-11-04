import { useState } from "react";
import type { Conversation, Exploration, Message, SourceReference } from "@/lib/model";
import { getDepth, getSectionChildren } from "@/lib/model";
import AnswerBody from "./AnswerBody";

type TopicCardProps = {
  space: Conversation;
  item: Exploration;
  active: boolean;
  selection: SourceReference | null;
  pendingQuestion?: string;
  pendingError?: string;
  canReroute?: string;
  readingRef: (element: HTMLDivElement | null) => void;
  onScroll: (top: number) => void;
  onFocus: () => void;
  onHover: (id: string | null) => void;
  onSelect: (source: SourceReference) => void;
  onOpen: (id: string) => void;
  onSource: (source: SourceReference) => void;
  onReroute: () => void;
  onRetry: () => void;
  onCancel: () => void;
};

export default function TopicCard(props: TopicCardProps) {
  const { space, item, active, selection } = props;
  const [contextMessage, setContextMessage] = useState<string | null>(null);
  const [outline, setOutline] = useState(false);
  const answers = item.messages.filter((message) => message.role === "assistant");
  const sections = answers.flatMap((message) => message.sections);

  const scrollTo = (id: string, button: HTMLButtonElement) => {
    const article = button.closest("article");
    const reader = article?.querySelector<HTMLDivElement>(".topic-reading");
    const section = reader?.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(id)}"]`);
    if (reader && section) {
      const scale = reader.getBoundingClientRect().height / reader.offsetHeight;
      reader.scrollTop += (section.getBoundingClientRect().top - reader.getBoundingClientRect().top) / scale - 12;
    }
    setOutline(false);
  };

  const metadata = (message: Message) => <div className="answer-meta" data-no-selection>
    {message.routing && <span title={message.routing.reason}>{message.routing.decision === "branch" ? "Opened a branch" : "Continued here"}</span>}
    {props.canReroute === message.requestId && <button onClick={props.onReroute}>{item.parentId && item.messages.length === 2 ? "Keep in parent" : "Open as branch"}</button>}
    {message.context && <button onClick={() => setContextMessage(contextMessage === message.id ? null : message.id)}>Context</button>}
    {contextMessage === message.id && message.context && <div className="context-details">
      <p>{message.routing?.reason}</p>
      <p>Included: {message.context.fullIds.map((id) => space.explorations[id]?.title ?? id).join(", ") || "Your question"}.</p>
      {message.context.summaryIds.length > 0 && <p>Summaries: {message.context.summaryIds.map((id) => space.explorations[id]?.title ?? id).join(", ")}.</p>}
      {message.context.truncated && <p>Older material was shortened to fit this request.</p>}
      <p>{message.model}</p>
    </div>}
  </div>;

  return <article className={`topic ${active ? "is-focused" : ""}`} data-topic={item.id} aria-label={item.title} onPointerEnter={() => props.onHover(item.id)} onPointerLeave={() => props.onHover(null)}>
    <div className="topic-header">
      <span className="topic-index">{String(getDepth(space, item.id)).padStart(2, "0")}</span>
      <h2><button onClick={props.onFocus} aria-label={`Enter ${item.title}`}>{item.title}</button></h2>
      <button className="topic-move" data-move-topic={item.id} aria-label={`Move ${item.title}`} title="Drag to move this topic">⠿</button>
      <button className="topic-enter" onClick={props.onFocus} aria-label={`Focus ${item.title}`}>↗</button>
    </div>
    <p className="topic-summary">{item.summary}</p>
    <div className="topic-reading" ref={props.readingRef} onScroll={(event) => props.onScroll(event.currentTarget.scrollTop)} tabIndex={0} aria-label={`Read ${item.title}`}>
      {sections.length > 3 && <div className="topic-outline" data-no-selection>
        <button onClick={() => setOutline(!outline)} aria-expanded={outline}>In this topic <span>{sections.length} sections</span></button>
        {outline && <div>{sections.map((section) => <button key={section.id} onClick={(event) => scrollTo(section.id, event.currentTarget)}>{section.title || "Answer"}</button>)}</div>}
      </div>}
      {item.source && <blockquote className="source-quote" data-no-selection><button onClick={() => props.onSource(item.source!)}>From {space.explorations[item.source.explorationId]?.title} ↗</button>{item.source.quote && <p>{item.source.quote}</p>}</blockquote>}
      {item.messages.map((message) => message.role === "user" ? <div key={message.id}>
        {message.source?.quote && message.source.quote !== item.source?.quote && <blockquote className="source-quote"><button onClick={() => props.onSource(message.source!)}>Selected passage ↗</button><p>{message.source.quote}</p></blockquote>}
        <p className="original-question">{message.sections.map((section) => section.body).join("\n\n")}</p>
      </div> : <div className="assistant-message" key={message.id}>
        <div data-message-id={message.id} data-exploration-id={item.id}>
          {message.sections.map((section) => <section className={`answer-section ${selection?.messageId === message.id && selection.sectionId === section.id ? "selected" : ""}`} data-section-id={section.id} key={section.id}>
            {section.title && <h3><span>{section.title}</span><button className="section-ask" aria-label={`Ask about ${section.title}`} data-no-selection onClick={() => props.onSelect({ explorationId: item.id, messageId: message.id, sectionId: section.id })}>↗</button></h3>}
            <AnswerBody text={section.body} />
          </section>)}
        </div>
        {message.sections.flatMap((section) => getSectionChildren(space, section.id)).map((child) => <button className="branch-link" key={child.id} onClick={() => props.onOpen(child.id)}>{child.title} <span>↗</span></button>)}
        {metadata(message)}
      </div>)}
      {props.pendingQuestion && <div className="pending-answer" role="status">
        <p className="original-question">{props.pendingQuestion}</p>
        {props.pendingError ? <><p>{props.pendingError}</p><button onClick={props.onRetry}>Retry</button><button onClick={props.onCancel}>Dismiss</button></> : <><p className="thinking">Working on your question<span>…</span></p><button onClick={props.onCancel}>Stop</button></>}
      </div>}
      {!item.messages.length && !props.pendingQuestion && <p className="empty-topic">Ask your first question below.</p>}
    </div>
  </article>;
}
