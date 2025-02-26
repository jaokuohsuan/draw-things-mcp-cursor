import { z } from 'zod';

// Parameter structure definition
export const ImageGenerationParamsSchema = z.object({
  // Basic parameters
  prompt: z.string().optional(),
  negative_prompt: z.string().optional(),
  
  // Size parameters
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  
  // Generation control parameters
  steps: z.number().int().positive().optional(),
  seed: z.number().int().optional(),
  guidance_scale: z.number().positive().optional(),
  
  // Model parameters
  model: z.string().optional(),
  sampler: z.string().optional(),
  
  // MCP special parameters
  random_string: z.string().optional(),
  
  // Other available parameters, but not strictly required
}).passthrough(); // Allow other unknown parameters to pass through

// Define the type from the schema
export type ImageGenerationParams = z.infer<typeof ImageGenerationParamsSchema>;

// Generation result structure definition
export const ImageGenerationResultSchema = z.object({
  status: z.number(),
  images: z.array(z.string()).optional(),
  parameters: z.record(z.any()).optional(),
  error: z.string().optional()
});

export type ImageGenerationResult = z.infer<typeof ImageGenerationResultSchema>;

// Success response structure definition
export const SuccessResponseSchema = z.object({
  content: z.array(
    z.object({
      type: z.literal('image'),
      data: z.string(),
      mimeType: z.string()
    })
  )
});

export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;

// Error response structure definition
export const ErrorResponseSchema = z.object({
  content: z.array(
    z.object({
      type: z.literal('text'),
      text: z.string()
    })
  ),
  isError: z.literal(true)
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// MCP response structure definition
export const McpResponseSchema = z.union([
  SuccessResponseSchema,
  ErrorResponseSchema
]);

export type McpResponse = z.infer<typeof McpResponseSchema>; 