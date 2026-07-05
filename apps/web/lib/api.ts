/**
 * @file api.ts
 * @author Rahul Kumar Sahoo
 * @description Shared web API helpers that resolve the correct backend origin for local and deployed environments.
 */
function getApiBaseUrl(hostname?: string | null): string {
  const normalizedHost = (hostname || '').toLowerCase();
  if (normalizedHost === 'localhost' || normalizedHost === '127.0.0.1' || normalizedHost === '0.0.0.0' || normalizedHost.endsWith('.local')) {
    return 'http://localhost:4000';
  }

  if (typeof window !== 'undefined') {
    const browserHost = window.location.hostname.toLowerCase();
    if (browserHost === 'localhost' || browserHost === '127.0.0.1' || browserHost === '0.0.0.0' || browserHost.endsWith('.local')) {
      return 'http://localhost:4000';
    }
  }

  return process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
}

let cachedToken: string | null = null;
let tokenExpiry: number | null = null;

interface FetchOptions extends RequestInit {
  requireAuth?: boolean;
}

// Automatically fetch the JWT from your Next.js bridge endpoint
async function getApiToken(): Promise<string | null> {
  // Use cached token if it exists and hasn't expired (giving a 5 min buffer)
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 300000) {
    return cachedToken;
  }
  
  try {
    // Note: This relies on relative fetching, which works client-side in Next.js
    const res = await fetch('/api/auth/api-token');
    if (res.ok) {
      const data = await res.json();
      cachedToken = data.token;
      // Cache the token for 1 hour to match the backend expiry safely
      tokenExpiry = Date.now() + 60 * 60 * 1000; 
      return cachedToken;
    }
  } catch (err) {
    console.error("Failed to fetch API bridge token", err);
  }
  
  return null;
}

export function getApiBaseUrlForClient(hostname?: string | null): string {
  return getApiBaseUrl(hostname);
}

export class ApiError extends Error {
  status: number;
  data: any;
  retryable: boolean;

  constructor(message: string, status: number, data: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.retryable = !!(data && typeof data === 'object' && (data as any).retryable);
  }
}

export async function fetchApi(endpoint: string, options: FetchOptions = {}) {
  const { requireAuth = true, headers: customHeaders, ...restOptions } = options;
  
  const headers = new Headers(customHeaders);
  
  // Set default content type for JSON bodies
  if (restOptions.body && typeof restOptions.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Inject authentication token seamlessly
  if (requireAuth) {
    const token = await getApiToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  // Ensure endpoint format is clean
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${getApiBaseUrl()}${cleanEndpoint}`;

  const response = await fetch(url, {
    ...restOptions,
    headers,
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    throw new ApiError((data as any)?.error || response.statusText || 'API Request Failed', response.status, data);
  }

  return data;
}