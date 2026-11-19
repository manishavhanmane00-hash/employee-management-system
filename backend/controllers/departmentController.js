const Department = require('../models/Department');
const Designation = require('../models/Designation');
const Employee   = require('../models/Employee');
const User       = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const Notification = require('../models/Notification');

const getDesignations = async (req, res) => {
  try {
    const filter = req.query.includeInactive === 'true' ? {} : { status: 'active' };
    const [designations, counts] = await Promise.all([
      Designation.find(filter).select('+normalizedName +normalizedDepartment').sort({ department: 1, name: 1 }).lean(),
      Employee.aggregate([
        { $match: { isDraft: { $ne: true }, designation: { $nin: ['', null] } } },
        { $group: { _id: { name: '$designation', department: '$department' }, employeeCount: { $sum: 1 } } },
      ]),
    ]);
    const countByAssignment = new Map(counts.map(item => [
      `${String(item._id.name).trim().toLocaleLowerCase()}\u0000${String(item._id.department || '').trim().toLocaleLowerCase()}`,
      item.employeeCount,
    ]));
    res.json({
      success: true,
      count: designations.length,
      data: designations.map(({ normalizedName, normalizedDepartment, ...item }) => ({
        ...item,
        employeeCount: countByAssignment.get(`${normalizedName}\u0000${normalizedDepartment}`) || 0,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const validateDesignationInput = async ({ name, department, allowInactiveDepartment = false }) => {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
    return 'Role / Designation name is required and must be at most 120 characters.';
  }
  if (typeof department !== 'string' || !department.trim() || department.trim().length > 120) {
    return 'Select a department for this designation.';
  }
  const departmentRecord = await Department.findOne({
    name: department.trim(),
    ...(!allowInactiveDepartment ? { status: 'active' } : {}),
  }).select('_id').lean();
  if (!departmentRecord) return 'Select an active department.';
  return null;
};

const createDesignation = async (req, res) => {
  try {
    const { name, department, description = '', status = 'active' } = req.body || {};
    const validationError = await validateDesignationInput({ name, department });
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    if (typeof description !== 'string' || description.length > 1000) {
      return res.status(400).json({ success: false, message: 'Description must be at most 1000 characters.' });
    }
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be active or inactive.' });
    }
    const normalizedName = name.trim().toLocaleLowerCase();
    const normalizedDepartment = department.trim().toLocaleLowerCase();
    const existing = await Designation.findOne({ normalizedName, normalizedDepartment }).select('_id').lean();
    if (existing) return res.status(409).json({ success: false, message: 'This role / designation already exists in the selected department.' });
    const designation = await Designation.create({
      name: name.trim(),
      department: department.trim(),
      description: description.trim(),
      status,
    });
    const data = designation.toObject();
    delete data.normalizedName;
    delete data.normalizedDepartment;
    res.status(201).json({ success: true, data: { ...data, employeeCount: 0 } });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'This role / designation already exists in the selected department.' });
    res.status(500).json({ success: false, message: 'Unable to save the role / designation.' });
  }
};

const updateDesignation = async (req, res) => {
  try {
    const designation = await Designation.findById(req.params.id).select('+normalizedName +normalizedDepartment');
    if (!designation) return res.status(404).json({ success: false, message: 'Role / designation not found.' });
    const { name = designation.name, department = designation.department, description = designation.description, status = designation.status } = req.body || {};
    const validationError = await validateDesignationInput({
      name,
      department,
      allowInactiveDepartment: department.trim().toLocaleLowerCase() === designation.department.toLocaleLowerCase(),
    });
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    if (typeof description !== 'string' || description.length > 1000) {
      return res.status(400).json({ success: false, message: 'Description must be at most 1000 characters.' });
    }
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be active or inactive.' });
    }
    const assignmentChanged = name.trim().toLocaleLowerCase() !== designation.normalizedName
      || department.trim().toLocaleLowerCase() !== designation.normalizedDepartment;
    if (assignmentChanged) {
      const assignedCount = await Employee.countDocuments({
        isDraft: { $ne: true },
        designation: designation.name,
        department: designation.department,
      });
      if (assignedCount) {
        return res.status(409).json({ success: false, message: 'This designation is assigned to employees. Reassign them before changing its name or department.' });
      }
    }
    designation.name = name.trim();
    designation.department = department.trim();
    designation.description = description.trim();
    designation.status = status;
    await designation.save();
    const employeeCount = await Employee.countDocuments({
      isDraft: { $ne: true }, designation: designation.name, department: designation.department,
    });
    const data = designation.toObject();
    delete data.normalizedName;
    delete data.normalizedDepartment;
    res.json({ success: true, data: { ...data, employeeCount } });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'This role / designation already exists in the selected department.' });
    res.status(500).json({ success: false, message: 'Unable to update the role / designation.' });
  }
};

