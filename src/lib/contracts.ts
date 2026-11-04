import type { Conversation, SourceReference } from "./model";

export type RoutingMode = "auto" | "branch" | "continue";

export type AnswerRequest = {
  requestId: string;
  conversation: Conversation;
  activeId: string;
  question: string;
  selection: SourceReference | null;
  mode: RoutingMode;
  includeIds: string[];
};

export type ContextRecord = {
  fullIds: string[];
  summaryIds: string[];
  truncated: boolean;
};

export type AnswerResult = {
  requestId: string;
  decision: "branch" | "continue";
  reason: string;
  title: string;
  summary: string;
  sections: { title: string; body: string }[];
  related: { targetId: string; reason: string }[];
  context: ContextRecord;
  model: string;
};

export type ModelStatus = {
  configured: boolean;
  model: string;
  accessCodeRequired: boolean;
};
