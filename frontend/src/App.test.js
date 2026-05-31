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
    TrendingUp: mockIcon('TrendingUp'),
    Calendar: mockIcon('Calendar'),
    Wallet: mockIcon('Wallet'),
    PieChart: mockIcon('PieChart'),
    BarChart3: mockIcon('BarChart3'),
    Plus: mockIcon('Plus'),
    Sun: mockIcon('Sun'),
    Moon: mockIcon('Moon'),
    LogOut: mockIcon('LogOut'),
    Settings: mockIcon('Settings'),
    Bell: mockIcon('Bell'),
    ChevronRight: mockIcon('ChevronRight'),
    ChevronDown: mockIcon('ChevronDown'),
    Activity: mockIcon('Activity'),
    Home: mockIcon('Home'),
    X: mockIcon('X'),
    AlertTriangle: mockIcon('AlertTriangle'),
    CheckCircle: mockIcon('CheckCircle'),
    Info: mockIcon('Info'),
    Menu: mockIcon('Menu'),
    Zap: mockIcon('Zap'),
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
    await waitFor(() => {
      expect(screen.getAllByText(/Voxly/i).length).toBeGreaterThan(0);
    });
    
    // Switch to Transactions tab
    const transactionsTabBtn = screen.getByRole('button', { name: /Transactions/i });
    await userEvent.click(transactionsTabBtn);

    // Click "Add expense manually" button to reveal the form
    const revealFormBtn = screen.getByRole('button', { name: /Add expense manually/i });
    await userEvent.click(revealFormBtn);

    let btn;
    await waitFor(() => {
      btn = screen.getByRole('button', { name: /Add Expense/i });
      expect(btn).toBeInTheDocument();
    });
    
    await userEvent.click(btn);
    expect(api.addExpense).not.toHaveBeenCalled();
  });

  test('formatINR formats Indian rupee correctly', () => {
    expect(formatINR(100000)).toBe('₹1,00,000.00');
  });
});
