import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { titleCase, formatINR } from '../utils';
import { getBudgets, setBudget, deleteBudget } from '../api';

const CATEGORIES = [
  'food', 'transport', 'entertainment', 'shopping', 'utilities', 'health',
  'education', 'rent', 'savings', 'personal', 'gifts', 'charity', 'insurance', 'fees', 'uncategorized'
];

export const BudgetTab = ({ categoryTotals, budgetStatuses, dark, onCategoryClick, onRefresh }) => {
  const [budgetsConfig, setBudgetsConfig] = useState({});
  const [selectedCat, setSelectedCat] = useState('food');
  const [limitInput, setLimitInput] = useState('');
  const [warnRatioInput, setWarnRatioInput] = useState('80');
  const [saving, setSaving] = useState(false);

  const fetchBudgetsConfig = useCallback(async () => {
    try {
      const data = await getBudgets();
      setBudgetsConfig(data || {});
    } catch (err) {
      console.error('Failed to fetch budgets config:', err);
    }
  }, []);

  useEffect(() => {
    fetchBudgetsConfig();
  }, [fetchBudgetsConfig, budgetStatuses]);

  // Pre-populate input when selected category or budgetsConfig changes
  useEffect(() => {
    const config = budgetsConfig[selectedCat.toLowerCase()];
    if (config) {
      setLimitInput(config.limit.toString());
      setWarnRatioInput(Math.round(config.warn_ratio * 100).toString());
    } else {
      setLimitInput('');
      setWarnRatioInput('80');
    }
  }, [selectedCat, budgetsConfig]);

  const rows = useMemo(() => {
    return (budgetStatuses || []).map(r => {
      const pct = r.percentage ? Math.min(r.percentage * 100, 120) : 0;
      const color = r.level === 'critical' ? '#ef4444' : r.level === 'warning' ? '#f59e0b' : '#22c55e';
      return {
        category: titleCase(r.category),
        rawCategory: r.category,
        spent: r.spent,
        budget: r.limit,
        pct,
        color
      };
    });
  }, [budgetStatuses]);

  const handleSave = async () => {
    const limit = Number(limitInput);
    if (!limit || limit <= 0) return;
    const warnRatio = Number(warnRatioInput) ? Number(warnRatioInput) / 100 : null;

    setSaving(true);
    try {
      await setBudget({
        category: selectedCat,
        limit,
        warn_ratio: warnRatio
      });
      if (onRefresh) await onRefresh();
      await fetchBudgetsConfig();
    } catch (err) {
      console.error('Failed to set budget:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await deleteBudget(selectedCat);
      if (onRefresh) await onRefresh();
      await fetchBudgetsConfig();
    } catch (err) {
      console.error('Failed to delete budget:', err);
    } finally {
      setSaving(false);
    }
  };

  const hasExistingBudget = Boolean(budgetsConfig[selectedCat.toLowerCase()]);

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Monthly Budget Overview */}
      <div className="vx-card p-5">
        <p className="text-sm font-medium mb-4" style={{ color: 'var(--text-1)' }}>Monthly Budget Overview</p>
        {rows.length > 0 ? (
          <div className="space-y-4">
            {rows.map((r) => (
              <div
                key={r.category}
                className="cursor-pointer"
                onClick={() => onCategoryClick && onCategoryClick(r.rawCategory)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onCategoryClick && onCategoryClick(r.rawCategory);
                  }
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs" style={{ color: 'var(--text-2)' }}>{r.category}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-2)' }}>{formatINR(r.spent)} / {formatINR(r.budget)}</span>
                    <span
                      className="text-xs font-medium px-1.5 py-0.5 rounded"
                      style={{
                        color: r.color,
                        background: r.color === '#ef4444' ? 'rgba(248,113,113,0.10)' : r.color === '#f59e0b' ? 'rgba(251,191,36,0.10)' : 'rgba(52,211,153,0.10)',
                      }}
                    >
                      {Math.round(r.pct)}%
                    </span>
                  </div>
                </div>
                <div className="vx-bar-track">
                  <div className="vx-bar-fill" style={{ width: `${Math.min(r.pct, 100)}%`, background: r.color }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-2)' }}>No budgets configured. Set one below to start tracking!</p>
        )}
      </div>

      {/* Manual Budget Management Form */}
      <div className="vx-card p-5">
        <p className="text-sm font-medium mb-4" style={{ color: 'var(--text-1)' }}>Manage Budget Manually</p>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="vx-label">Category</label>
            <select
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
              value={selectedCat}
              onChange={(e) => setSelectedCat(e.target.value)}
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{titleCase(c)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="vx-label">Limit (₹)</label>
            <input
              type="number"
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              placeholder="e.g. 5000"
              min="1"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="vx-label">Alert Threshold (%)</label>
            <input
              type="number"
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
              value={warnRatioInput}
              onChange={(e) => setWarnRatioInput(e.target.value)}
              placeholder="e.g. 80"
              min="1"
              max="100"
            />
          </div>
          <div className="sm:col-span-3 flex justify-end gap-3 mt-2">
            {hasExistingBudget && (
              <button
                type="button"
                className="vx-btn-ghost text-sm px-5 py-2.5 text-red-500 hover:text-white border-red-500 hover:border-red-600 hover:bg-red-500 transition-colors"
                style={{ borderColor: 'rgba(239, 68, 68, 0.4)' }}
                onClick={handleDelete}
                disabled={saving}
              >
                Clear
              </button>
            )}
            <button
              type="button"
              className="vx-btn-primary text-sm px-5 py-2.5"
              onClick={handleSave}
              disabled={saving || !limitInput}
            >
              {saving ? 'Saving…' : 'Set Budget'}
            </button>
          </div>
        </div>
      </div>

      {/* Voice Budget Commands Reference */}
      <div className="vx-card p-5">
        <p className="text-sm font-medium mb-4" style={{ color: 'var(--text-1)' }}>Voice Budget Commands</p>
        <div className="space-y-2">
          {[
            'set budget for food to 10000',
            'set budget for transport to 4000',
            "what's my food budget",
            'show my budgets',
            'remove budget for entertainment',
            'set budget for utilities to 5000 warn me at 70 percent'
          ].map((cmd, i) => (
            <div key={i} className="vx-surface px-4 py-2 text-xs font-mono" style={{ color: 'var(--text-2)' }}>
              {cmd}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
