import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import {
  Trash2, MapPin, Navigation, Ruler, Loader2,
  ChevronDown, ChevronUp, Mountain, Save, ImageIcon,
  Upload, X, Clock, TrendingUp, TrendingDown,
  Pencil, GitBranch, Map, GripVertical, Plus,
  HelpCircle, Lock, Copy, Unlock,
  Footprints, Bike, Car,
} from 'lucide-react';
import { toast } from 'sonner';

import RouteMap from '@/components/map/RouteMap';
import { useResizableSidebar } from '@/hooks/useResizableSidebar';
import ElevationProfile from '@/components/map/ElevationProfile';
import useRouteStore, { formatDuration } from '@/store/useRouteStore';
import useAuthStore from '@/store/useAuthStore';
import { POI_ICONS } from '@/components/map/PoiIconPicker';
import { uploadFile, validateImageFile } from '@/lib/uploadFile';
import { supabase } from '@/lib/supabaseClient';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';

/**
 * Типы активности маршрута — соответствуют activity_type в таблице routes.
 */
const ACTIVITY_TYPES = [
  { value: 'foot', label: 'Пешком',   Icon: Footprints },
  { value: 'bike', label: 'Велосипед', Icon: Bike },
  { value: 'car',  label: 'Авто',     Icon: Car },
];

/**
 * Страница создания нового маршрута.
 *
 * Компоновка:
 *  ┌──────────────┬──────────────────────────────────┐
 *  │  Sidebar     │  Карта (flex-1)                   │
 *  │  288px       ├──────────────────────────────────┤
 *  │  ┌─ Header ─┐│  Профиль высот (сворачиваемый)   │
 *  │  │ Название  ││                                  │
 *  │  │ Статистика││                                  │
 *  │  └───────────┘│                                  │
 *  │  [Tabs x4]   │                                   │
 *  │  ┌─ Footer ─┐│                                   │
 *  │  │ Кнопки   ││                                   │
 *  │  └───────────┘│                                   │
 *  └──────────────┴──────────────────────────────────┘
 *
 * Сайдбар содержит 4 вкладки:
 *  1. «Описание» — обложка, описание, тип активности с режимом редактирования.
 *  2. «Точки»    — список опорных точек с удалением и счётчиком.
 *  3. «Дни» — задел на многодневное планирование.
 *  4. «Покрытие» — задел на анализ типа дорог.
 *
 * Переключение вкладок не вызывает ремаунт карты.
 */
