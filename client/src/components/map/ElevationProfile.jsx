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

import useRouteStore from '@/store/useRouteStore';

// ─── Константы стилей ────────────────────────────────────────────────────────

/** Цвет линии и заливки графика (синий, соответствует цвету маршрута на карте) */
const CHART_COLOR = '#3b82f6'; // Tailwind blue-500

// ─── Кастомный тултип ────────────────────────────────────────────────────────

/**
 * Кастомный всплывающий тултип, отображаемый при наведении на график.
 *
 * При наведении показывается высота и дистанция.
 */
function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;

  const { elevation, distance, dayName, dayColor } = payload[0].payload;

  return (
    <div className="rounded-lg border bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm">
      {dayName && (
        <div className="mb-1.5 flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: dayColor ?? CHART_COLOR }}
          />
          <span className="text-xs font-semibold text-foreground">{dayName}</span>
        </div>
      )}
      <p className="text-xs font-semibold text-foreground">
        {elevation} м <span className="font-normal text-muted-foreground">над уровнем моря</span>
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Дистанция: {distance} км
      </p>
    </div>
  );
}

// ─── Кастомный курсор ─────────────────────────────────────────────────────────

/**
 * Кастомный вертикальный курсор на графике — тонкая синяя линия.
 * recharts передаёт координаты и размеры активной зоны.
 */
function CustomCursor({ points: pts, height }) {
  if (!pts?.length) return null;
  const { x } = pts[0];
  return (
    <line
      x1={x}
      y1={0}
      x2={x}
      y2={height}
      stroke="#6b7280"
      strokeWidth={1.5}
      strokeDasharray="4 3"
      opacity={0.6}
    />
  );
}

// ─── Вычисление статистики высот ─────────────────────────────────────────────

/**
 * Вычисляет статистику профиля высот из массива elevationData.
 *
 * @param {Array<{ elevation: number }>} data
 * @returns {{ minElev: number, maxElev: number, gain: number, loss: number }}
 *   minElev  — минимальная высота на маршруте (м)
 *   maxElev  — максимальная высота на маршруте (м)
 *   gain     — суммарный набор высоты (м) — сумма всех подъёмов
 *   loss     — суммарный сброс высоты (м) — сумма всех спусков
 */
function computeElevationStats(data) {
  if (!data.length) return { minElev: 0, maxElev: 0, gain: 0, loss: 0 };

  let minElev = Infinity;
  let maxElev = -Infinity;
  let gain = 0;
  let loss = 0;

  for (let i = 0; i < data.length; i++) {
    const ele = data[i].elevation;
    if (ele < minElev) minElev = ele;
    if (ele > maxElev) maxElev = ele;

    if (i > 0) {
      const delta = ele - data[i - 1].elevation;
      if (delta > 0) gain += delta;
      else loss += Math.abs(delta);
    }
  }

  return {
    minElev: Math.round(minElev),
    maxElev: Math.round(maxElev),
    gain: Math.round(gain),
    loss: Math.round(loss),
  };
}

// ─── Ступенчатый SVG-градиент по цветам дней ─────────────────────────────────

/**
 * Строит массив стопов для горизонтального SVG linearGradient,
 * который окрашивает профиль высот в цвета дней похода.
 *
 * Алгоритм:
 *  — Проходим по elevationData и ищем все точки, где меняется tripDayId.
 *  — На каждой границе добавляем два стопа на почти одинаковом offset (±0.001%),
 *    что создаёт резкий «ступенчатый» переход цвета без какого-либо смешения.
 *  — offset вычисляется как процент накопленной дистанции от максимальной.
 *
 * Fallback (однодневный маршрут или нет tripDayId):
 *  Возвращает два стопа одного цвета — эквивалентно однотонному заполнению.
 *
 * gradientUnits по умолчанию — «objectBoundingBox», поэтому 0% и 100% точно
 * соответствуют левому и правому краям области рисования.
 *
 * @param {Array<{ distance: number, tripDayId?: string, dayColor?: string }>} data
 * @returns {Array<{ offset: string, color: string }>}
 */
function buildGradientStops(data) {
  const fallbackColor = CHART_COLOR;

  if (!data.length) {
    return [
      { offset: '0%',   color: fallbackColor },
      { offset: '100%', color: fallbackColor },
    ];
  }

  const maxDist = data[data.length - 1].distance;

  // Если дистанция нулевая — рисуем однотонный градиент
  if (maxDist === 0) {
    const c = data[0].dayColor ?? fallbackColor;
    return [{ offset: '0%', color: c }, { offset: '100%', color: c }];
  }

  const stops = [];

  // Начальный стоп — цвет самой первой точки
  stops.push({ offset: '0%', color: data[0].dayColor ?? fallbackColor });

  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const curr = data[i];

    if (prev.tripDayId && curr.tripDayId && prev.tripDayId !== curr.tripDayId) {
      // Позиция перехода в % от общей дистанции маршрута
      const pct = (prev.distance / maxDist) * 100;

      // Два стопа вплотную — левый сохраняет цвет уходящего дня,
      // правый (на 0.001% дальше) сразу переключается на цвет нового дня.
      // Это создаёт визуально чёткую вертикальную границу без градиентного смешения.
      stops.push({ offset: `${pct.toFixed(4)}%`,           color: prev.dayColor ?? fallbackColor });
      stops.push({ offset: `${(pct + 0.001).toFixed(4)}%`, color: curr.dayColor ?? fallbackColor });
    }
  }

  // Конечный стоп — цвет последней точки
  stops.push({ offset: '100%', color: data[data.length - 1].dayColor ?? fallbackColor });

  return stops;
}

