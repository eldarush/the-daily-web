/* Editor-only account creation; authorization and password hashing stay on the server. */
(function () {
  'use strict';

  const toggle = document.getElementById('add-user');
  const panel = document.getElementById('create-user-panel');
  const form = document.getElementById('create-user-form');
  if (!toggle || !panel || !form) return;

  const username = document.getElementById('create-user-username');
  const fullName = document.getElementById('create-user-full-name');
  const password = document.getElementById('create-user-password');
  const role = document.getElementById('create-user-role');
  const status = document.getElementById('create-user-status');
  const signIn = document.getElementById('create-user-login');
  const cancel = document.getElementById('cancel-create-user');
  let pending = false;

  function closeForm() {
    if (pending) return;
    form.reset();
    password.value = '';
    status.textContent = '';
    signIn.hidden = true;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  }

  function setPending(value) {
    pending = value;
    toggle.disabled = value;
    form.setAttribute('aria-busy', String(value));
    Array.from(form.elements).forEach(function (control) { control.disabled = value; });
  }

  toggle.addEventListener('click', function () {
    if (pending) return;
    if (!panel.hidden) return closeForm();
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    username.focus();
  });
  cancel.addEventListener('click', closeForm);
  panel.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !pending) {
      event.preventDefault();
      closeForm();
    }
  });

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (pending) return;
    signIn.hidden = true;
    const data = {
      username: username.value.trim(),
      fullName: fullName.value.trim(),
      password: password.value,
      role: role.value
    };
    if (data.username.length < 3) {
      status.textContent = 'Username must contain at least 3 characters.';
      username.focus();
      return;
    }
    if (!data.fullName) {
      status.textContent = 'Full name is required.';
      fullName.focus();
      return;
    }
    if (!data.password.trim() || data.password.length < 6) {
      status.textContent = 'Password must contain at least 6 characters.';
      password.focus();
      return;
    }
    if (!['reporter', 'editor'].includes(data.role) || !form.reportValidity()) return;

    // Hold the submitted snapshot fixed; repeated clicks/Enter cannot send a second POST.
    setPending(true);
    status.textContent = 'Creating user…';
    let created = false;
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const body = await response.json().catch(function () { return {}; });
      if (response.status === 401 || response.status === 403) {
        password.value = '';
        signIn.hidden = response.status !== 401;
        status.textContent = response.status === 401
          ? 'Your session has expired. Sign in to continue.'
          : 'Only editors can create users. Your permissions may have changed.';
        return;
      }
      if (!response.ok) {
        status.textContent = typeof body?.error === 'string' ? body.error : 'Could not create the user. Please retry.';
        return;
      }
      form.reset();
      password.value = '';
      // Treat usernames and API errors as plain text, never as HTML.
      status.textContent = 'User "' + data.username + '" created successfully (' + data.role + ').';
      created = true;
    } catch (error) {
      status.textContent = 'Could not create the user. Check your connection and retry.';
    } finally {
      setPending(false);
      if (created) username.focus();
    }
  });
})();
