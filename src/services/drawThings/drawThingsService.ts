import { defaultParams } from './defaultParams.js';
import { ImageGenerationParams, ImageGenerationParamsSchema } from './schemas.js';
import fs from 'fs';
import path from 'path';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { DrawThingsGenerationResult, FetchOptions } from '../../interfaces/index.js';

// Use dirname resolution for consistent path handling across environments
const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../');
const logsDir = path.join(projectRoot, 'logs');

try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.error(`Created logs directory: ${logsDir}`);
  }
} catch (error) {
  console.error(`Failed to create logs directory: ${(error as Error).message}`);
}

export class DrawThingsService {
  baseUrl: string;
  connectionEstablished: boolean;
  lastConnectionCheck: number;
  connectionCheckInProgress: boolean;
  connectionRetryTimeout: NodeJS.Timeout | null;
  defaultHeaders: Record<string, string>;
  defaultTimeout: number;
  axios: AxiosInstance;

  constructor() {
    this.baseUrl = 'http://127.0.0.1:7888';
    this.connectionEstablished = false;
    this.lastConnectionCheck = 0;
    this.connectionCheckInProgress = false;
    this.connectionRetryTimeout = null;
    this.defaultTimeout = 120000; // 2 minutes timeout for image generation
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    
    // 初始化 axios 實例
    this.axios = axios.create({
      baseURL: this.baseUrl,
      timeout: this.defaultTimeout,
      headers: this.defaultHeaders
    });
    
    // 設置請求和響應攔截器
    this.setupInterceptors();
    
    console.error(`Initializing Draw Things Service with base URL: ${this.baseUrl}`);
  }

  getDefaultParams(): ImageGenerationParams {
    return defaultParams;
  }

