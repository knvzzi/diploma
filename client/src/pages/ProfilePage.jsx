import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  MapPin,
  Loader2,
  Pencil,
  Trash2,
  Globe,
  Lock,
  Share2,
  Plus,
  Search,
  LayoutGrid,
  List,
  Ruler,
  Clock,
  Footprints,
  Bike,
  Car,
  Image as ImageIcon,
  Heart,
  Bookmark,
  FolderOpen,
  Calendar,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  FileDown,
  Smartphone,
  AlertTriangle,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/lib/supabaseClient';
import { downloadRouteAsGpx } from '@/lib/gpxExport';
import QrModal from '@/components/QrModal';
import useAuthStore from '@/store/useAuthStore';
import { useAdminReadOnly } from '@/hooks/useAdminReadOnly';
import useProfileStore from '@/store/useProfileStore';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// ─────────────────────────────────────────────────────────────────────────────
// Константы и утилиты
// ─────────────────────────────────────────────────────────────────────────────

/** Количество карточек на одной странице (сетка 3 колонки → 2 ряда по умолчанию). */
const ITEMS_PER_PAGE = 6;

const ACTIVITY_META = {
  foot: { icon: Footprints, label: 'Пешком' },
  bike: { icon: Bike, label: 'Велосипед' },
  car:  { icon: Car,  label: 'Авто' },
};

/** Инициалы для заглушки аватара. */
function getInitials(fullName, lastName) {
  const parts = [fullName, lastName].filter(Boolean).join(' ').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts[0]) return parts[0][0].toUpperCase();
  return '?';
}

function formatDistance(meters) {
  if (meters == null) return '—';
  return `${(Number(meters) / 1000).toFixed(1)} км`;
}

