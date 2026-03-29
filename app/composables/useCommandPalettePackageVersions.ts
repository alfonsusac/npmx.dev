import type { MaybeRefOrGetter } from 'vue'
import { fetchAllPackageVersions } from '~/utils/npm/api'

export function useCommandPalettePackageVersions(
  packageName: MaybeRefOrGetter<string | null | undefined>,
) {
  const versions = shallowRef<string[] | null>(null)
  let pendingLoad: Promise<void> | null = null
  let loadToken = 0

  watch(
    () => toValue(packageName),
    () => {
      versions.value = null
      pendingLoad = null
      loadToken += 1
    },
  )

  async function ensureLoaded() {
    const resolvedPackageName = toValue(packageName)
    if (!resolvedPackageName || versions.value) return
    if (pendingLoad) return pendingLoad

    const requestToken = ++loadToken

    async function doLoad(name: string) {
      try {
        const allVersions = await fetchAllPackageVersions(name)
        if (requestToken !== loadToken || toValue(packageName) !== name) return
        versions.value = allVersions.map(version => version.version)
      } finally {
        if (pendingLoad === load) {
          pendingLoad = null
        }
      }
    }

    const load = doLoad(resolvedPackageName)
    pendingLoad = load
    return load
  }

  return {
    ensureLoaded,
    versions,
  }
}
