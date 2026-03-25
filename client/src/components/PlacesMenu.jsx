import { useState } from 'react';
import { MapPin, ChevronDown, EyeOff, Search, Loader2 } from 'lucide-react';

import { POI_CATEGORIES } from '@/config/poiConfig';
import useRouteStore from '@/store/useRouteStore';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';

/**
 * Секция «Места»: белая карточка, заголовок с иконкой, счётчиком и спиннером, контент раскрывается вниз.
 * Подсветка жёлтым, когда секция активна и есть выбранные категории.
 *
 * @param {{ expandedSection: string | null, onToggle: (section: string | null) => void }} props
 */
export default function PlacesMenu({ expandedSection, onToggle }) {
  const [searchQuery, setSearchQuery] = useState('');

  const activePoiCategories = useRouteStore((s) => s.activePoiCategories);
  const togglePoiCategory = useRouteStore((s) => s.togglePoiCategory);
  const clearAllPoiCategories = useRouteStore((s) => s.clearAllPoiCategories);
  const isLoadingPois = useRouteStore((s) => s.isLoadingPois);

  const filteredCategories = searchQuery.trim()
    ? POI_CATEGORIES.map((cat) => ({
        ...cat,
        items: cat.items.filter((item) =>
          item.label.toLowerCase().includes(searchQuery.toLowerCase()),
        ),
      })).filter((cat) => cat.items.length > 0)
    : POI_CATEGORIES;

  const activeCount = activePoiCategories.length;
  const isOpen = expandedSection === 'places';
  const highlightYellow = isOpen && activeCount > 0;

  return (
    <div className="relative flex flex-col overflow-visible">
      {/* Кнопка-триггер */}
      <button
        type="button"
        onClick={() => onToggle(isOpen ? null : 'places')}
        className={[
          'flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-gray-100 bg-white px-4 text-left shadow-lg transition-colors',
          highlightYellow ? 'bg-amber-50 border-amber-200/50' : 'hover:bg-gray-50',
        ].join(' ')}
      >
        <div className="flex min-w-0 items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-gray-600" />
          <span className="truncate text-sm font-medium text-gray-700">Места</span>
          {activeCount > 0 && (
            <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {activeCount}
            </span>
          )}
          {isLoadingPois && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Плавающий список: не зависит от ширины кнопки */}
      {isOpen && (
        <div className="absolute top-full right-0 z-[2000] mt-2 w-[350px] flex max-h-[60vh] flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg">
          {/* Поиск и кнопка «Скрыть всё» */}
          <div className="shrink-0 border-b border-gray-100 bg-white p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Поиск мест..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
            {activeCount > 0 && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={clearAllPoiCategories}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <EyeOff className="h-3 w-3" />
                  Скрыть всё
                </button>
              </div>
            )}
          </div>

          {/* Список категорий: занимает оставшееся место, прокрутка внутри */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            {filteredCategories.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs italic text-muted-foreground">
                Ничего не найдено
              </p>
            ) : (
              <div className="space-y-0.5 px-3 py-2 pb-4">
                {filteredCategories.map((category) => (
                  <div key={category.id}>
                    <p className="sticky top-0 z-10 bg-white px-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {category.label}
                    </p>
                    {category.items.map((item) => {
                      const Icon = item.icon;
                      const enabled = activePoiCategories.includes(item.id);
                      return (
                        <div
                          key={item.id}
                          className={[
                            'flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors',
                            enabled ? 'bg-primary/5' : 'hover:bg-muted/50',
                          ].join(' ')}
                        >
                          <div
                            className={[
                              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                              enabled ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                            ].join(' ')}
                          >
                            <Icon className="h-3 w-3" />
                          </div>
                          <span
                            className={[
                              'flex-1 truncate text-xs font-medium',
                              enabled ? 'text-foreground' : 'text-muted-foreground',
                            ].join(' ')}
                          >
                            {item.label}
                          </span>
                          <Switch
                            checked={enabled}
                            onCheckedChange={() => togglePoiCategory(item.id)}
                            aria-label={`Включить «${item.label}»`}
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Подвал */}
          <div className="shrink-0 border-t border-gray-100 px-4 py-2.5">
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Включённые категории отображаются на карте в радиусе маршрута.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
