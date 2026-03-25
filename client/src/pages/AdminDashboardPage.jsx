import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Flag, Users, Map as MapIcon, XCircle, Eye, AlertTriangle,
  Unlock, Trash2, Search, RefreshCw, ChevronLeft, ChevronRight,
} from 'lucide-react';

import { supabase } from '@/lib/supabaseClient';
import { issueStrikeToUser } from '@/lib/adminModeration';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AdminReportModal, { REPORT_KIND_LABEL } from '@/components/AdminReportModal';

// ─── Утилиты ─────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function displayName(profile) {
  if (!profile) return '—';
  const name = [profile.full_name, profile.last_name].filter(Boolean).join(' ');
  return name || profile.username || profile.email || '—';
}

/**
 * Профиль автора из ответа Supabase: embed может вернуть объект или массив;
 * также поддерживаем alias `author` (как в /api/routes/public).
 */
function getRouteAuthorProfile(route) {
  const raw = route?.profiles ?? route?.author;
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] ?? null : raw;
}

/** Метки активности маршрута. */
const ACTIVITY_LABELS = {
  walking: 'Пешком',
  cycling: 'Велосипед',
  driving: 'Авто',
  hiking: 'Поход',
  water: 'Водный',
  foot: 'Пешком',
  bike: 'Велосипед',
  car: 'Авто',
};

// ─── Бейдж статуса бана (outline-стиль для белой темы) ───────────────────────

function BanStatus({ isPermaBanned, banExpiresAt, strikesCount }) {
  if (isPermaBanned) {
    return (
      <span className="inline-flex items-center rounded-full border border-red-200 px-2.5 py-0.5 text-xs font-medium text-red-600">
        Перм. бан
      </span>
    );
  }
  if (banExpiresAt && new Date(banExpiresAt) > new Date()) {
    return (
      <span className="inline-flex items-center whitespace-nowrap rounded-full border border-red-200 px-2.5 py-0.5 text-xs font-medium text-red-600">
        Бан до {new Date(banExpiresAt).toLocaleDateString('ru-RU')}
      </span>
    );
  }
  if (strikesCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-yellow-300 bg-yellow-50 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
        <AlertTriangle className="h-3 w-3" />
        {strikesCount}/3 страйка
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-emerald-200 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
      Активен
    </span>
  );
}

