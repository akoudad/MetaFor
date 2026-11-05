import type { Conversation, SourceReference } from "./model";

export type RoutingMode = "auto" | "branch" | "continue";

export type AnnotationRequest = {
  id: string;
  source: SourceReference;
  question: string;
};

export type AnswerRequest = {
  requestId: string;
  conversation: Conversation;
  activeId: string;
  question: string;
  selection: SourceReference | null;
  mode: RoutingMode;
  includeIds: string[];
  annotations?: AnnotationRequest[];
};

export type ContextRecord = {
  fullIds: string[];
  summaryIds: string[];
  truncated: boolean;
};

export type TopicAnswer = {
  annotationId?: string;
  targetId: string;
  decision: "branch" | "continue";
  title: string;
  summary: string;
  sections: { title: string; body: string }[];
  sourceIds?: string[];
};

export type AnswerResult = {
  requestId: string;
  decision: "branch" | "continue";
  reason: string;
  title: string;
  summary: string;
  sections: { title: string; body: string }[];
  sourceIds?: string[];
  related: { targetId: string; reason: string }[];
  topics?: TopicAnswer[];
  context: ContextRecord;
  model: string;
};

export type ModelStatus = {
  configured: boolean;
  model: string;
  accessCodeRequired: boolean;
};
