import axios from 'axios';
import { defaultParams } from './defaultParams.js';

class DrawThingsService {
  constructor() {
    this.baseUrl = 'http://127.0.0.1:7888';
    this.axios = axios.create({
      baseURL: this.baseUrl,
      timeout: 300000, // 5 minutes timeout
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

  async generateImage(params) {
    const mergedParams = {
      ...defaultParams,
      ...params,
      seed: Math.floor(Math.random() * 2147483647)  // 生成隨機種子
    };

    try {
      console.log('Sending request to Draw Things API...');
      console.log('Request parameters:', mergedParams);
      
      const response = await this.axios.post('/sdapi/v1/txt2img', mergedParams);
      console.log('Received response from API');
      
      if (response.status >= 400) {
        console.error('API error:', response.data);
        return {
          status: response.status,
          error: response.data
        };
      }

      return {
        status: response.status,
        images: response.data.images,
        parameters: mergedParams
      };
    } catch (error) {
      console.error('API request failed:', error.message);
      if (error.response) {
        console.error('API error response:', error.response.data);
        return {
          status: error.response.status,
          error: error.response.data
        };
      }
      
      // Network error handling
      if (error.code === 'ECONNREFUSED') {
        return {
          status: 503,
          error: 'Draw Things API service is not running or cannot be connected'
        };
      }
      if (error.code === 'ETIMEDOUT') {
        return {
          status: 504,
          error: 'Request timed out, possibly due to long image generation time. The model might be loading or the generation is taking longer than expected.'
        };
      }
      
      return {
        status: 500,
        error: `Unknown error: ${error.message}`
      };
    }
  }
}

export { DrawThingsService }; 