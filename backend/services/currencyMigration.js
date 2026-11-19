const CurrencyMigration = require('../models/CurrencyMigration');
const Employee = require('../models/Employee');
const Payroll = require('../models/Payroll');
const Advance = require('../models/Advance');
const Allowance = require('../models/Allowance');
const InsurancePolicy = require('../models/InsurancePolicy');
const PFProfile = require('../models/PFProfile');
const PFContribution = require('../models/PFContribution');
const PFConfiguration = require('../models/PFConfiguration');
const Overtime = require('../models/Overtime');
const OvertimePolicy = require('../models/OvertimePolicy');

const MIGRATION_ID = 'classify-legacy-financial-currency-v1';
const MODELS = {
  Employee,
  Payroll,
  Advance,
  Allowance,
  InsurancePolicy,
  PFProfile,
  PFContribution,
  PFConfiguration,
  Overtime,
  OvertimePolicy,
};

const migrateLegacyCurrency = async () => {
  const completed = await CurrencyMigration.exists({ _id: MIGRATION_ID });
  if (completed) return;

  const classifiedAsUnverified = {};
  for (const [name, Model] of Object.entries(MODELS)) {
    const result = await Model.collection.updateMany(
      { $or: [{ currency: { $exists: false } }, { currency: null }, { currency: '' }] },
      { $set: { currency: 'UNVERIFIED' } }
    );
    classifiedAsUnverified[name] = result.modifiedCount;
  }

  await CurrencyMigration.updateOne(
    { _id: MIGRATION_ID },
    { $setOnInsert: { executedAt: new Date(), classifiedAsUnverified } },
    { upsert: true }
  );
  const total = Object.values(classifiedAsUnverified).reduce((sum, count) => sum + count, 0);
  if (total) console.log(`Classified ${total} legacy financial record(s) as currency-unverified; no amounts were changed.`);
};

module.exports = { migrateLegacyCurrency };
