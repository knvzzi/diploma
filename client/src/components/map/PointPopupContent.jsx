import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Check, ChevronDown, ImagePlus, Loader2 } from 'lucide-react';
import { uploadFile, validateImageFile } from '@/lib/uploadFile';
import { POI_ICONS, DEFAULT_POI_ICON_ID } from './PoiIconPicker';

/**
 * Палитра цветов по референсу: красный, синий, оранжевый, зелёный, розовый, жёлтый, фиолетовый, серый.
 * Выбранный цвет отмечается галочкой внутри кружка.
 */
export const MARKER_COLORS = [
  { value: '#ef4444', label: 'Красный' },
  { value: '#3b82f6', label: 'Синий' },
  { value: '#f97316', label: 'Оранжевый' },
  { value: '#22c55e', label: 'Зелёный' },
  { value: '#ec4899', label: 'Розовый' },
  { value: '#eab308', label: 'Жёлтый' },
  { value: '#a855f7', label: 'Фиолетовый' },
  { value: '#6b7280', label: 'Серый' },
];

/** Максимум символов в названии точки (для ввода и хранения). */
export const MAX_NAME_LENGTH = 50;

/** Совместимость для списка меток на вкладке «Точки». */
export const MARKER_ICONS = POI_ICONS.map((i) => ({ value: i.id, emoji: '', label: i.label }));

/**
 * Панель редактирования метки в конструкторе (Popup).
 * Компактная ширина ~280px, свои отступы (Tailwind). При смене цвета/иконки вызывается onSave —
 * маркер на карте обновляется через createCustomMarker в RouteMap.
 */
/** Нормализуем фото точки: массив URL (поддержка старого imageUrl). */
function normalizeImageUrls(point) {
  if (Array.isArray(point.imageUrls) && point.imageUrls.length > 0) return [...point.imageUrls];
  if (point.imageUrl && typeof point.imageUrl === 'string') return [point.imageUrl];
  return [];
}

