import React from 'react';
import { Plus } from 'lucide-react';
import { titleCase } from '../utils';

const AddExpenseForm = ({
  newExpense,
  setNewExpense,
  handleAddExpense,
  submitting,
  categories,
}) => {
  return (
    <div className="app-card p-6 border-2 border-blue-200">
      <h3 className="text-xl font-bold text-blue-900 mb-4 flex items-center gap-2">
        <Plus className="w-6 h-6" />
        Add Expense Manually
      </h3>
      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="flex-1 min-w-[200px] w-full">
          <label className="block text-sm font-semibold text-blue-900 mb-2">Amount (₹)</label>
          <input
            type="number"
            value={newExpense.amount}
            onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
            placeholder="Enter amount"
            className="w-full px-4 py-3 border-2 border-blue-200 rounded-lg focus:outline-none focus:border-blue-500 text-blue-900"
          />
        </div>
        <div className="flex-1 min-w-[200px] w-full">
          <label className="block text-sm font-semibold text-blue-900 mb-2">Category</label>
          <select
            value={newExpense.category}
            onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })}
            className="w-full px-4 py-3 border-2 border-blue-200 rounded-lg focus:outline-none focus:border-blue-500 text-blue-900"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>{titleCase(cat)}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleAddExpense}
          disabled={submitting}
          className={`px-8 py-3 rounded-lg font-semibold transition-colors shadow-md ${
            submitting
              ? 'bg-blue-300 text-white cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {submitting ? 'Adding...' : 'Add Expense'}
        </button>
      </div>
    </div>
  );
};

export default AddExpenseForm;
