import React from 'react';
import { titleCase, formatINR } from '../utils';

const ExpenseTable = ({
  recentExpenses,
  loading,
  expenseFilter,
  setExpenseFilter,
  getRecent,
  setRecentExpenses,
  mapRecentExpenses,
  editingId,
  setEditingId,
  editForm,
  setEditForm,
  apiUpdateExpense,
  setToast,
  loadData,
  categories,
}) => {
  const RECENT_LIMIT = 50;

  return (
    <div className="app-card p-6 border-2 border-blue-200">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-blue-900">Recent Expenses</h3>
        <div className="flex items-center gap-3">
          {loading && <span className="text-sm text-blue-600">Refreshing...</span>}
          <a
            href="/api/export?format=csv"
            className="text-sm text-blue-600 hover:underline font-medium"
            download
          >
            Export CSV
          </a>
        </div>
      </div>
      {/* Filter row */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div>
          <label className="block text-xs font-semibold text-blue-800 mb-1">From</label>
          <input
            type="date"
            value={expenseFilter.from}
            onChange={(e) => {
              const next = { ...expenseFilter, from: e.target.value };
              setExpenseFilter(next);
              getRecent(RECENT_LIMIT, next).then((res) => {
                const items = Array.isArray(res) ? res : [];
                setRecentExpenses(mapRecentExpenses(items));
              }).catch(() => {});
            }}
            className="px-3 py-2 border border-blue-200 rounded-lg text-sm text-blue-900 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-blue-800 mb-1">To</label>
          <input
            type="date"
            value={expenseFilter.to}
            onChange={(e) => {
              const next = { ...expenseFilter, to: e.target.value };
              setExpenseFilter(next);
              getRecent(RECENT_LIMIT, next).then((res) => {
                const items = Array.isArray(res) ? res : [];
                setRecentExpenses(mapRecentExpenses(items));
              }).catch(() => {});
            }}
            className="px-3 py-2 border border-blue-200 rounded-lg text-sm text-blue-900 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-blue-800 mb-1">Category</label>
          <select
            value={expenseFilter.category}
            onChange={(e) => {
              const next = { ...expenseFilter, category: e.target.value };
              setExpenseFilter(next);
              getRecent(RECENT_LIMIT, next).then((res) => {
                const items = Array.isArray(res) ? res : [];
                setRecentExpenses(mapRecentExpenses(items));
              }).catch(() => {});
            }}
            className="px-3 py-2 border border-blue-200 rounded-lg text-sm text-blue-900 focus:outline-none focus:border-blue-500"
          >
            <option value="">All</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{titleCase(cat)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto hidden md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b-2 border-blue-200">
              <th className="text-left py-3 px-4 text-blue-900 font-semibold">Date</th>
              <th className="text-left py-3 px-4 text-blue-900 font-semibold">Time</th>
              <th className="text-left py-3 px-4 text-blue-900 font-semibold">Amount</th>
              <th className="text-left py-3 px-4 text-blue-900 font-semibold">Category</th>
              <th className="text-left py-3 px-4 text-blue-900 font-semibold">Description</th>
              <th className="text-left py-3 px-4 text-blue-900 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {recentExpenses.length > 0 ? (
              recentExpenses.map((expense) => (
                editingId === expense.id ? (
                  <tr key={expense.id} className="border-b border-blue-100 bg-blue-50">
                    <td className="py-3 px-4 text-blue-800">{expense.date || '—'}</td>
                    <td className="py-3 px-4 text-blue-800">{expense.time || '—'}</td>
                    <td className="py-2 px-4">
                      <input
                        type="number"
                        value={editForm.amount}
                        onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                        className="w-24 px-2 py-1 border border-blue-300 rounded text-sm text-blue-900"
                      />
                    </td>
                    <td className="py-2 px-4">
                      <input
                        type="text"
                        value={editForm.category}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                        className="w-28 px-2 py-1 border border-blue-300 rounded text-sm text-blue-900"
                      />
                    </td>
                    <td className="py-2 px-4">
                      <input
                        type="text"
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                        className="w-full px-2 py-1 border border-blue-300 rounded text-sm text-blue-900"
                      />
                    </td>
                    <td className="py-2 px-4">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await apiUpdateExpense(expense.id, editForm);
                              setEditingId(null);
                              setToast({ type: 'success', message: 'Expense updated.' });
                              await loadData();
                            } catch (err) {
                              setToast({ type: 'error', message: err.message || 'Update failed.' });
                            }
                          }}
                          className="px-3 py-1 bg-green-600 text-white text-xs rounded font-semibold hover:bg-green-700"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1 bg-gray-300 text-gray-800 text-xs rounded font-semibold hover:bg-gray-400"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={expense.id} className="border-b border-blue-100 hover:bg-blue-50 transition-colors">
                    <td className="py-3 px-4 text-blue-800">{expense.date || '—'}</td>
                    <td className="py-3 px-4 text-blue-800">{expense.time || '—'}</td>
                    <td className="py-3 px-4 text-blue-900 font-semibold">{formatINR(expense.amount)}</td>
                    <td className="py-3 px-4">
                      <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                        {titleCase(expense.category)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-blue-700">{expense.description || '—'}</td>
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(expense.id);
                          setEditForm({
                            amount: String(expense.amount),
                            category: expense.category,
                            description: expense.description || '',
                          });
                        }}
                        className="px-3 py-1 bg-blue-100 text-blue-800 text-xs rounded font-semibold hover:bg-blue-200"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                )
              ))
            ) : (
              <tr>
                <td colSpan="6" className="py-4 px-4 text-center text-blue-700">
                  No expenses logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="space-y-4 md:hidden">
        {recentExpenses.length > 0 ? (
          recentExpenses.map((expense) => (
            <div key={`expense-card-${expense.id}`} className="border border-blue-100 rounded-xl p-4 bg-blue-50">
              <div className="flex items-center justify-between text-sm text-blue-800">
                <span>{expense.date || '—'}</span>
                <span>{expense.time || '—'}</span>
              </div>
              <p className="mt-2 text-lg font-semibold text-blue-900">{formatINR(expense.amount)}</p>
              <p className="text-sm text-blue-700">{expense.description || 'No description'}</p>
              <span className="inline-flex mt-3 px-3 py-1 bg-white text-blue-800 rounded-full text-xs font-semibold">
                {titleCase(expense.category)}
              </span>
            </div>
          ))
        ) : (
          <p className="text-blue-700">No expenses logged yet.</p>
        )}
      </div>
    </div>
  );
};

export default ExpenseTable;
