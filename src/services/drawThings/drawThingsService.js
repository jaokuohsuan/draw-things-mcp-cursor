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
    // Simple API connection check without retry logic
    try {
      console.log('Checking API connection to:', this.baseUrl);
      
      if (this.connectionEstablished) {
        console.log('Connection already established, skipping check');
        return true;
      }
      
      // Try options endpoint first
      try {
        console.log('Trying options endpoint...');
        const response = await this.axios.get('/sdapi/v1/options', { timeout: 5000 });
        if (response.status >= 200 && response.status < 500) {
          console.log('Connected successfully to options endpoint');
          this.connectionEstablished = true;
          return true;
        }
      } catch (optionsError) {
        console.log('Options endpoint unavailable, trying root endpoint...');
      }
      
      // Try root endpoint as fallback
      try {
        const response = await this.axios.get('/', { timeout: 5000 });
        if (response.status >= 200) {
          console.log('Connected successfully to root endpoint');
          this.connectionEstablished = true;
          return true;
        }
      } catch (rootError) {
        console.log('Root endpoint unavailable');
      }
      
      console.error('Draw Things API is not responding on any endpoint');
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
      
      const response = await this.axios.post('/sdapi/v1/txt2img', mergedParams);
      console.log('Received API response');
      
      if (response.status >= 400) {
        console.error('API error:', response.data);
        return ImageGenerationResultSchema.parse({
          status: response.status,
          error: response.data?.error || `API returned error status: ${response.status}`
        });
      }

      if (!response.data || !response.data.images || response.data.images.length === 0) {
        return ImageGenerationResultSchema.parse({
          status: 404,
          error: 'No images were generated by the API'
        });
      }

      return ImageGenerationResultSchema.parse({
        status: response.status,
        images: response.data.images,
        parameters: mergedParams
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