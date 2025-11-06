import { streamText, dynamicTool, jsonSchema, type Tool } from 'ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatRequestBody = {
  messages?: ChatMessage[];
  settings?: {
    provider?: 'google' | 'gateway' | 'nim' | 'openrouter';
    model?: string;
    apiKey?: string;
    composioToolRouterMcpUrl?: string;
    chatSessionMcpUrl?: string;
    maxSteps?: number;
  };
};

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  let mcpCleanup: (() => Promise<void> | void) | undefined;

  try {
    const body = (await request.json()) as ChatRequestBody;

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return createJsonErrorResponse('Missing messages in request body', 400);
    }

    const {
      provider = 'google',
      model: requestedModel,
      apiKey: providedApiKey,
      composioToolRouterMcpUrl,
      chatSessionMcpUrl,
    } = body.settings ?? {};

    const apiKey = providedApiKey ?? resolveApiKey(provider);

    if (!apiKey) {
      return createJsonErrorResponse(`Missing API key for provider "${provider}"`, 400);
    }

    const mcpUrl =
      composioToolRouterMcpUrl ??
      chatSessionMcpUrl ??
      process.env.MCP_TOOL_ROUTER_URL ??
      process.env.MCP_CHAT_URL;

    if (!mcpUrl) {
      return createJsonErrorResponse(
        'Missing MCP server URL. Provide composioToolRouterMcpUrl or MCP_TOOL_ROUTER_URL env.',
        400,
      );
    }

    const { tools, close: closeMcp } = await createMcpToolSet(mcpUrl);
    mcpCleanup = closeMcp;

    const model = await resolveModel(provider, apiKey, requestedModel);
    const aiMessages = body.messages.map(({ role, content }) => ({ role, content }));

    const result = streamText({
      model,
      tools,
      messages: aiMessages,
      abortSignal: request.signal,
    });

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const part of result.fullStream) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({
                message: error instanceof Error ? error.message : String(error),
              })}\n\n`,
            ),
          );
        } finally {
          controller.close();
          await closeMcp?.();
        }
      },
      cancel: async () => {
        await closeMcp?.();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    if (mcpCleanup) {
      await mcpCleanup();
    }

    return createJsonErrorResponse(
      error instanceof Error ? error.message : 'Unexpected server error',
      500,
    );
  }
}

export async function GET(): Promise<Response> {
  return createJsonErrorResponse('Method Not Allowed', 405);
}

async function resolveModel(provider: string, apiKey: string, requestedModel?: string) {
  switch (provider) {
    case 'gateway': {
      const { createGateway } = await import('@ai-sdk/gateway');
      const client = createGateway({ apiKey });
      return client(requestedModel ?? 'google/gemini-2.5-flash-lite');
    }
    case 'openrouter': {
      const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
      const openRouterClient = createOpenRouter({
        apiKey,
        headers: {
          'HTTP-Referer': process.env.OPENROUTER_REFERRER ?? 'https://atlas-extension',
          'X-Title': process.env.OPENROUTER_TITLE ?? 'Opulent Browser',
        },
      });
      return openRouterClient.chat(requestedModel ?? 'openrouter/auto');
    }
    case 'nim': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const nimClient = createOpenAI({
        apiKey,
        baseURL: 'https://integrate.api.nvidia.com/v1',
      });
      return nimClient(requestedModel ?? 'meta/llama-3.1-70b-instruct');
    }
    case 'google':
    default: {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const googleClient = createGoogleGenerativeAI({ apiKey });
      return googleClient(requestedModel ?? 'gemini-2.5-flash');
    }
  }
}

async function createMcpToolSet(baseUrl: string): Promise<{ tools: Record<string, Tool>; close: () => Promise<void> }> {
  const url = new URL(baseUrl);
  const client = new Client({
    name: 'open-chatgpt-atlas',
    version: '1.0.0',
  });

  let connected = false;

  try {
    const transport = new StreamableHTTPClientTransport(url);
    await client.connect(transport);
    connected = true;
  } catch (httpError) {
    console.warn('Streamable HTTP transport failed, falling back to SSE transport:', httpError);
  }

  if (!connected) {
    const transport = new SSEClientTransport(url);
    await client.connect(transport);
  }

  const { tools: mcpTools } = await client.listTools({});

  const toolMap: Record<string, Tool> = {};

  for (const tool of mcpTools) {
    const description = resolveToolDescription(tool);

    const inputSchema =
      tool.inputSchema && Object.keys(tool.inputSchema).length > 0
        ? jsonSchema(tool.inputSchema as any)
        : jsonSchema(() => ({ type: 'object', additionalProperties: true } as const));

    toolMap[tool.name] = dynamicTool({
      description,
      inputSchema,
      execute: async (rawArgs: unknown) => {
        const args = (rawArgs ?? {}) as Record<string, unknown>;
        const result = await client.callTool({
          name: tool.name,
          arguments: args,
        });

        if (result.structuredContent !== undefined) {
          return result.structuredContent;
        }

        if (Array.isArray(result.content) && result.content.length > 0) {
          const textParts = result.content
            .map((part) => ('text' in part ? part.text : undefined))
            .filter((part): part is string => typeof part === 'string');

          if (textParts.length > 0) {
            return { text: textParts.join('\n') };
          }
        }

        if (result.isError) {
          const errorText =
            Array.isArray(result.content) && result.content.length > 0
              ? result.content
                  .map((part) => ('text' in part ? part.text : undefined))
                  .filter((part): part is string => typeof part === 'string')
                  .join('\n')
                  .trim()
              : undefined;
          throw new Error(errorText && errorText.length > 0 ? errorText : `MCP tool ${tool.name} returned an error`);
        }

        return { success: true };
      },
    });
  }

  return {
    tools: toolMap,
    close: async () => {
      try {
        await client.close();
      } catch (error) {
        console.warn('Failed to close MCP client', error);
      }
    },
  };
}

function resolveApiKey(provider: string): string | undefined {
  switch (provider) {
    case 'gateway':
      return process.env.AI_GATEWAY_API_KEY ?? process.env.OPENROUTER_API_KEY ?? undefined;
    case 'openrouter':
      return process.env.OPENROUTER_API_KEY ?? undefined;
    case 'nim':
      return process.env.NVIDIA_NIM_API_KEY ?? undefined;
    case 'google':
    default:
      return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? undefined;
  }
}

function resolveToolDescription(tool: {
  description?: string;
  annotations?: unknown;
  metadata?: unknown;
  name: string;
}): string {
  if (tool.description) {
    return tool.description;
  }

  const annotationDescription =
    typeof tool.annotations === 'object' &&
    tool.annotations !== null &&
    'description' in tool.annotations
      ? (tool.annotations as Record<string, unknown>).description
      : undefined;

  if (typeof annotationDescription === 'string' && annotationDescription.trim().length > 0) {
    return annotationDescription;
  }

  const metadataDescription =
    typeof tool.metadata === 'object' &&
    tool.metadata !== null &&
    'description' in tool.metadata
      ? (tool.metadata as Record<string, unknown>).description
      : undefined;

  if (typeof metadataDescription === 'string' && metadataDescription.trim().length > 0) {
    return metadataDescription;
  }

  return `MCP tool ${tool.name}`;
}

function createJsonErrorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
