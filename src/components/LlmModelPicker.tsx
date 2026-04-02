import { LLM_MODEL_GROUPS, type LlmOption } from "@/lib/llmCatalog";

type Props = {
  value: string;
  onChange: (modelId: string) => void;
};

export const LlmModelPicker = ({ value, onChange }: Props) => {
  return (
    <label className="flex flex-col gap-1 text-right">
      <span className="text-[0.65rem] font-medium uppercase tracking-wide text-violet-950/55">
        Chat model
      </span>
      <select
        className="max-w-[min(18rem,42vw)] rounded-lg border border-violet-200/90 bg-white px-2 py-1.5 text-xs text-slate-800 shadow-[0_2px_10px_-4px_rgba(54,1,63,0.18)] outline-none transition hover:border-violet-300 focus:border-violet-400 focus:ring-2 focus:ring-violet-300/40"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title="Model used for Copilot chat (LiteLLM). Set API keys on the server."
      >
        {LLM_MODEL_GROUPS.map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.options.map((o: LlmOption) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
};
