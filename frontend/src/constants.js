import {
  LayoutDashboard,
  BarChart3,
  Receipt,
  PiggyBank,
  Settings,
} from 'lucide-react';

export const RECENT_LIMIT = 12;

export const CATEGORY_COLORS = {
  food:          { light: '#f97316', dark: '#fb923c' },
  transport:     { light: '#3b82f6', dark: '#60a5fa' },
  entertainment: { light: '#a855f7', dark: '#c084fc' },
  shopping:      { light: '#ec4899', dark: '#f472b6' },
  utilities:     { light: '#14b8a6', dark: '#2dd4bf' },
  health:        { light: '#22c55e', dark: '#4ade80' },
  education:     { light: '#eab308', dark: '#facc15' },
  rent:          { light: '#ef4444', dark: '#f87171' },
  savings:       { light: '#8b5cf6', dark: '#a78bfa' },
  personal:      { light: '#06b6d4', dark: '#22d3ee' },
  gifts:         { light: '#f43f5e', dark: '#fb7185' },
  other:         { light: '#64748b', dark: '#94a3b8' },
  uncategorized: { light: '#94a3b8', dark: '#cbd5e1' },
};

export const BUDGET_DEFAULTS = {
  food: 10000, transport: 4000, entertainment: 3000,
  shopping: 5000, utilities: 5000, health: 3000,
  personal: 2000, gifts: 2000, savings: 6000,
  uncategorized: 2000, other: 2500,
};

export const NAV_TABS = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'analytics', label: 'Analytics',  Icon: BarChart3 },
  { id: 'expenses',  label: 'Expenses',   Icon: Receipt },
  { id: 'budget',    label: 'Budget',     Icon: PiggyBank },
  { id: 'settings',  label: 'Settings',   Icon: Settings },
];

export const QUICK_COMMANDS = [
  'Add 500 food',
  'Weekly summary',
  'My budget',
  'Delete last',
];
