export const formatINR = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '₹0.00';
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
};

export const toLocalISO = (date) => {
  const off = date.getTimezoneOffset();
  const local = new Date(date.getTime() - off * 60 * 1000);
  return local.toISOString().slice(0, 10);
};

export const titleCase = (value) => {
  if (!value) {
    return '';
  }
  const s = value.toString().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};
