/**
 * External weather API routes.
 * Exposes /api/weather endpoint with 15-minute server-side caching.
 */
const express = require('express');
const router = express.Router();
const weatherController = require('../../controllers/weatherController');

router.get('/', weatherController.getWeather);

module.exports = router;
