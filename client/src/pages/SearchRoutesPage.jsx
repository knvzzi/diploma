import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { buildGpxString } from '@/lib/gpxExport';
import QrModal from '@/components/QrModal';
import L from '@/lib/leafletWithCluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import {
  Footprints,
  Bike,
  Car,
  Loader2,
  Ruler,
  Search,
  User,
  Mountain,
  ArrowLeft,
  Download,
  Bookmark,
  Copy,
  Clock,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Calendar,
  MapPin,
  SlidersHorizontal,
  Image as ImageIcon,
  Camera,
  Heart,
  Send,
  Trash2,
  Pencil,
  GitFork,
  Smartphone,
  Navigation,
  MoreHorizontal,
  Flag,
} from 'lucide-react';
import ElevationProfileView from '@/components/map/ElevationProfileView';
import { getSurfaceLayers } from '@/components/map/RouteMap';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import useProfileStore from '@/store/useProfileStore';
import { POI_ICONS, getPoiIconSvg } from '@/components/map/PoiIconPicker';
import { createCustomMarker } from '@/utils/markerUtils';
import PhotoLightbox from '@/components/PhotoLightbox';
import { useResizableSidebar } from '@/hooks/useResizableSidebar';
import useRouteStore, { MAP_LAYERS } from '@/store/useRouteStore';
import useAuthStore from '@/store/useAuthStore';
import { useAdminReadOnly } from '@/hooks/useAdminReadOnly';
import MapLayersControl from '@/components/map/MapLayerSwitcher';
import MapSearch from '@/components/map/MapSearch';
import { RouteCard, getRouteAuthorLabel, getRouteAuthorAvatar } from '@/components/RouteCard';
import ReportModal from '@/components/ReportModal';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatCreatedDate,
} from '@/lib/routeFormatters';

/** Экранирование для безопасной вставки в HTML popup. */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Массив фото POI: images (миграция 12), image_urls или image_url для обратной совместимости. */
function getPoiPhotos(poi) {
  let arr = poi?.images ?? poi?.image_urls;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch { arr = null; }
  }
  if (Array.isArray(arr) && arr.length > 0) return arr.filter(Boolean);
  if (poi?.image_url && typeof poi.image_url === 'string' && poi.image_url.trim()) return [poi.image_url];
  return [];
}

// ─── Цвета дней (совпадают с конструктором) ───────────────────────────────────

const DAY_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

// ─── Мета-данные типов покрытий (прогресс-бар и компактный список) ─────────────

const SURFACE_META = {
  paved: {
    label:       'Асфальт',
    description: 'Асфальт, бетон',
    color:       '#374151',           // тёмно-серый для полоски
    lineStyle:   'solid',             // сплошная толстая черточка
  },
  unpaved: {
    label:       'Грунт',
    description: 'Грунт, гравий',
    color:       '#9ca3af',           // светло-серый
    lineStyle:   'dashed',
  },
  unknown: {
    label:       'Неизвестно',
    description: 'Нет данных',
    color:       '#f3f4f6',           // белый — рамку задаём отдельно
    borderColor: '#d1d5db',
    lineStyle:   'outline',
  },
};

const ACTIVITY_META = {
  foot: { label: 'Пешие',        Icon: Footprints, color: 'text-green-700',  bg: 'bg-green-50'  },
  bike: { label: 'Велосипедные', Icon: Bike,        color: 'text-blue-700',   bg: 'bg-blue-50'   },
  car:  { label: 'Авто',         Icon: Car,         color: 'text-orange-700', bg: 'bg-orange-50' },
};

// ─── Компонент карточки POI в списке «Места» ──────────────────────────────────

