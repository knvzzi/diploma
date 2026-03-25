import { create } from 'zustand';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import useAuthStore from '@/store/useAuthStore';
import { POI_CATEGORIES } from '@/config/poiConfig';

/**
 * Палитра цветов для дней многодневного маршрута.
 * Цвета циклически присваиваются новым дням через addTripDay.
 */
export const DAY_COLORS = [
  '#ef4444', // красный
  '#3b82f6', // синий
  '#10b981', // зелёный
  '#f59e0b', // жёлто-янтарный
  '#8b5cf6', // фиолетовый
  '#ec4899', // розовый
];

/**
 * Конфигурация базовых слоёв карты (CartoDB, Esri Topo, Esri Satellite).
 */
export const MAP_LAYERS = {
  standard: {
    id: 'standard',
    name: 'Стандартная',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
      '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  },
  topo: {
    id: 'topo',
    name: 'Топографическая',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19,
  },
  satellite: {
    id: 'satellite',
    name: 'Спутник',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    maxZoom: 18,
  },
};

/**
 * Профили маршрутизации.
 *
 * ── Поля ──────────────────────────────────────────────────────────────────────
 *
 *  value        — уникальный идентификатор профиля в нашем приложении.
 *                 Хранится в каждом отрезке (поле `profile`), никогда не меняется.
 *
 *  orsProfile   — техническая строка для URL ORS API
 *                 (/v2/directions/{orsProfile}/geojson).
 *                 null для профилей, которые не используют ORS (alwaysDirect: true).
 *
 *  extraBody    — дополнительные параметры POST-запроса к ORS.
 *
 *  alwaysDirect — если true: отрезки строятся всегда по прямой (Haversine),
 *                 ORS не вызывается. Скорость берётся из PROFILE_SPEEDS_KMH.
 *                 Используется для режима «напрямик».
 *                 При выборе такого профиля routingMode автоматически → 'direct'.
 *
 *  label        — название в UI.
 *  subtitle     — пояснение в дропдауне.
 *  emoji        — иконка в кнопке тулбара.
 *  group        — группа: 'foot' | 'cycling' | 'other'.
 */
export const ROUTING_PROFILES = [
  // ── Пешком и бегом ──────────────────────────────────────────────────────────
  {
    value:      'foot-hiking',
    orsProfile: 'foot-hiking',
    label:      'Пешком',
    subtitle:   'Походы и прогулки.',
    emoji:      '🚶',
    group:      'foot',
  },
  {
    value:      'foot-walking',
    orsProfile: 'foot-walking',
    label:      'Бегом',
    subtitle:   'Трейл и город. Старается избегать песок и лестницы.',
    emoji:      '🏃',
    group:      'foot',
  },
  // ── На велосипеде ────────────────────────────────────────────────────────────
  {
    value:      'cycling-regular',
    orsProfile: 'cycling-regular',
    label:      'Город',
    subtitle:   'Велодорожки, тротуары и асфальт.',
    emoji:      '🚲',
    group:      'cycling',
  },
  {
    value:      'cycling-road',
    orsProfile: 'cycling-road',
    label:      'Шоссе',
    subtitle:   'Асфальтовые дороги. Старается избегать магистралей.',
    emoji:      '🚴',
    group:      'cycling',
  },
  {
    value:      'cycling-gravel',
    orsProfile: 'cycling-regular',
    extraBody:  { preference: 'recommended' },
    label:      'Гравий и грунт',
    subtitle:   'Гравийки и грунтовки, без жёсткого бездорожья.',
    emoji:      '🪨',
    group:      'cycling',
  },
  {
    value:      'cycling-mountain',
    orsProfile: 'cycling-mountain',
    label:      'Лесные дороги и бездорожье',
    subtitle:   'Лесные дороги и тропы. Допускает сложные покрытия (песок, грязь и т.д.).',
    emoji:      '🚵',
    group:      'cycling',
  },
  // ── Другое ──────────────────────────────────────────────────────────────────
  {
    value:      'driving-car',
    orsProfile: 'driving-car',
    label:      'Авто',
    subtitle:   'Автодороги.',
    emoji:      '🚗',
    group:      'other',
  },
  {
    value:        'direct-straight',
    orsProfile:   null,
    alwaysDirect: true,
    label:        'Напрямик',
    subtitle:     'Прямые линии между точками вне дорог.',
    emoji:        '↗️',
    group:        'other',
  },
];

// ─── Уровень модуля: не реактивное состояние ─────────────────────────────────

/**
 * Версионные счётчики на отрезок.
 * Ключ: `${fromPointId}_${toPointId}`, значение: число (версия запроса).
 *
 * Алгоритм: перед каждым ORS-запросом инкрементируем версию.
 * Когда ответ приходит, проверяем что версия не устарела.
 * Это позволяет безопасно игнорировать ответы от перетянутых/удалённых отрезков.
 */
const segmentVersions = {};

/** Счётчик незавершённых запросов на сборку отрезков (глобальный) */
let pendingCount = 0;

/**
 * Монотонно растущий счётчик запросов к Overpass API.
 * Позволяет игнорировать устаревшие ответы при быстром перемещении карты:
 * перед отправкой запроса снимаем «снимок» версии — если к моменту ответа
 * версия успела вырасти, ответ уже не актуален и мы его выбрасываем.
 */
let poiFetchVersion = 0;

/**
 * Жёсткий лимит на количество POI из одного запроса к Overpass.
 * 300 маркеров — достаточно для навигации, React рендерит их без заметных зависаний.
 */
const MAX_POIS = 300;

/**
 * Максимальный размер накопленного кеша pois.
 * При превышении оставляем 300 самых последних (свежих) элементов.
 */
const MAX_TOTAL_POIS = 300;

/**
 * Официальные зеркала Overpass API, перебираются по порядку (failover).
 * При 429 или сетевой ошибке переходим к следующему — пользователь не видит ошибок.
 */
const OVERPASS_ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Проверяет, соответствует ли набор тегов OSM-элемента условию Overpass QL.
 *
 * Поддерживаемые операторы (покрывают все запросы из poiConfig.js):
 *   =  — точное совпадение значения
 *   ~  — проверка через RegExp (Overpass использует ERE)
 *
 * @param {object} tags     — теги OSM-элемента (из data.elements[n].tags)
 * @param {string} queryStr — фрагмент Overpass QL, например '["amenity"="drinking_water"]'
 * @returns {boolean}
 */
function matchesPOIQuery(tags, queryStr) {
  const match = queryStr.match(/\["(.+?)"([=~])"(.+?)"\]/);
  if (!match) return false;
  const [, key, op, value] = match;
  if (!tags || !(key in tags)) return false;
  if (op === '=') return tags[key] === value;
  if (op === '~') return new RegExp(value).test(tags[key]);
  return false;
}

const getOrsUrl = (profile) =>
  `https://api.openrouteservice.org/v2/directions/${profile}/geojson`;

const ORS_ELEVATION_URL = 'https://api.openrouteservice.org/v2/elevation/line';

/**
 * Запрашивает высоты точек вдоль линии через ORS Elevation API.
 * Используется для запроса высот вдоль линии (например, для прямых отрезков).
 *
 * @param {Array<[number, number]>} path — массив [lat, lng]
 * @returns {Promise<Array<{ distance: number, elevation: number, lat: number, lng: number }>>}
 */
async function fetchElevationForPath(path) {
  if (!path?.length) return [];
  const apiKey = import.meta.env.VITE_ORS_API_KEY;
  if (!apiKey) return [];

  const coordinates = path.map(([lat, lng]) => [lng, lat]);
  const res = await fetch(ORS_ELEVATION_URL, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json, application/geo+json',
    },
    body: JSON.stringify({
      format_in:  'geojson',
      format_out: 'geojson',
      geometry:   { type: 'LineString', coordinates },
    }),
  });
  if (!res.ok) return [];

  const data = await res.json();
  const coords = data.geometry?.coordinates ?? data.features?.[0]?.geometry?.coordinates;
  if (!coords?.length) return [];

  let cumDistM = 0;
  const elevationPoints = [];
  const step = Math.max(1, Math.ceil(coords.length / 150));
  for (let i = 0; i < coords.length; i++) {
    const [lng, lat, ele] = coords[i].length >= 3 ? coords[i] : [...coords[i], 0];
    if (i > 0) {
      const [plng, plat] = coords[i - 1];
      cumDistM += haversineDistance(plat, plng, lat, lng);
    }
    if (i % step === 0 || i === coords.length - 1) {
      elevationPoints.push({
        distance:  Math.round((cumDistM / 1000) * 10) / 10,
        elevation: Math.round(Number(ele) || 0),
        lat,
        lng,
      });
    }
  }
  return elevationPoints;
}

/**
 * Маппинг числовых идентификаторов покрытия ORS на 3 категории.
 *
 * Источник: https://giscience.github.io/openrouteservice/documentation/extra-info/Surface
 * В GeoJSON-ответе значения лежат в properties.extras.surface.values[n][2].
 *
 *  0          — нет данных
 *  1          — paved    (общий «твёрдое»)
 *  2          — unpaved  (общий «мягкое»)
 *  3–6        — paved    (asphalt, concrete, cobblestone, metal)
 *  7–12       — unpaved  (wood, compacted_gravel, fine_gravel, gravel, dirt, ground)
 *  13         — unknown  (ice — не дорога)
 *  14         — paved    (paving_stones)
 *  15–17      — unpaved  (sand, woodchips, grass)
 *  18         — paved    (grass_paver — структурированное)
 */
