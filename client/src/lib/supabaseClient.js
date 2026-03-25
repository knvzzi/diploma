import { createClient } from '@supabase/supabase-js';

// Переменные окружения подставляются Vite из файла .env в корне /client.
// Префикс VITE_ обязателен — только такие переменные доступны в браузере.
const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Отсутствуют переменные окружения VITE_SUPABASE_URL или VITE_SUPABASE_ANON_KEY. ' +
    'Проверьте файл client/.env'
  );
}

/**
 * Единственный экземпляр Supabase-клиента для всего фронтенда.
 * Импортируй его в любом модуле: import { supabase } from '@/lib/supabaseClient'
 */
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: true },
  // Временное отключение кеша PostgREST для отладки свежести данных профиля.
  global: { headers: { 'Cache-Control': 'no-cache' } },
});
