import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { supabase } from '@/lib/supabaseClient';

/**
 * Обёртка для пользовательских разделов (создание маршрута, профиль, настройки).
 * Если текущий пользователь — администратор, перенаправляет на /admin
 * (админ работает только из панели модерации).
 */
export default function NoAdminRoute({ children }) {
  const [role, setRole] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        if (!cancelled) {
          setRole(null);
          setChecking(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error('[NoAdminRoute]', error.message);
        setRole('user');
      } else {
        setRole(data?.role ?? 'user');
      }
      setChecking(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (checking) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
      </div>
    );
  }

  if (role === 'admin') {
    return <Navigate to="/admin" replace />;
  }

  return children;
}
