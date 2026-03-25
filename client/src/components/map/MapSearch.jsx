import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const SEARCH_DEBOUNCE_MS = 400;
const FLY_TO_ZOOM = 13;

/**
 * Формирует отображаемое название места из ответа Nominatim.
 * name — основное имя (город, улица и т.д.), type — тип объекта.
 */
function getPlaceTitle(item) {
  const name = item.name || item.display_name?.split(',')[0]?.trim() || 'Без названия';
  const type = item.type || item.class || '';
  const typeLabel = type ? ` | ${type.charAt(0).toUpperCase() + type.slice(1)}` : '';
  return { name, typeLabel };
}

/**
 * Подзаголовок — остальная часть display_name (страна, регион, адрес).
 */
function getPlaceSubtitle(item) {
  const parts = item.display_name?.split(',').map((s) => s.trim()).filter(Boolean) || [];
  return parts.slice(1).join(', ') || '';
}

/**
 * Глобальный поиск по карте (Nominatim / OpenStreetMap).
 *
 * — Строка поиска с иконкой слева и крестиком очистки справа.
 * — Выпадающие подсказки под инпутом: название, тип, подзаголовок серым.
 * — При выборе места карта летит туда (flyTo zoom 13) и вызывается onPlaceSelect для маркера.
 *
 * @param {object} props
 * @param {L.Map} [props.map] — инстанс карты Leaflet (для flyTo при выборе места).
 * @param {Function} [props.onPlaceSelect] — callback({ lat, lon }) при выборе места.
 * @param {string} [props.containerClassName] — доп. класс контейнера (например "relative w-full" для встраивания в сайдбар).
 * @param {number} [props.limit=8] — макс. число подсказок Nominatim.
 */
export default function MapSearch({ map, onPlaceSelect, containerClassName = '', limit = 8 }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const fetchSuggestions = useCallback(async (q) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        format: 'json',
        q: trimmed,
        addressdetails: '1',
        limit: String(limit),
      });
      const res = await fetch(`${NOMINATIM_URL}?${params}`, {
        headers: {
          'Accept-Language': 'ru,en',
          // Nominatim требует осмысленный User-Agent
          'User-Agent': 'DiplomaRoutePlanner/1.0 (Tourist Route Planner)',
        },
      });
      if (!res.ok) throw new Error('Ошибка поиска');
      const data = await res.json();
      setSuggestions(Array.isArray(data) ? data : []);
      setSelectedIndex(-1);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  // Дебаунс запроса к Nominatim
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setOpen(true);
      fetchSuggestions(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchSuggestions]);

  // Закрытие выпадающего списка по клику вне компонента
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleClear = () => {
    setQuery('');
    setSuggestions([]);
    setOpen(false);
    setSelectedIndex(-1);
    onPlaceSelect?.(null);
    inputRef.current?.focus();
  };

  const handleSelect = (item) => {
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      map?.flyTo([lat, lon], FLY_TO_ZOOM, { duration: 0.8 });
      onPlaceSelect?.({ lat, lon });
    }
    setQuery(item.display_name || '');
    setSuggestions([]);
    setOpen(false);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e) => {
    if (!open || suggestions.length === 0) {
      if (e.key === 'Escape') setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => (i < suggestions.length - 1 ? i + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && selectedIndex >= 0 && suggestions[selectedIndex]) {
      e.preventDefault();
      handleSelect(suggestions[selectedIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setSelectedIndex(-1);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`z-[1001] pointer-events-auto ${containerClassName || 'absolute top-4 left-16 w-64 sm:w-72'}`}
    >
      <div className="flex h-10 items-center gap-2 overflow-hidden rounded-xl border border-gray-200 bg-white px-3 shadow-md transition-shadow focus-within:ring-2 focus-within:ring-amber-400 focus-within:border-amber-400">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim() && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Поиск места на карте..."
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="map-search-suggestions"
          id="map-search-input"
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-amber-400"
            aria-label="Очистить поиск"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Выпадающий список подсказок строго под инпутом (position: absolute, top: 100%, left: 0) */}
      {open && (suggestions.length > 0 || loading) && (
        <ul
          id="map-search-suggestions"
          className="absolute top-full left-0 right-0 z-10 mt-2 max-h-72 overflow-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
          role="listbox"
          aria-labelledby="map-search-input"
        >
          {loading && suggestions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">Загрузка...</li>
          ) : (
            suggestions.map((item, index) => {
              const { name, typeLabel } = getPlaceTitle(item);
              const subtitle = getPlaceSubtitle(item);
              const isSelected = index === selectedIndex;
              return (
                <li
                  key={item.place_id}
                  role="option"
                  aria-selected={isSelected}
                  className={`cursor-pointer px-3 py-2 text-left transition-colors ${
                    isSelected ? 'bg-amber-50' : 'hover:bg-muted/60'
                  }`}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(item)}
                >
                  <span className="font-semibold text-foreground">
                    {name}
                    {typeLabel}
                  </span>
                  {subtitle && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
