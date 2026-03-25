import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Footprints,
  Bike,
  Car,
  Loader2,
  Ruler,
  User,
  Clock,
  TrendingUp,
  Calendar,
  Image as ImageIcon,
  Heart,
  MoreHorizontal,
  Flag,
} from 'lucide-react';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatCreatedDate,
} from '@/lib/routeFormatters';
import { supabase } from '@/lib/supabaseClient';
import useAuthStore from '@/store/useAuthStore';
import { useAdminReadOnly } from '@/hooks/useAdminReadOnly';
import ReportModal from '@/components/ReportModal';

const ACTIVITY_META = {
  foot: { label: 'Пешие',        Icon: Footprints, color: 'text-green-700',  bg: 'bg-green-50'  },
  bike: { label: 'Велосипедные', Icon: Bike,        color: 'text-blue-700',   bg: 'bg-blue-50'   },
  car:  { label: 'Авто',         Icon: Car,         color: 'text-orange-700', bg: 'bg-orange-50' },
};

/**
 * Нормализуем вложенный профиль автора:
 * - основной путь: route.profiles (при select('..., profiles(...)'))
 * - совместимость: route.author (старый alias)
 * - поддержка массива и объекта.
 */
function getRouteProfileData(route) {
  const rawProfile = route?.profiles || route?.author;
  const profileData = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;

  if (!profileData) {
    console.warn(
      `[RouteCard] Нет данных автора для маршрута ID: ${route?.id}, author_id: ${route?.author_id}. Данные маршрута:`,
      route,
    );
  }

  return profileData;
}

export function getRouteAuthorLabel(route) {
  const profileData = getRouteProfileData(route);
  const username = typeof profileData?.username === 'string' ? profileData.username.trim() : '';
  if (username) return `@${username}`;
  const fullName = typeof profileData?.full_name === 'string' ? profileData.full_name.trim() : '';
  if (fullName) return fullName;

  if (route?.author_name) {
    const legacy = String(route.author_name).trim();
    if (legacy) return legacy;
  }
  return 'Анонимный турист';
}

export function getRouteAuthorAvatar(route) {
  const profileData = getRouteProfileData(route);
  return profileData?.avatar_url ?? route?.author_avatar ?? null;
}

/**
 * Карточка маршрута в списке поиска: обложка, метрики, кликабельный блок автора → /user/:id.
 */
