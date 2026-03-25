import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  XCircle, Loader2, AlertTriangle, CheckCircle2, Trash2,
} from 'lucide-react';

import { supabase } from '@/lib/supabaseClient';
import { issueStrikeToUser } from '@/lib/adminModeration';
import { cn } from '@/lib/utils';

/** Понятные подписи типа жалобы (для UI). */
export const REPORT_KIND_LABEL = {
  user: 'Жалоба на пользователя',
  route: 'Жалоба на маршрут',
  comment: 'Жалоба на комментарий',
};

/** Тип объекта в блоке «Проблемный контент» (кратко). */
const REPORT_OBJECT_TYPE_LABEL = {
  route: 'маршрут',
  comment: 'комментарий',
  user: 'пользователь',
};

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

/** URL обложки маршрута. */
function routeCoverUrl(route) {
  if (!route) return null;
  if (route.cover_image_url) return route.cover_image_url;
  const images = route.images;
  if (Array.isArray(images) && images[0]) return images[0];
  if (typeof images === 'string') {
    try {
      const arr = JSON.parse(images);
      return Array.isArray(arr) && arr[0] ? arr[0] : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Модальное окно рассмотрения жалобы.
 * Стиль: White + Black & Yellow — белый, чистый, с чёрными CTA и жёлтыми акцентами.
 */
export default function AdminReportModal({ report, onClose, onUpdated }) {
  const [working, setWorking] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  /** { type: 'comment'|'route'|'user', payload } */
  const [targetPayload, setTargetPayload] = useState(null);

  /**
   * Загружаем из БД сам объект жалобы: комментарий, маршрут или карточку пользователя.
   */
  useEffect(() => {
    if (!report) {
      setTargetPayload(null);
      return;
    }

    let cancelled = false;
    setLoadingContent(true);
    setTargetPayload(null);

    (async () => {
      try {
        const rt = report.report_type;

        if (rt === 'comment' && report.reported_comment_id) {
          const { data: row, error } = await supabase
            .from('route_comments')
            .select('id, text, user_id, route_id, created_at')
            .eq('id', report.reported_comment_id)
            .maybeSingle();

          if (error) throw error;

          let authorProfile = null;
          if (row?.user_id) {
            const { data: prof } = await supabase
              .from('profiles')
              .select('username, full_name, last_name')
              .eq('id', row.user_id)
              .maybeSingle();
            authorProfile = prof;
          }

          if (!cancelled) {
            setTargetPayload({ type: 'comment', comment: row, authorProfile });
          }
          return;
        }

        if (rt === 'route' && report.reported_route_id) {
          const { data: row, error } = await supabase
            .from('routes')
            .select('id, title, description, cover_image_url, images, author_id')
            .eq('id', report.reported_route_id)
            .maybeSingle();

          if (error) throw error;
          if (!cancelled) setTargetPayload({ type: 'route', route: row });
          return;
        }

        if (rt === 'user' && report.reported_user_id) {
          const { data: row, error } = await supabase
            .from('profiles')
            .select('id, username, full_name, last_name, bio, avatar_url')
            .eq('id', report.reported_user_id)
            .maybeSingle();

          if (error) throw error;
          if (!cancelled) setTargetPayload({ type: 'user', profile: row });
        }
      } catch (err) {
        console.error('[AdminReportModal] загрузка контента:', err);
        if (!cancelled) toast.error('Не удалось загрузить объект жалобы');
      } finally {
        if (!cancelled) setLoadingContent(false);
      }
    })();

    return () => { cancelled = true; };
  }, [
    report?.id,
    report?.report_type,
    report?.reported_comment_id,
    report?.reported_route_id,
    report?.reported_user_id,
  ]);

  const updateReport = async (status) => {
    const { error } = await supabase
      .from('reports')
      .update({ status })
      .eq('id', report.id);

    if (error) { toast.error(error.message); return false; }
    return true;
  };

  const finishClose = async (status, successToast) => {
    setWorking(true);
    const ok = await updateReport(status);
    setWorking(false);
    if (ok) { toast.success(successToast); onUpdated?.(); onClose(); }
  };

  /** Закрыть без нарушений — статус rejected. */
  const handleCloseNoViolation = () =>
    finishClose('rejected', 'Жалоба закрыта: нарушений не выявлено');

  const resolveAfterAction = async (msg) => {
    setWorking(true);
    const ok = await updateReport('resolved');
    setWorking(false);
    if (ok) { toast.success(msg); onUpdated?.(); onClose(); }
  };

  const handleStrikeAuthorId = async (authorId) => {
    if (!authorId) return;
    setWorking(true);
    const { data: prof, error } = await supabase
      .from('profiles')
      .select('strikes_count')
      .eq('id', authorId)
      .single();
    if (error) {
      toast.error('Не удалось получить данные пользователя');
      setWorking(false);
      return;
    }
    const ok = await issueStrikeToUser(authorId, prof.strikes_count ?? 0);
    setWorking(false);
    if (ok) await resolveAfterAction('Страйк применён, жалоба отмечена решённой');
  };

  const handleDeleteComment = async () => {
    if (!report.reported_comment_id) return;
    setWorking(true);

    // Отправляем системное уведомление автору комментария перед удалением
    const comment = targetPayload?.type === 'comment' ? targetPayload.comment : null;
    if (comment?.user_id) {
      const { data: authorProfile } = await supabase
        .from('profiles')
        .select('system_messages')
        .eq('id', comment.user_id)
        .maybeSingle();

      const current = authorProfile?.system_messages ?? [];
      const preview = (comment.text ?? '').substring(0, 20);
      const msg = `Ваш комментарий "${preview}..." был удален модератором за нарушение правил.`;
      await supabase
        .from('profiles')
        .update({ system_messages: [...current, msg] })
        .eq('id', comment.user_id);
    }

    const { error } = await supabase
      .from('route_comments')
      .delete()
      .eq('id', report.reported_comment_id);
    setWorking(false);
    if (error) { toast.error(error.message); return; }
    await resolveAfterAction('Комментарий удалён');
  };


  const handleDeleteRoute = async () => {
    if (!report.reported_route_id) return;
    setWorking(true);

    // Отправляем системное уведомление автору маршрута перед удалением
    const route = targetPayload?.type === 'route' ? targetPayload.route : null;
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
      .eq('id', report.reported_route_id);
    setWorking(false);
    if (error) { toast.error(error.message); return; }
    await resolveAfterAction('Маршрут удалён');
  };

  const handleStrikeReportedUser = async () => {
    if (!report.reported_user_id) return;
    await handleStrikeAuthorId(report.reported_user_id);
  };

  if (!report) return null;

  const kindLabel = REPORT_KIND_LABEL[report.report_type] || report.report_type || '—';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/25 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !working && onClose()}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">

        {/* ── Шапка ── */}
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-neutral-900">Рассмотрение жалобы</h3>
          </div>
          <button
            type="button"
            onClick={() => !working && onClose()}
            className="rounded-lg p-1.5 text-neutral-400 transition-all duration-200
                       hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Закрыть"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div
          className="max-h-[calc(100vh-200px)] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#a3a3a3_transparent]
                     [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-neutral-400/70
                     [&::-webkit-scrollbar-track]:bg-transparent"
        >
          <div className="space-y-5 px-6 py-5">

          {/* ── Мета-информация ── */}
          <div className="grid grid-cols-2 gap-4 rounded-2xl border border-neutral-100 bg-neutral-50 p-4 text-sm">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-400">
                Тип
              </p>
              <span className="inline-flex items-center rounded-full border border-yellow-300 bg-yellow-50 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
                {kindLabel}
              </span>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-400">
                Дата
              </p>
              <p className="font-medium text-neutral-800">{fmtDate(report.created_at)}</p>
            </div>
            <div className="col-span-2">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-400">
                Заявитель
              </p>
              {report.reporter?.id || report.reporter_id ? (
                <Link
                  to={`/user/${report.reporter_id}`}
                  className="font-medium text-neutral-900 underline underline-offset-4 hover:text-yellow-600"
                >
                  {displayName(report.reporter)}
                </Link>
              ) : (
                <span className="text-neutral-700">{displayName(report.reporter)}</span>
              )}
            </div>
          </div>

          {/* ── Проблемный контент ── */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-400">
              Проблемный контент
              {report.report_type && (
                <span className="ml-1 normal-case font-medium text-neutral-600">
                  — {REPORT_OBJECT_TYPE_LABEL[report.report_type] ?? report.report_type}
                </span>
              )}
            </p>
            <div className="rounded-2xl border border-neutral-100 bg-neutral-50 p-4 text-sm">
              {loadingContent && (
                <div className="flex items-center gap-2 text-neutral-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Загрузка…
                </div>
              )}

              {!loadingContent && report.report_type === 'comment' && targetPayload?.type === 'comment' && (
                <div className="space-y-2">
                  <p className="text-xs text-neutral-400">
                    Автор:{' '}
                    <Link
                      to={`/user/${targetPayload.comment?.user_id}`}
                      state={{ fromAdminReports: true }}
                      className="font-medium text-neutral-900 underline underline-offset-4 hover:text-yellow-600"
                    >
                      {displayName(targetPayload.authorProfile)}
                    </Link>
                  </p>
                  <p className="whitespace-pre-wrap leading-relaxed text-neutral-700">
                    {targetPayload.comment?.text || '—'}
                  </p>
                  {targetPayload.comment?.route_id && (
                    <p className="text-xs">
                      <Link
                        to={`/routes/${targetPayload.comment.route_id}`}
                        state={{ fromAdminReports: true }}
                        className="text-neutral-900 underline underline-offset-4 hover:text-yellow-600"
                      >
                        Открыть маршрут →
                      </Link>
                    </p>
                  )}
                </div>
              )}

              {!loadingContent && report.report_type === 'route' && targetPayload?.type === 'route' && (
                <div className="space-y-3">
                  {routeCoverUrl(targetPayload.route) && (
                    <img
                      src={routeCoverUrl(targetPayload.route)}
                      alt=""
                      className="max-h-40 w-full rounded-xl object-cover"
                    />
                  )}
                  <p className="font-bold text-neutral-900">
                    {targetPayload.route?.title || '—'}
                  </p>
                  <p className="whitespace-pre-wrap leading-relaxed text-neutral-500">
                    {targetPayload.route?.description || 'Нет описания'}
                  </p>
                  <Link
                    to={`/routes/${targetPayload.route?.id}`}
                    state={{ fromAdminReports: true }}
                    className="inline-block text-xs text-neutral-900 underline underline-offset-4 hover:text-yellow-600"
                  >
                    Открыть страницу маршрута →
                  </Link>
                </div>
              )}

              {!loadingContent && report.report_type === 'user' && targetPayload?.type === 'user' && (
                <div className="space-y-2">
                  <p className="font-bold text-neutral-900">
                    {displayName(targetPayload.profile)}
                  </p>
                  {targetPayload.profile?.username && (
                    <p className="text-xs text-neutral-400">
                      @{targetPayload.profile.username}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap leading-relaxed text-neutral-500">
                    {targetPayload.profile?.bio || '—'}
                  </p>
                  <Link
                    to={`/user/${targetPayload.profile?.id}`}
                    state={{ fromAdminReports: true }}
                    className="text-xs text-neutral-900 underline underline-offset-4 hover:text-yellow-600"
                  >
                    Публичный профиль →
                  </Link>
                </div>
              )}

              {!loadingContent && !targetPayload && (
                <p className="text-neutral-400">Нет данных для отображения</p>
              )}
            </div>
          </div>

          {/* ── Причина ── */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-400">
              Причина (из жалобы)
            </p>
            <p className="text-sm font-medium text-neutral-800">{report.reason}</p>
          </div>

          {/* ── Комментарий заявителя ── */}
          {report.comment && (
            <div className="rounded-2xl border border-neutral-100 bg-neutral-50 p-4 text-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-400">
                Комментарий заявителя
              </p>
              <p className="whitespace-pre-wrap leading-relaxed text-neutral-700">
                {report.comment}
              </p>
            </div>
          )}
          </div>

          {/* ── Панель действий: сетка плиток (без dropdown) ── */}
          <div className="border-t border-neutral-100 px-6 py-4">
          {report.report_type === 'route' && (
            <div className="grid grid-cols-2 gap-3">
              <ActionTile
                disabled={working}
                onClick={handleCloseNoViolation}
                icon={CheckCircle2}
                title="Нарушений нет"
                className="border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
              />
              <ActionTile
                disabled={working || !targetPayload?.route?.author_id}
                onClick={() => {
                  const aid = targetPayload?.route?.author_id;
                  if (aid) void handleStrikeAuthorId(aid);
                }}
                icon={AlertTriangle}
                title="Выдать страйк"
                className="border border-neutral-800 bg-neutral-900 text-white shadow-none hover:opacity-90"
              />
              <ActionTile
                disabled={working}
                onClick={() => { void handleDeleteRoute(); }}
                icon={Trash2}
                title="Удалить маршрут"
                className="border border-red-500 bg-white text-red-600 hover:bg-red-50"
              />
            </div>
          )}

          {report.report_type === 'comment' && (
            <div className="grid grid-cols-2 gap-3">
              <ActionTile
                disabled={working}
                onClick={handleCloseNoViolation}
                icon={CheckCircle2}
                title="Нарушений нет"
                className="col-span-2 border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
              />
              <ActionTile
                disabled={working}
                onClick={() => { void handleDeleteComment(); }}
                icon={Trash2}
                title="Удалить комментарий"
                className="border border-red-500 bg-white text-red-600 hover:bg-red-50"
              />
              <ActionTile
                disabled={working || !targetPayload?.comment?.user_id}
                onClick={() => {
                  const aid = targetPayload?.comment?.user_id;
                  if (aid) void handleStrikeAuthorId(aid);
                }}
                icon={AlertTriangle}
                title="Выдать страйк"
                className="border border-neutral-800 bg-neutral-900 text-white shadow-none hover:opacity-90"
              />
            </div>
          )}

          {report.report_type === 'user' && (
            <div className="grid grid-cols-2 gap-3">
              <ActionTile
                disabled={working}
                onClick={handleCloseNoViolation}
                icon={CheckCircle2}
                title="Нарушений нет"
                className="col-span-2 border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
              />
              <ActionTile
                disabled={working || !report.reported_user_id}
                onClick={() => { void handleStrikeReportedUser(); }}
                icon={AlertTriangle}
                title="Выдать страйк"
                className="col-span-2 border border-neutral-800 bg-neutral-900 text-white shadow-none hover:opacity-90"
              />
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Плитка действия в футере модалки: иконка слева, заголовок справа.
 */
function ActionTile({
  icon: Icon,
  title,
  onClick,
  disabled,
  className,
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl p-4 text-left shadow-sm transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 text-sm font-semibold leading-tight">{title}</span>
    </button>
  );
}
