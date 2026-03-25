import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

// ─── Константы ───────────────────────────────────────────────────────────────

const CHART_COLOR = '#3b82f6';

// ─── Кастомный тултип ────────────────────────────────────────────────────────

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { elevation, distance, dayColor } = payload[0].payload;
  return (
    <div className="rounded-lg border bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm">
      <p className="text-xs font-semibold text-foreground">
        {elevation} м{' '}
        <span className="font-normal text-muted-foreground">над уровнем моря</span>
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">Дистанция: {distance} км</p>
    </div>
  );
}

// ─── Кастомный курсор ─────────────────────────────────────────────────────────

function CustomCursor({ points: pts, height }) {
  if (!pts?.length) return null;
  const { x } = pts[0];
  return (
    <line
      x1={x} y1={0} x2={x} y2={height}
      stroke="#6b7280" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.6}
    />
  );
}

// ─── Статистика высот ────────────────────────────────────────────────────────

function computeStats(data) {
  if (!data.length) return { minElev: 0, maxElev: 0, gain: 0, loss: 0 };
  let minElev = Infinity, maxElev = -Infinity, gain = 0, loss = 0;
  for (let i = 0; i < data.length; i++) {
    const ele = data[i].elevation;
    if (ele < minElev) minElev = ele;
    if (ele > maxElev) maxElev = ele;
    if (i > 0) {
      const delta = ele - data[i - 1].elevation;
      if (delta > 0) gain += delta; else loss += Math.abs(delta);
    }
  }
  return { minElev: Math.round(minElev), maxElev: Math.round(maxElev), gain: Math.round(gain), loss: Math.round(loss) };
}

// ─── Ступенчатый SVG-градиент (повторяет логику основного ElevationProfile) ────

function buildGradientStops(data) {
  const fb = CHART_COLOR;
  if (!data.length) return [{ offset: '0%', color: fb }, { offset: '100%', color: fb }];
  const maxDist = data[data.length - 1].distance;
  if (!maxDist) {
    const c = data[0].dayColor ?? fb;
    return [{ offset: '0%', color: c }, { offset: '100%', color: c }];
  }
  const stops = [{ offset: '0%', color: data[0].dayColor ?? fb }];
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1], curr = data[i];
    if (prev.dayColor && curr.dayColor && prev.dayColor !== curr.dayColor) {
      const pct = (prev.distance / maxDist) * 100;
      stops.push({ offset: `${pct.toFixed(4)}%`, color: prev.dayColor });
      stops.push({ offset: `${(pct + 0.001).toFixed(4)}%`, color: curr.dayColor });
    }
  }
  stops.push({ offset: '100%', color: data[data.length - 1].dayColor ?? fb });
  return stops;
}

// ─── Бейдж статистики ────────────────────────────────────────────────────────

function StatBadge({ label, value, color }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground/70">{label}:</span>
      <span className={`font-semibold ${color}`}>{value}</span>
    </div>
  );
}

// ─── Главный компонент ────────────────────────────────────────────────────────

/**
 * Автономный график профиля высот.
 * Читает данные из пропа `elevationData` вместо Zustand-стора.
 * Используется на странице просмотра маршрута.
 *
 * @param {{ distance: number, elevation: number, lat?: number, lng?: number, dayColor?: string }[]} elevationData
 * @param {(point: { lat: number, lng: number, dayColor?: string } | null) => void} onHoverPoint — вызывается при наведении (lat, lng, dayColor для цвета кружка на карте) или null при уходе мыши
 */
