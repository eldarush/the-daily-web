const express = require('express');
const router = express.Router();
const userController = require('../../controllers/userController');
const { requireAuth } = require('../../middlewares/auth');
const { requireRole } = require('../../middlewares/rbac');

// All user management routes require Editor privileges
router.use(requireAuth);
router.use(requireRole('editor'));

router.get('/', userController.listUsers);
router.get('/:id', userController.getUserById);
router.post('/', userController.createUser);
router.put('/:id', userController.updateUser);
router.delete('/:id', userController.deleteUser);

module.exports = router;
