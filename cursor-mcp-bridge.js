#!/usr/bin/env node

/**
 * Cursor MCP Bridge - Connect Cursor MCP and Draw Things API
 * Converts simple text prompts to proper JSON-RPC requests
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import http from 'http';

// Set up log file
const logFile = 'cursor-mcp-bridge.log';
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  fs.appendFileSync(logFile, logMessage);
  console.error(logMessage); // Also output to stderr for debugging
}

// Enhanced error logging
function logError(error, message = 'Error') {
  const timestamp = new Date().toISOString();
  const errorDetails = error instanceof Error ? 
    `${error.message}\n${error.stack}` : 
    String(error);
  const logMessage = `${timestamp} - [ERROR] ${message}: ${errorDetails}\n`;
  fs.appendFileSync(logFile, logMessage);
  console.error(logMessage);
}

// Initialize log
log('Cursor MCP Bridge started');
log('Waiting for input...');

// Get current directory path
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure images directory exists
const imagesDir = path.join(__dirname, 'images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
  log(`Created image storage directory: ${imagesDir}`);
}

// Verify API connection - direct connection check
async function verifyApiConnection() {
  // Read API port from environment or use default
  const apiPort = process.env.DRAW_THINGS_API_PORT || 7888;
  const apiUrl = process.env.DRAW_THINGS_API_URL || `http://127.0.0.1:${apiPort}`;
  
  log(`Verifying API connection to ${apiUrl}`);

  return new Promise((resolve) => {
    // Try multiple endpoints
    const endpoints = ['/sdapi/v1/options', '/sdapi/v1/samplers', '/'];
    let endpointIndex = 0;
    let retryCount = 0;
    const maxRetries = 2;

    const tryEndpoint = () => {
      if (endpointIndex >= endpoints.length) {
        log('All endpoints failed, API connection verification failed');
        resolve(false);
        return;
      }

      const endpoint = endpoints[endpointIndex];
      const url = new URL(endpoint, apiUrl);
      
      log(`Trying endpoint: ${url.toString()}`);

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET',
        timeout: 5000,
        headers: {
          'User-Agent': 'DrawThingsMCP/1.0',
          'Accept': 'application/json'
        }
      };

      const req = http.request(options, (res) => {
        log(`API connection check response: ${res.statusCode}`);
        
        // Any 2xx response is good
        if (res.statusCode >= 200 && res.statusCode < 300) {
          log('API connection verified successfully');
          resolve(true);
          return;
        }
        
        // Try next endpoint
        endpointIndex++;
        retryCount = 0;
        tryEndpoint();
      });

      req.on('error', (e) => {
        log(`API connection error (${endpoint}): ${e.message}`);
        
        // Retry same endpoint a few times
        if (retryCount < maxRetries) {
          retryCount++;
          log(`Retrying ${endpoint} (attempt ${retryCount}/${maxRetries})...`);
          setTimeout(tryEndpoint, 1000);
          return;
        }
        
        // Move to next endpoint
        endpointIndex++;
        retryCount = 0;
        tryEndpoint();
      });

      req.on('timeout', () => {
        log(`API connection timeout (${endpoint})`);
        req.destroy();
        
        // Retry same endpoint a few times
        if (retryCount < maxRetries) {
          retryCount++;
          log(`Retrying ${endpoint} after timeout (attempt ${retryCount}/${maxRetries})...`);
          setTimeout(tryEndpoint, 1000);
          return;
        }
        
        // Move to next endpoint
        endpointIndex++;
        retryCount = 0;
        tryEndpoint();
      });

      req.end();
    };

    tryEndpoint();
  });
}

// Initial API verification
let apiVerified = false;
verifyApiConnection().then(result => {
  apiVerified = result;
  if (result) {
    log('API connection verified on startup');
  } else {
    log('API connection verification failed on startup - will retry on requests');
  }
});

// Set up readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// Listen for line input
rl.on('line', async (line) => {
  log(`Received input: ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`);
  
  // If API connection hasn't been verified yet, try again
  if (!apiVerified) {
    apiVerified = await verifyApiConnection();
    if (!apiVerified) {
      log('API connection still not available');
      // Return error response but continue processing the request
      // This allows the MCP service to handle the error properly
    }
  }
  
  // Check if input is already in JSON format
  try {
    const jsonInput = JSON.parse(line);
    log('Input is valid JSON, checking if it conforms to JSON-RPC 2.0 standard');
    
    // Check if it conforms to JSON-RPC 2.0 standard
    if (jsonInput.jsonrpc === "2.0" && jsonInput.method && jsonInput.id) {
      log('Input already conforms to JSON-RPC 2.0 standard, forwarding directly');
      process.stdout.write(line + '\n');
      return;
    } else {
      log('JSON format is valid but does not conform to JSON-RPC 2.0 standard, converting');
      processRequest(jsonInput);
    }
    return;
  } catch (e) {
    log(`Input is not valid JSON: ${e.message}`);
  }
  
  // Check if it's a plain text prompt from Cursor
  if (line && typeof line === 'string' && !line.startsWith('{')) {
    log('Detected plain text prompt, converting to JSON-RPC request');
    
    // Create request conforming to JSON-RPC 2.0 standard
    const request = {
      jsonrpc: "2.0",
      id: Date.now().toString(),
      method: "mcp.invoke",
      params: {
        tool: "generateImage",
        parameters: {
          prompt: line.trim()
        }
      }
    };
    
    processRequest(request);
  } else {
    log('Unrecognized input format, cannot process');
    sendErrorResponse('Unrecognized input format', "parse_error", -32700);
  }
});

// Process request
function processRequest(request) {
  log(`Processing request: ${JSON.stringify(request).substring(0, 100)}...`);
  
  try {
    // Ensure request has the correct structure
    if (!request.jsonrpc) request.jsonrpc = "2.0";
    if (!request.id) request.id = Date.now().toString();
    
    // If no method, set to mcp.invoke
    if (!request.method) {
      request.method = "mcp.invoke";
    }
    
    // Process params
    if (!request.params) {
      // Try to build params from different sources
      if (request.prompt || request.parameters) {
        request.params = {
          tool: "generateImage",
          parameters: request.prompt 
            ? { prompt: request.prompt } 
            : (request.parameters || {})
        };
      } else {
        // No usable parameters found
        log('No usable parameters found, using empty object');
        request.params = {
          tool: "generateImage",
          parameters: {}
        };
      }
    } else if (!request.params.tool) {
      // Ensure there's a tool parameter
      request.params.tool = "generateImage";
    }
    
    // Ensure there are parameters
    if (!request.params.parameters) {
      request.params.parameters = {};
    }
    
    // Add API verification status to the request for debugging
    if (!apiVerified) {
      log('Warning: Adding API status information to request');
      request.params.parameters._apiVerified = apiVerified;
    }
    
    log(`Final request: ${JSON.stringify(request).substring(0, 150)}...`);
    process.stdout.write(JSON.stringify(request) + '\n');
  } catch (error) {
    logError(error, 'Error processing request');
    sendErrorResponse(`Error processing request: ${error.message}`, "internal_error", -32603);
  }
}

// Send error response conforming to JSON-RPC 2.0
function sendErrorResponse(message, errorType = "invalid_request", code = -32600) {
  const errorResponse = {
    jsonrpc: "2.0",
    id: "error-" + Date.now(),
    error: {
      code: code,
      message: errorType,
      data: message
    }
  };
  
  log(`Sending error response: ${JSON.stringify(errorResponse)}`);
  process.stdout.write(JSON.stringify(errorResponse) + '\n');
}

// Buffer for assembling complete JSON responses
let responseBuffer = '';

// Handle responses from the MCP service
process.stdin.on('data', (data) => {
  try {
    const dataStr = data.toString();
    log(`Received data chunk from MCP service: ${dataStr.substring(0, 100)}${dataStr.length > 100 ? '...' : ''}`);
    
    // Append to buffer to handle chunked responses
    responseBuffer += dataStr;
    
    // Check if we have a complete JSON object by trying to find matching braces
    if (isCompleteJson(responseBuffer)) {
      log('Detected complete JSON response, processing');
      processCompleteResponse(responseBuffer);
      responseBuffer = ''; // Clear buffer after processing
    } else {
      log('Incomplete JSON detected, buffering for more data');
    }
  } catch (error) {
    logError(error, 'Error handling MCP service data');
    
    // If there's an error, try to forward the original data as a fallback
    try {
      process.stdout.write(data);
    } catch (writeError) {
      logError(writeError, 'Error forwarding original data');
    }
  }
});

// Check if a string contains a complete JSON object
function isCompleteJson(str) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    // Not complete or not valid JSON
    // Try basic brace matching as a fallback
    let openBraces = 0;
    let insideString = false;
    let escapeNext = false;
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\' && insideString) {
        escapeNext = true;
        continue;
      }
      
      if (char === '"') {
        insideString = !insideString;
        continue;
      }
      
      if (!insideString) {
        if (char === '{') openBraces++;
        if (char === '}') openBraces--;
      }
    }
    
    // Complete JSON object should have matching braces
    return openBraces === 0 && str.trim().startsWith('{') && str.trim().endsWith('}');
  }
}

// Process a complete response
function processCompleteResponse(responseStr) {
  try {
    log(`Processing complete response: ${responseStr.substring(0, 100)}${responseStr.length > 100 ? '...' : ''}`);
    
    // Check for API error messages and update connection status
    if (responseStr.includes("Draw Things API is not running or cannot be connected")) {
      log('Detected API connection error in response');
      // Trigger a new API verification
      verifyApiConnection().then(result => {
        apiVerified = result;
        log(`API verification after error message: ${apiVerified ? 'successful' : 'failed'}`);
      });
    }
    
    // Try to parse as JSON
    const response = JSON.parse(responseStr);
    log('Successfully parsed MCP service response as JSON');
    
    // Check if it's an image generation result
    if (response.result && response.result.content) {
      // Find image content
      const imageContent = response.result.content.find(item => item.type === 'image');
      if (imageContent && imageContent.data) {
        // Save the image
        const timestamp = Date.now();
        const imagePath = path.join(imagesDir, `image_${timestamp}.png`);
        
        // Remove data:image/png;base64, prefix
        const base64Data = imageContent.data.replace(/^data:image\/\w+;base64,/, '');
        
        fs.writeFileSync(imagePath, Buffer.from(base64Data, 'base64'));
        log(`Image saved to: ${imagePath}`);
        
        // Add saved path info to the response
        response.result.imageSavedPath = imagePath;
        
        // Successful image generation indicates API is working
        apiVerified = true;
      }
    }
    
    // Forward the processed response
    process.stdout.write(JSON.stringify(response) + '\n');
  } catch (error) {
    logError(error, 'Error processing complete response');
    
    // Try to convert non-JSON response to proper JSON-RPC
    if (responseStr.trim() && !responseStr.trim().startsWith('{')) {
      log('Converting non-JSON response to proper JSON-RPC response');
      
      // Create a JSON-RPC response with the text as content
      const jsonResponse = {
        jsonrpc: "2.0",
        id: "response-" + Date.now(),
        result: {
          content: [{
            type: 'text',
            text: responseStr.trim()
          }]
        }
      };
      
      process.stdout.write(JSON.stringify(jsonResponse) + '\n');
    } else {
      // Forward original response as fallback
      log('Forwarding original response as fallback');
      process.stdout.write(responseStr + '\n');
    }
  }
}

// Handle end of input
rl.on('close', () => {
  log('Input stream closed, program ending');
  process.exit(0);
});

// Handle errors
process.on('uncaughtException', (error) => {
  logError(error, 'Uncaught exception');
  sendErrorResponse(`Error processing request: ${error.message}`, "internal_error", -32603);
});

log('Bridge service ready, waiting for Cursor input...');

// Periodically check API connection
setInterval(async () => {
  const prevStatus = apiVerified;
  apiVerified = await verifyApiConnection();
  
  if (prevStatus !== apiVerified) {
    log(`API connection status changed: ${prevStatus} -> ${apiVerified}`);
  }
}, 60000); // Check every minute 