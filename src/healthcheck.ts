/**
 * Simple health check script for Docker
 * Returns exit code 0 if healthy, 1 if unhealthy
 */

// Read port from environment, default to 3000 if not set
// This should match the PORT environment variable set in docker-compose
const port = Number(process.env.PORT) || 3000

const checkHealth = async () => {
  try {
    // Use a shorter timeout for health checks
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

    const response = await fetch(`http://localhost:${port}/health`, {
      method: 'GET',
      headers: { 'User-Agent': 'Docker-HealthCheck/1.0' },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (response.ok) {
      const data = (await response.json()) as {
        success?: boolean
        msg?: string
        data?: { up?: boolean }
      }
      // Check if response indicates success
      // The health endpoint returns: { success: true, msg: "...", data: { up: true, ts: "..." } }
      if (data.success === true || data.data?.up === true) {
        process.exit(0)
      }
    }

    console.error(`Health check failed: Invalid response (status: ${response.status})`)
    process.exit(1)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error)
    console.error(`Health check failed: ${message}`)
    process.exit(1)
  }
}

checkHealth()
