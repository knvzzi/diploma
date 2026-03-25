import { create } from 'zustand';
import { supabase } from '@/lib/supabaseClient';

/**
 * Глобальный стор данных профиля текущего пользователя (аватар, имя, никнейм).
 * Используется Navbar для отображения аватарки и ProfilePage/SettingsPage
 * для синхронизации: при обновлении данных на любой из страниц вызывается
 * setProfile(), и шапка обновляется без перезагрузки.
 */
const useProfileStore = create((set, get) => ({
  profileUserId: null,
  avatarUrl:     null,
  fullName:      null,
  lastName:      null,
  username:      null,
  /** Роль пользователя ('user' | 'admin' | 'moderator'). Нужна для показа ссылки на AdminPanel. */
  role:          null,

  /** Устанавливает аватар и имя (вызывается из ProfilePage/SettingsPage после сохранения). */
  setProfile: (avatarUrl, fullName) => {
    set({ avatarUrl: avatarUrl ?? null, fullName: fullName ?? null });
  },

  /** Загружает профиль из БД по id пользователя. */
  loadProfile: async (userId) => {
    if (!userId) {
      set({ profileUserId: null, avatarUrl: null, fullName: null, lastName: null, username: null, role: null });
      return;
    }
    const { data } = await supabase
      .from('profiles')
      .select('avatar_url, full_name, last_name, username, role')
      .eq('id', userId)
      .maybeSingle();

    set({
      profileUserId: userId,
      avatarUrl:     data?.avatar_url ?? null,
      fullName:      data?.full_name  ?? null,
      lastName:      data?.last_name  ?? null,
      username:      data?.username   ?? null,
      role:          data?.role       ?? 'user',
    });
  },

  /** Сброс при выходе из аккаунта. */
  clearProfile: () => {
    set({ profileUserId: null, avatarUrl: null, fullName: null, lastName: null, username: null, role: null });
  },
}));

export default useProfileStore;
