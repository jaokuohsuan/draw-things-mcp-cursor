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
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

class DrawThingsMcp {
	constructor() {
		this.service = new DrawThingsService();
		this.server = new McpServer({
			name: 'draw-things-mcp',
			version: '1.0.3',
			description: 'Draw Things MCP Server'
		});
		this.setupTools();
	}

	setupTools() {
		// 設定可用的工具列表
		this.server.setRequestHandler(ListToolsRequestSchema, async () => {
			return {
				tools: [
					{
						name: "generateImage",
						description: "Generate an image using Draw Things API",
						inputSchema: {
							type: "object",
							properties: {
								prompt: {
									type: "string",
									description: "The prompt to generate the image from"
								},
								negative_prompt: {
									type: "string",
									description: "The negative prompt to avoid certain elements in the generated image"
								},
								width: {
									type: "number",
									description: "The width of the generated image"
								},
								height: {
									type: "number",
									description: "The height of the generated image"
								},
								model: {
									type: "string",
									description: "The model to use for generation"
								},
								steps: {
									type: "number",
									description: "Number of steps for generation"
								}
							},
							required: ["prompt"]
						}
					}
				]
			};
		});

		// 設定工具的處理邏輯
		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			try {
				if (!request.params.arguments) {
					throw new Error("Arguments are required");
				}

				switch (request.params.name) {
					case "generateImage": {
						console.log('Received generateImage request with params:', request.params.arguments);
						const result = await this.service.generateImage(request.params.arguments);
						
						if (result.status >= 400) {
							console.error('Generation failed:', result.error);
							return {
								type: 'error',
								error: result.error || 'Failed to generate image',
								code: result.status
							};
						}

						if (!result.images || result.images.length === 0) {
							console.error('No images generated');
							return {
								type: 'error',
								error: 'No images generated',
								code: 500
							};
						}

						console.log('Successfully generated image');
						return {
							type: 'success',
							content: [{
								type: 'image',
								data: result.images[0],
								mimeType: 'image/png'
							}],
							metadata: {
								parameters: result.parameters
							}
						};
					}
					default:
						throw new Error(`Unknown tool: ${request.params.name}`);
				}
			} catch (error) {
				console.error('Error in generateImage handler:', error);
				return {
					type: 'error',
					error: error.message || 'Internal server error',
					code: 500
				};
			}
		});
	}

	async start() {
		const transport = new StdioServerTransport();
		
		// 處理 SIGINT 信號 (Ctrl+C)
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

		console.log('Starting MCP server...');
		await this.server.connect(transport);
		console.log('MCP server connected');
	}
}

export { DrawThingsMcp };
