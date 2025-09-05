import { z } from "zod";
import { createUIResource } from "@mcp-ui/server";

const NAME = "show_map";
const DESCRIPTION = "Display an interactive Google Map with location or directions in an iframe";

const SCHEMA = {
  type: z.enum(["place", "directions", "streetview"]).describe("Type of map to display"),
  location: z.string().optional().describe("Location name or coordinates for place type"),
  origin: z.string().optional().describe("Starting point for directions"),
  destination: z.string().optional().describe("Destination for directions"),
  mode: z.enum(["driving", "walking", "bicycling", "transit"]).default("driving").describe("Travel mode for directions"),
  zoom: z.number().min(5).max(21).default(15).optional().describe("Map zoom level"),
};

export type ShowMapParams = z.infer<z.ZodObject<typeof SCHEMA>>;

function generateGoogleMapsEmbedUrl(params: ShowMapParams): string {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error("Google Maps API key is required");
  }

  const baseUrl = "https://www.google.com/maps/embed/v1";
  let url = "";

  switch (params.type) {
    case "place":
      if (!params.location) {
        throw new Error("Location is required for place type");
      }
      url = `${baseUrl}/place?key=${apiKey}&q=${encodeURIComponent(params.location)}`;
      if (params.zoom) {
        url += `&zoom=${params.zoom}`;
      }
      break;

    case "directions":
      if (!params.origin || !params.destination) {
        throw new Error("Origin and destination are required for directions type");
      }
      url = `${baseUrl}/directions?key=${apiKey}&origin=${encodeURIComponent(params.origin)}&destination=${encodeURIComponent(params.destination)}&mode=${params.mode}`;
      if (params.zoom) {
        url += `&zoom=${params.zoom}`;
      }
      break;

    case "streetview":
      if (!params.location) {
        throw new Error("Location is required for streetview type");
      }
      url = `${baseUrl}/streetview?key=${apiKey}&location=${encodeURIComponent(params.location)}`;
      break;

    default:
      throw new Error("Invalid map type");
  }

  return url;
}

async function ACTION(params: ShowMapParams): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const mapUrl = generateGoogleMapsEmbedUrl(params);
    const uniqueId = `map_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const resourceBlock = createUIResource({
      uri: `ui://map/${uniqueId}` as `ui://${string}`,
      content: { 
        type: 'externalUrl', 
        iframeUrl: mapUrl
      },
      encoding: 'text',
    });

    return {
      content: [resourceBlock],
      isError: false,
    };
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `地図表示エラー: ${errorMessage}` }],
    };
  }
}

export const ShowMap = {
  NAME,
  DESCRIPTION,
  SCHEMA,
  ACTION,
};