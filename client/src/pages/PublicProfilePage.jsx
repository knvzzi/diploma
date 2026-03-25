import { useEffect, useState, useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Loader2, User, MapPin, Flag } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { RouteCard } from '@/components/RouteCard';
import ReportModal from '@/components/ReportModal';
import useAuthStore from '@/store/useAuthStore';
import { useAdminReadOnly } from '@/hooks/useAdminReadOnly';

/**
 * Публичная страница профиля: данные из profiles и только публичные маршруты автора.
 * Скрытые маршруты (is_public = false) не запрашиваются и не показываются.
 */
export default function PublicProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const isAdminViewer = useAdminReadOnly();
  const cameFromAdminReports = Boolean(location.state?.fromAdminReports);
  const showBackToList =
    isAdminViewer || Boolean(location.state?.fromAdminList) || cameFromAdminReports;

  const [profile, setProfile] = useState(null);
  const [routesRaw, setRoutesRaw] = useState([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingRoutes, setLoadingRoutes] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [reportUserOpen, setReportUserOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const loadProfile = async () => {
      setLoadingProfile(true);
      setNotFound(false);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, full_name, last_name, avatar_url, bio')
        .eq('id', id)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error('[PublicProfilePage] profile:', error);
        toast.error('Не удалось загрузить профиль');
        setProfile(null);
        setNotFound(true);
      } else if (!data) {
        setProfile(null);
        setNotFound(true);
      } else {
        setProfile(data);
      }
      setLoadingProfile(false);
    };

    loadProfile();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const loadRoutes = async () => {
      setLoadingRoutes(true);
      const { data, error } = await supabase
        .from('routes')
        .select(`
          id, title, description, activity_type, total_distance, total_elevation, duration,
          author_id, is_public, likes_count, parent_id, cover_image_url, created_at,
          profiles(id, username, full_name, last_name, avatar_url)
        `)
        .eq('author_id', id)
        .eq('is_public', true)
        .order('created_at', { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error('[PublicProfilePage] routes:', error);
        toast.error('Не удалось загрузить маршруты');
        setRoutesRaw([]);
      } else {
        setRoutesRaw(Array.isArray(data) ? data : []);
      }
      setLoadingRoutes(false);
    };

    loadRoutes();
    return () => { cancelled = true; };
  }, [id]);

  const handleCardClick = useCallback(
    (route) => {
      navigate(`/search?route=${route.id}`);
    },
    [navigate],
  );

  /**
   * Нормализация вложенного profiles из JOIN (PostgREST может вернуть объект или массив).
   * Если JOIN недоступен, подставляем профиль автора из уже загруженной шапки страницы.
   */
  const routes = useMemo(() => {
    const fallbackProfile = profile?.id
      ? {
          id: profile.id,
          username: profile.username ?? null,
          full_name: profile.full_name ?? null,
          last_name: profile.last_name ?? null,
          avatar_url: profile.avatar_url ?? null,
        }
      : null;

    return routesRaw.map((r) => {
      let profiles = r.profiles;
      if (Array.isArray(profiles)) profiles = profiles[0];
      if (!profiles?.id && fallbackProfile) {
        profiles = fallbackProfile;
      }
      const { profiles: _ignored, ...rest } = r;
      return { ...rest, profiles: profiles ?? null };
    });
  }, [routesRaw, profile]);

  const displayNameParts = [];
  if (profile?.full_name?.trim()) displayNameParts.push(profile.full_name.trim());
  if (profile?.last_name?.trim()) displayNameParts.push(profile.last_name.trim());
  const fullNameLine = displayNameParts.length > 0 ? displayNameParts.join(' ') : null;

  const canReportUser =
    Boolean(user?.id && profile?.id && String(user.id) !== String(profile.id)) && !isAdminViewer;

  if (!id) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <p className="text-muted-foreground">Некорректная ссылка</p>
      </div>
    );
  }

  if (loadingProfile) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Загрузка профиля…</p>
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <MapPin className="h-12 w-12 text-muted-foreground/40" />
        <div>
          <p className="text-lg font-medium text-foreground">Пользователь не найден</p>
          <p className="mt-1 text-sm text-muted-foreground">Проверьте ссылку или вернитесь к поиску маршрутов.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      {showBackToList && (
        <button
          type="button"
          onClick={() => {
            if (cameFromAdminReports) {
              navigate('/admin?tab=reports');
              return;
            }
            navigate(-1);
          }}
          className="mb-5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Назад к списку
        </button>
      )}
      <header className="flex flex-col items-center gap-4 border-b border-border pb-8 text-center sm:flex-row sm:items-start sm:text-left">
        <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <User className="h-14 w-14 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {profile.username?.trim() && (
            <p className="text-lg font-semibold text-primary">
              @{profile.username.trim()}
            </p>
          )}
          {fullNameLine && (
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{fullNameLine}</h1>
          )}
          {!fullNameLine && !profile.username?.trim() && (
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Путешественник</h1>
          )}
          {profile.bio?.trim() && (
            <p className="max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {profile.bio.trim()}
            </p>
          )}
          {canReportUser && (
            <button
              type="button"
              onClick={() => setReportUserOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Flag className="h-4 w-4 shrink-0 text-amber-600" strokeWidth={2} aria-hidden />
              Пожаловаться на пользователя
            </button>
          )}
        </div>
      </header>

      <section className="mt-10">
        <h2 className="mb-6 text-lg font-semibold text-foreground">
          Публичные маршруты ({routes.length})
        </h2>

        {loadingRoutes ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : routes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-16 text-center">
            <p className="text-muted-foreground">
              Этот пользователь еще не опубликовал ни одного маршрута
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {routes.map((route) => (
              <RouteCard
                key={route.id}
                route={route}
                isSelected={false}
                isLoading={false}
                isHovered={false}
                onClick={() => handleCardClick(route)}
              />
            ))}
          </div>
        )}
      </section>

      <ReportModal
        isOpen={reportUserOpen}
        onClose={() => setReportUserOpen(false)}
        targetType="user"
        targetId={profile.id}
      />
    </div>
  );
}