export function RouteCard({ route, isSelected, isLoading, isHovered, onClick, onMouseEnter, onMouseLeave }) {
  const { user } = useAuthStore();
  const isAdminViewer = useAdminReadOnly();
  const [localProfile, setLocalProfile] = useState(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  /** Автор маршрута-источника (для копий). */
  const [parentAuthor, setParentAuthor] = useState(null);

  /** ID оригинала: после миграции 21 — parent_route_id; старые строки могли иметь только parent_id. */
  const forkParentId = route?.parent_route_id ?? route?.parent_id ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!forkParentId) {
      setParentAuthor(null);
      return () => { cancelled = true; };
    }

    const fetchParent = async () => {
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
      setParentAuthor({ id: profile.id, ...profile });
    };

    fetchParent();
    return () => { cancelled = true; };
  }, [forkParentId]);

  useEffect(() => {
    let cancelled = false;

    const propProfile = route?.profiles || route?.author;
    const initialProfile = Array.isArray(propProfile) ? propProfile[0] : propProfile;

    if (initialProfile?.full_name || initialProfile?.username) {
      setLocalProfile(initialProfile);
      setIsLoadingProfile(false);
      return () => { cancelled = true; };
    }

    if (!route?.author_id) {
      setLocalProfile(null);
      setIsLoadingProfile(false);
      return () => { cancelled = true; };
    }

    const fetchProfileIndependent = async () => {
      setIsLoadingProfile(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url')
        .eq('id', route.author_id)
        .single();

      if (cancelled) return;
      if (data && !error) {
        setLocalProfile(data);
      } else {
        setLocalProfile(null);
      }
      setIsLoadingProfile(false);
    };

    fetchProfileIndependent();
    return () => { cancelled = true; };
  }, [route]);

  const meta = ACTIVITY_META[route.activity_type] ?? ACTIVITY_META.foot;
  const { Icon: ActivityIcon } = meta;
  const [coverError, setCoverError] = useState(false);
  useEffect(() => { setCoverError(false); }, [route?.id, route?.cover_image_url]);
  const showCover = route.cover_image_url && !coverError;

  const [reportOpen, setReportOpen] = useState(false);
  const reportMenuRef = useRef(null);

  const displayName = localProfile?.username
    ? `@${localProfile.username}`
    : localProfile?.full_name
      ? localProfile.full_name
      : isLoadingProfile
        ? 'Загрузка...'
        : 'Анонимный турист';
  const authorAvatarUrl = localProfile?.avatar_url ?? getRouteAuthorAvatar(route);
  const authorId = route.author_id;
  const authorHref = user?.id && String(user.id) === String(authorId)
    ? '/profile'
    : `/user/${authorId}`;

  const isOtherUserRoute =
    Boolean(user?.id && authorId && String(user.id) !== String(authorId));

  const parentName = parentAuthor?.username
    ? `@${String(parentAuthor.username).trim()}`
    : parentAuthor?.full_name
      ? String(parentAuthor.full_name).trim()
      : 'Анонимный турист';

  const parentAuthorHref =
    user?.id && parentAuthor?.id && String(user.id) === String(parentAuthor.id)
      ? '/profile'
      : `/user/${parentAuthor?.id ?? ''}`;

  const authorBlock = (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
        {authorAvatarUrl ? (
          <img src={authorAvatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <User className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{displayName}</span>
    </span>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
      className={[
        'w-full cursor-pointer text-left rounded-2xl bg-white shadow-sm overflow-hidden transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isSelected && 'ring-2 ring-primary/50',
        isHovered && '-translate-y-1 shadow-md',
      ].join(' ')}
    >
      <div className="relative h-32 w-full shrink-0 overflow-hidden bg-neutral-100">
        {showCover ? (
          <div className="h-full w-full">
            <img
              src={route.cover_image_url}
              alt=""
              className="h-full w-full object-cover"
              onError={() => setCoverError(true)}
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-300">
            <ImageIcon className="h-10 w-10 text-gray-500" />
          </div>
        )}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        )}
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap items-center gap-2">
          {route.is_public === false && (
            <span className="rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-gray-700 shadow-sm backdrop-blur-sm">
              Приватный
            </span>
          )}
          {forkParentId && (
            <span className="rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-gray-700 shadow-sm backdrop-blur-sm">
              Копия
            </span>
          )}
        </div>
        {isOtherUserRoute && !isAdminViewer && (
          <div className="absolute right-2 top-2 z-20">
            <details
              ref={reportMenuRef}
              className="group/details relative"
              onClick={(e) => e.stopPropagation()}
            >
              <summary
                className="list-none rounded-md bg-white/90 p-1.5 text-gray-700 shadow-sm backdrop-blur-sm transition-colors hover:bg-white [&::-webkit-details-marker]:hidden"
                onClick={(e) => e.stopPropagation()}
                title="Действия"
              >
                <MoreHorizontal className="h-4 w-4" />
              </summary>
              <div className="absolute right-0 mt-1 w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (reportMenuRef.current) reportMenuRef.current.open = false;
                    setReportOpen(true);
                  }}
                >
                  <Flag className="h-4 w-4 shrink-0 text-amber-600" strokeWidth={2} aria-hidden />
                  Пожаловаться
                </button>
              </div>
            </details>
          </div>
        )}
      </div>
      <div className="px-4 pt-3 pb-2">
        <p className="font-bold text-sm leading-snug line-clamp-2">{route.title}</p>
        {forkParentId && (
          <div className="mb-2 mt-1 flex items-center gap-1 text-xs text-gray-500">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
            </svg>
            <span>Основа от:</span>
            {parentAuthor ? (
              <Link
                to={parentAuthorHref}
                className="pointer-events-auto relative z-10 text-blue-500 hover:text-blue-700 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {parentName}
              </Link>
            ) : (
              <span className="text-gray-400">Загрузка...</span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 pb-3 text-xs text-muted-foreground">
        <span className={`inline-flex items-center gap-1 ${meta.color}`}>
          <ActivityIcon className="h-3.5 w-3.5" />
          {meta.label}
        </span>
        <span className="inline-flex items-center gap-1">
          <Ruler className="h-3.5 w-3.5" />
          {formatDistance(route.total_distance ?? route.distance)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {formatDuration(route.duration)}
        </span>
        <span className="inline-flex items-center gap-1">
          <TrendingUp className="h-3.5 w-3.5" />
          {formatElevation(route.total_elevation)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Heart className="h-3.5 w-3.5" />
          {route.likes_count ?? 0}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 px-4 pb-3 text-xs text-muted-foreground">
        {authorId ? (
          <Link
            to={authorHref}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
            }}
            className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md -mx-1 px-1 py-0.5 text-left transition-colors hover:bg-muted/80 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {authorBlock}
          </Link>
        ) : (
          <div className="flex items-center gap-2">{authorBlock}</div>
        )}
        {route.created_at && (
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3 shrink-0" />
            {formatCreatedDate(route.created_at)}
          </span>
        )}
      </div>

      <ReportModal
        isOpen={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="route"
        targetId={route.id}
      />
    </div>
  );
}
