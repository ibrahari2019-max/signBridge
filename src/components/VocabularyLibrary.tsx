import { Play, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { CameraPreset, NslAvatarEngine } from '../avatar/AvatarRig';
import { AvatarViewport } from '../avatar/AvatarViewport';
import { useAuth } from '../hooks/useAuth';
import type { NslSignEntry, SignCategory, TranslationSignItem } from '../nsl/types';
import { ALL_NSL_SIGNS } from '../nsl/vocabulary';

const CATEGORIES: Array<{ id: 'all' | SignCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'greeting', label: 'Greetings' },
  { id: 'polite', label: 'Polite' },
  { id: 'pronoun', label: 'Pronouns' },
  { id: 'question', label: 'Questions' },
  { id: 'verb', label: 'Verbs' },
  { id: 'place', label: 'Places' },
  { id: 'noun', label: 'Nouns' },
  { id: 'time', label: 'Time' },
  { id: 'emotion', label: 'Emotions' },
  { id: 'number', label: 'Numbers' },
  { id: 'fingerspell', label: 'A–Z' },
];

export function VocabularyLibrary() {
  const { settings, updateSettings } = useAuth();
  const engineRef = useRef<NslAvatarEngine | null>(null);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | SignCategory>('all');
  const [selectedSign, setSelectedSign] = useState<NslSignEntry>(ALL_NSL_SIGNS[0]);
  const [activeItem, setActiveItem] = useState<TranslationSignItem | null>(null);
  const [playbackState, setPlaybackState] = useState({
    isPlaying: false,
    isPaused: false,
    queueLength: 0,
    activeIndex: -1,
  });

  const filteredSigns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ALL_NSL_SIGNS.filter((sign) => {
      if (category !== 'all' && sign.category !== category) return false;
      if (!q) return true;
      return (
        sign.gloss.toLowerCase().includes(q) ||
        sign.englishMeaning.toLowerCase().includes(q) ||
        sign.synonyms.some((syn) => syn.toLowerCase().includes(q))
      );
    });
  }, [category, query]);

  const previewSign = (sign: NslSignEntry) => {
    setSelectedSign(sign);
    engineRef.current?.playSingleSign(sign);
  };

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-8 py-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-white">
            NSL Dictionary
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5 tabular-nums">
            {ALL_NSL_SIGNS.length} signs and manual alphabet letters
          </p>
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search signs..."
            aria-label="Search NSL dictionary"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-sm text-neutral-900 dark:text-white"
          />
        </div>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-4 mb-5 border-b border-neutral-200 dark:border-neutral-800">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setCategory(cat.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              category === cat.id
                ? 'bg-blue-700 text-white'
                : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-6 divide-y divide-neutral-200 dark:divide-neutral-800 border border-neutral-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-neutral-900 max-h-[640px] overflow-y-auto">
          {filteredSigns.length === 0 ? (
            <div className="p-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
              No signs matched “{query}”.
            </div>
          ) : (
            filteredSigns.map((sign) => {
              const active = selectedSign.signCode === sign.signCode;
              return (
                <div
                  key={sign.signCode}
                  className={`p-4 flex items-center justify-between gap-4 transition-colors ${
                    active ? 'bg-blue-50/50 dark:bg-blue-950/30' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                      <span className="font-semibold text-blue-700 dark:text-blue-400">
                        {sign.gloss}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{sign.category}</span>
                    </div>
                    <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mt-0.5">
                      {sign.englishMeaning}
                    </h2>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                      {sign.movement}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => previewSign(sign)}
                    className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 min-h-[34px]"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Sign</span>
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="lg:col-span-6 space-y-4 lg:sticky lg:top-4">
          <div className="h-[460px]">
            <AvatarViewport
              onEngineReady={(engine) => {
                engineRef.current = engine;
                engine.setCallbacks({
                  onActiveSignChange: (_idx, item) => setActiveItem(item),
                  onPlaybackStateChange: (st) => setPlaybackState(st),
                });
                engine.setSpeed(settings.animationSpeed);
                engine.setAvatarScale(settings.avatarScale);
                engine.setCameraPreset(settings.cameraPreset);
              }}
              activeItem={activeItem}
              activeSign={selectedSign}
              playbackState={playbackState}
              speed={settings.animationSpeed}
              onSpeedChange={(s) => void updateSettings({ animationSpeed: s })}
              cameraPreset={settings.cameraPreset}
              onCameraPresetChange={(p: CameraPreset) => void updateSettings({ cameraPreset: p })}
              showCaptions={settings.showCaptions}
              avatarScale={settings.avatarScale}
              statusLabel={selectedSign.gloss}
            />
          </div>

          <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-1 text-xs text-neutral-600 dark:text-neutral-300">
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">
              {selectedSign.englishMeaning}
            </p>
            <p>Handshape: {selectedSign.handshape} · Location: {selectedSign.location}</p>
            <p>Expression: {selectedSign.facialExpression}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
