/** Typed calls for community submissions and the "still accurate?" loop. */
import { api } from "./api.ts";

export interface Similar { id: string; title: string; venue: string; distanceM: number }
export interface NewActivity {
  title: string; description?: string; category: string; tags: string[];
  kind?: "place" | "self_guided" | "recurring_program" | "seasonal";
  isFree?: boolean; priceDollars?: number | null; locale: "fr-CA" | "en-CA";
  venueId?: string; place?: { name: string; lat: number; lon: number };
  confirmNotDuplicate?: boolean;
}

export const communityApi = (token: string) => ({
  suggest: (title: string, description: string) =>
    api<{ category: string | null; tags: string[] }>("POST", "/v1/submissions/suggest", { title, description }, token),
  submit: (a: NewActivity) => api<{ activityId: string; status: "published" | "pending_review" }>("POST", "/v1/submissions", a, token),
  confirm: (activityId: string, accurate: boolean) =>
    api<{ effect: "verified" | "flagged" | null }>("POST", `/v1/activities/${activityId}/confirm`, { accurate }, token),
});