function formatDuration(seconds) {
  if (seconds == null) return '—';
  const s = Math.round(Number(seconds));
  if (s < 60) return `${s} с`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m} мин`;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

function formatDate(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Возвращает только явно заданную обложку маршрута. Фото из галереи/точек не используются. */
function getCoverUrl(route) {
  return route?.cover_image_url ?? null;
}

function isForkCopy(route) {
  return Boolean(route?.parent_route_id ?? route?.parent_id);
}

/**
 * Автор маршрута-источника для копий (двухшаговый запрос: routes → profiles).
 */
function useForkParentAuthor(route) {
  const [parentAuthor, setParentAuthor] = useState(null);
  const forkParentId = route?.parent_route_id ?? route?.parent_id ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!forkParentId) {
      setParentAuthor(null);
      return () => { cancelled = true; };
    }
    (async () => {
      const { data: parentRow, error: routeErr } = await supabase
        .from('routes')
        .select('author_id')
        .eq('id', forkParentId)
        .maybeSingle();
      if (cancelled || routeErr || !parentRow?.author_id) {
        if (!cancelled) setParentAuthor(null);
        return;
      }
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('id, username, full_name')
        .eq('id', parentRow.author_id)
        .maybeSingle();
      if (cancelled) return;
      if (profileErr || !profile?.id) {
        setParentAuthor(null);
        return;
      }
      setParentAuthor(profile);
    })();
    return () => { cancelled = true; };
  }, [forkParentId]);

  return { parentAuthor, forkParentId };
}

// ─────────────────────────────────────────────────────────────────────────────
// ProfilePage — единый дашборд (Профиль + Мои маршруты + Избранное)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Единая страница профиля пользователя (дашборд).
 *
 * Структура:
 *   - Шапка: тёмный баннер, аватар наезжающий, имя/фамилия/@username, кнопка «Редактировать профиль»
 *   - Сайдбар: «+ Создать», «Маршруты», «Избранные»
 *   - Основная часть: тулбар (поиск, сортировка, вид Grid/List) + сетка/список маршрутов
 */
export default function ProfilePage() {
  const { user } = useAuthStore();
  const { avatarUrl, fullName, lastName, username, loadProfile } = useProfileStore();
  const isAdminViewer = useAdminReadOnly();
  const navigate = useNavigate();

  // ── Профиль (для шапки) ───────────────────────────────────────────────────
  const [profile, setProfile] = useState(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // ── Вкладка сайдбара: 'routes' (мои) | 'liked' (понравившиеся) | 'saved' (сохранённые) ───
  const [activeTab, setActiveTab] = useState('routes');

  // ── Маршруты: свои, лайкнутые (route_likes), сохранённые (saved_routes) ─────────────────
  const [myRoutes, setMyRoutes] = useState([]);
  const [likedRoutes, setLikedRoutes] = useState([]);
  const [savedRoutes, setSavedRoutes] = useState([]);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(true);
  const [isLoadingLiked, setIsLoadingLiked] = useState(true);
  const [isLoadingSaved, setIsLoadingSaved] = useState(true);

  // ── Тулбар и панель фильтров (как на SearchRoutesPage) ───────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid');    // 'grid' | 'list'
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState('newest');      // 'newest' | 'popular' | 'shortest' | 'longest'
  const [filterType, setFilterType] = useState('all');       // 'all' | 'foot' | 'bike' | 'car'
  const [filterVisibility, setFilterVisibility] = useState('all'); // 'all' | 'public' | 'private'
  const [filterMinDistance, setFilterMinDistance] = useState('');
  const [filterMaxDistance, setFilterMaxDistance] = useState('');

  // ── Пагинация ─────────────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);
  const [deletingRouteId, setDeletingRouteId] = useState(null);
  const [routeToDelete, setRouteToDelete] = useState(null);
  const [publishingRouteId, setPublishingRouteId] = useState(null);

  // Загрузка профиля
  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    (async () => {
      setIsLoadingProfile(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, last_name, username, avatar_url, strikes_count, system_messages')
        .eq('id', user.id)
        .maybeSingle();
      if (!error) setProfile(data);
      loadProfile(user.id);
      setIsLoadingProfile(false);
    })();
  }, [user, navigate, loadProfile]);

  // Загрузка своих маршрутов (включая копии).
  useEffect(() => {
    if (!user) return;
    (async () => {
      setIsLoadingRoutes(true);
      const { data, error } = await supabase
        .from('routes')
        .select(`
          id, title, description, activity_type, total_distance, total_elevation, duration,
          is_public, created_at, updated_at, cover_image_url, likes_count, author_id, parent_route_id, parent_id,
          profiles(id, username, full_name, avatar_url)
        `)
        .eq('author_id', user.id)
        .order('updated_at', { ascending: false });
      if (error) {
        console.error('[ProfilePage] Ошибка загрузки маршрутов:', error);
        toast.error('Не удалось загрузить маршруты');
      } else {
        setMyRoutes(data ?? []);
      }
      setIsLoadingRoutes(false);
    })();
  }, [user]);

  // Загрузка понравившихся (лайкнутых) маршрутов — таблица route_likes
  useEffect(() => {
    if (!user) return;
    (async () => {
      setIsLoadingLiked(true);
      const { data: likesData, error: likesError } = await supabase
        .from('route_likes')
        .select('route_id')
        .eq('user_id', user.id);
      if (likesError || !likesData?.length) {
        setLikedRoutes([]);
        setIsLoadingLiked(false);
        return;
      }
      const routeIds = likesData.map((l) => l.route_id);
      const { data: routesData, error: routesError } = await supabase
        .from('routes')
        .select(`
          id, title, description, activity_type, total_distance, total_elevation, duration,
          is_public, created_at, updated_at, cover_image_url, likes_count, author_id, parent_route_id, parent_id,
          profiles(id, username, full_name, avatar_url)
        `)
        .in('id', routeIds);
      if (routesError) {
        console.error('[ProfilePage] Ошибка загрузки понравившихся:', routesError);
        setLikedRoutes([]);
      } else {
        const byId = Object.fromEntries((routesData ?? []).map((r) => [r.id, r]));
        setLikedRoutes(routeIds.map((id) => byId[id]).filter(Boolean));
      }
      setIsLoadingLiked(false);
    })();
  }, [user]);

  // Загрузка сохранённых (закладки) маршрутов — таблица saved_routes
  useEffect(() => {
    if (!user) return;
    (async () => {
      setIsLoadingSaved(true);
      const { data: savedData, error: savedError } = await supabase
        .from('saved_routes')
        .select('route_id')
        .eq('user_id', user.id);
      if (savedError || !savedData?.length) {
        setSavedRoutes([]);
        setIsLoadingSaved(false);
        return;
      }
      const routeIds = savedData.map((s) => s.route_id);
      const { data: routesData, error: routesError } = await supabase
        .from('routes')
        .select(`
          id, title, description, activity_type, total_distance, total_elevation, duration,
          is_public, created_at, updated_at, cover_image_url, likes_count, author_id, parent_route_id, parent_id,
          profiles(id, username, full_name, avatar_url)
        `)
        .in('id', routeIds);
      if (routesError) {
        console.error('[ProfilePage] Ошибка загрузки сохранённых:', routesError);
        setSavedRoutes([]);
      } else {
        const byId = Object.fromEntries((routesData ?? []).map((r) => [r.id, r]));
        setSavedRoutes(routeIds.map((id) => byId[id]).filter(Boolean));
      }
      setIsLoadingSaved(false);
    })();
  }, [user]);

  // Текущий список маршрутов активной вкладки (сырые данные из БД)
  const rawRoutes =
    activeTab === 'routes' ? myRoutes : activeTab === 'liked' ? likedRoutes : savedRoutes;

  // Сброс поиска при переключении вкладки, чтобы не показывать пустой экран
  useEffect(() => {
    setSearchQuery('');
  }, [activeTab]);

  // Фильтрация и сортировка (как на SearchRoutesPage, без фильтра по карте)
  const filteredAndSortedRoutes = useMemo(() => {
    let list = [...rawRoutes];

    // Поиск по названию и описанию
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) => {
        if ((r.title || '').toLowerCase().includes(q)) return true;
        if ((r.description || '').toLowerCase().includes(q)) return true;
        return false;
      });
    }

    // По типу передвижения
    if (filterType !== 'all') {
      list = list.filter((r) => r.activity_type === filterType);
    }

    // По видимости (только для вкладки «Мои маршруты», у которых есть is_public)
    if (filterVisibility === 'public') {
      list = list.filter((r) => r.is_public === true);
    } else if (filterVisibility === 'private') {
      list = list.filter((r) => r.is_public === false);
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
      list.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
    } else if (sortBy === 'popular') {
      list.sort((a, b) => (b.likes_count ?? 0) - (a.likes_count ?? 0));
    } else if (sortBy === 'shortest') {
      list.sort((a, b) => getDistance(a) - getDistance(b));
    } else if (sortBy === 'longest') {
      list.sort((a, b) => getDistance(b) - getDistance(a));
    }

    return list;
  }, [rawRoutes, searchQuery, filterType, filterVisibility, filterMinDistance, filterMaxDistance, sortBy]);

  // Сброс на первую страницу при смене фильтров, сортировки, поиска или вкладки
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, sortBy, filterType, filterVisibility, filterMinDistance, filterMaxDistance]);

  // Нарезка массива для текущей страницы
  const totalPages = Math.max(1, Math.ceil(filteredAndSortedRoutes.length / ITEMS_PER_PAGE));
  const paginatedRoutes = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSortedRoutes.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAndSortedRoutes, currentPage]);

  const isLoadingList =
    activeTab === 'routes' ? isLoadingRoutes : activeTab === 'liked' ? isLoadingLiked : isLoadingSaved;

  /** Навигация при клике на карточку: свой маршрут → конструктор (редактирование), чужой → просмотр на /search?route= */
  const handleCardClick = useCallback(
    (route) => {
      if (!route?.id) return;
      const isOwner = route.author_id === user?.id;
      if (isOwner) {
        navigate(`/constructor/${route.id}`);
      } else {
        navigate(`/search?route=${route.id}`);
      }
    },
    [user?.id, navigate],
  );

  /**
   * Удаление собственного маршрута с сервера.
   * Используем дополнительный фильтр по author_id для безопасности на клиенте.
   */
  const handleDeleteRoute = useCallback(async () => {
    if (!routeToDelete?.id || !user?.id) return;

    setDeletingRouteId(routeToDelete.id);
    const { error } = await supabase
      .from('routes')
      .delete()
      .eq('id', routeToDelete.id)
      .eq('author_id', user.id);

    if (error) {
      console.error('[ProfilePage] Ошибка удаления маршрута:', error);
      toast.error('Не удалось удалить маршрут');
      setDeletingRouteId(null);
      return;
    }

    setMyRoutes((prev) => prev.filter((r) => r.id !== routeToDelete.id));
    setLikedRoutes((prev) => prev.filter((r) => r.id !== routeToDelete.id));
    setSavedRoutes((prev) => prev.filter((r) => r.id !== routeToDelete.id));
    toast.success('Маршрут удалён');
    setDeletingRouteId(null);
    setRouteToDelete(null);
  }, [routeToDelete, user?.id]);

  /**
   * Переключает публичность собственного маршрута (is_public) прямо из карточки профиля.
   */
  const handleToggleRoutePublic = useCallback(async (route) => {
    if (!route?.id || !user?.id) return;
    if (isForkCopy(route)) {
      toast.error('Нельзя опубликовать маршрут, созданный на основе чужого');
      return;
    }
    const nextValue = !route.is_public;
    setPublishingRouteId(route.id);
    const { error } = await supabase
      .from('routes')
      .update({ is_public: nextValue })
      .eq('id', route.id)
      .eq('author_id', user.id);

    if (error) {
      console.error('[ProfilePage] Ошибка переключения публичности:', error);
      toast.error('Не удалось изменить статус маршрута');
      setPublishingRouteId(null);
      return;
    }

    setMyRoutes((prev) => prev.map((r) => (r.id === route.id ? { ...r, is_public: nextValue } : r)));
    setLikedRoutes((prev) => prev.map((r) => (r.id === route.id ? { ...r, is_public: nextValue } : r)));
    setSavedRoutes((prev) => prev.map((r) => (r.id === route.id ? { ...r, is_public: nextValue } : r)));
    toast.success(nextValue ? 'Маршрут опубликован' : 'Маршрут сделан приватным');
    setPublishingRouteId(null);
  }, [user?.id]);

  /**
   * Скачивает маршрут в формате GPX.
   * Запрашивает детали маршрута (точки, POI) через API и генерирует файл.
   */
  const handleDownloadGpx = useCallback((route) => {
    downloadRouteAsGpx(
      route,
      (msg) => toast.success(msg),
      (msg) => toast.error(msg),
    );
  }, []);

  /**
   * "На телефон": открывает модалку с QR-кодом для конкретного маршрута.
   * Ссылка ведёт на страницу поиска с предвыбранным маршрутом (/search?route=id).
   */
  const [qrRoute, setQrRoute] = useState(null);

  const handlePhoneShare = useCallback((route) => {
    if (!route?.id) return;
    setQrRoute(route);
  }, []);

  /**
   * Удаляет одно системное уведомление из массива system_messages в БД и обновляет локальный стейт.
   * Вызывается при нажатии кнопки «Понятно» (крестик) на плашке уведомления.
   * @param {number} index — индекс удаляемого сообщения в массиве
   */
  const dismissSystemMessage = useCallback(async (index) => {
    const current = profile?.system_messages ?? [];
    const updated = current.filter((_, i) => i !== index);
    const { error } = await supabase
      .from('profiles')
      .update({ system_messages: updated })
      .eq('id', user.id);
    if (error) {
      toast.error('Не удалось удалить уведомление');
      return;
    }
    setProfile((prev) => ({ ...prev, system_messages: updated }));
  }, [profile, user]);

  if (!user) return null;

  const displayName = profile?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Пользователь';
  const displayLastName = profile?.last_name ?? '';
  const displayUsername = profile?.username ?? '';
  const avatar = profile?.avatar_url ?? avatarUrl;
  const initials = getInitials(displayName, displayLastName);

  return (
    <div className="min-h-screen bg-muted/30 font-sans antialiased">
      {/* ─── Шапка: однотонный серый баннер + наезжающая аватарка и данные ─── */}
      <header className="relative">
        <div className="h-32 bg-gradient-to-b from-neutral-500 to-gray-300 sm:h-36" />
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex -mt-12 sm:-mt-14 items-end gap-4">
              {/* Аватарка наезжающая на баннер */}
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border-4 border-background bg-muted shadow-lg sm:h-28 sm:w-28">
                {avatar ? (
                  <img src={avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-2xl font-medium text-muted-foreground sm:text-3xl">
                    {initials}
                  </span>
                )}
              </div>
              <div className="pb-1">
                {isLoadingProfile ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Загрузка...</span>
                  </div>
                ) : (
                  <>
                    <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
                      {displayName}
                      {displayLastName && ` ${displayLastName}`}
                    </h1>
                    {displayUsername && (
                      <p className="text-sm text-muted-foreground">@{displayUsername}</p>
                    )}
                  </>
                )}
              </div>
            </div>
            {!isAdminViewer && (
              <Button asChild variant="outline" size="sm" className="shrink-0 gap-2 self-start sm:self-center mb-2 sm:mb-4">
                <Link to="/settings">
                  <Pencil className="h-4 w-4" />
                  Редактировать профиль
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ─── Баннер страйков: показывается при strikes_count > 0 ────────── */}
      {!isAdminViewer && (profile?.strikes_count ?? 0) > 0 && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-6xl items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <p className="text-sm font-medium text-red-800">
              ⚠️ Внимание: У вас{' '}
              <span className="font-bold">{profile.strikes_count}/3</span>{' '}
              предупреждений за нарушение правил.
              При получении 3 предупреждений аккаунт будет заблокирован.
            </p>
          </div>
        </div>
      )}

      {/* ─── Системные уведомления от модераторов ────────────────────────── */}
      {!isAdminViewer && (profile?.system_messages ?? []).length > 0 && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl space-y-2">
            {(profile.system_messages ?? []).map((msg, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 rounded-lg border border-red-200 bg-white px-4 py-3 shadow-sm"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <p className="flex-1 text-sm text-red-800">{msg}</p>
                {/* Кнопка «Понятно» — удаляет это сообщение из БД */}
                <button
                  type="button"
                  onClick={() => dismissSystemMessage(idx)}
                  className="shrink-0 rounded-md p-1 text-red-400 transition-colors hover:bg-red-100 hover:text-red-700"
                  title="Понятно — скрыть уведомление"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex gap-6 lg:gap-8">
          {/* ─── Сайдбар ───────────────────────────────────────────────────── */}
          <aside className="w-48 shrink-0">
            <nav className="flex flex-col gap-2">
              {!isAdminViewer && (
                <Button asChild className="w-full gap-2 bg-amber-500 hover:bg-amber-600 text-gray-900 font-medium">
                  <Link to="/create">
                    <Plus className="h-4 w-4" />
                    Создать
                  </Link>
                </Button>
              )}
              <button
                type="button"
                onClick={() => setActiveTab('routes')}
                className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  activeTab === 'routes'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                Мои маршруты
                {!isLoadingRoutes && myRoutes.length > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground">({myRoutes.length})</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('liked')}
                className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  activeTab === 'liked'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Heart className="h-4 w-4 shrink-0" />
                Понравившиеся
                {!isLoadingLiked && likedRoutes.length > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground">({likedRoutes.length})</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('saved')}
                className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  activeTab === 'saved'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Bookmark className="h-4 w-4 shrink-0" />
                Сохранённые
                {!isLoadingSaved && savedRoutes.length > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground">({savedRoutes.length})</span>
                )}
              </button>
            </nav>
          </aside>

          {/* ─── Основная часть: тулбар + сетка/список ─────────────────────── */}
          <main className="min-w-0 flex-1">
            {/* Панель управления (Toolbar) */}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px] max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Поиск по названию..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <button
                type="button"
                onClick={() => setIsFiltersOpen((v) => !v)}
                className={`flex h-9 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                  isFiltersOpen ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background text-muted-foreground hover:bg-muted'
                }`}
                title="Фильтры и сортировка"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
              <div className="flex rounded-lg border border-input bg-background p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={`rounded-md p-1.5 transition-colors ${
                    viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                  }`}
                  title="Плиткой"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`rounded-md p-1.5 transition-colors ${
                    viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                  }`}
                  title="Списком"
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Выпадающая панель фильтров */}
            {isFiltersOpen && (
              <div className="mb-4 rounded-xl border border-border bg-muted/30 p-4">
                <p className="mb-3 text-xs font-medium text-muted-foreground">Сортировка</p>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="mb-4 h-9 w-full max-w-xs rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="newest">Сначала новые</option>
                  <option value="popular">Сначала популярные</option>
                  <option value="shortest">Сначала короткие</option>
                  <option value="longest">Сначала длинные</option>
                </select>

                <p className="mb-2 text-xs font-medium text-muted-foreground">Тип передвижения</p>
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
                        filterType === key ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground shadow-sm hover:bg-muted'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {activeTab === 'routes' && (
                  <>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Видимость</p>
                    <div className="mb-4 flex flex-wrap gap-2">
                      {[
                        { key: 'all',     label: 'Все' },
                        { key: 'public',  label: 'Публичные' },
                        { key: 'private', label: 'Приватные' },
                      ].map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setFilterVisibility(key)}
                          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                            filterVisibility === key
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-background text-muted-foreground shadow-sm hover:bg-muted'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <p className="mb-2 text-xs font-medium text-muted-foreground">Расстояние (км)</p>
                <div className="flex flex-wrap gap-2">
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder="От"
                    value={filterMinDistance}
                    onChange={(e) => setFilterMinDistance(e.target.value)}
                    className="h-9 w-24"
                  />
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder="До"
                    value={filterMaxDistance}
                    onChange={(e) => setFilterMaxDistance(e.target.value)}
                    className="h-9 w-24"
                  />
                </div>

                <p className="mt-3 text-xs text-muted-foreground">
                  Показано: {filteredAndSortedRoutes.length}
                </p>
              </div>
            )}

            {/* Контент: загрузка / пусто / сетка или список */}
            {isLoadingList ? (
              <div className="flex min-h-[280px] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : activeTab === 'liked' && likedRoutes.length === 0 ? (
              <EmptyState
                icon={Heart}
                title="Нет понравившихся маршрутов"
                description="Ставьте лайки маршрутам на странице поиска — они появятся здесь"
                actionLabel="Перейти к поиску"
                actionHref="/search"
              />
            ) : activeTab === 'saved' && savedRoutes.length === 0 ? (
              <EmptyState
                icon={Bookmark}
                title="Нет сохранённых маршрутов"
                description="Нажимайте «Сохранить» на странице маршрута, чтобы добавить его в закладки"
                actionLabel="Перейти к поиску"
                actionHref="/search"
              />
            ) : activeTab === 'routes' && myRoutes.length === 0 ? (
              <EmptyState
                icon={MapPin}
                title="Маршрутов пока нет"
                description="Создайте первый маршрут с помощью кнопки «Создать»"
                actionLabel={isAdminViewer ? undefined : 'Создать маршрут'}
                actionHref={isAdminViewer ? undefined : '/create'}
              />
            ) : filteredAndSortedRoutes.length === 0 ? (
              <EmptyState
                icon={Search}
                title="Ничего не найдено"
                description="Попробуйте изменить поисковый запрос"
              />
            ) : viewMode === 'grid' ? (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {paginatedRoutes.map((route) => (
                    <RouteCardGrid
                      key={route.id}
                      route={route}
                      isOwn={activeTab === 'routes'}
                      adminReadOnly={isAdminViewer}
                      isPublishing={publishingRouteId === route.id}
                      onCardClick={handleCardClick}
                      onTogglePublic={handleToggleRoutePublic}
                      onDeleteClick={setRouteToDelete}
                      onDownloadGpx={handleDownloadGpx}
                      onPhoneShare={handlePhoneShare}
                    />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="gap-1"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Назад
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                        <button
                          key={page}
                          type="button"
                          onClick={() => setCurrentPage(page)}
                          className={`min-w-[2rem] rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
                            currentPage === page
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                          }`}
                        >
                          {page}
                        </button>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className="gap-1"
                    >
                      Вперед
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <>
                <ul className="space-y-2">
                  {paginatedRoutes.map((route) => (
                    <li key={route.id}>
                      <RouteCardList
                        route={route}
                        isOwn={activeTab === 'routes'}
                        adminReadOnly={isAdminViewer}
                        isPublishing={publishingRouteId === route.id}
                        onCardClick={handleCardClick}
                        onTogglePublic={handleToggleRoutePublic}
                        onDeleteClick={setRouteToDelete}
                        onDownloadGpx={handleDownloadGpx}
                        onPhoneShare={handlePhoneShare}
                      />
                    </li>
                  ))}
                </ul>
                {totalPages > 1 && (
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="gap-1"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Назад
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                        <button
                          key={page}
                          type="button"
                          onClick={() => setCurrentPage(page)}
                          className={`min-w-[2rem] rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
                            currentPage === page
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                          }`}
                        >
                          {page}
                        </button>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className="gap-1"
                    >
                      Вперед
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>

      <AlertDialog open={Boolean(routeToDelete)} onOpenChange={(open) => { if (!open) setRouteToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить маршрут?</AlertDialogTitle>
            <AlertDialogDescription>
              Маршрут <span className="font-semibold">«{routeToDelete?.title || 'Без названия'}»</span> будет удалён безвозвратно.
              Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingRouteId)}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteRoute}
              disabled={Boolean(deletingRouteId)}
            >
              {deletingRouteId ? 'Удаление...' : 'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* QR-модалка «На телефон» — ведёт на Live-навигацию, как на странице маршрута */}
      <QrModal
        isOpen={Boolean(qrRoute)}
        onClose={() => setQrRoute(null)}
        url={qrRoute ? `${window.location.origin}/route/${qrRoute.id}/live` : ''}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Пустое состояние
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, title, description, actionLabel, actionHref }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-card/50 py-16 text-center">
      <Icon className="h-12 w-12 text-muted-foreground/50" />
      <div>
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {actionLabel && actionHref && (
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link to={actionHref}>{actionLabel}</Link>
        </Button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Карточка маршрута — вид «плиткой» (Grid)
// ─────────────────────────────────────────────────────────────────────────────

function RouteCardGrid({ route, isOwn, adminReadOnly, isPublishing, onCardClick, onTogglePublic, onDeleteClick, onDownloadGpx, onPhoneShare }) {
  const { user } = useAuthStore();
  const { parentAuthor, forkParentId } = useForkParentAuthor(route);
  const meta = ACTIVITY_META[route.activity_type] ?? ACTIVITY_META.foot;
  const ActivityIcon = meta.icon;
  const coverUrl = getCoverUrl(route);
  const [coverError, setCoverError] = useState(false);
  const isCopiedRoute = isForkCopy(route);
  const parentAuthorHref =
    user?.id && parentAuthor?.id && String(user.id) === String(parentAuthor.id)
      ? '/profile'
      : `/user/${parentAuthor?.id ?? ''}`;

  const handleClick = () => onCardClick?.(route);
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="group block cursor-pointer overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Как в RouteCard: neutral-100 на обёртке, плейсхолдер — тот же bg-gray-300 */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-neutral-100">
        {coverUrl && !coverError ? (
          <img
            src={coverUrl}
            alt=""
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            onError={() => setCoverError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-300">
            <ImageIcon className="h-10 w-10 text-gray-500" />
          </div>
        )}
        {isOwn && !adminReadOnly && (
          <div className="absolute right-2 top-2 z-30">
            <details
              className="group/details relative"
              onClick={(e) => e.stopPropagation()}
            >
              <summary
                className="list-none rounded-md bg-background/90 p-1.5 text-foreground shadow-sm transition-colors hover:bg-background [&::-webkit-details-marker]:hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </summary>
              <div className="absolute right-0 mt-1 w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-sm font-normal text-foreground hover:bg-muted"
                  disabled={isPublishing || isCopiedRoute}
                  title={isCopiedRoute ? 'Нельзя опубликовать маршрут, созданный на основе чужого' : ''}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onTogglePublic?.(route);
                  }}
                >
                  {isPublishing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : route.is_public ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <Share2 className="h-4 w-4" />
                  )}
                  {isCopiedRoute ? 'Публикация недоступна' : (route.is_public ? 'Сделать приватным' : 'Опубликовать')}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-sm font-normal text-foreground hover:bg-muted"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDownloadGpx?.(route);
                  }}
                >
                  <FileDown className="h-4 w-4" />
                  Скачать GPX
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-sm font-normal text-foreground hover:bg-muted"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onPhoneShare?.(route);
                  }}
                >
                  <Smartphone className="h-4 w-4" />
                  На телефон
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDeleteClick?.(route);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Удалить
                </button>
              </div>
            </details>
          </div>
        )}
        {/* Бейджи: публичность + «Копия» рядом */}
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap items-center gap-2">
          <div
            className="inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm"
            title={route.is_public ? 'Маршрут опубликован' : 'Маршрут приватный'}
          >
            {route.is_public ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            {route.is_public ? 'Публичный' : 'Приватный'}
          </div>
          {forkParentId && (
            <span className="rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-gray-700 shadow-sm backdrop-blur-sm">
              Копия
            </span>
          )}
        </div>
        {/* Дистанция и время поверх картинки внизу */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 py-2 text-white">
          <span className="flex items-center gap-1 text-xs font-medium">
            <Ruler className="h-3.5 w-3.5" />
            {formatDistance(route.total_distance)}
          </span>
          <span className="flex items-center gap-1 text-xs font-medium">
            <Clock className="h-3.5 w-3.5" />
            {formatDuration(route.duration)}
          </span>
        </div>
      </div>
      <div className="p-3">
        <h3 className="line-clamp-2 font-medium text-foreground group-hover:text-primary">
          {route.title || 'Без названия'}
        </h3>
        {isCopiedRoute && (
          <div className="mt-1 flex items-center gap-1 text-xs text-gray-500">
            <span>Основа от:</span>
            {parentAuthor ? (
              <Link
                to={parentAuthorHref}
                className="relative z-10 text-blue-500 hover:text-blue-700 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {parentAuthor.username
                  ? `@${String(parentAuthor.username).trim()}`
                  : (parentAuthor.full_name || 'Анонимный турист')}
              </Link>
            ) : (
              <span className="text-gray-400">Загрузка...</span>
            )}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ActivityIcon className="h-3.5 w-3.5" />
            {meta.label}
          </span>
          {route.likes_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <Heart className="h-3.5 w-3.5" />
              {route.likes_count}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {formatDate(route.updated_at || route.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Карточка маршрута — вид «списком» (List)
// ─────────────────────────────────────────────────────────────────────────────

function RouteCardList({ route, isOwn, adminReadOnly, isPublishing, onCardClick, onTogglePublic, onDeleteClick, onDownloadGpx, onPhoneShare }) {
  const { user } = useAuthStore();
  const { parentAuthor, forkParentId } = useForkParentAuthor(route);
  const meta = ACTIVITY_META[route.activity_type] ?? ACTIVITY_META.foot;
  const ActivityIcon = meta.icon;
  const coverUrl = getCoverUrl(route);
  const [coverError, setCoverError] = useState(false);
  const isCopiedRoute = isForkCopy(route);
  const parentAuthorHref =
    user?.id && parentAuthor?.id && String(user.id) === String(parentAuthor.id)
      ? '/profile'
      : `/user/${parentAuthor?.id ?? ''}`;

  const handleClick = () => onCardClick?.(route);
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="flex cursor-pointer items-center gap-4 overflow-hidden rounded-xl border border-border bg-card p-3 shadow-sm transition-shadow transition-colors hover:bg-muted/50 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
        {coverUrl && !coverError ? (
          <img
            src={coverUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setCoverError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-300">
            <ImageIcon className="h-6 w-6 text-gray-500" />
          </div>
        )}
        {forkParentId && (
          <span className="pointer-events-none absolute left-1 top-1 z-10 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-gray-700 shadow-sm">
            Копия
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate font-medium text-foreground">{route.title || 'Без названия'}</h3>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              route.is_public
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}
            title={route.is_public ? 'Маршрут опубликован' : 'Маршрут приватный'}
          >
            {route.is_public ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            {route.is_public ? 'Публичный' : 'Приватный'}
          </span>
        </div>
        {isCopiedRoute && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
            <span>Основа от:</span>
            {parentAuthor ? (
              <Link
                to={parentAuthorHref}
                className="relative z-10 text-blue-500 hover:text-blue-700 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {parentAuthor.username
                  ? `@${String(parentAuthor.username).trim()}`
                  : (parentAuthor.full_name || 'Анонимный турист')}
              </Link>
            ) : (
              <span className="text-gray-400">Загрузка...</span>
            )}
          </div>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ActivityIcon className="h-3.5 w-3.5" />
            {meta.label}
          </span>
          <span>{formatDistance(route.total_distance)}</span>
          <span>{formatDuration(route.duration)}</span>
          {route.likes_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <Heart className="h-3.5 w-3.5" />
              {route.likes_count}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="text-right text-xs text-muted-foreground">
          {formatDate(route.updated_at || route.created_at)}
        </div>
        {isOwn && !adminReadOnly && (
          <details
            className="relative"
            onClick={(e) => e.stopPropagation()}
          >
            <summary
              className="list-none rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </summary>
            <div className="absolute right-0 mt-1 w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
              <button
                type="button"
                className="flex w-full items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-sm font-normal text-foreground hover:bg-muted"
                disabled={isPublishing || isCopiedRoute}
                title={isCopiedRoute ? 'Нельзя опубликовать маршрут, созданный на основе чужого' : ''}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onTogglePublic?.(route);
                }}
              >
                {isPublishing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : route.is_public ? (
                  <Lock className="h-4 w-4" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
                {isCopiedRoute ? 'Публикация недоступна' : (route.is_public ? 'Сделать приватным' : 'Опубликовать')}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-sm font-normal text-foreground hover:bg-muted"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDownloadGpx?.(route);
                }}
              >
                <FileDown className="h-4 w-4" />
                Скачать GPX
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-sm font-normal text-foreground hover:bg-muted"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onPhoneShare?.(route);
                }}
              >
                <Smartphone className="h-4 w-4" />
                На телефон
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDeleteClick?.(route);
                }}
              >
                <Trash2 className="h-4 w-4" />
                Удалить
              </button>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
