import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function resetGameSocket() {
  socket?.disconnect();
  socket = null;
}

export function getGameSocket() {
  if (!socket) {
    const endpoint =
      process.env.NEXT_PUBLIC_REALTIME_URL?.trim() ||
      (typeof window === "undefined" ? undefined : window.location.origin);
    socket = io(endpoint, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });
  }
  if (!socket.connected) socket.connect();
  return socket;
}
