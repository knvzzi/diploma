import React from 'react';
import { renderToString } from 'react-dom/server';
import L from 'leaflet';
import { MapPin } from 'lucide-react';

const DEFAULT_MARKER_COLOR = '#3b82f6';

/**
 * Создаёт L.divIcon маркера в виде капли (референс):
 *  - Форма: border-radius 50% 50% 50% 0 + rotate(-45deg).
 *  - Белая обводка (2px), лёгкая тень.
 *  - Внутри — Lucide-иконка, повёрнутая обратно (rotate(45deg)), цвет белый.
 *  - Фон капли — переданный color.
 *
 * @param {string} color — HEX цвета капли (например '#ef4444'). При отсутствии — #3b82f6.
 * @param {React.ComponentType<{ size?: number, color?: string, strokeWidth?: number }>} [IconComponent] — компонент иконки Lucide; при отсутствии — MapPin.
 * @returns {L.DivIcon}
 */
export function createCustomMarker(color, IconComponent) {
  const safeColor = color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : DEFAULT_MARKER_COLOR;
  const Icon = typeof IconComponent === 'function' ? IconComponent : MapPin;
  let iconSvg;
  try {
    iconSvg = renderToString(
      React.createElement(Icon, {
        size:   16,
        color:  '#ffffff',
        strokeWidth: 2.5,
      }),
    );
  } catch (_) {
    iconSvg = renderToString(React.createElement(MapPin, { size: 16, color: '#ffffff', strokeWidth: 2.5 }));
  }

  const html = `
    <div class="poi-teardrop-marker" style="background-color: ${safeColor};">
      <div class="poi-teardrop-marker__inner">
        ${iconSvg}
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className:  '',
    iconSize:   [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -18],
  });
}
