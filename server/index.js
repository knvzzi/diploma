import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { getSupabaseAnon, getSupabaseWithAuth } from './lib/supabase.js';

const app  = express();
const PORT = process.env.PORT || 5000;

// ─── ПЕРВЫЙ роут: /api/routes/public (выше всех роутов с :id, иначе будет Cannot GET)
// Стабильный запрос: id, title, …, parent_id, parent_route_id (миграция 21 — каноническое поле форка).
// start_lat/start_lng из первой точки; при отсутствии точек — null, без 500.
app.get('/api/routes/public', async (req, res) => {
  try {
    const supabase = getSupabaseAnon();

    // Загружаем маршруты без join на profiles — join через alias ненадёжен
    // при наличии нескольких FK от routes к profiles (Supabase может взять не тот).
    // Профили подгружаем отдельным запросом по уникальным author_id.
    const { data: dataPlain, error: plainError } = await supabase
      .from('routes')
      .select('id, title, description, activity_type, total_distance, total_elevation, duration, author_id, is_public, likes_count, parent_id, parent_route_id, cover_image_url, created_at')
      .eq('is_public', true)
      .order('created_at', { ascending: false });

    if (plainError) {
      console.error('[GET /api/routes/public] routes:', plainError);
      return res.status(500).json({ error: plainError.message });
    }

    let routes = (dataPlain ?? []).map((r) => ({ ...r, author: null }));
    const authorIds = [...new Set(routes.map((r) => r.author_id).filter(Boolean))];
    if (authorIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username, full_name, last_name, avatar_url')
        .in('id', authorIds);
      const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
      routes = routes.map((r) => ({ ...r, author: byId.get(r.author_id) ?? null }));
    }

    if (!routes?.length) {
      console.log('Данные успешно отправлены');
      return res.status(200).json([]);
    }

    const routeIds = routes.map((r) => r.id);

    // Первый день каждого маршрута (для стартовой точки)
    const { data: days } = await supabase
      .from('days')
      .select('id, route_id, day_number')
      .in('route_id', routeIds)
      .order('day_number', { ascending: true });

    const routeFirstDayId = new Map();
    for (const d of days ?? []) {
      if (!routeFirstDayId.has(d.route_id)) {
        routeFirstDayId.set(d.route_id, d.id);
      }
    }

    // Первая точка каждого первого дня. Если точек нет — start_lat/start_lng остаются null, ошибки нет.
    const firstDayIds = [...routeFirstDayId.values()];
    const dayFirstPoint = new Map();

    if (firstDayIds.length > 0) {
      const { data: points } = await supabase
        .from('points')
        .select('day_id, geom, order_index')
        .in('day_id', firstDayIds)
        .order('order_index', { ascending: true });

      for (const pt of points ?? []) {
        if (!dayFirstPoint.has(pt.day_id)) {
          dayFirstPoint.set(pt.day_id, pt);
        }
      }
    }

    const parseGeom = (raw) => {
      if (raw == null) return { lat: null, lng: null };
      try {
        const g = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!g || !Array.isArray(g?.coordinates)) return { lat: null, lng: null };
        const [lng, lat] = g.coordinates;
        return { lat, lng };
      } catch {
        return { lat: null, lng: null };
      }
    };

    const result = routes.map((route) => {
      const firstDayId = routeFirstDayId.get(route.id);
      const firstPoint = firstDayId ? dayFirstPoint.get(firstDayId) : null;
      const { lat: start_lat, lng: start_lng } = parseGeom(firstPoint?.geom ?? null);
      let profile = route.author;
      if (Array.isArray(profile)) profile = profile[0];
      const author = profile?.id
        ? {
            id: profile.id,
            username: profile.username ?? null,
            full_name: profile.full_name ?? null,
            last_name: profile.last_name ?? null,
            avatar_url: profile.avatar_url ?? null,
          }
        : null;
      const author_name = author?.username
        ? `@${author.username}`
        : (author?.full_name ?? null);
      const author_avatar = author?.avatar_url ?? null;
      const { author: _authorRaw, ...routeRest } = route;
      const likesCount = routeRest.likes_count ?? 0;
      const totalDistance = routeRest.total_distance ?? null;
      const distance = routeRest.distance ?? totalDistance;
      const duration = routeRest.duration ?? null;
      const totalElevation = routeRest.total_elevation ?? null;

      return {
        id: routeRest.id,
        title: routeRest.title,
        description: routeRest.description,
        activity_type: routeRest.activity_type,
        distance,
        duration,
        total_elevation: totalElevation,
        author_id: routeRest.author_id,
        is_public: routeRest.is_public,
        likes_count: likesCount,
        parent_id: routeRest.parent_id,
        /** Каноническая ссылка на оригинал (fork); при старых данных может быть только parent_id */
        parent_route_id: routeRest.parent_route_id ?? routeRest.parent_id ?? null,
        total_distance: totalDistance,
        cover_image_url: routeRest.cover_image_url ?? null,
        created_at: routeRest.created_at ?? null,
        start_lat,
        start_lng,
        author,
        author_name,
        author_avatar,
      };
    });

    console.log('Данные успешно отправлены');
    res.status(200).json(result);
  } catch (err) {
    console.error('[GET /api/routes/public]', err);
    res.status(500).json({ error: err.message });
  }
});

