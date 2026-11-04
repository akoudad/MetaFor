import { createAnswerHandler } from "@/lib/provider";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = createAnswerHandler();
