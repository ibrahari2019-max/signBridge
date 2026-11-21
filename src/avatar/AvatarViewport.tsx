import {
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Square,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { NslSignEntry, TranslationSignItem } from '../nsl/types';
import { NslAvatarEngine, type CameraPreset } from './AvatarRig';

interface AvatarViewportProps {
  onEngineReady: (engine: NslAvatarEngine) => void;
  activeItem: TranslationSignItem | null;
  activeSign: NslSignEntry | null;
  playbackState: {
    isPlaying: boolean;
    isPaused: boolean;
    queueLength: number;
    activeIndex: number;
  };
  speed: number;
  onSpeedChange: (speed: number) => void;
  cameraPreset: CameraPreset;
  onCameraPresetChange: (preset: CameraPreset) => void;
  showCaptions: boolean;
  avatarScale: number;
  statusLabel: string;
}

const CAMERA_OPTIONS: Array<{ id: CameraPreset; label: string }> = [
  { id: 'waist_up', label: 'Waist-Up' },
  { id: 'full_body', label: 'Full Body' },
  { id: 'hands_closeup', label: 'Hands' },
  { id: 'face_focus', label: 'Face' },
];

export function AvatarViewport({
  onEngineReady,
  activeItem,
  playbackState,
  speed,
  onSpeedChange,
  cameraPreset,
  onCameraPresetChange,
  showCaptions,
  avatarScale,
  statusLabel,
}: AvatarViewportProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<NslAvatarEngine | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const callbacksRef = useRef({ onEngineReady });
  callbacksRef.current = { onEngineReady };

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    const engine = new NslAvatarEngine(mountEl, {
      onModelLoaded: () => setIsLoading(false),
      onError: (msg) => setRenderError(msg),
    });

    engineRef.current = engine;
    callbacksRef.current.onEngineReady(engine);

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setSpeed(speed);
  }, [speed]);

  useEffect(() => {
    engineRef.current?.setAvatarScale(avatarScale);
  }, [avatarScale]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      engineRef.current?.handleResize();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!wrapperRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await wrapperRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // ignore fullscreen restrictions
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="relative w-full h-full min-h-[460px] lg:min-h-[600px] rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-[#f1f4f8] dark:bg-neutral-900 select-none"
    >
      <div ref={mountRef} className="w-full h-full" aria-label="3D Nigerian Sign Language Signer" />

      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-100/95 dark:bg-neutral-900/95 z-20">
          <div className="w-8 h-8 border-2 border-blue-700 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
            Preparing signer...
          </p>
        </div>
      )}

      {renderError && (
        <div className="absolute top-14 left-4 right-4 z-20 p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200 flex items-center justify-between gap-2">
          <span>{renderError}</span>
          <button
            type="button"
            onClick={() => setRenderError(null)}
            className="underline font-medium shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between gap-4 pointer-events-none">
        <div className="pointer-events-auto px-3 py-1.5 rounded-lg bg-white/90 dark:bg-neutral-900/90 border border-neutral-200 dark:border-neutral-800 text-xs font-medium text-neutral-700 dark:text-neutral-200">
          {statusLabel}
        </div>

        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
          className="pointer-events-auto p-2 rounded-lg bg-white/90 dark:bg-neutral-900/90 border border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors min-w-[38px] min-h-[38px] flex items-center justify-center"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {showCaptions && activeItem && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 z-10 max-w-[90%] w-max px-4 py-2 rounded-lg bg-neutral-900/90 text-white text-center transition-transform duration-150 ${
            dockCollapsed ? 'bottom-12' : 'bottom-20'
          }`}
        >
          <div className="flex items-center justify-center gap-2.5 text-sm">
            <span className="font-semibold text-blue-300 tracking-wide">{activeItem.gloss}</span>
            <span aria-hidden="true" className="text-neutral-500">·</span>
            <span className="font-medium text-white">{activeItem.displayLabel}</span>
          </div>
        </div>
      )}

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center max-w-[95%]">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="mb-1 px-2.5 py-1 rounded-md bg-white/90 dark:bg-neutral-900/90 border border-neutral-200 dark:border-neutral-800 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white flex items-center gap-1 whitespace-nowrap shrink-0"
        >
          {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{dockCollapsed ? 'Controls' : 'Hide'}</span>
        </button>

        {!dockCollapsed && (
          <div className="px-3 py-1.5 rounded-xl bg-white/95 dark:bg-neutral-900/95 border border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-center gap-2">
            <div className="flex items-center gap-1 pr-2 border-r border-neutral-200 dark:border-neutral-800">
              {playbackState.isPlaying && !playbackState.isPaused ? (
                <button
                  type="button"
                  onClick={() => engineRef.current?.pause()}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-neutral-700 flex items-center gap-1.5 whitespace-nowrap shrink-0 min-h-[34px]"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (playbackState.isPaused) engineRef.current?.resume();
                    else engineRef.current?.replayLast();
                  }}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-700 text-white hover:bg-blue-800 flex items-center gap-1.5 whitespace-nowrap shrink-0 min-h-[34px]"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{playbackState.isPaused ? 'Resume' : 'Replay'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => engineRef.current?.stopAndReset()}
                title="Stop"
                className="p-1.5 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 min-w-[34px] min-h-[34px] flex items-center justify-center"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1 p-0.5 bg-neutral-100 dark:bg-neutral-800 rounded-lg">
              {CAMERA_OPTIONS.map((cam) => (
                <button
                  key={cam.id}
                  type="button"
                  onClick={() => {
                    onCameraPresetChange(cam.id);
                    engineRef.current?.setCameraPreset(cam.id);
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    cameraPreset === cam.id
                      ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-xs'
                      : 'text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  {cam.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => engineRef.current?.setCameraPreset(cameraPreset)}
                title="Reset View"
                className="p-1 rounded-md text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1 pl-2 border-l border-neutral-200 dark:border-neutral-800">
              {[0.7, 1.0, 1.3].map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => onSpeedChange(spd)}
                  className={`px-2 py-1 rounded-md text-xs font-medium tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                    Math.abs(speed - spd) < 0.05
                      ? 'bg-blue-700 text-white'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
