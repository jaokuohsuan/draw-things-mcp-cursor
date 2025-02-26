#!/usr/bin/env node

/**
 * Draw Things API Connection Test
 * 測試不同方式連接到 Draw Things API
 */

import http from 'http';
import https from 'https';
import axios from 'axios';
import fs from 'fs';

// 記錄檔
const logFile = 'api-connection-test.log';
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  fs.appendFileSync(logFile, logMessage);
  console.log(message);
}

// 錯誤記錄
function logError(error, message = 'Error') {
  const timestamp = new Date().toISOString();
  const errorDetails = error instanceof Error ? 
    `${error.message}\n${error.stack}` : 
    String(error);
  const logMessage = `${timestamp} - [ERROR] ${message}: ${errorDetails}\n`;
  fs.appendFileSync(logFile, logMessage);
  console.error(`${message}: ${error.message}`);
}

// 讀取參數
const apiPort = process.env.DRAW_THINGS_API_PORT || 7888;
const apiProxyPort = process.env.PROXY_PORT || 7889;

log('Draw Things API Connection Test');
log('===========================');
log(`Testing API on port ${apiPort}`);
log(`Testing proxy on port ${apiProxyPort}`);
log('');

// 測試 1: 直接使用 HTTP 模組連接
async function testHttpModule() {
  log('Test 1: 使用 Node.js HTTP 模組連接');
  
  return new Promise((resolve) => {
    try {
      const urls = [
        { name: '直接 API 連接 (127.0.0.1)', host: '127.0.0.1', port: apiPort },
        { name: '直接 API 連接 (localhost)', host: 'localhost', port: apiPort },
        { name: '代理伺服器連接 (127.0.0.1)', host: '127.0.0.1', port: apiProxyPort },
        { name: '代理伺服器連接 (localhost)', host: 'localhost', port: apiProxyPort }
      ];
      
      let completedTests = 0;
      const results = [];

      for (const url of urls) {
        log(`測試連接: ${url.name}`);
        
        const options = {
          hostname: url.host,
          port: url.port,
          path: '/sdapi/v1/options',
          method: 'GET',
          timeout: 5000,
          headers: {
            'User-Agent': 'DrawThingsMCP/1.0',
            'Accept': 'application/json'
          }
        };
        
        const req = http.request(options, (res) => {
          log(`${url.name} 回應狀態碼: ${res.statusCode}`);
          
          let data = '';
          res.on('data', chunk => {
            data += chunk;
          });
          
          res.on('end', () => {
            const success = res.statusCode >= 200 && res.statusCode < 300;
            results.push({
              name: url.name,
              success,
              statusCode: res.statusCode,
              hasData: !!data
            });
            
            completedTests++;
            if (completedTests === urls.length) {
              resolve(results);
            }
          });
        });
        
        req.on('error', (e) => {
          log(`${url.name} 錯誤: ${e.message}`);
          results.push({
            name: url.name,
            success: false,
            error: e.message
          });
          
          completedTests++;
          if (completedTests === urls.length) {
            resolve(results);
          }
        });
        
        req.on('timeout', () => {
          log(`${url.name} 連接逾時`);
          req.destroy();
          
          results.push({
            name: url.name,
            success: false,
            error: 'Timeout'
          });
          
          completedTests++;
          if (completedTests === urls.length) {
            resolve(results);
          }
        });
        
        req.end();
      }
    } catch (error) {
      logError(error, 'HTTP 模組測試發生錯誤');
      resolve([]);
    }
  });
}

