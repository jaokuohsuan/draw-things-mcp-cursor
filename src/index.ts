#!/usr/bin/env node

/**
 * Draw Things MCP - A Model Context Protocol implementation for Draw Things API
 * Integrated with Cursor MCP Bridge functionality for multiple input formats
 */

import path from 'path';
import fs from 'fs';
import http from 'http';
import readline from 'readline';
import { z } from 'zod';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DrawThingsService } from './services/drawThings/drawThingsService.js';
import { ImageGenerationParamsSchema } from './services/drawThings/schemas.js';
import { fileURLToPath } from 'url';
import { 
  JsonRpcRequest, 
  JsonRpcResponse, 
  ImageResponse, 
  ImageGenerationParameters, 
  ImageGenerationResult 
} from './interfaces/index.js';

// Type-safe function declarations
function createErrorResponse(message: string): ImageResponse {
  return {
    content: [{
      base64: '',
      path: '',
      prompt: '',
      seed: 0,
      width: 0,
      height: 0,
      meta: {
        error: message
      }
    }]
  };
}

function createImageResponse(imageData: string): ImageResponse {
  return {
    content: [{
      base64: imageData.replace(/^data:image\/png;base64,/, ''),
      path: '',
      prompt: '',
      seed: 0,
      width: 0,
      height: 0,
      meta: {}
    }]
  };
}

// Track processed request IDs to avoid duplicate processing
const processedRequestIds: Set<string> = new Set();
const processedPrompts: Map<string, number> = new Map(); // Track processed prompts with timestamps
const REQUEST_HISTORY_LIMIT = 100; // Limit the size of our history to prevent memory leaks
const PROMPT_HISTORY_EXPIRE_MS = 60000; // 60 seconds expiry for prompt history

// Helper to prevent duplicate request processing
function markRequestAsProcessed(requestId: string): void {
  // Add to processed set
  processedRequestIds.add(requestId);
  
  // Keep set size limited
  if (processedRequestIds.size > REQUEST_HISTORY_LIMIT) {
    // Remove oldest entry (first item in the set)
    const iterator = processedRequestIds.values();
    const firstItem = iterator.next();
    if (firstItem.value) {
      processedRequestIds.delete(firstItem.value);
    }
  }
}

function hasRequestBeenProcessed(requestId: string): boolean {
  return processedRequestIds.has(requestId);
}

// Helper to track and prevent duplicate prompt processing
function isPromptDuplicate(promptContent: string | undefined): boolean {
  if (!promptContent) return false;
  
  // Clean up old entries first
  const now = Date.now();
  for (const [prompt, timestamp] of processedPrompts.entries()) {
    if (now - timestamp > PROMPT_HISTORY_EXPIRE_MS) {
      processedPrompts.delete(prompt);
    }
  }
  
  // Check if this prompt was recently processed
  const normalizedPrompt = promptContent.trim().toLowerCase();
  
  // Only consider it duplicate if processed in the last 2000ms (increased from 100ms)
  // This prevents legitimate repeated requests from being blocked
  const lastProcessed = processedPrompts.get(normalizedPrompt);
  if (lastProcessed && (now - lastProcessed) < 2000) {
    // Don't log duplicates when they're expected
    if (now - lastProcessed > 500) {
      log(`Duplicate prompt detected within 2 seconds: "${normalizedPrompt.substring(0, 30)}..."`);
    }
    return true;
  }
  
  // Add to processed prompts with current timestamp
  processedPrompts.set(normalizedPrompt, now);
  
  // Keep map size limited
  if (processedPrompts.size > REQUEST_HISTORY_LIMIT) {
    // Remove oldest entry (first item in the map)
    const iterator = processedPrompts.keys();
    const firstItem = iterator.next();
    if (firstItem.value) {
      processedPrompts.delete(firstItem.value);
    }
  }
  
  return false;
}

// Global variables with type definitions
let isProcessing: boolean = false;
let exitDelayTimer: NodeJS.Timeout | null = null;
const EXIT_DELAY_MS: number = 300000; // 5 minutes waiting time after successful completion
let isPipeMode: boolean = false; // Flag to indicate if running in pipe mode

