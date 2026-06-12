import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { getCategoryExpenses } from '../api';
import { formatINR, titleCase } from '../utils';

const BLUE_PALETTE = ['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'];

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

  const fetchExpenses = async () => {
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
  };

  useEffect(() => {
    fetchExpenses();
    return () => {
      requestRef.current++;
    };
  }, [category, period, customStart, customEnd]);

  if (!category) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4 py-6 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col my-auto max-h-[90vh]">
        {/* Header */}
        <div className="border-b border-blue-100 bg-blue-600/10 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-blue-900">
            {titleCase(category)} Expenses
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-full hover:bg-slate-100/50"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Period Selector */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex bg-slate-100 p-1 rounded-lg gap-1 max-w-max">
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
                    period === p.id
                      ? 'bg-white text-blue-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
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
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-400"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-400"
                />
              </div>
            )}
          </div>

          {loading && (
            <div className="py-12 text-center text-slate-500 text-sm font-medium animate-pulse">
              Loading expenses data...
            </div>
          )}

          {error && !loading && (
            <div className="py-8 text-center space-y-4">
              <p className="text-sm text-red-600 font-medium">{error}</p>
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
              <div className="bg-blue-50/50 rounded-xl border border-blue-100/50 p-4 flex justify-around text-center">
                <div>
                  <div className="text-xs text-blue-700 font-semibold uppercase tracking-wider mb-1">Total Spent</div>
                  <div className="text-2xl font-bold text-blue-900">{formatINR(data.total)}</div>
                </div>
                <div className="border-r border-blue-100/60" />
                <div>
                  <div className="text-xs text-blue-700 font-semibold uppercase tracking-wider mb-1">Transactions</div>
                  <div className="text-2xl font-bold text-blue-900">{data.count}</div>
                </div>
              </div>

              {/* Merchant Breakdown */}
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-slate-800">Merchant Breakdown</h4>
                {data.merchant_breakdown && data.merchant_breakdown.length > 0 ? (
                  <div className="space-y-3">
                    {data.merchant_breakdown.map((item, idx) => {
                      const barColor = BLUE_PALETTE[idx % BLUE_PALETTE.length];
                      return (
                        <div key={item.label} className="space-y-1">
                          <div className="flex items-center justify-between text-xs font-medium text-slate-700">
                            <span>{item.label} <span className="text-slate-400 font-normal">({item.count} order{item.count !== 1 ? 's' : ''})</span></span>
                            <span>{formatINR(item.total)} ({item.percentage.toFixed(1)}%)</span>
                          </div>
                          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
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
                  <p className="text-xs text-slate-400">No merchant data available.</p>
                )}
              </div>

              {/* Expense Table */}
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-slate-800">Expense Details</h4>
                <div className="border border-slate-100 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 text-slate-500 font-semibold sticky top-0 border-b border-slate-100">
                      <tr>
                        <th className="px-4 py-2">Date & Time</th>
                        <th className="px-4 py-2">Amount</th>
                        <th className="px-4 py-2">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.expenses && data.expenses.length > 0 ? (
                        data.expenses.map((e) => (
                          <tr key={e.id} className="hover:bg-slate-50/50">
                            <td className="px-4 py-2 text-slate-500 whitespace-nowrap">
                              {e.date} <span className="text-slate-300 font-light">|</span> {e.time}
                            </td>
                            <td className="px-4 py-2 font-bold text-slate-800 whitespace-nowrap">
                              {formatINR(e.amount)}
                            </td>
                            <td className="px-4 py-2 text-slate-600 max-w-[200px] truncate" title={e.description || ''}>
                              {e.description || '—'}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
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
