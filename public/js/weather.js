/**
 * Weather Widget Client Poller (Pure Vanilla JS).
 * Fetches server-cached weather data from /api/weather without full page reload.
 */
document.addEventListener('DOMContentLoaded', () => {
  const tempEl = document.getElementById('weather-temp');
  const descEl = document.getElementById('weather-desc');
  const cityEl = document.getElementById('weather-city');
  const iconEl = document.getElementById('weather-icon');
  const updatedEl = document.getElementById('weather-updated');
  const cacheStatusEl = document.getElementById('weather-cache-status');

  if (!tempEl) return;

  async function loadWeather() {
    try {
      const response = await fetch('/api/weather', {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch weather');
      }

      const data = await response.json();

      if (tempEl) tempEl.textContent = `${data.temp}°C`;
      if (descEl) descEl.textContent = data.description;
      if (cityEl) cityEl.textContent = data.city;
      if (cacheStatusEl) {
        cacheStatusEl.textContent = data.cached ? 'Cached (15m)' : 'Live Update';
      }

      // Map icon to emoji if needed
      if (iconEl) {
        const iconCode = data.icon || '01d';
        let emoji = '🌤️';
        if (iconCode.startsWith('01')) emoji = '☀️';
        else if (iconCode.startsWith('02')) emoji = '⛅';
        else if (iconCode.startsWith('03') || iconCode.startsWith('04')) emoji = '☁️';
        else if (iconCode.startsWith('09') || iconCode.startsWith('10')) emoji = '🌧️';
        else if (iconCode.startsWith('11')) emoji = '⛈️';
        else if (iconCode.startsWith('13')) emoji = '❄️';
        else if (iconCode.startsWith('50')) emoji = '🌫️';
        iconEl.textContent = emoji;
      }

      if (updatedEl) {
        const now = new Date();
        updatedEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    } catch (err) {
      console.warn('[Weather Widget] Could not update weather:', err.message);
      if (descEl) descEl.textContent = 'Weather unavailable';
    }
  }

  loadWeather();
  // Poll periodically every 5 minutes (well within 15-minute server cache)
  setInterval(loadWeather, 5 * 60 * 1000);
});