// Initialize DrawThingsService
const drawThingsService = new DrawThingsService();

// Constants and environment variables
const DEBUG_MODE: boolean = process.env.DEBUG_MODE === 'true';
// Get current file path in ESM
const __filename = fileURLToPath(import.meta.url);
// Get directory name
const __dirname = path.dirname(__filename);
const projectRoot: string = path.resolve(__dirname, '..');
const logsDir: string = path.join(projectRoot, 'logs');

// Create logs directory if it doesn't exist
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.error(`Created logs directory: ${logsDir}`);
  }
} catch (error) {
  console.error(`Failed to create logs directory: ${error instanceof Error ? error.message : String(error)}`);
}

const logFile: string = path.join(logsDir, 'draw-things-mcp.log');

// Basic logging function
function log(message: string): void {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  try {
    fs.appendFileSync(logFile, logMessage);
    // Only output to stderr to avoid polluting JSON-RPC communication
    console.error(logMessage);
  } catch (error) {
    console.error(`Failed to write to log file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Enhanced error logging to dedicated error log file
async function logError(error: Error | unknown): Promise<void> {
  try {
    const errorLogFile = path.join(logsDir, 'error.log');
    const timestamp = new Date().toISOString();
    const errorDetails = error instanceof Error ? 
      `${error.message}\n${error.stack}` : 
      String(error);
    
    const errorLog = `${timestamp} - ERROR: ${errorDetails}\n\n`;
    
    // Use async file writing with fallback
    try {
      await fs.promises.appendFile(errorLogFile, errorLog);
      
      // Also log to main log file
      log(`Error logged to ${errorLogFile}`);
      
      if (DEBUG_MODE) {
        // In debug mode, also output full error details to console
        console.error(`\n[DEBUG] FULL ERROR DETAILS:\n${errorDetails}\n`);
      }
    } catch (writeError) {
      // Fallback to sync writing
      try {
        fs.appendFileSync(errorLogFile, errorLog);
      } catch (syncWriteError) {
        // Last resort - log to console
        console.error(`Failed to write to error log: ${syncWriteError instanceof Error ? syncWriteError.message : String(syncWriteError)}`);
        console.error(`Original error: ${errorDetails}`);
      }
    }
  } catch (logError) {
    // If all else fails, at least log to console
    console.error('Critical error in error logging system:');
    console.error(logError);
    console.error('Original error:');
    console.error(error);
  }
}

// Helper function to save images to the file system
async function saveImage(base64Data: string, outputPath: string): Promise<string> {
  try {
    // Ensure the images directory exists
    const imagesDir = path.dirname(outputPath);
    if (!fs.existsSync(imagesDir)) {
      await fs.promises.mkdir(imagesDir, { recursive: true });
      log(`Created images directory: ${imagesDir}`);
    }
    
    log(`Starting to save image, size: ${base64Data.length} characters`);
    const buffer = Buffer.from(base64Data, 'base64');
    log(`Image converted to buffer, size: ${buffer.length} bytes`);
    
    await fs.promises.writeFile(outputPath, buffer);
    log(`Image successfully saved to: ${outputPath}`);
    return outputPath;
  } catch (error) {
    log(`Failed to save image: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error) {
      log(error.stack || 'No stack trace available');
    }
    throw error;
  }
}

// Function to signal completion of a task
function processComplete(success: boolean): void {
  log(`Process complete. Success: ${success}`);
  isProcessing = false;
  
  // Clear any existing timer
  if (exitDelayTimer) {
    clearTimeout(exitDelayTimer);
    exitDelayTimer = null;
  }
  
  // Only exit if not in pipe mode
  if (!isPipeMode) {
    // Set a timer to exit, giving time for any final operations to complete
    exitDelayTimer = setTimeout(() => {
      log('Exiting after successful completion (standalone mode)');
      process.exit(0);
    }, EXIT_DELAY_MS);
  } else {
    log('Completed processing request (pipe mode) - staying alive for additional requests');
  }
}

