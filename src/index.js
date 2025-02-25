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
import { ImageGenerationParamsSchema, McpResponseSchema } from './services/drawThings/schemas.js';
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
		}
		
		const buffer = Buffer.from(base64Data, 'base64');
		await fs.promises.writeFile(outputPath, buffer);
		console.log(`Image saved to: ${outputPath}`);
	} catch (error) {
		console.error('Error saving image:', error);
	}
}

// Create MCP server
const server = new McpServer({
	name: 'draw-things-mcp',
	version: '1.1.9',
	description: 'Draw Things MCP Server'
});

// Create service instance
const drawThingsService = new DrawThingsService();

// Helper function to create error response
function createErrorResponse(message) {
	return McpResponseSchema.parse({
		content: [{
			type: 'text',
			text: message
		}],
		isError: true
	});
}

// Helper function to create image response
function createImageResponse(imageData) {
	return McpResponseSchema.parse({
		content: [{
			type: 'image',
			data: imageData,
			mimeType: 'image/png'
		}]
	});
}

// Register image generation tool with Zod validation
server.tool(
	"generateImage", 
	"Generate an image using Draw Things API",
	async (inputParams, context) => {
		console.log('Received generateImage request with params:', inputParams);
		try {
			// Use Zod to validate parameters
			const parseResult = ImageGenerationParamsSchema.safeParse(inputParams);
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
				const prompt = result.parameters?.prompt || 'image';
				const filename = `${prompt.replace(/[^a-z0-9]/gi, '_').substring(0, 30)}_${timestamp}.png`;
				const outputPath = path.join('images', filename);
				await saveImage(result.images[0], outputPath);
				console.log(`Image saved to: ${outputPath}`);
			} catch (error) {
				console.warn('Failed to save image to file:', error);
				// Continue processing, as this should not block the MCP response
			}

			console.log('Successfully generated image');
			return createImageResponse(result.images[0]);
		} catch (error) {
			console.error('Error in generateImage handler:', error);
			return createErrorResponse(error.message || 'Internal server error');
		}
	}
);

// Start MCP server using immediately invoked function expression
(async () => {
	try {
		const transport = new StdioServerTransport();
		
		// Ensure stdout is only used for JSON messages
		const originalStdoutWrite = process.stdout.write.bind(process.stdout);
		process.stdout.write = (chunk, encoding, callback) => {
			// Only allow JSON messages to pass through
			if (typeof chunk === "string" && !chunk.startsWith("{")) {
				return true; // Silently skip non-JSON messages
			}
			return originalStdoutWrite(chunk, encoding, callback);
		};
		
		// Handle SIGINT signal (Ctrl+C)
		process.on('SIGINT', async () => {
			console.log('\nReceived SIGINT. Closing server...');
			try {
				await transport.close();
				process.exit(0);
			} catch (error) {
				console.error('Error closing server:', error);
				process.exit(1);
			}
		});

		console.log('Starting Draw Things MCP service...');
		console.log('Connecting to Draw Things API...');
		
		await server.connect(transport);
		console.log('MCP service is ready');

		// CLI mode handling (when not used through MCP)
		// Check if stdin is available and not being used through MCP
		if (!process.stdin.isTTY && process.argv.length <= 2) {
			let data = '';
			process.stdin.on('data', chunk => {
				data += chunk;
			});

			process.stdin.on('end', async () => {
				try {
					if (!data.trim()) {
						console.log('No input received. Exiting CLI mode.');
						process.exit(0);
					}

					// Parse and validate CLI input parameters
					let params;
					try {
						const rawParams = JSON.parse(data);
						const parseResult = ImageGenerationParamsSchema.safeParse(rawParams);
						if (!parseResult.success) {
							console.error('Invalid CLI parameters:', parseResult.error.format());
							process.exit(1);
						}
						params = parseResult.data;
					} catch (error) {
						console.error('Failed to parse CLI input:', error.message);
						process.exit(1);
					}

					console.log('CLI Mode: Received parameters:', params);
					
					const result = await drawThingsService.generateImage(params);
					console.log('Generation result:', result);
					
					if (result.status >= 400) {
						console.error('Generation failed:', result.error);
						process.exit(1);
					}

					if (result.images && result.images.length > 0) {
						const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
						const filename = `${params.prompt?.replace(/[^a-z0-9]/gi, '_') || 'image'}_${timestamp}.png`;
						const outputPath = path.join('images', filename);
						await saveImage(result.images[0], outputPath);
					}
					
					console.log('Image generated successfully');
					process.exit(0);
				} catch (error) {
					console.error('Error processing CLI request:', error);
					process.exit(1);
				}
			});
		}
	} catch (error) {
		console.error('Failed to initialize MCP server:', error);
		process.exit(1);
	}
})();
