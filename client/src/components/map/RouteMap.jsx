import { useRef, useMemo, useEffect, useState, Fragment } from 'react';
import { renderToString } from 'react-dom/server';
import {
  MapContainer, TileLayer, Marker, Popup, Tooltip,
  Polyline, CircleMarker, useMapEvents, useMap,
} from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import { Loader2, MapPin, ZoomIn } from 'lucide-react';

import 'leaflet/dist/leaflet.css';

import useRouteStore, { MAP_LAYERS, DAY_COLORS } from '@/store/useRouteStore';
import { getPoiMeta } from '@/config/poiConfig';
import MapLayersControl from './MapLayerSwitcher';
import PlacesMenu from '@/components/PlacesMenu';
import MapToolbar from './MapToolbar';
import MapSearch from './MapSearch';
import PointPopupContent from './PointPopupContent';
import { POI_ICONS } from './PoiIconPicker';
import { createCustomMarker } from '@/utils/markerUtils';
import PhotoLightbox from '@/components/PhotoLightbox';

const DEFAULT_CENTER = [55.751244, 37.618423];
const DEFAULT_ZOOM   = 10;

// ─── Иконки маркеров ──────────────────────────────────────────────────────────

/**
 * Кастомный DivIcon для технической точки маршрута.
 *
 * Белый кружок с толстой цветной обводкой — цвет соответствует дню маршрута.
 * Используем Marker вместо CircleMarker, потому что только Marker
 * поддерживает draggable в react-leaflet.
 * cursor: grab — визуально сигнализирует о перетаскиваемости.
 *
 * @param {number} index — порядковый номер (1, 2, 3…) для title
 * @param {string} color — HEX-цвет дня (из tripDays)
 * @returns {L.DivIcon}
 */
function createRoutePointIcon(index, color = '#1a1a1a') {
  return L.divIcon({
    html: `<div title="Точка маршрута ${index}" style="
      width:14px; height:14px;
      background:white;
      border:3px solid ${color};
      border-radius:50%;
      box-shadow:0 1px 5px rgba(0,0,0,0.4);
      cursor:grab;
    "></div>`,
    className:  '',
    iconSize:   [14, 14],
    iconAnchor: [7, 7],
  });
}

/**
 * DivIcon для смысловых меток — капля по референсу (createCustomMarker).
 * При смене цвета/иконки в Popup маркер обновляется мгновенно.
 */
function createLabelIcon(color, _index, iconType = 'map-pin') {
  const entry = POI_ICONS.find((i) => i.id === iconType);
  const Icon = entry?.Icon ?? POI_ICONS[0]?.Icon;
  if (!Icon) return L.divIcon({ html: '<div></div>', iconSize: [36, 36], iconAnchor: [18, 36] });
  return createCustomMarker(color ?? '#ef4444', Icon);
}

/** Минимальный зум для отображения подсказок расстояния на отрезках (при отдалении скрываем, чтобы не засорять карту). */
const MIN_ZOOM_SEGMENT_LABELS = 11;
/** Максимальное количество отрезков, при котором показываются бабблы (при большем числе — скрываем). */
const MAX_SEGMENT_LABELS = 25;

/**
 * Средняя точка отрезка path для размещения баббла расстояния.
 * Для двух точек — геометрическая середина; для длинной линии — точка в середине по индексу.
 *
 * @param {Array<[number, number]>} path — массив [lat, lng]
 * @returns {[number, number]|null}
 */
function getSegmentMidpoint(path) {
  if (!path?.length) return null;
  if (path.length === 1) return path[0];
  if (path.length === 2) {
    return [
      (path[0][0] + path[1][0]) / 2,
      (path[0][1] + path[1][1]) / 2,
    ];
  }
  const midIdx = Math.floor(path.length / 2);
  return path[midIdx];
}

/**
 * DivIcon для подсказки расстояния на отрезке: белая плашка со скруглёнными углами, тенью и хвостиком вниз.
 * Текст вида «1.2 км», без интерактивности (pointer-events: none), чтобы не перехватывать клики по карте.
 */
function createSegmentLabelIcon(distanceKm) {
  const text = `${Number(distanceKm).toFixed(1)} км`;
  return L.divIcon({
    html: `
      <div style="
        background: white;
        border-radius: 4px;
        padding: 2px 5px;
        font-size: 12px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        white-space: nowrap;
        pointer-events: none;
        font-family: system-ui, -apple-system, sans-serif;
        color: #1a1a1a;
        position: relative;
      ">
        ${text}
        <span style="
          position: absolute;
          left: 50%;
          bottom: -5px;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-top: 5px solid white;
          filter: drop-shadow(0 1px 1px rgba(0,0,0,0.2));
        "></span>
      </div>
    `,
    className: '',
    iconSize:   [56, 22],
    iconAnchor: [28, 22],
  });
}

// ─── Вспомогательные компоненты ────────────────────────────────────────────────

/**
 * Обрабатывает клики по карте в зависимости от активного режима:
 *  'label'  → addLabel (смысловая метка)
 *  'auto'/'direct' → addRoutePoint (техническая точка)
 *
 * Вынесен отдельно, так как useMapEvents должен быть внутри MapContainer.
 */