const SURFACE_CATEGORY_MAP = {
  0:  'unknown', // Unknown / нет данных
  1:  'paved',   // Paved (общее)
  2:  'unpaved', // Unpaved (общее)
  3:  'paved',   // Asphalt
  4:  'paved',   // Concrete
  5:  'paved',   // Cobblestone
  6:  'paved',   // Metal
  7:  'unpaved', // Wood
  8:  'unpaved', // Compacted gravel
  9:  'unpaved', // Fine gravel
  10: 'unpaved', // Gravel
  11: 'unpaved', // Dirt
  12: 'unpaved', // Ground
  13: 'unknown', // Ice
  14: 'paved',   // Paving stones
  15: 'unpaved', // Sand
  16: 'unpaved', // Woodchips
  17: 'unpaved', // Grass
  18: 'paved',   // Grass paver
};

/**
 * Средние скорости по профилю (км/ч).
 * Используются для расчёта `duration` в direct-отрезках,
 * где ORS не вызывается, но время всё равно нужно отобразить.
 *
 * Значения — реалистичные средние для каждого типа передвижения:
 *  foot-hiking      — 4.0  (прогулка/поход по тропам)
 *  foot-walking     — 8.0  (лёгкий бег, трейл)
 *  cycling-regular  — 18   (городской велосипед)
 *  cycling-road     — 25   (шоссейник, асфальт)
 *  cycling-gravel   — 12   (гравийный велосипед)
 *  cycling-mountain — 10   (МТБ, бездорожье)
 *  driving-car      — 60   (смешанный городской/загородный трафик)
 */
const PROFILE_SPEEDS_KMH = {
  'foot-hiking':      4.0,   // поход с рюкзаком
  'foot-walking':     8.0,   // лёгкий бег
  'cycling-regular':  18,    // городской велосипед
  'cycling-road':     25,    // шоссейник
  'cycling-gravel':   12,    // гравийный
  'cycling-mountain': 10,    // МТБ / бездорожье
  'driving-car':      60,    // автомобиль
  'direct-straight':   5,    // напрямик — пешая скорость по умолчанию
};

/**
 * Форматирует продолжительность маршрута в секундах в читаемую строку.
 * Используется как в сторе (console.log), так и в UI.
 *
 * @param {number|null} seconds
 * @returns {string|null}
 */
export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `~${m} мин`;
  if (m === 0) return `~${h} ч`;
  return `~${h}ч ${m}м`;
}

// ─── Чистые функции (вне стора) ───────────────────────────────────────────────

/**
 * Расстояние между двумя точками по формуле Гаверсинуса (в метрах).
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Суммарная длина пути в км по массиву координат [[lat, lng], ...].
 * Используется при загрузке маршрута из API (loadRouteFromDetails).
 */
function pathDistanceKm(path) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  let meters = 0;
  for (let i = 1; i < path.length; i++) {
    const [lat1, lng1] = path[i - 1];
    const [lat2, lng2] = path[i];
    meters += haversineDistance(lat1, lng1, lat2, lng2);
  }
  return Math.round(meters / 10) / 100; // км, 2 знака
}

/**
 * Вставляет или обновляет отрезок в массиве отрезков.
 * Идентификатор отрезка — пара (fromPointId, toPointId).
 */
function upsertSegment(segments, newSeg) {
  const idx = segments.findIndex(
    (s) => s.fromPointId === newSeg.fromPointId && s.toPointId === newSeg.toPointId,
  );
  if (idx >= 0) return segments.map((s, i) => (i === idx ? newSeg : s));
  return [...segments, newSeg];
}

/**
 * Вычисляет производные значения из массива отрезков.
 *
 * Возвращает:
 *  routePath     — объединённый массив [[lat, lng], ...] для Polyline
 *  totalDistance — суммарная дистанция в км (1 знак после запятой)
 *  totalDuration — суммарное время в секундах (целое число)
 *  elevationData — профиль высот с накопленными дистанциями
 *
 * Отрезки упорядочиваются по routePoints перед суммированием,
 * потому что upsertSegment может добавить отрезок в произвольное место.
 *
 * ── Отладочный лог ────────────────────────────────────────────────────────
 * console.group показывает разбивку каждого отрезка + итоговые значения.
 * Помогает убедиться, что расстояния и время корректны для каждого участка.
 *
 * @param {{ id: number }[]} routePoints
 * @param {object[]} segments
 * @param {{ id: string, color: string }[]} tripDays — список дней (для проставки dayColor)
 */
function computeDerived(routePoints, segments, tripDays = []) {
  // Упорядоченный список отрезков: только те, для которых есть запись (соседние точки в routePoints).
  // Между днями отрезка может не быть — разрывы допустимы (переезды). Геометрию не пересчитываем.
  const orderedSegs = [];
  for (let i = 0; i < routePoints.length - 1; i++) {
    const seg = segments.find(
      (s) => s.fromPointId === routePoints[i].id && s.toPointId === routePoints[i + 1].id,
    );
    if (seg) orderedSegs.push(seg);
  }

  // Глобальная линия — простая конкатенация path каждого отрезка (без вызовов API и без «склейки» разрывов)
  const routePath = orderedSegs.flatMap((s) => s.path);

  // totalDistance: сумма distance каждого отрезка, 1 знак после запятой
  const totalDistance = Math.round(
    orderedSegs.reduce((sum, s) => sum + s.distance, 0) * 10,
  ) / 10;

  // totalDuration: сумма duration (секунды) каждого отрезка
  const totalDuration = Math.round(
    orderedSegs.reduce((sum, s) => sum + s.duration, 0),
  );

  // Быстрый справочник dayId → объект дня (name, color) для обогащения высотных точек
  const dayMap = new Map(tripDays.map((d) => [d.id, d]));

  // Объединяем данные высот с корректными накопленными дистанциями.
  // К каждой точке добавляем tripDayId / dayName / dayColor — это используется
  // в ElevationProfile для визуального разделения графика по дням (ReferenceLine + тултип).
  let distOffset = 0;
  const elevationData = [];
  for (const seg of orderedSegs) {
    // Определяем день по конечной точке отрезка (toPointId → tripDayId)
    const toPoint  = routePoints.find((p) => p.id === seg.toPointId);
    const dayId    = toPoint?.tripDayId ?? 'day-1';
    const day      = dayMap.get(dayId);
    const dayColor = day?.color ?? '#3b82f6';
    const dayName  = day?.name  ?? 'День 1';

    for (const pt of seg.elevationPoints) {
      // lat / lng прописываем явно — не полагаемся только на ...pt,
      // чтобы координаты гарантированно присутствовали в финальном объекте.
      elevationData.push({
        ...pt,
        distance:  Math.round((pt.distance + distOffset) * 10) / 10,
        lat:       pt.lat,
        lng:       pt.lng,
        tripDayId: dayId,
        dayName,
        dayColor,
      });
    }
    distOffset += seg.distance;
  }

  // ── Статистика покрытия дороги ───────────────────────────────────────────
  //
  // Категории: 'paved' / 'unpaved' / 'unknown'.
  // Direct-отрезки — unknown; ORS-отрезки — по surfaceData.
  //
  const surfaceDistM = { paved: 0, unpaved: 0, unknown: 0 };

  for (const seg of orderedSegs) {
    if (!seg.surfaceData?.length || seg.method === 'direct') {
      surfaceDistM.unknown += seg.distance * 1000;
      continue;
    }
    // surfaceData = [[startIdx, endIdx, surfaceId], ...]
    for (const [startIdx, endIdx, surfaceId] of seg.surfaceData) {
      const category = SURFACE_CATEGORY_MAP[surfaceId] ?? 'unknown';
      for (let i = startIdx; i < endIdx && i + 1 < seg.path.length; i++) {
        const [lat1, lng1] = seg.path[i];
        const [lat2, lng2] = seg.path[i + 1];
        surfaceDistM[category] += haversineDistance(lat1, lng1, lat2, lng2);
      }
    }
  }

  const totalSurfaceM = surfaceDistM.paved + surfaceDistM.unpaved + surfaceDistM.unknown;
  const toStat = (distM) => ({
    distKm: Math.round((distM / 1000) * 10) / 10,
    pct:    totalSurfaceM > 0 ? Math.round((distM / totalSurfaceM) * 100) : 0,
  });
  const surfaceStats = {
    paved:   toStat(surfaceDistM.paved),
    unpaved: toStat(surfaceDistM.unpaved),
    unknown: toStat(surfaceDistM.unknown),
  };

  // ── Статистика по дням + цвет отрезка ───────────────────────────────────
  //
  // Для каждого упорядоченного отрезка смотрим на его конечную точку (toPointId),
  // берём из неё tripDayId, находим соответствующий день в tripDays и:
  //  — суммируем distance/duration в tripDaysStats
  //  — записываем seg.dayColor (используется в RouteMap для окраски линии)
  //
  // Фолбэк: если день не найден (старые данные без tripDayId) → синий #3b82f6.
  const tripDaysStats = {};

  for (const seg of orderedSegs) {
    const toPoint = routePoints.find((p) => p.id === seg.toPointId);
    const dayId   = toPoint?.tripDayId ?? 'day-1';
    const day     = tripDays.find((d) => d.id === dayId);

    // Проставляем цвет и ID дня прямо в объект отрезка — RouteMap читает при рендеринге
    seg.dayColor  = day?.color ?? '#3b82f6';
    seg.tripDayId = dayId;

    if (!tripDaysStats[dayId]) {
      tripDaysStats[dayId] = { distance: 0, duration: 0 };
    }
    tripDaysStats[dayId].distance =
      Math.round((tripDaysStats[dayId].distance + seg.distance) * 10) / 10;
    tripDaysStats[dayId].duration += seg.duration;
  }

  // Округляем duration каждого дня до целых секунд
  for (const dayId of Object.keys(tripDaysStats)) {
    tripDaysStats[dayId].duration = Math.round(tripDaysStats[dayId].duration);
  }

  // ── Отладочный лог в консоль разработчика ────────────────────────────────
  if (orderedSegs.length > 0) {
    console.group('[Route] Пересчёт итогов маршрута');
    orderedSegs.forEach((s, i) => {
      const dMin = Math.round(s.duration / 60);
      const dH   = Math.floor(s.duration / 3600);
      const dM   = Math.round((s.duration % 3600) / 60);
      const timeStr = dH > 0 ? `${dH}ч ${dM}мин` : `${dMin}мин`;
      console.log(
        `  Отрезок ${i + 1}: профиль="${s.profile}", метод="${s.method}", ` +
        `расстояние=${s.distance.toFixed(1)}км, время=${timeStr} (${Math.round(s.duration)}сек)`,
      );
    });
    const totH = Math.floor(totalDuration / 3600);
    const totM = Math.round((totalDuration % 3600) / 60);
    console.log(
      `  ► ИТОГО: ${totalDistance.toFixed(1)} км | ` +
      `${totH > 0 ? totH + 'ч ' : ''}${totM}мин (${totalDuration} сек)`,
    );
    console.log(
      `  ► ПОКРЫТИЕ: асфальт=${surfaceStats.paved.distKm}км (${surfaceStats.paved.pct}%), ` +
      `грунт=${surfaceStats.unpaved.distKm}км (${surfaceStats.unpaved.pct}%), ` +
      `неизв.=${surfaceStats.unknown.distKm}км (${surfaceStats.unknown.pct}%)`,
    );
    console.groupEnd();
  }

  return { routePath, totalDistance, totalDuration, elevationData, surfaceStats, tripDaysStats };
}

