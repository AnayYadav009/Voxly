import React from 'react';
import { formatINR } from '../utils';

export const DailyBarChart = ({ dailySpending, dark, threshold = 1500 }) => {
  const maxDaily = dailySpending.reduce((m, d) => Math.max(m, d.amount), 0) || 1;

  return (
    <div className="card">
      <div className="card-title">Last 7 Days</div>
      <div className="bar-chart">
        {dailySpending.map((d, i) => {
          const pct = (d.amount / maxDaily) * 100;
          const over = d.amount > threshold;
          return (
            <div key={d.key || d.day + i} className="bar-col">
              <div className="bar-fill-wrapper">
                <div
                  className="bar-fill"
                  style={{ 
                    height: `${d.amount > 0 ? Math.max(pct, 4) : 0}%`, 
                    background: over ? '#ef4444' : 'var(--accent)' 
                  }}
                  data-amount={formatINR(d.amount)}
                  tabIndex="0"
                />
              </div>
              <span className="bar-label">{d.day}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
