'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  shell,
  dialog,
  session,
  ipcMain,
  safeStorage
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const APP_TITLE = 'Mathletics Desktop';
const SESSION_PARTITION = 'persist:mathletics-auth';
const DEFAULT_START_URL = 'https://login.mathletics.com/';
const LOGIN_HOSTS = new Set(['login.mathletics.com']);
const ICON_PATH = path.join(__dirname, 'assets', 'icon.ico');

app.setName(APP_TITLE);
const STABLE_USER_DATA = path.join(app.getPath('appData'), 'Mathletics Desktop');
fs.mkdirSync(STABLE_USER_DATA, { recursive: true });
app.setPath('userData', STABLE_USER_DATA);

const CREDENTIALS_PATH = path.join(STABLE_USER_DATA, 'credentials.enc.json');
let mainWindow = null;
let credentialWindow = null;
let startUrl = DEFAULT_START_URL;

if (process.platform === 'win32') {
  app.setAppUserModelId('com.mathletics.multiverse.desktop');
}

function getWindowIcon() {
  return fs.existsSync(ICON_PATH) ? ICON_PATH : undefined;
}

function readConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    const candidate = new URL(config.startUrl);
    if (candidate.protocol === 'https:') startUrl = candidate.toString();
  } catch (error) {
    console.warn('No se pudo leer config.json; se usará el portal oficial.', error.message);
  }
}

function isHttpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; }
  catch { return false; }
}

function isAllowedLoginUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && LOGIN_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function assertCredentialEncryptionAvailable() {
  if (process.platform !== 'win32') {
    throw new Error('El guardado de credenciales está habilitado únicamente en Windows.');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows no ha habilitado el cifrado seguro de credenciales.');
  }
}

