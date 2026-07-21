import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = 'test-key';
const { parseLabsFromImage } = await import('../ai.js');

function mockOpenAi(handler){
  const original = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = original; };
}

describe('parseLabsFromImage', () => {
  test('sends the photo as an image_url content block and returns sanitized labs', async (t) => {
    const restore = mockOpenAi(async (url, opts) => {
      const body = JSON.parse(opts.body);
      const userMsg = body.messages.find(m => m.role === 'user');
      assert.ok(Array.isArray(userMsg.content), 'vision content must be an array of parts');
      const imagePart = userMsg.content.find(p => p.type === 'image_url');
      assert.equal(imagePart.image_url.url, 'data:image/jpeg;base64,AAAA');
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            labs: { hb: '11.2', platelets: '210000', sodium: '138' },
            reportDate: '2026-07-18'
          }) } }]
        })
      };
    });
    t.after(restore);

    const result = await parseLabsFromImage('data:image/jpeg;base64,AAAA');
    assert.equal(result.labs.hb, '11.2');
    assert.equal(result.labs.platelets, '210000');
    assert.equal(result.labs.sodium, '138');
    assert.equal(result.reportDate, '2026-07-18');
  });

  test('drops an unparseable reportDate rather than guessing', async (t) => {
    const restore = mockOpenAi(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          labs: { hb: '10' }, reportDate: 'sometime last week'
        }) } }]
      })
    }));
    t.after(restore);

    const result = await parseLabsFromImage('data:image/jpeg;base64,AAAA');
    assert.equal(result.reportDate, null);
  });

  test('returns an empty labs object when nothing is recognizable', async (t) => {
    const restore = mockOpenAi(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ labs: {}, reportDate: null }) } }]
      })
    }));
    t.after(restore);

    const result = await parseLabsFromImage('data:image/jpeg;base64,AAAA');
    assert.deepEqual(result.labs, {});
    assert.equal(result.reportDate, null);
  });

  test('captures unrecognized analytes as otherLabs instead of dropping them', async (t) => {
    const restore = mockOpenAi(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          labs: { hb: '11.2', uricAcid: '8.2' },
          otherLabs: [{ name: 'HbA1c', value: '6.1' }],
          reportDate: null
        }) } }]
      })
    }));
    t.after(restore);

    const result = await parseLabsFromImage('data:image/jpeg;base64,AAAA');
    assert.equal(result.labs.hb, '11.2');
    assert.equal('uricAcid' in result.labs, false);
    assert.deepEqual(result.otherLabs, [
      { name: 'uricAcid', value: '8.2' },
      { name: 'HbA1c', value: '6.1' }
    ]);
  });

  test('accepts bone-profile keys as first-class labs', async (t) => {
    const restore = mockOpenAi(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          labs: { calcium: '9.1', phosphate: '3.2', alp: '95', albumin: '3.9' },
          reportDate: null
        }) } }]
      })
    }));
    t.after(restore);

    const result = await parseLabsFromImage('data:image/jpeg;base64,AAAA');
    assert.deepEqual(result.labs, { calcium: '9.1', phosphate: '3.2', alp: '95', albumin: '3.9' });
    assert.deepEqual(result.otherLabs, []);
  });
});
