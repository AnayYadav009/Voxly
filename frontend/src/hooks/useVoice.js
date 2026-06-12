import { useCallback, useEffect, useRef, useState } from 'react';
import { sendVoiceCommand as apiSendVoiceCommand, getStoredTokens } from '../api';
import { mapRecentExpenses } from '../utils';

const speakText = async (text) => {
  if (!text) return;
  try {
    const { accessToken } = getStoredTokens();
    const headers = { 'Content-Type': 'application/json' };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    const response = await fetch('/api/voice/tts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      throw new Error('TTS response not OK');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    await audio.play();
  } catch (err) {
    console.warn('TTS streaming failed, falling back to browser speechSynthesis:', err);
    if ('speechSynthesis' in window && text.length <= 160) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
  }
};


export const useVoice = ({
  addToast,
  loadData,
  isMounted,
  setSummary,
  setRecentExpenses,
  setChartCategories,
  setChartDaily,
  setChartMonthly,
  setBudgetAlertOverride,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceConfirm, setVoiceConfirm] = useState(null);

  const recognitionRef = useRef(null);

  const handleVoiceResponse = useCallback(async (data) => {
    if (!data) { addToast('No response.', 'error'); return; }
    const msg = data.reply || data.message || 'Done.';
    const isErr = data.error || data.success === false;
    setVoiceStatus(msg);
    addToast(msg, isErr ? 'error' : 'success');

    if (data.budget_alert) setBudgetAlertOverride(data.budget_alert);
    
    // Speak the response text
    speakText(msg);

    const opts = data.options || data.option_list;
    if ((data.needs_confirmation || data.needsClarification) && Array.isArray(opts) && opts.length > 0) {
      setVoiceConfirm({ title: data.confirmation_prompt || 'Confirm', message: msg, options: opts });
      return;
    }

    if (data.dashboard) {
      setSummary(data.dashboard);
      setRecentExpenses(mapRecentExpenses(data.dashboard.recent_expenses || []));
      if (data.dashboard.chart_series) {
        const cs = data.dashboard.chart_series;
        setChartCategories(Array.isArray(cs.category_breakdown) ? cs.category_breakdown : []);
        setChartDaily(Array.isArray(cs.daily_totals) ? cs.daily_totals : []);
        setChartMonthly(Array.isArray(cs.monthly_totals) ? cs.monthly_totals : []);
      } else { await loadData(true); }
    } else if (!isErr) { await loadData(true); }
  }, [addToast, loadData, setSummary, setRecentExpenses, setChartCategories, setChartDaily, setChartMonthly, setBudgetAlertOverride]);

  const handleQuickCommand = useCallback(async (cmd) => {
    if (voiceProcessing || voiceConfirm) return;
    setVoiceProcessing(true);
    setVoiceStatus(`Running: "${cmd}"…`);
    try {
      const resp = await apiSendVoiceCommand(cmd);
      if (isMounted.current) await handleVoiceResponse(resp);
    } catch (err) {
      if (isMounted.current) addToast(err?.message || 'Command failed.', 'error');
    } finally { 
      if (isMounted.current) setVoiceProcessing(false); 
    }
  }, [voiceProcessing, voiceConfirm, handleVoiceResponse, addToast, isMounted]);

  const handleVoiceConfirmSelect = useCallback(async (option) => {
    setVoiceConfirm(null);
    const cmd = option?.value || option?.command || option?.text || option?.label || option;
    if (!cmd || !String(cmd).trim()) { setVoiceStatus('Cancelled.'); return; }
    setVoiceProcessing(true);
    try {
      const resp = await apiSendVoiceCommand(String(cmd));
      if (isMounted.current) await handleVoiceResponse(resp);
    } catch (err) { 
      if (isMounted.current) addToast(err?.message || 'Failed.', 'error'); 
    } finally { 
      if (isMounted.current) setVoiceProcessing(false); 
    }
  }, [handleVoiceResponse, addToast, isMounted]);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceStatus('Voice recognition not supported in this browser.'); return; }
    const rec = new SR();
    rec.lang = 'en-IN'; rec.continuous = false; rec.interimResults = false;
    rec.onstart = () => { setIsRecording(true); setVoiceStatus('Listening…'); };
    rec.onerror = (e) => { 
      setIsRecording(false); 
      setVoiceProcessing(false); 
      setVoiceStatus(e.error === 'no-speech' ? 'No speech detected.' : `Error: ${e.error}`); 
    };
    rec.onend = () => setIsRecording(false);
    
    rec.onresult = async (e) => {
      const t = e.results[0][0].transcript;
      if (!isMounted.current) return;
      
      setVoiceStatus(`Heard: "${t}"`);
      setVoiceProcessing(true);
      try { 
        const resp = await apiSendVoiceCommand(t); 
        if (isMounted.current) await handleVoiceResponse(resp); 
      } catch (err) { 
        if (isMounted.current) {
          addToast(err?.message || 'Failed.', 'error'); 
          setVoiceConfirm(null); 
        }
      } finally {
        if (isMounted.current) setVoiceProcessing(false);
      }
    };
    
    recognitionRef.current = rec;
    return () => rec.stop();
  }, [handleVoiceResponse, addToast, isMounted]);

  const toggleRecording = useCallback(() => {
    if (voiceProcessing || voiceConfirm) return;
    const rec = recognitionRef.current;
    if (!rec) return;
    
    if (isRecording) { 
      rec.stop(); 
      return; 
    }
    
    setVoiceStatus('Preparing…');
    // Fix 2: Proper catch for InvalidStateError when mic is already engaging
    try { 
      rec.start(); 
    } catch (err) { 
      rec.stop();
      setVoiceStatus('Mic error. Please try again.'); 
    }
  }, [isRecording, voiceProcessing, voiceConfirm]);

  return {
    isRecording,
    voiceStatus,
    voiceProcessing,
    voiceConfirm,
    toggleRecording,
    handleQuickCommand,
    handleVoiceConfirmSelect,
    setVoiceConfirm,
    setVoiceStatus,
  };
};
