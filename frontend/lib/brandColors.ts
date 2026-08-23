/**
 * JMAN Group brand palette, from the official PPT template's "Colours" slide.
 * Use these (not ad hoc Tailwind/indigo hex codes) for anything drawn outside
 * the semantic CSS tokens (bg-card, text-foreground, etc.) -- chart series,
 * SVG strokes, and gradients, where Recharts/inline styles need raw hex.
 */
export const JMAN = {
  white: "#FFFFFF",
  midnightBlue: "#19105B",
  trypanBlue: "#3411A3",
  rose: "#FF6196",
  turquoise: "#71EAE1",
  lightBlue: "#26D4F0",
  amethyst: "#A16BDB",
  berry: "#A6265E",
  emerald: "#16978E",
  grey: "#D9D9D9",
  greyLight: "#F2F2F2",
  red: "#FF0000",
  redLight: "#FF8080",
  amber: "#FFC000",
  amberLight: "#FFD555",
  green: "#00B050",
  greenLight: "#55CA8A",
} as const;

/** Ordered palette for multi-series charts (COE mixes, cluster breakdowns, etc.) */
export const JMAN_CHART_PALETTE = [
  JMAN.trypanBlue,
  JMAN.rose,
  JMAN.turquoise,
  JMAN.amethyst,
  JMAN.emerald,
  JMAN.lightBlue,
  JMAN.berry,
];

/** The teal->turquoise "primary gradient" from the brand deck, dark to light. */
export const JMAN_HEADER_GRADIENT = `linear-gradient(135deg, ${JMAN.emerald} 0%, ${JMAN.turquoise} 100%)`;

/** Chart chrome tuned for the app's light theme (not a dark dashboard). */
export const CHART_CHROME = {
  grid: "#E5E1F5",
  axisText: "#6B6584",
  tooltipBg: "#FFFFFF",
  tooltipBorder: "#E5E1F5",
  labelText: JMAN.midnightBlue,
  mutedText: "#6B6584",
} as const;
