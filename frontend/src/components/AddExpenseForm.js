import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { titleCase } from '../utils';
import { CATEGORY_COLORS } from '../constants';

export const AddExpenseForm = ({ onAddExpense, submitting }) => {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('food');
  const [note, setNote] = useState('');

  const handleAdd = async () => {
    const v = Number(amount);
    if (!v || v <= 0) return;
    await onAddExpense({ amount: v, category, description: note });
    setAmount('');
    setNote('');
  };

  return (
    <div className="card">
      <div className="card-title">Add Expense</div>
      <div className="form-grid">
        <div className="form-group">
          <label className="form-label">Amount (₹)</label>
          <input
            type="number"
            className="form-input"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0"
            min="0"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Category</label>
          <select className="form-select" value={category} onChange={e => setCategory(e.target.value)}>
            {['food','transport','entertainment','shopping','utilities','health','personal','other'].map(c => (
              <option key={c} value={c}>{titleCase(c)}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Note (optional)</label>
          <input
            type="text"
            className="form-input"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Add a note…"
          />
        </div>
        <button className="btn-primary" onClick={handleAdd} disabled={submitting}>
          <Plus size={15} />
          {submitting ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  );
};
