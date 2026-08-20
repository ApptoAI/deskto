const repoSlug = "ApptoAI/deskto"

export const repoUrl = `https://github.com/${repoSlug}`
export const releasesUrl = `${repoUrl}/releases`
// GitHub redirects this to the releases list while no release exists, so it
// is a safe target before the first one ships.
export const latestReleaseUrl = `${repoUrl}/releases/latest`
export const latestReleaseApiUrl = `https://api.github.com/repos/${repoSlug}/releases/latest`
export const downloadPageUrl = "/download"
