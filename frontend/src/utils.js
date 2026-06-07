import { CATEGORY_COLORS } from './constants';

export const formatINR = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Number(value));
};

export const titleCase = (v) =>
  v ? v.toString().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '';

export const getCatColor = (cat, dark) => {
  const key = (cat || '').toLowerCase();
  const entry = CATEGORY_COLORS[key] || CATEGORY_COLORS.other;
  return dark ? entry.dark : entry.light;
};

export const parseCurrencyValue = (line) => {
  if (!line) return null;
  const m = line.match(/₹\s*([\d,]+(?:\.\d+)?)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

export const parseCategoryLine = (line) => {
  if (!line) return [];
  const [, listPart = ''] = line.split(':');
  return listPart.split(',').map((item) => {
    const t = item.trim();
    if (!t) return null;
    const m = t.match(/^(.*?)\s*\((?:₹)?([\d,]+(?:\.\d+)?)\)/i);
    if (!m) return { name: titleCase(t), amount: null };
    return { name: titleCase(m[1].trim()), amount: Number(m[2].replace(/,/g, '')) };
  }).filter(Boolean);
};

export const parseWeeklySummary = (text) => {
  if (text && typeof text === 'object') {
    let topCats = [];
    if (Array.isArray(text.top_categories)) {
      topCats = text.top_categories.map(c => ({ name: titleCase(c.category), amount: c.total }));
    } else if (Array.isArray(text.topCategories)) {
      topCats = text.topCategories.map(c => ({ name: titleCase(c.name || c.category), amount: c.amount || c.total }));
    }
    return {
      total: text.total ?? null,
      dailyAverage: text.daily_average ?? text.dailyAverage ?? null,
      topCategories: topCats,
      lines: Array.isArray(text.lines) ? text.lines : [],
    };
  }
  const lines = typeof text === 'string' ? text.split(/\n+/).map(l => l.trim()).filter(Boolean) : [];
  return {
    total: parseCurrencyValue(lines.find(l => l.toLowerCase().includes('weekly spend'))),
    dailyAverage: parseCurrencyValue(lines.find(l => l.toLowerCase().includes('daily average'))),
    topCategories: parseCategoryLine(lines.find(l => l.toLowerCase().includes('top categories'))),
    lines,
  };
};

export const parseMonthlySummary = (text) => {
  if (text && typeof text === 'object') {
    let topCats = [];
    if (Array.isArray(text.top_categories)) {
      topCats = text.top_categories.map(c => ({ name: titleCase(c.category), amount: c.total }));
    } else if (Array.isArray(text.topCategories)) {
      topCats = text.topCategories.map(c => ({ name: titleCase(c.name || c.category), amount: c.amount || c.total }));
    }
    return {
      total: text.total ?? null,
      topCategories: topCats,
      lines: Array.isArray(text.lines) ? text.lines : [],
    };
  }
  const lines = typeof text === 'string' ? text.split(/\n+/).map(l => l.trim()).filter(Boolean) : [];
  return {
    total: parseCurrencyValue(lines.find(l => l.toLowerCase().includes('total'))),
    topCategories: parseCategoryLine(lines.find(l => l.toLowerCase().includes('leading categories'))),
    lines,
  };
};

export const normalizeCategoryTotals = (raw = []) => {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, i) => {
    if (Array.isArray(entry)) {
      return { key: String(entry[0] ?? i), category: String(entry[0] ?? '').toLowerCase(), amount: Number(entry[1]) || 0 };
    }
    if (entry && typeof entry === 'object') {
      const category = String(entry.category ?? entry[0] ?? '').toLowerCase();
      return { key: entry.id ?? `cat-${i}`, category, amount: Number(entry.total ?? entry.amount ?? 0) || 0 };
    }
    return null;
  }).filter(Boolean);
};

export const mapRecentExpenses = (raw = []) =>
  raw.map((item, i) => ({
    id: item.id ?? `e-${i}`,
    date: item.date ?? '',
    time: item.time ?? '',
    amount: Number(item.amount ?? 0) || 0,
    category: item.category ? item.category.toString() : 'uncategorized',
    description: item.description ?? '',
  }));

export const normalizeCategoryChart = (raw = []) =>
  (Array.isArray(raw) ? raw : []).map((e, i) => ({
    key: String(e?.category ?? e?.name ?? `c-${i}`),
    category: titleCase(String(e?.category ?? e?.name ?? `c-${i}`)),
    amount: Number(e?.total ?? e?.amount ?? 0) || 0,
  })).filter(Boolean);

export const normalizeDailyChart = (raw = []) =>
  (Array.isArray(raw) ? raw : []).map((e, i) => ({
    day: e?.label ?? e?.day ?? `Day ${i + 1}`,
    amount: Number(e?.total ?? e?.amount ?? 0) || 0,
  })).filter(Boolean);

export const normalizeMonthlyChart = (raw = []) =>
  (Array.isArray(raw) ? raw : []).map((e, i) => ({
    label: e?.label ?? e?.month ?? `M${i + 1}`,
    amount: Number(e?.total ?? e?.amount ?? 0) || 0,
  })).filter(Boolean);

export const computeDailySpending = (expenses = []) => {
  const today = new Date();
  const buckets = Array.from({ length: 7 }, (_, offset) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - offset));
    return { key: d.toISOString().slice(0, 10), day: d.toLocaleDateString('en-IN', { weekday: 'short' }), amount: 0 };
  });
  const byKey = Object.fromEntries(buckets.map(b => [b.key, b]));
  expenses.forEach(e => { if (byKey[e.date]) byKey[e.date].amount += Number(e.amount) || 0; });
  return buckets.map(({ day, amount, key }) => ({ day, amount, key }));
};
