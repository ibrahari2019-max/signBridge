import type { TranslationResult, TranslationSignItem } from './types.ts';
import { NSL_BY_GLOSS, NSL_CORE_VOCABULARY, NSL_NUMBER_SIGNS } from './vocabulary.ts';

export interface LexicalTokenPlan {
  kind: 'verified_sign' | 'fingerspell' | 'unsupported';
  gloss: string;
  sourceWord: string;
  nonManualCue?: string;
}

export interface LexicalTranslationPayload {
  tokens: LexicalTokenPlan[];
  grammarNotes: string;
  confidenceScore: number;
}

const ENGLISH_OMIT_WORDS = new Set([
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'a', 'an', 'the', 'to', 'at', 'for', 'of', 'and', 'or', 'do', 'does', 'did',
  'in', 'on', 'with', 'that', 'this',
]);

const TIME_GLOSSES = new Set([
  'TODAY', 'TOMORROW', 'YESTERDAY', 'MORNING', 'AFTERNOON', 'EVENING', 'NIGHT', 'NOW',
]);

const WH_GLOSSES = new Set(['WHAT', 'WHERE', 'WHO', 'WHEN', 'WHY', 'HOW']);

const WORD_TO_GLOSS: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const sign of [...NSL_CORE_VOCABULARY, ...NSL_NUMBER_SIGNS]) {
    map.set(sign.gloss.toLowerCase().replace(/_/g, ' '), sign.gloss);
    const primary = sign.englishMeaning.split('/')[0].trim().toLowerCase();
    if (primary && !map.has(primary)) map.set(primary, sign.gloss);
    for (const syn of sign.synonyms) {
      const k = syn.trim().toLowerCase();
      if (k && !map.has(k)) map.set(k, sign.gloss);
    }
  }
  map.set('me', 'I');
  map.set('im', 'I');
  map.set("i'm", 'I');
  map.set('my', 'MY');
  map.set('you', 'YOU');
  map.set('your', 'YOUR');
  map.set("you're", 'YOU');
  map.set('we', 'WE');
  map.set("we're", 'WE');
  map.set('they', 'THEY');
  map.set('thank you', 'THANK_YOU');
  map.set('thank', 'THANK_YOU');
  map.set('thanks', 'THANK_YOU');
  map.set('excuse me', 'EXCUSE_ME');
  map.set('excuse', 'EXCUSE_ME');
  map.set("what's", 'WHAT');
  map.set("where's", 'WHERE');
  map.set("who's", 'WHO');
  map.set("how's", 'HOW');
  map.set('dont', 'NOT');
  map.set("don't", 'NOT');
  map.set("can't", 'NOT');
  map.set("won't", 'NOT');
  map.set('not', 'NOT');
  map.set('no', 'NO');
  return map;
})();

