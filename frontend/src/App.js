import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Mic,
  TrendingUp,
  Calendar,
  Wallet,
  PieChart,
  BarChart3,
  Plus,
  Settings,
  X,
} from 'lucide-react';

import SchemeToggle, { useColorScheme } from './components/SchemeToggle';
import { BudgetTab } from './components/BudgetTab';

import {
  addExpense as apiAddExpense,
  deleteExpense,
  getCategoryBreakdown,
  getDailyTotals,
  getMonthlyTotals,
  getRecent,
  getSummary,
} from './api';
import ConfirmDialog from './components/ConfirmDialog';
import { AuthProvider, useAuth } from './context/AuthContext';

import { RECENT_LIMIT, NAV_TABS } from './constants';
import { formatINR, titleCase, parseWeeklySummary, parseMonthlySummary, normalizeCategoryTotals, mapRecentExpenses, normalizeCategoryChart, normalizeDailyChart, normalizeMonthlyChart, computeDailySpending } from './utils';
import CategoryDrilldown from './components/CategoryDrilldown';
import { useVoice } from './hooks/useVoice';

// ─── Hooks ────────────────────────────────────────────────────────────────────

const useToasts = () => {
  const [toasts, setToasts] = useState([]);
  const timerRefs = useRef({});

  const add = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-2), { id, message, type }]);
    timerRefs.current[id] = setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== id));
      delete timerRefs.current[id];
    }, 4000);
  }, []);

  const remove = useCallback((id) => {
    clearTimeout(timerRefs.current[id]);
    delete timerRefs.current[id];
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  return [toasts, add, remove];
};

// ─── Main Dashboard ───────────────────────────────────────────────────────────

const VoiceFinanceDashboard = ({ user, preferences = {}, onLogout, onToggleLogging, scheme, setScheme }) => {
  const [tab, setTab] = useState('dashboard');
  const [toasts, addToast] = useToasts();

  const [summary, setSummary] = useState(null);
  const [recentExpenses, setRecentExpenses] = useState([]);
  const [chartCategories, setChartCategories] = useState([]);
  const [chartDaily, setChartDaily] = useState([]);
  const [chartMonthly, setChartMonthly] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [preferenceSaving, setPreferenceSaving] = useState(false);

  const [budgetAlertOverride, setBudgetAlertOverride] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);

  const [newExpense, setNewExpense] = useState({ amount: '', category: 'food' });

  // Fix 3: Memory leak / state updates on unmounted component safety check
  const isMounted = useRef(true);
  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [summaryR, recentR, catR, dailyR, monthlyR] = await Promise.allSettled([
        getSummary(), getRecent(RECENT_LIMIT),
        getCategoryBreakdown(), getDailyTotals(7), getMonthlyTotals(6),
      ]);
      
      if (!isMounted.current) return;

      if (summaryR.status === 'fulfilled') setSummary(summaryR.value);
      else setSummary(null);

      if (recentR.status === 'fulfilled') {
        const p = recentR.value;
        const items = Array.isArray(p) ? p : Array.isArray(p?.items) ? p.items : Array.isArray(p?.recent) ? p.recent : [];
        setRecentExpenses(mapRecentExpenses(items));
      } else setRecentExpenses([]);

      if (catR.status === 'fulfilled') setChartCategories(catR.value?.items || catR.value?.data || []);
      if (dailyR.status === 'fulfilled') setChartDaily(dailyR.value?.items || dailyR.value?.data || []);
      if (monthlyR.status === 'fulfilled') setChartMonthly(monthlyR.value?.items || monthlyR.value?.data || []);
    } catch (err) {
      if (isMounted.current) addToast('Failed to load data', 'error');
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [addToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefresh = useCallback(() => {
    loadData(true);
  }, [loadData]);

  const { isRecording, voiceStatus, voiceProcessing, voiceConfirm, toggleRecording, handleQuickCommand, handleVoiceConfirmSelect, setVoiceConfirm, setVoiceStatus } = useVoice({
    addToast, loadData, isMounted,
    setSummary, setRecentExpenses, setChartCategories, setChartDaily, setChartMonthly,
    setBudgetAlertOverride,
  });

  const handleAddExpense = useCallback(async (arg) => {
    let amount, category, description;
    if (arg && typeof arg === 'object' && 'amount' in arg) {
      amount = arg.amount;
      category = arg.category;
      description = arg.description;
    } else {
      amount = Number(newExpense.amount);
      category = newExpense.category;
      description = '';
    }
    if (!amount || amount <= 0) return;
    setSubmitting(true);
    try {
      const r = await apiAddExpense({ amount, category, description });
      addToast(r.message || 'Expense added.', 'success');
      setNewExpense({ amount: '', category: 'food' });
      await loadData(true);
    } catch (err) { 
      addToast(err?.message || 'Failed.', 'error'); 
    } finally { 
      setSubmitting(false); 
    }
  }, [addToast, loadData, newExpense]);

  const handleDeleteExpense = useCallback(async (expenseId) => {
    try {
      await deleteExpense(expenseId);
      addToast('Expense deleted.', 'success');
      await loadData(true);
    } catch (err) {
      addToast(err?.message || 'Delete failed.', 'error');
    }
  }, [addToast, loadData]);

  const handleToggleLogging = useCallback(async (val) => {
    setPreferenceSaving(true);
    try { 
      await onToggleLogging(val); 
      addToast(val ? 'Logging enabled.' : 'Logging disabled.', 'success'); 
    } catch (err) { 
      addToast(err?.message || 'Failed to update.', 'error'); 
    } finally { 
      setPreferenceSaving(false); 
    }
  }, [onToggleLogging, addToast]);

  // Derived data
  const weeklySummaryData = useMemo(() => parseWeeklySummary(summary?.weekly_summary_data || summary?.weekly_summary), [summary?.weekly_summary, summary?.weekly_summary_data]);
  const monthlySummaryData = useMemo(() => parseMonthlySummary(summary?.monthly_summary_data || summary?.monthly_summary), [summary?.monthly_summary, summary?.monthly_summary_data]);
  const categoryTotals = useMemo(() => normalizeCategoryTotals(summary?.category_totals), [summary?.category_totals]);

  const dailyBudgetThreshold = useMemo(() => {
    const statuses = summary?.budget_status || [];
    if (!Array.isArray(statuses) || statuses.length === 0) return 1500;
    const totalLimit = statuses.reduce((sum, s) => sum + (Number(s.limit) || 0), 0);
    return totalLimit > 0 ? totalLimit / 30 : 1500;
  }, [summary?.budget_status]);

  const todayTotal = summary ? Number(summary.total_today) || 0 : 0;
  const monthlyTotal = summary?.monthly_total ?? monthlySummaryData.total ?? 0;
  const dailyAverage = weeklySummaryData.dailyAverage;

  const categorySpending = useMemo(() => {
    const fromApi = normalizeCategoryChart(chartCategories);
    if (fromApi.length > 0) return fromApi;
    return categoryTotals.map(item => ({ key: item.category, category: titleCase(item.category), amount: item.amount }));
  }, [chartCategories, categoryTotals]);

  const dailySpending = useMemo(() => {
    const fromApi = normalizeDailyChart(chartDaily);
    if (fromApi.length > 0) return fromApi;
    return computeDailySpending(recentExpenses);
  }, [chartDaily, recentExpenses]);

  const monthlyTrend = useMemo(() => normalizeMonthlyChart(chartMonthly), [chartMonthly]);

  const rawAlerts = useMemo(() => {
    const base = Array.isArray(summary?.budget_alerts) ? summary.budget_alerts : [];
    if (budgetAlertOverride && !base.includes(budgetAlertOverride)) return [budgetAlertOverride, ...base];
    return base;
  }, [summary?.budget_alerts, budgetAlertOverride]);

  const visibleAlerts = rawAlerts;

  const loggingEnabled = Boolean(preferences?.log_opt_in);
  const displayName = user?.display_name || user?.email || 'U';

  const userEmail = user?.email || '';
  const budgetWarning = null;
  const toast = toasts[0] || null;
  const error = null;

  const weeklySummaryLines = weeklySummaryData.lines || [];
  const monthlySummaryLines = monthlySummaryData.lines || [];

  const budgetAlerts = visibleAlerts;

  const handlePreferenceToggle = useCallback(async () => {
    await handleToggleLogging(!loggingEnabled);
  }, [handleToggleLogging, loggingEnabled]);

  const handleVoiceConfirmCancel = useCallback(() => {
    setVoiceConfirm(null);
    setVoiceStatus('Cancelled.');
  }, [setVoiceConfirm, setVoiceStatus]);

  const categoryData = useMemo(() => {
    const statuses = Array.isArray(summary?.budget_status) ? summary.budget_status : [];
    return categoryTotals.map((item) => {
      const matched = statuses.find(s => s.category.toLowerCase() === item.category.toLowerCase());
      const budget = matched ? matched.limit : 5000;
      const percentage = Math.round((item.amount / budget) * 100);
      return { category: titleCase(item.category), total: item.amount, budget, percentage };
    });
  }, [categoryTotals, summary?.budget_status]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text-1)' }}>
      <div className="flex h-screen overflow-hidden">

        {/* Sidebar — desktop only */}
        <aside
          className="hidden lg:flex flex-col w-56 shrink-0 border-r"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2.5 px-5 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
              <Mic className="w-3.5 h-3.5" style={{ color: 'var(--bg)' }} />
            </div>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Voxly</span>
          </div>

          <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
            {[
              { icon: <BarChart3 className="w-4 h-4" />, label: 'Dashboard', id: 'dashboard' },
              { icon: <TrendingUp className="w-4 h-4" />,label: 'Analytics', id: 'analytics' },
              { icon: <Wallet className="w-4 h-4" />,    label: 'Expenses',  id: 'expenses' },
              { icon: <PieChart className="w-4 h-4" />,  label: 'Budgets',   id: 'budget' },
              { icon: <Settings className="w-4 h-4" />,  label: 'Settings',  id: 'settings' },
            ].map(({ icon, label, id }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`vx-nav-item w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all${tab === id ? ' active' : ''}`}
              >
                {icon}<span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="px-4 py-3 border-t flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
            <span className="vx-label">Theme</span>
            <SchemeToggle scheme={scheme} setScheme={setScheme} />
          </div>

          <div className="px-4 py-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
              style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
            >
              {displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>{displayName}</p>
              {userEmail && <p className="text-xs truncate" style={{ color: 'var(--text-2)' }}>{userEmail}</p>}
            </div>
            <button type="button" onClick={onLogout} className="text-xs px-2 py-1 rounded-lg border transition-all" style={{ color: 'var(--text-2)', borderColor: 'var(--border)' }}>
              Out
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-4 pt-6 pb-20 lg:pb-6 sm:px-6 space-y-6">

            {/* Top bar */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold" style={{ color: 'var(--text-1)' }}>
                  {tab === 'dashboard' && 'Dashboard'}
                  {tab === 'analytics' && 'Analytics'}
                  {tab === 'expenses' && 'Expenses'}
                  {tab === 'budget' && 'Budgets'}
                  {tab === 'settings' && 'Settings'}
                </h1>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
                  {tab === 'dashboard' && `Good to see you, ${displayName.split(' ')[0]}`}
                  {tab === 'analytics' && 'Your financial breakdowns and trend analysis'}
                  {tab === 'expenses' && 'View recent transactions or log a new expense'}
                  {tab === 'budget' && 'Set limits and configure alert thresholds'}
                  {tab === 'settings' && 'Manage your workspace preferences'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="lg:hidden"><SchemeToggle scheme={scheme} setScheme={setScheme} /></div>
                <button type="button" className="vx-btn-ghost text-xs" onClick={onLogout}>Sign out</button>
              </div>
            </div>

            {/* Toasts */}
            {error && <div className="vx-toast error">{error}</div>}
            {toast && <div className={`vx-toast ${toast.type || 'info'}`}>{toast.message}</div>}

            {tab === 'dashboard' && (
              <>
                {/* Budget alerts */}
                {(budgetAlerts.length > 0 || budgetWarning) && (
                  <div className="rounded-xl border px-4 py-3 text-sm flex flex-col gap-1" style={{ background: 'rgba(251,191,36,0.08)', borderColor: 'rgba(251,191,36,0.25)', color: 'var(--warning)' }}>
                    <span className="font-medium text-xs uppercase tracking-wide opacity-70">Budget alerts</span>
                    {budgetWarning && <p>• {budgetWarning}</p>}
                    {budgetAlerts.map((alert, i) => <p key={i}>• {alert}</p>)}
                  </div>
                )}

                {/* Stat grid — always visible */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="vx-stat" style={{ '--stat-accent': 'var(--top-accent-1)' }}>
                    <span className="vx-label">Today</span>
                    <span className="vx-value">{formatINR(todayTotal)}</span>
                    <span className="vx-muted">Daily spend</span>
                  </div>
                  <div className="vx-stat" style={{ '--stat-accent': 'var(--top-accent-2)' }}>
                    <span className="vx-label">This month</span>
                    <span className="vx-value">{monthlyTotal !== null && monthlyTotal !== undefined ? formatINR(monthlyTotal) : '—'}</span>
                    <span className="vx-muted">Monthly total</span>
                  </div>
                  <div className="vx-stat" style={{ '--stat-accent': 'var(--top-accent-3)' }}>
                    <span className="vx-label">Weekly avg.</span>
                    <span className="vx-value">{dailyAverage !== null ? formatINR(dailyAverage) : '—'}</span>
                    <span className="vx-muted">7-day average</span>
                  </div>
                </div>

                {/* Voice card */}
                <div className="vx-card p-6 flex flex-col items-center gap-5">
                  {/* Status badge */}
                  <div
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs"
                    style={{
                      background: isRecording ? 'rgba(248,113,113,0.10)' : 'var(--accent-muted)',
                      borderColor: isRecording ? 'rgba(248,113,113,0.25)' : 'var(--accent-border)',
                      color: isRecording ? 'var(--danger)' : 'var(--accent)',
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: isRecording ? 'var(--danger)' : 'var(--accent)' }} />
                    {voiceProcessing ? 'Processing…' : isRecording ? 'Listening…' : 'Ready to listen'}
                  </div>

                  {/* Mic + rings */}
                  <div className="relative flex items-center justify-center" style={{ width: 96, height: 96 }}>
                    <div className={`vx-ring${isRecording ? ' active' : ''}`}    style={{ width: 96,  height: 96  }} />
                    <div className={`vx-ring vx-ring-2${isRecording ? ' active' : ''}`} style={{ width: 118, height: 118 }} />
                    <div className={`vx-ring vx-ring-3${isRecording ? ' active' : ''}`} style={{ width: 142, height: 142 }} />
                    <button
                      type="button"
                      className={`vx-mic${isRecording ? ' recording' : ''}`}
                      onClick={toggleRecording}
                      disabled={voiceProcessing || Boolean(voiceConfirm)}
                      aria-pressed={isRecording}
                      aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                    >
                      <Mic className="w-7 h-7" style={{ color: '#fff' }} />
                    </button>
                  </div>

                  {/* Equalizer */}
                  <div
                    className="flex items-end gap-0.5"
                    style={{ height: 24, opacity: isRecording ? 1 : 0, transition: 'opacity 0.2s' }}
                    aria-hidden="true"
                  >
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="vx-eq-bar" style={{ height: isRecording ? undefined : 4 }} />
                    ))}
                  </div>

                  {/* Transcript */}
                  <p
                    className="text-sm text-center min-h-[1.25rem] transition-colors"
                    style={{ color: voiceStatus ? 'var(--text-1)' : 'var(--text-2)', fontStyle: voiceStatus ? 'normal' : 'italic' }}
                  >
                    {voiceStatus || 'Say something like "Add 500 to food"'}
                  </p>

                  <hr className="vx-divider w-full" />

                  {/* Command chips */}
                  <div>
                    <p className="vx-label mb-3 text-center">Try saying</p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {[
                        { icon: <Plus className="w-3 h-3" />,       label: 'Add 500 to food'  },
                        { icon: <Wallet className="w-3 h-3" />,     label: "Today's balance"  },
                        { icon: <TrendingUp className="w-3 h-3" />, label: 'Weekly summary'   },
                        { icon: <Calendar className="w-3 h-3" />,   label: 'Monthly report'   },
                        { icon: <PieChart className="w-3 h-3" />,   label: 'Chart recap'      },
                      ].map(({ icon, label }) => (
                        <span key={label} className="vx-chip" onClick={() => handleQuickCommand(label)} role="button" tabIndex={0}>{icon}{label}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Category budget bars */}
                <div className="vx-card p-5">
                  <p className="text-sm font-medium mb-4" style={{ color: 'var(--text-1)' }}>Category budgets</p>
                  {categoryData.length > 0 ? (
                    <div className="space-y-3">
                      {categoryData.map((cat, idx) => (
                        <div key={idx} className="cursor-pointer" onClick={() => { setSelectedCategory(cat.category.toLowerCase()); setTab('budget'); }}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs" style={{ color: 'var(--text-2)' }}>{cat.category}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs" style={{ color: 'var(--text-2)' }}>{formatINR(cat.total)} / {formatINR(cat.budget)}</span>
                              <span
                                className="text-xs font-medium px-1.5 py-0.5 rounded"
                                style={{
                                  color: cat.percentage > 100 ? 'var(--danger)' : cat.percentage > 80 ? 'var(--warning)' : 'var(--success)',
                                  background: cat.percentage > 100 ? 'rgba(248,113,113,0.10)' : cat.percentage > 80 ? 'rgba(251,191,36,0.10)' : 'rgba(52,211,153,0.10)',
                                }}
                              >
                                {Math.round(cat.percentage)}%
                              </span>
                            </div>
                          </div>
                          <div className="vx-bar-track">
                            <div
                              className="vx-bar-fill"
                              style={{
                                width: `${Math.min(cat.percentage, 100)}%`,
                                background: cat.percentage > 100 ? 'var(--bar-over)' : cat.percentage > 80 ? 'var(--bar-warn)' : 'var(--bar-ok)',
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--text-2)' }}>Category insights appear once you log expenses.</p>
                  )}
                </div>
              </>
            )}

            {tab === 'analytics' && (
              <>
                {/* Charts row */}
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {/* Category pie */}
                  <div className="vx-card p-5">
                    <p className="text-sm font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                      <PieChart className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Category split
                    </p>
                    {categorySpending.length > 0 ? (
                      <>
                        <div className="relative w-36 h-36 mx-auto mb-4">
                          <svg viewBox="0 0 100 100" className="-rotate-90 w-full h-full">
                            {(() => {
                              let ang = 0;
                              const colors = ['var(--top-accent-1)', 'var(--top-accent-2)', 'var(--top-accent-3)', 'var(--text-2)', 'var(--text-3)'];
                              const total = categorySpending.reduce((s, c) => s + c.amount, 0) || 1;
                              return categorySpending.map((cat, idx) => {
                                const a = (cat.amount / total) * 360;
                                const large = a > 180 ? 1 : 0;
                                const sx = 50 + 40 * Math.cos((ang * Math.PI) / 180);
                                const sy = 50 + 40 * Math.sin((ang * Math.PI) / 180);
                                const ex = 50 + 40 * Math.cos(((ang + a) * Math.PI) / 180);
                                const ey = 50 + 40 * Math.sin(((ang + a) * Math.PI) / 180);
                                ang += a;
                                return <path key={cat.category} d={`M50 50L${sx} ${sy}A40 40 0 ${large} 1 ${ex} ${ey}Z`} fill={colors[idx % colors.length]} stroke="var(--bg-card)" strokeWidth="1" onClick={() => setSelectedCategory(cat.key || cat.category.toLowerCase())} style={{ cursor: 'pointer' }} />;
                              });
                            })()}
                          </svg>
                        </div>
                        <div className="space-y-1.5">
                          {categorySpending.slice(0, 4).map((cat, idx) => {
                            const colors = ['var(--top-accent-1)', 'var(--top-accent-2)', 'var(--top-accent-3)', 'var(--text-2)'];
                            return (
                              <div key={cat.category} className="flex items-center justify-between text-xs cursor-pointer" onClick={() => setSelectedCategory(cat.key || cat.category.toLowerCase())}>
                                <div className="flex items-center gap-1.5">
                                  <div className="w-2 h-2 rounded-full" style={{ background: colors[idx % colors.length] }} />
                                  <span style={{ color: 'var(--text-2)' }}>{cat.category}</span>
                                </div>
                                <span className="font-medium" style={{ color: 'var(--text-1)' }}>{formatINR(cat.amount)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs" style={{ color: 'var(--text-2)' }}>Add expenses to see the breakdown.</p>
                    )}
                  </div>

                  {/* Daily bar chart */}
                  <div className="vx-card p-5">
                    <p className="text-sm font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                      <BarChart3 className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Last 7 days
                    </p>
                    <div className="flex items-end justify-between gap-1" style={{ height: 100 }}>
                      {dailySpending.map((day, idx) => {
                        const maxAmt = Math.max(...dailySpending.map(d => d.amount), 1);
                        const pct = (day.amount / maxAmt) * 100;
                        return (
                          <div key={idx} className="flex flex-col items-center gap-1 flex-1">
                            <div className="w-full flex items-end justify-center" style={{ height: 80 }}>
                              <div
                                className="w-full rounded-t transition-all"
                                style={{ height: `${Math.max(pct, 4)}%`, background: day.amount > dailyBudgetThreshold ? 'var(--danger)' : 'var(--accent)', opacity: 0.85 }}
                                data-amount={formatINR(day.amount)}
                              />
                            </div>
                            <span style={{ color: 'var(--text-3)', fontSize: 9 }}>{day.day}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Monthly trend */}
                  <div className="vx-card p-5">
                    <p className="text-sm font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                      <TrendingUp className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Monthly trend
                    </p>
                    {monthlyTrend.length > 0 ? (
                      <div className="flex items-end justify-between gap-1" style={{ height: 100 }}>
                        {monthlyTrend.map((m, idx) => {
                          const maxAmt = Math.max(...monthlyTrend.map(x => x.amount), 1);
                          const pct = (m.amount / maxAmt) * 100;
                          return (
                            <div key={idx} className="flex flex-col items-center gap-1 flex-1">
                              <div className="w-full flex items-end justify-center" style={{ height: 80 }}>
                                <div className="w-full rounded-t" style={{ height: `${Math.max(pct, 4)}%`, background: 'var(--accent)', opacity: 0.7 }} data-amount={formatINR(m.amount)} />
                              </div>
                              <span style={{ color: 'var(--text-3)', fontSize: 9 }}>{m.label?.slice(0, 3)}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs" style={{ color: 'var(--text-2)' }}>Monthly data will appear here.</p>
                    )}
                  </div>
                </div>

                {/* Weekly + Monthly summaries */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="vx-card p-5">
                    <p className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                      <TrendingUp className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Weekly summary
                    </p>
                    {weeklySummaryLines.length > 0
                      ? weeklySummaryLines.map((line, i) => <p key={i} className="text-xs mb-1" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{line}</p>)
                      : <p className="text-xs" style={{ color: 'var(--text-2)' }}>Add expenses to see weekly insights.</p>}
                  </div>
                  <div className="vx-card p-5">
                    <p className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                      <Calendar className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Monthly summary
                    </p>
                    {monthlySummaryLines.length > 0
                      ? monthlySummaryLines.map((line, i) => <p key={i} className="text-xs mb-1" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{line}</p>)
                      : <p className="text-xs" style={{ color: 'var(--text-2)' }}>Monthly breakdown will appear once you log expenses.</p>}
                  </div>
                </div>
              </>
            )}

            {tab === 'expenses' && (
              <>
                {/* Add expense */}
                <div className="vx-card p-5">
                  <p className="text-sm font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                    <Plus className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Add expense
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="number"
                      value={newExpense.amount}
                      onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })}
                      placeholder="Amount (₹)"
                      className="flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
                      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
                    />
                    <select
                      value={newExpense.category}
                      onChange={e => setNewExpense({ ...newExpense, category: e.target.value })}
                      className="flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none"
                      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
                    >
                      {['food','transport','entertainment','shopping','utilities','health','personal','other'].map(c => (
                        <option key={c} value={c}>{titleCase(c)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleAddExpense}
                      disabled={submitting}
                      className="vx-btn-primary text-sm px-5 shrink-0"
                      style={{ opacity: submitting ? 0.6 : 1 }}
                    >
                      {submitting ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                </div>

                {/* Recent expenses */}
                <div className="vx-card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>Recent expenses</p>
                    {loading && <span className="text-xs" style={{ color: 'var(--text-2)' }}>Refreshing…</span>}
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                          {['Date','Time','Amount','Category','Description'].map(h => (
                            <th key={h} className="text-left pb-2 pr-4 font-medium" style={{ color: 'var(--text-2)' }}>{h}</th>
                          ))}
                          <th className="text-right pb-2 font-medium" style={{ color: 'var(--text-2)' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentExpenses.length > 0 ? recentExpenses.map(exp => (
                          <tr key={exp.id} style={{ borderBottom: '0.5px solid var(--border)' }}>
                            <td className="py-2 pr-4" style={{ color: 'var(--text-2)' }}>{exp.date || '—'}</td>
                            <td className="py-2 pr-4" style={{ color: 'var(--text-2)' }}>{exp.time || '—'}</td>
                            <td className="py-2 pr-4 font-medium" style={{ color: 'var(--text-1)' }}>{formatINR(exp.amount)}</td>
                            <td className="py-2 pr-4">
                              <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
                                {titleCase(exp.category)}
                              </span>
                            </td>
                            <td className="py-2" style={{ color: 'var(--text-2)' }}>{exp.description || '—'}</td>
                            <td className="py-2 text-right">
                              <button
                                type="button"
                                onClick={() => handleDeleteExpense(exp.id)}
                                className="hover:text-red-500 transition-colors p-1"
                                style={{ color: 'var(--text-3)' }}
                                title="Delete expense"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        )) : (
                          <tr><td colSpan={6} className="py-4 text-center" style={{ color: 'var(--text-2)' }}>No expenses logged yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="space-y-3 md:hidden">
                    {recentExpenses.length > 0 ? recentExpenses.map(exp => (
                      <div key={exp.id} className="vx-surface p-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{formatINR(exp.amount)}</p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>{titleCase(exp.category)} · {exp.date}</p>
                          {exp.description && <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{exp.description}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteExpense(exp.id)}
                          className="hover:text-red-500 transition-colors p-1 shrink-0"
                          style={{ color: 'var(--text-3)' }}
                          title="Delete expense"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )) : (
                      <p className="text-xs" style={{ color: 'var(--text-2)' }}>No expenses logged yet.</p>
                    )}
                  </div>
                </div>
              </>
            )}

            {tab === 'budget' && (
              <BudgetTab
                categoryTotals={categoryTotals}
                budgetStatuses={summary?.budget_status}
                dark={false}
                onCategoryClick={setSelectedCategory}
                onRefresh={handleRefresh}
              />
            )}

            {tab === 'settings' && (
              <div className="space-y-4">
                {/* Voice logging preference */}
                <div className="vx-card px-5 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>Voice logging</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>Store transcripts to debug misheard commands</p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePreferenceToggle}
                    disabled={preferenceSaving}
                    role="switch"
                    aria-checked={loggingEnabled}
                    className="relative inline-flex items-center rounded-full transition-colors shrink-0"
                    style={{ width: 40, height: 22, background: loggingEnabled ? 'var(--accent)' : 'var(--border)', opacity: preferenceSaving ? 0.6 : 1 }}
                  >
                    <span
                      className="inline-block rounded-full transition-transform"
                      style={{ width: 18, height: 18, background: '#fff', transform: loggingEnabled ? 'translateX(20px)' : 'translateX(2px)' }}
                    />
                  </button>
                </div>

                {/* Mobile sign out / settings info */}
                <div className="vx-card p-5 lg:hidden">
                  <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-1)' }}>Account</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{displayName}</p>
                      {userEmail && <p className="text-xs" style={{ color: 'var(--text-2)' }}>{userEmail}</p>}
                    </div>
                    <button type="button" onClick={onLogout} className="vx-btn-ghost text-xs px-3 py-1.5">
                      Sign out
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {NAV_TABS.map(({ id, label, Icon }) => (
            <button key={id} className={`bottom-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
              <Icon size={20} />
              {label}
            </button>
          ))}
        </div>
      </nav>

      <ConfirmDialog
        open={Boolean(voiceConfirm)}
        title={voiceConfirm?.title}
        message={voiceConfirm?.message}
        options={voiceConfirm?.options || []}
        onConfirm={handleVoiceConfirmSelect}
        onCancel={handleVoiceConfirmCancel}
      />

      {/* Category Drill-down Dialog */}
      {selectedCategory && (
        <CategoryDrilldown
          category={selectedCategory}
          onClose={() => setSelectedCategory(null)}
        />
      )}
    </div>
  );
};

// ─── Auth Screen ──────────────────────────────────────────────────────────────

const AuthScreen = ({ scheme, setScheme }) => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', name: '', confirmPassword: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.email || !form.password) { setError('Email and password are required.'); return; }
    if (mode === 'register' && form.password !== form.confirmPassword) { setError('Passwords must match.'); return; }
    setSubmitting(true);
    try {
      if (mode === 'login') await login({ email: form.email, password: form.password });
      else await register({ email: form.email, password: form.password, name: form.name });
    } catch (err) { setError(err?.message || 'Authentication failed.'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm rounded-2xl border p-8" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
            <Mic className="w-4 h-4" style={{ color: 'var(--bg)' }} />
          </div>
          <span className="text-lg font-semibold" style={{ color: 'var(--text-1)' }}>Voxly</span>
        </div>
        <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>
          {mode === 'login' ? 'Sign in to your account' : 'Create your account'}
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <div className="vx-toast error text-xs">{error}</div>}
          <div>
            <label className="vx-label block mb-1.5" htmlFor="auth-email">Email</label>
            <input id="auth-email" name="email" type="email" autoComplete="email" required value={form.email} onChange={handleChange} placeholder="you@example.com" className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-1)' }} />
          </div>
          {mode === 'register' && (
            <div>
              <label className="vx-label block mb-1.5" htmlFor="auth-name">Display name</label>
              <input id="auth-name" name="name" type="text" value={form.name} onChange={handleChange} placeholder="e.g. Anay" className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-1)' }} />
            </div>
          )}
          <div>
            <label className="vx-label block mb-1.5" htmlFor="auth-password">Password</label>
            <input id="auth-password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required value={form.password} onChange={handleChange} placeholder="Enter a strong password" className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-1)' }} />
          </div>
          {mode === 'register' && (
            <div>
              <label className="vx-label block mb-1.5" htmlFor="auth-confirm">Confirm password</label>
              <input id="auth-confirm" name="confirmPassword" type="password" required value={form.confirmPassword} onChange={handleChange} placeholder="Re-enter your password" className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-1)' }} />
            </div>
          )}
          <button type="submit" disabled={submitting} className="vx-btn-primary w-full py-2.5 mt-1" style={{ opacity: submitting ? 0.6 : 1 }}>
            {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="mt-5 text-center text-xs" style={{ color: 'var(--text-2)' }}>
          {mode === 'login' ? 'Need an account?' : 'Already have one?'}{' '}
          <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }} className="font-medium underline" style={{ color: 'var(--accent)' }}>
            {mode === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </p>
        <div className="mt-6 flex justify-center">
          <SchemeToggle scheme={scheme} setScheme={setScheme} />
        </div>
      </div>
    </div>
  );
};

// ─── Loading screen ───────────────────────────────────────────────────────────

const LoadingScreen = () => (
  <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
    <div className="rounded-2xl border px-8 py-6 text-sm" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-2)' }}>
      Loading your workspace…
    </div>
  </div>
);

// ─── Root ─────────────────────────────────────────────────────────────────────

const ProtectedApp = () => {
  const { user, initializing, logout, preferences, setLoggingPreference } = useAuth();
  const [scheme, setScheme] = useColorScheme();

  if (initializing) return <LoadingScreen />;
  if (!user) return <AuthScreen scheme={scheme} setScheme={setScheme} />;
  return (
    <VoiceFinanceDashboard
      user={user}
      preferences={preferences}
      onLogout={logout}
      onToggleLogging={setLoggingPreference}
      scheme={scheme}
      setScheme={setScheme}
    />
  );
};

const App = () => (
  <AuthProvider>
    <ProtectedApp />
  </AuthProvider>
);

export default App;