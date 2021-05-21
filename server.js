const bcrypt = require('bcrypt');
const express = require('express');
const { check, matchedData  } = require('express-validator');
const httpModule = require('http');
const path = require('path');
const socketIO = require('socket.io');

/* ----MARK: App Initializations ---- */
const app = express();
const originWhitelist = [/midarom\.herokuapp\.com$/, 'http://localhost:3000'];
const corsOptions =  {
    cors: {
        origin: originWhitelist,
        methods: ["GET", "POST"],
        transports: ['websocket', 'polling'],
        credentials: true
    },
    allowEIO3: true
}; 
const httpServer = httpModule.createServer(app);
const io = socketIO(httpServer, corsOptions);

/* ----MARK: App Local Variables ----  */
const users = {};
const cellSocketIds = new Array(10);
const sentData = {};
const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
let availableCells = '1111111111'; 
const port = process.env.PORT || 3000;
const loopbackUrls = ['localhost', '127.0.0.1']

const replaceAt = (str, index, char) => {
    return str.substr(0, index) + char + str.substr(index + char.length);
};

let masterUsername = "";
let masterLoggedIn = false;
let masterSocket;

/* ----MARK: Setup Middleware functionality for App ---- */
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('port', port);
app.set('trust proxy', 'loopback, linklocal, uniquelocal');


/* ----MARK: Setup App routes and handlers ---- */

// Redirect all HTTP requests to HTTPS
// app.get('*', function(req, res) {  
//     console.log("redirecting ", req.baseUrl, req.originalUrl, req.hostname); 
//     if (!loopbackUrls.includes(req.hostname)) {  
//         console.log("redirecting again"); 
//         res.redirect('https://' + req.headers.host + req.url);
//     }
// });

app.get('/master', (req, res, next) => {
    console.log("loading master"); 
    const options = {
        root: path.join(__dirname, 'public'),
        headers: {
            'x-timestamp': Date.now(),
            'x-sent': true
        }
    };
    res.sendFile('master-login.html', options, (err) => {
        if (err) {
          next(err);
        }
    });
});

app.post(
    '/master', 
    check('masterPassword').trim().not().isEmpty().escape().isAlphanumeric(),
    check('id').optional({checkFalsy: true}).escape(),
    check('projector').optional({checkFalsy: true}).isInt(),
    (req, res, next) => {
        const  { masterPassword: passwordInput } = matchedData(req, { locations: ['body'] });
        let masterHash = process.env.MASTER_PW_HASH;
        console.log("PROCESS HASH", process.env.MASTER_PW_HASH)
        if (!masterHash) {
            const { MASTER_PW_HASH: localHash } = require('./local-dev/credentials');
            masterHash = localHash;
        }
        if (passwordInput) {
            bcrypt.compare(passwordInput, masterHash, (err, isMatch) => {
                if (isMatch && !err) {
                    const  { id, projector } = matchedData(req, { locations: ['query'] });
                    let redirectPath = '/console?uid=' + masterUsername;
                    redirectPath += id ? `&id=${id}` : '';
                    redirectPath += projector ? `&projector=${parseInt(projector)}` : '';
                    res.redirect(redirectPath);
                } else {
                    res.send('Incorrect Password. Refresh to ry again.');
                }
            })
           
        } else {
            res.sendStatus(403);
        }
    }   
);

app.get('/console', (req, res, next) => {

    if (masterLoggedIn) {
        res.sendStatus(403);
        return;
    }

    const { query: { uid: username }} = req;

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
                console.err("error sending console file", username)
                next(err);
                return;
            }
        });

        masterLoggedIn = true;
    } else {
        res.redirect('/');
    }
});

/* ----MARK: Private Methods ---- */

const generateMasterUsername = () => {
    if (masterUsername.length) masterUsername = "";
    for(let i=0;i<16;i++) {
        const index = Math.round(Math.random() * (alphabet.length - 1));
        const c = index % masterUsername.length === 0 ? alphabet[index].toUpperCase() : alphabet[index].toLowerCase();
        masterUsername += c;
    }
};

const resetMaster = (socket) => {
    if (socket && masterSocket && socket.id === masterSocket.id) {
        masterSocket = null;
        masterLoggedIn = false;
        generateMasterUsername();
    }
}

const cleanuponDisconnect = (socket) => {
    if (socket && users[socket.id]) {
        const { activeCell } = users[socket.id];
        if (activeCell >= 0) {
            availableCells = replaceAt(availableCells, activeCell, '1');
        }
        resetMaster(socket);
        delete users[socket.id];
    }
};

const disconnectDrawingClient = (clientCellIndex, ackCallback) => {
    if (clientCellIndex >= 0 && clientCellIndex < cellSocketIds.length) {
        const clientSocketId = cellSocketIds[clientCellIndex];
        const clientCell = users[clientSocketId];
        if (clientCell && clientCell.socket) {
            if (masterSocket) {
                masterSocket.to(clientSocketId).emit('msgFromController', { controllerMessage: 'Your connection has been reset. Refresh in 5s to rejoin.' });
            }
            if (ackCallback) ackCallback("ok");
            clientCell.socket.disconnect(true);
            cleanuponDisconnect(clientCell.socket);
        } else {
            if (ackCallback) ackCallback("Invalid socket for requested client");
        }
    } else {
        if (ackCallback) ackCallback("Invalid `clientCellIndex` provided")
    }
}

const discconnectEventCallback = (event, data, ackCallback) => {
    console.log('disconnecting client event');
    const { username } = data;
    if (username && username === masterUsername) {
        if (event === 'disconnectAllClients') {
            for(let i=0;i<cellSocketIds.length;i++) {
                disconnectDrawingClient(i);
            }
            ackCallback("ok");
        } else if (event === 'disconnectClient') {
            const { clientCellIndex } = data;
            if (clientCellIndex) {
                disconnectDrawingClient(clientCellIndex, ackCallback);
            } else {
                ackCallback("Invalid `clientCellIndex` provided");
            }   
        }
    } else {
        ackCallback("Unauthorized client username");
    }
};

