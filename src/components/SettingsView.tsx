import { useAuth } from '../hooks/useAuth';

export function SettingsView() {
  const { settings, updateSettings } = useAuth();

  return (
    <div className="max-w-[760px] mx-auto px-4 sm:px-8 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-white">
          Settings
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
          Display, signing pace, and speech recognition preferences.
        </p>
      </div>

      <section className="divide-y divide-neutral-200 dark:divide-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <label className="flex items-center justify-between gap-4 p-4 cursor-pointer">
          <div>
            <div className="text-sm font-medium text-neutral-900 dark:text-white">Large Text</div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              Increase interface text size for easier reading.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.largeTextMode}
            onChange={(e) => void updateSettings({ largeTextMode: e.target.checked })}
            className="w-4 h-4 accent-blue-700"
          />
        </label>

        <label className="flex items-center justify-between gap-4 p-4 cursor-pointer">
          <div>
            <div className="text-sm font-medium text-neutral-900 dark:text-white">Dark Mode</div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              High-contrast dark background and text.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.highContrastMode}
            onChange={(e) => void updateSettings({ highContrastMode: e.target.checked })}
            className="w-4 h-4 accent-blue-700"
          />
        </label>

        <label className="flex items-center justify-between gap-4 p-4 cursor-pointer">
          <div>
            <div className="text-sm font-medium text-neutral-900 dark:text-white">Sign Captions</div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              Display the active sign label beneath the avatar.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.showCaptions}
            onChange={(e) => void updateSettings({ showCaptions: e.target.checked })}
            className="w-4 h-4 accent-blue-700"
          />
        </label>

        <div className="p-4 space-y-2">
          <div className="flex justify-between text-sm font-medium text-neutral-900 dark:text-white">
            <span>Signing Speed</span>
            <span className="tabular-nums text-neutral-600 dark:text-neutral-300">
              {settings.animationSpeed.toFixed(1)}x
            </span>
          </div>
          <input
            type="range"
            min="0.6"
            max="1.5"
            step="0.1"
            value={settings.animationSpeed}
            onChange={(e) => void updateSettings({ animationSpeed: Number(e.target.value) })}
            className="w-full accent-blue-700"
          />
        </div>

        <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-neutral-900 dark:text-white">Speech Accent</div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              Fallback browser speech language profile.
            </div>
          </div>
          <select
            value={settings.speechAccent}
            onChange={(e) =>
              void updateSettings({
                speechAccent: e.target.value as typeof settings.speechAccent,
              })
            }
            className="px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 text-sm text-neutral-900 dark:text-white"
          >
            <option value="en-NG">Nigerian English (en-NG)</option>
            <option value="en-GB">British English (en-GB)</option>
            <option value="en-US">US English (en-US)</option>
          </select>
        </div>
      </section>
    </div>
  );
}