export default function ElevationProfileView({ elevationData = [], onHoverPoint }) {
  const stats = useMemo(() => computeStats(elevationData), [elevationData]);

  const gradientStops = useMemo(() => buildGradientStops(elevationData), [elevationData]);

  // Границы смены дней — вертикальные разделители
  const dayBoundaries = useMemo(() => {
    const result = [];
    for (let i = 1; i < elevationData.length; i++) {
      const prev = elevationData[i - 1], curr = elevationData[i];
      if (prev.dayColor && curr.dayColor && prev.dayColor !== curr.dayColor) {
        result.push({ distance: prev.distance, dayColor: prev.dayColor });
      }
    }
    return result;
  }, [elevationData]);

  if (!elevationData.length) return null;

  const yMin = Math.max(0, stats.minElev - 30);
  const yMax = stats.maxElev + 50;

  /**
   * При наведении на график извлекаем координаты точки и передаём в onHoverPoint,
   * чтобы на карте отображался «бегающий кружок» (как на странице создания маршрута).
   * Recharts не всегда передаёт activePayload в onMouseMove — используем fallback по индексу.
   */
  const handleMouseMove = (evt) => {
    if (!onHoverPoint) return;
    let payload = evt?.activePayload?.[0]?.payload;
    if (!payload) {
      const idx = evt?.activeTooltipIndex ?? evt?.activeIndex;
      if (idx != null && elevationData[idx]) payload = elevationData[idx];
    }
    if (!payload) return;
    const dayColor = payload.dayColor ?? null;
    // Поддержка lat/lng и coordinates (GeoJSON: [lng, lat]); передаём dayColor для цвета кружка на карте
    if (payload.lat != null && payload.lng != null) {
      onHoverPoint({ lat: Number(payload.lat), lng: Number(payload.lng), dayColor });
    } else if (Array.isArray(payload.coordinates) && payload.coordinates.length >= 2) {
      const [lng, lat] = payload.coordinates;
      onHoverPoint({ lat: Number(lat), lng: Number(lng), dayColor });
    }
  };

  const handleMouseLeave = () => {
    if (onHoverPoint) onHoverPoint(null);
  };

  return (
    <div className="flex h-full flex-col px-3 pb-2 pt-2">
      {/* Статистика */}
      <div className="mb-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <StatBadge label="Мин." value={`${stats.minElev} м`} color="text-sky-500" />
        <StatBadge label="Макс." value={`${stats.maxElev} м`} color="text-orange-500" />
        <StatBadge label="↑" value={`${stats.gain} м`} color="text-emerald-500" />
        <StatBadge label="↓" value={`${stats.loss} м`} color="text-rose-500" />
      </div>

      {/* График */}
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={elevationData}
            margin={{ top: 4, right: 12, left: 0, bottom: 0 }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              <linearGradient id="epv-stroke" x1="0" y1="0" x2="1" y2="0">
                {gradientStops.map((s, i) => (
                  <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={1} />
                ))}
              </linearGradient>
              <linearGradient id="epv-fill" x1="0" y1="0" x2="1" y2="0">
                {gradientStops.map((s, i) => (
                  <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={0.25} />
                ))}
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />

            <XAxis
              dataKey="distance"
              type="number"
              domain={[0, 'dataMax']}
              tickFormatter={(v) => `${v} км`}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              tickCount={5}
            />
            <YAxis
              domain={[yMin, yMax]}
              tickFormatter={(v) => `${v}м`}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              width={38}
              tickCount={4}
            />

            <Tooltip
              content={(props) => <CustomTooltip {...props} />}
              cursor={<CustomCursor />}
              isAnimationActive={false}
            />

            <Area
              type="monotone"
              dataKey="elevation"
              stroke="url(#epv-stroke)"
              strokeWidth={2}
              fill="url(#epv-fill)"
              dot={false}
              activeDot={(dotProps) => (
                <circle
                  key={`adot-${dotProps.cx}-${dotProps.cy}`}
                  cx={dotProps.cx}
                  cy={dotProps.cy}
                  r={4}
                  fill={dotProps.payload?.dayColor ?? CHART_COLOR}
                  stroke="white"
                  strokeWidth={2}
                />
              )}
              strokeLinecap="round"
              strokeLinejoin="round"
              animationDuration={400}
            />

            {dayBoundaries.map((b) => (
              <ReferenceLine
                key={b.distance}
                x={b.distance}
                stroke={b.dayColor}
                strokeDasharray="4 4"
                strokeWidth={1.5}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
