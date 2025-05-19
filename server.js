"use strict";

const express = require('express');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const cors = require('cors');
const bodyParser = require('body-parser');
const debug = require('debug')('test');
const shortId = require('shortid');

// AWS-friendly configuration
const PORT = process.env.PORT || 3000;

// Add CORS support - critical for socket connections
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ["GET", "POST"]
}));

// Configure Socket.IO properly for AWS environments
const io = require('socket.io')(http, {
  pingTimeout: 60000,  // Increased ping timeout for AWS network conditions
  pingInterval: 25000, // Adjusted ping interval
  transports: ['websocket', 'polling'],
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ["GET", "POST"]
  }
});

// Parse application/json
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Import required modules
const startGame = require("./GamePlay/GameLogic");
const userInfo = require("./Users");

// Initialize user manager
const user = new userInfo();
const tempTwoUserQ = [];
const tempThreeUserQ = [];
const tempFourUserQ = [];
const onlineUserQ = [];

// Add health check endpoint for AWS
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Serve static files
app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname + '/index.html'));
});

// Socket.IO connection handling
io.on('connection', function (socket) {
  debug('a user connected ' + socket.id);

  // Handle connection errors
  socket.on('error', function(error) {
    debug('Socket error for ' + socket.id + ': ' + error);
  });

  socket.on("userId", function (data) {
    if (data["userId"] == "null") {
      const id = {
        id: "Guest" + shortId.generate()
      };
      debug("new user");
      socket.emit("registerUserId", id);
      onlineUserQ.push(id.id);
    } else {
      debug("old user");
      onlineUserQ.push(data["userId"]); // push userId to DB
    }
  });

  socket.on("test", function (data) {
    debug("hey its test");
    // Send acknowledgment back to client
    socket.emit("testAck", { status: "received" });
  });

  socket.on("quit", function (data) {
    debug("user ".concat(socket.id, " quit"));
    debug("userpawntype ".concat(data["players"], " quit"));
    
    // Remove from online user queue
    const index = onlineUserQ.indexOf(data["userId"]);
    if (index > -1) {
      onlineUserQ.splice(index, 1);
    }

    let isInTempQ = false;
    switch (data["players"]) {
      case 0:
        return;
      case 2:
        isInTempQ = RemoveUserFromTempOnlineQ(socket.id, tempTwoUserQ);
        break;
      case 3:
        isInTempQ = RemoveUserFromTempOnlineQ(socket.id, tempThreeUserQ);
        break;
      case 4:
        isInTempQ = RemoveUserFromTempOnlineQ(socket.id, tempFourUserQ);
        break;
      default:
        break;
    }

    if (!isInTempQ) {
      user.removeUser(socket.id);
    }
    
    // Acknowledge quit
    socket.emit("quitAck", { status: "success" });
  });

  socket.on("showData", function (data) {
    debug("tempTwoUserQLenght " + tempTwoUserQ.length);
    debug("tempOnlineQLength " + onlineUserQ.length);
    user.showUsers();
    
    // Send data back to client
    socket.emit("showDataResponse", { 
      twoUserQLength: tempTwoUserQ.length,
      onlineQLength: onlineUserQ.length
    });
  });

  socket.on("joinRoom", function (data) {
    // Validate incoming data
    if (!data || !data.players || !data.pawnType || !data.userId) {
      return socket.emit("error", { message: "Invalid join room data" });
    }

    let newUserDetail;
    switch (data["players"]) {
      case 2:
        newUserDetail = {
          socket: socket,
          pawnType: data["pawnType"],
          userId: data["userId"]
        };
        tempTwoUserQ.push(newUserDetail);
        MatchMakingWhenTwoUserArePlaying(tempTwoUserQ, newUserDetail);
        break;
      case 3:
        newUserDetail = {
          socket: socket,
          pawnType: data["pawnType"],
          userId: data["userId"]
        };
        tempThreeUserQ.push(newUserDetail);
        MatchMakingWhenThreeUserArePlaying(tempThreeUserQ, newUserDetail);
        break;
      case 4:
        tempFourUserQ.push({
          socket: socket,
          pawnType: data["pawnType"],
          userId: data["userId"]
        });
        RoomChecking(4, tempFourUserQ);
        break;
      default:
        socket.emit("error", { message: "Invalid player count" });
        break;
    }
  });

  socket.on('disconnect', function () {
    debug("disconnected " + socket.id);
    
    // Clean up all resources for this socket
    RemoveUserFromTempOnlineQ(socket.id, tempTwoUserQ);
    RemoveUserFromTempOnlineQ(socket.id, tempThreeUserQ);
    RemoveUserFromTempOnlineQ(socket.id, tempFourUserQ);
    
    // Get user's room to notify other players
    const userRooms = user.getUserRooms && typeof user.getUserRooms === 'function' 
      ? user.getUserRooms(socket.id) 
      : [];
      
    if (userRooms && userRooms.length > 0) {
      userRooms.forEach(roomName => {
        socket.to(roomName).emit("playerDisconnected", {
          socketId: socket.id,
          pawnType: user.getUserPawnType && typeof user.getUserPawnType === 'function'
            ? user.getUserPawnType(socket.id)
            : null
        });
      });
    }
    
    // Remove user from management
    user.removeUser(socket.id);
  });
});

