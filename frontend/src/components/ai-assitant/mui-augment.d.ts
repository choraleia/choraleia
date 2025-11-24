// MUI component variant augmentations
// Ensures custom Paper variant 'assistantMessage' is recognized by TypeScript.
import "@mui/material/Paper";

declare module "@mui/material/Paper" {
  interface PaperPropsVariantOverrides {
    assistantMessage: true;
  }
}
