import { DEFAULT_SYSTEM_PROMPT } from "@/lib/defaultSystemPrompt";

export const COPILOT_CURRENT_CONTEXT_MAX_KEY = "sec-copilot-current-context-max-chars";
export const COPILOT_ADDITIONAL_CONTEXT_MAX_KEY = "sec-copilot-additional-context-max-chars";
/** Saved textarea content (draft); may be the built-in default text for editing. */
export const COPILOT_SYSTEM_PROMPT_DRAFT_KEY = "sec-copilot-system-prompt-override";
export const COPILOT_USE_CUSTOM_SYSTEM_PROMPT_KEY = "sec-copilot-use-custom-system-prompt";

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

/**
 * Whether chat requests should send `system_prompt` from the saved draft.
 * Legacy: if draft key exists with non-empty text but the toggle key was never set, treat as true.
 */
export function loadUseCustomSystemPrompt(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const toggle = window.localStorage.getItem(COPILOT_USE_CUSTOM_SYSTEM_PROMPT_KEY);
    if (toggle === "1" || toggle === "true") return true;
    if (toggle === "0" || toggle === "false") return false;
    const draft = window.localStorage.getItem(COPILOT_SYSTEM_PROMPT_DRAFT_KEY);
    if (draft != null && draft.trim() !== "") return true;
    return false;
  } catch {
    return false;
  }
}

export function persistUseCustomSystemPrompt(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COPILOT_USE_CUSTOM_SYSTEM_PROMPT_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Text shown in admin / used when "use custom" is on. `null` key → show built-in default. */
export function loadSystemPromptDraftForEdit(): string {
  if (typeof window === "undefined") return DEFAULT_SYSTEM_PROMPT;
  try {
    const raw = window.localStorage.getItem(COPILOT_SYSTEM_PROMPT_DRAFT_KEY);
    if (raw === null) return DEFAULT_SYSTEM_PROMPT;
    return raw;
  } catch {
    return DEFAULT_SYSTEM_PROMPT;
  }
}

export function persistSystemPromptDraft(text: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COPILOT_SYSTEM_PROMPT_DRAFT_KEY, text);
  } catch {
    /* ignore */
  }
}

/**
 * Value to send on `/chat` when "use custom prompt" is on and a draft has been saved.
 * If the toggle is on but the draft key was never written, returns null (server default).
 */
export function getEffectiveSystemPromptForRequest(): string | null {
  if (typeof window === "undefined") return null;
  if (!loadUseCustomSystemPrompt()) return null;
  try {
    const raw = window.localStorage.getItem(COPILOT_SYSTEM_PROMPT_DRAFT_KEY);
    if (raw === null) return null;
    const text = raw.trim();
    return text || null;
  } catch {
    return null;
  }
}
