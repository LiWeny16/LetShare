import { createTheme } from '@mui/material/styles';

const SYSTEM_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Inter, ui-sans-serif, system-ui, sans-serif';

export const themes = {
  light: createTheme({
    typography: { fontFamily: SYSTEM_FONT_FAMILY },
    palette: {
      mode: 'light',
    },
  }),
  dark: createTheme({
    typography: { fontFamily: SYSTEM_FONT_FAMILY },
    palette: {
      mode: 'dark',
    },
  }),
  blue: createTheme({
    typography: { fontFamily: SYSTEM_FONT_FAMILY },
    palette: {
      mode: 'light',
      primary: { main: '#1976d2' },
      secondary: { main: '#90caf9' },
      background: {
        default: '#e3f2fd',
        paper: '#ffffff',
      },
    },
  }),
  green: createTheme({
    typography: { fontFamily: SYSTEM_FONT_FAMILY },
    palette: {
      mode: 'light',
      primary: { main: '#388e3c' },
      secondary: { main: '#a5d6a7' },
      background: {
        default: '#f1f8e9',
        paper: '#ffffff',
      },
    },
  }),
  sunset: createTheme({
    typography: { fontFamily: SYSTEM_FONT_FAMILY },
    palette: {
      mode: 'light',
      primary: { main: '#f57c00' },
      secondary: { main: '#ffcc80' },
      background: {
        default: '#fff3e0',
        paper: '#ffffff',
      },
    },
  }),
  coolGray: createTheme({
    typography: { fontFamily: SYSTEM_FONT_FAMILY },
    palette: {
      mode: 'dark',
      primary: { main: '#90a4ae' },
      secondary: { main: '#cfd8dc' },
      background: {
        default: '#263238',
        paper: '#37474f',
      },
    },
  }),
};



