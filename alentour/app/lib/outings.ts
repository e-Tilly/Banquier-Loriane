/** Typed calls to /v1/outings and the outings parts of /v1/me. */
import { api } from "./api.ts";

export type Answer = "yes" | "maybe" | "no";
export type Missing = "account" | "age" | "phone" | "restricted";

export interface Eligibility {
  ok: boolean; missing: Missing[]; minAge: number; paused: boolean; creationPaused: boolean;
  optIn: boolean; birthYear: number | null; adultAttested: boolean; phone: string | null;
}

export interface OutingSummary {
  id: string; mode: "venue_session" | "rally" | "fixed"; organizer: "venue" | "concierge" | "user";
  status: "voting" | "confirmed" | "paused"; activityId: string; startsAt: string | null; decisionDeadline: string | null;
  capacity: number; going: number; venue: { id: string; name: string };
  me: { status: "going" | "maybe" | "left" | null; invited: boolean; hosting: boolean };
}

export interface OutingDetail extends Omit<OutingSummary, "venue"> {
  endsAt: string | null; quorum: number; chatOpen: boolean;
  venue: { id: string; name: string; address: string | null; lat: number; lon: number };
  me: OutingSummary["me"] & { checkedIn: boolean };
  options: { id: string; starts_at: string; yes: number; maybe: number; mine: Answer | null }[];
}

export interface ChatMessage {
  id: number; kind: "user" | "concierge" | "system"; status: "visible" | "held";
  body: string | null; mine: boolean; author: string | null; created_at: string;
}

export const outingsApi = (token: string) => ({
  eligibility: () => api<Eligibility>("GET", "/v1/outings/eligibility", undefined, token),
  list: (q: { activityId?: string } = {}) =>
    api<{ outings: OutingSummary[]; paused: boolean }>("GET", `/v1/outings${q.activityId ? `?activityId=${q.activityId}` : ""}`, undefined, token),
  get: (id: string) => api<{ outing: OutingDetail }>("GET", `/v1/outings/${id}`, undefined, token),
  propose: (activityId: string) => api<{ id: string; invited: number }>("POST", "/v1/outings", { activityId, mode: "rally" }, token),
  vote: (id: string, answers: Record<string, Answer>) => api("POST", `/v1/outings/${id}/votes`, { answers }, token),
  join: (id: string) => api("POST", `/v1/outings/${id}/join`, {}, token),
  leave: (id: string) => api("POST", `/v1/outings/${id}/leave`, {}, token),
  checkIn: (id: string) => api("POST", `/v1/outings/${id}/checkin`, {}, token),
  feedback: (id: string, rating: number, again: boolean) => api("POST", `/v1/outings/${id}/feedback`, { rating, again }, token),
  messages: (id: string, after = 0) => api<{ messages: ChatMessage[]; open: boolean }>("GET", `/v1/outings/${id}/messages?after=${after}`, undefined, token),
  post: (id: string, body: string) => api<{ id: number; status: string }>("POST", `/v1/outings/${id}/messages`, { body }, token),
  blockAuthor: (id: string, messageId: number) => api("POST", `/v1/outings/${id}/messages/${messageId}/block`, {}, token),
  report: (subjectType: "outing" | "message", subjectId: string, reason: "safety" | "harassment" | "inappropriate" | "other", details = "") =>
    api<{ paused: boolean }>("POST", "/v1/reports", { subjectType, subjectId, reason, details }, token),
  profile: (patch: { birthYear?: number; adultAttested?: true; outingsOptIn?: boolean }) => api("PATCH", "/v1/me", patch, token),
  phoneStart: (phone: string) => api("POST", "/v1/me/phone", { phone }, token),
  phoneVerify: (code: string) => api("POST", "/v1/me/phone/verify", { code }, token),
});
