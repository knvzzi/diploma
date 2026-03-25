import { renderToString } from 'react-dom/server';
import {
  MapPin,
  Star,
  Flag,
  Eye,
  Camera,
  Image as ImageIcon,
  Heart,
  Tent,
  Flame,
  Mountain,
  Waves,
  TreePine,
  Landmark,
  Castle,
  UtensilsCrossed,
  Coffee,
  Wine,
  Beer,
  Bookmark,
  Compass,
  Navigation,
  Palette,
  Sun,
  CloudRain,
  Bike,
  Car,
  Plane,
  Ship,
  Anchor,
  Flower2,
  Trees,
  MapPinned,
  MountainSnow,
  Gem,
  ImagePlus,
  CircleDot,
} from 'lucide-react';

/**
 * Реестр иконок POI по категориям для выбора в конструкторе маршрута.
 * id хранится в БД (route_pois.icon_name) и в стейте метки (label.icon).
 * Иконки Lucide рендерятся в маркеры на карте через getPoiIconSvg(id).
 */
export const POI_ICONS = [
  { id: 'map-pin', Icon: MapPin, label: 'Точка', category: 'Основные' },
  { id: 'map-pinned', Icon: MapPinned, label: 'Точка на карте', category: 'Основные' },
  { id: 'star', Icon: Star, label: 'Звезда', category: 'Основные' },
  { id: 'flag', Icon: Flag, label: 'Флаг', category: 'Основные' },
  { id: 'bookmark', Icon: Bookmark, label: 'Закладка', category: 'Основные' },
  { id: 'circle-dot', Icon: CircleDot, label: 'Метка', category: 'Основные' },
  { id: 'eye', Icon: Eye, label: 'Точка обзора', category: 'Обзор' },
  { id: 'camera', Icon: Camera, label: 'Камера', category: 'Обзор' },
  { id: 'image-plus', Icon: ImagePlus, label: 'Фототочка', category: 'Обзор' },
  { id: 'image', Icon: ImageIcon, label: 'Фото', category: 'Обзор' },
  { id: 'mountain', Icon: Mountain, label: 'Гора', category: 'Природа' },
  { id: 'mountain-snow', Icon: MountainSnow, label: 'Вершина', category: 'Природа' },
  { id: 'tree-pine', Icon: TreePine, label: 'Лес', category: 'Природа' },
  { id: 'trees', Icon: Trees, label: 'Роща', category: 'Природа' },
  { id: 'waves', Icon: Waves, label: 'Вода', category: 'Природа' },
  { id: 'flame', Icon: Flame, label: 'Костёр', category: 'Природа' },
  { id: 'sun', Icon: Sun, label: 'Солнце', category: 'Природа' },
  { id: 'cloud-rain', Icon: CloudRain, label: 'Погода', category: 'Природа' },
  { id: 'flower2', Icon: Flower2, label: 'Цветы', category: 'Природа' },
  { id: 'tent', Icon: Tent, label: 'Палатка', category: 'Поход' },
  { id: 'compass', Icon: Compass, label: 'Компас', category: 'Поход' },
  { id: 'navigation', Icon: Navigation, label: 'Направление', category: 'Поход' },
  { id: 'bike', Icon: Bike, label: 'Велосипед', category: 'Транспорт' },
  { id: 'car', Icon: Car, label: 'Авто', category: 'Транспорт' },
  { id: 'plane', Icon: Plane, label: 'Самолёт', category: 'Транспорт' },
  { id: 'ship', Icon: Ship, label: 'Корабль', category: 'Транспорт' },
  { id: 'anchor', Icon: Anchor, label: 'Якорь', category: 'Транспорт' },
  { id: 'utensils-crossed', Icon: UtensilsCrossed, label: 'Еда', category: 'Еда и напитки' },
  { id: 'coffee', Icon: Coffee, label: 'Кафе', category: 'Еда и напитки' },
  { id: 'wine', Icon: Wine, label: 'Винодельня', category: 'Еда и напитки' },
  { id: 'beer', Icon: Beer, label: 'Паб', category: 'Еда и напитки' },
  { id: 'landmark', Icon: Landmark, label: 'Достопримечательность', category: 'Культура' },
  { id: 'castle', Icon: Castle, label: 'Замок', category: 'Культура' },
  { id: 'gem', Icon: Gem, label: 'Музей', category: 'Культура' },
  { id: 'heart', Icon: Heart, label: 'Избранное', category: 'Прочее' },
  { id: 'palette', Icon: Palette, label: 'Искусство', category: 'Прочее' },
];

const DEFAULT_POI_ICON_ID = 'map-pin';

/**
 * Возвращает SVG-строку иконки для вставки в L.divIcon (Leaflet).
 * Используется в конструкторе для отрисовки выбранной Lucide-иконки внутри маркера.
 *
 * @param {string} iconId — id из POI_ICONS (например 'camera', 'tent')
 * @param {object} options — { size?: number, color?: string }
 * @returns {string} HTML-строка с иконкой (svg в обёртке)
 */
export function getPoiIconSvg(iconId, options = {}) {
  const { size = 14, color = 'currentColor' } = options;
  const entry = POI_ICONS.find((e) => e.id === iconId) ?? POI_ICONS.find((e) => e.id === DEFAULT_POI_ICON_ID);
  const Icon = entry?.Icon ?? MapPin;
  try {
    return renderToString(<Icon size={size} color={color} strokeWidth={2} />);
  } catch (_) {
    return renderToString(<MapPin size={size} color={color} strokeWidth={2} />);
  }
}

/**
 * Компонент выбора иконки POI по категориям (сетка, как на референсе).
 *
 * @param {{ value: string, onChange: (iconId: string) => void, onClose?: () => void }} props
 */
export default function PoiIconPicker({ value, onChange, onClose }) {
  const categories = [...new Set(POI_ICONS.map((i) => i.category))];

  return (
    <div className="flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-600">Иконка места</span>
        {onClose && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Закрыть
          </button>
        )}
      </div>
      <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-slate-50/50 p-2">
        {categories.map((cat) => (
          <div key={cat} className="mb-3 last:mb-0">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {cat}
            </p>
            <div className="grid grid-cols-5 gap-1">
              {POI_ICONS.filter((i) => i.category === cat).map(({ id, Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  title={label}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(id);
                  }}
                  className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-slate-200 focus:outline-none ${
                    value === id ? 'bg-primary/15 text-primary ring-1 ring-primary/40' : 'text-slate-600'
                  }`}
                  aria-label={label}
                  aria-pressed={value === id}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export { DEFAULT_POI_ICON_ID };
