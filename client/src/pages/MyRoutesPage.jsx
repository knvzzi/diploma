import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  MapPin, Plus, Trash2, Loader2, Navigation,
  Ruler, Calendar, Bike, Car, Footprints,
  Globe, Lock, Share2,
} from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/lib/supabaseClient';
import useAuthStore from '@/store/useAuthStore';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

/**
 * Иконки и метки для типов активности маршрута.
 * Соответствуют значениям activity_type в таблице routes.
 */
const ACTIVITY_META = {
  foot: {
    icon: Footprints,
    label: 'Пешком',
    badgeVariant: 'secondary',
  },
  bike: {
    icon: Bike,
    label: 'Велосипед',
    badgeVariant: 'outline',
  },
  car: {
    icon: Car,
    label: 'Авто',
    badgeVariant: 'outline',
  },
};

/**
 * Форматирует дату в читаемый русский формат.
 * @param {string} isoString — ISO-строка даты из Supabase
 * @returns {string} — например, «25 февраля 2026»
 */
function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Форматирует дистанцию из метров в км.
 * @param {number} meters — дистанция в метрах
 * @returns {string} — например, «12.5 км»
 */
function formatDistance(meters) {
  if (!meters) return '—';
  return `${(meters / 1000).toFixed(2)} км`;
}

/**
 * Страница «Мои маршруты».
 *
 * Отображает список всех маршрутов, принадлежащих текущему пользователю.
 * Позволяет удалять маршруты с подтверждением через AlertDialog.
 *
 * Данные загружаются из Supabase при монтировании компонента
 * и при изменении пользователя (смена аккаунта).
 *
 * RLS-политика в Supabase гарантирует, что SELECT вернёт только
 * маршруты, где author_id = auth.uid() (или публичные is_public = TRUE).
 * Мы дополнительно фильтруем по author_id на клиенте для надёжности.
 */
