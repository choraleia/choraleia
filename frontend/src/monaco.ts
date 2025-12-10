import { loader } from "@monaco-editor/react";
import type { Environment } from "monaco-editor";

declare global {
  interface Window {
    MonacoEnvironment?: Environment;
  }
}

loader.config({ paths: { vs: "/monaco/vs" } });

const workerPaths: Record<string, string> = {
  json: "language/json/json.worker",
  css: "language/css/css.worker",
  scss: "language/css/css.worker",
  less: "language/css/css.worker",
  html: "language/html/html.worker",
  handlebars: "language/html/html.worker",
  razor: "language/html/html.worker",
  typescript: "language/typescript/ts.worker",
  javascript: "language/typescript/ts.worker",
};

const monacoEnv: Environment = window.MonacoEnvironment ?? {};
monacoEnv.getWorkerUrl = (_moduleId, label) => {
  const workerPath = workerPaths[label] || "editor/editor.worker";
  const base = window.MonacoEnvironment?.baseUrl ?? "";
  return `${base}/monaco/vs/${workerPath}.js`;
};
window.MonacoEnvironment = monacoEnv;

export {};
