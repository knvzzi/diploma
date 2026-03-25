import { useEffect, useState } from 'react';
import { ShieldOff, Mail, LogOut, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '@/store/useAuthStore';
import { supabase } from '@/lib/supabaseClient';

/**
 * Форматирует дату окончания бана в читаемую строку.
 * @param {string} iso — ISO-строка даты
 */
function formatBanDate(iso) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Страница для заблокированных пользователей.
 * Показывается вместо всего приложения при is_perma_banned или активном ban_expires_at.
 * Загружает детали блокировки из profiles, чтобы показать срок или «навсегда».
 */
export default function BannedPage() {
  const { user, signOut } = useAuthStore();
  const navigate = useNavigate();

  const [banInfo, setBanInfo] = useState(null); // { isPerma: bool, until: string|null }

  // Загружаем детали блокировки из профиля
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('is_perma_banned, ban_expires_at')
        .eq('id', user.id)
        .maybeSingle();
      if (data) {
        setBanInfo({
          isPerma: data.is_perma_banned === true,
          until: data.ban_expires_at ?? null,
        });
      }
    })();
  }, [user?.id]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  // Формируем строку с информацией о сроке блокировки
  const banUntilFuture =
    banInfo?.until && new Date(banInfo.until) > new Date();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4 py-16">
      <div className="max-w-md text-center">
        {/* Иконка */}
        <div className="mb-6 flex justify-center">
          <div className="rounded-full bg-red-50 p-5">
            <ShieldOff className="h-14 w-14 text-red-500" />
          </div>
        </div>

        {/* Заголовок */}
        <h1 className="mb-3 text-3xl font-bold tracking-tight text-gray-900">
          Ваш аккаунт заблокирован
        </h1>

        {/* Описание: адаптируется под тип бана */}
        {banInfo ? (
          banInfo.isPerma ? (
            <p className="mb-4 text-base leading-relaxed text-gray-500">
              Доступ к платформе приостановлен <span className="font-semibold text-gray-700">навсегда</span> за нарушение правил сообщества.
            </p>
          ) : banUntilFuture ? (
            <p className="mb-4 text-base leading-relaxed text-gray-500">
              Доступ к платформе приостановлен за нарушение правил сообщества.
            </p>
          ) : (
            <p className="mb-4 text-base leading-relaxed text-gray-500">
              Доступ к платформе приостановлен за нарушение правил сообщества.
            </p>
          )
        ) : (
          <p className="mb-4 text-base leading-relaxed text-gray-500">
            Доступ к платформе приостановлен за нарушение правил сообщества.
          </p>
        )}

        {/* Плашка со сроком блокировки */}
        {banInfo && (
          <div className="mb-8 inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
            <Clock className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="text-sm font-medium text-amber-800">
              {banInfo.isPerma
                ? 'Блокировка: навсегда'
                : banUntilFuture
                  ? `Аккаунт приостановлен до: ${formatBanDate(banInfo.until)}`
                  : 'Срок блокировки уточняется'}
            </span>
          </div>
        )}

        {/* Кнопки */}
        <div className="flex flex-col items-center gap-3">
          {/* Апелляция */}
          <a
            href="mailto:tatyana.kazantseva.04.04@gmail.com?subject=Апелляция%20блокировки%20аккаунта"
            className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-lg bg-black px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            <Mail className="h-4 w-4" />
            Написать в поддержку
          </a>

          {/* Выход из аккаунта */}
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
          >
            <LogOut className="h-4 w-4" />
            Выйти из аккаунта
          </button>
        </div>

        <p className="mt-6 text-xs text-gray-400">
          tatyana.kazantseva.04.04@gmail.com
        </p>
      </div>
    </div>
  );
}
