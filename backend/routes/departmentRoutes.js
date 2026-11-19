const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { checkAction, checkPermissionOrAction } = require('../middleware/checkPermission');
const {
  getDepartments, getDepartmentById, createDepartment, updateDepartment, deleteDepartment,
  getDesignations, createDesignation, updateDesignation, deleteDesignation,
} = require('../controllers/departmentController');

router.use(protect);

// Reads stay open to any authenticated user: department lists feed form dropdowns
// (e.g. Add Employee) across the app regardless of the Departments module toggle.
router.route('/')
  .get(getDepartments)
  .post(checkAction('departments', 'add'), createDepartment);

router.get('/roles', getDesignations);
router.post('/roles', checkPermissionOrAction('departments.roles', 'departments', 'add'), createDesignation);
router.put('/roles/:id', checkPermissionOrAction('departments.roles', 'departments', 'edit'), updateDesignation);
router.delete('/roles/:id', checkPermissionOrAction('departments.roles', 'departments', 'delete'), deleteDesignation);

router.route('/:id')
  .get(getDepartmentById)
  .put(checkAction('departments', 'edit'), updateDepartment)
  .delete(checkAction('departments', 'delete'), deleteDepartment);

module.exports = router;
