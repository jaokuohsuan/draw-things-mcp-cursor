#!/usr/bin/env node

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
import http from 'http';
import httpProxy from 'http-proxy';

// Get current directory path
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set up log file
const logFile = 'draw-things-mcp.log';
// Add debug mode flag
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

function log(message) {
	const timestamp = new Date().toISOString();
	const logMessage = `${timestamp} - ${message}\n`;
	try {
		fs.appendFileSync(logFile, logMessage);
		console.error(logMessage); // Also output to stderr for debugging
	} catch (error) {
		// Fallback if file writing fails
		console.error(`${timestamp} - [ERROR] Failed to write to log file: ${error.message}`);
		console.error(logMessage);
	}
}

// Initialize log
log('Draw Things MCP Service started');
log('Waiting for input...');

// Setup API proxy server to overcome local connection restrictions
function startApiProxyServer() {
	// Create API proxy with enhanced configuration
	const proxy = httpProxy.createProxyServer({
		target: {
			host: '127.0.0.1',
			port: 7888,
			protocol: 'http:'
		},
		changeOrigin: true,
		ws: true,
		xfwd: false,
		secure: false,
		// Enhanced headers for better connectivity
		headers: {
			"X-Forwarded-Host": "localhost:7888",
			"X-Forwarded-Proto": "http",
			"X-Forwarded-For": "127.0.0.1",
			"Host": "127.0.0.1:7888",
			"Origin": "http://127.0.0.1:7888",
			"Connection": "keep-alive",
			"Accept": "application/json",
			"Content-Type": "application/json",
			"User-Agent": "DrawThingsMCP/1.0" // Added User-Agent
		},
		// Increase proxy timeout settings for more stability
		proxyTimeout: 240000, // 4 minutes
		timeout: 240000, // 4 minutes
		// Add additional options for stability
		autoRewrite: true,
		followRedirects: true,
		selfHandleResponse: false,
		// Additional options for reliability
		ignorePath: false,
		prependPath: false,
		toProxy: false,
		preserveHeaderKeyCase: true,
		localAddress: '127.0.0.1'
	});
	
	// Create proxy server with enhanced error handling
	const proxyPort = process.env.PROXY_PORT || 7889;
	const maxRetries = 3;
	
	const proxyServer = http.createServer(async (req, res) => {
		// Log request for debugging
		log(`Proxy received request: ${req.method} ${req.url}`);
		
		// Enhanced CORS headers
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
		res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization');
		res.setHeader('Access-Control-Allow-Credentials', true);
		
		// Handle preflight requests
		if (req.method === 'OPTIONS') {
			res.writeHead(200);
			res.end();
			return;
		}
		
		// Add retry mechanism for failed requests
		const handleRequest = async (retryAttempt = 0) => {
			try {
				// Add custom headers for better connectivity
				req.headers['accept'] = 'application/json';
				req.headers['content-type'] = 'application/json';
				if (!req.headers['x-requested-with']) {
					req.headers['x-requested-with'] = 'XMLHttpRequest';
				}
				
				// Route request through proxy with promise wrapper
				await new Promise((resolve, reject) => {
					proxy.web(req, res, {}, (err) => {
						if (err) {
							reject(err);
						} else {
							resolve();
						}
					});
				});
			} catch (err) {
				if (retryAttempt < maxRetries) {
					log(`Retry attempt ${retryAttempt + 1} of ${maxRetries}`);
					await new Promise(resolve => setTimeout(resolve, 1000 * (retryAttempt + 1)));
					return handleRequest(retryAttempt + 1);
				}
				log(`Proxy error after ${maxRetries} retries: ${err.message}`);
				if (!res.headersSent) {
					res.writeHead(502);
					res.end(`Proxy error: ${err.message}`);
				}
			}
		};
		
		await handleRequest(0);
	});
	
	// Enhanced error handling for proxy
	proxy.on('error', (err, req, res) => {
		log(`Proxy error: ${err.message}`);
		if (res && !res.headersSent) {
			res.writeHead(502);
			res.end(`Proxy error: ${err.message}`);
		}
	});
	
	// Enhanced error handling for proxy server
	proxyServer.on('error', (err) => {
		log(`Proxy server error: ${err.message}`);
		if (err.code === 'EADDRINUSE') {
			log(`Port ${proxyPort} is in use, trying to close existing connection...`);
			setTimeout(() => {
				proxyServer.close();
				proxyServer.listen(proxyPort);
			}, 1000);
		}
	});
	
	// Start server with connection monitoring
	proxyServer.listen(proxyPort, () => {
		log(`API proxy server running on http://localhost:${proxyPort}`);
		log(`Proxying requests to http://127.0.0.1:7888`);
		
		// Update DrawThingsService baseUrl to use proxy
		drawThingsService.baseUrl = `http://localhost:${proxyPort}`;
		drawThingsService.axios.defaults.baseURL = drawThingsService.baseUrl;
		log(`Updated Draw Things Service to use proxy URL: ${drawThingsService.baseUrl}`);
		
		// Monitor proxy server status
		setInterval(() => {
			const activeConnections = proxyServer._connections;
			log(`Active proxy connections: ${activeConnections}`);
		}, 30000);
	});
	
	return proxyServer;
}

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
	description: 'Draw Things MCP Server for generating images via Draw Things API'
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
const EXIT_DELAY_MS = 300000; // 5 minutes waiting time after successful completion
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
		// For plain text input, create a proper request structure
		if (typeof request === 'string') {
			request = {
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
		}
		
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
				log('No usable parameters found in request');
				return null;
			}
		}
		
		log(`Processed request: ${JSON.stringify(request).substring(0, 150)}...`);
		return request;
	} catch (error) {
		log(`Error processing request: ${error.message}`);
		return null;
	}
}

