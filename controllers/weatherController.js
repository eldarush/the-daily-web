// In-memory weather cache object to enforce max 15-minute delay
let weatherCache = {
  data: null,
  lastFetched: 0
};

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Returns weather data with strict server-side caching (max 15-min TTL).
 * Does not call external API more than once every 15 minutes.
 */
async function getWeather(req, res, next) {
  try {
    const now = Date.now();
    const city = process.env.WEATHER_CITY || 'Tel Aviv';
    const apiKey = process.env.OPENWEATHER_API_KEY;

    // Check if cache is still fresh (< 15 minutes)
    if (weatherCache.data && (now - weatherCache.lastFetched < CACHE_TTL_MS)) {
      return res.status(200).json({
        ...weatherCache.data,
        cached: true,
        cacheAgeSeconds: Math.floor((now - weatherCache.lastFetched) / 1000)
      });
    }

    // Try fetching from OpenWeatherMap if API key is provided
    if (apiKey && apiKey.trim().length > 0) {
      try {
        const response = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${apiKey}`
        );

        if (response.ok) {
          const raw = await response.json();
          const weatherPayload = {
            city: raw.name,
            temp: Math.round(raw.main.temp),
            feelsLike: Math.round(raw.main.feels_like),
            description: raw.weather[0]?.description || 'Clear',
            icon: raw.weather[0]?.icon || '01d',
            humidity: raw.main.humidity,
            windSpeed: raw.wind?.speed || 0,
            lastUpdated: new Date()
          };

          weatherCache = {
            data: weatherPayload,
            lastFetched: now
          };

          return res.status(200).json({
            ...weatherPayload,
            cached: false
          });
        }
      } catch (externalErr) {
        console.warn('[Weather] External fetch failed, falling back to cached/default data:', externalErr.message);
      }
    }

    // Fallback data when API key is not set or fetch failed
    const fallbackPayload = {
      city: city,
      temp: 26,
      feelsLike: 27,
      description: 'Clear sky',
      icon: '01d',
      humidity: 58,
      windSpeed: 3.6,
      lastUpdated: new Date()
    };

    weatherCache = {
      data: fallbackPayload,
      lastFetched: now
    };

    return res.status(200).json({
      ...fallbackPayload,
      cached: false
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Resets the weather cache (primarily for unit testing).
 */
function resetWeatherCache() {
  weatherCache = { data: null, lastFetched: 0 };
}

module.exports = {
  getWeather,
  resetWeatherCache
};
