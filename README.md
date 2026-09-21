<img width="2854" height="1646" alt="image" src="https://github.com/user-attachments/assets/986fc370-676d-47c2-88ec-0eb30bbccde8" />

# Truth & Dare — Friends Edition

A professional, mobile-first Truth or Dare web app for friends who are in different places.

## Included

- Shareable room URL (`/room/<room-code>`)
- Realtime presence and chat with Socket.IO
- Chat history saved to `data/rooms.json`
- Server-authoritative bottle spins so every phone sees the same result
- Fair turn queue: each player gets one turn before the queue reshuffles
- Truth/Dare choice is synchronized to everyone in the room
- Safe, light-hearted starter prompts; players can skip any prompt
- Mobile-first UI with a centered bottle, subtle motion, bottom chat composer and polished transitions
- Copy/share buttons for room invites
- Reconnect-friendly client state

## Run locally

1. Install Node.js 18+.
2. In this folder, run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000` on your phone or computer.
5. Create a room and share the room link.

For two different phones on the same Wi-Fi, expose the server on your local network using your machine's LAN IP, for example `http://192.168.1.20:3000`. For internet play, deploy the Node server to a host that supports long-lived WebSocket connections.

## Persistence

Room metadata, player display names, game events and messages are saved in `data/rooms.json`. The app creates the file automatically. This is intentionally lightweight for a small friends-only app; for a larger production deployment, swap the storage adapter for PostgreSQL or another managed database.

## Safety / game content

The default prompt pack is designed around harmless, social challenges. Players can always skip a prompt. The app does not require risky activities, dangerous substances, or adult content.

## Tech

- Node.js + Express
- Socket.IO
- Vanilla HTML/CSS/JavaScript
- File-backed JSON persistence
