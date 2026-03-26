import { useEffect, useRef, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Trophy, Ruler, Mountain, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const ACTIVITY_LABELS = {
  foot:  'Пеший',
  bike:  'Велосипед',
  car:   'Авто',
};

function formatDistance(meters) {
  if (meters == null) return '—';
  return `${(Number(meters) / 1000).toFixed(1)} км`;
}

function formatElevation(meters) {
  if (meters == null) return '—';
  return `${Math.round(Number(meters))} м`;
}

/** Нормализация точки в [lat, lng]. */
function toLatLngPair(pt) {
  if (Array.isArray(pt) && pt.length >= 2) return [Number(pt[0]), Number(pt[1])];
  if (pt && typeof pt === 'object' && pt.lat != null && pt.lng != null)
    return [Number(pt.lat), Number(pt.lng)];
  return null;
}

function normalizePath(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(toLatLngPair).filter(Boolean);
}

/**
 * Возвращает массив путей, разбитых по дням: [[lat,lng][], ...].
 *
 * Приоритет: route_segments_json (каждый сегмент — уже внутридневной отрезок).
 * Фолбэк: опорные точки (route.points), сгруппированные по day_number.
 *
 * Каждый path рисуется отдельным L.polyline — концы разных дней
 * НЕ соединяются прямой линией.
 */
function getPathsByDay(route) {
  if (!route) return [];

  const segs = route.route_segments_json ?? [];
  if (Array.isArray(segs) && segs.length > 0) {
    return segs
      .map((seg) => normalizePath(seg.path ?? []))
      .filter((p) => p.length >= 2);
  }

  // Фолбэк: опорные точки, сгруппированные по day_number / day_id
  const pts = (route.points ?? []).filter((p) => p.lat != null && p.lng != null);
  if (pts.length === 0) return [];

  const byDay = new Map();
  for (const p of pts) {
    const key = p.day_number ?? p.day_id ?? 0;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push([Number(p.lat), Number(p.lng)]);
  }

  return [...byDay.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, path]) => path)
    .filter((p) => p.length > 0);
}

/**
 * Страница «Маршрут пройден»: праздничный экран после завершения навигации.
 * Роут: /route/:id/completed
 */
export default function RouteCompletedPage() {
  const { id } = useParams();
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mapContainerRef = useRef(null);
  const mapInstanceRef  = useRef(null);

  /** Пути по дням: [[lat,lng][], ...] */
  const pathsByDay = useMemo(() => getPathsByDay(route), [route]);

  /** Весь набор координат — только для fitBounds и маркеров */
  const allCoords = useMemo(() => pathsByDay.flat(), [pathsByDay]);

  useEffect(() => {
    if (!id) {
      setError('ID маршрута не указан');
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/routes/${id}/details`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Ошибка ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled) { setRoute(data); setError(null); }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message ?? 'Не удалось загрузить маршрут');
          toast.error(err?.message ?? 'Ошибка загрузки');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id]);

  /**
   * Мини-карта: каждый день — отдельный L.polyline, поэтому
   * конец дня 1 НЕ соединяется прямой линией с началом дня 2.
   */
  useEffect(() => {
    if (!route || allCoords.length < 2 || !mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: allCoords[0],
      zoom: 10,
      zoomControl: false,
      attributionControl: false,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap, CARTO',
      maxZoom: 19,
    }).addTo(map);

    // Отдельный polyline на каждый день — разрывы между днями сохраняются
    for (const path of pathsByDay) {
      if (path.length < 2) continue;
      L.polyline(path, {
        color:    '#2563eb',
        weight:   4,
        opacity:  0.9,
        lineCap:  'round',
        lineJoin: 'round',
      }).addTo(map);
    }

    const startIcon = L.divIcon({
      html: '<div style="width:12px;height:12px;border-radius:50%;background:#16a34a;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>',
      className: '',
      iconSize:   [12, 12],
      iconAnchor: [6, 6],
    });
    const finishIcon = L.divIcon({
      html: '<div style="width:12px;height:12px;border-radius:50%;background:#dc2626;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>',
      className: '',
      iconSize:   [12, 12],
      iconAnchor: [6, 6],
    });

    L.marker(allCoords[0], { icon: startIcon }).addTo(map);
    const last = allCoords[allCoords.length - 1];
    if (last[0] !== allCoords[0][0] || last[1] !== allCoords[0][1]) {
      L.marker(last, { icon: finishIcon }).addTo(map);
    }

    map.fitBounds(L.latLngBounds(allCoords), { padding: [20, 20], maxZoom: 14 });
    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        try { mapInstanceRef.current.remove(); } catch (_) {}
        mapInstanceRef.current = null;
      }
    };
  }, [route, allCoords, pathsByDay]);

  // ── Состояния загрузки / ошибки ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-[#FFF9F0]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
          <p className="text-sm text-neutral-500">Загрузка...</p>
        </div>
      </div>
    );
  }

  if (error || !route) {
    return (
      <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-4 bg-[#FFF9F0] p-6">
        <p className="text-center text-neutral-700">{error ?? 'Маршрут не найден'}</p>
      </div>
    );
  }

  const activityLabel = ACTIVITY_LABELS[route.activity_type] ?? route.activity_type ?? '—';

  return (
    <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center bg-[#FFF9F0] px-6 py-12">
      <div className="flex w-full max-w-sm flex-col items-center text-center">

        {/* Кубок — золотое кольцо */}
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full border-4 border-yellow-500 bg-yellow-50 shadow-sm">
          <Trophy className="h-12 w-12 text-yellow-600" strokeWidth={2} />
        </div>

        {/* Заголовок */}
        <p className="text-xs font-bold uppercase tracking-widest text-yellow-600">
          Очень круто!
        </p>
        <h1 className="mt-2 text-2xl font-bold leading-tight text-neutral-900">
          Маршрут пройден
        </h1>
        <p className="mt-1.5 text-base font-semibold text-neutral-500">
          {route.title ?? 'Без названия'}
        </p>

        {/* Карточка статистики — белая с мягкой жёлтой тенью */}
        <div className="mt-8 w-full rounded-2xl border border-yellow-100 bg-white p-4 shadow-[0_4px_20px_rgba(234,179,8,0.12)]">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm text-neutral-500">
              <Ruler className="h-4 w-4 text-yellow-500" />
              Дистанция
            </span>
            <span className="text-sm font-semibold text-neutral-900">
              {formatDistance(route.total_distance ?? route.distance)}
            </span>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-neutral-100 pt-3">
            <span className="flex items-center gap-2 text-sm text-neutral-500">
              <Mountain className="h-4 w-4 text-yellow-500" />
              Тип активности
            </span>
            <span className="text-sm font-semibold text-neutral-900">{activityLabel}</span>
          </div>

          {route.total_elevation != null && Number(route.total_elevation) > 0 && (
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-neutral-100 pt-3">
              <span className="text-sm text-neutral-500">Набор высоты</span>
              <span className="text-sm font-semibold text-neutral-900">
                {formatElevation(route.total_elevation)}
              </span>
            </div>
          )}
        </div>

        {/* Мини-карта */}
        {allCoords.length >= 2 && (
          <div className="mt-6 w-full overflow-hidden rounded-2xl border border-yellow-100 bg-white shadow-sm">
            <div ref={mapContainerRef} className="h-44 w-full" />
          </div>
        )}

      </div>
    </div>
  );
}
