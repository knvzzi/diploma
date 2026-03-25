import useProfileStore from '@/store/useProfileStore';

/**
 * Режим «только просмотр» для администратора: без лайков, закладок, комментариев,
 * форков, скачивания GPX, жалоб с пользовательской стороны и т.д.
 * Роль берётся из profiles.role (подгружается в Navbar через loadProfile).
 */
export function useAdminReadOnly() {
  const role = useProfileStore((s) => s.role);
  return role === 'admin';
}
