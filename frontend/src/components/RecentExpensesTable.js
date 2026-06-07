import React from 'react';
import { X } from 'lucide-react';
import { formatINR, titleCase, getCatColor } from '../utils';

export const RecentExpensesTable = ({ expenses, dark, loading, title, onDelete }) => {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '16px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="card-title" style={{ marginBottom: 0 }}>{title || 'Recent Expenses'}</div>
        {loading && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Updating…</span>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="expense-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Amount</th>
              <th>Category</th>
              <th className="hide-mobile">Note</th>
              {onDelete && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {expenses.length > 0 ? expenses.map(e => {
              const color = getCatColor(e.category, dark);
              return (
                <tr key={e.id}>
                  <td className="date-cell">{e.date || '—'}</td>
                  <td className="amount-cell">{formatINR(e.amount)}</td>
                  <td>
                    <span className="cat-badge" style={{ background: `${color}22`, color }}>
                      <span className="cat-dot" style={{ background: color }} />
                      {titleCase(e.category)}
                    </span>
                  </td>
                  <td className="desc-cell hide-mobile">{e.description || '—'}</td>
                  {onDelete && (
                    <td>
                      <button
                        onClick={() => onDelete(e.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--text-3)',
                          padding: 4,
                          borderRadius: 4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'color 0.2s',
                        }}
                        title="Delete expense"
                      >
                        <X size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            }) : (
              <tr><td colSpan={onDelete ? 5 : 4} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '20px 0' }}>No expenses yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
