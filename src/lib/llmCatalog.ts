/** LiteLLM unified model ids (provider/model). Default matches server. */

/**
 * Measured on the agent loop with a three-part question (concept + figure +
 * policy). Cost is per whole question, including every tool turn:
 *
 *   gpt-5.4-mini  $0.004   3.7s  cites correctly, facts correct   <- default
 *   gpt-5.4       $0.016   4.1s  correct, no measured gain
 *   gpt-4o        $0.019   6.1s  correct but slowest
 *   gpt-4o-mini   $0.001   5.5s  drops the required inline citations
 *   gpt-4         $0.635  80.2s  wrong facts, no citations, and past the 60s
 *                                vercel.json maxDuration - delisted below
 *
 * Keep in sync with DEFAULT_MODEL in server/llm_service.py.
 */
export const DEFAULT_LLM_MODEL = "openai/gpt-5.4-mini";

export const LLM_MODEL_STORAGE_KEY = "sec-copilot-llm-model";

export type LlmOption = {
  id: string;
  label: string;
  /** Short note shown in the picker - value, or what the model needs. */
  price?: string;
};

/**
 * `gpt-4` is deliberately absent: in the agent loop it took 80s, past the
 * function timeout, at 150x the cost of gpt-5.4-mini for a worse answer. A
 * stored id that is no longer listed fails `isKnownLlmModel` and falls back to
 * the default, which quietly migrates anyone still pinned to it.
 */
export const LLM_MODEL_GROUPS: { group: string; options: LlmOption[] }[] = [
  {
    group: "OpenAI",
    options: [
      { id: "openai/gpt-5.4-mini", label: "GPT-5.4 mini", price: "best value" },
      { id: "openai/gpt-5.4", label: "GPT-5.4" },
      { id: "openai/gpt-4o", label: "GPT-4o" },
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini", price: "omits citations" }
    ]
  },
  {
    group: "Anthropic",
    options: [
      {
        id: "anthropic/claude-sonnet-5",
        label: "Claude Sonnet 5",
        price: "needs ANTHROPIC_API_KEY"
      },
      { id: "anthropic/claude-opus-5", label: "Claude Opus 5", price: "needs ANTHROPIC_API_KEY" },
      {
        id: "anthropic/claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        price: "needs ANTHROPIC_API_KEY"
      }
    ]
  },
  {
    group: "Google",
    options: [
      { id: "gemini/gemini-1.5-pro", label: "Gemini 1.5 Pro", price: "needs GEMINI_API_KEY" },
      { id: "gemini/gemini-1.5-flash", label: "Gemini 1.5 Flash", price: "needs GEMINI_API_KEY" }
    ]
  }
];

const allIds = new Set(LLM_MODEL_GROUPS.flatMap((g) => g.options.map((o) => o.id)));

export function isKnownLlmModel(id: string): boolean {
  return allIds.has(id);
}
