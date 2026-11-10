'use strict';

const form = document.getElementById('form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const status = document.getElementById('status');
const saveButton = document.getElementById('save');

form.addEventListener('submit', async event => {
  event.preventDefault();
  saveButton.disabled = true;
  status.textContent = 'Cifrando y guardando…';

  try {
    await window.credentialStore.save(usernameInput.value, passwordInput.value);
    status.textContent = 'Credenciales guardadas de forma cifrada.';
    passwordInput.value = '';
  } catch (error) {
    status.textContent = error?.message || 'No se pudieron guardar las credenciales.';
    saveButton.disabled = false;
  }
});

document.getElementById('skip').addEventListener('click', () => {
  passwordInput.value = '';
  window.credentialStore.close();
});