/**
 * Zustand-стор для управления данными маршрута.
 *
 * ── Ключевая архитектура: маршрут по отрезкам (segments) ───────────────────────
 *
 * Маршрут хранится как набор ОТРЕЗКОВ между последовательными routePoints.
 * Каждый отрезок знает свой профиль (profile) — ORS или 'direct'.
 * При смене режима/профиля существующие отрезки НЕ пересчитываются:
 * новый режим применяется только к следующему добавленному отрезку.
 *
 * Это позволяет строить мультиспортивные маршруты:
 *   [пешком] → [велосипед] → [авто] — каждый участок со своей прокладкой.
 *
 * ── Типы точек ────────────────────────────────────────────────────────────────
 *
 * routePoints  [{id, lat, lng}]
 *   Технические точки для построения маршрута (чёрные кружки на карте).
 *   Перетаскиваемые: dragend пересчитывает только смежные отрезки.
 *
 * labels  [{id, lat, lng, name, description, imageUrls, color, icon}]
 *   Смысловые метки (режим 'label'). Перетаскиваемые, не влияют на маршрут.
 *
 * ── Отрезки (segments) ────────────────────────────────────────────────────────
 *
 * segments  [{fromPointId, toPointId, profile, method, path, distance, duration, elevationPoints}]
 *   Один отрезок = один участок между двумя соседними routePoints.
 *   profile  — ORS-профиль ('foot-walking', …), заморожен при создании.
 *   method   — 'direct' (Haversine) | 'ors' (через API), заморожен при создании.
 *   distance — км, 1 знак после запятой.
 *   duration — секунды (целые): от ORS или Haversine+PROFILE_SPEEDS_KMH.
 *   path — [[lat, lng], ...] для Polyline на карте.
 *   elevationPoints — прорежённые данные высот для ElevationProfile.
 *
 * routePath, totalDistance, elevationData — производные (вычисляются из segments
 * через computeDerived и сохраняются в стор для потребителей без мемоизации).
 */
