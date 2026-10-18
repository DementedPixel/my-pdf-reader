import {readFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {app, BrowserWindow, dialog, ipcMain, session} from 'electron';

interface OpenedPdf {
  name: string;
  path: string;
  data: Uint8Array;
}

let win: BrowserWindow | null = null;

const pdfArg = (argv: string[]) => argv.slice(1).find(a => a.toLowerCase().endsWith('.pdf'));

async function load(path: string): Promise<OpenedPdf> {
  const buf = await readFile(path);
  return {name: basename(path), path, data: new Uint8Array(buf)};
}

async function sendOpen(path: string) {
  try {
    win?.webContents.send('pdf:open', await load(path));
  } catch (e) {
    dialog.showErrorBox('Could not open file', String(e));
  }
}

// The reader is fully offline: refuse every request that leaves the machine.
function blockNetwork() {
  session.defaultSession.webRequest.onBeforeRequest(
    {urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']},
    (details, cb) => {
      const host = new URL(details.url).hostname;
      cb({cancel: !(host === 'localhost' || host === '127.0.0.1')});
    },
  );
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 850,
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', e => e.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
  const initial = pdfArg(process.argv);
  if (initial) win.webContents.once('did-finish-load', () => sendOpen(initial));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
    const p = pdfArg(argv);
    if (p) sendOpen(p);
  });

  ipcMain.handle('pdf:pick', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{name: 'PDF', extensions: ['pdf']}],
    });
    return r.canceled || !r.filePaths[0] ? null : load(r.filePaths[0]);
  });

  ipcMain.handle('pdf:save-as', async (_e, name: string, data: Uint8Array) => {
    const r = await dialog.showSaveDialog({
      defaultPath: name,
      filters: [{name: 'PDF', extensions: ['pdf']}],
    });
    if (r.canceled || !r.filePath) return false;
    const {writeFile} = await import('node:fs/promises');
    await writeFile(r.filePath, data);
    return true;
  });

  app.whenReady().then(() => {
    blockNetwork();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
