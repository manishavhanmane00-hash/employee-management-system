const assert = require('node:assert/strict');
const { after, afterEach, before, test } = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const ChatKnowledge = require('../models/ChatKnowledge');
const ChatFeedback = require('../models/ChatFeedback');
const ChatTicket = require('../models/ChatTicket');
const Employee = require('../models/Employee');
const Payroll = require('../models/Payroll');
const User = require('../models/User');
const { answer, createTicket, saveFeedback } = require('../controllers/chatController');
const { classifyIntent } = require('../services/chatIntent');
const originalAIEnv = {
  EMS_AI_API_KEY: process.env.EMS_AI_API_KEY,
  EMS_AI_MODEL: process.env.EMS_AI_MODEL,
};
const originalFetch = global.fetch;

let mongo;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(collection => collection.deleteMany({})));
  for (const [key, value] of Object.entries(originalAIEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  global.fetch = originalFetch;
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const makeUser = async ({ employeeLinked = false } = {}) => {
  const user = await User.create({
    name: 'Test Employee',
    email: 'employee@example.test',
    password: 'test-password',
    role: 'Employee',
  });
  if (employeeLinked) {
    const employee = await Employee.create({
      employeeId: 'EMP-TEST-01',
      name: user.name,
      email: user.email,
      department: 'Engineering',
      designation: 'Engineer',
      userId: user._id,
      status: 'active',
    });
    user.employeeId = employee.employeeId;
    user.employeeRef = employee._id;
    await user.save();
    return { user, employee };
  }
  return { user, employee: null };
};

const requestUser = user => ({
  id: String(user._id),
  _id: user._id,
  name: user.name,
  email: user.email,
  employeeId: user.employeeId,
  role: user.role,
  registrationStatus: user.registrationStatus,
  accountStatus: user.accountStatus,
  onboardingStatus: user.onboardingStatus,
  personalInfoApprovalStatus: user.personalInfoApprovalStatus,
  documentVerificationStatus: user.documentVerificationStatus,
});

const callHandler = async (handler, req) => {
  let statusCode = 200;
  let body;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  await handler(req, res);
  return { statusCode, body };
};

const ask = (user, question, module = 'general') => callHandler(answer, {
  user: requestUser(user),
  body: { question, module },
});

const addSupportArticle = () => ChatKnowledge.create({
  slug: 'contact-ems-support',
  title: 'Contact EMS Support',
  category: 'Support',
  module: 'general',
  content: 'To contact EMS support, create a support ticket in EMS Assistant. Review the details and confirm submission. Ticket updates appear in the Tickets tab.',
  audience: ['Employee', 'HR', 'Manager', 'Admin'],
  verified: true,
  active: true,
  source: 'Verified EMS support policy',
});

const addPayslip = employee => Payroll.create({
  employeeId: employee.employeeId,
  userId: employee.userId,
  email: employee.email,
  employeeName: employee.name,
  month: 'October',
  year: 2099,
  gross: 50000,
  net: 42000,
  status: 'paid',
  currency: 'INR',
});

test('answers verified general FAQ without an employee record', async () => {
  const { user } = await makeUser();
  await addSupportArticle();

  const { statusCode, body } = await ask(user, 'How do I contact support?');

  assert.equal(statusCode, 200);
  assert.match(body.response.text, /create a support ticket/i);
  assert.match(body.response.source, /Verified EMS support policy/);
  assert.equal(body.response.canEscalate, true);
});

test('returns the linked employee own payslip', async () => {
  const { user, employee } = await makeUser({ employeeLinked: true });
  await addPayslip(employee);

  const { statusCode, body } = await ask(user, 'Show my payslip');

  assert.equal(statusCode, 200);
  assert.match(body.response.text, /October 2099/);
  assert.match(body.response.text, /₹42,000/);
  assert.equal(body.response.source, 'Payroll records');
});

test('personal request without a linked employee creates an account verification ticket', async () => {
  const { user } = await makeUser();

  const { statusCode, body } = await ask(user, 'Show my payslip');

  assert.equal(statusCode, 200);
  assert.match(body.response.text, /My Salary/);
  assert.match(body.response.text, /verification ticket for HR/);
  assert.doesNotMatch(body.response.text, /could not safely resolve/i);
  assert.match(body.response.ticket.ticketId, /^EMS-/);
  assert.equal(await ChatTicket.countDocuments({ requesterId: user._id }), 1);
});

test('repeated unresolved questions reuse their open ticket', async () => {
  const { user } = await makeUser();

  const first = await ask(user, 'Show my payslip');
  const second = await ask(user, 'Show my payslip');

  assert.equal(first.body.response.ticket.reused, undefined);
  assert.equal(second.body.response.ticket.reused, true);
  assert.equal(first.body.response.ticket.ticketId, second.body.response.ticket.ticketId);
  assert.equal(await ChatTicket.countDocuments({ requesterId: user._id }), 1);
});

test('AI classifies multilingual payroll questions while querying only the linked account', async () => {
  const { user, employee } = await makeUser({ employeeLinked: true });
  await addPayslip(employee);
  process.env.EMS_AI_API_KEY = 'test-secret';
  process.env.EMS_AI_MODEL = 'test-model';
  global.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.match(request.messages[1].content, /माझा पगार किती आहे/);
    assert.doesNotMatch(request.messages[1].content, /42000/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"intent":"payslip"}' } }] }) };
  };

  const { statusCode, body } = await ask(user, 'माझा पगार किती आहे?');

  assert.equal(statusCode, 200);
  assert.match(body.response.text, /₹42,000/);
  assert.equal(body.context.ai.configured, true);
  assert.equal(body.context.ai.used, false);
});

test('AI uses approved knowledge when a Marathi question misses keyword matching', async () => {
  const { user } = await makeUser();
  await addSupportArticle();
  process.env.EMS_AI_API_KEY = 'test-secret';
  process.env.EMS_AI_MODEL = 'test-model';
  let callCount = 0;
  global.fetch = async (_url, options) => {
    callCount += 1;
    const request = JSON.parse(options.body);
    if (callCount === 1) return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"intent":"faq"}' } }] }),
    };
    assert.match(request.messages[1].content, /To contact EMS support/);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"grounded":true,"answer":"EMS Support मध्ये ticket तयार करा."}' } }] }),
    };
  };

  const { statusCode, body } = await ask(user, 'कंपनीचे नियम काय आहेत?');

  assert.equal(statusCode, 200);
  assert.equal(body.response.text, 'EMS Support मध्ये ticket तयार करा.');
  assert.equal(body.response.source, 'Verified EMS Knowledge Base');
  assert.equal(body.context.ai.used, true);
  assert.equal(body.response.ticket, null);
});

