import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { isInitializeRequest, SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import express, { Request, Response } from 'express'
import { Server } from 'http'
import { randomUUID } from 'node:crypto'
import { Logger } from '../index.js'

const VERSION = '0.0.1'

// MCP logging levels
type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency'

// Define a structure for tool configurations
export interface ToolConfig {
  name: string
  description: string
  schema: any // Adjust type as per actual SDK (e.g., ZodSchema)
  action: (params: any) => Promise<any> // Adjust type for params and return
}

export class BaseMcpServer {
  protected readonly server: McpServer
  private transports: { [sessionId: string]: StreamableHTTPServerTransport | SSEServerTransport } = {}
  private httpServer: Server | null = null
  private serverName: string
  private currentLogLevel: LogLevel = 'info'

  constructor(name: string, tools: ToolConfig[]) {
    this.serverName = name
    this.server = new McpServer(
      {
        name: this.serverName,
        version: VERSION
      },
      {
        capabilities: {
          logging: {},
          tools: {},
          resources: {}
        }
      }
    )

    this.registerTools(tools)
    this.registerLoggingHandler()
  }

  private registerTools(tools: ToolConfig[]): void {
    tools.forEach((tool) => {
      this.server.tool(tool.name, tool.description, tool.schema, async (params: any) => tool.action(params))
    })
  }

  private registerLoggingHandler(): void {
    // Register the logging/setLevel handler
    this.server.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      const { level } = request.params
      this.currentLogLevel = level

      Logger.log(`[${this.serverName}] Log level set to: ${level}`)

      return {}
    })
  }

  // Log level priority mapping (higher number = more severe)
  private getLogLevelPriority(level: LogLevel): number {
    const priorities: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      notice: 2,
      warning: 3,
      error: 4,
      critical: 5,
      alert: 6,
      emergency: 7
    }
    return priorities[level] || 1
  }

  // Check if a message should be logged based on current log level
  private shouldLog(messageLevel: LogLevel): boolean {
    return this.getLogLevelPriority(messageLevel) >= this.getLogLevelPriority(this.currentLogLevel)
  }

  // Get current log level
  public getCurrentLogLevel(): LogLevel {
    return this.currentLogLevel
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport)

    // Ensure stdout is only used for JSON messages
    const originalStdoutWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: any, encoding?: any, callback?: any) => {
      if (typeof chunk === 'string' && !chunk.startsWith('{')) {
        return true // Silently skip non-JSON messages
      }
      return originalStdoutWrite(chunk, encoding, callback)
    }

    Logger.log(`${this.serverName} connected and ready to process requests`)
  }

  async startHttpServer(port: number): Promise<void> {
    const app = express()
    app.use(express.json())

    // Handle POST requests for client-to-server communication
    app.post('/mcp', async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      let transport: StreamableHTTPServerTransport

      if (sessionId && this.transports[sessionId]) {
        // Check if the transport is of the correct type
        const existingTransport = this.transports[sessionId]
        if (existingTransport instanceof StreamableHTTPServerTransport) {
          // Reuse existing transport
          transport = existingTransport
        } else {
          // Transport exists but is not a StreamableHTTPServerTransport (could be SSEServerTransport)
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: Session exists but uses a different transport protocol'
            },
            id: null
          })
          return
        }
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            this.transports[sessionId] = transport
            Logger.log(`[${this.serverName}] New session initialized: ${sessionId}`)
          }
          // DNS rebinding protection is disabled by default for backwards compatibility
          // For production use, enable this:
          // enableDnsRebindingProtection: true,
          // allowedHosts: ['127.0.0.1'],
        })

        // Clean up transport when closed
        transport.onclose = () => {
          if (transport.sessionId) {
            delete this.transports[transport.sessionId]
            Logger.log(`[${this.serverName}] Session closed: ${transport.sessionId}`)
          }
        }

        await this.server.connect(transport)
      } else {
        // Invalid request
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided'
          },
          id: null
        })
        return
      }

      // Handle the request
      await transport.handleRequest(req, res, req.body)
    })

    // Reusable handler for GET and DELETE requests
    const handleSessionRequest = async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      if (!sessionId || !this.transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID')
        return
      }

      const transport = this.transports[sessionId]
      // Only StreamableHTTPServerTransport supports handleRequest
      if (transport instanceof StreamableHTTPServerTransport) {
        await transport.handleRequest(req, res)
      } else {
        res.status(400).send('This endpoint only supports StreamableHTTP transport')
      }
    }

    // Handle GET requests for server-to-client notifications via SSE
    app.get('/mcp', handleSessionRequest)

    // Handle DELETE requests for session termination
    app.delete('/mcp', handleSessionRequest)

    // SSE endpoint for establishing the stream (deprecated protocol version 2024-11-05)
    app.get('/sse', async (req: Request, res: Response) => {
      Logger.log(`[${this.serverName}] Received GET request to /sse (establishing SSE stream)`)
      try {
        // Create a new SSE transport for the client
        const transport = new SSEServerTransport('/messages', res)

        // Store the transport by session ID
        const sessionId = transport.sessionId
        this.transports[sessionId] = transport

        // Set up onclose handler to clean up transport when closed
        transport.onclose = () => {
          Logger.log(`[${this.serverName}] SSE transport closed for session ${sessionId}`)
          delete this.transports[sessionId]
        }

        // Connect the transport to the MCP server
        await this.server.connect(transport)
        Logger.log(`[${this.serverName}] Established SSE stream with session ID: ${sessionId}`)
      } catch (error) {
        Logger.error(`[${this.serverName}] Error establishing SSE stream:`, error)
        if (!res.headersSent) {
          res.status(500).send('Error establishing SSE stream')
        }
      }
    })

    // Messages endpoint for receiving client JSON-RPC requests (deprecated protocol)
    app.post('/messages', async (req: Request, res: Response) => {
      Logger.log(`[${this.serverName}] Received POST request to /messages`)

      // Extract session ID from URL query parameter
      const sessionId = req.query.sessionId as string
      if (!sessionId) {
        Logger.error(`[${this.serverName}] No session ID provided in request URL`)
        res.status(400).send('Missing sessionId parameter')
        return
      }

      const transport = this.transports[sessionId]
      if (!transport) {
        Logger.error(`[${this.serverName}] No active transport found for session ID: ${sessionId}`)
        res.status(404).send('Session not found')
        return
      }

      // Check if transport is SSEServerTransport
      if (!(transport instanceof SSEServerTransport)) {
        Logger.error(`[${this.serverName}] Session exists but uses different transport protocol`)
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: Session exists but uses a different transport protocol'
          },
          id: null
        })
        return
      }

      try {
        // Handle the POST message with the transport
        await transport.handlePostMessage(req, res, req.body)
      } catch (error) {
        Logger.error(`[${this.serverName}] Error handling request:`, error)
        if (!res.headersSent) {
          res.status(500).send('Error handling request')
        }
      }
    })

    this.httpServer = app.listen(port, () => {
      Logger.log(`[${this.serverName}] HTTP server listening on port ${port}`)
      Logger.log(`[${this.serverName}] MCP endpoint available at http://localhost:${port}/mcp`)
      Logger.log(`[${this.serverName}] SSE endpoint available at http://localhost:${port}/sse`)
      Logger.log(`[${this.serverName}] Messages endpoint available at http://localhost:${port}/messages`)
    })
  }

  async stopHttpServer(): Promise<void> {
    if (!this.httpServer) {
      // Changed to Logger.warn and return, as throwing an error might be too harsh if called multiple times.
      Logger.error(`[${this.serverName}] HTTP server is not running or already stopped.`)
      return
    }

    return new Promise((resolve, reject) => {
      this.httpServer!.close((err: Error | undefined) => {
        if (err) {
          Logger.error(`[${this.serverName}] Error stopping HTTP server:`, err)
          reject(err)
          return
        }
        Logger.log(`[${this.serverName}] HTTP server stopped.`)
        this.httpServer = null
        const closingTransports = Object.values(this.transports).map(async (transport) => {
          try {
            // Clean up transport
            const sessionId =
              transport instanceof StreamableHTTPServerTransport
                ? transport.sessionId
                : transport instanceof SSEServerTransport
                  ? transport.sessionId
                  : undefined

            if (sessionId) {
              delete this.transports[sessionId]
            }

            // Close the transport
            await transport.close()
          } catch (error) {
            Logger.error(`[${this.serverName}] Error closing transport:`, error)
          }
        })
        Promise.all(closingTransports)
          .then(() => {
            Logger.log(`[${this.serverName}] All transports closed.`)
            resolve()
          })
          .catch((transportCloseErr) => {
            // This catch might be redundant if individual transport close errors are handled
            Logger.error(`[${this.serverName}] Error during bulk transport closing:`, transportCloseErr)
            reject(transportCloseErr)
          })
      })
    })
  }
}
