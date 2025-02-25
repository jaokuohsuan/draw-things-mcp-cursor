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
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DrawThingsService } from './services/drawThings/drawThingsService.js';
import { ImageGenerationParamsSchema } from './services/drawThings/schemas.js';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

// Helper function to save images to the file system
async function saveImage(base64Data, outputPath) {
	try {
		// Ensure the images directory exists
		const imagesDir = path.dirname(outputPath);
		if (!fs.existsSync(imagesDir)) {
			await fs.promises.mkdir(imagesDir, { recursive: true });
			console.error(`Created images directory: ${imagesDir}`);
		}
		
		console.error(`Starting to save image, size: ${base64Data.length} characters`);
		const buffer = Buffer.from(base64Data, 'base64');
		console.error(`Image converted to buffer, size: ${buffer.length} bytes`);
		
		await fs.promises.writeFile(outputPath, buffer);
		console.error(`Image successfully saved to: ${outputPath}`);
		return outputPath;
	} catch (error) {
		console.error(`Failed to save image: ${error.message}`);
		console.error(error.stack);
		throw error;
	}
}

// Create MCP server
const server = new McpServer({
	name: 'draw-things-mcp',
	version: '1.2.4',
	description: 'Draw Things MCP Server'
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
		console.error('Received generateImage request with params:', params);
		try {
			// Use Zod to validate parameters
			const parseResult = ImageGenerationParamsSchema.safeParse(params);
			console.error('Parameter validation result:', parseResult.success);
			
			if (!parseResult.success) {
				console.error('Parameter validation failed:', parseResult.error.format());
				return createErrorResponse(`Invalid parameters: ${parseResult.error.message}`);
			}

			// Pass validated parameters to the service
			const result = await drawThingsService.generateImage(parseResult.data);
			
			if (result.status >= 400) {
				console.error('Generation failed:', result.error);
				return createErrorResponse(result.error || 'Failed to generate image');
			}

			if (!result.images || result.images.length === 0) {
				console.error('No images generated');
				return createErrorResponse('No images generated');
			}

			// Save generated image to file
			try {
				const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
				const prompt = parseResult.data?.prompt || 'image';
				const filename = `${prompt.replace(/[^a-z0-9]/gi, '_').substring(0, 30)}_${timestamp}.png`;
				const outputPath = path.join('images', filename);
				await saveImage(result.images[0], outputPath);
				console.error(`Image successfully saved to: ${outputPath}`);

				// Ensure image is saved successfully before returning response
				console.error('Preparing to return MCP response with image data');
				return createImageResponse(result.images[0]);
			} catch (error) {
				console.error(`Failed to save image, but will still try to return response: ${error.message}`);
				// Even if saving to the file system fails, still return image data
				return createImageResponse(result.images[0]);
			}
		} catch (error) {
			console.error('Error in generateImage handler:', error);
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

// Simplified main program
async function main() {
	try {
		console.error('Starting Draw Things MCP service...');
		console.error('Initializing Draw Things MCP service');
		
		const transport = new StdioServerTransport();
		
		// Handle SIGINT signal (Ctrl+C)
		process.on('SIGINT', async () => {
			console.error('\nReceived SIGINT. Closing server...');
			try {
				await transport.close();
				process.exit(0);
			} catch (error) {
				console.error('Error closing server:', error);
				process.exit(1);
			}
		});
		
		// Add direct JSON-RPC handling, bypassing official SDK processing
		process.stdin.on('data', async (chunk) => {
			const data = chunk.toString().trim();
			console.error(`[DEBUG] Received raw input: ${data.substring(0, 100)}${data.length > 100 ? '...' : ''}`);
			
			try {
				const jsonData = JSON.parse(data);
				console.error(`[DEBUG] Parsed JSON: method=${jsonData.method}, id=${jsonData.id}`);
				
				// Only process mcp.invoke method
				if (jsonData.method === 'mcp.invoke' && jsonData.params && jsonData.params.tool) {
					const { tool, parameters } = jsonData.params;
					console.error(`[DEBUG] Handling direct request for tool: ${tool}`);
					
					// Check if it's the generateImage tool
					if (tool === 'generateImage') {
						try {
							// Call image generation service
							const result = await drawThingsService.generateImage(parameters || {});
							
							if (result.status >= 400 || result.error) {
								// Return error response
								const errorMessage = result.error || 'Failed to generate image';
								const response = {
									jsonrpc: '2.0',
									id: jsonData.id,
									result: createErrorResponse(errorMessage)
								};
								process.stdout.write(JSON.stringify(response) + '\n');
							} else if (result.images && result.images.length > 0) {
								// Save image to file system
								try {
									const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
									const prompt = parameters?.prompt || 'image';
									const filename = `${prompt.replace(/[^a-z0-9]/gi, '_').substring(0, 30)}_${timestamp}.png`;
									const outputPath = path.join('images', filename);
									await saveImage(result.images[0], outputPath);
									console.error(`Successfully saved image to file system: ${outputPath}`);
									
									// Ensure image is saved before returning response
									const response = {
										jsonrpc: '2.0',
										id: jsonData.id,
										result: createImageResponse(result.images[0])
									};
									console.error('Preparing to return MCP response with image data');
									process.stdout.write(JSON.stringify(response) + '\n');
									console.error('MCP response sent');
								} catch (saveError) {
									console.error(`Error saving image: ${saveError.message}`);
									
									// Return image response even if saving fails
									const response = {
										jsonrpc: '2.0',
										id: jsonData.id,
										result: createImageResponse(result.images[0])
									};
									process.stdout.write(JSON.stringify(response) + '\n');
								}
							} else {
								// No images
								const response = {
									jsonrpc: '2.0',
									id: jsonData.id,
									result: createErrorResponse('No images were generated')
								};
								process.stdout.write(JSON.stringify(response) + '\n');
							}
						} catch (error) {
							// Handle error
							console.error(`[ERROR] Error processing generateImage request: ${error.message}`);
							const response = {
								jsonrpc: '2.0',
								id: jsonData.id,
								result: createErrorResponse(`Internal error: ${error.message}`)
							};
							process.stdout.write(JSON.stringify(response) + '\n');
						}
					} else {
						// Unsupported tool
						const response = {
							jsonrpc: '2.0',
							id: jsonData.id,
							error: {
								code: -32601,
								message: `Tool not found: ${tool}`
							}
						};
						process.stdout.write(JSON.stringify(response) + '\n');
					}
				} else if (jsonData.method === 'mcp.invoke') {
					// Incorrect request structure
					const response = {
						jsonrpc: '2.0',
						id: jsonData.id,
						error: {
							code: -32602,
							message: 'Invalid params for mcp.invoke'
						}
					};
					process.stdout.write(JSON.stringify(response) + '\n');
				}
				// Other methods will be handled by the SDK
			} catch (e) {
				console.error(`[DEBUG] Failed to parse or process input: ${e.message}`);
			}
		});
		
		// Connect to MCP channel
		console.error('Connecting to MCP transport...');
		await server.connect(transport);
		console.error('MCP service is ready');
	} catch (error) {
		console.error('Failed to initialize MCP server:', error);
		await logError(error);
		process.exit(1);
	}
}

// Start service
main().catch(async (error) => {
	console.error('Unexpected error in MCP server:', error);
	await logError(error);
	process.exit(1);
});
