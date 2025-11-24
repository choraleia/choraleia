import { createTheme } from "@mui/material/styles";

// Light theme configuration
export const lightTheme = createTheme({
  // Disable global transition durations
  transitions: {
    create: () => "none",
    duration: {
      shortest: 0,
      shorter: 0,
      short: 0,
      standard: 0,
      complex: 0,
      enteringScreen: 0,
      leavingScreen: 0,
    },
    easing: {
      easeInOut: "linear",
      easeOut: "linear",
      easeIn: "linear",
      sharp: "linear",
    },
  },
  palette: {
    mode: "light",
    // Primary color changed to dark gray
    primary: { main: "#262626" },
    success: { main: "#52c41a" },
    warning: { main: "#faad14" },
    error: { main: "#ff4d4f" },
    // Info color set to lighter gray for consistency
    info: { main: "#595959" },
    background: { default: "#f0f2f5", paper: "#ffffff" },
    text: { primary: "rgba(0,0,0,0.88)", secondary: "rgba(0,0,0,0.65)" },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily:
      '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif',
    fontSize: 12,
  },
  components: {
    // Global CSS overrides: disable animations & transitions
    MuiCssBaseline: {
      styleOverrides: {
        "*,*::before,*::after": {
          animation: "none !important",
          transition: "none !important",
        },
        html: { scrollBehavior: "auto" },
        body: { animation: "none !important" },
      },
    },
    MuiButton: {
      defaultProps: {
        size: "small",
        disableRipple: true,
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          textTransform: "none",
          padding: "4px 12px",
          minHeight: 32,
          transition: "none",
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 36, transition: "none" },
        indicator: { transition: "none" },
      },
    },
    MuiTextField: {
      defaultProps: { size: "small", margin: "dense", variant: "outlined" },
    },
    MuiSelect: {
      defaultProps: { size: "small" },
      styleOverrides: { root: { fontSize: 12 }, select: { fontSize: 12 } },
    },
    MuiAutocomplete: { defaultProps: { size: "small" } },
    MuiSwitch: { defaultProps: { size: "small" } },
    MuiCheckbox: { defaultProps: { size: "small", disableRipple: true } },
    MuiRadio: { defaultProps: { size: "small", disableRipple: true } },
    MuiIconButton: {
      defaultProps: { size: "small", disableRipple: true },
      styleOverrides: { root: { padding: 4, transition: "none" } },
    },
    MuiTab: {
      defaultProps: { iconPosition: "start", disableRipple: true },
      styleOverrides: {
        root: { minHeight: 36, padding: "6px 12px", transition: "none", textTransform: 'none' },
      },
    },
    MuiDialogTitle: { styleOverrides: { root: { padding: "12px 16px" } } },
    MuiDialogContent: { styleOverrides: { root: { padding: "12px 16px" } } },
    MuiDialogActions: { styleOverrides: { root: { padding: "8px 16px" } } },
    MuiFormLabel: { styleOverrides: { root: {} } },
    MuiInputLabel: {
      styleOverrides: {
        root: { transform: "translate(14px, 10px) scale(1)" },
        shrink: { transform: "translate(14px, -6px) scale(0.85)" },
      },
    },
    MuiChip: {
      defaultProps: { size: "small" },
      styleOverrides: {
        root: { height: 24 },
        label: { paddingLeft: 6, paddingRight: 6 },
      },
    },
    MuiAlert: {
      defaultProps: { variant: "outlined" },
      styleOverrides: { root: { padding: "4px 8px" } },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          minHeight: 32,
          paddingTop: 4,
          paddingBottom: 4,
          transition: "none",
          fontSize: 12,
        },
      },
    },
    MuiListItem: {
      defaultProps: { dense: true, disablePadding: false },
      styleOverrides: { root: { minHeight: 32, transition: "none" } },
    },
    MuiBreadcrumbs: { styleOverrides: { li: {} } },
    MuiPopover: {
      styleOverrides: { paper: { borderRadius: 6, transition: "none" } },
    },
    MuiTableCell: {
      defaultProps: { size: "small" },
      styleOverrides: { sizeSmall: { padding: "4px 8px" } },
    },
    MuiToolbar: { defaultProps: { variant: "dense" } },
    MuiPagination: { defaultProps: { size: "small" } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { minHeight: 32, transition: "none" },
        input: {
          padding: "7px 8px",
          height: 32,
          lineHeight: "18px",
          fontSize: 12,
          boxSizing: 'border-box',
          '&::placeholder': {
            fontSize: 12,
            lineHeight: '18px',
            opacity: 0.5,
          },
        },
      },
    },
    MuiInputBase: {
      defaultProps: { size: "small" },
      styleOverrides: {
        root: { minHeight: 32, transition: "none" },
        input: {
          padding: "7px 8px",
          height: 32,
          lineHeight: "18px",
          fontSize: 12,
          boxSizing: 'border-box',
          '&::placeholder': {
            fontSize: 12,
            lineHeight: '18px',
            opacity: 0.5,
          },
        },
      },
    },
    MuiFormControl: {
      defaultProps: { size: "small", margin: "dense" },
      styleOverrides: {
        root: {
          /* Common */
        },
        marginDense: { marginTop: 0, marginBottom: 0 },
      },
    },
    MuiPaper: {
      variants: [
        {
          props: { variant: 'assistantMessage' },
          style: ({ theme }) => ({
            backgroundColor: theme.palette.mode === 'light' ? '#fafafa' : theme.palette.background.paper,
            padding: '4px 12px',
            borderRadius: theme.shape.borderRadius * 3,
            boxShadow: 'none',
            border: `1px solid ${theme.palette.divider}`,
            fontSize: theme.typography.fontSize,
            lineHeight: 1.6,
          }),
        },
      ],
    },
  },
});

