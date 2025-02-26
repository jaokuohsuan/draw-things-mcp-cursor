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
  echo "  --port PORT    Specify custom port for Draw Things API (default: 7888)"
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
API_PORT=7888

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
    --port=*)
      API_PORT="${arg#*=}"
      shift
      ;;
  esac
done

# Install dependencies
echo "Checking and installing necessary dependencies..."
npm install --quiet

# Clean up old logs
if [ "$CLEANUP" = true ]; then
  echo "Cleaning up old log files..."
  if [ -f cursor-mcp-bridge.log ]; then
    mv cursor-mcp-bridge.log cursor-mcp-bridge.log.old
  fi
  if [ -f draw-things-mcp.log ]; then
    mv draw-things-mcp.log draw-things-mcp.log.old
  fi
fi

# Ensure images directory exists
mkdir -p images
# Ensure logs directory exists
mkdir -p logs

echo
echo "Step 1: Checking if Draw Things API is available..."

# Create a simple test script to check API connection
cat > test-api.js << EOL
import http from 'http';

const options = {
  host: '127.0.0.1',
  port: ${API_PORT},
  path: '/sdapi/v1/options',
  method: 'GET',
  timeout: 5000,
  headers: {
    'User-Agent': 'DrawThingsMCP/1.0',
    'Accept': 'application/json'
  }
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
  echo "Warning: Draw Things API appears to be unavailable on port ${API_PORT}."
  echo "Please ensure:"
  echo "1. Draw Things application is running"
  echo "2. API is enabled in Draw Things settings"
  echo "3. API is listening on 127.0.0.1:${API_PORT}"
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
echo "Step 2: Starting Services..."
echo

# Set up environment variables
export DRAW_THINGS_FORCE_STAY_ALIVE=true
export MCP_BRIDGE_DEDUP=true
export DEBUG_MODE=$DEBUG_MODE
export DRAW_THINGS_API_PORT=$API_PORT
export DRAW_THINGS_API_URL="http://127.0.0.1:${API_PORT}"

# Set up debug mode
if [ "$DEBUG_MODE" = true ]; then
  echo "Debug mode enabled, all log output will be displayed"
  echo "Starting MCP bridge service in debug mode..."
  
  # Start both services in debug mode
  node cursor-mcp-bridge.js 2>&1 | tee -a cursor-mcp-debug.log | node src/index.js
else
  # Start bridge service
  echo "Starting bridge service in normal mode..."
  echo "All logs will be saved to cursor-mcp-bridge.log and draw-things-mcp.log"
  
  # Start MCP bridge service and pipe output to MCP service
  node cursor-mcp-bridge.js | node src/index.js
fi

echo
echo "Service has ended."
echo "Log files:"
echo " - cursor-mcp-bridge.log"
echo " - draw-things-mcp.log"
echo " - logs/error.log (if errors occurred)"
echo "If generation was successful, images will be saved in the images directory."

# Display service status
if [ -f "images/image_$(date +%Y%m%d)*.png" ] || [ -f "images/generated-image_*.png" ]; then
  echo "Images were successfully generated today!"
  ls -la images/ | grep "$(date +%Y-%m-%d)"
else
  echo "No images generated today were found. Please check the logs for more information."
fi 