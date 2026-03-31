import { FilingKey } from "@/lib/types";

type Props = {
  items: FilingKey[];
  onPick: (item: FilingKey) => void;
};

export const RecentResearch = ({ items, onPick }: Props) => {
  return (
    <aside className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent Research</h2>
      <div className="space-y-2">
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
    </aside>
  );
};
