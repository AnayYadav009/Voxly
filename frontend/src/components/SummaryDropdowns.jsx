import React from 'react';
import { Wallet, Calendar, TrendingUp, BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import { formatINR } from '../utils';

const SummaryDropdowns = ({
  toggleSection,
  expandedSection,
  todayTotal,
  weeklyTotal,
  dailyAverage,
  weeklyTopCategories,
  weeklySummaryLines,
  monthlyTotal,
  monthlySummaryLines,
  monthlyCategories,
  forecast,
}) => {
  return (
    <div className="col-span-12 space-y-4 lg:col-span-7">
      {/* Daily Total */}
      <div className="app-card border-2 border-blue-200 overflow-hidden">
        <button
          onClick={() => toggleSection('daily')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-blue-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Wallet className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-blue-900">Today's Total</span>
            <span className="text-xl font-bold text-blue-700">{formatINR(todayTotal)}</span>
          </div>
          {expandedSection === 'daily' ? (
            <ChevronUp className="w-5 h-5 text-blue-600" />
          ) : (
            <ChevronDown className="w-5 h-5 text-blue-600" />
          )}
        </button>
        {expandedSection === 'daily' && (
          <div className="px-6 py-4 bg-blue-50 border-t border-blue-200">
            <p className="text-blue-800">
              Latest total for today. Keep logging expenses to stay on top of your spending.
            </p>
          </div>
        )}
      </div>

      {/* Weekly Total */}
      <div className="app-card border-2 border-blue-200 overflow-hidden">
        <button
          onClick={() => toggleSection('weeklyTotal')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-blue-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-blue-900">Weekly Total</span>
            <span className="text-xl font-bold text-blue-700">
              {weeklyTotal !== null && weeklyTotal !== undefined ? formatINR(weeklyTotal) : '—'}
            </span>
          </div>
          {expandedSection === 'weeklyTotal' ? (
            <ChevronUp className="w-5 h-5 text-blue-600" />
          ) : (
            <ChevronDown className="w-5 h-5 text-blue-600" />
          )}
        </button>
        {expandedSection === 'weeklyTotal' && (
          <div className="px-6 py-4 bg-blue-50 border-t border-blue-200 space-y-2 text-blue-800">
            {weeklySummaryLines.length > 0 ? (
              weeklySummaryLines.map((line, index) => <p key={`weekly-line-${index}`}>{line}</p>)
            ) : (
              <p>No weekly data yet. Add a few expenses to see insights.</p>
            )}
          </div>
        )}
      </div>

      {/* Weekly Summary */}
      <div className="app-card border-2 border-blue-200 overflow-hidden">
        <button
          onClick={() => toggleSection('weeklySummary')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-blue-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-blue-900">Weekly Summary</span>
          </div>
          {expandedSection === 'weeklySummary' ? (
            <ChevronUp className="w-5 h-5 text-blue-600" />
          ) : (
            <ChevronDown className="w-5 h-5 text-blue-600" />
          )}
        </button>
        {expandedSection === 'weeklySummary' && (
          <div className="px-6 py-4 bg-blue-50 border-t border-blue-200">
            {weeklySummaryLines.length > 0 ? (
              <>
                <p className="text-blue-800 mb-3">
                  Weekly spending: {weeklyTotal !== null && weeklyTotal !== undefined ? formatINR(weeklyTotal) : '—'} {' | '}
                  Daily average: {dailyAverage !== null && dailyAverage !== undefined ? formatINR(dailyAverage) : '—'}
                </p>
                {weeklyTopCategories.length > 0 && (
                  <>
                    <p className="text-blue-800 font-semibold mb-2">Top categories:</p>
                    <ul className="space-y-1">
                      {weeklyTopCategories.map((cat, idx) => (
                        <li key={`weekly-cat-${idx}`} className="text-blue-700">
                          • {cat.name}: {cat.amount !== null && cat.amount !== undefined ? formatINR(cat.amount) : '—'}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            ) : (
              <p className="text-blue-800">Weekly insights will appear after you add expenses.</p>
            )}
          </div>
        )}
      </div>

      {/* Monthly Summary */}
      <div className="app-card border-2 border-blue-200 overflow-hidden">
        <button
          onClick={() => toggleSection('monthlySummary')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-blue-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-blue-900">Monthly Summary</span>
            <span className="text-xl font-bold text-blue-700">
              {monthlyTotal !== null && monthlyTotal !== undefined ? formatINR(monthlyTotal) : '—'}
            </span>
          </div>
          {expandedSection === 'monthlySummary' ? (
            <ChevronUp className="w-5 h-5 text-blue-600" />
          ) : (
            <ChevronDown className="w-5 h-5 text-blue-600" />
          )}
        </button>
        {expandedSection === 'monthlySummary' && (
          <div className="px-6 py-4 bg-blue-50 border-t border-blue-200">
            {monthlySummaryLines.length > 0 ? (
              <>
                {monthlySummaryLines.map((line, index) => (
                  <p key={`monthly-line-${index}`} className="text-blue-800 mb-2">
                    {line}
                  </p>
                ))}
                {monthlyCategories.length > 0 && (
                  <>
                    <p className="text-blue-800 font-semibold mb-2">Leading categories:</p>
                    <ul className="space-y-1">
                      {monthlyCategories.map((cat, index) => (
                        <li key={`monthly-cat-${index}`} className="text-blue-700">
                          • {cat.name}: {cat.amount !== null && cat.amount !== undefined ? formatINR(cat.amount) : '—'}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            ) : (
              <p className="text-blue-800">Monthly breakdown will refresh once expenses are logged.</p>
            )}
          </div>
        )}
      </div>

      {/* Forecast KPI Card */}
      {forecast && forecast.projected_total !== null && (
        <div className="app-card border-2 border-blue-200 overflow-hidden">
          <div className="px-6 py-4 flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-blue-900">Month-end Forecast</span>
            <span className="text-xl font-bold text-blue-700">{formatINR(forecast.projected_total)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default SummaryDropdowns;
