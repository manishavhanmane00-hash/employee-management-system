const mongoose = require('mongoose');

const holidayAttendanceSchema = new mongoose.Schema({
  holidayId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Holiday', required: true, index: true },
  employeeRef:   { type: mongoose.Schema.Types.ObjectId, refPath: 'employeeModel', required: true, index: true },
  employeeModel: { type: String, enum: ['Employee', 'User'], default: 'Employee' },
  employeeId:    { type: String, required: true, index: true },
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  employeeName:  { type: String, default: '' },
  email:         { type: String, default: '' },
  department:    { type: String, default: '' },
  date:          { type: String, required: true, index: true },
  holidayName:   { type: String, required: true },
  holidayStatus: { type: String, enum: ['Public Holiday', 'Company Holiday', 'Assigned Holiday'], required: true },
}, { timestamps: true });

holidayAttendanceSchema.index({ holidayId: 1, employeeRef: 1, date: 1 }, { unique: true });
holidayAttendanceSchema.index({ employeeRef: 1, date: 1 });

module.exports = mongoose.model('HolidayAttendance', holidayAttendanceSchema);
