import { useCallback, useEffect, useRef, useState } from 'react';

export type MicStatus = 'idle' | 'requesting' | 'listening' | 'paused' | 'denied' | 'error';

interface SpeechRecognitionHookOptions {
  accent: 'en-NG' | 'en-US' | 'en-GB';
  onFinalPhrase: (phrase: string) => void;
  onInterimPhrase?: (phrase: string) => void;
}

function resampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === 16000 || sourceRate <= 0) return input;
  const ratio = sourceRate / 16000;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0;
    output[i] = s0 + (s1 - s0) * frac;
  }
  return output;
}

function float32ToInt16Base64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface WebSpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

interface WebSpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: WebSpeechRecognitionEvent) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function useSpeechRecognition(options: SpeechRecognitionHookOptions) {
  const { accent, onFinalPhrase, onInterimPhrase } = options;
  const [micStatus, setMicStatus] = useState<MicStatus>('idle');
  const [interimText, setInterimText] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onFinalRef = useRef(onFinalPhrase);
  onFinalRef.current = onFinalPhrase;

  const onInterimRef = useRef(onInterimPhrase);
  onInterimRef.current = onInterimPhrase;

  const isPausedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const recognitionRef = useRef<WebSpeechRecognitionInstance | null>(null);
  const phraseBufferRef = useRef('');
  const flushTimerRef = useRef<number | null>(null);
  const fellBackToBrowserRef = useRef(false);
  const lastBrowserResultAtRef = useRef(0);
  const browserBrokenRef = useRef(false);

