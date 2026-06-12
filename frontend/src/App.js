import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Mic,
  MicOff,
  Sun,
  Moon,
  RefreshCw,
  X,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Wallet,
  Calendar,
  Tag,
  LogOut,
} from 'lucide-react';

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

import { RECENT_LIMIT, NAV_TABS, QUICK_COMMANDS } from './constants';
import { formatINR, titleCase, getCatColor, parseWeeklySummary, parseMonthlySummary, normalizeCategoryTotals, mapRecentExpenses, normalizeCategoryChart, normalizeDailyChart, normalizeMonthlyChart, computeDailySpending } from './utils';
import { DonutChart } from './components/DonutChart';
import { DailyBarChart } from './components/DailyBarChart';
import { MonthlyBarChart } from './components/MonthlyBarChart';
import { RecentExpensesTable } from './components/RecentExpensesTable';
import { AddExpenseForm } from './components/AddExpenseForm';
import { BudgetTab } from './components/BudgetTab';
import { SettingsTab } from './components/SettingsTab';
import CategoryDrilldown from './components/CategoryDrilldown';
import { useVoice } from './hooks/useVoice';

// ─── Constants & Utilities ───────────────────────────────────────────────────

// ─── Hooks ────────────────────────────────────────────────────────────────────

const useDarkMode = () => {
  const [dark, setDark] = useState(false); // Fix 4: Neutral initial state to prevent hydration mismatch

  useEffect(() => {
    try {
      const stored = localStorage.getItem('voxly_theme');
      if (stored) {
        setDark(stored === 'dark');
      } else if (window.matchMedia) {
        setDark(window.matchMedia('(prefers-color-scheme: dark)').matches);
      }
    } catch {}
  }, []);

  const toggle = useCallback(() => setDark(d => {
    const next = !d;
    try { localStorage.setItem('voxly_theme', next ? 'dark' : 'light'); } catch {}
    return next;
  }), []);

  return [dark, toggle];
};

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

