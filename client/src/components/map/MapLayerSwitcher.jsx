import {
  Layers, ChevronDown,
  Map, Mountain, Globe,
} from 'lucide-react';

import useRouteStore, { MAP_LAYERS } from '@/store/useRouteStore';

const LAYER_CONFIG = [
  { id: 'standard', icon: Map },
  { id: 'topo', icon: Mountain },
  { id: 'satellite', icon: Globe },
];

/**
 * Секция «Слои»: белая карточка, заголовок с иконкой и ChevronDown, контент раскрывается вниз.
 */
export default function MapLayersControl({ expandedSection, onToggle }) {
  const { activeLayer, setActiveLayer } = useRouteStore();
  const isOpen = expandedSection === 'layers';

  return (
    <div className="relative z-[1100] flex flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg">
      <button
        type="button"
        onClick={() => onToggle(isOpen ? null : 'layers')}
        className="flex h-10 w-full items-center justify-between gap-2 px-4 text-left transition-colors hover:bg-gray-50"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Layers className="h-4 w-4 shrink-0 text-gray-600" />
          <span className="truncate text-sm font-medium text-gray-700">Слои</span>
          <span className="truncate text-xs text-gray-400">{MAP_LAYERS[activeLayer].name}</span>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="border-t px-2 py-2">
          {LAYER_CONFIG.map(({ id, icon: Icon }) => {
            const isActive = activeLayer === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setActiveLayer(id);
                  onToggle(null);
                }}
                className={[
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-primary text-primary-foreground' : 'text-gray-700 hover:bg-gray-100',
                ].join(' ')}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{MAP_LAYERS[id].name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
