import axios from 'axios';
import { defaultParams } from './defaultParams.js';
import { ImageGenerationParamsSchema, ImageGenerationResultSchema } from './schemas.js';

class DrawThingsService {
  constructor() {
    this.baseUrl = 'http://127.0.0.1:7888';
    this.connectionEstablished = false;
    
    console.log(`Initializing Draw Things Service with base URL: ${this.baseUrl}`);
    
    this.axios = axios.create({
      baseURL: this.baseUrl,
      timeout: 120000, // 2 minutes timeout for image generation
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    });

    // Setup interceptors
    this.setupInterceptors();
  }

  getDefaultParams() {
    return defaultParams;
  }

  async checkApiConnection() {
    // Enhanced API connection check with better error handling and retry logic
    try {
      console.log('Checking API connection to:', this.baseUrl);
      
      if (this.connectionEstablished) {
        console.log('Connection already established, skipping check');
        return true;
      }
      
      // Define endpoints to try in order
      const endpoints = [
        '/sdapi/v1/options',  // Primary endpoint
        '/sdapi/v1/samplers', // Alternative endpoint
        '/',                  // Root endpoint as last resort
      ];
      
      // Try each endpoint with retry
      for (const endpoint of endpoints) {
        console.log(`Trying endpoint: ${endpoint}`);
        
        // Try up to 3 times per endpoint
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`Attempt ${attempt} for ${endpoint}`);
            const response = await this.axios.get(endpoint, { 
              timeout: attempt * 2000, // Increase timeout with each attempt
              validateStatus: (status) => status >= 200 // Accept any non-error response
            });
            
            if (response.status >= 200) {
              console.log(`Connected successfully to ${endpoint} (Attempt ${attempt})`);
              // Update base URL with successful path if it was the root
              if (endpoint === '/') {
                this.baseUrl = this.axios.defaults.baseURL;
                console.log(`Updated base URL to: ${this.baseUrl}`);
              }
              this.connectionEstablished = true;
              return true;
            }
          } catch (attemptError) {
            console.log(`Attempt ${attempt} failed for ${endpoint}: ${attemptError.message}`);
            if (attempt < 3) {
              console.log(`Waiting before retry...`);
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before retry
            }
          }
        }
      }
      
      console.error('Draw Things API is not responding on any endpoint after all retries');
      return false;
    } catch (error) {
      console.error('API connection check failed:', error.message);
      return false;
    }
  }

  // Extract the interceptor setup to a separate method
  setupInterceptors() {
    // Request interceptor
    this.axios.interceptors.request.use(
      config => {
        console.log(`Sending request to ${config.url}:`, config.data);
        return config;
      },
      error => {
        console.error('Request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.axios.interceptors.response.use(
      response => {
        console.log('Received response:', response.status);
        if (response.data) {
          console.log('Response data:', response.data);
        }
        return response;
      },
      error => {
        console.error('Response error:', error.message);
        if (error.response) {
          console.error('Error response data:', error.response.data);
        }
        return Promise.reject(error);
      }
    );
  }

  async generateImage(inputParams = {}) {
    // Check API connection
    const isConnected = await this.checkApiConnection();
    if (!isConnected) {
      console.error('Draw Things API is not available');
      return ImageGenerationResultSchema.parse({
        status: 503,
        error: 'Draw Things API is not running or cannot be connected. Please make sure Draw Things is running and the API is enabled.'
      });
    }

    try {
      // Use Zod to validate and process input parameters
      const parseResult = ImageGenerationParamsSchema.safeParse(inputParams);
      
      let params;
      if (!parseResult.success) {
        console.warn('Parameter validation failed:', parseResult.error.format());
        console.log('Using default parameters');
        params = {};
      } else {
        params = parseResult.data;
        
        // Handle special case: only random_string parameter provided
        if (Object.keys(params).length === 1 && params.random_string !== undefined) {
          console.log('Only random_string provided, using all default values');
          params = {}; // Clear params to use all defaults
        } else if (params.random_string !== undefined) {
          // If random_string is one of the parameters but not the only one, remove it before processing
          const { random_string, ...cleanParams } = params;
          params = cleanParams;
          console.log('Removed random_string parameter, using remaining parameters');
        }
      }

      // Ensure prompt exists
      if (!params.prompt) {
        console.log('No prompt provided, using default prompt');
        params.prompt = defaultParams.prompt;
      }

      // Merge parameters
      const mergedParams = {
        ...defaultParams,
        ...params,
        seed: params.seed !== undefined ? params.seed : Math.floor(Math.random() * 2147483647)  // Generate random seed
      };

      console.log('Sending request to Draw Things API...');
      console.log('Request parameters:', mergedParams);
      
      // Implement retry logic for API requests
      const maxRetries = 3;
      let lastError = null;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`API request attempt ${attempt} of ${maxRetries}`);
          const response = await this.axios.post('/sdapi/v1/txt2img', mergedParams, {
            timeout: 120000 + (attempt * 30000), // Increase timeout with each retry
          });
          
          console.log(`Received API response on attempt ${attempt}`);
          
          if (response.status >= 400) {
            console.error('API error:', response.data);
            lastError = {
              status: response.status,
              error: response.data?.error || `API returned error status: ${response.status}`
            };
            // Only retry on 5xx errors, not on 4xx errors
            if (response.status < 500) break;
          } else if (!response.data || !response.data.images || response.data.images.length === 0) {
            lastError = {
              status: 404,
              error: 'No images were generated by the API'
            };
          } else {
            // Success case
            return ImageGenerationResultSchema.parse({
              status: response.status,
              images: response.data.images,
              parameters: mergedParams
            });
          }
        } catch (requestError) {
          console.error(`Request attempt ${attempt} failed:`, requestError.message);
          lastError = {
            status: requestError.response?.status || 500,
            error: requestError.message
          };
          
          // If not the last attempt, wait before retry
          if (attempt < maxRetries) {
            const waitTime = attempt * 2000; // Progressive backoff
            console.log(`Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
      }
      
      // If we reached here, all retries failed
      console.error('All API request attempts failed');
      return ImageGenerationResultSchema.parse(lastError || {
        status: 500,
        error: 'Unknown error after multiple retries'
      });
    } catch (error) {
      console.error('Error during image generation:', error);
      
      // Handle API error response
      if (error.response) {
        console.error('API error response:', error.response.data);
        return ImageGenerationResultSchema.parse({
          status: error.response.status,
          error: error.response.data?.error || `API error: ${error.message}`
        });
      }
      
      // Handle network errors
      if (error.code === 'ECONNREFUSED') {
        return ImageGenerationResultSchema.parse({
          status: 503,
          error: 'Draw Things API service is not running or cannot be connected. Please make sure Draw Things is running and the API is enabled.'
        });
      }
      if (error.code === 'ETIMEDOUT') {
        return ImageGenerationResultSchema.parse({
          status: 504,
          error: 'Request timed out, possibly due to long image generation time. The model might be loading or the generation is taking longer than expected.'
        });
      }
      
      // Handle other errors
      return ImageGenerationResultSchema.parse({
        status: 500,
        error: `Unknown error: ${error.message}`
      });
    }
  }
}

export { DrawThingsService }; 