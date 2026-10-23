const express = require('express');
const router = express.Router();
const userController = require('../../controllers/userController');
const { requireRole } = require('../../middlewares/rbac');

// requireRole also turns guests away with 401, so no separate requireAuth is needed.
router.use(requireRole('editor'));

router.get('/', userController.listUsers);
router.get('/:id', userController.getUserById);
router.post('/', userController.createUser);
router.put('/:id', userController.updateUser);
router.delete('/:id', userController.deleteUser);

module.exports = router;
