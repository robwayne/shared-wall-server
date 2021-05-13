const express = require('express');
const app = express();
const http = require('http').createServer(app);
const cors =  {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"],
        transports: ['websocket', 'polling'],
        credentials: true
    },
    allowEIO3: true
};
const io = require('socket.io')(http, cors);
const path = require('path');

const users = {};
const sentData = {};
const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
const port = process.env.PORT || 3000;

//TODO: change
const rootPW = "123654";

let masterUsername = "";
let masterLoggedIn = false;

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('port', port);

app.get('/master', (req, res, next) => {
    const options = {
        root: path.join(__dirname, 'public'),
        headers: {
            'x-timestamp': Date.now(),
            'x-sent': true
        }
    };
    res.sendFile('master-login.html', options, (err) => {
        if (err) {
          next(err)
        } else {
          console.log('Sent:', 'master')
        }
    });
});

app.post('/master', (req, res, next) => {
        // const errors = validationResult(req);
        // let success = errors.isEmpty() && req.body.password === rootPW;
        // console.log("isssues", success, errors)
        // if (success) {
        console.log("request body", req.body);
        if (req.body.masterPassword && req.body.masterPassword === rootPW) {
            masterLoggedIn = true;
            res.redirect('/console?mu=' + masterUsername);
        }
});

app.get('/console', (req, res, next) => {

    if (!masterLoggedIn) {
        res.sendStatus(403);
        return;
    }

    const { query: { mu: username }} = req;
    console.log('GOT USERNAME', username);

    if (username && masterUsername === username) {
        const options = {
            root: path.join(__dirname, 'public'),
            headers: {
                'x-timestamp': Date.now(),
                'x-sent': true
            }
        };
        
        res.sendFile('console-root.html', options, (err) => {
            if (err) {
                console.log("error sending console file", username)
                next(err);
                return;
            } else {
                console.log('Sent:', 'console')
            }
        })
    }
});

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

    socket.on('disconnectClient', ({clientIndex: index}) => {
        console.log('disconnectClient');
    })
})

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
