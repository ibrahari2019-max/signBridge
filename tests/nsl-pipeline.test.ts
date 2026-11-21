import assert from 'node:assert/strict';
import { HANDSHAPES } from '../src/nsl/handshapes.ts';
import {
  ALL_NSL_SIGNS,
  NSL_BY_CODE,
  NSL_BY_GLOSS,
  VALIDATED_TEST_PHRASES,
} from '../src/nsl/vocabulary.ts';
import { buildLexiconFallbackPlan, translateEnglishToNsl } from '../src/services/nslTranslator.ts';

async function runTests() {
  console.log('Running SignBridge NSL verification suite...');

  // 1. Lexicon integrity & metadata checks
  assert.ok(ALL_NSL_SIGNS.length >= 100, `Expected >= 100 NSL signs, got ${ALL_NSL_SIGNS.length}`);

  const seenCodes = new Set<string>();
  for (const sign of ALL_NSL_SIGNS) {
    assert.ok(!seenCodes.has(sign.signCode), `Duplicate signCode: ${sign.signCode}`);
    seenCodes.add(sign.signCode);

    assert.ok(sign.gloss.trim().length > 0, `Missing gloss for ${sign.signCode}`);
    assert.ok(sign.englishMeaning.trim().length > 0, `Missing meaning for ${sign.signCode}`);
    assert.ok(sign.handshape.trim().length > 0, `Missing handshape desc for ${sign.signCode}`);
    assert.ok(sign.orientation.trim().length > 0, `Missing orientation for ${sign.signCode}`);
    assert.ok(sign.location.trim().length > 0, `Missing location for ${sign.signCode}`);
    assert.ok(sign.movement.trim().length > 0, `Missing movement for ${sign.signCode}`);
    assert.ok(sign.facialExpression.trim().length > 0, `Missing facialExpression for ${sign.signCode}`);
    assert.ok(sign.translationNotes.trim().length > 0, `Missing translationNotes for ${sign.signCode}`);
    assert.ok(sign.sourceReference.trim().length > 0, `Missing sourceReference for ${sign.signCode}`);

    // Keyframe trajectory checks
    assert.ok(sign.keyframes.length >= 2, `Sign ${sign.signCode} needs >= 2 keyframes`);
    assert.equal(sign.keyframes[0].t, 0, `Sign ${sign.signCode} first keyframe t must be 0`);
    assert.equal(
      sign.keyframes[sign.keyframes.length - 1].t,
      1,
      `Sign ${sign.signCode} last keyframe t must be 1`
    );

    let prevT = -1;
    for (const kf of sign.keyframes) {
      assert.ok(kf.t > prevT, `Non-monotonic keyframe t in ${sign.signCode}`);
      prevT = kf.t;

      assert.ok(
        HANDSHAPES[kf.rightHand],
        `Unknown rightHand "${kf.rightHand}" in ${sign.signCode}`
      );
      if (kf.leftHand) {
        assert.ok(
          HANDSHAPES[kf.leftHand],
          `Unknown leftHand "${kf.leftHand}" in ${sign.signCode}`
        );
      }
      assert.equal(kf.rightArm.shoulder.length, 3);
      assert.equal(kf.rightArm.elbow.length, 3);
      assert.equal(kf.rightArm.wrist.length, 3);
    }
  }

  // 2. Fingerspelling A-Z & Numbers 0-10 coverage
  for (let code = 65; code <= 90; code++) {
    const ch = String.fromCharCode(code);
    assert.ok(
      NSL_BY_CODE.has(`NSL_FS_${ch}`),
      `Missing fingerspelling letter NSL_FS_${ch}`
    );
  }
  for (let n = 0; n <= 10; n++) {
    assert.ok(NSL_BY_CODE.has(`NSL_NUM_${n}`), `Missing number sign NSL_NUM_${n}`);
  }

  // 3. Validated test phrases benchmark checks
  assert.ok(VALIDATED_TEST_PHRASES.length >= 8, 'Expected at least 8 validated NSL test phrases');
  for (const phrase of VALIDATED_TEST_PHRASES) {
    for (const gloss of phrase.expectedGlosses) {
      assert.ok(
        NSL_BY_GLOSS.has(gloss),
        `Test phrase ${phrase.id} references unknown gloss "${gloss}"`
      );
    }

    const translated = await translateEnglishToNsl(
      phrase.english,
      'test_mode',
      phrase.id
    );
    assert.equal(translated.sourceMode, 'test_mode');
    assert.deepEqual(translated.nslGlossSequence, phrase.expectedGlosses);

    if (phrase.category === 'unsupported_handling') {
      assert.equal(translated.translationStatus, 'incomplete');
      assert.ok(translated.unsupportedTerms.length > 0, 'Expected unsupported terms to be surfaced');
    } else {
      assert.equal(translated.translationStatus, 'completed');
      assert.equal(translated.unsupportedTerms.length, 0);
    }

    // Verify all fingerspell tokens map to A-Z NSL_FS_*
    for (const item of translated.signItems) {
      if (item.type === 'fingerspell') {
        assert.ok(item.letters && item.letters.length > 0);
        for (const l of item.letters) {
          assert.ok(NSL_BY_CODE.has(`NSL_FS_${l.toUpperCase()}`));
        }
      }
    }
  }

  // 4. Deterministic fallback parser checks (NSL temporal fronting, WH-final, unsupported honesty)
  const fallbackQ = buildLexiconFallbackPlan('What is your name tomorrow?');
  assert.deepEqual(
    fallbackQ.tokens.map((t) => t.gloss),
    ['TOMORROW', 'YOUR', 'NAME', 'WHAT'],
    'Fallback parser should front time words and place WH-words at end'
  );
  const fallbackUnsupported = buildLexiconFallbackPlan('We need electrocardiogram in Lagos');
  assert.equal(fallbackUnsupported.tokens.some((t) => t.kind === 'unsupported' && t.sourceWord === 'electrocardiogram'), true);
  assert.equal(fallbackUnsupported.tokens.some((t) => t.kind === 'fingerspell' && t.sourceWord === 'Lagos'), true);

  // 5. Live HTTP endpoint assertions (against running server on port 3000)
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200, 'Expected /api/health to return 200');
  const healthJson = (await healthRes.json()) as { status: string };
  assert.equal(healthJson.status, 'ok');

  const vocabRes = await fetch(`${baseUrl}/api/nsl/vocabulary`);
  assert.equal(vocabRes.status, 200);
  const vocabJson = (await vocabRes.json()) as { signs: unknown[]; testPhrases: unknown[] };
  assert.equal(vocabJson.signs.length, ALL_NSL_SIGNS.length);
  assert.equal(vocabJson.testPhrases.length, VALIDATED_TEST_PHRASES.length);

  const authRes = await fetch(`${baseUrl}/api/user/me`);
  assert.equal(authRes.status, 401, 'Protected endpoint must reject unauthenticated requests');

  const badTranslateRes = await fetch(`${baseUrl}/api/nsl/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '   ' }),
  });
  assert.equal(badTranslateRes.status, 400, 'Empty translation input must return 400');

  console.log(
    `PASS: Verified ${ALL_NSL_SIGNS.length} NSL signs, ${Object.keys(HANDSHAPES).length} handshapes, ${VALIDATED_TEST_PHRASES.length} validated test phrases, and live API endpoints.`
  );
}

runTests().catch((err) => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
