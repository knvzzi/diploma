import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const ROUTE_SORT_OPTIONS = [
  { value: 'newest', label: 'Сначала новые' },
  { value: 'popular', label: 'Сначала популярные' },
  { value: 'shortest', label: 'Сначала короткие' },
  { value: 'longest', label: 'Сначала длинные' },
];

/**
 * Сортировка маршрутов — Radix Select (список рисуется в DOM страницы,
 * виден при записи экрана; нативный <select> на Windows часто не попадает в видео).
 */
export default function RouteSortSelect({ value, onValueChange, triggerClassName }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder="Сортировка" />
      </SelectTrigger>
      <SelectContent>
        {ROUTE_SORT_OPTIONS.map(({ value: v, label }) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
