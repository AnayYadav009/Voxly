import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import App from './App';
import * as api from './api';
import { formatINR } from './utils';

jest.mock('lucide-react', () => ({
  Mic: () => <div data-testid="mic-icon" />,
  MicOff: () => <div data-testid="mic-off-icon" />,
  Menu: () => <div data-testid="menu-icon" />,
  User: () => <div data-testid="user-icon" />,
  LogOut: () => <div />,
  Settings: () => <div />,
  AlertCircle: () => <div />,
  CheckCircle: () => <div />,
  Info: () => <div />,
  ChevronDown: () => <div />,
  ChevronUp: () => <div />,
  TrendingUp: () => <div />,
  Calendar: () => <div />,
  Wallet: () => <div />,
  PieChart: () => <div />,
  BarChart3: () => <div />,
  Plus: () => <div />,
  X: () => <div />,
}));

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
      expect(screen.getAllByText(/Voice Finance Tracker/i).length).toBeGreaterThan(0);
    });
  });

  test('shows auth screen when no token', async () => {
    api.getStoredTokens.mockReturnValue({ accessToken: null, refreshToken: null });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Sign in/i)).toBeInTheDocument();
    });
  });

  test('add expense button does not submit with no amount', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Add Expense/i })).toBeInTheDocument();
    });
    const btn = screen.getByRole('button', { name: /^Add$/i });
    await userEvent.click(btn);
    expect(api.addExpense).not.toHaveBeenCalled();
  });

  test('formatINR formats Indian rupee correctly', () => {
    expect(formatINR(100000)).toBe('₹1,00,000.00');
  });
});
