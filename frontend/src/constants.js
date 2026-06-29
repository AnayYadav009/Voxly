import {
  LayoutDashboard,
  BarChart3,
  Receipt,
  PiggyBank,
  Settings,
} from 'lucide-react';

export const RECENT_LIMIT = 12;

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
