import { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Полноэкранная галерея фотографий (Lightbox).
 * Пропсы: photos (массив URL), initialIndex, onClose.
 * Управление: кнопки влево/вправо, миниатюры снизу, клавиши ArrowLeft / ArrowRight / Escape.
 */
export default function PhotoLightbox({ photos = [], initialIndex = 0, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(() =>
    Math.max(0, Math.min(initialIndex, photos.length - 1)),
  );

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => (i <= 0 ? photos.length - 1 : i - 1));
  }, [photos.length]);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => (i >= photos.length - 1 ? 0 : i + 1));
  }, [photos.length]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, goPrev, goNext]);

  useEffect(() => {
    setCurrentIndex((i) => Math.max(0, Math.min(i, photos.length - 1)));
  }, [photos.length]);

  if (photos.length === 0) return null;

  const currentUrl = photos[currentIndex];

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-black/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Галерея фотографий"
    >
      {/* Верхняя панель: кнопка закрытия */}
      <div className="flex shrink-0 justify-end p-4">
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          aria-label="Закрыть"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Центр: главное фото + стрелки */}
      <div className="relative flex flex-1 items-center justify-center px-4 py-2">
        <button
          type="button"
          onClick={goPrev}
          className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 sm:left-4"
          aria-label="Предыдущее фото"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        <img
          src={currentUrl}
          alt=""
          className="max-h-[70vh] w-auto object-contain select-none"
          draggable={false}
        />

        <button
          type="button"
          onClick={goNext}
          className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 sm:right-4"
          aria-label="Следующее фото"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      {/* Счётчик */}
      <div className="shrink-0 py-2 text-center text-sm text-white/90">
        {currentIndex + 1} / {photos.length}
      </div>

      {/* Лента миниатюр */}
      <div className="shrink-0 overflow-x-auto p-4">
        <div className="flex gap-2 justify-start sm:justify-center">
          {photos.map((url, i) => (
            <button
              key={`${url}-${i}`}
              type="button"
              onClick={() => setCurrentIndex(i)}
              className={`h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-md border-2 object-cover transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${
                i === currentIndex
                  ? 'border-white opacity-100'
                  : 'border-transparent opacity-50 hover:opacity-100'
              }`}
            >
              <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
