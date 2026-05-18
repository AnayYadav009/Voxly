import { render, screen } from '@testing-library/react';
import React from 'react';
import App from './App';

// Mock lucide-react to avoid issues with SVG rendering in JSDOM
jest.mock('lucide-react', () => ({
  Mic: () => <div data-testid="mic-icon" />,
  ChevronDown: () => <div />,
  ChevronUp: () => <div />,
  TrendingUp: () => <div />,
  Calendar: () => <div />,
  Wallet: () => <div />,
  PieChart: () => <div />,
  BarChart3: () => <div />,
  Plus: () => <div />,
}));

// Mock the AuthContext
jest.mock('./context/AuthContext', () => ({
  useAuth: () => ({
    user: { email: 'test@example.com', display_name: 'Test User' },
    initializing: false,
    preferences: { log_opt_in: false },
    logout: jest.fn(),
    setLoggingPreference: jest.fn(),
  }),
  AuthProvider: ({ children }) => <div data-testid="auth-provider">{children}</div>,
}));

// Mock the API
jest.mock('./api', () => ({
  getSummary: jest.fn(() => Promise.resolve({ total_today: 0, weekly_summary: '', monthly_summary: '', category_totals: [] })),
  getRecent: jest.fn(() => Promise.resolve([])),
  getCategoryBreakdown: jest.fn(() => Promise.resolve([])),
  getDailyTotals: jest.fn(() => Promise.resolve([])),
  getMonthlyTotals: jest.fn(() => Promise.resolve([])),
  getBudgets: jest.fn(() => Promise.resolve({})),
  addExpense: jest.fn(() => Promise.resolve({ message: 'Added.' })),
  updateExpense: jest.fn(() => Promise.resolve({ message: 'Updated.' })),
  sendVoiceCommand: jest.fn(() => Promise.resolve({ action: 'unknown', reply: 'test' })),
  onAuthFailure: jest.fn(() => () => {}),
}));

// Mock window.SpeechRecognition
function MockSpeechRecognition() {
  this.start = jest.fn();
  this.stop = jest.fn();
  this.lang = 'en-IN';
  this.continuous = false;
  this.interimResults = false;
}
window.SpeechRecognition = MockSpeechRecognition;
window.webkitSpeechRecognition = MockSpeechRecognition;

// Mock window.speechSynthesis
window.speechSynthesis = {
  speak: jest.fn(),
  cancel: jest.fn(),
  getVoices: jest.fn(() => []),
};

describe('Voxly Dashboard', () => {
  test('renders the main header', async () => {
    render(<App />);
    const headerElement = await screen.findByText(/Voice Finance Tracker/i);
    expect(headerElement).toBeInTheDocument();
  });

  test('renders the voice button', async () => {
    render(<App />);
    const micButton = await screen.findByTestId('mic-icon');
    expect(micButton).toBeInTheDocument();
  });
});