// Fixed function - had a logic error with early return
function RemoveUserFromTempOnlineQ(socketId, tempQ) {
  for (let i = 0; i < tempQ.length; i++) {
    const id = tempQ[i].socket.id;
    if (socketId === id) {
      tempQ.splice(i, 1);
      return true;
    }
  }
  return false; // Return false outside the loop
}

function RoomChecking(noOfUserInASingleRoom, tempUserQ) {
  switch (noOfUserInASingleRoom) {
    case 2:
      if (tempUserQ.length >= 2) CreateRoom(tempUserQ, 2);
      break;
    case 3:
      if (tempUserQ.length >= 3) CreateRoom(tempUserQ, 3);
      break;
    case 4:
      if (tempUserQ.length >= 4) CreateRoom(tempUserQ, 4);
      break;
    default:
      break;
  }
}

function MatchMakingWhenTwoUserArePlaying(tempQ, newUser) {
  const currentPawnType = newUser.pawnType;
  let opponentPawnType = 0;

  if (currentPawnType % 2 === 0) {
    if (currentPawnType === 2) {
      opponentPawnType = 4;
    } else {
      opponentPawnType = 2;
    }
  } else {
    if (currentPawnType === 3) {
      opponentPawnType = 1;
    } else {
      opponentPawnType = 3;
    }
  }

  if (opponentPawnType === 0) {
    newUser.socket.emit("tostmsg", {
      msg: "Something went wrong, try again"
    });
    return;
  }

  const usersJoiningTheRoom = [];
  usersJoiningTheRoom.push(newUser);

  for (let i = 0; i < tempQ.length; i++) {
    if (tempQ[i].socket.id === newUser.socket.id) {
      continue;
    }

    if (tempQ[i].pawnType === opponentPawnType) {
      usersJoiningTheRoom.push(tempQ[i]);
      RefactorTempQ(usersJoiningTheRoom, tempQ).then(function (data) {
        CreateRoom(usersJoiningTheRoom, 2);
        debug("#user left in q " + tempQ.length);
      });
      return;
    }
  }
}

