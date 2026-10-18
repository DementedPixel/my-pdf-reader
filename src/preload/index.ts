import {contextBridge, ipcRenderer, webUtils} from 'electron';

export interface OpenedPdf {
  name: string;
  path: string;
  data: Uint8Array;
}

contextBridge.exposeInMainWorld('reader', {
  pick: (): Promise<OpenedPdf | null> => ipcRenderer.invoke('pdf:pick'),
  save: (path: string, data: Uint8Array): Promise<void> =>
    ipcRenderer.invoke('pdf:save', path, data),
  saveAs: (name: string, data: Uint8Array): Promise<{name: string; path: string} | null> =>
    ipcRenderer.invoke('pdf:save-as', name, data),
  setDirty: (v: boolean) => ipcRenderer.send('app:dirty', v),
  closeNow: () => ipcRenderer.send('app:close-now'),
  onCloseRequested: (cb: () => void) => {
    ipcRenderer.on('app:close-requested', cb);
    return () => ipcRenderer.removeListener('app:close-requested', cb);
  },
  pathForFile: (f: File) => webUtils.getPathForFile(f),
  onOpen: (cb: (pdf: OpenedPdf) => void) => {
    const h = (_e: unknown, pdf: OpenedPdf) => cb(pdf);
    ipcRenderer.on('pdf:open', h);
    return () => ipcRenderer.removeListener('pdf:open', h);
  },
});
