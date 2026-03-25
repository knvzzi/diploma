import { useState, useRef, useEffect } from 'react';
import {
  Minus, MapPin, ChevronDown, Route,
  PersonStanding, Bike, Car, Mountain, Check,
} from 'lucide-react';

import useRouteStore, { ROUTING_PROFILES } from '@/store/useRouteStore';

/**
 * Группы профилей — порядок и заголовки разделов дропдауна.
 * id совпадает с полем `group` в ROUTING_PROFILES.
 */
const PROFILE_GROUPS = [
  { id: 'foot',    label: 'Пешком и бегом' },
  { id: 'cycling', label: 'На велосипеде'  },
  { id: 'other',   label: 'Другое'         },
];

/**
 * Иконки (Lucide) для каждого профиля.
 * Используются внутри дропдауна вместо эмодзи — выглядят как «чёрные» иконки.
 */
const PROFILE_ICONS = {
  'foot-hiking':      Mountain,
  'foot-walking':     PersonStanding,
  'cycling-regular':  Bike,
  'cycling-road':     Bike,
  'cycling-gravel':   Bike,
  'cycling-mountain': Mountain,
  'driving-car':      Car,
  'direct-straight':  Minus,
};

/**
 * Плавающая панель инструментов над картой.
 *
 * Позиционируется абсолютно относительно обёртки RouteMap.
 * Используется z-index 500 — выше карты (z-index 0-400), но ниже
 * попапов Leaflet (z-index 700+), чтобы попапы маркеров перекрывали тулбар.
 *
 * ── Кнопки ──────────────────────────────────────────────────────────────────
 *
 * 1. «По дорогам» (Автопостроение) — режим 'auto'.
 *    Клик по основной части: активировать режим.
 *    Клик по шеврону ▾ (или по кнопке когда уже активна): открыть дропдаун
 *    с выбором профиля ORS (пешком / туризм / велосипед / МТБ / авто).
 *
 * 2. «Прямые» — режим 'direct'.
 *    Строит прямые линии между точками без вызова API.
 *    Время и дистанция пересчитываются мгновенно через Haversine.
 *
 * 3. «Метки» — режим 'label'.
 *    Клик по карте создаёт смысловую метку (с названием, фото и т.д.)
 *    вместо технической точки маршрута.
 *
 * Активная кнопка подсвечивается янтарным фоном (amber-400).
 */
