import React from 'react';

const UserHeader = ({
  displayName,
  userEmail,
  onLogout,
  loggingEnabled,
  preferenceSaving,
  handlePreferenceToggle,
}) => {
  return (
    <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="text-center md:text-left">
        <h1 className="text-3xl font-bold text-blue-900 md:text-4xl">Voice Finance Tracker</h1>
        <p className="mt-2 text-blue-700">Track your expenses with voice commands or manual entry</p>
      </div>
      <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center md:justify-end">
        <div className="flex items-center gap-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-blue-900 shadow-sm">
          <div className="text-left">
            <p className="text-sm font-semibold">{displayName}</p>
            {userEmail && <p className="text-xs text-blue-600">{userEmail}</p>}
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-800 transition hover:bg-blue-100"
          >
            Logout
          </button>
        </div>
        <div className="rounded-2xl border border-blue-100 bg-white/80 px-4 py-3 text-blue-900 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-500">Voice command logging</p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={handlePreferenceToggle}
              disabled={preferenceSaving}
              className={`relative inline-flex h-6 w-11 items-center rounded-full border transition ${
                loggingEnabled ? 'bg-blue-600 border-blue-600' : 'bg-gray-300 border-gray-300'
              } ${preferenceSaving ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                  loggingEnabled ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
            <div>
              <p className="text-sm font-semibold">
                {loggingEnabled ? 'Enabled' : 'Disabled'}
                {preferenceSaving && <span className="ml-2 text-xs font-normal text-blue-500">Saving...</span>}
              </p>
              <p className="text-xs text-blue-600">
                Store transcripts to debug misheard commands. Nothing is logged unless you opt in.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserHeader;
