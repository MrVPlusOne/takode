/**
 * The app icon as Takode's own UI shows it: the day painting in the light theme and the night
 * painting in the dark theme, the way Ink & Paper turns to night. Icons the system installs
 * (home screen, installed app, notifications) can't follow the theme and stay on the day one.
 */
export function appLogoSrc(dark: boolean): string {
  return dark ? "/app-logo-night.png" : "/app-logo.png";
}

/**
 * Applies Takode's light or dark theme to the page: the `dark` class, and the browser tab's icon,
 * which follows Takode's theme rather than the system's so it always matches the in-app logo.
 */
export function applyThemeToDocument(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (favicon) favicon.href = dark ? "/favicon-night.png" : "/favicon.png";
}
