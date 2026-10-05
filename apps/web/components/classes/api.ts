export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const payload =
    body === undefined && !["GET", "HEAD"].includes(method) ? {} : body;
  const response = await fetch(`/api/${path}`, {
    method,
    credentials: "same-origin",
    ...(payload === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed");
  return result.data as T;
}
export interface SchoolResource {
  id: string;
  class_id: string;
  owner_id: string;
  parent_id: string | null;
  kind: string;
  title: string;
  version: number;
  deleted_at: string | null;
  data: Record<string, unknown>;
  editable?: boolean;
  owned?: boolean;
  shares?: { user_id: string; username: string; permission: string }[];
}
export interface SchoolClass {
  id: string;
  name: string;
  color: string;
}