// Gracefully handle errors when writing to stdout
function safeWrite(data: string): void {
  try {
    // Only write to stdout if it's valid JSON-RPC
    process.stdout.write(data + '\n');
  } catch (error) {
    // If we get EPIPE, the other end has closed the pipe
    const err = error as any;
    if (err instanceof Error && err.code === 'EPIPE') {
      log('Pipe has been closed, exiting gracefully');
      process.exit(0);
    } else {
      log(`Error writing to stdout: ${error instanceof Error ? error.message : String(error)}`);
      // For other errors, don't exit but log the issue
    }
  }
}

// Send error response conforming to JSON-RPC 2.0 with safe write
function sendErrorResponse(
  message: string, 
  errorType: string = "invalid_request", 
  code: number = -32600, 
  id: string = "error-" + Date.now()
): void {
  const errorResponse: JsonRpcResponse = {
    jsonrpc: "2.0",
    id: id,
    error: {
      code: code,
      message: errorType,
      data: message
    }
  };
  
  log(`Sending error response: ${JSON.stringify(errorResponse)}`);
  safeWrite(JSON.stringify(errorResponse));
}

// Process request to ensure it has the correct JSON-RPC 2.0 structure
function processRequest(request: string | JsonRpcRequest): JsonRpcRequest | null {
  log(`Processing request: ${JSON.stringify(request).substring(0, 100)}...`);
  
  try {
    let processedRequest: JsonRpcRequest;
    
    // For plain text input, create a proper request structure
    if (typeof request === 'string') {
      processedRequest = {
        jsonrpc: "2.0",
        id: Date.now().toString(),
        method: "mcp.invoke",
        params: {
          tool: "generateImage",
          parameters: {
            prompt: request.trim()
          }
        }
      };
    } else {
      processedRequest = request;
    }
    
    // Ensure request has the correct structure
    if (!processedRequest.jsonrpc) processedRequest.jsonrpc = "2.0";
    if (!processedRequest.id) processedRequest.id = Date.now().toString();
    
    // If no method, set to mcp.invoke
    if (!processedRequest.method) {
      processedRequest.method = "mcp.invoke";
    }
    
    // Process params
    if (!processedRequest.params) {
      // Try to build params from different sources
      if (processedRequest.prompt || processedRequest.parameters) {
        processedRequest.params = {
          tool: "generateImage",
          parameters: processedRequest.prompt 
            ? { prompt: processedRequest.prompt } 
            : (processedRequest.parameters || {})
        };
      } else {
        // No usable parameters found
        log('No usable parameters found in request');
        return null;
      }
    }
    
    log(`Processed request: ${JSON.stringify(processedRequest).substring(0, 150)}...`);
    return processedRequest;
  } catch (error) {
    log(`Error processing request: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// Function to send proper JSON-RPC 2.0 formatted responses
function sendJsonRpcResponse(id: string, result: any, isError: boolean = false): void {
  try {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: id,
      result: result
    };
    
    // Ensure we're sending a valid JSON string followed by newline
    log(`Sending JSON-RPC response for id: ${id}, isError: ${isError}`);
    safeWrite(JSON.stringify(response));
  } catch (error) {
    log(`Error creating JSON-RPC response: ${error instanceof Error ? error.message : String(error)}`);
    
    // Fallback to a simpler response format
    try {
      const fallbackResponse: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: id,
        result: {
          content: [{
            type: 'text',
            text: isError 
              ? `Error generating image: ${error instanceof Error ? error.message : String(error)}`
              : 'Image generation completed, but there was an error creating the response'
          }],
          isError: isError
        }
      };
      safeWrite(JSON.stringify(fallbackResponse));
    } catch (secondError) {
      log(`Critical error sending response: ${secondError instanceof Error ? secondError.message : String(secondError)}`);
    }
  }
}

// Process plain text input from MCP Bridge
async function handleImageGeneration(parameters: ImageGenerationParameters, requestId: string): Promise<void> {
  if (hasRequestBeenProcessed(requestId)) {
    log(`Duplicate request ID detected and skipped: ${requestId}`);
    return;
  }

  // Process only once per request ID
  markRequestAsProcessed(requestId);
  
  // Set processing flag to prevent early exit
  isProcessing = true;
  
  try {
    log(`Handling image generation request ID: ${requestId}`);
    
    // Ensure we have a prompt
    const userParams = parameters || {};
    
    // Extract prompt if it's the only parameter (for random_string from Cursor)
    if (userParams.random_string && Object.keys(userParams).length === 1) {
      userParams.prompt = userParams.random_string;
      delete userParams.random_string;
    }
    
    // Check prompt for duplication only for similar prompts
    // Skip duplication check if this is a retry or has additional parameters
    if (Object.keys(userParams).length <= 1 && 
        isPromptDuplicate(userParams.prompt) && 
        !requestId.includes('retry')) {
      log(`Duplicate prompt detected for request ${requestId}, skipping`);
      return sendJsonRpcResponse(requestId, createErrorResponse('Duplicate request detected and skipped'));
    }
    
    log(`Generating image for prompt: ${JSON.stringify(userParams).substring(0, 100)}...`);
    
    // Generate image with retry logic
    const result: ImageGenerationResult = await drawThingsService.generateImage(userParams);
    
    // Handle generation result
    if (result.isError) {
      log(`Error generating image: ${result.errorMessage}`);
      return sendJsonRpcResponse(requestId, createErrorResponse(result.errorMessage || 'Unknown error'), true);
    }
    
    if (!result.imageData && (!result.images || result.images.length === 0)) {
      log('No image data returned from generation');
      return sendJsonRpcResponse(requestId, createErrorResponse('No image data returned from generation'), true);
    }
    
    const imageData = result.imageData || (result.images && result.images.length > 0 ? result.images[0] : undefined);
    if (!imageData) {
      log('No valid image data available');
      return sendJsonRpcResponse(requestId, createErrorResponse('No valid image data available'), true);
    }
    
    // Save image to file system
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const prompt = userParams.prompt || 'generated-image';
      const safePrompt = prompt.substring(0, 30).replace(/[^a-zA-Z0-9]/g, '_');
      const imagePath = path.join('images', `${safePrompt}_${timestamp}.png`);
      
      // Save image to file system
      await saveImage(imageData, imagePath);
      log(`Successfully saved image to file system: ${imagePath}`);
      
      // Return response with image data
      log('Preparing to return MCP response with image data');
      const imageResponse: ImageResponse = createImageResponse(imageData);
      
      // Add file path to response
      imageResponse.imageSavedPath = imagePath;
      
      // Send JSON-RPC 2.0 formatted response
      sendJsonRpcResponse(requestId, imageResponse);
      log('MCP response sent');
    } catch (saveError) {
      log(`Error saving image: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
      return sendJsonRpcResponse(requestId, createErrorResponse(`Failed to save image: ${saveError instanceof Error ? saveError.message : String(saveError)}`), true);
    }
  } catch (error) {
    log(`Error handling image generation: ${error instanceof Error ? error.message : String(error)}`);
    await logError(error);
    
    // Send error response in JSON-RPC 2.0 format
    sendJsonRpcResponse(requestId, createErrorResponse(`Internal error: ${error instanceof Error ? error.message : String(error)}`), true);
  } finally {
    // Signal that the request is complete
    processComplete(true);
  }
}

