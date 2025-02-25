#!/usr/bin/env node

/**
 * Cursor MCP Bridge - Connect Cursor MCP and Draw Things API
 * Converts simple text prompts to proper JSON-RPC requests
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

// Set up log file
const logFile = 'cursor-mcp-bridge.log';
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  fs.appendFileSync(logFile, logMessage);
  console.error(logMessage); // Also output to stderr for debugging
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

// Set up readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// Listen for line input
rl.on('line', (line) => {
  log(`Received input: ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`);
  
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
    
    log(`Final request: ${JSON.stringify(request).substring(0, 150)}...`);
    process.stdout.write(JSON.stringify(request) + '\n');
  } catch (error) {
    log(`Error processing request: ${error.message}`);
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

// Handle responses from the MCP service
process.stdin.on('data', (data) => {
  try {
    const responseStr = data.toString();
    log(`Received MCP service response: ${responseStr.substring(0, 100)}${responseStr.length > 100 ? '...' : ''}`);
    
    // Try to parse the response
    const response = JSON.parse(responseStr);
    
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
      }
    }
    
    // Forward the response
    process.stdout.write(responseStr + '\n');
  } catch (error) {
    log(`Error processing MCP service response: ${error.message}`);
    // Forward original response
    process.stdout.write(data);
  }
});

// Handle end of input
rl.on('close', () => {
  log('Input stream closed, program ending');
  process.exit(0);
});

// Handle errors
process.on('uncaughtException', (error) => {
  log(`Uncaught error: ${error.message}`);
  log(error.stack);
  sendErrorResponse(`Error processing request: ${error.message}`, "internal_error", -32603);
});

log('Bridge service ready, waiting for Cursor input...'); 