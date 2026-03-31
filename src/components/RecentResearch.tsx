import { useState } from "react";
import { FilingKey } from "@/lib/types";

type Props = {
  items: FilingKey[];
  onPick: (item: FilingKey) => void;
};

export const RecentResearch = ({ items, onPick }: Props) => {
  const [open, setOpen] = useState(false);

  return (
    <aside className="shrink-0 overflow-hidden rounded-2xl border border-violet-100/80 bg-white/95 shadow-[0_6px_20px_-8px_rgba(54,1,63,0.18)] ring-1 ring-violet-100/60 transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_-10px_rgba(54,1,63,0.22)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-violet-50/60"
      >
        <span className="text-sm font-semibold text-violet-950">Recent Research</span>
        <span className="flex items-center gap-2 text-xs text-violet-800/70">
          {items.length > 0 && <span className="tabular-nums">{items.length}</span>}
          <svg
            className={`h-4 w-4 shrink-0 text-violet-500/80 transition-transform ${open ? "rotate-180" : ""}`}
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
        <div className="border-t border-violet-100/80 px-4 pb-4 pt-1">
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {items.map((item) => (
              <button
                key={`${item.ticker}-${item.year}-${item.formType}`}
                onClick={() => onPick(item)}
                className="block w-full rounded-lg px-2 py-2 text-left text-sm text-slate-700 transition hover:bg-violet-50 hover:text-violet-950"
              >
                {item.ticker} {item.formType} ({item.year})
              </button>
            ))}
            {items.length === 0 && <p className="text-xs text-violet-800/60">No recent filings yet.</p>}
          </div>
        </div>
      )}
    </aside>
  );
};
