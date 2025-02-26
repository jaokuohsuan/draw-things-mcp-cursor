import axios from 'axios';
import { defaultParams } from './defaultParams.js';
import { ImageGenerationParamsSchema, ImageGenerationResultSchema } from './schemas.js';

class DrawThingsService {
  constructor() {
    this.baseUrl = 'http://127.0.0.1:7888';
    this.connectionEstablished = false;
    this.lastConnectionCheck = 0;
    this.connectionCheckInProgress = false;
    this.connectionRetryTimeout = null;
    
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
    // Enhanced API connection check with improved error handling, caching, and retry logic
    try {
      console.log('Checking API connection to:', this.baseUrl);
      
      // Check if a connection check is already in progress
      if (this.connectionCheckInProgress) {
        console.log('Connection check already in progress, waiting...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.connectionEstablished;
      }
      
      // Set in-progress flag
      this.connectionCheckInProgress = true;
      
      // Check if we already verified connection recently (last 30 seconds)
      const now = Date.now();
      if (this.connectionEstablished && (now - this.lastConnectionCheck < 30000)) {
        console.log('Connection recently established, skipping check');
        this.connectionCheckInProgress = false;
        return true;
      }
      
      // Clear any existing retry timeout
      if (this.connectionRetryTimeout) {
        clearTimeout(this.connectionRetryTimeout);
        this.connectionRetryTimeout = null;
      }
      
      // Define endpoints to try in order with different approaches
      const endpoints = [
        { path: '/sdapi/v1/options', method: 'GET' },
        { path: '/sdapi/v1/samplers', method: 'GET' },
        { path: '/sdapi/v1/sd-models', method: 'GET' },
        { path: '/sdapi/v1/prompt-styles', method: 'GET' },
        { path: '/', method: 'GET' }
      ];
      
      // Try each endpoint with multiple retry attempts
      for (const endpoint of endpoints) {
        console.log(`Trying endpoint: ${endpoint.path}`);
        
        // Try up to 3 times per endpoint
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`Attempt ${attempt} for ${endpoint.path}`);
            
            // Use different request configurations to maximize chances of success
            const config = {
              timeout: attempt * 3000, // Increase timeout with each attempt
              validateStatus: (status) => status >= 200, // Accept any non-error response
              headers: {
                'User-Agent': 'DrawThingsMCP/1.0',
                'Accept': 'application/json',
                'Connection': attempt === 1 ? 'keep-alive' : 'close' // Try different connection settings
              }
            };
            
            let response;
            if (endpoint.method === 'GET') {
              response = await this.axios.get(endpoint.path, config);
            } else {
              response = await this.axios.post(endpoint.path, {}, config);
            }
            
            if (response.status >= 200) {
              console.log(`Connected successfully to ${endpoint.path} (Attempt ${attempt})`);
              
              // Update connection state
              this.connectionEstablished = true;
              this.lastConnectionCheck = Date.now();
              this.connectionCheckInProgress = false;
              
              return true;
            }
          } catch (attemptError) {
            // Log error but continue trying
            console.log(`Attempt ${attempt} failed for ${endpoint.path}: ${attemptError.message}`);
            
            if (attempt < 3) {
              console.log(`Waiting before retry...`);
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Progressive backoff
            }
          }
        }
      }
      
      // If we get here, all connection attempts failed
      console.error('All Draw Things API connection attempts failed');
      this.connectionEstablished = false;
      this.connectionCheckInProgress = false;
      
      // Schedule a retry in the background
      this.connectionRetryTimeout = setTimeout(() => {
        console.log('Retrying API connection in background');
        this.checkApiConnection().catch(e => {
          console.error('Background connection retry failed:', e.message);
        });
      }, 30000); // Retry after 30 seconds
      
