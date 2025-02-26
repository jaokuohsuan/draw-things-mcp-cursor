/**
 * JSON-RPC 2.0 相關的介面定義
 */

/**
 * JSON-RPC 2.0 請求格式
 */
export interface JsonRpcRequest {
  jsonrpc: string;
  id: string;
  method: string;
  params?: {
    tool: string;
    parameters: any;
  };
  prompt?: string;
  parameters?: any;
}

/**
 * JSON-RPC 2.0 回應格式
 */
export interface JsonRpcResponse {
  jsonrpc: string;
  id: string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
} 