// client.js – real WebRTC + random matching

const socket = io();

// DOM refs
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

const mainStartBtn = document.getElementById("mainStartBtn");
const stopBtn = document.getElementById("stopBtn");
const navStartBtn = document.getElementById("navStartBtn");
const heroStartBtn = document.getElementById("heroStartBtn");
const scrollHowBtn = document.getElementById("scrollHowBtn");
const howSection = document.getElementById("how");

const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");

const micToggle = document.getElementById("micToggle");
const camToggle = document.getElementById("camToggle");
const sfwToggle = document.getElementById("sfwToggle");

let localStream = null;
let peerConnection = null;
let currentRoomId = null;
let currentRole = null; // "caller" | "callee"
let state = "idle";      // idle | searching | connected

// STUN server (for NAT traversal). TURN would be extra but costs money.
const ICE_SERVERS = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function setStatus(text, mode = "idle") {
  state = mode;
  if (statusText) statusText.textContent = text;

  if (!statusDot) return;

  if (mode === "connected") {
    statusDot.style.background = "#22c55e";
    statusDot.style.boxShadow = "0 0 0 6px rgba(34,197,94,0.2)";
  } else if (mode === "searching") {
    statusDot.style.background = "#f97316";
    statusDot.style.boxShadow = "0 0 0 6px rgba(249,115,22,0.2)";
  } else {
    statusDot.style.background = "#6b7280";
    statusDot.style.boxShadow = "0 0 0 4px rgba(107,114,128,0.2)";
  }
}

async function setupLocalMedia() {
  if (localStream) return;

  try {
    const wantVideo = camToggle ? camToggle.checked : true;
    const wantAudio = micToggle ? micToggle.checked : true;

    localStream = await navigator.mediaDevices.getUserMedia({
      video: wantVideo,
      audio: wantAudio
    });

    if (localVideo) {
      localVideo.srcObject = localStream;
    }
  } catch (err) {
    console.error("Error accessing media devices:", err);
    alert("Could not access camera/mic. Check your browser permissions.");
    throw err;
  }
}

function createPeerConnection() {
  if (!localStream) {
    console.warn("No localStream yet when creating peer connection");
  }

  peerConnection = new RTCPeerConnection(ICE_SERVERS);

  // local tracks → peer
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });
  }

  // remote tracks
  peerConnection.ontrack = (event) => {
    const [stream] = event.streams;
    console.log("Received remote stream");
    if (remoteVideo) {
      remoteVideo.srcObject = stream;
    }
  };

  // send ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && currentRoomId) {
      socket.emit("ice_candidate", {
        roomId: currentRoomId,
        candidate: event.candidate
      });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log("Peer connection state:", peerConnection.connectionState);
    if (peerConnection.connectionState === "failed") {
      setStatus("Connection failed. Try again.", "idle");
    }
  };
}

function cleanupConnection() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (remoteVideo) {
    remoteVideo.srcObject = null;
  }
  currentRoomId = null;
  currentRole = null;
}

function stopLocalStream() {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (localVideo) {
    localVideo.srcObject = null;
  }
}

async function startOrNext() {
  try {
    await setupLocalMedia();
  } catch {
    return;
  }

  // if already in a room, leave first (Next behavior)
  if (currentRoomId) {
    socket.emit("leave_room", { roomId: currentRoomId });
    cleanupConnection();
  }

  setStatus("Searching for a stranger…", "searching");
  socket.emit("find_partner");
}

function stopChat() {
  if (currentRoomId) {
    socket.emit("leave_room", { roomId: currentRoomId });
  }
  cleanupConnection();
  // keep local cam running unless user turns cam off
  setStatus("Stopped · Click Start to find someone.", "idle");
}

// toggle mic/cam on the fly
function applyMediaToggles() {
  if (!localStream) return;

  const audioTracks = localStream.getAudioTracks();
  const videoTracks = localStream.getVideoTracks();

  if (micToggle) {
    audioTracks.forEach((track) => (track.enabled = micToggle.checked));
  }
  if (camToggle) {
    videoTracks.forEach((track) => (track.enabled = camToggle.checked));
  }
}

// button wiring
if (mainStartBtn) mainStartBtn.addEventListener("click", startOrNext);
if (navStartBtn) navStartBtn.addEventListener("click", startOrNext);
if (heroStartBtn) heroStartBtn.addEventListener("click", startOrNext);

if (stopBtn) {
  stopBtn.addEventListener("click", () => {
    stopChat();
  });
}

if (scrollHowBtn && howSection) {
  scrollHowBtn.addEventListener("click", () => {
    howSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// toggle events
if (micToggle) micToggle.addEventListener("change", applyMediaToggles);
if (camToggle) camToggle.addEventListener("change", applyMediaToggles);
if (sfwToggle) {
  sfwToggle.addEventListener("change", () => {
    console.log("SFW toggle:", sfwToggle.checked);
    // this would be used later for tagging / filters
  });
}

// SOCKET.IO EVENTS

socket.on("waiting", () => {
  setStatus("Waiting for someone to join…", "searching");
});

socket.on("matched", async ({ roomId, role }) => {
  console.log("Matched in room", roomId, "as", role);
  currentRoomId = roomId;
  currentRole = role;

  try {
    await setupLocalMedia();
  } catch {
    return;
  }

  cleanupConnection(); // ensure old PC is closed
  createPeerConnection();
  setStatus("Connected · Say hi 👋", "connected");

  if (currentRole === "caller") {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("offer", { roomId: currentRoomId, sdp: offer });
  }
});

socket.on("offer", async ({ sdp }) => {
  console.log("Received offer");
  if (!peerConnection) {
    createPeerConnection();
  }
  await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit("answer", { roomId: currentRoomId, sdp: answer });
});

socket.on("answer", async ({ sdp }) => {
  console.log("Received answer");
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
});

socket.on("ice_candidate", async ({ candidate }) => {
  if (!peerConnection || !candidate) return;
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error("Error adding ICE candidate", err);
  }
});

socket.on("partner_left", () => {
  console.log("Partner left");
  setStatus("Stranger disconnected · Click Start for a new one.", "idle");
  cleanupConnection();
});

// initial status
setStatus("Idle · Not connected", "idle");
console.log("Client JS loaded.");