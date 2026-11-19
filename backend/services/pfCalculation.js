const PFConfiguration = require('../models/PFConfiguration');

const roundMoney = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const getPFConfigurationForDate = date => PFConfiguration.findOne({
  effectiveFrom: { $lte: date },
  $or: [
    { effectiveTo: null },
    { effectiveTo: { $exists: false } },
    { effectiveTo: { $gte: date } },
  ],
}).sort({ effectiveFrom: -1 });

const calculatePFAmounts = ({ basicSalary, grossSalary, configuration }) => {
  if (Number(configuration.epsRate) + Number(configuration.edliRate) > Number(configuration.employerRate) + 1e-9) {
    throw new Error('PF rule is invalid: EPS plus EDLI exceeds the employer total rate.');
  }
  const salaryBasis = configuration.salaryBasis === 'grossSalary'
    ? Number(grossSalary)
    : Number(basicSalary);
  const wageBasis = configuration.wageCeiling == null
    ? salaryBasis
    : Math.min(salaryBasis, Number(configuration.wageCeiling));
  const employeeContribution = roundMoney(wageBasis * configuration.employeeRate / 100);
  const employerContribution = roundMoney(wageBasis * configuration.employerRate / 100);
  const epsContribution = roundMoney(wageBasis * configuration.epsRate / 100);
  const edliContribution = roundMoney(wageBasis * configuration.edliRate / 100);

  return {
    wageBasis,
    employeeRate: configuration.employeeRate,
    employerRate: configuration.employerRate,
    employeeContribution,
    employerContribution,
    epsContribution,
    edliContribution,
    employerEpfContribution: roundMoney(employerContribution - epsContribution - edliContribution),
    configuration: configuration._id,
  };
};

module.exports = { calculatePFAmounts, getPFConfigurationForDate };
