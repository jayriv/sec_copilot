import { AgentStep } from "@/lib/types";

export type CoursewareCitationResponse = {
  id: string;
  citation: string;
  heading_path: string;
  source_id: string;
  lens?: string[];
  score: number;
};

export type ChatApiResponse = {
  answer: string;
  source_quote?: string;
  citations?: CoursewareCitationResponse[];
  lenses?: string[];
  mode?: "agent" | "single";
  trace?: AgentStep[];
  usage?: {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost_usd: number | null;
  } | null;
};

/** A tool call in flight, for the "what is it doing" line under the composer. */
export type ProgressStep = { tool: string; args: Record<string, unknown>; done: boolean };

async function errorFromResponse(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (body.detail !== undefined) {
      return typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    }
  } catch {
    /* keep default */
  }
  return "Chat request failed.";
}

/**
 * Ask the copilot, reporting tool progress as it happens.
 *
 * Tries the SSE endpoint first and falls back to plain POST /chat whenever
 * streaming is unavailable — an older browser with no `response.body`, a proxy
 * that buffers, or a deployment where the route is missing. The fallback
 * produces an identical result, just without the intermediate updates, so a
 * host that cannot stream degrades to exactly the previous behaviour.
 */
export async function askCopilot(
  baseUrl: string,
  payload: unknown,
  onProgress: (steps: ProgressStep[]) => void
): Promise<ChatApiResponse> {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  };

  let streamed: Response | null = null;
  try {
    streamed = await fetch(`${baseUrl}/chat/stream`, init);
  } catch {
    streamed = null;
  }

  if (streamed?.ok && streamed.body) {
    const result = await readStream(streamed.body, onProgress);
    if (result) return result;
    // Stream opened but never delivered a result — fall through rather than
    // leaving the student with nothing.
  } else if (streamed && !streamed.ok && streamed.status !== 404) {
    throw new Error(await errorFromResponse(streamed));
  }

  const response = await fetch(`${baseUrl}/chat`, init);
  if (!response.ok) throw new Error(await errorFromResponse(response));
  return (await response.json()) as ChatApiResponse;
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  onProgress: (steps: ProgressStep[]) => void
): Promise<ChatApiResponse | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const steps: ProgressStep[] = [];
  let buffer = "";
  let result: ChatApiResponse | null = null;
  let failure: string | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE records are separated by a blank line; keep any partial tail.
    const records = buffer.split("\n\n");
    buffer = records.pop() ?? "";

    for (const record of records) {
      const line = record.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line.slice(6)) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (event.type === "tool_start") {
        steps.push({
          tool: String(event.tool ?? ""),
          args: (event.args as Record<string, unknown>) ?? {},
          done: false
        });
        onProgress([...steps]);
      } else if (event.type === "tool_end") {
        const pending = [...steps].reverse().find((s) => s.tool === event.tool && !s.done);
        if (pending) pending.done = true;
        onProgress([...steps]);
      } else if (event.type === "done") {
        result = event as unknown as ChatApiResponse;
      } else if (event.type === "error") {
        failure = String(event.detail ?? "Chat request failed.");
      }
    }
  }

  if (failure) throw new Error(failure);
  return result;
}
