import React from 'react';
import { BarChart3 } from 'lucide-react';
import { formatINR } from '../utils';

const MonthlyBarChart = ({ monthlyTrend, maxMonthly, forecast }) => {
  return (
    <div className="app-card border-2 border-blue-200 p-6">
      <h3 className="text-lg font-bold text-blue-900 mb-4 flex items-center gap-2">
        <BarChart3 className="w-5 h-5" />
        Monthly Totals (6 Months)
      </h3>
      {monthlyTrend.length > 0 ? (
        <>
          <div className="h-64 flex items-end justify-around gap-1 px-4 relative">
            {monthlyTrend.map((month, idx) => {
              const height = maxMonthly ? (month.amount / maxMonthly) * 100 : 0;
              return (
                <div key={`monthly-${idx}`} className="flex flex-col items-center z-10">
                  <div className="flex flex-col items-center justify-end h-52 relative">
                    <div className="relative group">
                      <div
                        className="w-10 rounded-t transition-all hover:opacity-80 bg-blue-600"
                        style={{ height: `${(height / 100) * 208}px` }}
                      ></div>
                      <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-blue-900 text-white px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-20">
                        {formatINR(month.amount)}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-blue-700 mt-2 font-medium text-center leading-tight">{month.label}</span>
                </div>
              );
            })}
            {forecast && forecast.projected_total !== null && (
              <div
                className="absolute left-4 right-4 border-t-2 border-dashed border-indigo-400 pointer-events-none"
                style={{ bottom: `calc(1.5rem + ${maxMonthly ? (forecast.projected_total / maxMonthly) * 208 : 0}px)` }}
              >
                <span className="absolute -top-5 right-0 text-xs font-semibold text-indigo-600 bg-white/80 px-1 rounded">
                  Forecast: {formatINR(forecast.projected_total)}
                </span>
              </div>
            )}
          </div>
          <div className="mt-4 pt-4 border-t border-blue-200">
            <div className="text-xs text-blue-700 text-center">
              Recent monthly spending totals
            </div>
            {forecast && forecast.projected_total !== null && (() => {
              return (
                <div className="mt-2 pt-2 border-t border-blue-200 flex items-center gap-2 text-xs text-blue-700 justify-center">
                  <div className="flex items-center gap-1">
                    <div className="w-6 border-t-2 border-dashed border-blue-400" />
                    <span>Projected: {formatINR(forecast.projected_total)}</span>
                  </div>
                  <span className="text-blue-400">·</span>
                  <span className="text-blue-500">{forecast.confidence}</span>
                </div>
              );
            })()}
          </div>
        </>
      ) : (
        <p className="text-blue-700">Monthly totals will appear once you log expenses.</p>
      )}
    </div>
  );
};

export default MonthlyBarChart;
