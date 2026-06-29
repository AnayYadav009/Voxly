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
    const statuses = Array.isArray(budgetStatuses) ? budgetStatuses : [];
    const totals = Array.isArray(categoryTotals) ? categoryTotals : [];

    const categoriesMap = new Map();

    // 1. Add configured budgets
    statuses.forEach(s => {
      const catKey = s.category.toLowerCase();
      categoriesMap.set(catKey, {
        category: titleCase(s.category),
        rawCategory: s.category,
        spent: s.spent || 0,
        budget: s.limit,
        isConfigured: true,
        warnRatio: s.warn_ratio || 0.8
      });
    });

    // 2. Add categories with active expenses but no custom budget
    totals.forEach(t => {
      const catKey = t.category.toLowerCase();
      if (!categoriesMap.has(catKey)) {
        categoriesMap.set(catKey, {
          category: titleCase(t.category),
          rawCategory: t.category,
          spent: t.amount,
          budget: 5000, // default limit
          isConfigured: false,
          warnRatio: 0.8 // default warn ratio
        });
      } else {
        const existing = categoriesMap.get(catKey);
        existing.spent = t.amount;
      }
    });

    return Array.from(categoriesMap.values()).map(r => {
      const pct = r.budget ? (r.spent / r.budget) * 100 : 0;
      const warnRatio = r.warnRatio;
      const color = pct >= 100 ? '#ef4444' : pct >= (warnRatio * 100) ? '#f59e0b' : '#22c55e';
      return {
        ...r,
        pct,
        color
      };
    });
  }, [budgetStatuses, categoryTotals]);

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
          <div className="space-y-3.5">
            {rows.map((r) => {
              const remaining = r.budget - r.spent;
              const isOver = remaining < 0;
              const absRemaining = Math.abs(remaining);

              return (
                <div
                  key={r.category}
                  className="p-4 rounded-xl border transition-all hover:border-gray-500/30"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                >
                  <div className="flex flex-col gap-2.5">
                    {/* Header: Category Name & Config status & pct */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{r.category}</span>
                        <span
                          className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded tracking-wider"
                          style={{
                            color: r.isConfigured ? 'var(--accent)' : 'var(--text-3)',
                            background: r.isConfigured ? 'var(--accent-muted)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${r.isConfigured ? 'var(--accent-border)' : 'var(--border)'}`
                          }}
                        >
                          {r.isConfigured ? 'Custom' : 'Default'}
                        </span>
                      </div>
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded"
                        style={{
                          color: r.color,
                          background: r.color === '#ef4444' ? 'rgba(239,68,68,0.10)' : r.color === '#f59e0b' ? 'rgba(245,158,11,0.10)' : 'rgba(34,197,94,0.10)',
                        }}
                      >
                        {Math.round(r.pct)}% Used
                      </span>
                    </div>

                    {/* Progress Bar with Alert threshold indicator line */}
                    <div className="relative pt-1 pb-1">
                      <div className="vx-bar-track h-2 bg-black/20 rounded-full overflow-hidden">
                        <div className="vx-bar-fill h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(r.pct, 100)}%`, background: r.color }} />
                      </div>
                      {/* Warning tick mark */}
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-yellow-500/50"
                        style={{ left: `${r.warnRatio * 100}%` }}
                        title={`Alert Threshold: ${r.warnRatio * 100}%`}
                      />
                    </div>

                    {/* Spent / Limit info & Alerts info & remaining status */}
                    <div className="flex flex-wrap items-center justify-between text-xs gap-2 pt-0.5">
                      <div style={{ color: 'var(--text-2)' }}>
                        <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{formatINR(r.spent)}</span>
                        <span> of {formatINR(r.budget)} limit</span>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                          Alerts at {Math.round(r.warnRatio * 100)}% ({formatINR(r.budget * r.warnRatio)})
                        </span>
                        
                        <span className={`font-semibold ${isOver ? 'text-red-400' : 'text-emerald-400'}`}>
                          {isOver ? `Over by ${formatINR(absRemaining)}` : `${formatINR(absRemaining)} left`}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-4 border-t pt-2 mt-1" style={{ borderColor: 'var(--border)' }}>
                      <button
                        type="button"
                        onClick={() => onCategoryClick && onCategoryClick(r.rawCategory)}
                        className="text-[11px] font-semibold hover:underline"
                        style={{ color: 'var(--accent)' }}
                      >
                        View Expenses
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCat(r.rawCategory);
                          setLimitInput(r.budget.toString());
                          setWarnRatioInput(Math.round(r.warnRatio * 100).toString());
                          document.getElementById('manage-budget-form')?.scrollIntoView({ behavior: 'smooth' });
                        }}
                        className="text-[11px] font-semibold hover:underline"
                        style={{ color: 'var(--text-2)' }}
                      >
                        Edit Limit
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-2)' }}>No budgets configured. Set one below to start tracking!</p>
        )}
      </div>

      {/* Manual Budget Management Form */}
      <div id="manage-budget-form" className="vx-card p-5">
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
