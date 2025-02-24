#!/usr/bin/env node

import { DrawThingsMcp } from './index.js';
import fs from 'fs';
import path from 'path';

async function saveImage(base64Data, outputPath) {
  const buffer = Buffer.from(base64Data, 'base64');
  await fs.promises.writeFile(outputPath, buffer);
  console.log(`Image saved to: ${outputPath}`);
}

async function main() {
  console.log('Starting Draw Things MCP service...');
  const mcp = new DrawThingsMcp();
  
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT. Shutting down...');
    process.exit(0);
  });

  try {
    console.log('Connecting to Draw Things API...');
    await mcp.start();
    console.log('MCP service is ready');

    // 從標準輸入讀取 JSON
    let data = '';
    process.stdin.on('data', chunk => {
      data += chunk;
    });

    process.stdin.on('end', async () => {
      try {
        const params = JSON.parse(data);
        console.log('Received parameters:', params);
        
        const result = await mcp.service.generateImage(params);
        console.log('Generation result:', result);
        
        if (result.status >= 400) {
          console.error('Generation failed:', result.error);
          process.exit(1);
        }

        if (result.images && result.images.length > 0) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `${params.prompt.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.png`;
          const outputPath = path.join('images', filename);
          await saveImage(result.images[0], outputPath);
        }
        
        console.log('Image generated successfully');
        process.exit(0);
      } catch (error) {
        console.error('Error processing request:', error);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error('Failed to start MCP service:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 