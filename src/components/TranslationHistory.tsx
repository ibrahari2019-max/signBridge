import { Download, Play, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import type { TranslationResult } from '../nsl/types';

interface TranslationHistoryProps {
  sessionHistory: TranslationResult[];
  onClearSessionHistory: () => void;
  onReplayInStudio: (record: TranslationResult) => void;
}

export function TranslationHistory({
  sessionHistory,
  onClearSessionHistory,
  onReplayInStudio,
}: TranslationHistoryProps) {
  const { user, getIdToken } = useAuth();
  const [cloudRecords, setCloudRecords] = useState<TranslationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const loadCloudHistory = useCallback(async () => {
    if (!user) {
      setCloudRecords([]);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/history', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load translation history.');
      setCloudRecords(data.records ?? []);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load history.');
    } finally {
      setLoading(false);
    }
  }, [getIdToken, user]);

  useEffect(() => {
    void loadCloudHistory();
  }, [loadCloudHistory]);

  const mergedRecords = user && cloudRecords.length > 0 ? cloudRecords : sessionHistory;
  const filtered = mergedRecords.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      r.sourceText.toLowerCase().includes(q) ||
      r.nslGlossSequence.join(' ').toLowerCase().includes(q)
    );
  });

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    onClearSessionHistory();
    if (user) {
      try {
        const token = await getIdToken();
        await fetch('/api/history', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        setCloudRecords([]);
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to clear history.');
      }
    }
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signbridge-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-white">
            History
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
            {user ? `Signed in as ${user.email}` : 'Current session'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportJson}
            disabled={filtered.length === 0}
            className="px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
          <button
            type="button"
            onClick={() => void handleClear()}
            disabled={mergedRecords.length === 0}
            className={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 disabled:opacity-40 ${
              confirmClear
                ? 'bg-red-600 text-white border-red-600'
                : 'border-neutral-200 dark:border-neutral-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{confirmClear ? 'Confirm Clear' : 'Clear'}</span>
          </button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter history..."
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-sm text-neutral-900 dark:text-white"
        />
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-16 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
          <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
            No translations yet
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Translations from Studio will appear here.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-neutral-200 dark:divide-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
          {filtered.map((rec, idx) => (
            <div
              key={(rec.id ?? idx) + rec.sourceText}
              className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition-colors"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-neutral-900 dark:text-white">
                  {rec.sourceText}
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-400 break-words">
                  {rec.nslGlossSequence.join(' · ')}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onReplayInStudio(rec)}
                className="px-3.5 py-2 rounded-lg bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start sm:self-center"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Replay</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
