# SignBridge NSL — English to Nigerian Sign Language Translation Studio

Real-time spoken English to Nigerian Sign Language (NSL) communication platform featuring streaming speech recognition, contextual NSL linguistic translation, and an articulated 54-bone 3D human avatar rendered with Three.js.

## Architecture

- **Frontend (`/src`)**: React 19 + TypeScript + Tailwind CSS v4 + Three.js (`OrbitControls`, `RoomEnvironment`, `AnimationMixer`, `QuaternionKeyframeTrack`, `GLTFLoader`).
- **3D Signing Rig (`/src/avatar/AvatarRig.ts`)**: Full-body humanoid skeleton with 3-segment articulated fingers (15 finger bones per hand), wrist pronation/supination, elbow/shoulder kinematics, eyebrow raise/furrow, jaw/smile facial expressions, natural blinking, smooth crossfade transitions, and custom `.glb` avatar loading support.
- **NSL Linguistic Lexicon (`/src/nsl/`)**: Modular verified NSL vocabulary (`vocabulary.ts`), handshape library (`handshapes.ts`), numbers `0–10`, A–Z manual fingerspelling alphabet, and validated Test Mode benchmark phrases.
- **Speech & Translation Backend (`/server.ts`, `/src/services/`)**:
  - Real-time streaming microphone transcription over WebSocket (`/ws/transcribe`) powered by `gemini-3.5-transcribe-live`, plus Browser Web Speech API (`en-NG` / `en-GB` / `en-US`) and pre-recorded audio upload (`/api/speech/transcribe` via `gemini-3.5-transcribe`).
  - Contextual English-to-NSL linguistic translation (`/api/nsl/translate` via `gemini-4-hydrogen`) applying topic-comment syntax, temporal fronting, question-final ordering, negation markers, fingerspelling expansion, and honest unsupported-word detection.
- **Database & Auth (`/src/db/`)**: Cloud SQL PostgreSQL with Drizzle ORM across 8 relational tables (`users`, `user_settings`, `sign_vocabulary`, `sign_animation_assets`, `translation_records`, `translation_feedback`, `translation_review_status`, `system_configuration`) secured by Firebase Authentication (`requireAuth`).

## Environment Variables

Configure via Secrets / environment (see `.env.example`):

- `GEMINI_API_KEY`: Server-side Google GenAI API key.
- `SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`: Cloud SQL PostgreSQL connection variables.

## Scripts

- `npm run dev` — Starts full-stack Express + WebSocket + Vite middleware server on port `3000`.
- `npm run build` — Builds production client bundle into `dist/`.
- `npm start` — Runs production server (`node server.ts`).
- `npm run lint` — Runs TypeScript type checking (`tsc --noEmit`).
