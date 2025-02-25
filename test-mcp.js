#!/usr/bin/env node

/**
 * Draw Things MCP Test Script
 * 
 * This script is used to test whether the Draw Things MCP service can start normally and process image generation requests.
 * It simulates MCP client behavior, sending requests to the MCP service and handling responses.
 */

import { spawn } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory path of the current file
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure test output directory exists
const testOutputDir = path.join(__dirname, 'test-output');
try {
  await mkdir(testOutputDir, { recursive: true });
  console.log(`Test output directory created: ${testOutputDir}`);
} catch (error) {
  if (error.code !== 'EEXIST') {
    console.error('Error creating test output directory:', error);
    process.exit(1);
  }
}

// MCP request example - format corrected to comply with MCP protocol
const mcpRequest = {
  jsonrpc: "2.0",
  id: "test-request-" + Date.now(),
  method: "mcp.invoke",
  params: {
    tool: "generateImage",
    parameters: {
      prompt: "Beautiful Taiwan landscape, mountain and water painting style"
    }
  }
};

// Save request to file
const requestFilePath = path.join(testOutputDir, 'mcp-request.json');
try {
  await writeFile(requestFilePath, JSON.stringify(mcpRequest, null, 2));
  console.log(`MCP request saved to: ${requestFilePath}`);
} catch (error) {
  console.error('Error saving MCP request:', error);
  process.exit(1);
}

console.log('Starting Draw Things MCP service for testing...');

// Start MCP service process
const mcpProcess = spawn('node', ['src/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Add progress display timer
let waitTime = 0;
const progressInterval = setInterval(() => {
  waitTime += 30;
  console.log(`Waited ${waitTime} seconds... Image generation may take some time, please be patient`);
}, 30000);

// Cleanup function - called when terminating the service in any situation
function cleanup() {
  clearInterval(progressInterval);
  if (mcpProcess && !mcpProcess.killed) {
    mcpProcess.kill();
  }
}

// Record standard output
let stdoutData = '';
mcpProcess.stdout.on('data', (data) => {
  const dataStr = data.toString();
  console.log(`MCP standard output: ${dataStr}`);
  stdoutData += dataStr;
  
  try {
    // Try to parse output as JSON
    const lines = dataStr.trim().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const jsonData = JSON.parse(line);
        console.log('Parsed JSON response:', JSON.stringify(jsonData).substring(0, 100) + '...');
        
        // If it's an MCP response, save and analyze
        if (jsonData.id && (jsonData.result || jsonData.error)) {
          console.log('Received MCP response ID:', jsonData.id);
          
          if (jsonData.error) {
            console.error('MCP error response:', jsonData.error);
            const errorFile = path.join(testOutputDir, 'mcp-error.json');
            writeFile(errorFile, JSON.stringify(jsonData, null, 2))
              .catch(e => console.error('Failed to write error file:', e));
          } else if (jsonData.result) {
            console.log('MCP successful response type:', jsonData.result.content?.[0]?.type || 'unknown');
            
            // Determine if the response contains an error
            if (jsonData.result.isError) {
              console.error('Error response:', jsonData.result.content[0].text);
              const errorResultFile = path.join(testOutputDir, 'mcp-error-result.json');
              writeFile(errorResultFile, JSON.stringify(jsonData, null, 2))
                .catch(e => console.error('Failed to write error result file:', e));
            } else {
              // Successful response, should contain image data
              console.log('Successfully generated image!');
              if (jsonData.result.content && jsonData.result.content[0].type === 'image') {
                const imageData = jsonData.result.content[0].data;
                console.log(`Image data size: ${imageData.length} characters`);
                
                // Use immediately executed async function
                (async function() {
                  try {
                    const savedImagePath = await saveImage(imageData);
                    console.log(`Image successfully saved to: ${savedImagePath}`);
                    
                    const successFile = path.join(testOutputDir, 'mcp-success.json');
                    await writeFile(successFile, JSON.stringify(jsonData.result, null, 2));
                    console.log('Successfully saved result information to JSON file');
                    
                    // Extend wait time to ensure all operations complete
                    setTimeout(() => {
                      console.log('Test completed, image processing successful, terminating MCP service...');
                      cleanup();
                      process.exit(0);
                    }, 3000); // Increased to 3 seconds
                  } catch (saveError) {
                    console.error('Error saving image or results:', saveError);
                    const errorFile = path.join(testOutputDir, 'mcp-save-error.json');
                    writeFile(errorFile, JSON.stringify({ error: saveError.message }, null, 2))
                      .catch(e => console.error('Failed to write error information:', e));
                    
                    // End test normally even if there's an error
                    setTimeout(() => {
                      console.log('Test completed, but errors occurred during image processing, terminating MCP service...');
                      cleanup();
                      process.exit(1);
                    }, 3000);
                  }
                })();
              }
            }
          }
        }
      } catch (parseError) {
        // Not valid JSON, might be regular log output
        // console.log('Non-JSON data:', line);
      }
    }
  } catch (error) {
    console.error('Error processing MCP output:', error);
  }
});

