import {contextBridge, ipcRenderer, webUtils} from 'electron';

export interface OpenedPdf {
  name: string;
  path: string;
  data: Uint8Array;
}

contextBridge.exposeInMainWorld('reader', {
  pick: (): Promise<OpenedPdf | null> => ipcRenderer.invoke('pdf:pick'),
  saveAs: (name: string, data: Uint8Array): Promise<boolean> =>
    ipcRenderer.invoke('pdf:save-as', name, data),
  pathForFile: (f: File) => webUtils.getPathForFile(f),
  onOpen: (cb: (pdf: OpenedPdf) => void) => {
    const h = (_e: unknown, pdf: OpenedPdf) => cb(pdf);
    ipcRenderer.on('pdf:open', h);
    return () => ipcRenderer.removeListener('pdf:open', h);
  },
});