const deleteDesignation = async (req, res) => {
  try {
    const designation = await Designation.findById(req.params.id);
    if (!designation) return res.status(404).json({ success: false, message: 'Role / designation not found.' });
    const employeeCount = await Employee.countDocuments({
      isDraft: { $ne: true }, designation: designation.name, department: designation.department,
    });
    if (employeeCount) {
      return res.status(409).json({ success: false, message: `This designation is assigned to ${employeeCount} employee(s). Reassign them before deleting it.` });
    }
    await Designation.deleteOne({ _id: designation._id });
    res.json({ success: true, message: 'Role / designation deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to delete the role / designation.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/departments  — list all departments with employee counts
// ─────────────────────────────────────────────────────────────────────────────
const getDepartments = async (req, res) => {
  try {
    const departments = await Department.find().sort({ name: 1 }).lean();

    // Compute live employee counts from the Employee collection
    const counts = await Employee.aggregate([
      { $group: { _id: '$department', count: { $sum: 1 } } },
    ]);
    const countMap = counts.reduce((m, c) => { m[c._id] = c.count; return m; }, {});

    departments.forEach(d => { d.employeeCount = countMap[d.name] || 0; });

    res.json({ success: true, count: departments.length, data: departments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/departments/:id
// ─────────────────────────────────────────────────────────────────────────────
const getDepartmentById = async (req, res) => {
  try {
    const dept = await Department.findById(req.params.id);
    if (!dept) return res.status(404).json({ success: false, message: 'Department not found' });
    const employeeCount = await Employee.countDocuments({ department: dept.name });
    res.json({ success: true, data: { ...dept.toObject(), employeeCount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/departments  (admin/HR)
// ─────────────────────────────────────────────────────────────────────────────
const createDepartment = async (req, res) => {
  try {
    const { name, code, description, manager } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Department name is required' });
    }

    const exists = await Department.findOne({ name: name.trim() });
    if (exists) {
      return res.status(400).json({ success: false, message: 'A department with this name already exists' });
    }

    const dept = await Department.create({
      name: name.trim(),
      code: (code || '').trim().toUpperCase(),
      description: (description || '').trim(),
      manager: (manager || '').trim(),
    });
    res.status(201).json({ success: true, data: dept });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'A department with this name already exists' });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/departments/:id  (admin/HR)
// ─────────────────────────────────────────────────────────────────────────────
const updateDepartment = async (req, res) => {
  try {
    const { name, code, description, manager, status } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (code !== undefined) updates.code = code.trim().toUpperCase();
    if (description !== undefined) updates.description = description.trim();
    if (manager !== undefined) updates.manager = manager.trim();
    if (status !== undefined) updates.status = status;

    const oldDept = await Department.findById(req.params.id);
    if (!oldDept) return res.status(404).json({ success: false, message: 'Department not found' });
    let affectedEmployees = [];

    // If renaming the department, propagate the new name to all employees in it
    if (name && name.trim() !== oldDept.name) {
      const newName = name.trim();
      const dup = await Department.findOne({ name: newName, _id: { $ne: req.params.id } });
      if (dup) {
        return res.status(400).json({ success: false, message: 'A department with this name already exists' });
      }
      const [sourceRoles, targetRoles] = await Promise.all([
        Designation.find({ department: oldDept.name }).select('+normalizedName').lean(),
        Designation.find({ department: newName }).select('+normalizedName').lean(),
      ]);
      const targetNames = new Set(targetRoles.map(role => role.normalizedName));
      if (sourceRoles.some(role => targetNames.has(role.normalizedName))) {
        return res.status(409).json({
          success: false,
          message: 'The department cannot be renamed because a role with the same name already exists in the target department.',
        });
      }
      affectedEmployees = await Employee.find({ department: oldDept.name })
        .select('_id userId employeeId email reportingManagerId name').lean();
      await Employee.updateMany({ department: oldDept.name }, { $set: { department: newName } });
      const accountConditions = [
        ...(affectedEmployees.some(employee => employee.userId)
          ? [{ _id: { $in: affectedEmployees.map(employee => employee.userId).filter(Boolean) } }]
          : []),
        ...(affectedEmployees.some(employee => employee.employeeId)
          ? [{ employeeId: { $in: affectedEmployees.map(employee => employee.employeeId).filter(Boolean) } }]
          : []),
        ...(affectedEmployees.some(employee => employee.email)
          ? [{ email: { $in: affectedEmployees.map(employee => employee.email).filter(Boolean) } }]
          : []),
      ];
      if (accountConditions.length) await User.updateMany({ $or: accountConditions }, { $set: { department: newName } });
    }

    const dept = await Department.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (name && oldDept && name.trim() !== oldDept.name) {
      await Designation.updateMany(
        { department: oldDept.name },
        { $set: { department: name.trim(), normalizedDepartment: name.trim().toLocaleLowerCase() } },
      );
    }
    let warning;
    if (affectedEmployees.length) {
      try {
        await ActivityLog.create({
          userId: req.user._id,
          userName: req.user.name,
          userRole: req.user.role,
          module: 'Departments',
          action: 'Department renamed and employee profiles synchronized',
          recordId: String(dept._id),
          previousValue: { name: oldDept.name },
          updatedValue: { name: dept.name, affectedEmployeeCount: affectedEmployees.length },
        });
        const accountIds = affectedEmployees.map(employee => employee.userId).filter(Boolean);
        const managerIds = affectedEmployees.map(employee => employee.reportingManagerId).filter(Boolean);
        const employeeIds = affectedEmployees.map(employee => employee.employeeId).filter(Boolean);
        const emails = affectedEmployees.map(employee => employee.email).filter(Boolean);
        const administratorAccounts = await User.find({
          isActive: true,
          $or: [
            { role: { $in: ['Admin', 'HR'] } },
            ...(accountIds.length ? [{ _id: { $in: accountIds } }] : []),
            ...(managerIds.length ? [{ _id: { $in: managerIds } }] : []),
            ...(employeeIds.length ? [{ employeeId: { $in: employeeIds } }] : []),
            ...(emails.length ? [{ email: { $in: emails } }] : []),
          ],
        }).select('_id role').lean();
        await Notification.insertMany(administratorAccounts.map(account => ({
          userId: account._id,
          title: 'Department updated',
          message: `Employee department assignments were synchronized to ${dept.name}.`,
          type: 'directory',
        })));
      } catch (error) {
        console.error(`[Department ${dept._id}] Hierarchy synchronization notification failed:`, error.message);
        warning = 'The department and employee records were updated, but some synchronization notifications could not be sent.';
      }
    }
    res.json({ success: true, data: dept, ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/departments/:id  (admin/HR)
// Prevents deletion when employees are still assigned — unless reassigned.
// ─────────────────────────────────────────────────────────────────────────────
const deleteDepartment = async (req, res) => {
  try {
    const dept = await Department.findById(req.params.id);
    if (!dept) return res.status(404).json({ success: false, message: 'Department not found' });

    const empCount = await Employee.countDocuments({ department: dept.name });
    if (empCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete "${dept.name}" — ${empCount} employee(s) are still assigned. Reassign them first.`,
        employeeCount: empCount,
      });
    }

    const roleCount = await Designation.countDocuments({ department: dept.name });
    if (roleCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete "${dept.name}" — ${roleCount} role / designation record(s) still reference it. Reassign or delete them first.`,
        designationCount: roleCount,
      });
    }

    // Safe — no employees reference this department
    await Department.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Department deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getDepartments, getDepartmentById, createDepartment, updateDepartment, deleteDepartment,
  getDesignations, createDesignation, updateDesignation, deleteDesignation,
};
