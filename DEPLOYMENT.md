# Deployment notes

The project is intentionally a small Node service so the same app serves the mobile UI and the realtime room transport.

## Local / LAN

```bash
npm install
npm start
```

Then open `http://localhost:3000`. For a second phone on the same Wi-Fi, use the computer's LAN address instead of `localhost`.

## Internet deployment

Deploy the folder to a Node-compatible host that supports WebSocket connections and persistent disk if you want the JSON chat store to survive deploys. Set `PORT` if your host supplies a port variable.

A persistent volume is recommended for `data/rooms.json` because that file stores room/chat history. For larger multi-instance deployments, replace the file store with a shared database.
