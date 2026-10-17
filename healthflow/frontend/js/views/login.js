import { login } from '../auth.js';
import { navigate } from '../router.js';
import { html, mount, formValues, setBusy, setPage, toast, icon } from '../ui.js';

export default function loginView({ outlet }) {
  setPage('');

  mount(
    outlet,
    html`<div class="login">
      <div class="login__panel">
        <aside class="login__aside" aria-hidden="true">
          <div class="login__aside-inner">
            <span class="login__aside-mark">${icon('heart-pulse', { size: 34 })}</span>
            <p class="login__aside-title">HealthFlow</p>
            <p class="login__aside-tag">Clinic flow, live.</p>
            <ul class="login__aside-list">
              <li>${icon('queue', { size: 18 })} Real-time queue &amp; room routing</li>
              <li>${icon('appointments', { size: 18 })} Appointments without double-booking</li>
              <li>${icon('bill', { size: 18 })} Billing &amp; daily reports in one place</li>
            </ul>
          </div>
          <p class="login__aside-foot">Trusted by front desks that move fast.</p>
        </aside>

        <div class="login__card">
          <p class="login__brand">${icon('heart-pulse', { size: 24 })} HealthFlow</p>
          <h1 class="login__title">Sign in</h1>
          <p class="login__hint">Use your clinic account to continue.</p>

          <form id="login-form" novalidate>
            <div class="field">
              <label for="email">Email</label>
              <div class="input-affix">
                <span class="input-affix__icon" aria-hidden="true">${icon('mail', { size: 18 })}</span>
                <input id="email" name="email" type="email" autocomplete="username"
                  required autofocus placeholder="you@clinic.example" />
              </div>
            </div>
            <div class="field">
              <label for="password">Password</label>
              <div class="input-affix">
                <span class="input-affix__icon" aria-hidden="true">${icon('lock', { size: 18 })}</span>
                <input id="password" name="password" type="password" autocomplete="current-password"
                  required placeholder="••••••••" />
                <button type="button" class="input-affix__btn" id="toggle-password"
                  aria-label="Show password" aria-pressed="false">${icon('eye', { size: 18 })}</button>
              </div>
            </div>
            <p id="login-error" class="form-error" role="alert" hidden></p>
            <button class="btn btn--primary btn--block" type="submit" id="login-submit">
              ${icon('log-in', { size: 18 })} Sign in
            </button>
          </form>

          <p class="login__foot">HealthFlow clinic management · v1.0</p>
        </div>
      </div>
    </div>`
  );

  const form = outlet.querySelector('#login-form');
  const errorBox = outlet.querySelector('#login-error');
  const submit = outlet.querySelector('#login-submit');
  const passwordInput = outlet.querySelector('#password');
  const toggle = outlet.querySelector('#toggle-password');

  toggle.addEventListener('click', () => {
    const showing = passwordInput.type === 'text';
    passwordInput.type = showing ? 'password' : 'text';
    toggle.innerHTML = String(showing ? icon('eye', { size: 18 }) : icon('eye-off', { size: 18 }));
    toggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    toggle.setAttribute('aria-pressed', String(!showing));
    passwordInput.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;

    const { email, password } = formValues(form);
    if (!email || !password) {
      errorBox.textContent = 'Enter your email and password.';
      errorBox.hidden = false;
      (email ? form.elements.password : form.elements.email).focus();
      return;
    }

    setBusy(submit, true, 'Signing in…');
    try {
      const user = await login(email, password);
      toast(`Welcome back, ${user.full_name}.`, 'success');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      errorBox.textContent = err.isAuthError ? 'Invalid email or password.' : err.message;
      errorBox.hidden = false;
      form.elements.password.value = '';
      form.elements.email.focus();
    } finally {
      setBusy(submit, false);
    }
  });

  return null;
}
