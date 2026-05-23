import React from 'react';
import { PieChart } from 'lucide-react';
import { formatINR } from '../utils';

const CategoryPieChart = ({ categorySpending }) => {
  return (
    <div className="app-card border-2 border-blue-200 p-6">
      <h3 className="text-lg font-bold text-blue-900 mb-4 flex items-center gap-2">
        <PieChart className="w-5 h-5" />
        Category Distribution
      </h3>
      {categorySpending.length > 0 ? (
        <>
          <div className="relative w-48 h-48 mx-auto mb-4">
            <svg viewBox="0 0 100 100" className="transform -rotate-90">
              {(() => {
                let currentAngle = 0;
                const colors = ['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'];
                const total = categorySpending.reduce((sum, c) => sum + c.amount, 0) || 1;

                return categorySpending.map((cat, idx) => {
                  const percentage = total ? (cat.amount / total) * 100 : 0;
                  const angle = (percentage / 100) * 360;
                  const largeArc = angle > 180 ? 1 : 0;

                  const startX = 50 + 40 * Math.cos((currentAngle * Math.PI) / 180);
                  const startY = 50 + 40 * Math.sin((currentAngle * Math.PI) / 180);
                  const endX = 50 + 40 * Math.cos(((currentAngle + angle) * Math.PI) / 180);
                  const endY = 50 + 40 * Math.sin(((currentAngle + angle) * Math.PI) / 180);

                  const path = `M 50 50 L ${startX} ${startY} A 40 40 0 ${largeArc} 1 ${endX} ${endY} Z`;
                  currentAngle += angle;

                  return (
                    <path
                      key={cat.category}
                      d={path}
                      fill={colors[idx % colors.length]}
                      stroke="white"
                      strokeWidth="0.5"
                    />
                  );
                });
              })()}
            </svg>
          </div>
          <div className="space-y-2">
            {categorySpending.map((cat, idx) => {
              const colors = ['bg-blue-900', 'bg-blue-700', 'bg-blue-500', 'bg-blue-400', 'bg-blue-300'];
              return (
                <div key={`category-spending-${cat.category}-${idx}`} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded ${colors[idx % colors.length]}`}></div>
                    <span className="text-blue-800">{cat.category}</span>
                  </div>
                  <span className="font-semibold text-blue-900">{formatINR(cat.amount)}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="text-blue-700">Add expenses to see the category distribution chart.</p>
      )}
    </div>
  );
};

export default CategoryPieChart;
