import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Утилита для объединения классов Tailwind.
 * clsx — условное объединение строк классов.
 * twMerge — разрешает конфликты (например, p-2 и p-4 → оставит p-4).
 * Используется во всех компонентах Shadcn UI.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
