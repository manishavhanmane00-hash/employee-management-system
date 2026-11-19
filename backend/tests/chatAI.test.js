const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const { classifyQuestion, generateGroundedAnswer, isAIConfigured } = require('../services/chatAI');

const originalEnv = {
  EMS_AI_API_KEY: process.env.EMS_AI_API_KEY,
  EMS_AI_MODEL: process.env.EMS_AI_MODEL,
  EMS_AI_BASE_URL: process.env.EMS_AI_BASE_URL,
};
const originalFetch = global.fetch;

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  global.fetch = originalFetch;
});

test('reports provider unavailable when backend credentials are missing', async () => {
  delete process.env.EMS_AI_API_KEY;
  delete process.env.EMS_AI_MODEL;

  assert.equal(isAIConfigured(), false);
  assert.equal(await classifyQuestion('माझा पगार किती आहे?'), null);
});

test('classifies multilingual questions only to an allowed intent', async () => {
  process.env.EMS_AI_API_KEY = 'test-secret';
  process.env.EMS_AI_MODEL = 'test-model';
  global.fetch = async (url, options) => {
    assert.match(url, /\/chat\/completions$/);
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    const request = JSON.parse(options.body);
    assert.match(request.messages[0].content, /Marathi/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"intent":"payslip"}' } }] }) };
  };

  assert.equal(await classifyQuestion('माझा पगार किती आहे?'), 'payslip');
});

test('only returns a grounded generated answer from supplied context', async () => {
  process.env.EMS_AI_API_KEY = 'test-secret';
  process.env.EMS_AI_MODEL = 'test-model';
  global.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.match(request.messages[1].content, /verifiedEmsContext/);
    assert.match(request.messages[1].content, /approved leave policy/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"grounded":true,"answer":"तुमची रजा धोरणानुसार आहे."}' } }] }) };
  };

  const answer = await generateGroundedAnswer({
    question: 'रजा कशी घ्यावी?', role: 'Employee', module: 'leave',
    context: { knowledge: 'approved leave policy' },
  });
  assert.equal(answer, 'तुमची रजा धोरणानुसार आहे.');
});