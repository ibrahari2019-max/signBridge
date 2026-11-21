import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// 1. Users table (linked to Firebase Auth UID)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  photoUrl: text('photo_url'),
  role: text('role').notNull().default('user'), // 'user' | 'nsl_reviewer' | 'admin'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 2. User Settings table
export const userSettings = pgTable('user_settings', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  animationSpeed: real('animation_speed').notNull().default(1.0),
  avatarScale: real('avatar_scale').notNull().default(1.0),
  cameraPreset: text('camera_preset').notNull().default('waist_up'),
  speechAccent: text('speech_accent').notNull().default('en-NG'),
  largeTextMode: boolean('large_text_mode').notNull().default(false),
  highContrastMode: boolean('high_contrast_mode').notNull().default(false),
  showCaptions: boolean('show_captions').notNull().default(true),
  saveAudioOptIn: boolean('save_audio_opt_in').notNull().default(false),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 3. Sign Vocabulary table (modular NSL lexicon)
export const signVocabulary = pgTable(
  'sign_vocabulary',
  {
    id: serial('id').primaryKey(),
    signCode: text('sign_code').notNull().unique(),
    gloss: text('gloss').notNull(),
    englishMeaning: text('english_meaning').notNull(),
    synonyms: jsonb('synonyms').$type<string[]>().notNull().default([]),
    category: text('category').notNull(),
    handshape: text('handshape').notNull(),
    orientation: text('orientation').notNull(),
    location: text('location').notNull(),
    movement: text('movement').notNull(),
    facialExpression: text('facial_expression').notNull(),
    nonManualMarkers: text('non_manual_markers').notNull().default(''),
    translationNotes: text('translation_notes').notNull().default(''),
    verificationStatus: text('verification_status').notNull().default('verified'), // 'verified' | 'draft' | 'deprecated'
    sourceReference: text('source_reference').notNull().default('NSL Linguistic Core'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_sign_vocabulary_gloss').on(table.gloss),
    index('idx_sign_vocabulary_category').on(table.category),
  ]
);

// 4. Sign Animation Assets table (skeletal keyframe specs & asset metadata)
export const signAnimationAssets = pgTable('sign_animation_assets', {
  id: serial('id').primaryKey(),
  signId: integer('sign_id')
    .references(() => signVocabulary.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  rigFormat: text('rig_format').notNull().default('nsl_humanoid_v1'),
  durationSec: real('duration_sec').notNull(),
  twoHanded: boolean('two_handed').notNull().default(false),
  keyframeSpec: jsonb('keyframe_spec').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 5. Translation Records table
export const translationRecords = pgTable(
  'translation_records',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    sourceText: text('source_text').notNull(),
    sourceMode: text('source_mode').notNull().default('mic'), // 'mic' | 'text' | 'audio_upload' | 'test_mode'
    nslGlossSequence: jsonb('nsl_gloss_sequence').$type<string[]>().notNull().default([]),
    signItems: jsonb('sign_items').$type<Array<Record<string, unknown>>>().notNull().default([]),
    translationStatus: text('translation_status').notNull().default('completed'), // 'completed' | 'incomplete' | 'failed'
    unsupportedTerms: jsonb('unsupported_terms').$type<string[]>().notNull().default([]),
    confidenceScore: real('confidence_score').notNull().default(0.9),
    processingMs: integer('processing_ms').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_translation_records_user_created').on(table.userId, table.createdAt),
  ]
);

// 6. Translation Feedback table
export const translationFeedback = pgTable(
  'translation_feedback',
  {
    id: serial('id').primaryKey(),
    translationId: integer('translation_id').references(() => translationRecords.id, {
      onDelete: 'set null',
    }),
    signId: integer('sign_id').references(() => signVocabulary.id, {
      onDelete: 'set null',
    }),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    reportedTerm: text('reported_term').notNull(),
    issueType: text('issue_type').notNull(), // 'incorrect_sign' | 'missing_sign' | 'wrong_grammar' | 'handshape_error' | 'facial_marker'
    suggestedGloss: text('suggested_gloss'),
    notes: text('notes').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_translation_feedback_user').on(table.userId)]
);

// 7. Translation Review Status table (strict verification gate)
export const translationReviewStatus = pgTable('translation_review_status', {
  id: serial('id').primaryKey(),
  feedbackId: integer('feedback_id')
    .references(() => translationFeedback.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  status: text('status').notNull().default('pending_review'), // 'pending_review' | 'under_review' | 'approved' | 'rejected'
  reviewerUid: text('reviewer_uid'),
  reviewerNotes: text('reviewer_notes'),
  reviewedAt: timestamp('reviewed_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 8. System Configuration table
export const systemConfiguration = pgTable('system_configuration', {
  id: serial('id').primaryKey(),
  configKey: text('config_key').notNull().unique(),
  configValue: jsonb('config_value').$type<Record<string, unknown>>().notNull(),
  description: text('description').notNull().default(''),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Drizzle Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  settings: one(userSettings, {
    fields: [users.id],
    references: [userSettings.userId],
  }),
  translations: many(translationRecords),
  feedbacks: many(translationFeedback),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, {
    fields: [userSettings.userId],
    references: [users.id],
  }),
}));

export const signVocabularyRelations = relations(signVocabulary, ({ one, many }) => ({
  animationAsset: one(signAnimationAssets, {
    fields: [signVocabulary.id],
    references: [signAnimationAssets.signId],
  }),
  feedbacks: many(translationFeedback),
}));

export const signAnimationAssetsRelations = relations(signAnimationAssets, ({ one }) => ({
  sign: one(signVocabulary, {
    fields: [signAnimationAssets.signId],
    references: [signVocabulary.id],
  }),
}));

export const translationRecordsRelations = relations(translationRecords, ({ one, many }) => ({
  user: one(users, {
    fields: [translationRecords.userId],
    references: [users.id],
  }),
  feedbacks: many(translationFeedback),
}));

export const translationFeedbackRelations = relations(translationFeedback, ({ one }) => ({
  user: one(users, {
    fields: [translationFeedback.userId],
    references: [users.id],
  }),
  translation: one(translationRecords, {
    fields: [translationFeedback.translationId],
    references: [translationRecords.id],
  }),
  sign: one(signVocabulary, {
    fields: [translationFeedback.signId],
    references: [signVocabulary.id],
  }),
  reviewStatus: one(translationReviewStatus, {
    fields: [translationFeedback.id],
    references: [translationReviewStatus.feedbackId],
  }),
}));

export const translationReviewStatusRelations = relations(translationReviewStatus, ({ one }) => ({
  feedback: one(translationFeedback, {
    fields: [translationReviewStatus.feedbackId],
    references: [translationFeedback.id],
  }),
}));
