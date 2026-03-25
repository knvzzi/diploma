import { Navigate, useLocation, useParams } from 'react-router-dom';

/**
 * Редирект на страницу поиска с открытием карточки маршрута по id.
 * Публичный просмотр: /search?route=<uuid> (логика в SearchRoutesPage).
 */
export default function RouteViewRedirect() {
  const { id } = useParams();
  const location = useLocation();
  if (!id) return <Navigate to="/search" replace />;
  return <Navigate to={`/search?route=${encodeURIComponent(id)}`} replace state={location.state} />;
}
