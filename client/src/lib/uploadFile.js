import { supabase } from '@/lib/supabaseClient';

/**
 * Загружает файл изображения в Supabase Storage (бакет «route-photos»)
 * и возвращает его публичную ссылку.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  НАСТРОЙКА БАКЕТА В SUPABASE (один раз, вручную):
 *   1. Supabase Dashboard → Storage → «New bucket»
 *   2. Name: route-photos
 *   3. Public bucket: ✅ включить
 *   4. Запустить SQL из файла: supabase/migrations/03_storage_policies.sql
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Структура путей внутри бакета:
 *   covers/{timestamp}_{uid}.{ext}  — обложки маршрутов
 *   points/{timestamp}_{uid}.{ext}  — фото точек маршрута
 *
 * Алгоритм:
 *  1. Генерируем уникальное имя файла (timestamp + random hex).
 *     Это предотвращает коллизии имён даже при одновременных загрузках.
 *  2. Загружаем бинарный файл через supabase.storage.upload().
 *  3. Получаем публичный URL через getPublicUrl() — работает синхронно,
 *     без HTTP-запроса, просто строит строку из шаблона.
 *  4. Возвращаем { url, error } для удобной обработки в компонентах.
 *
 * @param {File}   file    — объект File из <input type="file">
 * @param {string} folder  — вложенная папка: 'covers' | 'points'
 * @returns {Promise<{ url: string|null, error: string|null }>}
 */
export async function uploadFile(file, folder = 'uploads') {
  try {
    // Извлекаем расширение файла (jpg, png, webp и т.д.)
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';

    // Уникальный идентификатор пути в бакете
    const uid      = Math.random().toString(36).slice(2, 9);
    const filePath = `${folder}/${Date.now()}_${uid}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('route-photos')
      .upload(filePath, file, {
        // Браузер и CDN кэшируют файл на 1 час
        cacheControl: '3600',
        // upsert: false — не перезаписываем файл с тем же именем.
        // При коллизии Supabase вернёт ошибку 409, что маловероятно
        // благодаря уникальному uid в имени файла.
        upsert:       false,
        contentType:  file.type,
      });

    if (uploadError) throw uploadError;

    // getPublicUrl() — синхронный метод, не делает запрос на сервер.
    // Строит URL из шаблона: {supabaseUrl}/storage/v1/object/public/{bucket}/{path}
    const { data } = supabase.storage
      .from('route-photos')
      .getPublicUrl(filePath);

    return { url: data.publicUrl, error: null };
  } catch (err) {
    console.error('[uploadFile] Ошибка загрузки файла:', err);
    return { url: null, error: err.message || 'Не удалось загрузить файл' };
  }
}

/**
 * Проверяет, является ли файл допустимым изображением.
 * Используется для валидации перед загрузкой.
 *
 * @param {File}   file       — файл для проверки
 * @param {number} maxSizeMB  — максимальный размер в МБ (по умолчанию 10)
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateImageFile(file, maxSizeMB = 10) {
  const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: 'Поддерживаются форматы: JPG, PNG, WebP, GIF',
    };
  }

  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > maxSizeMB) {
    return {
      valid: false,
      error: `Файл слишком большой (${sizeMB.toFixed(1)} МБ). Максимум: ${maxSizeMB} МБ`,
    };
  }

  return { valid: true, error: null };
}
