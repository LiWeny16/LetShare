import { Box, Typography } from "@mui/material";
import { motion, useReducedMotion } from "motion/react";

/**
 * Joining-the-meeting loader: a small elephant rides a LetShare tile down a
 * slide. The loop is ~3s; reduced-motion users get a static seated pose.
 */
export default function MeetingJoinLoader({ label }: { label: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <Box
      role="status"
      aria-live="polite"
      data-testid="meeting-join-loader"
      sx={{ display: "grid", justifyItems: "center", gap: 1.1, px: 2, textAlign: "center" }}
    >
      <Box
        component="svg"
        viewBox="0 0 240 184"
        aria-hidden="true"
        sx={{ width: { xs: 196, sm: 224 }, height: "auto", display: "block", overflow: "visible" }}
      >
        <defs>
          <linearGradient id="meeting-join-tile" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3f9bff" />
            <stop offset="100%" stopColor="#1677ff" />
          </linearGradient>
          <linearGradient id="meeting-join-slide" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8ec2ff" />
            <stop offset="100%" stopColor="#1677ff" />
          </linearGradient>
        </defs>

        {/* Ground */}
        <ellipse cx="124" cy="168" rx="86" ry="9" fill="#e4eefb" />
        <ellipse cx="124" cy="168" rx="58" ry="5.5" fill="#d3e4f7" />

        {/* Slide: soft rail under a brand-blue rail */}
        <path
          d="M 20 46 C 46 48 70 58 94 80 C 120 104 150 118 196 126"
          fill="none"
          stroke="#d6e7f9"
          strokeWidth="20"
          strokeLinecap="round"
        />
        <path
          d="M 20 46 C 46 48 70 58 94 80 C 120 104 150 118 196 126"
          fill="none"
          stroke="url(#meeting-join-slide)"
          strokeWidth="11"
          strokeLinecap="round"
        />
        <path d="M 101 94 L 95 154" stroke="#bad4ee" strokeWidth="5" strokeLinecap="round" />
        <path d="M 160 114 L 156 154" stroke="#bad4ee" strokeWidth="5" strokeLinecap="round" />

        {/* Twinkles */}
        <motion.path
          d="M 0 -6 L 1.6 -1.6 L 6 0 L 1.6 1.6 L 0 6 L -1.6 1.6 L -6 0 L -1.6 -1.6 Z"
          transform="translate(202 58)"
          fill="#ffc94d"
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
          animate={reduceMotion ? { opacity: 0.75 } : { opacity: [0.15, 1, 0.15], scale: [0.65, 1, 0.65] }}
          transition={reduceMotion ? undefined : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.path
          d="M 0 -6 L 1.6 -1.6 L 6 0 L 1.6 1.6 L 0 6 L -1.6 1.6 L -6 0 L -1.6 -1.6 Z"
          transform="translate(214 92)"
          fill="#7eb5ff"
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
          animate={reduceMotion ? { opacity: 0.6 } : { opacity: [0.12, 0.95, 0.12], scale: [0.6, 0.95, 0.6] }}
          transition={reduceMotion ? undefined : { duration: 2.4, delay: 0.7, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.path
          d="M 0 -6 L 1.6 -1.6 L 6 0 L 1.6 1.6 L 0 6 L -1.6 1.6 L -6 0 L -1.6 -1.6 Z"
          transform="translate(30 96)"
          fill="#a9c9f0"
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
          animate={reduceMotion ? { opacity: 0.55 } : { opacity: [0.1, 0.9, 0.1], scale: [0.55, 0.9, 0.55] }}
          transition={reduceMotion ? undefined : { duration: 2.4, delay: 1.3, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Rider: elephant sitting on a LetShare tile */}
        <g transform="translate(66 26)">
          <motion.g
            animate={reduceMotion
              ? { x: 0, y: 0, opacity: 1 }
              : { x: [0, 94, 94, 94, 0, 0], y: [0, 62, 62, 62, 0, 0], opacity: [1, 1, 1, 0, 0, 1] }}
            transition={reduceMotion
              ? undefined
              : { duration: 2.8, times: [0, 0.52, 0.6, 0.61, 0.63, 0.7], repeat: Infinity, repeatDelay: 0.15, ease: "easeInOut" }}
          >
            {/* Tail */}
            <path d="M -28 18 C -40 17 -41 7 -33 4" fill="none" stroke="#20395c" strokeWidth="2.6" strokeLinecap="round" />

            {/* Body */}
            <ellipse cx="-2" cy="0" rx="30" ry="24" fill="#93a9c6" stroke="#20395c" strokeWidth="2.6" />

            {/* Ear */}
            <motion.g
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
              animate={reduceMotion ? undefined : { rotate: [0, -6, 3, 0] }}
              transition={reduceMotion ? undefined : { duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            >
              <ellipse cx="7" cy="-20" rx="12" ry="16" fill="#afc4dd" stroke="#20395c" strokeWidth="2.4" />
              <ellipse cx="8" cy="-19" rx="6.5" ry="10" fill="#d7e4f3" />
            </motion.g>

            {/* Head */}
            <circle cx="20" cy="-20" r="17" fill="#93a9c6" stroke="#20395c" strokeWidth="2.6" />
            <path d="M 15 -37 q 3 -5 7 -1" fill="none" stroke="#20395c" strokeWidth="2.4" strokeLinecap="round" />

            {/* Eye, cheek, tusk */}
            <circle cx="26" cy="-24" r="2.5" fill="#172b4d" />
            <circle cx="26.9" cy="-24.9" r="0.85" fill="#ffffff" />
            <ellipse cx="30" cy="-16" rx="4.2" ry="2.6" fill="#f2a3b4" opacity="0.75" />
            <path d="M 32 -12 c 3 3 6 4 10 3" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />

            {/* Trunk */}
            <motion.path
              d="M 35 -26 C 42 -20 43 -8 36 -4 C 34 -9 32 -15 29 -19 Z"
              fill="#93a9c6"
              stroke="#20395c"
              strokeWidth="2.2"
              strokeLinejoin="round"
              style={{ transformBox: "fill-box", transformOrigin: "top center" }}
              animate={reduceMotion ? undefined : { rotate: [0, 5, -3, 0] }}
              transition={reduceMotion ? undefined : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* LetShare tile sled */}
            <rect x="-26" y="10" width="52" height="32" rx="11" fill="url(#meeting-join-tile)" />
            <rect x="-21" y="13.5" width="42" height="7" rx="3.5" fill="#ffffff" opacity="0.18" />
            <path d="M -14 20 v 11 q 0 3.4 4.2 3.4 h 8" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M 3 26 L 10.5 21.5 M 3 26 L 10.5 30.5" fill="none" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="11.5" cy="20.5" r="2.2" fill="#ffffff" />
            <circle cx="11.5" cy="31.5" r="2.2" fill="#ffffff" />
            <circle cx="2" cy="26" r="2.2" fill="#ffffff" />

            {/* Feet resting on the sled */}
            <ellipse cx="-11" cy="9" rx="7" ry="5" fill="#93a9c6" stroke="#20395c" strokeWidth="2.2" />
            <ellipse cx="7" cy="9" rx="7" ry="5" fill="#93a9c6" stroke="#20395c" strokeWidth="2.2" />
          </motion.g>
        </g>
      </Box>
      <Typography sx={{ color: "text.secondary", fontSize: "0.78rem", fontWeight: 650, letterSpacing: "0.02em" }}>{label}</Typography>
    </Box>
  );
}
