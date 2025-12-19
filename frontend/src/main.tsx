import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import App from "./App";
import { lightTheme, darkTheme } from "./themes";
import { getApiBaseAsync } from "./api/base";

const Root = () => {
  const getPrefersDark = () =>
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const [isDark, setIsDark] = useState(getPrefersDark());
  const [runtimeReady, setRuntimeReady] = useState(
    typeof window === "undefined" || window.location?.protocol !== "wails:",
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const maybeInit = async () => {
      if (typeof window === "undefined") return;
      if (window.location?.protocol !== "wails:") return;

      // Warm up runtime discovery so early fetch calls use http://127.0.0.1:PORT
      // instead of producing wails://api/... URLs.
      await getApiBaseAsync();
      if (!cancelled) setRuntimeReady(true);
    };

    void maybeInit();
    return () => {
      cancelled = true;
    };
  }, []);

  const theme = isDark ? darkTheme : lightTheme;

  if (!runtimeReady) {
    // Keep it simple: avoid rendering anything that might fire fetches.
    return null;
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
