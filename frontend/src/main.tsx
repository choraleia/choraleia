import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import App from "./App";
import { lightTheme, darkTheme } from "./themes";
import { WorkspaceProvider } from "./state/workspaces";

const Root = () => {
  const getPrefersDark = () =>
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const [isDark, setIsDark] = useState(getPrefersDark());

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const theme = isDark ? darkTheme : lightTheme;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </ThemeProvider>
  );
};

const container = document.getElementById("root") as HTMLElement;
const root = ReactDOM.createRoot(container);

if (import.meta.env.DEV) {
  root.render(<Root />);
} else {
  root.render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
}
