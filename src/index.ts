#!/usr/bin/env node

/**
 * Draw Things MCP - A Model Context Protocol implementation for Draw Things API
 * Integrated with Cursor MCP Bridge functionality for multiple input formats
 * 
 * NOTE: Requires Node.js version 14+ for optional chaining support in dependencies
 */

import path from 'path';
import fs from 'fs';
import http from 'http';
import { z } from 'zod';
import { fileURLToPath } from 'url';

// MCP SDK imports
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

// Local service imports
import { DrawThingsService } from './services/drawThings/drawThingsService.js';
import { ImageGenerationParamsSchema } from './services/drawThings/schemas.js';
import { 
  ImageGenerationParameters, 
  ImageGenerationResult 
} from './interfaces/index.js';

// Type-safe function declarations
function createErrorResponse(message: string): any {
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

function createImageResponse(imageData: string, imagePath: string): any {
  return {
    content: [{
      base64: imageData.replace(/^data:image\/png;base64,/, ''),
      path: imagePath,
      prompt: '',
      seed: 0,
      width: 0,
      height: 0,
      meta: {}
    }]
  };
}

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

// Main program
async function main(): Promise<void> {
  try {
    log('Starting Draw Things MCP service...');
    
    // Print connection info to the console
    printConnectionInfo();
    
    log('Initializing Draw Things MCP service');
    
    // Initialize DrawThingsService
    const drawThingsService = new DrawThingsService();
    
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
    } else {
      log('\nSUCCESSFULLY CONNECTED TO DRAW THINGS API');
      log('The service is ready to generate images.\n');
    }

    // Create MCP server instance
    const server = new McpServer({
      name: "draw-things-mcp",
      version: "1.0.0",
    });

    // Define the image generation tool schema
    const paramsSchema = {
      prompt: z.string().optional(),
      negative_prompt: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      steps: z.number().optional(),
      seed: z.number().optional(),
      guidance_scale: z.number().optional(),
      random_string: z.string().optional(),
    };

    // Register image generation tool
    server.tool(
      "generateImage",
      {...paramsSchema},
      async (extra) => {
        try {
          // Extract parameters from the request
          const parameters = extra.request.params.parameters as ImageGenerationParameters;
          log(`Processing generateImage request: ${JSON.stringify(parameters).substring(0, 100)}...`);
          
          // Generate image
          const result: ImageGenerationResult = await drawThingsService.generateImage(parameters);
          
          // Handle generation result
          if (result.isError) {
            log(`Error generating image: ${result.errorMessage}`);
            throw new Error(result.errorMessage || 'Unknown error');
          }
          
          if (!result.imageData && (!result.images || result.images.length === 0)) {
            log('No image data returned from generation');
            throw new Error('No image data returned from generation');
          }
          
          const imageData = result.imageData || (result.images && result.images.length > 0 ? result.images[0] : undefined);
          if (!imageData) {
            log('No valid image data available');
            throw new Error('No valid image data available');
          }
          
          // Save image to file system
          try {
            const timestamp = new Date().toISOString().replace(/:/g, '-');
            const prompt = parameters.prompt || 'generated-image';
            const safePrompt = prompt.substring(0, 30).replace(/[^a-zA-Z0-9]/g, '_');
            const imagePath = path.join('images', `${safePrompt}_${timestamp}.png`);
            
            // Save image
            await saveImage(imageData, imagePath);
            log(`Successfully saved image to file system: ${imagePath}`);
            
            // Return response with image data
            return createImageResponse(imageData, imagePath);
          } catch (saveError) {
            log(`Error saving image: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
            throw new Error(`Failed to save image: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
          }
        } catch (error) {
          log(`Error handling image generation: ${error instanceof Error ? error.message : String(error)}`);
          await logError(error);
          throw error;
        }
      }
    );

    // Create transport and connect server
    log('Creating transport and connecting server...');
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
    
    // Handle EPIPE error
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        log('Broken pipe detected on stdout');
        process.exit(0);
      } else {
        log(`stdout error: ${err.message}`);
      }
    });
    
    // Keep the process alive to prevent timeout
    const keepAliveInterval = setInterval(() => {
      // No operation, keep the process alive
    }, 30000);

    // Clean up on exit
    process.on('exit', () => {
      clearInterval(keepAliveInterval);
    });
    
    // Connect server to transport
    log('Connecting server to transport...');
    await server.connect(transport);
    log('MCP Server started successfully!');
    
  } catch (error) {
    log(`Error in main program: ${error instanceof Error ? error.message : String(error)}`);
    await logError(error);
    process.exit(1);
  }
}

// Start the server
main();