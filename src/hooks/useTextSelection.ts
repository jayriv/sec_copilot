import { useCallback, useEffect, useState } from "react";

type SelectionState = {
  text: string;
  x: number;
  y: number;
  visible: boolean;
};

/** Viewport coordinates for position: fixed (works inside scrollable readers). */
function readSelectionInRoot(root: HTMLElement): SelectionState | null {
  const current = window.getSelection();
  if (!current || current.isCollapsed || !root.contains(current.anchorNode)) {
    return null;
  }

  const text = current.toString().trim();
  if (!text) return null;

  try {
    const range = current.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return {
      text,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
      visible: true
    };
  } catch {
    return null;
  }
}

export const useTextSelection = (targetId: string) => {
  const [selection, setSelection] = useState<SelectionState>({
    text: "",
    x: 0,
    y: 0,
    visible: false
  });

  const syncFromDom = useCallback(() => {
    const root = document.getElementById(targetId);
    if (!root) {
      setSelection((prev) => ({ ...prev, visible: false, text: "" }));
      return;
    }
    const next = readSelectionInRoot(root as HTMLElement);
    if (!next) {
      setSelection((prev) => ({ ...prev, visible: false, text: "" }));
      return;
    }
    setSelection(next);
  }, [targetId]);

  useEffect(() => {
    const root = document.getElementById(targetId);
    const onMouseUp = () => requestAnimationFrame(syncFromDom);
    const onSelectionChange = () => requestAnimationFrame(syncFromDom);

    const onScroll = () => requestAnimationFrame(syncFromDom);

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("selectionchange", onSelectionChange);
    root?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      root?.removeEventListener("scroll", onScroll);
    };
  }, [targetId, syncFromDom]);

  const dismiss = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelection({ text: "", x: 0, y: 0, visible: false });
  }, []);

  return { selection, dismiss };
};
