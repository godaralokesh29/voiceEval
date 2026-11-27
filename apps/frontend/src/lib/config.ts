export const BACKEND_URL = process.env.BUN_PUBLIC_BACKEND_URL || "http://localhost:3001";

// WebSocket base for the live voice session (same host as the backend).
export const LIVE_WS_URL = BACKEND_URL.replace(/^http/, "ws");
