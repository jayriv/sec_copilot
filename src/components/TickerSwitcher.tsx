import { FormEvent, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { FilingKey } from "@/lib/types";

type Props = {
  initial: FilingKey;
  isLoading?: boolean;
  onSwitch: (next: FilingKey) => Promise<void>;
};

export const TickerSwitcher = ({ initial, isLoading = false, onSwitch }: Props) => {
  const [ticker, setTicker] = useState(initial.ticker);
  const [year, setYear] = useState(initial.year);
  const [formType, setFormType] = useState(initial.formType);

  useEffect(() => {
    setTicker(initial.ticker);
    setYear(initial.year);
    setFormType(initial.formType);
  }, [initial.ticker, initial.year, initial.formType]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSwitch({ ticker: ticker.toUpperCase(), year, formType: formType.toUpperCase() });
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
      <label className="sr-only" htmlFor="ticker-input">
        Ticker
      </label>
      <div className="flex items-center rounded-xl border border-violet-200/70 bg-white px-3 py-2 shadow-[0_4px_16px_-6px_rgba(54,1,63,0.22)] ring-1 ring-violet-100/50 transition hover:shadow-[0_6px_20px_-6px_rgba(54,1,63,0.28)]">
        <Search size={16} className="mr-2 text-violet-500/70" />
        <input
          id="ticker-input"
          className="w-24 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
          value={ticker}
          disabled={isLoading}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="AAPL"
        />
      </div>
      <input
        className="rounded-xl border border-violet-200/70 bg-white px-3 py-2 text-sm text-slate-900 shadow-[0_4px_16px_-6px_rgba(54,1,63,0.22)] outline-none ring-1 ring-violet-100/50 transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-300/40 hover:shadow-[0_6px_20px_-6px_rgba(54,1,63,0.28)]"
        value={year}
        disabled={isLoading}
        onChange={(e) => setYear(e.target.value)}
        placeholder="2024"
      />
      <input
        className="rounded-xl border border-violet-200/70 bg-white px-3 py-2 text-sm text-slate-900 shadow-[0_4px_16px_-6px_rgba(54,1,63,0.22)] outline-none ring-1 ring-violet-100/50 transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-300/40 hover:shadow-[0_6px_20px_-6px_rgba(54,1,63,0.28)]"
        value={formType}
        disabled={isLoading}
        onChange={(e) => setFormType(e.target.value)}
        placeholder="10-K"
      />
      <button
        disabled={isLoading}
        className="rounded-xl bg-[#36013F] px-4 py-2 text-sm font-medium text-white shadow-[0_6px_18px_-6px_rgba(54,1,63,0.45)] transition hover:bg-violet-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? "Loading..." : "Open"}
      </button>
    </form>
  );
};
