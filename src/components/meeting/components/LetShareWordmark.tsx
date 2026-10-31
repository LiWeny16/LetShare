import { Box } from "@mui/material";

/** Hand-drawn vector wordmark; remains sharp at every display scale. */
export function LetShareWordmark() {
  return (
    <Box component="svg" viewBox="0 0 190 54" role="img" aria-label="LetShare" sx={{ display: "block", width: { xs: 112, sm: 128 }, height: "auto", flexShrink: 0 }}>
      <g transform="translate(6 0) skewX(-6)" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5.4">
        <g stroke="#172b4d">
          <path d="M6 10v29q0 4 5 4h14" />
          <path d="M29 33h17c0-11-17-11-17 0s10 12 17 7" />
          <path d="M56 15v22q0 7 7 5M50 24h15" />
        </g>
        <g stroke="#1677ff">
          <path d="M91 14c-4-5-20-5-21 5-1 6 6 7 12 9 11 3 10 15-2 15-6 0-11-2-13-6" />
          <path d="M99 9v34m0-12c0-10 17-11 17 0v12" />
          <path d="M141 24v19m0-11c0-11-17-11-17 1s17 12 17 1" />
          <path d="M149 43V24m0 9c0-7 4-10 11-9" />
          <path d="M164 33h17c0-11-17-11-17 0s9 12 17 7" />
        </g>
      </g>
    </Box>
  );
}
