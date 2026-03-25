/** Общие форматтеры для карточек и деталей маршрута (поиск, профиль). */

export function formatDistance(meters) {
  if (meters == null) return '—';
  return `${(Number(meters) / 1000).toFixed(1)} км`;
}

export function formatElevation(meters) {
  if (meters == null) return '—';
  return `${Math.round(Number(meters))} м`;
}

export function formatDuration(seconds) {
  if (seconds == null) return '—';
  const s = Math.round(Number(seconds));
  if (s < 60) return `${s} с`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m} мин`;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

/** Дата создания: "15 янв. 2025" */
export function formatCreatedDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}