function MapClickHandler({ routingMode, onAddRoutePoint, onAddLabel }) {
  useMapEvents({
    click: (e) => {
      if (routingMode === 'label') onAddLabel(e.latlng);
      else onAddRoutePoint(e.latlng);
    },
  });
  return null;
}

/**
 * Синяя точка для отображения результата глобального поиска по карте.
 */
const searchResultIcon = L.divIcon({
  html: `<div style="
    width:20px; height:20px;
    background:#2563eb;
    border:2px solid white;
    border-radius:50%;
    box-shadow:0 2px 6px rgba(0,0,0,0.35);
  "></div>`,
  className: '',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

/**
 * Мост для передачи инстанса карты в MapSearch и отображение маркера результата поиска.
 * Должен находиться внутри MapContainer (useMap).
 */
function MapSearchBridge({ onMapReady, searchMarkerPosition }) {
  const map = useMap();
  useEffect(() => {
    onMapReady?.(map);
    return () => onMapReady?.(null);
  }, [map, onMapReady]);

  if (!searchMarkerPosition) return null;
  return (
    <Marker
      position={[searchMarkerPosition.lat, searchMarkerPosition.lon]}
      icon={searchResultIcon}
      zIndexOffset={1000}
    />
  );
}

/**
 * Слушает window resize (в т.ч. после ресайза сайдбара) и вызывает map.invalidateSize(),
 * чтобы карта пересчитала размеры и не оставалось серых зон.
 */
function MapResizeHandler() {
  const map = useMap();
  useEffect(() => {
    const onResize = () => map.invalidateSize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [map]);
  return null;
}

/**
 * Минимальный попап для технической точки.
 * Содержит только кнопку «Удалить» — технические точки не редактируются.
 * stopPropagation предотвращает всплытие клика до карты.
 */
function RoutePointPopup({ id, index, onDelete }) {
  return (
    <div
      className="flex flex-col items-center gap-2 py-1"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-xs font-semibold text-foreground">
        Точка маршрута {index}
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(id); }}
        className="rounded-md bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
      >
        Удалить
      </button>
    </div>
  );
}

// ─── POI ───────────────────────────────────────────────────────────────────────

/**
 * Кастомный DivIcon для кластера POI-маркеров.
 *
 * Стилизован идентично отдельным маркерам (тёмный кружок #18181b, белая рамка,
 * тень) — кластер выглядит как «жирная» версия одиночного маркера.
 *
 * Используем inline styles по той же причине, что и в createPoiIcon:
 * Tailwind-классы в renderToString не попадают в CSS-бандл (purge).
 *
 * @param {L.MarkerCluster} cluster — объект Leaflet MarkerCluster
 * @returns {L.DivIcon}
 */
function createClusterCustomIcon(cluster) {
  let count = 0;
  try {
    count = typeof cluster?.getChildCount === 'function' ? cluster.getChildCount() : 0;
  } catch (_) {
    count = 0;
  }
  let iconHtml;
  try {
    iconHtml = renderToString(
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        width:          '40px',
        height:         '40px',
        background:     '#18181b',
        borderRadius:   '50%',
        border:         '2.5px solid white',
        boxShadow:      '0 2px 10px rgba(0,0,0,0.45)',
        color:          'white',
        fontWeight:     '700',
        fontSize:       '14px',
        fontFamily:     'system-ui, -apple-system, sans-serif',
      }}>
        {count}
      </div>,
    );
  } catch (_) {
    iconHtml = `<div style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;background:#18181b;border-radius:50%;border:2.5px solid white;box-shadow:0 2px 10px rgba(0,0,0,0.45);color:white;font-weight:700;font-size:14px;font-family:system-ui,sans-serif;">${count}</div>`;
  }

  return L.divIcon({
    html:        iconHtml,
    className:   'border-none bg-transparent',
    iconSize:    [40, 40],
    iconAnchor:  [20, 20],
  });
}

/**
 * Кастомный DivIcon для POI-маркера.
 *
 * Использует renderToString для вставки React/Lucide-компонента в HTML-строку,
 * которую принимает Leaflet.divIcon. Это стандартный паттерн интеграции
 * Leaflet и React без дополнительных библиотек.
 *
 * Важно: className на самом divIcon должен сбрасывать дефолтный стиль Leaflet
 * (белый прямоугольник с рамкой), поэтому передаём пустой класс и border-none.
 *
 * @param {string|null} categoryId — id из poiConfig ('water', 'cafe', …)
 * @returns {L.DivIcon}
 */
function createPoiIcon(categoryId) {
  const meta = getPoiMeta(categoryId ?? null);
  const IconComponent = meta?.icon ?? MapPin;

  try {
    const iconHtml = renderToString(
      <div style={{
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        width:           '32px',
        height:          '32px',
        background:      '#18181b',
        borderRadius:    '50%',
        border:          '2.5px solid white',
        boxShadow:       '0 2px 10px rgba(0,0,0,0.45)',
        color:           'white',
      }}>
        <IconComponent size={16} color="white" strokeWidth={2.5} />
      </div>,
    );

    return L.divIcon({
      html:        iconHtml,
      className:   'border-none bg-transparent',
      iconSize:    [32, 32],
      iconAnchor:  [16, 16],
      popupAnchor: [0, -20],
    });
  } catch (_) {
    const fallbackHtml = '<div style="width:32px;height:32px;border-radius:50%;background:#18181b;border:2.5px solid white;display:flex;align-items:center;justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></div>';
    return L.divIcon({
      html:        fallbackHtml,
      className:   'border-none bg-transparent',
      iconSize:    [32, 32],
      iconAnchor:  [16, 16],
      popupAnchor: [0, -20],
    });
  }
}

