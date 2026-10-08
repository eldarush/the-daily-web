document.addEventListener('DOMContentLoaded', () => {
  const tempEl = document.getElementById('weather-temp');
  const descEl = document.getElementById('weather-desc');
  const cityEl = document.getElementById('weather-city');
  const iconEl = document.getElementById('weather-icon');
  const updatedEl = document.getElementById('weather-updated');
  const cacheStatusEl = document.getElementById('weather-cache-status');

  if (!tempEl) return;
  let expiresAt = 0;
  let expiryTimer;

  function showUnavailable() {
    tempEl.textContent = '—';
    if (descEl) descEl.textContent = 'Weather unavailable';
    if (cacheStatusEl) cacheStatusEl.textContent = 'Unavailable';
    if (updatedEl) updatedEl.textContent = '—';
  }

  async function loadWeather() {
    try {
      const response = await fetch('/api/weather', {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch weather');
      }

      const data = await response.json();
      expiresAt = new Date(data.observedAt).getTime() + 15 * 60 * 1000;
      const remaining = expiresAt - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('Weather expired');
      clearTimeout(expiryTimer);
      expiryTimer = setTimeout(() => { showUnavailable(); loadWeather(); }, remaining);

      if (tempEl) tempEl.textContent = `${data.temp}°C`;
      if (descEl) descEl.textContent = data.description;
      if (cityEl) cityEl.textContent = data.city;
      if (cacheStatusEl) {
        cacheStatusEl.textContent = data.cached ? 'Cached' : 'Updated';
      }

      if (iconEl) {
        iconEl.textContent = data.description || 'Current';
      }

      if (updatedEl) {
        const now = new Date(data.fetchedAt);
        updatedEl.dateTime = data.fetchedAt;
        updatedEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    } catch (err) {
      console.warn('[Weather Widget] Could not update weather:', err.message);
      showUnavailable();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() >= expiresAt) {
      showUnavailable();
      loadWeather();
    }
  });
  loadWeather();
  setInterval(loadWeather, 5 * 60 * 1000);
});
