import axios from 'axios';
import { defaultParams } from './defaultParams.js';
import { ImageGenerationParamsSchema, ImageGenerationResultSchema } from './schemas.js';

class DrawThingsService {
  constructor() {
    this.baseUrl = 'http://127.0.0.1:7888';
    this.axios = axios.create({
      baseURL: this.baseUrl,
      timeout: 600000, // 10 minutes timeout
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    });

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

  getDefaultParams() {
    return defaultParams;
  }

  async checkApiConnection() {
    try {
      console.log('Checking API connection to:', this.baseUrl);
      
      // First try a simple connection test
      const response = await this.axios.get('/', { 
        timeout: 5000,
        validateStatus: function (status) {
          // Any status is considered a successful connection test
          return true;
        }
      });
      
      console.log('API connection response code:', response.status);
      
      // Even if we get a 404, it means the server is responding
      if (response.status >= 200) {
        console.log('Draw Things API is responding');
        return true;
      }
      
      // Fallback to options endpoint if root returns error
      try {
        const optionsResponse = await this.axios.get('/sdapi/v1/options', { timeout: 5000 });
        console.log('Options endpoint response:', optionsResponse.status);
        return optionsResponse.status >= 200 && optionsResponse.status < 500;
      } catch (innerError) {
        console.error('Options endpoint check failed:', innerError.message);
        return false;
      }
    } catch (error) {
      console.error('API connection check failed:', error.message);
      
      // Check if it's a network error
      if (error.code === 'ECONNREFUSED') {
        console.error('Connection refused. Draw Things API is not running or the port is blocked.');
      } else if (error.code === 'ETIMEDOUT') {
        console.error('Connection timed out. Draw Things API is not responding.');
      }
      
      return false;
    }
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