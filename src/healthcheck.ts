/**
 * Simple health check script for Docker
 * Returns exit code 0 if healthy, 1 if unhealthy
 */

const checkHealth = async () => {
  try {
    const response = await fetch('http://localhost:3000/health', {
      method: 'GET',
      headers: { 'User-Agent': 'Docker-HealthCheck/1.0' },
    })

    if (response.ok) {
      const data = await response.json()
      if (data.status === 'ok' || data.message === 'OK') {
        process.exit(0)
      }
    }

    console.error('Health check failed: Invalid response')
    process.exit(1)
  } catch (error) {
    console.error('Health check failed:', error.message)
    process.exit(1)
  }
}

checkHealth()
