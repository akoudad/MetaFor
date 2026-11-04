import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Message } from "./model";

type TextNode = { type: string; value?: string; alt?: string; children?: TextNode[] };
const parser = unified().use(remarkParse).use(remarkGfm);

function textOf(node: TextNode): string {
  if (node.type === "html" || node.type === "definition") return "";
  if (node.type === "image") return node.alt ?? "";
  if (node.type === "break") return "\n";
  if (typeof node.value === "string") return node.value;
  const separator = ["root", "list", "listItem", "table", "tableRow", "blockquote"].includes(node.type) ? "\n" : "";
  return node.children?.map(textOf).join(separator) ?? "";
}

export function markdownToText(value: string): string {
  return textOf(parser.parse(value) as TextNode);
}

export function messageText(message: Message): string {
  return message.sections.map((section) => `${section.title}\n${markdownToText(section.body)}`).join("\n\n");
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
