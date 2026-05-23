import React from 'react';
import { BarChart3 } from 'lucide-react';
import { formatINR } from '../utils';

const DailyBarChart = ({ dailySpending, maxDaily, userBudgets }) => {
  return (
    <div className="app-card border-2 border-blue-200 p-6">
      <h3 className="text-lg font-bold text-blue-900 mb-4 flex items-center gap-2">
        <BarChart3 className="w-5 h-5" />
        Last 7 Days Spending
      </h3>
      <div className="h-64 flex items-end justify-around gap-1 px-4">
        {dailySpending.map((day, idx) => {
          const height = maxDaily ? (day.amount / maxDaily) * 100 : 0;
          const avgDailyBudget = Object.values(userBudgets || {}).reduce((sum, b) => sum + (b.limit || 0), 0) / 30;
          const isOverBudget = avgDailyBudget > 0 && day.amount > avgDailyBudget;
          return (
            <div key={`daily-${idx}`} className="flex flex-col items-center">
              <div className="flex flex-col items-center justify-end h-52">
                <div className="relative group">
                  <div
                    className={`w-10 rounded-t transition-all hover:opacity-80 ${
                      isOverBudget ? 'bg-red-500' : 'bg-blue-600'
                    }`}
                    style={{ height: `${(height / 100) * 208}px` }}
                  ></div>
                  <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-blue-900 text-white px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                    {formatINR(day.amount)}
                    {isOverBudget && <div className="text-red-300 text-xs">Over budget!</div>}
                  </div>
                </div>
              </div>
              <span className="text-xs text-blue-700 mt-2 font-medium">{day.day}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 pt-4 border-t border-blue-200">
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-blue-600 rounded"></div>
            <span className="text-blue-700">Normal</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-red-500 rounded"></div>
            <span className="text-blue-700">Over Budget</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DailyBarChart;
