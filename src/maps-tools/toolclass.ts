import { Client, Language } from "@googlemaps/google-maps-services-js";
import dotenv from "dotenv";

// 確保環境變數被載入
dotenv.config();

interface SearchParams {
  location: { lat: number; lng: number };
  radius?: number;
  keyword?: string;
  openNow?: boolean;
  minRating?: number;
}

interface PlaceResult {
  name: string;
  place_id: string;
  formatted_address?: string;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
  rating?: number;
  user_ratings_total?: number;
  opening_hours?: {
    open_now?: boolean;
  };
}

interface GeocodeResult {
  lat: number;
  lng: number;
}

export class GoogleMapsTools {
  private client: Client;
  private readonly defaultLanguage: Language = Language.zh_TW;

  constructor() {
    this.client = new Client({});
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      throw new Error("Google Maps API Key is required");
    }
  }

  async searchNearbyPlaces(params: SearchParams): Promise<PlaceResult[]> {
    const searchParams = {
      location: params.location,
      radius: params.radius || 1000,
      keyword: params.keyword,
      opennow: params.openNow,
      language: this.defaultLanguage,
      key: process.env.GOOGLE_MAPS_API_KEY || "",
    };

    try {
      const response = await this.client.placesNearby({
        params: searchParams,
      });

      let results = response.data.results;

      // 如果有最低評分要求，進行過濾
      if (params.minRating) {
        results = results.filter((place) => (place.rating || 0) >= (params.minRating || 0));
      }

      return results as PlaceResult[];
    } catch (error) {
      console.error("Error in searchNearbyPlaces:", error);
      throw new Error("搜尋附近地點時發生錯誤");
    }
  }

  async getPlaceDetails(placeId: string) {
    try {
      const response = await this.client.placeDetails({
        params: {
          place_id: placeId,
          fields: ["name", "rating", "formatted_address", "opening_hours", "reviews", "geometry", "formatted_phone_number", "website", "price_level", "photos"],
          language: this.defaultLanguage,
          key: process.env.GOOGLE_MAPS_API_KEY || "",
        },
      });
      return response.data.result;
    } catch (error) {
      console.error("Error in getPlaceDetails:", error);
      throw new Error("獲取地點詳細資訊時發生錯誤");
    }
  }

  private async geocodeAddress(address: string): Promise<GeocodeResult> {
    try {
      const response = await this.client.geocode({
        params: {
          address: address,
          key: process.env.GOOGLE_MAPS_API_KEY || "",
          language: this.defaultLanguage
        }
      });

      if (response.data.results.length === 0) {
        throw new Error("找不到該地址的位置");
      }

      const location = response.data.results[0].geometry.location;
      return {
        lat: location.lat,
        lng: location.lng
      };
    } catch (error) {
      console.error("Error in geocodeAddress:", error);
      throw new Error("地址轉換座標時發生錯誤");
    }
  }

  private parseCoordinates(coordString: string): GeocodeResult {
    const coords = coordString.split(',').map(c => parseFloat(c.trim()));
    if (coords.length !== 2 || isNaN(coords[0]) || isNaN(coords[1])) {
      throw new Error("無效的座標格式，請使用「緯度,經度」格式");
    }
    return { lat: coords[0], lng: coords[1] };
  }

  async getLocation(center: { value: string; isCoordinates: boolean }): Promise<GeocodeResult> {
    if (center.isCoordinates) {
      return this.parseCoordinates(center.value);
    }
    return this.geocodeAddress(center.value);
  }
}