// Record standard error
mcpProcess.stderr.on('data', (data) => {
  const logMsg = data.toString().trim();
  console.log(`MCP service log: ${logMsg}`);
  
  // Monitor specific log messages to confirm service status
  if (logMsg.includes('MCP service is ready')) {
    console.log('Detected MCP service is ready, preparing to send request...');
    // Delay sending request
    setTimeout(() => {
      sendRequest();
    }, 1000);
  }
});

// Handle process exit
mcpProcess.on('close', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`MCP service exited with code ${code}`);
    
    // Save output for diagnosis
    try {
      writeFile(path.join(testOutputDir, 'mcp-stdout.log'), stdoutData);
      console.log('MCP service standard output log saved');
    } catch (error) {
      console.error('Error saving output log:', error);
    }
    
    cleanup();
    process.exit(1);
  }
});

// Handle errors
mcpProcess.on('error', (error) => {
  console.error('Error starting MCP service:', error);
  cleanup();
  process.exit(1);
});

// Function to send MCP request
function sendRequest() {
  console.log('Sending image generation request...');
  console.log('Request content:', JSON.stringify(mcpRequest));
  
  // Ensure request string ends with newline
  const requestString = JSON.stringify(mcpRequest) + '\n';
  mcpProcess.stdin.write(requestString);
  console.log(`Sent ${requestString.length} bytes of request data`);
  console.log('\n========================================');
  console.log('Image generation has started, this may take a few minutes...');
  console.log('Wait progress will be displayed every 30 seconds');
  console.log('Please be patient, do not interrupt the test');
  console.log('========================================\n');
  
  // Save the raw request sent
  writeFile(path.join(testOutputDir, 'mcp-raw-request.txt'), requestString)
    .catch(e => console.error('Failed to save raw request:', e));
}

// Helper function: Save image
async function saveImage(base64Data) {
  try {
    // Create buffer from base64 string
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    // Save image to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const imagePath = path.join(testOutputDir, `generated-image-${timestamp}.png`);
    
    await writeFile(imagePath, imageBuffer);
    console.log(`Generated image saved to: ${imagePath}`);
    return imagePath;  // Make sure to return the saved path
  } catch (error) {
    console.error('Error saving image:', error);
    throw error;  // Throw error so the upper function can catch and handle it
  }
}

// Don't send request immediately, wait for service log to indicate readiness

// Timeout handling
setTimeout(() => {
  console.error('Test timeout, terminating MCP service...');
  writeFile(path.join(testOutputDir, 'mcp-timeout.log'), 'Test timed out after 300 seconds')
    .catch(e => console.error('Failed to save timeout log:', e));
  cleanup();
  process.exit(1);
}, 300000); // 5 minute timeout, providing more time to complete image generation 