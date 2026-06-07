import React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { formatINR } from '../utils';

export const MonthlyBarChart = ({ monthlyTrend, dark }) => {
  const maxMonthly = monthlyTrend.reduce((m, d) => Math.max(m, d.amount), 0) || 1;
  const monthDelta = monthlyTrend.length >= 2
    ? monthlyTrend[monthlyTrend.length - 1].amount - monthlyTrend[monthlyTrend.length - 2].amount
    : null;
  const monthDeltaPct = monthlyTrend.length >= 2 && monthlyTrend[monthlyTrend.length - 2].amount > 0
    ? Math.abs(monthDelta) / monthlyTrend[monthlyTrend.length - 2].amount * 100
    : null;

  return (
    <div className="card">
      <div className="card-title">Monthly Trend (6 months)</div>
      <div className="month-chart">
        {monthlyTrend.map((m, i) => {
          const isCurrent = i === monthlyTrend.length - 1;
          const pct = (m.amount / maxMonthly) * 100;
          return (
            <div key={m.label || i} className="month-col">
              <div className="bar-fill-wrapper">
                <div
                  className="month-bar bar-fill"
                  style={{
                    height: `${m.amount > 0 ? Math.max(pct, 4) : 0}%`,
                    background: isCurrent ? 'var(--accent)' : 'var(--border)',
                    opacity: isCurrent ? 1 : 0.6,
                    position: 'relative'
                  }}
                  data-amount={formatINR(m.amount)}
                  tabIndex="0"
                />
              </div>
              <span className="month-label">{m.label}</span>
            </div>
          );
        })}
      </div>
      {monthDelta !== null && (
        <div className="month-delta" style={{ color: monthDelta <= 0 ? 'var(--success)' : 'var(--danger)' }}>
          {monthDelta <= 0 ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />}
          <span>
            {monthDelta <= 0 ? 'Down' : 'Up'} {formatINR(Math.abs(monthDelta))}
            {monthDeltaPct !== null && ` (${monthDeltaPct.toFixed(0)}%)`} vs last month
          </span>
        </div>
      )}
    </div>
  );
};
