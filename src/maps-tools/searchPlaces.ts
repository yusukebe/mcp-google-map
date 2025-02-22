import { GoogleMapsTools } from "./toolclass.js";

interface SearchNearbyResponse {
  success: boolean;
  error?: string;
  data?: any[];
  location?: any;
}

interface PlaceDetailsResponse {
  success: boolean;
  error?: string;
  data?: any;
}

export class PlacesSearcher {
  private mapsTools: GoogleMapsTools;

  constructor() {
    this.mapsTools = new GoogleMapsTools();
  }

  async searchNearby(params: { center: { value: string; isCoordinates: boolean }; keyword?: string; radius?: number; openNow?: boolean; minRating?: number }): Promise<SearchNearbyResponse> {
    try {
      const location = await this.mapsTools.getLocation(params.center);
      console.error(location);
      const places = await this.mapsTools.searchNearbyPlaces({
        location,
        keyword: params.keyword,
        radius: params.radius,
        openNow: params.openNow,
        minRating: params.minRating,
      });

      return {
        location: location,
        success: true,
        data: places.map((place) => ({
          name: place.name,
          place_id: place.place_id,
          address: place.formatted_address,
          location: place.geometry.location,
          rating: place.rating,
          total_ratings: place.user_ratings_total,
          open_now: place.opening_hours?.open_now,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "搜尋時發生錯誤",
      };
    }
  }

  async getPlaceDetails(placeId: string): Promise<PlaceDetailsResponse> {
    try {
      const details = await this.mapsTools.getPlaceDetails(placeId);

      return {
        success: true,
        data: {
          name: details.name,
          address: details.formatted_address,
          location: details.geometry?.location,
          rating: details.rating,
          total_ratings: details.user_ratings_total,
          open_now: details.opening_hours?.open_now,
          phone: details.formatted_phone_number,
          website: details.website,
          price_level: details.price_level,
          reviews: details.reviews?.map((review) => ({
            rating: review.rating,
            text: review.text,
            time: review.time,
            author_name: review.author_name,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "獲取詳細資訊時發生錯誤",
      };
    }
  }
}
