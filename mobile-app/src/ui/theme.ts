import { Platform, type TextStyle, type ViewStyle } from "react-native";

export const colors = {
  ink: "#082B5C",
  inkStrong: "#041E42",
  teal: "#0B8AA3",
  tealBright: "#39BBC7",
  tealSoft: "#E8F5F7",
  background: "#F5F8FB",
  surface: "#FFFFFF",
  surfaceAlt: "#EFF4F8",
  text: "#12233F",
  muted: "#64748B",
  line: "#DCE5ED",
  success: "#147D64",
  successSoft: "#E9F7F2",
  warning: "#A46116",
  warningSoft: "#FFF6E6",
  danger: "#B23A48",
  dangerSoft: "#FDECEF",
  white: "#FFFFFF",
  black: "#07101F",
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const shadows: Record<"card" | "floating", ViewStyle> = {
  card: Platform.select({
    ios: {
      shadowColor: colors.inkStrong,
      shadowOpacity: 0.07,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
    },
    android: { elevation: 2 },
    default: {},
  }) as ViewStyle,
  floating: Platform.select({
    ios: {
      shadowColor: colors.inkStrong,
      shadowOpacity: 0.17,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
    },
    android: { elevation: 7 },
    default: {},
  }) as ViewStyle,
};

export const textStyles: Record<
  "hero" | "title" | "section" | "body" | "bodyStrong" | "caption" | "eyebrow",
  TextStyle
> = {
  hero: { fontSize: 42, lineHeight: 48, fontWeight: "800", letterSpacing: -1.5 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "800", letterSpacing: -0.6 },
  section: { fontSize: 20, lineHeight: 26, fontWeight: "800", letterSpacing: -0.25 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "400" },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: "700" },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: "500" },
  eyebrow: { fontSize: 11, lineHeight: 15, fontWeight: "800", letterSpacing: 0.8 },
};
