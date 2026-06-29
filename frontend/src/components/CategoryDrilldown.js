import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { getCategoryExpenses } from '../api';
import { formatINR, titleCase } from '../utils';

const MERCHANT_PALETTE = ['var(--top-accent-1)', 'var(--top-accent-2)', 'var(--top-accent-3)', 'var(--accent)', 'var(--text-2)'];

const CategoryDrilldown = ({ category, onClose }) => {
  const [period, setPeriod] = useState('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const requestRef = useRef(0);

  // Helper function to calculate YYYY-MM-DD
  const formatDate = (date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const fetchExpenses = useCallback(async () => {
    if (!category) return;
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
      end = formatDate(today);
    } else if (period === '30d') {
      const past = new Date();
      past.setDate(today.getDate() - 29);
      start = formatDate(past);
      end = formatDate(today);
    } else if (period === 'month') {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      start = formatDate(firstDay);
      end = formatDate(today);
    } else if (period === 'custom') {
      if (!customStart || !customEnd) {
        setLoading(false);
        return; // Don't fetch until both dates are entered
      }
      start = customStart;
      end = customEnd;
    }

    try {
      const res = await getCategoryExpenses(category, { start, end });
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
  }, [category, period, customStart, customEnd]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  if (!category) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4 py-6 overflow-y-auto backdrop-blur-sm">
      <div 
        className="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[90vh] border"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      >
        {/* Header */}
        <div 
          className="border-b px-6 py-4 flex items-center justify-between"
          style={{ background: 'var(--accent-muted)', borderColor: 'var(--border)' }}
        >
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>
            {titleCase(category)} Expenses
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="transition-colors p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
            style={{ color: 'var(--text-2)' }}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Period Selector */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex p-1 rounded-lg gap-1 max-w-max" style={{ background: 'var(--bg-surface)' }}>
              {[
                { id: '7d', label: '7 Days' },
                { id: '30d', label: '30 Days' },
                { id: 'month', label: 'This Month' },
                { id: 'custom', label: 'Custom' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
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
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="rounded-lg border px-3 py-1.5 text-xs outline-none focus:border-blue-400"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
                />
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="rounded-lg border px-3 py-1.5 text-xs outline-none focus:border-blue-400"
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
              <div className="space-y-3">
                <h4 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Merchant Breakdown</h4>
                {data.merchant_breakdown && data.merchant_breakdown.length > 0 ? (
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
                ) : (
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>No merchant data available.</p>
                )}
              </div>

              {/* Expense Table */}
              <div className="space-y-3">
                <h4 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Expense Details</h4>
                <div className="border rounded-xl overflow-hidden max-h-60 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 border-b font-semibold" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-2)' }}>
                      <tr>
                        <th className="px-4 py-2">Date & Time</th>
                        <th className="px-4 py-2">Amount</th>
                        <th className="px-4 py-2">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                      {data.expenses && data.expenses.length > 0 ? (
                        data.expenses.map((e) => (
                          <tr key={e.id} className="hover:bg-white/5" style={{ borderBottom: '0.5px solid var(--border)' }}>
                            <td className="px-4 py-2 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
                              {e.date} <span style={{ color: 'var(--border)' }}>|</span> {e.time}
                            </td>
                            <td className="px-4 py-2 font-bold whitespace-nowrap" style={{ color: 'var(--text-1)' }}>
                              {formatINR(e.amount)}
                            </td>
                            <td className="px-4 py-2 max-w-[200px] truncate" style={{ color: 'var(--text-2)' }} title={e.description || ''}>
                              {e.description || '—'}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={3} className="px-4 py-6 text-center" style={{ color: 'var(--text-3)' }}>
                            No expenses in this period.
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
