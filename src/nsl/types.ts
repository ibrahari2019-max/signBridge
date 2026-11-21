export type HandshapeId =
  | 'FLAT_B'
  | 'OPEN_5'
  | 'FIST_S'
  | 'FIST_A'
  | 'POINT_1'
  | 'VICTORY_V'
  | 'C_HAND'
  | 'O_HAND'
  | 'FLAT_O'
  | 'PINCH_F'
  | 'Y_HAND'
  | 'L_HAND'
  | 'ILY_HAND'
  | 'CLAW_5'
  | 'BENT_B'
  | 'W_HAND'
  | 'R_HAND'
  | 'K_HAND'
  | 'U_HAND'
  | 'M_HAND'
  | 'N_HAND'
  | 'T_HAND'
  | 'E_HAND'
  | 'D_HAND'
  | 'G_HAND'
  | 'H_HAND'
  | 'I_HAND'
  | 'X_HAND'
  | 'RELAXED';

export interface FingerSpec {
  // Normalized 0..1 curl per finger (0 = straight, 1 = fully curled into palm)
  thumb: number;
  thumbOppose?: number; // 0..1 opposition across palm
  index: number;
  middle: number;
  ring: number;
  pinky: number;
  spread?: number; // -0.2 .. 1.0 finger splay
}

export interface ArmTarget {
  // Shoulder pitch (negative = forward), yaw, roll (negative = outward for right, positive = outward for left)
  shoulder: [number, number, number];
  // Elbow hinge pitch (negative = bend upward/forward), forearm twist
  elbow: [number, number, number];
  // Wrist pitch, pronation/supination twist (Y), radial/ulnar tilt (Z)
  wrist: [number, number, number];
}

export interface FacialExpressionSpec {
  browRaise?: number; // 0..1 (yes/no questions, surprise)
  browFurrow?: number; // 0..1 (WH-questions, concern)
  smile?: number; // 0..1 (friendly/greeting/happy)
  mouthOpen?: number; // 0..0.6 (mouthing/emphasis)
  headPitch?: number; // radians (+ = nod down, - = tilt up)
  headYaw?: number; // radians (+ = turn left, - = turn right)
  headRoll?: number; // radians
  torsoLean?: number; // radians (+ = lean forward)
}

export interface SignKeyframe {
  t: number; // normalized 0..1 within clip duration
  rightArm: ArmTarget;
  leftArm?: ArmTarget; // omitted for one-handed signs (defaults to relaxed rest)
  rightHand: HandshapeId;
  leftHand?: HandshapeId;
  facial?: FacialExpressionSpec;
}

export type SignCategory =
  | 'greeting'
  | 'pronoun'
  | 'question'
  | 'verb'
  | 'noun'
  | 'place'
  | 'emotion'
  | 'time'
  | 'number'
  | 'fingerspell'
  | 'polite';

export interface NslSignEntry {
  signCode: string;
  gloss: string;
  englishMeaning: string;
  synonyms: string[];
  category: SignCategory;
  handshape: string;
  orientation: string;
  location: string;
  movement: string;
  facialExpression: string;
  nonManualMarkers: string;
  translationNotes: string;
  verificationStatus: 'verified' | 'draft';
  sourceReference: string;
  durationSec: number;
  twoHanded: boolean;
  keyframes: SignKeyframe[];
}

export interface TranslationSignItem {
  id: string;
  type: 'verified_sign' | 'fingerspell' | 'unsupported';
  gloss: string;
  displayLabel: string;
  signCode?: string;
  letters?: string[];
  sourceWord: string;
  facialExpression: string;
  nonManualMarkers: string;
  notes?: string;
}

export type TranslationStatusState =
  | 'idle'
  | 'listening'
  | 'speech_recognized'
  | 'translating'
  | 'preparing_animation'
  | 'signing'
  | 'incomplete'
  | 'completed'
  | 'error';

export interface TranslationResult {
  id?: number;
  sourceText: string;
  sourceMode: 'mic' | 'text' | 'audio_upload' | 'test_mode';
  nslGlossSequence: string[];
  signItems: TranslationSignItem[];
  translationStatus: 'completed' | 'incomplete' | 'failed';
  unsupportedTerms: string[];
  grammarNotes: string;
  confidenceScore: number;
  processingMs: number;
  createdAt?: string;
}

export interface CameraPresetId {
  id: 'waist_up' | 'full_body' | 'hands_closeup' | 'face_focus';
  label: string;
}

export interface TestPhraseCase {
  id: string;
  english: string;
  expectedGlosses: string[];
  linguisticHighlight: string;
  category: 'greeting' | 'question' | 'negation' | 'everyday' | 'fingerspelling' | 'unsupported_handling';
}
