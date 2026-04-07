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
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="ticker-input">
        Ticker
      </label>
      <div className="flex items-center rounded-lg border border-violet-200/70 bg-white px-2 py-1.5 shadow-[0_3px_12px_-5px_rgba(54,1,63,0.2)] ring-1 ring-violet-100/50 transition hover:shadow-[0_4px_14px_-5px_rgba(54,1,63,0.24)]">
        <Search size={14} className="mr-1.5 text-violet-500/70" />
        <input
          id="ticker-input"
          className="w-[5.25rem] bg-transparent text-xs text-slate-900 outline-none placeholder:text-slate-400"
          value={ticker}
          disabled={isLoading}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="AAPL"
        />
      </div>
      <input
        className="w-16 rounded-lg border border-violet-200/70 bg-white px-2 py-1.5 text-xs text-slate-900 shadow-[0_3px_12px_-5px_rgba(54,1,63,0.2)] outline-none ring-1 ring-violet-100/50 transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-300/40 hover:shadow-[0_4px_14px_-5px_rgba(54,1,63,0.24)]"
        value={year}
        disabled={isLoading}
        onChange={(e) => setYear(e.target.value)}
        placeholder="2024"
      />
      <input
        className="w-[4.5rem] rounded-lg border border-violet-200/70 bg-white px-2 py-1.5 text-xs text-slate-900 shadow-[0_3px_12px_-5px_rgba(54,1,63,0.2)] outline-none ring-1 ring-violet-100/50 transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-300/40 hover:shadow-[0_4px_14px_-5px_rgba(54,1,63,0.24)]"
        value={formType}
        disabled={isLoading}
        onChange={(e) => setFormType(e.target.value)}
        placeholder="10-K"
      />
      <button
        disabled={isLoading}
        className="rounded-lg bg-[#36013F] px-3 py-1.5 text-xs font-medium text-white shadow-[0_4px_14px_-5px_rgba(54,1,63,0.4)] transition hover:bg-violet-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? "Loading..." : "Open"}
      </button>
    </form>
  );
};
