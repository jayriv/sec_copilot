/** LiteLLM unified model ids (provider/model). Default matches server. */

/**
 * Sonnet 5 ($2 / $10 per 1M tokens) is the default for user-facing answers:
 * strong enough for financial-statement reasoning without Opus pricing on a
 * student-facing app. Keep in sync with DEFAULT_MODEL in server/llm_service.py.
 */
export const DEFAULT_LLM_MODEL = "anthropic/claude-sonnet-5";

export const LLM_MODEL_STORAGE_KEY = "sec-copilot-llm-model";

export type LlmOption = {
  id: string;
  label: string;
  /** Rough input/output cost per 1M tokens, shown in the picker. */
  price?: string;
};

export const LLM_MODEL_GROUPS: { group: string; options: LlmOption[] }[] = [
  {
    group: "Anthropic",
    options: [
      { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", price: "$2 / $10" },
      { id: "anthropic/claude-opus-5", label: "Claude Opus 5", price: "$5 / $25" },
      { id: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", price: "$1 / $5" }
    ]
  },
  {
    group: "OpenAI",
    options: [
      { id: "openai/gpt-5.4", label: "GPT-5.4" },
      { id: "openai/gpt-5.4-mini", label: "GPT-5.4 mini" },
      { id: "openai/gpt-5.4-nano", label: "GPT-5.4 nano" },
      { id: "openai/gpt-4", label: "GPT-4" },
      { id: "openai/gpt-4o", label: "GPT-4o" },
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini" }
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
