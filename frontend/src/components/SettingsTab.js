import React from 'react';
import { LogOut, Sun, Moon } from 'lucide-react';

export const SettingsTab = ({ user, dark, toggleDark, loggingEnabled, onToggleLogging, preferenceSaving, onLogout }) => {
  const displayName = user?.display_name || user?.email || 'User';
  const initial = (displayName[0] || 'U').toUpperCase();

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="settings-section">
          <div className="settings-title">Profile</div>
          <div className="profile-avatar">{initial}</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>{displayName}</div>
          {user?.email && <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>{user.email}</div>}
        </div>

        <div className="settings-section">
          <div className="settings-title">Appearance</div>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Dark Mode</div>
              <div className="settings-row-sub">Switch between light and dark theme</div>
            </div>
            <label className="toggle-wrap">
              <input type="checkbox" className="toggle-input" checked={dark} onChange={toggleDark} />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-title">Privacy</div>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Voice Command Logging</div>
              <div className="settings-row-sub">Store transcripts to help debug misheard commands. Off by default.</div>
            </div>
            <label className="toggle-wrap">
              <input type="checkbox" className="toggle-input" checked={loggingEnabled} onChange={e => onToggleLogging(e.target.checked)} disabled={preferenceSaving} />
              <span className="toggle-slider" />
            </label>
          </div>
          {preferenceSaving && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>Saving…</div>}
        </div>

        <button className="btn-danger" onClick={onLogout}>
          <LogOut size={15} />
          Sign out
        </button>
      </div>
    </div>
  );
};
