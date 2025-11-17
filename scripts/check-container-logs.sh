#!/bin/bash

# Script to check container logs for debugging

echo "🔍 Checking container logs..."
echo ""

echo "=== App Container Logs ==="
docker logs quantum-sport-app-prod --tail 50 2>&1
echo ""

echo "=== Email Worker Container Logs ==="
docker logs quantum-sport-email-worker-prod --tail 50 2>&1
echo ""

echo "=== Nginx Container Logs ==="
docker logs quantum-sport-nginx-prod --tail 50 2>&1
echo ""

echo "=== Container Status ==="
docker ps -a | grep quantum-sport
echo ""

echo "💡 To follow logs in real-time, run:"
echo "   docker logs -f quantum-sport-app-prod"