// Correctly register MCP tool - fix tool registration format
server.tool(
	"generateImage", 
	"Generate an image using Draw Things API",
	{
		prompt: z.string().optional().describe("The prompt to generate an image from"),
		negative_prompt: z.string().optional().describe("Negative prompt to guide what not to include"),
		seed: z.number().optional().describe("Random seed for reproducibility"),
		width: z.number().optional().describe("Width of the generated image"),
		height: z.number().optional().describe("Height of the generated image"),
		num_inference_steps: z.number().min(4).max(50).optional().describe("Number of inference steps"),
		guidance_scale: z.number().optional().describe("Guidance scale for generation"),
		model: z.string().optional().describe("Model to use for generation"),
		random_string: z.string().optional().describe("Dummy parameter for no-parameter tools")
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

// Enhanced error logging to dedicated error log file
async function logError(error) {
	try {
		// Ensure logs directory exists
		const logsDir = path.join(process.cwd(), 'logs');
		if (!fs.existsSync(logsDir)) {
			try {
				fs.mkdirSync(logsDir, { recursive: true });
				log(`Created logs directory: ${logsDir}`);
			} catch (mkdirError) {
				console.error(`Failed to create logs directory: ${mkdirError.message}`);
				// Continue anyway - we'll try to write to the file and handle any errors
			}
		}
		
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
				console.error(`Failed to write to error log: ${syncWriteError.message}`);
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

// Function to always send proper JSON-RPC 2.0 formatted responses
function sendJsonRpcResponse(id, result, isError = false) {
	try {
		const response = {
			jsonrpc: "2.0",
			id: id,
			result: result
		};
		
		// Ensure we're sending a valid JSON string followed by newline
		log(`Sending JSON-RPC response for id: ${id}, isError: ${isError}`);
		safeWrite(JSON.stringify(response));
	} catch (error) {
		log(`Error creating JSON-RPC response: ${error.message}`);
		
		// Fallback to a simpler response format
		try {
			const fallbackResponse = {
				jsonrpc: "2.0",
				id: id,
				result: {
					content: [{
						type: 'text',
						text: isError 
							? `Error generating image: ${error.message}`
							: 'Image generation completed, but there was an error creating the response'
					}],
					isError: isError
				}
			};
			safeWrite(JSON.stringify(fallbackResponse));
		} catch (secondError) {
			log(`Critical error sending response: ${secondError.message}`);
		}
	}
}

// Process plain text input from MCP Bridge
async function handleImageGeneration(parameters, requestId) {
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
		const result = await drawThingsService.generateImage(userParams);
		
		// Handle generation result
		if (result.isError) {
			log(`Error generating image: ${result.errorMessage}`);
			return sendJsonRpcResponse(requestId, createErrorResponse(result.errorMessage), true);
		}
		
		if (!result.imageData) {
			log('No image data returned from generation');
			return sendJsonRpcResponse(requestId, createErrorResponse('No image data returned from generation'), true);
		}
		
		// Save image to file system
		try {
			const timestamp = new Date().toISOString().replace(/:/g, '-');
			const prompt = userParams.prompt || 'generated-image';
			const safePrompt = prompt.substring(0, 30).replace(/[^a-zA-Z0-9]/g, '_');
			const imagePath = path.join('images', `${safePrompt}_${timestamp}.png`);
			
			// Save image to file system
			await saveImage(result.imageData, imagePath);
			log(`Successfully saved image to file system: ${imagePath}`);
			
			// Return response with image data
			log('Preparing to return MCP response with image data');
			const imageResponse = createImageResponse(result.imageData);
			
			// Add file path to response
			imageResponse.imageSavedPath = imagePath;
			
			// Send JSON-RPC 2.0 formatted response
			sendJsonRpcResponse(requestId, imageResponse);
			log('MCP response sent');
		} catch (saveError) {
			log(`Error saving image: ${saveError.message}`);
			return sendJsonRpcResponse(requestId, createErrorResponse(`Failed to save image: ${saveError.message}`), true);
		}
	} catch (error) {
		log(`Error handling image generation: ${error.message}`);
		await logError(error);
		
		// Send error response in JSON-RPC 2.0 format
		sendJsonRpcResponse(requestId, createErrorResponse(`Internal error: ${error.message}`), true);
	} finally {
		// Signal that the request is complete
		processComplete(true);
	}
}

// Simplified main program
async function main() {
	try {
		log('Starting Draw Things MCP service...');
		
		// Print connection info to the console
		printConnectionInfo();
		
		log('Initializing Draw Things MCP service');
		
		// Start API proxy server first to ensure connectivity
		log('Starting API proxy server...');
		const proxyServer = startApiProxyServer();
		
		// Enhanced API connection verification with multiple methods
		log('Checking Draw Things API connection before starting service...');
		const apiPort = process.env.DRAW_THINGS_API_PORT || 7888;
		const apiProxyPort = process.env.PROXY_PORT || 7889;
		
		// Verify direct connection first
		log(`Checking direct connection to API on port ${apiPort}...`);
		const directApiCheck = async () => {
			try {
				const options = {
					host: '127.0.0.1',
					port: apiPort,
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
						log(`Direct API connection response: ${res.statusCode}`);
						resolve(res.statusCode >= 200 && res.statusCode < 300);
					});

					req.on('error', (e) => {
						log(`Direct API connection error: ${e.message}`);
						resolve(false);
					});

					req.on('timeout', () => {
						log('Direct API connection timeout');
						req.destroy();
						resolve(false);
					});

					req.end();
				});
			} catch (error) {
				log(`Error during direct API check: ${error.message}`);
				return false;
			}
		};

		// Verify proxy connection
		log(`Checking proxy connection to API on port ${apiProxyPort}...`);
		const proxyApiCheck = async () => {
			try {
				const options = {
					host: 'localhost',
					port: apiProxyPort,
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
						log(`Proxy API connection response: ${res.statusCode}`);
						resolve(res.statusCode >= 200 && res.statusCode < 300);
					});

					req.on('error', (e) => {
						log(`Proxy API connection error: ${e.message}`);
						resolve(false);
					});

					req.on('timeout', () => {
						log('Proxy API connection timeout');
						req.destroy();
						resolve(false);
					});

					req.end();
				});
			} catch (error) {
				log(`Error during proxy API check: ${error.message}`);
				return false;
			}
		};

		// Try both connection methods
		const directConnectionOk = await directApiCheck();
		log(`Direct API connection result: ${directConnectionOk ? 'SUCCESS' : 'FAILED'}`);

		// Wait a moment for the proxy to initialize
		await new Promise(resolve => setTimeout(resolve, 2000));

		const proxyConnectionOk = await proxyApiCheck();
		log(`Proxy API connection result: ${proxyConnectionOk ? 'SUCCESS' : 'FAILED'}`);

		// Set preferred connection method
		if (directConnectionOk) {
			log('Using direct connection to Draw Things API');
			drawThingsService.baseUrl = `http://127.0.0.1:${apiPort}`;
			drawThingsService.axios.defaults.baseURL = drawThingsService.baseUrl;
		} else if (proxyConnectionOk) {
			log('Using proxy connection to Draw Things API');
			drawThingsService.baseUrl = `http://localhost:${apiProxyPort}`;
			drawThingsService.axios.defaults.baseURL = drawThingsService.baseUrl;
		} else {
			log('Neither direct nor proxy connection could be established');
		}

		// Final drawThingsService connection check
		const isApiConnected = await drawThingsService.checkApiConnection();
		if (!isApiConnected) {
			console.error('\nFAILED TO CONNECT TO DRAW THINGS API');
			console.error('Please make sure Draw Things is running and the API is enabled.');
			console.error('The service will continue running, but image generation will not work until the API is available.\n');
			
			// Still continue - the service should auto-retry on each request
			log('Continuing despite connection failure - will retry on each request');
		} else {
			console.error('\nSUCCESSFULLY CONNECTED TO DRAW THINGS API');
			console.error('The service is ready to generate images.\n');
		}

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

// Print connection information and help message on startup
function printConnectionInfo() {
	console.error('\n---------------------------------------------');
	console.error('| Draw Things MCP - Image Generation Service |');
	console.error('---------------------------------------------\n');
	console.error('Attempting to connect to Draw Things API at:');
	console.error('    http://127.0.0.1:7888\n');
	console.error('TROUBLESHOOTING TIPS:');
	console.error('1. Ensure Draw Things is running on your computer');
	console.error('2. Make sure the API is enabled in Draw Things settings');
	console.error('3. If you changed the default port in Draw Things, set the environment variable:');
	console.error('   DRAW_THINGS_API_URL=http://127.0.0.1:YOUR_PORT \n');
	console.error('Starting service...\n');
}