/**
 * Попап для POI-маркера.
 *
 * Структура:
 *  — Название (из tags.name или метка категории как фолбэк)
 *  — Ссылка на OpenStreetMap для просмотра / редактирования объекта
 *  — Разделитель
 *  — Кнопка «Добавить метку» (заглушка, реализация — следующий шаг)
 */
function PoiPopup({ poi }) {
  if (!poi) return <span className="text-sm text-muted-foreground">Без названия</span>;
  const meta = getPoiMeta(poi?.categoryId ?? null);
  const displayName = poi?.tags?.name ?? meta?.label ?? 'Без названия';
  const osmId = poi?.id ?? '';

  return (
    <div
      className="flex min-w-[190px] flex-col py-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Название */}
      <span className="text-sm font-semibold leading-tight text-foreground">
        {displayName}
      </span>

      {/* Ссылка на OSM */}
      {osmId ? (
        <a
          href={`https://www.openstreetmap.org/node/${osmId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 block text-xs text-blue-500 hover:underline"
        >
          Посмотреть на OpenStreetMap
        </a>
      ) : null}

      <hr className="my-2 border-gray-200" />

      {/* Кнопка-заглушка «Добавить метку» */}
      <button
        type="button"
        onClick={() => console.log('Add POI:', poi)}
        className="flex w-full items-center gap-2 rounded p-1 text-sm transition-colors hover:bg-gray-100"
      >
        <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-xs text-foreground">Добавить метку</span>
      </button>
    </div>
  );
}

/**
 * Минимальный зум, при котором разрешено загружать POI.
 *
 * Зум 10 охватывает ~город целиком — хороший баланс между охватом и размером BBox.
 * При меньших значениях Overpass возвращает тысячи объектов или падает с 429.
 */
const MIN_POI_ZOOM = 10;

/**
 * Вспомогательный компонент, управляющий загрузкой POI.
 *
 * Должен находиться внутри <MapContainer>, чтобы иметь доступ
 * к инстансу карты через useMapEvents.
 *
 * Оптимизации против спама к Overpass API:
 *  1. Debounce 1000 мс на moveend — запрос уходит только когда пользователь
 *     остановил карту, а не при каждом пикселе прокрутки.
 *  2. Проверка зума — при масштабе < MIN_POI_ZOOM запрос не делается совсем
 *     (BBox был бы слишком большим → таймаут или 429).
 *  3. Очистка таймера при размонтировании — не допускаем вызова setState
 *     на уже размонтированный компонент.
 */
function PoiManager() {
  /*
   * Selector-подписка: перерендер только при изменении activePoiCategories,
   * а не при любом обновлении стора.
   */
  const activePoiCategories = useRouteStore((state) => state.activePoiCategories);
  const setIsZoomTooLow     = useRouteStore((state) => state.setIsZoomTooLow);
  const debounceRef = useRef(null);

  /*
   * useMapEvents возвращает стабильный инстанс Leaflet-карты.
   * fetchPois и актуальные категории читаются через getState() внутри setTimeout,
   * чтобы не было stale closure при быстром сдвиге карты.
   */
  const map = useMapEvents({
    moveend: () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const { fetchPois, activePoiCategories: cats } = useRouteStore.getState();
        if (map.getZoom() >= MIN_POI_ZOOM && cats.length > 0) {
          /*
           * pad(0.1) = 10% запаса вокруг видимой области.
           * Достаточно для плавного панорамирования без риска таймаута Overpass
           * (pad(0.5) давал площадь x4 — слишком много для зума 10).
           */
          fetchPois(map.getBounds().pad(0.1));
        }
      }, 800);
    },

    /*
     * zoomend — только обновляем флаг для подсказки.
     * Загруженные маркеры НЕ удаляем: они остаются видимы при любом зуме,
     * а загрузка новых просто ставится на паузу ниже MIN_POI_ZOOM.
     */
    zoomend: () => {
      setIsZoomTooLow(map.getZoom() < MIN_POI_ZOOM);
    },
  });

  // Первичная проверка при монтировании — подсказка появляется сразу,
  // если карта уже открыта на слишком мелком масштабе
  useEffect(() => {
    setIsZoomTooLow(map.getZoom() < MIN_POI_ZOOM);
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * Triggered when the user toggles a POI category.
   *
   * Debounce 1000 мс: если пользователь быстро включает несколько тумблеров,
   * таймер каждый раз сбрасывается — в Overpass уходит один финальный запрос,
   * а не по одному на каждый клик. Cleanup-функция гарантирует отмену
   * незавершённого таймера при следующем рендере или размонтировании.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      if (activePoiCategories.length > 0 && map.getZoom() >= MIN_POI_ZOOM) {
        useRouteStore.getState().fetchPois(map.getBounds().pad(0.1));
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [activePoiCategories, map]); // eslint-disable-line react-hooks/exhaustive-deps

  // Очищаем pending-таймер при размонтировании компонента
  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  return null;
}

/**
 * Маркеры-«бабблы» с расстоянием для каждого отрезка маршрута.
 * Отображаются только при достаточном зуме и не слишком большом числе отрезков.
 * При удалении точек или очистке маршрута исчезают вместе с линией (segmentLabels приходит пустой).
 */
function SegmentDistanceLabels({ segmentLabels }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());

  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on('zoomend', onZoom);
    return () => map.off('zoomend', onZoom);
  }, [map]);

  const show =
    segmentLabels.length > 0 &&
    segmentLabels.length <= MAX_SEGMENT_LABELS &&
    zoom >= MIN_ZOOM_SEGMENT_LABELS;

  if (!show) return null;

  return (
    <>
      {segmentLabels.map(({ key, midpoint, distance }) => (
        <Marker
          key={key}
          position={midpoint}
          icon={createSegmentLabelIcon(distance)}
          interactive={false}
          zIndexOffset={100}
        />
      ))}
    </>
  );
}

// ─── Конфигурация визуального стиля линий (дни / отрезки) ───────────────────────

/**
 * Маппинг числовых ORS surface-id → категория покрытия.
 * Зеркалит SURFACE_CATEGORY_MAP из стора (держится рядом со стилями
 * чтобы RouteMap был самодостаточным компонентом).
 *
 * 0         — unknown (нет данных)
 * 1         — paved   (общий «твёрдое»)
 * 2         — unpaved (общий «мягкое»)
 * 3–6       — paved   (asphalt, concrete, cobblestone, metal)
 * 7–12      — unpaved (wood, compacted_gravel, fine_gravel, gravel, dirt, ground)
 * 13        — unknown (ice)
 * 14        — paved   (paving_stones)
 * 15–17     — unpaved (sand, woodchips, grass)
 * 18        — paved   (grass_paver)
 */
/** Экспорт для использования на странице просмотра маршрута (vanilla Leaflet). */
export const SURFACE_ID_TO_CATEGORY = {
  0:  'unknown', 1:  'paved',   2:  'unpaved', 3:  'paved',   4:  'paved',
  5:  'paved',   6:  'paved',   7:  'unpaved', 8:  'unpaved', 9:  'unpaved',
  10: 'unpaved', 11: 'unpaved', 12: 'unpaved', 13: 'unknown', 14: 'paved',
  15: 'unpaved', 16: 'unpaved', 17: 'unpaved', 18: 'paved',
};

/**
 * Генерирует массив слоёв pathOptions для фрагмента линии по покрытию.
 *
 * Цвет основы (c) берётся из dayColor — линии сохраняют цвет своего дня.
 * isActive управляет толщиной: активный день рисуется толще, неактивные тоньше.
 *
 * Слои накладываются снизу вверх через несколько <Polyline>:
 *
 *  paved   — 1 слой:  сплошная цвета дня         (active 7 / inactive 4)
 *  unpaved — 3 слоя:  цвет дня (7/4) → белый (5/3) → пунктир цвета дня (5/3)
 *  unknown — 2 слоя:  цвет дня (7/4) → белая «труба» (3/2)
 *
 * @param {number}  surfaceValue — числовой код ORS (extras.surface.values[n][2])
 * @param {string}  dayColor     — HEX-цвет дня (seg.dayColor)
 * @param {boolean} isActive     — принадлежит ли отрезок активному дню
 * @returns {object[]} массив Leaflet pathOptions (от нижнего слоя к верхнему)
 */
export function getSurfaceLayers(surfaceValue, dayColor, isActive = false) {
  const category = SURFACE_ID_TO_CATEGORY[surfaceValue] ?? 'unknown';
  const c = dayColor ?? '#27272a';

  switch (category) {
    case 'paved':
      return [
        { color: c, weight: isActive ? 7 : 4, opacity: 1, lineJoin: 'round', lineCap: 'round' },
      ];
    case 'unpaved':
      return [
        { color: c,         weight: isActive ? 7 : 4, opacity: 1, lineJoin: 'round', lineCap: 'round' },
        { color: '#ffffff', weight: isActive ? 5 : 3, opacity: 1, lineJoin: 'round', lineCap: 'round' },
        { color: c,         weight: isActive ? 5 : 3, opacity: 1, lineJoin: 'round', lineCap: 'round',
          dashArray: '4 8' },
      ];
    default: // unknown
      return [
        { color: c,         weight: isActive ? 7 : 4, opacity: 1, lineJoin: 'round', lineCap: 'round' },
        { color: '#ffffff', weight: isActive ? 3 : 2, opacity: 1, lineJoin: 'round', lineCap: 'round' },
      ];
  }
}

// ─── Основной компонент ────────────────────────────────────────────────────────

/**
 * Основной компонент интерактивной карты маршрутов.
 *
 * Рендерит:
 *  1. Линии дней маршрута как отдельные Polyline (сплошные/пунктирные).
 *  2. Технические точки как перетаскиваемые Marker с чёрным кружком.
 *  3. Смысловые метки как перетаскиваемые Marker «капля» с попапом редактирования.
 *  4. Синхронизирующий CircleMarker для графика высот.
 *
 * Drag-and-drop:
 *  Технические точки: dragend → dragRoutePoint(id, latlng) → пересчёт смежных отрезков.
 *  Метки: dragend → dragLabel(id, latlng) → только обновление координат в сторе.
 *
 * Панели управления (MapToolbar, MapLayerSwitcher) размещены абсолютно
 * поверх карты вне MapContainer — без Leaflet.Control.
 *
 * Опциональный проп hoveredLocation: { lat, lng } | null — для отображения бегающей точки
 * при просмотре маршрута (когда график высот передаёт координаты извне). Если не передан,
 * используется hoveredElevationPoint из стора (страница создания).
 *
 * readOnly: при true скрывается панель инструментов (MapToolbar), отключаются клики по карте
 * (добавление точек/меток) и перетаскивание маркеров — режим только просмотра.
 */
export default function RouteMap({ hoveredLocation: hoveredLocationProp = null, readOnly = false }) {
  const [expandedSection, setExpandedSection] = useState(null); // 'layers' | 'places' | null
  const [mapInstance, setMapInstance] = useState(null);
  const [searchMarkerPosition, setSearchMarkerPosition] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxPhotos, setLightboxPhotos] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const {
    routePoints,
    routePath,
    labels,
    segments,
    tripDays,
    activeDayId,
    routingMode,
    routingProfile,
    activeLayer,
    showSurfaceOnMap,
    pois,
    activePoiCategories,
    isZoomTooLow,
    poiLimitReached,
    isSlowLoading,
    poiUpdateTrigger,
    addRoutePoint,
    addLabel,
    removeRoutePoint,
    removeLabel,
    updateLabelMeta,
    dragRoutePoint,
    dragLabel,
    hoveredElevationPoint,
  } = useRouteStore();

  /** Один раз подгоняем карту под загруженный маршрут (edit/clone), чтобы не было пустой карты при старте. */
  const fittedBoundsRef = useRef(false);
  useEffect(() => {
    if (!readOnly || !mapInstance || !Array.isArray(routePath) || routePath.length < 2) return;
    if (fittedBoundsRef.current) return;
    try {
      const bounds = L.latLngBounds(routePath.map((p) => [p[0], p[1]]));
      mapInstance.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
      fittedBoundsRef.current = true;
    } catch (_) {
      // игнорируем ошибки bounds
    }
  }, [readOnly, mapInstance, routePath]);
  useEffect(() => {
    if (!readOnly) fittedBoundsRef.current = false;
  }, [readOnly]);

  const currentLayer = MAP_LAYERS[activeLayer];

  /** Рефы на Leaflet-маркеры меток для программного закрытия попапа. */
  const labelRefs = useRef({});

  const handleLabelSave = (id, meta, options) => {
    updateLabelMeta(id, meta);
    if (options?.close !== false) labelRefs.current[id]?.closePopup();
  };

  /**
   * Упорядоченный список отрезков по порядку routePoints.
   * Вычисляется здесь для рендеринга — несколько Polyline вместо одного.
   * useMemo предотвращает лишние перебросы при каждом рендере карты.
   */
  const orderedSegments = useMemo(() => {
    const result = [];
    for (let i = 0; i < routePoints.length - 1; i++) {
      const seg = segments.find(
        (s) => s.fromPointId === routePoints[i].id && s.toPointId === routePoints[i + 1].id,
      );
      if (seg) result.push(seg);
    }
    return result;
  }, [routePoints, segments]);

  /** Данные для бабблов расстояния: средняя точка каждого отрезка и расстояние в км. При удалении точки/очистке маршрута массив обновляется — бабблы исчезают. */
  const segmentLabels = useMemo(() => {
    return orderedSegments
      .map((seg) => {
        const midpoint = getSegmentMidpoint(seg.path);
        if (!midpoint) return null;
        return {
          key:    `seg-label_${seg.fromPointId}_${seg.toPointId}`,
          midpoint,
          distance: seg.distance,
        };
      })
      .filter(Boolean);
  }, [orderedSegments]);

  /**
   * Точки стыка отрезков (ночёвки / смена дня): конец одного отрезка и начало следующего.
   * Исключаем самую первую точку маршрута (Старт) и самую последнюю (Финиш).
   * Дедупликация по координатам, чтобы одна и та же точка не рисовалась дважды.
   */
  const junctionPoints = useMemo(() => {
    if (orderedSegments.length < 2) return [];
    const first = orderedSegments[0].path?.[0];
    const lastSeg = orderedSegments[orderedSegments.length - 1];
    const last = lastSeg.path?.[lastSeg.path.length - 1];
    if (!first || !last) return [];

    const eq = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
    const seen = new Set();
    const key = (pt) => `${Math.round(pt[0] * 1e5)}_${Math.round(pt[1] * 1e5)}`;
    const points = [];

    for (let i = 0; i < orderedSegments.length - 1; i++) {
      const pathEnd = orderedSegments[i].path;
      if (pathEnd?.length) {
        const pt = pathEnd[pathEnd.length - 1];
        if (!eq(pt, first) && !eq(pt, last) && !seen.has(key(pt))) {
          seen.add(key(pt));
          points.push(pt);
        }
      }
      const pathStart = orderedSegments[i + 1].path;
      if (pathStart?.length) {
        const pt = pathStart[0];
        if (!eq(pt, first) && !eq(pt, last) && !seen.has(key(pt))) {
          seen.add(key(pt));
          points.push(pt);
        }
      }
    }
    return points;
  }, [orderedSegments]);

  /** Бегающая точка: из пропа (просмотр) или из стора (создание). */
  const runningPoint = hoveredLocationProp?.lat != null && hoveredLocationProp?.lng != null
    ? hoveredLocationProp
    : (hoveredElevationPoint?.lat != null && hoveredElevationPoint?.lng != null ? hoveredElevationPoint : null);

  return (
    <div className="relative h-full w-full">
      {/* Глобальный поиск: строго в левом верхнем углу карты (absolute относительно этого контейнера) */}
      <MapSearch
        map={mapInstance}
        onPlaceSelect={setSearchMarkerPosition}
      />
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom={true}
        closePopupOnClick={false}
        className="h-full w-full"
      >
        {/* Тайловый слой — key принудительно пересоздаёт при смене */}
        <TileLayer
          key={activeLayer}
          url={currentLayer.url}
          attribution={currentLayer.attribution}
          maxZoom={currentLayer.maxZoom}
        />

        {/* Обработчик кликов: в readOnly не добавляем точки и метки */}
        {!readOnly && (
          <MapClickHandler
            routingMode={routingMode}
            onAddRoutePoint={addRoutePoint}
            onAddLabel={addLabel}
          />
        )}

        {/* Мост для MapSearch: передаёт инстанс карты и рисует маркер результата поиска */}
        <MapSearchBridge
          onMapReady={setMapInstance}
          searchMarkerPosition={searchMarkerPosition}
        />

        {/* Пересчёт размеров карты при resize (ресайз сайдбара на странице конструктора) */}
        <MapResizeHandler />

        {/*
         * ── Линии дней маршрута ─────────────────────────────────────────────
         *
         * Режим showSurfaceOnMap === false (по умолчанию):
         *   Каждый отрезок — Polyline цвета своего дня (seg.dayColor).
         *   ORS — сплошная линия weight:5.
         *   Direct — пунктир того же цвета weight:5.
         *   Благодаря разрыву между днями маршрут выглядит как цветные отрезки.
         *
         * Режим showSurfaceOnMap === true:
         *   Каждый диапазон покрытия рисуется набором многослойных Polyline.
         *   Основной цвет — dayColor отрезка; белые слои остаются белыми:
         *     paved   — 1 слой: сплошная цвета дня
         *     unpaved — 3 слоя: цвет дня + белый канал + пунктир цвета дня
         *     unknown — 2 слоя: цвет дня + белая «труба» (полая линия)
         *   Слои накладываются через несколько <Polyline> с одинаковыми позициями.
         *   Координаты: path.slice(startIdx, endIdx + 1) → стыковка без зазоров.
         *
         * Fallback (showSurfaceOnMap=true, нет surfaceData):
         *   direct → пунктир цвета дня weight:5
         *   ors    → сплошная цвета дня weight:5
         *
         */}
        {orderedSegments.map((seg) => {
          const segId    = `${seg.fromPointId}_${seg.toPointId}`;
          const dayColor = seg.dayColor ?? DAY_COLORS[0];
          const isActive = seg.tripDayId === activeDayId;

          // ── Режим без раскраски покрытия: цветные линии дня ─────────────
          if (!showSurfaceOnMap) {
            if (seg.method === 'direct') {
              // Прямые линии — пунктир того же цвета дня
              return (
                <Polyline
                  key={`seg_${segId}`}
                  positions={seg.path}
                  pathOptions={{
                    color: dayColor, weight: isActive ? 6 : 4, opacity: 0.82,
                    lineJoin: 'round', lineCap: 'round',
                    dashArray: '10 8',
                  }}
                />
              );
            }
            // ORS — сплошная линия цвета дня
            return (
              <Polyline
                key={`seg_${segId}`}
                positions={seg.path}
                pathOptions={{
                  color: dayColor, weight: isActive ? 6 : 4, opacity: 0.85,
                  lineJoin: 'round', lineCap: 'round',
                }}
              />
            );
          }

          // ── Fallback (showSurfaceOnMap включён, но данных нет) ────────────
          if (!seg.surfaceData?.length) {
            if (seg.method === 'direct') {
              return (
                <Polyline
                  key={`seg_${segId}_fb`}
                  positions={seg.path}
                  pathOptions={{
                    color: dayColor, weight: isActive ? 6 : 4, opacity: 0.75,
                    lineJoin: 'round', lineCap: 'round',
                    dashArray: '10 8',
                  }}
                />
              );
            }
            // ORS без данных покрытия — сплошная цвета дня
            return (
              <Polyline
                key={`seg_${segId}_fb`}
                positions={seg.path}
                pathOptions={{
                  color: dayColor, weight: isActive ? 6 : 4, opacity: 0.82,
                  lineJoin: 'round', lineCap: 'round',
                }}
              />
            );
          }

          // ── Раскраска по типу покрытия (цвет + толщина дня) ─────────────
          // dayColor и isActive передаются в getSurfaceLayers.
          return seg.surfaceData.flatMap(([startIdx, endIdx, surfaceValue]) => {
            // +1 к endIdx: соседние фрагменты покрытия стыкуются без зазоров
            const subPath = seg.path.slice(startIdx, endIdx + 1);
            if (subPath.length < 2) return [];
            return getSurfaceLayers(surfaceValue, dayColor, isActive).map((opts, li) => (
              <Polyline
                key={`seg_${segId}_s${startIdx}_l${li}`}
                positions={subPath}
                pathOptions={opts}
              />
            ));
          });
        })}

        {/* Подсказки расстояния по отрезкам: белые бабблы в средней точке. Скрываются при низком зуме и при большом числе отрезков. */}
        <SegmentDistanceLabels segmentLabels={segmentLabels} />

        {/*
         * Промежуточные точки стыка отрезков (ночёвки / концы дней): чёрные кружки.
         * Исключены первая (Старт) и последняя (Финиш) точки маршрута.
         */}
        {junctionPoints.map((pt, idx) => (
          <CircleMarker
            key={`junction-${idx}`}
            center={pt}
            radius={4}
            pathOptions={{
              color:       'white',
              weight:      2,
              fillColor:   'black',
              fillOpacity: 1,
            }}
            zIndexOffset={500}
            interactive={false}
          />
        ))}

        {/*
         * Бегающая точка, синхронизированная с графиком высот.
         * Источник: проп hoveredLocation (просмотр) или hoveredElevationPoint из стора (создание).
         */}
        {runningPoint && (
          <CircleMarker
            center={[runningPoint.lat, runningPoint.lng]}
            radius={6}
            pathOptions={{
              color:       'white',
              weight:      2,
              fillColor:   runningPoint.dayColor ?? '#3b82f6',
              fillOpacity: 1,
            }}
            zIndexOffset={1000}
            interactive={false}
          />
        )}

        {/*
         * ── Технические точки маршрута (чёрные кружки) ─────────────────────
         *
         * Используем Marker (не CircleMarker), потому что только Marker
         * поддерживает draggable в react-leaflet.
         *
         * Drag lifecycle:
         *  dragstart → закрываем попап (не мешает тащить)
         *  dragend   → dragRoutePoint(id, newLatLng) → пересчёт смежных отрезков
         *
         * click с stopPropagation — клик по точке не создаёт новую точку через MapClickHandler.
         */}
        {routePoints.map((point, index) => {
          // Ищем цвет дня для этой точки; фолбэк — первый цвет палитры
          const ptDayColor = tripDays.find((d) => d.id === point.tripDayId)?.color
            ?? DAY_COLORS[0];
          return (
          <Marker
            key={point.id}
            position={[point.lat, point.lng]}
            icon={createRoutePointIcon(index + 1, ptDayColor)}
            draggable={!readOnly}
            ref={(ref) => { if (ref) ref._icon?.setAttribute('title', `Точка ${index + 1}`); }}
            eventHandlers={readOnly ? undefined : {
              dragstart: (e) => { e.target.closePopup(); },
              dragend:   (e) => {
                const { lat, lng } = e.target.getLatLng();
                dragRoutePoint(point.id, { lat, lng });
              },
              click: (e) => { L.DomEvent.stopPropagation(e); },
            }}
          >
            <Popup minWidth={130} maxWidth={150} className="route-point-popup">
              <RoutePointPopup
                id={point.id}
                index={index + 1}
                onDelete={removeRoutePoint}
              />
            </Popup>
          </Marker>
          );
        })}

        {/*
         * ── Смысловые метки (цветные «капли») ──────────────────────────────
         *
         * Полноценные маркеры с PointPopupContent для редактирования:
         *  название, описание, фото (Supabase Storage), цвет, иконка.
         *
         * Drag lifecycle:
         *  dragstart → закрываем попап
         *  dragend   → dragLabel(id, newLatLng) → только обновление координат,
         *              маршрут не затрагивается
         *
         * Event bubbling:
         *  Клик по кнопке в попапе может всплыть до карты → добавление точки.
         *  Решение: stopPropagation в PointPopupContent.
         */}
        {labels.map((label, index) => {
          const displayName = (label.name || 'Метка').trim();
          const truncatedName = displayName.length > 25 ? `${displayName.slice(0, 25)}…` : displayName;
          return (
            <Marker
              key={label.id}
              position={[label.lat, label.lng]}
              icon={createLabelIcon(label.color, index + 1, label.icon)}
              draggable={!readOnly}
              ref={(ref) => { labelRefs.current[label.id] = ref; }}
              eventHandlers={readOnly ? undefined : {
                dragstart: (e) => { e.target.closePopup(); },
                dragend:   (e) => {
                  const { lat, lng } = e.target.getLatLng();
                  dragLabel(label.id, { lat, lng });
                },
              }}
            >
              <Tooltip permanent direction="right" offset={[12, 0]} className="poi-label-tooltip">
                {truncatedName}
              </Tooltip>
              <Popup minWidth={280} maxWidth={280} className="point-edit-popup">
                <PointPopupContent
                  point={label}
                  index={index + 1}
                  onSave={handleLabelSave}
                  onDelete={removeLabel}
                  onPhotoClick={(photos, idx) => {
                    if (Array.isArray(photos) && photos.length > 0) {
                      setLightboxPhotos(photos);
                      setLightboxIndex(Math.max(0, Math.min(idx, photos.length - 1)));
                      setLightboxOpen(true);
                    }
                  }}
                />
              </Popup>
            </Marker>
          );
        })}

        {/*
         * ── POI-маркеры (интересные места из Overpass API) ──────────────────
         *
         * MarkerClusterGroup автоматически объединяет близкие маркеры в кластеры,
         * решая проблему «визуального мусора» при сотнях точек на карте.
         *
         * chunkedLoading — разбивает добавление маркеров на микро-задачи,
         *   не блокируя поток рендеринга при большом массиве pois.
         * maxClusterRadius — максимальное расстояние (px) для объединения в кластер.
         * showCoverageOnHover — отключаем подсветку полигона охвата кластера.
         * iconCreateFunction — наш кастомный тёмный кружок вместо дефолтных
         *   зелёно-жёлтых иконок leaflet.markercluster.
         */}
        {/*
         * key на основе poiUpdateTrigger (Date.now()) — гарантирует полный reMount
         * кластера при каждом успешном ответе Overpass. Это надёжное решение бага
         * react-leaflet-cluster: кластер не реагировал на изменение children после
         * асинхронной загрузки, точки не появлялись до ручного сдвига карты.
         */}
        <MarkerClusterGroup
          key={`cluster-${poiUpdateTrigger}`}
          chunkedLoading
          iconCreateFunction={createClusterCustomIcon}
          maxClusterRadius={50}
          showCoverageOnHover={false}
        >
          {(pois || []).map((poi, index) => {
            const lat = poi?.lat;
            const lon = poi?.lon ?? poi?.lng;
            if (lat == null || lon == null || typeof lat !== 'number' || typeof lon !== 'number') return null;
            const key = poi?.id ?? `poi-${index}`;
            return (
              <Marker
                key={key}
                position={[lat, lon]}
                icon={createPoiIcon(poi?.categoryId)}
              >
                <Popup minWidth={200} maxWidth={240}>
                  <PoiPopup poi={poi} />
                </Popup>
              </Marker>
            );
          })}
        </MarkerClusterGroup>

        {/* Подключаем менеджер загрузки POI последним — должен быть внутри MapContainer */}
        <PoiManager />
      </MapContainer>

      {/* Плавающие панели поверх карты (в readOnly скрываем тулбар — только просмотр) */}
      {!readOnly && <MapToolbar />}

      {/* Единый вертикальный контроллер: Слои и Места; высокий z-index чтобы панель была поверх кнопок и сайдбара */}
      <div className="absolute top-4 right-4 z-[1100] flex w-64 flex-col gap-2 overflow-visible">
        <MapLayersControl
          expandedSection={expandedSection}
          onToggle={setExpandedSection}
        />
        {/* Обёртка relative + min-h: резервирует место под кнопку, PlacesMenu (absolute) не сжимается */}
        <div className="relative min-h-10 shrink-0">
          <PlacesMenu
            expandedSection={expandedSection}
            onToggle={setExpandedSection}
          />
        </div>
      </div>

      {/*
       * Подсказка «Приблизьте карту» — показывается только если:
       *  1. Включена хотя бы одна POI-категория (пользователь ждёт маркеров)
       *  2. Текущий зум ниже MIN_POI_ZOOM (слишком мелко для запроса к Overpass)
       *
       * pointer-events-none — не перехватывает клики, карта остаётся управляемой.
       * transition-opacity — плавное появление/исчезновение при изменении зума.
       */}
      {activePoiCategories.length > 0 && isZoomTooLow && (
        <div className="pointer-events-none absolute left-1/2 top-6 z-[2000] flex -translate-x-1/2 items-center gap-2 rounded-full border border-gray-200 bg-white/90 px-4 py-2 text-sm font-medium text-gray-700 shadow-lg backdrop-blur-sm transition-opacity duration-300">
          <ZoomIn className="h-4 w-4 shrink-0 text-blue-500" />
          <span>Приблизьте карту, чтобы загрузить больше мест</span>
        </div>
      )}

      {/*
       * Стек уведомлений POI — общий контейнер управляет позицией,
       * внутренние плашки просто стекаются вниз через flex-col + gap-2.
       *  top-6  — подсказка зума (синяя, ZoomIn) — отдельно, вне стека
       *  top-16 — этот стек: долгая загрузка и/или лимит точек
       */}
      <div className="pointer-events-none absolute left-1/2 top-16 z-[2000] flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2">
        {isSlowLoading && activePoiCategories.length > 0 && (
          <div className="flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-800 shadow-lg transition-all">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span>Много мест для загрузки. Пожалуйста, подождите...</span>
          </div>
        )}

        {poiLimitReached && activePoiCategories.length > 0 && (
          <div className="flex items-center gap-2 rounded-full border border-orange-300 bg-orange-100 px-4 py-2 text-sm font-medium text-orange-800 shadow-lg transition-all">
            <span>⚠️ Показано 300 мест. Приблизьте карту, чтобы увидеть остальные.</span>
          </div>
        )}
      </div>

      {lightboxOpen && (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}