      return false;
    } catch (error) {
      console.error('API connection check failed:', error.message);
      this.connectionEstablished = false;
      this.connectionCheckInProgress = false;
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
    // Check API connection with aggressive options
    if (!this.connectionEstablished) {
      console.log('Connection not yet established, performing aggressive connection check');
      
      // Try changing the baseUrl if specified in environment
      const envApiUrl = process.env.DRAW_THINGS_API_URL;
      if (envApiUrl && envApiUrl !== this.baseUrl) {
        console.log(`Trying environment-specified API URL: ${envApiUrl}`);
        this.baseUrl = envApiUrl;
        this.axios.defaults.baseURL = this.baseUrl;
      }
      
      // Check if proxy is enabled and try alternative ports
      const apiPort = process.env.DRAW_THINGS_API_PORT || 7888;
      const proxyPort = process.env.PROXY_PORT || 7889;
      
      const originalBaseUrl = this.baseUrl;
      
      // Try direct API first
      this.baseUrl = `http://127.0.0.1:${apiPort}`;
      this.axios.defaults.baseURL = this.baseUrl;
      console.log(`Trying direct API connection: ${this.baseUrl}`);
      let isConnected = await this.checkApiConnection();
      
      // If direct fails, try proxy
      if (!isConnected) {
        this.baseUrl = `http://localhost:${proxyPort}`;
        this.axios.defaults.baseURL = this.baseUrl;
        console.log(`Trying proxy API connection: ${this.baseUrl}`);
        isConnected = await this.checkApiConnection();
        
        // If proxy fails too, try localhost direct
        if (!isConnected) {
          this.baseUrl = `http://localhost:${apiPort}`;
          this.axios.defaults.baseURL = this.baseUrl;
          console.log(`Trying localhost direct API connection: ${this.baseUrl}`);
          isConnected = await this.checkApiConnection();
          
          // If all attempts fail, restore original URL
          if (!isConnected) {
            this.baseUrl = originalBaseUrl;
            this.axios.defaults.baseURL = this.baseUrl;
          }
        }
      }
      
      // If still not connected after all attempts
      if (!isConnected) {
        console.error('Draw Things API is not available after multiple connection attempts');
        return {
          isError: true,
          errorMessage: 'Draw Things API is not running or cannot be connected. Please make sure Draw Things is running and the API is enabled.'
        };
      }
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
          console.log('Only random_string provided, using as prompt');
          params = { prompt: params.random_string };
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
          
          console.log(`Received API response on attempt ${attempt}: ${response.status}`);
          
          if (response.status >= 400) {
            console.error(`API error (${response.status}):`, response.data);
            lastError = `API returned error status: ${response.status}: ${response.data?.error || 'Unknown error'}`;
            
            // Only retry on 5xx errors, not on 4xx errors
            if (response.status < 500) break;
          } else if (!response.data || !response.data.images || response.data.images.length === 0) {
            lastError = 'No images were generated by the API';
          } else {
            // Success case - ensure image data is correctly formatted
            const imageData = response.data.images[0];
            
            // Success means connection is working
            this.connectionEstablished = true;
            this.lastConnectionCheck = Date.now();
            
            // Check if image data already has base64 prefix, if not add it
            const formattedImageData = imageData.startsWith('data:image/') 
              ? imageData 
              : `data:image/png;base64,${imageData}`;
            
            return {
              isError: false,
              imageData: formattedImageData,
              parameters: mergedParams
            };
          }
        } catch (requestError) {
          console.error(`Request attempt ${attempt} failed:`, requestError.message);
          lastError = requestError.message;
          
          // Check for connection errors and update connection status
          if (requestError.code === 'ECONNREFUSED' || requestError.code === 'ETIMEDOUT') {
            this.connectionEstablished = false;
          }
          
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
      
      // Update connection status based on error
      if (lastError && (lastError.includes('ECONNREFUSED') || lastError.includes('ETIMEDOUT'))) {
        this.connectionEstablished = false;
      }
      
      return {
        isError: true,
        errorMessage: lastError || 'Unknown error after multiple retries'
      };
    } catch (error) {
      console.error('Error during image generation:', error);
      
      // Handle API error response
      if (error.response) {
        console.error('API error response:', error.response.data);
        return {
          isError: true,
          errorMessage: error.response.data?.error || `API error: ${error.message}`
        };
      }
      
      // Handle network errors
      if (error.code === 'ECONNREFUSED') {
        this.connectionEstablished = false;
        return {
          isError: true,
          errorMessage: 'Draw Things API service is not running or cannot be connected. Please make sure Draw Things is running and the API is enabled.'
        };
      }
      if (error.code === 'ETIMEDOUT') {
        this.connectionEstablished = false;
        return {
          isError: true,
          errorMessage: 'Connection to Draw Things API timed out. The image generation process may be taking too long or the API might be unresponsive.'
        };
      }
      
      // Generic error handling
      return {
        isError: true,
        errorMessage: `Failed to generate image: ${error.message}`
      };
    }
  }
}

export { DrawThingsService }; 