/**
 * Переиспользуемая модалка QR-кода.
 *
 * Отображает QR-код для переданного URL и кнопку «Скопировать ссылку».
 * Используется на странице поиска (SearchRoutesPage) и в карточках профиля (ProfilePage).
 *
 * Props:
 *  - isOpen    {boolean}  — управляет видимостью модалки
 *  - onClose   {function} — вызывается при закрытии (клик по оверлею или крестику)
 *  - url       {string}   — URL, который будет закодирован в QR-код
 *  - title     {string}   — заголовок модалки (опционально)
 *  - description {string} — подпись под заголовком (опционально)
 */

import { useCallback } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { X, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';

export default function QrModal({
  isOpen,
  onClose,
  url,
  title = 'Открыть на телефоне',
  description = 'Отсканируйте QR-код камерой телефона, чтобы открыть этот маршрут',
}) {
  const handleCopyLink = useCallback(() => {
    if (!url) return;

    // Безопасный контекст (HTTPS) — используем Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(url)
        .then(() => toast.success('Ссылка скопирована'))
        .catch((err) => {
          console.error('[QrModal] Ошибка копирования:', err);
          toast.error('Не удалось скопировать ссылку');
        });
    } else {
      // Fallback для HTTP (без secure context): textarea + execCommand
      const textArea = document.createElement('textarea');
      textArea.value = url;
      textArea.style.position = 'absolute';
      textArea.style.left = '-999999px';
      document.body.prepend(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        toast.success('Ссылка скопирована');
      } catch (err) {
        console.error('[QrModal] Fallback копирование не удалось:', err);
        toast.error('Не удалось скопировать ссылку');
      } finally {
        textArea.remove();
      }
    }
  }, [url]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xs rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Кнопка закрытия */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
          title="Закрыть"
        >
          <X className="h-4 w-4" />
        </button>

        <h3 className="mb-1 pr-8 text-base font-semibold text-neutral-900">
          {title}
        </h3>
        <p className="mb-5 text-xs leading-relaxed text-neutral-500">
          {description}
        </p>

        {/* QR-код */}
        <div className="flex justify-center">
          <QRCodeCanvas
            value={url || window.location.href}
            size={200}
            bgColor="#ffffff"
            fgColor="#111827"
            level="M"
            includeMargin
          />
        </div>

        {/* Скопировать ссылку */}
        <button
          type="button"
          onClick={handleCopyLink}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
        >
          <LinkIcon className="h-4 w-4" />
          Скопировать ссылку
        </button>
      </div>
    </div>
  );
}
