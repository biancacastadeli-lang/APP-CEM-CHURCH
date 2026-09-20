// Fallback visual temporário. Quando a Administração passar a fornecer
// `branding` no bootstrap, os valores recebidos substituem estes sem exigir
// redesenho do aplicativo. URLs de logo/banner permanecem vazias até os
// arquivos oficiais serem disponibilizados.
export const defaultBranding = Object.freeze({
  applicationName: 'CEM CONNECT',
  churchName: 'CEM Church',
  logoUrl: '',
  backgroundUrl: '',
  annualTheme: {
    name: 'Legado',
    subtitle: 'a luz da tua presença',
    year: '',
    bannerUrl: '',
    colors: {
      sand: '#E8D5B5',
      terracotta: '#B96745',
      copper: '#D38A53',
      dusk: '#2A1E18'
    }
  }
});

const safeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;

export function resolveBranding(remoteBranding) {
  const remote = remoteBranding && typeof remoteBranding === 'object' ? remoteBranding : {};
  const remoteTheme = remote.annualTheme && typeof remote.annualTheme === 'object' ? remote.annualTheme : {};
  const colors = remoteTheme.colors && typeof remoteTheme.colors === 'object' ? remoteTheme.colors : {};
  return {
    applicationName: typeof remote.applicationName === 'string' && remote.applicationName.trim() ? remote.applicationName.trim() : defaultBranding.applicationName,
    churchName: typeof remote.churchName === 'string' && remote.churchName.trim() ? remote.churchName.trim() : defaultBranding.churchName,
    logoUrl: typeof remote.logoUrl === 'string' ? remote.logoUrl.trim() : '',
    backgroundUrl: typeof remote.backgroundUrl === 'string' && /^https:\/\/[^\s]+$/i.test(remote.backgroundUrl) ? remote.backgroundUrl.trim() : '',
    annualTheme: {
      name: typeof remoteTheme.name === 'string' && remoteTheme.name.trim() ? remoteTheme.name.trim() : defaultBranding.annualTheme.name,
      subtitle: typeof remoteTheme.subtitle === 'string' && remoteTheme.subtitle.trim() ? remoteTheme.subtitle.trim() : defaultBranding.annualTheme.subtitle,
      year: typeof remoteTheme.year === 'string' || typeof remoteTheme.year === 'number' ? String(remoteTheme.year) : defaultBranding.annualTheme.year,
      bannerUrl: typeof remoteTheme.bannerUrl === 'string' ? remoteTheme.bannerUrl.trim() : '',
      colors: {
        sand: safeColor(colors.text ?? colors.sand, defaultBranding.annualTheme.colors.sand),
        terracotta: safeColor(colors.primary ?? colors.terracotta, defaultBranding.annualTheme.colors.terracotta),
        copper: safeColor(colors.secondary ?? colors.accent ?? colors.copper, defaultBranding.annualTheme.colors.copper),
        dusk: safeColor(colors.background ?? colors.dusk, defaultBranding.annualTheme.colors.dusk)
      }
    }
  };
}
