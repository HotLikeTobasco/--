// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// serve ./public as static site
app.use(express.static("public"));

let waitingUser = null;        // one user waiting in queue
const rooms = new Map();       // roomId -> { a, b }

io.on("connection", (socket) => {
  console.log("user connected:", socket.id);

  // user wants to find a partner
  socket.on("find_partner", () => {
    console.log(socket.id, "is looking for partner");

    if (waitingUser && waitingUser !== socket.id) {
      // partner exists → pair them
      const callerId = waitingUser; // first one becomes caller
      const calleeId = socket.id;   // new one is callee
      const roomId = `${callerId}#${calleeId}`;

      rooms.set(roomId, { a: callerId, b: calleeId });

      const caller = io.sockets.sockets.get(callerId);
      const callee = io.sockets.sockets.get(calleeId);

      if (caller) caller.join(roomId);
      if (callee) callee.join(roomId);

      waitingUser = null;

      if (caller) caller.emit("matched", { roomId, role: "caller" });
      if (callee) callee.emit("matched", { roomId, role: "callee" });

      console.log("paired:", callerId, "and", calleeId, "in room", roomId);
    } else {
      // nobody waiting → this user waits
      waitingUser = socket.id;
      socket.emit("waiting");
      console.log("no partner, user waiting:", socket.id);
    }
  });

  // WebRTC SDP offer
  socket.on("offer", ({ roomId, sdp }) => {
    console.log("offer from", socket.id, "room", roomId);
    socket.to(roomId).emit("offer", { sdp });
  });

  // WebRTC SDP answer
  socket.on("answer", ({ roomId, sdp }) => {
    console.log("answer from", socket.id, "room", roomId);
    socket.to(roomId).emit("answer", { sdp });
  });

  // ICE candidates
  socket.on("ice_candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("ice_candidate", { candidate });
  });

  // user manually leaves current room
  socket.on("leave_room", ({ roomId }) => {
    console.log("leave_room from", socket.id, "room", roomId);
    handleLeaveRoom(socket, roomId);
  });

  // disconnect logic
  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);

    if (waitingUser === socket.id) {
      waitingUser = null;
    }

    // if they were in a room, clean it up
    for (const [roomId, pair] of rooms.entries()) {
      if (pair.a === socket.id || pair.b === socket.id) {
        handleLeaveRoom(socket, roomId);
        break;
      }
    }
  });
});

function handleLeaveRoom(socket, roomId) {
  socket.leave(roomId);

  const pair = rooms.get(roomId);
  if (!pair) return;

  const otherId = pair.a === socket.id ? pair.b : pair.a;
  const otherSocket = io.sockets.sockets.get(otherId);

  if (otherSocket) {
    otherSocket.leave(roomId);
    otherSocket.emit("partner_left");
  }

  rooms.delete(roomId);
  console.log("room closed:", roomId);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});