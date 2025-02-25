#!/usr/bin/env node

/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

/**
 * Draw Things MCP - A Model Context Protocol implementation for Draw Things API
 * Integrated with Cursor MCP Bridge functionality for multiple input formats
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DrawThingsService } from './services/drawThings/drawThingsService.js';
import { ImageGenerationParamsSchema } from './services/drawThings/schemas.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { z } from 'zod';

// Get current directory path
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set up log file
const logFile = 'draw-things-mcp.log';
function log(message) {
	const timestamp = new Date().toISOString();
	const logMessage = `${timestamp} - ${message}\n`;
	fs.appendFileSync(logFile, logMessage);
	console.error(logMessage); // Also output to stderr for debugging
}

// Initialize log
log('Draw Things MCP Service started');
log('Waiting for input...');

// Helper function to save images to the file system
async function saveImage(base64Data, outputPath) {
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
		log(`Failed to save image: ${error.message}`);
		log(error.stack);
		throw error;
	}
}

// Create MCP server
const server = new McpServer({
	name: 'draw-things-mcp',
	version: '1.3.0',
	description: 'Draw Things MCP Server with integrated input format handling'
});

// Create service instance
const drawThingsService = new DrawThingsService();

// Helper function to create error response
function createErrorResponse(message) {
	return {
		content: [{
			type: 'text',
			text: message
		}],
		isError: true
	};
}

// Helper function to create image response
function createImageResponse(imageData) {
	return {
		content: [{
			type: 'image',
			data: imageData,
			mimeType: 'image/png'
		}]
	};
}

// Used to track whether we have an active request
let isProcessing = false;
let exitDelayTimer = null;
const EXIT_DELAY_MS = 3000; // 3 seconds waiting time after successful completion
let isPipeMode = false; // Flag to indicate if running in pipe mode

// Track processed request IDs to avoid duplicate processing
const processedRequestIds = new Set();
const processedPrompts = new Map(); // Track processed prompts with timestamps
const REQUEST_HISTORY_LIMIT = 100; // Limit the size of our history to prevent memory leaks
const PROMPT_HISTORY_EXPIRE_MS = 60000; // 60 seconds expiry for prompt history

// Helper to prevent duplicate request processing
function markRequestAsProcessed(requestId) {
	// Add to processed set
	processedRequestIds.add(requestId);
	
	// Keep set size limited
	if (processedRequestIds.size > REQUEST_HISTORY_LIMIT) {
		// Remove oldest entry (first item in the set)
		const oldestId = processedRequestIds.values().next().value;
		processedRequestIds.delete(oldestId);
	}
}

function hasRequestBeenProcessed(requestId) {
	return processedRequestIds.has(requestId);
}

// Helper to track and prevent duplicate prompt processing
function isPromptDuplicate(promptContent) {
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
	if (processedPrompts.has(normalizedPrompt)) {
		log(`Duplicate prompt detected: "${normalizedPrompt.substring(0, 30)}..."`);
		return true;
	}
	
	// Add to processed prompts with current timestamp
	processedPrompts.set(normalizedPrompt, now);
	
	// Keep map size limited
	if (processedPrompts.size > REQUEST_HISTORY_LIMIT) {
		// Remove oldest entry (first item in the map)
		const oldestPrompt = processedPrompts.keys().next().value;
		processedPrompts.delete(oldestPrompt);
	}
	
	return false;
}

// Check if running in pipe mode (stdin/stdout is not a TTY)
try {
	isPipeMode = !process.stdin.isTTY || !process.stdout.isTTY;
	if (process.env.DRAW_THINGS_FORCE_STAY_ALIVE === 'true') {
		isPipeMode = true;
	}
	log(`Process running in ${isPipeMode ? 'pipe' : 'standalone'} mode`);
} catch (e) {
	// If we can't check TTY status, assume we might be in pipe mode
	isPipeMode = true;
	log('Unable to determine TTY status, assuming pipe mode');
}

// Function to signal completion of a task
function processComplete(success) {
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
function safeWrite(data) {
	try {
		process.stdout.write(data + '\n');
	} catch (error) {
		// If we get EPIPE, the other end has closed the pipe
		if (error.code === 'EPIPE') {
			log('Pipe has been closed, exiting gracefully');
			process.exit(0);
		} else {
			log(`Error writing to stdout: ${error.message}`);
			// For other errors, don't exit but log the issue
		}
	}
}

// Send error response conforming to JSON-RPC 2.0 with safe write
function sendErrorResponse(message, errorType = "invalid_request", code = -32600, id = "error-" + Date.now()) {
	const errorResponse = {
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
		return request;
	} catch (error) {
		log(`Error processing request: ${error.message}`);
		sendErrorResponse(`Error processing request: ${error.message}`, "internal_error", -32603);
		return null;
	}
}

// Correctly register MCP tool - fix tool registration format
server.tool(
	"generateImage", 
	"Generate an image using Draw Things API",
	{
		prompt: z.string().describe("The prompt to generate an image from"),
		negative_prompt: z.string().optional().describe("Negative prompt to guide what not to include"),
		seed: z.number().optional().describe("Random seed for reproducibility"),
		width: z.number().optional().describe("Width of the generated image"),
		height: z.number().optional().describe("Height of the generated image"),
		num_inference_steps: z.number().min(4).max(50).optional().describe("Number of inference steps"),
		guidance_scale: z.number().optional().describe("Guidance scale for generation"),
		model: z.string().optional().describe("Model to use for generation")
	},
	async (params) => {
		log('Received generateImage request with params:', params);
		try {
			// Use Zod to validate parameters
			const parseResult = ImageGenerationParamsSchema.safeParse(params);
			log('Parameter validation result:', parseResult.success);
			
			if (!parseResult.success) {
				log('Parameter validation failed:', parseResult.error.format());
				return createErrorResponse(`Invalid parameters: ${parseResult.error.message}`);
			}

			// Pass validated parameters to the service
			const result = await drawThingsService.generateImage(parseResult.data);
			
			if (result.status >= 400) {
				log('Generation failed:', result.error);
				return createErrorResponse(result.error || 'Failed to generate image');
			}

			if (!result.images || result.images.length === 0) {
				log('No images generated');
				return createErrorResponse('No images generated');
			}

			// Save generated image to file
			try {
				const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
				const prompt = parseResult.data?.prompt || 'image';
				const filename = `${prompt.replace(/[^a-z0-9]/gi, '_').substring(0, 30)}_${timestamp}.png`;
				const outputPath = path.join('images', filename);
				await saveImage(result.images[0], outputPath);
				log(`Image successfully saved to: ${outputPath}`);

				// Ensure image is saved successfully before returning response
				log('Preparing to return MCP response with image data');
				return createImageResponse(result.images[0]);
			} catch (error) {
				log(`Failed to save image, but will still try to return response: ${error.message}`);
				// Even if saving to the file system fails, still return image data
				return createImageResponse(result.images[0]);
			}
		} catch (error) {
			log('Error in generateImage handler:', error);
			await logError(error);
			return createErrorResponse(error.message || 'Internal server error');
		}
	}
);

// Error logging function
async function logError(error) {
	try {
		const timestamp = new Date().toISOString();
		const errorMessage = `${timestamp} - ${error.stack || error}\n`;
		await fs.promises.appendFile('error.log', errorMessage);
	} catch (logError) {
		console.error('Failed to write error log:', logError);
	}
}

// Handle image generation request
async function handleImageGeneration(parameters, requestId) {
	try {
		// Check if this request has already been processed
		if (hasRequestBeenProcessed(requestId)) {
			log(`Request ${requestId} has already been processed, skipping`);
			return;
		}
		
		// Check for duplicate prompt content
		if (parameters && parameters.prompt && isPromptDuplicate(parameters.prompt)) {
			log(`Duplicate prompt detected for request ${requestId}, skipping`);
			return;
		}
		
		// Mark as processed
		markRequestAsProcessed(requestId);
		
		// Call image generation service
		const result = await drawThingsService.generateImage(parameters || {});
		
		if (result.status >= 400 || result.error) {
			// Return error response
			const errorMessage = result.error || 'Failed to generate image';
			const response = {
				jsonrpc: '2.0',
				id: requestId,
				result: createErrorResponse(errorMessage)
			};
			safeWrite(JSON.stringify(response));
			
			// Signal that the request is complete with error
			processComplete(false);
		} else if (result.images && result.images.length > 0) {
			// Save image to file system
			try {
				const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
				const prompt = parameters?.prompt || 'image';
				const filename = `${prompt.replace(/[^a-z0-9]/gi, '_').substring(0, 30)}_${timestamp}.png`;
				const outputPath = path.join('images', filename);
				await saveImage(result.images[0], outputPath);
				log(`Successfully saved image to file system: ${outputPath}`);
				
				// Ensure image is saved before returning response
				const response = {
					jsonrpc: '2.0',
					id: requestId,
					result: createImageResponse(result.images[0])
				};
				log('Preparing to return MCP response with image data');
				safeWrite(JSON.stringify(response));
				log('MCP response sent');
				
				// Signal that the request is complete successfully
				processComplete(true);
			} catch (saveError) {
				log(`Error saving image: ${saveError.message}`);
				
				// Return image response even if saving fails
				const response = {
					jsonrpc: '2.0',
					id: requestId,
					result: createImageResponse(result.images[0])
				};
				safeWrite(JSON.stringify(response));
				
				// Signal that the request is complete with partial success
				processComplete(true);
			}
		} else {
			// No images
			const response = {
				jsonrpc: '2.0',
				id: requestId,
				result: createErrorResponse('No images were generated')
			};
			safeWrite(JSON.stringify(response));
			
			// Signal that the request is complete with error
			processComplete(false);
		}
	} catch (error) {
		// Handle error
		log(`[ERROR] Error processing generateImage request: ${error.message}`);
		const response = {
			jsonrpc: '2.0',
			id: requestId,
			result: createErrorResponse(`Internal error: ${error.message}`)
		};
		safeWrite(JSON.stringify(response));
		
		// Signal that the request is complete with error
		processComplete(false);
	}
}

// Simplified main program
async function main() {
	try {
		log('Starting Draw Things MCP service...');
		log('Initializing Draw Things MCP service');
		
		const transport = new StdioServerTransport();
		
		// Handle SIGINT signal (Ctrl+C)
		process.on('SIGINT', async () => {
			log('\nReceived SIGINT. Closing server...');
			try {
				await transport.close();
				process.exit(0);
			} catch (error) {
				log('Error closing server:', error);
				process.exit(1);
			}
		});
		
		// Handle EPIPE specially
		process.on('EPIPE', () => {
			log('EPIPE signal received - pipe has been closed');
			process.exit(0);
		});
		
		// Handle broken pipe specifically
		process.stdout.on('error', (err) => {
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
		rl.on('line', (line) => {
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
				log(`Input is not valid JSON: ${e.message}`);
				
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
					
					// Process the image generation request directly
					handleImageGeneration(request.params.parameters, request.id);
				} else {
					log('Unrecognized input format, cannot process');
					sendErrorResponse('Unrecognized input format', "parse_error", -32700);
					processComplete(false);
				}
			}
		});
		
		// Add direct JSON-RPC handling for raw data (binary or chunked data)
		process.stdin.on('data', async (chunk) => {
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
				const jsonData = JSON.parse(data);
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
		
		// Handle errors
		process.on('uncaughtException', (error) => {
			log(`Uncaught error: ${error.message}`);
			log(error.stack);
			sendErrorResponse(`Error processing request: ${error.message}`, "internal_error", -32603);
			processComplete(false);
		});
		
		// Connect to MCP channel
		log('Connecting to MCP transport...');
		await server.connect(transport);
		log('MCP service is ready and accepting multiple input formats');
		log('Supported formats: Plain text prompts, JSON objects, and JSON-RPC 2.0 requests');
		log(`Service will ${isPipeMode ? 'stay alive (pipe mode)' : 'auto-exit after completion (standalone mode)'}`);
		
		// Set an initial timer to exit if no requests received after a certain time
		// But only if not running in pipe mode
		if (!isPipeMode) {
			exitDelayTimer = setTimeout(() => {
				if (!isProcessing) {
					log('No requests received, exiting...');
					process.exit(0);
				}
			}, EXIT_DELAY_MS);
		}
	} catch (error) {
		log('Failed to initialize MCP server:', error);
		await logError(error);
		process.exit(1);
	}
}

// Start service
main().catch(async (error) => {
	log('Unexpected error in MCP server:', error);
	await logError(error);
	process.exit(1);
});