  // 封裝的 fetch 方法，添加超時和自訂配置
  async fetchWithTimeout(
    url: string, 
    options: FetchOptions = {}
  ): Promise<Response> {
    const { timeout = this.defaultTimeout, validateStatus, ...fetchOptions } = options;
    
    // 使用 AbortController 處理超時
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    // 合併默認標頭和自訂標頭
    const headers = {
      ...this.defaultHeaders,
      ...(fetchOptions.headers || {})
    };
    
    // 記錄請求資訊
    console.error(`Sending request to ${url}:`, fetchOptions.body || '');
    
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal
      });
      
      // 記錄回應資訊
      console.error('Received response:', response.status);
      
      // 驗證狀態碼（類似 axios 的 validateStatus）
      if (validateStatus && !validateStatus(response.status)) {
        throw new Error(`HTTP Error: ${response.status}`);
      }
      
      return response;
    } catch (error) {
      console.error('Response error:', (error as Error).message);
      
      // 處理中止錯誤（超時）
      if ((error as Error).name === 'AbortError') {
        throw new Error('Request timeout');
      }
      
      // 重新拋出錯誤
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 用於發送 GET 請求
  async get(path: string, options: FetchOptions = {}): Promise<any> {
    const url = new URL(path, this.baseUrl).toString();
    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      ...options
    });
    
    const contentType = response.headers.get('Content-Type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    }
    
    return response.text();
  }

  // 用於發送 POST 請求
  async post(path: string, data: any, options: FetchOptions = {}): Promise<any> {
    const url = new URL(path, this.baseUrl).toString();
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      body: JSON.stringify(data),
      ...options
    });
    
    const contentType = response.headers.get('Content-Type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    }
    
    return response.text();
  }

  async checkApiConnection(): Promise<boolean> {
    // Enhanced API connection check with improved error handling, caching, and retry logic
    try {
      console.error('Checking API connection to:', this.baseUrl);
      
      // Check if a connection check is already in progress
      if (this.connectionCheckInProgress) {
        console.error('Connection check already in progress, waiting...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.connectionEstablished;
      }
      
      // Set in-progress flag
      this.connectionCheckInProgress = true;
      
      // Check if we already verified connection recently (last 30 seconds)
      const now = Date.now();
      if (this.connectionEstablished && (now - this.lastConnectionCheck < 30000)) {
        console.error('Connection recently established, skipping check');
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
        console.error(`Trying endpoint: ${endpoint.path}`);
        
        // Try up to 3 times per endpoint
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.error(`Attempt ${attempt} for ${endpoint.path}`);
            
            // Use different request configurations to maximize chances of success
            const config: AxiosRequestConfig = {
              timeout: attempt * 3000, // Increase timeout with each attempt
              validateStatus: (status: number) => status >= 200, // Accept any non-error response
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
              console.error(`Connected successfully to ${endpoint.path} (Attempt ${attempt})`);
              
              // Update connection state
              this.connectionEstablished = true;
              this.lastConnectionCheck = Date.now();
              this.connectionCheckInProgress = false;
              
              return true;
            }
          } catch (attemptError) {
            // Log error but continue trying
            console.error(`Attempt ${attempt} failed for ${endpoint.path}: ${(attemptError as Error).message}`);
            
            if (attempt < 3) {
              console.error(`Waiting before retry...`);
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
        console.error('Retrying API connection in background');
        this.checkApiConnection().catch(e => {
          console.error('Background connection retry failed:', (e as Error).message);
        });
      }, 30000); // Retry after 30 seconds
      
      return false;
    } catch (error) {
      console.error('API connection check failed:', (error as Error).message);
      this.connectionEstablished = false;
      this.connectionCheckInProgress = false;
      return false;
    }
  }

  // Extract the interceptor setup to a separate method
  setupInterceptors(): void {
    // Request interceptor
    this.axios.interceptors.request.use(
      (config: any) => {
        console.error(`Sending request to ${config.url}:`, config.data);
        return config;
      },
      (error: any) => {
        console.error('Request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.axios.interceptors.response.use(
      (response: any) => {
        console.error('Received response:', response.status);
        if (response.data) {
          console.error('Response data:', response.data);
        }
        return response;
      },
      (error: any) => {
        console.error('Response error:', error.message);
        if (error.response) {
          console.error('Error response data:', error.response.data);
        }
        return Promise.reject(error);
      }
    );
  }

  async generateImage(inputParams: Partial<ImageGenerationParams> = {}): Promise<DrawThingsGenerationResult> {
    // Check API connection with aggressive options
    if (!this.connectionEstablished) {
      console.error('Connection not yet established, performing aggressive connection check');
      
      // Try changing the baseUrl if specified in environment
      const envApiUrl = process.env.DRAW_THINGS_API_URL;
      if (envApiUrl && envApiUrl !== this.baseUrl) {
        console.error(`Trying environment-specified API URL: ${envApiUrl}`);
        this.baseUrl = envApiUrl;
        this.axios.defaults.baseURL = this.baseUrl;
      }
      
      // Check API connection with alternative ports/hosts
      const apiPort = process.env.DRAW_THINGS_API_PORT || 7888;
      
      const originalBaseUrl = this.baseUrl;
      
      // Try direct API first with IP address
      this.baseUrl = `http://127.0.0.1:${apiPort}`;
      this.axios.defaults.baseURL = this.baseUrl;
      console.error(`Trying API connection: ${this.baseUrl}`);
      let isConnected = await this.checkApiConnection();
      
      // If that fails, try with localhost
      if (!isConnected) {
        this.baseUrl = `http://localhost:${apiPort}`;
        this.axios.defaults.baseURL = this.baseUrl;
        console.error(`Trying localhost API connection: ${this.baseUrl}`);
        isConnected = await this.checkApiConnection();
        
        // If all attempts fail, restore original URL
        if (!isConnected) {
          this.baseUrl = originalBaseUrl;
          this.axios.defaults.baseURL = this.baseUrl;
          console.error(`Could not establish connection. Restoring original URL: ${this.baseUrl}`);
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
      
      let params: Partial<ImageGenerationParams>;
      if (!parseResult.success) {
        console.warn('Parameter validation failed:', parseResult.error.format());
        console.error('Using default parameters');
        params = {};
      } else {
        params = parseResult.data;
        
        // Handle special case: only random_string parameter provided
        if (Object.keys(params).length === 1 && params.random_string !== undefined) {
          console.error('Only random_string provided, using as prompt');
          params = { prompt: params.random_string };
        } else if (params.random_string !== undefined) {
          // If random_string is one of the parameters but not the only one, remove it before processing
          const { random_string, ...cleanParams } = params;
          params = cleanParams;
          console.error('Removed random_string parameter, using remaining parameters');
        }
      }

      // Ensure prompt exists
      if (!params.prompt) {
        console.error('No prompt provided, using default prompt');
        params.prompt = defaultParams.prompt;
      }

      // Merge parameters
      const mergedParams = {
        ...defaultParams,
        ...params,
        seed: params.seed !== undefined ? params.seed : Math.floor(Math.random() * 2147483647)  // Generate random seed
      };

      console.error('Sending request to Draw Things API...');
      console.error('Request parameters:', mergedParams);
      
      // Implement retry logic for API requests
      const maxRetries = 3;
      let lastError: string | null = null;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.error(`API request attempt ${attempt} of ${maxRetries}`);
          const response = await this.axios.post('/sdapi/v1/txt2img', mergedParams, {
            timeout: 120000 + (attempt * 30000), // Increase timeout with each retry
          });
          
          console.error(`Received API response on attempt ${attempt}: ${response.status}`);
          
          if (response.status >= 400) {
            console.error(`API error (${response.status}):`, response.data);
            lastError = `API returned error status: ${response.status}: ${response.data && response.data.error ? response.data.error : 'Unknown error'}`;
            
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
          console.error(`Request attempt ${attempt} failed:`, (requestError as Error).message);
          lastError = (requestError as Error).message;
          
          // Check for connection errors and update connection status
          const error = requestError as any;
          if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            this.connectionEstablished = false;
          }
          
          // If not the last attempt, wait before retry
          if (attempt < maxRetries) {
            const waitTime = attempt * 2000; // Progressive backoff
            console.error(`Waiting ${waitTime}ms before retry...`);
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
      const axiosError = error as any;
      if (axiosError.response) {
        console.error('API error response:', axiosError.response.data);
        return {
          isError: true,
          errorMessage: axiosError.response.data && axiosError.response.data.error ? axiosError.response.data.error : `API error: ${(error as Error).message}`
        };
      }
      
      // Handle network errors
      if (axiosError.code === 'ECONNREFUSED') {
        this.connectionEstablished = false;
        return {
          isError: true,
          errorMessage: 'Draw Things API service is not running or cannot be connected. Please make sure Draw Things is running and the API is enabled.'
        };
      }
      if (axiosError.code === 'ETIMEDOUT') {
        this.connectionEstablished = false;
        return {
          isError: true,
          errorMessage: 'Connection to Draw Things API timed out. The image generation process may be taking too long or the API might be unresponsive.'
        };
      }
      
      // Generic error handling
      return {
        isError: true,
        errorMessage: `Failed to generate image: ${(error as Error).message}`
      };
    }
  }
} 