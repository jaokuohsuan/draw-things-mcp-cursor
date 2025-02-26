/**
 * 圖像生成相關的介面定義
 */

/**
 * 圖像回應格式
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
  imageSavedPath?: string; // 可選屬性，用於儲存圖像的檔案路徑
}

/**
 * 圖像生成參數
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
 * 圖像生成結果
 */
export interface ImageGenerationResult {
  status?: number;  // 改為可選
  error?: string;
  images?: string[];
  imageData?: string;
  isError?: boolean;
  errorMessage?: string;
}

/**
 * Draw Things 服務的生成結果
 */
export interface DrawThingsGenerationResult {
  isError: boolean;
  imageData?: string;
  errorMessage?: string;
  parameters?: Record<string, any>;
  status?: number; // 新增屬性以相容 ImageGenerationResult
  images?: string[]; // 新增屬性以相容 ImageGenerationResult
  error?: string;    // 新增屬性以相容 ImageGenerationResult
} 