function MatchMakingWhenThreeUserArePlaying(tempQ, newUser) {
  if (tempQ.length < 2) return;
  
  const finalUserQToCreateARoom = [];
  finalUserQToCreateARoom.push(newUser);

  for (let i = 0; i < tempQ.length; i++) {
    if (finalUserQToCreateARoom.length === 3) {
      RefactorTempQ(finalUserQToCreateARoom, tempQ).then(function (data) {
        CreateRoom(finalUserQToCreateARoom, 3);
        debug("#user left in q " + tempQ.length);
      });
      break;
    }

    if (tempQ[i].userId === newUser.userId) continue;

    let canAdd = true;
    for (let j = 0; j < finalUserQToCreateARoom.length; j++) {
      const avoidSamePawnType = finalUserQToCreateARoom[j].pawnType === tempQ[i].pawnType;
      if (avoidSamePawnType) {
        canAdd = false;
        break;
      }
    }
    
    if (canAdd) {
      finalUserQToCreateARoom.push(tempQ[i]);
    }
  }
}

function RefactorTempQ(users, tempQ) {
  return new Promise(function (resolve, reject) {
    // Create a copy of users to avoid modification during iteration
    const usersCopy = [...users];
    
    for (let usersIndex = 0; usersIndex < usersCopy.length; usersIndex++) {
      for (let tempQIndex = tempQ.length - 1; tempQIndex >= 0; tempQIndex--) {
        if (usersCopy.length === 0) break;

        if (tempQ[tempQIndex].socket.id === usersCopy[usersIndex].socket.id) {
          debug("user removed from the tempQ :" + tempQ[tempQIndex].socket.id);
          tempQ.splice(tempQIndex, 1);
        }
      }

      if (usersCopy.length === 0) break;
    }

    resolve("done");
  });
}

// Create a game room
function CreateRoom(tempUserQ, roomLimit) {
  const players = roomLimit;
  debug("player:" + players);
  const roomName = shortId.generate();
  
  JoinRoom(tempUserQ, roomLimit, roomName).then(function (data) {
    startGame(data["userSocketObj"], data["roomName"], io);
  }).catch(function(error) {
    debug("Error creating room: " + error);
  });
}

function JoinRoom(tempUserQ, players, roomName) {
  const userSocketObj = [];
  
  return new Promise(function (resolve, reject) {
    try {
      for (let i = 0; i < players; i++) {
        if (!tempUserQ[i] || !tempUserQ[i].socket) {
          return reject("Invalid user at index " + i);
        }
        
        user.addUser(tempUserQ[i].socket, roomName, tempUserQ[i].pawnType, tempUserQ[i].userId);
        userSocketObj.push({
          socket: tempUserQ[i].socket,
          pawnType: tempUserQ[i].pawnType
        });
        
        tempUserQ[i].socket.join(roomName, function () {
          debug("user ".concat(tempUserQ[i].socket.id, " joined room ").concat(roomName, " of pawnType ").concat(tempUserQ[i].pawnType));
        });
      }

      resolve({
        userSocketObj: userSocketObj.concat(),
        roomName: roomName
      });
    } catch (err) {
      reject("Error joining room: " + err);
    }
  });
}

// Get room users with modern Socket.IO API
function getRoomUsers(roomName) {
  const room = io.sockets.adapter.rooms.get(roomName);
  if (!room) return [];
  
  const users = [];
  room.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      users.push(socket);
    }
  });
  
  return users;
}

// Add periodic cleanup of disconnected sockets
setInterval(() => {
  debug("Running periodic cleanup");
  cleanupDisconnectedSockets(tempTwoUserQ);
  cleanupDisconnectedSockets(tempThreeUserQ);
  cleanupDisconnectedSockets(tempFourUserQ);
}, 60000); // Every minute

function cleanupDisconnectedSockets(queue) {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!queue[i].socket.connected) {
      debug("Removing disconnected socket from queue: " + queue[i].socket.id);
      queue.splice(i, 1);
    }
  }
}

// Error handling for process
process.on('uncaughtException', function(err) {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', function(reason, promise) {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  debug('SIGTERM received, shutting down gracefully');
  
  http.close(() => {
    debug('HTTP server closed');
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    debug('Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
});

// Start the server
http.listen(PORT, function () {
  debug('Server listening on port ' + PORT);
});