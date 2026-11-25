import { Modality, type LiveServerMessage } from '@google/genai';
import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { WebSocketServer, type WebSocket } from 'ws';
import { adminAuth } from './src/lib/firebase-admin.ts';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import { ALL_NSL_SIGNS, VALIDATED_TEST_PHRASES } from './src/nsl/vocabulary.ts';
import {
  clearUserTranslations,
  getOrCreateUser,
  getUserSettings,
  listUserFeedback,
  listUserTranslations,
  saveTranslationRecord,
  submitTranslationFeedback,
  syncVocabularySeedToDb,
  updateFeedbackReviewStatus,
  updateUserSettings,
} from './src/services/dbRepository.ts';
import { getGeminiClient, translateEnglishToNsl } from './src/services/nslTranslator.ts';

dotenv.config();

const app = express();
app.use(express.json({ limit: '15mb' }));

function extractCleanErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // not JSON, return raw string
  }
  return raw;
}

// Health endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'clon-nsl', timestamp: new Date().toISOString() });
});

// Public read-only NSL verified vocabulary & test benchmark catalog
app.get('/api/nsl/vocabulary', (_req, res) => {
  res.json({
    signs: ALL_NSL_SIGNS,
    testPhrases: VALIDATED_TEST_PHRASES,
  });
});

// Contextual English -> NSL translation endpoint
app.post('/api/nsl/translate', async (req, res) => {
  try {
    const { text, sourceMode = 'text', testPhraseId } = req.body ?? {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Please provide an English sentence to translate.' });
    }
    if (text.length > 1000) {
      return res.status(400).json({ error: 'Input sentence exceeds 1000 character limit.' });
    }

    const result = await translateEnglishToNsl(text, sourceMode, testPhraseId);

    // If user included a valid Bearer token, persist record automatically to Cloud SQL
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
        const user = await getOrCreateUser(decoded.uid, decoded.email ?? '', decoded.name, decoded.picture);
        const saved = await saveTranslationRecord(user.id, result);
        result.id = saved.id;
        result.createdAt = saved.createdAt.toISOString();
      } catch (persistErr) {
        console.warn('Skipping DB history save for translation:', persistErr);
      }
    }

    return res.json(result);
  } catch (error: unknown) {
    const message = extractCleanErrorMessage(error, 'Translation service unavailable.');
    console.error('Translation error:', error);
    return res.status(502).json({ error: message });
  }
});

// Pre-recorded audio transcription endpoint (Gemini 3.5 Transcribe)
app.post('/api/speech/transcribe', async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/webm' } = req.body ?? {};
    if (typeof audioBase64 !== 'string' || !audioBase64) {
      return res.status(400).json({ error: 'Missing audioBase64 payload.' });
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: audioBase64,
            },
          },
          {
            text: 'Accurately transcribe this spoken English audio, paying special attention to Nigerian English phonology, local idioms, proper nouns, and context. Return only clean transcript text with proper punctuation.',
          },
        ],
      },
    });

    const transcript = (response.text ?? '').trim();
    if (!transcript) {
      return res.status(422).json({ error: 'No clear speech was detected in the audio recording.' });
    }

    return res.json({ transcript });
  } catch (error: unknown) {
    const message = extractCleanErrorMessage(error, 'Speech transcription failed.');
    console.error('Audio transcription error:', error);
    return res.status(502).json({ error: message });
  }
});

// --- AUTHENTICATED CLOUD SQL ENDPOINTS ---

app.get('/api/user/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const decoded = req.user!;
    const user = await getOrCreateUser(
      decoded.uid,
      decoded.email ?? '',
      decoded.name ?? null,
      decoded.picture ?? null
    );
    const settings = await getUserSettings(user.id);
    return res.json({ user, settings });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load profile.';
    return res.status(500).json({ error: message });
  }
});

app.put('/api/user/settings', requireAuth, async (req: AuthRequest, res) => {
  try {
    const decoded = req.user!;
    const user = await getOrCreateUser(decoded.uid, decoded.email ?? '');
    const allowed = [
      'animationSpeed',
      'avatarScale',
      'cameraPreset',
      'speechAccent',
      'largeTextMode',
      'highContrastMode',
      'showCaptions',
      'saveAudioOptIn',
    ] as const;

    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body && key in req.body) {
        patch[key] = req.body[key];
      }
    }

    const updated = await updateUserSettings(user.id, patch);
    return res.json({ settings: updated });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update settings.';
    return res.status(500).json({ error: message });
  }
});

app.get('/api/history', requireAuth, async (req: AuthRequest, res) => {
  try {
    const decoded = req.user!;
    const user = await getOrCreateUser(decoded.uid, decoded.email ?? '');
    const records = await listUserTranslations(user.id);
    return res.json({ records });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load translation history.';
    return res.status(500).json({ error: message });
  }
});

app.post('/api/history', requireAuth, async (req: AuthRequest, res) => {
  try {
    const decoded = req.user!;
    const user = await getOrCreateUser(decoded.uid, decoded.email ?? '');
    const saved = await saveTranslationRecord(user.id, req.body);
    return res.status(201).json({ record: saved });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save translation history.';
    return res.status(500).json({ error: message });
  }
});

