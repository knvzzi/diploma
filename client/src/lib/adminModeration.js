import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';

/**
 * Выдаёт страйк пользователю по правилам модерации.
 * 0 → 1 страйк + бан 3 дня; 1 → 2 + бан 14 дней; 2+ → 3 + перм. бан.
 * @returns {Promise<boolean>}
 */
export async function issueStrikeToUser(userId, currentStrikes) {
  let updateData = {};
  let banMsg = '';

  if (currentStrikes === 0) {
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    updateData = { strikes_count: 1, ban_expires_at: expiresAt, is_perma_banned: false };
    banMsg = 'Страйк 1 выдан. Бан на 3 дня.';
  } else if (currentStrikes === 1) {
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    updateData = { strikes_count: 2, ban_expires_at: expiresAt, is_perma_banned: false };
    banMsg = 'Страйк 2 выдан. Бан на 14 дней.';
  } else {
    updateData = { strikes_count: 3, ban_expires_at: null, is_perma_banned: true };
    banMsg = 'Страйк 3 выдан. Аккаунт заблокирован навсегда.';
  }

  const { error } = await supabase
    .from('profiles')
    .update(updateData)
    .eq('id', userId);

  if (error) {
    toast.error(`Ошибка выдачи страйка: ${error.message}`);
    return false;
  }

  toast.success(banMsg);
  return true;
}
