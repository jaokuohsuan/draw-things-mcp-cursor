/**
 * image generation params interface
 */

// params interface
export interface ImageGenerationParams {
  // basic params
  prompt?: string;
  negative_prompt?: string;

  // size params
  width?: number;
  height?: number;

  // generate control params
  steps?: number;
  seed?: number;
  guidance_scale?: number;

  // model params
  model?: string;
  sampler?: string;

  // MCP special params
  random_string?: string;

  // allow other params
  [key: string]: any;
}

// function for validating ImageGenerationParams
export function validateImageGenerationParams(params: any): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // check params type
  if (params.prompt !== undefined && typeof params.prompt !== "string") {
    errors.push("prompt must be a string");
  }

  if (
    params.negative_prompt !== undefined &&
    typeof params.negative_prompt !== "string"
  ) {
    errors.push("negative_prompt must be a string");
  }

  if (
    params.width !== undefined &&
    (typeof params.width !== "number" ||
      params.width <= 0 ||
      !Number.isInteger(params.width))
  ) {
    errors.push("width must be a positive integer");
  }

  if (
    params.height !== undefined &&
    (typeof params.height !== "number" ||
      params.height <= 0 ||
      !Number.isInteger(params.height))
  ) {
    errors.push("height must be a positive integer");
  }

  if (
    params.steps !== undefined &&
    (typeof params.steps !== "number" ||
      params.steps <= 0 ||
      !Number.isInteger(params.steps))
  ) {
    errors.push("steps must be a positive integer");
  }

  if (
    params.seed !== undefined &&
    (typeof params.seed !== "number" || !Number.isInteger(params.seed))
  ) {
    errors.push("seed must be an integer");
  }

  if (
    params.guidance_scale !== undefined &&
    (typeof params.guidance_scale !== "number" || params.guidance_scale <= 0)
  ) {
    errors.push("guidance_scale must be a positive number");
  }

  if (params.model !== undefined && typeof params.model !== "string") {
    errors.push("model must be a string");
  }

  if (params.sampler !== undefined && typeof params.sampler !== "string") {
    errors.push("sampler must be a string");
  }

  if (
    params.random_string !== undefined &&
    typeof params.random_string !== "string"
  ) {
    errors.push("random_string must be a string");
  }

  return { valid: errors.length === 0, errors };
}

// response interface
export interface ImageGenerationResult {
  status?: number;
  images?: string[];
  parameters?: Record<string, any>;
  error?: string;
}

// success response interface
export interface SuccessResponse {
  content: Array<{
    type: "image";
    data: string;
    mimeType: string;
  }>;
}

// error response interface
export interface ErrorResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError: true;
}

// MCP response interface
export type McpResponse = SuccessResponse | ErrorResponse;