// ─── Главный компонент ────────────────────────────────────────────────────────

/**
 * График профиля высот маршрута.
 *
 * ────────────────────────────────────────────────────────────────────────
 *  КАК РАБОТАЕТ СИНХРОНИЗАЦИЯ ГРАФИКА С КАРТОЙ
 * ────────────────────────────────────────────────────────────────────────
 *
 *  1. В useRouteStore хранится поле `hoveredElevationPoint: { lat, lng } | null`.
 *
 *  2. Когда пользователь водит мышью над графиком, recharts вызывает
 *     onMouseMove(data), где data.activePayload[0].payload содержит
 *     объект текущей точки { distance, elevation, lat, lng }.
 *
 *  3. Мы вызываем setHoveredElevationPoint({ lat, lng }) — записываем
 *     координаты в Zustand стор.
 *
 *  4. Компонент RouteMap подписан на hoveredElevationPoint. Когда оно
 *     меняется, React перерендеривает RouteMap и CircleMarker появляется
 *     (или перемещается) в нужное место на линии маршрута.
 *
 *  5. При уходе мыши с графика (onMouseLeave) вызываем
 *     setHoveredElevationPoint(null) — маркер исчезает с карты.
 *
 *  Итог: пользователь видит «живую» связь между позицией на графике
 *  и соответствующей точкой на линии маршрута.
 * ────────────────────────────────────────────────────────────────────────
 */
