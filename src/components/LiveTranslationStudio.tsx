import { Mic, MicOff, Pause, Play, RotateCcw, Send, Square, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraPreset, NslAvatarEngine } from '../avatar/AvatarRig';
import { AvatarViewport } from '../avatar/AvatarViewport';
import { useAuth } from '../hooks/useAuth';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { translateInstantNsl } from '../nsl/localTranslator';
import type {
  NslSignEntry,
  TranslationResult,
  TranslationSignItem,
  TranslationStatusState,
} from '../nsl/types';
import { NSL_BY_CODE, NSL_BY_GLOSS } from '../nsl/vocabulary';

interface LiveTranslationStudioProps {
  onRecordTranslation: (record: TranslationResult) => void;
  pendingReplay: TranslationResult | null;
  onClearPendingReplay: () => void;
}

const STATUS_LABELS: Record<TranslationStatusState, string> = {
  idle: 'Ready',
  listening: 'Listening',
  speech_recognized: 'Recognizing',
  translating: 'Translating',
  preparing_animation: 'Preparing',
  signing: 'Signing',
  incomplete: 'Partial match',
  completed: 'Done',
  error: 'Error',
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const str = String(reader.result || '');
      const idx = str.indexOf(',');
      resolve(idx >= 0 ? str.slice(idx + 1) : str);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function normalizeWords(text: string): string[] {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function LiveTranslationStudio({
  onRecordTranslation,
  pendingReplay,
  onClearPendingReplay,
}: LiveTranslationStudioProps) {
  const { settings, updateSettings, getIdToken } = useAuth();

  const engineRef = useRef<NslAvatarEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const signedWordsRef = useRef<string[]>([]);
  const currentResultRef = useRef<TranslationResult | null>(null);
  const isListeningRef = useRef(false);

  const [textInput, setTextInput] = useState('');
  const [translationStatus, setTranslationStatus] = useState<TranslationStatusState>('idle');
  const [currentResult, setCurrentResult] = useState<TranslationResult | null>(null);
  const [activeSignItem, setActiveSignItem] = useState<TranslationSignItem | null>(null);
  const [activeSignEntry, setActiveSignEntry] = useState<NslSignEntry | null>(null);
  const [activeQueueIdx, setActiveQueueIdx] = useState<number>(-1);
  const [playbackState, setPlaybackState] = useState({
    isPlaying: false,
    isPaused: false,
    queueLength: 0,
    activeIndex: -1,
  });
  const [translationError, setTranslationError] = useState<string | null>(null);

  currentResultRef.current = currentResult;

  const handleInterimPhrase = useCallback((phrase: string) => {
    const words = normalizeWords(phrase);
    if (words.length === 0) return;

    const prev = signedWordsRef.current;
    let common = 0;
    while (common < prev.length && common < words.length && prev[common] === words[common]) {
      common++;
    }

    if (words.length <= common) {
      if (words.length < prev.length && common === 0) {
        signedWordsRef.current = [];
      }
      return;
    }

    const newChunk = words.slice(common).join(' ');
    signedWordsRef.current = words;

    const instant = translateInstantNsl(phrase, 'mic');
    setCurrentResult(instant);

    const delta = translateInstantNsl(newChunk, 'mic');
    const playableDelta = delta.signItems.filter(
      (item) => item.type === 'verified_sign' || item.type === 'fingerspell'
    );
    if (playableDelta.length > 0 && engineRef.current) {
      engineRef.current.enqueueSequence(playableDelta, false);
      setTranslationStatus('signing');
    }
  }, []);

  const performTranslation = useCallback(
    async (englishText: string, sourceMode: TranslationResult['sourceMode'], alreadyStreamed = false) => {
      const trimmed = englishText.trim();
      if (!trimmed) return;

      setTranslationError(null);

      if (!alreadyStreamed) {
        const instant = translateInstantNsl(trimmed, sourceMode);
        setCurrentResult(instant);
        const instantPlayable = instant.signItems.some(
          (item) => item.type === 'verified_sign' || item.type === 'fingerspell'
        );
        if (instantPlayable && engineRef.current) {
          engineRef.current.enqueueSequence(instant.signItems, true);
          setTranslationStatus('signing');
        } else {
          setTranslationStatus('translating');
        }
      }

      try {
        const token = await getIdToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;

        const res = await fetch('/api/nsl/translate', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: trimmed, sourceMode }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Translation request failed.');
        }

        const result = data as TranslationResult;
        setCurrentResult(result);
        onRecordTranslation(result);

        const hasPlayable = result.signItems.some(
          (item) => item.type === 'verified_sign' || item.type === 'fingerspell'
        );

        if (!alreadyStreamed && hasPlayable && engineRef.current) {
          engineRef.current.enqueueSequence(result.signItems, true);
          setTranslationStatus(result.translationStatus === 'incomplete' ? 'incomplete' : 'signing');
        } else if (!hasPlayable) {
          setTranslationStatus('incomplete');
        }
      } catch (err: unknown) {
        if (!alreadyStreamed) {
          setTranslationError(err instanceof Error ? err.message : 'Unable to translate.');
          setTranslationStatus('error');
        }
      }
    },
    [getIdToken, onRecordTranslation]
  );

  const {
    micStatus,
    interimText,
    audioLevel,
    errorMsg: micError,
    clearError: clearMicError,
    startListening,
    pauseListening,
    resumeListening,
    stopListening,
  } = useSpeechRecognition({
    accent: settings.speechAccent,
    onInterimPhrase: handleInterimPhrase,
    onFinalPhrase: (phrase) => {
      const finalWords = normalizeWords(phrase);
      const prev = signedWordsRef.current;
      let common = 0;
      while (common < prev.length && common < finalWords.length && prev[common] === finalWords[common]) {
        common++;
      }
      const remaining = finalWords.slice(common);
      const wasStreamed = prev.length > 0;
      signedWordsRef.current = [];

      if (wasStreamed && remaining.length > 0 && engineRef.current) {
        const tail = translateInstantNsl(remaining.join(' '), 'mic');
        const playableTail = tail.signItems.filter(
          (item) => item.type === 'verified_sign' || item.type === 'fingerspell'
        );
        if (playableTail.length > 0) {
          engineRef.current.enqueueSequence(playableTail, false);
          setTranslationStatus('signing');
        }
      }

      void performTranslation(phrase, 'mic', wasStreamed);
    },
  });

  isListeningRef.current = micStatus === 'listening';

  useEffect(() => {
    engineRef.current?.setReadyToSign(micStatus === 'listening');
  }, [micStatus]);

  const handleEngineReady = useCallback(
    (engine: NslAvatarEngine) => {
      engineRef.current = engine;
      engine.setCallbacks({
        onActiveSignChange: (idx, item, sign) => {
          setActiveQueueIdx(idx);
          setActiveSignItem(item);
          setActiveSignEntry(sign);
        },
        onPlaybackStateChange: (st) => {
          setPlaybackState(st);
          if (!st.isPlaying && currentResultRef.current) {
            setTranslationStatus(
              currentResultRef.current.translationStatus === 'incomplete' ? 'incomplete' : 'completed'
            );
          }
        },
      });
      engine.setSpeed(settings.animationSpeed);
      engine.setAvatarScale(settings.avatarScale);
      engine.setCameraPreset(settings.cameraPreset);
      engine.setReadyToSign(isListeningRef.current);
    },
    [settings.animationSpeed, settings.avatarScale, settings.cameraPreset]
  );

  useEffect(() => {
    if (pendingReplay && engineRef.current) {
      setCurrentResult(pendingReplay);
      engineRef.current.enqueueSequence(pendingReplay.signItems, true);
      setTranslationStatus(pendingReplay.translationStatus === 'incomplete' ? 'incomplete' : 'signing');
      onClearPendingReplay();
    }
  }, [onClearPendingReplay, pendingReplay]);

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    void performTranslation(textInput, 'text', false);
    setTextInput('');
  };

  const handleAudioUpload = async (file: File) => {
    setTranslationError(null);
    setTranslationStatus('translating');
    try {
      const base64 = await blobToBase64(file);
      const res = await fetch('/api/speech/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: base64,
          mimeType: file.type || 'audio/webm',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Audio transcription failed.');
      await performTranslation(data.transcript, 'audio_upload', false);
    } catch (err: unknown) {
      setTranslationError(err instanceof Error ? err.message : 'Unable to process audio file.');
      setTranslationStatus('error');
    }
  };

  const playSignItem = (item: TranslationSignItem) => {
    if (!engineRef.current || item.type === 'unsupported') return;
    engineRef.current.enqueueSequence([item], true);
    setActiveSignItem(item);
    const entry = item.signCode
      ? NSL_BY_CODE.get(item.signCode) ?? null
      : NSL_BY_GLOSS.get(item.gloss) ?? null;
    setActiveSignEntry(entry);
    setTranslationStatus('signing');
  };

  const effectiveStatusLabel =
    micStatus === 'listening' && translationStatus === 'idle'
      ? 'Listening'
      : STATUS_LABELS[translationStatus];

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-8 py-5">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <section className="lg:col-span-7 xl:col-span-8 flex flex-col min-h-[500px] lg:h-[calc(100vh-116px)]">
          <AvatarViewport
            onEngineReady={handleEngineReady}
            activeItem={activeSignItem}
            activeSign={activeSignEntry}
            playbackState={playbackState}
            speed={settings.animationSpeed}
            onSpeedChange={(spd) => void updateSettings({ animationSpeed: spd })}
            cameraPreset={settings.cameraPreset}
            onCameraPresetChange={(preset: CameraPreset) => void updateSettings({ cameraPreset: preset })}
            showCaptions={settings.showCaptions}
            avatarScale={settings.avatarScale}
            statusLabel={effectiveStatusLabel}
          />
        </section>

        <aside className="lg:col-span-5 xl:col-span-4 flex flex-col bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-5 lg:h-[calc(100vh-116px)] lg:overflow-y-auto">
          <div className="space-y-4 pb-5 border-b border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-between">
              <h1 className="text-base font-semibold text-neutral-900 dark:text-white">
                English to NSL
              </h1>
              <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                {micStatus === 'listening' ? (
                  <Mic className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
                ) : (
                  <MicOff className="w-3.5 h-3.5 text-neutral-400" />
                )}
                <span>
                  {micStatus === 'idle' && 'Mic ready'}
                  {micStatus === 'requesting' && 'Starting...'}
                  {micStatus === 'listening' && 'Listening'}
                  {micStatus === 'paused' && 'Paused'}
                  {micStatus === 'denied' && 'Mic blocked'}
                  {micStatus === 'error' && 'Mic offline'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {micStatus === 'idle' || micStatus === 'denied' || micStatus === 'error' ? (
                <button
                  type="button"
                  onClick={() => {
                    signedWordsRef.current = [];
                    void startListening();
                  }}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors min-h-[44px]"
                >
                  <Mic className="w-4 h-4" />
                  <span>Speak</span>
                </button>
              ) : (
                <>
                  {micStatus === 'paused' ? (
                    <button
                      type="button"
                      onClick={resumeListening}
                      className="flex-1 px-3 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium flex items-center justify-center gap-2 min-h-[44px]"
                    >
                      <Play className="w-4 h-4" />
                      <span>Resume</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={pauseListening}
                      className="flex-1 px-3 py-2.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-900 dark:text-white text-sm font-medium flex items-center justify-center gap-2 min-h-[44px]"
                    >
                      <Pause className="w-4 h-4" />
                      <span>Pause</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      signedWordsRef.current = [];
                      stopListening();
                    }}
                    className="px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium flex items-center justify-center gap-2 min-h-[44px]"
                  >
                    <Square className="w-4 h-4" />
                    <span>Stop</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Upload audio recording"
                className="p-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <Upload className="w-4 h-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleAudioUpload(f);
                  e.target.value = '';
                }}
              />
            </div>

            {micStatus === 'listening' && (
              <div className="w-full h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                <div
                  className="h-full bg-blue-700 dark:bg-blue-400 transition-[width] duration-75"
                  style={{ width: `${Math.round(audioLevel * 100)}%` }}
                />
              </div>
            )}

            {micError && (
              <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200 flex items-start justify-between gap-2">
                <span>{micError}</span>
                <button type="button" onClick={clearMicError} className="underline shrink-0">
                  Dismiss
                </button>
              </div>
            )}

            <form onSubmit={handleTextSubmit} className="flex gap-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Or type English here..."
                aria-label="Type English text to translate"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 text-sm text-neutral-900 dark:text-white focus:outline-2 focus:outline-blue-700"
              />
              <button
                type="submit"
                disabled={!textInput.trim()}
                className="px-3.5 py-2 rounded-lg bg-neutral-900 dark:bg-blue-700 text-white text-xs font-medium hover:bg-neutral-800 dark:hover:bg-blue-800 disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap shrink-0 min-h-[40px]"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Sign</span>
              </button>
            </form>
          </div>

          <div className="pt-5 flex-1 flex flex-col gap-4">
            {interimText && (
              <p className="text-sm text-neutral-600 dark:text-neutral-300 italic">
                “{interimText}”
              </p>
            )}

            {translationError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200">
                {translationError}
              </div>
            )}

            {currentResult ? (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 mb-1">
                    <span>Transcript</span>
                    <button
                      type="button"
                      onClick={() => engineRef.current?.replayLast()}
                      className="text-blue-700 dark:text-blue-400 hover:underline font-medium flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Replay</span>
                    </button>
                  </div>
                  <p className="text-base font-medium text-neutral-900 dark:text-white">
                    {currentResult.sourceText}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
                    Sign sequence
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {currentResult.signItems.map((item, idx) => {
                      const isActive =
                        activeSignItem?.id === item.id ||
                        (activeQueueIdx >= 0 && activeSignItem?.gloss === item.gloss);
                      const isUnsupported = item.type === 'unsupported';
                      return (
                        <button
                          key={item.id + idx}
                          type="button"
                          onClick={() => playSignItem(item)}
                          disabled={isUnsupported}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                            isUnsupported
                              ? 'border-neutral-200 dark:border-neutral-800 text-neutral-400 dark:text-neutral-500 cursor-default'
                              : isActive
                              ? 'border-blue-700 bg-blue-700 text-white'
                              : 'border-neutral-200 dark:border-neutral-800 text-neutral-800 dark:text-neutral-200 hover:border-blue-400'
                          }`}
                        >
                          {item.gloss}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {currentResult.unsupportedTerms.length > 0 && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    No NSL sign on file for: {currentResult.unsupportedTerms.join(', ')}.
                  </p>
                )}
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
                Press <strong>Speak</strong> or type a sentence to see it signed in real time.
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
