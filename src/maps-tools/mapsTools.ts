export const SEARCH_NEARBY_TOOL = {
  name: "search_nearby",
  description: "搜尋附近的地點",
  inputSchema: {
    type: "object",
    properties: {
      center: {
        type: "object",
        properties: {
          value: { type: "string", description: "地址、地標名稱或經緯度座標(經緯度座標格式: lat,lng)" },
          isCoordinates: { type: "boolean", description: "是否為經緯度座標", default: false }
        },
        required: ["value"],
        description: "搜尋中心點",
      },
      keyword: {
        type: "string",
        description: "搜尋關鍵字（例如：餐廳、咖啡廳）",
      },
      radius: {
        type: "number",
        description: "搜尋半徑（公尺）",
        default: 1000,
      },
      openNow: {
        type: "boolean",
        description: "是否只顯示營業中的地點",
        default: false,
      },
      minRating: {
        type: "number",
        description: "最低評分要求（0-5）",
        minimum: 0,
        maximum: 5,
      },
    },
    required: ["center"],
  },
};

export const GET_PLACE_DETAILS_TOOL = {
  name: "get_place_details",
  description: "獲取特定地點的詳細資訊",
  inputSchema: {
    type: "object",
    properties: {
      placeId: {
        type: "string",
        description: "Google Maps 地點 ID",
      },
    },
    required: ["placeId"],
  },
};