export default function MapToolbar() {
  const { routingMode, routingProfile, setRoutingMode, setRoutingProfile } =
    useRouteStore();

  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const menuRef = useRef(null);

  const activeProfile = ROUTING_PROFILES.find((p) => p.value === routingProfile);

  /**
   * Кнопка «По дорогам» подсвечивается когда:
   *  — режим 'auto' (ORS), ИЛИ
   *  — выбран профиль с alwaysDirect (По реке / Напрямик) — они «владеют» кнопкой 1.
   */
  const isAutoButtonActive = routingMode === 'auto' || !!activeProfile?.alwaysDirect;

  /**
   * Кнопка «Прямые» подсвечивается только когда routingMode === 'direct'
   * и при этом НЕ активен один из alwaysDirect-профилей
   * (чтобы «По реке» и «Напрямик» не дублировали подсветку).
   */
  const isDirectButtonActive = routingMode === 'direct' && !activeProfile?.alwaysDirect;

  // Закрываем дропдаун при клике вне него
  useEffect(() => {
    if (!showProfileMenu) return;
    const handleOutsideClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showProfileMenu]);

  /**
   * Обрабатывает клик по кнопке «По дорогам»:
   *  — Если уже в режиме 'auto': переключаем видимость дропдауна профилей.
   *  — Если в другом режиме: переключаемся в 'auto', дропдаун закрываем.
   */
  const handleAutoClick = () => {
    if (routingMode === 'auto') {
      setShowProfileMenu((v) => !v);
    } else {
      setRoutingMode('auto');
      setShowProfileMenu(false);
    }
  };

  const handleChevronClick = (e) => {
    e.stopPropagation();
    setRoutingMode('auto');
    setShowProfileMenu((v) => !v);
  };

  const handleProfileSelect = (value) => {
    setRoutingProfile(value);
    setShowProfileMenu(false);
  };

  const handleDirectClick = () => {
    setRoutingMode('direct');
    setShowProfileMenu(false);
  };

  const handleLabelClick = () => {
    setRoutingMode('label');
    setShowProfileMenu(false);
  };

  return (
    /*
     * Абсолютное позиционирование: по центру сверху карты.
     * pointer-events: none на обёртке — чтобы «пустое» место тулбара
     * не перехватывало клики по карте.
     * pointer-events: auto восстановлен на самой панели.
     */
    <div className="pointer-events-none absolute inset-x-0 top-4 z-[500] flex justify-center">
      <div
        className="pointer-events-auto relative flex items-center gap-1 overflow-visible rounded-full bg-white p-1 shadow-md dark:bg-white/95"
        ref={menuRef}
      >
        {/* ── Кнопка 1: Тип передвижения — одна капсула (иконка + шеврон, без текста) ── */}
        <div
          className={`group relative flex items-center rounded-full transition-colors ${
            isAutoButtonActive ? 'bg-amber-400' : ''
          }`}
        >
          <button
            type="button"
            onClick={handleAutoClick}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
              isAutoButtonActive
                ? 'text-black hover:bg-amber-500/80'
                : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-200/80'
            }`}
          >
            <Route className="h-4 w-4 shrink-0" />
          </button>
          <button
            type="button"
            onClick={handleChevronClick}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
              isAutoButtonActive
                ? 'text-black hover:bg-amber-500/80'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-200/80'
            }`}
          >
            <ChevronDown
              className={`h-4 w-4 shrink-0 transition-transform duration-200 ${showProfileMenu ? 'rotate-180' : ''}`}
            />
          </button>
          <div className="absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#2d2d2d] px-3 py-2 text-sm text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 pointer-events-none">
            Тип передвижения
          </div>
        </div>

        {/* ── Кнопка 2: Прямые линии (только иконка) ── */}
        <button
          type="button"
          onClick={handleDirectClick}
          className={`group relative flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
            isDirectButtonActive
              ? 'bg-amber-400 text-black'
              : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-200/80'
          }`}
        >
          <Minus className="h-4 w-4 shrink-0" />
          <div className="absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#2d2d2d] px-3 py-2 text-sm text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 pointer-events-none">
            Построение по прямой между точками
            <span className="ml-2 text-gray-400">S</span>
          </div>
        </button>

        {/* ── Кнопка 3: Метки (только иконка) ── */}
        <button
          type="button"
          onClick={handleLabelClick}
          className={`group relative flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
            routingMode === 'label'
              ? 'bg-amber-400 text-black'
              : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-200/80'
          }`}
        >
          <MapPin className="h-4 w-4 shrink-0" />
          <div className="absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#2d2d2d] px-3 py-2 text-sm text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 pointer-events-none">
            Добавить метку
            <span className="ml-2 text-gray-400">F</span>
          </div>
        </button>

        {/* ── Дропдаун выбора профиля ── */}
        {showProfileMenu && (
          /*
           * flex-col + max-h: шапка зафиксирована, тело скроллится независимо.
           * Скроллбар скрыт через [&::-webkit-scrollbar]:hidden,
           * но прокрутка работает (колёсиком и тачем).
           */
          <div className="absolute left-0 top-full mt-2 flex max-h-[480px] w-[400px] flex-col overflow-hidden rounded-2xl border border-border/60 bg-white shadow-2xl dark:bg-background">

            {/* Шапка — не скроллится */}
            <div className="shrink-0 border-b border-border/50 px-4 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Тип маршрута
              </p>
            </div>

            {/* Тело — скроллится при переполнении */}
            <div className="overflow-y-auto py-1 [&::-webkit-scrollbar]:hidden">
              {PROFILE_GROUPS.map((group, gIdx) => {
                const groupProfiles = ROUTING_PROFILES.filter((p) => p.group === group.id);
                if (groupProfiles.length === 0) return null;

                return (
                  <div key={group.id}>
                    {/* Разделитель между группами */}
                    {gIdx > 0 && (
                      <div className="mx-4 my-1 h-px bg-border/40" />
                    )}

                    {/* Заголовок группы */}
                    <p className="px-4 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                      {group.label}
                    </p>

                    {/* Пункты группы */}
                    {groupProfiles.map((profile) => {
                      const isActive = routingProfile === profile.value;
                      const IconComp = PROFILE_ICONS[profile.value];

                      return (
                        <button
                          key={profile.value}
                          type="button"
                          onClick={() => handleProfileSelect(profile.value)}
                          className={`flex w-full flex-row items-start gap-3 px-4 py-1.5 text-left transition-colors hover:bg-muted/60 ${
                            isActive ? 'bg-amber-50 dark:bg-amber-950/20' : ''
                          }`}
                        >
                          {/* Иконка — выровнена по первой строке заголовка */}
                          <span className="mt-0.5 shrink-0">
                            {IconComp ? (
                              <IconComp
                                className={`h-4 w-4 ${isActive ? 'text-amber-600' : 'text-foreground'}`}
                                strokeWidth={1.75}
                              />
                            ) : (
                              <span className="text-sm leading-none">{profile.emoji}</span>
                            )}
                          </span>

                          {/* Заголовок + описание */}
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-medium leading-tight ${
                              isActive ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'
                            }`}>
                              {profile.label}
                            </p>
                            <p className="mt-0.5 text-xs leading-snug text-gray-500">
                              {profile.subtitle}
                            </p>
                          </div>

                          {/* Галочка выбранного профиля */}
                          {isActive && (
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Подсказка для режима «Метки» ── */}
      {routingMode === 'label' && (
        <div className="pointer-events-none absolute top-[calc(100%+8px)] rounded-xl border bg-amber-50/95 px-3 py-1.5 text-xs font-medium text-amber-800 shadow-md backdrop-blur-sm dark:bg-amber-950/80 dark:text-amber-200">
          Кликните по карте, чтобы поставить метку
        </div>
      )}
    </div>
  );
}
