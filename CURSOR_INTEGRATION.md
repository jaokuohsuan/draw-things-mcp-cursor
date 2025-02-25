# Complete Guide for Using Draw Things MCP in Cursor

This documentation provides steps for correctly using Draw Things MCP service to generate images in Cursor, following the [Model Context Protocol](https://modelcontextprotocol.io/docs/concepts/transports) specification.

## Background

When directly using the `mcp_generateImage` tool in Cursor, the following issues occur:

1. Cursor sends plain text prompts instead of the correct JSON-RPC 2.0 format
2. MCP service cannot parse this input format, resulting in the error `Unexpected token A in JSON at position 0`
3. According to the [MCP documentation](https://docs.cursor.com/context/model-context-protocol), communication must use a specific JSON-RPC 2.0 format

## Solution: Bridge Service

We provide a bridge service that automatically converts Cursor's plain text prompts to the correct JSON-RPC 2.0 format.

### Step 1: Environment Setup

First, ensure you have installed these prerequisites:

1. Node.js and npm
2. Draw Things application
3. API enabled in Draw Things (port 7888)

### Step 2: Start the Bridge Service

We provide a startup script that easily launches the bridge service:

```bash
# Grant execution permission
chmod +x start-cursor-bridge.sh

# Basic usage
./start-cursor-bridge.sh

# Use debug mode
./start-cursor-bridge.sh --debug

# View help
./start-cursor-bridge.sh --help
```

This script will:
1. Check if the Draw Things API is available
2. Start the bridge service
3. Start the MCP service
4. Connect the two services so they can communicate with each other

### Step 3: Using in Cursor

When the bridge service is running, the following two input methods are supported when using the `mcp_generateImage` tool in Cursor:

1. **Directly send English prompts** (the bridge service will automatically convert to JSON-RPC format):
   ```
   A group of adorable kittens playing together, cute, fluffy, detailed fur, warm lighting, playful mood
   ```

2. **Use JSON objects** (suitable when more custom parameters are needed):
   ```json
   {
     "prompt": "A group of adorable kittens playing together, cute, fluffy, detailed fur, warm lighting, playful mood",
     "negative_prompt": "blurry, distorted, low quality",
     "seed": 12345
   }
   ```

### Step 4: View Results

Generated images will be saved in the `images` directory. You can also check the `cursor-mcp-bridge.log` file to understand the bridge service's operation.

## JSON-RPC 2.0 Format Explanation

According to the MCP specification, the correct request format should be:

```json
{
  "jsonrpc": "2.0",
  "id": "request-123",
  "method": "mcp.invoke",
  "params": {
    "tool": "generateImage",
    "parameters": {
      "prompt": "A group of adorable kittens playing together",
      "negative_prompt": "blurry, low quality",
      "seed": 12345
    }
  }
}
```

Our bridge service automatically converts simple inputs to this format.

## Custom Options

You can modify default parameters by editing the `src/services/drawThings/defaultParams.js` file, such as:

- Model selection
- Image dimensions
- Sampler type
- Other generation parameters

## Troubleshooting

### Check Logs

If you encounter problems, first check these logs:

1. `cursor-mcp-bridge.log` - Bridge service logs
2. `cursor-mcp-debug.log` - Detailed logs when debug mode is enabled
3. `error.log` - MCP service error logs

### Common Issues

1. **Connection Error**: Ensure the Draw Things application is running and API is enabled (127.0.0.1:7888).

2. **Parsing Error**: Check the format of prompts sent from Cursor. The bridge service should handle most cases, but complex JSON structures may cause issues.

3. **Service Not Started**: Make sure both the bridge service and MCP service are running. Please use the provided startup script, which will automatically handle both services.

## Technical Details

How the bridge service works:

1. Receives plain text or JSON input from Cursor
2. Converts it to JSON-RPC 2.0 format compliant with MCP specifications
3. Passes the converted request to the MCP service
4. MCP service communicates with the Draw Things API
5. Receives the response and saves the generated image to the file system

### Transport Layer

According to the MCP specification, our bridge service implements the following functions:

- Uses stdin/stdout as the transport layer
- Correctly handles JSON-RPC 2.0 request/response formats
- Supports error handling and logging
- Automatically saves generated images

If you need more customization, you can edit the `cursor-mcp-bridge.js` file. 