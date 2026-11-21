import { useCallback, useState } from 'react';
import { LiveTranslationStudio } from './components/LiveTranslationStudio';
import { SettingsView } from './components/SettingsView';
import { TopNav, type AppRoute } from './components/TopNav';
import { TranslationHistory } from './components/TranslationHistory';
import { VocabularyLibrary } from './components/VocabularyLibrary';
import { AuthProvider } from './hooks/useAuth';
import type { TranslationResult } from './nsl/types';

function StudioShell() {
  const [route, setRoute] = useState<AppRoute>('studio');
  const [sessionHistory, setSessionHistory] = useState<TranslationResult[]>([]);
  const [pendingReplay, setPendingReplay] = useState<TranslationResult | null>(null);

  const handleRecordTranslation = useCallback((rec: TranslationResult) => {
    setSessionHistory((prev) => [
      { ...rec, createdAt: rec.createdAt ?? new Date().toISOString() },
      ...prev.slice(0, 49),
    ]);
  }, []);

  const handleReplayInStudio = useCallback((rec: TranslationResult) => {
    setPendingReplay(rec);
    setRoute('studio');
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA] dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <TopNav activeRoute={route} onNavigate={setRoute} />

      <main className="flex-1">
        {route === 'studio' && (
          <LiveTranslationStudio
            onRecordTranslation={handleRecordTranslation}
            pendingReplay={pendingReplay}
            onClearPendingReplay={() => setPendingReplay(null)}
          />
        )}
        {route === 'dictionary' && <VocabularyLibrary />}
        {route === 'history' && (
          <TranslationHistory
            sessionHistory={sessionHistory}
            onClearSessionHistory={() => setSessionHistory([])}
            onReplayInStudio={handleReplayInStudio}
          />
        )}
        {route === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <StudioShell />
    </AuthProvider>
  );
}
