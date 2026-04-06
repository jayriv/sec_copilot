import { FilingKey, StoredSession } from "@/lib/types";

const PREFIX = "sec-copilot";
const RECENTS_KEY = `${PREFIX}:recents`;
const LAST_ACTIVE_FILING_KEY = `${PREFIX}:last-active-filing`;

function isFilingKey(value: unknown): value is FilingKey {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.ticker === "string" &&
    typeof o.year === "string" &&
    typeof o.formType === "string"
  );
}

/** Remember which ticker/year/form session to restore after refresh (per-browser). */
export const saveLastActiveFilingKey = (key: FilingKey): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_ACTIVE_FILING_KEY, JSON.stringify(key));
  } catch {
    /* ignore quota */
  }
};

export const loadLastActiveFilingKey = (): FilingKey | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_ACTIVE_FILING_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isFilingKey(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const toSessionKey = ({ ticker, year, formType }: FilingKey): string =>
  `${PREFIX}:${ticker.toUpperCase()}:${year}:${formType.toUpperCase()}`;

export const loadSession = (key: FilingKey): StoredSession | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(toSessionKey(key));
  return raw ? (JSON.parse(raw) as StoredSession) : null;
};

export const saveSession = (session: StoredSession): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(toSessionKey(session.filingKey), JSON.stringify(session));
    saveLastActiveFilingKey(session.filingKey);
    pushRecent(session.filingKey);
  } catch {
    /* ignore quota / private mode */
  }
};

export const pushRecent = (filingKey: FilingKey): void => {
  if (typeof window === "undefined") return;
  const current = loadRecents();
  const next = [
    filingKey,
    ...current.filter(
      (item) =>
        !(
          item.ticker === filingKey.ticker &&
          item.year === filingKey.year &&
          item.formType === filingKey.formType
        )
    )
  ].slice(0, 12);
  window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
};

export const loadRecents = (): FilingKey[] => {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(RECENTS_KEY);
  return raw ? (JSON.parse(raw) as FilingKey[]) : [];
};
