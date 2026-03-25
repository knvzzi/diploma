import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { X, Locate, Ruler, Loader2, Navigation } from 'lucide-react';
import { toast } from 'sonner';
import { MAP_LAYERS } from '@/store/useRouteStore';
import { getSurfaceLayers } from '@/components/map/RouteMap';
import { POI_ICONS, getPoiIconSvg } from '@/components/map/PoiIconPicker';
import { createCustomMarker } from '@/utils/markerUtils';

const DAY_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
const MAP_CENTER = [53.9045, 27.5615];
const MAP_ZOOM = 12;

function formatDistance(meters) {
  if (meters == null) return '—';
  return `${(Number(meters) / 1000).toFixed(1)} км`;
}

/** Экранирование для HTML в попапах маркеров */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Массив фото POI (images, image_urls, image_url) */
function getPoiPhotos(poi) {
  let arr = poi?.images ?? poi?.image_urls;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch { arr = null; }
  }
  if (Array.isArray(arr) && arr.length > 0) return arr.filter(Boolean);
  if (poi?.image_url && typeof poi.image_url === 'string' && poi.image_url.trim()) return [poi.image_url];
  return [];
}

/** Нормализация точки в [lat, lng]. Поддержка массивов и объектов { lat, lng }. */
function toLatLngPair(pt) {
  if (Array.isArray(pt) && pt.length >= 2) return [Number(pt[0]), Number(pt[1])];
  if (pt && typeof pt === 'object' && pt.lat != null && pt.lng != null) return [Number(pt.lat), Number(pt.lng)];
  if (pt && typeof pt === 'object' && pt.latitude != null && pt.longitude != null) return [Number(pt.latitude), Number(pt.longitude)];
  return null;
}

/** Нормализация пути отрезка в массив [lat, lng]. */
function normalizePath(path) {
  if (!Array.isArray(path)) return [];
  return path.map(toLatLngPair).filter(Boolean);
}

/** Расстояние между двумя точками в метрах (формула Haversine). */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Страница Live-навигации: карта на весь экран, линия маршрута, GPS-позиция пользователя.
 * Без Navbar — ощущение нативного приложения.
 */
