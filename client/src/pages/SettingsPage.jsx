import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  User, ShieldAlert, Camera, Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/lib/supabaseClient';
import { validateImageFile } from '@/lib/uploadFile';
import useAuthStore from '@/store/useAuthStore';
import useProfileStore from '@/store/useProfileStore';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// ─────────────────────────────────────────────────────────────────────────────
// Константы
// ─────────────────────────────────────────────────────────────────────────────
const AVATARS_BUCKET = 'avatars';
const MAX_AVATAR_MB  = 5;

/** Допустимые вкладки сайдбара. */
const TABS = [
  { id: 'profile', label: 'Профиль',  icon: User },
  { id: 'account', label: 'Аккаунт',  icon: ShieldAlert },
];

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательные функции
// ─────────────────────────────────────────────────────────────────────────────

/** Инициалы из displayName: «Иван Петров» → «ИП». */
function getInitials(displayName) {
  if (!displayName || typeof displayName !== 'string') return '?';
  const trimmed = displayName.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (trimmed[0] || '?').toUpperCase();
}

/**
 * Загружает файл аватара в Supabase Storage (бакет «avatars»).
 * Путь: {userId}/{timestamp}_{uid}.{ext}
 */
async function uploadAvatar(file, userId) {
  const ext      = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const uid      = Math.random().toString(36).slice(2, 9);
  const filePath = `${userId}/${Date.now()}_${uid}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert:       true,
      contentType:  file.type,
    });

  if (uploadError) return { url: null, error: uploadError.message };

  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(filePath);
  return { url: `${data.publicUrl}?t=${Date.now()}`, error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// SettingsPage — корневой компонент
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Страница настроек пользователя (/settings).
 *
 * Лейаут: узкий сайдбар слева + контентная зона справа.
 * Вкладки:
 *   - «Профиль» — аватар, никнейм, имя, фамилия, «О себе»
 *   - «Аккаунт»  — email, сброс пароля, удаление аккаунта
 *
 * Активная вкладка синхронизируется с URL-параметром ?tab=profile|account.
 */
export default function SettingsPage() {
  const { user, signOut }          = useAuthStore();
  const { setProfile: setGlobalProfile } = useProfileStore();
  const navigate                   = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = searchParams.get('tab') || 'profile';

  const setActiveTab = useCallback(
    (tab) => setSearchParams({ tab }, { replace: true }),
    [setSearchParams],
  );

  // ── Данные профиля ─────────────────────────────────────────────────────────
  const [profile,    setProfile]    = useState(null);
  const [isLoading,  setIsLoading]  = useState(true);

  // Редиректим незалогиненного пользователя
  useEffect(() => {
    if (!user) navigate('/login');
  }, [user, navigate]);

  // Загружаем профиль из БД
  useEffect(() => {
    if (!user) return;

    (async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, last_name, username, avatar_url, bio')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        console.error('[SettingsPage] Ошибка загрузки профиля:', error);
        toast.error('Не удалось загрузить данные профиля');
      } else {
        setProfile(data);
      }
      setIsLoading(false);
    })();
  }, [user]);

  if (!user) return null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 font-sans antialiased">

      {/* ── Заголовок страницы ─────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Настройки</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Управляйте настройками своего профиля и аккаунта
        </p>
      </div>

      {/* ── Основной лейаут: сайдбар + контент (flex: сайдбар фиксирован, контент занимает остаток) ── */}
      <div className="flex flex-row gap-6 lg:gap-8">

        {/* ── Сайдбар навигации (жесткая ширина, не сжимается) ───────────────── */}
        <aside className="w-64 shrink-0">
          <nav className="flex flex-col gap-1" aria-label="Настройки разделы">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={[
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left',
                  activeTab === id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                ].join(' ')}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        {/* ── Контентная зона: фиксированные min-размеры, спиннер внутри контейнера ── */}
        <div className="flex min-h-[500px] min-w-[300px] w-full max-w-2xl flex-1 flex-col md:min-w-[600px]">
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : activeTab === 'profile' ? (
            <ProfileTab
              user={user}
              profile={profile}
              setProfile={setProfile}
              setGlobalProfile={setGlobalProfile}
            />
          ) : (
            <AccountTab
              user={user}
              signOut={signOut}
              navigate={navigate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Профиль»
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Вкладка редактирования данных профиля.
 *
 * Позволяет:
 *  - Сменить аватар (загрузка в Supabase Storage)
 *  - Изменить никнейм (@username)
 *  - Изменить имя (full_name) и фамилию (last_name)
 *  - Изменить «О себе» (bio)
 */
function ProfileTab({ user, profile, setProfile, setGlobalProfile }) {
  // ── Поля формы ────────────────────────────────────────────────────────────
  const [username,  setUsername]  = useState(profile?.username  ?? '');
  const [fullName,  setFullName]  = useState(profile?.full_name ?? '');
  const [lastName,  setLastName]  = useState(profile?.last_name ?? '');
  const [bio,       setBio]       = useState(profile?.bio       ?? '');
  const [isSaving,  setIsSaving]  = useState(false);

  // ── Аватар ────────────────────────────────────────────────────────────────
  const [avatarPreview,     setAvatarPreview]     = useState(profile?.avatar_url ?? null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const avatarInputRef = useRef(null);

  // Когда профиль загрузился (или обновился снаружи) — синхронизируем поля
  useEffect(() => {
    if (!profile) return;
    setUsername(profile.username  ?? '');
    setFullName(profile.full_name ?? '');
    setLastName(profile.last_name ?? '');
    setBio(profile.bio            ?? '');
    setAvatarPreview(profile.avatar_url ?? null);
  }, [profile]);

  // Отображаемое имя для инициалов-заглушки
  const displayName = fullName || user?.user_metadata?.name || user?.email?.split('@')[0] || 'П';

  // ── Загрузка аватара ──────────────────────────────────────────────────────
  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    e.target.value = '';

    const { valid, error: validError } = validateImageFile(file, MAX_AVATAR_MB);
    if (!valid) { toast.error(validError); return; }

    // Оптимистичное превью
    const previewUrl = URL.createObjectURL(file);
    setAvatarPreview(previewUrl);
    setIsUploadingAvatar(true);

    const { url, error: uploadError } = await uploadAvatar(file, user.id);

    if (uploadError) {
      toast.error(`Не удалось загрузить аватар: ${uploadError}`);
      setAvatarPreview(profile?.avatar_url ?? null);
      setIsUploadingAvatar(false);
      URL.revokeObjectURL(previewUrl);
      return;
    }

    // Сохраняем новый avatar_url в БД
    const { error: dbError } = await supabase
      .from('profiles')
      .upsert(
        { id: user.id, avatar_url: url, updated_at: new Date().toISOString() },
        { onConflict: 'id' },
      );

    URL.revokeObjectURL(previewUrl);

    if (dbError) {
      console.error('[SettingsPage] Ошибка сохранения avatar_url:', dbError);
      toast.error('Аватар загружен, но не сохранён в профиле');
    } else {
      setAvatarPreview(url);
      setProfile((prev) => ({ ...prev, avatar_url: url }));
      setGlobalProfile(url, profile?.full_name ?? null);
      toast.success('Аватар обновлён');
    }

    setIsUploadingAvatar(false);
  };

  // ── Сохранение полей профиля ──────────────────────────────────────────────
  const handleSave = async () => {
    if (!user) return;

    // Валидация никнейма: только латиница, цифры, _ и ., без пробелов
    const trimmedUsername = username.trim().toLowerCase();
    if (trimmedUsername && !/^[a-z0-9_.]{3,30}$/.test(trimmedUsername)) {
      toast.error('Никнейм: от 3 до 30 символов, только латиница, цифры, точка и _');
      return;
    }

    // Явная проверка занятости логина до сохранения профиля.
    // Это даёт понятную ошибку сразу, не дожидаясь ошибки UNIQUE от БД.
    if (trimmedUsername && trimmedUsername !== (profile?.username ?? '').trim().toLowerCase()) {
      const { data: existingUser, error: checkError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', trimmedUsername)
        .maybeSingle();

      if (checkError) {
        console.error('[SettingsPage] Ошибка проверки username:', checkError);
        toast.error('Не удалось проверить логин. Попробуйте ещё раз.');
        return;
      }

      if (existingUser && existingUser.id !== user.id) {
        toast.error('Этот логин уже занят. Пожалуйста, выберите другой.');
        return;
      }
    }

    setIsSaving(true);

    const { data, error } = await supabase
      .from('profiles')
      .upsert(
        {
          id:         user.id,
          username:   trimmedUsername || null,
          full_name:  fullName.trim() || null,
          last_name:  lastName.trim() || null,
          bio:        bio.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      )
      .select()
      .single();

    setIsSaving(false);

    if (error) {
      // Код 23505 — нарушение уникальности (username уже занят)
      if (error.code === '23505') {
        toast.error('Этот никнейм уже занят. Попробуйте другой.');
      } else {
        console.error('[SettingsPage] Ошибка сохранения профиля:', error);
        toast.error('Не удалось сохранить профиль');
      }
      return;
    }

    setProfile((prev) => ({ ...prev, ...data }));
    setGlobalProfile(data.avatar_url ?? null, data.full_name ?? null);
    toast.success('Профиль сохранён');
  };

  return (
    <div className="w-full space-y-8">
      <div>
        <h2 className="text-lg font-medium text-foreground">Профиль</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Ваша публичная информация и аватар
        </p>
      </div>

      {/* ── Аватарка ────────────────────────────────────────────────────── */}
      <div className="flex w-full items-center gap-5">
        <div className="relative">
          <div className="h-20 w-20 overflow-hidden rounded-full border-2 border-border/60 bg-muted shadow-sm">
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt="Аватар"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-2xl font-medium text-muted-foreground select-none">
                {getInitials(displayName)}
              </span>
            )}
          </div>

          {/* Кнопка-карандаш поверх аватарки */}
          <button
            type="button"
            aria-label="Изменить аватар"
            disabled={isUploadingAvatar}
            onClick={() => avatarInputRef.current?.click()}
            className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-primary shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isUploadingAvatar ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-foreground" />
            ) : (
              <Camera className="h-3.5 w-3.5 text-primary-foreground" />
            )}
          </button>
        </div>

        <input
          ref={avatarInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleAvatarChange}
        />

        <div className="text-sm text-muted-foreground">
          <p>Нажмите на иконку камеры, чтобы загрузить фото.</p>
          <p className="mt-0.5">Максимальный размер — {MAX_AVATAR_MB}&nbsp;МБ.</p>
        </div>
      </div>

      {/* ── Поля формы ──────────────────────────────────────────────────── */}
      <div className="grid w-full gap-5 sm:grid-cols-2">

        {/* Никнейм */}
        <div className="sm:col-span-2 w-full">
          <Label htmlFor="username" className="mb-1.5 block text-sm font-medium">
            Имя пользователя
          </Label>
          <div className="relative w-full">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground select-none">
              @
            </span>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
              placeholder="ivan_petrov"
              maxLength={30}
              className="w-full pl-7"
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Только латиница, цифры, точка и символ _. От 3 до 30 символов.
          </p>
        </div>

        {/* Имя */}
        <div className="w-full">
          <Label htmlFor="full_name" className="mb-1.5 block text-sm font-medium">Имя</Label>
          <Input
            id="full_name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Иван"
            maxLength={100}
            className="w-full"
          />
        </div>

        {/* Фамилия */}
        <div className="w-full">
          <Label htmlFor="last_name" className="mb-1.5 block text-sm font-medium">Фамилия</Label>
          <Input
            id="last_name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Петров"
            maxLength={100}
            className="w-full"
          />
        </div>

        {/* О себе */}
        <div className="sm:col-span-2 w-full">
          <Label htmlFor="bio" className="mb-1.5 block text-sm font-medium">О себе</Label>
          <Textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Расскажите кратко о себе, своих увлечениях и любимых маршрутах..."
            rows={4}
            maxLength={500}
            className="w-full resize-none"
          />
          <p className="mt-1 text-right text-xs text-muted-foreground">
            {bio.length}/500
          </p>
        </div>
      </div>

      {/* ── Кнопка сохранить ────────────────────────────────────────────── */}
      <div className="flex justify-end border-t border-border/50 pt-5">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="gap-2 min-w-[120px]"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Сохранить
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Аккаунт»
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Вкладка управления аккаунтом.
 *
 * Содержит:
 *  - Отображение текущего email
 *  - Кнопку сброса пароля (отправляет письмо через supabase.auth.resetPasswordForEmail)
 *  - Кнопку удаления аккаунта с модальным подтверждением
 */
function AccountTab({ user, signOut, navigate }) {
  const [isSendingReset,  setIsSendingReset]  = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // ── Сброс пароля ──────────────────────────────────────────────────────────
  const handleResetPassword = async () => {
    if (!user?.email) return;
    setIsSendingReset(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        // После сброса Supabase перенаправит сюда с токеном
        redirectTo: `${window.location.origin}/settings?tab=account`,
      });
      if (error) throw error;
      toast.success('Письмо со ссылкой для сброса отправлено на почту');
    } catch (err) {
      console.error('[SettingsPage] Ошибка сброса пароля:', err);
      toast.error('Не удалось отправить письмо. Попробуйте позже.');
    } finally {
      setIsSendingReset(false);
    }
  };

  // ── Удаление аккаунта ─────────────────────────────────────────────────────
  /**
   * Вызывает Supabase RPC-функцию delete_own_account (если настроена),
   * иначе — выводит сообщение об обращении в поддержку.
   *
   * Для полноценного удаления нужно создать Edge Function или SQL-функцию
   * с SECURITY DEFINER, поскольку обычный пользователь не может удалить
   * себя из auth.users без Service Role Key.
   */
  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true);
    try {
      const { error } = await supabase.rpc('delete_own_account');
      if (error) throw error;
      await signOut();
      toast.success('Аккаунт удалён. Жаль с вами расставаться!');
      navigate('/');
    } catch (err) {
      console.error('[SettingsPage] Ошибка удаления аккаунта:', err);
      // Если RPC не настроен — показываем fallback-сообщение
      toast.error(
        'Для удаления аккаунта обратитесь в поддержку. Функция пока в разработке.',
        { duration: 6000 },
      );
    } finally {
      setIsDeletingAccount(false);
      setShowDeleteModal(false);
    }
  };

  return (
    <div className="w-full space-y-8">
      <div>
        <h2 className="text-lg font-medium text-foreground">Аккаунт</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Управляйте настройками входа и безопасности
        </p>
      </div>

      {/* ── Email ─────────────────────────────────────────────────────────── */}
      <section className="w-full rounded-xl border border-border/60 bg-card p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-medium text-foreground">Электронная почта</h3>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm text-foreground truncate select-all">
            {user.email}
          </div>
          <span className="shrink-0 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-600 dark:text-green-400">
            Подтверждён
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Изменение email временно недоступно.
        </p>
      </section>

      {/* ── Сброс пароля ─────────────────────────────────────────────────── */}
      <section className="w-full rounded-xl border border-border/60 bg-card p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-medium text-foreground">Пароль</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Мы отправим письмо со ссылкой для сброса пароля на ваш адрес&nbsp;
          <span className="font-medium text-foreground">{user.email}</span>.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={isSendingReset}
          onClick={handleResetPassword}
          className="gap-2"
        >
          {isSendingReset && <Loader2 className="h-4 w-4 animate-spin" />}
          Изменить пароль
        </Button>
      </section>

      {/* ── Удаление аккаунта ─────────────────────────────────────────────── */}
      <section className="w-full rounded-xl border border-destructive/30 bg-destructive/5 p-5">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-medium text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Опасная зона
        </h3>
        <p className="mb-4 text-sm text-muted-foreground">
          После удаления аккаунта все ваши маршруты, комментарии и данные будут безвозвратно удалены.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDeleteModal(true)}
          className="gap-2 border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
        >
          Удалить мой аккаунт
        </Button>
      </section>

      {/* ── Модалка подтверждения удаления ───────────────────────────────── */}
      {showDeleteModal && (
        <DeleteAccountModal
          email={user.email}
          isDeleting={isDeletingAccount}
          onConfirm={handleDeleteAccount}
          onCancel={() => setShowDeleteModal(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Модальное окно подтверждения удаления аккаунта
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Модальное окно с подтверждением удаления аккаунта.
 * Пользователь должен ввести своё email, чтобы подтвердить намерение.
 *
 * @param {string}   email      — email пользователя
 * @param {boolean}  isDeleting — флаг загрузки во время удаления
 * @param {Function} onConfirm  — колбэк при подтверждении
 * @param {Function} onCancel   — колбэк при отмене
 */
function DeleteAccountModal({ email, isDeleting, onConfirm, onCancel }) {
  const [confirmInput, setConfirmInput] = useState('');

  const isConfirmed = confirmInput.trim() === email;

  // Закрытие по Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    /* Оверлей */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-modal-title"
        className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl"
      >
        {/* Иконка-предупреждение */}
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>

        <h2 id="delete-modal-title" className="mb-2 text-lg font-semibold text-foreground">
          Удалить аккаунт?
        </h2>
        <p className="mb-4 text-sm text-muted-foreground leading-relaxed">
          Это действие <span className="font-medium text-foreground">необратимо</span>. Все ваши маршруты, комментарии, оценки и данные профиля будут удалены навсегда.
        </p>

        {/* Подтверждение через ввод email */}
        <div className="mb-5 space-y-1.5">
          <Label htmlFor="confirm-email" className="text-sm">
            Для подтверждения введите ваш email:{' '}
            <span className="font-medium text-foreground">{email}</span>
          </Label>
          <Input
            id="confirm-email"
            type="email"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={email}
            autoFocus
          />
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Отмена
          </Button>
          <Button
            variant="destructive"
            className="flex-1 gap-2"
            disabled={!isConfirmed || isDeleting}
            onClick={onConfirm}
          >
            {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
            Удалить навсегда
          </Button>
        </div>
      </div>
    </div>
  );
}
