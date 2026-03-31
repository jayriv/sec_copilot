import { useEffect, useState } from "react";

type SelectionState = {
  text: string;
  x: number;
  y: number;
  visible: boolean;
};

export const useTextSelection = (targetId: string) => {
  const [selection, setSelection] = useState<SelectionState>({
    text: "",
    x: 0,
    y: 0,
    visible: false
  });

  useEffect(() => {
    const onMouseUp = () => {
      const root = document.getElementById(targetId);
      const current = window.getSelection();
      if (!root || !current || current.isCollapsed) {
        setSelection((prev) => ({ ...prev, visible: false, text: "" }));
        return;
      }

      const range = current.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        setSelection((prev) => ({ ...prev, visible: false, text: "" }));
        return;
      }

      const rect = range.getBoundingClientRect();
      const text = current.toString().trim();
      setSelection({
        text,
        x: rect.left + rect.width / 2 + window.scrollX,
        y: rect.top + window.scrollY - 10,
        visible: text.length > 0
      });
    };

    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [targetId]);

  return selection;
};