app.delete('/api/history', requireAuth, async (req: AuthRequest, res) => {
  try {
    const decoded = req.user!;
    const user = await getOrCreateUser(decoded.uid, decoded.email ?? '');
    await clearUserTranslations(user.id);
    return res.json({ cleared: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to clear translation history.';
    return res.status(500).json({ error: message });
  }
});

app.get('/api/feedback', requireAuth, async (req: AuthRequest, res) => {
  try {
    const decoded = req.user!;
    const user = await getOrCreateUser(decoded.uid, decoded.email ?? '');
    const items = await listUserFeedback(user.id);
    return res.json({ feedback: items });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load feedback.';
    return res.status(500).json({ error: message });
  }
});

app.post('/api/feedback', requireAuth, async (req: AuthRequest, res) => {
  try {
    const decoded = req.user!;
    const user = await getOrCreateUser(decoded.uid, decoded.email ?? '');
    const { translationId, signCode, reportedTerm, issueType, suggestedGloss, notes } = req.body ?? {};
    if (!reportedTerm || !issueType || !notes) {
      return res.status(400).json({ error: 'reportedTerm, issueType, and notes are required.' });
    }
    const created = await submitTranslationFeedback(user.id, {
      translationId,
      signCode,
      reportedTerm,
      issueType,
      suggestedGloss,
      notes,
    });
    return res.status(201).json(created);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to submit feedback.';
    return res.status(500).json({ error: message });
  }
});

app.patch('/api/feedback/:id/review', requireAuth, async (req: AuthRequest, res) => {
  try {
    const feedbackId = Number(req.params.id);
    const { status, reviewerNotes } = req.body ?? {};
    if (!Number.isFinite(feedbackId) || !['pending_review', 'under_review', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid feedback ID or review status.' });
    }
    const updated = await updateFeedbackReviewStatus(feedbackId, req.user!.uid, status, reviewerNotes);
    return res.json({ reviewStatus: updated });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update review status.';
    return res.status(500).json({ error: message });
  }
});

app.post('/api/admin/seed-vocabulary', requireAuth, async (_req: AuthRequest, res) => {
  try {
    const result = await syncVocabularySeedToDb();
    return res.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to seed vocabulary.';
    return res.status(500).json({ error: message });
  }
});

// --- HTTP + WEBSOCKET + VITE SERVER SETUP ---

const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  if (url.pathname === '/ws/transcribe') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', async (clientWs: WebSocket) => {
  let liveSession: Awaited<ReturnType<ReturnType<typeof getGeminiClient>['live']['connect']>> | null = null;
  let sessionOpen = false;
  let closed = false;
  const pendingAudio: string[] = [];

  const flushPendingAudio = () => {
    if (!liveSession || !sessionOpen || closed) return;
    while (pendingAudio.length > 0) {
      const chunk = pendingAudio.shift()!;
      try {
        liveSession.sendRealtimeInput({
          audio: {
            data: chunk,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      } catch {
        break;
      }
    }
  };

  clientWs.on('message', (raw) => {
    if (closed) return;
    try {
      const payload = JSON.parse(raw.toString()) as { audio?: string };
      if (!payload.audio) return;

      if (liveSession && sessionOpen) {
        liveSession.sendRealtimeInput({
          audio: {
            data: payload.audio,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      } else if (pendingAudio.length < 100) {
        pendingAudio.push(payload.audio);
      }
    } catch (err) {
      console.error('WebSocket audio chunk parse error:', err);
    }
  });

  clientWs.on('close', () => {
    closed = true;
    pendingAudio.length = 0;
    try {
      liveSession?.close();
    } catch {
      // ignore close errors
    }
  });

  try {
    const ai = getGeminiClient();
    liveSession = await ai.live.connect({
      model: 'gemini-3.5-transcribe-live',
      config: {
        responseModalities: [Modality.TEXT],
        inputAudioTranscription: {
          languageCodes: ['en'],
        },
      },
      callbacks: {
        onopen: () => {
          sessionOpen = true;
          flushPendingAudio();
          if (!closed && clientWs.readyState === clientWs.OPEN) {
            clientWs.send(JSON.stringify({ type: 'ready' }));
          }
        },
        onmessage: (message: LiveServerMessage) => {
          if (closed || clientWs.readyState !== clientWs.OPEN) return;
          const content = message.serverContent;
          if (content?.interimInputTranscription?.text) {
            clientWs.send(
              JSON.stringify({
                type: 'interim',
                text: content.interimInputTranscription.text,
              })
            );
          }
          if (content?.inputTranscription?.text) {
            clientWs.send(
              JSON.stringify({
                type: 'final',
                text: content.inputTranscription.text,
              })
            );
          }
        },
        onerror: (err: unknown) => {
          console.error('Gemini Live transcription error:', err);
          if (!closed && clientWs.readyState === clientWs.OPEN) {
            clientWs.send(
              JSON.stringify({
                type: 'error',
                error: 'Live speech transcription encountered an upstream error.',
              })
            );
          }
        },
      },
    });
    if (closed) {
      liveSession.close();
    } else {
      sessionOpen = true;
      flushPendingAudio();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to start live transcription.';
    console.error('Failed to connect Gemini Live transcription:', err);
    if (clientWs.readyState === clientWs.OPEN) {
      clientWs.send(JSON.stringify({ type: 'error', error: msg }));
      clientWs.close();
    }
  }
});

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(
    '/models',
    express.static(path.resolve(process.cwd(), isProd ? 'dist/models' : 'public/models'), {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.glb')) {
          res.setHeader('Content-Type', 'model/gltf-binary');
        }
      },
    })
  );

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Clon NSL server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
