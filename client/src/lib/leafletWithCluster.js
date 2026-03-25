/**
 * Leaflet с глобальными ссылками для плагинов (MarkerCluster и др.).
 * Импортируйте этот файл первым, затем плагин — тогда L.MarkerClusterGroup будет доступен.
 */
import L from 'leaflet';

if (typeof window !== 'undefined') {
  window.L = L;
  window.Leaflet = L;
}

export default L;