// Print connection information and help message on startup
function printConnectionInfo(): void {
  // Only print to stderr to avoid polluting JSON-RPC communication
  const infoText = `
---------------------------------------------
| Draw Things MCP - Image Generation Service |
---------------------------------------------

Attempting to connect to Draw Things API at:
    http://127.0.0.1:7888

TROUBLESHOOTING TIPS:
1. Ensure Draw Things is running on your computer
2. Make sure the API is enabled in Draw Things settings
3. If you changed the default port in Draw Things, set the environment variable:
   DRAW_THINGS_API_URL=http://127.0.0.1:YOUR_PORT 

Starting service...
`;
  
  // Log to file and stderr
  log(infoText);
}

// Simplified main program
async function main(): Promise<void> {
  try {
    log('Starting Draw Things MCP service...');
    
    // Print connection info to the console
    printConnectionInfo();
    
    log('Initializing Draw Things MCP service');
    
    // Enhanced API connection verification with direct method
    log('Checking Draw Things API connection before starting service...');
    const apiPort = process.env.DRAW_THINGS_API_PORT || 7888;
    
    // Verify direct connection
    log(`Checking direct connection to API on port ${apiPort}...`);
    const checkApiConnection = async (): Promise<boolean> => {
      try {
        const options: http.RequestOptions = {
          host: '127.0.0.1',
          port: Number(apiPort),
          path: '/sdapi/v1/options',
          method: 'GET',
          timeout: 5000,
          headers: {
            'User-Agent': 'DrawThingsMCP/1.0',
            'Accept': 'application/json'
          }
        };

        return new Promise((resolve) => {
          const req = http.request(options, (res) => {
            log(`API connection response: ${res.statusCode}`);
            resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300);
          });

          req.on('error', (e) => {
            log(`API connection error: ${e.message}`);
            resolve(false);
          });

          req.on('timeout', () => {
            log('API connection timeout');
            req.destroy();
            resolve(false);
          });

          req.end();
        });
      } catch (error) {
        log(`Error during API check: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    };

    // Try connection method
    const connectionOk = await checkApiConnection();
    log(`API connection result: ${connectionOk ? 'SUCCESS' : 'FAILED'}`);

    // Set connection method
    if (connectionOk) {
      log('Using direct connection to Draw Things API');
      drawThingsService.baseUrl = `http://127.0.0.1:${apiPort}`;
      drawThingsService.axios.defaults.baseURL = drawThingsService.baseUrl;
    } else {
      log('Could not establish connection to Draw Things API');
    }

    // Final drawThingsService connection check
    const isApiConnected = await drawThingsService.checkApiConnection();
    if (!isApiConnected) {
      log('\nFAILED TO CONNECT TO DRAW THINGS API');
      log('Please make sure Draw Things is running and the API is enabled.');
      log('The service will continue running, but image generation will not work until the API is available.\n');
      
      // Still continue - the service should auto-retry on each request
      log('Continuing despite connection failure - will retry on each request');
    } else {
      log('\nSUCCESSFULLY CONNECTED TO DRAW THINGS API');
      log('The service is ready to generate images.\n');
    }

    const transport = new StdioServerTransport();
    
    // Handle SIGINT signal (Ctrl+C)
    process.on('SIGINT', async () => {
      log('\nReceived SIGINT. Closing server...');
      try {
        await transport.close();
        process.exit(0);
      } catch (error) {
        log(`Error closing server: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
    
    // Handle EPIPE specially
    process.on('EPIPE', () => {
      log('EPIPE signal received - pipe has been closed');
      process.exit(0);
    });
    
    // Handle broken pipe specifically
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        log('Broken pipe detected on stdout');
        process.exit(0);
      } else {
        log(`stdout error: ${err.message}`);
      }
    });
    
    // Set up readline interface for line-by-line processing
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });
    
    // Listen for line input (for plain text and simple JSON formats)
    rl.on('line', (line: string) => {
      if (!line || line.trim() === '') return;
      
      log(`Received line input: ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`);
      
      // Set processing flag to prevent early exit
      isProcessing = true;
      
      // Clear any existing exit timer
      if (exitDelayTimer) {
        clearTimeout(exitDelayTimer);
        exitDelayTimer = null;
      }
      
      // Check if input is already in JSON format
      try {
        const jsonInput = JSON.parse(line);
        log('Input is valid JSON, checking if it conforms to JSON-RPC 2.0 standard');
        
        // Check if it conforms to JSON-RPC 2.0 standard
        if (jsonInput.jsonrpc === "2.0" && jsonInput.method && jsonInput.id) {
          log('Input already conforms to JSON-RPC 2.0 standard, forwarding directly');
          
          // Process mcp.invoke method directly
          if (jsonInput.method === 'mcp.invoke' && jsonInput.params && jsonInput.params.tool) {
            const { tool, parameters } = jsonInput.params;
            
            if (tool === 'generateImage') {
              handleImageGeneration(parameters, jsonInput.id);
            } else {
              // Unsupported tool
              sendErrorResponse(`Tool not found: ${tool}`, "method_not_found", -32601, jsonInput.id);
              processComplete(false);
            }
          } else {
            // Let the MCP SDK handle other methods
            safeWrite(line);
            // For non-image generation methods, mark as complete immediately
            processComplete(true);
          }
        } else {
          log('JSON format is valid but does not conform to JSON-RPC 2.0 standard, converting');
          const processedRequest = processRequest(jsonInput);
          if (processedRequest) {
            if (processedRequest.method === 'mcp.invoke' && 
                processedRequest.params && 
                processedRequest.params.tool === 'generateImage') {
              handleImageGeneration(processedRequest.params.parameters, processedRequest.id);
            } else {
              safeWrite(JSON.stringify(processedRequest));
              // For non-image generation methods, mark as complete immediately
              processComplete(true);
            }
          } else {
            processComplete(false);
          }
        }
      } catch (e) {
        log(`Input is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
        
        // Check if it's a plain text prompt
        if (line && typeof line === 'string' && !line.startsWith('{')) {
          log('Detected plain text prompt, converting to JSON-RPC request');
          
          // Check for duplicate prompt content to prevent multiple processing
          if (isPromptDuplicate(line.trim())) {
            log(`Duplicate plain text prompt detected, skipping: "${line.trim().substring(0, 30)}..."`);
            processComplete(false);
            return;
          }
          
          // Create request conforming to JSON-RPC 2.0 standard
          const request: JsonRpcRequest = {
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
          
          // Process the image generation request directly
          handleImageGeneration(request.params && request.params.parameters ? request.params.parameters : {}, request.id);
        } else {
          log('Unrecognized input format, cannot process');
          sendErrorResponse('Unrecognized input format', "parse_error", -32700);
          processComplete(false);
        }
      }
    });
    
    // Add direct JSON-RPC handling for raw data (binary or chunked data)
    process.stdin.on('data', async (chunk: Buffer) => {
      // This handler will only process data that wasn't handled by the readline interface
      // It's mainly for handling binary data or chunked JSON that might not end with newlines
      const data = chunk.toString().trim();
      
      // Skip empty data or data that will be handled by readline
      if (!data || data.includes('\n')) return;
      
      log(`[DEBUG] Received raw input: ${data.substring(0, 100)}${data.length > 100 ? '...' : ''}`);
      
      // Set processing flag to prevent early exit
      isProcessing = true;
      
      // Clear any existing exit timer
      if (exitDelayTimer) {
        clearTimeout(exitDelayTimer);
        exitDelayTimer = null;
      }
      
      try {
        const jsonData = JSON.parse(data) as JsonRpcRequest;
        log(`[DEBUG] Parsed JSON from raw data: method=${jsonData.method}, id=${jsonData.id}`);
        
        // Only process if not already handled by readline
        if (jsonData.method === 'mcp.invoke' && jsonData.params && jsonData.params.tool) {
          const { tool, parameters } = jsonData.params;
          log(`[DEBUG] Handling direct request for tool: ${tool}`);
          
          // Check if it's the generateImage tool
          if (tool === 'generateImage') {
            handleImageGeneration(parameters, jsonData.id);
          } else {
            // Unsupported tool
            sendErrorResponse(`Tool not found: ${tool}`, "method_not_found", -32601, jsonData.id);
            processComplete(false);
          }
        } else {
          // Not a tool invocation, mark as complete
          processComplete(true);
        }
      } catch (e) {
        // Ignore parsing errors here as they'll be handled by readline
      }
    });
  } catch (error) {
    log(`Error in main program: ${error instanceof Error ? error.message : String(error)}`);
    await logError(error);
    process.exit(1);
  }
}

main();