export default function LiveNavigationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const tileLayerRef = useRef(null);
  const polylinesRef = useRef([]);
  const userMarkerRef = useRef(null);
  const startMarkerRef = useRef(null);
  const finishMarkerRef = useRef(null);
  const poisMarkersRef = useRef(new Map());

  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [userPosition, setUserPosition] = useState(null);
  /** Стартовый экран: GPS запускается только после клика «Начать маршрут» (требование браузеров) */
  const [isStarted, setIsStarted] = useState(false);
  /** Показывать оверлей «Вы у цели!», если пользователь в радиусе 50 м от финиша */
  const [showNearFinishOverlay, setShowNearFinishOverlay] = useState(false);

  /** Финишная точка маршрута (последняя координата) для проверки «у цели» */
  const finishPoint = useMemo(() => {
    if (!route) return null;
    const segs = route.route_segments_json ?? [];
    if (Array.isArray(segs) && segs.length > 0) {
      const lastSeg = segs[segs.length - 1];
      const path = normalizePath(lastSeg?.path ?? []);
      if (path.length > 0) return path[path.length - 1];
    }
    const points = route.points ?? [];
    if (points.length > 0) {
      const last = points[points.length - 1];
      if (last?.lat != null && last?.lng != null) return [last.lat, last.lng];
    }
    return null;
  }, [route]);

  // ── Загрузка маршрута ──────────────────────────────────────────────────────

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
        if (cancelled) return;
        setRoute(data);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err?.message ?? 'Не удалось загрузить маршрут');
          toast.error(err?.message ?? 'Ошибка загрузки маршрута');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id]);

  // ── Инициализация карты (только после клика «Начать маршрут», когда isStarted === true) ───

  useEffect(() => {
    if (!isStarted || !mapDivRef.current || mapRef.current) return;

    try {
      const map = L.map(mapDivRef.current, {
        center: MAP_CENTER,
        zoom: MAP_ZOOM,
        zoomControl: false,
      });
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      const layerConfig = MAP_LAYERS.standard;
      const tileLayer = L.tileLayer(layerConfig.url, {
        attribution: layerConfig.attribution,
        maxZoom: layerConfig.maxZoom ?? 19,
      }).addTo(map);
      tileLayerRef.current = tileLayer;
      mapRef.current = map;
      setMapReady(true);
    } catch (err) {
      console.error('[LiveNavigationPage] map init:', err);
      setError(err?.message ?? 'Ошибка инициализации карты');
    }

    return () => {
      tileLayerRef.current = null;
      polylinesRef.current.forEach((p) => { try { p.remove(); } catch (_) {} });
      polylinesRef.current = [];
      poisMarkersRef.current.forEach((m) => { try { m.remove(); } catch (_) {} });
      poisMarkersRef.current.clear();
      if (startMarkerRef.current) { try { startMarkerRef.current.remove(); } catch (_) {} startMarkerRef.current = null; }
      if (finishMarkerRef.current) { try { finishMarkerRef.current.remove(); } catch (_) {} finishMarkerRef.current = null; }
      if (userMarkerRef.current) {
        try { userMarkerRef.current.remove(); } catch (_) {}
        userMarkerRef.current = null;
      }
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch (_) {}
        mapRef.current = null;
      }
      setMapReady(false);
    };
  }, [isStarted]);

  // Проверка «у цели»: в радиусе 50 м от финиша — показываем оверлей
  useEffect(() => {
    if (!userPosition || !finishPoint || finishPoint.length < 2) {
      setShowNearFinishOverlay(false);
      return;
    }
    const [finishLat, finishLng] = finishPoint;
    const dist = haversineMeters(
      userPosition.lat,
      userPosition.lng,
      finishLat,
      finishLng
    );
    setShowNearFinishOverlay(dist <= 50);
  }, [userPosition, finishPoint]);

  // ── Отрисовка маршрута и маркеров (старт, финиш, путевые точки, чёрные точки поворотов) ───

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !route) return;

    // Очистка предыдущих полилиний и маркеров
    polylinesRef.current.forEach((p) => { try { p.remove(); } catch (_) {} });
    polylinesRef.current = [];
    poisMarkersRef.current.forEach((m) => { try { m.remove(); } catch (_) {} });
    poisMarkersRef.current.clear();
    if (startMarkerRef.current) { try { startMarkerRef.current.remove(); } catch (_) {} startMarkerRef.current = null; }
    if (finishMarkerRef.current) { try { finishMarkerRef.current.remove(); } catch (_) {} finishMarkerRef.current = null; }

    const routeSegmentsJson = route.route_segments_json ?? [];
    const points = route.points ?? [];
    const pois = Array.isArray(route.pois) ? route.pois : [];
    const allCoords = [];

    // Строим отрезки с path, surfaceData и color (как в конструкторе / странице просмотра)
    const segments = [];
    if (Array.isArray(routeSegmentsJson) && routeSegmentsJson.length > 0) {
      for (let i = 0; i < routeSegmentsJson.length; i++) {
        const seg = routeSegmentsJson[i];
        const rawPath = seg.path ?? [];
        const path = normalizePath(rawPath);
        if (path.length < 2) continue;
        const surfaceData = Array.isArray(seg.surfaceData) ? seg.surfaceData : [];
        const dayColor = seg.dayColor ?? DAY_COLORS[i % DAY_COLORS.length];
        segments.push({ path, surfaceData, color: dayColor });
      }
    }
    if (segments.length === 0 && Array.isArray(points) && points.length > 0) {
      const orderedSegments = [];
      let currentDayId = null;
      let currentPath = [];
      let segmentIndex = 0;
      for (const p of points) {
        if (p.lat == null || p.lng == null) continue;
        const dayId = p.day_id ?? '__single__';
        if (dayId !== currentDayId) {
          if (currentPath.length >= 2) {
            orderedSegments.push({
              path: currentPath,
              surfaceData: [],
              color: DAY_COLORS[segmentIndex % DAY_COLORS.length],
            });
            segmentIndex++;
          }
          currentDayId = dayId;
          currentPath = [];
        }
        currentPath.push([p.lat, p.lng]);
      }
      if (currentPath.length >= 2) {
        orderedSegments.push({
          path: currentPath,
          surfaceData: [],
          color: DAY_COLORS[segmentIndex % DAY_COLORS.length],
        });
      }
      segments.push(...orderedSegments);
    }

    // Слой «внизу»: обводка + цветные линии по отрезкам и типам покрытия (как в конструкторе)
    const routeLinePane = map.getPane('liveRouteLine') ?? map.createPane('liveRouteLine');
    routeLinePane.style.zIndex = 250;
    const paneOpt = { pane: 'liveRouteLine' };

    for (const { path, surfaceData, color: segmentColor } of segments) {
      // Теневая подложка: белая/светлая обводка, чуть шире, чтобы линия читалась на любом фоне
      const outline = L.polyline(path, {
        color: '#ffffff',
        weight: 10,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round',
        ...paneOpt,
      }).addTo(map);
      polylinesRef.current.push(outline);

      if (surfaceData.length > 0) {
        // Отрисовка по типам покрытия: у каждого подотрезка свой стиль (сплошной или пунктир для грунта)
        for (const [startIdx, endIdx, surfaceId] of surfaceData) {
          const subPath = path.slice(startIdx, endIdx + 1);
          if (subPath.length < 2) continue;
          const layers = getSurfaceLayers(surfaceId, segmentColor, false);
          for (const opts of layers) {
            const line = L.polyline(subPath, {
              color: opts.color,
              weight: opts.weight ?? 5,
              opacity: opts.opacity ?? 1,
              lineCap: opts.lineCap ?? 'round',
              lineJoin: opts.lineJoin ?? 'round',
              dashArray: opts.dashArray,
              ...paneOpt,
            }).addTo(map);
            polylinesRef.current.push(line);
          }
        }
      } else {
        // Нет surfaceData — одна сплошная линия цвета дня (отрезка)
        const line = L.polyline(path, {
          color: segmentColor,
          weight: 5,
          opacity: 1,
          lineCap: 'round',
          lineJoin: 'round',
          ...paneOpt,
        }).addTo(map);
        polylinesRef.current.push(line);
      }
      allCoords.push(...path);
    }

    if (allCoords.length > 0) {
      // Авто-зум: помещаем весь маршрут и все метки в видимую область
      const boundsPoints = [...allCoords];
      pois.forEach((poi) => {
        const lat = poi.lat;
        const lng = poi.lng ?? poi.lon;
        if (lat != null && lng != null) boundsPoints.push([lat, lng]);
      });
      const bounds = L.latLngBounds(boundsPoints);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });

      // ── Маркеры Старт и Финиш (зелёный и красный кружки с белой обводкой) ──
      const [startLat, startLng] = allCoords[0];
      const [finishLat, finishLng] = allCoords[allCoords.length - 1];

      const startIcon = L.divIcon({
        html: `<div style="
          width:20px;height:20px;border-radius:50%;
          background:#16a34a;border:2px solid white;
          box-shadow:0 1px 4px rgba(0,0,0,0.35);
        "></div>`,
        className: '',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      const finishIcon = L.divIcon({
        html: `<div style="
          width:20px;height:20px;border-radius:50%;
          background:#dc2626;border:2px solid white;
          box-shadow:0 1px 4px rgba(0,0,0,0.35);
        "></div>`,
        className: '',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      // ── Маркеры поверх линии: Старт, Финиш, путевые точки (POI). Чёрные точки не рисуем. ──
      startMarkerRef.current = L.marker([startLat, startLng], { icon: startIcon, zIndexOffset: 400 })
        .bindTooltip('Старт', { permanent: false, direction: 'top', offset: [0, -6] })
        .addTo(map);

      const isSamePoint = Math.abs(startLat - finishLat) < 1e-6 && Math.abs(startLng - finishLng) < 1e-6;
      if (!isSamePoint) {
        finishMarkerRef.current = L.marker([finishLat, finishLng], { icon: finishIcon, zIndexOffset: 400 })
          .bindTooltip('Финиш', { permanent: false, direction: 'top', offset: [0, -6] })
          .addTo(map);
      }

      // Путевые точки (POI): капля/иконка с подписью и попапом (как на странице просмотра) ──
      pois.forEach((poi) => {
        if (!poi) return;
        const lat = poi.lat;
        const lng = poi.lng ?? poi.lon;
        if (lat == null || lng == null || typeof lat !== 'number' || typeof lng !== 'number') return;

        const photoUrls = getPoiPhotos(poi) ?? [];
        const firstPhoto = photoUrls[0] ?? poi?.image_url;
        const hasPhoto = Boolean(firstPhoto);
        const multiPhoto = photoUrls.length > 1;
        const badgeHtml = multiPhoto ? `<span class="poi-marker-badge">${photoUrls.length}</span>` : '';
        const iconName = poi?.icon_name || 'map-pin';
        const poiColor = poi?.color && /^#[0-9A-Fa-f]{6}$/.test(poi.color) ? poi.color : '#3b82f6';
        let icon = null;
        if (hasPhoto) {
          icon = L.divIcon({
            html: `<div class="poi-marker-wrap"><div class="poi-marker poi-marker--photo" style="background-image:url('${String(firstPhoto).replace(/'/g, "\\'")}')"></div>${badgeHtml}</div>`,
            className: '',
            iconSize: [36, 36],
            iconAnchor: [18, 36],
            popupAnchor: [0, -20],
          });
        } else {
          const entry = POI_ICONS.find((i) => i.id === iconName);
          const Icon = entry?.Icon ?? POI_ICONS[0]?.Icon;
          try {
            const baseIcon = createCustomMarker(poiColor, Icon);
            icon = multiPhoto
              ? L.divIcon({
                  html: `<div class="poi-marker-wrap poi-marker-wrap--teardrop">${baseIcon.options.html}${badgeHtml}</div>`,
                  className: '',
                  iconSize: baseIcon.options.iconSize ?? [32, 32],
                  iconAnchor: baseIcon.options.iconAnchor ?? [16, 32],
                  popupAnchor: baseIcon.options.popupAnchor ?? [0, -18],
                })
              : baseIcon;
          } catch (_) {
            icon = createCustomMarker(poiColor, undefined);
          }
        }
        if (!icon) return;
        const popupUrls = getPoiPhotos(poi) ?? [];
        const iconSvg = getPoiIconSvg(iconName, { size: 20, color: '#ffffff' });
        const headerIconHtml = `<span class="poi-popup-header-icon" style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background-color:${poiColor};flex-shrink:0;">${iconSvg}</span>`;
        const nameHtml = `<span style="font-size:1rem;font-weight:600;color:#111;line-height:1.3;">${escapeHtml(poi?.name ?? 'Без названия')}</span>`;
        const descHtml = (poi?.description && String(poi.description).trim())
          ? `<div style="font-size:0.8125rem;color:#6b7280;margin-top:6px;line-height:1.4;">${escapeHtml(String(poi.description).trim())}</div>`
          : '';
        const galleryHtml = popupUrls.length > 0
          ? `<div class="poi-popup-gallery" style="display:flex;gap:8px;overflow-x:auto;margin-top:8px;padding-bottom:6px;">${popupUrls.map((src) => `<img src="${escapeHtml(src)}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;flex-shrink:0;" />`).join('')}</div>`
          : '';
        const coordsHtml = `<div style="font-size:0.7rem;color:#9ca3af;margin-top:6px;">Координаты: ${Number(lat).toFixed(5)} ${Number(lng).toFixed(5)}</div>`;
        const popupInner = `<div style="display:flex;align-items:flex-start;gap:8px;">${headerIconHtml}<div style="flex:1;min-width:0;">${nameHtml}${descHtml}${galleryHtml}${coordsHtml}</div></div>`;
        const poiName = (poi?.name ?? 'Без названия').trim();
        const truncatedName = poiName.length > 25 ? `${poiName.slice(0, 25)}…` : poiName;
        const marker = L.marker([lat, lng], { icon, zIndexOffset: 350 })
          .bindPopup(`<div style="font-family:system-ui,sans-serif;min-width:200px;">${popupInner}</div>`, { maxWidth: 320, className: 'poi-detail-popup' })
          .bindTooltip(truncatedName, { permanent: true, direction: 'right', offset: [12, 0], className: 'poi-label-tooltip' })
          .addTo(map);
        const refKey = poi?.id ?? `poi-${lat}-${lng}`;
        poisMarkersRef.current.set(refKey, marker);
      });
    }
  }, [mapReady, route]);

  // ── GPS: watchPosition запускается только после клика «Начать маршрут» (требование браузеров) ─

  useEffect(() => {
    if (!isStarted || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUserPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        console.warn('[LiveNavigation] geolocation error:', err);
        setUserPosition(null);
        if (err.code === 1) {
          toast.error('Доступ к геолокации запрещён');
        } else if (err.code === 2 || err.code === 3) {
          toast.error('Не удалось определить местоположение');
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [isStarted]);

  // ── Маркер пользователя (синий пульсирующий кружок) ─────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (!userPosition) {
      if (userMarkerRef.current) {
        try { userMarkerRef.current.remove(); } catch (_) {}
        userMarkerRef.current = null;
      }
      return;
    }

    const userIcon = L.divIcon({
      html: `
        <div class="relative flex items-center justify-center">
          <span class="absolute inline-flex h-8 w-8 rounded-full bg-blue-500 opacity-40 animate-ping"></span>
          <span class="relative inline-flex h-6 w-6 rounded-full bg-blue-500 border-2 border-white shadow-lg"></span>
        </div>
      `,
      className: 'bg-transparent border-0',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([userPosition.lat, userPosition.lng]);
    } else {
      userMarkerRef.current = L.marker([userPosition.lat, userPosition.lng], {
        icon: userIcon,
        zIndexOffset: 1000,
      }).addTo(map);
    }
  }, [mapReady, userPosition]);

  // ── Кнопка «Где я?» ────────────────────────────────────────────────────────

  const handleLocate = useCallback(() => {
    const map = mapRef.current;
    if (!userPosition || !map) {
      toast.error('Местоположение пока не определено');
      return;
    }
    map.flyTo([userPosition.lat, userPosition.lng], 16, { duration: 0.6 });
  }, [userPosition]);

  const handleExit = useCallback(() => {
    if (route?.id) {
      navigate(`/route/${route.id}/completed`);
    } else {
      navigate(-1);
      if (window.history.length <= 1) navigate('/search');
    }
  }, [navigate, route?.id]);

  if (loading) {
    return (
      <div className="flex h-[100dvh] w-full min-h-[100dvh] items-center justify-center bg-neutral-100">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-neutral-600">Загрузка маршрута...</p>
        </div>
      </div>
    );
  }

  if (error && !route) {
    return (
      <div className="flex h-[100dvh] w-full min-h-[100dvh] flex-col items-center justify-center gap-4 bg-neutral-100 p-6">
        <p className="text-center text-neutral-700">{error}</p>
        <button
          type="button"
          onClick={() => navigate('/search')}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Вернуться к поиску
        </button>
      </div>
    );
  }

  // Стартовый экран: маршрут загружен, но пользователь ещё не нажал «Начать» (GPS не запрашиваем до клика)
  if (route && !isStarted) {
    return (
      <div className="flex h-[100dvh] w-full min-h-[100dvh] flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-amber-50 to-white">
        <div className="flex flex-col items-center gap-6 max-w-sm">
          <div className="w-full rounded-2xl border border-amber-200 bg-white/90 px-6 py-5 shadow-lg">
            <h1 className="text-xl font-bold text-neutral-900 truncate">
              {route.title ?? 'Маршрут'}
            </h1>
            <div className="mt-3 flex items-center justify-center gap-2 text-neutral-600">
              <Ruler className="h-5 w-5 shrink-0 text-amber-600" />
              <span className="text-lg font-medium">{formatDistance(route.total_distance ?? route.distance)}</span>
            </div>
          </div>
          <p className="text-sm text-neutral-500">
            Нажмите кнопку ниже, чтобы включить карту и отслеживание по GPS
          </p>
          <button
            type="button"
            onClick={() => setIsStarted(true)}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-amber-500 px-8 py-5 text-xl font-semibold text-neutral-900 shadow-lg shadow-amber-500/30 transition-all hover:bg-amber-600 active:scale-[0.98]"
          >
            <Navigation className="h-7 w-7" />
            Начать маршрут
          </button>
        </div>
      </div>
    );
  }

  // Нижний отступ с учётом safe area (челка iOS, панель навигации) — чтобы элементы не перекрывались
  const bottomSafe = 'bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]';

  // Режим навигации: карта на весь экран, GPS уже запущен
  return (
    <div className="relative h-[100dvh] w-full min-h-[100dvh] overflow-hidden bg-neutral-200">
      {/* Карта: контейнер с классом для стилей Leaflet (отступ контролов от нижнего края) */}
      <div ref={mapDivRef} className="absolute inset-0 z-0 live-nav-map" />

      {/* Кнопка «Завершить» / «Выйти» */}
      <button
        type="button"
        onClick={handleExit}
        className="absolute top-4 right-4 z-[1000] flex items-center gap-2 rounded-full bg-neutral-900/95 px-4 py-2.5 text-sm font-semibold text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black"
        title="Завершить навигацию"
      >
        <X className="h-5 w-5" />
        Завершить
      </button>

      {/* Кнопка «Где я?» — отступ снизу с учётом safe area */}
      <button
        type="button"
        onClick={handleLocate}
        className={`absolute ${bottomSafe} right-4 z-[1000] flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/95 shadow-lg backdrop-blur-sm transition-colors hover:bg-amber-600`}
        title="Центрировать на моём местоположении"
      >
        <Locate className="h-6 w-6 text-neutral-900" />
      </button>

      {/* Блок статистики внизу — отступ с учётом safe area */}
      <div className={`absolute ${bottomSafe} left-4 right-20 z-[1000] rounded-xl bg-neutral-900/90 px-4 py-3 shadow-lg backdrop-blur-sm`}>
        <p className="truncate font-semibold text-white">
          {route?.title ?? 'Маршрут'}
        </p>
        <div className="mt-1 flex items-center gap-2 text-sm text-neutral-200">
          <Ruler className="h-4 w-4 shrink-0 text-amber-400" />
          <span>{formatDistance(route?.total_distance ?? route?.distance)}</span>
          {userPosition && (
            <span className="ml-2 text-xs text-amber-300">• GPS активен</span>
          )}
        </div>
      </div>

      {/* Оверлей «Вы у цели!» — в радиусе 50 м от финиша */}
      {showNearFinishOverlay && (
        <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <p className="text-center text-lg font-semibold text-neutral-900">
              Вы у цели! Завершить маршрут?
            </p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setShowNearFinishOverlay(false)}
                className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Ещё нет
              </button>
              <button
                type="button"
                onClick={handleExit}
                className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-amber-600"
              >
                Завершить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
