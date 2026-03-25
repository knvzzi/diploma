import {
  Baby,
  Banknote,
  Bath,
  Bike,
  Bus,
  Caravan,
  Church,
  Droplets,
  Eye,
  Fuel,
  History,
  Home,
  Hotel,
  Library,
  Map,
  Mountain,
  Navigation,
  Palette,
  Palmtree,
  ParkingCircle,
  Ship,
  ShoppingCart,
  Tent,
  Utensils,
  Waves,
  Wind,
  Zap,
} from 'lucide-react';

/**
 * Конфигурация категорий интересных мест (POI — Points of Interest).
 *
 * Поле `query` содержит фрагмент Overpass QL-фильтра для выборки объектов
 * из базы OpenStreetMap через Overpass API.
 *
 * Структура:
 *  id     — уникальный идентификатор элемента (используется в activePoiCategories)
 *  label  — читаемое название для UI
 *  icon   — компонент иконки из lucide-react
 *  query  — Overpass QL тег-фильтр, например '["amenity"="drinking_water"]'
 */
export const POI_CATEGORIES = [
  {
    id: 'outdoor',
    label: 'Outdoor',
    items: [
      { id: 'water',       label: 'Источники воды',       icon: Droplets,     query: '["amenity"~"drinking_water|water_point"]' },
      { id: 'shelter',     label: 'Укрытия и приюты',     icon: Home,         query: '["amenity"="shelter"]' },
      { id: 'camp',        label: 'Места под палатки',     icon: Tent,         query: '["tourism"~"camp_site|alpine_hut"]' },
      { id: 'picnic',      label: 'Места для пикника',     icon: Palmtree,     query: '["tourism"="picnic_site"]' },
      { id: 'peaks',       label: 'Горы и вулканы',        icon: Mountain,     query: '["natural"="peak"]' },
      { id: 'waterfalls',  label: 'Водопады',              icon: Waves,        query: '["waterway"="waterfall"]' },
      { id: 'viewpoints',  label: 'Точки обзора',          icon: Eye,          query: '["tourism"="viewpoint"]' },
      { id: 'passes',      label: 'Горные перевалы',       icon: Navigation,   query: '["mountain_pass"="yes"]' },
      { id: 'caves',       label: 'Пещеры',                icon: Map,          query: '["natural"="cave_entrance"]' },
      { id: 'guides',      label: 'Указатели',             icon: Map,          query: '["information"="guidepost"]' },
      { id: 'water_bodies',label: 'Водные объекты',        icon: Waves,        query: '["natural"="water"]' },
      { id: 'mills',       label: 'Водяные мельницы',      icon: Wind,         query: '["man_made"="watermill"]' },
      { id: 'pier',        label: 'Причалы',               icon: Ship,         query: '["man_made"="pier"]' },
      { id: 'slipway',     label: 'Слипы',                 icon: Ship,         query: '["leisure"="slipway"]' },
    ],
  },
  {
    id: 'places',
    label: 'Места',
    items: [
      { id: 'hotel',    label: 'Отели и гостиницы',        icon: Hotel,    query: '["tourism"~"hotel|hostel|guest_house"]' },
      { id: 'toilets',  label: 'Души и туалеты',           icon: Bath,     query: '["amenity"~"toilets|shower"]' },
      { id: 'food',     label: 'Еда и напитки',            icon: Utensils, query: '["amenity"~"cafe|restaurant|pub|fast_food"]' },
      { id: 'museum',   label: 'Музеи',                    icon: Library,  query: '["tourism"="museum"]' },
      { id: 'history',  label: 'Исторические объекты',     icon: History,  query: '["historic"]' },
      { id: 'religion', label: 'Религия',                  icon: Church,   query: '["amenity"="place_of_worship"]' },
      { id: 'children', label: 'Для детей',                icon: Baby,     query: '["leisure"="playground"]' },
      { id: 'art',      label: 'Публичные произведения...', icon: Palette,  query: '["tourism"="artwork"]' },
      { id: 'atm',      label: 'Банкоматы',                icon: Banknote, query: '["amenity"="atm"]' },
    ],
  },
  {
    id: 'transport',
    label: 'Автомобили и транспорт',
    items: [
      { id: 'fuel',        label: 'Заправочные станции',   icon: Fuel,          query: '["amenity"="fuel"]' },
      { id: 'parking',     label: 'Парковки',              icon: ParkingCircle, query: '["amenity"="parking"]' },
      { id: 'charging',    label: 'Зарядные станции',      icon: Zap,           query: '["amenity"="charging_station"]' },
      { id: 'caravan',     label: 'Парковки для домов...',  icon: Caravan,       query: '["tourism"="caravan_site"]' },
      { id: 'moto',        label: 'Магазины для мото...',  icon: Bike,          query: '["shop"~"motorcycle|bicycle"]' },
      { id: 'supermarket', label: 'Продуктовые магазины',  icon: ShoppingCart,  query: '["shop"~"supermarket|convenience"]' },
      { id: 'bus',         label: 'Остановки транспорта',  icon: Bus,           query: '["highway"="bus_stop"]' },
      { id: 'ferry',       label: 'Паромы',                icon: Ship,          query: '["amenity"="ferry_terminal"]' },
    ],
  },
];

/**
 * Плоский индекс всех POI-элементов для быстрого поиска по id.
 * Строится один раз при загрузке модуля.
 */
const POI_ITEMS_INDEX = Object.fromEntries(
  POI_CATEGORIES.flatMap((cat) => cat.items).map((item) => [item.id, item]),
);

/**
 * Возвращает метаданные POI-категории (label, icon, query) по её id.
 *
 * @param {string|null} categoryId — id из poiConfig, например 'water'
 * @returns {{ id, label, icon, query } | null}
 */
export function getPoiMeta(categoryId) {
  return POI_ITEMS_INDEX[categoryId] ?? null;
}
