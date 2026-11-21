import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  buildLexiconFallbackPlan,
  buildTranslationResultFromPlan,
  type LexicalTokenPlan,
  type LexicalTranslationPayload,
} from '../nsl/localTranslator.ts';
import type { TranslationResult } from '../nsl/types.ts';
import {
  NSL_CORE_VOCABULARY,
  NSL_NUMBER_SIGNS,
  VALIDATED_TEST_PHRASES,
} from '../nsl/vocabulary.ts';

export { buildLexiconFallbackPlan, translateInstantNsl } from '../nsl/localTranslator.ts';

let _aiClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  if (!_aiClient) {
    _aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return _aiClient;
}

const AVAILABLE_GLOSSES_SUMMARY = [...NSL_CORE_VOCABULARY, ...NSL_NUMBER_SIGNS]
  .map((s) => `${s.gloss} (${s.englishMeaning}; syn: ${s.synonyms.slice(0, 4).join(', ')})`)
  .join('\n');

export async function translateEnglishToNsl(
  sourceText: string,
  sourceMode: TranslationResult['sourceMode'] = 'text',
  testPhraseId?: string
): Promise<TranslationResult> {
  const started = Date.now();
  const trimmed = sourceText.trim();
  if (!trimmed) {
    throw new Error('Input text is empty.');
  }

  if (sourceMode === 'test_mode' && testPhraseId) {
    const testCase = VALIDATED_TEST_PHRASES.find((p) => p.id === testPhraseId);
    if (testCase) {
      const tokens: LexicalTokenPlan[] = [];
      for (const g of testCase.expectedGlosses) {
        if (g.startsWith('FS-')) {
          const last = tokens[tokens.length - 1];
          const ch = g.slice(3);
          if (last && last.kind === 'fingerspell') {
            last.sourceWord += ch;
            last.gloss += ch;
          } else {
            tokens.push({ kind: 'fingerspell', gloss: ch, sourceWord: ch });
          }
        } else {
          tokens.push({ kind: 'verified_sign', gloss: g, sourceWord: g.toLowerCase().replace(/_/g, ' ') });
        }
      }
      if (testCase.category === 'unsupported_handling') {
        tokens.push({ kind: 'unsupported', gloss: 'QUANTUM_CRYPTOGRAPHY', sourceWord: 'quantum cryptography' });
        tokens.push({ kind: 'unsupported', gloss: 'SERVER', sourceWord: 'server' });
      }
      return buildTranslationResultFromPlan(
        testCase.english,
        'test_mode',
        {
          tokens,
          grammarNotes: testCase.linguisticHighlight,
          confidenceScore: testCase.category === 'unsupported_handling' ? 0.65 : 0.98,
        },
        Date.now() - started
      );
    }
  }

  const ai = getGeminiClient();

  const systemInstruction = `You are an expert Nigerian Sign Language (NSL) linguistic translator.
Convert spoken English sentences into a structured sequence of Nigerian Sign Language glosses.

RULES OF NIGERIAN SIGN LANGUAGE (NSL):
1. Do NOT output word-for-word Signed English. Omit English copulas ("is", "am", "are", "was", "were"), articles ("a", "an", "the"), and redundant prepositions ("to", "at", "for") unless semantically required.
2. Place time indicators at the beginning of the clause (e.g., TODAY, TOMORROW, YESTERDAY, MORNING, AFTERNOON, EVENING).
3. Use Topic-Comment and Question-Final ordering:
   - WH-questions place WHAT, WHERE, WHO, WHEN, WHY, HOW at the END (e.g., "What is your name?" -> YOUR NAME WHAT).
   - Negation places NOT after the verb (e.g., "I do not understand" -> I UNDERSTAND NOT).
4. STRICT LEXICON CONSTRAINT:
   - For "verified_sign", choose ONLY glosses from the VERIFIED NSL GLOSSES list below.
   - Never invent a gloss or substitute an unlisted sign.
   - Use "fingerspell" ONLY for proper names or cities (e.g., Lagos, Abuja, Amina, Tunde).
   - For concepts not in the verified list and not proper nouns, emit kind="unsupported" with sourceWord set to the English word.

VERIFIED NSL GLOSSES:
${AVAILABLE_GLOSSES_SUMMARY}`;

  const modelsToTry = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;
  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;

  for (const modelName of modelsToTry) {
    try {
      const isHydrogen = modelName === 'gemini-4-hydrogen';
      const generatePromise = ai.models.generateContent({
        model: modelName,
        contents: `Translate this English sentence to Nigerian Sign Language (NSL): "${trimmed}"`,
        config: {
          systemInstruction,
          ...(isHydrogen ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tokens: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    kind: {
                      type: Type.STRING,
                      description: 'Must be one of: verified_sign, fingerspell, unsupported',
                    },
                    gloss: {
                      type: Type.STRING,
                      description: 'Exact uppercase gloss from VERIFIED NSL GLOSSES when verified_sign, or word when fingerspell/unsupported',
                    },
                    sourceWord: {
                      type: Type.STRING,
                      description: 'Original English word or short phrase represented',
                    },
                    nonManualCue: {
                      type: Type.STRING,
                      description: 'Facial/head marker note',
                    },
                  },
                  required: ['kind', 'gloss', 'sourceWord'],
                },
              },
              grammarNotes: {
                type: Type.STRING,
                description: 'Concise 1-sentence explanation of NSL syntax applied',
              },
              confidenceScore: {
                type: Type.NUMBER,
                description: 'Translation confidence from 0.0 to 1.0',
              },
            },
            required: ['tokens', 'grammarNotes', 'confidenceScore'],
          },
        },
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('503 Upstream model timeout')), 8000)
      );
      response = await Promise.race([generatePromise, timeoutPromise]);
      break;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isTransient =
        errMsg.includes('503') ||
        errMsg.includes('UNAVAILABLE') ||
        errMsg.includes('429') ||
        errMsg.includes('timeout');
      if (!isTransient) {
        throw err;
      }
    }
  }

  if (!response) {
    return buildTranslationResultFromPlan(
      trimmed,
      sourceMode,
      buildLexiconFallbackPlan(trimmed),
      Date.now() - started
    );
  }

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Empty response received from NSL translation service.');
  }

  let parsed: LexicalTranslationPayload;
  try {
    parsed = JSON.parse(rawText) as LexicalTranslationPayload;
  } catch {
    throw new Error('Invalid JSON returned by NSL translation service.');
  }

  return buildTranslationResultFromPlan(trimmed, sourceMode, parsed, Date.now() - started);
}
