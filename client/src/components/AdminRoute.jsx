import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';

import useAuthStore from '@/store/useAuthStore';
import { supabase } from '@/lib/supabaseClient';

/**
 * Компонент-защитник для маршрутов админ-панели.
 *
 * Проверяет два условия:
 *  1. Пользователь аутентифицирован (user !== null).
 *  2. Его роль в таблице profiles равна 'admin'.
 *
 * Если хотя бы одно условие не выполнено — редирект на главную страницу.
 * Пока идёт проверка — отображает спиннер.
 */
export default function AdminRoute({ children }) {
  const { user, isLoading: authLoading } = useAuthStore();

  // Роль текущего пользователя (null = ещё не загружена)
  const [role, setRole] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Ждём завершения инициализации Auth-стора
    if (authLoading) return;

    // Если пользователь не залогинен — сразу завершаем проверку
    if (!user) {
      setChecking(false);
      return;
    }

    // Запрашиваем роль из БД напрямую (не полагаемся на кэш стора,
    // чтобы защита работала корректно даже при первом рендере)
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error('[AdminRoute] Ошибка проверки роли:', error.message);
          setRole('user');
        } else {
          setRole(data?.role ?? 'user');
        }
        setChecking(false);
      });
  }, [user, authLoading]);

  // Пока проверяем — показываем индикатор загрузки
  if (authLoading || checking) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-border border-t-primary" />
        <p className="text-sm text-muted-foreground">Проверка доступа…</p>
      </div>
    );
  }

  // Нет пользователя — редирект на страницу входа
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Есть пользователь, но роль не 'admin' — редирект на главную
  if (role !== 'admin') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
        <ShieldOff className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold text-foreground">Доступ запрещён</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Эта страница доступна только администраторам.
        </p>
        <Navigate to="/" replace />
      </div>
    );
  }

  return children;
}
