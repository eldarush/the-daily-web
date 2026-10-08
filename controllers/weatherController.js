const CACHE_TTL_MS = 15 * 60 * 1000;
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

async function fetchWeather(city = 'Tel Aviv') {
  const latitude = process.env.WEATHER_LATITUDE || '32.0853';
  const longitude = process.env.WEATHER_LONGITUDE || '34.7818';
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

async function getWeather(req, res) {
  const now = Date.now();
  if (weatherCache.data && now - weatherCache.lastFetched < CACHE_TTL_MS &&
      now - new Date(weatherCache.data.observedAt).getTime() < CACHE_TTL_MS) {
    return res.status(200).json({ ...weatherCache.data, cached: true });
  }
  try {
    // Concurrent readers share the same refresh.
    if (!inFlight) {
      inFlight = fetchWeather(process.env.WEATHER_CITY || 'Tel Aviv')
        .then(data => { weatherCache = { data, lastFetched: Date.now() }; return data; })
        .finally(() => { inFlight = null; });
    }
    const data = await inFlight;
    return res.status(200).json({ ...data, cached: false });
  } catch (err) {
    console.error('Weather refresh failed:', err.message);
    return res.status(503).json({ error: 'Weather unavailable' });
  }
}

function resetWeatherCache() {
  weatherCache = { data: null, lastFetched: 0 };
  inFlight = null;
}

module.exports = { fetchWeather, getWeather, resetWeatherCache };
