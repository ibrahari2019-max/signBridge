import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { auth, googleAuthProvider } from '../lib/firebase';

export interface UserSettingsState {
  animationSpeed: number;
  avatarScale: number;
  cameraPreset: 'waist_up' | 'full_body' | 'hands_closeup' | 'face_focus';
  speechAccent: 'en-NG' | 'en-US' | 'en-GB';
  largeTextMode: boolean;
  highContrastMode: boolean;
  showCaptions: boolean;
  saveAudioOptIn: boolean;
}

export const DEFAULT_SETTINGS: UserSettingsState = {
  animationSpeed: 1.0,
  avatarScale: 1.0,
  cameraPreset: 'waist_up',
  speechAccent: 'en-NG',
  largeTextMode: false,
  highContrastMode: false,
  showCaptions: true,
  saveAudioOptIn: false,
};

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  role: string;
  settings: UserSettingsState;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
  updateSettings: (patch: Partial<UserSettingsState>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState('user');
  const [settings, setSettings] = useState<UserSettingsState>(DEFAULT_SETTINGS);
  const [authError, setAuthError] = useState<string | null>(null);

  const syncProfile = useCallback(async (firebaseUser: User) => {
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/user/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user?.role) setRole(data.user.role);
        if (data.settings) {
          setSettings({
            animationSpeed: Number(data.settings.animationSpeed ?? 1.0),
            avatarScale: Number(data.settings.avatarScale ?? 1.0),
            cameraPreset: data.settings.cameraPreset ?? 'waist_up',
            speechAccent: data.settings.speechAccent ?? 'en-NG',
            largeTextMode: Boolean(data.settings.largeTextMode),
            highContrastMode: Boolean(data.settings.highContrastMode),
            showCaptions: data.settings.showCaptions ?? true,
            saveAudioOptIn: Boolean(data.settings.saveAudioOptIn),
          });
        }
      }
    } catch (err) {
      console.warn('Could not sync user profile:', err);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        await syncProfile(u);
      } else {
        setRole('user');
      }
      setLoading(false);
    });
    return unsub;
  }, [syncProfile]);

  useEffect(() => {
    document.documentElement.classList.toggle('large-text', settings.largeTextMode);
    document.documentElement.classList.toggle('dark', settings.highContrastMode);
  }, [settings.largeTextMode, settings.highContrastMode]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      setAuthError(msg);
    }
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  const getIdToken = useCallback(async () => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken();
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<UserSettingsState>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
      if (!auth.currentUser) return;
      try {
        const token = await auth.currentUser.getIdToken();
        await fetch('/api/user/settings', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(patch),
        });
      } catch (err) {
        console.warn('Failed to persist settings:', err);
      }
    },
    []
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        role,
        settings,
        authError,
        signInWithGoogle,
        signOut,
        getIdToken,
        updateSettings,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
