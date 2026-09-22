import type {
  CompanyBrief,
  Flashcard,
  Kit,
  PracticeState,
  Question,
  QuestionCategory,
} from "@trao/shared";

/**
 * All backend calls go through this one client. The backend and frontend
 * deploy to two different hosts (Section 12: "frontend and backend must
 * both be reachable" — a single free-tier host rarely serves both), so
 * every request needs an absolute URL and `credentials: "include"` to
 * carry the session cookie cross-origin. NEXT_PUBLIC_API_URL is the one
 * frontend env var this app needs — see .env.example.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the server. Check your connection and try again.");
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? res.statusText);
  }
  return body as T;
}

// ---- auth ---------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
}

export function register(email: string, password: string) {
  return request<{ user: AuthUser }>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function login(email: string, password: string) {
  return request<{ user: AuthUser }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function logout() {
  return request<void>("/auth/logout", { method: "POST" });
}

export function me() {
  return request<{ user: AuthUser }>("/auth/me");
}

// ---- kits ---------------------------------------------------------------

export type KitStatus = "pending" | "generating" | "ready" | "failed";

export interface ProgressEntry {
  step: string;
  status: "running" | "done" | "skipped" | "failed";
  detail?: string;
  at: string;
}

export interface KitRecord {
  id: string;
  status: KitStatus;
  input: { jd: string; companyUrl: string; days: number };
  data: Kit | null;
  error: { code: string; message: string } | null;
  progress: ProgressEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateKitInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export function createKit(input: CreateKitInput) {
  return request<KitRecord>("/kits", { method: "POST", body: JSON.stringify(input) });
}

export function listKits() {
  return request<{ kits: KitRecord[] }>("/kits");
}

export function getKit(id: string) {
  return request<KitRecord>(`/kits/${id}`);
}

export function deleteKit(id: string) {
  return request<void>(`/kits/${id}`, { method: "DELETE" });
}

// ---- company brief --------------------------------------------------------

export function updateCompanyBrief(kitId: string, patch: Partial<Pick<CompanyBrief, "summary" | "what_they_do">>) {
  return request<KitRecord>(`/kits/${kitId}/company-brief`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function regenerateCompanyBrief(kitId: string) {
  return request<KitRecord>(`/kits/${kitId}/company-brief/regenerate`, { method: "POST" });
}

// ---- questions --------------------------------------------------------

export function updateQuestion(
  kitId: string,
  questionId: string,
  patch: Partial<Pick<Question, "prompt" | "answer_outline" | "difficulty" | "category" | "requirement_ids">>
) {
  return request<KitRecord>(`/kits/${kitId}/questions/${questionId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function addQuestion(
  kitId: string,
  draft: Pick<Question, "category" | "prompt" | "answer_outline" | "difficulty"> & { requirement_ids?: string[] }
) {
  return request<KitRecord>(`/kits/${kitId}/questions`, { method: "POST", body: JSON.stringify(draft) });
}

export function deleteQuestion(kitId: string, questionId: string) {
  return request<KitRecord>(`/kits/${kitId}/questions/${questionId}`, { method: "DELETE" });
}

export function moveQuestion(kitId: string, questionId: string, category: QuestionCategory) {
  return request<KitRecord>(`/kits/${kitId}/questions/${questionId}/move`, {
    method: "POST",
    body: JSON.stringify({ category }),
  });
}

export function reorderQuestions(kitId: string, category: QuestionCategory, orderedIds: string[]) {
  return request<KitRecord>(`/kits/${kitId}/questions/reorder`, {
    method: "POST",
    body: JSON.stringify({ category, orderedIds }),
  });
}

export function regenerateQuestions(kitId: string, category: QuestionCategory) {
  return request<KitRecord>(`/kits/${kitId}/questions/regenerate`, {
    method: "POST",
    body: JSON.stringify({ category }),
  });
}

// ---- flashcards --------------------------------------------------------

export function updateFlashcard(
  kitId: string,
  flashcardId: string,
  patch: Partial<Pick<Flashcard, "front" | "back" | "requirement_ids">>
) {
  return request<KitRecord>(`/kits/${kitId}/flashcards/${flashcardId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function addFlashcard(kitId: string, draft: Pick<Flashcard, "front" | "back"> & { requirement_ids?: string[] }) {
  return request<KitRecord>(`/kits/${kitId}/flashcards`, { method: "POST", body: JSON.stringify(draft) });
}

export function deleteFlashcard(kitId: string, flashcardId: string) {
  return request<KitRecord>(`/kits/${kitId}/flashcards/${flashcardId}`, { method: "DELETE" });
}

// ---- schedule --------------------------------------------------------

export function regenerateSchedule(kitId: string, daysAvailable?: number) {
  return request<KitRecord>(`/kits/${kitId}/schedule/regenerate`, {
    method: "POST",
    body: JSON.stringify(daysAvailable !== undefined ? { daysAvailable } : {}),
  });
}

// ---- practice --------------------------------------------------------

export interface PracticeSession {
  flashcards: Flashcard[];
  coverage: { total: number; reviewed: number };
}

export function getPracticeSession(kitId: string) {
  return request<PracticeSession>(`/kits/${kitId}/practice`);
}

export function recordFlashcardReview(kitId: string, flashcardId: string, confidence: number) {
  return request<KitRecord>(`/kits/${kitId}/practice/review`, {
    method: "POST",
    body: JSON.stringify({ flashcardId, confidence }),
  });
}

export type { Kit, Question, Flashcard, CompanyBrief, PracticeState, QuestionCategory };
