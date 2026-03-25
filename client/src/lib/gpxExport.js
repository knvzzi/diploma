/**
 * Утилиты для генерации и скачивания GPX-файлов маршрутов.
 *
 * Модуль вынесен как общая библиотека, чтобы его могли использовать
 * как страница поиска (SearchRoutesPage), так и страница профиля (ProfilePage).
 */

import { supabase } from '@/lib/supabaseClient';

/** Цвета дней — синхронизированы с конструктором и страницей поиска. */
const DAY_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

/** Экранирует спецсимволы XML, чтобы не сломать структуру GPX-файла. */
function xmlEscape(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Генерирует строку в формате GPX 1.1 на основе объекта маршрута и детальных данных.
 *
 * Структура выходного файла:
 *  - <metadata><name> — название маршрута
 *  - <wpt> — опорные точки из POI (detailData.pois)
 *  - По одному <trk> на каждый день маршрута с тегом <name>День N</name>.
 *
 * ВАЖНО: один <trk> = один день, а не один общий <trk> с несколькими <trkseg>.
 * Если положить все дни в один <trk>, Garmin/OsmAnd соединят конец одного <trkseg>
 * с началом следующего прямой линией. Отдельные <trk> этого не делают.
 *
 * Источники координат (приоритет по убыванию):
 *  1. elevation_json — точки с высотой, привязаны к дню через dayColor
 *  2. segments.coordinates — плоские опорные точки дня (фолбэк без высоты)
 *  3. Весь elevation_json одним треком (если dayColor не совпал ни с одним сегментом)
 *
 * @param {object} route       - объект маршрута из Supabase (нужны: title, elevation_json)
 * @param {object} detailData  - { segments: [], pois: [] }
 * @returns {string} GPX-строка
 */
export function buildGpxString(route, detailData) {
  const title = xmlEscape(route?.title || 'Маршрут');

  // ── Опорные точки (POI) ────────────────────────────────────────────────────
  const waypointLines = (detailData?.pois ?? [])
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => {
      const name = xmlEscape(p.name || 'Место');
      const desc = p.description ? `<desc>${xmlEscape(p.description)}</desc>` : '';
      return `  <wpt lat="${Number(p.lat).toFixed(7)}" lon="${Number(p.lng).toFixed(7)}"><name>${name}</name>${desc}</wpt>`;
    })
    .join('\n');

  // ── Вспомогательные функции для формирования <trkpt> строк ────────────────

  /** Строки <trkpt> из точек с высотой */
  const elePoints = (pts) =>
    pts
      .map((pt) => {
        const ele = pt.elevation != null
          ? `<ele>${Number(pt.elevation).toFixed(1)}</ele>`
          : '';
        return `        <trkpt lat="${Number(pt.lat).toFixed(7)}" lon="${Number(pt.lng).toFixed(7)}">${ele}</trkpt>`;
      })
      .join('\n');

  /** Строки <trkpt> из плоских [lat, lng] без высоты */
  const flatPoints = (coords) =>
    (coords ?? [])
      .map(([lat, lng]) => `        <trkpt lat="${Number(lat).toFixed(7)}" lon="${Number(lng).toFixed(7)}"></trkpt>`)
      .join('\n');

  // ── Формируем треки: один <trk> = один день ───────────────────────────────
  const elevationJson = Array.isArray(route?.elevation_json) ? route.elevation_json : [];
  const segments = detailData?.segments ?? [];
  let tracksXml = '';

  if (segments.length > 0) {
    if (elevationJson.length > 0 && elevationJson[0]?.lat != null) {
      // Группируем elevation_json по цвету дня (dayColor совпадает с seg.color)
      const byColor = new Map();
      for (const pt of elevationJson) {
        const key = pt.dayColor ?? '__single__';
        if (!byColor.has(key)) byColor.set(key, []);
        byColor.get(key).push(pt);
      }

      let anyBuilt = false;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const dayName = xmlEscape(seg.dayTitle || `День ${i + 1}`);
        const pts = byColor.get(seg.color) ?? [];
        const trkptsStr = pts.length > 0 ? elePoints(pts) : flatPoints(seg.coordinates);
        if (!trkptsStr) continue;
        tracksXml += `  <trk>\n    <name>${dayName}</name>\n    <trkseg>\n${trkptsStr}\n    </trkseg>\n  </trk>\n`;
        anyBuilt = true;
      }

      // Фолбэк: если привязка по цвету не дала результатов — один трек на весь маршрут
      if (!anyBuilt) {
        const trkptsStr = elePoints(elevationJson);
        if (trkptsStr) {
          tracksXml = `  <trk>\n    <name>${title}</name>\n    <trkseg>\n${trkptsStr}\n    </trkseg>\n  </trk>\n`;
        }
      }
    } else {
      // Нет elevation_json — плоские координаты опорных точек, по одному <trk> на день
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const dayName = xmlEscape(seg.dayTitle || `День ${i + 1}`);
        const trkptsStr = flatPoints(seg.coordinates);
        if (!trkptsStr) continue;
        tracksXml += `  <trk>\n    <name>${dayName}</name>\n    <trkseg>\n${trkptsStr}\n    </trkseg>\n  </trk>\n`;
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Туристический планировщик маршрутов"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${title}</name>
  </metadata>
${waypointLines ? waypointLines + '\n' : ''}${tracksXml}</gpx>`;
}

/**
 * Загружает детали маршрута через API, генерирует GPX и инициирует скачивание файла.
 *
 * @param {object} route   - объект маршрута (нужны: id, title, elevation_json)
 * @param {function} toastSuccess - функция для показа успешного уведомления
 * @param {function} toastError   - функция для показа ошибки
 * @returns {Promise<void>}
 */
export async function downloadRouteAsGpx(route, toastSuccess, toastError) {
  if (!route?.id) {
    toastError?.('Маршрут не найден');
    return;
  }

  try {
    // Получаем токен авторизации для доступа к приватным маршрутам
    const { data: { session } } = await supabase.auth.getSession();
    const headers = {};
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }

    const res = await fetch(`/api/routes/${route.id}/details`, { headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Ошибка ${res.status}`);
    }
    const data = await res.json();

    const points = Array.isArray(data.points) ? data.points : [];
    const pois   = Array.isArray(data.pois)   ? data.pois   : [];

    // Строим сегменты по дням (такая же логика, как в SearchRoutesPage)
    const byDay = new Map();
    for (const p of points) {
      if (!byDay.has(p.day_id)) byDay.set(p.day_id, []);
      byDay.get(p.day_id).push([p.lat, p.lng]);
    }
    const dayIdsOrdered = [...new Map(points.map((p) => [p.day_id, p.day_number])).entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([dayId]) => dayId);

    const apiDaysMap = new Map((data.days ?? []).map((d) => [d.id, d]));
    const segments = dayIdsOrdered.map((dayId, i) => {
      const apiDay = apiDaysMap.get(dayId) ?? {};
      return {
        dayId,
        dayTitle:    apiDay.title || `День ${i + 1}`,
        color:       DAY_COLORS[i % DAY_COLORS.length],
        coordinates: byDay.get(dayId) ?? [],
        distance:    apiDay.distance ?? 0,
        elevation_gain: apiDay.elevation_gain ?? 0,
      };
    });

    // Маршрут из API может содержать elevation_json — берём из него, если не было в исходном объекте
    const enrichedRoute = { ...route, elevation_json: route.elevation_json ?? data.elevation_json };

    const gpxString = buildGpxString(enrichedRoute, { segments, pois });
    const blob = new Blob([gpxString], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fileName = `${(route?.title || 'маршрут').replace(/[\\/:*?"<>|]/g, '_')}.gpx`;
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toastSuccess?.('GPX-файл скачан');
  } catch (err) {
    console.error('[downloadRouteAsGpx]', err);
    toastError?.('Не удалось сформировать GPX-файл');
  }
}
