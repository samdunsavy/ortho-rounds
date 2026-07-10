import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Static imports are hoisted above any top-level statement in an ES module,
// so setting process.env.OPENAI_API_KEY before a `import ... from './ai.js'`
// line would run AFTER ai.js has already evaluated its module-level
// `const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''`. A dynamic
// import() is a real expression, not hoisted, so this ordering actually works.
process.env.OPENAI_API_KEY = 'test-key';
const { wardRiskFlags } = await import('../ai.js');

function mockOpenAi(handler){
  const original = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = original; };
}

describe('wardRiskFlags', () => {
  test('resolves beds back to real patient ids and drops hallucinated beds', async (t) => {
    const restore = mockOpenAi(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          flags: [
            { bed: '4', type: 'bad', text: 'Rising creatinine, watch renal function' },
            { bed: '99', type: 'warn', text: 'A bed the census does not contain' }
          ]
        }) } }]
      })
    }));
    t.after(restore);

    const patients = [
      { id: 'p1', bed: '4', name: 'Test Patient' },
      { id: 'p2', bed: '7', name: 'Other Patient' }
    ];
    const flags = await wardRiskFlags(patients);
    assert.equal(flags.length, 1);
    assert.equal(flags[0].patientId, 'p1');
    assert.equal(flags[0].flag.type, 'bad');
    assert.match(flags[0].flag.text, /creatinine/i);
  });

  test('never sends the real patient name to the AI, and reidentifies it back into the flag text', async (t) => {
    const restore = mockOpenAi(async (url, opts) => {
      const body = JSON.parse(opts.body);
      const userMsg = body.messages.find(m => m.role === 'user').content;
      assert.ok(!userMsg.includes('Ramesh'), 'real patient name must not reach the AI call');
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            flags: [{ bed: '4', type: 'warn', text: 'Patient A missed antibiotics dose' }]
          }) } }]
        })
      };
    });
    t.after(restore);

    const patients = [{ id: 'p1', bed: '4', name: 'Ramesh Kumar' }];
    const flags = await wardRiskFlags(patients);
    assert.equal(flags[0].flag.text, 'Ramesh Kumar missed antibiotics dose');
  });

  test('defaults an unrecognized type to warn rather than trusting the AI value', async (t) => {
    const restore = mockOpenAi(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          flags: [{ bed: '4', type: 'critical-ish nonsense', text: 'Something odd' }]
        }) } }]
      })
    }));
    t.after(restore);

    const flags = await wardRiskFlags([{ id: 'p1', bed: '4', name: 'X' }]);
    assert.equal(flags[0].flag.type, 'warn');
  });

  test('drops flags with no usable text', async (t) => {
    const restore = mockOpenAi(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          flags: [{ bed: '4', type: 'bad', text: '   ' }]
        }) } }]
      })
    }));
    t.after(restore);

    const flags = await wardRiskFlags([{ id: 'p1', bed: '4', name: 'X' }]);
    assert.deepEqual(flags, []);
  });

  test('returns an empty array without calling the AI when there are no patients', async () => {
    // No fetch mock installed — if this called out to the network it would
    // throw/hang, proving the empty-input short-circuit works.
    const flags = await wardRiskFlags([]);
    assert.deepEqual(flags, []);
  });
});