  const flushPhraseBuffer = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const text = phraseBufferRef.current.trim();
    if (text.length > 0) {
      phraseBufferRef.current = '';
      setInterimText('');
      onFinalRef.current(text);
    }
  }, []);

  const cleanupStreams = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    phraseBufferRef.current = '';
    lastBrowserResultAtRef.current = 0;
    browserBrokenRef.current = false;

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  useEffect(() => {
    return () => {
      cleanupStreams();
    };
  }, [cleanupStreams]);

  const attachNativeSpeechRecognizer = useCallback(
    (standalone: boolean): boolean => {
      const win = window as unknown as {
        SpeechRecognition?: new () => WebSpeechRecognitionInstance;
        webkitSpeechRecognition?: new () => WebSpeechRecognitionInstance;
      };
      const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
      if (!SpeechRec) return false;

      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = accent;

      rec.onresult = (event) => {
        if (isPausedRef.current) return;
        lastBrowserResultAtRef.current = Date.now();
        phraseBufferRef.current = '';
        if (flushTimerRef.current !== null) {
          window.clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }

        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const transcript = res[0].transcript;
          if (res.isFinal) {
            const cleaned = transcript.trim();
            if (cleaned) {
              setInterimText('');
              onFinalRef.current(cleaned);
            }
          } else {
            interim += transcript;
          }
        }
        if (interim) {
          const text = interim.trim();
          setInterimText(text);
          if (text) onInterimRef.current?.(text);
        }
      };

      rec.onerror = (ev) => {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
          browserBrokenRef.current = true;
          if (standalone) {
            setMicStatus('denied');
            setErrorMsg('Microphone permission denied. Type a sentence below to translate.');
            cleanupStreams();
          }
        } else if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
          browserBrokenRef.current = true;
          if (standalone) {
            setErrorMsg(`Speech recognition interrupted (${ev.error}).`);
          }
        }
      };

      rec.onend = () => {
        if (recognitionRef.current === rec && !isPausedRef.current && !browserBrokenRef.current) {
          try {
            rec.start();
          } catch {
            // ignore restart race
          }
        }
      };

      try {
        recognitionRef.current = rec;
        rec.start();
        return true;
      } catch {
        recognitionRef.current = null;
        return false;
      }
    },
    [accent, cleanupStreams]
  );

  const startBrowserSpeech = useCallback(async () => {
    const win = window as unknown as {
      SpeechRecognition?: new () => WebSpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => WebSpeechRecognitionInstance;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      setMicStatus('error');
      setErrorMsg('Live microphone recognition is unavailable in this browser. You can type or upload audio below.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArr = new Uint8Array(analyser.frequencyBinCount);
      const sampleLevel = () => {
        if (!streamRef.current) return;
        analyser.getByteTimeDomainData(dataArr);
        let sum = 0;
        for (let i = 0; i < dataArr.length; i++) {
          const v = (dataArr[i] - 128) / 128;
          sum += v * v;
        }
        setAudioLevel(Math.min(1, Math.sqrt(sum / dataArr.length) * 4));
        if (streamRef.current) requestAnimationFrame(sampleLevel);
      };
      sampleLevel();
    } catch (err) {
      setMicStatus('denied');
      setErrorMsg(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone access was denied. Enable it in browser settings or type below.'
          : 'Unable to access microphone.'
      );
      return;
    }

    if (attachNativeSpeechRecognizer(true)) {
      setMicStatus('listening');
    } else {
      setMicStatus('error');
      setErrorMsg('Unable to start browser speech recognition.');
    }
  }, [attachNativeSpeechRecognizer]);

  const startLiveStream = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      setMicStatus('denied');
      setErrorMsg(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone permission denied. Allow access in browser settings or type below.'
          : 'No active microphone found on this device.'
      );
      return;
    }

    streamRef.current = stream;
    fellBackToBrowserRef.current = false;
    browserBrokenRef.current = false;
    lastBrowserResultAtRef.current = 0;

    // Launch native SpeechRecognition in parallel for instant (~120ms) word-level onset when supported
    const nativeStarted = attachNativeSpeechRecognizer(false);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/transcribe`);
    wsRef.current = ws;

    const fallbackToBrowser = () => {
      if (fellBackToBrowserRef.current) return;
      fellBackToBrowserRef.current = true;
      if (nativeStarted && !browserBrokenRef.current && recognitionRef.current) {
        if (wsRef.current) {
          try {
            wsRef.current.close();
          } catch {
            // ignore
          }
          wsRef.current = null;
        }
        return;
      }
      cleanupStreams();
      void startBrowserSpeech();
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as { type: string; text?: string; error?: string };
        if (msg.type === 'ready') {
          setMicStatus(isPausedRef.current ? 'paused' : 'listening');
          return;
        }
        if (msg.type === 'error') {
          fallbackToBrowser();
          return;
        }

        // Skip duplicate WS events while native SpeechRecognition is actively emitting for this utterance
        const browserActive =
          !browserBrokenRef.current &&
          lastBrowserResultAtRef.current > 0 &&
          Date.now() - lastBrowserResultAtRef.current < 1800;
        if (browserActive) return;

        if (msg.type === 'interim' && msg.text) {
          if (!isPausedRef.current) {
            const interim = msg.text.trim();
            const fullInterim = phraseBufferRef.current ? `${phraseBufferRef.current} ${interim}` : interim;
            setInterimText(fullInterim);
            if (interim) onInterimRef.current?.(fullInterim);
          }
        } else if (msg.type === 'final' && msg.text) {
          if (!isPausedRef.current) {
            const segment = msg.text.trim();
            if (segment) {
              phraseBufferRef.current = phraseBufferRef.current
                ? `${phraseBufferRef.current} ${segment}`
                : segment;
              setInterimText(phraseBufferRef.current);
              onInterimRef.current?.(phraseBufferRef.current);

              if (/[.!?]$/.test(segment)) {
                flushPhraseBuffer();
              } else {
                if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
                flushTimerRef.current = window.setTimeout(flushPhraseBuffer, 300);
              }
            }
          }
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = () => {
      fallbackToBrowser();
    };

    const audioCtx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = audioCtx;
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume().catch(() => {});
    }
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(1024, 1, 1);
    processorRef.current = processor;

    source.connect(processor);
    processor.connect(audioCtx.destination);

    processor.onaudioprocess = (e) => {
      if (isPausedRef.current) {
        setAudioLevel(0);
        return;
      }
      const raw = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < raw.length; i++) sum += raw[i] * raw[i];
      setAudioLevel(Math.min(1, Math.sqrt(sum / raw.length) * 5));

      if (ws.readyState === WebSocket.OPEN) {
        const resampled = resampleTo16k(raw, audioCtx.sampleRate);
        ws.send(JSON.stringify({ audio: float32ToInt16Base64(resampled) }));
      }
    };

    setMicStatus('listening');
  }, [attachNativeSpeechRecognizer, cleanupStreams, flushPhraseBuffer, startBrowserSpeech]);

  const startListening = useCallback(async () => {
    setErrorMsg(null);
    isPausedRef.current = false;
    setMicStatus('requesting');
    cleanupStreams();
    await startLiveStream();
  }, [cleanupStreams, startLiveStream]);

  const pauseListening = useCallback(() => {
    isPausedRef.current = true;
    flushPhraseBuffer();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setMicStatus('paused');
    setAudioLevel(0);
  }, [flushPhraseBuffer]);

  const resumeListening = useCallback(() => {
    isPausedRef.current = false;
    if (recognitionRef.current && !browserBrokenRef.current) {
      try {
        recognitionRef.current.start();
      } catch {
        // ignore if already running
      }
    }
    setMicStatus('listening');
  }, []);

  const stopListening = useCallback(() => {
    isPausedRef.current = false;
    flushPhraseBuffer();
    cleanupStreams();
    setInterimText('');
    setMicStatus('idle');
  }, [cleanupStreams, flushPhraseBuffer]);

  return {
    micStatus,
    interimText,
    audioLevel,
    errorMsg,
    clearError: () => setErrorMsg(null),
    startListening,
    pauseListening,
    resumeListening,
    stopListening,
  };
}
