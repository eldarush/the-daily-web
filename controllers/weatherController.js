const { writeLog } = require('../config/logger');
const CACHE_TTL_MS = 15 * 60 * 1000;
// These module variables belong to one Node process, not MongoDB or all replicas.
// lastFetched measures our refresh; observedAt measures the provider observation.
let weatherCache = { data: null, lastFetched: 0 };
let inFlight = null;

function describeWeather(code) {
  if (code === 0) return 'Clear sky';
  if (code <= 3) return 'Cloudy';
  if (code <= 48) return 'Fog';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorm';
}

// The only external API: Open-Meteo (free, no API key, so there is no secret to protect).
// The server calls it, not the browser, so we can cache one answer for all readers.
async function fetchWeather(city = 'Tel Aviv') {
  // city labels the result; coordinates select the location. Changing the city
  // label alone does not geocode a new place.
  const latitude = process.env.WEATHER_LATITUDE || '32.0853';
  const longitude = process.env.WEATHER_LONGITUDE || '34.7818';
  // Give up after 10 seconds so a slow provider can't hang our request.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(latitude) +
      '&longitude=' + encodeURIComponent(longitude) +
      '&current=temperature_2m,weather_code&timeformat=unixtime&forecast_days=1',
      { signal: controller.signal }
    );
    if (!response.ok) throw new Error('Weather provider unavailable');
    const raw = await response.json();
    const current = raw.current;
    if (!current || !Number.isFinite(current.temperature_2m) ||
        !Number.isInteger(current.weather_code) || !Number.isFinite(current.time)) {
      throw new Error('Invalid weather response');
    }
    const observedAt = current.time * 1000;
    if (observedAt > Date.now() || Date.now() - observedAt >= CACHE_TTL_MS) {
      throw new Error('Weather observation is out of date');
    }
    return {
      city, temp: Math.round(current.temperature_2m),
      description: describeWeather(current.weather_code),
      observedAt: new Date(observedAt).toISOString(),
      fetchedAt: new Date().toISOString()
    };
  } finally {
    clearTimeout(timer);
  }
}

// GET /api/weather: serve the cached answer while it is under 15 minutes old, otherwise refresh.
async function getWeather(req, res) {
  const now = Date.now();
  // A recent fetch can contain an older observation. Both ages must be fresh;
  // this is request-driven caching, not a fixed fifteen-minute background job.
  if (weatherCache.data && now - weatherCache.lastFetched < CACHE_TTL_MS &&
      now - new Date(weatherCache.data.observedAt).getTime() < CACHE_TTL_MS) {
    return res.status(200).json({ ...weatherCache.data, cached: true });
  }
  try {
    // Concurrent readers share the same refresh.
    if (!inFlight) {
      inFlight = fetchWeather(process.env.WEATHER_CITY || 'Tel Aviv')
        .then(data => { weatherCache = { data, lastFetched: Date.now() }; return data; })
        // Clear on failure as well as success so later callers can retry.
        .finally(() => { inFlight = null; });
    }
    const data = await inFlight;
    return res.status(200).json({ ...data, cached: false });
  } catch (err) {
    writeLog('weather.refresh.failed', { level: 'warn', errorType: err.name || 'Error' });
    return res.status(503).json({ error: 'Weather unavailable' });
  }
}

function resetWeatherCache() {
  weatherCache = { data: null, lastFetched: 0 };
  inFlight = null;
}

module.exports = { fetchWeather, getWeather, resetWeatherCache };
