import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapPin, LogOut, LogIn, UserPlus, User, Plus, Map, Search, Settings, Shield } from 'lucide-react';

import useAuthStore from '@/store/useAuthStore';
import useProfileStore from '@/store/useProfileStore';
import { Button } from '@/components/ui/button';

function getInitials(displayName) {
  if (!displayName || typeof displayName !== 'string') return '?';
  const trimmed = displayName.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (trimmed[0] || '?').toUpperCase();
}

/**
 * Навигация приложения.
 * Администратор (role === 'admin') видит только поиск, ссылку на панель модерации и выход —
 * без создания маршрутов, профиля и настроек (см. NoAdminRoute в App.jsx).
 */
export default function Navbar() {
  const { user, signOut, isLoading } = useAuthStore();
  const { profileUserId, avatarUrl, fullName, role, loadProfile, clearProfile } = useProfileStore();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const isAdmin = Boolean(user && role === 'admin');

  useEffect(() => {
    if (!user?.id) {
      clearProfile();
      return;
    }
    if (profileUserId !== user.id) {
      loadProfile(user.id);
    }
  }, [user?.id, profileUserId, loadProfile, clearProfile]);

  const displayName =
    fullName || user?.user_metadata?.name || user?.email?.split('@')[0] || 'П';
  const initials = getInitials(displayName);

  const handleSignOut = async () => {
    setDropdownOpen(false);
    clearProfile();
    await signOut();
    navigate('/');
  };

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [dropdownOpen]);

  return (
    <header className="shrink-0 z-50 w-full border-b border-border/40 bg-background shadow-sm">
      <nav className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          to="/"
          className="flex items-center gap-2 font-semibold text-foreground transition-opacity hover:opacity-90"
        >
          <MapPin className="h-5 w-5 text-primary" />
          <span className="text-lg tracking-tight">Маршруты</span>
        </Link>

        <div className="hidden items-center gap-1 sm:flex">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/search" className="flex items-center gap-1.5">
              <Search className="h-4 w-4" />
              Поиск
            </Link>
          </Button>

          {isAdmin ? (
            <Button variant="ghost" size="sm" asChild>
              <Link
                to="/admin"
                className="flex items-center gap-1.5 text-neutral-900 hover:text-neutral-700"
              >
                <Shield className="h-4 w-4" />
                Панель управления
              </Link>
            </Button>
          ) : (
            <>
              {user && (
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/profile" className="flex items-center gap-1.5">
                    <Map className="h-4 w-4" />
                    Мои маршруты
                  </Link>
                </Button>
              )}
              <Button variant="ghost" size="sm" asChild>
                <Link to="/create" className="flex items-center gap-1.5">
                  <Plus className="h-4 w-4" />
                  Создать маршрут
                </Link>
              </Button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isLoading ? (
            <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
          ) : user ? (
            isAdmin ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSignOut}
                  className="gap-2"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">Выйти</span>
                </Button>
              </>
            ) : (
              <>
                <div className="relative" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setDropdownOpen((o) => !o)}
                    aria-expanded={dropdownOpen}
                    aria-haspopup="true"
                    aria-label="Меню пользователя"
                    className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-border/60 bg-muted shadow-sm transition-all hover:border-primary/30 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-sm font-medium text-muted-foreground">
                        {initials}
                      </span>
                    )}
                  </button>

                  {dropdownOpen && (
                    <div
                      className="absolute right-0 top-full z-[100] mt-2 min-w-[160px] rounded-xl border border-border/60 bg-background py-1 shadow-lg"
                      role="menu"
                    >
                      <Link
                        to="/profile"
                        onClick={() => setDropdownOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                        role="menuitem"
                      >
                        <User className="h-4 w-4 text-muted-foreground" />
                        Профиль
                      </Link>
                      <Link
                        to="/settings"
                        onClick={() => setDropdownOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                        role="menuitem"
                      >
                        <Settings className="h-4 w-4 text-muted-foreground" />
                        Настройки
                      </Link>
                    </div>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSignOut}
                  className="gap-2"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">Выйти</span>
                </Button>
              </>
            )
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/login" className="gap-2 flex items-center">
                  <LogIn className="h-4 w-4" />
                  Войти
                </Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/register" className="gap-2 flex items-center">
                  <UserPlus className="h-4 w-4" />
                  Регистрация
                </Link>
              </Button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
