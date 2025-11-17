/**
 * Simple health check script for Docker
 * Returns exit code 0 if healthy, 1 if unhealthy
 */

const port = Number(process.env.PORT) || 3000

const checkHealth = async () => {
  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      method: 'GET',
      headers: { 'User-Agent': 'Docker-HealthCheck/1.0' },
    })

    if (response.ok) {
      const data = (await response.json()) as {
        success?: boolean
        msg?: string
        data?: { up?: boolean }
      }
      // Check if response indicates success
      if (data.success === true || (data.data?.up === true)) {
        process.exit(0)
      }
    }

    console.error('Health check failed: Invalid response')
    process.exit(1)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error)
    console.error('Health check failed:', message)
    process.exit(1)
  }
}

checkHealth()
