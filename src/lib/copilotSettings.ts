export const COPILOT_CURRENT_CONTEXT_MAX_KEY = "sec-copilot-current-context-max-chars";
export const COPILOT_ADDITIONAL_CONTEXT_MAX_KEY = "sec-copilot-additional-context-max-chars";
export const COPILOT_SYSTEM_PROMPT_KEY = "sec-copilot-system-prompt-override";

/** Defaults match server env fallbacks in `llm_service.py`. */
export const DEFAULT_CURRENT_CONTEXT_MAX = 80_000;
export const DEFAULT_ADDITIONAL_CONTEXT_MAX = 60_000;

export const SLIDER_CURRENT_MIN = 5_000;
export const SLIDER_CURRENT_MAX = 120_000;
export const SLIDER_ADDITIONAL_MIN = 0;
export const SLIDER_ADDITIONAL_MAX = 80_000;

function readInt(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export function loadCurrentContextMax(): number {
  if (typeof window === "undefined") return DEFAULT_CURRENT_CONTEXT_MAX;
  const n = readInt(COPILOT_CURRENT_CONTEXT_MAX_KEY, DEFAULT_CURRENT_CONTEXT_MAX);
  return Math.min(SLIDER_CURRENT_MAX, Math.max(SLIDER_CURRENT_MIN, n));
}

export function loadAdditionalContextMax(): number {
  if (typeof window === "undefined") return DEFAULT_ADDITIONAL_CONTEXT_MAX;
  const n = readInt(COPILOT_ADDITIONAL_CONTEXT_MAX_KEY, DEFAULT_ADDITIONAL_CONTEXT_MAX);
  return Math.min(SLIDER_ADDITIONAL_MAX, Math.max(SLIDER_ADDITIONAL_MIN, n));
}

export function persistCurrentContextMax(value: number): void {
  try {
    window.localStorage.setItem(COPILOT_CURRENT_CONTEXT_MAX_KEY, String(value));
  } catch {
    /* ignore */
  }
}

export function persistAdditionalContextMax(value: number): void {
  try {
    window.localStorage.setItem(COPILOT_ADDITIONAL_CONTEXT_MAX_KEY, String(value));
  } catch {
    /* ignore */
  }
}

/** Empty string means "use server default" (no override). */
export function loadSystemPromptOverride(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(COPILOT_SYSTEM_PROMPT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function persistSystemPromptOverride(text: string): void {
  if (typeof window === "undefined") return;
  try {
    if (!text.trim()) {
      window.localStorage.removeItem(COPILOT_SYSTEM_PROMPT_KEY);
    } else {
      window.localStorage.setItem(COPILOT_SYSTEM_PROMPT_KEY, text);
    }
  } catch {
    /* ignore */
  }
}
