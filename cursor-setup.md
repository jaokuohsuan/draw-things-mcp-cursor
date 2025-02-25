# Cursor MCP Tool Setup Guide

## Setting Up Draw Things MCP Tool in Cursor

This guide will help you set up and use the Draw Things MCP tool in Cursor editor, allowing you to generate AI images directly within Cursor.

### Prerequisites

- Ensure Draw Things API is running (http://127.0.0.1:7888)
- Node.js v14.0.0 or higher

### 1. Install the Package

#### Local Development Mode

If you're developing or modifying this tool, you can use local linking:

```bash
# In the project directory
npm link
```

#### Publishing to NPM (if needed)

If you want to publish this tool for others to use:

```bash
npm publish
```

Then install globally via npm:

```bash
npm install -g draw-things-mcp-cursor
```

### 2. Create Cursor MCP Configuration File

You need to create or edit the `~/.cursor/claude_desktop_config.json` file to register the MCP tool with Cursor:

```json
{
  "mcpServers": {
    "draw-things": {
      "command": "draw-things-mcp-cursor",
      "args": []
    }
  }
}
```

#### Local Development Configuration

If you're developing locally, it's recommended to use an absolute path to your JS file:

```json
{
  "mcpServers": {
    "draw-things": {
      "command": "node",
      "args": [
        "/Users/james_jao/m800/my-mcp/src/index.js"
      ]
    }
  }
}
```

### 3. Restart Cursor

After configuration, completely close and restart the Cursor editor to ensure the new MCP configuration is properly loaded.

### 4. Using the MCP Tool

In Cursor, you can call the image generation tool when chatting with the AI assistant using the following format:

#### Basic Usage

```
generateImage({"prompt": "a cute cat"})
```

#### Advanced Usage

You can specify additional parameters to fine-tune the generated image:

```
generateImage({
  "prompt": "a cute cat",
  "negative_prompt": "ugly, deformed",
  "width": 512,
  "height": 512,
  "steps": 4,
  "model": "flux_1_schnell_q5p.ckpt"
})
```

### Available Parameters

| Parameter Name | Description | Default Value |
|----------------|-------------|---------------|
| prompt | The image generation prompt | (Required) |
| negative_prompt | Elements to avoid in the image | (Empty) |
| width | Image width (pixels) | 360 |
| height | Image height (pixels) | 360 |
| steps | Number of generation steps (higher is more detailed but slower) | 8 |
| model | Model name to use | "flux_1_schnell_q5p.ckpt" |

### Troubleshooting

If you encounter issues when setting up or using the MCP tool, check:

- Log files in the `~/.cursor/logs` directory for detailed error information
- Ensure Draw Things API is started and running at http://127.0.0.1:7888
- Make sure the src/index.js file has execution permissions: `chmod +x src/index.js`
- Check for error messages in the terminal: `draw-things-mcp-cursor`

### Getting Help

If you have any questions, please open an issue on the project's GitHub page:
https://github.com/james-jao/draw-things-mcp/issues 