import React, { useMemo } from 'react';
import { BUDGET_DEFAULTS } from '../constants';
import { titleCase, formatINR } from '../utils';

export const BudgetTab = ({ categoryTotals, dark, onCategoryClick }) => {
  const rows = useMemo(() => categoryTotals.map(item => {
    const budget = BUDGET_DEFAULTS[item.category] ?? 4000;
    const pct = budget ? Math.min((item.amount / budget) * 100, 120) : 0;
    const color = pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#22c55e';
    return { category: titleCase(item.category), rawCategory: item.category, spent: item.amount, budget, pct, color };
  }), [categoryTotals]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-title">Monthly Budget Overview</div>
        {rows.length > 0 ? rows.map((r, i) => (
          <div
            key={r.category}
            className="progress-row cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/20 p-2 -mx-2 rounded-xl transition-all"
            onClick={() => onCategoryClick && onCategoryClick(r.rawCategory)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                onCategoryClick && onCategoryClick(r.rawCategory);
              }
            }}
          >
            <div className="progress-meta">
              <span className="progress-name">{r.category}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="progress-amounts">{formatINR(r.spent)} / {formatINR(r.budget)}</span>
                <span className="progress-pct" style={{ color: r.color }}>{Math.round(r.pct)}%</span>
              </div>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${Math.min(r.pct, 100)}%`, background: r.color }} />
            </div>
          </div>
        )) : (
          <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Add expenses to track budget utilization.</p>
        )}
      </div>

      <div className="card">
        <div className="card-title">Voice Budget Commands</div>
        <div className="mono-list">
          set budget for food to 10000<br />
          set budget for transport to 4000<br />
          what's my food budget<br />
          show my budgets<br />
          remove budget for entertainment<br />
          set budget for utilities to 5000 warn me at 70 percent
        </div>
      </div>
    </div>
  );
};
