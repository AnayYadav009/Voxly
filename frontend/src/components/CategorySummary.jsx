import React from 'react';
import { formatINR } from '../utils';

const CategorySummary = ({ categoryData }) => {
  return (
    <div className="app-card p-6 border-2 border-blue-200">
      <h3 className="text-xl font-bold text-blue-900 mb-6">Category Summary</h3>
      {categoryData.length > 0 ? (
        <div className="space-y-3">
          {categoryData.map((cat, idx) => (
            <div key={`category-data-${idx}`} className="border-b border-blue-100 pb-3 last:border-b-0">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-blue-900">{cat.category}</span>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-blue-700">
                    {formatINR(cat.total)} / {formatINR(cat.budget)}
                  </span>
                  <span
                    className={`text-sm font-semibold ${
                      cat.percentage > 100
                        ? 'text-red-600'
                        : cat.percentage > 80
                        ? 'text-yellow-600'
                        : 'text-green-600'
                    }`}
                  >
                    {Math.round(cat.percentage)}%
                  </span>
                </div>
              </div>
              <div className="relative h-2 bg-blue-100 rounded-full overflow-hidden">
                <div
                  className={`absolute left-0 top-0 h-full rounded-full transition-all ${
                    cat.percentage > 100
                      ? 'bg-red-500'
                      : cat.percentage > 80
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                ></div>
                {cat.percentage > 80 && (
                  <div className="absolute right-2 top-0 h-full flex items-center">
                    <span className="text-xs text-white font-bold">
                      {cat.percentage > 100 ? '⚠️ Over Budget' : '⚠️ Warning'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-blue-700">Category insights will appear once you log some expenses.</p>
      )}
    </div>
  );
};

export default CategorySummary;
