import React from 'react';
import { formatINR, getCatColor } from '../utils';

export const DonutChart = ({ data, dark }) => {
  const total = data.reduce((s, d) => s + d.amount, 0) || 1;
  let angle = -90;
  const R = 80, cx = 90, cy = 90, stroke = 28;
  const polarToXY = (deg, r) => ({
    x: cx + r * Math.cos((deg * Math.PI) / 180),
    y: cy + r * Math.sin((deg * Math.PI) / 180),
  });

  if (data.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div className="donut-wrap"><svg width={180} height={180} viewBox="0 0 180 180"><circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--border)" strokeWidth={stroke} /></svg></div>
        <p style={{ fontSize: 13, color: 'var(--text-2)' }}>No expenses yet.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
      <div className="donut-wrap">
        <svg width={180} height={180} viewBox="0 0 180 180" role="img" aria-label="Donut chart showing spending breakdown">
          {data.map((d, i) => {
            const pct = d.amount / total;
            const sweep = pct * 360;
            const large = sweep > 180 ? 1 : 0;
            const start = polarToXY(angle, R);
            angle += sweep;
            const end = polarToXY(angle, R);
            const color = getCatColor(d.category.toLowerCase(), dark);
            
            if (sweep < 1) return null;
            
            // Fix: Handle 100% case
            if (sweep >= 359.9) {
              return <circle key={d.key || i} cx={cx} cy={cy} r={R} fill={color} style={{ cursor: 'default' }} />;
            }
            
            return (
              <path
                key={d.key || i}
                d={`M ${cx} ${cy} L ${start.x} ${start.y} A ${R} ${R} 0 ${large} 1 ${end.x} ${end.y} Z`}
                fill={color}
                style={{ cursor: 'default' }}
              />
            );
          })}
          <circle cx={cx} cy={cy} r={R - stroke} fill="var(--bg-card)" />
        </svg>
        <div className="donut-center">
          <span className="donut-total">{formatINR(total)}</span>
          <span className="donut-sub">total</span>
        </div>
      </div>
      <div className="donut-legend">
        {data.slice(0, 6).map((d, i) => (
          <div key={d.key || i} className="legend-item">
            <div className="legend-left">
              <div className="legend-dot" style={{ background: getCatColor(d.category.toLowerCase(), dark) }} />
              <span className="legend-name">{d.category}</span>
            </div>
            <span className="legend-amount">{formatINR(d.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
