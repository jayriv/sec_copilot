/** LiteLLM unified model ids (provider/model). Default matches server. */
export const DEFAULT_LLM_MODEL = "openai/gpt-4";

export const LLM_MODEL_STORAGE_KEY = "sec-copilot-llm-model";

export type LlmOption = { id: string; label: string };

export const LLM_MODEL_GROUPS: { group: string; options: LlmOption[] }[] = [
  {
    group: "OpenAI",
    options: [
      { id: "openai/gpt-4", label: "GPT-4" },
      { id: "openai/gpt-4o", label: "GPT-4o" },
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini" }
    ]
  },
  {
    group: "Anthropic",
    options: [
      { id: "anthropic/claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
      { id: "anthropic/claude-3-opus-20240229", label: "Claude 3 Opus" }
    ]
  },
  {
    group: "Google",
    options: [
      { id: "gemini/gemini-1.5-pro", label: "Gemini 1.5 Pro" },
      { id: "gemini/gemini-1.5-flash", label: "Gemini 1.5 Flash" }
    ]
  }
];

const allIds = new Set(LLM_MODEL_GROUPS.flatMap((g) => g.options.map((o) => o.id)));

export function isKnownLlmModel(id: string): boolean {
  return allIds.has(id);
}