function saveEncryptedCredentials(username, password) {
  assertCredentialEncryptionAvailable();
  const data = {
    version: 1,
    username: safeStorage.encryptString(username).toString('base64'),
    password: safeStorage.encryptString(password).toString('base64')
  };
  const tempPath = `${CREDENTIALS_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data), { encoding: 'utf8' });
  fs.renameSync(tempPath, CREDENTIALS_PATH);
}

function readDecryptedCredentials() {
  assertCredentialEncryptionAvailable();
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;

  const data = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  if (data.version !== 1 || typeof data.username !== 'string' || typeof data.password !== 'string') {
    throw new Error('El archivo de credenciales tiene un formato no válido.');
  }

  return {
    username: safeStorage.decryptString(Buffer.from(data.username, 'base64')),
    password: safeStorage.decryptString(Buffer.from(data.password, 'base64'))
  };
}

function deleteEncryptedCredentials() {
  if (fs.existsSync(CREDENTIALS_PATH)) fs.unlinkSync(CREDENTIALS_PATH);
}

function openCredentialsWindow() {
  if (credentialWindow && !credentialWindow.isDestroyed()) {
    credentialWindow.focus();
    return;
  }

  credentialWindow = new BrowserWindow({
    width: 460,
    height: 540,
    minWidth: 420,
    minHeight: 500,
    resizable: false,
    title: 'Credenciales de Mathletics',
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#101321',
    icon: getWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'credentials-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  credentialWindow.once('ready-to-show', () => credentialWindow?.show());
  credentialWindow.on('closed', () => { credentialWindow = null; });
  credentialWindow.loadFile(path.join(__dirname, 'credentials.html'));
}

// Solo se permite guardar credenciales desde la ventana local de configuración.
ipcMain.handle('credentials:save', (event, payload) => {
  if (!credentialWindow || event.sender !== credentialWindow.webContents) {
    throw new Error('Solicitud no autorizada.');
  }
  const username = typeof payload?.username === 'string' ? payload.username.trim() : '';
  const password = typeof payload?.password === 'string' ? payload.password : '';
  if (!username || !password) throw new Error('Escribe tu usuario y contraseña.');
  if (username.length > 256 || password.length > 4096) throw new Error('Los datos superan el tamaño permitido.');

  saveEncryptedCredentials(username, password);
  credentialWindow.close();
  if (mainWindow && !mainWindow.isDestroyed()) autofillIfLoginPage(mainWindow.webContents);
  return { ok: true };
});

ipcMain.on('credentials:close', event => {
  if (credentialWindow && event.sender === credentialWindow.webContents) credentialWindow.close();
});

async function autofillIfLoginPage(webContents) {
  if (!webContents || webContents.isDestroyed() || !isAllowedLoginUrl(webContents.getURL())) return;

  let credentials;
  try {
    credentials = readDecryptedCredentials();
  } catch (error) {
    console.error('No se pudieron recuperar las credenciales cifradas:', error.message);
    return;
  }
  if (!credentials) return;

  // El script solo se ejecuta en login.mathletics.com. Rellena el formulario,
  // pero nunca lo envía automáticamente: el usuario confirma el inicio de sesión.
  const script = `(() => {
    if (window.__mathleticsDesktopAutofillStarted) return 'already-started';
    window.__mathleticsDesktopAutofillStarted = true;
    const savedUsername = ${JSON.stringify(credentials.username)};
    const savedPassword = ${JSON.stringify(credentials.password)};
    const isVisible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const setValue = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (setter) setter.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const fill = () => {
      const password = [...document.querySelectorAll('input[type="password"]')].find(isVisible);
      if (!password) return false;
      const form = password.form || password.closest('form') || document;
      const candidates = [...form.querySelectorAll('input:not([type]), input[type="text"], input[type="email"]')].filter(isVisible);
      const username = candidates.find(el => /user|email|login|account/i.test([el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute('aria-label')].join(' '))) || candidates[0];
      if (username && !username.value) setValue(username, savedUsername);
      if (!password.value) setValue(password, savedPassword);
      return true;
    };
    if (fill()) return 'filled';
    const observer = new MutationObserver(() => {
      if (fill()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 60000);
    return 'waiting-for-login-form';
  })()`;

  try {
    await webContents.executeJavaScript(script, true);
  } catch (error) {
    console.warn('No se pudo rellenar el formulario de Mathletics:', error.message);
  } finally {
    // Reduce el tiempo que la contraseña permanece en memoria del proceso principal.
    credentials.username = '';
    credentials.password = '';
  }
}

function createMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        { label: 'Recargar página', accelerator: 'F5', click: () => mainWindow?.webContents.reload() },
        { label: 'Recarga completa', accelerator: 'Ctrl+Shift+R', click: () => mainWindow?.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Salir', accelerator: 'Alt+F4', role: 'quit' }
      ]
    },
    {
      label: 'Cuenta',
      submenu: [
        { label: 'Guardar / actualizar credenciales…', click: openCredentialsWindow },
        {
          label: 'Eliminar credenciales guardadas…',
          click: async () => {
            const result = await dialog.showMessageBox(mainWindow, {
              type: 'warning',
              buttons: ['Cancelar', 'Eliminar'],
              defaultId: 0,
              cancelId: 0,
              title: 'Eliminar credenciales',
              message: '¿Eliminar el usuario y la contraseña guardados?',
              detail: 'Esto no cerrará necesariamente la sesión actual de Mathletics; solo elimina el archivo cifrado de esta aplicación.'
            });
            if (result.response === 1) {
              deleteEncryptedCredentials();
              dialog.showMessageBox(mainWindow, { type: 'info', message: 'Credenciales eliminadas.' });
            }
          }
        }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Pantalla completa', accelerator: 'F11', click: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
        { label: 'Aumentar zoom', accelerator: 'Ctrl+=', click: () => mainWindow?.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5) },
        { label: 'Reducir zoom', accelerator: 'Ctrl+-', click: () => mainWindow?.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 0.5) },
        { label: 'Restablecer zoom', accelerator: 'Ctrl+0', click: () => mainWindow?.webContents.setZoomLevel(0) },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' }
      ]
    },
    {
      label: 'Ayuda',
      submenu: [
        { label: 'Abrir Mathletics en el navegador', click: () => shell.openExternal(startUrl) },
        {
          label: 'Estado de sesión',
          click: () => {
            const authSession = session.fromPartition(SESSION_PARTITION);
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Estado de sesión',
              message: authSession.isPersistent() ? 'El perfil persistente está activado.' : 'El perfil no es persistente.',
              detail: `Perfil local: ${app.getPath('userData')}\nAlmacenamiento web: ${authSession.storagePath || 'No disponible'}\nArchivo de credenciales cifradas: ${fs.existsSync(CREDENTIALS_PATH) ? 'Existe' : 'No existe'}\n\nLa sesión web y las credenciales guardadas son mecanismos distintos. Mathletics puede caducar una sesión desde sus servidores.`
            });
          }
        },
        { label: 'Acerca de', click: () => dialog.showMessageBox(mainWindow, {
          type: 'info', title: APP_TITLE, message: APP_TITLE,
          detail: `Versión ${app.getVersion()}\nAplicación de escritorio no oficial. El inicio de sesión y el juego son proporcionados por Mathletics.`
        }) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: false,
    backgroundColor: '#101321',
    title: APP_TITLE,
    icon: getWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      partition: SESSION_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isHttpsUrl(url)) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1000,
        height: 760,
        autoHideMenuBar: true,
        icon: getWindowIcon(),
        webPreferences: {
          partition: SESSION_PARTITION,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false
        }
      }
    };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isHttpsUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isHttpsUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.on('did-finish-load', () => autofillIfLoginPage(mainWindow?.webContents));
  mainWindow.webContents.on('did-navigate-in-page', () => autofillIfLoginPage(mainWindow?.webContents));
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) console.error(`Error al cargar ${validatedURL}: ${errorDescription} (${errorCode})`);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(startUrl);
}

app.whenReady().then(() => {
  readConfig();
  createMenu();
  createWindow();

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    // Primera ejecución: ofrece guardar las credenciales, pero permite omitirlo.
    openCredentialsWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault());
});