// 測試 2: 使用 Axios 連接
async function testAxios() {
  log('Test 2: 使用 Axios 連接');
  
  try {
    const urls = [
      { name: '直接 API 連接 (127.0.0.1)', url: `http://127.0.0.1:${apiPort}/sdapi/v1/options` },
      { name: '直接 API 連接 (localhost)', url: `http://localhost:${apiPort}/sdapi/v1/options` },
      { name: '代理伺服器連接 (127.0.0.1)', url: `http://127.0.0.1:${apiProxyPort}/sdapi/v1/options` },
      { name: '代理伺服器連接 (localhost)', url: `http://localhost:${apiProxyPort}/sdapi/v1/options` },
    ];
    
    const results = [];
    
    for (const url of urls) {
      log(`測試連接: ${url.name}`);
      
      try {
        const response = await axios.get(url.url, {
          timeout: 5000,
          headers: {
            'User-Agent': 'DrawThingsMCP/1.0',
            'Accept': 'application/json'
          }
        });
        
        log(`${url.name} 回應狀態碼: ${response.status}`);
        
        results.push({
          name: url.name,
          success: response.status >= 200 && response.status < 300,
          statusCode: response.status,
          hasData: !!response.data
        });
      } catch (error) {
        log(`${url.name} 錯誤: ${error.message}`);
        
        results.push({
          name: url.name,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  } catch (error) {
    logError(error, 'Axios 測試發生錯誤');
    return [];
  }
}

// 測試 3: 嘗試不同的端點
async function testDifferentEndpoints() {
  log('Test 3: 測試不同的 API 端點');
  
  try {
    // 使用工作正常的連接方式 (localhost 或 127.0.0.1)
    const baseUrl = `http://127.0.0.1:${apiPort}`;
    
    const endpoints = [
      '/sdapi/v1/options',
      '/sdapi/v1/samplers',
      '/sdapi/v1/sd-models',
      '/sdapi/v1/prompt-styles',
      '/'
    ];
    
    const results = [];
    
    for (const endpoint of endpoints) {
      log(`測試端點: ${endpoint}`);
      
      try {
        const response = await axios.get(`${baseUrl}${endpoint}`, {
          timeout: 5000,
          headers: {
            'User-Agent': 'DrawThingsMCP/1.0',
            'Accept': 'application/json'
          }
        });
        
        log(`端點 ${endpoint} 回應狀態碼: ${response.status}`);
        
        results.push({
          endpoint,
          success: response.status >= 200 && response.status < 300,
          statusCode: response.status,
          hasData: !!response.data
        });
      } catch (error) {
        log(`端點 ${endpoint} 錯誤: ${error.message}`);
        
        results.push({
          endpoint,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  } catch (error) {
    logError(error, '端點測試發生錯誤');
    return [];
  }
}

// 執行測試
async function runTests() {
  try {
    // 測試 1: HTTP 模組
    log('\n執行 HTTP 模組測試...');
    const httpResults = await testHttpModule();
    
    log('\nHTTP 模組測試結果:');
    httpResults.forEach(result => {
      log(`${result.name}: ${result.success ? '成功' : '失敗'} ${result.statusCode ? `(狀態碼: ${result.statusCode})` : ''} ${result.error ? `(錯誤: ${result.error})` : ''}`);
    });
    
    // 測試 2: Axios
    log('\n執行 Axios 測試...');
    const axiosResults = await testAxios();
    
    log('\nAxios 測試結果:');
    axiosResults.forEach(result => {
      log(`${result.name}: ${result.success ? '成功' : '失敗'} ${result.statusCode ? `(狀態碼: ${result.statusCode})` : ''} ${result.error ? `(錯誤: ${result.error})` : ''}`);
    });
    
    // 測試 3: 不同端點
    log('\n執行不同端點測試...');
    const endpointResults = await testDifferentEndpoints();
    
    log('\n不同端點測試結果:');
    endpointResults.forEach(result => {
      log(`端點 ${result.endpoint}: ${result.success ? '成功' : '失敗'} ${result.statusCode ? `(狀態碼: ${result.statusCode})` : ''} ${result.error ? `(錯誤: ${result.error})` : ''}`);
    });
    
    // 總結
    const httpSuccess = httpResults.some(r => r.success);
    const axiosSuccess = axiosResults.some(r => r.success);
    const endpointSuccess = endpointResults.some(r => r.success);
    
    log('\n=== 測試總結 ===');
    log(`HTTP 模組連接測試: ${httpSuccess ? '至少有一個成功' : '全部失敗'}`);
    log(`Axios 連接測試: ${axiosSuccess ? '至少有一個成功' : '全部失敗'}`);
    log(`端點測試: ${endpointSuccess ? '至少有一個成功' : '全部失敗'}`);
    
    if (httpSuccess || axiosSuccess) {
      log('\nAPI 連接測試成功! 您的 Draw Things API 似乎可以正常工作。');
      
      // 建議最佳連接方式
      const bestConnection = [...httpResults, ...axiosResults].find(r => r.success);
      if (bestConnection) {
        log(`建議使用連接方式: ${bestConnection.name}`);
      }
    } else {
      log('\nAPI 連接測試失敗! 請確認:');
      log('1. Draw Things 應用程式正在運行');
      log('2. Draw Things 已啟用 API 功能');
      log('3. API 在設定的端口上運行 (默認 7888)');
      log('4. 沒有防火牆阻擋連接');
    }
    
  } catch (error) {
    logError(error, '測試執行過程中發生錯誤');
  }
}

// 執行測試
runTests().catch(error => {
  logError(error, '測試主程序發生錯誤');
}); 