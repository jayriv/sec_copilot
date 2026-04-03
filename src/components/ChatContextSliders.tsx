import {
  DEFAULT_ADDITIONAL_CONTEXT_MAX,
  DEFAULT_CURRENT_CONTEXT_MAX,
  SLIDER_ADDITIONAL_MAX,
  SLIDER_ADDITIONAL_MIN,
  SLIDER_CURRENT_MAX,
  SLIDER_CURRENT_MIN
} from "@/lib/copilotSettings";

type Props = {
  currentContextMax: number;
  additionalContextMax: number;
  onCurrentContextMaxChange: (value: number) => void;
  onAdditionalContextMaxChange: (value: number) => void;
};

export const ChatContextSliders = ({
  currentContextMax,
  additionalContextMax,
  onCurrentContextMaxChange,
  onAdditionalContextMaxChange
}: Props) => {
  return (
    <div className="mb-3 shrink-0 space-y-3 rounded-xl border border-violet-100/90 bg-violet-50/40 px-3 py-2.5 text-xs text-violet-950/90">
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="font-medium">Current filing context</span>
          <span className="tabular-nums text-violet-800/90">
            {currentContextMax.toLocaleString()} chars
          </span>
        </div>
        <input
          type="range"
          min={SLIDER_CURRENT_MIN}
          max={SLIDER_CURRENT_MAX}
          step={1000}
          value={currentContextMax}
          onChange={(e) => onCurrentContextMaxChange(Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-[#36013F]"
          aria-label="Maximum characters from current filing to send with each question"
        />
        <p className="mt-1 text-[0.65rem] leading-snug text-violet-900/70">
          Caps how much of the filing text is included (head + tail when truncated). Default{" "}
          {DEFAULT_CURRENT_CONTEXT_MAX.toLocaleString()}.
        </p>
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="font-medium">Additional context</span>
          <span className="tabular-nums text-violet-800/90">
            {additionalContextMax.toLocaleString()} chars
          </span>
        </div>
        <input
          type="range"
          min={SLIDER_ADDITIONAL_MIN}
          max={SLIDER_ADDITIONAL_MAX}
          step={1000}
          value={additionalContextMax}
          onChange={(e) => onAdditionalContextMaxChange(Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-[#36013F]"
          aria-label="Maximum characters for comparison or extra filing context"
        />
        <p className="mt-1 text-[0.65rem] leading-snug text-violet-900/70">
          Used when the app pulls a second filing for comparisons. Default{" "}
          {DEFAULT_ADDITIONAL_CONTEXT_MAX.toLocaleString()}.
        </p>
      </div>
    </div>
  );
};
