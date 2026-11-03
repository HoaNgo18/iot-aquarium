export type ThemePreference = 'light' | 'dark' | 'system'
export const THEME_KEY = 'aquasense-theme'
export function themePreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}
export function resolveTheme(preference: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
}
export function readStorage(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
export function writeStorage(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* Private/storage-disabled mode still works. */ }
}
export function applyTheme(preference: ThemePreference): void {
  const theme = resolveTheme(preference, window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = theme
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--background').trim()
  window.dispatchEvent(new Event('aquasense:theme'))
}
export function initTheme() {
  applyTheme(themePreference(readStorage(THEME_KEY)))
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themePreference(readStorage(THEME_KEY)) === 'system') applyTheme('system')
  })
}
