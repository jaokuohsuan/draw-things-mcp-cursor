#!/bin/bash

# Cursor MCP and Draw Things Bridge Service Startup Script

# Ensure the program aborts on error
set -e

echo "========================================================"
echo "  Cursor MCP and Draw Things Bridge Service Tool  "
echo "  Image Generation Service Compliant with Model Context Protocol  "
echo "========================================================"
echo

# Check dependencies
command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required but not installed"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm is required but not installed"; exit 1; }

# Ensure script has execution permissions
chmod +x cursor-mcp-bridge.js

# Check if help information is needed
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
  echo "Usage: ./start-cursor-bridge.sh [options]"
  echo
  echo "Options:"
  echo "  --help, -h     Display this help information"
  echo "  --debug        Enable additional debug output"
  echo "  --no-cleanup   Keep old log files"
  echo
  echo "This script is used to start the Cursor MCP and Draw Things bridge service."
  echo "It will start a service that allows Cursor to generate images using plain text prompts."
  echo
  echo "Dependencies:"
  echo "  - Node.js and npm"
  echo "  - Draw Things application (must be running with API enabled)"
  echo
  exit 0
fi

# Parse parameters
DEBUG_MODE=false
CLEANUP=true

for arg in "$@"; do
  case $arg in
    --debug)
      DEBUG_MODE=true
      shift
      ;;
    --no-cleanup)
      CLEANUP=false
      shift
      ;;
  esac
done

# Install dependencies
echo "Checking and installing necessary dependencies..."
npm install --quiet fs path url readline

# Clean up old logs
if [ "$CLEANUP" = true ] && [ -f cursor-mcp-bridge.log ]; then
  echo "Cleaning up old log files..."
  mv cursor-mcp-bridge.log cursor-mcp-bridge.log.old
fi

# Ensure images directory exists
mkdir -p images

echo
echo "Step 1: Checking if Draw Things API is available..."

# Create a simple test script to check API connection
cat > test-api.js << 'EOL'
import http from 'http';

const options = {
  host: '127.0.0.1',
  port: 7888,
  path: '/',
  method: 'GET',
  timeout: 5000
};

const req = http.request(options, (res) => {
  console.log('Draw Things API connection successful! Status code:', res.statusCode);
  process.exit(0);
});

req.on('error', (e) => {
  if (e.code === 'ECONNREFUSED') {
    console.error('Error: Unable to connect to Draw Things API. Make sure Draw Things application is running and API is enabled.');
  } else if (e.code === 'ETIMEDOUT') {
    console.error('Error: Connection to Draw Things API timed out. Make sure Draw Things application is running normally.');
  } else {
    console.error('Error:', e.message);
  }
  process.exit(1);
});

req.on('timeout', () => {
  console.error('Error: Connection to Draw Things API timed out. Make sure Draw Things application is running normally.');
  req.destroy();
  process.exit(1);
});

req.end();
EOL

# Run API test
if node test-api.js; then
  echo "Draw Things API is available, continuing to start bridge service..."
else
  echo
  echo "Warning: Draw Things API appears to be unavailable."
  echo "Please ensure:"
  echo "1. Draw Things application is running"
  echo "2. API is enabled in Draw Things settings"
  echo "3. API is listening on 127.0.0.1:7888"
  echo
  read -p "Continue starting the bridge service anyway? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Canceling bridge service startup."
    exit 1
  fi
fi

# Clean up temporary files
rm -f test-api.js

echo
echo "Step 2: Starting Cursor MCP Bridge Service..."
echo "This service will allow Cursor to generate images using plain text prompts"
echo

# Set up environment variable to force the MCP service to stay alive
export DRAW_THINGS_FORCE_STAY_ALIVE=true
export MCP_BRIDGE_DEDUP=true

# Set up debug mode
if [ "$DEBUG_MODE" = true ]; then
  echo "Debug mode enabled, all log output will be displayed"
  node cursor-mcp-bridge.js 2>&1 | tee -a cursor-mcp-debug.log | npx -y draw-things-mcp-cursor
else
  # Start bridge service
  echo "Starting bridge service..."
  echo "All logs will be saved to cursor-mcp-bridge.log"
  node cursor-mcp-bridge.js | npx -y draw-things-mcp-cursor
fi

echo
echo "Service has ended."
echo "Log file: cursor-mcp-bridge.log"
echo "If generation was successful, images will be saved in the images directory."

# Display service status
if [ -f "images/image_$(date +%Y%m%d)*.png" ]; then
  echo "Images were successfully generated!"
  ls -la images/
else
  echo "No images generated today were found. Please check the logs for more information."
fi 