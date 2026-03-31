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
      <div className="flex items-center rounded-lg bg-white px-3 py-2 shadow-sm ring-1 ring-slate-200">
        <Search size={16} className="mr-2 text-slate-400" />
        <input
          id="ticker-input"
          className="w-24 bg-transparent text-sm outline-none"
          value={ticker}
          disabled={isLoading}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="AAPL"
        />
      </div>
      <input
        className="rounded-lg bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-200 outline-none"
        value={year}
        disabled={isLoading}
        onChange={(e) => setYear(e.target.value)}
        placeholder="2024"
      />
      <input
        className="rounded-lg bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-200 outline-none"
        value={formType}
        disabled={isLoading}
        onChange={(e) => setFormType(e.target.value)}
        placeholder="10-K"
      />
      <button
        disabled={isLoading}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? "Loading..." : "Open"}
      </button>
    </form>
  );
};
