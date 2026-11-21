import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  signAnimationAssets,
  signVocabulary,
  systemConfiguration,
  translationFeedback,
  translationRecords,
  translationReviewStatus,
  userSettings,
  users,
} from '../db/schema.ts';
import type { TranslationResult } from '../nsl/types.ts';
import { ALL_NSL_SIGNS } from '../nsl/vocabulary.ts';

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string | null,
  photoUrl?: string | null
) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName: displayName ?? null,
        photoUrl: photoUrl ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          displayName: displayName ?? null,
          photoUrl: photoUrl ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    const user = result[0];
    // Ensure default settings row exists
    await db
      .insert(userSettings)
      .values({ userId: user.id })
      .onConflictDoNothing({ target: userSettings.userId });

    return user;
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Unable to synchronize user profile.', { cause: error });
  }
}

export async function getUserSettings(userId: number) {
  try {
    const rows = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
    if (rows.length > 0) return rows[0];
    const inserted = await db.insert(userSettings).values({ userId }).returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed in getUserSettings:', error);
    throw new Error('Unable to load user settings.', { cause: error });
  }
}

export async function updateUserSettings(
  userId: number,
  patch: Partial<{
    animationSpeed: number;
    avatarScale: number;
    cameraPreset: string;
    speechAccent: string;
    largeTextMode: boolean;
    highContrastMode: boolean;
    showCaptions: boolean;
    saveAudioOptIn: boolean;
  }>
) {
  try {
    const updated = await db
      .insert(userSettings)
      .values({
        userId,
        ...patch,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          ...patch,
          updatedAt: new Date(),
        },
      })
      .returning();
    return updated[0];
  } catch (error) {
    console.error('Database query failed in updateUserSettings:', error);
    throw new Error('Unable to save user settings.', { cause: error });
  }
}

