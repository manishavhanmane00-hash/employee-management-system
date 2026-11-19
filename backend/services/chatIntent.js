const PERSONAL_INTENTS = new Set(['payslip', 'leave_balance', 'attendance', 'profile']);

const normalizeChatText = value => {
  let text = String(value || '').toLowerCase().normalize('NFKC');
  const translations = [
    [/मदत|मदद|सहाय्य|सहायता/g, ' support '],
    [/संपर्क/g, ' contact '],
    [/कसा|कशी|कसे|कैसे|कैसा/g, ' how '],
    [/पगार|वेतन/g, ' salary '],
    [/पावती|पर्ची/g, ' payslip '],
    [/दाखवा|दाखव|दिखाओ|दिखा/g, ' show '],
    [/मला|माझा|माझी|माझे|मुझे|मेरा|मेरी/g, ' my '],
    [/पाहिजे|चाहिए/g, ' show '],
    [/शिल्लक|बाकी|शेष/g, ' balance '],
  ];
  for (const [pattern, replacement] of translations) text = text.replace(pattern, replacement);

  const transliterations = [
    [/\b(mala|majha|maza|majhi|mujhe|mera|meri)\b/g, ' my '],
    [/\b(pagar|vetan)\b/g, ' salary '],
    [/\b(sampark)\b/g, ' contact '],
    [/\b(madad|madat|sahayya|sahayata)\b/g, ' support '],
    [/\b(kasa|kashi|kaise|kaisa)\b/g, ' how '],
    [/\b(karu|karo|kare|karna)\b/g, ' contact '],
    [/\b(dakhva|dakhav|dakhay|dikhao|dikha|pahije|chahiye)\b/g, ' show '],
    [/\b(zale|jhale|zala|jhala)\b/g, ' '],
    [/\b(patta|pata)\b/g, ' profile '],
  ];
  for (const [pattern, replacement] of transliterations) text = text.replace(pattern, replacement);
  return text.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
};

const classifyIntent = question => {
  const normalized = normalizeChatText(question);
  if (/\b(support|help|ticket)\b/.test(normalized)
    || (/\bcontact\b/.test(normalized) && /\bhow\b/.test(normalized))) {
    return { intent: 'support_contact', confidence: 0.98, normalized };
  }
  if (/\b(payslip|pay slip|salary slip|salary statement)\b/.test(normalized)
    || (/\bsalary\b/.test(normalized) && /\b(my|show|view|display|download)\b/.test(normalized))) {
    return { intent: 'payslip', confidence: 0.96, normalized };
  }
  if (/\b(leave|vacation)\b/.test(normalized)
    && /\b(balance|remaining|available|my|status|history|request)\b/.test(normalized)) {
    return { intent: 'leave_balance', confidence: 0.9, normalized };
  }
  if (/\b(attendance|check in|check out|working hours)\b/.test(normalized)
    && /\b(my|history|record|records|hours|show|status)\b/.test(normalized)) {
    return { intent: 'attendance', confidence: 0.9, normalized };
  }
  if (/\b(profile|personal details|personal information)\b/.test(normalized)
    && /\b(my|update|edit|show|view)\b/.test(normalized)) {
    return { intent: 'profile', confidence: 0.9, normalized };
  }
  return { intent: 'faq', confidence: 0.35, normalized };
};

module.exports = { PERSONAL_INTENTS, classifyIntent, normalizeChatText };
