import { loader } from "@monaco-editor/react";
import type { Environment } from "monaco-editor";

declare global {
  interface Window {
    MonacoEnvironment?: Environment;
  }
}

// Setup MonacoEnvironment before loader.config
// Monaco min version uses workerMain.js for all workers
window.MonacoEnvironment = {
  getWorkerUrl: () => {
    return `/monaco/vs/base/worker/workerMain.js`;
  },
};

loader.config({ paths: { vs: "/monaco/vs" } });


export {};
