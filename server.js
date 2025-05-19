const express = require('express');
const http = require('http');
const app = express();
const server = http.createServer(app);
const bodyParser = require("body-parser");
const debug = require("debug")("test");
const matchMaking = require("./MatchMaking");
const user = require("./Users");
const PORT = process.env.PORT || process.env.SERVER_PORT || 8080;
const shortid = require("shortid"); // Fixed variable name
const establishConnection = require("./GamePlay/ClientApi").establishConnection; // Fixed typo

const cors = require('cors');

// Apply middleware
app.use(bodyParser.json()); // Added bodyParser usage
app.use(cors({
  origin: process.env.CORS_ORIGIN || "*",
  methods: ["GET", "POST"]
}));

// Configure Socket.IO for AWS load balancers and sticky sessions
const io = require('socket.io')(server, { // Changed from http to server for better practice
  pingTimeout: 60000,  // Increase ping timeout for AWS network conditions
  pingInterval: 25000, // Adjust ping interval
  transports: ['websocket', 'polling'],
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"]
  }
});

let onlineUserQ = [];

// Helper function to broadcast online player count
function broadcastOnlinePlayers() {
  const count = onlineUserQ.length;
  io.emit(establishConnection.ONLINE_PLAYERS, {
    onlinePlayers: count,
  });
}

io.on("connection", (socket) => {
  debug("a user connected " + socket.id);

  onlineUserQ.push(socket);
  broadcastOnlinePlayers();

  socket.on(establishConnection.ONLINE_PLAYERS, (data) => {
    socket.emit(establishConnection.ONLINE_PLAYERS, { onlinePlayers: onlineUserQ.length });
  });
  
  socket.on(establishConnection.PLAYER_REGISTRATION, (data) => {
    let invalidId = !data.playerId || data.playerId === "null";
    if (invalidId) {
      debug("new user");
      let id = "guest" + shortid.generate();
      socket.emit(establishConnection.PLAYER_REGISTRATION, { id });
    } else {
      debug("old user");
      // You might want to validate returning users here
    }
  });
  
  socket.on("quit", (data) => {
    debug(`user ${socket.id} quit`);
    // Consider adding cleanup logic here
  });
  
  socket.on("showData", (data) => {
    console.log(user().showUsers());
  });
  
  socket.on(establishConnection.MATCH_MAKING, (data) => {
    let newUserDetail = {
      socket: socket,
      playerId: data.playerId,
      players: data.players,
      profile: data.profilePic,
    };
    socket.players = data.players;
    matchMaking(newUserDetail);
  });
  
  socket.on("disconnect", () => {
    debug("disconnected " + socket.id);
    
    // More efficient way to remove the disconnected socket
    const index = onlineUserQ.findIndex(s => s.id === socket.id);
    if (index !== -1) {
      onlineUserQ.splice(index, 1);
      broadcastOnlinePlayers();
    }
  });
});

// Use the PORT variable consistently
server.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
});