/**
 * images generation interfaces
 */

/**
 * image response format
 */
export interface ImageResponse {
  content: Array<{
    base64: string;
    path: string;
    prompt: string;
    negative_prompt?: string;
    seed: number;
    width: number;
    height: number;
    meta: Record<string, any>;
  }>;
  imageSavedPath?: string; // optional property, for storing image file path
}

/**
 * image generation parameters
 */
export interface ImageGenerationParameters {
  prompt?: string;
  negative_prompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  num_inference_steps?: number;
  guidance_scale?: number;
  model?: string;
  random_string?: string;
  [key: string]: any;
}

/**
 * image generation result
 */
export interface ImageGenerationResult {
  status?: number;  // changed to optional
  error?: string;
  images?: string[];
  imageData?: string;
  isError?: boolean;
  errorMessage?: string;
}

/**
 * Draw Things service generation result
 */
export interface DrawThingsGenerationResult {
  isError: boolean;
  imageData?: string;
  errorMessage?: string;
  parameters?: Record<string, any>;
  status?: number; // added property to compatible with ImageGenerationResult
  images?: string[]; // added property to compatible with ImageGenerationResult
  error?: string;    // added property to compatible with ImageGenerationResult
  imagePath?: string; // added property to store the path of the generated image
  metadata?: {
    alt: string;
    inference_time_ms: number;
  }; // added metadata
} 