import { Component, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';

import useAuthStore from '@/store/useAuthStore';
import { supabase } from '@/lib/supabaseClient';
import Navbar from '@/components/Navbar';
import AdminRoute from '@/components/AdminRoute';
import NoAdminRoute from '@/components/NoAdminRoute';
import RouteViewRedirect from '@/components/RouteViewRedirect';
import HomePage from '@/pages/HomePage';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import UpdatePasswordPage from '@/pages/UpdatePasswordPage';
import CreateRoutePage from '@/pages/CreateRoutePage';
import ProfilePage from '@/pages/ProfilePage';
import SearchRoutesPage from '@/pages/SearchRoutesPage';
import SettingsPage from '@/pages/SettingsPage';
import PublicProfilePage from '@/pages/PublicProfilePage';
import LiveNavigationPage from '@/pages/LiveNavigationPage';
import RouteCompletedPage from '@/pages/RouteCompletedPage';
import AdminDashboardPage from '@/pages/AdminDashboardPage';
import BannedPage from '@/pages/BannedPage';

/** Перехват ошибок рендера (например на странице поиска) — вместо белого экрана показываем сообщение */
class ErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8">
          <p className="text-lg font-medium text-foreground">Что-то пошло не так на этой странице</p>
          <p className="max-w-md text-center text-sm text-muted-foreground">
            {this.state.error?.message || 'Неизвестная ошибка'}
          </p>
          <Link to="/" className="text-sm text-primary underline">Вернуться на главную</Link>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Защитный слой для заблокированных пользователей.
 * Если isBanned === true — принудительно перенаправляет на /banned,
 * полностью блокируя доступ к остальным страницам приложения.
 */
function BanGuard() {
  const { isBanned } = useAuthStore();
  if (isBanned) return <Navigate to="/banned" replace />;
  return <Outlet />;
}

/**
 * Базовый Layout приложения (App-like: фиксированная высота экрана, скролл только в контенте).
 * Корень: h-screen + overflow-hidden — приложение не скроллится целиком.
 * Хедер: shrink-0 — фиксированная высота.
 * main: flex-1 overflow-y-auto — скроллбар только под шапкой, шапка не дергается.
 */
function MainLayout() {
  const location = useLocation();
  const isSearchPage = location.pathname === '/search';
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <Navbar />
      <main
        className={`flex min-h-0 flex-1 flex-col ${isSearchPage ? 'overflow-hidden' : 'relative overflow-y-auto'}`}
      >
        <Outlet />
      </main>
    </div>
  );
}

/**
 * Внутренний компонент с маршрутами приложения.
 *
 * Вынесен отдельно от App, чтобы находиться ВНУТРИ <BrowserRouter>
 * и иметь доступ к хуку useNavigate — он необходим для обработки
 * события PASSWORD_RECOVERY от Supabase Auth.
 *
 * Структура маршрутов:
 *  /                    → HomePage (внутри MainLayout с Navbar)
 *  /login               → LoginPage (без Navbar)
 *  /register            → RegisterPage (без Navbar)
 *  /update-password     → UpdatePasswordPage (без Navbar, открывается по ссылке из письма)
 *  *                    → редирект на /
 */
function AppRoutes() {
  const { checkSession } = useAuthStore();
  const navigate = useNavigate();

  /**
   * Проверяем сессию один раз при старте приложения.
   * Supabase хранит токен в localStorage, checkSession его восстанавливает
   * и подписывается на изменения состояния аутентификации.
   */
  useEffect(() => {
    checkSession();
  }, [checkSession]);

  /**
   * Отдельная подписка на onAuthStateChange специально для обработки
   * события PASSWORD_RECOVERY — срабатывает, когда пользователь
   * переходит по ссылке восстановления пароля из email.
   *
   * Supabase автоматически извлекает токен из URL-фрагмента (#access_token=...),
   * устанавливает сессию и генерирует это событие. Мы его перехватываем
   * и направляем пользователя на форму ввода нового пароля.
   */
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        navigate('/update-password');
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  return (
    <Routes>
      {/* Страница заблокированного пользователя — доступна всегда, без BanGuard */}
      <Route path="/banned" element={<BannedPage />} />

      {/* Все остальные маршруты обёрнуты в BanGuard:
          заблокированный пользователь будет перенаправлен на /banned */}
      <Route element={<BanGuard />}>
        {/* Страницы с Navbar */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<ErrorBoundary><SearchRoutesPage /></ErrorBoundary>} />
          {/* Публичный просмотр маршрута по ссылке /routes/:id → редирект на поиск с открытием карточки */}
          <Route path="/routes/:id" element={<RouteViewRedirect />} />
          <Route path="/create" element={<NoAdminRoute><CreateRoutePage /></NoAdminRoute>} />
          {/* Конструктор с явным id маршрута (редактирование своей записи) */}
          <Route path="/constructor/:routeId" element={<NoAdminRoute><CreateRoutePage /></NoAdminRoute>} />
          <Route path="/routes" element={<Navigate to="/profile" replace />} />
          <Route path="/my-routes" element={<NoAdminRoute><Navigate to="/profile" replace /></NoAdminRoute>} />
          <Route path="/profile" element={<NoAdminRoute><ProfilePage /></NoAdminRoute>} />
          <Route path="/user/:id" element={<PublicProfilePage />} />
          <Route path="/settings" element={<NoAdminRoute><SettingsPage /></NoAdminRoute>} />
          {/* Админ-панель: доступна только пользователям с role = 'admin' */}
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminDashboardPage />
              </AdminRoute>
            }
          />
        </Route>

        {/* Страницы аутентификации — без Navbar, со своим дизайном */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        {/* Форма ввода нового пароля — открывается по событию PASSWORD_RECOVERY */}
        <Route path="/update-password" element={<UpdatePasswordPage />} />

        {/* Live-навигация: карта на весь экран, без Navbar */}
        <Route path="/route/:id/live" element={<LiveNavigationPage />} />

        {/* Маршрут пройден: праздничная страница после завершения навигации */}
        <Route path="/route/:id/completed" element={<RouteCompletedPage />} />

        {/* Любой неизвестный путь → на главную */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/**
 * Корневой компонент приложения.
 * Содержит только провайдеры (BrowserRouter, Toaster) и рендерит AppRoutes.
 */
export default function App() {
  return (
    <BrowserRouter>
      {/* Sonner — глобальный провайдер всплывающих уведомлений */}
      <Toaster
        position="top-right"
        richColors
        closeButton
        toastOptions={{
          duration: 4000,
        }}
      />
      <AppRoutes />
    </BrowserRouter>
  );
}