export async function saveTranslationRecord(userId: number, result: TranslationResult) {
  try {
    const inserted = await db
      .insert(translationRecords)
      .values({
        userId,
        sourceText: result.sourceText,
        sourceMode: result.sourceMode,
        nslGlossSequence: result.nslGlossSequence,
        signItems: result.signItems as unknown as Array<Record<string, unknown>>,
        translationStatus: result.translationStatus,
        unsupportedTerms: result.unsupportedTerms,
        confidenceScore: result.confidenceScore,
        processingMs: result.processingMs,
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed in saveTranslationRecord:', error);
    throw new Error('Unable to save translation record.', { cause: error });
  }
}

export async function listUserTranslations(userId: number, limit = 50) {
  try {
    return await db
      .select()
      .from(translationRecords)
      .where(eq(translationRecords.userId, userId))
      .orderBy(desc(translationRecords.createdAt))
      .limit(limit);
  } catch (error) {
    console.error('Database query failed in listUserTranslations:', error);
    throw new Error('Unable to fetch translation history.', { cause: error });
  }
}

export async function clearUserTranslations(userId: number) {
  try {
    await db.delete(translationRecords).where(eq(translationRecords.userId, userId));
  } catch (error) {
    console.error('Database query failed in clearUserTranslations:', error);
    throw new Error('Unable to clear translation history.', { cause: error });
  }
}

export async function submitTranslationFeedback(
  userId: number,
  payload: {
    translationId?: number | null;
    signCode?: string | null;
    reportedTerm: string;
    issueType: string;
    suggestedGloss?: string | null;
    notes: string;
  }
) {
  try {
    let signId: number | null = null;
    if (payload.signCode) {
      const found = await db
        .select({ id: signVocabulary.id })
        .from(signVocabulary)
        .where(eq(signVocabulary.signCode, payload.signCode))
        .limit(1);
      if (found.length > 0) signId = found[0].id;
    }

    const created = await db.transaction(async (tx) => {
      const [fb] = await tx
        .insert(translationFeedback)
        .values({
          userId,
          translationId: payload.translationId ?? null,
          signId,
          reportedTerm: payload.reportedTerm,
          issueType: payload.issueType,
          suggestedGloss: payload.suggestedGloss ?? null,
          notes: payload.notes,
        })
        .returning();

      const [review] = await tx
        .insert(translationReviewStatus)
        .values({
          feedbackId: fb.id,
          status: 'pending_review',
        })
        .returning();

      return { feedback: fb, reviewStatus: review };
    });

    return created;
  } catch (error) {
    console.error('Database query failed in submitTranslationFeedback:', error);
    throw new Error('Unable to submit translation feedback.', { cause: error });
  }
}

export async function listUserFeedback(userId: number) {
  try {
    const rows = await db
      .select({
        id: translationFeedback.id,
        reportedTerm: translationFeedback.reportedTerm,
        issueType: translationFeedback.issueType,
        suggestedGloss: translationFeedback.suggestedGloss,
        notes: translationFeedback.notes,
        createdAt: translationFeedback.createdAt,
        reviewStatus: translationReviewStatus.status,
        reviewerNotes: translationReviewStatus.reviewerNotes,
        reviewedAt: translationReviewStatus.reviewedAt,
      })
      .from(translationFeedback)
      .leftJoin(translationReviewStatus, eq(translationReviewStatus.feedbackId, translationFeedback.id))
      .where(eq(translationFeedback.userId, userId))
      .orderBy(desc(translationFeedback.createdAt))
      .limit(40);

    return rows;
  } catch (error) {
    console.error('Database query failed in listUserFeedback:', error);
    throw new Error('Unable to fetch submitted feedback.', { cause: error });
  }
}

export async function updateFeedbackReviewStatus(
  feedbackId: number,
  reviewerUid: string,
  status: 'pending_review' | 'under_review' | 'approved' | 'rejected',
  reviewerNotes?: string
) {
  try {
    const updated = await db
      .update(translationReviewStatus)
      .set({
        status,
        reviewerUid,
        reviewerNotes: reviewerNotes ?? null,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(translationReviewStatus.feedbackId, feedbackId))
      .returning();

    return updated[0] ?? null;
  } catch (error) {
    console.error('Database query failed in updateFeedbackReviewStatus:', error);
    throw new Error('Unable to update review status.', { cause: error });
  }
}

export async function syncVocabularySeedToDb() {
  try {
    for (const sign of ALL_NSL_SIGNS) {
      const [inserted] = await db
        .insert(signVocabulary)
        .values({
          signCode: sign.signCode,
          gloss: sign.gloss,
          englishMeaning: sign.englishMeaning,
          synonyms: sign.synonyms,
          category: sign.category,
          handshape: sign.handshape,
          orientation: sign.orientation,
          location: sign.location,
          movement: sign.movement,
          facialExpression: sign.facialExpression,
          nonManualMarkers: sign.nonManualMarkers,
          translationNotes: sign.translationNotes,
          verificationStatus: sign.verificationStatus,
          sourceReference: sign.sourceReference,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: signVocabulary.signCode,
          set: {
            gloss: sign.gloss,
            englishMeaning: sign.englishMeaning,
            synonyms: sign.synonyms,
            category: sign.category,
            handshape: sign.handshape,
            orientation: sign.orientation,
            location: sign.location,
            movement: sign.movement,
            facialExpression: sign.facialExpression,
            nonManualMarkers: sign.nonManualMarkers,
            translationNotes: sign.translationNotes,
            verificationStatus: sign.verificationStatus,
            sourceReference: sign.sourceReference,
            updatedAt: new Date(),
          },
        })
        .returning();

      await db
        .insert(signAnimationAssets)
        .values({
          signId: inserted.id,
          rigFormat: 'nsl_humanoid_v1',
          durationSec: sign.durationSec,
          twoHanded: sign.twoHanded,
          keyframeSpec: { keyframes: sign.keyframes },
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: signAnimationAssets.signId,
          set: {
            durationSec: sign.durationSec,
            twoHanded: sign.twoHanded,
            keyframeSpec: { keyframes: sign.keyframes },
            updatedAt: new Date(),
          },
        });
    }

    await db
      .insert(systemConfiguration)
      .values({
        configKey: 'nsl_engine_policy',
        configValue: {
          requireVerifiedGlosses: true,
          autoApproveUserFeedback: false,
          defaultSpeechModel: 'gemini-3.5-transcribe-live',
          defaultTranslationModel: 'gemini-4-hydrogen',
          lexiconVersion: '1.0.0',
        },
        description: 'Governing translation verification and model routing policy.',
        updatedAt: new Date(),
      })
      .onConflictDoNothing({ target: systemConfiguration.configKey });

    return { seededCount: ALL_NSL_SIGNS.length };
  } catch (error) {
    console.error('Database seed failed:', error);
    throw new Error('Failed to synchronize NSL vocabulary to PostgreSQL.', { cause: error });
  }
}