export function buildLexiconFallbackPlan(sourceText: string): LexicalTranslationPayload {
  const cleaned = sourceText.replace(/[?!.,;:()"]/g, ' ').trim();
  const rawWords = cleaned.split(/\s+/).filter(Boolean);

  const timeTokens: LexicalTokenPlan[] = [];
  const whTokens: LexicalTokenPlan[] = [];
  const bodyTokens: LexicalTokenPlan[] = [];

  let i = 0;
  while (i < rawWords.length) {
    const w1 = rawWords[i];
    const w1Lower = w1.toLowerCase();
    const w2Lower = i + 1 < rawWords.length ? `${w1Lower} ${rawWords[i + 1].toLowerCase()}` : '';

    if (w2Lower === 'thank you' || w2Lower === 'excuse me') {
      const gloss = WORD_TO_GLOSS.get(w2Lower)!;
      bodyTokens.push({ kind: 'verified_sign', gloss, sourceWord: `${w1} ${rawWords[i + 1]}` });
      i += 2;
      continue;
    }

    if (ENGLISH_OMIT_WORDS.has(w1Lower)) {
      i += 1;
      continue;
    }

    const matchedGloss = WORD_TO_GLOSS.get(w1Lower);
    if (matchedGloss) {
      const tok: LexicalTokenPlan = { kind: 'verified_sign', gloss: matchedGloss, sourceWord: w1 };
      if (TIME_GLOSSES.has(matchedGloss)) timeTokens.push(tok);
      else if (WH_GLOSSES.has(matchedGloss)) whTokens.push(tok);
      else bodyTokens.push(tok);
    } else if (i > 0 && /^[A-Z][a-zA-Z]{1,14}$/.test(w1)) {
      bodyTokens.push({ kind: 'fingerspell', gloss: w1.toUpperCase(), sourceWord: w1 });
    } else {
      bodyTokens.push({ kind: 'unsupported', gloss: w1.toUpperCase(), sourceWord: w1 });
    }
    i += 1;
  }

  return {
    tokens: [...timeTokens, ...bodyTokens, ...whTokens],
    grammarNotes: 'Translated using Nigerian Sign Language topic-comment structure.',
    confidenceScore: 0.82,
  };
}

export function buildTranslationResultFromPlan(
  sourceText: string,
  sourceMode: TranslationResult['sourceMode'],
  plan: LexicalTranslationPayload,
  processingMs: number
): TranslationResult {
  const signItems: TranslationSignItem[] = [];
  const nslGlossSequence: string[] = [];
  const unsupportedTerms: string[] = [];

  plan.tokens.forEach((tok, idx) => {
    const cleanGloss = (tok.gloss || '').trim().toUpperCase();
    if (tok.kind === 'verified_sign') {
      const sign = NSL_BY_GLOSS.get(cleanGloss);
      if (sign) {
        nslGlossSequence.push(sign.gloss);
        signItems.push({
          id: `sign-${idx}-${sign.signCode}`,
          type: 'verified_sign',
          gloss: sign.gloss,
          displayLabel: sign.englishMeaning,
          signCode: sign.signCode,
          sourceWord: tok.sourceWord || sign.englishMeaning,
          facialExpression: sign.facialExpression,
          nonManualMarkers: tok.nonManualCue || sign.nonManualMarkers,
          notes: sign.translationNotes,
        });
        return;
      }
      const rawWord = (tok.sourceWord || cleanGloss).trim();
      unsupportedTerms.push(rawWord);
      signItems.push({
        id: `unsupported-${idx}`,
        type: 'unsupported',
        gloss: `[${rawWord.toUpperCase()}]`,
        displayLabel: rawWord,
        sourceWord: rawWord,
        facialExpression: 'Neutral',
        nonManualMarkers: 'English caption fallback',
      });
      return;
    }

    if (tok.kind === 'fingerspell') {
      const cleanWord = (tok.sourceWord || tok.gloss || '').replace(/[^a-zA-Z]/g, '');
      if (cleanWord.length > 0 && cleanWord.length <= 16) {
        const letters = cleanWord.toUpperCase().split('');
        letters.forEach((l) => nslGlossSequence.push(`FS-${l}`));
        signItems.push({
          id: `fs-${idx}-${cleanWord}`,
          type: 'fingerspell',
          gloss: `FS(${cleanWord.toUpperCase()})`,
          displayLabel: `Fingerspell: ${cleanWord}`,
          letters,
          sourceWord: tok.sourceWord || cleanWord,
          facialExpression: 'Neutral',
          nonManualMarkers: tok.nonManualCue || 'Subtle mouthing',
        });
        return;
      }
    }

    const term = (tok.sourceWord || tok.gloss || '').trim();
    if (term) {
      unsupportedTerms.push(term);
      signItems.push({
        id: `unsupported-${idx}`,
        type: 'unsupported',
        gloss: `[${term.toUpperCase()}]`,
        displayLabel: term,
        sourceWord: term,
        facialExpression: 'Neutral',
        nonManualMarkers: 'English caption fallback',
      });
    }
  });

  return {
    sourceText,
    sourceMode,
    nslGlossSequence,
    signItems,
    translationStatus: unsupportedTerms.length > 0 ? 'incomplete' : 'completed',
    unsupportedTerms,
    grammarNotes: plan.grammarNotes || 'Translated using Nigerian Sign Language syntax.',
    confidenceScore: Math.max(0.1, Math.min(1.0, plan.confidenceScore ?? 0.85)),
    processingMs,
  };
}

export function translateInstantNsl(
  sourceText: string,
  sourceMode: TranslationResult['sourceMode'] = 'mic'
): TranslationResult {
  const started = Date.now();
  const plan = buildLexiconFallbackPlan(sourceText);
  return buildTranslationResultFromPlan(sourceText, sourceMode, plan, Date.now() - started);
}
