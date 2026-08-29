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

      if (iconEl) {
        iconEl.textContent = data.description || 'Current';
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
  setInterval(loadWeather, 5 * 60 * 1000);
});
