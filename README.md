# Draw Things MCP

Draw Things API integration for Cursor using Model Context Protocol (MCP).

## Prerequisites

- Node.js >= 14.0.0
- Draw Things API running on http://127.0.0.1:7888

## Installation

```bash
npx draw-things-mcp-cursor
```

## Usage

### Check Capabilities

```bash
npx draw-things-mcp-cursor --capabilities
```

### Generate Image

```bash
echo '{"prompt": "your prompt here"}' | npx draw-things-mcp-cursor
```

### Parameters

- `prompt`: The text prompt for image generation
- `negative_prompt`: The negative prompt for image generation
- `width`: Image width (default: 1024)
- `height`: Image height (default: 1024)
- `model`: Model to use for generation (default: "dreamshaper_xl_v2.1_turbo_f16.ckpt")

Example:

```bash
echo '{
  "prompt": "a happy smiling dog, professional photography",
  "negative_prompt": "ugly, deformed, blurry",
  "width": 1024,
  "height": 1024
}' | npx draw-things-mcp-cursor
```

## Response Format

Success:
```json
{
  "type": "success",
  "data": {
    "images": ["base64 encoded image data"],
    "parameters": { ... }
  }
}
```

Error:
```json
{
  "type": "error",
  "error": "error message"
}
```

## License

MIT 