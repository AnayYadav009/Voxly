import React from 'react';
import { Mic } from 'lucide-react';

const VoiceButton = ({
  toggleRecording,
  voiceProcessing,
  voiceConfirm,
  isRecording,
  voiceStatus,
}) => {
  return (
    <div className="app-card border-2 border-blue-200 p-6 sm:p-8 h-full flex flex-col items-center justify-center">
      <button
        onClick={toggleRecording}
        disabled={voiceProcessing || Boolean(voiceConfirm)}
        className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 ${
          voiceProcessing || voiceConfirm
            ? 'bg-blue-300 cursor-not-allowed'
            : isRecording
            ? 'bg-red-500 hover:bg-red-600 shadow-xl shadow-red-300 animate-pulse'
            : 'bg-blue-600 hover:bg-blue-700 shadow-xl shadow-blue-300'
        }`}
        aria-pressed={isRecording}
        aria-label={isRecording ? 'Stop listening' : 'Start listening'}
      >
        <Mic className="w-16 h-16 text-white" />
      </button>
      <p className="mt-6 text-base font-semibold text-blue-900 sm:text-lg">
        {voiceProcessing
          ? 'Processing...'
          : isRecording
          ? 'Listening...'
          : 'Click to Speak'}
      </p>
      <p className="text-sm text-blue-600 mt-2 text-center min-h-[1.5rem]">
        {voiceStatus || 'Say commands like "Add 500 to food"'}
      </p>
    </div>
  );
};

export default VoiceButton;
