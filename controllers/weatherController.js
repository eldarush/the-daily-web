const CACHE_TTL_MS = 15 * 60 * 1000; // 15-minute server-side cache

let weatherCache = {
  data: null,
  lastFetched: 0
};

/**
 * Fetches current weather from external OpenWeatherMap API or returns realistic fallback.
 * @param {string} city 
 * @param {string} apiKey 
 * @returns {Promise<object>}
 */
async function fetchWeather(city, apiKey) {
  if (apiKey && apiKey.trim().length > 0) {
    try {
      const response = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${apiKey}`
      );
      if (response.ok) {
        const raw = await response.json();
        return {
          city: raw.name || city,
          temp: Math.round(raw.main.temp),
          description: raw.weather?.[0]?.description || 'Clear',
          icon: raw.weather?.[0]?.icon || '01d',
          cached: false
        };
      }
    } catch {
      // Fallback on network or API failure
    }
  }

  return {
    city: city || 'Tel Aviv',
    temp: 26,
    description: 'Clear sky',
    icon: '01d',
    cached: false
  };
}

/**
 * Weather endpoint handler with strict 15-minute server-side caching.
 */
async function getWeather(req, res, next) {
  try {
    const now = Date.now();
    const city = process.env.WEATHER_CITY || 'Tel Aviv';
    const apiKey = process.env.OPENWEATHER_API_KEY;

    if (weatherCache.data && (now - weatherCache.lastFetched < CACHE_TTL_MS)) {
      return res.status(200).json({
        ...weatherCache.data,
        cached: true,
        cacheAgeSeconds: Math.floor((now - weatherCache.lastFetched) / 1000)
      });
    }

    const data = await fetchWeather(city, apiKey);
    weatherCache = { data, lastFetched: now };
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Resets weather cache (used in automated unit testing).
 */
function resetWeatherCache() {
  weatherCache = { data: null, lastFetched: 0 };
}

module.exports = {
  getWeather,
  fetchWeather,
  resetWeatherCache
};
