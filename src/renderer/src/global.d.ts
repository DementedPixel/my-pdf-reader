interface OpenedPdf {
  name: string;
  path: string;
  data: Uint8Array;
}

interface Window {
  reader: {
    pick(): Promise<OpenedPdf | null>;
    saveAs(name: string, data: Uint8Array): Promise<boolean>;
    pathForFile(f: File): string;
    onOpen(cb: (pdf: OpenedPdf) => void): () => void;
  };
}
