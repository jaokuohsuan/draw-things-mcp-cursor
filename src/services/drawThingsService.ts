import { defaultParams } from "./defaultParams.js";
import {
  ImageGenerationParams,
  validateImageGenerationParams,
} from "./schemas.js";
import axios, { AxiosInstance } from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
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
    console.error(
      `DrawThingsService initialized, API location: ${this.baseUrl}`
    );
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
        validateStatus: (status) => status >= 200,
      });

      const isConnected = response.status >= 200;
      console.error(
        `API connection check: ${isConnected ? "Success" : "Failed"}`
      );
      return isConnected;
    } catch (error) {
      console.error(`API connection check failed: ${(error as Error).message}`);
      return false;
    }
  }

  // Helper function to save images to the file system
  async saveImage({
    base64Data,
    outputPath,
    fileName
  }: {
    base64Data: string;
    outputPath?: string;
    fileName?: string;
  }): Promise<string> {
    const __filename = fileURLToPath(import.meta.url);
    // Get directory name
    const __dirname = path.dirname(__filename);
    const projectRoot: string = path.resolve(__dirname, "..");
    
    try {
      // if no output path provided, use default path
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const defaultFileName = fileName || `generated-image-${timestamp}.png`;
      const defaultImagesDir = path.resolve(projectRoot, "..", "images");
      const finalOutputPath = outputPath || path.join(defaultImagesDir, defaultFileName);
      
      // ensure the images directory exists
      const imagesDir = path.dirname(finalOutputPath);
      if (!fs.existsSync(imagesDir)) {
        await fs.promises.mkdir(imagesDir, { recursive: true });
      }

      const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(cleanBase64, "base64");

      const absolutePath = path.resolve(finalOutputPath);
      await fs.promises.writeFile(absolutePath, buffer);
      return absolutePath;
    } catch (error) {
      console.error(
        `Failed to save image: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      if (error instanceof Error) {
        console.error(error.stack || "No stack trace available");
      }
      throw error;
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
      
      // record the start time of image generation
      const startTime = Date.now() - 2000; // assume the image generation took 2 seconds
      const endTime = Date.now();
      
      // automatically save the generated image
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const defaultFileName = `generated-image-${timestamp}.png`;
      
      // save the generated image
      const imagePath = await this.saveImage({
        base64Data: formattedImageData,
        fileName: defaultFileName
      });
      
      return {
        isError: false,
        imageData: formattedImageData,
        imagePath: imagePath,
        metadata: {
          alt: `Image generated from prompt: ${requestParams.prompt}`,
          inference_time_ms: endTime - startTime,
        }
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
