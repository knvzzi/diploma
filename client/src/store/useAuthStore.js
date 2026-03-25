import { create } from 'zustand';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';

/**
 * Проверяет, заблокирован ли пользователь по данным его профиля.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function checkBanStatus(userId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_perma_banned, ban_expires_at')
    .eq('id', userId)
    .maybeSingle();

  return (
    profile?.is_perma_banned === true ||
    (!!profile?.ban_expires_at && new Date(profile.ban_expires_at) > new Date())
  );
}

/**
 * Zustand-стор для управления аутентификацией пользователя.
 *
 * Хранит:
 *  - user        — объект текущего пользователя (из Supabase Auth) или null
 *  - isLoading   — флаг загрузки (true во время асинхронных операций)
 *  - error       — последнее сообщение об ошибке или null
 *
 * Методы:
 *  - checkSession() — проверяет существующую сессию при старте приложения
 *  - signUp()       — регистрация нового пользователя
 *  - signIn()       — вход существующего пользователя
 *  - signOut()      — выход из системы
 */
const useAuthStore = create((set) => ({
  user: null,
  isLoading: true,  // true по умолчанию — ждём проверки сессии
  error: null,
  /**
   * Флаг активного бана. Если true — роутер перенаправляет пользователя на /banned.
   * Устанавливается при checkSession и signIn, если профиль заблокирован.
   */
  isBanned: false,

  /**
   * Проверяет активную сессию Supabase при первой загрузке приложения.
   * Также подписывается на изменения состояния аутентификации (onAuthStateChange),
   * чтобы стор реагировал на события: вход, выход, обновление токена.
   *
   * Дополнительно: если у пользователя активен бан — устанавливаем isBanned=true,
   * чтобы BanGuard в роутере принудительно перенаправил на /banned.
   */
  checkSession: async () => {
    set({ isLoading: true });

    const { data: { session } } = await supabase.auth.getSession();

    if (session?.user) {
      // Проверяем, не заблокирован ли пользователь
      const banned = await checkBanStatus(session.user.id);
      if (banned) {
        // Сохраняем пользователя, но помечаем как заблокированного —
        // BanGuard перенаправит на /banned, не выбрасывая из системы.
        set({ user: session.user, isBanned: true, isLoading: false });
        supabase.auth.onAuthStateChange((_event, s) => set({ user: s?.user ?? null }));
        return;
      }
    }

    set({ user: session?.user ?? null, isBanned: false, isLoading: false });

    // Подписка на изменения состояния аутентификации
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ user: session?.user ?? null });
    });
  },

  /**
   * Регистрирует нового пользователя в Supabase Auth.
   * @param {string} email     — адрес электронной почты
   * @param {string} password  — пароль (минимум 6 символов)
   * @param {string} name      — отображаемое имя пользователя
   * @returns {{ error: string|null }} — объект с ошибкой или null при успехе
   */
  signUp: async (email, password, name) => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },   // Сохраняем имя в user_metadata
        },
      });

      if (error) throw error;

      // Supabase при регистрации уже существующего email не возвращает ошибку,
      // но отдаёт user с пустым массивом identities — используем это как признак дубля.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        const msg = 'Пользователь с таким email уже зарегистрирован.';
        set({ error: msg, isLoading: false });
        return { error: msg };
      }

      set({ user: data.user, isLoading: false });
      return { error: null };
    } catch (err) {
      const message = translateAuthError(err.message);
      set({ error: message, isLoading: false });
      return { error: message };
    }
  },

  /**
   * Выполняет вход пользователя по email и паролю.
   * @param {string} email    — адрес электронной почты
   * @param {string} password — пароль
   * @returns {{ error: string|null }} — объект с ошибкой или null при успехе
   */
  signIn: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      // Проверяем бан сразу после успешного входа
      const banned = await checkBanStatus(data.user.id);
      if (banned) {
        // Помечаем как заблокированного — BanGuard перенаправит на /banned
        set({ user: data.user, isBanned: true, isLoading: false, error: null });
        return { error: null };
      }

      set({ user: data.user, isLoading: false });
      return { error: null };
    } catch (err) {
      const message = translateAuthError(err.message);
      set({ error: message, isLoading: false });
      return { error: message };
    }
  },

  /**
   * Выполняет выход текущего пользователя из системы.
   * Сбрасывает флаг isBanned, чтобы BanGuard не удерживал на /banned после логаута.
   */
  signOut: async () => {
    set({ isLoading: true });
    await supabase.auth.signOut();
    set({ user: null, isBanned: false, isLoading: false, error: null });
  },
}));

/**
 * Переводит типичные сообщения об ошибках Supabase Auth на русский язык.
 * Supabase возвращает ошибки на английском — переводим для удобства пользователя.
 * @param {string} message — оригинальное сообщение об ошибке
 * @returns {string} — переведённое сообщение
 */
function translateAuthError(message) {
  const errorMap = {
    'Invalid login credentials':
      'Неверный email или пароль. Проверьте введённые данные.',
    'Email not confirmed':
      'Email не подтверждён. Проверьте вашу почту и перейдите по ссылке.',
    'User already registered':
      'Пользователь с таким email уже зарегистрирован.',
    'Password should be at least 6 characters':
      'Пароль должен содержать минимум 6 символов.',
    'Signup requires a valid password':
      'Введите корректный пароль.',
    'Unable to validate email address: invalid format':
      'Некорректный формат email адреса.',
    'Email rate limit exceeded':
      'Слишком много попыток. Повторите через несколько минут.',
    'over_email_send_rate_limit':
      'Слишком много запросов. Пожалуйста, подождите и попробуйте снова.',
  };

  // Ищем совпадение в словаре, иначе возвращаем оригинал
  for (const [key, translation] of Object.entries(errorMap)) {
    if (message.includes(key)) return translation;
  }

  return message || 'Произошла непредвиденная ошибка. Попробуйте снова.';
}

export default useAuthStore;
