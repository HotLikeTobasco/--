// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// serve static files
app.use(express.static("public"));

// ---- QUEUE & ROOM STORAGE ----
let queue = [];
const rooms = new Map();  // roomId -> { a, b }

// Try matching users from queue
function tryMatch() {
  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();

    const socketA = io.sockets.sockets.get(a);
    const socketB = io.sockets.sockets.get(b);

    // If one is dead, skip
    if (!socketA || !socketB) continue;

    const roomId = `${a}#${b}`;
    rooms.set(roomId, { a, b });

    socketA.join(roomId);
    socketB.join(roomId);

    socketA.emit("matched", { roomId, role: "caller" });
    socketB.emit("matched", { roomId, role: "callee" });

    console.log(`paired: ${a} and ${b} in ${roomId}`);
  }
}

// Clean room + notify partner
function leaveRoom(socket, roomId) {
  const pair = rooms.get(roomId);
  if (!pair) return;

  const otherId = pair.a === socket.id ? pair.b : pair.a;
  const otherSocket = io.sockets.sockets.get(otherId);

  socket.leave(roomId);

  if (otherSocket) {
    otherSocket.leave(roomId);
    otherSocket.emit("partner_left");
  }

  rooms.delete(roomId);
  console.log("room closed:", roomId);
}

// ---- SOCKET LOGIC ----
io.on("connection", (socket) => {
  console.log("user connected:", socket.id);

  socket.on("find_partner", () => {
    // Remove dead users from queue
    queue = queue.filter(id => io.sockets.sockets.get(id));

    queue.push(socket.id);
    socket.emit("waiting");
    tryMatch();
  });

  // ---- SIGNALING ----
  socket.on("offer", ({ roomId, sdp }) => {
    console.log("offer from", socket.id);
    socket.to(roomId).emit("offer", { sdp });
  });

  socket.on("answer", ({ roomId, sdp }) => {
    console.log("answer from", socket.id);
    socket.to(roomId).emit("answer", { sdp });
  });

  socket.on("ice_candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("ice_candidate", { candidate });
  });

  // ---- LEAVING ----
  socket.on("leave_room", ({ roomId }) => {
    leaveRoom(socket, roomId);
  });

  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);

    queue = queue.filter(id => id !== socket.id);

    // If in a room, clean it up
    for (const [roomId, pair] of rooms.entries()) {
      if (pair.a === socket.id || pair.b === socket.id) {
        leaveRoom(socket, roomId);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
