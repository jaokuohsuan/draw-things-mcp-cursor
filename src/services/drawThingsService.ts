import { defaultParams } from "./defaultParams.js";
import {
  ImageGenerationParams,
  validateImageGenerationParams,
} from "./schemas.js";
import axios, { AxiosInstance } from "axios";
import { DrawThingsGenerationResult } from "../../interfaces/index.js";

/**
 * simplified DrawThingsService
 * focus on core functionality: connect to Draw Things API and generate image
 */
export class DrawThingsService {
  // make baseUrl public for compatibility with index.ts
  public baseUrl: string;
  // change to public axios for compatibility
  public axios: AxiosInstance;

  constructor(apiUrl = "http://127.0.0.1:7888") {
    this.baseUrl = apiUrl;

    // initialize axios
    this.axios = axios.create({
      baseURL: this.baseUrl,
      timeout: 300000, // 5 minutes timeout (image generation may take time)
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    // log initialization
    console.error(`DrawThingsService initialized, API location: ${this.baseUrl}`);
  }

  /**
   * Set new base URL and update axios instance
   * @param url new base URL
   */
  setBaseUrl(url: string): void {
    this.baseUrl = url;
    this.axios.defaults.baseURL = url;
    console.error(`Updated API base URL to: ${url}`);
  }

  /**
   * check API connection
   * simplified version that just checks if API is available
   */
  async checkApiConnection(): Promise<boolean> {
    try {
      console.error(`Checking API connection to: ${this.baseUrl}`);
      
      // Try simple endpoint with short timeout
      const response = await this.axios.get("/sdapi/v1/options", {
        timeout: 5000,
        validateStatus: (status) => status >= 200
      });
      
      const isConnected = response.status >= 200;
      console.error(`API connection check: ${isConnected ? "Success" : "Failed"}`);
      return isConnected;
    } catch (error) {
      console.error(`API connection check failed: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * get default params
   */
  getDefaultParams(): ImageGenerationParams {
    return defaultParams;
  }

  /**
   * generate image
   * @param inputParams user provided params
   */
  async generateImage(
    inputParams: Partial<ImageGenerationParams> = {}
  ): Promise<DrawThingsGenerationResult> {
    try {
      // handle input params
      let params: Partial<ImageGenerationParams> = {};

      // validate params
      try {
        const validationResult = validateImageGenerationParams(inputParams);
        if (validationResult.valid) {
          params = inputParams;
        } else {
          console.error("parameter validation failed, use default params");
        }
      } catch (error) {
        console.error("parameter validation error:", error);
      }

      // handle random_string special case
      if (
        params.random_string &&
        (!params.prompt || Object.keys(params).length === 1)
      ) {
        params.prompt = params.random_string;
        delete params.random_string;
      }

      // ensure prompt
      if (!params.prompt) {
        params.prompt = inputParams.prompt || defaultParams.prompt;
      }

      // merge params
      const requestParams = {
        ...defaultParams,
        ...params,
        seed: params.seed ?? Math.floor(Math.random() * 2147483647),
      };

      console.error(`use prompt: "${requestParams.prompt}"`);

      // send request to Draw Things API
      console.error("send request to Draw Things API...");
      const response = await this.axios.post(
        "/sdapi/v1/txt2img",
        requestParams
      );

      // handle response
      if (
        !response.data ||
        !response.data.images ||
        response.data.images.length === 0
      ) {
        throw new Error("API did not return image data");
      }

      // handle image data
      const imageData = response.data.images[0];

      // format image data
      const formattedImageData = imageData.startsWith("data:image/")
        ? imageData
        : `data:image/png;base64,${imageData}`;

      console.error("image generation success");
      return {
        isError: false,
        imageData: formattedImageData,
        parameters: requestParams,
      };
    } catch (error) {
      console.error("image generation error:", error);

      // error message
      let errorMessage = "unknown error";

      if (error instanceof Error) {
        errorMessage = error.message;
      }

      // handle axios error
      const axiosError = error as any;
      if (axiosError.response) {
        errorMessage = `API error: ${axiosError.response.status} - ${
          axiosError.response.data?.error || axiosError.message
        }`;
      } else if (axiosError.code === "ECONNREFUSED") {
        errorMessage =
          "cannot connect to Draw Things API. please ensure Draw Things is running and API is enabled.";
      } else if (axiosError.code === "ETIMEDOUT") {
        errorMessage =
          "connection to Draw Things API timeout. image generation may take longer, or API not responding.";
      }

      return {
        isError: true,
        errorMessage,
      };
    }
  }
}