test('normalizes Marathi/Hinglish payslip request to personal payslip intent', async () => {
  const { user, employee } = await makeUser({ employeeLinked: true });
  await addPayslip(employee);

  assert.equal(classifyIntent('mala salary payslip display zale pahije').intent, 'payslip');
  const { statusCode, body } = await ask(user, 'mala salary payslip display zale pahije');

  assert.equal(statusCode, 200);
  assert.match(body.response.text, /October 2099/);
  assert.match(body.response.text, /₹42,000/);
});

test('normalizes Marathi/Hinglish support question and answers verified knowledge', async () => {
  const { user } = await makeUser();
  await addSupportArticle();

  assert.equal(classifyIntent('support kasa contact karu').intent, 'support_contact');
  assert.equal(classifyIntent('मदत कशी संपर्क करू').intent, 'support_contact');
  assert.equal(classifyIntent('मदद कैसे संपर्क करूं').intent, 'support_contact');
  const { statusCode, body } = await ask(user, 'support kasa contact karu');

  assert.equal(statusCode, 200);
  assert.match(body.response.text, /create a support ticket/i);
  assert.match(body.response.source, /Verified EMS support policy/);
  assert.equal(body.response.canEscalate, true);

  const hindi = await ask(user, 'मदद कैसे संपर्क करूं');
  assert.equal(hindi.statusCode, 200);
  assert.match(hindi.body.response.text, /create a support ticket/i);
});

test('feedback and ticket actions remain available after an unlinked personal answer', async () => {
  const { user } = await makeUser();
  const response = await ask(user, 'Show my payslip');
  const responsePayload = response.body.response;

  const feedback = await callHandler(saveFeedback, {
    user: requestUser(user),
    body: {
      responseId: responsePayload.id,
      helpful: true,
      question: 'मला salary payslip display zale pahije',
      answer: responsePayload.text,
      module: 'payroll',
    },
  });
  assert.equal(feedback.statusCode, 201);
  assert.equal(await ChatFeedback.countDocuments({ userId: user._id }), 1);

  const ticket = await callHandler(createTicket, {
    user: requestUser(user),
    body: { subject: 'Payslip access', description: responsePayload.text, module: 'payroll' },
  });
  assert.equal(ticket.statusCode, 201);
  assert.equal(await ChatTicket.countDocuments({ requesterId: user._id }), 2);
});