export default function PointPopupContent({ point, index, onSave, onDelete, onPhotoClick }) {
  const [name, setName] = useState(point.name ?? '');
  const [description, setDescription] = useState(point.description ?? '');
  const [imageUrls, setImageUrls] = useState(() => normalizeImageUrls(point));
  const [color, setColor] = useState(point.color ?? '#ef4444');
  const [icon, setIcon] = useState(point.icon ?? DEFAULT_POI_ICON_ID);
  const [isUploading, setIsUploading] = useState(false);
  const [imgErrors, setImgErrors] = useState({});
  const [iconOpen, setIconOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const fileInputRef = useRef(null);
  const iconBtnRef = useRef(null);
  const iconDropdownRef = useRef(null);

  const currentIconEntry = POI_ICONS.find((i) => i.id === icon) ?? POI_ICONS[0];
  const CurrentIcon = currentIconEntry?.Icon;

  /** Синхронизация с картой: при смене цвета или иконки обновляем метку в сторе без закрытия popup. */
  const pushMeta = (next) => {
    const meta = {
      name: name.trim(),
      description: description.trim(),
      imageUrls: [...imageUrls],
      color: next?.color ?? color,
      icon: next?.icon ?? icon,
    };
    onSave(point.id, meta, { close: false });
  };

  const handleSave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSave(point.id, {
      name: name.trim(),
      description: description.trim(),
      imageUrls: [...imageUrls],
      color,
      icon,
    });
  };

  const handleDelete = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete(point.id);
  };

  const handleIconSelect = (id) => {
    setIcon(id);
    pushMeta({ icon: id });
    setIconOpen(false);
  };

  const handleIconBtnClick = (e) => {
    e.stopPropagation();
    if (!iconOpen && iconBtnRef.current) {
      const rect = iconBtnRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
    setIconOpen((v) => !v);
  };

  const handleUploadClick = (e) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    e.stopPropagation();
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const validation = validateImageFile(file, 5);
    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }
    const blobUrl = URL.createObjectURL(file);
    setImageUrls((prev) => [...prev, blobUrl]);
    setImgErrors((prev) => ({ ...prev, [blobUrl]: false }));
    setIsUploading(true);
    const { url, error } = await uploadFile(file, 'points');
    URL.revokeObjectURL(blobUrl);
    if (url) {
      setImageUrls((prev) => prev.map((u) => (u === blobUrl ? url : u)));
      setImgErrors((prev) => {
        const next = { ...prev };
        delete next[blobUrl];
        next[url] = false;
        return next;
      });
    } else {
      setImageUrls((prev) => prev.filter((u) => u !== blobUrl));
      setImgErrors((prev) => {
        const next = { ...prev };
        delete next[blobUrl];
        return next;
      });
      toast.error(`Не удалось загрузить фото: ${error}`);
    }
    setIsUploading(false);
  };

  const handleRemovePhoto = (e, urlToRemove) => {
    e.stopPropagation();
    setImageUrls((prev) => prev.filter((u) => u !== urlToRemove));
    setImgErrors((prev) => {
      const next = { ...prev };
      delete next[urlToRemove];
      return next;
    });
  };

  useEffect(() => {
    const close = (e) => {
      if (
        iconDropdownRef.current && !iconDropdownRef.current.contains(e.target) &&
        iconBtnRef.current && !iconBtnRef.current.contains(e.target)
      ) {
        setIconOpen(false);
      }
    };
    if (iconOpen) document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [iconOpen]);

  const categories = [...new Set(POI_ICONS.map((i) => i.category))];

  return (
    <div
      className="flex w-[280px] flex-col gap-3 overflow-y-auto p-3"
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Выбор цвета: круглые кнопки, галочка на выбранном ───────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {MARKER_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            title={c.label}
            onMouseDown={(e) => {
              e.stopPropagation();
              setColor(c.value);
              pushMeta({ color: c.value });
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-white shadow-sm transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            style={{
              backgroundColor: c.value,
              boxShadow: color === c.value ? `0 0 0 2px ${c.value}` : '0 1px 2px rgba(0,0,0,0.2)',
            }}
            aria-label={c.label}
            aria-pressed={color === c.value}
          >
            {color === c.value && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
          </button>
        ))}
      </div>

      {/* ── Выбор иконки: кнопка-селект + Popover через portal (вне попапа карты) ── */}
      <div className="relative">
        <button
          ref={iconBtnRef}
          type="button"
          onClick={handleIconBtnClick}
          className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
        >
          {CurrentIcon && <CurrentIcon className="h-4 w-4 shrink-0 text-slate-600" strokeWidth={2} />}
          <span className="truncate">{currentIconEntry?.label ?? 'Иконка'}</span>
          <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform ${iconOpen ? 'rotate-180' : ''}`} />
        </button>
        {iconOpen && createPortal(
          <div
            ref={iconDropdownRef}
            style={{
              position: 'fixed',
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              zIndex: 99999,
            }}
            className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {categories.map((cat) => (
              <div key={cat} className="mb-2 last:mb-0">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{cat}</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {POI_ICONS.filter((i) => i.category === cat).map(({ id, Icon, label }) => (
                    <button
                      key={id}
                      type="button"
                      title={label}
                      onMouseDown={(e) => { e.stopPropagation(); handleIconSelect(id); }}
                      className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-slate-100 focus:outline-none ${icon === id ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-400/60' : 'text-slate-800'}`}
                    >
                      <Icon className="h-5 w-5" strokeWidth={1.5} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>,
          document.body,
        )}
      </div>

      {/* ── Название и описание: минималистичные инпуты ─────────────────────── */}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Название</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          placeholder="Начало тропы, Вершина..."
          maxLength={MAX_NAME_LENGTH}
          className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/30"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Описание</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          placeholder="Заметки о точке..."
          maxLength={400}
          rows={2}
          className="w-full resize-none rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/30"
        />
      </div>

      {/* ── Добавить фото ─────────────────────────────────────────────────── */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleFileChange}
          onClick={(e) => e.stopPropagation()}
        />
        <div className="space-y-2">
          {imageUrls.length > 0 && (
            <div className="max-h-40 overflow-y-auto overflow-x-hidden rounded-lg border border-slate-100 bg-slate-50/50 p-1.5">
              <div className="grid grid-cols-3 gap-1.5">
                {imageUrls.map((url, i) => (
                <div key={url} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200">
                  {!imgErrors[url] ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onPhotoClick?.(imageUrls, i); }}
                      className="h-full w-full cursor-pointer border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded-lg overflow-hidden"
                    >
                      <img
                        src={url}
                        alt=""
                        className="h-full w-full object-cover pointer-events-none"
                        onError={() => setImgErrors((prev) => ({ ...prev, [url]: true }))}
                      />
                    </button>
                  ) : (
                    <div className="flex h-full items-center justify-center bg-slate-50 text-[10px] text-slate-400">Ошибка</div>
                  )}
                  {!isUploading && (
                    <button
                      type="button"
                      onClick={(e) => handleRemovePhoto(e, url)}
                      className="absolute right-0.5 top-0.5 rounded bg-black/50 px-1 py-0.5 text-[10px] text-white hover:bg-red-600/90 z-10"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              </div>
            </div>
          )}
          {isUploading && (
            <div className="flex items-center justify-center gap-1.5 py-1 text-amber-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">Загрузка...</span>
            </div>
          )}
          <button
            type="button"
            onClick={handleUploadClick}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 py-2 text-sm text-slate-500 transition-colors hover:border-amber-300 hover:bg-amber-50/50 hover:text-amber-700 focus:outline-none"
          >
            <ImagePlus className="h-4 w-4" />
            {imageUrls.length > 0 ? 'Добавить ещё фото' : 'Добавить фото'}
          </button>
        </div>
      </div>

      {/* ── Кнопки действий: Готово (жёлтая), Удалить (белая с жёлтой обводкой) ─ */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={isUploading}
          className="flex-1 rounded-lg bg-amber-400 py-2 text-sm font-semibold text-amber-950 shadow-sm transition-opacity hover:bg-amber-500 focus:outline-none disabled:opacity-60"
        >
          {isUploading ? 'Загрузка...' : 'Готово'}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="rounded-lg border-2 border-amber-400 bg-white px-4 py-2 text-sm font-medium text-amber-600 transition-colors hover:bg-amber-50 focus:outline-none"
        >
          Удалить
        </button>
      </div>
    </div>
  );
}
