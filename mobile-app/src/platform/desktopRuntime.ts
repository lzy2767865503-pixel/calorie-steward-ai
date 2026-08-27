import { Platform } from "react-native";

export type CalorieStewardDesktopBridge = {
  platform: "windows";
  version: string;
  secrets: {
    delete: (key: string) => Promise<void>;
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
  };
  saveTextFile: (request: {
    contents: string;
    defaultFileName: string;
  }) => Promise<{ canceled: boolean; fileName: string | null }>;
};

declare global {
  interface Window {
    calorieStewardDesktop?: CalorieStewardDesktopBridge;
  }
}

export function desktopBridge(): CalorieStewardDesktopBridge | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const bridge = window.calorieStewardDesktop;
  return bridge?.platform === "windows" ? bridge : null;
}

export function isWindowsDesktopRuntime(): boolean {
  return desktopBridge() !== null;
}