// ─── Главный компонент ────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const [reports, setReports]   = useState([]);
  const [users, setUsers]       = useState([]);
  const [routes, setRoutes]     = useState([]);

  const [loadingReports, setLoadingReports] = useState(false);
  const [loadingUsers, setLoadingUsers]     = useState(false);
  const [loadingRoutes, setLoadingRoutes]   = useState(false);

  const [activeTab, setActiveTab] = useState('reports');

  const [userSearch, setUserSearch]   = useState('');
  const [routeSearch, setRouteSearch] = useState('');

  // ── Фильтры ──────────────────────────────────────────────────────────────
  const [userStatusFilter, setUserStatusFilter]           = useState('all');
  const [routeVisibilityFilter, setRouteVisibilityFilter] = useState('all');
  const [routeActivityFilter, setRouteActivityFilter]     = useState('all');
  const [routeSortOrder, setRouteSortOrder]               = useState('desc');
  const [reportTypeFilter, setReportTypeFilter]           = useState('all');
  const [reportSortOrder, setReportSortOrder]             = useState('desc');

  // ── Пагинация ─────────────────────────────────────────────────────────────
  const ADMIN_PAGE_SIZE = 10;
  const [userPage, setUserPage]     = useState(1);
  const [routePage, setRoutePage]   = useState(1);
  const [reportPage, setReportPage] = useState(1);

  const [reviewReport, setReviewReport] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  const loadReports = useCallback(async () => {
    setLoadingReports(true);
    const { data, error } = await supabase
      .from('reports')
      .select(`
        *,
        reporter:profiles!reports_reporter_id_fkey(username, full_name, last_name),
        reported_user:profiles!reports_reported_user_id_fkey(username, full_name, last_name),
        reported_route:routes(title),
        reported_comment:route_comments!reports_reported_comment_id_fkey(id, text)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error(`Ошибка загрузки жалоб: ${error.message}`);
    } else {
      setReports(data ?? []);
    }
    setLoadingReports(false);
  }, []);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, last_name, username, email, role, strikes_count, ban_expires_at, is_perma_banned')
      .neq('role', 'admin')
      .order('full_name', { ascending: true });

    if (error) {
      toast.error(`Ошибка загрузки пользователей: ${error.message}`);
    } else {
      setUsers(data ?? []);
    }
    setLoadingUsers(false);
  }, []);

  const loadRoutes = useCallback(async () => {
    setLoadingRoutes(true);
    // author_id в БД ссылается на public.users, а не на profiles — PostgREST не делает
    // автоматический embed profiles(...). Подтягиваем профили вторым запросом.
    const { data: routesData, error } = await supabase
      .from('routes')
      .select('id, title, activity_type, is_public, created_at, author_id')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error(`Ошибка загрузки маршрутов: ${error.message}`);
      setRoutes([]);
      setLoadingRoutes(false);
      return;
    }

    const list = routesData ?? [];
    const authorIds = [...new Set(list.map((r) => r.author_id).filter(Boolean))];
    let byAuthorId = new Map();
    if (authorIds.length > 0) {
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, full_name, last_name, username, email')
        .in('id', authorIds);
      if (pErr) {
        toast.error(`Не удалось загрузить авторов маршрутов: ${pErr.message}`);
      } else {
        byAuthorId = new Map((profiles ?? []).map((p) => [p.id, p]));
      }
    }

    setRoutes(
      list.map((r) => ({
        ...r,
        profiles: r.author_id ? byAuthorId.get(r.author_id) ?? null : null,
      })),
    );
    setLoadingRoutes(false);
  }, []);

  useEffect(() => {
    if (activeTab === 'reports') loadReports();
    if (activeTab === 'users')   loadUsers();
    if (activeTab === 'routes')  loadRoutes();
  }, [activeTab, loadReports, loadUsers, loadRoutes]);

  const dismissReport = async (reportId) => {
    const { error } = await supabase
      .from('reports')
      .update({ status: 'rejected' })
      .eq('id', reportId);

    if (error) {
      toast.error(`Ошибка: ${error.message}`);
    } else {
      toast.success('Жалоба отклонена');
      loadReports();
    }
  };

  const handleIssueStrike = async (userId, currentStrikes) => {
    const ok = await issueStrikeToUser(userId, currentStrikes);
    if (ok) loadUsers();
  };

  const unbanUser = async (userId) => {
    const { error } = await supabase
      .from('profiles')
      .update({ ban_expires_at: null, is_perma_banned: false, strikes_count: 0 })
      .eq('id', userId);

    if (error) {
      toast.error(`Ошибка разблокировки: ${error.message}`);
    } else {
      toast.success('Пользователь разблокирован, страйки сброшены');
      loadUsers();
    }
  };

  const deleteRoute = async (routeId) => {
    // Находим маршрут в локальном стейте, чтобы получить автора и название
    const route = routes.find((r) => r.id === routeId);

    // Отправляем системное уведомление автору перед удалением
    if (route?.author_id && route?.title) {
      const { data: authorProfile } = await supabase
        .from('profiles')
        .select('system_messages')
        .eq('id', route.author_id)
        .maybeSingle();

      const current = authorProfile?.system_messages ?? [];
      const msg = `Ваш маршрут "${route.title}" был удален модератором за нарушение правил.`;
      await supabase
        .from('profiles')
        .update({ system_messages: [...current, msg] })
        .eq('id', route.author_id);
    }

    const { error } = await supabase
      .from('routes')
      .delete()
      .eq('id', routeId);

    if (error) {
      toast.error(`Ошибка удаления: ${error.message}`);
    } else {
      toast.success('Маршрут удалён');
      loadRoutes();
    }
  };


  // Сброс страницы при изменении фильтров / поиска
  useEffect(() => { setUserPage(1); }, [userSearch, userStatusFilter]);
  useEffect(() => { setRoutePage(1); }, [routeSearch, routeVisibilityFilter, routeActivityFilter, routeSortOrder]);
  useEffect(() => { setReportPage(1); }, [reportTypeFilter, reportSortOrder]);

  // ── Фильтрация ────────────────────────────────────────────────────────────

  const filteredUsers = users.filter((u) => {
    const q = userSearch.toLowerCase();
    const matchesSearch =
      !q ||
      u.full_name?.toLowerCase().includes(q) ||
      u.last_name?.toLowerCase().includes(q) ||
      u.username?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q);

    const isBanned =
      u.is_perma_banned || (u.ban_expires_at && new Date(u.ban_expires_at) > new Date());
    const matchesStatus =
      userStatusFilter === 'all' ||
      (userStatusFilter === 'active' && !isBanned) ||
      (userStatusFilter === 'banned' && isBanned);

    return matchesSearch && matchesStatus;
  });

  // Нормализуем тип активности для сравнения (foot/walking → foot, bike/cycling → bike)
  const ACTIVITY_NORM = { walking: 'foot', cycling: 'bike', driving: 'car' };
  const normalizeActivity = (v) => ACTIVITY_NORM[v] ?? v;

  const filteredRoutes = routes
    .filter((r) => {
      const q = routeSearch.toLowerCase();
      const matchesSearch = !q || r.title?.toLowerCase().includes(q);
      const matchesVisibility =
        routeVisibilityFilter === 'all' ||
        (routeVisibilityFilter === 'public' && r.is_public) ||
        (routeVisibilityFilter === 'private' && !r.is_public);
      const matchesActivity =
        routeActivityFilter === 'all' ||
        normalizeActivity(r.activity_type) === routeActivityFilter;
      return matchesSearch && matchesVisibility && matchesActivity;
    })
    .sort((a, b) => {
      const diff = new Date(a.created_at) - new Date(b.created_at);
      return routeSortOrder === 'desc' ? -diff : diff;
    });

  const filteredReports = reports
    .filter((r) => reportTypeFilter === 'all' || r.report_type === reportTypeFilter)
    .sort((a, b) => {
      const diff = new Date(a.created_at) - new Date(b.created_at);
      return reportSortOrder === 'desc' ? -diff : diff;
    });

  // ── Пагинация: срезы текущей страницы ────────────────────────────────────

  const userTotalPages   = Math.max(1, Math.ceil(filteredUsers.length / ADMIN_PAGE_SIZE));
  const routeTotalPages  = Math.max(1, Math.ceil(filteredRoutes.length / ADMIN_PAGE_SIZE));
  const reportTotalPages = Math.max(1, Math.ceil(filteredReports.length / ADMIN_PAGE_SIZE));

  const pagedUsers   = filteredUsers.slice((userPage - 1) * ADMIN_PAGE_SIZE, userPage * ADMIN_PAGE_SIZE);
  const pagedRoutes  = filteredRoutes.slice((routePage - 1) * ADMIN_PAGE_SIZE, routePage * ADMIN_PAGE_SIZE);
  const pagedReports = filteredReports.slice((reportPage - 1) * ADMIN_PAGE_SIZE, reportPage * ADMIN_PAGE_SIZE);

  const openConfirm = (label, onConfirm) => {
    setConfirmAction({ label, onConfirm });
  };

  // Рендер: целевая ссылка в таблице жалоб
  function ReportTargetCell({ r }) {
    if (r.report_type === 'user' && r.reported_user_id) {
      return (
        <Link
          to={`/user/${r.reported_user_id}`}
          state={{ fromAdminList: true }}
          className="font-medium text-neutral-900 underline underline-offset-4 hover:text-yellow-600"
        >
          {displayName(r.reported_user)}
        </Link>
      );
    }
    if (r.report_type === 'route' && r.reported_route_id) {
      return (
        <Link
          to={`/routes/${r.reported_route_id}`}
          state={{ fromAdminList: true }}
          className="font-medium text-neutral-900 underline underline-offset-4 hover:text-yellow-600"
        >
          {r.reported_route?.title || 'Маршрут'}
        </Link>
      );
    }
    if (r.report_type === 'comment' && r.reported_comment_id) {
      const body = r.reported_comment?.text?.trim() ?? '';
      const preview = body.length > 30 ? `${body.slice(0, 30)}…` : body;
      const fallbackId = `(${String(r.reported_comment_id).slice(0, 8)}…)`;
      return (
        <span
          className="max-w-[min(100%,20rem)] text-neutral-500"
          title={body || undefined}
        >
          {preview ? (
            <span className="text-neutral-800">{preview}</span>
          ) : (
            <span>
              Комментарий <span className="font-mono text-xs">{fallbackId}</span>
            </span>
          )}
        </span>
      );
    }
    return '—';
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        <Tabs value={activeTab} onValueChange={setActiveTab}>

          {/* ── Навигационные табы: белый фон, активный = чёрный + жёлтый текст ── */}
          <TabsList className="mb-6 inline-flex gap-1 rounded-2xl border border-neutral-100 bg-white p-1.5 shadow-sm">
            <TabsTrigger
              value="reports"
              className="gap-2 rounded-xl px-4 py-2 text-sm font-medium text-neutral-500
                         transition-all duration-200 hover:bg-neutral-50 hover:text-neutral-900
                         data-[state=active]:bg-black data-[state=active]:text-white
                         data-[state=active]:font-semibold data-[state=active]:shadow-none"
            >
              <Flag className="h-4 w-4" />
              Жалобы
            </TabsTrigger>

            <TabsTrigger
              value="users"
              className="gap-2 rounded-xl px-4 py-2 text-sm font-medium text-neutral-500
                         transition-all duration-200 hover:bg-neutral-50 hover:text-neutral-900
                         data-[state=active]:bg-black data-[state=active]:text-white
                         data-[state=active]:font-semibold data-[state=active]:shadow-none"
            >
              <Users className="h-4 w-4" />
              Пользователи
            </TabsTrigger>

            <TabsTrigger
              value="routes"
              className="gap-2 rounded-xl px-4 py-2 text-sm font-medium text-neutral-500
                         transition-all duration-200 hover:bg-neutral-50 hover:text-neutral-900
                         data-[state=active]:bg-black data-[state=active]:text-white
                         data-[state=active]:font-semibold data-[state=active]:shadow-none"
            >
              <MapIcon className="h-4 w-4" />
              Маршруты
            </TabsTrigger>
          </TabsList>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* Вкладка: Жалобы                                                */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <TabsContent value="reports">
            <div className="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-neutral-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold text-neutral-900">Ожидающие рассмотрения</h2>
                  <p className="mt-0.5 text-xs text-neutral-400">Входящие жалобы от пользователей</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <FilterSelect
                    value={reportSortOrder}
                    onChange={setReportSortOrder}
                    options={[
                      { value: 'desc', label: 'Сначала новые' },
                      { value: 'asc',  label: 'Сначала старые' },
                    ]}
                  />
                  <FilterSelect
                    value={reportTypeFilter}
                    onChange={setReportTypeFilter}
                    options={[
                      { value: 'all',     label: 'Все типы' },
                      { value: 'user',    label: 'На пользователя' },
                      { value: 'route',   label: 'На маршрут' },
                      { value: 'comment', label: 'На комментарий' },
                    ]}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadReports}
                    disabled={loadingReports}
                    className="gap-1.5 rounded-lg border border-neutral-200 bg-white text-neutral-500
                               hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-800
                               transition-all duration-200"
                  >
                    <RefreshCw className={`h-4 w-4 ${loadingReports ? 'animate-spin' : ''}`} />
                    Обновить
                  </Button>
                </div>
              </div>

              {loadingReports ? (
                <LoadingRows cols={5} />
              ) : filteredReports.length === 0 ? (
                <EmptyState
                  icon={<Flag className="h-8 w-8 text-neutral-300" />}
                  text="Жалоб нет — всё чисто!"
                />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-neutral-100">
                          <Th>Дата</Th>
                          <Th>Кто пожаловался</Th>
                          <Th>Тип</Th>
                          <Th>Причина / Комментарий</Th>
                          <Th>На кого / Что</Th>
                          <Th>Действия</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 bg-white">
                        {pagedReports.map((r) => (
                          <tr
                            key={r.id}
                            className="transition-colors duration-150 hover:bg-neutral-50"
                          >
                            <Td className="whitespace-nowrap text-xs text-neutral-400">
                              {fmtDate(r.created_at)}
                            </Td>
                            <Td>
                              {r.reporter_id ? (
                                <Link
                                  to={`/user/${r.reporter_id}`}
                                  state={{ fromAdminList: true }}
                                  className="font-medium text-neutral-900 underline underline-offset-4 hover:text-yellow-600"
                                >
                                  {displayName(r.reporter)}
                                </Link>
                              ) : (
                                <span className="text-neutral-700">{displayName(r.reporter)}</span>
                              )}
                            </Td>
                            <Td>
                              <span className="inline-flex items-center whitespace-nowrap rounded-full border border-yellow-300 bg-yellow-50 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
                                {REPORT_KIND_LABEL[r.report_type] || r.report_type}
                              </span>
                            </Td>
                            <Td>
                              <p className="font-medium text-neutral-800">{r.reason}</p>
                              {r.comment && (
                                <p className="mt-0.5 line-clamp-2 text-xs text-neutral-400">
                                  {r.comment}
                                </p>
                              )}
                            </Td>
                            <Td className="font-medium">
                              <ReportTargetCell r={r} />
                            </Td>
                            <Td>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-1.5 rounded-lg border border-neutral-200 bg-white text-neutral-500
                                             hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-800
                                             transition-all duration-200"
                                  onClick={() =>
                                    openConfirm(
                                      'Отклонить эту жалобу?',
                                      () => dismissReport(r.id),
                                    )
                                  }
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  Отклонить
                                </Button>
                                <Button
                                  size="sm"
                                  className="gap-1.5 rounded-lg border-0 bg-black font-semibold
                                             text-white transition-all duration-200
                                             hover:bg-neutral-800 hover:-translate-y-0.5"
                                  onClick={() => setReviewReport(r)}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  Рассмотреть
                                </Button>
                              </div>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    page={reportPage}
                    totalPages={reportTotalPages}
                    total={filteredReports.length}
                    pageSize={ADMIN_PAGE_SIZE}
                    onPrev={() => setReportPage((p) => Math.max(1, p - 1))}
                    onNext={() => setReportPage((p) => Math.min(reportTotalPages, p + 1))}
                  />
                </>
              )}
            </div>
          </TabsContent>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* Вкладка: Пользователи                                          */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <TabsContent value="users">
            <div className="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-neutral-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold text-neutral-900">Все пользователи</h2>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {users.length} зарегистрировано
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                    <Input
                      placeholder="Поиск по имени или email..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      className="h-9 w-56 rounded-lg border-neutral-200 bg-white
                                 pl-9 text-sm text-neutral-800 placeholder:text-neutral-400
                                 focus-visible:border-black focus-visible:ring-0
                                 transition-all duration-200"
                    />
                  </div>
                  <FilterSelect
                    value={userStatusFilter}
                    onChange={setUserStatusFilter}
                    options={[
                      { value: 'all',    label: 'Все статусы' },
                      { value: 'active', label: 'Активен' },
                      { value: 'banned', label: 'Заблокирован' },
                    ]}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadUsers}
                    disabled={loadingUsers}
                    className="rounded-lg border border-neutral-200 bg-white text-neutral-500
                               hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-800
                               transition-all duration-200"
                  >
                    <RefreshCw className={`h-4 w-4 ${loadingUsers ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>

              {loadingUsers ? (
                <LoadingRows cols={6} />
              ) : filteredUsers.length === 0 ? (
                <EmptyState
                  icon={<Users className="h-8 w-8 text-neutral-300" />}
                  text="Пользователи не найдены"
                />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-neutral-100">
                          <Th>Пользователь</Th>
                          <Th>Email</Th>
                          <Th>Роль</Th>
                          <Th>Страйки</Th>
                          <Th>Статус</Th>
                          <Th>Действия</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 bg-white">
                        {pagedUsers.map((u) => {
                          const isBanned =
                            u.is_perma_banned ||
                            (u.ban_expires_at && new Date(u.ban_expires_at) > new Date());
                          return (
                            <tr
                              key={u.id}
                              className="transition-colors duration-150 hover:bg-neutral-50"
                            >
                              <Td>
                                <div>
                                  <Link
                                    to={`/user/${u.id}`}
                                    state={{ fromAdminList: true }}
                                    className="font-semibold text-neutral-900 underline-offset-4
                                               transition-colors duration-150 hover:text-yellow-600 hover:underline"
                                  >
                                    {displayName(u)}
                                  </Link>
                                  {u.username && (
                                    <p className="mt-0.5 text-xs text-neutral-400">
                                      @{u.username}
                                    </p>
                                  )}
                                </div>
                              </Td>
                              <Td className="text-sm text-neutral-500">{u.email || '—'}</Td>
                              <Td>
                                {u.role === 'admin' ? (
                                  <span className="inline-flex items-center rounded-full bg-black px-2.5 py-0.5 text-xs font-semibold text-white">
                                    Админ
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs font-medium text-neutral-600">
                                    Пользователь
                                  </span>
                                )}
                              </Td>
                              <Td>
                                <div className="flex items-center gap-1.5">
                                  {[0, 1, 2].map((i) => (
                                    <div
                                      key={i}
                                      className={`h-2 w-6 rounded-full ${
                                        i < (u.strikes_count ?? 0)
                                          ? 'bg-red-400'
                                          : 'bg-neutral-200'
                                      }`}
                                    />
                                  ))}
                                  <span className="ml-1 text-xs text-neutral-400">
                                    {u.strikes_count ?? 0}/3
                                  </span>
                                </div>
                              </Td>
                              <Td>
                                <BanStatus
                                  isPermaBanned={u.is_perma_banned}
                                  banExpiresAt={u.ban_expires_at}
                                  strikesCount={u.strikes_count}
                                />
                              </Td>
                              <Td>
                                {u.role !== 'admin' && (
                                  <div className="flex items-center gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={u.is_perma_banned}
                                      className="gap-1.5 rounded-lg border border-red-200 bg-white text-red-600
                                                 hover:border-red-300 hover:bg-red-50 transition-all duration-200
                                                 disabled:opacity-40"
                                      onClick={() =>
                                        openConfirm(
                                          `Выдать страйк пользователю ${displayName(u)}?`,
                                          () => handleIssueStrike(u.id, u.strikes_count ?? 0),
                                        )
                                      }
                                    >
                                      <AlertTriangle className="h-3.5 w-3.5" />
                                      Страйк
                                    </Button>
                                    {isBanned && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="gap-1.5 rounded-lg border border-emerald-200 bg-white text-emerald-700
                                                   hover:border-emerald-300 hover:bg-emerald-50 transition-all duration-200"
                                        onClick={() =>
                                          openConfirm(
                                            `Разблокировать ${displayName(u)}?`,
                                            () => unbanUser(u.id),
                                          )
                                        }
                                      >
                                        <Unlock className="h-3.5 w-3.5" />
                                        Разблокировать
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    page={userPage}
                    totalPages={userTotalPages}
                    total={filteredUsers.length}
                    pageSize={ADMIN_PAGE_SIZE}
                    onPrev={() => setUserPage((p) => Math.max(1, p - 1))}
                    onNext={() => setUserPage((p) => Math.min(userTotalPages, p + 1))}
                  />
                </>
              )}
            </div>
          </TabsContent>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* Вкладка: Маршруты                                              */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <TabsContent value="routes">
            <div className="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-neutral-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold text-neutral-900">Все маршруты</h2>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {routes.length} маршрутов в базе
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                    <Input
                      placeholder="Поиск по названию..."
                      value={routeSearch}
                      onChange={(e) => setRouteSearch(e.target.value)}
                      className="h-9 w-44 rounded-lg border-neutral-200 bg-white
                                 pl-9 text-sm text-neutral-800 placeholder:text-neutral-400
                                 focus-visible:border-black focus-visible:ring-0
                                 transition-all duration-200"
                    />
                  </div>
                  <FilterSelect
                    value={routeSortOrder}
                    onChange={setRouteSortOrder}
                    options={[
                      { value: 'desc', label: 'Сначала новые' },
                      { value: 'asc',  label: 'Сначала старые' },
                    ]}
                  />
                  <FilterSelect
                    value={routeActivityFilter}
                    onChange={setRouteActivityFilter}
                    options={[
                      { value: 'all',  label: 'Все типы' },
                      { value: 'foot', label: 'Пешком' },
                      { value: 'bike', label: 'Велосипед' },
                      { value: 'car',  label: 'Авто' },
                    ]}
                  />
                  <FilterSelect
                    value={routeVisibilityFilter}
                    onChange={setRouteVisibilityFilter}
                    options={[
                      { value: 'all',     label: 'Все' },
                      { value: 'public',  label: 'Публичные' },
                      { value: 'private', label: 'Приватные' },
                    ]}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadRoutes}
                    disabled={loadingRoutes}
                    className="rounded-lg border border-neutral-200 bg-white text-neutral-500
                               hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-800
                               transition-all duration-200"
                  >
                    <RefreshCw className={`h-4 w-4 ${loadingRoutes ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>

              {loadingRoutes ? (
                <LoadingRows cols={5} />
              ) : filteredRoutes.length === 0 ? (
                <EmptyState
                  icon={<MapIcon className="h-8 w-8 text-neutral-300" />}
                  text="Маршруты не найдены"
                />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-neutral-100">
                          <Th>Название</Th>
                          <Th>Тип активности</Th>
                          <Th>Автор</Th>
                          <Th>Дата создания</Th>
                          <Th>Видимость</Th>
                          <Th>Действия</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 bg-white">
                        {pagedRoutes.map((r) => (
                          <tr
                            key={r.id}
                            className="transition-colors duration-150 hover:bg-neutral-50"
                          >
                            <Td className="max-w-[220px]">
                              <Link
                                to={`/routes/${r.id}`}
                                state={{ fromAdminList: true }}
                                className="line-clamp-2 font-semibold text-neutral-900 underline-offset-4
                                           transition-colors duration-150 hover:text-yellow-600 hover:underline"
                              >
                                {r.title || '(без названия)'}
                              </Link>
                            </Td>
                            <Td>
                              <span className="inline-flex items-center rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs font-medium text-neutral-600">
                                {ACTIVITY_LABELS[r.activity_type] || r.activity_type || '—'}
                              </span>
                            </Td>
                            <Td>
                              {r.author_id ? (
                                <Link
                                  to={`/user/${r.author_id}`}
                                  state={{ fromAdminList: true }}
                                  className="text-neutral-700 underline-offset-4 hover:text-yellow-600 hover:underline"
                                >
                                  {displayName(getRouteAuthorProfile(r))}
                                </Link>
                              ) : (
                                <span className="text-xs text-neutral-400">—</span>
                              )}
                            </Td>
                            <Td className="whitespace-nowrap text-xs text-neutral-400">
                              {fmtDate(r.created_at)}
                            </Td>
                            <Td>
                              {r.is_public ? (
                                <span className="inline-flex items-center rounded-full border border-emerald-200 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                                  Публичный
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs font-medium text-neutral-500">
                                  Приватный
                                </span>
                              )}
                            </Td>
                            <Td>
                              <div className="flex items-center gap-2">
                                {/* Удалить: красный — первый слева */}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-1.5 rounded-lg border border-red-200 bg-white text-red-600
                                             hover:border-red-300 hover:bg-red-50 transition-all duration-200"
                                  onClick={() =>
                                    openConfirm(
                                      `Удалить маршрут «${r.title || 'без названия'}»?`,
                                      () => deleteRoute(r.id),
                                    )
                                  }
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Удалить
                                </Button>
                              </div>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    page={routePage}
                    totalPages={routeTotalPages}
                    total={filteredRoutes.length}
                    pageSize={ADMIN_PAGE_SIZE}
                    onPrev={() => setRoutePage((p) => Math.max(1, p - 1))}
                    onNext={() => setRoutePage((p) => Math.min(routeTotalPages, p + 1))}
                  />
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {reviewReport && (
          <AdminReportModal
            report={reviewReport}
            onClose={() => setReviewReport(null)}
            onUpdated={loadReports}
          />
        )}

        {confirmAction && (
          <ConfirmDialog
            label={confirmAction.label}
            onConfirm={() => {
              confirmAction.onConfirm();
              setConfirmAction(null);
            }}
            onCancel={() => setConfirmAction(null)}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательные компоненты
// ─────────────────────────────────────────────────────────────────────────────

function Th({ children }) {
  return (
    <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-widest text-neutral-500">
      {children}
    </th>
  );
}

function Td({ children, className = '' }) {
  return <td className={`px-6 py-4 ${className}`}>{children}</td>;
}

function LoadingRows({ cols = 5 }) {
  return (
    <div className="space-y-4 p-6">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex gap-4">
          {[...Array(cols)].map((_, j) => (
            <div
              key={j}
              className="h-3.5 flex-1 animate-pulse rounded-full bg-neutral-100"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      {/* rounded-2xl — в точности как RouteCard */}
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-50 border border-neutral-100">
        {icon}
      </div>
      <p className="text-sm font-medium text-neutral-400">{text}</p>
    </div>
  );
}

/** Минималистичный выпадающий список для фильтрации. */
function FilterSelect({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-700
                 focus:border-black focus:outline-none focus:ring-0
                 transition-all duration-200 cursor-pointer hover:border-neutral-300"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/** Блок пагинации под таблицей. */
function Pagination({ page, totalPages, total, pageSize, onPrev, onNext }) {
  const from = Math.min((page - 1) * pageSize + 1, total);
  const to   = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between border-t border-neutral-100 px-6 py-3">
      <span className="text-xs text-neutral-400">
        Показано {from}–{to} из {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={onPrev}
          disabled={page === 1}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200
                     text-neutral-500 transition-all duration-150
                     hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-800
                     disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Предыдущая страница"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[3rem] text-center text-xs text-neutral-500">
          {page} / {totalPages}
        </span>
        <button
          onClick={onNext}
          disabled={page === totalPages}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200
                     text-neutral-500 transition-all duration-150
                     hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-800
                     disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Следующая страница"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ConfirmDialog({ label, onConfirm, onCancel }) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/25 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-full max-w-sm rounded-2xl border border-neutral-100 bg-white p-6 shadow-xl">
        <div className="mb-5 h-1 w-10 rounded-full bg-neutral-300" />
        <h3 className="mb-2 text-base font-bold text-neutral-900">
          Подтвердите действие
        </h3>
        <p className="mb-6 text-sm leading-relaxed text-neutral-500">{label}</p>
        <div className="flex justify-end gap-3">
          {/* Отмена: белая с чёрной рамкой */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="rounded-lg border border-neutral-300 bg-white text-neutral-700
                       hover:bg-neutral-50 hover:border-neutral-400 transition-all duration-200"
          >
            Отмена
          </Button>
          {/* Подтвердить: чёрный + белый текст */}
          <Button
            size="sm"
            onClick={onConfirm}
            className="rounded-lg border-0 bg-black font-semibold text-white
                       transition-all duration-200 hover:bg-neutral-800 hover:-translate-y-0.5"
          >
            Подтвердить
          </Button>
        </div>
      </div>
    </div>
  );
}