export default function ElevationProfile() {
  const { elevationData, segments, setHoveredElevationPoint } = useRouteStore();

  if (!elevationData.length) return null;

  /** Данные для графика (уклон между соседними точками опционально) */
  const chartData = useMemo(() => {
    if (!elevationData.length) return [];
    return elevationData.map((pt, i) => {
      let slope = null;
      if (i > 0) {
        const prev = elevationData[i - 1];
        const distKm = pt.distance - prev.distance;
        if (distKm > 0) {
          const riseM = pt.elevation - prev.elevation;
          slope = Math.round((riseM / (distKm * 10)) * 10) / 10;
        }
      }
      return { ...pt, slope };
    });
  }, [elevationData]);

  const stats = computeElevationStats(elevationData);

  /**
   * Отступ по оси Y: добавляем небольшой запас выше максимума и ниже минимума,
   * чтобы линия не упиралась в края графика.
   */
  const yMin = Math.max(0, stats.minElev - 30);
  const yMax = stats.maxElev + 50;

  /**
   * Ступенчатые стопы горизонтального SVG-градиента.
   * Пересчитываются при каждом изменении elevationData.
   * Используются для stroke и fill компонента <Area>.
   */
  const gradientStops = buildGradientStops(elevationData);

  /**
   * Вычисляем границы дней — точки по оси X, где меняется tripDayId.
   *
   * Алгоритм: проходим по массиву elevationData и сравниваем tripDayId
   * текущей и предыдущей точки. Если они отличаются — записываем дистанцию
   * последней точки предыдущего дня как границу.
   *
   * Дополнительно сохраняем dayName завершившегося дня для лейбла линии.
   * Если данные одного дня или tripDayId отсутствует — массив будет пустым
   * и ни одной ReferenceLine не отрисуется.
   */
  const dayBoundaries = [];
  for (let i = 1; i < elevationData.length; i++) {
    const prev = elevationData[i - 1];
    const curr = elevationData[i];
    if (prev.tripDayId && curr.tripDayId && prev.tripDayId !== curr.tripDayId) {
      dayBoundaries.push({
        distance: prev.distance,
        dayName:  prev.dayName,
        // Цвет завершившегося дня — используется для окраски разделителя
        dayColor: prev.dayColor,
      });
    }
  }

  /**
   * Обработчик движения мыши над графиком.
   * recharts передаёт объект с активными данными точки.
   * Извлекаем lat/lng и записываем в стор → RouteMap отреагирует.
   */
  /**
   * Recharts не всегда прокидывает activePayload в onMouseMove —
   * вместо этого передаёт activeTooltipIndex (числовой индекс ближайшей точки).
   * Мы напрямую читаем точку из elevationData по этому индексу.
   */
  const handleMouseMove = (chartEvt) => {
    const idx = chartEvt?.activeTooltipIndex ?? chartEvt?.activeIndex;
    if (idx != null) {
      const point = chartData[idx];
      if (point?.lat != null && point?.lng != null) {
        setHoveredElevationPoint(point);
      }
    }
  };

  /** Когда мышь уходит — убираем маркер с карты */
  const handleMouseLeave = () => setHoveredElevationPoint(null);

  return (
    <div className="flex h-full flex-col px-4 pb-3 pt-2">

      {/* ── Статистика высот ── */}
      <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
        <StatBadge label="Мин. высота" value={`${stats.minElev} м`} color="text-sky-500" />
        <StatBadge label="Макс. высота" value={`${stats.maxElev} м`} color="text-orange-500" />
        <StatBadge label="Набор высоты" value={`↑ ${stats.gain} м`} color="text-emerald-500" />
        <StatBadge label="Сброс высоты" value={`↓ ${stats.loss} м`} color="text-rose-500" />
      </div>

      {/* ── График ── */}
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            {/*
             * SVG-определения: два горизонтальных ступенчатых градиента по цветам дней.
             *
             * «trip-day-stroke» — для линии профиля (полная непрозрачность).
             * «trip-day-fill»   — для заливки под линией (пониженная прозрачность).
             *
             * Оба используют один и тот же массив gradientStops, сформированный в
             * buildGradientStops(). Горизонтальное направление (x1=0 x2=1 y1=0 y2=0)
             * вместе с gradientUnits="objectBoundingBox" (по умолчанию) гарантирует,
             * что offset 0% и 100% точно совпадают с левым и правым краями AreaChart.
             */}
            <defs>
              <linearGradient id="trip-day-stroke" x1="0" y1="0" x2="1" y2="0">
                {gradientStops.map((s, i) => (
                  <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={1} />
                ))}
              </linearGradient>

              <linearGradient id="trip-day-fill" x1="0" y1="0" x2="1" y2="0">
                {gradientStops.map((s, i) => (
                  <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={0.28} />
                ))}
              </linearGradient>
            </defs>

            {/* Сетка — только горизонтальные линии, пунктир */}
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="hsl(var(--border))"
              opacity={0.6}
            />

            {/* Ось X — дистанция в км */}
            <XAxis
              dataKey="distance"
              type="number"
              domain={[0, 'dataMax']}
              tickFormatter={(v) => `${v} км`}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              tickCount={6}
            />

            {/* Ось Y — высота в метрах */}
            <YAxis
              domain={[yMin, yMax]}
              tickFormatter={(v) => `${v}м`}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              width={40}
              tickCount={4}
            />

            {/* Тултип с кастомным курсором */}
            <Tooltip
              content={(props) => <CustomTooltip {...props} />}
              cursor={<CustomCursor />}
              isAnimationActive={false}
            />

            {/*
             * Область (Area) — заливка + линия.
             *
             * stroke / fill ссылаются на ступенчатые SVG-градиенты из <defs>.
             * Цвет линии и заливки автоматически меняется на границах дней похода.
             *
             * activeDot — кастомный рендер, берёт dayColor из payload точки,
             * чтобы активная точка совпадала по цвету с текущим днём.
             */}
            <Area
              type="monotone"
              dataKey="elevation"
              stroke="url(#trip-day-stroke)"
              strokeWidth={2}
              fill="url(#trip-day-fill)"
              dot={false}
              activeDot={(dotProps) => {
                const color = dotProps.payload?.dayColor ?? CHART_COLOR;
                return (
                  <circle
                    key={`adot-${dotProps.cx}-${dotProps.cy}`}
                    cx={dotProps.cx}
                    cy={dotProps.cy}
                    r={5}
                    fill={color}
                    stroke="hsl(var(--background))"
                    strokeWidth={2}
                  />
                );
              }}
              strokeLinecap="round"
              strokeLinejoin="round"
              animationDuration={600}
            />

            {/*
             * Вертикальные разделители дней.
             *
             * Каждая линия окрашена в цвет завершившегося дня (boundary.dayColor),
             * усиливая визуальный ритм: линия профиля, разделитель и маркер на карте
             * используют один и тот же цвет дня.
             */}
            {dayBoundaries.map((boundary) => (
              <ReferenceLine
                key={boundary.distance}
                x={boundary.distance}
                stroke={boundary.dayColor}
                strokeDasharray="4 4"
                strokeWidth={2}
                label={{
                  position:   'insideTopLeft',
                  value:      boundary.dayName,
                  fill:       boundary.dayColor,
                  fontSize:   11,
                  fontWeight: 500,
                }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Вспомогательный компонент статистики ────────────────────────────────────

/**
 * Маленький бейдж для отображения одного показателя статистики.
 *
 * @param {{ label: string, value: string, color: string }} props
 */
function StatBadge({ label, value, color }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground/70">{label}:</span>
      <span className={`font-semibold ${color}`}>{value}</span>
    </div>
  );
}