export default function MyRoutesPage() {
  const { user } = useAuthStore();
  const navigate  = useNavigate();

  const [routes, setRoutes]       = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [publishingId, setPublishingId] = useState(null); // id маршрута при переключении is_public

  /**
   * Загружает маршруты текущего пользователя из Supabase.
   * Сортировка по дате создания — новые сначала.
   */
  useEffect(() => {
    if (!user) {
      // Неавторизованный пользователь — перенаправляем на вход
      navigate('/login');
      return;
    }

    const fetchRoutes = async () => {
      setIsLoading(true);

      const { data, error } = await supabase
        .from('routes')
        .select(`
          id, title, description, activity_type, total_distance, is_public, created_at, author_id,
          parent_route_id, parent_id,
          profiles(id, username, full_name, avatar_url)
        `)
        .eq('author_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[MyRoutesPage] Ошибка загрузки маршрутов:', error);
        toast.error('Не удалось загрузить маршруты');
      } else {
        setRoutes(data ?? []);
      }

      setIsLoading(false);
    };

    fetchRoutes();
  }, [user, navigate]);

  /**
   * Переключает публичность маршрута (is_public).
   * Позволяет опубликовать приватный маршрут прямо из списка без перехода в редактор.
   */
  const handleTogglePublic = async (routeId, currentIsPublic) => {
    setPublishingId(routeId);
    const newValue = !currentIsPublic;
    const { error } = await supabase
      .from('routes')
      .update({ is_public: newValue })
      .eq('id', routeId)
      .eq('author_id', user.id);

    if (error) {
      console.error('[MyRoutesPage] Ошибка обновления публичности:', error);
      toast.error('Не удалось изменить статус');
    } else {
      setRoutes((prev) =>
        prev.map((r) => (r.id === routeId ? { ...r, is_public: newValue } : r))
      );
      toast.success(newValue ? 'Маршрут опубликован' : 'Маршрут сделан приватным');
    }
    setPublishingId(null);
  };

  /**
   * Удаляет маршрут по id.
   * Благодаря каскадному удалению (ON DELETE CASCADE) в схеме БД,
   * при удалении маршрута автоматически удаляются все его days → points.
   *
   * @param {string} routeId — UUID маршрута для удаления
   */
  const handleDelete = async (routeId) => {
    setDeletingId(routeId);

    const { error } = await supabase
      .from('routes')
      .delete()
      .eq('id', routeId);

    if (error) {
      console.error('[MyRoutesPage] Ошибка удаления маршрута:', error);
      toast.error('Не удалось удалить маршрут');
    } else {
      // Оптимистичное обновление: убираем маршрут из локального стейта
      setRoutes((prev) => prev.filter((r) => r.id !== routeId));
      toast.success('Маршрут удалён');
    }

    setDeletingId(null);
  };

  // ─── Экраны загрузки / пустого состояния ─────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Загрузка маршрутов...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">

      {/* ─── Заголовок страницы ─────────────────────────────────────────── */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Navigation className="h-6 w-6 text-primary" />
            Мои маршруты
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {routes.length > 0
              ? `Всего маршрутов: ${routes.length}`
              : 'У вас пока нет сохранённых маршрутов'}
          </p>
        </div>

        {/* Кнопка создания нового маршрута */}
        <Button asChild className="gap-2">
          <Link to="/create">
            <Plus className="h-4 w-4" />
            Новый маршрут
          </Link>
        </Button>
      </div>

      {/* ─── Пустое состояние ───────────────────────────────────────────── */}
      {routes.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed py-20 text-center">
          <MapPin className="h-12 w-12 text-muted-foreground/40" />
          <div>
            <p className="font-semibold text-foreground">Маршрутов пока нет</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Создайте свой первый маршрут, нажав кнопку выше
            </p>
          </div>
          <Button asChild variant="outline" className="gap-2">
            <Link to="/create">
              <Plus className="h-4 w-4" />
              Создать маршрут
            </Link>
          </Button>
        </div>
      )}

      {/* ─── Сетка карточек маршрутов ───────────────────────────────────── */}
      {routes.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {routes.map((route) => {
            // Получаем мета-данные для типа активности (иконка, метка)
            const activity = ACTIVITY_META[route.activity_type] ?? ACTIVITY_META.foot;
            const ActivityIcon = activity.icon;
            const isDeleting = deletingId === route.id;

            return (
              <Card key={route.id} className="flex flex-col transition-shadow hover:shadow-md">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="line-clamp-2 text-base leading-snug">
                      {route.title}
                    </CardTitle>
                    {/* Иконка статуса: опубликован (Globe) или приватный (Lock) */}
                    <span
                      className="shrink-0 flex items-center gap-1 text-muted-foreground"
                      title={route.is_public ? 'Опубликован — виден всем' : 'Приватный — только вы'}
                    >
                      {route.is_public ? (
                        <Globe className="h-4 w-4 text-primary" aria-label="Опубликован" />
                      ) : (
                        <Lock className="h-4 w-4" aria-label="Приватный" />
                      )}
                    </span>
                  </div>

                  {route.description && (
                    <CardDescription className="line-clamp-2 mt-1">
                      {route.description}
                    </CardDescription>
                  )}
                </CardHeader>

                <CardContent className="flex flex-col gap-2 pb-3">
                  {/* Тип активности */}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ActivityIcon className="h-4 w-4 shrink-0" />
                    <span>{activity.label}</span>
                  </div>

                  {/* Дистанция */}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Ruler className="h-4 w-4 shrink-0" />
                    <span>{formatDistance(route.total_distance)}</span>
                  </div>

                  {/* Дата создания */}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4 shrink-0" />
                    <span>{formatDate(route.created_at)}</span>
                  </div>
                </CardContent>

                <CardFooter className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-0">
                  {/* Кнопка «Опубликовать» / «Скрыть» — только для своих маршрутов */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={publishingId === route.id}
                    onClick={() => handleTogglePublic(route.id, route.is_public)}
                  >
                    {publishingId === route.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : route.is_public ? (
                      <Lock className="h-4 w-4" />
                    ) : (
                      <Share2 className="h-4 w-4" />
                    )}
                    {route.is_public ? 'Сделать приватным' : 'Опубликовать'}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={isDeleting}
                      >
                        {isDeleting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        Удалить
                      </Button>
                    </AlertDialogTrigger>

                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Удалить маршрут?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Маршрут <span className="font-semibold">«{route.title}»</span> будет
                          удалён безвозвратно вместе со всеми его точками.
                          Это действие нельзя отменить.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => handleDelete(route.id)}
                        >
                          Удалить
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}