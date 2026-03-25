/**
 * Supabase-клиент для сервера.
 * Используется для запросов к БД (публичные маршруты, fork).
 *
 * Для запросов от имени пользователя (fork) создаём клиент с JWT из заголовка Authorization.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[supabase] SUPABASE_URL или SUPABASE_ANON_KEY не заданы. Эндпоинты /api/routes/* могут не работать.'
  );
}

/**
 * Клиент без авторизации (anon). RLS применяется — видны только публичные маршруты при выборке.
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function getSupabaseAnon() {
  return createClient(supabaseUrl ?? '', supabaseAnonKey ?? '');
}

/**
 * Клиент с JWT пользователя. RLS видит auth.uid() = пользователь из токена.
 * Нужен для fork: создание маршрута от имени текущего пользователя и чтение исходного (если публичный или автор).
 *
 * @param {string} accessToken — JWT из Supabase Auth (Bearer-токен)
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function getSupabaseWithAuth(accessToken) {
  if (!accessToken) return getSupabaseAnon();
  return createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
