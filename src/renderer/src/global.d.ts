interface OpenedPdf {
  name: string;
  path: string;
  data: Uint8Array;
}

interface Window {
  reader: {
    pick(): Promise<OpenedPdf | null>;
    save(path: string, data: Uint8Array): Promise<void>;
    saveAs(name: string, data: Uint8Array): Promise<{name: string; path: string} | null>;
    setDirty(v: boolean): void;
    closeNow(): void;
    onCloseRequested(cb: () => void): () => void;
    pathForFile(f: File): string;
    onOpen(cb: (pdf: OpenedPdf) => void): () => void;
  };
}
