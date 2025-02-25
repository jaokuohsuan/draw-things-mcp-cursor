import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { defaultParams } from './src/services/drawThings/defaultParams.js';

// Set API base URL
const baseUrl = 'http://127.0.0.1:7888';

// Create axios instance
const api = axios.create({
  baseURL: baseUrl,
  timeout: 30000, // 30 seconds timeout
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

// Save image function
async function saveImage(base64Data, outputPath) {
  try {
    // Ensure output directory exists
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

// Test API connection
async function testApiConnection() {
  console.log('Checking Draw Things API connection...');
  console.log(`Trying to connect to ${baseUrl}`);
  
  try {
    // Try to get API status
    const response = await api.get('/');
    console.log('API response:', response.status, response.data);
    return true;
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error('Connection refused. Make sure Draw Things app is running and API is enabled.');
    } else if (error.response) {
      console.log('Received API response, status code:', error.response.status);
      // Even with a 404, it means the server is running
      return true;
    } else {
      console.error('API connection failed:', error.message);
    }
    return false;
  }
}

// Test available API endpoints
async function testApiEndpoints() {
  const endpoints = [
    '/sdapi/v1/sd-models',
    '/sdapi/v1/samplers',
    '/sdapi/v1/upscalers',
    '/sdapi/v1/options',
    '/sdapi/v1/cmd-flags',
    '/sdapi/v1/progress'
  ];
  
  console.log('Testing available API endpoints...');
  
  for (const endpoint of endpoints) {
    try {
      console.log(`Testing endpoint: ${endpoint}`);
      const response = await api.get(endpoint);
      console.log(`✅ Endpoint ${endpoint} available, response status: ${response.status}`);
    } catch (error) {
      if (error.response) {
        console.log(`❌ Endpoint ${endpoint} response status: ${error.response.status}`);
      } else {
        console.log(`❌ Endpoint ${endpoint} error: ${error.message}`);
      }
    }
  }
}

// Test image generation
async function testGenerateImage() {
  try {
    console.log('\nStarting image generation test...');
    
    // Set generation parameters
    const params = {
      ...defaultParams,
      prompt: "A crowded movie theater with people watching a film, cinematic lighting, detailed audience",
      negative_prompt: "blurry, low quality, distorted, deformed",
      seed: Math.floor(Math.random() * 2147483647)
    };
    
    console.log('Using parameters:', JSON.stringify(params, null, 2));
    
    console.log('Sending request to /sdapi/v1/txt2img...');
    const response = await api.post('/sdapi/v1/txt2img', params);
    
    console.log('Received response, status code:', response.status);
    
    if (response.data && response.data.images && response.data.images.length > 0) {
      console.log('Image generation successful!');
      
      // Save image
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `test_image_${timestamp}.png`;
      const outputPath = path.join('images', filename);
      await saveImage(response.data.images[0], outputPath);
      
      console.log('Test completed, image generation successful!');
    } else {
      console.error('No images in API response:', response.data);
    }
  } catch (error) {
    console.error('Error during test:', error.message);
    if (error.response) {
      console.error('API error response status:', error.response.status);
      console.error('API error response data:', error.response.data);
    }
  }
}

// Main test function
async function runTests() {
  console.log('=== Draw Things API Test ===');
  
  // Test API connection
  const isConnected = await testApiConnection();
  
  if (isConnected) {
    // Test API endpoints
    await testApiEndpoints();
    
    // Test image generation
    await testGenerateImage();
  } else {
    console.error('Cannot connect to Draw Things API, test terminated.');
    console.log('Please ensure:');
    console.log('1. Draw Things app is running');
    console.log('2. API is enabled in Draw Things');
    console.log('3. API service is running on http://127.0.0.1:7888');
  }
}

// Run tests
runTests(); 