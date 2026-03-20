<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

definePageMeta({
  name: 'timeline',
  path: '/package-timeline/:org?/:packageName/v/:version',
})

const route = useRoute('timeline')

const packageName = computed(() =>
  route.params.org ? `${route.params.org}/${route.params.packageName}` : route.params.packageName,
)
const version = computed(() => route.params.version)

const { data: pkg } = usePackage(packageName)

const latestVersion = computed(() => {
  if (!pkg.value) return null
  const latestTag = pkg.value['dist-tags']?.latest
  if (!latestTag) return null
  return pkg.value.versions[latestTag] ?? null
})

const versionUrlPattern = computed(() => {
  const split = packageName.value.split('/')
  const org = split.length === 2 ? split[0] : undefined
  const name = split.length === 2 ? split[1]! : split[0]!
  return `/package-timeline/${org ? `${org}/` : ''}${name}/v/{version}`
})

function timelineRoute(ver: string): RouteLocationRaw {
  return { name: 'timeline', params: { ...route.params, version: ver } }
}

// Build chronological version list sorted newest-first
const PAGE_SIZE = 25

const timelineEntries = computed(() => {
  if (!pkg.value) return []
  const time = pkg.value.time
  const versions = Object.keys(pkg.value.versions)

  const tagsByVersion = new Map<string, string[]>()
  for (const [tag, ver] of Object.entries(pkg.value['dist-tags'] ?? {})) {
    const list = tagsByVersion.get(ver)
    if (list) list.push(tag)
    else tagsByVersion.set(ver, [tag])
  }

  return versions
    .filter(v => time[v])
    .map(v => ({
      version: v,
      time: time[v]!,
      tags: tagsByVersion.get(v) ?? [],
    }))
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
})

const visibleCount = ref(PAGE_SIZE)

const visibleEntries = computed(() => timelineEntries.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < timelineEntries.value.length)

function loadMore() {
  visibleCount.value += PAGE_SIZE
}

const SIZE_INCREASE_THRESHOLD = 0.25
const DEP_INCREASE_THRESHOLD = 5

const sizeCache = shallowReactive(new Map<string, InstallSizeResult>())
const fetchingVersions = shallowReactive(new Set<string>())

async function fetchSize(ver: string) {
  if (sizeCache.has(ver) || fetchingVersions.has(ver)) return
  fetchingVersions.add(ver)
  try {
    const data = await $fetch<InstallSizeResult>(
      `/api/registry/install-size/${packageName.value}/v/${ver}`,
    )
    sizeCache.set(ver, data)
  } catch {
    // silently skip — size data is best-effort
  } finally {
    fetchingVersions.delete(ver)
  }
}

// Fetch sizes for visible version pairs
if (import.meta.client) {
  watch(
    visibleEntries,
    entries => {
      for (const entry of entries) {
        fetchSize(entry.version)
      }
    },
    { immediate: true },
  )
}

interface SizeEvent {
  direction: 'increase' | 'decrease'
  sizeRatio: number
  sizeDelta: number
  depDiff: number
  sizeThresholdExceeded: boolean
  depThresholdExceeded: boolean
}

// Compute size events between consecutive visible versions
const sizeEvents = computed(() => {
  const events = new Map<string, SizeEvent>()
  const entries = visibleEntries.value

  for (let i = 0; i < entries.length - 1; i++) {
    const current = sizeCache.get(entries[i]!.version)
    const previous = sizeCache.get(entries[i + 1]!.version)
    if (!current || !previous) continue

    const sizeRatio =
      previous.totalSize > 0 ? (current.totalSize - previous.totalSize) / previous.totalSize : 0
    const depDiff = current.dependencyCount - previous.dependencyCount

    const sizeIncreased = sizeRatio > SIZE_INCREASE_THRESHOLD
    const sizeDecreased = sizeRatio < -SIZE_INCREASE_THRESHOLD
    const depsIncreased = depDiff > DEP_INCREASE_THRESHOLD
    const depsDecreased = depDiff < -DEP_INCREASE_THRESHOLD

    if (!sizeIncreased && !sizeDecreased && !depsIncreased && !depsDecreased) continue

    events.set(entries[i]!.version, {
      direction:
        (sizeDecreased || depsDecreased) && !sizeIncreased && !depsIncreased
          ? 'decrease'
          : 'increase',
      sizeRatio,
      sizeDelta: current.totalSize - previous.totalSize,
      depDiff,
      sizeThresholdExceeded: sizeIncreased || sizeDecreased,
      depThresholdExceeded: depsIncreased || depsDecreased,
    })
  }

  return events
})

const bytesFormatter = useBytesFormatter()