// Разрешаем запросы с локального фронта и прод-доменов Vercel.
// Важно для превью-деплоев: *.vercel.app
const allowedOrigins = new Set(
  [
    process.env.CLIENT_URL,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://diploma-umber.vercel.app',
  ].filter(Boolean),
);

const isVercelPreviewOrigin = (origin) => {
  try {
    return /\.vercel\.app$/i.test(new URL(origin).hostname);
  } catch {
    return false;
  }
};

app.use(cors({
  origin(origin, callback) {
    // origin отсутствует у части non-browser запросов (healthchecks, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin) || isVercelPreviewOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
}));

// Парсим JSON-тела запросов
app.use(express.json());

// ─── Остальные API-роуты (специфичные пути выше параметризованных /:id) ─────

/**
 * GET /api/routes/:id/details
 * Полные данные маршрута для страницы детального просмотра:
 *  - маршрут (route) + автор из profiles
 *  - points: точки пути для отрисовки линии (отсортированы по day_number, order_index)
 *  - pois: метки из route_pois (если таблица пустая — pois: [])
 */
app.get('/api/routes/:id/details', async (req, res) => {
  const { id } = req.params;
  // JWT из заголовка: администратор видит приватные маршруты (RLS get_my_role() = 'admin')
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const supabase = getSupabaseWithAuth(token);

  const parseGeom = (geomRaw) => {
    try {
      const g = typeof geomRaw === 'string' ? JSON.parse(geomRaw) : geomRaw;
      if (!Array.isArray(g?.coordinates)) return null;
      const [lng, lat] = g.coordinates;
      return { lat, lng };
    } catch {
      return null;
    }
  };

  try {
    // Маршрут и дни — параллельно
    const [routeRes, daysRes] = await Promise.all([
      supabase.from('routes').select('*').eq('id', id).single(),
      supabase.from('days').select('id, day_number, title, distance, elevation_gain').eq('route_id', id).order('day_number', { ascending: true }),
    ]);

    if (routeRes.error || !routeRes.data) {
      const code = routeRes.error?.code === 'PGRST116' ? 404 : 500;
      console.error('[GET /api/routes/:id/details] route:', routeRes.error?.message ?? 'not found');
      return res.status(code).json({ error: routeRes.error?.message ?? 'Маршрут не найден' });
    }

    const route = routeRes.data;
    const days = daysRes.data ?? [];
    const dayIds = days.map((d) => d.id);
    const dayOrder = new Map(days.map((d, i) => [d.id, i]));

    // POI: запрашиваем images (миграция 12) или image_urls (11), при ошибке — только базовые поля
    const baseSelect = 'id, day_id, geom, name, description, image_url, icon_name, color, order_index';
    function toPhotoArray(poi) {
      let arr = poi.images ?? poi.image_urls;
      if (typeof arr === 'string') {
        try { arr = JSON.parse(arr); } catch { arr = null; }
      }
      if (Array.isArray(arr) && arr.length > 0) return arr;
      if (poi.image_url && typeof poi.image_url === 'string' && poi.image_url.trim()) return [poi.image_url];
      return [];
    }
    let poisRes = await supabase
      .from('route_pois')
      .select(`${baseSelect}, images`)
      .eq('route_id', id)
      .order('order_index', { ascending: true });
    if (poisRes.error) {
      poisRes = await supabase
        .from('route_pois')
        .select(`${baseSelect}, image_urls`)
        .eq('route_id', id)
        .order('order_index', { ascending: true });
    }
    if (poisRes.error) {
      poisRes = await supabase
        .from('route_pois')
        .select(baseSelect)
        .eq('route_id', id)
        .order('order_index', { ascending: true });
    }

    let pois = [];
    if (poisRes.data && Array.isArray(poisRes.data)) {
      pois = poisRes.data
        .map((poi) => {
          const coord = parseGeom(poi.geom);
          if (!coord) return null;
          const urls = toPhotoArray(poi);
          return {
            id: poi.id,
            dayId: poi.day_id,
            lat: coord.lat,
            lng: coord.lng,
            name: poi.name ?? '',
            description: poi.description ?? '',
            image_url: poi.image_url ?? (urls[0] ?? null),
            images: urls,
            image_urls: urls,
            icon_name: poi.icon_name ?? 'map-pin',
            color: poi.color ?? '#ef4444',
          };
        })
        .filter(Boolean);
    }
    if (poisRes.error) {
      console.warn('[GET /api/routes/:id/details] route_pois:', poisRes.error.message, '- returning pois: []');
    }

    // Точки пути: второй раунд — нужны day_ids
    let points = [];
    if (dayIds.length > 0) {
      const { data: pointsRaw, error: pointsError } = await supabase
        .from('points')
        .select('id, day_id, geom, order_index')
        .in('day_id', dayIds)
        .order('order_index', { ascending: true });

      if (pointsError) {
        console.error('[GET /api/routes/:id/details] points:', pointsError.message);
        return res.status(500).json({ error: pointsError.message });
      }

      const dayNumberMap = new Map(days.map((d) => [d.id, d.day_number ?? 0]));

      const withCoord = (pointsRaw ?? [])
        .map((pt) => {
          const coord = parseGeom(pt.geom);
          if (!coord) return null;
          return {
            id: pt.id,
            day_id: pt.day_id,
            day_number: dayNumberMap.get(pt.day_id) ?? 0,
            order_index: pt.order_index ?? 0,
            lat: coord.lat,
            lng: coord.lng,
          };
        })
        .filter(Boolean);

      // Сортировка: по day_number, затем по order_index
      points = withCoord.sort((a, b) => {
        if (a.day_number !== b.day_number) return a.day_number - b.day_number;
        return a.order_index - b.order_index;
      });
    }

    // Профиль автора (author_id может совпадать с auth.users.id / profiles.id)
    let author = null;
    let author_name = null;
    let author_avatar = null;
    if (route.author_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, username, full_name, last_name, avatar_url')
        .eq('id', route.author_id)
        .maybeSingle();
      if (profile) {
        author = {
          id: profile.id,
          username: profile.username ?? null,
          full_name: profile.full_name ?? null,
          last_name: profile.last_name ?? null,
          avatar_url: profile.avatar_url ?? null,
        };
        author_name = author.username ? `@${author.username}` : (author.full_name ?? null);
        author_avatar = author.avatar_url ?? null;
      }
    }

    const { profiles: _p, ...routeRest } = route;

    // Формируем массив дней с числовыми значениями дистанции и набора высоты.
    // Используется на фронтенде для разбивки маршрута по дням в карточке деталей.
    const daysForResponse = (daysRes.data ?? []).map((d) => ({
      id:             d.id,
      day_number:     d.day_number ?? 0,
      title:          d.title ?? null,
      distance:       Number(d.distance ?? 0),
      elevation_gain: Number(d.elevation_gain ?? 0),
    }));

    const parentRouteId = route.parent_route_id ?? route.parent_id ?? null;

    res.json({
      ...routeRest,
      /** Единое поле для фронта: старые копии могли иметь только parent_id */
      parent_route_id: parentRouteId,
      author,
      author_name,
      author_avatar,
      days: daysForResponse,
      points,
      pois,
    });
  } catch (err) {
    console.error('[GET /api/routes/:id/details]', err);
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/health
 * Проверочный роут — убеждаемся, что сервер запущен и работает.
 * Фронтенд может пинговать этот эндпоинт для проверки соединения.
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Сервер работает',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/routes/:id/geometry
 * Возвращает полный массив координат маршрута для отрисовки полилинии на карте.
 * Точки сортируются по day_number, затем order_index.
 * Координаты в формате [[lat, lng], ...] — как ожидает Leaflet L.polyline().
 */
app.get('/api/routes/:id/geometry', async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = getSupabaseAnon();

    // Все дни маршрута (нужны для сортировки по day_number)
    const { data: days, error: daysError } = await supabase
      .from('days')
      .select('id, day_number')
      .eq('route_id', id)
      .order('day_number', { ascending: true });

    if (daysError) {
      console.error('[GET /api/routes/:id/geometry] days:', daysError);
      return res.status(500).json({ error: daysError.message });
    }
    if (!days?.length) return res.json({ coordinates: [] });

    const dayIds = days.map((d) => d.id);

    // Все точки по этим дням
    const { data: points, error: pointsError } = await supabase
      .from('points')
      .select('day_id, geom, order_index')
      .in('day_id', dayIds)
      .order('order_index', { ascending: true });

    if (pointsError) {
      console.error('[GET /api/routes/:id/geometry] points:', pointsError);
      return res.status(500).json({ error: pointsError.message });
    }

    // Сортируем: сначала по позиции дня, потом по order_index внутри дня
    const dayOrderIndex = new Map(days.map((d, i) => [d.id, i]));
    const sorted = (points ?? [])
      .filter((pt) => pt.geom)
      .sort((a, b) => {
        const dA = dayOrderIndex.get(a.day_id) ?? 0;
        const dB = dayOrderIndex.get(b.day_id) ?? 0;
        if (dA !== dB) return dA - dB;
        return (a.order_index ?? 0) - (b.order_index ?? 0);
      });

    // Разбираем geom и формируем [[lat, lng], ...] для Leaflet
    const coordinates = sorted.reduce((acc, pt) => {
      const g = typeof pt.geom === 'string' ? JSON.parse(pt.geom) : pt.geom;
      if (!Array.isArray(g?.coordinates)) return acc;
      const [lng, lat] = g.coordinates;
      acc.push([lat, lng]);
      return acc;
    }, []);

    res.json({ coordinates });
  } catch (err) {
    console.error('[GET /api/routes/:id/geometry]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/routes/:id/fork
 * Устаревший серверный fork (дублировал INSERT вместе с клиентским сохранением).
 * Основной сценарий: фронт открывает /create?clone=:id и один раз сохраняет копию через Supabase.
 * Оставлено для совместимости; не вызывается из UI.
 */
app.post('/api/routes/:id/fork', async (req, res) => {
  const routeId = req.params.id;
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация. Передайте заголовок Authorization: Bearer <token>.' });
  }

  const supabase = getSupabaseWithAuth(token);

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return res.status(401).json({ error: 'Неверный или истёкший токен.' });
    }
    const userId = user.id;

    // Загружаем исходный маршрут (RLS: только если публичный или мы автор)
    const { data: route, error: routeError } = await supabase
      .from('routes')
      .select('id, title, description, activity_type, total_distance, total_elevation, duration, cover_image_url')
      .eq('id', routeId)
      .single();

    if (routeError || !route) {
      return res.status(routeError?.code === 'PGRST116' ? 404 : 500)
        .json({ error: routeError?.message ?? 'Маршрут не найден или доступ запрещён.' });
    }

    // Дни маршрута
    const { data: days, error: daysError } = await supabase
      .from('days')
      .select('id, day_number, title, distance, elevation_gain')
      .eq('route_id', routeId)
      .order('day_number');

    if (daysError) {
      console.error('[fork] days', daysError);
      return res.status(500).json({ error: daysError.message });
    }

    const dayIds = (days ?? []).map((d) => d.id);
    if (dayIds.length === 0) {
      return res.status(400).json({ error: 'У маршрута нет дневных сегментов.' });
    }

    // Точки по всем дням (нужны lat, lng из geom — PostGIS в ответе часто как GeoJSON)
    const { data: points, error: pointsError } = await supabase
      .from('points')
      .select('id, day_id, order_index, name, description, photos, is_waypoint, geom')
      .in('day_id', dayIds)
      .order('day_id')
      .order('order_index');

    if (pointsError) {
      console.error('[fork] points', pointsError);
      return res.status(500).json({ error: pointsError.message });
    }

    // Новый маршрут (копия)
    const { data: newRoute, error: insertRouteError } = await supabase
      .from('routes')
      .insert({
        author_id:       userId,
        parent_id:       routeId,
        title:           (route.title || 'Маршрут').trim() + ' (копия)',
        description:     route.description ?? null,
        activity_type:   route.activity_type ?? 'foot',
        total_distance:  route.total_distance ?? 0,
        total_elevation: route.total_elevation ?? 0,
        duration:        route.duration ?? null,
        cover_image_url: route.cover_image_url ?? null,
        is_public:       false,
        likes_count:     0,
      })
      .select('id')
      .single();

    if (insertRouteError) {
      console.error('[fork] insert route', insertRouteError);
      return res.status(500).json({ error: insertRouteError.message });
    }
    const newRouteId = newRoute.id;

    // Соответствие старый day_id → новый day (после вставки)
    const oldToNewDay = new Map();
    for (const d of days ?? []) {
      const { data: newDay, error: insertDayError } = await supabase
        .from('days')
        .insert({
          route_id:      newRouteId,
          day_number:    d.day_number,
          title:         d.title ?? null,
          distance:      d.distance ?? 0,
          elevation_gain: d.elevation_gain ?? 0,
        })
        .select('id')
        .single();
      if (insertDayError) {
        console.error('[fork] insert day', insertDayError);
        return res.status(500).json({ error: insertDayError.message });
      }
      oldToNewDay.set(d.id, newDay.id);
    }

    // Преобразуем geom в { lat, lng }. PostGIS в Supabase возвращает GeoJSON: { type: 'Point', coordinates: [lng, lat] }
    const pointToPayload = (pt) => {
      let lat = null;
      let lng = null;
      let geom = pt.geom;
      if (typeof geom === 'string') {
        try {
          geom = JSON.parse(geom);
        } catch {
          geom = null;
        }
      }
      if (geom && Array.isArray(geom.coordinates)) {
        const [x, y] = geom.coordinates;
        lng = x;
        lat = y;
      }
      return {
        lat,
        lng,
        name:        pt.name ?? '',
        description: pt.description ?? '',
        image_url:   (pt.photos && pt.photos[0]) ? pt.photos[0] : '',
        is_waypoint: pt.is_waypoint ?? true,
      };
    };

    // Группируем точки по day_id и вставляем пакетами через RPC
    const pointsByDay = new Map();
    for (const pt of points ?? []) {
      const newDayId = oldToNewDay.get(pt.day_id);
      if (!newDayId) continue;
      const payload = pointToPayload(pt);
      if (payload.lat == null || payload.lng == null) continue;
      if (!pointsByDay.has(newDayId)) pointsByDay.set(newDayId, []);
      pointsByDay.get(newDayId).push(payload);
    }

    for (const [dayId, payloads] of pointsByDay) {
      const { error: rpcError } = await supabase.rpc('insert_route_points', {
        p_day_id: dayId,
        p_points: payloads,
      });
      if (rpcError) {
        console.error('[fork] insert_route_points', rpcError);
        return res.status(500).json({ error: rpcError.message });
      }
    }

    return res.status(201).json({
      id: newRouteId,
      message: 'Маршрут скопирован. Можете отредактировать его в «Мои маршруты».',
    });
  } catch (err) {
    console.error('[POST /api/routes/:id/fork]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/routes/:id/like-status
 * Возвращает { liked: boolean } для текущего пользователя. Без авторизации — { liked: false }.
 */
app.get('/api/routes/:id/like-status', async (req, res) => {
  try {
    const routeId = req.params.id;
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.json({ liked: false });
    }

    const supabase = getSupabaseWithAuth(token);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return res.json({ liked: false });
    }

    const { data: row } = await supabase
      .from('route_likes')
      .select('route_id')
      .eq('route_id', routeId)
      .eq('user_id', user.id)
      .maybeSingle();

    res.json({ liked: !!row });
  } catch (err) {
    console.error('[GET /api/routes/:id/like-status]', err);
    res.json({ liked: false });
  }
});

/**
 * POST /api/routes/:id/like
 * Переключает лайк: добавляет или удаляет запись в route_likes и обновляет likes_count в routes.
 * Требует авторизации (Bearer JWT).
 */
app.post('/api/routes/:id/like', async (req, res) => {
  const routeId = req.params.id;
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация.' });
  }

  const supabase = getSupabaseWithAuth(token);

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return res.status(401).json({ error: 'Неверный или истёкший токен.' });
    }
    const userId = user.id;

    const { data: existing } = await supabase
      .from('route_likes')
      .select('route_id')
      .eq('route_id', routeId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      await supabase.from('route_likes').delete().eq('route_id', routeId).eq('user_id', userId);
      const { data: r } = await supabase.from('routes').select('likes_count').eq('id', routeId).single();
      const newCount = Math.max(0, (r?.likes_count ?? 0) - 1);
      await supabase.from('routes').update({ likes_count: newCount }).eq('id', routeId);
      return res.json({ liked: false, likes_count: newCount });
    } else {
      await supabase.from('route_likes').insert({ route_id: routeId, user_id: userId });
      const { data: r } = await supabase.from('routes').select('likes_count').eq('id', routeId).single();
      const newCount = (r?.likes_count ?? 0) + 1;
      await supabase.from('routes').update({ likes_count: newCount }).eq('id', routeId);
      return res.json({ liked: true, likes_count: newCount });
    }
  } catch (err) {
    console.error('[POST /api/routes/:id/like]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/routes/:id/save-status
 * Возвращает { saved: boolean } для текущего пользователя. Без авторизации — { saved: false }.
 */
app.get('/api/routes/:id/save-status', async (req, res) => {
  try {
    const routeId = req.params.id;
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.json({ saved: false });
    }

    const supabase = getSupabaseWithAuth(token);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return res.json({ saved: false });
    }

    const { data: row } = await supabase
      .from('saved_routes')
      .select('route_id')
      .eq('route_id', routeId)
      .eq('user_id', user.id)
      .maybeSingle();

    res.json({ saved: !!row });
  } catch (err) {
    console.error('[GET /api/routes/:id/save-status]', err);
    res.json({ saved: false });
  }
});

/**
 * POST /api/routes/:id/save
 * Переключает закладку: добавляет или удаляет запись в saved_routes. Не влияет на likes_count.
 * Требует авторизации (Bearer JWT).
 */
app.post('/api/routes/:id/save', async (req, res) => {
  const routeId = req.params.id;
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация.' });
  }

  const supabase = getSupabaseWithAuth(token);

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return res.status(401).json({ error: 'Неверный или истёкший токен.' });
    }
    const userId = user.id;

    const { data: existing } = await supabase
      .from('saved_routes')
      .select('route_id')
      .eq('route_id', routeId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      await supabase.from('saved_routes').delete().eq('route_id', routeId).eq('user_id', userId);
      return res.json({ saved: false });
    } else {
      await supabase.from('saved_routes').insert({ route_id: routeId, user_id: userId });
      return res.json({ saved: true });
    }
  } catch (err) {
    console.error('[POST /api/routes/:id/save]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/routes/:id/comments
 * Список комментариев с ручным маппингом author_name и author_avatar_url из profiles.
 */
app.get('/api/routes/:id/comments', async (req, res) => {
  try {
    const supabase = getSupabaseAnon();

    // Шаг 1: все комментарии маршрута
    const { data: comments, error } = await supabase
      .from('route_comments')
      .select('*')
      .eq('route_id', req.params.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[GET /api/routes/:id/comments]', error);
      return res.status(500).json({ error: error.message });
    }

    // Шаг 2: нет комментариев — сразу отдаём пустой массив
    if (!comments || comments.length === 0) {
      return res.json([]);
    }

    // Шаг 3: уникальные ID авторов (поддержка и user_id, и author_id из разных миграций)
    const userIds = [...new Set(comments.map((c) => c.user_id ?? c.author_id).filter(Boolean))];

    // Шаг 4: один запрос за профилями
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', userIds);

    const profileList = profiles ?? [];

    // Шаг 5: склейка — каждому комментарию добавляем author_name и author_avatar_url
    const result = comments.map((c) => {
      const authorKey = c.user_id ?? c.author_id;
      const profile = profileList.find((p) => String(p.id) === String(authorKey));
      const body = c.text ?? c.content ?? '';
      return {
        /** Первичный ключ route_comments — обязателен для жалоб (reports.reported_comment_id) */
        id: c.id,
        author_id: authorKey,
        text: body,
        created_at: c.created_at,
        author_name: profile ? profile.full_name : 'Пользователь',
        author_avatar_url: profile ? profile.avatar_url : null,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('[GET /api/routes/:id/comments]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/routes/:id/comments
 * Добавить комментарий к маршруту. Тело: { text: string }. Требует авторизации.
 */
app.post('/api/routes/:id/comments', async (req, res) => {
  const routeId = req.params.id;
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация.' });
  }

  const supabase = getSupabaseWithAuth(token);
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

  if (!text) {
    return res.status(400).json({ error: 'Текст комментария не может быть пустым.' });
  }

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return res.status(401).json({ error: 'Неверный или истёкший токен.' });
    }

    const { data: comment, error: insertError } = await supabase
      .from('route_comments')
      .insert({ route_id: routeId, user_id: user.id, text })
      .select('id, user_id, text, created_at')
      .single();

    if (insertError) {
      console.error('[POST /api/routes/:id/comments]', insertError);
      return res.status(500).json({ error: insertError.message });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, avatar_url')
      .eq('id', user.id)
      .single();

    res.status(201).json({
      id: comment.id,
      author_id: comment.user_id,
      text: comment.text,
      created_at: comment.created_at,
      author_name: profile?.full_name ?? 'Пользователь',
      author_avatar_url: profile?.avatar_url ?? null,
    });
  } catch (err) {
    console.error('[POST /api/routes/:id/comments]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/routes/:routeId/comments/:commentId
 * Удаление своего комментария. Требует авторизации; удалить можно только свой комментарий.
 */
app.delete('/api/routes/:routeId/comments/:commentId', async (req, res) => {
  const { routeId, commentId } = req.params;
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация.' });
  }

  const supabase = getSupabaseWithAuth(token);
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return res.status(401).json({ error: 'Неверный или истёкший токен.' });
    }

    const { data: row, error: fetchError } = await supabase
      .from('route_comments')
      .select('id, user_id')
      .eq('id', commentId)
      .eq('route_id', routeId)
      .maybeSingle();

    if (fetchError || !row) {
      return res.status(404).json({ error: 'Комментарий не найден.' });
    }
    if (row.user_id !== user.id) {
      return res.status(403).json({ error: 'Можно удалить только свой комментарий.' });
    }

    const { error: deleteError } = await supabase
      .from('route_comments')
      .delete()
      .eq('id', commentId)
      .eq('route_id', routeId);

    if (deleteError) {
      console.error('[DELETE /api/routes/:routeId/comments/:commentId]', deleteError);
      return res.status(500).json({ error: deleteError.message });
    }

    res.status(204).send();
  } catch (err) {
    console.error('[DELETE /api/routes/:routeId/comments/:commentId]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Запуск сервера ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});
