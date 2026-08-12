import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import { autoUpdater } from 'electron-updater';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const reminders = new Map();

let mainWindow;
let tray;
let quitting = false;
let updateCheckTimer;
let updateCheckInFlight = false;

function showWindow(route = '/') {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('desktop:route', route);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 600,
    title: 'Bullets',
    backgroundColor: '#f7f5f2',
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (rendererUrl) void mainWindow.loadURL(rendererUrl);
  else void mainWindow.loadFile(path.join(here, '..', 'dist', 'index.html'));

  mainWindow.on('close', event => {
    // Closing a menu-bar app should clear the desk, not turn off reminders.
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function menuTemplate() {
  return [
    { label: 'Open Bullets', click: () => showWindow('/') },
    { label: 'Quick capture', click: () => showWindow('/capture') },
    { label: 'Check for updates…', click: () => void checkForUpdates() },
    { type: 'separator' },
    { label: 'Quit Bullets', accelerator: 'Command+Q', click: () => app.quit() },
  ];
}

function checkForUpdates() {
  if (!app.isPackaged || updateCheckInFlight) return Promise.resolve();
  updateCheckInFlight = true;
  return autoUpdater.checkForUpdates().catch(error => {
    // An update check must not crash the menu-bar app. The error is still
    // deliberately visible in the app log if its release feed is broken.
    console.error('Bullets update check failed:', error);
  }).finally(() => {
    updateCheckInFlight = false;
  });
}

function startUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', error => console.error('Bullets updater error:', error));
  autoUpdater.on('update-downloaded', info => {
    const notification = new Notification({
      title: 'Bullets update ready',
      body: `Version ${info.version} has downloaded. Click to restart and install it.`,
    });
    notification.on('click', () => {
      quitting = true;
      autoUpdater.quitAndInstall();
    });
    notification.show();
  });

  void checkForUpdates();
  updateCheckTimer = setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(here, 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Bullets');
  // macOS status items conventionally reveal their menu when clicked. Building
  // it at click time keeps the Show/Quick capture actions responsive after the
  // window has been hidden for a while.
  tray.on('click', () => tray?.popUpContextMenu(Menu.buildFromTemplate(menuTemplate())));
}

function notify(reminder) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: reminder.title, body: reminder.body });
  notification.on('click', () => showWindow(reminder.route));
  notification.on('failed', (_event, error) => {
    console.error('Bullets huddle notification failed:', error);
  });
  notification.show();
}

function arm(reminder) {
  const wait = reminder.at - Date.now();
  // Node cannot accept a timeout longer than a signed 32-bit integer. Re-arm
  // long-range huddles instead of accidentally firing their reminder at once.
  const delay = Math.max(0, Math.min(wait, 2_147_000_000));
  const timer = setTimeout(() => {
    if (reminder.at > Date.now()) {
      arm(reminder);
      return;
    }
    reminders.delete(reminder.id);
    notify(reminder);
  }, delay);
  reminders.set(reminder.id, timer);
}

function replaceReminders(next) {
  for (const timer of reminders.values()) clearTimeout(timer);
  reminders.clear();
  for (const reminder of next) arm(reminder);
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  startUpdater();

  const appMenu = Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]);
  Menu.setApplicationMenu(appMenu);

  app.on('activate', () => showWindow('/'));
});

app.on('before-quit', () => {
  quitting = true;
  if (updateCheckTimer) clearInterval(updateCheckTimer);
});

ipcMain.handle(
  'desktop:notifications-supported',
  () => Notification.isSupported(),
);
ipcMain.handle('desktop:schedule-notifications', (_event, next) => {
  if (!Array.isArray(next)) return;
  const safe = next.filter(
    item =>
      item &&
      typeof item.id === 'number' &&
      typeof item.title === 'string' &&
      typeof item.body === 'string' &&
      typeof item.route === 'string' &&
      typeof item.at === 'number' &&
      Number.isFinite(item.at),
  );
  replaceReminders(safe);
});