export default function CreateRoutePage() {
  const {
    labels, routePoints, routingMode, routingProfile, segments,
    clearAll, removeLabel,
    totalDistance, totalDuration, isLoadingRoute, elevationData,
    surfaceStats, showSurfaceOnMap, setShowSurfaceOnMap,
    saveRoute, isSaving, loadRouteFromDetails,
    tripDays, activeDayId, tripDaysStats, addTripDay, setActiveDayId,
  } = useRouteStore();

  const { user }  = useAuthStore();
  const navigate  = useNavigate();
  const [searchParams] = useSearchParams();
  /** Явный id в пути `/constructor/:routeId` — режим редактирования (аналог `?edit=`). */
  const { routeId: routeIdFromPath } = useParams();

  /** Источник истины для UPDATE: query `edit` или участок пути конструктора (не React state). */
  const editFromUrl = searchParams.get('edit') || routeIdFromPath || null;
  const cloneFromUrl = searchParams.get('clone');

  const [isElevationOpen, setIsElevationOpen] = useState(true);

  /** Read-only до «Разблокировать» только при ?clone= (копия чужого). Свой маршрут в /constructor/:id сразу доступен. */
  const [isLocked, setIsLocked] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [isLoadingRouteDetails, setIsLoadingRouteDetails] = useState(false);

  // ─── Данные формы сохранения ─────────────────────────────────────────────
  const [saveTitle,        setSaveTitle]        = useState('');
  const [saveDescription,  setSaveDescription]  = useState('');
  /**
   * Тип активности для базы данных (activity_type в таблице routes).
   * Пользователь выбирает вручную в таблице «Описание».
   * Дефолт 'foot' — соответствует профилю foot-walking по умолчанию.
   */
  const [saveActivity,     setSaveActivity]      = useState('foot');
  const [saveCoverUrl,     setSaveCoverUrl]      = useState('');
  const [coverImgError,    setCoverImgError]     = useState(false);
  const [isUploadingCover, setIsUploadingCover]  = useState(false);
  /** Дополнительные фотографии маршрута (массив URL), сохраняются в routes.images */
  const [routeImages,      setRouteImages]       = useState([]);
  const [isUploadingRouteImages, setIsUploadingRouteImages] = useState(false);
  /** Публикация маршрута: при true маршрут будет виден всем в поиске (is_public в БД). */
  const [saveIsPublic,     setSaveIsPublic]      = useState(false);
  /** true, если маршрут является копией (имеет parent_route_id). */
  const [isForkBasedRoute, setIsForkBasedRoute] = useState(false);

  /**
   * Режим редактирования описания.
   * По умолчанию true: при создании нового маршрута поля сразу доступны для ввода.
   * При нажатии «Готово» переключается в режим отображения (read-only).
   */
  const [isEditMode, setIsEditMode] = useState(true);

  const coverFileInputRef = useRef(null);
  const routeImagesFileInputRef = useRef(null);

  /**
   * Полный сброс состояния конструктора:
   * - очищает глобальные данные маршрута в сторе (точки/отрезки маршрута/статистику);
   * - очищает локальные поля формы (название, описание, обложка, публичность и т.д.).
   */
  const resetConstructorState = useCallback((withToast = false) => {
    clearAll();
    setSaveTitle('');
    setSaveDescription('');
    setSaveActivity('foot');
    setSaveCoverUrl('');
    setCoverImgError(false);
    setRouteImages([]);
    setSaveIsPublic(false);
    setIsEditMode(true);
    setIsLocked(false);
    setLoadError(null);
    setIsForkBasedRoute(false);
    if (withToast) toast.info('Маршрут очищен');
  }, [clearAll]);

  // ─── Загрузка маршрута: ?edit= / ?clone= или /constructor/:routeId ───────
  useEffect(() => {
    const routeId = editFromUrl || cloneFromUrl;
    if (!routeId) {
      // Чистый конструктор без id: обязателен полный сброс, чтобы не было «грязного» состояния.
      resetConstructorState(false);
      return;
    }

    let cancelled = false;
    setLoadError(null);
    setIsLoadingRouteDetails(true);

    (async () => {
      try {
        const parseGeom = (geomRaw) => {
          try {
            const g = typeof geomRaw === 'string' ? JSON.parse(geomRaw) : geomRaw;
            if (!Array.isArray(g?.coordinates)) return null;
            const [lng, lat] = g.coordinates;
            if (lat == null || lng == null) return null;
            return { lat, lng };
          } catch {
            return null;
          }
        };

        const { data: routeRow, error: routeError } = await supabase
          .from('routes')
          .select('*, profiles(id, username, full_name, avatar_url)')
          .eq('id', routeId)
          .maybeSingle();
        if (routeError || !routeRow) {
          throw new Error(routeError?.message || 'Маршрут не найден');
        }

        // Защита: если открыт режим редактирования чужого маршрута (не ?clone=),
        // автоматически переключаемся в режим клонирования — редактировать чужой нельзя.
        if (editFromUrl && !cloneFromUrl && routeRow.author_id && user?.id) {
          if (String(routeRow.author_id) !== String(user.id)) {
            if (!cancelled) {
              navigate(`/create?clone=${editFromUrl}`, { replace: true });
            }
            return;
          }
        }

        const { data: daysRows, error: daysError } = await supabase
          .from('days')
          .select('id, day_number, title, distance, elevation_gain')
          .eq('route_id', routeId)
          .order('day_number', { ascending: true });
        if (daysError) throw daysError;

        const basePoiSelect = 'id, day_id, geom, name, description, image_url, icon_name, color, order_index';
        let poisRes = await supabase
          .from('route_pois')
          .select(`${basePoiSelect}, images`)
          .eq('route_id', routeId)
          .order('order_index', { ascending: true });
        if (poisRes.error) {
          poisRes = await supabase
            .from('route_pois')
            .select(`${basePoiSelect}, image_urls`)
            .eq('route_id', routeId)
            .order('order_index', { ascending: true });
        }
        if (poisRes.error) {
          poisRes = await supabase
            .from('route_pois')
            .select(basePoiSelect)
            .eq('route_id', routeId)
            .order('order_index', { ascending: true });
        }
        if (poisRes.error) throw poisRes.error;

        const pois = (poisRes.data ?? [])
          .map((poi) => {
            const coord = parseGeom(poi.geom);
            if (!coord) return null;
            let urls = poi.images ?? poi.image_urls;
            if (typeof urls === 'string') {
              try { urls = JSON.parse(urls); } catch { urls = null; }
            }
            const images = Array.isArray(urls)
              ? urls.filter(Boolean)
              : (poi.image_url ? [poi.image_url] : []);

            return {
              id: poi.id,
              dayId: poi.day_id,
              lat: coord.lat,
              lng: coord.lng,
              name: poi.name ?? '',
              description: poi.description ?? '',
              image_url: poi.image_url ?? images[0] ?? null,
              images,
              image_urls: images,
              icon_name: poi.icon_name ?? 'map-pin',
              color: poi.color ?? '#ef4444',
            };
          })
          .filter(Boolean);

        const data = {
          ...routeRow,
          days: (daysRows ?? []).map((d) => ({
            id: d.id,
            day_number: d.day_number ?? 0,
            title: d.title ?? null,
            distance: Number(d.distance ?? 0),
            elevation_gain: Number(d.elevation_gain ?? 0),
          })),
          points: [],
          pois,
        };
        if (cancelled) return;

        loadRouteFromDetails(data);
        let title = data.title ?? '';
        if (cloneFromUrl) {
          const t = title.trim();
          if (!/\(Копия\)\s*$/i.test(t)) {
            title = t ? `${t} (Копия)` : 'Маршрут (Копия)';
          }
        }
        setSaveTitle(title);
        setSaveDescription(data.description ?? '');
        setSaveActivity(data.activity_type ?? 'foot');
        setSaveCoverUrl(data.cover_image_url ?? '');
        setRouteImages(Array.isArray(data.images) ? data.images : []);
        const forkParentId = data.parent_route_id ?? data.parent_id ?? null;
        const derivedRoute = Boolean(forkParentId) || Boolean(cloneFromUrl);
        setIsForkBasedRoute(derivedRoute);
        setSaveIsPublic(derivedRoute ? false : (editFromUrl && !cloneFromUrl ? Boolean(data.is_public) : false));
        if (editFromUrl && !cloneFromUrl) {
          setIsLocked(false);
        } else if (cloneFromUrl) {
          setIsLocked(true);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err.message || 'Не удалось загрузить маршрут');
          toast.error(err.message || 'Не удалось загрузить маршрут');
        }
      } finally {
        if (!cancelled) setIsLoadingRouteDetails(false);
      }
    })();

    return () => { cancelled = true; };
  }, [searchParams, editFromUrl, cloneFromUrl, loadRouteFromDetails, resetConstructorState]);

  // ─── Вычисляемые характеристики маршрута ────────────────────────────────
  /**
   * Вычисляем статистику высот и ориентировочное время за один проход.
   * Набор (gain) и сброс (loss) считаются как сумма положительных/отрицательных дельт.
   */
  /**
   * Вычисляем статистику высот за один проход по elevationData.
   * Время теперь берётся из totalDuration (точная сумма duration всех отрезков маршрута),
   * а не оценивается по дистанции и профилю — это честнее для мультиспортивных маршрутов.
   */
  const stats = useMemo(() => {
    let gain = 0;
    let loss = 0;
    for (let i = 1; i < elevationData.length; i++) {
      const diff = elevationData[i].elevation - elevationData[i - 1].elevation;
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);
    }
    return {
      gain:          Math.round(gain),
      loss:          Math.round(loss),
      estimatedTime: formatDuration(totalDuration),
    };
  }, [elevationData, totalDuration]);

  // ─── Обработчики ─────────────────────────────────────────────────────────

  const handleClear = () => {
    resetConstructorState(true);
  };

  /**
   * Обрабатывает выбор файла обложки.
   *
   * Алгоритм:
   *  1. Валидируем файл (тип + размер до 10 МБ).
   *  2. Создаём blob-URL для мгновенного превью.
   *  3. Загружаем в Supabase Storage (covers/).
   *  4. Заменяем blob-URL на публичный Storage URL.
   *  5. Освобождаем blob-URL из памяти.
   */
  const handleCoverFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';

    const validation = validateImageFile(file, 10);
    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }

    const blobUrl = URL.createObjectURL(file);
    setSaveCoverUrl(blobUrl);
    setCoverImgError(false);
    setIsUploadingCover(true);

    const { url, error } = await uploadFile(file, 'covers');
    URL.revokeObjectURL(blobUrl);

    if (url) {
      setSaveCoverUrl(url);
      toast.success('Обложка загружена');
    } else {
      setSaveCoverUrl('');
      toast.error(`Не удалось загрузить обложку: ${error}`);
    }

    setIsUploadingCover(false);
  };

  /**
   * Обрабатывает выбор нескольких файлов для раздела «Фотографии маршрута».
   * Загружает каждый файл в Storage (covers), добавляет URL в routeImages.
   */
  const handleRouteImagesFileChange = async (e) => {
    const files = e.target.files ? [...e.target.files] : [];
    e.target.value = '';
    if (files.length === 0) return;

    setIsUploadingRouteImages(true);
    const newUrls = [];
    for (const file of files) {
      const validation = validateImageFile(file, 10);
      if (!validation.valid) {
        toast.error(`${file.name}: ${validation.error}`);
        continue;
      }
      const { url, error } = await uploadFile(file, 'covers');
      if (url) newUrls.push(url);
      else toast.error(`${file.name}: ${error || 'Ошибка загрузки'}`);
    }
    setRouteImages((prev) => [...prev, ...newUrls]);
    if (newUrls.length > 0) toast.success(`Добавлено фотографий: ${newUrls.length}`);
    setIsUploadingRouteImages(false);
  };

  const removeRouteImage = (index) => {
    setRouteImages((prev) => prev.filter((_, i) => i !== index));
  };

  /**
   * Сохраняет маршрут в Supabase.
   * Режим редактирования: `?edit=` или `/constructor/:routeId` — только UPDATE по id (без INSERT).
   * Режим «Сделать на основе»: `?clone=` — INSERT, author_id текущего пользователя, parent_route_id.
   * Новый маршрут: без edit/clone — INSERT.
   */
  const handleSave = async () => {
    if (!user) {
      toast.error('Войдите в аккаунт, чтобы сохранить маршрут');
      navigate('/login');
      return;
    }
    if (!saveTitle.trim()) {
      toast.error('Введите название маршрута');
      return;
    }
    if (isUploadingCover || isUploadingRouteImages) {
      toast.warning('Дождитесь завершения загрузки фотографий');
      return;
    }

    const editingExisting = Boolean(editFromUrl) && !cloneFromUrl;
    const isPublic = isForkBasedRoute ? false : saveIsPublic;
    const options = editingExisting
      ? { existingRouteId: editFromUrl }
      : cloneFromUrl
        ? { parentRouteId: cloneFromUrl }
        : {};

    const { routeId, savedRoute, error } = await saveRoute(
      saveTitle, saveDescription, saveActivity, saveCoverUrl, isPublic, routeImages, options,
    );

    if (!error && routeId) {
      toast.success(editingExisting ? 'Маршрут обновлён!' : 'Маршрут успешно сохранён!');
      setIsLocked(false);
      navigate(`/constructor/${routeId}`, { replace: true, state: { savedRoute } });
    }
  };

  /**
   * Маршрут готов к сохранению если:
   *  — Построен хотя бы один отрезок маршрута (независимо от режима)
   *  — Нет незавершённых запросов (isLoadingRoute)
   */
  const canSave = segments.length > 0 && !isLoadingRoute;

  const namedLabelsCount = labels.filter((l) => l.name).length;

  const onSidebarResizeEnd = useCallback(() => {
    window.dispatchEvent(new Event('resize'));
  }, []);
  const { sidebarStyle, handleMouseDown: handleSidebarResizeStart } = useResizableSidebar({
    initialWidth: 400,
    minWidth: 320,
    maxWidth: 520,
    onResizeEnd: onSidebarResizeEnd,
  });

  return (
    <div className="flex h-[calc(100vh-4rem)]">

      {/* ═══════════════════════════ SIDEBAR (ресайз по правому краю) ═══════════════════════════ */}
      <div className="relative flex flex-col border-r bg-white dark:bg-background shadow-sm" style={sidebarStyle}>
        <aside className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">

        {/* Кнопка «Редактировать» / «Разблокировать для копирования» — вверху панели при isLocked */}
        {isLocked && (
          <div className="shrink-0 border-b border-border bg-muted/30 px-4 py-2">
            <Button
              type="button"
              size="sm"
              onClick={() => setIsLocked(false)}
              className="w-full gap-1.5 text-xs h-8"
            >
              {cloneFromUrl ? (
                <>
                  <Unlock className="h-3.5 w-3.5 shrink-0" />
                  Разблокировать для копирования
                </>
              ) : (
                <>
                  <Pencil className="h-3.5 w-3.5 shrink-0" />
                  Редактировать маршрут
                </>
              )}
            </Button>
          </div>
        )}

        {isLoadingRouteDetails && (
          <div className="shrink-0 flex items-center justify-center gap-2 border-b px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка маршрута...
          </div>
        )}

        {loadError && (
          <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {loadError}
          </div>
        )}

        {/* Шапка — фиксирована сверху */}
        <div className="shrink-0 border-b px-4 pt-4 pb-3 space-y-3">

          {/* Название — всегда видимый инпут */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Navigation className="h-4 w-4 text-primary" />
            </div>
            <Input
              placeholder="Название маршрута"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              maxLength={120}
              disabled={isLocked}
              className="h-8 border-0 bg-transparent px-0 text-sm font-semibold shadow-none focus-visible:ring-0 placeholder:font-normal placeholder:text-muted-foreground/50 disabled:opacity-70 disabled:cursor-not-allowed"
            />
          </div>

          {/* Строка характеристик: время · километраж · набор · сброс высоты */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {stats.estimatedTime && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span className="font-semibold text-foreground">{stats.estimatedTime}</span>
              </span>
            )}
            {totalDistance > 0 && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Ruler className="h-3 w-3" />
                {isLoadingRoute
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <span className="font-semibold text-foreground">{totalDistance} км</span>
                }
              </span>
            )}
            {stats.gain > 0 && (
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-emerald-500" />
                <span className="font-semibold text-emerald-600">+{stats.gain}м</span>
              </span>
            )}
            {stats.loss > 0 && (
              <span className="flex items-center gap-1">
                <TrendingDown className="h-3 w-3 text-rose-400" />
                <span className="font-semibold text-rose-500">−{stats.loss}м</span>
              </span>
            )}
            {routePoints.length === 0 && labels.length === 0 && (
              <span className="italic text-muted-foreground/60">
                Кликайте по карте, чтобы ставить точки
              </span>
            )}
          </div>

        </div>

        {/* ── Вкладки ── */}
        {/*
         * Tabs не вызывают ремаунт карты при переключении, потому что <RouteMap>
         * находится вне <Tabs> в структуре JSX.
         */}
        {/* Блок табов: заполняет середину, контент скроллится */}
        <Tabs defaultValue="description" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Шапка вкладок — фиксирована сверху */}
          <div className="flex min-h-[48px] shrink-0 w-full items-center justify-center border-b border-border px-4 overflow-x-auto [&::-webkit-scrollbar]:h-0">
            <TabsList className="flex h-8 w-full flex-1 gap-0.5 rounded-lg bg-muted p-0.5">
              <TabsTrigger value="description" className="flex-1 justify-center text-xs px-2 whitespace-nowrap">
                Описание
              </TabsTrigger>
              <TabsTrigger value="points" className="flex-1 justify-center gap-1 text-xs px-2 whitespace-nowrap">
                Метки
                {labels.length > 0 && (
                  <span className="rounded-full bg-primary/15 px-1 text-[10px] font-bold text-primary">
                    {labels.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="segments" className="flex-1 justify-center text-xs px-2 whitespace-nowrap">
                Дни
              </TabsTrigger>
              <TabsTrigger value="coverage" className="flex-1 justify-center text-xs px-2 whitespace-nowrap">
                Покрытие
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ─────────────────── ТАБ: ОПИСАНИЕ ─────────────────── */}
          <TabsContent
            value="description"
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
          >
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
            {/* Скрытый нативный file input */}
            <input
              ref={coverFileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handleCoverFileChange}
            />

            {/* ── Обложка маршрута ── */}
            <div className="space-y-1.5">
              <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <ImageIcon className="h-3 w-3" />
                Обложка
              </p>

              {saveCoverUrl ? (
                /*
                 * Превью обложки.
                 * Сначала показывается blob-URL (мгновенно),
                 * после завершения загрузки — реальный Storage URL.
                 */
                <div className="relative overflow-hidden rounded-xl border">
                  {!coverImgError ? (
                    <img
                      src={saveCoverUrl}
                      alt="Обложка маршрута"
                      className="h-32 w-full object-cover"
                      onError={() => setCoverImgError(true)}
                    />
                  ) : (
                    <div className="flex h-32 items-center justify-center bg-muted text-xs text-muted-foreground">
                      Не удалось загрузить изображение
                    </div>
                  )}

                  {/* Спиннер во время загрузки на сервер */}
                  {isUploadingCover && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-background/70 backdrop-blur-sm">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <span className="text-[10px] font-medium text-foreground">Загрузка...</span>
                    </div>
                  )}

                  {/* Кнопки управления (только в режиме редактирования и не в режиме блокировки) */}
                  {!isUploadingCover && isEditMode && !isLocked && (
                    <div className="absolute right-2 top-2 flex gap-1">
                      <button
                        type="button"
                        onClick={() => coverFileInputRef.current?.click()}
                        className="flex items-center gap-1 rounded-md bg-black/50 px-2 py-1 text-[10px] text-white backdrop-blur-sm transition-colors hover:bg-black/70"
                      >
                        <Upload className="h-2.5 w-2.5" />
                        Заменить
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSaveCoverUrl(''); setCoverImgError(false); }}
                        className="flex items-center justify-center rounded-md bg-black/50 p-1 text-white backdrop-blur-sm transition-colors hover:bg-red-600/80"
                        title="Удалить обложку"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  )}
                </div>
              ) : (isEditMode && !isLocked) ? (
                /* Зона загрузки файла — пунктирная рамка */
                <button
                  type="button"
                  onClick={() => coverFileInputRef.current?.click()}
                  className="flex h-20 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-muted-foreground/25 transition-colors hover:border-primary/40 hover:bg-muted/40 focus:outline-none"
                >
                  <Upload className="h-5 w-5 text-muted-foreground/40" />
                  <div className="text-center">
                    <p className="text-xs font-medium text-muted-foreground">
                      Загрузить обложку
                    </p>
                    <p className="text-[10px] text-muted-foreground/60">
                      JPG, PNG, WebP · до 10 МБ
                    </p>
                  </div>
                </button>
              ) : (
                <div className="flex h-14 items-center justify-center rounded-xl bg-muted/40 text-xs italic text-muted-foreground">
                  Обложка не добавлена
                </div>
              )}
            </div>

            {/* ── Фотографии маршрута ── */}
            <div className="space-y-1.5">
              <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <ImageIcon className="h-3 w-3" />
                Фотографии маршрута
              </p>
              {(isEditMode && !isLocked) ? (
                <>
                  <button
                    type="button"
                    onClick={() => routeImagesFileInputRef.current?.click()}
                    disabled={isUploadingRouteImages}
                    title="JPG, PNG, WebP · до 10 МБ · несколько файлов"
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/40 hover:text-foreground focus:outline-none disabled:opacity-50"
                  >
                    {isUploadingRouteImages ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>{isUploadingRouteImages ? 'Загрузка...' : 'Добавить фотографии'}</span>
                  </button>
                  <input
                    ref={routeImagesFileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                    multiple
                    className="hidden"
                    onChange={handleRouteImagesFileChange}
                  />
                  {routeImages.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {routeImages.map((url, index) => (
                        <div key={`${url}-${index}`} className="relative aspect-square rounded-lg overflow-hidden border border-border bg-muted/30">
                          <img src={url} alt="" className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removeRouteImage(index)}
                            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                            title="Удалить"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : routeImages.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {routeImages.map((url, index) => (
                    <div key={`${url}-${index}`} className="aspect-square rounded-lg overflow-hidden border border-border bg-muted/30">
                      <img src={url} alt="" className="h-full w-full object-cover" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground/60">Дополнительные фото не добавлены</p>
              )}
            </div>

            {/* ── Описание маршрута ── */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground">Описание</p>
              {(isEditMode && !isLocked) ? (
                <Textarea
                  placeholder="Особенности рельефа, достопримечательности, советы..."
                  value={saveDescription}
                  onChange={(e) => setSaveDescription(e.target.value)}
                  rows={4}
                  maxLength={1000}
                  className="resize-none text-sm"
                />
              ) : (
                <p className="min-h-[5rem] rounded-xl bg-muted/40 px-3 py-2.5 text-sm leading-relaxed text-foreground">
                  {saveDescription || (
                    <span className="italic text-muted-foreground">Описание не добавлено</span>
                  )}
                </p>
              )}
            </div>

            {/* ── Опубликовать маршрут (is_public). В режиме клона — принудительно приватный, тумблер заблокирован. ── */}
            <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="save-is-public"
                    checked={isForkBasedRoute ? false : saveIsPublic}
                    onCheckedChange={setSaveIsPublic}
                    disabled={isLocked || isForkBasedRoute}
                  />
                  <label
                    htmlFor="save-is-public"
                    className={`text-sm font-medium select-none ${isForkBasedRoute ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer'}`}
                  >
                    Опубликовать маршрут
                  </label>
                  <span
                    className="text-muted-foreground hover:text-foreground"
                    title="Публичные маршруты будут видны всем пользователям в поиске"
                    aria-label="Подсказка"
                  >
                    <HelpCircle className="h-4 w-4 shrink-0" />
                  </span>
                </div>
              </div>
              {isForkBasedRoute && (
                <p className="text-xs text-gray-500">
                  Нельзя опубликовать маршрут, созданный на основе чужого.
                </p>
              )}
            </div>

            {/* ── Тип активности ── */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground">Тип активности</p>
              {(isEditMode && !isLocked) ? (
                <Select value={saveActivity} onValueChange={setSaveActivity}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Выберите тип">
                      {(() => {
                        const t = ACTIVITY_TYPES.find((x) => x.value === saveActivity);
                        if (!t) return null;
                        const Icon = t.Icon;
                        return (
                          <span className="flex items-center gap-2">
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            {t.label}
                          </span>
                        );
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIVITY_TYPES.map((t) => {
                      const Icon = t.Icon;
                      return (
                        <SelectItem key={t.value} value={t.value}>
                          <span className="flex items-center gap-2">
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            {t.label}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm text-foreground">
                  {(() => {
                    const t = ACTIVITY_TYPES.find((x) => x.value === saveActivity);
                    if (!t) return '—';
                    const Icon = t.Icon;
                    return (
                      <>
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {t.label}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Подсказка об именованных метках */}
            {namedLabelsCount > 0 && (
              <div className="rounded-xl bg-emerald-50 px-3 py-2 text-[11px] leading-relaxed text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                ✓ Именованных меток:{' '}
                <b className="text-emerald-800 dark:text-emerald-300">{namedLabelsCount}</b>
                {' '}— данные будут сохранены в базу.
              </div>
            )}
              </div>
            </div>
          </TabsContent>

          {/* ─────────────────── ТАБ: МЕТКИ ─────────────────── */}
          {/*
           * Отображает только смысловые метки (labels) — точки с именами, фото и т.д.
           * Технические routePoints здесь не показываются — они на карте как чёрные кружки.
           */}
          <TabsContent
            value="points"
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
          >
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {labels.length === 0 ? (
              /* Пустое состояние */
              <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Меток ещё нет</p>
                  <p className="mt-1 max-w-[170px] text-xs leading-relaxed text-muted-foreground">
                    Включите режим «Метки» в панели инструментов и кликните на карту
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {labels.map((label, index) => {
                  const iconMeta = POI_ICONS.find((ic) => ic.id === label.icon);
                  const IconComponent = iconMeta?.Icon;
                  return (
                    <div
                      key={label.id}
                      className="group flex items-center gap-2 rounded-xl border bg-card px-2.5 py-2.5 transition-colors hover:bg-muted/50"
                    >
                      <GripVertical
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40"
                        title="Перетащите метку на карте"
                      />

                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm"
                        style={{ backgroundColor: label.color || '#3b82f6' }}
                      >
                        {IconComponent ? (
                          <IconComponent className="h-3 w-3" strokeWidth={2.5} />
                        ) : (
                          index + 1
                        )}
                      </span>

                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-1 truncate text-xs font-medium text-foreground">
                          {label.name || `Метка ${index + 1}`}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {label.lat.toFixed(4)}, {label.lng.toFixed(4)}
                        </span>
                      </div>

                      {/* Кнопка удаления — появляется при наведении */}
                      <button
                        type="button"
                        onClick={() => removeLabel(label.id)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        title="Удалить метку"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            </div>
          </TabsContent>

          {/* ─────────────────── ТАБ: ДНИ ─────────────────── */}
          {/*
           * Многодневное планирование: каждый день — отдельный отрезок маршрута.
           * Активный день выделяется рамкой; новые точки добавляются в него.
           * Статистика (км / время) берётся из tripDaysStats, вычисленного в computeDerived.
           */}
          <TabsContent
            value="segments"
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
          >
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="space-y-2">
            {/* Подсказка — только когда нет точек маршрута */}
            {routePoints.length === 0 && (
              <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                Кликайте на карту — точки добавятся в активный день.
              </div>
            )}

            {/* Список дней (в режиме просмотра клик по дню заблокирован) */}
            <div className="space-y-2">
              {tripDays.map((day) => {
                const dayStat  = tripDaysStats[day.id];
                const isActive = day.id === activeDayId;
                return (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => !isLocked && setActiveDayId(day.id)}
                    disabled={isLocked}
                    className={[
                      'w-full flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      isActive
                        ? 'border-primary/60 bg-primary/5 shadow-sm'
                        : 'border-border bg-card hover:bg-muted/50',
                      isLocked && 'cursor-not-allowed opacity-80',
                    ].join(' ')}
                  >
                    {/* Цветовой маркер дня */}
                    <span
                      className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: day.color }}
                    />

                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium text-foreground leading-tight">
                        {day.name}
                      </span>

                      {/* Статистика дня: расстояние и время */}
                      {dayStat ? (
                        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-0.5">
                            <Ruler className="h-2.5 w-2.5" />
                            {dayStat.distance} км
                          </span>
                          {dayStat.duration > 0 && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="h-2.5 w-2.5" />
                              {formatDuration(dayStat.duration)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="mt-0.5 text-[11px] italic text-muted-foreground/50">
                          Точек нет
                        </span>
                      )}
                    </div>

                    {/* Бейдж активного дня */}
                    {isActive && (
                      <span className="shrink-0 self-center rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                        активен
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
              </div>
            </div>

            {/* Кнопки таба — при isLocked кнопка «Добавить день» заблокирована */}
            <div className="shrink-0 border-t border-gray-100 bg-white p-4 dark:bg-background dark:border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addTripDay}
                disabled={isLocked}
                className={`w-full gap-2 border-amber-400/60 bg-amber-400/10 font-semibold text-amber-700 hover:bg-amber-400/20 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Plus className="h-4 w-4" />
                Добавить день
              </Button>
            </div>
          </TabsContent>

          {/* ─────────────────── ТАБ: ПОКРЫТИЕ ─────────────────── */}
          <TabsContent
            value="coverage"
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
          >
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
              {/* ── Тумблер «Отображать на карте» ── */}
              <div className="flex items-center justify-between rounded-xl border bg-card px-3 py-2.5">
                <span className="text-xs font-medium text-foreground">
                  Отображать на карте
                </span>
                <Switch
                  checked={showSurfaceOnMap}
                  onCheckedChange={setShowSurfaceOnMap}
                />
              </div>

              {segments.length === 0 ? (
                /* Пустое состояние */
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Map className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Нет данных</p>
                    <p className="mt-1 max-w-[180px] text-xs leading-relaxed text-muted-foreground">
                      Постройте маршрут, чтобы увидеть статистику покрытия
                    </p>
                  </div>
                </div>
              ) : showSurfaceOnMap && (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Тип покрытия
                  </p>

                  {/* ── Сводная полоса (stacked bar): асфальт, грунт, неизвестно ── */}
                  {totalDistance > 0 && (
                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-zinc-800 transition-all duration-500"
                        style={{ width: `${surfaceStats.paved.pct}%` }}
                      />
                      <div
                        className="h-full bg-zinc-400 transition-all duration-500"
                        style={{ width: `${surfaceStats.unpaved.pct}%` }}
                      />
                      <div
                        className="h-full border-y border-zinc-800 bg-transparent transition-all duration-500"
                        style={{ width: `${surfaceStats.unknown.pct}%` }}
                      />
                    </div>
                  )}

                  {/* ── Строки статистики покрытия ── */}
                  {[
                    {
                      key:   'paved',
                      label: 'С покрытием',
                      hint:  'Асфальт, бетон, брусчатка',
                      /*
                       * Толстая сплошная тёмная линия — точно как на карте.
                       */
                      line: (
                        <svg width="40" height="14" viewBox="0 0 40 14" fill="none">
                          <rect x="0" y="4" width="40" height="6" rx="3" fill="#27272a" />
                        </svg>
                      ),
                    },
                    {
                      key:   'unpaved',
                      label: 'Без покрытия',
                      hint:  'Грунт, гравий, трава, песок',
                      /*
                       * Пунктир внутри обводки: нижний тёмный прямоугольник +
                       * белый поверх + тёмный пунктир сверху.
                       */
                      line: (
                        <svg width="40" height="14" viewBox="0 0 40 14" fill="none">
                          <rect x="0" y="4" width="40" height="6" rx="3" fill="#27272a" />
                          <rect x="0" y="5" width="40" height="4" rx="2" fill="white" />
                          <line
                            x1="2" y1="7" x2="38" y2="7"
                            stroke="#27272a" strokeWidth="2.5" strokeLinecap="round"
                            strokeDasharray="4 8"
                          />
                        </svg>
                      ),
                    },
                    {
                      key:   'unknown',
                      label: 'Неизвестно',
                      hint:  'Нет данных о покрытии',
                      /*
                       * Полая линия — тёмная рамка, белая заливка.
                       */
                      line: (
                        <svg width="40" height="14" viewBox="0 0 40 14" fill="none">
                          <rect x="0" y="4" width="40" height="6" rx="3"
                            fill="white" stroke="#27272a" strokeWidth="2" />
                        </svg>
                      ),
                    },
                  ].map(({ key, label, hint, line }) => {
                    const stat = surfaceStats[key];
                    return (
                      <div
                        key={key}
                        className="flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5"
                      >
                        <span className="shrink-0">{line}</span>

                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="text-xs font-medium text-foreground leading-tight">
                            {label}
                          </span>
                          <span className="text-[10px] text-muted-foreground leading-tight">
                            {hint}
                          </span>
                        </div>

                        <span className="shrink-0 text-xs font-semibold text-foreground tabular-nums">
                          {stat.distKm} км
                        </span>

                        <span className="w-8 shrink-0 text-right text-[11px] font-medium text-muted-foreground tabular-nums">
                          {stat.pct}%
                        </span>
                      </div>
                    );
                  })}

                  {/* Пояснение для direct-маршрутов */}
                  {segments.every((s) => s.method === 'direct') && (
                    <p className="rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                      Данные о покрытии доступны только для маршрутов по дорогам (не для прямых линий).
                    </p>
                  )}
                </>
              )}
              </div>
            </div>
          </TabsContent>

        </Tabs>

        {/* Футер — при isLocked скрываем «Очистить» и «Сохранить»; при разблокировке показываем обе кнопки */}
        <div className="shrink-0 space-y-2 border-t border-gray-100 bg-white p-4 dark:bg-background dark:border-border">
          {!isLocked && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClear}
                disabled={routePoints.length === 0 && labels.length === 0}
                className="w-full gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Очистить маршрут
              </Button>

              <Button
                size="sm"
                onClick={handleSave}
                disabled={!canSave || isSaving || isUploadingCover}
                className="w-full gap-2"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Сохранить маршрут
                  </>
                )}
              </Button>
            </>
          )}
        </div>
        </aside>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Изменить ширину панели"
          onMouseDown={handleSidebarResizeStart}
          className="absolute top-0 right-0 z-50 h-full w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/50"
        />
      </div>

      {/* ═══════════════════════ MAP + ELEVATION ═══════════════════════ */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-visible">
        <div className="relative min-h-0 flex-1 overflow-visible">
          <RouteMap readOnly={isLocked} />
        </div>

        {elevationData.length > 0 && (
          <div className="shrink-0 border-t bg-background">
            <button
              className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
              onClick={() => setIsElevationOpen((prev) => !prev)}
              aria-expanded={isElevationOpen}
              aria-controls="elevation-panel"
            >
              <span className="flex items-center gap-2">
                <Mountain className="h-4 w-4 text-primary" />
                Профиль высот
              </span>
              {isElevationOpen
                ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                : <ChevronUp   className="h-4 w-4 text-muted-foreground" />
              }
            </button>

            {isElevationOpen && (
              <div id="elevation-panel" className="h-48">
                <ElevationProfile />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
