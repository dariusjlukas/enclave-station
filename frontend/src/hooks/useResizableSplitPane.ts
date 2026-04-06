import { useState, useCallback, useEffect, useRef } from 'react';

interface UseResizableSplitPaneOptions {
  defaultTopPercent: number;
  minTopPercent: number;
  maxTopPercent: number;
  storageKey?: string;
}

export function useResizableSplitPane({
  defaultTopPercent,
  minTopPercent,
  maxTopPercent,
  storageKey,
}: UseResizableSplitPaneOptions) {
  const [topPercent, setTopPercent] = useState(() => {
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseFloat(stored);
        if (!isNaN(parsed))
          return Math.max(minTopPercent, Math.min(maxTopPercent, parsed));
      }
    }
    return defaultTopPercent;
  });
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const startPercentRef = useRef(0);
  const topPercentRef = useRef(topPercent);

  useEffect(() => {
    topPercentRef.current = topPercent;
  }, [topPercent]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startYRef.current = e.clientY;
    startPercentRef.current = topPercentRef.current;
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const containerHeight = container.getBoundingClientRect().height;
      if (containerHeight === 0) return;
      const deltaY = e.clientY - startYRef.current;
      const deltaPercent = (deltaY / containerHeight) * 100;
      const newPercent = startPercentRef.current + deltaPercent;
      setTopPercent(
        Math.max(minTopPercent, Math.min(maxTopPercent, newPercent)),
      );
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      if (storageKey) {
        localStorage.setItem(storageKey, String(topPercentRef.current));
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, minTopPercent, maxTopPercent, storageKey]);

  return { topPercent, isResizing, handleMouseDown, containerRef };
}
