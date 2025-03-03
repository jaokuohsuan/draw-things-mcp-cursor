#!/usr/bin/env node

/**
 * Draw Things MCP - A Model Context Protocol implementation for Draw Things API
 * Integrated with Cursor MCP Bridge functionality for multiple input formats
 *
 * NOTE: Requires Node.js version 14+ for optional chaining support in dependencies
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { z } from "zod";

// MCP SDK imports
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

// Local service imports
import { DrawThingsService } from "./services/drawThingsService.js";
import {
  ImageGenerationParameters,
  ImageGenerationResult,
} from "./services/schemas.js";

// Constants and environment variables
const DEBUG_MODE: boolean = process.env.DEBUG_MODE === "true";
// Get current file path in ESM
const __filename = fileURLToPath(import.meta.url);
// Get directory name
const __dirname = path.dirname(__filename);
const projectRoot: string = path.resolve(__dirname, "..");
const logsDir: string = path.join(projectRoot, "logs");

// Create logs directory if it doesn't exist
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.error(`Created logs directory: ${logsDir}`);
  }
} catch (error) {
  console.error(
    `Failed to create logs directory: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}

const logFile: string = path.join(logsDir, "draw-things-mcp.log");

// Basic logging function
function log(message: string): void {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  try {
    fs.appendFileSync(logFile, logMessage);
    // Only output to stderr to avoid polluting JSON-RPC communication
    console.error(logMessage);
  } catch (error) {
    console.error(
      `Failed to write to log file: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

// Enhanced error logging to dedicated error log file
async function logError(error: Error | unknown): Promise<void> {
  try {
    const errorLogFile = path.join(logsDir, "error.log");
    const timestamp = new Date().toISOString();
    const errorDetails =
      error instanceof Error
        ? `${error.message}\n${error.stack}`
        : String(error);

    const errorLog = `${timestamp} - ERROR: ${errorDetails}\n\n`;

    try {
      await fs.promises.appendFile(errorLogFile, errorLog);

      log(`Error logged to ${errorLogFile}`);

      if (DEBUG_MODE) {
        console.error(`\n[DEBUG] FULL ERROR DETAILS:\n${errorDetails}\n`);
      }
    } catch (writeError) {
      // Fallback to sync writing
      try {
        fs.appendFileSync(errorLogFile, errorLog);
      } catch (syncWriteError) {
        console.error(
          `Failed to write to error log: ${
            syncWriteError instanceof Error
              ? syncWriteError.message
              : String(syncWriteError)
          }`
        );
        console.error(`Original error: ${errorDetails}`);
      }
    }
  } catch (logError) {
    console.error("Critical error in error logging system:");
    console.error(logError);
    console.error("Original error:");
    console.error(error);
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

const drawThingsService = new DrawThingsService();

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

server.tool(
  "generateImage",
  "Generate an image based on a prompt",
  paramsSchema,
  async (mcpParams: any) => {
    try {
      log("Received image generation request");
      log(`mcpParams====== ${JSON.stringify(mcpParams)}`);
      // handle ai prompts
      const parameters =
        mcpParams?.params?.arguments || mcpParams?.arguments || mcpParams || {};

      if (parameters.prompt) {
        log(`Using provided prompt: ${parameters.prompt}`);
      } else {
        log("No prompt provided, using default");
        parameters.prompt = "A cute dog";
      }

      // Generate image
      const result: ImageGenerationResult =
        await drawThingsService.generateImage(parameters);

      // Handle generation result
      if (result.isError) {
        log(`Error generating image: ${result.errorMessage}`);
        throw new Error(result.errorMessage || "Unknown error");
      }

      if (!result.imageData && (!result.images || result.images.length === 0)) {
        log("No image data returned from generation");
        throw new Error("No image data returned from generation");
      }

      const imageData =
        result.imageData ||
        (result.images && result.images.length > 0
          ? result.images[0]
          : undefined);
      if (!imageData) {
        log("No valid image data available");
        throw new Error("No valid image data available");
      }

      log("Successfully generated image, returning directly via MCP");

      // calculate the difference between the start and end time (example value)
      const startTime = Date.now() - 2000; // assume the image generation took 2 seconds
      const endTime = Date.now();

      // build the response format
      const responseData = {
        image_paths: result.imagePath ? [result.imagePath] : [],
        metadata: {
          alt: `Image generated from prompt: ${parameters.prompt}`,
          inference_time_ms:
            result.metadata?.inference_time_ms || endTime - startTime,
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(responseData, null, 2),
          },
        ],
      };
    } catch (error) {
      log(
        `Error handling image generation: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      await logError(error);
      throw error;
    }
  }
);

// Main program
async function main(): Promise<void> {
  try {
    log("Starting Draw Things MCP service...");

    // Print connection info to the console
    printConnectionInfo();

    log("Initializing Draw Things MCP service");

    // Enhanced API connection verification with direct method
    log("Checking Draw Things API connection before starting service...");
    const apiPort = process.env.DRAW_THINGS_API_PORT || 7888;

    // Final drawThingsService connection check
    const isApiConnected = await drawThingsService.checkApiConnection();
    if (!isApiConnected) {
      log("\nFAILED TO CONNECT TO DRAW THINGS API");
      log("Please make sure Draw Things is running and the API is enabled.");
      log(
        "The service will continue running, but image generation will not work until the API is available.\n"
      );
    } else {
      log("\nSUCCESSFULLY CONNECTED TO DRAW THINGS API");
      log("The service is ready to generate images.\n");
      drawThingsService.setBaseUrl(`http://127.0.0.1:${apiPort}`);
    }

    // Create transport and connect server
    log("Creating transport and connecting server...");
    const transport = new StdioServerTransport();

    // Connect server to transport
    log("Connecting server to transport...");
    await server.connect(transport);
    log("MCP Server started successfully!");
  } catch (error) {
    log(
      `Error in main program: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    await logError(error);
  }
}

main().catch(async (error) => {
  log("server.log", `${new Date().toISOString()} - ${error.stack || error}\n`);
  console.error(error);
  process.exit(1);
});
