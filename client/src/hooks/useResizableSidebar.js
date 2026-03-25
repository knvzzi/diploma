import { useState, useRef, useCallback, useEffect } from 'react';

const DEFAULT_MIN = 320;
const DEFAULT_MAX = 800;
const DEFAULT_INITIAL = 400;

/**
 * Хук для ресайза левой панели (сайдбара).
 * Возвращает ширину, стили контейнера и обработчик mousedown для ползунка.
 * При изменении ширины по окончании перетаскивания вызывается onResizeEnd (например, map.invalidateSize()).
 *
 * @param {Object} options
 * @param {number} [options.initialWidth=400] — начальная ширина в px
 * @param {number} [options.minWidth=320] — минимум px
 * @param {number} [options.maxWidth=800] — максимум px (можно заменить на 50vw логикой в обработчике)
 */
export function useResizableSidebar(options = {}) {
  const {
    initialWidth = DEFAULT_INITIAL,
    minWidth = DEFAULT_MIN,
    maxWidth = DEFAULT_MAX,
    onResizeEnd,
  } = options;

  const [sidebarWidth, setSidebarWidth] = useState(initialWidth);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(initialWidth);

  useEffect(() => {
    if (!isDragging) return;

    const maxW = typeof maxWidth === 'number'
      ? maxWidth
      : Math.min(800, Math.floor(window.innerWidth * 0.5));

    const handleMove = (e) => {
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.min(maxW, Math.max(minWidth, startWidthRef.current + delta));
      setSidebarWidth(newWidth);
    };

    const handleUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      onResizeEnd?.();
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging, minWidth, maxWidth, onResizeEnd]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
    setIsDragging(true);
  }, [sidebarWidth]);

  return {
    sidebarWidth,
    sidebarStyle: { width: sidebarWidth, flexShrink: 0 },
    handleMouseDown,
  };
}