function PoiCard({ poi, onClick, onPhotoClick }) {
  const photoUrls = getPoiPhotos(poi);
  const hasPhoto = photoUrls.length > 0;
  const iconEntry = POI_ICONS.find((i) => i.id === (poi.icon_name || 'map-pin')) ?? POI_ICONS[0];
  const PoiIcon = iconEntry?.Icon ?? MapPin;
  const markerColor = poi.color && /^#[0-9A-Fa-f]{6}$/.test(poi.color) ? poi.color : '#ef4444';
  const hasCoords = poi.lat != null && poi.lng != null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
      className="flex w-full items-start gap-3 rounded-xl bg-white p-3 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring text-left"
    >
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
        {hasPhoto ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPhotoClick?.(poi); }}
            className="h-full w-full cursor-pointer border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-lg"
          >
            <img src={photoUrls[0]} alt="" className="h-full w-full object-cover" />
          </button>
        ) : (
          <div
            className="flex h-full w-full items-center justify-center rounded-lg"
            style={{ backgroundColor: markerColor }}
          >
            <PoiIcon className="h-6 w-6 text-white" strokeWidth={2.5} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-sm text-neutral-900">
            {poi.name || 'Место без названия'}
          </p>
          {hasPhoto && (
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: markerColor }}
              title={iconEntry?.label}
            >
              <PoiIcon className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
            </span>
          )}
        </div>
        {poi.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500 leading-relaxed">
            {poi.description}
          </p>
        )}
        {hasCoords && (
          <p className="mt-1 text-xs text-neutral-400">
            Координаты: {Number(poi.lat).toFixed(5)}, {Number(poi.lng).toFixed(5)}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Детальный просмотр маршрута ──────────────────────────────────────────────

/** Относительная дата для комментариев: "только что", "2 дня назад" и т.д. */
function formatRelativeDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const sec = Math.floor((now - date) / 1000);
  if (sec < 60) return 'только что';
  const min = Math.floor(sec / 60);
  if (min < 60) return min === 1 ? '1 минуту назад' : min < 5 ? `${min} минуты назад` : `${min} минут назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? '1 час назад' : h < 5 ? `${h} часа назад` : `${h} часов назад`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'вчера';
  if (d < 5) return `${d} дня назад`;
  if (d < 21) return `${d} дней назад`;
  const m = Math.floor(d / 30);
  if (m < 12) return m === 1 ? '1 месяц назад' : `${m} мес. назад`;
  const y = Math.floor(d / 365);
  return y === 1 ? '1 год назад' : `${y} г. назад`;
}


function RouteDetails({ route, detailData, mapRef, onBack, onDownload, onFork, onPhotoClick, onPoiClick, onLikesUpdate, elevationVisible, onToggleElevation }) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { role: profileRole } = useProfileStore();
  /** Админ с панели: только просмотр, без соц. действий и скачивания */
  const isAdminViewer = useAdminReadOnly();
  const [tab, setTab] = useState('overview');
  const [slideIdx, setSlideIdx] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(() => route?.likes_count ?? 0);
  const [saved, setSaved] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [sendCommentLoading, setSendCommentLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const hasSession = Boolean(user?.id || currentUserId);
  // "Гость" в БД: роль `guest` (даже если auth-сессия существует).
  // Поэтому авторизация в UI = наличие сессии + роль НЕ guest.
  const isAuthorized = hasSession && profileRole != null && profileRole !== 'guest';
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  /**
   * Жалоба: явно targetType 'route' | 'comment' и id объекта (как setTargetType / setTargetId).
   * Для маршрута в меню «⋯» всегда вызываем setReportTargetType('route') + setReportTargetId(route.id).
   */
  const [reportTargetType, setReportTargetType] = useState(null);
  const [reportTargetId, setReportTargetId] = useState(null);
  const reportRouteMenuRef = useRef(null);

  /** Смена маршрута — сбрасываем тип и id жалобы */
  useEffect(() => {
    setReportTargetType(null);
    setReportTargetId(null);
  }, [route?.id]);
  /** Автор оригинального маршрута (только если текущий — копия по parent_route_id). */
  const [parentAuthor, setParentAuthor] = useState(null);

  /** ID маршрута-источника: после миграции 21 — parent_route_id; старые строки могли иметь только parent_id. */
  const forkParentId = route?.parent_route_id ?? route?.parent_id ?? null;

  const meta = ACTIVITY_META[route?.activity_type] ?? ACTIVITY_META.foot;
  const { Icon: ActivityIcon } = meta;

  // Синхронизация счётчика лайков с маршрутом при смене маршрута
  useEffect(() => {
    setLikesCount(route?.likes_count ?? 0);
  }, [route?.id, route?.likes_count]);

  // Загрузка статуса лайка текущего пользователя
  useEffect(() => {
    if (!route?.id) return;
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/routes/${route.id}/like-status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (cancelled) return;
      const data = await res.json().catch(() => ({}));
      setLiked(!!data.liked);
    })();
    return () => { cancelled = true; };
  }, [route?.id]);

  // Загрузка статуса закладки (сохранён ли маршрут текущим пользователем)
  useEffect(() => {
    if (!route?.id) return;
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/routes/${route.id}/save-status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (cancelled) return;
      const data = await res.json().catch(() => ({}));
      setSaved(!!data.saved);
    })();
    return () => { cancelled = true; };
  }, [route?.id]);

  // Текущий пользователь — для отображения кнопки «удалить» только у своих комментариев
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setCurrentUserId(session?.user?.id ?? null);
    });
    return () => { cancelled = true; };
  }, [route?.id]);

  // Автор оригинала — для маршрутов-копий (parent_route_id или устаревший parent_id)
  useEffect(() => {
    let cancelled = false;
    if (!forkParentId) {
      setParentAuthor(null);
      return () => { cancelled = true; };
    }

    const fetchParentAuthor = async () => {
      const { data: parentRow, error: routeErr } = await supabase
        .from('routes')
        .select('author_id')
        .eq('id', forkParentId)
        .maybeSingle();

      if (cancelled) return;
      if (routeErr || !parentRow?.author_id) {
        setParentAuthor(null);
        return;
      }

      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('id, username, full_name, last_name, avatar_url')
        .eq('id', parentRow.author_id)
        .maybeSingle();

      if (cancelled) return;
      if (profileErr || !profile?.id) {
        setParentAuthor(null);
        return;
      }
      setParentAuthor(profile);
    };

    fetchParentAuthor();
    return () => { cancelled = true; };
  }, [route?.id, forkParentId]);

  // Загрузка комментариев сразу при открытии маршрута (вместе с открытием карточки; счётчик в табе корректен)
  useEffect(() => {
    if (!route?.id) return;
    setCommentsLoading(true);
    fetch(`/api/routes/${route.id}/comments`)
      .then((r) => r.json())
      .then((data) => setComments(Array.isArray(data) ? data : []))
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false));
  }, [route?.id]);

  const handleLikeClick = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      toast.error('Войдите в систему, чтобы поставить лайк');
      return;
    }
    const prevLiked = liked;
    const prevCount = likesCount;
    setLiked(!liked);
    setLikesCount((c) => (liked ? c - 1 : c + 1));
    onLikesUpdate?.(!liked, liked ? prevCount - 1 : prevCount + 1);
    try {
      const res = await fetch(`/api/routes/${route.id}/like`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      setLiked(!!data.liked);
      setLikesCount(data.likes_count ?? likesCount);
      onLikesUpdate?.(!!data.liked, data.likes_count);
    } catch (err) {
      setLiked(prevLiked);
      setLikesCount(prevCount);
      onLikesUpdate?.(prevLiked, prevCount);
      toast.error(err.message || 'Не удалось изменить лайк');
    }
  }, [route?.id, liked, likesCount, onLikesUpdate]);

  // Переключение закладки (сохранить/убрать из сохранённых). Не влияет на счётчик лайков.
  const handleSaveClick = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      toast.error('Войдите в систему, чтобы сохранить маршрут');
      return;
    }
    const prevSaved = saved;
    setSaved(!saved);
    try {
      const res = await fetch(`/api/routes/${route.id}/save`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      setSaved(!!data.saved);
    } catch (err) {
      setSaved(prevSaved);
      toast.error(err.message || 'Не удалось сохранить маршрут');
    }
  }, [route?.id, saved]);

  const handleDeleteComment = useCallback(async (commentId) => {
    if (!route?.id) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      toast.error('Войдите в систему');
      return;
    }
    try {
      const res = await fetch(`/api/routes/${route.id}/comments/${commentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Не удалось удалить');
      }
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      toast.error(err.message || 'Не удалось удалить комментарий');
    }
  }, [route?.id]);

  const handleSendComment = useCallback(async () => {
    const text = commentText.trim();
    if (!text || !route?.id) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      toast.error('Войдите в систему, чтобы оставить комментарий');
      return;
    }
    setSendCommentLoading(true);
    try {
      const res = await fetch(`/api/routes/${route.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      setComments((prev) => [...prev, data]);
      setCommentText('');
    } catch (err) {
      toast.error(err.message || 'Не удалось отправить комментарий');
    } finally {
      setSendCommentLoading(false);
    }
  }, [route?.id, commentText]);

  // Ссылка на режим Live-навигации (для QR и копирования)
  const liveNavigationUrl = route?.id
    ? `${window.location.origin}/route/${route.id}/live`
    : window.location.href;

  // Скачивание маршрута в формате GPX 1.1 с разбивкой по дням (trkseg) и опорными точками
  const downloadGPX = useCallback(() => {
    if (!isAuthorized) {
      toast.error('Войдите в систему, чтобы скачать GPX');
      return;
    }

    try {
      const gpxString = buildGpxString(route, detailData);
      const blob = new Blob([gpxString], { type: 'application/gpx+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      // Имя файла: транслитерация не нужна — браузер сам обработает UTF-8
      const fileName = `${(route?.title || 'маршрут').replace(/[\\/:*?"<>|]/g, '_')}.gpx`;
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('GPX-файл скачан');
    } catch (err) {
      console.error('[downloadGPX]', err);
      toast.error('Не удалось сформировать GPX-файл');
    }
  }, [route, detailData, isAuthorized]);

  const handleOpenQr = useCallback(() => {
    if (!isAuthorized) {
      toast.error('Войдите в систему, чтобы отправить маршрут на телефон');
      return;
    }
    setIsQrModalOpen(true);
  }, [isAuthorized]);

  // Карусель «Фотографии»: обложка + фото маршрута (route.images) + все фото всех POI
  const slides = useMemo(() => {
    const arr = [];
    if (route?.cover_image_url) arr.push({ src: route.cover_image_url, label: route.title });
    const routeImgs = Array.isArray(route?.images) ? route.images : [];
    for (const src of routeImgs) {
      if (src && typeof src === 'string') arr.push({ src: src.trim(), label: route?.title || 'Маршрут' });
    }
    for (const poi of (detailData?.pois ?? [])) {
      const urls = getPoiPhotos(poi);
      for (const src of urls) {
        if (src) arr.push({ src, label: poi.name || 'Место' });
      }
    }
    return arr;
  }, [route?.cover_image_url, route?.title, route?.images, detailData?.pois]);

  // Все фото маршрута для вкладки «Фотографии»: обложка + route.images + все фото всех меток, без дубликатов
  const allPhotos = useMemo(() => {
    const urls = [];
    if (route?.cover_image_url?.trim()) urls.push(route.cover_image_url.trim());
    const routeImgs = Array.isArray(route?.images) ? route.images : [];
    for (const src of routeImgs) {
      if (src && typeof src === 'string' && src.trim()) urls.push(src.trim());
    }
    for (const poi of (detailData?.pois ?? [])) {
      const list = getPoiPhotos(poi);
      for (const src of list) {
        if (src && typeof src === 'string' && src.trim()) urls.push(src.trim());
      }
    }
    return [...new Set(urls)];
  }, [route?.cover_image_url, route?.images, detailData?.pois]);

  // Цвет дня по его dayId
  const dayColorMap = useMemo(() => {
    const m = new Map();
    for (const seg of (detailData?.segments ?? [])) {
      m.set(seg.dayId, seg.color);
    }
    return m;
  }, [detailData?.segments]);

  // При клике по метке в списке «Места» открываем тот же попап, что и у маркера на карте
  const handlePoiClick = useCallback((poi) => {
    onPoiClick?.(poi);
  }, [onPoiClick]);

  const prevSlide = () => setSlideIdx((i) => (i - 1 + slides.length) % slides.length);
  const nextSlide = () => setSlideIdx((i) => (i + 1) % slides.length);

  const [isHeaderExpanded, setIsHeaderExpanded] = useState(true);

  /** Имя автора оригинала: 1 — username, 2 — full_name */
  const parentDisplayName = parentAuthor?.username
    ? `@${String(parentAuthor.username).trim()}`
    : parentAuthor?.full_name
      ? String(parentAuthor.full_name).trim()
      : 'Анонимный турист';

  const parentAuthorHref =
    parentAuthor?.id && user?.id && String(user.id) === String(parentAuthor.id)
      ? '/profile'
      : `/user/${parentAuthor?.id ?? ''}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-neutral-100">

      {/* ── Шапка: кнопка «Назад» всегда видна ─────────────────────────── */}
      <div className="shrink-0 bg-white">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-4 pt-4 pb-2 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Назад к списку
        </button>

        {/* Сворачиваемый блок: карусель + заголовок с лайком */}
        <div
          className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
          style={{ maxHeight: isHeaderExpanded ? 320 : 0 }}
        >
          {/* Карусель: клик по фото открывает Lightbox */}
          <div className="relative h-44 w-full overflow-hidden bg-neutral-100">
            {slides.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => onPhotoClick?.(allPhotos, slideIdx)}
                  className="h-full w-full cursor-pointer border-0 bg-transparent p-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <img
                    key={slideIdx}
                    src={slides[slideIdx].src}
                    alt={slides[slideIdx].label ?? ''}
                    className="h-full w-full object-cover transition-opacity duration-300"
                  />
                </button>
                {slides.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={prevSlide}
                      className="absolute left-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={nextSlide}
                      className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
                      {slides.map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setSlideIdx(i)}
                          className={`h-1.5 rounded-full transition-all ${i === slideIdx ? 'w-4 bg-white' : 'w-1.5 bg-white/50'}`}
                        />
                      ))}
                    </div>
                  </>
                )}
            {/* Кнопка «Свернуть» поверх фото (правый верхний угол) — не занимает отдельную строку */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setIsHeaderExpanded(false); }}
              className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-black/40 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              title="Свернуть фото и заголовок"
            >
              <ChevronUp className="h-3.5 w-3.5" />
              <span>Свернуть</span>
            </button>
              </>
            ) : (
              <div className="flex h-full items-center justify-center bg-gray-300">
                <ImageIcon className="h-12 w-12 text-gray-500" />
              </div>
            )}
            {/* Кнопка «Свернуть» при пустой карусели (плейсхолдер) */}
            {slides.length === 0 && (
              <button
                type="button"
                onClick={() => setIsHeaderExpanded(false)}
                className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1.5 text-xs font-medium text-neutral-700 backdrop-blur-sm hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                title="Свернуть"
              >
                <ChevronUp className="h-3.5 w-3.5" />
                <span>Свернуть</span>
              </button>
            )}
          </div>

          {/* Заголовок и лайк */}
          <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="flex-1 min-w-0">
                <h2 className="break-words text-xl font-bold leading-tight text-neutral-900">
                  {route?.title || 'Без названия'}
                </h2>
              </div>
              {forkParentId && parentAuthor?.id && (
                <div className="mb-3 mt-1 flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500 dark:bg-neutral-800 dark:text-neutral-400">
                    <Copy className="h-3 w-3 shrink-0" aria-hidden />
                    Копия маршрута
                  </span>
                  <span className="text-sm text-gray-500 dark:text-neutral-400">
                    Оригинал:{' '}
                    <Link
                      to={parentAuthorHref}
                      className="font-medium text-blue-500 hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {parentDisplayName}
                    </Link>
                  </span>
                </div>
              )}
              {route?.author_id ? (
                <Link
                  to={currentUserId && String(currentUserId) === String(route.author_id) ? '/profile' : `/user/${route.author_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1 flex min-w-0 max-w-full items-center gap-2 rounded-md py-0.5 text-xs text-neutral-600 transition-colors hover:text-neutral-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-200">
                    {getRouteAuthorAvatar(route) ? (
                      <img src={getRouteAuthorAvatar(route)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <User className="h-3.5 w-3.5 text-neutral-500" />
                    )}
                  </span>
                  <span className="min-w-0 truncate font-medium">{getRouteAuthorLabel(route)}</span>
                </Link>
              ) : (
                <p className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
                  <User className="h-3 w-3 shrink-0" />
                  {getRouteAuthorLabel(route)}
                </p>
              )}
              {route?.created_at && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
                  <Calendar className="h-3 w-3" />
                  Создан: {formatCreatedDate(route.created_at)}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2 self-start">
              {isAdminViewer ? (
                <div className="flex items-center gap-2 rounded-full border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm text-neutral-500">
                  <Heart className="h-5 w-5 text-neutral-400" strokeWidth={2} />
                  <span>{likesCount}</span>
                </div>
              ) : (
                <>
                  {/* Лайк: влияет на счётчик лайков маршрута (таблица route_likes) */}
                  <button
                    type="button"
                    onClick={handleLikeClick}
                    className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    title={liked ? 'Убрать лайк' : 'Нравится'}
                  >
                    <Heart
                      className={`h-5 w-5 ${liked ? 'fill-red-500 text-red-500' : ''}`}
                      strokeWidth={2}
                    />
                    <span>{likesCount}</span>
                  </button>
                  {/* Сохранить в закладки: личный список (таблица saved_routes), не влияет на лайки */}
                  <button
                    type="button"
                    onClick={handleSaveClick}
                    className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    title={saved ? 'Убрать из сохранённых' : 'Сохранить'}
                  >
                    <Bookmark
                      className={`h-5 w-5 ${saved ? 'fill-amber-500 text-amber-500' : ''}`}
                      strokeWidth={2}
                    />
                  </button>
                </>
              )}
              {!isAdminViewer && currentUserId && route?.author_id && String(currentUserId) !== String(route.author_id) && (
                <details
                  ref={reportRouteMenuRef}
                  className="relative shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <summary
                    className="list-none flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 transition-colors hover:bg-neutral-50 [&::-webkit-details-marker]:hidden"
                    title="Ещё"
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </summary>
                  <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-neutral-200 bg-white p-1 shadow-lg">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-100"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (reportRouteMenuRef.current) reportRouteMenuRef.current.open = false;
                        if (!route?.id) {
                          toast.error('Не удалось определить маршрут');
                          return;
                        }
                        setReportTargetType('route');
                        setReportTargetId(String(route.id));
                      }}
                    >
                      <Flag className="h-4 w-4 shrink-0 text-amber-600" strokeWidth={2} aria-hidden />
                      Пожаловаться
                    </button>
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>

        {/* Компактная кнопка «Развернуть» только когда шапка свёрнута */}
        {!isHeaderExpanded && (
          <div className="flex justify-center border-b border-neutral-200 bg-white py-1.5">
            <button
              type="button"
              onClick={() => setIsHeaderExpanded(true)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              title="Развернуть фото и заголовок"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              <span>Развернуть</span>
            </button>
          </div>
        )}

        {/* Вкладки: горизонтальный скролл при нехватке ширины */}
        <div className="flex border-b border-neutral-200 overflow-x-auto overflow-y-hidden px-4 [&::-webkit-scrollbar]:h-0">
          {['overview', 'places', 'photos', 'comments'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={[
                'whitespace-nowrap pb-2.5 pt-1 mr-5 text-[13px] font-medium border-b-2 transition-colors',
                tab === t
                  ? 'border-primary text-neutral-900'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700',
              ].join(' ')}
            >
              {t === 'overview' && 'Обзор'}
              {t === 'places' && `Места${(detailData?.pois?.length ?? 0) > 0 ? ` (${detailData.pois.length})` : ''}`}
              {t === 'photos' && `Фотографии (${allPhotos.length})`}
              {t === 'comments' && `Комментарии (${comments.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* ── Тело вкладки ──────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

        {tab === 'overview' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {route?.description && (
              <p className="text-sm leading-relaxed text-neutral-600">{route.description}</p>
            )}

            {/* Статистика */}
            <div className="grid grid-cols-2 gap-2">
              <StatBlock icon={<Ruler className="h-4 w-4 text-neutral-500" />} label="Расстояние" value={formatDistance(route?.total_distance ?? route?.distance)} />
              <StatBlock icon={<Clock className="h-4 w-4 text-neutral-500" />} label="Время" value={formatDuration(route?.duration)} />
              <StatBlock icon={<TrendingUp className="h-4 w-4 text-neutral-500" />} label="Набор высоты" value={formatElevation(route?.total_elevation)} />
              <StatBlock
                icon={<ActivityIcon className={`h-4 w-4 ${meta.color}`} />}
                label="Тип активности"
                value={meta.label}
              />
            </div>

            {/* График покрытий дороги */}
            {route?.surfaces_json && (
              <SurfacesBar
                surfaces={route.surfaces_json}
                totalDistanceKm={
                  (route?.total_distance ?? route?.distance) != null
                    ? Number(route.total_distance ?? route.distance) / 1000
                    : null
                }
              />
            )}

            {/* Разбивка по дням */}
            {(detailData?.segments?.length ?? 0) > 0 && (
              <DaySegmentsList segments={detailData.segments} />
            )}

            {/* Кнопка профиля высот */}
            {route?.elevation_json?.length > 0 && (
              <button
                type="button"
                onClick={onToggleElevation}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
              >
                <span className="flex items-center gap-2">
                  <Mountain className="h-4 w-4 text-neutral-400" />
                  Профиль высот
                </span>
                {elevationVisible
                  ? <ChevronDown className="h-4 w-4 text-neutral-400" />
                  : <ChevronUp className="h-4 w-4 text-neutral-400" />
                }
              </button>
            )}
          </div>
        )}

        {tab === 'places' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {((detailData?.pois)?.length ?? 0) === 0 ? (
              <div className="py-12 text-center">
                <MapPin className="mx-auto mb-3 h-8 w-8 text-neutral-300" />
                <p className="text-sm text-neutral-500">В этом маршруте нет отмеченных мест</p>
              </div>
            ) : (
              (detailData?.pois ?? []).map((poi, idx) => (
                <PoiCard
                  key={poi?.id ?? `poi-${idx}`}
                  poi={poi}
                  onClick={() => handlePoiClick(poi)}
                  onPhotoClick={(p) => onPhotoClick?.(getPoiPhotos(p), 0)}
                />
              ))
            )}
          </div>
        )}

        {tab === 'photos' && (
          <div className="flex-1 overflow-y-auto p-4">
            {allPhotos.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {allPhotos.map((src, i) => (
                  <button
                    key={`${src}-${i}`}
                    type="button"
                    onClick={() => onPhotoClick?.(allPhotos, i)}
                    className="aspect-square rounded-xl overflow-hidden bg-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    <img
                      src={src}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-4 rounded-2xl bg-neutral-50 border border-neutral-100">
                <Camera className="h-14 w-14 text-neutral-300 mb-4" />
                <p className="text-sm text-neutral-500 text-center">
                  К этому маршруту пока не добавлено ни одной фотографии
                </p>
              </div>
            )}
          </div>
        )}

        {tab === 'comments' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto pb-4 pt-4 px-4">
              {commentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
                </div>
              ) : comments.length === 0 ? (
                <p className="py-8 text-center text-sm text-neutral-500">Пока нет комментариев. Будьте первым!</p>
              ) : (
                <ul className="space-y-4">
                  {comments.map((commentRow) => (
                    <li key={commentRow.id} className="relative flex gap-3 pr-8">
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-neutral-200">
                        {commentRow.author_avatar_url ? (
                          <img src={commentRow.author_avatar_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-sm font-medium text-neutral-500">
                            {(commentRow.author_name || '?').charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-neutral-500">
                          <span className="font-medium text-neutral-700">{commentRow.author_name || 'Пользователь'}</span>
                          <span>·</span>
                          <span>{formatRelativeDate(commentRow.created_at)}</span>
                        </div>
                        <p className="mt-0.5 text-sm text-neutral-700 leading-snug">{commentRow.text}</p>
                      </div>
                      {currentUserId && !isAdminViewer && String(commentRow.author_id) === String(currentUserId) && (
                        <button
                          type="button"
                          onClick={() => handleDeleteComment(commentRow.id)}
                          className="absolute top-0 right-0 p-1 text-gray-400 hover:text-red-500 transition-colors"
                          title="Удалить комментарий"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                      {currentUserId && !isAdminViewer && String(commentRow.author_id) !== String(currentUserId) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Жалоба на комментарий: в модалку — СТРОГО PK route_comments (поле id в API), не author_id / не route.id
                            const commentUuid = String(commentRow.id ?? '').trim();
                            if (!commentUuid) {
                              toast.error('Не удалось определить комментарий');
                              return;
                            }
                            if (String(commentRow.author_id ?? '') === commentUuid) {
                              console.error('BUG: id комментария совпал с author_id — проверьте API /api/routes/.../comments');
                              toast.error('Некорректные данные комментария');
                              return;
                            }
                            if (route?.id != null && commentUuid === String(route.id)) {
                              toast.error('Ошибка: передан идентификатор маршрута вместо комментария');
                              return;
                            }
                            console.log('🔥 Жалоба на комментарий, commentRow.id (PK):', commentRow.id);
                            setReportTargetType('comment');
                            setReportTargetId(commentUuid);
                          }}
                          className="absolute top-0 right-0 p-1 text-gray-400 transition-colors hover:text-amber-600"
                          title="Пожаловаться на комментарий"
                        >
                          <Flag className="h-4 w-4" strokeWidth={2} aria-hidden />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {!isAdminViewer ? (
              <div className="shrink-0 border-t border-neutral-200 bg-white pt-2 mt-auto px-4 pb-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSendComment(); } }}
                    placeholder="Написать комментарий..."
                    className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                  <button
                    type="button"
                    onClick={handleSendComment}
                    disabled={sendCommentLoading || !commentText.trim()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                    title="Отправить"
                  >
                    {sendCommentLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Панель действий (для админа — скрыта, только просмотр) ───── */}
      {!isAdminViewer ? (
        <div className="shrink-0 border-t border-neutral-200 bg-white p-4">
          <div className="flex flex-col gap-3">
            {/* Live-навигация: карта на весь экран с GPS */}
            <button
              type="button"
              onClick={() => navigate(`/route/${route?.id}/live`)}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-base font-semibold text-neutral-900 shadow-md transition-colors hover:bg-amber-600 md:hidden"
              title="Открыть режим навигации: карта на весь экран, GPS-позиция в реальном времени"
            >
              <Navigation className="h-5 w-5" />
              Начать маршрут
            </button>

            <div className="grid grid-cols-2 gap-2">
              {/* Скачать GPX: генерирует файл трека с разбивкой по дням и опорными точками */}
              <button
                type="button"
                onClick={downloadGPX}
                disabled={!isAuthorized}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
                title={isAuthorized ? 'Скачать файл маршрута в формате GPX для навигатора или приложения' : 'Войдите в систему, чтобы скачать GPX'}
              >
                <Download className="h-4 w-4" />
                Скачать GPX
              </button>

              {/* На телефон: открывает QR-код с URL текущей страницы */}
              <button
                type="button"
                onClick={handleOpenQr}
                disabled={!isAuthorized}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
                title={isAuthorized ? 'Открыть QR-код для отправки маршрута на телефон' : 'Войдите в систему, чтобы отправить маршрут на телефон'}
              >
                <Smartphone className="h-4 w-4" />
                На телефон
              </button>

              <button
                type="button"
                onClick={handleSaveClick}
                disabled={!isAuthorized}
                className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                  saved
                    ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                    : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                title={isAuthorized ? undefined : 'Войдите в систему, чтобы сохранить маршрут'}
              >
                <Bookmark className={`h-4 w-4 ${saved ? 'fill-amber-500 text-amber-500' : ''}`} strokeWidth={2} />
                {saved ? 'В сохранённых' : 'Сохранить'}
              </button>

              {/* Кнопка меняется в зависимости от авторства маршрута:
                  — Своё: переход в конструктор для редактирования
                  — Чужое: переход в конструктор для создания копии (fork) */}
              {(currentUserId ?? user?.id) && String(currentUserId ?? user?.id) === String(route?.author_id) ? (
                <button
                  type="button"
                  onClick={() => navigate(`/constructor/${route.id}`)}
                  disabled={!isAuthorized}
                  className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors ${
                    isAuthorized ? 'hover:bg-black' : 'cursor-not-allowed opacity-50'
                  }`}
                >
                  <Pencil className="h-4 w-4" />
                  Редактировать
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (!isAuthorized) return;
                    onFork?.();
                  }}
                  disabled={!isAuthorized}
                  className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-neutral-900 transition-colors ${
                    isAuthorized ? 'hover:bg-amber-600' : 'cursor-not-allowed opacity-50 hover:bg-amber-500'
                  }`}
                  title={isAuthorized ? undefined : 'Войдите в систему, чтобы сделать копию маршрута'}
                >
                  <GitFork className="h-4 w-4" />
                  Сделать на основе
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Модальное окно QR-кода ──────────────────────────────────── */}
      <QrModal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        url={liveNavigationUrl}
      />

      <ReportModal
        key={
          reportTargetType && reportTargetId
            ? `report-${reportTargetType}-${reportTargetId}`
            : 'report-closed'
        }
        isOpen={reportTargetType != null && reportTargetId != null}
        onClose={() => {
          setReportTargetType(null);
          setReportTargetId(null);
        }}
        targetType={reportTargetType}
        targetId={reportTargetId}
      />
    </div>
  );
}

// ─── Маленький блок статистики ────────────────────────────────────────────────

function StatBlock({ icon, label, value }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 shadow-sm">
      {icon}
      <div>
        <p className="text-xs text-neutral-500">{label}</p>
        <p className="font-semibold text-sm text-neutral-800">{value}</p>
      </div>
    </div>
  );
}

// ─── Иконка-линия для типа покрытия (сплошная / пунктир / контур) ─────────────

function SurfaceLineIcon({ lineStyle }) {
  const base = 'h-1.5 w-8 flex-shrink-0 rounded-sm';
  if (lineStyle === 'solid') {
    return <div className={`${base} bg-neutral-700`} title="Твёрдое покрытие" />;
  }
  if (lineStyle === 'dashed') {
    return (
      <div className={`${base} border-2 border-neutral-400 border-dashed bg-transparent`} title="Грунт" />
    );
  }
  return (
    <div className={`${base} border border-neutral-300 bg-white`} title="Неизвестно" />
  );
}

// ─── Блок покрытий: прогресс-бар + компактный список ──────────────────────────

/**
 * Данные surfaces: { paved: { pct, distKm }, unpaved: { pct, distKm }, unknown: { pct, distKm } }
 * Километраж берётся из surfaces[key].distKm; при отсутствии — из доли процента и общей длины.
 */
function SurfacesBar({ surfaces, totalDistanceKm }) {
  if (!surfaces) return null;

  const sumKm = Number(surfaces.paved?.distKm ?? 0) + Number(surfaces.unpaved?.distKm ?? 0) + Number(surfaces.unknown?.distKm ?? 0);
  const totalKm = totalDistanceKm ?? (sumKm > 0 ? sumKm : null);

  const segments = Object.entries(SURFACE_META)
    .map(([key, meta]) => {
      const pct = Number(surfaces[key]?.pct ?? 0);
      let distKm = Number(surfaces[key]?.distKm ?? 0);
      if (distKm === 0 && pct > 0 && totalKm > 0) {
        distKm = Math.round((totalKm * pct) / 100 * 10) / 10;
      }
      return { key, ...meta, pct, distKm };
    })
    .filter((s) => s.pct > 0);

  if (!segments.length) return null;

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Покрытие
      </p>

      {/* Горизонтальная полоска: h-2 rounded-full overflow-hidden flex */}
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        {segments.map((s) => (
          <div
            key={s.key}
            className="h-full flex-shrink-0"
            style={{
              width: `${s.pct}%`,
              backgroundColor: s.color,
              border: s.borderColor ? `2px solid ${s.borderColor}` : 'none',
            }}
            title={`${s.label}: ${s.pct}%`}
          />
        ))}
      </div>

      {/* Компактный вертикальный список */}
      <div className="mt-3 flex flex-col gap-2">
        {segments.map((s) => (
          <div
            key={s.key}
            className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white py-1.5 px-3 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <SurfaceLineIcon lineStyle={s.lineStyle} />
              <div>
                <p className="text-sm font-medium text-neutral-800">{s.label}</p>
                <p className="text-xs text-gray-500">{s.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-neutral-600">{s.distKm > 0 ? `${s.distKm} км` : '—'}</span>
              <span className="font-semibold text-neutral-900">{s.pct}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Список дней маршрута ─────────────────────────────────────────

/**
 * Карточки дней с километражом и набором высоты.
 * Данные segments: [{ dayId, dayTitle, color, distance, elevation_gain }]
 */
function DaySegmentsList({ segments }) {
  if (!segments?.length) return null;

  const totalDays = segments.length;

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {totalDays === 1 ? 'Маршрут' : `По дням (${totalDays} дн.)`}
      </p>
      <div className="space-y-1.5">
        {segments.map((seg, idx) => {
          const distKm = seg.distance ? (Number(seg.distance) / 1000).toFixed(1) : null;
          const gainM  = seg.elevation_gain ? Math.round(Number(seg.elevation_gain)) : null;
          return (
            <div
              key={seg.dayId}
              className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 shadow-sm"
            >
              <span
                className="h-3.5 w-3.5 flex-shrink-0 rounded-sm"
                style={{ backgroundColor: seg.color }}
              />
              <span className="flex-1 text-sm font-medium text-neutral-700">
                {totalDays === 1 ? (seg.dayTitle || 'Маршрут') : (seg.dayTitle || `День ${idx + 1}`)}
              </span>
              <div className="flex items-center gap-3 text-xs text-neutral-500">
                {distKm && (
                  <span className="flex items-center gap-1">
                    <Ruler className="h-3 w-3" />
                    {distKm} км
                  </span>
                )}
                {gainM > 0 && (
                  <span className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    ↑{gainM} м
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── SVG-иконки для маркеров на карте поиска ─────────────────────────────────

const ICON_SVG = {
  foot: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>',
  bike: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/><path d="m12 17.5-2-4 4-3 2 3"/><path d="m9 8 3-2 4 2"/></svg>',
  car:  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
};

// ─── Главный компонент страницы ───────────────────────────────────────────────

export default function SearchRoutesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const openedFromAdminList = Boolean(location.state?.fromAdminList);
  const openedFromAdminReports = Boolean(location.state?.fromAdminReports);

  const [routes,            setRoutes]            = useState([]);
  const [search,            setSearch]            = useState('');
  const [isFiltersOpen,     setIsFiltersOpen]     = useState(false);
  const [sortBy,            setSortBy]            = useState('newest');
  const [filterType,        setFilterType]        = useState('all');
  const [filterMinDistance, setFilterMinDistance] = useState('');
  const [filterMaxDistance, setFilterMaxDistance] = useState('');
  const [mapBounds, setMapBounds] = useState(null);
  const [hoveredRouteId,  setHoveredRouteId]  = useState(null);
  const [loading,         setLoading]         = useState(true);
  const [selectedId,      setSelectedId]      = useState(null);
  const [selectedRoute,   setSelectedRoute]   = useState(null);
  const [detailData,      setDetailData]      = useState({ points: [], pois: [], segments: [] });
  const [detailsError,    setDetailsError]    = useState(null);
  const [geometryLoading, setGeometryLoading] = useState(false);
  const [mapReady,        setMapReady]        = useState(false);
  const [pageError,       setPageError]       = useState(null);
  const [lightboxOpen,     setLightboxOpen]    = useState(false);
  const [lightboxPhotos,   setLightboxPhotos] = useState([]);
  const [lightboxIndex,    setLightboxIndex]  = useState(0);
  const [elevationVisible, setElevationVisible] = useState(false);
  /** Точка на карте, синхронизированная с наведением на график высот (бегающая точка). */
  const [hoveredLocation, setHoveredLocation] = useState(null);

  const startMarkerRef    = useRef(null);
  const finishMarkerRef   = useRef(null);
  const hoverCircleRef    = useRef(null);
  const junctionMarkersRef = useRef([]);

  const openLightboxRef    = useRef(null);

  const mapDivRef          = useRef(null);
  const mapRef             = useRef(null);
  const currentTileLayerRef = useRef(null);
  const clusterGroupRef    = useRef(null);       // L.MarkerClusterGroup, когда selectedRoute === null
  const markersRef         = useRef(new Map()); // маркеры старта (в кластере или нет)
  const activePolylinesRef = useRef([]);
  const poisMarkersRef     = useRef(new Map());

  const { activeLayer, setActiveLayer } = useRouteStore();
  const { role, loadProfile, profileUserId } = useProfileStore();
  const [expandedSection, setExpandedSection] = useState(null);

  const { user: authUser } = useAuthStore();

  // Роль профиля нужна, чтобы админ мог открыть по ссылке приватный маршрут (?route=id)
  useEffect(() => {
    if (authUser?.id && profileUserId !== authUser.id) {
      loadProfile(authUser.id);
    }
  }, [authUser?.id, profileUserId, loadProfile]);

  // Отключаем скролл страницы (класс на html — стили в index.css)
  useEffect(() => {
    document.documentElement.classList.add('search-page-no-scroll');
    return () => document.documentElement.classList.remove('search-page-no-scroll');
  }, []);

  const onSidebarResizeEnd = useCallback(() => {
    mapRef.current?.invalidateSize?.();
  }, []);
  const { sidebarStyle, handleMouseDown: handleSidebarResizeStart } = useResizableSidebar({
    initialWidth: 400,
    minWidth: 320,
    maxWidth: 800,
    onResizeEnd: onSidebarResizeEnd,
  });

  // ── Инициализация карты ──────────────────────────────────────────────────

  // Центр и зум — как в конструкторе (RouteMap)
  const MAP_CENTER = [55.751244, 37.618423];
  const MAP_ZOOM = 10;

  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    try {
      const map = L.map(mapDivRef.current, { center: MAP_CENTER, zoom: MAP_ZOOM });
      const layerId = useRouteStore.getState().activeLayer ?? 'standard';
      const layerConfig = MAP_LAYERS[layerId] ?? MAP_LAYERS.standard;
      const tileLayer = L.tileLayer(layerConfig.url, {
        attribution: layerConfig.attribution,
        maxZoom: layerConfig.maxZoom ?? 19,
      }).addTo(map);
      currentTileLayerRef.current = tileLayer;
      mapRef.current = map;
      setMapReady(true);
    } catch (err) {
      console.error('[SearchRoutesPage] map init:', err);
      setPageError(err?.message || 'Ошибка инициализации карты');
    }
    return () => {
      currentTileLayerRef.current = null;
      if (clusterGroupRef.current && mapRef.current) {
        try { mapRef.current.removeLayer(clusterGroupRef.current); } catch (_) {}
        clusterGroupRef.current = null;
      }
      markersRef.current.clear();
      poisMarkersRef.current.forEach((m) => m.remove());
      poisMarkersRef.current.clear();
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch (_) {}
        mapRef.current = null;
      }
      setMapReady(false);
    };
  }, []);

  // Синхронизация слоя карты с выбором в панели (как в конструкторе)
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !currentTileLayerRef.current) return;
    const layerConfig = MAP_LAYERS[activeLayer] ?? MAP_LAYERS.standard;
    map.removeLayer(currentTileLayerRef.current);
    const tileLayer = L.tileLayer(layerConfig.url, {
      attribution: layerConfig.attribution,
      maxZoom: layerConfig.maxZoom ?? 19,
    }).addTo(map);
    currentTileLayerRef.current = tileLayer;
  }, [mapReady, activeLayer]);

  // Отслеживание видимой области карты (для фильтра по границам)
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const updateBounds = () => setMapBounds(map.getBounds());
    updateBounds();
    map.on('moveend', updateBounds);
    map.on('zoomend', updateBounds);
    return () => {
      map.off('moveend', updateBounds);
      map.off('zoomend', updateBounds);
    };
  }, [mapReady]);

  // Открытие Lightbox из попапа метки (клик по миниатюре в HTML)
  useEffect(() => {
    openLightboxRef.current = (photos, index) => {
      setLightboxPhotos(Array.isArray(photos) ? photos : []);
      setLightboxIndex(Math.max(0, Math.min(index, (photos?.length ?? 1) - 1)));
      setLightboxOpen(true);
    };
    const handleDocClick = (e) => {
      const btn = e.target.closest('.poi-lightbox-thumb');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const photosJson = btn.getAttribute('data-photos');
        const indexStr = btn.getAttribute('data-index');
        const photos = photosJson ? JSON.parse(photosJson) : [];
        const index = parseInt(indexStr || '0', 10);
        openLightboxRef.current?.(photos, index);
      } catch (_) {}
    };
    document.addEventListener('click', handleDocClick, true);
    return () => document.removeEventListener('click', handleDocClick, true);
  }, []);

  // ── Загрузка списка маршрутов ────────────────────────────────────────────

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/routes/public');
        if (!res.ok) throw new Error(`Ошибка ${res.status}`);
        const data = await res.json();
        setRoutes(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('[SearchRoutesPage] routes:', err);
        toast.error('Не удалось загрузить маршруты');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // ── Фильтрация и сортировка (один useMemo для списка и карты) ─────────────

  const filteredAndSortedRoutes = useMemo(() => {
    let list = [...routes];

    // Поиск по названию, описанию и названиям мест (POI)
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => {
        if ((r.title || '').toLowerCase().includes(q)) return true;
        if ((r.description || '').toLowerCase().includes(q)) return true;
        const pois = Array.isArray(r.pois) ? r.pois : [];
        if (pois.some((p) => (p?.name || '').toLowerCase().includes(q))) return true;
        return false;
      });
    }

    // По типу передвижения
    if (filterType !== 'all') {
      list = list.filter((r) => r.activity_type === filterType);
    }

    // По видимой области карты: старт маршрута должен попадать в bounds
    if (mapBounds != null) {
      list = list.filter((r) => {
        const lat = r.start_lat;
        const lng = r.start_lng ?? r.start_lon;
        if (lat == null || lng == null) return false;
        try {
          return mapBounds.contains(L.latLng(lat, lng));
        } catch {
          return false;
        }
      });
    }

    // По расстоянию (км): total_distance в БД в метрах
    const minM = filterMinDistance !== '' && Number(filterMinDistance) >= 0 ? Number(filterMinDistance) * 1000 : null;
    const maxM = filterMaxDistance !== '' && Number(filterMaxDistance) >= 0 ? Number(filterMaxDistance) * 1000 : null;
    if (minM != null || maxM != null) {
      list = list.filter((r) => {
        const d = r.total_distance ?? r.distance ?? 0;
        if (minM != null && d < minM) return false;
        if (maxM != null && d > maxM) return false;
        return true;
      });
    }

    // Сортировка
    const getDistance = (r) => r.total_distance ?? r.distance ?? 0;
    if (sortBy === 'newest') {
      list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    } else if (sortBy === 'popular') {
      list.sort((a, b) => (b.likes_count ?? 0) - (a.likes_count ?? 0));
    } else if (sortBy === 'shortest') {
      list.sort((a, b) => getDistance(a) - getDistance(b));
    } else if (sortBy === 'longest') {
      list.sort((a, b) => getDistance(b) - getDistance(a));
    }

    return list;
  }, [routes, search, filterType, filterMinDistance, filterMaxDistance, sortBy, mapBounds]);

  // ── Очистка карты при возврате к списку ──────────────────────────────────

  const cleanupMap = useCallback(() => {
    activePolylinesRef.current.forEach((pl) => { try { pl.remove(); } catch (_) {} });
    activePolylinesRef.current = [];
    poisMarkersRef.current.forEach((m) => { try { m.remove(); } catch (_) {} });
    poisMarkersRef.current.clear();
    // Удаляем маркеры Старт/Финиш
    if (startMarkerRef.current)  { try { startMarkerRef.current.remove();  } catch (_) {} startMarkerRef.current  = null; }
    if (finishMarkerRef.current) { try { finishMarkerRef.current.remove(); } catch (_) {} finishMarkerRef.current = null; }
    if (hoverCircleRef.current)  { try { hoverCircleRef.current.remove();  } catch (_) {} hoverCircleRef.current  = null; }
    junctionMarkersRef.current.forEach((m) => { try { m.remove(); } catch (_) {} });
    junctionMarkersRef.current = [];
    if (mapRef.current) {
      try { mapRef.current.closePopup(); } catch (_) {}
    }
  }, []);

  /** Удаляет слой кластеров и все стартовые маркеры с карты (при открытии деталей маршрута). */
  const removeClusterGroup = useCallback(() => {
    const map = mapRef.current;
    if (clusterGroupRef.current && map) {
      try { map.removeLayer(clusterGroupRef.current); } catch (_) {}
      clusterGroupRef.current = null;
    }
    markersRef.current.forEach((marker) => {
      try { mapRef.current?.removeLayer(marker); } catch (_) {}
    });
    markersRef.current.clear();
  }, []);

  // ── Выбор маршрута: загрузка деталей + отрисовка ─────────────────────────

  const handleSelectRoute = useCallback(async (id, routeObject) => {
    const map = mapRef.current;
    if (!map) return;

    cleanupMap();
    removeClusterGroup();
    setDetailsError(null);

    const route = routeObject ?? routes.find((r) => r.id === id);
    setSelectedId(id);
    setSelectedRoute(route ?? null);
    setDetailData({ points: [], pois: [], segments: [] });

    setElevationVisible(false);
    setGeometryLoading(true);
    try {
      const headers = {};
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      const res = await fetch(`/api/routes/${id}/details`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Ошибка ${res.status}`);
      }
      const data = await res.json();

      const points = Array.isArray(data.points) ? data.points : [];
      const pois   = Array.isArray(data.pois)   ? data.pois   : [];

      setDetailsError(null);
      setSelectedRoute((prev) => ({ ...(prev ?? {}), ...data }));
      setDetailData({ points, pois, segments: [] });

      // Строим линии из points для отрисовки (группировка по day_id, цвет по индексу дня)
      const byDay = new Map();
      for (const p of points) {
        if (!byDay.has(p.day_id)) byDay.set(p.day_id, []);
        byDay.get(p.day_id).push([p.lat, p.lng]);
      }
      const dayIdsOrdered = [...new Map(points.map((p) => [p.day_id, p.day_number])).entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([dayId]) => dayId);

      // Используем данные о днях (distance, elevation_gain) из API для разбивки по дням
      const apiDaysMap = new Map((data.days ?? []).map((d) => [d.id, d]));

      const segments = dayIdsOrdered.map((dayId, i) => {
        const apiDay = apiDaysMap.get(dayId) ?? {};
        return {
          dayId,
          dayTitle:       apiDay.title || `День ${i + 1}`,
          color:          DAY_COLORS[i % DAY_COLORS.length],
          coordinates:    byDay.get(dayId) ?? [],
          distance:       apiDay.distance ?? 0,
          elevation_gain: apiDay.elevation_gain ?? 0,
        };
      });

      setDetailData((prev) => ({ ...prev, segments }));

      const routeSegmentsJson = data.route_segments_json;
      const allCoords = [];

      if (Array.isArray(routeSegmentsJson) && routeSegmentsJson.length > 0) {
        // ── Отрисовка по покрытиям (как в конструкторе): белая обводка + разноцветные отрезки по surfaceData ──
        for (const seg of routeSegmentsJson) {
          const path = seg.path ?? [];
          const surfaceData = seg.surfaceData ?? [];
          const dayColor = seg.dayColor ?? '#3b82f6';
          if (path.length < 2) continue;

          const outline = L.polyline(path, {
            color:    '#ffffff',
            weight:   8,
            opacity:  0.85,
            lineCap:  'round',
            lineJoin: 'round',
          }).addTo(map);
          activePolylinesRef.current.push(outline);

          if (surfaceData.length > 0) {
            for (const [startIdx, endIdx, surfaceId] of surfaceData) {
              const subPath = path.slice(startIdx, endIdx + 1);
              if (subPath.length < 2) continue;
              const layers = getSurfaceLayers(surfaceId, dayColor, false);
              for (const opts of layers) {
                const line = L.polyline(subPath, {
                  color:     opts.color,
                  weight:    opts.weight,
                  opacity:   opts.opacity ?? 1,
                  lineCap:   opts.lineCap ?? 'round',
                  lineJoin:  opts.lineJoin ?? 'round',
                  dashArray: opts.dashArray,
                }).addTo(map);
                activePolylinesRef.current.push(line);
              }
            }
          } else {
            const line = L.polyline(path, {
              color:    dayColor,
              weight:   5,
              opacity:  1,
              lineCap:  'round',
              lineJoin: 'round',
            }).addTo(map);
            activePolylinesRef.current.push(line);
          }
          allCoords.push(...path);
        }
      } else {
        // Фолбэк: отрисовка по дням (белая обводка + цвет дня)
        for (const seg of segments) {
          if (seg.coordinates.length < 2) continue;
          const outline = L.polyline(seg.coordinates, {
            color:    '#ffffff',
            weight:   8,
            opacity:  0.85,
            lineCap:  'round',
            lineJoin: 'round',
          }).addTo(map);
          const line = L.polyline(seg.coordinates, {
            color:    seg.color,
            weight:   5,
            opacity:  1,
            lineCap:  'round',
            lineJoin: 'round',
          }).addTo(map);
          activePolylinesRef.current.push(outline, line);
          allCoords.push(...seg.coordinates);
        }
      }

      if (allCoords.length > 0) {
        map.fitBounds(L.latLngBounds(allCoords), { padding: [48, 48] });

        // ── Маркеры Старт и Финиш (уменьшенные: зелёный и красный кружки с белой обводкой) ──
        const [startLat, startLng]   = allCoords[0];
        const [finishLat, finishLng] = allCoords[allCoords.length - 1];

        const startIcon = L.divIcon({
          html: `<div style="
            width:20px;height:20px;border-radius:50%;
            background:#16a34a;border:2px solid white;
            box-shadow:0 1px 4px rgba(0,0,0,0.35);
          "></div>`,
          className:  '',
          iconSize:   [20, 20],
          iconAnchor: [10, 10],
        });

        const finishIcon = L.divIcon({
          html: `<div style="
            width:20px;height:20px;border-radius:50%;
            background:#dc2626;border:2px solid white;
            box-shadow:0 1px 4px rgba(0,0,0,0.35);
          "></div>`,
          className:  '',
          iconSize:   [20, 20],
          iconAnchor: [10, 10],
        });

        if (startMarkerRef.current)  { try { startMarkerRef.current.remove();  } catch (_) {} }
        if (finishMarkerRef.current) { try { finishMarkerRef.current.remove(); } catch (_) {} }

        startMarkerRef.current = L.marker([startLat, startLng], { icon: startIcon, zIndexOffset: 500 })
          .bindTooltip('Старт', { permanent: false, direction: 'top', offset: [0, -6] })
          .addTo(map);

        const isSamePoint = Math.abs(startLat - finishLat) < 1e-6 && Math.abs(startLng - finishLng) < 1e-6;
        if (!isSamePoint) {
          finishMarkerRef.current = L.marker([finishLat, finishLng], { icon: finishIcon, zIndexOffset: 500 })
            .bindTooltip('Финиш', { permanent: false, direction: 'top', offset: [0, -6] })
            .addTo(map);
        }

        // Промежуточные точки стыка: конец и начало каждого отрезка (ночёвки). Исключены Старт и Финиш.
        junctionMarkersRef.current.forEach((m) => { try { m.remove(); } catch (_) {} });
        junctionMarkersRef.current = [];
        const segList = Array.isArray(routeSegmentsJson) && routeSegmentsJson.length > 0
          ? routeSegmentsJson
          : segments;
        const eq = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
        const routeStart = allCoords[0];
        const routeEnd = allCoords[allCoords.length - 1];
        const key = (pt) => `${Math.round(pt[0] * 1e5)}_${Math.round(pt[1] * 1e5)}`;
        const added = new Set();
        for (let i = 0; i < segList.length - 1; i++) {
          const pathEnd = segList[i].path ?? segList[i].coordinates ?? [];
          if (pathEnd.length > 0) {
            const pt = pathEnd[pathEnd.length - 1];
            if (!eq(pt, routeStart) && !eq(pt, routeEnd) && !added.has(key(pt))) {
              added.add(key(pt));
              const circle = L.circleMarker(pt, { radius: 4, color: 'white', weight: 2, fillColor: 'black', fillOpacity: 1 }).addTo(map);
              circle.bringToFront();
              junctionMarkersRef.current.push(circle);
            }
          }
          const pathStart = segList[i + 1].path ?? segList[i + 1].coordinates ?? [];
          if (pathStart.length > 0) {
            const pt = pathStart[0];
            if (!eq(pt, routeStart) && !eq(pt, routeEnd) && !added.has(key(pt))) {
              added.add(key(pt));
              const circle = L.circleMarker(pt, { radius: 4, color: 'white', weight: 2, fillColor: 'black', fillOpacity: 1 }).addTo(map);
              circle.bringToFront();
              junctionMarkersRef.current.push(circle);
            }
          }
        }
      } else if (route?.start_lat != null) {
        map.setView([route.start_lat, route.start_lng], 13);
      } else {
        toast.info('Маршрут не содержит точек для отображения');
      }

      // POI-маркеры: капля по референсу (createCustomMarker) или круг с фото; бейдж с числом при нескольких фото
      const safePois = Array.isArray(pois) ? pois : [];
      safePois.forEach((poi) => {
        if (!poi) return;
        const lat = poi.lat;
        const lng = poi.lng ?? poi.lon;
        if (lat == null || lng == null || typeof lat !== 'number' || typeof lng !== 'number') return;

        const photoUrls = getPoiPhotos(poi) ?? [];
        const firstPhoto = photoUrls[0] ?? poi?.image_url;
        const hasPhoto = Boolean(firstPhoto);
        const multiPhoto = photoUrls.length > 1;
        const badgeHtml = multiPhoto ? `<span class="poi-marker-badge">${photoUrls.length}</span>` : '';
        const iconName = poi?.icon_name || 'map-pin';
        const poiColor = poi?.color && /^#[0-9A-Fa-f]{6}$/.test(poi.color) ? poi.color : '#3b82f6';
        let icon = null;
        if (hasPhoto) {
          icon = L.divIcon({
            html: `<div class="poi-marker-wrap"><div class="poi-marker poi-marker--photo" style="background-image:url('${String(firstPhoto).replace(/'/g, "\\'")}')"></div>${badgeHtml}</div>`,
            className: '',
            iconSize: [36, 36],
            iconAnchor: [18, 36],
            popupAnchor: [0, -20],
          });
        } else {
          const entry = POI_ICONS.find((i) => i.id === iconName);
          const Icon = entry?.Icon ?? POI_ICONS[0]?.Icon;
          try {
            const baseIcon = createCustomMarker(poiColor, Icon);
            if (!multiPhoto) icon = baseIcon;
            else {
              icon = L.divIcon({
                html: `<div class="poi-marker-wrap poi-marker-wrap--teardrop">${baseIcon.options.html}${badgeHtml}</div>`,
                className: '',
                iconSize: baseIcon.options.iconSize ?? [32, 32],
                iconAnchor: baseIcon.options.iconAnchor ?? [16, 32],
                popupAnchor: baseIcon.options.popupAnchor ?? [0, -18],
              });
            }
          } catch (_) {
            icon = createCustomMarker(poiColor, undefined);
          }
        }
        if (!icon) return;
        const popupUrls = getPoiPhotos(poi) ?? [];
        const iconSvg = getPoiIconSvg(iconName, { size: 20, color: '#ffffff' });
        const headerIconHtml = `<span class="poi-popup-header-icon" style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background-color:${poiColor};flex-shrink:0;">${iconSvg}</span>`;
        const nameHtml = `<span style="font-size:1rem;font-weight:600;color:#111;line-height:1.3;">${escapeHtml(poi?.name ?? 'Без названия')}</span>`;
        const descHtml = (poi?.description && String(poi.description).trim())
          ? `<div style="font-size:0.8125rem;color:#6b7280;margin-top:6px;line-height:1.4;">${escapeHtml(String(poi.description).trim())}</div>`
          : '';
        const galleryHtml = popupUrls.length > 0
          ? `<div class="poi-popup-gallery" style="display:flex;gap:8px;overflow-x:auto;overflow-y:hidden;margin-top:8px;padding-bottom:6px;max-width:100%;-webkit-overflow-scrolling:touch;">${popupUrls.map((src, i) => {
              const photosAttr = JSON.stringify(popupUrls).replace(/"/g, '&quot;');
              return `<button type="button" class="poi-lightbox-thumb" data-photos="${photosAttr}" data-index="${i}" style="width:64px;height:64px;padding:0;border:none;border-radius:8px;overflow:hidden;flex-shrink:0;cursor:pointer;background:transparent;"><img src="${escapeHtml(src)}" alt="" style="width:100%;height:100%;object-fit:cover;pointer-events:none;" /></button>`;
            }).join('')}</div>`
          : '';
        const coordsStr = `Координаты: ${Number(lat).toFixed(5)} ${Number(lng).toFixed(5)}`;
        const coordsHtml = `<div style="font-size:0.7rem;color:#9ca3af;margin-top:6px;">${coordsStr}</div>`;
        const popupInner = `<div style="display:flex;align-items:flex-start;gap:8px;">${headerIconHtml}<div style="flex:1;min-width:0;">${nameHtml}${descHtml}${galleryHtml}${coordsHtml}</div></div>`;
        const poiName = (poi?.name ?? 'Без названия').trim();
        const truncatedName = poiName.length > 25 ? `${poiName.slice(0, 25)}…` : poiName;
        const marker = L.marker([lat, lng], { icon })
          .bindPopup(
            `<div style="font-family:system-ui,sans-serif;min-width:200px;">${popupInner}</div>`,
            { maxWidth: 320, className: 'poi-detail-popup' },
          )
          .bindTooltip(truncatedName, {
            permanent: true,
            direction: 'right',
            offset: [12, 0],
            className: 'poi-label-tooltip',
          })
          .addTo(map);
        const refKey = poi?.id ?? `poi-${lat}-${lng}`;
        poisMarkersRef.current.set(refKey, marker);
      });
    } catch (err) {
      console.error('[SearchRoutesPage] details:', err);
      setDetailsError(err.message ?? 'Не удалось загрузить данные маршрута');
      toast.error(err.message ?? 'Не удалось загрузить данные маршрута');
    } finally {
      setGeometryLoading(false);
    }
  }, [routes, cleanupMap, removeClusterGroup]);

  // Открытие карточки по ссылке /search?route=<uuid> (например с публичного профиля или /routes/:id)
  const openedFromQueryRef = useRef(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const openId = params.get('route');
    if (!openId) {
      openedFromQueryRef.current = null;
      return;
    }
    if (loading || !mapReady) return;
    if (openedFromQueryRef.current === openId) return;
    const r = routes.find((x) => String(x.id) === String(openId));
    // Администратор может открыть маршрут по id, даже если он не в публичном списке
    if (!r && role !== 'admin') return;
    openedFromQueryRef.current = openId;
    handleSelectRoute(openId, r ?? { id: openId });
    navigate(
      { pathname: location.pathname, search: '' },
      { replace: true, state: location.state },
    );
  }, [loading, routes, location.search, location.pathname, handleSelectRoute, navigate, mapReady, role]);

  // ── Назад к списку ───────────────────────────────────────────────────────

  const handleBackFromDetails = useCallback(() => {
    if (openedFromAdminReports) {
      navigate('/admin?tab=reports');
      return;
    }
    if (openedFromAdminList) {
      navigate('/admin');
      return;
    }
    cleanupMap();
    setSelectedRoute(null);
    setSelectedId(null);
    setDetailData({ points: [], pois: [], segments: [] });
    setDetailsError(null);
    setElevationVisible(false);
    setHoveredLocation(null);
  }, [cleanupMap, navigate, openedFromAdminList, openedFromAdminReports]);

  // Бегающий кружок на карте при наведении на график высот (аналог страницы создания маршрута)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedRoute) return;

    if (hoveredLocation?.lat != null && hoveredLocation?.lng != null) {
      const fillColor = hoveredLocation?.dayColor ?? '#3b82f6';
      if (hoverCircleRef.current) {
        hoverCircleRef.current.setLatLng([hoveredLocation.lat, hoveredLocation.lng]);
        hoverCircleRef.current.setStyle({ fillColor, fillOpacity: 1 });
      } else {
        hoverCircleRef.current = L.circleMarker([hoveredLocation.lat, hoveredLocation.lng], {
          radius:      6,
          color:       'white',
          weight:      2,
          fillColor,
          fillOpacity: 1,
        }).addTo(map);
        hoverCircleRef.current.bringToFront();
      }
    } else {
      if (hoverCircleRef.current) {
        hoverCircleRef.current.remove();
        hoverCircleRef.current = null;
      }
    }
  }, [hoveredLocation, selectedRoute]);

  // Открыть попап метки на карте (при клике по метке из списка «Места» — тот же попап, что у маркера)
  const openPoiPopupOnMap = useCallback((poi) => {
    const map = mapRef?.current;
    if (!map || poi?.lat == null || poi?.lng == null) return;
    const marker = poisMarkersRef.current.get(poi.id);
    if (marker) {
      map.flyTo([poi.lat, poi.lng], 16, { duration: 0.8 });
      marker.openPopup();
    } else {
      map.flyTo([poi.lat, poi.lng], 16, { duration: 0.8 });
    }
  }, []);

  // ── Копирование маршрута (fork) ───────────────────────────────────────────

  /**
   * «Сделать на основе»: только переход в конструктор с ?clone=ID.
   * Копия в БД создаётся одним INSERT при «Сохранить» (без дублирующего POST /fork).
   */
  const handleFork = useCallback(async () => {
    if (!selectedId) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      toast.error('Войдите в систему, чтобы скопировать маршрут');
      return;
    }
    // Защита: роль `guest` должна блокировать клонирование/конструктор.
    const userId = session?.user?.id;
    if (!userId) {
      toast.error('Войдите в систему, чтобы скопировать маршрут');
      return;
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.role === 'guest' || !profile?.role) {
      toast.error('Войдите в систему, чтобы скопировать маршрут');
      return;
    }
    toast.success('Открываем конструктор…');
    navigate(`/create?clone=${selectedId}`);
  }, [selectedId, navigate]);

  // ── Маркеры-стартовые точки: только когда маршрут НЕ выбран; с кластеризацией ─

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    // Если открыт детальный просмотр — стартовые точки не показываем (только линия и POI выбранного маршрута)
    if (selectedRoute) {
      removeClusterGroup();
      return;
    }

    try {
      // Удаляем старый слой кластеров с карты
      if (clusterGroupRef.current) {
        map.removeLayer(clusterGroupRef.current);
        clusterGroupRef.current.clearLayers();
        clusterGroupRef.current = null;
      }
      // Удаляем все старые маркеры с карты (в т.ч. когда рисуем без кластера)
      markersRef.current.forEach((marker) => {
        try { map.removeLayer(marker); } catch (_) {}
      });
      markersRef.current.clear();

      if (filteredAndSortedRoutes.length === 0) return;

      if (typeof L.markerClusterGroup !== 'function') {
        filteredAndSortedRoutes.forEach((route) => {
          if (route.start_lat == null || route.start_lng == null) return;
          const iconSvg = ICON_SVG[route.activity_type || 'foot'] ?? ICON_SVG.car;
          const icon = L.divIcon({
            className: '', html: `<div class="route-marker-pin" data-route-id="${route.id}"><span class="route-marker-pin__icon">${iconSvg}</span></div>`,
            iconSize: [32, 40], iconAnchor: [16, 40],
          });
          const marker = L.marker([route.start_lat, route.start_lng], { icon })
            .addTo(map)
            .bindTooltip(route.title || '', {
              permanent: true,
              direction: 'right',
              offset: [12, 0],
              className: 'bg-white/90 backdrop-blur-sm border-none shadow-sm rounded-lg font-medium text-gray-800 px-2 py-1',
            });
          marker.on('click', () => handleSelectRoute(route.id, route));
          markersRef.current.set(route.id, marker);
        });
        return;
      }

      const clusterGroup = L.markerClusterGroup({
        chunkedLoading: true,
        iconCreateFunction: (cluster) => {
          const count = cluster.getChildCount();
          return L.divIcon({
            className: '',
            iconSize: [36, 36],
            iconAnchor: [18, 36],
            html: `<div style="width: 36px; height: 36px; background-color: #111827; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 2px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
  <span style="transform: rotate(45deg); color: white; font-weight: bold; font-size: 14px;">${count}</span>
</div>`,
          });
        },
      });

      filteredAndSortedRoutes.forEach((route) => {
        if (route.start_lat == null || route.start_lng == null) return;
        const iconSvg = ICON_SVG[route.activity_type || 'foot'] ?? ICON_SVG.car;
        const icon = L.divIcon({
          className: '',
          html: `<div class="route-marker-pin" data-route-id="${route.id}"><span class="route-marker-pin__icon">${iconSvg}</span></div>`,
          iconSize: [32, 40],
          iconAnchor: [16, 40],
        });
        const marker = L.marker([route.start_lat, route.start_lng], { icon })
          .bindTooltip(route.title || '', {
            permanent: true,
            direction: 'right',
            offset: [12, 0],
            className: 'bg-white/90 backdrop-blur-sm border-none shadow-sm rounded-lg font-medium text-gray-800 px-2 py-1',
          });
        marker.on('click', () => handleSelectRoute(route.id, route));
        clusterGroup.addLayer(marker);
        markersRef.current.set(route.id, marker);
      });

      map.addLayer(clusterGroup);
      clusterGroupRef.current = clusterGroup;
    } catch (err) {
      console.error('[SearchRoutesPage] markers:', err);
    }
  }, [mapReady, filteredAndSortedRoutes, selectedRoute, handleSelectRoute, removeClusterGroup]);

  // ── Подсветка маркера при ховере карточки ───────────────────────────────

  useEffect(() => {
    markersRef.current.forEach((marker, routeId) => {
      const el = marker._icon;
      if (!el) return;
      if (routeId === hoveredRouteId) {
        el.classList.add('route-marker-pin--hover');
      } else {
        el.classList.remove('route-marker-pin--hover');
      }
    });
  }, [hoveredRouteId]);

  // ── Рендер ───────────────────────────────────────────────────────────────

  if (pageError) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-800">
          <p className="font-medium">Ошибка загрузки страницы</p>
          <p className="mt-2 text-sm">{pageError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 h-[calc(100vh-3.5rem)] overflow-hidden">

      {/* ── Сайдбар (ресайз по правому краю) ───────────────────────────────── */}
      <div className="relative flex flex-col border-r border-border bg-neutral-100" style={sidebarStyle}>
        <aside className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">

        {/* Шапка — только в режиме списка */}
        {!selectedRoute && (
          <>
            <div className="shrink-0 border-b border-neutral-200 bg-neutral-100 px-4 pt-5 pb-3">
              <h1 className="text-2xl font-bold text-neutral-800">
                Найдено {loading ? '…' : filteredAndSortedRoutes.length} маршрутов
              </h1>
            </div>

            <div className="shrink-0 border-b border-neutral-200 bg-neutral-100 p-4">
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  {mapReady && mapRef.current ? (
                    <MapSearch
                      map={mapRef.current}
                      containerClassName="relative w-full"
                      limit={5}
                      onPlaceSelect={() => {}}
                    />
                  ) : (
                    <div className="flex h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3">
                      <Search className="h-4 w-4 shrink-0 text-neutral-400" />
                      <span className="text-sm text-neutral-400">Поиск места на карте...</span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setIsFiltersOpen((v) => !v)}
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                    isFiltersOpen ? 'border-primary bg-primary/10 text-primary' : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                  }`}
                  title="Фильтры и сортировка"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              </div>

              {isFiltersOpen && (
                <div className="mt-4 rounded-xl border border-neutral-200 bg-gray-50 p-4">
                  <p className="mb-2 text-xs font-medium text-neutral-600">Поиск по названию маршрута</p>
                  <div className="relative mb-4">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
                    <input
                      type="text"
                      placeholder="Название или описание..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-9 w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  <p className="mb-3 text-xs font-medium text-neutral-600">Сортировка</p>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="mb-4 h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="newest">Сначала новые</option>
                    <option value="popular">Сначала популярные</option>
                    <option value="shortest">Сначала короткие</option>
                    <option value="longest">Сначала длинные</option>
                  </select>

                  <p className="mb-2 text-xs font-medium text-neutral-600">Тип</p>
                  <div className="mb-4 flex flex-wrap gap-2">
                    {[
                      { key: 'all', label: 'Все' },
                      { key: 'foot', label: 'Пешком' },
                      { key: 'bike', label: 'Велосипед' },
                      { key: 'car', label: 'Авто' },
                    ].map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setFilterType(key)}
                        className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                          filterType === key ? 'bg-primary text-white' : 'bg-white text-neutral-600 shadow-sm hover:bg-neutral-50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <p className="mb-2 text-xs font-medium text-neutral-600">Расстояние (км)</p>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      placeholder="От"
                      value={filterMinDistance}
                      onChange={(e) => setFilterMinDistance(e.target.value)}
                      className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      placeholder="До"
                      value={filterMaxDistance}
                      onChange={(e) => setFilterMaxDistance(e.target.value)}
                      className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  <p className="mt-3 text-xs text-neutral-500">
                    Показано: {filteredAndSortedRoutes.length}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Тело */}
        <div className="flex min-h-0 flex-1 flex-col">
          {selectedRoute ? (
            <>
              {detailsError && (
                <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {detailsError}
                </div>
              )}
              <RouteDetails
                route={selectedRoute}
                detailData={detailData}
                mapRef={mapRef}
                onBack={handleBackFromDetails}
                onDownload={() => toast.info('Скачивание — в разработке')}
                onFork={handleFork}
                onPhotoClick={(photos, index) => {
                  setLightboxPhotos(Array.isArray(photos) ? photos : []);
                  setLightboxIndex(Math.max(0, Math.min(index, (photos?.length ?? 1) - 1)));
                  setLightboxOpen(true);
                }}
                onPoiClick={openPoiPopupOnMap}
                onLikesUpdate={(_, count) => {
                  setSelectedRoute((r) => (r ? { ...r, likes_count: count } : r));
                  setRoutes((prev) => prev.map((r) => (r.id === selectedRoute?.id ? { ...r, likes_count: count } : r)));
                }}
                elevationVisible={elevationVisible}
                onToggleElevation={() => setElevationVisible((v) => !v)}
              />
            </>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4">
                {loading ? (
                  <div className="flex h-32 items-center justify-center gap-2 text-sm text-neutral-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Загрузка маршрутов...
                  </div>
                ) : filteredAndSortedRoutes.length === 0 ? (
                  <p className="py-16 px-4 text-center text-sm text-neutral-500">
                    {search || filterType !== 'all' || filterMinDistance !== '' || filterMaxDistance !== ''
                      ? 'Ничего не найдено'
                      : 'Маршрутов пока нет. Станьте первым!'}
                  </p>
                ) : (
                  <div className="space-y-4">
                    {filteredAndSortedRoutes.map((route) => (
                      <RouteCard
                        key={route.id}
                        route={route}
                        isSelected={selectedId === route.id}
                        isLoading={geometryLoading && selectedId === route.id}
                        isHovered={hoveredRouteId === route.id}
                        onClick={() => handleSelectRoute(route.id, route)}
                        onMouseEnter={() => setHoveredRouteId(route.id)}
                        onMouseLeave={() => setHoveredRouteId(null)}
                      />
                    ))}
                  </div>
                )}
              </div>
              {!isFiltersOpen && (
                <div className="shrink-0 border-t border-neutral-200 px-4 py-2 text-xs text-neutral-500">
                  {loading ? 'Загрузка...' : `Показано: ${filteredAndSortedRoutes.length}`}
                </div>
              )}
            </>
          )}
        </div>
        </aside>
        {/* Ползунок ресайза по правому краю */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Изменить ширину панели"
          onMouseDown={handleSidebarResizeStart}
          className="absolute top-0 right-0 z-50 h-full w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/50"
        />
      </div>

      {/* ── Карта (overflow-visible чтобы панель «Слои» не обрезалась; z-10 чтобы поверх сайдбара) ─── */}
      <div className="relative z-10 min-h-0 flex-1 overflow-visible">
        <div ref={mapDivRef} className="absolute inset-0 z-0 overflow-hidden bg-neutral-200" />
        <div className="absolute top-4 right-4 z-[1100] flex w-64 flex-col gap-2 overflow-visible pointer-events-auto">
          <MapLayersControl
            expandedSection={expandedSection}
            onToggle={setExpandedSection}
          />
        </div>

        {/* Панель профиля высот — плавно выезжает снизу поверх карты */}
        {selectedRoute?.elevation_json?.length > 0 && (
          <div
            className="pointer-events-auto absolute inset-x-0 bottom-0 z-[800] transition-transform duration-300 ease-in-out"
            style={{ transform: elevationVisible ? 'translateY(0)' : 'translateY(100%)' }}
          >
            <div className="mx-4 mb-4 overflow-hidden rounded-2xl border border-white/30 bg-white/95 shadow-2xl backdrop-blur-sm">
              {/* Заголовок панели */}
              <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2">
                <div className="flex items-center gap-2">
                  <Mountain className="h-4 w-4 text-neutral-400" />
                  <span className="text-sm font-semibold text-neutral-700">Профиль высот</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setElevationVisible(false);
                    setHoveredLocation(null); // убираем бегающий кружок при закрытии панели
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                  title="Скрыть профиль высот"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              {/* График */}
              <div className="h-48">
                <ElevationProfileView
                  elevationData={selectedRoute.elevation_json}
                  onHoverPoint={setHoveredLocation}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Полноэкранная галерея (Lightbox) */}
      {lightboxOpen && (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}