useSeoMeta({
  title: () => `Timeline - ${packageName.value} - npmx`,
  description: () => `Version timeline for ${packageName.value}`,
})
</script>

<template>
  <main class="flex-1 flex flex-col min-h-0">
    <PackageHeader
      :pkg="pkg"
      :resolved-version="version"
      :display-version="pkg?.requestedVersion"
      :latest-version="latestVersion"
      :version-url-pattern="versionUrlPattern"
      page="timeline"
    />

    <div class="container w-full py-8">
      <!-- Timeline -->
      <ol v-if="visibleEntries.length" class="relative border-s border-border ms-4">
        <li v-for="entry in visibleEntries" :key="entry.version" class="mb-6 ms-6">
          <!-- Size event -->
          <div v-if="sizeEvents.has(entry.version)" class="mb-4 -ms-6 ps-6 relative">
            <span
              class="absolute -start-2 flex items-center justify-center w-4 h-4 rounded-full border"
              :class="
                sizeEvents.get(entry.version)!.direction === 'decrease'
                  ? 'bg-green-500 border-green-600'
                  : 'bg-amber-500 border-amber-600'
              "
            >
              <span
                class="w-2.5 h-2.5 text-white"
                :class="
                  sizeEvents.get(entry.version)!.direction === 'decrease'
                    ? 'i-lucide:trending-down'
                    : 'i-lucide:trending-up'
                "
                aria-hidden="true"
              />
            </span>
            <div
              class="border rounded-lg px-3 py-2 text-sm"
              :class="
                sizeEvents.get(entry.version)!.direction === 'decrease'
                  ? 'border-green-600/40 bg-green-500/10 text-green-800 dark:text-green-400'
                  : 'border-amber-600/40 bg-amber-500/10 text-amber-800 dark:text-amber-400'
              "
            >
              <template v-if="sizeEvents.get(entry.version)!.sizeThresholdExceeded">
                {{
                  sizeEvents.get(entry.version)!.direction === 'decrease'
                    ? $t('package.timeline.size_decrease', {
                        percent: Math.abs(
                          Math.round(sizeEvents.get(entry.version)!.sizeRatio * 100),
                        ),
                        size: bytesFormatter.format(
                          Math.abs(sizeEvents.get(entry.version)!.sizeDelta),
                        ),
                      })
                    : $t('package.timeline.size_increase', {
                        percent: Math.round(sizeEvents.get(entry.version)!.sizeRatio * 100),
                        size: bytesFormatter.format(sizeEvents.get(entry.version)!.sizeDelta),
                      })
                }}
              </template>
              <template
                v-if="
                  sizeEvents.get(entry.version)!.sizeThresholdExceeded &&
                  sizeEvents.get(entry.version)!.depThresholdExceeded
                "
              >
                &middot;
              </template>
              <template v-if="sizeEvents.get(entry.version)!.depThresholdExceeded">
                {{
                  sizeEvents.get(entry.version)!.depDiff > 0
                    ? $t('package.timeline.dep_increase', {
                        count: sizeEvents.get(entry.version)!.depDiff,
                      })
                    : $t('package.timeline.dep_decrease', {
                        count: Math.abs(sizeEvents.get(entry.version)!.depDiff),
                      })
                }}
              </template>
            </div>
          </div>
          <!-- Dot -->
          <span
            class="absolute -start-2 flex items-center justify-center w-4 h-4 rounded-full border border-border"
            :class="entry.version === version ? 'bg-accent border-accent' : 'bg-bg-subtle'"
          />
          <!-- Content -->
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <LinkBase
              :to="timelineRoute(entry.version)"
              class="text-sm font-medium"
              :class="entry.version === version ? 'text-accent' : ''"
              dir="ltr"
            >
              {{ entry.version }}
            </LinkBase>
            <span
              v-for="tag in entry.tags"
              :key="tag"
              class="text-3xs font-semibold uppercase tracking-wide"
              :class="tag === 'latest' ? 'text-accent' : 'text-fg-subtle'"
            >
              {{ tag }}
            </span>
            <DateTime
              :datetime="entry.time"
              class="text-xs text-fg-subtle"
              year="numeric"
              month="short"
              day="numeric"
            />
          </div>
        </li>
      </ol>

      <!-- Load more -->
      <div v-if="hasMore" class="mt-4 ms-10">
        <button
          type="button"
          class="text-sm text-accent hover:text-accent/80 transition-colors"
          @click="loadMore"
        >
          {{ $t('package.timeline.load_more') }}
        </button>
      </div>

      <!-- Empty state -->
      <div v-else-if="!pkg" class="py-20 text-center">
        <span class="i-svg-spinners:ring-resize w-5 h-5 text-fg-subtle" />
      </div>
    </div>
  </main>
</template>