// Dark theme configuration
export const darkTheme = createTheme({
  transitions: {
    create: () => "none",
    duration: {
      shortest: 0,
      shorter: 0,
      short: 0,
      standard: 0,
      complex: 0,
      enteringScreen: 0,
      leavingScreen: 0,
    },
    easing: {
      easeInOut: "linear",
      easeOut: "linear",
      easeIn: "linear",
      sharp: "linear",
    },
  },
  palette: {
    mode: "dark",
    // Primary color set to dark gray (slightly lighter for contrast)
    primary: { main: "#434343" },
    success: { main: "#52c41a" },
    warning: { main: "#faad14" },
    error: { main: "#ff4d4f" },
    info: { main: "#8c8c8c" },
    background: { default: "#141414", paper: "#1f1f1f" },
    text: {
      primary: "rgba(255,255,255,0.88)",
      secondary: "rgba(255,255,255,0.65)",
    },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily:
      '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif',
    fontSize: 12,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        "*,*::before,*::after": {
          animation: "none !important",
          transition: "none !important",
        },
        html: { scrollBehavior: "auto" },
        body: { animation: "none !important" },
      },
    },
    MuiButton: {
      defaultProps: {
        size: "small",
        disableRipple: true,
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          textTransform: "none",
          padding: "4px 12px",
          minHeight: 32,
          transition: "none",
        },
      },
    },
    MuiTextField: {
      defaultProps: { size: "small", margin: "dense", variant: "outlined" },
    },
    MuiSelect: {
      defaultProps: { size: "small" },
      styleOverrides: { root: { fontSize: 12 }, select: { fontSize: 12 } },
    },
    MuiAutocomplete: { defaultProps: { size: "small" } },
    MuiSwitch: { defaultProps: { size: "small" } },
    MuiCheckbox: { defaultProps: { size: "small", disableRipple: true } },
    MuiRadio: { defaultProps: { size: "small", disableRipple: true } },
    MuiIconButton: {
      defaultProps: { size: "small", disableRipple: true },
      styleOverrides: { root: { padding: 4, transition: "none" } },
    },
    MuiTab: {
      defaultProps: { iconPosition: "start", disableRipple: true },
      styleOverrides: {
        root: { minHeight: 36, padding: "6px 12px", transition: "none", textTransform: 'none' },
      },
    },
    MuiDialogTitle: { styleOverrides: { root: { padding: "12px 16px" } } },
    MuiDialogContent: { styleOverrides: { root: { padding: "12px 16px" } } },
    MuiDialogActions: { styleOverrides: { root: { padding: "8px 16px" } } },
    MuiFormLabel: { styleOverrides: { root: {} } },
    MuiInputLabel: {
      styleOverrides: {
        root: { transform: "translate(14px, 10px) scale(1)" },
        shrink: { transform: "translate(14px, -6px) scale(0.85)" },
      },
    },
    MuiChip: {
      defaultProps: { size: "small" },
      styleOverrides: {
        root: { height: 24 },
        label: { paddingLeft: 6, paddingRight: 6 },
      },
    },
    MuiAlert: {
      defaultProps: { variant: "outlined" },
      styleOverrides: { root: { padding: "4px 8px" } },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          minHeight: 32,
          fontSize: 12,
          paddingTop: 4,
          paddingBottom: 4,
          transition: "none",
        },
      },
    },
    MuiListItem: {
      defaultProps: { dense: true },
      styleOverrides: { root: { minHeight: 32, transition: "none" } },
    },
    MuiBreadcrumbs: { styleOverrides: { li: {} } },
    MuiPopover: {
      styleOverrides: { paper: { borderRadius: 6, transition: "none" } },
    },
    MuiTableCell: {
      defaultProps: { size: "small" },
      styleOverrides: { sizeSmall: { padding: "4px 8px" } },
    },
    MuiToolbar: { defaultProps: { variant: "dense" } },
    MuiPagination: { defaultProps: { size: "small" } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { minHeight: 32, transition: "none" },
        input: {
          padding: "7px 8px",
          height: 32,
          lineHeight: "18px",
          fontSize: 12,
          boxSizing: 'border-box',
          '&::placeholder': {
            fontSize: 12,
            lineHeight: '18px',
            opacity: 0.5,
          },
        },
      },
    },
    MuiInputBase: {
      defaultProps: { size: "small" },
      styleOverrides: {
        root: { minHeight: 32, transition: "none" },
        input: {
          padding: "7px 8px",
          height: 32,
          lineHeight: "18px",
          fontSize: 12,
          boxSizing: 'border-box',
          '&::placeholder': {
            fontSize: 12,
            lineHeight: '18px',
            opacity: 0.5,
          },
        },
      },
    },
    MuiFormControl: {
      defaultProps: { size: "small", margin: "dense" },
      styleOverrides: {
        root: {
          /* Common */
        },
        marginDense: { marginTop: 0, marginBottom: 0 },
      },
    },
    MuiPaper: {
      variants: [
        {
          props: { variant: 'assistantMessage' },
          style: ({ theme }) => ({
            backgroundColor: theme.palette.background.paper,
            padding: '4px 12px',
            borderRadius: theme.shape.borderRadius * 3,
            boxShadow: 'none',
            border: `1px solid ${theme.palette.divider}`,
            fontSize: theme.typography.fontSize,
            lineHeight: 1.6,
          }),
        },
      ],
    },
  },
});

// Theme type
export type ThemeMode = "light" | "dark";

// Theme configuration mapping
export const themes = {
  light: lightTheme,
  dark: darkTheme,
};
