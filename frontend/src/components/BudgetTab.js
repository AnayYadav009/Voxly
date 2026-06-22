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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Monthly Budget Overview */}
      <div className="card">
        <div className="card-title">Monthly Budget Overview</div>
        {rows.length > 0 ? rows.map((r) => (
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
          <p style={{ fontSize: 13, color: 'var(--text-3)' }}>No budgets configured. Set one below to start tracking!</p>
        )}
      </div>

      {/* Manual Budget Management Form */}
      <div className="card">
        <div className="card-title">Manage Budget Manually</div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Category</label>
            <select
              className="form-select"
              value={selectedCat}
              onChange={(e) => setSelectedCat(e.target.value)}
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{titleCase(c)}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Limit (₹)</label>
            <input
              type="number"
              className="form-input"
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              placeholder="e.g. 5000"
              min="1"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Alert Threshold (%)</label>
            <input
              type="number"
              className="form-input"
              value={warnRatioInput}
              onChange={(e) => setWarnRatioInput(e.target.value)}
              placeholder="e.g. 80"
              min="1"
              max="100"
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignSelf: 'stretch', justifyContent: 'flex-end', width: '100%' }}>
            {hasExistingBudget && (
              <button
                className="btn-danger"
                style={{
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 20px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'background 0.2s'
                }}
                onClick={handleDelete}
                disabled={saving}
              >
                Clear
              </button>
            )}
            <button className="btn-primary" onClick={handleSave} disabled={saving || !limitInput}>
              {saving ? 'Saving…' : 'Set Budget'}
            </button>
          </div>
        </div>
      </div>

      {/* Voice Budget Commands Reference */}
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
