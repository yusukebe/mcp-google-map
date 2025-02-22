#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { GET_PLACE_DETAILS_TOOL, SEARCH_NEARBY_TOOL } from "./maps-tools/mapsTools.js";
import { PlacesSearcher } from "./maps-tools/searchPlaces.js";

const tools = [SEARCH_NEARBY_TOOL, GET_PLACE_DETAILS_TOOL];
const placesSearcher = new PlacesSearcher();

const server = new Server(
  {
    name: "mcp-server/maps_executor",
    version: "0.0.1",
  },
  {
    capabilities: {
      description: "An MCP server providing Google Maps integration!",
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (!args) {
      throw new Error("No parameters provided");
    }

    if (name === "search_nearby") {
      const { center, keyword, radius, openNow, minRating } = args as {
        center: { value: string; isCoordinates: boolean };
        keyword?: string;
        radius?: number;
        openNow?: boolean;
        minRating?: number;
      };

      const result = await placesSearcher.searchNearby({
        center,
        keyword,
        radius,
        openNow,
        minRating,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.error || "搜尋失敗" }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `location: ${JSON.stringify(result.location, null, 2)}\n` + JSON.stringify(result.data, null, 2),
          },
        ],
        isError: false,
      };
    }

    if (name === "get_place_details") {
      const { placeId } = args as {
        placeId: string;
      };

      const result = await placesSearcher.getPlaceDetails(placeId);

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.error || "獲取詳細資訊失敗" }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data, null, 2),
          },
        ],
        isError: false,
      };
    }

    return {
      content: [{ type: "text", text: `錯誤：未知的工具 ${name}` }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `錯誤：${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function runServer() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log("MCP Maps Server started");
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
}

runServer().catch((error) => {
  console.error("Server encountered a critical error:", error);
  process.exit(1);
});