const useRouteStore = create((set, get) => ({

  // ─── Точки и отрезки ───────────────────────────────────────────────────
  routePoints: [],
  labels:      [],
  segments:    [],

  // ─── Дни поездки (tripDays) ───────────────────────────────────────────
  /**
   * Список дней маршрута (поездка по дням).
   * Каждый день: { id, name, color }.
   * По умолчанию один день — «День 1» с первым цветом палитры.
   */
  tripDays: [{ id: 'day-1', name: 'День 1', color: DAY_COLORS[0] }],

  /** ID активного дня. Новые routePoints получают этот tripDayId. */
  activeDayId: 'day-1',

  /**
   * Статистика по каждому дню (вычисляется в computeDerived).
   * Ключ — id дня, значение — { distance: км, duration: сек }.
   * Пример: { 'day-1': { distance: 12.3, duration: 7200 } }
   */
  tripDaysStats: {},

  // ─── Режим/профиль построения ─────────────────────────────────────────────
  /** 'auto' | 'direct' | 'label' */
  routingMode:    'auto',
  /** ORS профиль: 'foot-hiking' | 'foot-walking' | 'cycling-road' | … */
  routingProfile: 'foot-hiking',

  // ─── Производные от segments (вычисляются через computeDerived) ──────────
  routePath:     [],
  totalDistance: 0,
  /** Суммарное время прохождения маршрута в секундах. 0 = маршрут не построен. */
  totalDuration: 0,
  elevationData: [],
  /**
   * Статистика покрытия дороги по всему маршруту.
   * Вычисляется в computeDerived на основе surfaceData каждого отрезка.
   * { paved, unpaved, unknown } → { distKm: number, pct: number }
   */
  surfaceStats: {
    paved:   { distKm: 0, pct: 0 },
    unpaved: { distKm: 0, pct: 0 },
    unknown: { distKm: 0, pct: 0 },
  },

  // ─── Прочее ───────────────────────────────────────────────────────────────
  activeLayer:           'standard',
  isLoadingRoute:        false,
  hoveredElevationPoint: null,
  isSaving:              false,
  /** Включена ли раскраска маршрута по типу покрытия на карте. */
  showSurfaceOnMap:      true,

  /**
   * Список ID активных категорий POI (интересных мест), отображаемых на карте.
   * Пример: ['water', 'cafe'] — показывать источники воды и кафе.
   * Управляется тумблерами в панели PlacesMenu.
   */
  activePoiCategories: [],

  /** Загруженные объекты POI из Overpass API для текущей области карты. */
  pois: [],

  /** true пока выполняется запрос к Overpass API. */
  isLoadingPois: false,

  /**
   * true, если текущий зум карты ниже MIN_POI_ZOOM.
   * Используется для отображения подсказки «Приблизьте карту» поверх карты.
   * Управляется из PoiManager через setIsZoomTooLow.
   */
  isZoomTooLow: false,

  /**
   * true, если последний запрос вернул больше MAX_POIS результатов и массив
   * был принудительно обрезан. Показывает оранжевое предупреждение на карте.
   */
  poiLimitReached: false,

  /**
   * true, если текущий запрос к Overpass длится дольше 3 секунд.
   * Включается отложенным таймером внутри fetchPois и сбрасывается при завершении.
   * Показывает синюю плашку-успокоение «карта не зависла, просто много данных».
   */
  isSlowLoading: false,

  /**
   * Монотонно растущая метка времени (Date.now()), обновляемая при каждом
   * успешном получении POI. Используется как key у <MarkerClusterGroup>:
   * смена key форсирует полный реMount кластера и обходит баг ленивой
   * перерисовки react-leaflet-cluster после асинхронной загрузки.
   */
  poiUpdateTrigger: 0,

  // ─── Управление режимом/профилем ──────────────────────────────────────────

  /**
   * Переключает активный режим (auto/direct/label).
   * НЕ пересчитывает существующие отрезки — новый режим применяется
   * только к следующей добавленной точке.
   */
  setRoutingMode: (mode) => set({ routingMode: mode }),

  /**
   * Меняет активный профиль и автоматически устанавливает routingMode:
   *  — 'direct', если у профиля alwaysDirect: true (напрямик).
   *  — 'auto'   во всех остальных случаях.
   * Существующие отрезки не пересчитываются.
   */
  setRoutingProfile: (profile) => {
    const profileObj = ROUTING_PROFILES.find((p) => p.value === profile);
    const nextMode  = profileObj?.alwaysDirect ? 'direct' : 'auto';
    set({
      routingProfile: profile,
      routingMode:    nextMode,
    });
  },

  // ─── Управление днями поездки и отрезками маршрута ────────────────────────

  /**
   * Создаёт новый день маршрута, присваивает ему следующий цвет из палитры
   * и делает его активным (новые точки будут добавляться в этот день).
   */
  addTripDay: () => {
    const { tripDays } = get();
    const newDay = {
      id:    `day-${Date.now()}`,
      name:  `День ${tripDays.length + 1}`,
      color: DAY_COLORS[tripDays.length % DAY_COLORS.length],
    };
    set((state) => ({
      tripDays:    [...state.tripDays, newDay],
      activeDayId: newDay.id,
    }));
  },

  /** Делает указанный день активным (новые точки добавляются в него). */
  setActiveDayId: (id) => set({ activeDayId: id }),

  // ─── Технические точки маршрута ───────────────────────────────────────────

  /**
   * Добавляет точку в активный день и строит один новый отрезок.
   * Точка вставляется в конец текущего активного дня (после последней точки этого дня),
   * а не в конец всего маршрута — так не возникает разрыва при добавлении в «День 2» и т.д.
   * Отрезок строится от последней точки активного дня до новой точки (API/прямая линия).
   *
   * @param {{ lat: number, lng: number }} latlng
   */
  addRoutePoint: (latlng) => {
    const { routePoints, segments, routingMode, routingProfile, activeDayId, tripDays } = get();
    const newPoint = { id: Date.now(), lat: latlng.lat, lng: latlng.lng, tripDayId: activeDayId };

    // Индекс вставки: после последней точки активного дня (чтобы новая точка цеплялась к концу этого дня)
    let insertIdx = -1;
    for (let i = routePoints.length - 1; i >= 0; i--) {
      if (routePoints[i].tripDayId === activeDayId) {
        insertIdx = i + 1;
        break;
      }
    }
    if (insertIdx < 0) {
      const activeDayIndex = tripDays.findIndex((d) => d.id === activeDayId);
      if (activeDayIndex <= 0) {
        insertIdx = 0;
      } else {
        const prevDayId = tripDays[activeDayIndex - 1].id;
        for (let i = routePoints.length - 1; i >= 0; i--) {
          if (routePoints[i].tripDayId === prevDayId) {
            insertIdx = i + 1;
            break;
          }
        }
        if (insertIdx < 0) insertIdx = routePoints.length;
      }
    }

    const newRoutePoints = [
      ...routePoints.slice(0, insertIdx),
      newPoint,
      ...routePoints.slice(insertIdx),
    ];

    const prevPoint = insertIdx > 0 ? newRoutePoints[insertIdx - 1] : null;
    const nextPoint = insertIdx < routePoints.length ? newRoutePoints[insertIdx + 1] : null;
    const isInsertInMiddle = prevPoint && nextPoint;

    // При вставке в середину удаляем один отрезок (prev→next). Остальные отрезки не трогаем.
    const newSegments = isInsertInMiddle
      ? segments.filter(
          (s) => !(s.fromPointId === prevPoint.id && s.toPointId === nextPoint.id),
        )
      : segments;

    set({
      routePoints: newRoutePoints,
      segments:    newSegments,
      ...computeDerived(newRoutePoints, newSegments, tripDays),
    });

    const profileObj = ROUTING_PROFILES.find((p) => p.value === routingProfile);
    const method = (routingMode === 'direct' || profileObj?.alwaysDirect) ? 'direct' : 'ors';
    const removedSeg = isInsertInMiddle
      ? segments.find((s) => s.fromPointId === prevPoint.id && s.toPointId === nextPoint.id)
      : null;
    const segProfile = removedSeg?.profile ?? routingProfile;
    const segMethod  = removedSeg?.method ?? method;

    // Отрезки независимы: API маршрутизации вызываем СТРОКО для пар точек внутри ОДНОГО дня.
    // Не строим путь между концом Дня 1 и началом Дня 2 (разрыв для переезда и т.п.).
    const prevInSameDay = prevPoint && prevPoint.tripDayId === activeDayId;
    const nextInSameDay = nextPoint && nextPoint.tripDayId === activeDayId;

    if (prevInSameDay) {
      get().buildSegment(prevPoint, newPoint, routingProfile, method);
    }
    if (nextInSameDay) {
      get().buildSegment(newPoint, nextPoint, segProfile, segMethod);
    }
  },

  /**
   * Удаляет точку и все смежные с ней отрезки.
   * Если точка была посередине — строит новый «мостовой» отрезок
   * между соседями (с профилем удалённого правого отрезка).
   *
   * @param {number} id
   */
  removeRoutePoint: (id) => {
    const { routePoints, segments, tripDays } = get();
    const index = routePoints.findIndex((p) => p.id === id);
    if (index === -1) return;

    const prevPoint = index > 0 ? routePoints[index - 1] : null;
    const nextPoint = index < routePoints.length - 1 ? routePoints[index + 1] : null;

    // Профиль и метод мостового отрезка — берём у правого удалённого отрезка
    const removedRightSeg = segments.find((s) => s.fromPointId === id);
    const bridgeProfile   = removedRightSeg?.profile ?? get().routingProfile;
    const bridgeMethod    = removedRightSeg?.method  ?? 'ors';

    // Инвалидируем версии удалённых отрезков
    const removedSegs = segments.filter((s) => s.fromPointId === id || s.toPointId === id);
    removedSegs.forEach((s) => {
      const key = `${s.fromPointId}_${s.toPointId}`;
      segmentVersions[key] = (segmentVersions[key] ?? 0) + 1;
    });

    const newPoints   = routePoints.filter((p) => p.id !== id);
    const newSegments = segments.filter((s) => s.fromPointId !== id && s.toPointId !== id);

    set({
      routePoints: newPoints,
      segments:    newSegments,
      ...computeDerived(newPoints, newSegments, tripDays),
    });

    /**
     * Мостовой отрезок строится только если оба соседа принадлежат одному дню.
     * Если удалённая точка была на границе дней — мост между разными днями
     * не создаётся, и каждый день остаётся самостоятельным отрезком.
     */
    if (prevPoint && nextPoint && prevPoint.tripDayId === nextPoint.tripDayId) {
      get().buildSegment(prevPoint, nextPoint, bridgeProfile, bridgeMethod);
    }
  },

  /**
   * Обрабатывает dragend технической точки.
   * Обновляет координаты и пересчитывает только смежные отрезки.
   *
   * @param {number} id
   * @param {{ lat: number, lng: number }} newLatlng
   */
  dragRoutePoint: (id, newLatlng) => {
    const { routePoints, segments } = get();

    const updatedPoints = routePoints.map((p) =>
      p.id === id ? { ...p, lat: newLatlng.lat, lng: newLatlng.lng } : p,
    );
    set({ routePoints: updatedPoints });

    const draggedPoint = { id, lat: newLatlng.lat, lng: newLatlng.lng };
    const affectedSegs = segments.filter(
      (s) => s.fromPointId === id || s.toPointId === id,
    );

    for (const seg of affectedSegs) {
      const fromPt =
        seg.fromPointId === id
          ? draggedPoint
          : updatedPoints.find((p) => p.id === seg.fromPointId);
      const toPt =
        seg.toPointId === id
          ? draggedPoint
          : updatedPoints.find((p) => p.id === seg.toPointId);

      if (fromPt && toPt) {
        // Пересчитываем тем же методом и профилем, что были заморожены в отрезке
        get().buildSegment(fromPt, toPt, seg.profile, seg.method);
      }
    }
  },

  // ─── Смысловые метки ──────────────────────────────────────────────────────

  /**
   * Добавляет смысловую метку с пустыми метаданными.
   * Метка независима от маршрута.
   */
  addLabel: (latlng) => {
    set((state) => ({
      labels: [
        ...state.labels,
        {
          id:          Date.now(),
          lat:         latlng.lat,
          lng:         latlng.lng,
          name:        '',
          description: '',
          imageUrls:   [],
          color:       '#3b82f6',
          icon:        'map-pin',
        },
      ],
    }));
  },

  removeLabel: (id) =>
    set((state) => ({ labels: state.labels.filter((l) => l.id !== id) })),

  updateLabelMeta: (id, meta) =>
    set((state) => ({
      labels: state.labels.map((l) => (l.id === id ? { ...l, ...meta } : l)),
    })),

  /**
   * Обрабатывает dragend смысловой метки.
   * Просто обновляет координаты — маршрут не затрагивается.
   */
  dragLabel: (id, newLatlng) => {
    set((state) => ({
      labels: state.labels.map((l) =>
        l.id === id ? { ...l, lat: newLatlng.lat, lng: newLatlng.lng } : l,
      ),
    }));
  },

  // ─── Сброс всего ──────────────────────────────────────────────────────────

  /**
   * Полностью сбрасывает маршрут: точки, метки, отрезки, данные высот.
   * Инвалидирует все versioned-запросы через сброс счётчиков.
   */
  clearAll: () => {
    Object.keys(segmentVersions).forEach((k) => delete segmentVersions[k]);
    pendingCount = 0;
    set({
      routePoints:           [],
      labels:                [],
      segments:              [],
      routePath:             [],
      totalDistance:         0,
      totalDuration:         0,
      elevationData:         [],
      surfaceStats: {
        paved:   { distKm: 0, pct: 0 },
        unpaved: { distKm: 0, pct: 0 },
        unknown: { distKm: 0, pct: 0 },
      },
      // Сброс дней — возвращаем к одному начальному дню
      tripDays:              [{ id: 'day-1', name: 'День 1', color: DAY_COLORS[0] }],
      activeDayId:           'day-1',
      tripDaysStats:         {},
      isLoadingRoute:        false,
      hoveredElevationPoint: null,
    });
  },

  /**
   * Загружает маршрут в стор из ответа API /api/routes/:id/details.
   * Используется для режимов редактирования (?edit=, /constructor/:id) и клонирования (?clone=).
   *
   * Важно: опорные точки (waypoints) — только границы отрезков из route_segments_json.
   * Массив apiData.points — это вся геометрия линии (сотни точек), его НЕ используем для маркеров.
   *
   * Ожидаемая структура apiData:
   *  - points: [{ lat, lng, day_id }] — геометрия линии (НЕ для маркеров)
   *  - pois: [{ lat, lng, name, description, images, icon_name, color }]
   *  - days: [{ id, title, distance, elevation_gain }]
   *  - route_segments_json: [{ path, surfaceData?, dayColor? }] — линия и границы отрезков (waypoints)
   *  - elevation_json: [{ distance, elevation, lat, lng, dayColor? }]
   */
  loadRouteFromDetails: (apiData) => {
    if (!apiData) return;
    Object.keys(segmentVersions).forEach((k) => delete segmentVersions[k]);
    pendingCount = 0;

    const pois   = Array.isArray(apiData.pois)   ? apiData.pois   : [];
    const days   = Array.isArray(apiData.days)   ? apiData.days   : [];
    const routeSegmentsJson = Array.isArray(apiData.route_segments_json) ? apiData.route_segments_json : [];
    const elevationJson = Array.isArray(apiData.elevation_json) ? apiData.elevation_json : [];

    const tripDays = days.length > 0
      ? days.map((d, i) => ({
          id:    String(d.id),
          name:  d.title || `День ${i + 1}`,
          color: DAY_COLORS[i % DAY_COLORS.length],
        }))
      : [{ id: 'day-1', name: 'День 1', color: DAY_COLORS[0] }];

    // Только непустые отрезки — из них строим waypoints и segments. Каждый отрезок привязан к дню по dayColor.
    const segmentsWithPath = routeSegmentsJson.filter((seg) => (seg?.path ?? []).length > 0);
    const firstDayId = tripDays[0]?.id ?? 'day-1';
    // Порядок появления dayColor в отрезках = порядок дней (День 1, День 2, …). Используем для привязки waypoints к дням.
    const uniqueDayColorsInOrder = [];
    for (const seg of segmentsWithPath) {
      const c = seg.dayColor ?? tripDays[0]?.color;
      if (c && !uniqueDayColorsInOrder.includes(c)) uniqueDayColorsInOrder.push(c);
    }

    /**
     * Строим массив опорных точек (waypoints) и параллельно запоминаем индексы
     * from/to для каждого геометрического отрезка.
     *
     * Ключевое правило:
     *  — Если отрезок продолжает тот же день, его стартовая точка уже есть в массиве
     *    (она же конечная точка предыдущего отрезка того же дня).
     *  — Если отрезок начинает НОВЫЙ день, его стартовая точка добавляется отдельно
     *    (gap-разрыв между днями). Благодаря этому пара «конец Дня1 – начало Дня2»
     *    никогда не попадает в segments, и Polylines каждого дня полностью независимы.
     */
    const routePoints = [];
    const segWpPairs   = []; // [{fromIdx, toIdx}] — для каждого отрезка из segmentsWithPath

    for (let i = 0; i < segmentsWithPath.length; i++) {
      const seg  = segmentsWithPath[i];
      const path = seg.path ?? [];

      let dayIdx = uniqueDayColorsInOrder.indexOf(seg.dayColor ?? '');
      if (dayIdx < 0) dayIdx = 0;
      dayIdx = Math.min(dayIdx, tripDays.length - 1);
      const tripDayId = tripDays[dayIdx]?.id ?? firstDayId;

      const prevSeg   = i > 0 ? segmentsWithPath[i - 1] : null;
      const isNewDay  = !prevSeg || (prevSeg.dayColor ?? '') !== (seg.dayColor ?? '');

      // Добавляем стартовую точку отрезка только когда начинается новый день
      // (для продолжения того же дня стартовая точка уже есть — это конец предыдущего отрезка)
      if (isNewDay) {
        routePoints.push({
          id:        '',
          lat:       Number(path[0][0]),
          lng:       Number(path[0][1]),
          tripDayId,
        });
      }

      const fromIdx = routePoints.length - 1; // FROM = только что добавленная или уже существующая точка

      const lastIdx = path.length - 1;
      routePoints.push({
        id:        '',
        lat:       Number(path[lastIdx][0]),
        lng:       Number(path[lastIdx][1]),
        tripDayId,
      });

      const toIdx = routePoints.length - 1;
      segWpPairs.push({ fromIdx, toIdx });
    }

    // Присваиваем финальные ID после того, как массив полностью сформирован
    routePoints.forEach((p, i) => { p.id = `pt-${i + 1}`; });

    const labels = pois.map((p, i) => {
      const urls = p.images ?? (p.image_urls ? (Array.isArray(p.image_urls) ? p.image_urls : [p.image_urls]) : []);
      const imgArr = Array.isArray(urls) ? urls.filter(Boolean) : (p.image_url ? [p.image_url] : []);
      return {
        id:          `label-${i + 1}`,
        lat:         Number(p.lat),
        lng:         Number(p.lng),
        name:        p.name ?? '',
        description: p.description ?? '',
        imageUrls:   imgArr,
        icon:        p.icon_name ?? 'map-pin',
        color:       (p.color && /^#[0-9A-Fa-f]{6}$/.test(p.color)) ? p.color : '#ef4444',
      };
    });

    const segmentDistances = segmentsWithPath.map((seg) => pathDistanceKm(seg.path || []));
    let cumDist = 0;
    const segments = [];
    // Итерируем по segmentsWithPath (не по routePoints.length-1!), используя
    // заранее вычисленные индексы waypoints (segWpPairs). Это гарантирует, что
    // для каждого геометрического отрезка создаётся ровно один объект segments[],
    // и GAP между днями (нет отрезка C→D) корректно пропускается.
    for (let i = 0; i < segmentsWithPath.length; i++) {
      const segData = segmentsWithPath[i];
      const path    = segData?.path ?? [];
      const distKm  = segmentDistances[i] ?? 0;
      const durationSec = Math.round((distKm / 5) * 3600);
      cumDist += distKm;
      const segStartDist = cumDist - distKm;
      const segEndDist   = cumDist;
      const segElevation = elevationJson.filter(
        (pt) => pt.distance >= segStartDist - 0.01 && pt.distance <= segEndDist + 0.01,
      );
      const elevationPoints = segElevation.length > 0
        ? segElevation.map((pt) => ({
            distance:  Math.round((pt.distance - segStartDist) * 10) / 10,
            elevation: Number(pt.elevation) || 0,
            lat:       pt.lat,
            lng:       pt.lng,
          }))
        : path.map((coords, idx) => {
            const localDist = path.length > 1 ? (idx / (path.length - 1)) * distKm : 0;
            return {
              distance:  Math.round(localDist * 10) / 10,
              elevation: 0,
              lat:       coords[0],
              lng:       coords[1],
            };
          });

      const { fromIdx, toIdx } = segWpPairs[i];
      segments.push({
        fromPointId:     routePoints[fromIdx].id,
        toPointId:       routePoints[toIdx].id,
        profile:         'foot-hiking',
        method:          'auto',
        path,
        distance:        distKm,
        duration:        durationSec,
        elevationPoints,
        surfaceData:     Array.isArray(segData?.surfaceData) ? segData.surfaceData : [],
        dayColor:        segData?.dayColor ?? tripDays[0]?.color ?? DAY_COLORS[0],
        tripDayId:       routePoints[toIdx].tripDayId ?? tripDays[0]?.id,
      });
    }

    const derived = computeDerived(routePoints, segments, tripDays);
    set({
      routePoints,
      labels,
      segments,
      tripDays,
      activeDayId: tripDays[0]?.id ?? 'day-1',
      ...derived,
      isLoadingRoute: false,
    });
  },

  // ─── Слой карты ───────────────────────────────────────────────────────────

  setActiveLayer: (layerId) => set({ activeLayer: layerId }),

  setHoveredElevationPoint: (point) => set({ hoveredElevationPoint: point }),

  setShowSurfaceOnMap: (val) => set({ showSurfaceOnMap: val }),

  /**
   * Переключает видимость категории POI на карте.
   * Если id уже есть в массиве — убирает, иначе добавляет.
   */
  /**
   * Переключает видимость категории POI на карте.
   *
   * Выключение (id уже активен):
   *  — Убираем id из activePoiCategories.
   *  — Мгновенно фильтруем pois, удаляя все точки этой категории —
   *    маркеры исчезают с карты без запроса к Overpass.
   *
   * Включение (id не активен):
   *  — Добавляем id в activePoiCategories.
   *  — pois не трогаем: PoiManager сам запросит новые точки через useEffect.
   */
  togglePoiCategory: (id) =>
    set((state) => {
      const isActive = state.activePoiCategories.includes(id);
      if (isActive) {
        const newCategories = state.activePoiCategories.filter((c) => c !== id);
        return {
          activePoiCategories: newCategories,
          pois: state.pois.filter((p) => p.categoryId !== id),
          /*
           * Сбрасываем плашку-предупреждение если все тумблеры выключены —
           * пустой экран не должен показывать «Показано 300 мест».
           * Если осталась хотя бы одна категория, статус лимита не меняем:
           * он будет обновлён следующим запросом к Overpass.
           */
          poiLimitReached: newCategories.length === 0 ? false : state.poiLimitReached,
        };
      }
      return {
        activePoiCategories: [...state.activePoiCategories, id],
      };
    }),

  /** Устанавливает флаг «зум слишком мелкий для загрузки POI». */
  setIsZoomTooLow: (val) => set({ isZoomTooLow: val }),

  /**
   * Полный сброс всего POI-состояния одним действием.
   * Вызывается кнопкой «Скрыть всё» в PlacesMenu.
   * Мгновенно убирает все маркеры с карты и сбрасывает все предупреждения.
   */
  clearAllPoiCategories: () => set({
    activePoiCategories: [],
    pois:                [],
    poiLimitReached:     false,
    isLoadingPois:       false,
    isSlowLoading:       false,
    poiUpdateTrigger:    Date.now(),
  }),

  /**
   * Загружает POI из Overpass API по текущей видимой области карты.
   *
   * Вызывается двумя способами:
   *  1. PoiManager.useMapEvents(moveend) — при перемещении / зуме карты
   *  2. PoiManager.useEffect([activePoiCategories]) — при переключении тумблеров
   *
   * Защита от race-condition: перед отправкой фиксируем версию запроса (myVersion).
   * Если к моменту получения ответа poiFetchVersion успел вырасти —
   * значит пользователь успел сдвинуть карту ещё раз; результат выбрасываем.
   *
   * @param {L.LatLngBounds} bounds — текущие границы Leaflet-карты
   */
  fetchPois: async (bounds) => {
    const { activePoiCategories } = get();

    // Нет активных категорий — очищаем маркеры и выходим без запроса
    if (activePoiCategories.length === 0) {
      set({ pois: [] });
      return;
    }

    // Фиксируем версию для защиты от устаревших ответов
    const myVersion = ++poiFetchVersion;

    // Сбрасываем флаги предыдущего цикла при старте нового запроса
    set({ isLoadingPois: true, isSlowLoading: false });

    /*
     * Отложенное предупреждение: если запрос не завершится за 3 секунды
     * (например, failover перебирает серверы), показываем синюю плашку.
     * Таймер гарантированно отменяется в блоке finally — при любом исходе.
     */
    const slowLoadingTimer = setTimeout(() => {
      if (myVersion === poiFetchVersion) {
        set({ isSlowLoading: true });
      }
    }, 3000);

    // Диагностический лог: видим какие категории и версию ушли в запрос
    console.log('[fetchPois] запрос POI, категории:', get().activePoiCategories, 'версия:', myVersion);

    try {
      // Overpass ждёт BBox в порядке: south, west, north, east
      const bbox = [
        bounds.getSouth(),
        bounds.getWest(),
        bounds.getNorth(),
        bounds.getEast(),
      ].join(',');

      // Плоский список всех элементов конфига для поиска по id
      const allItems = POI_CATEGORIES.flatMap((cat) => cat.items);

      // Отбираем только включённые категории и формируем строки запроса
      const activeItems = activePoiCategories
        .map((id) => allItems.find((item) => item.id === id))
        .filter(Boolean);

      const nodeLines = activeItems
        .map((item) => `  node${item.query}(${bbox});`)
        .join('\n');

      /*
       * Финальный Overpass QL-запрос.
       * Объединение (...) позволяет фильтровать по нескольким тегам за один запрос.
       * [timeout:25] — максимум 25 секунд на ответ сервера.
       */
      const query = [
        '[out:json][timeout:10];',
        '(',
        nodeLines,
        ');',
        'out body;',
        '>;\nout skel qt;',
      ].join('\n');

      /*
       * Failover-цикл по официальным зеркалам Overpass.
       *
       * При 429 (rate limit) идём к следующему серверу немедленно.
       * При любой другой сетевой ошибке — тоже пробуем следующий.
       * Пользователь не видит ни одного из этих сбоев; старые маркеры
       * остаются на карте, приложение выглядит работающим.
       */
      let rawElements = null;

      for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
          const response = await fetch(endpoint, {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    `data=${encodeURIComponent(query)}`,
          });

          if (response.status === 429) {
            console.warn(`[POI] ${endpoint} — занят (429), переключаемся...`);
            continue;
          }
          if (!response.ok) {
            console.warn(`[POI] ${endpoint} — HTTP ${response.status}, переключаемся...`);
            continue;
          }

          const data = await response.json();
          rawElements = Array.isArray(data.elements) ? data.elements : [];
          console.log(`[POI] ответ от ${endpoint}: ${rawElements.length} объектов`);
          break; // успех — выходим из цикла
        } catch (err) {
          console.warn(`[POI] ${endpoint} — сетевая ошибка: ${err.message}, переключаемся...`);
        }
      }

      // Все серверы недоступны — тихо выходим, старые маркеры остаются
      if (rawElements === null) {
        console.error('[POI] Все серверы Overpass недоступны, запрос пропущен.');
        return;
      }

      // Запрос устарел (карта успела сдвинуться) — выбрасываем ответ
      if (poiFetchVersion !== myVersion) return;

      /*
       * Преобразуем OSM-элементы в POI-объекты.
       * Определяем categoryId через matchesPOIQuery — сопоставляем теги элемента
       * с query-строками активных категорий и берём id первого совпадения.
       */
      const result = rawElements
        .filter((el) => el.lat != null && el.lon != null)
        .map((el) => {
          const matchedItem = activeItems.find((item) =>
            matchesPOIQuery(el.tags, item.query),
          );
          return {
            id:         el.id,
            lat:        el.lat,
            lon:        el.lon,
            tags:       el.tags ?? {},
            categoryId: matchedItem?.id ?? null,
          };
        });

      /*
       * Флаг лимита вычисляем по сырому ответу ДО любой обрезки —
       * честный сигнал «на этом экране есть ещё места за горизонтом».
       */
      const isLimitReached = result.length >= MAX_POIS;

      /*
       * Умное накопление с очисткой вне экрана.
       *
       * Алгоритм:
       *  1. Из текущего кеша оставляем ТОЛЬКО точки внутри текущего bounds.
       *     Устаревшие точки других районов автоматически отфильтровываются.
       *  2. Мержим с новыми результатами в Map<id, poi> — дубли дедуплицируются.
       *  3. Если итог превышает MAX_TOTAL_POIS — берём .slice(-N) (самые свежие).
       */
      const visibleOldPois = get().pois.filter((p) => bounds.contains([p.lat, p.lon]));
      const merged = new Map(visibleOldPois.map((p) => [p.id, p]));
      result.forEach((p) => merged.set(p.id, p));

      const allPois = Array.from(merged.values());
      const finalPois = allPois.length > MAX_TOTAL_POIS
        ? allPois.slice(-MAX_TOTAL_POIS)
        : allPois;

      // Атомарное обновление: данные + оба спиннера выключаем за один рендер
      set({
        pois:             finalPois,
        poiLimitReached:  isLimitReached,
        poiUpdateTrigger: Date.now(),
        isLoadingPois:    false,
        isSlowLoading:    false,
      });
    } catch (err) {
      // Непредвиденная ошибка (например, синтаксис JSON) — тихо логируем
      if (poiFetchVersion !== myVersion) return;
      console.error('[POI] непредвиденная ошибка:', err.message ?? err);
    } finally {
      /*
       * Страховочный сброс: срабатывает при catch, при return из-за
       * rawElements === null или stale-check. Также отменяет таймер
       * isSlowLoading — независимо от того, успел он сработать или нет.
       * Проверка версии гарантирует, что устаревший запрос не затрёт
       * isLoadingPois: true более нового параллельного запроса.
       */
      clearTimeout(slowLoadingTimer);
      if (poiFetchVersion === myVersion) {
        set({ isLoadingPois: false, isSlowLoading: false });
      }
    }
  },

  // ─── Построение одного отрезка ───────────────────────────────────────────

  /**
   * Строит отрезок маршрута между двумя точками и фиксирует его данные.
   *
   * Структура сохранённого отрезка:
   *  { fromPointId, toPointId, profile, method, path, distance, duration, elevationPoints }
   *
   *  profile  — ORS-профиль (e.g. 'foot-walking') — никогда не меняется после создания.
   *             Даже если пользователь переключил профиль в тулбаре, этот отрезок
   *             хранит тот профиль, который был АКТИВЕН при его создании.
   *  method   — 'direct' | 'ors' — способ построения, тоже заморожен.
   *  distance — км, 1 знак после запятой, вычислен однажды при создании.
   *  duration — секунды (целые), вычислен однажды при создании:
   *               для 'ors'    — из ORS summary.duration
   *               для 'direct' — из Haversine + PROFILE_SPEEDS_KMH[profile]
   *
   * Защита от устаревших ответов: segmentVersions[key] инкрементируется перед
   * каждым запросом; ответ применяется только если версия не изменилась.
   *
   * При ошибке ORS — фолбэк на прямую линию (отрезок не «зависает»).
   *
   * @param {{ id: number, lat: number, lng: number }} fromPoint
   * @param {{ id: number, lat: number, lng: number }} toPoint
   * @param {string} profile — ORS-профиль ('foot-walking', 'cycling-road', …)
   * @param {'direct'|'ors'} method — способ построения
   */
  buildSegment: async (fromPoint, toPoint, profile, method = 'ors') => {
    const segKey = `${fromPoint.id}_${toPoint.id}`;
    const version = (segmentVersions[segKey] = (segmentVersions[segKey] ?? 0) + 1);

    pendingCount++;
    set({ isLoadingRoute: true });

    // ── Режим прямой линии: без API роутинга (как «Напрямик») ──
    if (method === 'direct') {
      const path = [[fromPoint.lat, fromPoint.lng], [toPoint.lat, toPoint.lng]];
      const distM    = haversineDistance(fromPoint.lat, fromPoint.lng, toPoint.lat, toPoint.lng);
      const distKm   = Math.round((distM / 1000) * 10) / 10;
      const speedKmh = PROFILE_SPEEDS_KMH[profile] ?? 4.5;
      const durSec   = Math.round((distKm / speedKmh) * 3600);

      const newSeg = {
        fromPointId:     fromPoint.id,
        toPointId:       toPoint.id,
        profile,
        method:          'direct',
        path,
        distance:        distKm,
        duration:        durSec,
        elevationPoints: [],
        surfaceData:     [],
      };

      pendingCount = Math.max(0, pendingCount - 1);
      set((state) => {
        const segs = upsertSegment(state.segments, newSeg);
        return {
          segments:       segs,
          isLoadingRoute: pendingCount > 0,
          ...computeDerived(state.routePoints, segs, state.tripDays),
        };
      });
      return;
    }

    // ── Режим ORS API ───────────────────────────────────────────────────────
    try {
      /**
       * Ищем объект профиля, чтобы получить:
       *  orsProfile — реальную строку для URL (/v2/directions/{orsProfile}/...)
       *  extraBody  — дополнительные параметры запроса (preference, options и т.д.)
       *
       * Если профиль не найден (например, пользовательский), используем `profile`
       * напрямую — это безопасный фолбэк.
       */
      const profileObj  = ROUTING_PROFILES.find((p) => p.value === profile);
      const orsProfile  = profileObj?.orsProfile ?? profile;
      const extraBody   = profileObj?.extraBody  ?? {};

      const response = await fetch(getOrsUrl(orsProfile), {
        method: 'POST',
        headers: {
          Authorization: import.meta.env.VITE_ORS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json, application/geo+json',
        },
        body: JSON.stringify({
          coordinates: [[fromPoint.lng, fromPoint.lat], [toPoint.lng, toPoint.lat]],
          elevation:   true,
          extra_info:  ['surface'],
          ...extraBody,
        }),
      });

      // Проверяем актуальность ДО чтения тела ответа
      if (segmentVersions[segKey] !== version) {
        pendingCount = Math.max(0, pendingCount - 1);
        set({ isLoadingRoute: pendingCount > 0 });
        return;
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `ORS HTTP ${response.status}`);
      }

      const data = await response.json();

      // Повторная проверка после await (другой drag мог запустить новую версию)
      if (segmentVersions[segKey] !== version) {
        pendingCount = Math.max(0, pendingCount - 1);
        set({ isLoadingRoute: pendingCount > 0 });
        return;
      }

      const summary   = data.features[0].properties.summary;
      const rawCoords = data.features[0].geometry.coordinates;

      /**
       * В GeoJSON-ответе ORS extra_info лежит под ключом `extras`, а не `extra_info`.
       * extra_info используется только в JSON-формате (не GeoJSON).
       * Лог помогает проверить, что данные действительно приходят от API.
       */
      console.log('[ORS] extras:', data.features[0].properties.extras);
      // Данные о покрытии: [[startIdx, endIdx, surfaceId], ...]
      // Индексы соответствуют позициям в rawCoords (и в итоговом path).
      const surfaceData = data.features[0].properties.extras?.surface?.values ?? [];

      // Конвертируем: метры → км (1 знак)
      const distKm = Math.round((summary.distance / 1000) * 10) / 10;

      /**
       * Коэффициент реализма ×1.3:
       * ORS считает время для идеального атлета без снаряжения.
       * Множитель делает оценку более честной для туриста с рюкзаком:
       * привалы, ориентирование, неровная тропа и усталость.
       */
      const durSec = Math.round(summary.duration * 1.3);

      const path = rawCoords.map(([lng, lat]) => [lat, lng]);

      /**
       * Данные высот для ElevationProfile.
       * Прореживаем до ~150 точек на отрезок (достаточно для читаемого графика
       * и быстрого рендеринга recharts при нескольких отрезках).
       */
      const hasElevation   = rawCoords[0]?.length >= 3;
      const elevationPoints = [];

      if (hasElevation) {
        const step = Math.max(1, Math.ceil(rawCoords.length / 150));
        let cumDistM = 0;

        for (let i = 0; i < rawCoords.length; i++) {
          const [lng, lat, ele] = rawCoords[i];
          if (i > 0) {
            const [pl, plat] = rawCoords[i - 1];
            cumDistM += haversineDistance(plat, pl, lat, lng);
          }
          if (i % step === 0 || i === rawCoords.length - 1) {
            elevationPoints.push({
              distance:  Math.round((cumDistM / 1000) * 10) / 10,
              elevation: Math.round(ele),
              lat,
              lng,
            });
          }
        }
      }

      const newSeg = {
        fromPointId:     fromPoint.id,
        toPointId:       toPoint.id,
        profile,           // заморожен при создании
        method:          'ors',
        path,
        distance:        distKm,   // км, 1 знак
        duration:        durSec,   // секунды (от ORS)
        elevationPoints,
        surfaceData,       // [[startIdx, endIdx, surfaceId], ...]
      };

      pendingCount = Math.max(0, pendingCount - 1);
      set((state) => {
        const segs = upsertSegment(state.segments, newSeg);
        return {
          segments:       segs,
          isLoadingRoute: pendingCount > 0,
          ...computeDerived(state.routePoints, segs, state.tripDays),
        };
      });

    } catch (err) {
      if (segmentVersions[segKey] !== version) {
        pendingCount = Math.max(0, pendingCount - 1);
        set({ isLoadingRoute: pendingCount > 0 });
        return;
      }

      console.error('[buildSegment] Ошибка ORS, фолбэк на прямую линию:', err);

      const isNetworkErr = err instanceof TypeError;
      toast.error(
        isNetworkErr
          ? 'Нет соединения с сервисом маршрутов'
          : `Участок построен по прямой: ${err.message}`,
      );

      const distM    = haversineDistance(fromPoint.lat, fromPoint.lng, toPoint.lat, toPoint.lng);
      const distKm   = Math.round((distM / 1000) * 10) / 10;
      const speedKmh = PROFILE_SPEEDS_KMH[profile] ?? 4.5;
      const durSec   = Math.round((distKm / speedKmh) * 3600);

      const fallback = {
        fromPointId:     fromPoint.id,
        toPointId:       toPoint.id,
        profile,
        method:          'direct',
        path:            [[fromPoint.lat, fromPoint.lng], [toPoint.lat, toPoint.lng]],
        distance:        distKm,
        duration:        durSec,
        elevationPoints: [],
        surfaceData:     [],
      };

      pendingCount = Math.max(0, pendingCount - 1);
      set((state) => {
        const segs = upsertSegment(state.segments, fallback);
        return {
          segments:       segs,
          isLoadingRoute: pendingCount > 0,
          ...computeDerived(state.routePoints, segs, state.tripDays),
        };
      });
    }
  },

  // ─── Сохранение маршрута в Supabase ───────────────────────────────────────

  /**
   * Сохраняет маршрут в БД.
   *
   * @param {object} [options]
   *  - existingRouteId — UPDATE существующей записи (только свой маршрут: +eq author_id).
   *  - parentRouteId — при INSERT из режима «Сделать на основе»: поле routes.parent_route_id.
   *
   * Точки пути (геометрия линии): в таблицу points через insert_route_points.
   * Маркеры с контентом (labels / POI): в таблицу route_pois через insert_route_pois.
   */
  saveRoute: async (title, description, activityType, coverImageUrl = '', isPublic = false, routeImages = [], options = {}) => {
    const { elevationData, totalDistance, routePoints, labels, segments, routePath, surfaceStats, tripDays } = get();
    const existingRouteId = options?.existingRouteId ?? null;
    const parentRouteId = options?.parentRouteId ?? null;

    const authUser = useAuthStore.getState().user;
    const userId   = authUser?.id;

    if (!userId) {
      toast.error('Ошибка: пользователь не авторизован');
      return { routeId: null, error: 'Не авторизован' };
    }

    if (segments.length === 0 || routePath.length === 0) {
      toast.error('Сначала постройте маршрут (добавьте минимум 2 точки)');
      return { routeId: null, error: 'Нет данных маршрута' };
    }

    // Длительность (сек): сумма по отрезкам
    const totalDuration = Math.round(
      segments.reduce((sum, s) => sum + (s.duration ?? 0), 0),
    );
    // Набор высоты (м): сумма положительных приростов по elevationData
    let totalElevationGain = 0;
    if (Array.isArray(elevationData) && elevationData.length > 1) {
      for (let i = 1; i < elevationData.length; i++) {
        const prev = Number(elevationData[i - 1].elevation) || 0;
        const curr = Number(elevationData[i].elevation) || 0;
        const gain = curr - prev;
        if (gain > 0) totalElevationGain += gain;
      }
    }
    totalElevationGain = Math.round(totalElevationGain);

    set({ isSaving: true });

    try {
      const imagesArray = Array.isArray(routeImages) ? routeImages.filter((u) => typeof u === 'string' && u.trim()) : [];

      // Прореживаем данные высот до max 300 точек для хранения в БД.
      // Равномерная выборка по индексу сохраняет форму профиля без лишней нагрузки.
      let elevationJsonToSave = null;
      if (Array.isArray(elevationData) && elevationData.length > 0) {
        const srcLen = elevationData.length;
        const targetLen = Math.min(srcLen, 300);
        const step = srcLen / targetLen;
        elevationJsonToSave = Array.from({ length: targetLen }, (_, i) => {
          const pt = elevationData[Math.min(Math.round(i * step), srcLen - 1)];
          return {
            distance:  pt.distance,
            elevation: pt.elevation,
            lat:       pt.lat,
            lng:       pt.lng,
            dayColor:  pt.dayColor ?? null,
          };
        });
      }

      // Статистика покрытий — сохраняем как JSONB-поле routes.surfaces_json
      const surfacesJsonToSave = surfaceStats ?? null;

      // Упорядоченные отрезки с path и surfaceData для отрисовки линии по покрытиям при просмотре
      const orderedSegmentsForSave = [];
      for (let i = 0; i < routePoints.length - 1; i++) {
        const seg = segments.find(
          (s) => s.fromPointId === routePoints[i].id && s.toPointId === routePoints[i + 1].id,
        );
        if (!seg || !seg.path?.length) continue;
        const toPoint = routePoints.find((p) => p.id === seg.toPointId);
        const dayId = toPoint?.tripDayId ?? 'day-1';
        const day = tripDays.find((d) => d.id === dayId);
        const dayColor = day?.color ?? '#3b82f6';
        orderedSegmentsForSave.push({
          path:        seg.path,
          surfaceData: Array.isArray(seg.surfaceData) ? seg.surfaceData : [],
          dayColor,
        });
      }
      const routeSegmentsJsonToSave = orderedSegmentsForSave.length > 0 ? orderedSegmentsForSave : null;

      let routeId;
      let savedRoute = null;
      const profileSelect = 'id, username, full_name, avatar_url';
      const withProfileSelect = `
        id, title, description, activity_type, total_distance, total_elevation, duration,
        author_id, is_public, likes_count, parent_id, parent_route_id, cover_image_url, created_at, updated_at,
        profiles(${profileSelect})
      `;
      if (existingRouteId) {
        // Режим редактирования: обновляем существующую запись
        const { data: updatedRow, error: updateError } = await supabase
          .from('routes')
          .update({
            title:              title.trim(),
            description:        description?.trim() || null,
            activity_type:      activityType,
            total_distance:     Math.round(totalDistance * 1000),
            total_elevation:    totalElevationGain,
            duration:           totalDuration > 0 ? totalDuration : null,
            is_public:          Boolean(isPublic),
            cover_image_url:    coverImageUrl?.trim() || null,
            images:             imagesArray,
            surfaces_json:      surfacesJsonToSave,
            elevation_json:     elevationJsonToSave,
            route_segments_json: routeSegmentsJsonToSave,
          })
          .eq('id', existingRouteId)
          .eq('author_id', userId)
          .select(withProfileSelect)
          .maybeSingle();
        if (updateError) throw updateError;
        if (!updatedRow) {
          throw new Error('Маршрут не найден или нет прав на изменение');
        }
        routeId = existingRouteId;
        savedRoute = updatedRow;
        // Удаляем старые дни (каскадно удалятся точки) и POI
        await supabase.from('days').delete().eq('route_id', existingRouteId);
        await supabase.from('route_pois').delete().eq('route_id', existingRouteId);
      } else {
        // Создание нового маршрута
        const routeInsertPayload = {
          author_id:          userId,
          parent_route_id:    parentRouteId || null,
          title:              title.trim(),
          description:        description?.trim() || null,
          activity_type:      activityType,
          total_distance:     Math.round(totalDistance * 1000),
          total_elevation:    totalElevationGain,
          duration:           totalDuration > 0 ? totalDuration : null,
          is_public:          Boolean(isPublic),
          cover_image_url:    coverImageUrl?.trim() || null,
          images:             imagesArray,
          surfaces_json:      surfacesJsonToSave,
          elevation_json:     elevationJsonToSave,
          route_segments_json: routeSegmentsJsonToSave,
        };
        // Страховка: даже если payload когда-либо будут собирать из route-объекта,
        // критические поля оригинала не должны попасть в INSERT копии.
        const {
          id: _ignoredId,
          created_at: _ignoredCreatedAt,
          updated_at: _ignoredUpdatedAt,
          ...clonedRouteData
        } = routeInsertPayload;

        const { data: routeData, error: routeError } = await supabase
          .from('routes')
          .insert(clonedRouteData)
          .select('*, profiles(id, username, full_name, avatar_url)')
          .single();
        if (routeError) throw routeError;
        if (!routeData?.id) {
          throw new Error('Не удалось получить данные созданного маршрута');
        }
        routeId = routeData.id;
        savedRoute = routeData;
      }

      // Упорядоченный список ID дней (как в UI) для сохранения разбивки по дням
      const orderedDayIds = [];
      for (const p of routePoints) {
        const id = p.tripDayId ?? 'day-1';
        if (!orderedDayIds.includes(id)) orderedDayIds.push(id);
      }
      if (orderedDayIds.length === 0) orderedDayIds.push('day-1');

      // Статистика по дням: дистанция и длительность из отрезков
      const tripDaysStatsSave = {};
      for (let i = 0; i < routePoints.length - 1; i++) {
        const seg = segments.find(
          (s) => s.fromPointId === routePoints[i].id && s.toPointId === routePoints[i + 1].id,
        );
        if (!seg) continue;
        const dayId = routePoints.find((p) => p.id === seg.toPointId)?.tripDayId ?? 'day-1';
        if (!tripDaysStatsSave[dayId]) tripDaysStatsSave[dayId] = { distance: 0, duration: 0 };
        tripDaysStatsSave[dayId].distance += seg.distance ?? 0;
        tripDaysStatsSave[dayId].duration += seg.duration ?? 0;
      }
      for (const dayId of Object.keys(tripDaysStatsSave)) {
        tripDaysStatsSave[dayId].distance = Math.round(tripDaysStatsSave[dayId].distance * 10) / 10;
        tripDaysStatsSave[dayId].duration = Math.round(tripDaysStatsSave[dayId].duration);
      }

      // Набор высоты по дням из elevationData (если есть)
      const elevationGainPerDay = {};
      if (Array.isArray(elevationData) && elevationData.length > 1) {
        for (let i = 1; i < elevationData.length; i++) {
          const prev = elevationData[i - 1];
          const curr = elevationData[i];
          const dayId = curr.tripDayId ?? prev.tripDayId ?? 'day-1';
          if (curr.tripDayId === prev.tripDayId) {
            const gain = (Number(curr.elevation) || 0) - (Number(prev.elevation) || 0);
            if (gain > 0) {
              elevationGainPerDay[dayId] = (elevationGainPerDay[dayId] ?? 0) + gain;
            }
          }
        }
        for (const dayId of Object.keys(elevationGainPerDay)) {
          elevationGainPerDay[dayId] = Math.round(elevationGainPerDay[dayId]);
        }
      }

      // Точки по дням: для каждого отрезка относим его path к дню конечной точки
      const dayToPathCoords = {};
      for (const id of orderedDayIds) dayToPathCoords[id] = [];
      for (let i = 0; i < routePoints.length - 1; i++) {
        const seg = segments.find(
          (s) => s.fromPointId === routePoints[i].id && s.toPointId === routePoints[i + 1].id,
        );
        if (!seg?.path?.length) continue;
        const dayId = routePoints.find((p) => p.id === seg.toPointId)?.tripDayId ?? 'day-1';
        dayToPathCoords[dayId].push(...seg.path);
      }

      const insertedDayIds = [];
      for (let idx = 0; idx < orderedDayIds.length; idx++) {
        const dayId = orderedDayIds[idx];
        const dayMeta = tripDays.find((d) => d.id === dayId);
        const stats = tripDaysStatsSave[dayId] ?? { distance: 0, duration: 0 };
        const gain = elevationGainPerDay[dayId] ?? 0;
        const { data: insertedDays, error: dayError } = await supabase
          .from('days')
          .insert({
            route_id:       routeId,
            day_number:     idx + 1,
            title:         dayMeta?.name ?? `День ${idx + 1}`,
            distance:      Math.round((stats.distance || 0) * 1000),
            elevation_gain: gain,
          })
          .select('id');
        if (dayError) throw dayError;
        const dayRow = Array.isArray(insertedDays) && insertedDays.length > 0 ? insertedDays[0] : null;
        if (!dayRow?.id) {
          throw new Error('Не удалось создать день маршрута');
        }
        insertedDayIds.push(dayRow.id);

        const coords = dayToPathCoords[dayId] ?? [];
        const pathPoints = coords.map(([lat, lng]) => ({
          lat: lat ?? 0,
          lng: lng ?? 0,
          name: '',
          description: '',
          image_url: '',
          is_waypoint: false,
        }));
        if (pathPoints.length > 0) {
          const { error: pointsError } = await supabase.rpc('insert_route_points', {
            p_day_id: dayRow.id,
            p_points: pathPoints,
          });
          if (pointsError) throw pointsError;
        }
      }

      const firstDayIdForPois = insertedDayIds[0];

      // Маркеры с контентом (POI) — в отдельную таблицу route_pois для вкладки «Места»
      if (labels.length > 0) {
        const poisPayload = labels.map(({ lat, lng, name, description, imageUrls, icon, color }) => {
          const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
          return {
            lat,
            lng,
            name: name ?? '',
            description: description ?? '',
            image_url: urls[0] ?? '',
            images: urls,
            image_urls: urls,
            icon_name: icon ?? 'map-pin',
            color: color ?? '#ef4444',
          };
        });
        const { error: poisError } = await supabase.rpc('insert_route_pois', {
          p_route_id: routeId,
          p_day_id:   firstDayIdForPois,
          p_pois:     poisPayload,
        });
        if (poisError) throw poisError;
      }

      set({ isSaving: false });
      return { routeId, savedRoute, error: null };

    } catch (err) {
      const message = err.message || 'Не удалось сохранить маршрут';
      toast.error(`Ошибка сохранения: ${message}`);
      set({ isSaving: false });
      return { routeId: null, savedRoute: null, error: message };
    }
  },
}));

export default useRouteStore;
