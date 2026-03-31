import { FilingKey, StoredSession } from "@/lib/types";

const PREFIX = "sec-copilot";
const RECENTS_KEY = `${PREFIX}:recents`;

export const toSessionKey = ({ ticker, year, formType }: FilingKey): string =>
  `${PREFIX}:${ticker.toUpperCase()}:${year}:${formType.toUpperCase()}`;

export const loadSession = (key: FilingKey): StoredSession | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(toSessionKey(key));
  return raw ? (JSON.parse(raw) as StoredSession) : null;
};

export const saveSession = (session: StoredSession): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(toSessionKey(session.filingKey), JSON.stringify(session));
  pushRecent(session.filingKey);
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