// ─── CSS injection ────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --font-display: 'Space Grotesk', sans-serif;
    --font-body: 'Inter', sans-serif;
    --radius: 14px;
    --radius-sm: 8px;
    --radius-lg: 20px;
    --transition: 200ms cubic-bezier(0.4, 0, 0.2, 1);
    --shadow: 0 4px 24px rgba(0,0,0,0.06);
    --shadow-lg: 0 8px 40px rgba(0,0,0,0.10);
  }

  .voxly-light {
    --bg: #f4f3f0;
    --bg-card: #ffffff;
    --bg-card-hover: #fafafa;
    --bg-sidebar: #1a1a2e;
    --bg-input: #f9f8f5;
    --border: #e8e5e0;
    --text: #1a1a1a;
    --text-2: #5a5a6a;
    --text-3: #9a98a8;
    --accent: #2563eb;
    --accent-2: #1d4ed8;
    --accent-muted: rgba(37,99,235,0.10);
    --sidebar-text: rgba(255,255,255,0.65);
    --sidebar-active-bg: rgba(255,255,255,0.12);
    --sidebar-active-text: #fff;
    --topbar-bg: rgba(244,243,240,0.85);
    --success: #16a34a;
    --warning: #d97706;
    --danger: #dc2626;
    --toast-success-bg: #f0fdf4; --toast-success-border: #bbf7d0; --toast-success-text: #166534;
    --toast-error-bg: #fef2f2;   --toast-error-border: #fecaca;   --toast-error-text: #991b1b;
    --toast-info-bg: #eff6ff;    --toast-info-border: #bfdbfe;    --toast-info-text: #1e40af;
    --scrollbar: #d1cfc9;
  }
  .voxly-dark {
    --bg: #0f0f13;
    --bg-card: #1a1a24;
    --bg-card-hover: #1e1e2a;
    --bg-sidebar: #13131b;
    --bg-input: #22222e;
    --border: #2a2a38;
    --text: #f0f0f4;
    --text-2: #8888aa;
    --text-3: #4a4a60;
    --accent: #60a5fa;
    --accent-2: #3b82f6;
    --accent-muted: rgba(96,165,250,0.12);
    --sidebar-text: rgba(255,255,255,0.50);
    --sidebar-active-bg: rgba(255,255,255,0.08);
    --sidebar-active-text: #fff;
    --topbar-bg: rgba(15,15,19,0.85);
    --success: #4ade80;
    --warning: #fbbf24;
    --danger: #f87171;
    --toast-success-bg: #052e16; --toast-success-border: #14532d; --toast-success-text: #86efac;
    --toast-error-bg: #450a0a;   --toast-error-border: #7f1d1d;   --toast-error-text: #fca5a5;
    --toast-info-bg: #0c1a3a;    --toast-info-border: #1e3a8a;    --toast-info-text: #93c5fd;
    --scrollbar: #2a2a38;
  }

  body, .voxly-root {
    font-family: var(--font-body);
    background: var(--bg);
    color: var(--text);
    height: 100dvh;
    overflow: hidden;
  }

  .voxly-layout {
    display: flex;
    height: 100dvh;
    overflow: hidden;
  }

  /* ── Sidebar ── */
  .sidebar {
    width: 220px;
    flex-shrink: 0;
    background: var(--bg-sidebar);
    display: flex;
    flex-direction: column;
    padding: 0;
    position: relative;
    z-index: 10;
  }
  .sidebar-logo {
    padding: 24px 20px 20px;
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 800;
    color: #fff;
    letter-spacing: -0.5px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sidebar-logo-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }
  .sidebar-nav { flex: 1; padding: 8px 12px; display: flex; flex-direction: column; gap: 2px; }
  .nav-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 14px; font-weight: 500;
    color: var(--sidebar-text);
    transition: background var(--transition), color var(--transition);
    border: none; background: transparent; width: 100%; text-align: left;
  }
  .nav-item:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.85); }
  .nav-item.active { background: var(--sidebar-active-bg); color: var(--sidebar-active-text); }
  .nav-item.active svg { opacity: 1; }
  .nav-item svg { opacity: 0.6; transition: opacity var(--transition); }
  .nav-item.active svg, .nav-item:hover svg { opacity: 1; }
  .sidebar-footer { padding: 12px; }
  .sidebar-signout {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 13px; font-weight: 500;
    color: rgba(255,255,255,0.40);
    transition: all var(--transition);
    border: none; background: transparent; width: 100%;
  }
  .sidebar-signout:hover { background: rgba(239,68,68,0.15); color: #f87171; }

  /* ── Main area ── */
  .main-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  /* ── Top bar ── */
  .topbar {
    height: 56px; flex-shrink: 0;
    background: var(--topbar-bg);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 24px;
    position: sticky; top: 0; z-index: 5;
  }
  .topbar-title {
    font-family: var(--font-display);
    font-size: 16px; font-weight: 700;
    color: var(--text);
  }
  .topbar-actions { display: flex; align-items: center; gap: 8px; }
  .icon-btn {
    width: 34px; height: 34px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--text-2);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all var(--transition);
  }
  .icon-btn:hover { color: var(--text); background: var(--bg-card-hover); }
  .icon-btn.spinning svg { animation: spin 1s linear infinite; }
  .avatar-btn {
    width: 34px; height: 34px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    font-family: var(--font-display);
    font-size: 13px; font-weight: 700;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    border: none;
    transition: opacity var(--transition);
  }
  .avatar-btn:hover { opacity: 0.85; }

  /* ── Content ── */
  .content { flex: 1; overflow-y: auto; padding: 24px; }
  .content::-webkit-scrollbar { width: 6px; }
  .content::-webkit-scrollbar-track { background: transparent; }
  .content::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 99px; }

  /* ── Cards ── */
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    transition: background var(--transition);
  }
  .card-title {
    font-family: var(--font-display);
    font-size: 13px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-3);
    margin-bottom: 16px;
  }

  /* ── Stat cards ── */
  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
  .stat-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 18px 20px;
    position: relative; overflow: hidden;
  }
  .stat-icon {
    width: 36px; height: 36px;
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 14px;
    font-size: 16px;
  }
  .stat-value {
    font-family: var(--font-display);
    font-size: 24px; font-weight: 800;
    color: var(--text);
    letter-spacing: -0.5px;
    line-height: 1;
    margin-bottom: 6px;
  }
  .stat-label { font-size: 13px; color: var(--text-2); }
  .stat-sub { font-size: 12px; color: var(--text-3); margin-top: 4px; }

  /* ── Budget alerts ── */
  .alert-banner {
    display: flex; align-items: flex-start; justify-content: space-between;
    background: rgba(217,119,6,0.10);
    border: 1px solid rgba(217,119,6,0.25);
    border-radius: var(--radius-sm);
    padding: 12px 14px;
    margin-bottom: 12px;
    font-size: 13px;
    color: var(--warning);
  }
  .alert-dismiss {
    background: none; border: none; cursor: pointer;
    color: var(--warning); opacity: 0.7;
    padding: 0 0 0 8px; flex-shrink: 0;
  }
  .alert-dismiss:hover { opacity: 1; }

  /* ── Dashboard grid ── */
  .dashboard-grid { display: grid; grid-template-columns: 1fr 1.4fr; gap: 16px; margin-bottom: 20px; }
  .dashboard-right { display: flex; flex-direction: column; gap: 16px; }

  /* ── Voice card ── */
  .voice-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 28px 20px;
    display: flex; flex-direction: column; align-items: center;
    gap: 16px;
  }
  .mic-wrap { position: relative; display: flex; align-items: center; justify-content: center; }
  .mic-ring {
    position: absolute;
    border-radius: 50%;
    border: 2px solid rgba(239,68,68,0.4);
    animation: voicePulse 1.8s ease-out infinite;
  }
  .mic-ring:nth-child(2) { animation-delay: 0.6s; }
  .mic-btn {
    width: 80px; height: 80px;
    border-radius: 50%;
    border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 28px;
    transition: all var(--transition);
    position: relative; z-index: 1;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  }
  .mic-btn.idle {
    background: var(--accent);
    color: #fff;
  }
  .mic-btn.idle:hover { background: var(--accent-2); transform: scale(1.04); }
  .mic-btn.recording { background: #ef4444; color: #fff; }
  .mic-btn.processing { background: var(--bg-input); color: var(--text-3); cursor: not-allowed; }
  .equalizer {
    display: flex; align-items: flex-end; gap: 3px; height: 24px;
  }
  .eq-bar {
    width: 4px; border-radius: 2px;
    background: var(--accent);
    opacity: 0.8;
  }
  .eq-bar:nth-child(1) { animation: voiceBar1 0.9s ease-in-out infinite; }
  .eq-bar:nth-child(2) { animation: voiceBar2 1.1s ease-in-out infinite; }
  .eq-bar:nth-child(3) { animation: voiceBar3 0.7s ease-in-out infinite; }
  .eq-bar:nth-child(4) { animation: voiceBar4 1.3s ease-in-out infinite; }
  .eq-bar:nth-child(5) { animation: voiceBar5 0.85s ease-in-out infinite; }
  .voice-status {
    font-size: 13px; color: var(--text-2); text-align: center;
    min-height: 20px; max-width: 220px; line-height: 1.4;
  }
  .quick-chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
  .chip {
    padding: 5px 11px; border-radius: 99px;
    background: var(--accent-muted); color: var(--accent);
    font-size: 12px; font-weight: 500;
    border: 1px solid transparent;
    cursor: pointer; transition: all var(--transition);
    white-space: nowrap;
  }
  .chip:hover { background: var(--accent); color: #fff; border-color: var(--accent); }

  /* ── Bar chart (daily & monthly logic combined for tooltips) ── */
  .bar-chart { display: flex; align-items: stretch; gap: 4px; height: 140px; }
  .bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; height: 100%; justify-content: flex-end; }
  .bar-fill-wrapper { flex: 1; display: flex; align-items: flex-end; width: 100%; }
  .bar-fill {
    width: 100%; border-radius: 5px 5px 0 0;
    min-height: 4px;
    transition: height 0.6s cubic-bezier(0.34,1.56,0.64,1);
    position: relative;
    cursor: default;
  }
  .bar-fill:hover::after, .bar-fill:focus::after {
    content: attr(data-amount);
    position: absolute; bottom: calc(100% + 5px); left: 50%;
    transform: translateX(-50%);
    background: var(--text); color: var(--bg);
    font-size: 11px; font-weight: 600;
    padding: 3px 7px; border-radius: 5px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 10;
  }

  /* Prevent edge clipping for tooltips */
  .bar-col:first-child .bar-fill:hover::after,
  .bar-col:first-child .bar-fill:focus::after,
  .month-col:first-child .bar-fill:hover::after,
  .month-col:first-child .bar-fill:focus::after {
    left: 0; transform: none;
  }
  .bar-col:last-child .bar-fill:hover::after,
  .bar-col:last-child .bar-fill:focus::after,
  .month-col:last-child .bar-fill:hover::after,
  .month-col:last-child .bar-fill:focus::after {
    left: auto; right: 0; transform: none;
  }

  .bar-label { font-size: 11px; color: var(--text-3); }

  /* ── Recent table ── */
  .expense-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .expense-table th {
    text-align: left; padding: 8px 12px;
    font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
    color: var(--text-3); border-bottom: 1px solid var(--border);
  }
  .expense-table td { padding: 11px 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  .expense-table tr:last-child td { border-bottom: none; }
  .expense-table tr:hover td { background: var(--bg-card-hover); }
  .cat-badge {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 9px; border-radius: 99px;
    font-size: 11px; font-weight: 600;
  }
  .cat-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .amount-cell { font-weight: 600; font-family: var(--font-display); letter-spacing: -0.3px; }
  .desc-cell { color: var(--text-2); }
  .date-cell { color: var(--text-3); font-size: 12px; }

  /* ── Donut chart ── */
  .donut-wrap { position: relative; width: 180px; height: 180px; flex-shrink: 0; }
  .donut-center {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    pointer-events: none;
  }
  .donut-total { font-family: var(--font-display); font-size: 20px; font-weight: 800; color: var(--text); }
  .donut-sub { font-size: 11px; color: var(--text-3); }
  .donut-legend { display: flex; flex-direction: column; gap: 8px; flex: 1; }
  .legend-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; }
  .legend-left { display: flex; align-items: center; gap: 8px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
  .legend-name { color: var(--text-2); }
  .legend-amount { font-weight: 600; font-family: var(--font-display); font-size: 13px; color: var(--text); }

  /* ── Monthly bar chart ── */
  .month-chart { display: flex; align-items: stretch; gap: 6px; height: 120px; }
  .month-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; height: 100%; justify-content: flex-end; }
  .month-bar { width: 100%; border-radius: 5px 5px 0 0; transition: height 0.6s cubic-bezier(0.34,1.56,0.64,1); }
  .month-label { font-size: 10px; color: var(--text-3); white-space: nowrap; }
  .month-delta {
    display: flex; align-items: center; gap: 5px;
    font-size: 13px; font-weight: 500; margin-top: 10px;
  }

  /* ── Collapsible ── */
  .collapsible-header {
    display: flex; align-items: center; justify-content: space-between;
    cursor: pointer; padding: 14px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-card);
    border-radius: var(--radius);
    transition: background var(--transition);
    border: 1px solid var(--border);
    width: 100%;
  }
  .collapsible-header:hover { background: var(--bg-card-hover); }
  .collapsible-header.open { border-radius: var(--radius) var(--radius) 0 0; }
  .collapsible-body {
    background: var(--bg-card);
    border: 1px solid var(--border); border-top: none;
    border-radius: 0 0 var(--radius) var(--radius);
    padding: 16px 20px;
  }
  .coll-title { font-family: var(--font-display); font-size: 14px; font-weight: 700; color: var(--text); }
  .coll-badge { font-size: 13px; font-weight: 600; color: var(--accent); }

  /* ── Add expense form ── */
  .form-grid { display: grid; grid-template-columns: 1fr 1fr 1.5fr auto; gap: 10px; align-items: flex-end; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-label { font-size: 12px; font-weight: 600; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.05em; }
  .form-input, .form-select {
    background: var(--bg-input); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 10px 12px;
    font-size: 14px; color: var(--text);
    font-family: var(--font-body);
    transition: border-color var(--transition), box-shadow var(--transition);
    outline: none; width: 100%;
  }
  .form-input:focus, .form-select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-muted);
  }
  .btn-primary {
    background: var(--accent); color: #fff;
    border: none; border-radius: var(--radius-sm);
    padding: 10px 20px;
    font-size: 14px; font-weight: 600; font-family: var(--font-body);
    cursor: pointer; transition: all var(--transition);
    display: flex; align-items: center; gap: 6px;
    white-space: nowrap;
  }
  .btn-primary:hover:not(:disabled) { background: var(--accent-2); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── Progress bars (budget) ── */
  .progress-row { margin-bottom: 16px; }
  .progress-meta { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .progress-name { font-size: 14px; font-weight: 500; color: var(--text); }
  .progress-amounts { font-size: 12px; color: var(--text-2); }
  .progress-pct { font-size: 13px; font-weight: 700; }
  .progress-track {
    height: 8px; background: var(--border); border-radius: 99px; overflow: hidden;
  }
  .progress-fill { height: 100%; border-radius: 99px; transition: width 0.8s cubic-bezier(0.34,1.56,0.64,1); }

  /* ── Settings card ── */
  .settings-section { margin-bottom: 24px; }
  .settings-title { font-family: var(--font-display); font-size: 14px; font-weight: 700; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; }
  .settings-row { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid var(--border); }
  .settings-row:last-child { border-bottom: none; }
  .settings-row-label { font-size: 14px; color: var(--text); }
  .settings-row-sub { font-size: 12px; color: var(--text-2); margin-top: 2px; }
  .toggle-wrap { position: relative; width: 44px; height: 24px; }
  .toggle-input { position: absolute; opacity: 0; width: 0; height: 0; }
  .toggle-slider {
    position: absolute; inset: 0;
    background: var(--border); border-radius: 99px;
    cursor: pointer; transition: background 0.25s;
  }
  .toggle-slider::after {
    content: '';
    position: absolute; top: 2px; left: 2px;
    width: 20px; height: 20px; border-radius: 50%;
    background: #fff; transition: transform 0.25s;
    box-shadow: 0 1px 4px rgba(0,0,0,0.2);
  }
  .toggle-input:checked + .toggle-slider { background: var(--accent); }
  .toggle-input:checked + .toggle-slider::after { transform: translateX(20px); }
  .profile-avatar {
    width: 64px; height: 64px; border-radius: 50%;
    background: var(--accent); color: #fff;
    font-family: var(--font-display); font-size: 26px; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 12px;
  }
  .btn-danger {
    background: rgba(239,68,68,0.10); color: var(--danger);
    border: 1px solid rgba(239,68,68,0.20);
    border-radius: var(--radius-sm); padding: 10px 18px;
    font-size: 14px; font-weight: 600; font-family: var(--font-body);
    cursor: pointer; transition: all var(--transition);
    display: flex; align-items: center; gap: 6px;
  }
  .btn-danger:hover { background: rgba(239,68,68,0.18); }
  .mono-list {
    font-family: 'Courier New', monospace; font-size: 12px;
    color: var(--text-2); line-height: 1.9;
    background: var(--bg-input); border-radius: var(--radius-sm);
    padding: 12px 14px;
    border: 1px solid var(--border);
  }

  /* ── Auth screen ── */
  .auth-root {
    height: 100dvh; display: flex; align-items: center; justify-content: center;
    background: var(--bg); padding: 16px;
  }
  .auth-card {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: var(--radius-lg); padding: 36px 32px;
    width: 100%; max-width: 400px;
    box-shadow: var(--shadow-lg);
  }
  .auth-logo { font-family: var(--font-display); font-size: 28px; font-weight: 800; color: var(--text); margin-bottom: 4px; }
  .auth-sub { font-size: 14px; color: var(--text-2); margin-bottom: 28px; }
  .auth-tabs { display: flex; background: var(--bg-input); border-radius: var(--radius-sm); padding: 3px; margin-bottom: 24px; gap: 3px; }
  .auth-tab {
    flex: 1; padding: 8px; border-radius: 6px;
    font-size: 13px; font-weight: 600;
    border: none; cursor: pointer; transition: all var(--transition);
    background: transparent; color: var(--text-2);
  }
  .auth-tab.active { background: var(--bg-card); color: var(--text); box-shadow: 0 1px 4px rgba(0,0,0,0.08); }

  /* ── Toasts ── */
  .toast-container {
    position: fixed; top: 16px; right: 16px;
    z-index: 1000; display: flex; flex-direction: column; gap: 8px;
    pointer-events: none;
  }
  .toast {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
    padding: 12px 14px; border-radius: var(--radius-sm);
    border: 1px solid; min-width: 280px; max-width: 380px;
    font-size: 13px; line-height: 1.4;
    box-shadow: var(--shadow-lg);
    pointer-events: all;
    animation: toastIn 0.25s cubic-bezier(0.34,1.56,0.64,1);
  }
  .toast-close { background: none; border: none; cursor: pointer; flex-shrink: 0; opacity: 0.6; padding: 0; }
  .toast-close:hover { opacity: 1; }

  /* ── Bottom nav (mobile) ── */
  .bottom-nav {
    display: none;
    position: fixed; bottom: 0; left: 0; right: 0;
    background: var(--bg-sidebar);
    border-top: 1px solid rgba(255,255,255,0.06);
    padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px));
    z-index: 20;
  }
  .bottom-nav-inner { display: flex; justify-content: space-around; }
  .bottom-tab {
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 4px 12px; border-radius: var(--radius-sm);
    background: none; border: none; cursor: pointer;
    color: var(--sidebar-text); font-size: 10px; font-weight: 500;
    transition: color var(--transition);
  }
  .bottom-tab.active { color: var(--accent); }

  /* ── Animations ── */
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes voicePulse {
    0%   { width: 80px; height: 80px; opacity: 0.8; }
    100% { width: 140px; height: 140px; opacity: 0; }
  }
  @keyframes voiceBar1 { 0%,100% { height: 8px; } 50% { height: 22px; } }
  @keyframes voiceBar2 { 0%,100% { height: 14px; } 50% { height: 6px; } }
  @keyframes voiceBar3 { 0%,100% { height: 6px; } 50% { height: 20px; } }
  @keyframes voiceBar4 { 0%,100% { height: 18px; } 50% { height: 8px; } }
  @keyframes voiceBar5 { 0%,100% { height: 10px; } 50% { height: 24px; } }
  @keyframes toastIn {
    from { transform: translateX(20px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes barIn { from { transform: scaleY(0); transform-origin: bottom; } }

  /* ── Responsive ── */
  @media (max-width: 900px) {
    .stat-grid { grid-template-columns: repeat(2, 1fr); }
    .dashboard-grid { grid-template-columns: 1fr; }
    .form-grid { grid-template-columns: 1fr 1fr; }
    .form-grid .btn-primary { grid-column: span 2; justify-content: center; }
  }
  @media (max-width: 640px) {
    .sidebar { display: none; }
    .bottom-nav { display: block; }
    .content { padding: 16px 14px calc(80px + env(safe-area-inset-bottom, 0px)); }
    .stat-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .stat-value { font-size: 18px; }
    .form-grid { grid-template-columns: 1fr; }
    .form-grid .btn-primary { grid-column: auto; }
    .expense-table .hide-mobile { display: none; }
  }
`;

// Fix 1: CSS Injection moved completely outside the component render phase
let cssInjected = false;
function injectCSS() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = GLOBAL_CSS;
  document.head.appendChild(style);
}

// Trigger CSS injection safely on module load (client side only)
if (typeof window !== 'undefined') {
  injectCSS();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const Toasts = ({ toasts, remove }) => (
  <div className="toast-container" role="status" aria-live="polite">
    {toasts.map(t => (
      <div
        key={t.id}
        className="toast"
        style={{
          background: `var(--toast-${t.type}-bg)`,
          borderColor: `var(--toast-${t.type}-border)`,
          color: `var(--toast-${t.type}-text)`,
        }}
      >
        <span>{t.message}</span>
        <button className="toast-close" onClick={() => remove(t.id)}><X size={14} /></button>
      </div>
    ))}
  </div>
);


const Collapsible = ({ title, badge, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button className={`collapsible-header${open ? ' open' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="coll-title">{title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {badge && <span className="coll-badge">{badge}</span>}
          {open ? <ChevronUp size={16} color="var(--text-3)" aria-hidden="true" /> : <ChevronDown size={16} color="var(--text-3)" aria-hidden="true" />}
        </div>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
};

// ─── Tab panels ──────────────────────────────────────────────────────────────

const DashboardTab = ({
  todayTotal, weeklyTotal, monthlyTotal, categoryCount,
  dailyAverage, dailySpending, recentExpenses,
  budgetAlerts, dismissAlert, loading,
  voiceStatus, voiceProcessing, isRecording, voiceConfirm,
  toggleRecording, handleQuickCommand,
  dark,
  onDelete,
  threshold,
}) => {
  const statCards = [
    { label: "Today's Spend", value: formatINR(todayTotal), sub: 'Updated live', color: '#3b82f6', bg: 'rgba(59,130,246,0.10)', Icon: Wallet },
    { label: 'This Month',    value: formatINR(monthlyTotal), sub: 'Month to date', color: '#a855f7', bg: 'rgba(168,85,247,0.10)', Icon: Calendar },
    { label: 'Weekly Total',  value: weeklyTotal !== null ? formatINR(weeklyTotal) : '—', sub: dailyAverage !== null ? `Avg ${formatINR(dailyAverage)}/day` : 'Last 7 days', color: '#22c55e', bg: 'rgba(34,197,94,0.10)', Icon: TrendingUp },
    { label: 'Categories',    value: categoryCount, sub: 'Active this month', color: '#f97316', bg: 'rgba(249,115,22,0.10)', Icon: Tag },
  ];

  return (
    <div>
      {/* Stat cards */}
      <div className="stat-grid">
        {statCards.map(({ label, value, sub, color, bg, Icon }) => (
          <div className="stat-card" key={label}>
            <div className="stat-icon" style={{ background: bg, color }}><Icon size={18} /></div>
            <div className="stat-value">{value}</div>
            <div className="stat-label">{label}</div>
            <div className="stat-sub">{sub}</div>
          </div>
        ))}
      </div>

      {/* Budget alerts */}
      {budgetAlerts.map((msg, i) => (
        <div className="alert-banner" key={i}>
          <span>⚠️ {msg}</span>
          <button className="alert-dismiss" onClick={() => dismissAlert(i)}><X size={14} /></button>
        </div>
      ))}

      {/* Voice + daily chart */}
      <div className="dashboard-grid">
        {/* Voice card */}
        <div className="voice-card">
          <div className="card-title" style={{ marginBottom: 0 }}>Voice Assistant</div>
          <div className="mic-wrap">
            {isRecording && (
              <>
                <div className="mic-ring" style={{ width: 80, height: 80 }} />
                <div className="mic-ring" style={{ width: 80, height: 80 }} />
              </>
            )}
            <button
              className={`mic-btn ${voiceProcessing || voiceConfirm ? 'processing' : isRecording ? 'recording' : 'idle'}`}
              onClick={toggleRecording}
              disabled={voiceProcessing || Boolean(voiceConfirm)}
              aria-label={isRecording ? 'Stop' : 'Speak'}
            >
              {isRecording ? <MicOff size={32} /> : <Mic size={32} />}
            </button>
          </div>

          {isRecording && (
            <div className="equalizer">
              {[1,2,3,4,5].map(n => <div key={n} className="eq-bar" style={{ height: 16 }} />)}
            </div>
          )}

          <div className="voice-status">
            {voiceStatus || 'Say "Add 500 to food" or tap a chip below'}
          </div>

          <div className="quick-chips">
            {QUICK_COMMANDS.map(cmd => (
              <button key={cmd} className="chip" onClick={() => handleQuickCommand(cmd)}>{cmd}</button>
            ))}
          </div>
        </div>

        {/* Daily chart */}
        <div className="dashboard-right">
          <DailyBarChart dailySpending={dailySpending} dark={dark} threshold={threshold} />

          {/* Recent table */}
          <RecentExpensesTable expenses={recentExpenses.slice(0, 8)} dark={dark} loading={loading} title="Recent Expenses" onDelete={onDelete} />
        </div>
      </div>
    </div>
  );
};

const AnalyticsTab = ({ categorySpending, monthlyTrend, weeklySummaryData, monthlySummaryData, dark, onCategoryClick }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Donut */}
      <div className="card">
        <div className="card-title">Spending by Category</div>
        <DonutChart data={categorySpending} dark={dark} onCategoryClick={onCategoryClick} />
      </div>

      {/* Monthly trend */}
      <MonthlyBarChart monthlyTrend={monthlyTrend} dark={dark} />

      {/* Collapsibles */}
      <Collapsible title="Weekly Summary" badge={weeklySummaryData.total ? formatINR(weeklySummaryData.total) : null} defaultOpen>
        {weeklySummaryData.lines.length > 0
          ? weeklySummaryData.lines.map((l, i) => <p key={i} style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{l}</p>)
          : <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Add expenses to see weekly insights.</p>
        }
      </Collapsible>

      <Collapsible title="Monthly Summary" badge={monthlySummaryData.total ? formatINR(monthlySummaryData.total) : null}>
        {monthlySummaryData.lines.length > 0
          ? monthlySummaryData.lines.map((l, i) => <p key={i} style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{l}</p>)
          : <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Add expenses to see monthly insights.</p>
        }
      </Collapsible>
    </div>
  );
};

const ExpensesTab = ({ recentExpenses, onAddExpense, submitting, dark }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Add form */}
      <AddExpenseForm onAddExpense={onAddExpense} submitting={submitting} />

      {/* Full table */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 0' }}><div className="card-title">All Expenses</div></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="expense-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Amount</th>
                <th>Category</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {recentExpenses.length > 0 ? recentExpenses.map(e => {
                const color = getCatColor(e.category, dark);
                return (
                  <tr key={e.id}>
                    <td className="date-cell">{e.date || '—'}</td>
                    <td className="date-cell">{e.time || '—'}</td>
                    <td className="amount-cell">{formatINR(e.amount)}</td>
                    <td>
                      <span className="cat-badge" style={{ background: `${color}22`, color }}>
                        <span className="cat-dot" style={{ background: color }} />
                        {titleCase(e.category)}
                      </span>
                    </td>
                    <td className="desc-cell">{e.description || '—'}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '24px 0' }}>No expenses yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// Extracted BudgetTab and SettingsTab to separate component files
// ─── Main Dashboard ───────────────────────────────────────────────────────────

const VoiceFinanceDashboard = ({ user, preferences = {}, onLogout, onToggleLogging }) => {
  const [dark, toggleDark] = useDarkMode();
  const [tab, setTab] = useState('dashboard');
  const [toasts, addToast, removeToast] = useToasts();

  const [summary, setSummary] = useState(null);
  const [recentExpenses, setRecentExpenses] = useState([]);
  const [chartCategories, setChartCategories] = useState([]);
  const [chartDaily, setChartDaily] = useState([]);
  const [chartMonthly, setChartMonthly] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preferenceSaving, setPreferenceSaving] = useState(false);

  const [dismissedAlerts, setDismissedAlerts] = useState([]);
  const [budgetAlertOverride, setBudgetAlertOverride] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  
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
        setRefreshing(false);
      }
    }
  }, [addToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadData(true);
  }, [loadData]);

  const { isRecording, voiceStatus, voiceProcessing, voiceConfirm, toggleRecording, handleQuickCommand, handleVoiceConfirmSelect, setVoiceConfirm, setVoiceStatus } = useVoice({
    addToast, loadData, isMounted,
    setSummary, setRecentExpenses, setChartCategories, setChartDaily, setChartMonthly,
    setBudgetAlertOverride,
  });

  const handleAddExpense = useCallback(async ({ amount, category, description }) => {
    setSubmitting(true);
    try {
      const r = await apiAddExpense({ amount, category, description });
      addToast(r.message || 'Expense added.', 'success');
      await loadData(true);
    } catch (err) { 
      addToast(err?.message || 'Failed.', 'error'); 
    } finally { 
      setSubmitting(false); 
    }
  }, [addToast, loadData]);

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
  const weeklyTotal = weeklySummaryData.total;
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

  const visibleAlerts = rawAlerts.filter((_, i) => !dismissedAlerts.includes(i));

  const dismissAlert = useCallback((i) => setDismissedAlerts(d => [...d, i]), []);

  const loggingEnabled = Boolean(preferences?.log_opt_in);
  const displayName = user?.display_name || user?.email || 'U';
  const initial = (displayName[0] || 'U').toUpperCase();

  const tabLabel = NAV_TABS.find(t => t.id === tab)?.label ?? 'Dashboard';

  return (
    <div className={`voxly-root ${dark ? 'voxly-dark' : 'voxly-light'}`}>
      <div className="voxly-layout">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="sidebar-logo-dot" />
            Voxly
          </div>
          <nav className="sidebar-nav">
            {NAV_TABS.map(({ id, label, Icon }) => (
              <button key={id} className={`nav-item${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
                <Icon size={17} />
                {label}
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <button className="sidebar-signout" onClick={onLogout}>
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </aside>

        {/* Main */}
        <div className="main-area">
          {/* Topbar */}
          <header className="topbar">
            <span className="topbar-title">{tabLabel}</span>
            <div className="topbar-actions">
              <button className="icon-btn" onClick={toggleDark} title="Toggle theme">
                {dark ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <button className={`icon-btn${refreshing ? ' spinning' : ''}`} onClick={handleRefresh} title="Refresh">
                <RefreshCw size={16} />
              </button>
              <button className="avatar-btn" onClick={() => setTab('settings')} title="Settings">
                {initial}
              </button>
            </div>
          </header>

          {/* Content */}
          <main className="content">
            {tab === 'dashboard' && (
              <DashboardTab
                todayTotal={todayTotal}
                weeklyTotal={weeklyTotal}
                monthlyTotal={monthlyTotal}
                categoryCount={categoryTotals.length}
                dailyAverage={dailyAverage}
                dailySpending={dailySpending}
                recentExpenses={recentExpenses}
                budgetAlerts={visibleAlerts}
                dismissAlert={dismissAlert}
                loading={loading}
                voiceStatus={voiceStatus}
                voiceProcessing={voiceProcessing}
                isRecording={isRecording}
                voiceConfirm={voiceConfirm}
                toggleRecording={toggleRecording}
                handleQuickCommand={handleQuickCommand}
                dark={dark}
                onDelete={handleDeleteExpense}
                threshold={dailyBudgetThreshold}
              />
            )}
            {tab === 'analytics' && (
              <AnalyticsTab
                categorySpending={categorySpending}
                monthlyTrend={monthlyTrend}
                weeklySummaryData={weeklySummaryData}
                monthlySummaryData={monthlySummaryData}
                dark={dark}
                onCategoryClick={setSelectedCategory}
              />
            )}
            {tab === 'expenses' && (
              <ExpensesTab
                recentExpenses={recentExpenses}
                onAddExpense={handleAddExpense}
                submitting={submitting}
                dark={dark}
              />
            )}
            {tab === 'budget' && (
              <BudgetTab categoryTotals={categoryTotals} dark={dark} onCategoryClick={setSelectedCategory} />
            )}
            {tab === 'settings' && (
              <SettingsTab
                user={user}
                dark={dark}
                toggleDark={toggleDark}
                loggingEnabled={loggingEnabled}
                onToggleLogging={handleToggleLogging}
                preferenceSaving={preferenceSaving}
                onLogout={onLogout}
              />
            )}
          </main>
        </div>
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

      {/* Toasts */}
      <Toasts toasts={toasts} remove={removeToast} />

      {/* Confirm dialog */}
      <ConfirmDialog
        open={Boolean(voiceConfirm)}
        title={voiceConfirm?.title}
        message={voiceConfirm?.message}
        options={voiceConfirm?.options || []}
        onConfirm={handleVoiceConfirmSelect}
        onCancel={() => { setVoiceConfirm(null); setVoiceStatus('Cancelled.'); }}
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

const AuthScreen = () => {
  const { login, register } = useAuth();
  const [dark] = useDarkMode();
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
    <div className={`voxly-root ${dark ? 'voxly-dark' : 'voxly-light'}`}>
      <div className="auth-root">
        <div className="auth-card">
          <div className="auth-logo">Voxly</div>
          <div className="auth-sub">Your voice-powered finance tracker</div>

          <div className="auth-tabs">
            {['login','register'].map(m => (
              <button key={m} className={`auth-tab${mode === m ? ' active' : ''}`} onClick={() => { setMode(m); setError(null); }}>
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {error && (
              <div style={{ background: 'var(--toast-error-bg)', border: '1px solid var(--toast-error-border)', color: 'var(--toast-error-text)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', fontSize: 13 }}>
                {error}
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Email</label>
              <input id="auth-email" name="email" type="email" className="form-input" autoComplete="email" required placeholder="you@example.com" value={form.email} onChange={handleChange} />
            </div>
            {mode === 'register' && (
              <div className="form-group">
                <label className="form-label">Display name</label>
                <input id="auth-name" name="name" type="text" className="form-input" placeholder="e.g. Priya" value={form.name} onChange={handleChange} />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Password</label>
              <input id="auth-password" name="password" type="password" className="form-input" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required placeholder="••••••••" value={form.password} onChange={handleChange} />
            </div>
            {mode === 'register' && (
              <div className="form-group">
                <label className="form-label">Confirm password</label>
                <input id="auth-confirm" name="confirmPassword" type="password" className="form-input" required placeholder="••••••••" value={form.confirmPassword} onChange={handleChange} />
              </div>
            )}
            <button type="submit" className="btn-primary" disabled={submitting} style={{ justifyContent: 'center', marginTop: 4 }}>
              {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

// ─── Loading screen ───────────────────────────────────────────────────────────

const LoadingScreen = () => {
  const [dark] = useDarkMode();
  return (
    <div className={`voxly-root ${dark ? 'voxly-dark' : 'voxly-light'}`}>
      <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>Voxly</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Loading your workspace…</div>
        </div>
      </div>
    </div>
  );
};

// ─── Root ─────────────────────────────────────────────────────────────────────

const ProtectedApp = () => {
  const { user, initializing, logout, preferences, setLoggingPreference } = useAuth();
  if (initializing) return <LoadingScreen />;
  if (!user) return <AuthScreen />;
  return (
    <VoiceFinanceDashboard
      user={user}
      preferences={preferences}
      onLogout={logout}
      onToggleLogging={setLoggingPreference}
    />
  );
};

const App = () => (
  <AuthProvider>
    <ProtectedApp />
  </AuthProvider>
);

export default App;