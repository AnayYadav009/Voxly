import React, { useEffect, useState } from 'react';

const SCHEMES = [
  { id: 'midnight', color: '#60a5fa', label: 'Midnight blue' },
  { id: 'sage',     color: '#4a5c4e', label: 'Sage & slate'  },
  { id: 'aurora',   color: '#2dd4bf', label: 'Aurora'        },
  { id: 'ember',    color: '#c2773a', label: 'Ember'         },
  { id: 'violet',   color: '#a78bfa', label: 'Violet noir'   },
];

const STORAGE_KEY = 'voxly.colorScheme';

export const useColorScheme = () => {
  const [scheme, setScheme] = useState(
    () => (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY)) || 'midnight'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-scheme', scheme);
    localStorage.setItem(STORAGE_KEY, scheme);
  }, [scheme]);

  return [scheme, setScheme];
};

const SchemeToggle = ({ scheme, setScheme }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} role="group" aria-label="Color scheme">
    {SCHEMES.map((s) => (
      <button
        key={s.id}
        className={`vx-scheme-btn${scheme === s.id ? ' selected' : ''}`}
        style={{ background: s.color }}
        onClick={() => setScheme(s.id)}
        aria-label={s.label}
        aria-pressed={scheme === s.id}
        title={s.label}
        type="button"
      />
    ))}
  </div>
);

export default SchemeToggle;
