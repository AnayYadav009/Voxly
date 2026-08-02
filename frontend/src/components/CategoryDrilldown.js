import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, ArrowUpDown, ArrowUp, ArrowDown, Filter, Calendar } from 'lucide-react';
import { getCategoryExpenses } from '../api';
import { formatINR, titleCase } from '../utils';

const MERCHANT_PALETTE = ['var(--top-accent-1)', 'var(--top-accent-2)', 'var(--top-accent-3)', 'var(--accent)', 'var(--text-2)'];

const CATEGORIES = [
  { id: 'all', label: 'All Categories' },
  { id: 'food', label: 'Food' },
  { id: 'transport', label: 'Transport' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'utilities', label: 'Utilities' },
  { id: 'health', label: 'Health' },
  { id: 'personal', label: 'Personal' },
  { id: 'other', label: 'Other' },
];

const CategoryDrilldown = ({ category: initialCategory, onClose }) => {
  const [category, setCategory] = useState(initialCategory || 'all');
  const [period, setPeriod] = useState('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  useEffect(() => {
    if (initialCategory) {
      setCategory(initialCategory);
    }
  }, [initialCategory]);
  
  // Sorting state: default Date Newest First ('date', 'desc')
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const requestRef = useRef(0);

  const formatDate = (date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const fetchExpenses = useCallback(async () => {
    const currentRequestId = ++requestRef.current;
    setLoading(true);
    setError(null);

    let start = '';
    let end = '';
    const today = new Date();

    if (period === '7d') {
      const past = new Date();
      past.setDate(today.getDate() - 6);
      start = formatDate(past);
      end = '';
    } else if (period === '30d') {
      const past = new Date();
      past.setDate(today.getDate() - 29);
      start = formatDate(past);
      end = '';
    } else if (period === '90d') {
      const past = new Date();
      past.setDate(today.getDate() - 89);
      start = formatDate(past);
      end = '';
    } else if (period === 'month') {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      start = formatDate(firstDay);
      end = '';
    } else if (period === 'last_month') {
      const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
      start = formatDate(firstDay);
      end = formatDate(lastDay);
    } else if (period === 'year') {
      const firstDay = new Date(today.getFullYear(), 0, 1);
      start = formatDate(firstDay);
      end = '';
    } else if (period === 'all') {
      start = '';
      end = '';
    } else if (period === 'custom') {
      if (!customStart || !customEnd) {
        setLoading(false);
        return;
      }
      start = customStart;
      end = customEnd;
    }

    try {
      const res = await getCategoryExpenses(category, { start, end, sortBy, order: sortOrder });
      if (currentRequestId === requestRef.current) {
        setData(res);
      }
    } catch (err) {
      if (currentRequestId === requestRef.current) {
        setError(err.message || 'Failed to fetch expenses.');
      }
    } finally {
      if (currentRequestId === requestRef.current) {
        setLoading(false);
      }
    }
  }, [category, period, customStart, customEnd, sortBy, sortOrder]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  // Client-side sorted expenses list for instant sorting response
  const sortedExpenses = useMemo(() => {
    if (!data?.expenses) return [];
    const list = [...data.expenses];
    list.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];

      if (sortBy === 'amount') {
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
      } else if (sortBy === 'date') {
        valA = `${a.date || ''} ${a.time || ''}`;
        valB = `${b.date || ''} ${b.time || ''}`;
      } else {
        valA = String(valA || '').toLowerCase();
        valB = String(valB || '').toLowerCase();
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [data?.expenses, sortBy, sortOrder]);

  const handleHeaderClick = (field) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const getSortIcon = (field) => {
    if (sortBy !== field) {
      return <ArrowUpDown className="w-3 h-3 opacity-40 inline-block ml-1" />;
    }
    return sortOrder === 'asc' 
      ? <ArrowUp className="w-3 h-3 inline-block ml-1" style={{ color: 'var(--accent)' }} /> 
      : <ArrowDown className="w-3 h-3 inline-block ml-1" style={{ color: 'var(--accent)' }} />;
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4 py-6 overflow-y-auto backdrop-blur-sm">
      <div 
        className="w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh] border"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      >
        {/* Header */}
        <div 
          className="border-b px-6 py-4 flex items-center justify-between"
          style={{ background: 'var(--accent-muted)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <Filter className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <div>
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>
                Expenses Breakdown & Custom Sorting
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                Analyze & sort all expenses by category and timeframe
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="transition-colors p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
            style={{ color: 'var(--text-2)' }}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Controls: Category Selector & Timeframe Selector */}
          <div className="flex flex-col gap-4">
            {/* Row 1: Category Selector + Timeframe Selector */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {/* Category Dropdown */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold shrink-0" style={{ color: 'var(--text-2)' }}>Category:</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="rounded-xl border px-3 py-1.5 text-xs font-medium outline-none transition-colors cursor-pointer"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
                >
                  {CATEGORIES.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>

              {/* Quick Sort Shortcuts */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold shrink-0" style={{ color: 'var(--text-2)' }}>Sort by:</label>
                <select
                  value={`${sortBy}-${sortOrder}`}
                  onChange={(e) => {
                    const [field, ord] = e.target.value.split('-');
                    setSortBy(field);
                    setSortOrder(ord);
                  }}
                  className="rounded-xl border px-3 py-1.5 text-xs font-medium outline-none transition-colors cursor-pointer"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
                >
                  <option value="date-desc">Newest First (Date ↓)</option>
                  <option value="date-asc">Oldest First (Date ↑)</option>
                  <option value="amount-desc">Highest Amount (₹ ↓)</option>
                  <option value="amount-asc">Lowest Amount (₹ ↑)</option>
                  <option value="description-asc">Description (A-Z)</option>
                  <option value="description-desc">Description (Z-A)</option>
                </select>
              </div>
            </div>

            {/* Row 2: Timeframe Preset Pills */}
            <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl" style={{ background: 'var(--bg-surface)' }}>
              {[
                { id: '7d', label: '7 Days' },
                { id: '30d', label: '30 Days' },
                { id: '90d', label: '90 Days' },
                { id: 'month', label: 'This Month' },
                { id: 'last_month', label: 'Last Month' },
                { id: 'year', label: 'This Year' },
                { id: 'all', label: 'All Time' },
                { id: 'custom', label: 'Custom' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    period === p.id ? 'shadow-sm' : ''
                  }`}
                  style={{
                    background: period === p.id ? 'var(--bg-card)' : 'transparent',
                    color: period === p.id ? 'var(--text-1)' : 'var(--text-2)'
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {period === 'custom' && (
              <div className="flex items-center gap-2 pt-1">
                <Calendar className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="rounded-xl border px-3 py-1.5 text-xs outline-none"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
                />
                <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="rounded-xl border px-3 py-1.5 text-xs outline-none"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
                />
              </div>
            )}
          </div>

          {loading && (
            <div className="py-12 text-center text-sm font-medium animate-pulse" style={{ color: 'var(--text-2)' }}>
              Loading expenses data...
            </div>
          )}

          {error && !loading && (
            <div className="py-8 text-center space-y-4">
              <p className="text-sm font-medium text-red-400">{error}</p>
              <button
                type="button"
                onClick={fetchExpenses}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold shadow-md hover:bg-blue-700 transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {data && !loading && !error && (
            <div className="space-y-6">
              {/* Summary Line */}
              <div 
                className="rounded-xl border p-4 flex justify-around text-center"
                style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)' }}
              >
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-2)' }}>Total Spent</div>
                  <div className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>{formatINR(data.total)}</div>
                </div>
                <div className="border-r" style={{ borderColor: 'var(--accent-border)' }} />
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-2)' }}>Transactions</div>
                  <div className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>{data.count}</div>
                </div>
              </div>

              {/* Merchant Breakdown */}
              {data.merchant_breakdown && data.merchant_breakdown.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Merchant Breakdown</h4>
                  <div className="space-y-3">
                    {data.merchant_breakdown.map((item, idx) => {
                      const barColor = MERCHANT_PALETTE[idx % MERCHANT_PALETTE.length];
                      return (
                        <div key={item.label} className="space-y-1">
                          <div className="flex items-center justify-between text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                            <span>{item.label} <span style={{ color: 'var(--text-3)' }}>({item.count} order{item.count !== 1 ? 's' : ''})</span></span>
                            <span style={{ color: 'var(--text-1)' }}>{formatINR(item.total)} ({item.percentage.toFixed(1)}%)</span>
                          </div>
                          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-surface)' }}>
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${item.percentage}%`, background: barColor }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Expense Table with Column Headers for Interactive Sorting */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                    Expense Details ({sortedExpenses.length})
                  </h4>
                  <span className="text-xs" style={{ color: 'var(--text-2)' }}>
                    Click column headers to sort
                  </span>
                </div>
                
                <div className="border rounded-xl overflow-hidden max-h-72 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 border-b font-semibold select-none" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-2)' }}>
                      <tr>
                        <th 
                          onClick={() => handleHeaderClick('date')} 
                          className="px-4 py-2.5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                        >
                          Date & Time {getSortIcon('date')}
                        </th>
                        <th 
                          onClick={() => handleHeaderClick('amount')} 
                          className="px-4 py-2.5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                        >
                          Amount {getSortIcon('amount')}
                        </th>
                        {category === 'all' && (
                          <th 
                            onClick={() => handleHeaderClick('category')} 
                            className="px-4 py-2.5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          >
                            Category {getSortIcon('category')}
                          </th>
                        )}
                        <th 
                          onClick={() => handleHeaderClick('description')} 
                          className="px-4 py-2.5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                        >
                          Description {getSortIcon('description')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                      {sortedExpenses.length > 0 ? (
                        sortedExpenses.map((e) => (
                          <tr key={e.id} className="hover:bg-white/5 transition-colors" style={{ borderBottom: '0.5px solid var(--border)' }}>
                            <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
                              {e.date} <span style={{ color: 'var(--border)' }}>|</span> {e.time || '—'}
                            </td>
                            <td className="px-4 py-2.5 font-bold whitespace-nowrap" style={{ color: 'var(--text-1)' }}>
                              {formatINR(e.amount)}
                            </td>
                            {category === 'all' && (
                              <td className="px-4 py-2.5 whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
                                  {titleCase(e.category)}
                                </span>
                              </td>
                            )}
                            <td className="px-4 py-2.5 max-w-[200px] truncate" style={{ color: 'var(--text-2)' }} title={e.description || ''}>
                              {e.description || '—'}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={category === 'all' ? 4 : 3} className="px-4 py-6 text-center" style={{ color: 'var(--text-3)' }}>
                            No expenses matching the selected category and period.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CategoryDrilldown;
