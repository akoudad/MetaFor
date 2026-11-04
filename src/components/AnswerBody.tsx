import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

function AnswerBody({ text }: { text: string }) {
  return <div className="answer-markdown"><Markdown
    remarkPlugins={[remarkGfm]}
    skipHtml
    components={{
      a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      img: ({ alt }) => <span>{alt}</span>,
      table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
    }}
  >{text}</Markdown></div>;
}

export default memo(AnswerBody);
