import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import App from './App';
import * as api from './api';
import { formatINR } from './utils';

jest.mock('lucide-react', () => {
  const mockIcon = (name) => {
    return (props) => {
      let testId = `${name.toLowerCase()}-icon`;
      if (name === 'MicOff') testId = 'mic-off-icon';
      return <span data-testid={testId} {...props} />;
    };
  };
  return {
    Mic: mockIcon('Mic'),
    MicOff: mockIcon('MicOff'),
    LayoutDashboard: mockIcon('LayoutDashboard'),
    TrendingUp: mockIcon('TrendingUp'),
    Calendar: mockIcon('Calendar'),
    Wallet: mockIcon('Wallet'),
    BarChart3: mockIcon('BarChart3'),
    Receipt: mockIcon('Receipt'),
    PiggyBank: mockIcon('PiggyBank'),
    Plus: mockIcon('Plus'),
    Sun: mockIcon('Sun'),
    Moon: mockIcon('Moon'),
    RefreshCw: mockIcon('RefreshCw'),
    LogOut: mockIcon('LogOut'),
    Settings: mockIcon('Settings'),
    ChevronDown: mockIcon('ChevronDown'),
    ChevronUp: mockIcon('ChevronUp'),
    Tag: mockIcon('Tag'),
    X: mockIcon('X'),
    ArrowUpRight: mockIcon('ArrowUpRight'),
    ArrowDownRight: mockIcon('ArrowDownRight'),
  };
});

jest.mock('./api');

function MockSpeechRecognition() {
  this.start = jest.fn();
  this.stop = jest.fn();
  this.lang = 'en-IN';
  this.continuous = false;
  this.interimResults = false;
}
window.SpeechRecognition = MockSpeechRecognition;
window.webkitSpeechRecognition = MockSpeechRecognition;

window.speechSynthesis = {
  speak: jest.fn(),
  cancel: jest.fn(),
  getVoices: jest.fn(() => []),
};

beforeEach(() => {
  api.fetchCurrentUser.mockResolvedValue({
    user: { id: '1', email: 'a@b.com', display_name: 'Test' },
  });
  api.getStoredTokens.mockReturnValue({ accessToken: 'fake-token', refreshToken: 'fake-refresh' });
  api.getPreferences.mockResolvedValue({ preferences: { log_opt_in: false } });
  api.getSummary.mockResolvedValue({
    total_today: 0,
    weekly_summary: '',
    monthly_summary: '',
    category_totals: [],
    budget_alerts: [],
  });
  api.getRecent.mockResolvedValue([]);
  api.getCategoryBreakdown.mockResolvedValue({ items: [] });
  api.getDailyTotals.mockResolvedValue({ items: [] });
  api.getMonthlyTotals.mockResolvedValue({ items: [] });
  api.getBudgets.mockResolvedValue({});
  api.addExpense.mockResolvedValue({ message: 'Added.' });
  api.sendVoiceCommand.mockResolvedValue({ action: 'unknown', reply: 'test' });
  api.onAuthFailure.mockReturnValue(() => {});
  api.loginUser.mockResolvedValue({ user: { email: 'a@b.com' } });
  api.registerUser.mockResolvedValue({ user: { email: 'a@b.com' } });
  api.logoutUser.mockResolvedValue({});
  api.updatePreferences.mockResolvedValue({ preferences: { log_opt_in: false } });
});

describe('Voxly Dashboard', () => {
  test('renders dashboard when authenticated', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByText(/Voxly/i).length).toBeGreaterThan(0);
    });
  });

  test('shows auth screen when no token', async () => {
    api.getStoredTokens.mockReturnValue({ accessToken: null, refreshToken: null });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Email/i)).toBeInTheDocument();
    });
  });

  test('add expense button does not submit with no amount', async () => {
    render(<App />);

    const expensesTabBtn = await screen.findAllByRole('button', { name: /Expenses/i });
    await userEvent.click(expensesTabBtn[0]);

    let btn;
    await waitFor(() => {
      btn = screen.getByRole('button', { name: /^Add$/i });
      expect(btn).toBeInTheDocument();
    });
    
    await userEvent.click(btn);
    expect(api.addExpense).not.toHaveBeenCalled();
  });

  test('formatINR formats Indian rupee correctly', () => {
    expect(formatINR(100000)).toBe('₹1,00,000');
  });
});
