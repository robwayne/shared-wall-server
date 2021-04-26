const express = require('express');
const app = express();
const http = require('http').createServer(app);
const cors =  {
    cors: {
        origin: "https://midarom.herokuapp.com/",
        methods: ["GET", "POST"],
        transports: ['websocket', 'polling'],
        credentials: true
    },
    allowEIO3: true
};
const io = require('socket.io')(http, cors);

const users = {};
const sentData = {};
let clientSketchIndex = 0;
const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
let masterUsername = "";
const port = process.env.PORT || 3000;

// app.get('/', (req, res) => {
//   res.sendFile('index.html');
// });

app.use(express.static('public'))
app.set('port', port)

// MARK: SOCKET IO
io.sockets.on('connection', (socket) => {
    console.log('a user connected');
    if (!users[socket.id]) {
        users[socket.id] = socket;
        socket.on('disconnect', () => {
            delete users[socket.id];
        });
    }
    // socket.emit("sketchIndex", {sketchIndex: clientSketchIndex})

    // socket.emit("sentSketchData", sentData)
    // clientSketchIndex++;

    socket.on('mouse', (data) => {
        const { canvasIndex } = data;
        if (!sentData[canvasIndex]) {
            sentData[canvasIndex] = [];
        }
        sentData[canvasIndex].push(data);
        socket.broadcast.emit('mouse', data)
    });
})

// io.use((socket, next) => {
//     const username = socket.handshake.auth.username;
//     if (!username) {
//       return next(new Error("invalid username"));
//     }
//     socket.username = username;
//     next();
// });

const generateMasterUsername = () => {
    if (masterUsername.length) masterUsername = "";
    for(let i=0;i<16;i++) {
        const index = Math.round(Math.random() * (alphabet.length - 1));
        const c = index % masterUsername.length === 0 ? alphabet[index].toUpperCase() : alphabet[index].toLowerCase();
        masterUsername += c;
    }
    console.log(masterUsername)
};

http.listen(port, () => {
  generateMasterUsername();
  console.log('listening on *:', port);
});
