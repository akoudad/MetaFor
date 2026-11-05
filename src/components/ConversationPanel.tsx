import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { Conversation, SourceReference } from "@/lib/model";
import AnswerBody from "./AnswerBody";
import { conversationTranscript } from "./conversation-transcript";

type Props = {
  space: Conversation;
  activeId: string;
  onNavigate: (source: SourceReference) => void;
  onInteraction?: () => void;
};

export default function ConversationPanel({ space, activeId, onNavigate, onInteraction }: Props) {
  const previous = useRef<{ id: string; order: string[] } | null>(null);
  const turns = useMemo(() => conversationTranscript(space, previous.current?.id === space.id ? previous.current.order : []), [space]);
  useEffect(() => { previous.current = { id: space.id, order: turns.map((turn) => turn.id) }; }, [space.id, turns]);
  const reader = useRef<HTMLDivElement>(null);
  const followEnd = useRef(true);
  const position = useRef(0);
  const conversationId = useRef(space.id);
  useLayoutEffect(() => {
    if (conversationId.current !== space.id) { conversationId.current = space.id; followEnd.current = true; position.current = 0; }
    if (reader.current) reader.current.scrollTop = followEnd.current ? reader.current.scrollHeight : position.current;
  }, [turns, space.id]);

  return <section className="conversation-panel" aria-label="Conversation" onPointerDown={onInteraction} onWheel={onInteraction} onKeyDown={onInteraction}>
    <div className="conversation-panel-heading">
      <span>Conversation</span><span className="conversation-turn-count">{turns.length}</span>
    </div>
    <div id="conversation-reader" className="conversation-reader" ref={reader} tabIndex={0} aria-label="Conversation messages" onScroll={(event) => {
      const element = event.currentTarget; position.current = element.scrollTop;
      followEnd.current = element.scrollHeight - element.clientHeight - element.scrollTop < 48;
    }}>
      <p className="conversation-reader-hint">Click an answer to find it in the graph.</p>
      {turns.map((turn) => <article className="conversation-turn" key={turn.id}>
        {turn.questions.map(({ topicId, message }) => <div className="conversation-question" key={`${topicId}:${message.id}`}>
          <span className="conversation-speaker">You</span>
          {message.source?.quote && <blockquote>{message.source.quote}</blockquote>}
          {message.sections.map((section) => <div key={section.id}>{section.title && <h3>{section.title}</h3>}<AnswerBody text={section.body} /></div>)}
        </div>)}
        {turn.answers.map(({ topicId, topicTitle, message }) => <div className="conversation-answer" key={`${topicId}:${message.id}`} data-active={topicId === activeId || undefined}>
          <div className="conversation-answer-heading"><span className="conversation-speaker">metafor</span><span>{topicTitle}</span></div>
          {message.sections.map((section) => {
            const source = { explorationId: topicId, messageId: message.id, sectionId: section.id };
            return <section className="conversation-answer-part" key={section.id} data-transcript-section={section.id} onClick={(event) => {
              if (event.defaultPrevented || event.detail > 1 || (event.target as HTMLElement).closest("a, button, input, textarea, select") || !window.getSelection()?.isCollapsed) return;
              onNavigate(source);
            }}>
              <div className="conversation-part-heading">{section.title && <h3>{section.title}</h3>}<button type="button" onClick={() => onNavigate(source)} aria-label={`Show ${section.title || topicTitle} in conversation graph`} title="Show in conversation graph">↗</button></div>
              <AnswerBody text={section.body} />
            </section>;
          })}
        </div>)}
      </article>)}
    </div>
  </section>;
}