/* ----MARK: Socket IO Events ---- */

io.sockets.on('connection', (socket) => {

    io.emit('availableCells', availableCells);

    if (!users[socket.id]) {
        users[socket.id] = {socket, activeCell: -1};
    }

    socket.on('disconnect', () => {
        cleanuponDisconnect(socket);
        io.emit('availableCells', availableCells);
    });

    socket.on('registerUsername', ({username}) => {
        if (masterLoggedIn && username === masterUsername) {
            masterSocket = socket;
       }
    }); 

    socket.on('mouse', (data) => {
        const { canvasIndex } = data;
        if (!sentData[canvasIndex]) {
            sentData[canvasIndex] = [];
        }
        sentData[canvasIndex].push(data);
        socket.broadcast.emit('mouse', data)
    }); 
    
    socket.on('relinquishCell', (data, ackCallback) => {
        const { socketID, activeCell } = data;
        // acknowledgementCallback("SERVER trying to relinquish" + activeCell + socketID);
        if (socketID && availableCells[activeCell] == '0') {
            const userData = users[socketID];
            if (userData && userData.activeCell === activeCell) {
                users[socketID].activeCell = -1;
                availableCells = replaceAt(availableCells, activeCell, '1');
                cellSocketIds[activeCell] = null;
                ackCallback(availableCells);
                socket.broadcast.emit('availableCells', availableCells); 
            }
        }
    });
    
    socket.on('requestCell', (data, ackCallback) => {
        const { socketID, requestedCell } = data;
        if (socketID && requestedCell >= 0 && requestedCell < availableCells.length) {
            if (availableCells.charAt(requestedCell) == '1') {
                users[socketID].activeCell = requestedCell;
                ackCallback(availableCells);
                availableCells = replaceAt(availableCells, requestedCell, '0');
                cellSocketIds[requestedCell] = socketID;
                socket.broadcast.emit('availableCells', availableCells);
            }
        }
    });

    socket.on('disconnectClient', (data, ackCallback) => {
        discconnectEventCallback('disconnectClient', data, ackCallback)
    });
    
    socket.on('disconnectAllClients', (data, ackCallback) => {
        socket.broadcast.emit('clearAllDrawings');
        discconnectEventCallback('disconnectAllClients', data, ackCallback);
    });

    socket.on('clearAll', (data, ackCallback) => {
        const { username } = data;
        if (username === masterUsername) {
            ackCallback("ok");
            socket.broadcast.emit('clearAllDrawings');
        } else {
            ackCallback("Unauthorized client username");
        }
    });

    socket.on('clearClientDrawing', (data, ackCallback) => {
        const { clientCellIndex, username } = data;
        if (username === masterUsername) {
            if (clientCellIndex >= 0 && clientCellIndex < cellSocketIds.length) {
                const clientSocketId = cellSocketIds[clientCellIndex];
                if (clientSocketId) {
                    socket.to(clientSocketId).emit('clear');
                    ackCallback("ok");
                } else {
                    ackCallback("Invalid socket for requested client");
                }
            } else {
                ackCallback("Invalid `clientCellIndex` provided")
            }
        } else {
            ackCallback("Unauthorized client username");
        }
    });

    socket.on('messageClient', (data, ackCallback) => {
        const { clientCellIndex, username, messageForClient } = data;
        // TODO: GET CLIENTS SOCKET ID AND DISCONNECT IT BASED ON THAT
        if (username === masterUsername) {
            if (clientCellIndex >= 0 && clientCellIndex < cellSocketIds.length) {
                let clientSocketId = cellSocketIds[clientCellIndex];
                if (clientSocketId) {
                    socket.to(clientSocketId).emit('msgFromController', { controllerMessage: messageForClient })
                    ackCallback("ok");
                } else {
                    ackCallback("Invalid socket for requested client");
                }
            } else {
                ackCallback("Invalid `clientCellIndex` provided")
            }
        } else {
            ackCallback("Unauthorized client username");
        }
    });

    socket.on('disableCellForClients', (data, ackCallback) => {
        const { clientCellIndex, username } = data;
        // TODO: GET CLIENTS SOCKET ID AND DISCONNECT IT BASED ON THAT
        if (username === masterUsername) {
            if (clientCellIndex >= 0 && clientCellIndex < availableCells.length) {
                ackCallback("ok");
                availableCells = replaceAt(availableCells, clientCellIndex, '2');
                cellSocketIds[clientCellIndex] = null;
                socket.broadcast.emit('availableCells', availableCells);
            } else {
                ackCallback("Invalid `clientCellIndex` provided")
            }
        } else {
            ackCallback("Unauthorized client username");
        }
    });
    
    socket.on('enableCellForClients', (data, ackCallback) => {
        const { clientCellIndex, username } = data;
        // TODO: GET CLIENTS SOCKET ID AND DISCONNECT IT BASED ON THAT
        if (username === masterUsername) {
            if (clientCellIndex >= 0 && clientCellIndex < availableCells.length) {
                ackCallback("ok");
                availableCells = replaceAt(availableCells, clientCellIndex, '1');
                cellSocketIds[clientCellIndex] = null;
                socket.broadcast.emit('availableCells', availableCells);
            } else {
                ackCallback("Invalid `clientCellIndex` provided")
            }
        } else {
            ackCallback("Unauthorized client username");
        }
    });
   
});

httpServer.listen(port, () => {
  generateMasterUsername();
  console.log('listening on *:', port);
});
