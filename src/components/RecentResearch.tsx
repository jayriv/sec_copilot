import { useState } from "react";
import { FilingKey } from "@/lib/types";

type Props = {
  items: FilingKey[];
  onPick: (item: FilingKey) => void;
};

export const RecentResearch = ({ items, onPick }: Props) => {
  const [open, setOpen] = useState(false);

  return (
    <aside className="shrink-0 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
      >
        <span className="text-sm font-semibold text-slate-900">Recent Research</span>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          {items.length > 0 && <span className="tabular-nums">{items.length}</span>}
          <svg
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.24 4.5a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-1">
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {items.map((item) => (
              <button
                key={`${item.ticker}-${item.year}-${item.formType}`}
                onClick={() => onPick(item)}
                className="block w-full rounded-md px-2 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {item.ticker} {item.formType} ({item.year})
              </button>
            ))}
            {items.length === 0 && <p className="text-xs text-slate-500">No recent filings yet.</p>}
          </div>
        </div>
      )}
    </aside>
  );
};
