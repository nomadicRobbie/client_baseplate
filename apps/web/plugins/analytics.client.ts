// Client-only plugin — fires page_view on every route navigation automatically.
// Zero config required from the client's pages.
export default defineNuxtPlugin(() => {
  const features = useFeatures()
  if (!features.analytics) return

  const { post } = useApi()
  const sessionId = useAnalyticsSession()
  const router = useRouter()

  router.afterEach((to) => {
    post('/public/analytics/event', {
      event_type: 'page_view',
      session_id: sessionId.value,
      url: window.location.origin + to.fullPath,
      referrer: document.referrer || undefined,
    }).catch(() => {})
  })
})
