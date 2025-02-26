/**
 * HTTP 請求相關的介面定義
 */

/**
 * 自訂的 Fetch 選項，擴展原生 RequestInit
 */
export interface FetchOptions extends RequestInit {
  timeout?: number;
  validateStatus?: (status: number) => boolean;
} 